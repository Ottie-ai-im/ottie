import type {
  SpeechRecognitionHandle,
  StartSpeechRecognition,
  StartSpeechRecognitionOptions,
} from "@/voice-control/speech-recognition-types";

/**
 * Native (iOS/Android) STT — phase-2 stub.
 *
 * Returning null here means the controller stays in "recording" visual state
 * but produces no transcript. Phase 3 will wire this to either:
 *   - `@react-native-voice/voice` (cross-platform native bindings), or
 *   - Apple's SFSpeechRecognizer / Android's RecognizerIntent through a thin
 *     custom Expo module, or
 *   - The existing daemon voice path with a "transcription only" mode.
 *
 * The decision is gated on user feedback after they validate the web flow.
 */
export const startSpeechRecognition: StartSpeechRecognition = (
  options: StartSpeechRecognitionOptions,
): SpeechRecognitionHandle | null => {
  options.onError?.("Voice recognition is web-only for now. Mobile support coming next.");
  return null;
};
