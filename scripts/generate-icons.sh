#!/usr/bin/env bash
set -euo pipefail
mkdir -p public/icon
for size in 16 32 48 128; do
  rsvg-convert -w "$size" -h "$size" assets/icon-source.svg -o "public/icon/${size}.png"
done
