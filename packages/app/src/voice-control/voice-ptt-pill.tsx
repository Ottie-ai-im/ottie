import { useCallback, useEffect, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Mic, Loader2, X } from "lucide-react-native";
import { isWeb } from "@/constants/platform";
import { useAppSettings } from "@/hooks/use-settings";
import {
  selectVoiceActionLog,
  selectVoiceCountdownRemainingMs,
  selectVoiceErrorMessage,
  selectVoicePhase,
  selectVoiceTranscript,
  useVoiceControlStore,
} from "@/voice-control/voice-control-store";
import { keyboardEventMatchesHotkey } from "@/voice-control/hotkey-format";
import { voiceController } from "@/voice-control/voice-controller";

/**
 * Desktop / web push-to-talk pill.
 *
 * Visible only while the configured hotkey is held (or post-release while the
 * runtime processes & executes commands). Bottom-right floating card showing:
 *   - while recording: mic + waveform placeholder + transcript-as-it-arrives
 *   - while processing: spinner + last transcript
 *   - while executing: action log with status ticks
 *
 * Phase 1 wires only the hotkey listener. Audio capture, STT, and intent
 * dispatch land in phase 2. The pill renders correctly for all phases once
 * those layers feed into the store.
 */
export function VoicePttPill() {
  const { settings } = useAppSettings();
  const voice = settings.betaFeatures.voiceControl;

  const phase = useVoiceControlStore(selectVoicePhase);
  const transcript = useVoiceControlStore(selectVoiceTranscript);
  const actionLog = useVoiceControlStore(selectVoiceActionLog);
  const countdownRemainingMs = useVoiceControlStore(selectVoiceCountdownRemainingMs);
  const errorMessage = useVoiceControlStore(selectVoiceErrorMessage);

  // Hotkey press/release listener — web only. Native uses the floating orb.
  useEffect(() => {
    if (!isWeb || typeof document === "undefined") return;
    if (!voice.enabled || !voice.pushToTalkHotkey) return;

    let isActive = false;

    const onDown = (event: KeyboardEvent) => {
      // Repeat events fire while the key is held — ignore to keep `phase`
      // stable. Only the leading edge transitions idle → recording.
      if (event.repeat) return;
      // Esc cancels a pending countdown without re-checking the hotkey.
      if (event.key === "Escape") {
        const currentPhase = useVoiceControlStore.getState().phase;
        if (currentPhase === "executing" || currentPhase === "processing") {
          event.preventDefault();
          voiceController.cancelPending();
          return;
        }
      }
      if (!keyboardEventMatchesHotkey(event, voice.pushToTalkHotkey)) return;
      // Don't hijack typing in inputs.
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) {
          return;
        }
      }
      event.preventDefault();
      isActive = true;
      voiceController.startPushToTalk();
    };

    const onUp = (event: KeyboardEvent) => {
      if (!isActive) return;
      // Release fires when ANY of the combo keys is released. Trigger stop on
      // the first release after recording started.
      if (
        event.key === "Meta" ||
        event.key === "Shift" ||
        event.key === "Control" ||
        event.key === "Alt" ||
        keyboardEventMatchesHotkey(event, voice.pushToTalkHotkey)
      ) {
        event.preventDefault();
        isActive = false;
        voiceController.stopPushToTalk();
      }
    };

    document.addEventListener("keydown", onDown);
    document.addEventListener("keyup", onUp);
    return () => {
      document.removeEventListener("keydown", onDown);
      document.removeEventListener("keyup", onUp);
      // Defensive: if the user disabled the feature mid-recording, tear down
      // the controller so the mic stops. Idempotent.
      voiceController.reset();
    };
  }, [voice.enabled, voice.pushToTalkHotkey]);

  if (!voice.enabled) return null;
  if (!isWeb) return null;
  if (phase === "idle") return null;

  return (
    <PillBody
      phase={phase}
      transcript={transcript}
      actionLog={actionLog}
      countdownRemainingMs={countdownRemainingMs}
      errorMessage={errorMessage}
    />
  );
}

interface PillBodyProps {
  phase: ReturnType<typeof selectVoicePhase>;
  transcript: string;
  actionLog: ReturnType<typeof selectVoiceActionLog>;
  countdownRemainingMs: number | null;
  errorMessage: string | null;
}

// Stable Reanimated layout-anim instances so we don't construct a fresh one
// on every render (perf-rule trigger + GC churn).
const PILL_ENTERING = FadeIn.duration(140);
const PILL_EXITING = FadeOut.duration(160);

function PillBody({
  phase,
  transcript,
  actionLog,
  countdownRemainingMs,
  errorMessage,
}: PillBodyProps) {
  const { theme } = useUnistyles();

  const handleCancel = useCallback(() => voiceController.cancelPending(), []);

  const isCountdownActive =
    phase === "executing" && countdownRemainingMs !== null && countdownRemainingMs > 0;
  const countdownSeconds = countdownRemainingMs ? Math.ceil(countdownRemainingMs / 1000) : 0;

  const headline = useMemo(() => {
    if (phase === "recording") return "Listening…";
    if (phase === "processing") return "Processing";
    if (phase === "executing")
      return isCountdownActive ? `Running in ${countdownSeconds}s` : "Running";
    if (phase === "done") return errorMessage ? "Couldn't run that" : "Done";
    return "";
  }, [phase, isCountdownActive, countdownSeconds, errorMessage]);

  const inactiveIconBubbleStyle = useMemo(
    () => [styles.iconBubble, { backgroundColor: theme.colors.surface3 }],
    [theme.colors.surface3],
  );

  return (
    <Animated.View
      entering={PILL_ENTERING}
      exiting={PILL_EXITING}
      style={styles.pillContainer}
      pointerEvents="none"
    >
      <View style={styles.headerRow}>
        {phase === "recording" ? (
          <View style={styles.iconBubble}>
            <Mic size={16} color={theme.colors.accentForeground} />
          </View>
        ) : (
          <View style={inactiveIconBubbleStyle}>
            <Loader2 size={16} color={theme.colors.foreground} />
          </View>
        )}
        <Text style={styles.headerText}>{headline}</Text>
        {isCountdownActive ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel pending command"
            onPress={handleCancel}
            style={styles.cancelButton}
            testID="voice-control-cancel"
          >
            <X size={14} color={theme.colors.foreground} />
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>
        ) : null}
      </View>
      <TranscriptOrPlaceholder phase={phase} transcript={transcript} />
      {errorMessage && phase !== "recording" ? (
        <Text style={styles.errorText} numberOfLines={2}>
          {errorMessage}
        </Text>
      ) : null}
      {actionLog.length > 0 ? (
        <View style={styles.actionList}>
          {actionLog.map((entry) => (
            <ActionLogRow key={entry.id} entry={entry} />
          ))}
        </View>
      ) : null}
    </Animated.View>
  );
}

interface TranscriptOrPlaceholderProps {
  phase: ReturnType<typeof selectVoicePhase>;
  transcript: string;
}

function TranscriptOrPlaceholder({ phase, transcript }: TranscriptOrPlaceholderProps) {
  if (transcript) {
    return (
      <Text style={styles.transcriptText} numberOfLines={3}>
        “{transcript}”
      </Text>
    );
  }
  if (phase === "recording") {
    return <Text style={styles.placeholderText}>Speak now — release the hotkey to execute.</Text>;
  }
  return null;
}

interface ActionLogRowProps {
  entry: ReturnType<typeof selectVoiceActionLog>[number];
}

function ActionLogRow({ entry }: ActionLogRowProps) {
  const dotStyle = useMemo(
    () => [
      styles.actionDot,
      entry.status === "ok" && styles.actionDotOk,
      entry.status === "error" && styles.actionDotError,
      entry.status === "running" && styles.actionDotRunning,
    ],
    [entry.status],
  );
  return (
    <View style={styles.actionRow}>
      <View style={dotStyle} />
      <Text style={styles.actionText} numberOfLines={1}>
        {entry.command}
        {entry.message ? ` — ${entry.message}` : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  pillContainer: {
    position: "absolute",
    right: theme.spacing[6],
    bottom: theme.spacing[6],
    minWidth: 280,
    maxWidth: 360,
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[2],
    ...theme.shadow.lg,
    zIndex: 9000,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  iconBubble: {
    width: 26,
    height: 26,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.accent,
  },
  headerText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  transcriptText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  placeholderText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  cancelButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: "auto",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
  },
  cancelButtonText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.xs,
    lineHeight: 18,
  },
  actionList: {
    gap: theme.spacing[1],
    paddingTop: theme.spacing[1],
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  actionDot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foregroundMuted,
  },
  actionDotOk: {
    backgroundColor: theme.colors.accentBright,
  },
  actionDotError: {
    backgroundColor: theme.colors.destructive,
  },
  actionDotRunning: {
    backgroundColor: theme.colors.palette.amber[500],
  },
  actionText: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
}));
