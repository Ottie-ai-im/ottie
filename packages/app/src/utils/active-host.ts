import type { HostProfile } from "@/types/host-connection";
import { parseServerIdFromPathname } from "@/utils/host-routes";

export function resolveActiveHost({
  hosts,
  pathname,
}: {
  hosts: readonly HostProfile[];
  pathname: string;
}): HostProfile | null {
  const serverIdFromPath = parseServerIdFromPathname(pathname);
  if (serverIdFromPath) {
    const routeMatch = hosts.find((host) => host.serverId === serverIdFromPath);
    if (routeMatch) {
      return routeMatch;
    }
  }

  return pickDefaultHost(hosts);
}

// Default-host order: most-recently-used wins, then most-recently-created,
// then the original list order. Sort is stable: when no host has a
// lastUsedAt or createdAt signal, the first entry in the list is returned —
// matching the previous `hosts[0]` behavior.
function pickDefaultHost(hosts: readonly HostProfile[]): HostProfile | null {
  if (hosts.length === 0) return null;
  const indexed = hosts.map((host, index) => ({ host, index }));
  indexed.sort((a, b) => {
    const lastUsedDelta = compareDescending(a.host.lastUsedAt, b.host.lastUsedAt);
    if (lastUsedDelta !== 0) return lastUsedDelta;
    const createdDelta = compareDescending(a.host.createdAt, b.host.createdAt);
    if (createdDelta !== 0) return createdDelta;
    return a.index - b.index;
  });
  return indexed[0]?.host ?? null;
}

function compareDescending(a: string | undefined, b: string | undefined): number {
  const av = a ?? "";
  const bv = b ?? "";
  if (av === bv) return 0;
  return av > bv ? -1 : 1;
}
