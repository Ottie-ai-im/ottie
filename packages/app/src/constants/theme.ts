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

// Font family names. The whole UI uses JetBrains Mono (Latin / numerals /
// punctuation) paired with Ark Pixel (CJK pixel font) — terminal / hacker
// aesthetic. On web, "JetBrains Mono" is grouped under one family across
// weights via @font-face declarations in public/index.html so font-weight
// cascading works. On native, expo-font registers each weight by filename
// (e.g. "JetBrainsMono-Regular"); we point at the most common weights and
// let RN's fake-bold handle anything else.
//
// CJK fall-through: JetBrains Mono has no Chinese glyphs. The browser /
// react-native-web walks the family list, so Chinese chars naturally pick
// up Ark Pixel — giving the whole UI a coherent "terminal × pixel" look.
const SANS_STACK_WEB =
  "'JetBrains Mono', 'Ark Pixel', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', monospace";
const MONO_STACK_WEB =
  "'JetBrains Mono', 'Ark Pixel', SFMono-Regular, Menlo, Monaco, Consolas, monospace";

const SANS_NATIVE = "JetBrainsMono-Regular";
const MONO_NATIVE = "JetBrainsMono-Regular";

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
