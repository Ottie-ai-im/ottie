// Native build of the identity file I/O helpers. Writes the export to the
// app cache, then opens the OS share sheet so the user can save to Files /
// iCloud / Google Drive / send to themselves. Reads the import file via
// expo-document-picker, copying into the cache so the URI is readable.

import * as DocumentPicker from "expo-document-picker";
import { File as FSFile, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import {
  buildIdentityFileName,
  sanitizeIdentityFileBase,
  type IdentityFilePickResult,
  type IdentityFileSaveInput,
} from "./identity-file-io-common";

export { buildIdentityFileName, sanitizeIdentityFileBase };
export type { IdentityFilePickResult, IdentityFileSaveInput };

export async function saveIdentityFile(input: IdentityFileSaveInput): Promise<void> {
  const directory = Paths.cache ?? Paths.document;
  if (!directory) {
    throw new Error("No writable directory available");
  }
  const fileName = buildIdentityFileName(input.baseName);
  // Overwrite any leftover from a previous export run.
  let target = new FSFile(directory, fileName);
  if (target.exists) {
    try {
      target.delete();
    } catch {
      // If delete fails (rare) fall through to write — write() will throw.
    }
    target = new FSFile(directory, fileName);
  }
  target.create();
  target.write(input.jsonContent);

  const sharingAvailable = await Sharing.isAvailableAsync();
  if (!sharingAvailable) {
    // Sharing is generally available on iOS/Android. If a host stripped
    // it, surface a clear error rather than silently leaving the file in
    // cache where the user can't find it.
    throw new Error("Sharing is not available on this device — cannot present a save destination");
  }
  await Sharing.shareAsync(target.uri, {
    mimeType: "application/json",
    dialogTitle: fileName,
    UTI: "public.json",
  });
}

export async function pickIdentityFile(): Promise<IdentityFilePickResult | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/json", "text/plain", "*/*"],
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset) return null;

  const file = new FSFile(asset.uri);
  const text = await file.text();
  return { text, fileName: asset.name ?? null };
}
