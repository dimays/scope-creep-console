#!/usr/bin/env python3
"""
Scope Creep — macOS app icon renderer (zero external deps).

Rasterizes directly into an RGBA buffer with analytic anti-aliasing
(signed-distance coverage) + supersampling, and encodes PNG via zlib.
Produces genuinely transparent corners (alpha 0 outside the squircle tile),
which qlmanage/SVG-on-white could not.

Motif: a solid "seed" rounded square at center, with concentric rounded-square
rings EXPANDING outward and fading as they go — the outermost ring runs off the
tile edge (clipped by the squircle) so the growth reads as continuing beyond the
frame. Scope grows to infinity; that's the point.

Usage: python3 render_icon.py <out_dir>
Writes PNGs named icon_<size>.png for each unique pixel size.
"""
import sys, os, math, zlib, struct

# ---- palette (indigo -> violet -> purple, deep and vivid) -------------------
# 3-stop diagonal gradient. sRGB 8-bit.
STOP0 = (0x37, 0x2C, 0xA8)   # deep indigo
STOP1 = (0x63, 0x2A, 0xD6)   # violet
STOP2 = (0xA9, 0x5A, 0xF0)   # bright purple
WHITE = (0xFF, 0xFF, 0xFF)

# tile geometry as fractions of canvas
TILE_FRAC   = 0.82           # tile width / canvas width
CORNER_FRAC = 0.45           # corner radius / tile_half  (~Apple squircle ratio)

# motif rings: (half_extent / tile_half, alpha)
SEED_H      = 0.145          # solid center square half-extent
RINGS = [
    (0.30, 0.98),
    (0.49, 0.80),
    (0.70, 0.60),
    (0.94, 0.40),            # outermost — bleeds toward/over the tile edge
]
STROKE_FRAC = 0.052          # ring stroke width / tile_half
RING_CORNER = 0.30           # ring corner radius / ring_half


def lerp(a, b, t):
    return a + (b - a) * t


def grad_color(t):
    """3-stop gradient, t in [0,1]."""
    if t < 0.5:
        u = t / 0.5
        return (lerp(STOP0[0], STOP1[0], u),
                lerp(STOP0[1], STOP1[1], u),
                lerp(STOP0[2], STOP1[2], u))
    u = (t - 0.5) / 0.5
    return (lerp(STOP1[0], STOP2[0], u),
            lerp(STOP1[1], STOP2[1], u),
            lerp(STOP1[2], STOP2[2], u))


def rbox_sdf(px, py, cx, cy, half, r):
    """Signed distance to a rounded square centered (cx,cy), half-extent `half`,
    corner radius `r`. Negative inside."""
    dx = abs(px - cx) - (half - r)
    dy = abs(py - cy) - (half - r)
    ax = dx if dx > 0.0 else 0.0
    ay = dy if dy > 0.0 else 0.0
    outside = math.sqrt(ax * ax + ay * ay) - r
    inside = min(max(dx, dy), 0.0)
    return outside + inside


def render(size, ss):
    """Render one square icon at `size` px using ss x ss supersampling.
    Returns bytes of premultiplied-free 8-bit RGBA, row-major, len size*size*4."""
    N = size * ss
    soft = 0.9                       # AA softness in subpixel units
    cx = cy = N / 2.0
    tile_half = 0.5 * N * TILE_FRAC
    tile_r = CORNER_FRAC * tile_half
    stroke = STROKE_FRAC * tile_half
    seed_half = SEED_H * tile_half
    seed_r = RING_CORNER * seed_half

    # precompute ring params in pixels
    rings = []
    for frac, alpha in RINGS:
        h = frac * tile_half
        rings.append((h, RING_CORNER * h, alpha))

    # gradient axis: diagonal top-left -> bottom-right across the tile bbox
    g0 = cx - tile_half + (cy - tile_half)          # min projection
    g1 = cx + tile_half + (cy + tile_half)          # max projection
    gspan = g1 - g0

    inv = 1.0 / (ss * ss)
    out = bytearray(size * size * 4)

    for Y in range(size):
        row_base = Y * size * 4
        for X in range(size):
            sr = sg = sb = sa = 0.0
            for jy in range(ss):
                py = Y * ss + jy + 0.5
                for jx in range(ss):
                    px = X * ss + jx + 0.5
                    # tile coverage (alpha)
                    td = rbox_sdf(px, py, cx, cy, tile_half, tile_r)
                    tcov = 0.5 - td / soft
                    if tcov <= 0.0:
                        continue
                    if tcov > 1.0:
                        tcov = 1.0
                    # base gradient color
                    t = ((px + py) - g0) / gspan
                    if t < 0.0: t = 0.0
                    elif t > 1.0: t = 1.0
                    br, bg, bb = grad_color(t)
                    # soft top highlight for depth (adds a little white near top)
                    hl = (1.0 - (py / N)) - 0.55
                    if hl > 0.0:
                        a = hl * 0.18
                        br = br + (255 - br) * a
                        bg = bg + (255 - bg) * a
                        bb = bb + (255 - bb) * a
                    # seed (solid center square)
                    sd = rbox_sdf(px, py, cx, cy, seed_half, seed_r)
                    scov = 0.5 - sd / soft
                    if scov > 0.0:
                        a = scov if scov < 1.0 else 1.0
                        br = br + (WHITE[0] - br) * a
                        bg = bg + (WHITE[1] - bg) * a
                        bb = bb + (WHITE[2] - bb) * a
                    # expanding rings
                    for (h, rc, ralpha) in rings:
                        d = abs(rbox_sdf(px, py, cx, cy, h, rc)) - stroke * 0.5
                        rcov = 0.5 - d / soft
                        if rcov > 0.0:
                            a = (rcov if rcov < 1.0 else 1.0) * ralpha
                            br = br + (WHITE[0] - br) * a
                            bg = bg + (WHITE[1] - bg) * a
                            bb = bb + (WHITE[2] - bb) * a
                    # accumulate premultiplied by tile alpha
                    sr += br * tcov
                    sg += bg * tcov
                    sb += bb * tcov
                    sa += tcov
            aavg = sa * inv
            o = row_base + X * 4
            if aavg <= 0.0:
                out[o] = out[o+1] = out[o+2] = out[o+3] = 0
            else:
                # un-premultiply
                r = sr / sa
                g = sg / sa
                b = sb / sa
                out[o]   = int(r + 0.5) if r < 255 else 255
                out[o+1] = int(g + 0.5) if g < 255 else 255
                out[o+2] = int(b + 0.5) if b < 255 else 255
                out[o+3] = int(aavg * 255 + 0.5) if aavg < 1.0 else 255
    return bytes(out)


def write_png(path, size, rgba):
    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))
    # raw scanlines with filter byte 0
    stride = size * 4
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        raw += rgba[y * stride:(y + 1) * stride]
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", ihdr)
           + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


def main():
    out_dir = sys.argv[1]
    os.makedirs(out_dir, exist_ok=True)
    # unique sizes -> supersample factor (bigger ss for small icons)
    plan = {16: 8, 32: 8, 64: 6, 128: 4, 256: 4, 512: 3, 1024: 2}
    for size, ss in plan.items():
        rgba = render(size, ss)
        p = os.path.join(out_dir, "icon_%d.png" % size)
        write_png(p, size, rgba)
        print("wrote", p, flush=True)


if __name__ == "__main__":
    main()
