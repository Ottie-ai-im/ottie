/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSmoothedText } from "./use-smoothed-text";

interface RafScheduler {
  flushFrame: (deltaMs?: number) => void;
}

function installFakeRaf(): RafScheduler {
  const queue: Array<(ts: number) => void> = [];
  let now = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: (ts: number) => void) => {
    queue.push(cb);
    return queue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
    queue[handle - 1] = () => {};
  });
  return {
    flushFrame(deltaMs = 16.7) {
      now += deltaMs;
      const callbacks = queue.splice(0, queue.length);
      for (const cb of callbacks) cb(now);
    },
  };
}

describe("useSmoothedText", () => {
  let raf: RafScheduler;

  beforeEach(() => {
    raf = installFakeRaf();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the full source immediately when not live", () => {
    const { result } = renderHook(() => useSmoothedText("hello world", false));
    expect(result.current).toBe("hello world");
  });

  it("starts empty and drips characters when live", () => {
    const { result } = renderHook(({ src }) => useSmoothedText(src, true), {
      initialProps: { src: "abcdef" },
    });
    expect(result.current).toBe("");

    act(() => raf.flushFrame());
    expect(result.current.length).toBeGreaterThan(0);
    expect(result.current.length).toBeLessThan("abcdef".length);

    for (let i = 0; i < 10; i++) act(() => raf.flushFrame());
    expect(result.current).toBe("abcdef");
  });

  it("snaps to source the moment isLive flips false", () => {
    const { result, rerender } = renderHook(
      ({ src, live }: { src: string; live: boolean }) => useSmoothedText(src, live),
      { initialProps: { src: "abcdef", live: true } },
    );
    expect(result.current).toBe("");
    rerender({ src: "abcdef", live: false });
    expect(result.current).toBe("abcdef");
  });

  it("jumps when backlog exceeds the threshold", () => {
    const huge = "x".repeat(10_000);
    const { result } = renderHook(() => useSmoothedText(huge, true, { jumpThreshold: 4000 }));
    expect(result.current).toBe(huge);
  });

  it("resets visible count when source shrinks", () => {
    const { result, rerender } = renderHook(
      ({ src }: { src: string }) => useSmoothedText(src, true),
      { initialProps: { src: "hello world" } },
    );
    for (let i = 0; i < 20; i++) act(() => raf.flushFrame());
    expect(result.current).toBe("hello world");

    rerender({ src: "hi" });
    expect(result.current).toBe("hi");
  });

  it("respects maxCharsPerFrame ceiling at the start of streaming", () => {
    const { result } = renderHook(() =>
      useSmoothedText("abcdefghijklmnop", true, { maxCharsPerFrame: 2 }),
    );
    act(() => raf.flushFrame(16.7));
    expect(result.current.length).toBeLessThanOrEqual(3);
  });
});
