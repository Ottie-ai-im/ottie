import { VOICE_COMMANDS, type VoiceCommand } from "@/voice-control/voice-commands";

/**
 * Voice intent router (phase-2 lightweight).
 *
 * Maps a transcript string to a {command, params} pair using local heuristics
 * — no LLM call, no network. Trade-off: works perfectly for short verbatim
 * commands ("open files", "stop", "focus mode"), degrades on freeform speech.
 * Phase 3 replaces this with an LLM-backed router.
 *
 * Design:
 *   1. Tokenize transcript and each command's `examples` + name + description
 *   2. Score each candidate by Jaccard token overlap with the best-matching
 *      example, weighted by example specificity (shorter examples win ties)
 *   3. Apply a small bonus when the transcript contains "send/say/tell" verbs
 *      so {@link send_to_active_agent} dominates message-style utterances and
 *      the rest of the utterance becomes the message text
 *   4. Reject below MIN_CONFIDENCE so a stray "uh, hmm" doesn't fire actions
 */

const MIN_CONFIDENCE = 0.35;

const MESSAGE_TRIGGERS: ReadonlyArray<RegExp> = [
  /^\s*send\s+(.+)$/i,
  /^\s*say\s+(.+)$/i,
  /^\s*tell\s+(?:it|him|her|the\s+agent)\s+(.+)$/i,
  /^\s*reply\s+(.+)$/i,
  /^\s*write\s+(.+)$/i,
  // Chinese triggers: "发：xxx" / "说 xxx" / "告诉它 xxx"
  /^\s*发[：:、，,\s]+(.+)$/,
  /^\s*说[：:、，,\s]+(.+)$/,
  /^\s*告诉它[：:、，,\s]+(.+)$/,
];

export interface IntentMatch {
  command: VoiceCommand;
  params: unknown;
  confidence: number;
  /** What got matched against (example, name, etc.) — useful for debug UI. */
  source: string;
}

function tokenize(input: string): string[] {
  // Lowercase, strip punctuation, split on whitespace. CJK kept verbatim
  // (each character is its own meaningful token already).
  return input
    .toLowerCase()
    .replace(/[.,!?;:'"`()/-]/g, " ")
    .split(/\s+/)
    .filter((s) => s.length > 0);
}

function jaccard(aTokens: ReadonlyArray<string>, bTokens: ReadonlyArray<string>): number {
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  const unionSize = a.size + b.size - intersection;
  return unionSize === 0 ? 0 : intersection / unionSize;
}

function tryMessageTrigger(transcript: string): { text: string } | null {
  for (const pattern of MESSAGE_TRIGGERS) {
    const match = pattern.exec(transcript.trim());
    if (match && match[1] && match[1].trim().length > 0) {
      return { text: match[1].trim() };
    }
  }
  return null;
}

/**
 * Run intent matching against the registered commands.
 * Returns null when no candidate clears MIN_CONFIDENCE — caller should show
 * a "didn't catch that" message rather than guess.
 */
export function matchIntent(transcript: string): IntentMatch | null {
  const trimmed = transcript.trim();
  if (!trimmed) return null;

  // Fast path: explicit "send / say / tell" → send_to_active_agent with the
  // remainder as message text. Confidence is high because the trigger is
  // unambiguous; no need to compete with example matching.
  const messagePayload = tryMessageTrigger(trimmed);
  if (messagePayload) {
    const sendCmd = VOICE_COMMANDS.find((c) => c.name === "send_to_active_agent");
    if (sendCmd) {
      return {
        command: sendCmd,
        params: { text: messagePayload.text },
        confidence: 0.95,
        source: `message-trigger`,
      };
    }
  }

  const transcriptTokens = tokenize(trimmed);
  let best: IntentMatch | null = null;
  let bestScore = 0;

  for (const command of VOICE_COMMANDS) {
    const candidates = [...command.examples, command.name.replace(/_/g, " ")];

    for (const candidate of candidates) {
      const candTokens = tokenize(candidate);
      let score = jaccard(transcriptTokens, candTokens);

      // Tie-break / boost: shorter examples that are fully contained in the
      // transcript win. "stop" matches "stop" much better than it matches
      // "stop the running agent" via Jaccard alone.
      if (candTokens.every((t) => transcriptTokens.includes(t))) {
        score += 0.15;
      }

      if (score > bestScore) {
        bestScore = score;
        // Zero-param commands have an empty schema → params = {}.
        // Param-bearing commands (find_workspace, switch_to_*) need richer
        // routing; for phase 2 we only auto-fire zero-param + the message
        // trigger above. Param commands fall through to "no match" so the
        // user sees a clear "I didn't catch that" rather than a broken call.
        const schemaShape = (command.schema as unknown as { _def?: { shape?: unknown } })._def
          ?.shape;
        const isZeroParam =
          !schemaShape || (typeof schemaShape === "object" && Object.keys(schemaShape).length === 0);
        if (!isZeroParam) {
          continue;
        }
        best = {
          command,
          params: {},
          confidence: score,
          source: candidate,
        };
      }
    }
  }

  if (!best || best.confidence < MIN_CONFIDENCE) return null;
  return best;
}
