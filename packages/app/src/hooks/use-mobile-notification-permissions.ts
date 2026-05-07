import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking } from "react-native";
import * as Notifications from "expo-notifications";

import { isNative } from "@/constants/platform";

/**
 * Phase 4 v3/d — exposes the mobile (iOS / Android) push notification
 * permission state to the settings UI plus three actions:
 *
 *   - `requestPermission()` — triggers the OS prompt. iOS will only
 *     show the system dialog the *first* time; if the user already
 *     denied once, this resolves to the existing status. The UI
 *     should fall through to `openSystemSettings()` when the system
 *     prompt won't re-arm.
 *   - `sendLocalTest()` — schedules an immediate local notification
 *     via `Notifications.scheduleNotificationAsync`. Marked with
 *     `data.kind: "ottie:test"` so the foreground handler in
 *     `_layout.tsx` whitelists it through and renders the banner
 *     instead of suppressing it.
 *   - `openSystemSettings()` — deep-links to the OS app settings
 *     where the user can toggle Notifications back on. The only
 *     escape hatch when the OS prompt is exhausted.
 *
 * Web / desktop callers should ignore this hook and use the existing
 * `useDesktopPermissions`. Returns `isNative: false` so the consumer
 * can render-skip cleanly.
 */
export type MobileNotificationPermissionState = "granted" | "denied" | "undetermined";

export interface UseMobileNotificationPermissionsResult {
  isNative: boolean;
  state: MobileNotificationPermissionState;
  /** True when the OS prompt is still re-armable. iOS flips this off after first denial. */
  canAskAgain: boolean;
  isLoading: boolean;
  isRequesting: boolean;
  isSendingLocalTest: boolean;
  lastError: string | null;
  refresh: () => Promise<void>;
  requestPermission: () => Promise<void>;
  sendLocalTest: () => Promise<void>;
  openSystemSettings: () => Promise<void>;
}

function statusToState(status: string | undefined): MobileNotificationPermissionState {
  if (status === "granted") return "granted";
  if (status === "denied") return "denied";
  return "undetermined";
}

export function useMobileNotificationPermissions(): UseMobileNotificationPermissionsResult {
  const mountedRef = useRef(true);
  const [state, setState] = useState<MobileNotificationPermissionState>("undetermined");
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isRequesting, setIsRequesting] = useState(false);
  const [isSendingLocalTest, setIsSendingLocalTest] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!isNative) {
      if (mountedRef.current) setIsLoading(false);
      return;
    }
    if (mountedRef.current) setIsLoading(true);
    try {
      const result = await Notifications.getPermissionsAsync();
      if (!mountedRef.current) return;
      setState(statusToState(result.status));
      setCanAskAgain(result.canAskAgain ?? true);
    } catch (err) {
      if (!mountedRef.current) return;
      setLastError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  // Initial load + re-poll when the user comes back from Settings.app
  // (so we pick up "they just turned notifications on/off via the
  // system prefs"). AppState listener fires on foreground.
  useEffect(() => {
    void refresh();
    if (!isNative) return undefined;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const requestPermission = useCallback(async () => {
    if (!isNative) return;
    if (mountedRef.current) {
      setIsRequesting(true);
      setLastError(null);
    }
    try {
      const result = await Notifications.requestPermissionsAsync();
      if (!mountedRef.current) return;
      setState(statusToState(result.status));
      setCanAskAgain(result.canAskAgain ?? true);
    } catch (err) {
      if (!mountedRef.current) return;
      setLastError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setIsRequesting(false);
    }
  }, []);

  const sendLocalTest = useCallback(async () => {
    if (!isNative) return;
    if (mountedRef.current) {
      setIsSendingLocalTest(true);
      setLastError(null);
    }
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Ottie notification test",
          body: "If you can see this, local notifications work.",
          // Tag drives the foreground-handler whitelist in _layout.tsx
          // so the banner actually renders even with the app open.
          data: { kind: "ottie:test" },
        },
        // null trigger = fire immediately
        trigger: null,
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setLastError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setIsSendingLocalTest(false);
    }
  }, []);

  const openSystemSettings = useCallback(async () => {
    try {
      await Linking.openSettings();
    } catch (err) {
      if (!mountedRef.current) return;
      setLastError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  return {
    isNative,
    state,
    canAskAgain,
    isLoading,
    isRequesting,
    isSendingLocalTest,
    lastError,
    refresh,
    requestPermission,
    sendLocalTest,
    openSystemSettings,
  };
}
