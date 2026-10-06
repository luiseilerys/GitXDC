/**
 * app.js — Lógica principal de GitXDC
 * Clon descentralizado de GitHub como mini-app webxdc.
 * Comentarios en español. Código completo.
 */

(function () {
  "use strict";

  // Globals de los bundles IIFE (esbuild --global-name)
  // En strict mode no se resuelven como variables sueltas.
  function resolveExport(mod) {
    if (!mod) return null;
    if (typeof mod === "function") return mod;
    if (mod.default && (typeof mod.default === "function" || typeof mod.default === "object")) {
      return mod.default;
    }
    return mod;
  }
  const git = resolveExport(window.git);
  const Y = resolveExport(window.Y);
  const LightningFS = resolveExport(window.LightningFS || window.lightningFS);

  // ── Constantes del protocolo binario P2P ──
  const MSG_WANT = 0x01;
  const MSG_PACK_META = 0x05;
  const MSG_PACK_CHUNK = 0x06;
  const MSG_PACK_END = 0x07;
  const MSG_SYNC_DONE = 0x08;
  const CHUNK_SIZE = 120 * 1024; // ≤120KB

  // ── Estado global ──
  let fs = null;
  let pfs = null; // promesa-based FS
  let dir = "/repo";
  let currentBranch = "main";
  let currentFile = null;
  let dirty = false;
  let issues = [];
  let prs = [];
  let ydoc = null;
  let yrefs = null;
  let realtime = null;
  let myAddr = "";
  let myName = "";
  let packReceiving = null; // { id, total, chunks: [], received }

  // ── Logging ──
  const logEl = () => document.getElementById("log-container");

  function log(msg, level = "info") {
    const el = logEl();
    if (!el) return;
    const t = new Date().toLocaleTimeString();
    const entry = document.createElement("div");
    entry.className = "log-entry";
    entry.innerHTML = `<span class="time">${t}</span><span class="level-${level}">[${level}]</span> ${escapeHtml(msg)}`;
    el.appendChild(entry);
    el.scrollTop = el.scrollHeight;
    console.log(`[GitXDC ${level}]`, msg);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setStatus(text, online = false) {
    const el = document.getElementById("status");
    if (el) {
      el.textContent = text;
      el.className = "status" + (online ? " online" : "");
    }
  }

  // ── Inicialización de FS y git ──
  async function initFS() {
    fs = new LightningFS("gitxdc-fs");
    pfs = fs.promises;
    try {
      await pfs.mkdir(dir);
    } catch (e) {
      // ya existe
    }
    log("LightningFS inicializado sobre IndexedDB");
  }

  async function initGit() {
    try {
      const files = await pfs.readdir(dir + "/.git");
      if (files && files.length) {
        log("Repositorio existente detectado");
        await refreshTree();
        return;
      }
    } catch (_) {}

    await git.init({ fs, dir, defaultBranch: "main" });
    await pfs.writeFile(dir + "/README.md", "# GitXDC Repo\n\nRepositorio local descentralizado.\n");
    await git.add({ fs, dir, filepath: "README.md" });
    const sha = await git.commit({
      fs,
      dir,
      message: "Commit inicial",
      author: { name: myName || "GitXDC", email: myAddr || "gitxdc@local" }
    });
    log("Repo inicializado, commit " + sha.slice(0, 7));
    document.getElementById("repo-name").textContent = "local/repo";
    await refreshTree();
  }

  function initYjs() {
    ydoc = new Y.Doc();
    yrefs = ydoc.getMap("refs");
    yrefs.observe(() => {
      const state = Y.encodeStateAsUpdate(ydoc);
      const b64 = uint8ToBase64(state);
      sendAppUpdate({ type: "YJS_UPDATE", data: b64 }, "Refs actualizadas (Yjs)");
    });
    log("Yjs CRDT para refs inicializado");
  }

  function uint8ToBase64(u8) {
    let s = "";
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s);
  }

  function base64ToUint8(b64) {
    const s = atob(b64);
    const u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
  }

  function writeUint32(view, offset, val) {
    view.setUint32(offset, val, false);
  }

  function readUint32(view, offset) {
    return view.getUint32(offset, false);
  }

  function buildWant(oids, have) {
    const n = oids.length;
    const h = have.length;
    const buf = new Uint8Array(1 + 4 + n * 20 + 4 + h * 20);
    const view = new DataView(buf.buffer);
    buf[0] = MSG_WANT;
    writeUint32(view, 1, n);
    let off = 5;
    for (const oid of oids) {
      buf.set(hexToBytes(oid), off);
      off += 20;
    }
    writeUint32(view, off, h);
    off += 4;
    for (const oid of have) {
      buf.set(hexToBytes(oid), off);
      off += 20;
    }
    return buf;
  }

  function parseWant(data) {
    const view = new DataView(data.buffer, data.byteOffset);
    const n = readUint32(view, 1);
    let off = 5;
    const oids = [];
    for (let i = 0; i < n; i++) {
      oids.push(bytesToHex(data.subarray(off, off + 20)));
      off += 20;
    }
    const h = readUint32(view, off);
    off += 4;
    const have = [];
    for (let i = 0; i < h; i++) {
      have.push(bytesToHex(data.subarray(off, off + 20)));
      off += 20;
    }
    return { oids, have };
  }

  function buildPackMeta(packId, totalChunks, totalSize) {
    const buf = new Uint8Array(1 + 16 + 4 + 4);
    const view = new DataView(buf.buffer);
    buf[0] = MSG_PACK_META;
    buf.set(packId, 1);
    writeUint32(view, 17, totalChunks);
    writeUint32(view, 21, totalSize);
    return buf;
  }

  function buildPackChunk(packId, index, chunk) {
    const buf = new Uint8Array(1 + 16 + 4 + chunk.length);
    const view = new DataView(buf.buffer);
    buf[0] = MSG_PACK_CHUNK;
    buf.set(packId, 1);
    writeUint32(view, 17, index);
    buf.set(chunk, 21);
    return buf;
  }

  function buildPackEnd(packId) {
    const buf = new Uint8Array(1 + 16);
    buf[0] = MSG_PACK_END;
    buf.set(packId, 1);
    return buf;
  }

  function buildSyncDone() {
    return new Uint8Array([MSG_SYNC_DONE]);
  }

  function hexToBytes(hex) {
    const bytes = new Uint8Array(20);
    for (let i = 0; i < 20; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  }

  function bytesToHex(bytes) {
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function randomPackId() {
    const id = new Uint8Array(16);
    crypto.getRandomValues(id);
    return id;
  }

  async function sendPackfile(oids) {
    if (!realtime) {
      log("Canal realtime no disponible", "warn");
      return;
    }
    try {
      const packResult = await git.packObjects({ fs, dir, oids, write: false });
      let packData;
      if (packResult.pack instanceof Uint8Array) {
        packData = packResult.pack;
      } else if (packResult.pack && typeof packResult.pack.getReader === "function") {
        const reader = packResult.pack.getReader();
        const chunks = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        const total = chunks.reduce((a, c) => a + c.length, 0);
        packData = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) {
          packData.set(c, off);
          off += c.length;
        }
      } else {
        log("Formato de pack no soportado", "error");
        return;
      }

      const packId = randomPackId();
      const totalChunks = Math.ceil(packData.length / CHUNK_SIZE);
      log(`Enviando pack ${bytesToHex(packId).slice(0, 8)}… ${packData.length} bytes en ${totalChunks} chunks`, "sync");

      realtime.send(buildPackMeta(packId, totalChunks, packData.length));
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, packData.length);
        realtime.send(buildPackChunk(packId, i, packData.subarray(start, end)));
        await new Promise((r) => setTimeout(r, 5));
      }
      realtime.send(buildPackEnd(packId));
      realtime.send(buildSyncDone());
      log("Pack enviado completamente", "sync");
      sendAppUpdate({ type: "SYNC_ACK", from: myAddr }, "Sync completado");
    } catch (e) {
      log("Error enviando pack: " + e.message, "error");
    }
  }

  async function handleRealtimeData(data) {
    if (!(data instanceof Uint8Array) || data.length === 0) return;
    const type = data[0];
    switch (type) {
      case MSG_WANT: {
        const { oids, have } = parseWant(data);
        log(`WANT recibido: ${oids.length} oids, have=${have.length}`, "sync");
        if (oids.length > 0) await sendPackfile(oids);
        break;
      }
      case MSG_PACK_META: {
        const packId = data.subarray(1, 17);
        const view = new DataView(data.buffer, data.byteOffset);
        packReceiving = {
          id: packId,
          totalChunks: readUint32(view, 17),
          totalSize: readUint32(view, 21),
          chunks: new Array(readUint32(view, 17)),
          received: 0
        };
        log(`PACK_META: ${packReceiving.totalChunks} chunks, ${packReceiving.totalSize} bytes`, "sync");
        break;
      }
      case MSG_PACK_CHUNK: {
        if (!packReceiving) return;
        const packId = data.subarray(1, 17);
        if (bytesToHex(packId) !== bytesToHex(packReceiving.id)) return;
        const view = new DataView(data.buffer, data.byteOffset);
        const index = readUint32(view, 17);
        const chunk = data.subarray(21);
        if (!packReceiving.chunks[index]) {
          packReceiving.chunks[index] = chunk;
          packReceiving.received++;
        }
        break;
      }
      case MSG_PACK_END: {
        if (!packReceiving) return;
        log(`PACK_END recibido, ${packReceiving.received}/${packReceiving.totalChunks} chunks`, "sync");
        if (packReceiving.received === packReceiving.totalChunks) {
          const total = packReceiving.chunks.reduce((a, c) => a + c.length, 0);
          const packData = new Uint8Array(total);
          let off = 0;
          for (const c of packReceiving.chunks) {
            packData.set(c, off);
            off += c.length;
          }
          try {
            await git.unpack({ fs, dir, data: packData });
            log("Pack descomprimido e integrado", "sync");
            await refreshTree();
          } catch (e) {
            log("Error al unpack: " + e.message, "error");
          }
        }
        packReceiving = null;
        break;
      }
      case MSG_SYNC_DONE:
        log("SYNC_DONE recibido", "sync");
        setStatus("sincronizado", true);
        break;
      default:
        log("Mensaje realtime desconocido: 0x" + type.toString(16), "warn");
    }
  }

  function sendAppUpdate(payload, info) {
    window.webxdc.sendUpdate({ payload }, info || "");
  }

  function handleAppUpdate(update) {
    const p = update.payload;
    if (!p || typeof p !== "object") return;
    switch (p.type) {
      case "REF_UPDATE":
        if (p.refs) {
          for (const [name, oid] of Object.entries(p.refs)) yrefs.set(name, oid);
        }
        break;
      case "YJS_UPDATE":
        try {
          Y.applyUpdate(ydoc, base64ToUint8(p.data));
          log("YJS_UPDATE aplicado", "sync");
        } catch (e) {
          log("Error aplicando YJS_UPDATE: " + e.message, "error");
        }
        break;
      case "SYNC_ACK":
        log("SYNC_ACK de " + (p.from || "?"), "sync");
        break;
      case "ISSUE_CREATE":
        issues.push(p.issue);
        renderIssues();
        break;
      case "ISSUE_COMMENT": {
        const issue = issues.find((i) => i.id === p.issueId);
        if (issue) {
          issue.comments = issue.comments || [];
          issue.comments.push(p.comment);
          renderIssues();
        }
        break;
      }
      case "PR_CREATE":
        prs.push(p.pr);
        renderPRs();
        break;
      case "PR_MERGE": {
        const pr = prs.find((x) => x.id === p.prId);
        if (pr) { pr.state = "merged"; renderPRs(); }
        break;
      }
      case "PR_CLOSE": {
        const pr = prs.find((x) => x.id === p.prId);
        if (pr) { pr.state = "closed"; renderPRs(); }
        break;
      }
    }
  }

  async function listFiles(path = "") {
    const full = dir + (path ? "/" + path : "");
    let entries;
    try { entries = await pfs.readdir(full); } catch { return []; }
    const result = [];
    for (const name of entries) {
      if (name === ".git") continue;
      const rel = path ? path + "/" + name : name;
      const st = await pfs.stat(dir + "/" + rel);
      result.push({ name, path: rel, isDir: st.isDirectory() });
    }
    result.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return result;
  }

  async function refreshTree() {
    const tree = document.getElementById("file-tree");
    tree.innerHTML = "";
    const files = await listFiles();
    if (files.length === 0) {
      tree.innerHTML = '<div class="empty"><h3>Vacío</h3><p>No hay archivos</p></div>';
      return;
    }
    for (const f of files) {
      const item = document.createElement("div");
      item.className = "tree-item" + (f.isDir ? " dir" : "");
      item.dataset.path = f.path;
      item.innerHTML = `<span class="icon">${f.isDir ? "📁" : "📄"}</span> ${escapeHtml(f.name)}`;
      item.addEventListener("click", () => { if (!f.isDir) openFile(f.path); });
      tree.appendChild(item);
    }
  }

  async function openFile(path) {
    if (dirty && !confirm("Hay cambios sin guardar. ¿Descartar?")) return;
    try {
      const content = await pfs.readFile(dir + "/" + path, "utf8");
      currentFile = path;
      dirty = false;
      document.getElementById("editor-path").textContent = path;
      document.getElementById("btn-save").disabled = true;
      window.GitXDCEditor.setContent(content, path);
      document.querySelectorAll(".tree-item").forEach((el) => {
        el.classList.toggle("active", el.dataset.path === path);
      });
      log("Abierto: " + path);
    } catch (e) {
      log("Error abriendo " + path + ": " + e.message, "error");
    }
  }

  async function saveFile() {
    if (!currentFile) return;
    const content = window.GitXDCEditor.getContent();
    await pfs.writeFile(dir + "/" + currentFile, content, "utf8");
    await git.add({ fs, dir, filepath: currentFile });
    dirty = false;
    document.getElementById("btn-save").disabled = true;
    log("Guardado y staged: " + currentFile);
  }

  async function createCommit() {
    const message = prompt("Mensaje del commit:", "Update");
    if (!message) return;
    try {
      const sha = await git.commit({
        fs, dir, message,
        author: { name: myName || "GitXDC", email: myAddr || "gitxdc@local" }
      });
      log("Commit creado: " + sha.slice(0, 7) + " — " + message);
      const refs = {};
      try {
        const head = await git.resolveRef({ fs, dir, ref: "HEAD" });
        refs["refs/heads/" + currentBranch] = head;
        yrefs.set("refs/heads/" + currentBranch, head);
      } catch (_) {}
      sendAppUpdate({ type: "REF_UPDATE", refs }, "Ref actualizada");
      setStatus("commit " + sha.slice(0, 7));
    } catch (e) {
      log("Error en commit: " + e.message, "error");
    }
  }

  async function newFile() {
    const name = prompt("Nombre del archivo (ruta relativa):");
    if (!name) return;
    try {
      const parts = name.split("/");
      if (parts.length > 1) {
        let acc = dir;
        for (let i = 0; i < parts.length - 1; i++) {
          acc += "/" + parts[i];
          try { await pfs.mkdir(acc); } catch (_) {}
        }
      }
      await pfs.writeFile(dir + "/" + name, "", "utf8");
      await git.add({ fs, dir, filepath: name });
      await refreshTree();
      openFile(name);
      log("Archivo creado: " + name);
    } catch (e) {
      log("Error creando archivo: " + e.message, "error");
    }
  }

  function renderIssues() {
    const container = document.getElementById("issues-container");
    document.getElementById("badge-issues").textContent = issues.filter((i) => i.state === "open").length;
    if (issues.length === 0) {
      container.innerHTML = '<div class="empty"><h3>No hay issues</h3></div>';
      return;
    }
    container.innerHTML = issues.map((i) => `
      <div class="issue-card" data-id="${i.id}">
        <div class="title">${escapeHtml(i.title)}</div>
        <div class="meta">
          <span class="${i.state}">${i.state === "open" ? "● Open" : "● Closed"}</span>
          · #${i.id} abierto por ${escapeHtml(i.author)} · ${(i.comments || []).length} comentarios
        </div>
      </div>`).join("");
    container.querySelectorAll(".issue-card").forEach((el) => {
      el.addEventListener("click", () => showIssueDetail(+el.dataset.id));
    });
  }

  function showIssueDetail(id) {
    const issue = issues.find((i) => i.id === id);
    if (!issue) return;
    document.getElementById("issues-list").style.display = "none";
    const detail = document.getElementById("issue-detail");
    detail.style.display = "block";
    const commentsHtml = (issue.comments || []).map((c) => `
      <div class="comment">
        <span class="author">${escapeHtml(c.author)}</span>
        <span class="time">${c.time || ""}</span>
        <div class="text">${escapeHtml(c.text)}</div>
      </div>`).join("");
    detail.innerHTML = `
      <span class="back" id="back-issues">← Volver</span>
      <h2>#${issue.id} ${escapeHtml(issue.title)}</h2>
      <div class="meta">${issue.state} · por ${escapeHtml(issue.author)}</div>
      <div class="body">${escapeHtml(issue.body || "")}</div>
      <h3>Comentarios</h3>
      ${commentsHtml || "<p class='empty'>Sin comentarios</p>"}
      <div class="form-row"><label>Nuevo comentario</label><textarea id="issue-comment-text"></textarea></div>
      <div class="form-actions"><button class="primary" id="btn-add-comment">Comentar</button></div>`;
    document.getElementById("back-issues").onclick = () => {
      detail.style.display = "none";
      document.getElementById("issues-list").style.display = "block";
    };
    document.getElementById("btn-add-comment").onclick = () => {
      const text = document.getElementById("issue-comment-text").value.trim();
      if (!text) return;
      const comment = { author: myName, text, time: new Date().toISOString() };
      issue.comments = issue.comments || [];
      issue.comments.push(comment);
      sendAppUpdate({ type: "ISSUE_COMMENT", issueId: issue.id, comment }, "Comentario en issue #" + issue.id);
      showIssueDetail(id);
    };
  }

  function newIssue() {
    const title = prompt("Título del issue:");
    if (!title) return;
    const body = prompt("Descripción (opcional):") || "";
    const issue = {
      id: issues.length + 1, title, body, author: myName, state: "open",
      comments: [], created: new Date().toISOString()
    };
    issues.push(issue);
    sendAppUpdate({ type: "ISSUE_CREATE", issue }, "Issue creado: " + title);
    renderIssues();
  }

  function renderPRs() {
    const container = document.getElementById("prs-container");
    document.getElementById("badge-prs").textContent = prs.filter((p) => p.state === "open").length;
    if (prs.length === 0) {
      container.innerHTML = '<div class="empty"><h3>No hay pull requests</h3></div>';
      return;
    }
    container.innerHTML = prs.map((p) => `
      <div class="pr-card" data-id="${p.id}">
        <div class="title">${escapeHtml(p.title)}</div>
        <div class="meta">
          <span class="${p.state}">${p.state === "open" ? "● Open" : p.state === "merged" ? "● Merged" : "● Closed"}</span>
          · #${p.id} ${escapeHtml(p.head)} → ${escapeHtml(p.base)} · por ${escapeHtml(p.author)}
        </div>
      </div>`).join("");
    container.querySelectorAll(".pr-card").forEach((el) => {
      el.addEventListener("click", () => showPRDetail(+el.dataset.id));
    });
  }

  function showPRDetail(id) {
    const pr = prs.find((p) => p.id === id);
    if (!pr) return;
    document.getElementById("prs-list").style.display = "none";
    const detail = document.getElementById("pr-detail");
    detail.style.display = "block";
    detail.innerHTML = `
      <span class="back" id="back-prs">← Volver</span>
      <h2>#${pr.id} ${escapeHtml(pr.title)}</h2>
      <div class="meta">${pr.state} · ${escapeHtml(pr.head)} → ${escapeHtml(pr.base)} · por ${escapeHtml(pr.author)}</div>
      <div class="body">${escapeHtml(pr.body || "")}</div>
      <div class="form-actions">
        ${pr.state === "open" ? `<button class="primary" id="btn-merge-pr">Merge</button><button class="danger" id="btn-close-pr">Cerrar</button>` : ""}
      </div>`;
    document.getElementById("back-prs").onclick = () => {
      detail.style.display = "none";
      document.getElementById("prs-list").style.display = "block";
    };
    const mergeBtn = document.getElementById("btn-merge-pr");
    if (mergeBtn) {
      mergeBtn.onclick = () => {
        pr.state = "merged";
        sendAppUpdate({ type: "PR_MERGE", prId: pr.id }, "PR #" + pr.id + " mergeado");
        showPRDetail(id);
        renderPRs();
      };
    }
    const closeBtn = document.getElementById("btn-close-pr");
    if (closeBtn) {
      closeBtn.onclick = () => {
        pr.state = "closed";
        sendAppUpdate({ type: "PR_CLOSE", prId: pr.id }, "PR #" + pr.id + " cerrado");
        showPRDetail(id);
        renderPRs();
      };
    }
  }

  function newPR() {
    const title = prompt("Título del PR:");
    if (!title) return;
    const head = prompt("Branch origen (head):", "feature") || "feature";
    const base = prompt("Branch destino (base):", "main") || "main";
    const body = prompt("Descripción (opcional):") || "";
    const pr = {
      id: prs.length + 1, title, head, base, body, author: myName,
      state: "open", created: new Date().toISOString()
    };
    prs.push(pr);
    sendAppUpdate({ type: "PR_CREATE", pr }, "PR creado: " + title);
    renderPRs();
  }

  async function doSync() {
    setStatus("sincronizando…");
    log("Iniciando sync P2P…", "sync");
    try {
      const head = await git.resolveRef({ fs, dir, ref: "HEAD" });
      const oids = [head];
      try {
        const logEntries = await git.log({ fs, dir, depth: 10 });
        for (const e of logEntries) oids.push(e.oid);
      } catch (_) {}
      if (realtime) {
        realtime.send(buildWant(oids, []));
        await sendPackfile(oids);
      } else {
        log("Sin canal realtime", "warn");
      }
      setStatus("sync enviado", true);
    } catch (e) {
      log("Error en sync: " + e.message, "error");
      setStatus("error sync");
    }
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
    return table;
  })();

  function crc32(data) {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
      crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  async function compressDeflate(data) {
    if (typeof CompressionStream !== "undefined") {
      const cs = new CompressionStream("deflate-raw");
      const writer = cs.writable.getWriter();
      writer.write(data);
      writer.close();
      const reader = cs.readable.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const total = chunks.reduce((a, c) => a + c.length, 0);
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { out.set(c, off); off += c.length; }
      return out;
    }
    return data;
  }

  async function buildZip(files) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const f of files) {
      const nameBytes = new TextEncoder().encode(f.name);
      const raw = f.data;
      const compressed = await compressDeflate(raw);
      const useDeflate = compressed.length < raw.length;
      const payload = useDeflate ? compressed : raw;
      const method = useDeflate ? 8 : 0;
      const crc = crc32(raw);
      const local = new Uint8Array(30 + nameBytes.length + payload.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0, true);
      lv.setUint16(8, method, true);
      lv.setUint16(10, 0, true);
      lv.setUint16(12, 0, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, payload.length, true);
      lv.setUint32(22, raw.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      local.set(payload, 30 + nameBytes.length);
      localParts.push(local);
      const central = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true);
      cv.setUint16(10, method, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, payload.length, true);
      cv.setUint32(24, raw.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      central.set(nameBytes, 46);
      centralParts.push(central);
      offset += local.length;
    }
    const centralSize = centralParts.reduce((a, c) => a + c.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);
    const zip = new Uint8Array(offset + centralSize + 22);
    let off = 0;
    for (const p of localParts) { zip.set(p, off); off += p.length; }
    for (const p of centralParts) { zip.set(p, off); off += p.length; }
    zip.set(eocd, off);
    return zip;
  }

  async function listFilesRecursive(path) {
    const entries = await listFiles(path);
    let result = [];
    for (const e of entries) {
      if (e.isDir) result = result.concat(await listFilesRecursive(e.path));
      else result.push(e.path);
    }
    return result;
  }

  async function exportXdc() {
    log("Generando .xdc…");
    setStatus("exportando…");
    try {
      const files = [];
      const treeFiles = await listFilesRecursive("");
      for (const f of treeFiles) {
        const data = await pfs.readFile(dir + "/" + f);
        const u8 = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
        files.push({ name: f, data: u8 });
      }
      if (!files.find((f) => f.name === "manifest.toml")) {
        files.push({ name: "manifest.toml", data: new TextEncoder().encode('name = "GitXDC-Repo"\n') });
      }
      if (!files.find((f) => f.name === "index.html")) {
        files.push({ name: "index.html", data: new TextEncoder().encode("<!DOCTYPE html><html><body><h1>GitXDC Export</h1></body></html>") });
      }
      const zipData = await buildZip(files);
      await window.webxdc.sendToChat({
        file: { name: "GitXDC-export.xdc", base64: uint8ToBase64(zipData) },
        text: "Exportado desde GitXDC — " + files.length + " archivos"
      });
      log("Export .xdc enviado (" + zipData.length + " bytes)", "sync");
      setStatus("exportado");
    } catch (e) {
      log("Error exportando .xdc: " + e.message, "error");
      setStatus("error export");
    }
  }

  function setupTabs() {
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
        document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
        tab.classList.add("active");
        document.getElementById("panel-" + tab.dataset.tab).classList.add("active");
      });
    });
  }

  async function boot() {
    try {
      if (!git) throw new Error("isomorphic-git no cargado (window.git)");
      if (!LightningFS) throw new Error("lightning-fs no cargado (window.LightningFS)");
      if (!Y) throw new Error("yjs no cargado (window.Y)");
      if (!window.CodeMirrorBundle) throw new Error("CodeMirror no cargado");
      if (!window.GitXDCEditor) throw new Error("editor.js no cargado");
      if (!window.webxdc) throw new Error("webxdc API no disponible");

      myAddr = window.webxdc.selfAddr;
      myName = window.webxdc.selfName;
      log("Arrancando GitXDC como " + myName + " (" + myAddr + ")");

      window.webxdc.setUpdateListener((update) => { handleAppUpdate(update); }, 0);

      try {
        realtime = window.webxdc.joinRealtimeChannel();
        realtime.setListener(handleRealtimeData);
        log("Canal realtime unido");
      } catch (e) {
        log("Realtime no disponible: " + e.message, "warn");
      }

      await initFS();
      initYjs();
      await initGit();

      const container = document.getElementById("editor-container");
      window.GitXDCEditor.init(container);
      window.GitXDCEditor.onChange(() => {
        dirty = true;
        document.getElementById("btn-save").disabled = false;
      });

      document.getElementById("btn-save").onclick = saveFile;
      document.getElementById("btn-new-file").onclick = newFile;
      document.getElementById("btn-commit").onclick = createCommit;
      document.getElementById("btn-sync").onclick = doSync;
      document.getElementById("btn-export").onclick = exportXdc;
      document.getElementById("btn-new-issue").onclick = newIssue;
      document.getElementById("btn-new-pr").onclick = newPR;

      setupTabs();
      renderIssues();
      renderPRs();

      setStatus("listo", true);
      log("GitXDC listo");
    } catch (e) {
      console.error(e);
      setStatus("error: " + (e && e.message ? e.message : e));
      try { log(String(e && e.stack ? e.stack : e), "error"); } catch (_) {}
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
