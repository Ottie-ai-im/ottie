import { useEffect, useId, useMemo, useRef } from "react";
import { CURVE_PRESETS } from "./curves";
import { buildPathD, computeParticle, getDetailScale, getRotationDegrees } from "./motion";
import type { MathCurveLoaderProps } from "./types";

const SVG_OVERFLOW_STYLE = { overflow: "visible" } as const;

export function MathCurveLoaderRenderer({
  curve,
  size,
  color,
  reduceMotion = false,
  ariaLabel,
  brandContext: _brandContext,
}: MathCurveLoaderProps) {
  const preset = CURVE_PRESETS[curve];
  const groupRef = useRef<SVGGElement | null>(null);
  const pathRef = useRef<SVGPathElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Stable id per mount so we don't collide with other loaders.
  const idPrefix = useId().replace(/[:#]/g, "");

  const containerStyle = useMemo(
    () => ({
      width: size,
      height: size,
      color,
      display: "inline-block",
      lineHeight: 0,
    }),
    [size, color],
  );

  useEffect(() => {
    if (reduceMotion) return;
    const group = groupRef.current;
    const path = pathRef.current;
    if (!group || !path) return;

    let raf = 0;
    const startedAt = performance.now();
    const frame = (now: number) => {
      const time = now - startedAt;
      const progress = (time % preset.durationMs) / preset.durationMs;
      const detailScale = getDetailScale(time, preset.pulseDurationMs);

      group.setAttribute(
        "transform",
        `rotate(${getRotationDegrees(time, preset.rotate, preset.rotationDurationMs)} 50 50)`,
      );
      path.setAttribute("d", buildPathD(preset, detailScale));

      const circles = group.querySelectorAll<SVGCircleElement>("circle[data-particle='1']");
      const count = circles.length;
      circles.forEach((node, index) => {
        const p = computeParticle(preset, index, count, progress, detailScale, preset.trailSpan);
        node.setAttribute("cx", p.x.toFixed(2));
        node.setAttribute("cy", p.y.toFixed(2));
        node.setAttribute("r", p.radius.toFixed(2));
        node.setAttribute("opacity", p.opacity.toFixed(3));
      });

      raf = window.requestAnimationFrame(frame);
    };
    raf = window.requestAnimationFrame(frame);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [preset, reduceMotion]);

  // Pre-create stable particle keys; nodes are mutated by attribute each frame.
  const particles = useMemo(
    () => Array.from({ length: preset.particleCount }, (_, i) => `p-${i}`),
    [preset.particleCount],
  );

  return (
    <div ref={containerRef} style={containerStyle}>
      <svg
        viewBox="0 0 100 100"
        fill="none"
        width={size}
        height={size}
        style={SVG_OVERFLOW_STYLE}
        aria-label={ariaLabel}
        role={ariaLabel ? "img" : undefined}
      >
        <g ref={groupRef}>
          <path
            ref={pathRef}
            id={`${idPrefix}-path`}
            stroke="currentColor"
            strokeWidth={preset.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={reduceMotion ? 0.6 : 0.1}
            d={reduceMotion ? buildPathD(preset, 0.76) : undefined}
          />
          {!reduceMotion &&
            particles.map((key) => (
              <circle key={key} data-particle="1" fill="currentColor" cx="50" cy="50" r="0" />
            ))}
        </g>
      </svg>
    </div>
  );
}
