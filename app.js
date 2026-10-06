/**
 * app.js — GitXDC core (boot tolerante, no se cuelga)
 */
(function () {
  "use strict";

  function resolveExport(mod) {
    if (!mod) return null;
    if (typeof mod === "function") return mod;
    if (mod.default) return mod.default;
    return mod;
  }

  var git = null;
  var Y = null;
  var LightningFS = null;

  var fs = null, pfs = null, dir = "/repo";
  var currentFile = null, dirty = false;
  var issues = [], prs = [];
  var ydoc = null, yrefs = null, realtime = null;
  var myAddr = "", myName = "";

  function log(msg, level) {
    level = level || "info";
    try {
      var el = document.getElementById("log-container");
      if (el) {
        var entry = document.createElement("div");
        entry.className = "log-entry";
        entry.innerHTML =
          '<span class="time">' +
          new Date().toLocaleTimeString() +
          '</span><span class="level-' +
          level +
          '">[' +
          level +
          "]</span> " +
          escapeHtml(String(msg));
        el.appendChild(entry);
        el.scrollTop = el.scrollHeight;
      }
    } catch (_) {}
    try {
      console.log("[GitXDC " + level + "]", msg);
    } catch (_) {}
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

  function withTimeout(promise, ms, label) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var t = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error("timeout " + (label || "") + " (" + ms + "ms)"));
      }, ms);
      promise.then(
        function (v) {
          if (done) return;
          done = true;
          clearTimeout(t);
          resolve(v);
        },
        function (e) {
          if (done) return;
          done = true;
          clearTimeout(t);
          reject(e);
        }
      );
    });
  }

  async function initFS() {
    fs = new LightningFS("gitxdc-fs");
    pfs = fs.promises;
    try {
      await pfs.mkdir(dir);
    } catch (e) {}
    log("FS ok");
  }

  async function initGit() {
    if (!git) {
      log("git ausente — solo FS", "warn");
      await refreshTree();
      return;
    }
    try {
      var files = await pfs.readdir(dir + "/.git");
      if (files && files.length) {
        log("Repo existente");
        var rn = document.getElementById("repo-name");
        if (rn) rn.textContent = "local/repo";
        await refreshTree();
        return;
      }
    } catch (_) {}

    await git.init({ fs: fs, dir: dir, defaultBranch: "main" });
    await pfs.writeFile(dir + "/README.md", "# GitXDC\n\nRepo local.\n", "utf8");
    await git.add({ fs: fs, dir: dir, filepath: "README.md" });
    var sha = await git.commit({
      fs: fs,
      dir: dir,
      message: "Commit inicial",
      author: { name: myName || "GitXDC", email: myAddr || "gitxdc@local" }
    });
    log("Repo nuevo " + String(sha).slice(0, 7));
    var rn2 = document.getElementById("repo-name");
    if (rn2) rn2.textContent = "local/repo";
    await refreshTree();
  }

  function sendAppUpdate(payload, info) {
    try {
      if (window.webxdc && window.webxdc.sendUpdate) {
        window.webxdc.sendUpdate({ payload: payload }, info || "");
      }
    } catch (e) {
      log("sendUpdate: " + e.message, "warn");
    }
  }

  function handleAppUpdate(update) {
    var p = update && update.payload;
    if (!p || typeof p !== "object") return;
    if (p.type === "ISSUE_CREATE") {
      issues.push(p.issue);
      renderIssues();
    } else if (p.type === "PR_CREATE") {
      prs.push(p.pr);
      renderPRs();
    }
  }

  async function listFiles(path) {
    path = path || "";
    if (!pfs) return [];
    var full = dir + (path ? "/" + path : "");
    var entries;
    try {
      entries = await pfs.readdir(full);
    } catch (e) {
      return [];
    }
    var result = [],
      i,
      name,
      rel,
      st;
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
      tree.innerHTML =
        '<div class="empty"><h3>Sin archivos</h3><p>Pulsa + o Importar</p></div>';
      return;
    }
    files.forEach(function (f) {
      var item = document.createElement("div");
      item.className = "tree-item" + (f.isDir ? " dir" : "");
      item.dataset.path = f.path;
      item.innerHTML =
        '<span class="icon">' +
        (f.isDir ? "📁" : "📄") +
        "</span> " +
        escapeHtml(f.name);
      item.addEventListener("click", function () {
        if (!f.isDir) openFile(f.path);
      });
      tree.appendChild(item);
    });
  }

  async function openFile(path) {
    if (!pfs) return;
    if (dirty) {
      log("Cambios sin guardar descartados", "warn");
      dirty = false;
    }
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
    } catch (e) {
      log("Error: " + e.message, "error");
    }
  }

  async function saveFile() {
    if (!currentFile || !pfs) return;
    var content = window.GitXDCEditor ? window.GitXDCEditor.getContent() : "";
    await pfs.writeFile(dir + "/" + currentFile, content, "utf8");
    if (git) {
      try {
        await git.add({ fs: fs, dir: dir, filepath: currentFile });
      } catch (e) {
        log("git add: " + e.message, "warn");
      }
    }
    dirty = false;
    document.getElementById("btn-save").disabled = true;
    log("Guardado: " + currentFile);
  }

  async function createFileAt(name, content) {
    if (!pfs) {
      log("FS no listo", "error");
      return;
    }
    content = content || "";
    var parts = name.split("/"),
      i,
      acc;
    if (parts.length > 1) {
      acc = dir;
      for (i = 0; i < parts.length - 1; i++) {
        acc += "/" + parts[i];
        try {
          await pfs.mkdir(acc);
        } catch (e) {}
      }
    }
    await pfs.writeFile(dir + "/" + name, content, "utf8");
    if (git) {
      try {
        await git.add({ fs: fs, dir: dir, filepath: name });
      } catch (e) {}
    }
    await refreshTree();
    await openFile(name);
    log("Creado: " + name);
  }

  async function doCommit(message) {
    if (!git) {
      log("git no disponible", "error");
      return;
    }
    try {
      var sha = await git.commit({
        fs: fs,
        dir: dir,
        message: message || "Update",
        author: { name: myName || "GitXDC", email: myAddr || "gitxdc@local" }
      });
      log("Commit " + String(sha).slice(0, 7) + " — " + message);
      setStatus("commit " + String(sha).slice(0, 7));
    } catch (e) {
      log("Commit: " + e.message, "error");
    }
  }

  async function importFiles(fileList) {
    if (!pfs || !fileList || !fileList.length) return;
    var n = 0,
      i,
      file,
      name,
      text;
    for (i = 0; i < fileList.length; i++) {
      file = fileList[i];
      try {
        name = file.name.replace(/^.*[\\/]/, "");
        text = await file.text();
        await pfs.writeFile(dir + "/" + name, text, "utf8");
        if (git) {
          try {
            await git.add({ fs: fs, dir: dir, filepath: name });
          } catch (e) {}
        }
        n++;
        log("Importado: " + name);
      } catch (e) {
        log("Import: " + e.message, "error");
      }
    }
    await refreshTree();
    setStatus("importados " + n);
  }

  async function resetRepo() {
    if (!pfs) return;
    try {
      var names = await pfs.readdir(dir),
        i,
        name;
      for (i = 0; i < names.length; i++) {
        name = names[i];
        if (name === ".git") continue;
        try {
          await pfs.unlink(dir + "/" + name);
        } catch (e) {}
      }
    } catch (e) {}
    if (git) {
      try {
        await git.init({ fs: fs, dir: dir, defaultBranch: "main" });
        await pfs.writeFile(dir + "/README.md", "# GitXDC\n\nRepo reiniciado.\n", "utf8");
        await git.add({ fs: fs, dir: dir, filepath: "README.md" });
        var sha = await git.commit({
          fs: fs,
          dir: dir,
          message: "Commit inicial",
          author: { name: myName || "GitXDC", email: myAddr || "gitxdc@local" }
        });
        log("Repo reiniciado " + String(sha).slice(0, 7));
      } catch (e) {
        log("reset git: " + e.message, "error");
      }
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
      id: issues.length + 1,
      title: title,
      body: body || "",
      author: myName || "anon",
      state: "open",
      comments: [],
      created: new Date().toISOString()
    };
    issues.push(issue);
    sendAppUpdate({ type: "ISSUE_CREATE", issue: issue }, "Issue: " + title);
    renderIssues();
  }

  function createPR(title, head, base, body) {
    var pr = {
      id: prs.length + 1,
      title: title,
      head: head || "feature",
      base: base || "main",
      body: body || "",
      author: myName || "anon",
      state: "open",
      created: new Date().toISOString()
    };
    prs.push(pr);
    sendAppUpdate({ type: "PR_CREATE", pr: pr }, "PR: " + title);
    renderPRs();
  }

  function renderIssues() {
    var container = document.getElementById("issues-container");
    if (!container) return;
    var badge = document.getElementById("badge-issues");
    if (badge)
      badge.textContent = issues.filter(function (i) {
        return i.state === "open";
      }).length;
    if (!issues.length) {
      container.innerHTML = '<div class="empty"><h3>No hay issues</h3></div>';
      return;
    }
    container.innerHTML = issues
      .map(function (i) {
        return (
          '<div class="issue-card" data-id="' +
          i.id +
          '"><div class="title">' +
          escapeHtml(i.title) +
          '</div><div class="meta">#' +
          i.id +
          " · " +
          escapeHtml(i.author || "") +
          "</div></div>"
        );
      })
      .join("");
  }

  function renderPRs() {
    var container = document.getElementById("prs-container");
    if (!container) return;
    var badge = document.getElementById("badge-prs");
    if (badge)
      badge.textContent = prs.filter(function (p) {
        return p.state === "open";
      }).length;
    if (!prs.length) {
      container.innerHTML = '<div class="empty"><h3>No hay PRs</h3></div>';
      return;
    }
    container.innerHTML = prs
      .map(function (p) {
        return (
          '<div class="pr-card" data-id="' +
          p.id +
          '"><div class="title">' +
          escapeHtml(p.title) +
          '</div><div class="meta">#' +
          p.id +
          " " +
          escapeHtml(p.head) +
          " → " +
          escapeHtml(p.base) +
          "</div></div>"
        );
      })
      .join("");
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
      var parts = [],
        i;
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
        document.querySelectorAll(".tab").forEach(function (t) {
          t.classList.remove("active");
        });
        document.querySelectorAll(".panel").forEach(function (p) {
          p.classList.remove("active");
        });
        tab.classList.add("active");
        var panel = document.getElementById("panel-" + tab.dataset.tab);
        if (panel) panel.classList.add("active");
      });
    });
  }

  function wireCoreButtons() {
    var save = document.getElementById("btn-save");
    if (save)
      save.onclick = function () {
        saveFile().catch(function (e) {
          log(e.message, "error");
        });
      };
    var sync = document.getElementById("btn-sync");
    if (sync)
      sync.onclick = function () {
        doSync();
      };
    var exp = document.getElementById("btn-export");
    if (exp)
      exp.onclick = function () {
        exportXdc();
      };
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
      try {
        window.GitXDCUI.wire(window.GitXDCApp);
        log("UI modales lista");
      } catch (e) {
        log("UI wire: " + e.message, "error");
      }
    } else {
      log("ui.js no cargado", "warn");
    }
  }

  function finishUi() {
    setupTabs();
    wireCoreButtons();
    wireAppApi();
    renderIssues();
    renderPRs();
  }

  async function boot() {
    setStatus("boot…");
    log("Boot iniciando");

    // 1) UI básica YA (aunque fallen vendors)
    try {
      finishUi();
    } catch (e) {
      log("UI base: " + e.message, "error");
    }

    git = resolveExport(window.git);
    Y = resolveExport(window.Y);
    LightningFS = resolveExport(window.LightningFS || window.lightningFS);

    var missing = [];
    if (!window.webxdc) missing.push("webxdc");
    if (!git) missing.push("git");
    if (!LightningFS) missing.push("LightningFS");
    if (!Y) missing.push("Yjs");
    if (!window.GitXDCEditor) missing.push("editor");
    if (!window.GitXDCUI) missing.push("ui");
    if (missing.length) log("Opcional ausente: " + missing.join(", "), "warn");

    try {
      myAddr = (window.webxdc && window.webxdc.selfAddr) || "local";
      myName = (window.webxdc && window.webxdc.selfName) || "User";
      log("Usuario " + myName);

      if (window.webxdc && window.webxdc.setUpdateListener) {
        try {
          window.webxdc.setUpdateListener(handleAppUpdate, 0);
        } catch (e) {
          log("setUpdateListener: " + e.message, "warn");
        }
      }
      try {
        if (window.webxdc && window.webxdc.joinRealtimeChannel) {
          realtime = window.webxdc.joinRealtimeChannel();
          log("Realtime ok");
        }
      } catch (e) {
        log("Realtime: " + e.message, "warn");
      }

      if (!LightningFS) {
        setStatus("sin FS (vendor)");
        log("Sin LightningFS — no se puede usar el tree", "error");
        return;
      }

      setStatus("fs…");
      await withTimeout(initFS(), 8000, "initFS");

      setStatus("git…");
      try {
        await withTimeout(initGit(), 12000, "initGit");
      } catch (e) {
        log("initGit falló: " + e.message, "error");
        // FS sigue usable sin git
        try {
          await refreshTree();
        } catch (_) {}
      }

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
      } catch (e) {
        log("Editor: " + e.message, "warn");
      }

      setStatus("listo", true);
      log("GitXDC listo");
    } catch (e) {
      console.error(e);
      setStatus("error: " + (e && e.message ? e.message : e));
      log(String(e && e.stack ? e.stack : e), "error");
    }
  }

  function start() {
    // Dar tiempo a scripts vendor síncronos + un frame
    setTimeout(boot, 50);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
