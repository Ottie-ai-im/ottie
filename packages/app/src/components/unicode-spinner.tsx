import { useEffect, useMemo, useState } from "react";
import { Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

/**
 * Tiny text-frame spinner — cycles through the unicode glyphs from the
 * `unicode-animations` package (https://www.npmjs.com/package/unicode-animations).
 * Used wherever the older grid/curve loaders ran; lighter, scales with
 * font size, and inherits theme color naturally.
 *
 * The package's API has shifted between versions, so we sniff a couple of
 * common shapes and otherwise fall back to a built-in frame table that
 * mirrors the same braille / dots / bouncing-bar sets the package ships.
 */
type AnimationName =
  | "dots"
  | "dots2"
  | "dots3"
  | "line"
  | "arc"
  | "bouncingBar"
  | "circleHalves"
  | "moon";

const FALLBACK_FRAMES: Record<AnimationName, readonly string[]> = {
  dots: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  dots2: ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"],
  dots3: ["⠋", "⠙", "⠚", "⠞", "⠖", "⠦", "⠴", "⠲", "⠳", "⠓"],
  line: ["-", "\\", "|", "/"],
  arc: ["◜", "◠", "◝", "◞", "◡", "◟"],
  bouncingBar: ["[    ]", "[=   ]", "[==  ]", "[=== ]", "[ ===]", "[  ==]", "[   =]"],
  circleHalves: ["◐", "◓", "◑", "◒"],
  moon: ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"],
};

type PackageShape =
  | { animations?: Partial<Record<string, readonly string[]>> }
  | Partial<Record<string, readonly string[]>>;

let cachedFrames: Partial<Record<AnimationName, readonly string[]>> | null = null;

function loadPackageFrames(): Partial<Record<AnimationName, readonly string[]>> {
  if (cachedFrames) return cachedFrames;
  try {
    // Lazy require so a missing dependency doesn't crash the bundler in dev.
    // Metro / webpack inline this; the catch handles "module not found".
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("unicode-animations") as PackageShape;
    const root = (mod as { animations?: Partial<Record<string, readonly string[]>> }).animations;
    const source = (root ?? mod) as Partial<Record<string, readonly string[]>>;
    const picks: Partial<Record<AnimationName, readonly string[]>> = {};
    for (const name of Object.keys(FALLBACK_FRAMES) as AnimationName[]) {
      const frames = source[name];
      if (Array.isArray(frames) && frames.length > 0) {
        picks[name] = frames;
      }
    }
    cachedFrames = picks;
    return picks;
  } catch {
    cachedFrames = {};
    return cachedFrames;
  }
}

export interface UnicodeSpinnerProps {
  /** Which animation to show. Defaults to `"dots"` (braille). */
  animation?: AnimationName;
  /** Frames per second. Defaults to 12 — same cadence as cli-spinners' "dots". */
  fps?: number;
  /** Override font size; defaults to current parent. */
  size?: number;
  /** Override color; defaults to theme.colors.foregroundMuted. */
  color?: string;
}

export function UnicodeSpinner({ animation = "dots", fps = 12, size, color }: UnicodeSpinnerProps) {
  const { theme } = useUnistyles();
  const frames = useMemo(() => {
    const fromPackage = loadPackageFrames()[animation];
    return fromPackage ?? FALLBACK_FRAMES[animation];
  }, [animation]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (frames.length <= 1) return;
    const interval = setInterval(
      () => setIndex((value) => (value + 1) % frames.length),
      Math.max(16, Math.round(1000 / fps)),
    );
    return () => clearInterval(interval);
  }, [frames.length, fps]);

  const textStyle = useMemo(
    () => [
      styles.text,
      {
        fontSize: size ?? theme.fontSize.base,
        color: color ?? theme.colors.foregroundMuted,
        // Lock the cell width to the widest frame so the layout doesn't
        // jiggle as the glyph changes between narrow / wide forms.
        minWidth: (size ?? theme.fontSize.base) * (animation === "bouncingBar" ? 4 : 1.1),
      },
    ],
    [size, color, theme.fontSize.base, theme.colors.foregroundMuted, animation],
  );

  return (
    <Text style={textStyle} accessible accessibilityRole="progressbar" accessibilityLabel="Loading">
      {frames[index] ?? frames[0] ?? ""}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  text: {
    fontFamily: theme.fontFamily.mono,
    fontWeight: theme.fontWeight.normal,
    textAlign: "center",
    lineHeight: undefined,
  },
}));
