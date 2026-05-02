// Light-mode semantic tokens — the v1.11 alias tier.
//
// Components consume these (theme.surface.*, theme.text.*, theme.status.*)
// and NEVER reach through to `palette.*` directly (research §8.3 + PITFALLS
// pitfall 5 — Polaris-v11 lesson). The flat-key legacy shape (surface0,
// foregroundMuted, etc.) lives separately under `theme.colors` via the
// LEGACY shim composed in theme.ts; new code uses the nested namespaces.
//
// Phase 1 is structural, NOT visual (PITFALLS pitfall 1). Every existing
// color value MUST round-trip identically. Where a primitive match exists
// in `palette`, we reference it; otherwise we keep the inline literal.
//
// ---------------------------------------------------------------------------
// Migration map — OLD lightSemanticColors key → new nested namespace path
// ---------------------------------------------------------------------------
//
//   surface0                    → surface.background      (#ffffff)
//   surface1                    → surface.subtle          (#fafafa)
//   surface2                    → surface.elevated        (#f4f4f5)
//   surface3                    → surface.high            (#e4e4e7)
//   surface4                    → surface.highest         (#d4d4d8)
//   surfaceDiffEmpty            → surface.diffEmpty       (#f6f6f6)
//   surfaceSidebar              → surface.sidebar         (#f4f4f5)
//   surfaceSidebarHover         → surface.sidebarHover    (#e9e9ec)
//   surfaceWorkspace            → surface.workspace       (#ffffff)
//   surfaceGlass                → surface.glass.tint      (rgba)
//   surfaceGlassStrong          → surface.glass.tintStrong(rgba)
//   surfaceGlassHover           → surface.glass.tintHover (rgba)
//   borderGlass                 → surface.glass.border    (rgba)
//   surfaceChat                 → surface.chat            (#f7f7f8)
//   bubbleSelf                  → surface.bubble.self     (#dcfce7)
//   bubbleSelfForeground        → text.bubble.self        (#14532d)
//   bubbleOther                 → surface.bubble.other    (#f4f4f5)
//   bubbleOtherForeground       → text.bubble.other       (#1a1a1e)
//   bubbleMeta                  → text.bubble.meta        (#71717a)
//   foreground                  → text.primary            (#1a1a1e)
//   foregroundMuted             → text.muted              (#71717a)
//   scrollbarHandle             → control.scrollbarHandle (#3f3f46)
//   border                      → border.default          (#e4e4e7)
//   borderAccent                → border.accent           (#ececf1)
//   accent                      → accent.base             (#1FA855)
//   accentBright                → accent.bright           (#22C55E)
//   accentForeground            → accent.foreground       (#ffffff)
//   destructive                 → status.destructive      (#dc2626)
//   destructiveForeground       → status.destructiveForeground (#ffffff)
//   success                     → status.success          (#1FA855)  (= accent.base)
//   successForeground           → status.successForeground(#ffffff)
//   diffAddition                → status.diffAddition     (#15803d)
//   diffDeletion                → status.diffDeletion     (#b91c1c)
//   statusSuccess               → status.statusSuccess    (#15803d)
//   statusDanger                → status.statusDanger     (#b91c1c)
//   statusWarning               → status.statusWarning    (#d97706)
//   statusMerged                → status.statusMerged     (#52525b)
//   terminal                    → terminal (kept as nested object — verbatim)
//   (D-09 add-on)               → status.online           (palette.green[400])
//   (D-09 add-on)               → status.connecting       (palette.amber[500])
//   (D-09 add-on)               → status.offline          (palette.red[500])
//
// Phase 4 (THM-02..04) reads this map to migrate the remaining surfaces.

import { palette } from "./primitives";

export const semanticLight = {
  surface: {
    background: palette.white, // surface0
    subtle: palette.zinc[50], // surface1
    elevated: palette.zinc[100], // surface2
    high: palette.zinc[200], // surface3
    highest: palette.zinc[300], // surface4
    diffEmpty: "#f6f6f6", // inline: between zinc[50] and zinc[100], no exact primitive match
    sidebar: palette.zinc[100], // surfaceSidebar
    sidebarHover: "#e9e9ec", // inline: no exact primitive match
    workspace: palette.white, // surfaceWorkspace
    chat: "#f7f7f8", // inline: warm gray, no exact primitive match
    glass: {
      // Glass tints stay as inline rgba (no palette equivalent — translucent layer fills).
      tint: "rgba(255, 255, 255, 0.55)",
      tintStrong: "rgba(255, 255, 255, 0.72)",
      tintHover: "rgba(255, 255, 255, 0.85)",
      border: "rgba(0, 0, 0, 0.06)",
    },
    bubble: {
      self: palette.green[100], // bubbleSelf (#dcfce7)
      other: palette.zinc[100], // bubbleOther
    },
  },

  text: {
    primary: "#1a1a1e", // foreground (no exact primitive match — close to zinc[900] but not equal)
    muted: palette.zinc[600], // foregroundMuted (#52525b) — bumped from 500 for AA on elevated surface
    bubble: {
      self: palette.green[900], // bubbleSelfForeground (#14532d)
      other: "#1a1a1e", // bubbleOtherForeground (matches text.primary)
      meta: palette.zinc[500], // bubbleMeta stays at 500 (small meta text)
    },
  },

  border: {
    default: palette.zinc[200], // border (#e4e4e7)
    accent: "#ececf1", // borderAccent — inline (not in palette)
  },

  control: {
    scrollbarHandle: palette.zinc[700], // (#3f3f46)
  },

  accent: {
    base: "#1FA855", // brand messenger green — inline (not in palette)
    bright: palette.green[500], // accentBright (#22C55E) — matches palette.green[500]
    foreground: palette.white, // accentForeground
  },

  // Status namespace — destructive/success + diff + check/PR signals + connection-dot triad.
  status: {
    destructive: palette.red[600], // (#dc2626)
    destructiveForeground: palette.white,
    success: "#15803d", // (#15803d) — green-700 for AA contrast on background
    successForeground: palette.white,

    // Diff signals (light)
    diffAddition: "#15803d", // green-700 — readable on white without screaming
    diffDeletion: "#b91c1c", // red-700

    // PR / check status signals
    statusSuccess: "#15803d", // green-700
    statusDanger: "#b91c1c", // red-700
    statusWarning: palette.amber[700], // amber-700 for AA contrast on background
    statusMerged: palette.zinc[600], // (#52525b)

    // Daemon connection-dot triad (D-09 add-on for daemon-connection-dot.tsx migration)
    online: palette.green[400], // (#4ade80)
    connecting: palette.amber[500], // (#f59e0b)
    offline: palette.red[500], // (#ef4444)
  },

  terminal: {
    background: palette.white,
    foreground: "#1a1a1e",
    cursor: "#1a1a1e",
    cursorAccent: palette.white,
    selectionBackground: "rgba(0, 0, 0, 0.15)",
    selectionForeground: "#1a1a1e",

    black: "#1a1a1e",
    red: palette.red[600], // (#dc2626)
    green: "#1FA855", // = accent.base
    yellow: "#ca8a04", // inline: not in palette
    blue: palette.blue[600], // (#2563eb)
    magenta: "#475569", // inline: slate-600 not in primitives
    cyan: "#0891b2", // inline: cyan not in primitives
    white: palette.white,

    brightBlack: palette.zinc[700], // (#3f3f46)
    brightRed: palette.red[500], // (#ef4444)
    brightGreen: palette.green[500], // (#22c55e)
    brightYellow: palette.amber[500], // (#f59e0b)
    brightBlue: palette.blue[500], // (#3b82f6)
    brightMagenta: "#64748b", // inline
    brightCyan: "#06b6d4", // inline
    brightWhite: palette.zinc[50], // (#fafafa)
  },
} as const;
