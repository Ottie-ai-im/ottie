import { create } from "zustand";

/**
 * Runtime state for the voice control UI surfaces (PTT pill on desktop,
 * floating orb on mobile). Drives visibility, recording state, and a
 * transient action log shown to the user during/after a voice turn.
 *
 * This store is INTENTIONALLY thin — settings persistence lives in
 * {@link useAppSettings} (`betaFeatures.voiceControl.*`). Anything ephemeral
 * (currently recording? captured transcript? action log entries?) lives here.
 *
 * Phase 1 only writes `phase` from key-press / orb-press hooks. Phase 2 will
 * extend this with `transcript: string` once STT is wired, and a list of
 * structured `actions` once the intent router runs.
 */

export type VoiceControlPhase =
  | "idle" // not active
  | "recording" // user holding hotkey / pressing orb
  | "processing" // released, waiting for STT + intent + execution
  | "executing" // commands firing, countdown can cancel
  | "done"; // brief settled state before fading back to idle

export interface ActionLogEntry {
  id: string;
  command: string;
  status: "pending" | "running" | "ok" | "error" | "skipped";
  message?: string;
}

interface VoiceControlState {
  phase: VoiceControlPhase;
  transcript: string;
  actionLog: ActionLogEntry[];
  /** Pre-execution countdown remaining (ms). null when not counting down. */
  countdownRemainingMs: number | null;
  /** Operator-facing error to surface in the pill (no STT, no match, etc). */
  errorMessage: string | null;
  // Wallclock when current phase started — drives countdown visuals.
  phaseStartedAt: number | null;

  startRecording: () => void;
  stopRecording: () => void;
  setProcessing: () => void;
  setTranscript: (transcript: string) => void;
  setError: (message: string | null) => void;
  setCountdownRemainingMs: (remaining: number | null) => void;
  pushAction: (entry: ActionLogEntry) => void;
  updateAction: (id: string, patch: Partial<ActionLogEntry>) => void;
  finish: () => void;
  reset: () => void;
}

const INITIAL_STATE = {
  phase: "idle" as VoiceControlPhase,
  transcript: "",
  actionLog: [] as ActionLogEntry[],
  countdownRemainingMs: null as number | null,
  errorMessage: null as string | null,
  phaseStartedAt: null as number | null,
};

export const useVoiceControlStore = create<VoiceControlState>((set) => ({
  ...INITIAL_STATE,

  startRecording: () =>
    set({
      phase: "recording",
      transcript: "",
      actionLog: [],
      countdownRemainingMs: null,
      errorMessage: null,
      phaseStartedAt: Date.now(),
    }),

  stopRecording: () =>
    set({
      phase: "processing",
      phaseStartedAt: Date.now(),
    }),

  setProcessing: () =>
    set({
      phase: "processing",
      phaseStartedAt: Date.now(),
    }),

  setTranscript: (transcript) => set({ transcript }),

  setError: (errorMessage) => set({ errorMessage }),

  setCountdownRemainingMs: (countdownRemainingMs) => set({ countdownRemainingMs }),

  pushAction: (entry) =>
    set((state) => ({
      phase: "executing",
      phaseStartedAt: state.phase === "executing" ? state.phaseStartedAt : Date.now(),
      actionLog: [...state.actionLog, entry],
    })),

  updateAction: (id, patch) =>
    set((state) => ({
      actionLog: state.actionLog.map((entry) =>
        entry.id === id ? { ...entry, ...patch } : entry,
      ),
    })),

  finish: () =>
    set({
      phase: "done",
      countdownRemainingMs: null,
      phaseStartedAt: Date.now(),
    }),

  reset: () => set(INITIAL_STATE),
}));

/**
 * Selector helpers — keep components subscribing to the smallest slice
 * possible so toggling visibility doesn't re-render the whole pill.
 */
export const selectVoicePhase = (s: VoiceControlState) => s.phase;
export const selectVoiceTranscript = (s: VoiceControlState) => s.transcript;
export const selectVoiceActionLog = (s: VoiceControlState) => s.actionLog;
export const selectVoiceCountdownRemainingMs = (s: VoiceControlState) => s.countdownRemainingMs;
export const selectVoiceErrorMessage = (s: VoiceControlState) => s.errorMessage;
export const selectVoiceIsActive = (s: VoiceControlState) => s.phase !== "idle";
