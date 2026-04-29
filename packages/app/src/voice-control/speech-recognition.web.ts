import type {
  SpeechRecognitionHandle,
  StartSpeechRecognition,
  StartSpeechRecognitionOptions,
} from "@/voice-control/speech-recognition-types";

/**
 * Web Speech API implementation. Uses the browser-native `SpeechRecognition`
 * (or `webkitSpeechRecognition` on Safari/Chromium). No external API key, no
 * network proxy — captures from the user's mic and transcribes locally /
 * via the browser's recognition service.
 *
 * Limitations we accept for phase 2:
 *   - Browser support: Chrome, Edge, Safari ✓; Firefox ✗ (returns null)
 *   - Internet-dependent in some browsers (Chrome uses Google's cloud STT)
 *   - Languages default to the page locale; future work can expose a setting
 */

interface WebSpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [resultIndex: number]: { transcript: string; confidence: number };
    };
  };
}

interface WebSpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface WebSpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives?: number;
  onresult: ((event: WebSpeechRecognitionEvent) => void) | null;
  onerror: ((event: WebSpeechRecognitionErrorEvent) => void) | null;
  onend: ((event: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface WebSpeechRecognitionConstructor {
  new (): WebSpeechRecognitionInstance;
}

function resolveConstructor(): WebSpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, WebSpeechRecognitionConstructor | undefined>;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const startSpeechRecognition: StartSpeechRecognition = (
  options: StartSpeechRecognitionOptions,
): SpeechRecognitionHandle | null => {
  const Ctor = resolveConstructor();
  if (!Ctor) {
    options.onError?.("Speech recognition not supported in this browser.");
    return null;
  }

  const recognition = new Ctor();
  recognition.continuous = true;
  recognition.interimResults = true;
  // Default to the document's language — picks up `<html lang>` if set,
  // else browser locale. Voice commands above are bilingual so this works.
  if (typeof document !== "undefined" && document.documentElement.lang) {
    recognition.lang = document.documentElement.lang;
  }

  let stopped = false;
  let aggregated = "";

  // Use addEventListener instead of `on*` assignment so we don't clobber any
  // listener wired by another consumer (defensive — also satisfies lint).
  recognition.addEventListener("result", ((event: Event) => {
    const e = event as unknown as WebSpeechRecognitionEvent;
    let interim = "";
    let finalChunk = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      if (!result) continue;
      const alternative = result[0];
      if (!alternative) continue;
      if (result.isFinal) {
        finalChunk += alternative.transcript;
      } else {
        interim += alternative.transcript;
      }
    }
    if (finalChunk) {
      aggregated = (aggregated + " " + finalChunk).trim();
      options.onResult({ transcript: aggregated, isFinal: true });
    } else if (interim) {
      const combined = (aggregated + " " + interim).trim();
      options.onResult({ transcript: combined, isFinal: false });
    }
  }) as EventListener);

  recognition.addEventListener("error", ((event: Event) => {
    const e = event as unknown as WebSpeechRecognitionErrorEvent;
    // "no-speech" / "aborted" are common benign cases when the user
    // releases the hotkey before saying anything. Don't shout at them.
    if (e.error === "no-speech" || e.error === "aborted") return;
    options.onError?.(e.message ?? e.error ?? "Speech recognition failed");
  }) as EventListener);

  recognition.addEventListener("end", (() => {
    if (stopped) return;
    stopped = true;
    options.onEnd?.();
  }) as EventListener);

  try {
    recognition.start();
  } catch (err) {
    options.onError?.(err instanceof Error ? err.message : String(err));
    return null;
  }

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        recognition.stop();
      } catch {
        // Already stopped — ignore.
      }
    },
  };
};
