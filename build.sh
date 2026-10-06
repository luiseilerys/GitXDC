#!/usr/bin/env bash
# build.sh — Empaqueta GitXDC.xdc (ZIP con Deflate)

set -euo pipefail

OUT="GitXDC.xdc"
TMPDIR=$(mktemp -d)

echo "==> Copiando archivos al staging…"
cp manifest.toml index.html style.css webxdc.js editor.js ui.js "$TMPDIR/"

# Prefer base64 loader + chunks
if ls app-b64-*.txt >/dev/null 2>&1; then
  echo "==> Usando app.js (loader) + app-b64-*.txt"
  cp app.js "$TMPDIR/"
  cp app-b64-*.txt "$TMPDIR/"
elif [[ -f app-part1.js && -f app-part2.js ]]; then
  echo "==> Ensamblando app.js desde partes…"
  cat app-part1.js app-part2.js > "$TMPDIR/app.js"
elif [[ -f app.js ]]; then
  cp app.js "$TMPDIR/"
else
  echo "ERROR: falta app"
  exit 1
fi

mkdir -p "$TMPDIR/vendor"
cp vendor/*.js "$TMPDIR/vendor/" 2>/dev/null || {
  echo "ERROR: ejecuta primero ./vendor.sh"
  exit 1
}

echo "==> Creando $OUT…"
(cd "$TMPDIR" && zip -9 -r - .) > "$OUT"
rm -rf "$TMPDIR"
echo "==> Generado: $OUT ($(du -h "$OUT" | cut -f1))"
