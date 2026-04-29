/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from "react-native";

const tintColorLight = "#1FA855";
const tintColorDark = "#22C55E";

export const Colors = {
  light: {
    text: "#11181C",
    background: "#fff",
    tint: tintColorLight,
    icon: "#687076",
    tabIconDefault: "#687076",
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: "#ECEDEE",
    background: "#151718",
    tint: tintColorDark,
    icon: "#9BA1A6",
    tabIconDefault: "#9BA1A6",
    tabIconSelected: tintColorDark,
  },
};

// Font family names. Ark Pixel everywhere (Latin + CJK) so the whole UI
// keeps the pixel-art look. Render size is locked to 16px (native PPEM)
// in public/index.html so the pixel grid stays sharp; antialiasing softens
// the edges just enough to avoid the harsh 8-bit look. JetBrains Mono is
// kept only as a last-resort fallback for any glyph Ark Pixel lacks.
const SANS_STACK_WEB = "'Ark Pixel', 'JetBrains Mono', monospace";
const MONO_STACK_WEB = "'Ark Pixel', 'JetBrains Mono', monospace";

const SANS_NATIVE = "ArkPixel16px";
const MONO_NATIVE = "ArkPixel16px";

export const Fonts = Platform.select({
  ios: {
    sans: SANS_NATIVE,
    serif: "ui-serif",
    rounded: "ui-rounded",
    mono: MONO_NATIVE,
  },
  default: {
    sans: SANS_NATIVE,
    serif: "serif",
    rounded: "normal",
    mono: MONO_NATIVE,
  },
  web: {
    sans: SANS_STACK_WEB,
    serif: "Georgia, 'Times New Roman', serif",
    rounded: SANS_STACK_WEB,
    mono: MONO_STACK_WEB,
  },
});
