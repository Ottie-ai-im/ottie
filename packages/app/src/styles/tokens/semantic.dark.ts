// Dark-mode semantic tokens — mirror of semantic.light.ts (same key paths,
// dark values). Default values are the "ottie" dark theme that today's
// `darkTheme` export produces; alternate dark variants (zinc, midnight,
// claude, ghostty) feed a different `DarkThemeConfig` into
// `buildSemanticDark()` from theme.ts.
//
// Phase 1 is structural, NOT visual (PITFALLS pitfall 1). Every existing
// dark value MUST round-trip identically.
//
// Migration map (OLD → new) is identical to semantic.light.ts; see that
// file for the canonical mapping. This file only documents dark-specific
// deltas.

import { palette } from "./primitives";

/**
 * Per-variant config — same shape as the legacy `DarkThemeConfig` in
 * theme.ts. Surface/text/border values vary per variant; everything
 * else (status colors, accent.foreground, terminal ansi) is shared via
 * the `buildSemanticDark` body below.
 */
export interface DarkSemanticConfig {
  surface0: string;
  surface1: string;
  surface2: string;
  surface3: string;
  surface4: string;
  surfaceDiffEmpty: string;
  surfaceSidebar: string;
  surfaceSidebarHover: string;
  foregroundMuted: string;
  scrollbarHandle: string;
  border: string;
  borderAccent: string;
  accent: string;
  accentBright: string;
  /** Optional glass overrides — fall back to the standard white-wash defaults below. */
  surfaceGlass?: string;
  surfaceGlassStrong?: string;
  surfaceGlassHover?: string;
  borderGlass?: string;
}

const DARK_TERMINAL_ANSI = {
  red: "#e07070",
  green: "#5dba80",
  yellow: "#d4a44a",
  blue: "#6a9de0",
  magenta: "#94a3b8",
  cyan: "#4aabb8",
  white: "#d4d4d8",
  brightRed: "#e89090",
  brightGreen: "#7ecf9a",
  brightYellow: "#e0be6e",
  brightBlue: "#8ab4e8",
  brightMagenta: "#cbd5e1",
  brightCyan: "#6ec2cc",
  brightWhite: "#f0f0f2",
} as const;

export function buildSemanticDark(tint: DarkSemanticConfig) {
  // Glass defaults match macOS 26 "Liquid Glass" white wash. Variants
  // override (e.g. claude warm, ghostty cool) by passing surfaceGlass*.
  const glassTint = tint.surfaceGlass ?? "rgba(255, 255, 255, 0.06)";
  const glassTintStrong = tint.surfaceGlassStrong ?? "rgba(255, 255, 255, 0.10)";
  const glassTintHover = tint.surfaceGlassHover ?? "rgba(255, 255, 255, 0.14)";
  const glassBorder = tint.borderGlass ?? "rgba(255, 255, 255, 0.10)";

  return {
    surface: {
      background: tint.surface0, // surface0
      subtle: tint.surface1, // surface1
      elevated: tint.surface2, // surface2
      high: tint.surface3, // surface3
      highest: tint.surface4, // surface4
      diffEmpty: tint.surfaceDiffEmpty,
      sidebar: tint.surfaceSidebar,
      sidebarHover: tint.surfaceSidebarHover,
      workspace: tint.surface1, // surfaceWorkspace = surface1 in dark (per legacy buildDarkSemanticColors)
      chat: tint.surface0, // surfaceChat = surface0 in dark (per legacy)
      glass: {
        tint: glassTint,
        tintStrong: glassTintStrong,
        tintHover: glassTintHover,
        border: glassBorder,
      },
      bubble: {
        self: "rgba(31, 168, 85, 0.20)", // bubbleSelf — accent-tinted translucent (legacy literal)
        other: tint.surface2, // bubbleOther = surface2 (legacy literal)
      },
    },

    text: {
      primary: palette.zinc[50], // foreground = #fafafa
      muted: tint.foregroundMuted,
      bubble: {
        self: "#e8f8ee", // bubbleSelfForeground (no palette match — light green wash)
        other: palette.zinc[50], // bubbleOtherForeground = #fafafa
        meta: tint.foregroundMuted,
      },
    },

    border: {
      default: tint.border,
      accent: tint.borderAccent,
    },

    control: {
      scrollbarHandle: tint.scrollbarHandle,
    },

    accent: {
      base: tint.accent,
      bright: tint.accentBright,
      foreground: palette.white,
    },

    status: {
      destructive: palette.red[500], // (#ef4444) — brighter red on dark backgrounds
      destructiveForeground: palette.white,
      success: tint.accent, // success = accent in dark (legacy semantic alias)
      successForeground: palette.white,

      // Diff signals (dark) — brighter palette so they read on dark fields.
      diffAddition: palette.green[400], // (#4ade80)
      diffDeletion: palette.red[500], // (#ef4444)

      // PR / check status signals (darkStatusColors — verbatim)
      statusSuccess: palette.green[600], // (#16a34a)
      statusDanger: palette.red[600], // (#dc2626)
      statusWarning: palette.amber[500], // (#f59e0b)
      statusMerged: palette.zinc[400], // (#a1a1aa)

      // Daemon connection-dot triad (D-09 add-on for daemon-connection-dot.tsx migration)
      online: palette.green[400],
      connecting: palette.amber[500],
      offline: palette.red[500],
    },

    terminal: {
      background: tint.surface0,
      foreground: palette.zinc[50], // #fafafa
      cursor: palette.zinc[50],
      cursorAccent: tint.surface0,
      selectionBackground: "rgba(255, 255, 255, 0.2)",
      selectionForeground: palette.zinc[50],
      black: tint.surfaceSidebar,
      ...DARK_TERMINAL_ANSI,
      brightBlack: tint.surface3,
    },
  } as const;
}

// Default Ottie dark — neutral dark with subtle warm gray + messenger green
// accent. Equivalent to today's `darkTheme` export from theme.ts.
const ottieDarkConfig: DarkSemanticConfig = {
  surface0: "#1A1C1B",
  surface1: "#202221",
  surface2: "#272A29",
  surface3: "#3A3D3C",
  surface4: "#54595A",
  surfaceDiffEmpty: "#242625",
  surfaceSidebar: "#141615",
  surfaceSidebarHover: "#1D201F",
  foregroundMuted: "#A0A4A2",
  scrollbarHandle: "#6E7270",
  border: "#252827",
  borderAccent: "#2E3231",
  accent: "#1FA855",
  accentBright: "#22C55E",
};

export const semanticDark = buildSemanticDark(ottieDarkConfig);
