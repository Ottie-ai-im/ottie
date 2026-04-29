/**
 * Platform-agnostic STT contract used by the voice controller. Implementations
 * live in `.web.ts` (Web Speech API) and `.native.ts` (stub for now — phase 3
 * wires up `@react-native-voice/voice` or expo-speech once we commit a native
 * dep).
 */

export interface SpeechRecognitionResult {
  /** Final or partial transcript so far, accumulated across the session. */
  transcript: string;
  /** True once the engine emits a final result (no more partial updates). */
  isFinal: boolean;
}

export interface SpeechRecognitionHandle {
  /** Stop capturing and tear down. Idempotent. */
  stop(): void;
}

export interface StartSpeechRecognitionOptions {
  onResult: (result: SpeechRecognitionResult) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
}

/**
 * Returns a handle if speech recognition successfully starts; null when the
 * platform doesn't support it (e.g. mobile this phase, or web browsers
 * without the API). The PTT pill should fall back to a "voice not available"
 * hint in those cases.
 */
export type StartSpeechRecognition = (
  options: StartSpeechRecognitionOptions,
) => SpeechRecognitionHandle | null;
