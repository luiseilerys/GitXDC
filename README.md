# GitXDC

Clon descentralizado de GitHub como **mini-app webxdc** para [ArcaneChat](https://arcanechat.me/) / Delta Chat.

Un repositorio Git vive **dentro del chat** (IndexedDB). No hay servidor central: el estado se comparte por `webxdc` entre los participantes del mismo chat.

**Repo:** https://github.com/luiseilerys/GitXDC

---

## Características

| Área | Detalle |
|------|--------|
| **VCS local** | [isomorphic-git](https://isomorphic-git.org/) + [lightning-fs](https://github.com/isomorphic-git/lightning-fs) sobre IndexedDB |
| **Editor** | CodeMirror 6 (tema oscuro) o textarea de respaldo |
| **UI** | Tema oscuro estilo GitHub — pestañas **Código / Issues / PRs / Log** |
| **Archivos** | Crear (`+`), importar (`↑`), reiniciar repo (`↺`), guardar y commit |
| **Issues / PRs** | Colaborativos vía `webxdc.sendUpdate()` |
| **Sync P2P** | Canal realtime binario (packfiles fragmentados ≤120 KB) |
| **Refs** | CRDT con Yjs (`YJS_UPDATE`) |
| **Sin CDN** | Dependencias empaquetadas con esbuild en `vendor/` |

---

## Uso en el chat

1. Genera o descarga el archivo **`GitXDC.xdc`** (ver [Build](#build)).
2. Envíalo en un chat de ArcaneChat / Delta Chat.
3. Ábrelo desde el mensaje (se ejecuta como webxdc).

### Panel Código

| Control | Acción |
|---------|--------|
| **+** | Nuevo archivo (modal: ruta + contenido) |
| **↑** | Importar archivos del dispositivo |
| **↺** | Reiniciar el repo local (IndexedDB de este chat) |
| **Guardar** | Escribe el archivo abierto y lo añade al índice git |
| **Commit** | Commit con mensaje (modal) |
| **Sync** | Señal de sincronización / HEAD |
| **Export** | Comparte un resumen del tree por el chat |

- El nombre del repo se muestra en la cabecera como **`local/repo`**.
- Es **un repo por instancia webxdc** (por chat), no un listado de remotos tipo GitHub.com.

### Issues y PRs

Formularios en modal (no usan `prompt()`, que suele estar bloqueado en webxdc). Los cambios se propagan con `sendUpdate` a los demás participantes.

### Log

Mensajes de arranque, errores y operaciones. Si algo falla, el **status** de la cabecera y el Log indican la causa.

---

## Build

### Opción A — GitHub Actions (recomendado)

1. Ve a **Actions** → workflow **Build GitXDC.xdc**.
2. **Run workflow** (o haz push a `main` en archivos de la app).
3. Cuando termine, descarga el artifact **`GitXDC.xdc`**.

### Opción B — Local

```bash
git clone https://github.com/luiseilerys/GitXDC.git
cd GitXDC
chmod +x vendor.sh build.sh
./vendor.sh    # npm install + esbuild → vendor/*.js
./build.sh     # genera GitXDC.xdc en la raíz
```

**Requisitos locales:** Node.js 20+, npm, `zip`.

`vendor.sh` genera un `package.json` temporal (no hay lockfile en el repo a propósito). Los bundles quedan en `vendor/`:

- `isomorphic-git.js`
- `lightning-fs.js`
- `yjs.js`
- `codemirror.js`

---

## Estructura del proyecto

```
GitXDC/
├── manifest.toml              # nombre + source_code_url (webxdc)
├── index.html                 # shell UI + carga de scripts
├── style.css                  # tema oscuro
├── webxdc.js                  # polyfill solo para probar en navegador
├── editor.js                  # wrapper CodeMirror 6 (+ fallback textarea)
├── ui.js                      # modales (nuevo archivo, commit, issues, PRs…)
├── app.js                     # FS, git, tabs, API window.GitXDCApp
├── vendor.sh                  # vendoriza dependencias con esbuild
├── build.sh                   # empaqueta .xdc (zip)
├── vendor/                    # generado (no versionar en git si no quieres)
└── .github/workflows/
    └── build-xdc.yml          # CI → artifact GitXDC.xdc
```

Dentro del `.xdc` deben ir al menos: `manifest.toml`, `index.html`, `style.css`, `editor.js`, `ui.js`, `app.js` y `vendor/*.js`.

---

## Protocolo (referencia)

### Realtime (Uint8Array)

| Byte | Nombre | Uso |
|------|--------|-----|
| `0x01` | WANT | Solicitud de oids / have |
| `0x05` | PACK_META | Metadatos del pack |
| `0x06` | PACK_CHUNK | Fragmento ≤120 KB |
| `0x07` | PACK_END | Fin de pack |
| `0x08` | SYNC_DONE | Sync terminado |

### `sendUpdate` (payload JSON)

Tipos usados: `REF_UPDATE`, `YJS_UPDATE`, `SYNC_ACK`, `ISSUE_CREATE`, `ISSUE_COMMENT`, `PR_CREATE`, `PR_MERGE`, `PR_CLOSE`.

---

## Arranque y diagnóstico

El status de la cabecera avanza aproximadamente así:

`boot…` → `fs…` → `git…` → `editor…` → **`listo`**

| Status / Log | Qué implica |
|--------------|-------------|
| **listo** | App usable |
| **sin FS (vendor)** | Faltan bundles en `vendor/` dentro del `.xdc` |
| **Opcional ausente: git / LightningFS / …** | Vendor incompleto o scripts no cargaron |
| **initGit falló / timeout** | Git no inicializó; el tree puede seguir usable con FS |
| **ui.js no cargado** | No habrá modales en + / Commit / Issues |

**Importante:** tras cambios en el código, vuelve a generar el `.xdc` y ábrelo de nuevo en el chat (no reutilices un artifact viejo).

---

## Desarrollo en navegador

Si abres `index.html` fuera de webxdc, se carga el polyfill `webxdc.js` automáticamente. Necesitas haber ejecutado `./vendor.sh` antes para tener `vendor/*.js`.

---

## Licencia

MIT
