// Web build of the identity file I/O helpers. Uses standard browser APIs:
// a Blob + ObjectURL + <a download> for save, and an <input type=file> for
// pick. The same module shape ships on Tauri because Tauri uses the web
// build of the Expo app.

import {
  buildIdentityFileName,
  sanitizeIdentityFileBase,
  type IdentityFilePickResult,
  type IdentityFileSaveInput,
} from "./identity-file-io-common";

export { buildIdentityFileName, sanitizeIdentityFileBase };
export type { IdentityFilePickResult, IdentityFileSaveInput };

/** Trigger a browser save-dialog for the identity export JSON. */
export async function saveIdentityFile(input: IdentityFileSaveInput): Promise<void> {
  const fileName = buildIdentityFileName(input.baseName);
  const blob = new Blob([input.jsonContent], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Defer revoke so Safari/Firefox actually fire the download. The 60s
    // window is conservative — DownloadStore uses similar timing.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/**
 * Open a file picker, let the user choose a JSON file, and return its text.
 * Returns null when the user cancels.
 */
export async function pickIdentityFile(): Promise<IdentityFilePickResult | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    let resolved = false;
    input.addEventListener("change", () => {
      const file = input.files?.[0] ?? null;
      if (!file) {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
        return;
      }
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        resolved = true;
        const text = typeof reader.result === "string" ? reader.result : "";
        resolve({ text, fileName: file.name });
      });
      reader.addEventListener("error", () => {
        resolved = true;
        reject(reader.error ?? new Error("Failed to read file"));
      });
      reader.readAsText(file);
    });
    // Cancel detection on web is unreliable across browsers; fall back to
    // a window-focus probe — when the picker closes the page regains focus
    // and any unresolved promise we still hold means the user cancelled.
    const onFocus = () => {
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          window.removeEventListener("focus", onFocus);
          resolve(null);
        }
      }, 500);
    };
    window.addEventListener("focus", onFocus, { once: true });
    input.click();
  });
}
