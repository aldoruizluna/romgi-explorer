#!/usr/bin/env python3
"""
icons.py - draw the app icons (the pixel-art die of the logo) as PNG files, with no image library.

  python3 icons.py site/icons

The logo is a 16 x 16 grid (see web/index.html). Each icon places it on a larger square, so the die keeps hard edges at every size:
  icon-192.png, icon-512.png   the install icon: a rounded dark square with the die, transparent outside the corners
  maskable-512.png             full-bleed, with the die inside the 80% circle Android may crop to
  apple-touch-icon.png         full-bleed, 180 px: iOS rounds the corners itself and paints transparency black
"""
from __future__ import annotations

import math
import struct
import sys
import zlib
from pathlib import Path

BACKGROUND = (12, 15, 21)       # --bg of the dark theme
ACCENT = (57, 135, 229)         # --accent


def die(x: int, y: int) -> bool:
    """Is the logo's cell (x, y) inked? An outlined square with stepped corners, and five 2 x 2 dots inside it."""
    if not (0 <= x < 16 and 0 <= y < 16):
        return False
    outer = {1: (3, 13), 2: (2, 14), 13: (2, 14), 14: (3, 13)}.get(y, (1, 15) if 3 <= y <= 12 else (0, 0))
    hole = {3: (4, 12), 12: (4, 12)}.get(y, (3, 13) if 4 <= y <= 11 else (0, 0))
    if outer[0] <= x < outer[1] and not hole[0] <= x < hole[1]:
        return True
    return any(dx <= x < dx + 2 and dy <= y < dy + 2 for dx, dy in ((4, 4), (10, 4), (7, 7), (4, 10), (10, 10)))


def png(width: int, height: int, rows: list[bytes]) -> bytes:
    """An 8-bit RGBA PNG from rows of width * 4 bytes."""
    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + r for r in rows)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def render(size: int, margin: float, corner: float) -> bytes:
    """size px square. margin: how many logo cells of background on each side of the 16-cell die. corner: corner radius as a share of the
    size (0 for a full-bleed icon). Cells are sampled from the centre of each pixel, so a cell is never blurred, only sometimes one pixel wider."""
    cells = 16 + 2 * margin
    radius = corner * size
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            alpha = 255
            if radius:                       # a one-pixel soft edge on the rounded square
                dx = max(radius - (px + 0.5), (px + 0.5) - (size - radius), 0)
                dy = max(radius - (py + 0.5), (py + 0.5) - (size - radius), 0)
                alpha = round(255 * min(1.0, max(0.0, radius - (dx * dx + dy * dy) ** 0.5 + 0.5)))
            ink = die(math.floor((px + 0.5) / size * cells - margin), math.floor((py + 0.5) / size * cells - margin))
            r, g, b = ACCENT if ink else BACKGROUND
            row += bytes((r, g, b, alpha))
        rows.append(bytes(row))
    return png(size, size, rows)


ICONS = {
    "icon-192.png": (192, 4, 0.2),
    "icon-512.png": (512, 4, 0.2),
    "maskable-512.png": (512, 6.5, 0),
    "apple-touch-icon.png": (180, 4, 0),
}


def write(dest: str | Path) -> list[str]:
    out = Path(dest)
    out.mkdir(parents=True, exist_ok=True)
    for name, (size, margin, corner) in ICONS.items():
        (out / name).write_bytes(render(size, margin, corner))
    return sorted(ICONS)


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "site/icons"
    print(f"wrote {', '.join(write(target))} to {target}")
