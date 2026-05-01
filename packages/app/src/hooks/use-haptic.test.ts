// @vitest-environment jsdom

/**
 * Tests for useHaptic.
 *
 * Strategy: vitest runs in node mode and `react-native` is aliased to
 * `react-native-web`, so `Platform.OS === "web"`. We therefore exercise the
 * native code path by mocking `@/constants/platform` directly instead of
 * trying to fake a real native runtime. Two suites:
 *
 *   1. Native-mode suite — `isNative=true` exercises debounce / settings /
 *      low-power-mode behavior (Tests 6 / 7 / 8 / 9)
 *   2. Web-mode suite — `isNative=false` confirms all calls are no-ops
 *      (Test 10)
 *
 * `expo-haptics` is mocked so we can assert call counts without invoking the
 * real native module.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: {
    Light: "light",
    Medium: "medium",
    Heavy: "heavy",
  },
  NotificationFeedbackType: {
    Success: "success",
    Warning: "warning",
    Error: "error",
  },
  impactAsync: vi.fn().mockResolvedValue(undefined),
  notificationAsync: vi.fn().mockResolvedValue(undefined),
}));

describe("useHaptic — native runtime", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.doMock("@/constants/platform", () => ({
      isWeb: false,
      isNative: true,
      isDev: false,
      getIsElectron: () => false,
      getIsElectronMac: () => false,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock("@/constants/platform");
    vi.clearAllMocks();
  });

  it("Test 6 — fire('light') calls Haptics.impactAsync exactly once", async () => {
    const { useHaptic } = await import("@/hooks/use-haptic");
    const Haptics = await import("expo-haptics");
    const { result } = renderHook(() => useHaptic({ enabled: true, isLowPowerMode: false }));
    result.current.fire("light");
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
  });

  it("Test 7 — two consecutive fire('light') within 200ms only call Haptics.impactAsync once", async () => {
    const { useHaptic } = await import("@/hooks/use-haptic");
    const Haptics = await import("expo-haptics");
    const { result } = renderHook(() => useHaptic({ enabled: true, isLowPowerMode: false }));
    result.current.fire("light");
    // Advance well below the 200ms debounce window
    vi.advanceTimersByTime(50);
    result.current.fire("light");
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
  });

  it("Test 8 — fire is a no-op when enabled=false", async () => {
    const { useHaptic } = await import("@/hooks/use-haptic");
    const Haptics = await import("expo-haptics");
    const { result } = renderHook(() => useHaptic({ enabled: false, isLowPowerMode: false }));
    result.current.fire("light");
    result.current.fire("medium");
    result.current.fire("heavy");
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });

  it("Test 9 — fire is a no-op when isLowPowerMode=true", async () => {
    const { useHaptic } = await import("@/hooks/use-haptic");
    const Haptics = await import("expo-haptics");
    const { result } = renderHook(() => useHaptic({ enabled: true, isLowPowerMode: true }));
    result.current.fire("medium");
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it("after the 200ms debounce window, the next fire triggers Haptics again", async () => {
    const { useHaptic } = await import("@/hooks/use-haptic");
    const Haptics = await import("expo-haptics");
    const { result } = renderHook(() => useHaptic({ enabled: true, isLowPowerMode: false }));
    result.current.fire("light");
    vi.advanceTimersByTime(250);
    result.current.fire("light");
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(2);
  });
});

describe("useHaptic — web runtime", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("@/constants/platform", () => ({
      isWeb: true,
      isNative: false,
      isDev: false,
      getIsElectron: () => false,
      getIsElectronMac: () => false,
    }));
  });

  afterEach(() => {
    vi.doUnmock("@/constants/platform");
    vi.clearAllMocks();
  });

  it("Test 10 — on web, all fire() calls are no-ops", async () => {
    const { useHaptic } = await import("@/hooks/use-haptic");
    const Haptics = await import("expo-haptics");
    const { result } = renderHook(() => useHaptic({ enabled: true, isLowPowerMode: false }));
    result.current.fire("light");
    result.current.fire("medium");
    result.current.fire("heavy");
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });
});
