export const baseColors = {
  // Base colors
  white: "#ffffff",
  black: "#000000",

  // Zinc scale (primary gray palette)
  zinc: {
    50: "#fafafa",
    100: "#f4f4f5",
    200: "#e4e4e7",
    300: "#d4d4d8",
    400: "#a1a1aa",
    500: "#71717a",
    600: "#52525b",
    700: "#3f3f46",
    800: "#27272a",
    850: "#1a1a1d",
    900: "#18181b",
    950: "#121214",
  },

  // Gray scale
  gray: {
    50: "#f9fafb",
    100: "#f3f4f6",
    200: "#e5e7eb",
    300: "#d1d5db",
    400: "#9ca3af",
    500: "#6b7280",
    600: "#4b5563",
    700: "#374151",
    800: "#1f2937",
    900: "#111827",
  },

  // Slate scale
  slate: {
    200: "#e2e8f0",
  },

  // Blue scale
  blue: {
    50: "#eff6ff",
    100: "#dbeafe",
    200: "#bfdbfe",
    300: "#93c5fd",
    400: "#60a5fa",
    500: "#3b82f6",
    600: "#2563eb",
    700: "#1d4ed8",
    800: "#1e40af",
    900: "#1e3a8a",
    950: "#172554",
  },

  // Green scale
  green: {
    100: "#dcfce7",
    200: "#bbf7d0",
    400: "#4ade80",
    500: "#22c55e",
    600: "#16a34a",
    800: "#166534",
    900: "#14532d",
  },

  // Red scale
  red: {
    100: "#fee2e2",
    200: "#fecaca",
    300: "#fca5a5",
    500: "#ef4444",
    600: "#dc2626",
    800: "#991b1b",
    900: "#7f1d1d",
  },

  // Teal scale
  teal: {
    200: "#99f6e4",
  },

  // Amber scale
  amber: {
    500: "#f59e0b",
    700: "#b45309",
  },

  // Yellow scale
  yellow: {
    400: "#fbbf24",
  },

  // Orange scale
  orange: {
    500: "#f97316",
    600: "#ea580c",
  },
} as const;

export type ThemeName = "light" | "dark" | "zinc" | "midnight" | "claude" | "ghostty";

// Diff stat colors — light uses muted tones, dark uses the brighter palette values
const lightDiffColors = {
  diffAddition: "#15803d", // green-700 — readable on white without screaming
  diffDeletion: "#b91c1c", // red-700
};

const darkDiffColors = {
  diffAddition: "#4ade80", // green-400
  diffDeletion: "#ef4444", // red-500
};

// Status colors — semantic signals for success/danger/warning/merged. Used by
// check statuses, PR states, and review decisions. Kept a step darker than the
// raw palette so they read as signals, not neon.
const lightStatusColors = {
  statusSuccess: "#15803d", // green-700
  statusDanger: "#b91c1c", // red-700
  statusWarning: "#d97706", // amber-600
  statusMerged: "#52525b", // zinc-600 (gray for merged)
};

const darkStatusColors = {
  statusSuccess: "#16a34a", // green-600
  statusDanger: "#dc2626", // red-600
  statusWarning: "#f59e0b", // amber-500
  statusMerged: "#a1a1aa", // zinc-400 (gray for merged)
};

// Semantic color tokens - Layer-based system
const lightSemanticColors = {
  // Surfaces (layers) - shifted one step lighter
  surface0: "#ffffff", // App background
  surface1: "#fafafa", // Subtle hover (was zinc-100, now zinc-50)
  surface2: "#f4f4f5", // Elevated: badges, inputs, sheets (was zinc-200, now zinc-100)
  surface3: "#e4e4e7", // Highest elevation (was zinc-300, now zinc-200)
  surface4: "#d4d4d8", // Extra emphasis (was zinc-400, now zinc-300)
  surfaceDiffEmpty: "#f6f6f6", // Empty side of split diff rows, between surface1 and surface2 and biased toward surface2
  surfaceSidebar: "#f4f4f5", // Sidebar background (darker than main)
  surfaceSidebarHover: "#e9e9ec", // Sidebar hover (darker in light mode)
  surfaceWorkspace: "#ffffff", // Workspace main background
  // Glass tokens (light): white-tinted but more opaque so content stays
  // readable on bright backgrounds.
  surfaceGlass: "rgba(255, 255, 255, 0.55)",
  surfaceGlassStrong: "rgba(255, 255, 255, 0.72)",
  surfaceGlassHover: "rgba(255, 255, 255, 0.85)",
  borderGlass: "rgba(0, 0, 0, 0.06)",

  // Chat surfaces — IM-style message area, distinct from workspace pure-white
  surfaceChat: "#f7f7f8", // Chat main background — soft warm gray
  bubbleSelf: "#dcfce7", // Own message bubble — accent-tinted
  bubbleSelfForeground: "#14532d", // green-900 on bubbleSelf
  bubbleOther: "#f4f4f5", // Agent / counterpart message bubble
  bubbleOtherForeground: "#1a1a1e",
  bubbleMeta: "#71717a", // Timestamps, delivery marks, sender names

  // Text
  foreground: "#1a1a1e",
  foregroundMuted: "#71717a",

  // Controls
  scrollbarHandle: "#3f3f46", // zinc-700

  // Borders - shifted one step lighter
  border: "#e4e4e7", // (was zinc-200, now zinc-200 - keep for contrast)
  borderAccent: "#ececf1", // Softer accent border for low-emphasis outlines

  // Brand — messenger green. accent is the calmer base used for
  // buttons/active states; accentBright is the brighter highlight for
  // hover, focus rings, and online indicators.
  accent: "#1FA855",
  accentBright: "#22C55E",
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

  ...lightDiffColors,
  ...lightStatusColors,

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
// Dark theme variant builder
// ---------------------------------------------------------------------------

interface DarkThemeConfig {
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
  /**
   * macOS/iOS 26-inspired glass tints. Optional so existing tints keep
   * working — `buildDarkSemanticColors` derives sane defaults when omitted.
   * `surfaceGlass*` are translucent fills layered on top of darker backdrops
   * (sidebar / behind-window vibrancy). `borderGlass` is the bright inner
   * stroke that gives glass its highlight edge.
   */
  surfaceGlass?: string;
  surfaceGlassStrong?: string;
  surfaceGlassHover?: string;
  borderGlass?: string;
}

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

function buildDarkSemanticColors(tint: DarkThemeConfig) {
  // Glass tokens — translucent fills layered on darker backdrops
  // (sidebar / vibrancy). Defaults pick a subtle white wash that matches
  // macOS 26's "Liquid Glass" look. Tints can override for e.g. tinted
  // panels (claude warm, ghostty cool).
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
    // Glass surfaces
    surfaceGlass,
    surfaceGlassStrong,
    surfaceGlassHover,
    borderGlass,

    // Chat surfaces — IM-style message area
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

    ...darkDiffColors,
    ...darkStatusColors,

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
// Dark tint definitions
// ---------------------------------------------------------------------------

// Ottie — neutral dark with subtle warm gray + messenger green accent (default)
const ottieDarkColors = buildDarkSemanticColors({
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
});

// Zinc — pure neutral gray with messenger green accent
const zincDarkColors = buildDarkSemanticColors({
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
  accent: "#1FA855",
  accentBright: "#22C55E",
});

// Midnight — cool slate gray with messenger green accent. Slightly
// blue-tinted glass to match macOS 26's "midnight" preset.
const midnightDarkColors = buildDarkSemanticColors({
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
  accent: "#1FA855",
  accentBright: "#22C55E",
  surfaceGlass: "rgba(210, 230, 255, 0.05)",
  surfaceGlassStrong: "rgba(210, 230, 255, 0.09)",
  surfaceGlassHover: "rgba(210, 230, 255, 0.13)",
  borderGlass: "rgba(210, 230, 255, 0.10)",
});

// Claude slot — warm neutral gray + messenger green. Glass overlays use a
// warm ivory tint so the panel feels closer to macOS 26 "Tahoe" warm light.
const claudeDarkColors = buildDarkSemanticColors({
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
  accent: "#1FA855",
  accentBright: "#22C55E",
  surfaceGlass: "rgba(255, 240, 220, 0.05)",
  surfaceGlassStrong: "rgba(255, 240, 220, 0.09)",
  surfaceGlassHover: "rgba(255, 240, 220, 0.13)",
  borderGlass: "rgba(255, 240, 220, 0.10)",
});

// Ghostty slot — cool gray-green dark with green-tinted glass.
const ghosttyDarkColors = buildDarkSemanticColors({
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
  accent: "#1FA855",
  accentBright: "#22C55E",
  surfaceGlass: "rgba(220, 255, 235, 0.05)",
  surfaceGlassStrong: "rgba(220, 255, 235, 0.09)",
  surfaceGlassHover: "rgba(220, 255, 235, 0.13)",
  borderGlass: "rgba(220, 255, 235, 0.10)",
});

const commonTheme = {
  spacing: {
    0: 0,
    1: 4,
    1.5: 6,
    2: 8,
    3: 12,
    4: 16,
    6: 24,
    8: 32,
    12: 48,
    16: 64,
    20: 80,
    24: 96,
    32: 128,
  },

  fontSize: {
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 20,
    "2xl": 22,
    "3xl": 26,
    "4xl": 34,
  },

  lineHeight: {
    diff: 22,
  },

  iconSize: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 20,
  },

  fontWeight: {
    normal: "normal" as const,
    medium: "500" as const,
    semibold: "600" as const,
    bold: "bold" as const,
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
    // IM-style semantic radii — use these for chat surfaces so we keep
    // existing UI radii stable while migrating phase-by-phase.
    card: 14,
    bubble: 20,
    sheet: 18,
    pill: 9999,
    // macOS/iOS 26 semantic radii — continuous-style squircles. Pair these
    // with `borderCurve: "continuous"` on each style to get the iOS look.
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

  /**
   * Typography stack. Following CLAUDE.md hybrid policy:
   * - `system`: macOS/iOS 26 SF stack for chrome (buttons, headers, menus)
   * - `rounded`: SF Pro Rounded equivalent for prominent display titles
   * - `mono`: existing JetBrains Mono / Ark Pixel pair, kept for code,
   *   agent stream output, terminal, and inputs that benefit from
   *   monospaced alignment.
   *
   * On web/Tauri: SF stack resolves to "-apple-system" then falls back.
   * On native: React Native maps "System" automatically to SF Pro / Roboto.
   */
  fontFamily: {
    system:
      'system-ui, -apple-system, "SF Pro Text", "SF Pro", BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    rounded:
      '"SF Pro Rounded", "SF Pro Display", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    mono: '"JetBrains Mono", "Ark Pixel", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  },

  /**
   * Motion tokens — used with reanimated `withSpring` / `withTiming`.
   * `snappy`: button presses, tab switches, hover-in/out
   * `gentle`: modals, sheets, drawer slides
   * `bouncy`: drag-release, sidebar opens (slight overshoot for life)
   */
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
  /**
   * macOS 26-style glass elevation — soft, wide, low-intensity.
   * `glass` is for floating cards/menus; `glassDeep` for full-screen
   * sheets and modal stacks where the ambient shadow should read further.
   */
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

function buildDarkTheme(semanticColors: ReturnType<typeof buildDarkSemanticColors>) {
  return {
    colorScheme: "dark" as const,
    colors: {
      ...semanticColors,
      palette: baseColors,
    },
    shadow: darkShadow,
    ...commonTheme,
  } as const;
}

export const darkTheme = buildDarkTheme(ottieDarkColors);
export const darkZincTheme = buildDarkTheme(zincDarkColors);
export const darkMidnightTheme = buildDarkTheme(midnightDarkColors);
export const darkClaudeTheme = buildDarkTheme(claudeDarkColors);
export const darkGhosttyTheme = buildDarkTheme(ghosttyDarkColors);

export const lightTheme = {
  colorScheme: "light" as const,
  colors: {
    ...lightSemanticColors,
    palette: baseColors,
  },
  shadow: lightShadow,
  ...commonTheme,
} as const;

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
