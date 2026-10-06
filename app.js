/**
 * app.js — GitXDC core + API para ui.js
 */
(function () {
  "use strict";

  function resolveExport(mod) {
    if (!mod) return null;
    if (typeof mod === "function") return mod;
    if (mod.default) return mod.default;
    return mod;
  }

  // Leer globals DESPUÉS de que carguen los scripts (boot, no al parsear)
  var git = null;
  var Y = null;
  var LightningFS = null;

  var fs = null, pfs = null, dir = "/repo", currentBranch = "main";
  var currentFile = null, dirty = false;
  var issues = [], prs = [], ydoc = null, yrefs = null, realtime = null;
  var myAddr = "", myName = "";

  function log(msg, level) {
    level = level || "info";
    try {
      var el = document.getElementById("log-container");
      if (el) {
        var entry = document.createElement("div");
        entry.className = "log-entry";
        entry.innerHTML = '<span class="time">' + new Date().toLocaleTimeString() +
          '</span><span class="level-' + level + '">[' + level + ']</span> ' + escapeHtml(String(msg));
        el.appendChild(entry);
        el.scrollTop = el.scrollHeight;
      }
    } catch (_) {}
    try { console.log("[GitXDC " + level + "]", msg); } catch (_) {}
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&")
      .replace(/</g, "<")
      .replace(/>/g, ">")
      .replace(/"/g, """);
  }

  function setStatus(text, online) {
    var el = document.getElementById("status");
    if (el) {
      el.textContent = text;
      el.className = "status" + (online ? " online" : "");
    }
  }

  function diagnose() {
    var missing = [];
    if (!window.webxdc) missing.push("webxdc");
    if (!resolveExport(window.git)) missing.push("git(vendor)");
    if (!resolveExport(window.LightningFS || window.lightningFS)) missing.push("LightningFS(vendor)");
    if (!resolveExport(window.Y)) missing.push("Yjs(vendor)");
    if (!window.CodeMirrorBundle) missing.push("CodeMirror(vendor)");
    if (!window.GitXDCEditor) missing.push("editor.js");
    if (!window.GitXDCUI) missing.push("ui.js");
    return missing;
  }

  async function initFS() {
    fs = new LightningFS("gitxdc-fs");
    pfs = fs.promises;
    try { await pfs.mkdir(dir); } catch (e) {}
    log("FS ok");
  }

  async function initGit() {
    try {
      var files = await pfs.readdir(dir + "/.git");
      if (files && files.length) {
        log("Repo existente");
        document.getElementById("repo-name").textContent = "local/repo";
        await refreshTree();
        return;
      }
    } catch (_) {}
    await git.init({ fs: fs, dir: dir, defaultBranch: "main" });
    await pfs.writeFile(dir + "/README.md", "# GitXDC\n\nRepo local.\n", "utf8");
    await git.add({ fs: fs, dir: dir, filepath: "README.md" });
    var sha = await git.commit({
      fs: fs, dir: dir, message: "Commit inicial",
      author: { name: myName || "GitXDC", email: myAddr || "gitxdc@local" }
    });
    log("Repo nuevo " + String(sha).slice(0, 7));
    document.getElementById("repo-name").textContent = "local/repo";
    await refreshTree();
  }

  function initYjs() {
    if (!Y) return;
    ydoc = new Y.Doc();
    yrefs = ydoc.getMap("refs");
  }

  function sendAppUpdate(payload, info) {
    try {
      if (window.webxdc && window.webxdc.sendUpdate) {
        window.webxdc.sendUpdate({ payload: payload }, info || "");
      }
    } catch (e) { log("sendUpdate: " + e.message, "warn"); }
  }

  function handleAppUpdate(update) {
    var p = update && update.payload;
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
      try {
        st = await pfs.stat(dir + "/" + rel);
        result.push({ name: name, path: rel, isDir: st.isDirectory() });
      } catch (e) {}
    }
    result.sort(function (a, b) {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return result;
  }

  async function refreshTree() {
    var tree = document.getElementById("file-tree");
    if (!tree) return;
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
      if (window.GitXDCEditor) window.GitXDCEditor.setContent(content, path);
      document.querySelectorAll(".tree-item").forEach(function (el) {
        el.classList.toggle("active", el.dataset.path === path);
      });
      log("Abierto: " + path);
    } catch (e) { log("Error: " + e.message, "error"); }
  }

  async function saveFile() {
    if (!currentFile) return;
    var content = window.GitXDCEditor ? window.GitXDCEditor.getContent() : "";
    await pfs.writeFile(dir + "/" + currentFile, content, "utf8");
    if (git) await git.add({ fs: fs, dir: dir, filepath: currentFile });
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
    if (git) await git.add({ fs: fs, dir: dir, filepath: name });
    await refreshTree();
    await openFile(name);
    log("Creado: " + name);
  }

  async function doCommit(message) {
    if (!git) { log("git no disponible", "error"); return; }
    var sha = await git.commit({
      fs: fs, dir: dir, message: message || "Update",
      author: { name: myName || "GitXDC", email: myAddr || "gitxdc@local" }
    });
    log("Commit " + String(sha).slice(0, 7) + " — " + message);
    setStatus("commit " + String(sha).slice(0, 7));
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
        if (git) await git.add({ fs: fs, dir: dir, filepath: name });
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
    if (git) {
      await git.init({ fs: fs, dir: dir, defaultBranch: "main" });
      await pfs.writeFile(dir + "/README.md", "# GitXDC\n\nRepo reiniciado.\n", "utf8");
      await git.add({ fs: fs, dir: dir, filepath: "README.md" });
      var sha = await git.commit({
        fs: fs, dir: dir, message: "Commit inicial",
        author: { name: myName || "GitXDC", email: myAddr || "gitxdc@local" }
      });
      log("Repo reiniciado " + String(sha).slice(0, 7));
    }
    currentFile = null;
    dirty = false;
    document.getElementById("editor-path").textContent = "—";
    document.getElementById("btn-save").disabled = true;
    if (window.GitXDCEditor) window.GitXDCEditor.clear();
    document.getElementById("repo-name").textContent = "local/repo";
    await refreshTree();
    setStatus("repo nuevo", true);
  }

  function createIssue(title, body) {
    var issue = {
      id: issues.length + 1, title: title, body: body || "", author: myName || "anon",
      state: "open", comments: [], created: new Date().toISOString()
    };
    issues.push(issue);
    sendAppUpdate({ type: "ISSUE_CREATE", issue: issue }, "Issue: " + title);
    renderIssues();
  }

  function createPR(title, head, base, body) {
    var pr = {
      id: prs.length + 1, title: title, head: head || "feature", base: base || "main",
      body: body || "", author: myName || "anon", state: "open", created: new Date().toISOString()
    };
    prs.push(pr);
    sendAppUpdate({ type: "PR_CREATE", pr: pr }, "PR: " + title);
    renderPRs();
  }

  function renderIssues() {
    var container = document.getElementById("issues-container");
    if (!container) return;
    var badge = document.getElementById("badge-issues");
    if (badge) badge.textContent = issues.filter(function (i) { return i.state === "open"; }).length;
    if (!issues.length) {
      container.innerHTML = '<div class="empty"><h3>No hay issues</h3></div>';
      return;
    }
    container.innerHTML = issues.map(function (i) {
      return '<div class="issue-card" data-id="' + i.id + '"><div class="title">' + escapeHtml(i.title) +
        '</div><div class="meta">#' + i.id + ' · ' + escapeHtml(i.author || "") + '</div></div>';
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
      escapeHtml(issue.title) + '</h2><div class="body">' + escapeHtml(issue.body || "") + "</div>";
    document.getElementById("back-issues").onclick = function () {
      detail.style.display = "none";
      document.getElementById("issues-list").style.display = "block";
    };
  }

  function renderPRs() {
    var container = document.getElementById("prs-container");
    if (!container) return;
    var badge = document.getElementById("badge-prs");
    if (badge) badge.textContent = prs.filter(function (p) { return p.state === "open"; }).length;
    if (!prs.length) {
      container.innerHTML = '<div class="empty"><h3>No hay PRs</h3></div>';
      return;
    }
    container.innerHTML = prs.map(function (p) {
      return '<div class="pr-card" data-id="' + p.id + '"><div class="title">' + escapeHtml(p.title) +
        '</div><div class="meta">#' + p.id + " " + escapeHtml(p.head) + " → " + escapeHtml(p.base) + "</div></div>";
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
      escapeHtml(pr.title) + '</h2><div class="body">' + escapeHtml(pr.body || "") + "</div>";
    document.getElementById("back-prs").onclick = function () {
      detail.style.display = "none";
      document.getElementById("prs-list").style.display = "block";
    };
  }

  async function doSync() {
    setStatus("sync…");
    try {
      if (!git) throw new Error("sin git");
      var head = await git.resolveRef({ fs: fs, dir: dir, ref: "HEAD" });
      log("HEAD " + String(head).slice(0, 7), "sync");
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
      var parts = [], i;
      for (i = 0; i < files.length; i++) {
        if (!files[i].isDir) parts.push(files[i].path);
      }
      if (window.webxdc && window.webxdc.sendToChat) {
        await window.webxdc.sendToChat({ text: "GitXDC — " + parts.join(", ") });
      }
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
        var panel = document.getElementById("panel-" + tab.dataset.tab);
        if (panel) panel.classList.add("active");
      });
    });
  }

  function wireCoreButtons() {
    var save = document.getElementById("btn-save");
    if (save) save.onclick = function () { saveFile().catch(function (e) { log(e.message, "error"); }); };
    var sync = document.getElementById("btn-sync");
    if (sync) sync.onclick = function () { doSync(); };
    var exp = document.getElementById("btn-export");
    if (exp) exp.onclick = function () { exportXdc(); };
  }

  function wireAppApi() {
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
      log("ui.js no cargado — usa Log para ver errores", "warn");
    }
  }

  async function boot() {
    setStatus("boot…");
    log("Boot iniciando");

    // Resolver vendors ahora
    git = resolveExport(window.git);
    Y = resolveExport(window.Y);
    LightningFS = resolveExport(window.LightningFS || window.lightningFS);

    var missing = diagnose();
    if (missing.length) {
      log("Faltan: " + missing.join(", "), "error");
      setStatus("faltan: " + missing[0]);
      // Aun así cablear tabs y UI básica
      setupTabs();
      wireCoreButtons();
      wireAppApi();
      renderIssues();
      renderPRs();
      return;
    }

    try {
      myAddr = (window.webxdc && window.webxdc.selfAddr) || "local";
      myName = (window.webxdc && window.webxdc.selfName) || "User";
      log("Usuario " + myName);
      setStatus("webxdc ok");

      if (window.webxdc.setUpdateListener) {
        window.webxdc.setUpdateListener(handleAppUpdate, 0);
      }
      try {
        if (window.webxdc.joinRealtimeChannel) {
          realtime = window.webxdc.joinRealtimeChannel();
          log("Realtime ok");
        }
      } catch (e) { log("Realtime: " + e.message, "warn"); }

      setStatus("fs…");
      await initFS();

      setStatus("yjs…");
      try { initYjs(); } catch (e) { log("Yjs: " + e.message, "warn"); }

      setStatus("git…");
      await initGit();

      setStatus("editor…");
      try {
        if (window.GitXDCEditor && document.getElementById("editor-container")) {
          window.GitXDCEditor.init(document.getElementById("editor-container"));
          window.GitXDCEditor.onChange(function () {
            dirty = true;
            var b = document.getElementById("btn-save");
            if (b) b.disabled = false;
          });
        }
      } catch (e) { log("Editor: " + e.message, "warn"); }

      setupTabs();
      wireCoreButtons();
      wireAppApi();
      renderIssues();
      renderPRs();

      setStatus("listo", true);
      log("GitXDC listo");
    } catch (e) {
      console.error(e);
      setStatus("error: " + (e && e.message ? e.message : e));
      log(String(e && e.stack ? e.stack : e), "error");
      // Intentar UI mínima
      try {
        setupTabs();
        wireCoreButtons();
        wireAppApi();
      } catch (_) {}
    }
  }

  // Esperar a que el DOM y los scripts síncronos terminen
  function start() {
    // micro-delay por si algún script vendor aún no expuso globals
    setTimeout(boot, 0);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
