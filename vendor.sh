#!/usr/bin/env bash
# vendor.sh — Descarga y empaqueta dependencias con esbuild (versiones fijadas)
# Sin CDN en runtime. Todo queda en vendor/

set -euo pipefail

VENDOR_DIR="vendor"
mkdir -p "$VENDOR_DIR"

echo "==> Instalando dependencias temporales…"
# Usamos un package.json temporal con versiones exactas
cat > package.json << 'EOF'
{
  "name": "gitxdc-vendor",
  "private": true,
  "dependencies": {
    "isomorphic-git": "1.27.1",
    "@isomorphic-git/lightning-fs": "4.6.0",
    "yjs": "13.6.18",
    "codemirror": "6.0.1",
    "@codemirror/lang-javascript": "6.2.2",
    "@codemirror/lang-markdown": "6.2.5",
    "@codemirror/lang-json": "6.0.1",
    "@codemirror/lang-html": "6.4.9",
    "@codemirror/lang-css": "6.2.1",
    "@codemirror/theme-one-dark": "6.1.2",
    "@codemirror/view": "6.28.0",
    "@codemirror/state": "6.4.1",
    "esbuild": "0.23.0"
  }
}
EOF

npm install --silent

echo "==> Bundling isomorphic-git…"
npx esbuild node_modules/isomorphic-git/index.js \
  --bundle \
  --format=iife \
  --global-name=git \
  --outfile="$VENDOR_DIR/isomorphic-git.js" \
  --platform=browser \
  --target=es2020

echo "==> Bundling lightning-fs…"
npx esbuild node_modules/@isomorphic-git/lightning-fs/src/index.js \
  --bundle \
  --format=iife \
  --global-name=LightningFS \
  --outfile="$VENDOR_DIR/lightning-fs.js" \
  --platform=browser \
  --target=es2020

echo "==> Bundling yjs…"
npx esbuild node_modules/yjs/src/index.js \
  --bundle \
  --format=iife \
  --global-name=Y \
  --outfile="$VENDOR_DIR/yjs.js" \
  --platform=browser \
  --target=es2020

echo "==> Bundling CodeMirror 6 + lenguajes + tema…"
# Punto de entrada temporal que re-exporta lo necesario
cat > /tmp/cm-entry.js << 'CMEOF'
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";

window.CodeMirrorBundle = {
  EditorView,
  EditorState,
  basicSetup,
  oneDark,
  javascript,
  markdown,
  json,
  html,
  css
};
CMEOF

npx esbuild /tmp/cm-entry.js \
  --bundle \
  --format=iife \
  --outfile="$VENDOR_DIR/codemirror.js" \
  --platform=browser \
  --target=es2020

echo "==> Limpiando…"
rm -rf node_modules package.json package-lock.json /tmp/cm-entry.js

echo "==> Listo. Bundles en $VENDOR_DIR/:"
ls -lh "$VENDOR_DIR/"
