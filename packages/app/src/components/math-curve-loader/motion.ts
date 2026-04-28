// Shared per-frame math for all parametric curve loaders.
//
// The renderers (web/native) call these helpers to avoid duplicating the
// breathing / rotation / particle-trail logic across platforms. They take a
// curve preset (see ./curves) and a wall-clock timestamp.

import type { CurvePreset, Point } from "./curves";

export interface ParticleFrame {
  x: number;
  y: number;
  radius: number;
  opacity: number;
}

export function normalizeProgress(progress: number): number {
  return ((progress % 1) + 1) % 1;
}

// Breathing factor 0.52..1.0 — feeds into config.point() so each preset can
// modulate its own radius/petal/etc. amplitude.
export function getDetailScale(time: number, pulseDurationMs: number): number {
  const pulseProgress = (time % pulseDurationMs) / pulseDurationMs;
  const pulseAngle = pulseProgress * Math.PI * 2;
  return 0.52 + ((Math.sin(pulseAngle + 0.55) + 1) / 2) * 0.48;
}

export function getRotationDegrees(
  time: number,
  rotate: boolean,
  rotationDurationMs: number,
): number {
  if (!rotate) return 0;
  return -((time % rotationDurationMs) / rotationDurationMs) * 360;
}

// Build the SVG path "d" attribute for the curve at the current breath.
// `steps` controls smoothness — 240 is enough for hand visual; web demo
// uses 480 but native can afford to drop a bit.
export function buildPathD(preset: CurvePreset, detailScale: number, steps = 240): string {
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const point = preset.point(i / steps, detailScale);
    d +=
      i === 0
        ? `M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
        : ` L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }
  return d;
}

// Compute one particle's position + opacity / radius along the trail.
// `index` is 0..particleCount-1 (head → tail), `progress` is 0..1.
export function computeParticle(
  preset: CurvePreset,
  index: number,
  particleCount: number,
  progress: number,
  detailScale: number,
  trailSpan: number,
): ParticleFrame {
  const denom = Math.max(1, particleCount - 1);
  const tailOffset = index / denom;
  const point: Point = preset.point(
    normalizeProgress(progress - tailOffset * trailSpan),
    detailScale,
  );
  const fade = Math.pow(1 - tailOffset, 0.56);
  return {
    x: point.x,
    y: point.y,
    radius: 0.9 + fade * 2.7,
    opacity: 0.04 + fade * 0.96,
  };
}
