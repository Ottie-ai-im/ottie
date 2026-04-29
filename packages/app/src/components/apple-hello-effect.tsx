import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";

/**
 * Apple-style "Hello" reveal — strokes "你好" onto the screen as if
 * handwritten, then fades the fill in. Inspired by chanhdai.com/components/apple-hello-effect:
 * the trick is a stroke-only `<text>` with stroke-dasharray animated, layered
 * under a fill-only copy that crossfades in once the stroke completes.
 *
 * Web-first — uses SVG + CSS keyframes. On native we fall back to a static
 * styled Text since the same path-stroke animation isn't worth the
 * react-native-svg ceremony for a one-shot intro.
 */
export interface AppleHelloEffectProps {
  /** Greeting text. Defaults to "你好"; pass "Hello" for the English variant. */
  text?: string;
  /** Width of the rendered SVG in px. Height is derived from the aspect ratio. */
  width?: number;
  /** Color of the stroke + final fill. Defaults to the theme foreground. */
  color?: string;
  /** Total animation duration in ms. Stroke takes ~80% of this; fill fades in last. */
  durationMs?: number;
  /** Restart the animation when this value changes. */
  replayKey?: string | number;
}

const DEFAULT_TEXT = "你好";

export function AppleHelloEffect({
  text = DEFAULT_TEXT,
  width = 280,
  color,
  durationMs = 2200,
  replayKey,
}: AppleHelloEffectProps) {
  const { theme } = useUnistyles();
  const resolvedColor = color ?? theme.colors.foreground;
  const reactId = useId();
  const animId = `apple-hello-${reactId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const [tick, setTick] = useState(0);
  const previousReplayKey = useRef(replayKey);

  useEffect(() => {
    if (previousReplayKey.current !== replayKey) {
      previousReplayKey.current = replayKey;
      setTick((value) => value + 1);
    }
  }, [replayKey]);

  // SVG `<text>` doesn't expose individual glyph length, but
  // `stroke-dasharray` set to a generously large value paired with
  // `stroke-dashoffset` animated to 0 produces a clean left-to-right
  // reveal. We layer two copies: the first paints only the stroke (the
  // "writing"), the second paints only the fill (the "ink filling in").
  const aspect = 0.42;
  const height = Math.round(width * aspect);
  const fontSize = Math.round(width * 0.36);
  const strokeDuration = Math.round(durationMs * 0.78);
  const fillDelay = Math.round(durationMs * 0.6);
  const fillDuration = Math.round(durationMs - fillDelay);

  // Fontstack matches macOS 26 chrome — SF Pro Rounded gives the
  // friendlier, hand-drawn-adjacent feel that pairs with the reveal.
  const fontFamily = theme.fontFamily.rounded;

  const fallbackTextStyle = useMemo(
    () => [styles.fallbackText, { color: resolvedColor, fontSize: width * 0.42 }],
    [resolvedColor, width],
  );
  const wrapStyle = useMemo(() => [styles.wrap, { width, height }], [width, height]);
  const keyframeMarkup = useMemo(
    () => ({
      __html: `
        @keyframes ${animId}-stroke {
          0%   { stroke-dashoffset: 800; opacity: 1; }
          100% { stroke-dashoffset: 0;   opacity: 1; }
        }
        @keyframes ${animId}-fill {
          0%   { fill-opacity: 0; }
          100% { fill-opacity: 1; }
        }
        @keyframes ${animId}-strokeFade {
          0%, 70% { opacity: 1; }
          100%    { opacity: 0; }
        }
      `,
    }),
    [animId],
  );
  const svgRootStyle = useMemo(() => ({ overflow: "visible" as const }), []);
  const strokeAnimStyle = useMemo(
    () => ({
      strokeDasharray: 800,
      strokeDashoffset: 800,
      animation: `${animId}-stroke ${strokeDuration}ms cubic-bezier(0.65, 0, 0.35, 1) forwards, ${animId}-strokeFade ${durationMs}ms ease-in-out forwards`,
    }),
    [animId, strokeDuration, durationMs],
  );
  const fillAnimStyle = useMemo(
    () => ({
      fillOpacity: 0,
      animation: `${animId}-fill ${fillDuration}ms ease-out ${fillDelay}ms forwards`,
    }),
    [animId, fillDuration, fillDelay],
  );

  if (!isWeb) {
    return (
      <View style={styles.fallbackWrap}>
        <Text style={fallbackTextStyle}>{text}</Text>
      </View>
    );
  }

  return (
    <View
      // tick + replayKey rebuild the DOM so CSS animations restart cleanly.
      key={`${tick}-${replayKey ?? "static"}`}
      style={wrapStyle}
      accessibilityLabel={text}
      accessibilityRole="image"
    >
      <style dangerouslySetInnerHTML={keyframeMarkup} />
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={svgRootStyle}
      >
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily={fontFamily}
          fontWeight="600"
          fontSize={fontSize}
          letterSpacing="-1"
          stroke={resolvedColor}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={strokeAnimStyle}
        >
          {text}
        </text>
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily={fontFamily}
          fontWeight="600"
          fontSize={fontSize}
          letterSpacing="-1"
          fill={resolvedColor}
          style={fillAnimStyle}
        >
          {text}
        </text>
      </svg>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  fallbackWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[4],
  },
  fallbackText: {
    fontFamily: theme.fontFamily.rounded,
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: -1,
  },
}));
