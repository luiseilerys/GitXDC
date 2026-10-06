#!/usr/bin/env bash
# build.sh — Empaqueta GitXDC.xdc (ZIP con Deflate)

set -euo pipefail

OUT="GitXDC.xdc"
TMPDIR=$(mktemp -d)

# Ensamblar app.js desde partes
if [[ -f app-part1.js && -f app-part2.js ]]; then
  echo "==> Ensamblando app.js desde app-part1.js + app-part2.js…"
  cat app-part1.js app-part2.js > app.js
fi

if [[ ! -f app.js ]]; then
  echo "ERROR: falta app.js (o app-part1.js + app-part2.js)"
  exit 1
fi

echo "==> Copiando archivos al staging…"
cp manifest.toml index.html style.css webxdc.js editor.js ui.js app.js "$TMPDIR/"
mkdir -p "$TMPDIR/vendor"
cp vendor/*.js "$TMPDIR/vendor/" 2>/dev/null || {
  echo "ERROR: ejecuta primero ./vendor.sh"
  exit 1
}

echo "==> Creando $OUT…"
(cd "$TMPDIR" && zip -9 -r - .) > "$OUT"

rm -rf "$TMPDIR"

echo "==> Generado: $OUT ($(du -h "$OUT" | cut -f1))"
