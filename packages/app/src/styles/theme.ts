// Composition root for Ottie's Unistyles 3 theme tree.
//
// v1.11 token skeleton (Plan 01-02 / D-09 / D-11 / D-12):
//   - Color/spacing/radius primitives live in `tokens/primitives.ts`.
//   - Light/dark semantic aliases live in `tokens/semantic.{light,dark}.ts`.
//   - Component-level tokens live in `tokens/component.ts`.
//   - Motion + typography tokens live in `tokens/motion.ts` /
//     `tokens/typography.ts`.
//
// This file spreads all six tokens trees plus the new nested semantic
// namespaces into the public theme objects (lightTheme, darkTheme,
// darkZincTheme, darkMidnightTheme, darkClaudeTheme, darkGhosttyTheme).
// Phase 1 is structural — every existing exported name is preserved.

import { palette, spacing } from "./tokens/primitives";
import { semanticLight } from "./tokens/semantic.light";
import { buildSemanticDark, semanticDark, type DarkSemanticConfig } from "./tokens/semantic.dark";
import { componentTokens } from "./tokens/component";
import { motion as motionTokens } from "./tokens/motion";
import { typography } from "./tokens/typography";

// Re-export `palette` under its historical name so any consumer that
// directly imported `baseColors` from this file keeps compiling. No new
// callers; existing call sites read `theme.colors.palette.*` instead.
export const baseColors = palette;

export type ThemeName = "light" | "dark" | "zinc" | "midnight" | "claude" | "ghostty";

// ---------------------------------------------------------------------------
// LEGACY shim — flat semantic shape that today's non-migrated consumers
// (~every screen, every panel) still read via `theme.colors.<flatKey>`.
// Removed surface-by-surface in Phase 4 (THM-02..04). See ROADMAP §"Phase 4".
// ---------------------------------------------------------------------------

// LEGACY shim: flat light-mode semantic literal (lifted verbatim from the
// pre-Plan-01-02 theme.ts:132-225 `lightSemanticColors` block — every key
// identical so non-migrated consumers continue to work).
const lightLegacyColors = {
  // Surfaces (layers) - shifted one step lighter
  surface0: "#ffffff",
  surface1: "#fafafa",
  surface2: "#f4f4f5",
  surface3: "#e4e4e7",
  surface4: "#d4d4d8",
  surfaceDiffEmpty: "#f6f6f6",
  surfaceSidebar: "#f4f4f5",
  surfaceSidebarHover: "#e9e9ec",
  surfaceWorkspace: "#ffffff",
  surfaceGlass: "rgba(255, 255, 255, 0.55)",
  surfaceGlassStrong: "rgba(255, 255, 255, 0.72)",
  surfaceGlassHover: "rgba(255, 255, 255, 0.85)",
  borderGlass: "rgba(0, 0, 0, 0.06)",

  // Chat surfaces — IM-style message area
  surfaceChat: "#f7f7f8",
  bubbleSelf: "#dcfce7",
  bubbleSelfForeground: "#14532d",
  bubbleOther: "#f4f4f5",
  bubbleOtherForeground: "#1a1a1e",
  bubbleMeta: "#71717a",

  // Text
  foreground: "#1a1a1e",
  foregroundMuted: "#71717a",

  // Controls
  scrollbarHandle: "#3f3f46",

  // Borders
  border: "#e4e4e7",
  borderAccent: "#ececf1",

  // Brand — messenger green
  accent: "#48b7f6",
  accentBright: "#7dd3fc",
  accentForeground: "#ffffff",

  // Semantic
  destructive: "#dc2626",
  destructiveForeground: "#ffffff",
  success: "#1FA855",
  successForeground: "#ffffff",

  // Legacy aliases (for gradual migration)
  background: "#ffffff",
  popover: "#ffffff",
  popoverForeground: "#1a1a1e",
  primary: "#18181b",
  primaryForeground: "#fafafa",
  secondary: "#f4f4f5",
  secondaryForeground: "#1a1a1e",
  muted: "#f4f4f5",
  mutedForeground: "#71717a",
  accentBorder: "#ececf1",
  input: "#f4f4f5",
  ring: "#18181b",

  // Diff signals (light)
  diffAddition: "#15803d",
  diffDeletion: "#b91c1c",

  // PR / check status signals (light)
  statusSuccess: "#15803d",
  statusDanger: "#b91c1c",
  statusWarning: "#d97706",
  statusMerged: "#52525b",

  terminal: {
    background: "#ffffff",
    foreground: "#1a1a1e",
    cursor: "#1a1a1e",
    cursorAccent: "#ffffff",
    selectionBackground: "rgba(0, 0, 0, 0.15)",
    selectionForeground: "#1a1a1e",
    black: "#1a1a1e",
    red: "#dc2626",
    green: "#1FA855",
    yellow: "#ca8a04",
    blue: "#2563eb",
    magenta: "#475569",
    cyan: "#0891b2",
    white: "#ffffff",
    brightBlack: "#3f3f46",
    brightRed: "#ef4444",
    brightGreen: "#22c55e",
    brightYellow: "#f59e0b",
    brightBlue: "#3b82f6",
    brightMagenta: "#64748b",
    brightCyan: "#06b6d4",
    brightWhite: "#fafafa",
  },
} as const;

// ---------------------------------------------------------------------------
// Dark variant configs + LEGACY shim builder
// ---------------------------------------------------------------------------

const darkTerminalAnsi = {
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

// LEGACY shim builder: produces the flat dark-semantic shape today's
// non-migrated consumers read via `theme.colors.<flatKey>`. Identical to
// the pre-Plan-01-02 `buildDarkSemanticColors` body.
function buildDarkLegacyColors(tint: DarkSemanticConfig) {
  const surfaceGlass = tint.surfaceGlass ?? "rgba(255, 255, 255, 0.06)";
  const surfaceGlassStrong = tint.surfaceGlassStrong ?? "rgba(255, 255, 255, 0.10)";
  const surfaceGlassHover = tint.surfaceGlassHover ?? "rgba(255, 255, 255, 0.14)";
  const borderGlass = tint.borderGlass ?? "rgba(255, 255, 255, 0.10)";
  return {
    surface0: tint.surface0,
    surface1: tint.surface1,
    surface2: tint.surface2,
    surface3: tint.surface3,
    surface4: tint.surface4,
    surfaceDiffEmpty: tint.surfaceDiffEmpty,
    surfaceSidebar: tint.surfaceSidebar,
    surfaceSidebarHover: tint.surfaceSidebarHover,
    surfaceWorkspace: tint.surface1,

    surfaceGlass,
    surfaceGlassStrong,
    surfaceGlassHover,
    borderGlass,

    surfaceChat: tint.surface0,
    bubbleSelf: "rgba(31, 168, 85, 0.20)",
    bubbleSelfForeground: "#e8f8ee",
    bubbleOther: tint.surface2,
    bubbleOtherForeground: "#fafafa",
    bubbleMeta: tint.foregroundMuted,

    foreground: "#fafafa",
    foregroundMuted: tint.foregroundMuted,

    scrollbarHandle: tint.scrollbarHandle,

    border: tint.border,
    borderAccent: tint.borderAccent,

    accent: tint.accent,
    accentBright: tint.accentBright,
    accentForeground: "#ffffff",

    destructive: "#ef4444",
    destructiveForeground: "#ffffff",
    success: tint.accent,
    successForeground: "#ffffff",

    // Legacy aliases (for gradual migration)
    background: tint.surface0,
    popover: tint.surface2,
    popoverForeground: "#fafafa",
    primary: "#fafafa",
    primaryForeground: tint.surface0,
    secondary: tint.surface2,
    secondaryForeground: "#fafafa",
    muted: tint.surface2,
    mutedForeground: tint.foregroundMuted,
    accentBorder: tint.borderAccent,
    input: tint.surface2,
    ring: "#d4d4d8",

    // Diff signals (dark)
    diffAddition: "#4ade80",
    diffDeletion: "#ef4444",

    // PR / check status signals (dark)
    statusSuccess: "#16a34a",
    statusDanger: "#dc2626",
    statusWarning: "#f59e0b",
    statusMerged: "#a1a1aa",

    terminal: {
      background: tint.surface0,
      foreground: "#fafafa",
      cursor: "#fafafa",
      cursorAccent: tint.surface0,
      selectionBackground: "rgba(255, 255, 255, 0.2)",
      selectionForeground: "#fafafa",
      black: tint.surfaceSidebar,
      ...darkTerminalAnsi,
      brightBlack: tint.surface3,
    },
  };
}

// ---------------------------------------------------------------------------
// Dark tint definitions — same values as before Plan 01-02. Each variant
// drives both the legacy flat shape and the new nested semantic shape.
// ---------------------------------------------------------------------------

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
  accent: "#48b7f6",
  accentBright: "#7dd3fc",
};

const zincDarkConfig: DarkSemanticConfig = {
  surface0: "#18181b",
  surface1: "#1f1f22",
  surface2: "#27272a",
  surface3: "#3f3f46",
  surface4: "#52525b",
  surfaceDiffEmpty: "#242427",
  surfaceSidebar: "#131316",
  surfaceSidebarHover: "#1b1b1e",
  foregroundMuted: "#a1a1aa",
  scrollbarHandle: "#71717a",
  border: "#27272a",
  borderAccent: "#303036",
  accent: "#48b7f6",
  accentBright: "#7dd3fc",
};

const midnightDarkConfig: DarkSemanticConfig = {
  surface0: "#161A1C",
  surface1: "#1C2123",
  surface2: "#252A2D",
  surface3: "#3A4045",
  surface4: "#4F555A",
  surfaceDiffEmpty: "#22272A",
  surfaceSidebar: "#111517",
  surfaceSidebarHover: "#1A1F22",
  foregroundMuted: "#9099A0",
  scrollbarHandle: "#5F676D",
  border: "#242A2D",
  borderAccent: "#2D3439",
  accent: "#48b7f6",
  accentBright: "#7dd3fc",
  surfaceGlass: "rgba(210, 230, 255, 0.05)",
  surfaceGlassStrong: "rgba(210, 230, 255, 0.09)",
  surfaceGlassHover: "rgba(210, 230, 255, 0.13)",
  borderGlass: "rgba(210, 230, 255, 0.10)",
};

const claudeDarkConfig: DarkSemanticConfig = {
  surface0: "#1d1d1f",
  surface1: "#252527",
  surface2: "#2c2c2e",
  surface3: "#3a3a3c",
  surface4: "#48484a",
  surfaceDiffEmpty: "#252527",
  surfaceSidebar: "#161618",
  surfaceSidebarHover: "#202022",
  foregroundMuted: "#a8a8ad",
  scrollbarHandle: "#6e6e73",
  border: "#2a2a2c",
  borderAccent: "#34343a",
  accent: "#48b7f6",
  accentBright: "#7dd3fc",
  surfaceGlass: "rgba(255, 240, 220, 0.05)",
  surfaceGlassStrong: "rgba(255, 240, 220, 0.09)",
  surfaceGlassHover: "rgba(255, 240, 220, 0.13)",
  borderGlass: "rgba(255, 240, 220, 0.10)",
};

const ghosttyDarkConfig: DarkSemanticConfig = {
  surface0: "#1F2422",
  surface1: "#262B29",
  surface2: "#2D3331",
  surface3: "#3F4644",
  surface4: "#535B59",
  surfaceDiffEmpty: "#292E2C",
  surfaceSidebar: "#181C1B",
  surfaceSidebarHover: "#212523",
  foregroundMuted: "#A4ABA8",
  scrollbarHandle: "#6F7775",
  border: "#272D2B",
  borderAccent: "#313835",
  accent: "#48b7f6",
  accentBright: "#7dd3fc",
  surfaceGlass: "rgba(220, 255, 235, 0.05)",
  surfaceGlassStrong: "rgba(220, 255, 235, 0.09)",
  surfaceGlassHover: "rgba(220, 255, 235, 0.13)",
  borderGlass: "rgba(220, 255, 235, 0.10)",
};

// ---------------------------------------------------------------------------
// Shadows + shared common-theme block (kept verbatim, lifted from pre-01-02)
// ---------------------------------------------------------------------------

const darkShadow = {
  sm: {
    shadowColor: "rgba(0, 0, 0, 0.25)",
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: "rgba(0, 0, 0, 0.20)",
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 8,
  },
  lg: {
    shadowColor: "rgba(0, 0, 0, 0.40)",
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 24,
    elevation: 8,
  },
  glass: {
    shadowColor: "rgba(0, 0, 0, 0.45)",
    shadowOffset: { width: 0, height: 18 },
    shadowRadius: 38,
    elevation: 16,
  },
  glassDeep: {
    shadowColor: "rgba(0, 0, 0, 0.55)",
    shadowOffset: { width: 0, height: 28 },
    shadowRadius: 56,
    elevation: 24,
  },
} as const;

const lightShadow = {
  sm: {
    shadowColor: "rgba(0, 0, 0, 0.06)",
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: "rgba(0, 0, 0, 0.08)",
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 4,
  },
  lg: {
    shadowColor: "rgba(0, 0, 0, 0.10)",
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 24,
    elevation: 6,
  },
  glass: {
    shadowColor: "rgba(0, 0, 0, 0.12)",
    shadowOffset: { width: 0, height: 18 },
    shadowRadius: 38,
    elevation: 12,
  },
  glassDeep: {
    shadowColor: "rgba(0, 0, 0, 0.18)",
    shadowOffset: { width: 0, height: 28 },
    shadowRadius: 56,
    elevation: 18,
  },
} as const;

// `commonTheme` keeps the legacy flat shape (spacing, fontSize, iconSize,
// fontWeight, borderRadius, borderWidth, opacity, fontFamily, motion) for
// non-migrated consumers. New code reads `theme.spacing` / `theme.typography`
// / `theme.components` / `theme.motion` from the spread tokens trees below.
const commonTheme = {
  spacing,

  fontSize: typography.fontSize,
  lineHeight: typography.lineHeight,
  fontFamily: typography.fontFamily,
  fontWeight: typography.weight,

  iconSize: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 20,
  },

  borderRadius: {
    none: 0,
    sm: 4,
    base: 8,
    md: 10,
    lg: 12,
    xl: 16,
    "2xl": 20,
    "3xl": 24,
    full: 9999,
    // IM-style semantic radii
    card: 14,
    bubble: 20,
    sheet: 18,
    pill: 9999,
    // macOS/iOS 26 semantic radii
    button: 14,
    field: 14,
    glassCard: 18,
    glassSheet: 22,
    glassPill: 9999,
  },

  borderWidth: {
    0: 0,
    1: 1,
    2: 2,
  },

  opacity: {
    0: 0,
    50: 0.5,
    100: 1,
  },

  motion: {
    duration: {
      fast: 120,
      base: 200,
      slow: 320,
    },
    spring: {
      snappy: { damping: 22, stiffness: 320, mass: 0.9 },
      gentle: { damping: 26, stiffness: 220, mass: 1 },
      bouncy: { damping: 14, stiffness: 220, mass: 1 },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Theme assembly — composition root. Every variant gets:
//   - the shared primitive/spacing/radius/motion/typography token trees,
//     spread under their nested namespaces (theme.palette, theme.motionTokens, etc.)
//   - the new nested SEMANTIC namespaces (surface, text, status, accent, ...)
//   - the LEGACY flat `colors:` shim (Phase 4 deprecates surface-by-surface)
//   - the existing `commonTheme` flat shape (spacing/borderRadius/etc.)
// ---------------------------------------------------------------------------

function buildLightTheme() {
  const semantic = semanticLight;
  return {
    colorScheme: "light" as const,
    // Nested semantic namespaces (new — Plan 01-02 consumers).
    surface: semantic.surface,
    text: semantic.text,
    border: semantic.border,
    control: semantic.control,
    accent: semantic.accent,
    status: semantic.status,
    components: componentTokens,
    motionTokens,
    typography,
    // LEGACY shim — removed surface-by-surface in Phase 4 (THM-02..04).
    colors: {
      ...lightLegacyColors,
      palette,
    },
    shadow: lightShadow,
    ...commonTheme,
  } as const;
}

function buildDarkTheme(tint: DarkSemanticConfig) {
  const semantic = buildSemanticDark(tint);
  const legacy = buildDarkLegacyColors(tint);
  return {
    colorScheme: "dark" as const,
    // Nested semantic namespaces (new — Plan 01-02 consumers).
    surface: semantic.surface,
    text: semantic.text,
    border: semantic.border,
    control: semantic.control,
    accent: semantic.accent,
    status: semantic.status,
    components: componentTokens,
    motionTokens,
    typography,
    // LEGACY shim — removed surface-by-surface in Phase 4 (THM-02..04).
    colors: {
      ...legacy,
      palette,
    },
    shadow: darkShadow,
    ...commonTheme,
  } as const;
}

export const lightTheme = buildLightTheme();
export const darkTheme = buildDarkTheme(ottieDarkConfig);
export const darkZincTheme = buildDarkTheme(zincDarkConfig);
export const darkMidnightTheme = buildDarkTheme(midnightDarkConfig);
export const darkClaudeTheme = buildDarkTheme(claudeDarkConfig);
export const darkGhosttyTheme = buildDarkTheme(ghosttyDarkConfig);

// Re-export `semanticDark` so any consumer that imports it directly from
// theme.ts keeps compiling (no current call sites — additive, harmless).
export { semanticDark, semanticLight };

// Keep compatibility with existing code
export const theme = darkTheme;

// Export a union type that works for both themes
export type Theme = typeof darkTheme | typeof lightTheme;

type UnistylesThemeKey =
  | "light"
  | "dark"
  | "darkZinc"
  | "darkMidnight"
  | "darkClaude"
  | "darkGhostty";

export const THEME_TO_UNISTYLES: Record<ThemeName, UnistylesThemeKey> = {
  light: "light",
  dark: "dark",
  zinc: "darkZinc",
  midnight: "darkMidnight",
  claude: "darkClaude",
  ghostty: "darkGhostty",
};

export const THEME_SWATCHES: Record<ThemeName, string> = {
  light: "#ffffff",
  dark: "#1FA855",
  zinc: "#71717a",
  midnight: "#3A4045",
  claude: "#48484a",
  ghostty: "#22C55E",
};
