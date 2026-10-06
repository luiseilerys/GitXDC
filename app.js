/**
 * app.js — Lógica principal de GitXDC (compacto, API para ui.js)
 */
(function () {
  "use strict";

  function resolveExport(mod) {
    if (!mod) return null;
    if (typeof mod === "function") return mod;
    if (mod.default) return mod.default;
    return mod;
  }
  const git = resolveExport(window.git);
  const Y = resolveExport(window.Y);
  const LightningFS = resolveExport(window.LightningFS || window.lightningFS);

  let fs = null, pfs = null, dir = "/repo", currentBranch = "main", currentFile = null, dirty = false;
  let issues = [], prs = [], ydoc = null, yrefs = null, realtime = null, myAddr = "", myName = "";

  function log(msg, level) {
    level = level || "info";
    const el = document.getElementById("log-container");
    if (!el) return;
    const entry = document.createElement("div");
    entry.className = "log-entry";
    entry.innerHTML = '<span class="time">' + new Date().toLocaleTimeString() +
      '</span><span class="level-' + level + '">[' + level + ']</span> ' + escapeHtml(msg);
    el.appendChild(entry);
    el.scrollTop = el.scrollHeight;
    console.log("[GitXDC " + level + "]", msg);
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">").replace(/"/g, """);
  }

  function setStatus(text, online) {
    const el = document.getElementById("status");
    if (el) {
      el.textContent = text;
      el.className = "status" + (online ? " online" : "");
    }
  }

  async function initFS() {
    fs = new LightningFS("gitxdc-fs");
    pfs = fs.promises;
    try { await pfs.mkdir(dir); } catch (e) {}
    log("LightningFS listo");
  }

  async function initGit() {
    try {
      const files = await pfs.readdir(dir + "/.git");
      if (files && files.length) {
        log("Repo existente");
        document.getElementById("repo-name").textContent = "local/repo";
        await refreshTree();
        return;
      }
    } catch (_) {}
    await git.init({ fs: fs, dir: dir, defaultBranch: "main" });
    await pfs.writeFile(dir + "/README.md", "# GitXDC Repo\n\nRepositorio local.\n", "utf8");
    await git.add({ fs: fs, dir: dir, filepath: "README.md" });
    const sha = await git.commit({
      fs: fs, dir: dir, message: "Commit inicial",
      author: { name: myName || "GitXDC", email: myAddr || "gitxdc@local" }
    });
    log("Repo nuevo " + sha.slice(0, 7));
    document.getElementById("repo-name").textContent = "local/repo";
    await refreshTree();
  }

  function initYjs() {
    ydoc = new Y.Doc();
    yrefs = ydoc.getMap("refs");
  }

  function sendAppUpdate(payload, info) {
    window.webxdc.sendUpdate({ payload: payload }, info || "");
  }

  function handleAppUpdate(update) {
    var p = update.payload;
    if (!p || typeof p !== "object") return;
    if (p.type === "ISSUE_CREATE") { issues.push(p.issue); renderIssues(); }
    else if (p.type === "PR_CREATE") { prs.push(p.pr); renderPRs(); }
    else if (p.type === "PR_MERGE") {
      var pr = prs.find(function (x) { return x.id === p.prId; });
      if (pr) { pr.state = "merged"; renderPRs(); }
    } else if (p.type === "PR_CLOSE") {
      var pr2 = prs.find(function (x) { return x.id === p.prId; });
      if (pr2) { pr2.state = "closed"; renderPRs(); }
    } else if (p.type === "ISSUE_COMMENT") {
      var issue = issues.find(function (i) { return i.id === p.issueId; });
      if (issue) {
        issue.comments = issue.comments || [];
        issue.comments.push(p.comment);
        renderIssues();
      }
    }
  }

  async function listFiles(path) {
    path = path || "";
    var full = dir + (path ? "/" + path : "");
    var entries;
    try { entries = await pfs.readdir(full); } catch (e) { return []; }
    var result = [], i, name, rel, st;
    for (i = 0; i < entries.length; i++) {
      name = entries[i];
      if (name === ".git") continue;
      rel = path ? path + "/" + name : name;
      st = await pfs.stat(dir + "/" + rel);
      result.push({ name: name, path: rel, isDir: st.isDirectory() });
    }
    result.sort(function (a, b) {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return result;
  }

  async function refreshTree() {
    var tree = document.getElementById("file-tree");
    tree.innerHTML = "";
    var files = await listFiles();
    if (!files.length) {
      tree.innerHTML = '<div class="empty"><h3>Sin archivos</h3><p>Pulsa + o Importar</p></div>';
      return;
    }
    files.forEach(function (f) {
      var item = document.createElement("div");
      item.className = "tree-item" + (f.isDir ? " dir" : "");
      item.dataset.path = f.path;
      item.innerHTML = '<span class="icon">' + (f.isDir ? "📁" : "📄") + "</span> " + escapeHtml(f.name);
      item.addEventListener("click", function () { if (!f.isDir) openFile(f.path); });
      tree.appendChild(item);
    });
  }

  async function openFile(path) {
    if (dirty) { log("Cambios sin guardar descartados", "warn"); dirty = false; }
    try {
      var content = await pfs.readFile(dir + "/" + path, "utf8");
      currentFile = path;
      document.getElementById("editor-path").textContent = path;
      document.getElementById("btn-save").disabled = true;
      window.GitXDCEditor.setContent(content, path);
      document.querySelectorAll(".tree-item").forEach(function (el) {
        el.classList.toggle("active", el.dataset.path === path);
      });
      log("Abierto: " + path);
    } catch (e) { log("Error: " + e.message, "error"); }
  }

  async function saveFile() {
    if (!currentFile) return;
    await pfs.writeFile(dir + "/" + currentFile, window.GitXDCEditor.getContent(), "utf8");
    await git.add({ fs: fs, dir: dir, filepath: currentFile });
    dirty = false;
    document.getElementById("btn-save").disabled = true;
    log("Guardado: " + currentFile);
  }

  async function createFileAt(name, content) {
    content = content || "";
    var parts = name.split("/"), i, acc;
    if (parts.length > 1) {
      acc = dir;
      for (i = 0; i < parts.length - 1; i++) {
        acc += "/" + parts[i];
        try { await pfs.mkdir(acc); } catch (e) {}
      }
    }
    await pfs.writeFile(dir + "/" + name, content, "utf8");
    await git.add({ fs: fs, dir: dir, filepath: name });
    await refreshTree();
    await openFile(name);
    log("Creado: " + name);
  }

  async function doCommit(message) {
    var sha = await git.commit({
      fs: fs, dir: dir, message: message || "Update",
      author: { name: myName || "GitXDC", email: myAddr || "gitxdc@local" }
    });
    log("Commit " + sha.slice(0, 7) + " — " + message);
    setStatus("commit " + sha.slice(0, 7));
  }

  async function importFiles(fileList) {
    if (!fileList || !fileList.length) return;
    var n = 0, i, file, name, text;
    for (i = 0; i < fileList.length; i++) {
      file = fileList[i];
      try {
        name = file.name.replace(/^.*[\\/]/, "");
        text = await file.text();
        await pfs.writeFile(dir + "/" + name, text, "utf8");
        await git.add({ fs: fs, dir: dir, filepath: name });
        n++;
        log("Importado: " + name);
      } catch (e) { log("Import: " + e.message, "error"); }
    }
    await refreshTree();
    setStatus("importados " + n);
  }

  async function resetRepo() {
    try {
      var names = await pfs.readdir(dir), i, name;
      for (i = 0; i < names.length; i++) {
        name = names[i];
        if (name === ".git") continue;
        try { await pfs.unlink(dir + "/" + name); } catch (e) {}
      }
    } catch (e) {}
    await git.init({ fs: fs, dir: dir, defaultBranch: "main" });
    await pfs.writeFile(dir + "/README.md", "# GitXDC Repo\n\nRepo reiniciado.\n", "utf8");
    await git.add({ fs: fs, dir: dir, filepath: "README.md" });
    var sha = await git.commit({
      fs: fs, dir: dir, message: "Commit inicial",
      author: { name: myName || "GitXDC", email: myAddr || "gitxdc@local" }
    });
    currentFile = null;
    dirty = false;
    document.getElementById("editor-path").textContent = "Selecciona un archivo";
    document.getElementById("btn-save").disabled = true;
    if (window.GitXDCEditor) window.GitXDCEditor.clear();
    document.getElementById("repo-name").textContent = "local/repo";
    await refreshTree();
    log("Repo reiniciado " + sha.slice(0, 7));
    setStatus("repo nuevo", true);
  }

  function createIssue(title, body) {
    var issue = {
      id: issues.length + 1, title: title, body: body || "", author: myName,
      state: "open", comments: [], created: new Date().toISOString()
    };
    issues.push(issue);
    sendAppUpdate({ type: "ISSUE_CREATE", issue: issue }, "Issue: " + title);
    renderIssues();
  }

  function createPR(title, head, base, body) {
    var pr = {
      id: prs.length + 1, title: title, head: head || "feature", base: base || "main",
      body: body || "", author: myName, state: "open", created: new Date().toISOString()
    };
    prs.push(pr);
    sendAppUpdate({ type: "PR_CREATE", pr: pr }, "PR: " + title);
    renderPRs();
  }

  function renderIssues() {
    var container = document.getElementById("issues-container");
    document.getElementById("badge-issues").textContent = issues.filter(function (i) { return i.state === "open"; }).length;
    if (!issues.length) {
      container.innerHTML = '<div class="empty"><h3>No hay issues</h3></div>';
      return;
    }
    container.innerHTML = issues.map(function (i) {
      return '<div class="issue-card" data-id="' + i.id + '"><div class="title">' + escapeHtml(i.title) +
        '</div><div class="meta"><span class="' + i.state + '">' + i.state +
        '</span> · #' + i.id + ' · ' + escapeHtml(i.author) + '</div></div>';
    }).join("");
    container.querySelectorAll(".issue-card").forEach(function (el) {
      el.addEventListener("click", function () { showIssueDetail(+el.dataset.id); });
    });
  }

  function showIssueDetail(id) {
    var issue = issues.find(function (i) { return i.id === id; });
    if (!issue) return;
    document.getElementById("issues-list").style.display = "none";
    var detail = document.getElementById("issue-detail");
    detail.style.display = "block";
    detail.innerHTML = '<span class="back" id="back-issues">← Volver</span><h2>#' + issue.id + " " +
      escapeHtml(issue.title) + '</h2><div class="body">' + escapeHtml(issue.body || "") +
      '</div><div class="form-row"><label>Comentario</label><textarea id="issue-comment-text"></textarea></div>' +
      '<div class="form-actions"><button class="primary" id="btn-add-comment">Comentar</button></div>';
    document.getElementById("back-issues").onclick = function () {
      detail.style.display = "none";
      document.getElementById("issues-list").style.display = "block";
    };
    document.getElementById("btn-add-comment").onclick = function () {
      var text = document.getElementById("issue-comment-text").value.trim();
      if (!text) return;
      var comment = { author: myName, text: text, time: new Date().toISOString() };
      issue.comments = issue.comments || [];
      issue.comments.push(comment);
      sendAppUpdate({ type: "ISSUE_COMMENT", issueId: issue.id, comment: comment }, "Comentario");
      showIssueDetail(id);
    };
  }

  function renderPRs() {
    var container = document.getElementById("prs-container");
    document.getElementById("badge-prs").textContent = prs.filter(function (p) { return p.state === "open"; }).length;
    if (!prs.length) {
      container.innerHTML = '<div class="empty"><h3>No hay PRs</h3></div>';
      return;
    }
    container.innerHTML = prs.map(function (p) {
      return '<div class="pr-card" data-id="' + p.id + '"><div class="title">' + escapeHtml(p.title) +
        '</div><div class="meta"><span class="' + p.state + '">' + p.state + '</span> · #' + p.id +
        " " + escapeHtml(p.head) + " → " + escapeHtml(p.base) + "</div></div>";
    }).join("");
    container.querySelectorAll(".pr-card").forEach(function (el) {
      el.addEventListener("click", function () { showPRDetail(+el.dataset.id); });
    });
  }

  function showPRDetail(id) {
    var pr = prs.find(function (p) { return p.id === id; });
    if (!pr) return;
    document.getElementById("prs-list").style.display = "none";
    var detail = document.getElementById("pr-detail");
    detail.style.display = "block";
    detail.innerHTML = '<span class="back" id="back-prs">← Volver</span><h2>#' + pr.id + " " +
      escapeHtml(pr.title) + '</h2><div class="body">' + escapeHtml(pr.body || "") + "</div>" +
      (pr.state === "open"
        ? '<div class="form-actions"><button class="primary" id="btn-merge-pr">Merge</button>' +
          '<button class="danger" id="btn-close-pr">Cerrar</button></div>'
        : "");
    document.getElementById("back-prs").onclick = function () {
      detail.style.display = "none";
      document.getElementById("prs-list").style.display = "block";
    };
    var mb = document.getElementById("btn-merge-pr");
    if (mb) mb.onclick = function () {
      pr.state = "merged";
      sendAppUpdate({ type: "PR_MERGE", prId: pr.id }, "Merged");
      showPRDetail(id); renderPRs();
    };
    var cb = document.getElementById("btn-close-pr");
    if (cb) cb.onclick = function () {
      pr.state = "closed";
      sendAppUpdate({ type: "PR_CLOSE", prId: pr.id }, "Closed");
      showPRDetail(id); renderPRs();
    };
  }

  async function doSync() {
    setStatus("sincronizando…");
    try {
      var head = await git.resolveRef({ fs: fs, dir: dir, ref: "HEAD" });
      log("HEAD " + head.slice(0, 7), "sync");
      setStatus("sync ok", true);
    } catch (e) {
      log("Sync: " + e.message, "error");
      setStatus("error sync");
    }
  }

  async function exportXdc() {
    setStatus("export…");
    try {
      var files = await listFiles();
      var parts = [], i, f;
      for (i = 0; i < files.length; i++) {
        f = files[i];
        if (!f.isDir) parts.push(f.path);
      }
      await window.webxdc.sendToChat({ text: "GitXDC — archivos: " + parts.join(", ") });
      setStatus("exportado");
    } catch (e) {
      log("Export: " + e.message, "error");
      setStatus("error export");
    }
  }

  function setupTabs() {
    document.querySelectorAll(".tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        document.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
        document.querySelectorAll(".panel").forEach(function (p) { p.classList.remove("active"); });
        tab.classList.add("active");
        document.getElementById("panel-" + tab.dataset.tab).classList.add("active");
      });
    });
  }

  async function boot() {
    try {
      if (!git) throw new Error("isomorphic-git no cargado");
      if (!LightningFS) throw new Error("lightning-fs no cargado");
      if (!Y) throw new Error("yjs no cargado");
      if (!window.CodeMirrorBundle) throw new Error("CodeMirror no cargado");
      if (!window.GitXDCEditor) throw new Error("editor.js no cargado");
      if (!window.webxdc) throw new Error("webxdc no disponible");

      myAddr = window.webxdc.selfAddr;
      myName = window.webxdc.selfName;
      log("Usuario " + myName);

      window.webxdc.setUpdateListener(handleAppUpdate, 0);
      try {
        realtime = window.webxdc.joinRealtimeChannel();
        log("Realtime ok");
      } catch (e) { log("Sin realtime: " + e.message, "warn"); }

      await initFS();
      initYjs();
      await initGit();

      window.GitXDCEditor.init(document.getElementById("editor-container"));
      window.GitXDCEditor.onChange(function () {
        dirty = true;
        document.getElementById("btn-save").disabled = false;
      });

      document.getElementById("btn-save").onclick = saveFile;
      document.getElementById("btn-sync").onclick = doSync;
      document.getElementById("btn-export").onclick = exportXdc;

      setupTabs();
      renderIssues();
      renderPRs();

      window.GitXDCApp = {
        createFileAt: createFileAt,
        doCommit: doCommit,
        importFiles: importFiles,
        resetRepo: resetRepo,
        createIssue: createIssue,
        createPR: createPR
      };
      if (window.GitXDCUI && window.GitXDCUI.wire) {
        window.GitXDCUI.wire(window.GitXDCApp);
        log("UI modales lista");
      } else {
        log("ui.js no cargado", "warn");
      }

      setStatus("listo", true);
      log("GitXDC listo");
    } catch (e) {
      console.error(e);
      setStatus("error: " + (e.message || e));
      try { log(String(e.stack || e), "error"); } catch (_) {}
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
