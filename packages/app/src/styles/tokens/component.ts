// Component-level tokens — radii + border widths for named components.
//
// Lifted from theme.ts `commonTheme.borderRadius` keys: glassCard,
// glassSheet, glassPill, button. Where a primitive radius matches we
// reference it; otherwise we keep the inline pixel value with a comment.
//
// Consumed via `theme.components.<name>.{radius, borderWidth}` instead of
// `theme.borderRadius.<name>` — the legacy flat shape stays available
// through the LEGACY shim composed in theme.ts (Phase 4 deprecates).

import { radius } from "./primitives";

export const componentTokens = {
  glassCard: {
    radius: 18, // inline: no primitive match (between radius.xl=16 and radius["2xl"]=20)
    borderWidth: 1,
  },
  glassSheet: {
    radius: 22, // inline: no primitive match
    borderWidth: 1,
  },
  glassPill: {
    radius: radius.full,
    borderWidth: 1,
  },
  button: {
    radius: 14, // inline: no primitive match (between radius.lg=12 and radius.xl=16)
    borderWidth: 0,
  },
} as const;
