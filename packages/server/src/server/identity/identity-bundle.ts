import { existsSync } from "node:fs";
import type pino from "pino";

import { loadDeviceList } from "./device-list-store.js";
import { loadPeerList } from "./peer-store.js";
import { loadRootIdentity, rootIdentityFilePath } from "./root-identity-store.js";
import { loadSelfDevice, selfDeviceFilePath } from "./self-device-store.js";
import type { IdentityExportBundle } from "./identity-rpc-schemas.js";

// `identity/export` and `identity/import` operate on this single bundle so the
// user gets one file to manage. The bundle is the raw stored shapes — same as
// what's on disk — because the importer is the same daemon that wrote those
// files. We don't recompress / re-sign; just round-trip the bytes.

/**
 * Read the four identity-related files into a single bundle. Returns null when
 * `root.json` is missing (nothing to export). `selfDevice`, `devices`, and
 * `peers` are individually nullable: peers in particular can legitimately be
 * absent on a freshly-initialized daemon with no friends yet.
 */
export function readIdentityExportBundle(
  ottieHome: string,
  options?: { appVersion?: string; logger?: pino.Logger },
): IdentityExportBundle | null {
  const logger = options?.logger;
  const rootBundle = loadRootIdentity(ottieHome, logger);
  if (!rootBundle) return null;

  const selfBundle = loadSelfDevice(ottieHome, logger);
  const devices = loadDeviceList(ottieHome, logger);
  const peers = loadPeerList(ottieHome, logger);

  return {
    v: 1,
    type: "ottie-identity-export",
    exportedAt: new Date().toISOString(),
    ...(options?.appVersion ? { appVersion: options.appVersion } : {}),
    rootIdentity: rootBundle.stored,
    selfDevice: selfBundle ? selfBundle.stored : null,
    devices: devices ?? null,
    peers: peers ?? null,
  };
}

/**
 * Returns true when `$OTTIE_HOME/identity/` already contains a `root.json` or
 * `self-device.json`. We use either as the "this daemon has been initialized"
 * sentinel for refusing imports — matches the guards inside the individual
 * `writeImported*` helpers, but lets the caller fail fast with a friendlier
 * message before touching disk.
 */
export function identityHomeHasContent(ottieHome: string): boolean {
  if (existsSync(rootIdentityFilePath(ottieHome))) return true;
  if (existsSync(selfDeviceFilePath(ottieHome))) return true;
  // peers.json + devices.json without the keypair files would be inert; treat
  // that as "empty enough" to import over so a partial leftover doesn't lock
  // the user out.
  return false;
}
