#!/usr/bin/env bash
# build.sh — Empaqueta GitXDC.xdc (ZIP con Deflate)

set -euo pipefail

OUT="GitXDC.xdc"
TMPDIR=$(mktemp -d)

echo "==> Copiando archivos al staging…"
cp manifest.toml index.html style.css webxdc.js editor.js app.js "$TMPDIR/"
mkdir -p "$TMPDIR/vendor"
cp vendor/*.js "$TMPDIR/vendor/" 2>/dev/null || {
  echo "ERROR: ejecuta primero ./vendor.sh"
  exit 1
}

echo "==> Creando $OUT…"
# ZIP con Deflate, sin directorios extra
(cd "$TMPDIR" && zip -9 -r - .) > "$OUT"

rm -rf "$TMPDIR"

echo "==> Generado: $OUT ($(du -h "$OUT" | cut -f1))"
