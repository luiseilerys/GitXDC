#!/usr/bin/env bash
set -euo pipefail
OUT="GitXDC.xdc"
TMPDIR=$(mktemp -d)
echo "==> Staging…"
cp manifest.toml index.html style.css style-extra.css webxdc.js editor.js ui.js app.js "$TMPDIR/"
cp app-b64-*.txt "$TMPDIR/" 2>/dev/null || true
mkdir -p "$TMPDIR/vendor"
cp vendor/*.js "$TMPDIR/vendor/" 2>/dev/null || { echo "ERROR: run ./vendor.sh first"; exit 1; }
echo "==> Zipping $OUT…"
(cd "$TMPDIR" && zip -9 -r - .) > "$OUT"
rm -rf "$TMPDIR"
echo "==> Done: $OUT ($(du -h "$OUT" | cut -f1))"
