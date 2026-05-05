import { useEffect, useState } from "react";
import * as Battery from "expo-battery";
import { isNative } from "@/constants/platform";

/**
 * useLowPowerMode — live low-power detection.
 * Returns true if the device is in low-power (battery saver) mode.
 * Defaults to false on web or if the module is unavailable.
 */
export function useLowPowerMode(): boolean {
  const [isLowPower, setIsLowPower] = useState(false);

  useEffect(() => {
    if (!isNative) return;

    let cancelled = false;

    // Check initial state
    Battery.isLowPowerModeEnabledAsync()
      .then((enabled) => {
        if (!cancelled) setIsLowPower(enabled);
        return undefined;
      })
      .catch(() => {
        // Fallback if the native module fails
        if (!cancelled) setIsLowPower(false);
      });

    // Listen for changes
    const subscription = Battery.addLowPowerModeListener(({ lowPowerMode }) => {
      setIsLowPower(lowPowerMode);
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return isLowPower;
}
