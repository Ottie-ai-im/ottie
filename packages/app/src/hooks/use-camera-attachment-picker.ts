import { useCallback, useRef } from "react";
import { Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import {
  normalizePickedImageAssets,
  type PickedImageAttachmentInput,
} from "@/hooks/image-attachment-picker";

interface UseCameraAttachmentPickerResult {
  takePhoto: () => Promise<PickedImageAttachmentInput[] | null>;
}

/**
 * Sibling of useImageAttachmentPicker that opens the device camera instead
 * of the photo library. Reuses the same normalizer so the resulting
 * attachment shape is interchangeable upstream.
 */
export function useCameraAttachmentPicker(): UseCameraAttachmentPickerResult {
  const [permission, requestPermission] = ImagePicker.useCameraPermissions();
  const isCapturingRef = useRef(false);

  const ensurePermission = useCallback(async () => {
    let current = permission;
    if (!current || current.status === "undetermined" || !current.granted) {
      current = await requestPermission();
    }
    if (!current?.granted) {
      Alert.alert("Permission required", "Please allow camera access to take photos.");
      return false;
    }
    return true;
  }, [permission, requestPermission]);

  const takePhoto = useCallback(async () => {
    if (isCapturingRef.current) return null;
    isCapturingRef.current = true;

    try {
      const ok = await ensurePermission();
      if (!ok) return null;

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"] as ImagePicker.MediaType[],
        quality: 0.8,
      });

      if (result.canceled) return null;
      return await normalizePickedImageAssets(result.assets);
    } catch (error) {
      console.error("[CameraAttachmentPicker] Failed to capture photo:", error);
      Alert.alert("Error", "Failed to capture photo");
      return null;
    } finally {
      isCapturingRef.current = false;
    }
  }, [ensurePermission]);

  return { takePhoto };
}
