import { useEffect, useRef, useState } from "react";

export interface UseSmoothedTextOptions {
  /**
   * Maximum visible characters added per animation frame while streaming.
   * The buffer auto-tunes within this ceiling: a large pending backlog
   * accelerates the drip so the UI stays close to the source, but never
   * exceeds this rate so single-frame jumps stay imperceptible.
   * @default 3
   */
  maxCharsPerFrame?: number;
  /**
   * If the pending buffer exceeds this many characters, jump to the latest
   * source instantly. Prevents falling minutes behind on huge bursts.
   * @default 4000
   */
  jumpThreshold?: number;
}

interface SmoothingState {
  visibleCount: number;
  rafHandle: number | null;
  lastFrameTs: number;
}

const DEFAULT_MAX_CHARS_PER_FRAME = 3;
const DEFAULT_JUMP_THRESHOLD = 4000;
const TARGET_FRAME_MS = 16.7;

/**
 * Decouple the visual cadence of a streaming string from the network's bursty
 * chunk cadence. Returns a `displayed` substring that grows toward `source`
 * via `requestAnimationFrame`. When `isLive` flips to `false`, snaps to the
 * full string immediately so finalized history is never partial.
 *
 * Behavior:
 * - `source` shrinking (history reload, navigation) resets the visible count.
 * - When `isLive=false`, returns `source` directly with no scheduling.
 * - The drip rate scales with backlog up to `maxCharsPerFrame`, so short
 *   bursts catch up smoothly while sustained streams drip near real-time.
 */
export function useSmoothedText(
  source: string,
  isLive: boolean,
  options: UseSmoothedTextOptions = {},
): string {
  const maxCharsPerFrame = options.maxCharsPerFrame ?? DEFAULT_MAX_CHARS_PER_FRAME;
  const jumpThreshold = options.jumpThreshold ?? DEFAULT_JUMP_THRESHOLD;

  const [displayed, setDisplayed] = useState<string>(() => (isLive ? "" : source));
  const stateRef = useRef<SmoothingState>({
    visibleCount: isLive ? 0 : source.length,
    rafHandle: null,
    lastFrameTs: 0,
  });
  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(() => {
    const state = stateRef.current;

    if (!isLive) {
      if (state.rafHandle !== null) {
        cancelAnimationFrame(state.rafHandle);
        state.rafHandle = null;
      }
      state.visibleCount = source.length;
      state.lastFrameTs = 0;
      setDisplayed(source);
      return;
    }

    if (state.visibleCount > source.length) {
      state.visibleCount = source.length;
      setDisplayed(source);
    }

    const pending = source.length - state.visibleCount;
    if (pending <= 0) {
      return;
    }

    if (pending > jumpThreshold) {
      state.visibleCount = source.length;
      state.lastFrameTs = 0;
      setDisplayed(source);
      return;
    }

    if (state.rafHandle !== null) {
      return;
    }

    const tick = (timestamp: number) => {
      const current = stateRef.current;
      const latest = sourceRef.current;
      const backlog = latest.length - current.visibleCount;
      if (backlog <= 0) {
        current.rafHandle = null;
        current.lastFrameTs = 0;
        return;
      }

      const elapsed =
        current.lastFrameTs === 0 ? TARGET_FRAME_MS : Math.max(1, timestamp - current.lastFrameTs);
      current.lastFrameTs = timestamp;
      const frames = Math.max(1, elapsed / TARGET_FRAME_MS);
      const baseStep = Math.min(maxCharsPerFrame * frames, backlog);
      const accelerated = Math.min(maxCharsPerFrame * frames + Math.floor(backlog / 60), backlog);
      const step = Math.max(1, Math.floor(Math.max(baseStep, accelerated)));

      current.visibleCount = Math.min(latest.length, current.visibleCount + step);
      setDisplayed(latest.slice(0, current.visibleCount));

      if (current.visibleCount < latest.length) {
        current.rafHandle = requestAnimationFrame(tick);
      } else {
        current.rafHandle = null;
        current.lastFrameTs = 0;
      }
    };

    state.rafHandle = requestAnimationFrame(tick);
  }, [source, isLive, jumpThreshold, maxCharsPerFrame]);

  useEffect(() => {
    const state = stateRef.current;
    return () => {
      if (state.rafHandle !== null) {
        cancelAnimationFrame(state.rafHandle);
        state.rafHandle = null;
      }
    };
  }, []);

  return displayed;
}
