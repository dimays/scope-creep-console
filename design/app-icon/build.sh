#!/bin/bash
# Reproducibly build and (optionally) install the Scope Creep app icon.
# Deps: python3, sips, iconutil (macOS built-ins only). No ImageMagick/PIL/cairo.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HERE/out}"
PNG="$OUT/png"
IS="$OUT/ScopeCreep.iconset"
rm -rf "$OUT"; mkdir -p "$PNG" "$IS"

python3 "$HERE/render_icon.py" "$PNG"

cp "$PNG/icon_16.png"   "$IS/icon_16x16.png"
cp "$PNG/icon_32.png"   "$IS/icon_16x16@2x.png"
cp "$PNG/icon_32.png"   "$IS/icon_32x32.png"
cp "$PNG/icon_64.png"   "$IS/icon_32x32@2x.png"
cp "$PNG/icon_128.png"  "$IS/icon_128x128.png"
cp "$PNG/icon_256.png"  "$IS/icon_128x128@2x.png"
cp "$PNG/icon_256.png"  "$IS/icon_256x256.png"
cp "$PNG/icon_512.png"  "$IS/icon_256x256@2x.png"
cp "$PNG/icon_512.png"  "$IS/icon_512x512.png"
cp "$PNG/icon_1024.png" "$IS/icon_512x512@2x.png"

iconutil -c icns "$IS" -o "$OUT/icon.icns"
echo "Built $OUT/icon.icns"

# Install with:  ./build.sh && cp out/icon.icns "/Users/davidmays/Applications/Scope Creep.app/Contents/Resources/icon.icns"
# Then re-register:
#   /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "/Users/davidmays/Applications/Scope Creep.app"
