# GitXDC

Clon descentralizado de GitHub como mini-app webxdc para ArcaneChat / Delta Chat.

## Características

- **VCS local**: isomorphic-git + lightning-fs sobre IndexedDB
- **Sync P2P**: packfiles binarios fragmentados (≤120KB) vía `webxdc.joinRealtimeChannel()`
- **Protocolo binario** (Uint8Array):
  - `0x01` = WANT (oid + have)
  - `0x05` = PACK_META
  - `0x06` = PACK_CHUNK
  - `0x07` = PACK_END
  - `0x08` = SYNC_DONE
- **Señalización y persistencia**: `webxdc.sendUpdate()` con tipos REF_UPDATE, YJS_UPDATE, SYNC_ACK, ISSUE_CREATE/COMMENT, PR_CREATE/MERGE/CLOSE
- **Refs como CRDT**: Yjs
- **Empaquetado .xdc**: JS puro (CompressionStream + ZIP manual con crc32)
- **UI oscura estilo GitHub**: pestañas Código / Issues / PRs / Log
- **Sin red, sin servidores, sin CDN**: dependencias vendorizadas con esbuild

## Requisitos

- Node.js + npm (solo para vendor.sh y build.sh)
- Navegador moderno con CompressionStream y IndexedDB

## Desarrollo

```bash
# Instalar y vendorizar dependencias (versiones fijadas)
chmod +x vendor.sh build.sh
./vendor.sh

# Construir el .xdc
./build.sh
```

El archivo `GitXDC.xdc` se genera en la raíz.

## Estructura

```
GitXDC/
├── manifest.toml
├── index.html
├── style.css
├── webxdc.js          # polyfill para desarrollo
├── editor.js          # CodeMirror 6
├── app.js             # lógica principal
├── vendor/            # bundles generados por vendor.sh
├── vendor.sh
├── build.sh
└── README.md
```

## Licencia

MIT
