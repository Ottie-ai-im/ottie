import { useCallback, useRef } from "react";
import { Alert } from "react-native";
import * as Location from "expo-location";

export interface SharedLocation {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  capturedAt: string;
}

interface UseLocationShareResult {
  shareLocation: () => Promise<SharedLocation | null>;
}

/**
 * Capture the device's current location for inclusion as a chat attachment.
 *
 * Today we only return the coordinates — there is no `location` attachment
 * type in the daemon protocol yet, so callers (composer) decide how to
 * surface it (currently appended to the message as a Google Maps link). When
 * the IM-side schema lands, this hook can switch to producing a structured
 * location attachment without touching the call site.
 */
export function useLocationShare(): UseLocationShareResult {
  const isFetchingRef = useRef(false);

  const ensurePermission = useCallback(async () => {
    let permission = await Location.getForegroundPermissionsAsync();
    if (permission.status === "undetermined" || !permission.granted) {
      permission = await Location.requestForegroundPermissionsAsync();
    }
    if (!permission.granted) {
      Alert.alert(
        "Permission required",
        "Please allow location access to share your current position.",
      );
      return false;
    }
    return true;
  }, []);

  const shareLocation = useCallback(async (): Promise<SharedLocation | null> => {
    if (isFetchingRef.current) return null;
    isFetchingRef.current = true;

    try {
      const ok = await ensurePermission();
      if (!ok) return null;

      const reading = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      return {
        latitude: reading.coords.latitude,
        longitude: reading.coords.longitude,
        accuracyMeters:
          typeof reading.coords.accuracy === "number" ? reading.coords.accuracy : null,
        capturedAt: new Date(reading.timestamp).toISOString(),
      };
    } catch (error) {
      console.error("[LocationShare] Failed to capture location:", error);
      Alert.alert("Error", "Failed to read location");
      return null;
    } finally {
      isFetchingRef.current = false;
    }
  }, [ensurePermission]);

  return { shareLocation };
}
