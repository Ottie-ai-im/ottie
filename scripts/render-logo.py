#!/usr/bin/env python3
"""Render the Ottie logo at all the sizes the repo ships.

Logo: a hollow circle with three dots in a horizontal row inside, one of
which can be tinted to an accent colour to express state (running, idle,
attention).

Run:
    python3 scripts/render-logo.py
"""

from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parents[1]
APP_ASSETS = REPO / "packages/app/assets/images"
DESKTOP_ICONS = REPO / "packages/desktop/src-tauri/icons"
WEBSITE_PUBLIC = REPO / "packages/website/public"

# Logo geometry. All values are fractions of the canvas's shorter side so
# the same numbers work at every output size.
RING_RADIUS_FRAC = 0.42       # outer radius of the ring
RING_STROKE_FRAC = 0.07       # ring thickness
DOT_RADIUS_FRAC = 0.075       # each filled dot
DOT_GAP_FRAC = 0.18           # horizontal distance between dots' centres


def _tuple(rgba: tuple[int, int, int] | tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    if len(rgba) == 3:
        return (*rgba, 255)
    return rgba  # type: ignore[return-value]


def render_logo(
    size: int,
    fg: tuple[int, int, int],
    accent: tuple[int, int, int] | None = None,
    accent_dot_index: int = 1,
    bg: tuple[int, int, int, int] | None = None,
) -> Image.Image:
    """Return an RGBA Image with the Ottie logo centred on a square canvas."""
    canvas_bg = bg if bg is not None else (0, 0, 0, 0)
    img = Image.new("RGBA", (size, size), canvas_bg)

    # Draw at 4× then downscale for smoother edges than 1× anti-alias.
    scale = 4
    big = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)

    cx = cy = (size * scale) // 2
    r_outer = int(RING_RADIUS_FRAC * size * scale)
    stroke = max(2, int(RING_STROKE_FRAC * size * scale))

    fg_rgba = _tuple(fg)

    # Hollow circle = outer disk minus inner disk.
    d.ellipse((cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer), fill=fg_rgba)
    inner_r = r_outer - stroke
    d.ellipse(
        (cx - inner_r, cy - inner_r, cx + inner_r, cy + inner_r),
        fill=(0, 0, 0, 0),
    )

    # Three dots in a row.
    dot_r = int(DOT_RADIUS_FRAC * size * scale)
    gap = int(DOT_GAP_FRAC * size * scale)
    centres = [(cx - gap, cy), (cx, cy), (cx + gap, cy)]
    for i, (dx, dy) in enumerate(centres):
        colour = _tuple(accent) if accent is not None and i == accent_dot_index else fg_rgba
        d.ellipse((dx - dot_r, dy - dot_r, dx + dot_r, dy + dot_r), fill=colour)

    return big.resize((size, size), Image.LANCZOS)


# ---- colour palette ----
BLACK = (10, 10, 10)
WHITE = (245, 245, 245)
GREEN = (38, 175, 110)         # for "running"
AMBER = (240, 165, 50)         # for "attention"


def write(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG")
    print(f"  wrote {path.relative_to(REPO)}  {img.size}")


def render_set() -> None:
    # ---- packages/app/assets/images ----
    write(render_logo(48, BLACK), APP_ASSETS / "favicon.png")
    write(render_logo(48, BLACK), APP_ASSETS / "favicon-light.png")
    write(render_logo(48, WHITE), APP_ASSETS / "favicon-dark.png")
    write(
        render_logo(48, BLACK, accent=AMBER, accent_dot_index=1),
        APP_ASSETS / "favicon-light-attention.png",
    )
    write(
        render_logo(48, WHITE, accent=AMBER, accent_dot_index=1),
        APP_ASSETS / "favicon-dark-attention.png",
    )
    write(
        render_logo(48, BLACK, accent=GREEN, accent_dot_index=1),
        APP_ASSETS / "favicon-light-running.png",
    )
    write(
        render_logo(48, WHITE, accent=GREEN, accent_dot_index=1),
        APP_ASSETS / "favicon-dark-running.png",
    )
    write(render_logo(1024, BLACK), APP_ASSETS / "icon.png")
    write(render_logo(96, BLACK), APP_ASSETS / "notification-icon.png")
    write(render_logo(200, BLACK), APP_ASSETS / "splash-icon.png")

    # ---- packages/desktop/src-tauri/icons ----
    # Tauri reads at least 32×32 for the build context. Render at 512 for
    # higher-density displays; Tauri also accepts larger.
    write(render_logo(512, BLACK), DESKTOP_ICONS / "icon.png")

    # ---- packages/website/public ----
    write_svg(WEBSITE_PUBLIC / "favicon.svg")


def write_svg(path: Path) -> None:
    """Hand-write an SVG for crisp scaling on the marketing site."""
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n'
        '  <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" stroke-width="7"/>\n'
        '  <circle cx="32" cy="50" r="7.5" fill="currentColor"/>\n'
        '  <circle cx="50" cy="50" r="7.5" fill="currentColor"/>\n'
        '  <circle cx="68" cy="50" r="7.5" fill="currentColor"/>\n'
        '</svg>\n'
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(svg)
    print(f"  wrote {path.relative_to(REPO)}  (svg)")


if __name__ == "__main__":
    print(f"rendering Ottie logo set under {REPO}")
    render_set()
    print("done")
