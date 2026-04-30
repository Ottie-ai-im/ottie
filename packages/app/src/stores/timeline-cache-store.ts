// Per-(serverId, agentId) timeline cache.
//
// This file exists so callers can `import "@/stores/timeline-cache-store"`
// without specifying a platform. Metro picks `.native.ts` on iOS/Android
// and `.web.ts` in the browser at build time. This module is a fallback for
// non-Metro consumers (Node, vitest, server-side renders) — it forwards to
// the web backend when `indexedDB` exists, otherwise no-ops.
//
// Both platform implementations share the wire format defined in
// `timeline-cache-store-shared.ts`; the legacy AsyncStorage-backed cache was
// retired in favor of those (no row cap, real per-row writes instead of one
// big JSON blob — which was already the bottleneck once histories grew past
// a few thousand rows).

export {
  loadCachedTimeline,
  saveCachedTimeline,
  clearCachedTimeline,
  scheduleSaveCachedTimeline,
  loadCachedCursor,
  saveCachedCursor,
} from "./timeline-cache-store.web";
