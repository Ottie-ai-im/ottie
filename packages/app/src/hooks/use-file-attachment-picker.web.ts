import { useCallback, useRef } from "react";
import type { PickedImageAttachmentInput } from "@/hooks/image-attachment-picker";

interface UseFileAttachmentPickerResult {
  pickFiles: () => Promise<PickedImageAttachmentInput[] | null>;
}

export function useFileAttachmentPicker(): UseFileAttachmentPickerResult {
  const isPickingRef = useRef(false);

  const pickFiles = useCallback(async () => {
    if (isPickingRef.current) return null;
    isPickingRef.current = true;

    try {
      const files = await openWebFilePicker();
      if (!files || files.length === 0) return null;

      return files.map((file) => ({
        source: { kind: "blob" as const, blob: file },
        mimeType: file.type || null,
        fileName: file.name || null,
      }));
    } catch (error) {
      console.error("[FileAttachmentPicker] Failed to pick file:", error);
      return null;
    } finally {
      isPickingRef.current = false;
    }
  }, []);

  return { pickFiles };
}

function openWebFilePicker(): Promise<File[] | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(null);
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.style.display = "none";
    let settled = false;
    const finish = (value: File[] | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };
    input.addEventListener("change", () => {
      const list = input.files;
      finish(list ? Array.from(list) : null);
    });
    input.addEventListener("cancel", () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}
