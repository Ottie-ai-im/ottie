import { startSpeechRecognition } from "@/voice-control/speech-recognition";
import type { SpeechRecognitionHandle } from "@/voice-control/speech-recognition-types";
import { matchIntent } from "@/voice-control/voice-router";
import {
  VOICE_COMMANDS,
  getCommandByName,
  type CommandResult,
  type VoiceCommand,
} from "@/voice-control/voice-commands";
import { useVoiceControlStore, type ActionLogEntry } from "@/voice-control/voice-control-store";
import { flyGhostCursorForCommand } from "@/voice-control/ghost-cursor-target";
import {
  routeVoiceIntent,
  serializeCommandsForRouting,
  VOICE_ROUTE_DEFAULT_TIMEOUT_MS,
  type VoiceRouteResult,
} from "@/voice-control/voice-route-rpc";
import {
  APP_SETTINGS_QUERY_KEY,
  DEFAULT_APP_SETTINGS,
  type AppSettings,
} from "@/hooks/use-settings";
import { queryClient } from "@/query/query-client";

/**
 * Voice control runtime. Owns the full PTT lifecycle:
 *
 *   user holds hotkey
 *     ↓ startPushToTalk()
 *   speech recognition runs, transcript streams into store
 *     ↓ stopPushToTalk()  (user released)
 *   processing: brief pause, intent router matches
 *     ↓ scheduleExecution(command)  if matched
 *   2-second cancellable countdown ("Running in 2s · 1s · …")
 *     ↓ runCommand()  if not cancelled
 *   handler executes, log entry updated, transition to "done" then idle
 *
 * Pattern adapted from realtime-voice-component:
 *   - app-owned narrow tools (VOICE_COMMANDS) → matched intent → executed
 *   - controller is a singleton lifetime, not per-component
 *   - cleanup is idempotent so React strict-mode remounts can't leak audio
 *
 * The controller never reads React state directly. UI subscribes to the
 * store to render the pill / orb. Settings (enabled, hotkey) are read by
 * the press hooks before they decide whether to call `startPushToTalk()`.
 */

const COUNTDOWN_TOTAL_MS = 2000;
const COUNTDOWN_TICK_MS = 100;
const DONE_FADE_MS = 900;
const PROCESSING_GRACE_MS = 200;

/** Convert `open_file_explorer` → `Open file explorer` for the action log. */
function humanizeCommandName(name: string): string {
  const spaced = name.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Read AppSettings synchronously from the React Query cache. The controller
 * runs outside React, so we can't use `useAppSettings()` here; reading the
 * cache directly is the documented way to access cached query data
 * imperatively. Returns the persisted defaults if the cache hasn't loaded
 * yet (first frame after mount).
 */
function readAppSettingsSnapshot(): AppSettings {
  return queryClient.getQueryData<AppSettings>([...APP_SETTINGS_QUERY_KEY]) ?? DEFAULT_APP_SETTINGS;
}

class VoiceController {
  private recognition: SpeechRecognitionHandle | null = null;
  private latestTranscript = "";
  private pendingExecutionTimer: ReturnType<typeof setTimeout> | null = null;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;
  private doneFadeTimer: ReturnType<typeof setTimeout> | null = null;

  /** Called from the PTT pill / floating orb when the user starts holding. */
  startPushToTalk(): void {
    this.cleanupTimers();
    const store = useVoiceControlStore.getState();
    store.startRecording();
    this.latestTranscript = "";

    const handle = startSpeechRecognition({
      onResult: ({ transcript }) => {
        this.latestTranscript = transcript;
        useVoiceControlStore.getState().setTranscript(transcript);
      },
      onError: (message) => {
        useVoiceControlStore.getState().setError(message);
      },
      onEnd: () => {
        // Fired by the engine itself (not a manual stop). If we're still in
        // recording phase, the user probably stopped speaking before
        // releasing the hotkey — keep the latest transcript and let
        // stopPushToTalk handle dispatch.
      },
    });

    this.recognition = handle;
  }

  /** Called when the user releases the hotkey / orb. */
  stopPushToTalk(): void {
    this.recognition?.stop();
    this.recognition = null;
    const store = useVoiceControlStore.getState();
    store.stopRecording();

    // Brief pause to let the speech engine deliver any final fragments
    // queued in flight, then dispatch the matched intent.
    setTimeout(() => {
      void this.dispatchTranscript(this.latestTranscript);
    }, PROCESSING_GRACE_MS);
  }

  /** User cancelled while countdown was ticking — abort, mark skipped. */
  cancelPending(): void {
    this.cleanupTimers();
    const store = useVoiceControlStore.getState();
    const pending = store.actionLog.find((entry) => entry.status === "pending");
    if (pending) {
      store.updateAction(pending.id, {
        status: "skipped",
        message: "Cancelled before execution",
      });
    }
    this.scheduleFadeToIdle();
  }

  /** Hard reset — used by error paths and on unmount. */
  reset(): void {
    this.cleanupTimers();
    this.recognition?.stop();
    this.recognition = null;
    useVoiceControlStore.getState().reset();
  }

  /**
   * Run a known command directly, bypassing STT and intent matching.
   * Useful for the "Quick test" buttons in Labs and for any future
   * keyboard-shortcut command palette — the same execution path as voice
   * (countdown, ghost cursor, action log, bridge call) but deterministic.
   */
  testRun(commandName: string, params: unknown = {}): void {
    const command = getCommandByName(commandName);
    if (!command) {
      const store = useVoiceControlStore.getState();
      store.setError(`Unknown command "${commandName}"`);
      this.scheduleFadeToIdle();
      return;
    }
    this.cleanupTimers();
    const store = useVoiceControlStore.getState();
    store.startRecording();
    store.stopRecording();
    store.setTranscript(`(test) ${humanizeCommandName(commandName)}`);

    const entry: ActionLogEntry = {
      id: `vc-${Date.now()}`,
      command: humanizeCommandName(commandName),
      status: "pending",
      message: "Test · Press Esc to cancel",
    };
    store.pushAction(entry);
    store.setCountdownRemainingMs(COUNTDOWN_TOTAL_MS);
    this.startCountdown(command, params, entry.id);
  }

  // -------------------------------------------------------------------------

  private async dispatchTranscript(transcript: string): Promise<void> {
    const store = useVoiceControlStore.getState();
    const trimmed = transcript.trim();
    if (!trimmed) {
      store.setError("Didn't catch that — try holding the hotkey longer.");
      this.scheduleFadeToIdle();
      return;
    }

    // Read settings imperatively — controller lives outside React.
    const settings = readAppSettingsSnapshot();
    const intentProvider = settings.betaFeatures.voiceControl.intentProvider;
    const intentModelId = settings.betaFeatures.voiceControl.intentModelId;

    let resolved: { command: VoiceCommand; params: unknown } | null = null;
    let routedVia: "heuristic" | "ai" | "ai-fallback" = "heuristic";

    if (intentProvider !== "heuristic") {
      const aiResult = await this.runAiRouting(trimmed, intentProvider, intentModelId);
      if (aiResult) {
        resolved = aiResult;
        routedVia = "ai";
      } else {
        // AI mode requested but routing failed — log a hint, then fall
        // through to the local heuristic so the user still gets something.
        routedVia = "ai-fallback";
      }
    }

    if (!resolved) {
      const match = matchIntent(trimmed);
      if (match) {
        resolved = { command: match.command, params: match.params };
      }
    }

    if (!resolved) {
      const fallbackHint =
        routedVia === "ai-fallback"
          ? `${trimmed}" — AI routing unavailable, heuristic also missed.`
          : `${trimmed}".`;
      store.setError(`Couldn't match a command for "${fallbackHint}`);
      this.scheduleFadeToIdle();
      return;
    }

    let tag: string;
    if (routedVia === "ai") tag = "AI";
    else if (routedVia === "ai-fallback") tag = "Heuristic (AI unavailable)";
    else tag = "Heuristic";

    const entry: ActionLogEntry = {
      id: `vc-${Date.now()}`,
      command: humanizeCommandName(resolved.command.name),
      status: "pending",
      message: `${tag} · Press Esc to cancel`,
    };
    store.pushAction(entry);
    store.setCountdownRemainingMs(COUNTDOWN_TOTAL_MS);
    this.startCountdown(resolved.command, resolved.params, entry.id);
  }

  private async runAiRouting(
    transcript: string,
    provider: Exclude<
      ReturnType<typeof readAppSettingsSnapshot>["betaFeatures"]["voiceControl"]["intentProvider"],
      "heuristic"
    >,
    modelId: string | null,
  ): Promise<{ command: VoiceCommand; params: unknown } | null> {
    let result: VoiceRouteResult;
    try {
      result = await routeVoiceIntent({
        transcript,
        provider,
        modelId,
        commands: serializeCommandsForRouting(VOICE_COMMANDS),
        timeoutMs: VOICE_ROUTE_DEFAULT_TIMEOUT_MS,
      });
    } catch (err) {
      // Network / unexpected errors — log to store, return null so caller
      // falls back to heuristic.
      const store = useVoiceControlStore.getState();
      store.setError(err instanceof Error ? err.message : "AI routing crashed");
      return null;
    }

    if (!result.ok) {
      return null;
    }

    const command = getCommandByName(result.commandName);
    if (!command) {
      // The AI hallucinated a command name we don't have. Fall back.
      return null;
    }

    return { command, params: result.params };
  }

  private startCountdown(command: VoiceCommand, params: unknown, entryId: string): void {
    const startedAt = Date.now();
    this.countdownInterval = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, COUNTDOWN_TOTAL_MS - elapsed);
      useVoiceControlStore.getState().setCountdownRemainingMs(remaining);
    }, COUNTDOWN_TICK_MS);

    this.pendingExecutionTimer = setTimeout(() => {
      this.cleanupTimers();
      void this.runCommand(command, params, entryId);
    }, COUNTDOWN_TOTAL_MS);
  }

  private async runCommand(command: VoiceCommand, params: unknown, entryId: string): Promise<void> {
    const store = useVoiceControlStore.getState();
    store.setCountdownRemainingMs(null);
    store.updateAction(entryId, { status: "running", message: "Running…" });

    // Visual feedback: fly the ghost cursor toward the command's anchor
    // (button tagged with data-voice-target) before the handler fires, so
    // the user sees WHERE the action lands. Web-only; native is a noop.
    flyGhostCursorForCommand(command.name);

    let result: CommandResult;
    try {
      // Validate via the command's own schema before invoking. Defends
      // against a stale router or future LLM that produces malformed args.
      const parsed = command.schema.parse(params);
      result = await command.handler(parsed as never);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result = { ok: false, message };
    }

    store.updateAction(entryId, {
      status: result.ok ? "ok" : "error",
      message: result.message ?? (result.ok ? "Done" : "Failed"),
    });
    this.scheduleFadeToIdle();
  }

  private scheduleFadeToIdle(): void {
    useVoiceControlStore.getState().finish();
    this.doneFadeTimer = setTimeout(() => {
      useVoiceControlStore.getState().reset();
    }, DONE_FADE_MS);
  }

  private cleanupTimers(): void {
    if (this.pendingExecutionTimer) {
      clearTimeout(this.pendingExecutionTimer);
      this.pendingExecutionTimer = null;
    }
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    if (this.doneFadeTimer) {
      clearTimeout(this.doneFadeTimer);
      this.doneFadeTimer = null;
    }
  }
}

/**
 * Module-level singleton. The PTT pill and orb both call into this; both
 * eventually unmount during navigation but the controller's state outlives
 * them so a multi-screen voice turn doesn't break.
 */
export const voiceController = new VoiceController();
