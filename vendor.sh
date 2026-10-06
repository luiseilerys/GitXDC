#!/usr/bin/env bash
# vendor.sh — Descarga y empaqueta dependencias con esbuild (versiones fijadas)
# Sin CDN en runtime. Todo queda en vendor/
# Polyfills de builtins de Node para isomorphic-git en el navegador.

set -euo pipefail

VENDOR_DIR="vendor"
mkdir -p "$VENDOR_DIR"

echo "==> Instalando dependencias temporales…"
cat > package.json << 'EOF'
{
  "name": "gitxdc-vendor",
  "private": true,
  "type": "module",
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
    "esbuild": "0.23.0",
    "esbuild-plugin-polyfill-node": "0.3.0",
    "buffer": "6.0.3",
    "path-browserify": "1.0.1",
    "events": "3.3.0",
    "stream-browserify": "3.0.0",
    "process": "0.11.10",
    "util": "0.12.5"
  }
}
EOF

npm install --silent

echo "==> Creando script de build esbuild con polyfills…"
cat > /tmp/vendor-build.mjs << 'BUILDEOF'
import * as esbuild from "esbuild";
import { polyfillNode } from "esbuild-plugin-polyfill-node";
import { writeFileSync } from "fs";

const common = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  logLevel: "info",
};

// isomorphic-git necesita polyfills de Node (buffer, path, stream, process…)
await esbuild.build({
  ...common,
  entryPoints: ["node_modules/isomorphic-git/index.js"],
  outfile: "vendor/isomorphic-git.js",
  globalName: "git",
  plugins: [
    polyfillNode({
      globals: {
        process: true,
        Buffer: true,
      },
    }),
  ],
  define: {
    global: "globalThis",
  },
});

// lightning-fs
await esbuild.build({
  ...common,
  entryPoints: ["node_modules/@isomorphic-git/lightning-fs/src/index.js"],
  outfile: "vendor/lightning-fs.js",
  globalName: "LightningFS",
  plugins: [
    polyfillNode({
      globals: { process: true, Buffer: true },
    }),
  ],
  define: { global: "globalThis" },
});

// yjs (sin polyfills Node)
await esbuild.build({
  ...common,
  entryPoints: ["node_modules/yjs/src/index.js"],
  outfile: "vendor/yjs.js",
  globalName: "Y",
});

// CodeMirror 6 + lenguajes + tema
writeFileSync(
  "/tmp/cm-entry.js",
  `
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
`
);

await esbuild.build({
  ...common,
  entryPoints: ["/tmp/cm-entry.js"],
  outfile: "vendor/codemirror.js",
});

console.log("Bundles generados correctamente.");
BUILDEOF

echo "==> Ejecutando esbuild…"
node /tmp/vendor-build.mjs

echo "==> Limpiando…"
rm -rf node_modules package.json package-lock.json /tmp/cm-entry.js /tmp/vendor-build.mjs

echo "==> Listo. Bundles en $VENDOR_DIR/:"
ls -lh "$VENDOR_DIR/"
