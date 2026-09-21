# Scope Creep — app icon source

Reproducible source for the macOS launcher icon at
`/Users/davidmays/Applications/Scope Creep.app/Contents/Resources/icon.icns`.

## Why a Python rasterizer (not SVG)
`qlmanage` composites SVG on an opaque WHITE background, which is what produced the
rejected "white corners" placeholder. This renderer writes RGBA pixels directly
(analytic SDF anti-aliasing + supersampling) and encodes PNG via `zlib`, so the
corners outside the rounded-squircle tile are genuinely alpha 0. Uses only macOS
built-ins: `python3`, `sips`, `iconutil`. No ImageMagick / rsvg / PIL / cairosvg.

## Design
Deep indigo -> violet -> purple diagonal gradient on a rounded squircle tile
(~Apple corner ratio, transparent corners). A solid white "seed" square at center
with concentric rounded-square rings rippling OUTWARD and fading as they grow — the
motif of scope expanding without bound. Soft top highlight for depth.

## Build
    ./build.sh                 # -> out/icon.icns  (+ out/png, out/ScopeCreep.iconset)
Install + re-register commands are in the footer of build.sh.

## Files
- render_icon.py — the rasterizer (all tunables at top: palette, TILE_FRAC, RINGS…)
- build.sh       — render -> iconset -> icns
