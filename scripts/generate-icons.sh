#!/usr/bin/env bash
set -euo pipefail
mkdir -p public/icon
for size in 16 32 48 128; do
  magick -background none assets/icon-source.svg -resize "${size}x${size}" "public/icon/${size}.png"
done
