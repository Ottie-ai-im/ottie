import { useCallback, useEffect, useMemo, useRef } from "react";
import { View } from "react-native";
import Svg, { Circle, G, Path } from "react-native-svg";
import { CURVE_PRESETS, NATIVE_PATH_STEPS, getNativeParticleCount } from "./curves";
import { buildPathD, computeParticle, getDetailScale, getRotationDegrees } from "./motion";
import type { MathCurveLoaderProps } from "./types";

// Native ticks at ~30fps to leave the JS thread free for gestures (the
// sidebar pan, touch input, etc.). The visual difference vs 60fps is small
// because the curve breathes slowly anyway.
const NATIVE_FRAME_INTERVAL_MS = 33;

export function MathCurveLoaderRenderer({
  curve,
  size,
  color,
  reduceMotion = false,
  ariaLabel,
  brandContext: _brandContext,
}: MathCurveLoaderProps) {
  const preset = CURVE_PRESETS[curve];
  const particleCount = getNativeParticleCount(preset);

  // Refs for imperative updates. We bypass React reconciliation in the
  // animation loop — setNativeProps mutates the rendered SVG directly,
  // avoiding 60 re-renders / second of the entire particle list. The exact
  // typed Ref shape is private to react-native-svg, so we treat them as
  // opaque setNativeProps holders via callback refs (which dodge TS's
  // strict ref-compat checks on the JSX side).
  interface SetNativeProps {
    setNativeProps?: (props: Record<string, unknown>) => void;
  }
  const groupRef = useRef<SetNativeProps | null>(null);
  const pathRef = useRef<SetNativeProps | null>(null);
  const circleRefs = useRef<Array<SetNativeProps | null>>([]);
  const setGroupRef = useCallback((node: SetNativeProps | null) => {
    groupRef.current = node;
  }, []);
  const setPathRef = useCallback((node: SetNativeProps | null) => {
    pathRef.current = node;
  }, []);

  // Stable keys per particle slot so React doesn't reuse keys by index.
  const particleKeys = useMemo(
    () => Array.from({ length: particleCount }, (_, i) => `p-${i}`),
    [particleCount],
  );

  useEffect(() => {
    if (reduceMotion) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    const tick = () => {
      if (cancelled) return;

      const time = Date.now() - startedAt;
      const progress = (time % preset.durationMs) / preset.durationMs;
      const detailScale = getDetailScale(time, preset.pulseDurationMs);

      // react-native-svg's <G> takes `rotation` as a number prop. setNativeProps
      // is the cheapest way to update it without re-rendering children.
      const rotation = getRotationDegrees(time, preset.rotate, preset.rotationDurationMs);
      groupRef.current?.setNativeProps?.({ rotation });
      pathRef.current?.setNativeProps?.({
        d: buildPathD(preset, detailScale, NATIVE_PATH_STEPS),
      });

      for (let i = 0; i < particleCount; i++) {
        const node = circleRefs.current[i];
        if (!node) continue;
        const p = computeParticle(
          preset,
          i,
          particleCount,
          progress,
          detailScale,
          preset.trailSpan,
        );
        node.setNativeProps?.({
          cx: p.x,
          cy: p.y,
          r: p.radius,
          opacity: p.opacity,
        });
      }

      timer = setTimeout(tick, NATIVE_FRAME_INTERVAL_MS);
    };
    timer = setTimeout(tick, NATIVE_FRAME_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer != null) clearTimeout(timer);
    };
  }, [particleCount, preset, reduceMotion]);

  const containerStyle = useMemo(() => ({ width: size, height: size }), [size]);

  // Static initial path so the loader has something to show on first paint
  // before the first tick lands. detailScale 0.76 ≈ middle of the breath.
  const initialD = useMemo(() => buildPathD(preset, 0.76, NATIVE_PATH_STEPS), [preset]);

  // Pre-bound ref setters per particle slot. Stable across renders so React
  // never rebinds the refs and the react-perf linter is happy.
  const refSetters = useMemo<Array<(node: SetNativeProps | null) => void>>(
    () =>
      Array.from({ length: particleCount }, (_, i) => (node: SetNativeProps | null) => {
        circleRefs.current[i] = node;
      }),
    [particleCount],
  );

  return (
    <View
      style={containerStyle}
      accessible={!!ariaLabel}
      accessibilityLabel={ariaLabel}
      accessibilityRole={ariaLabel ? "image" : undefined}
    >
      <Svg viewBox="0 0 100 100" width={size} height={size}>
        <G ref={setGroupRef} origin="50, 50" rotation={0}>
          <Path
            ref={setPathRef}
            d={initialD}
            stroke={color}
            strokeWidth={preset.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={reduceMotion ? 0.6 : 0.1}
            fill="none"
          />
          {!reduceMotion &&
            particleKeys.map((key, i) => (
              <Circle
                key={key}
                ref={refSetters[i]}
                cx={50}
                cy={50}
                r={0}
                fill={color}
                opacity={0}
              />
            ))}
        </G>
      </Svg>
    </View>
  );
}
