// Typography tokens — fontFamily, fontSize, lineHeight, weight.
//
// Lifted verbatim from theme.ts `commonTheme.fontFamily` /
// `commonTheme.fontSize` / `commonTheme.lineHeight` /
// `commonTheme.fontWeight`. Phase 1 is structural — values match
// byte-for-byte.

export const typography = {
  /**
   * Typography stack. CLAUDE.md hybrid policy:
   * - `system`: macOS/iOS 26 SF stack for chrome (buttons, headers, menus)
   * - `rounded`: SF Pro Rounded for prominent display titles
   * - `mono`: JetBrains Mono / Ark Pixel pair for code, agent stream
   *   output, terminal, and inputs that benefit from monospaced alignment.
   */
  fontFamily: {
    system:
      'system-ui, -apple-system, "SF Pro Text", "SF Pro", BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    rounded:
      '"SF Pro Rounded", "SF Pro Display", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    mono: '"JetBrains Mono", "Ark Pixel", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
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

  /**
   * Font weight aliases. Names match the React Native/Expo font-weight
   * vocabulary (`"normal" | "500" | "600" | "bold"`).
   */
  weight: {
    normal: "normal" as const,
    medium: "500" as const,
    semibold: "600" as const,
    bold: "bold" as const,
  },
} as const;
