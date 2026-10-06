/**
 * app.js — GitXDC core + modo Owner / Solo lectura (estilo GitHub)
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
  var realtime = null;
  var myAddr = "", myName = "";

  // Owner del repo en este chat (como GitHub owner)
  var ownerAddr = null;
  var ownerName = null;
  var ownerClaimed = false;

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
      .replace(/&/g, "&" + "amp;")
      .replace(/</g, "&" + "lt;")
      .replace(/>/g, "&" + "gt;")
      .replace(/"/g, "&" + "quot;");
  }

  function setStatus(text, online) {
    var el = document.getElementById("status");
    if (el) {
      el.textContent = text;
      el.className = "status" + (online ? " online" : "");
    }
  }

  function isOwner() {
    if (!ownerAddr) return true;
    return ownerAddr === myAddr;
  }

  function canWrite() {
    return isOwner();
  }

  function applyAccessMode() {
    var write = canWrite();
    try {
      document.body.classList.toggle("is-guest", !write);
    } catch (_) {}

    var badge = document.getElementById("access-badge");
    if (badge) {
      if (write) {
        badge.textContent = "Owner";
        badge.className = "access-badge owner";
        badge.title = "Eres el dueño: puedes editar código y hacer commit";
      } else {
        badge.textContent = "Solo lectura";
        badge.className = "access-badge guest";
        badge.title =
          "Invitado — owner: " +
          (ownerName || ownerAddr || "?") +
          ". Puedes ver código, abrir issues y PRs.";
      }
    }

    var hint = document.getElementById("ro-hint");
    if (hint) hint.style.display = write ? "none" : "inline";

    var rn = document.getElementById("repo-name");
    if (rn) {
      var who = ownerName || (write ? myName : "user") || "local";
      rn.textContent = who + "/repo";
      rn.title = write
        ? "Tu repositorio (owner)"
        : "Repo de " + (ownerName || ownerAddr) + " — solo lectura";
    }

    log(
      write
        ? "Modo Owner (escritura)"
        : "Modo invitado (solo lectura) — owner " + (ownerName || ownerAddr),
      write ? "info" : "warn"
    );
  }

  function setOwner(addr, name, fromNetwork) {
    if (!addr) return;
    // Primera REPO_META gana (estilo repo ya creado)
    if (ownerAddr && ownerAddr !== addr) {
      log("Owner ya fijado: " + (ownerName || ownerAddr) + " — ignorando " + addr, "warn");
      return;
    }
    ownerAddr = addr;
    ownerName = name || addr;
    applyAccessMode();
    if (!fromNetwork && !ownerClaimed) {
      ownerClaimed = true;
      sendAppUpdate(
        { type: "REPO_META", ownerAddr: ownerAddr, ownerName: ownerName },
        "Owner: " + ownerName
      );
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

    if (p.type === "REPO_META" && p.ownerAddr) {
      setOwner(p.ownerAddr, p.ownerName, true);
      return;
    }
    if (p.type === "ISSUE_CREATE" && p.issue) {
      if (!issues.some(function (i) { return i.id === p.issue.id; })) {
        issues.push(p.issue);
        renderIssues();
      }
    } else if (p.type === "PR_CREATE" && p.pr) {
      if (!prs.some(function (x) { return x.id === p.pr.id; })) {
        prs.push(p.pr);
        renderPRs();
      }
    } else if (p.type === "PR_MERGE") {
      var pr = prs.find(function (x) { return x.id === p.prId; });
      if (pr) {
        pr.state = "merged";
        renderPRs();
      }
    } else if (p.type === "PR_CLOSE") {
      var pr2 = prs.find(function (x) { return x.id === p.prId; });
      if (pr2) {
        pr2.state = "closed";
        renderPRs();
      }
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
      tree.innerHTML =
        '<div class="empty"><h3>Sin archivos</h3><p>' +
        (canWrite() ? "Pulsa + o Importar" : "Repo vacío (solo lectura)") +
        "</p></div>";
      return;
    }
    files.forEach(function (f) {
      var item = document.createElement("div");
      item.className = "tree-item" + (f.isDir ? " dir" : "");
      item.dataset.path = f.path;
      item.innerHTML =
        '<span class="icon">' +
        (f.isDir ? "\uD83D\uDCC1" : "\uD83D\uDCC4") +
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
    if (dirty && canWrite()) {
      log("Cambios sin guardar descartados", "warn");
      dirty = false;
    }
    try {
      var content = await pfs.readFile(dir + "/" + path, "utf8");
      currentFile = path;
      document.getElementById("editor-path").textContent = path;
      var saveBtn = document.getElementById("btn-save");
      if (saveBtn) saveBtn.disabled = true;
      if (window.GitXDCEditor) window.GitXDCEditor.setContent(content, path);
      document.querySelectorAll(".tree-item").forEach(function (el) {
        el.classList.toggle("active", el.dataset.path === path);
      });
      log("Abierto: " + path + (canWrite() ? "" : " (solo lectura)"));
    } catch (e) {
      log("Error: " + e.message, "error");
    }
  }

  function denyWrite(action) {
    log("Solo lectura: no puedes " + action + " (no eres el owner)", "warn");
    if (window.GitXDCUI && window.GitXDCUI.openModal) {
      window.GitXDCUI.openModal(
        "Solo lectura",
        "<p>Este repo pertenece a <strong>" +
          escapeHtml(ownerName || ownerAddr || "?") +
          "</strong>.</p><p>Como invitado puedes ver el código, abrir issues y proponer PRs — como en un repo público de GitHub.</p>",
        [{ label: "Entendido", primary: true }]
      );
    }
  }

  async function saveFile() {
    if (!canWrite()) return denyWrite("guardar");
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
    if (!canWrite()) return denyWrite("crear archivos");
    if (!pfs) {
      log("FS no listo", "error");
      return;
    }
    content = content || "";
    var parts = name.split("/"), i, acc;
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
    if (!canWrite()) return denyWrite("hacer commit");
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
    if (!canWrite()) return denyWrite("importar");
    if (!pfs || !fileList || !fileList.length) return;
    var n = 0, i, file, name, text;
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
    if (!canWrite()) return denyWrite("reiniciar el repo");
    if (!pfs) return;
    try {
      var names = await pfs.readdir(dir), i, name;
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
    document.getElementById("editor-path").textContent = "-";
    document.getElementById("btn-save").disabled = true;
    if (window.GitXDCEditor) window.GitXDCEditor.clear();
    await refreshTree();
    setStatus("repo nuevo", true);
  }

  function createIssue(title, body) {
    var issue = {
      id: issues.length + 1,
      title: title,
      body: body || "",
      author: myName || "anon",
      authorAddr: myAddr,
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
      authorAddr: myAddr,
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
          " · " +
          escapeHtml(p.author || "") +
          "</div></div>"
        );
      })
      .join("");
  }

  async function doSync() {
    setStatus("sync...");
    try {
      if (!git) throw new Error("sin git");
      var head = await git.resolveRef({ fs: fs, dir: dir, ref: "HEAD" });
      log("HEAD " + String(head).slice(0, 7), "sync");
      if (canWrite() && ownerAddr) {
        sendAppUpdate(
          { type: "REPO_META", ownerAddr: ownerAddr, ownerName: ownerName },
          "Owner broadcast"
        );
      }
      setStatus("sync ok", true);
    } catch (e) {
      log("Sync: " + e.message, "error");
      setStatus("error sync");
    }
  }

  async function exportXdc() {
    setStatus("export...");
    try {
      var files = await listFiles();
      var parts = [], i;
      for (i = 0; i < files.length; i++) {
        if (!files[i].isDir) parts.push(files[i].path);
      }
      if (window.webxdc && window.webxdc.sendToChat) {
        await window.webxdc.sendToChat({
          text:
            "GitXDC " +
            (ownerName || "local") +
            "/repo — " +
            parts.join(", ")
        });
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
      createPR: createPR,
      canWrite: canWrite,
      isOwner: isOwner,
      getOwner: function () {
        return { addr: ownerAddr, name: ownerName };
      }
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
    applyAccessMode();
  }

  async function boot() {
    setStatus("boot...");
    log("Boot iniciando");

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
    if (!window.GitXDCEditor) missing.push("editor");
    if (!window.GitXDCUI) missing.push("ui");
    if (missing.length) log("Opcional ausente: " + missing.join(", "), "warn");

    try {
      myAddr = (window.webxdc && window.webxdc.selfAddr) || "local";
      myName = (window.webxdc && window.webxdc.selfName) || "User";
      log("Usuario " + myName + " (" + myAddr + ")");

      if (window.webxdc && window.webxdc.setUpdateListener) {
        try {
          // serial 0: recibe historial → puede traer REPO_META del owner
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

      // Esperar un poco a updates históricos; si no hay owner, reclamamos
      setTimeout(function () {
        if (!ownerAddr) {
          setOwner(myAddr, myName, false);
          log("Reclamado ownership (primer participante / sin REPO_META previo)");
        } else {
          applyAccessMode();
        }
      }, 400);

      if (!LightningFS) {
        setStatus("sin FS (vendor)");
        log("Sin LightningFS — no se puede usar el tree", "error");
        return;
      }

      setStatus("fs...");
      await withTimeout(initFS(), 8000, "initFS");

      setStatus("git...");
      try {
        await withTimeout(initGit(), 12000, "initGit");
      } catch (e) {
        log("initGit fallo: " + e.message, "error");
        try {
          await refreshTree();
        } catch (_) {}
      }

      setStatus("editor...");
      try {
        if (window.GitXDCEditor && document.getElementById("editor-container")) {
          window.GitXDCEditor.init(document.getElementById("editor-container"));
          window.GitXDCEditor.onChange(function () {
            if (!canWrite()) return;
            dirty = true;
            var b = document.getElementById("btn-save");
            if (b) b.disabled = false;
          });
        }
      } catch (e) {
        log("Editor: " + e.message, "warn");
      }

      applyAccessMode();
      setStatus("listo", true);
      log("GitXDC listo");
    } catch (e) {
      console.error(e);
      setStatus("error: " + (e && e.message ? e.message : e));
      log(String(e && e.stack ? e.stack : e), "error");
    }
  }

  function start() {
    setTimeout(boot, 50);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
