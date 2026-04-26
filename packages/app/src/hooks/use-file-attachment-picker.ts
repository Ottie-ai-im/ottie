import { useCallback, useRef } from "react";
import { Alert } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import type { PickedImageAttachmentInput } from "@/hooks/image-attachment-picker";

interface UseFileAttachmentPickerResult {
  pickFiles: () => Promise<PickedImageAttachmentInput[] | null>;
}

/**
 * Wraps expo-document-picker so it produces the same
 * `PickedImageAttachmentInput` shape that image / camera pickers return.
 * The composer then treats files identically to images downstream — only
 * mimeType differs, and the daemon already handles arbitrary MIME via the
 * existing attachment store.
 */
export function useFileAttachmentPicker(): UseFileAttachmentPickerResult {
  const isPickingRef = useRef(false);

  const pickFiles = useCallback(async () => {
    if (isPickingRef.current) return null;
    isPickingRef.current = true;

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        multiple: true,
        copyToCacheDirectory: true,
      });

      if (result.canceled) return null;
      const assets = result.assets ?? [];
      if (assets.length === 0) return null;

      return assets.map((asset) => ({
        source: { kind: "file_uri" as const, uri: asset.uri },
        mimeType: asset.mimeType ?? null,
        fileName: asset.name ?? null,
      }));
    } catch (error) {
      console.error("[FileAttachmentPicker] Failed to pick file:", error);
      Alert.alert("Error", "Failed to attach file");
      return null;
    } finally {
      isPickingRef.current = false;
    }
  }, []);

  return { pickFiles };
}
