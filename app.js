/**
 * app.js — GitXDC
 * - Cada usuario tiene SUS repos (pantalla Inicio)
 * - Comparte un enlace personal → otro abre en modo invitado
 * - Invitado: ver, clonar, abrir PR
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
  var LightningFS = null;
  var fs = null;
  var pfs = null;

  var myAddr = "";
  var myName = "";

  // Catalogo local: { id, name, ownerAddr, ownerName }
  var myRepos = [];
  var currentRepo = null; // { id, name, ownerAddr, ownerName }
  var viewMode = "home"; // home | owner | guest
  var guestSnapshot = null; // { files: { path: content } } cuando invitamos
  var pendingSnapshots = {}; // key ownerAddr+repoId -> snapshot

  var currentFile = null;
  var dirty = false;
  var issues = [];
  var prs = [];

  var META_KEY = "gitxdc-meta-v1";

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

  function repoDir(repoId) {
    return "/repos/" + repoId;
  }

  function canWrite() {
    return viewMode === "owner";
  }

  function isGuest() {
    return viewMode === "guest";
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

  function uid() {
    return (
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 8)
    );
  }

  // ── Persistencia catalogo ──
  async function loadCatalog() {
    try {
      var raw = await pfs.readFile("/" + META_KEY, "utf8");
      var data = JSON.parse(raw);
      myRepos = data.repos || [];
    } catch (_) {
      myRepos = [];
    }
  }

  async function saveCatalog() {
    await pfs.writeFile(
      "/" + META_KEY,
      JSON.stringify({ repos: myRepos }),
      "utf8"
    );
  }

  // ── Enlace de invitacion ──
  function buildInviteLink(repo) {
    var payload = {
      v: 1,
      type: "gitxdc-invite",
      ownerAddr: repo.ownerAddr,
      ownerName: repo.ownerName,
      repoId: repo.id,
      repoName: repo.name
    };
    var b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    return "gitxdc://invite/" + b64;
  }

  function parseInviteLink(text) {
    text = (text || "").trim();
    var m = text.match(/gitxdc:\/\/invite\/([A-Za-z0-9+/=_-]+)/);
    if (!m) {
      // tambien aceptar JSON pegado
      try {
        var j = JSON.parse(text);
        if (j && j.type === "gitxdc-invite") return j;
      } catch (_) {}
      return null;
    }
    try {
      var json = decodeURIComponent(escape(atob(m[1])));
      var obj = JSON.parse(json);
      if (obj && obj.type === "gitxdc-invite") return obj;
    } catch (_) {}
    return null;
  }

  // ── Vistas ──
  function showHome() {
    viewMode = "home";
    currentRepo = null;
    guestSnapshot = null;
    document.getElementById("view-home").classList.add("active");
    document.getElementById("view-repo").classList.remove("active");
    document.getElementById("repo-name").textContent = "Mis repos";
    document.getElementById("access-badge").textContent = myName || "yo";
    document.getElementById("access-badge").className = "access-badge owner";
    document.body.classList.remove("is-guest");
    setHeaderButtons("home");
    renderRepoList();
  }

  function setHeaderButtons(mode) {
    var map = {
      home: {
        "btn-home": false,
        "btn-open-link": true,
        "btn-share": false,
        "btn-clone": false,
        "btn-sync": false,
        "btn-commit": false,
        "btn-export": false
      },
      owner: {
        "btn-home": true,
        "btn-open-link": true,
        "btn-share": true,
        "btn-clone": false,
        "btn-sync": true,
        "btn-commit": true,
        "btn-export": true
      },
      guest: {
        "btn-home": true,
        "btn-open-link": true,
        "btn-share": false,
        "btn-clone": true,
        "btn-sync": true,
        "btn-commit": false,
        "btn-export": false
      }
    };
    var cfg = map[mode] || map.home;
    Object.keys(cfg).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.display = cfg[id] ? "" : "none";
    });
  }

  function openOwnerRepo(repo) {
    viewMode = "owner";
    currentRepo = repo;
    guestSnapshot = null;
    document.getElementById("view-home").classList.remove("active");
    document.getElementById("view-repo").classList.add("active");
    document.body.classList.remove("is-guest");
    document.getElementById("repo-name").textContent =
      (repo.ownerName || "me") + "/" + repo.name;
    document.getElementById("access-badge").textContent = "Owner";
    document.getElementById("access-badge").className = "access-badge owner";
    document.getElementById("ro-hint").style.display = "none";
    setHeaderButtons("owner");
    refreshTree();
    log("Repo propio: " + repo.name);
  }

  function openGuestRepo(invite, snapshot) {
    viewMode = "guest";
    currentRepo = {
      id: invite.repoId,
      name: invite.repoName || invite.repoId,
      ownerAddr: invite.ownerAddr,
      ownerName: invite.ownerName || invite.ownerAddr
    };
    guestSnapshot = snapshot || { files: {} };
    document.getElementById("view-home").classList.remove("active");
    document.getElementById("view-repo").classList.add("active");
    document.body.classList.add("is-guest");
    document.getElementById("repo-name").textContent =
      currentRepo.ownerName + "/" + currentRepo.name;
    document.getElementById("access-badge").textContent = "Invitado";
    document.getElementById("access-badge").className = "access-badge guest";
    document.getElementById("ro-hint").style.display = "inline";
    setHeaderButtons("guest");
    refreshTree();
    log(
      "Modo invitado: " +
        currentRepo.ownerName +
        "/" +
        currentRepo.name +
        " — puedes clonar y abrir PR"
    );
  }

  function renderRepoList() {
    var list = document.getElementById("repo-list");
    if (!list) return;
    if (!myRepos.length) {
      list.innerHTML =
        '<div class="empty"><h3>Sin repositorios</h3><p>Crea el primero o abre un enlace</p></div>';
      return;
    }
    list.innerHTML = myRepos
      .map(function (r) {
        return (
          '<div class="repo-card" data-id="' +
          escapeHtml(r.id) +
          '">' +
          '<div class="repo-card-title">' +
          escapeHtml(r.name) +
          "</div>" +
          '<div class="repo-card-meta">' +
          escapeHtml(r.ownerName || "yo") +
          "/" +
          escapeHtml(r.name) +
          "</div></div>"
        );
      })
      .join("");
    list.querySelectorAll(".repo-card").forEach(function (card) {
      card.onclick = function () {
        var id = card.getAttribute("data-id");
        var r = myRepos.find(function (x) {
          return x.id === id;
        });
        if (r) openOwnerRepo(r);
      };
    });
  }

  // ── FS / git por repo ──
  async function ensureRepoFs(repo) {
    var d = repoDir(repo.id);
    try {
      await pfs.mkdir("/repos");
    } catch (e) {}
    try {
      await pfs.mkdir(d);
    } catch (e) {}
    if (!git) return d;
    try {
      var files = await pfs.readdir(d + "/.git");
      if (files && files.length) return d;
    } catch (_) {}
    await git.init({ fs: fs, dir: d, defaultBranch: "main" });
    await pfs.writeFile(
      d + "/README.md",
      "# " + repo.name + "\n\nRepo de " + (repo.ownerName || myName) + ".\n",
      "utf8"
    );
    await git.add({ fs: fs, dir: d, filepath: "README.md" });
    await git.commit({
      fs: fs,
      dir: d,
      message: "Commit inicial",
      author: { name: myName || "GitXDC", email: myAddr || "gitxdc@local" }
    });
    return d;
  }

  async function listFilesLocal(repo) {
    var d = repoDir(repo.id);
    var entries;
    try {
      entries = await pfs.readdir(d);
    } catch (e) {
      return [];
    }
    var result = [],
      i,
      name,
      st;
    for (i = 0; i < entries.length; i++) {
      name = entries[i];
      if (name === ".git") continue;
      try {
        st = await pfs.stat(d + "/" + name);
        result.push({ name: name, path: name, isDir: st.isDirectory() });
      } catch (e) {}
    }
    result.sort(function (a, b) {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return result;
  }

  async function collectAllFiles(repo) {
    var d = repoDir(repo.id);
    var out = {};
    async function walk(rel) {
      var base = d + (rel ? "/" + rel : "");
      var entries;
      try {
        entries = await pfs.readdir(base);
      } catch (e) {
        return;
      }
      var i, name, path, st;
      for (i = 0; i < entries.length; i++) {
        name = entries[i];
        if (name === ".git") continue;
        path = rel ? rel + "/" + name : name;
        st = await pfs.stat(d + "/" + path);
        if (st.isDirectory()) await walk(path);
        else {
          try {
            out[path] = await pfs.readFile(d + "/" + path, "utf8");
          } catch (e) {}
        }
      }
    }
    await walk("");
    return out;
  }

  async function refreshTree() {
    var tree = document.getElementById("file-tree");
    if (!tree || !currentRepo) return;
    tree.innerHTML = "";
    var files;
    if (viewMode === "guest") {
      var paths = Object.keys((guestSnapshot && guestSnapshot.files) || {});
      files = paths.map(function (p) {
        return { name: p, path: p, isDir: false };
      });
    } else {
      files = await listFilesLocal(currentRepo);
    }
    if (!files.length) {
      tree.innerHTML =
        '<div class="empty"><h3>Sin archivos</h3></div>';
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
    if (!currentRepo) return;
    try {
      var content = "";
      if (viewMode === "guest") {
        content =
          (guestSnapshot &&
            guestSnapshot.files &&
            guestSnapshot.files[path]) ||
          "";
      } else {
        content = await pfs.readFile(
          repoDir(currentRepo.id) + "/" + path,
          "utf8"
        );
      }
      currentFile = path;
      dirty = false;
      document.getElementById("editor-path").textContent = path;
      var saveBtn = document.getElementById("btn-save");
      if (saveBtn) saveBtn.disabled = true;
      if (window.GitXDCEditor)
        window.GitXDCEditor.setContent(content, path);
      log("Abierto: " + path + (isGuest() ? " (invitado)" : ""));
    } catch (e) {
      log("Error: " + e.message, "error");
    }
  }

  async function createRepo(name) {
    name = (name || "").trim() || "repo";
    var repo = {
      id: uid(),
      name: name,
      ownerAddr: myAddr,
      ownerName: myName
    };
    await ensureRepoFs(repo);
    myRepos.push(repo);
    await saveCatalog();
    renderRepoList();
    openOwnerRepo(repo);
    log("Repo creado: " + name);
  }

  async function saveFile() {
    if (!canWrite() || !currentRepo || !currentFile) return;
    var content = window.GitXDCEditor
      ? window.GitXDCEditor.getContent()
      : "";
    var d = repoDir(currentRepo.id);
    await pfs.writeFile(d + "/" + currentFile, content, "utf8");
    if (git) {
      try {
        await git.add({ fs: fs, dir: d, filepath: currentFile });
      } catch (e) {}
    }
    dirty = false;
    document.getElementById("btn-save").disabled = true;
    log("Guardado: " + currentFile);
  }

  async function createFileAt(name, content) {
    if (!canWrite() || !currentRepo) return;
    content = content || "";
    var d = repoDir(currentRepo.id);
    var parts = name.split("/"), i, acc = d;
    if (parts.length > 1) {
      for (i = 0; i < parts.length - 1; i++) {
        acc += "/" + parts[i];
        try {
          await pfs.mkdir(acc);
        } catch (e) {}
      }
    }
    await pfs.writeFile(d + "/" + name, content, "utf8");
    if (git) {
      try {
        await git.add({ fs: fs, dir: d, filepath: name });
      } catch (e) {}
    }
    await refreshTree();
    await openFile(name);
  }

  async function doCommit(message) {
    if (!canWrite() || !currentRepo || !git) return;
    var d = repoDir(currentRepo.id);
    try {
      var sha = await git.commit({
        fs: fs,
        dir: d,
        message: message || "Update",
        author: { name: myName || "GitXDC", email: myAddr || "gitxdc@local" }
      });
      log("Commit " + String(sha).slice(0, 7));
      // Publicar snapshot para invitados
      await publishSnapshot(currentRepo);
    } catch (e) {
      log("Commit: " + e.message, "error");
    }
  }

  async function importFiles(fileList) {
    if (!canWrite() || !currentRepo || !fileList) return;
    var d = repoDir(currentRepo.id);
    var n = 0, i, file, name, text;
    for (i = 0; i < fileList.length; i++) {
      file = fileList[i];
      try {
        name = file.name.replace(/^.*[\\/]/, "");
        text = await file.text();
        await pfs.writeFile(d + "/" + name, text, "utf8");
        if (git) {
          try {
            await git.add({ fs: fs, dir: d, filepath: name });
          } catch (e) {}
        }
        n++;
      } catch (e) {
        log("Import: " + e.message, "error");
      }
    }
    await refreshTree();
    setStatus("importados " + n);
  }

  async function resetRepo() {
    if (!canWrite() || !currentRepo) return;
    log("Reinicio no implementado en multi-repo (borra y crea de nuevo)", "warn");
  }

  async function publishSnapshot(repo) {
    var files = await collectAllFiles(repo);
    sendAppUpdate(
      {
        type: "REPO_SNAPSHOT",
        ownerAddr: repo.ownerAddr,
        ownerName: repo.ownerName,
        repoId: repo.id,
        repoName: repo.name,
        files: files
      },
      "Snapshot " + repo.name
    );
    log("Snapshot publicado (" + Object.keys(files).length + " archivos)");
  }

  function shareCurrentRepo() {
    if (!currentRepo || viewMode !== "owner") return;
    var link = buildInviteLink(currentRepo);
    publishSnapshot(currentRepo);
    if (window.webxdc && window.webxdc.sendToChat) {
      window.webxdc.sendToChat({
        text:
          "GitXDC — repo de " +
          currentRepo.ownerName +
          "/" +
          currentRepo.name +
          "\nAbre este enlace en GitXDC (Abrir enlace):\n" +
          link
      });
    }
    if (window.GitXDCUI) {
      window.GitXDCUI.openModal(
        "Enlace para invitados",
        '<p>Cualquiera en el chat puede pegar este enlace en <strong>Abrir enlace</strong>:</p>' +
          '<div class="form-row"><textarea id="modal-invite-link" readonly rows="4">' +
          escapeHtml(link) +
          "</textarea></div>",
        [{ label: "Cerrar", primary: true }]
      );
    }
    log("Enlace de invitación generado");
  }

  function requestSnapshot(invite) {
    sendAppUpdate(
      {
        type: "WANT_SNAPSHOT",
        fromAddr: myAddr,
        fromName: myName,
        ownerAddr: invite.ownerAddr,
        repoId: invite.repoId
      },
      "Want snapshot"
    );
  }

  async function openInviteFromText(text) {
    var invite = parseInviteLink(text);
    if (!invite) {
      log("Enlace inválido", "error");
      if (window.GitXDCUI) {
        window.GitXDCUI.openModal(
          "Enlace inválido",
          "<p>Pega un enlace <code>gitxdc://invite/…</code> generado con Compartir.</p>",
          [{ label: "Ok", primary: true }]
        );
      }
      return;
    }
    if (invite.ownerAddr === myAddr) {
      var mine = myRepos.find(function (r) {
        return r.id === invite.repoId;
      });
      if (mine) {
        openOwnerRepo(mine);
        return;
      }
    }
    var key = invite.ownerAddr + "::" + invite.repoId;
    var snap = pendingSnapshots[key];
    openGuestRepo(invite, snap || { files: {} });
    if (!snap || !Object.keys(snap.files || {}).length) {
      requestSnapshot(invite);
      setStatus("pidiendo snapshot…");
      log("Solicitando snapshot al owner…");
    }
  }

  async function cloneGuestRepo() {
    if (viewMode !== "guest" || !currentRepo) return;
    var files =
      (guestSnapshot && guestSnapshot.files) || {};
    var name = currentRepo.name + "-clone";
    var repo = {
      id: uid(),
      name: name,
      ownerAddr: myAddr,
      ownerName: myName,
      clonedFrom: {
        ownerAddr: currentRepo.ownerAddr,
        ownerName: currentRepo.ownerName,
        repoId: currentRepo.id,
        repoName: currentRepo.name
      }
    };
    await ensureRepoFs(repo);
    var d = repoDir(repo.id);
    var paths = Object.keys(files), i, p, parts, acc, j;
    for (i = 0; i < paths.length; i++) {
      p = paths[i];
      parts = p.split("/");
      if (parts.length > 1) {
        acc = d;
        for (j = 0; j < parts.length - 1; j++) {
          acc += "/" + parts[j];
          try {
            await pfs.mkdir(acc);
          } catch (e) {}
        }
      }
      await pfs.writeFile(d + "/" + p, files[p], "utf8");
      if (git) {
        try {
          await git.add({ fs: fs, dir: d, filepath: p });
        } catch (e) {}
      }
    }
    if (git) {
      try {
        await git.commit({
          fs: fs,
          dir: d,
          message: "Clone de " + currentRepo.ownerName + "/" + currentRepo.name,
          author: { name: myName || "GitXDC", email: myAddr || "gitxdc@local" }
        });
      } catch (e) {}
    }
    myRepos.push(repo);
    await saveCatalog();
    log("Clonado como " + name + " (" + paths.length + " archivos)");
    openOwnerRepo(repo);
  }

  function createIssue(title, body) {
    if (!currentRepo) return;
    var issue = {
      id: issues.length + 1,
      title: title,
      body: body || "",
      author: myName,
      authorAddr: myAddr,
      repoId: currentRepo.id,
      state: "open",
      created: new Date().toISOString()
    };
    issues.push(issue);
    sendAppUpdate(
      {
        type: "ISSUE_CREATE",
        repoId: currentRepo.id,
        ownerAddr: currentRepo.ownerAddr,
        issue: issue
      },
      "Issue: " + title
    );
    renderIssues();
  }

  function createPR(title, head, base, body) {
    if (!currentRepo) return;
    var pr = {
      id: prs.length + 1,
      title: title,
      head: head || "feature",
      base: base || "main",
      body: body || "",
      author: myName,
      authorAddr: myAddr,
      // PR hacia el repo que estamos viendo (owner) o, si somos owner de un clone, hacia el origen
      targetOwnerAddr: currentRepo.clonedFrom
        ? currentRepo.clonedFrom.ownerAddr
        : currentRepo.ownerAddr,
      targetRepoId: currentRepo.clonedFrom
        ? currentRepo.clonedFrom.repoId
        : currentRepo.id,
      targetRepoName: currentRepo.clonedFrom
        ? currentRepo.clonedFrom.repoName
        : currentRepo.name,
      sourceRepoId: currentRepo.id,
      sourceRepoName: currentRepo.name,
      state: "open",
      created: new Date().toISOString()
    };
    prs.push(pr);
    sendAppUpdate({ type: "PR_CREATE", pr: pr }, "PR: " + title);
    renderPRs();
    log("PR abierto hacia " + pr.targetOwnerAddr + "/" + pr.targetRepoName);
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
          '<div class="issue-card"><div class="title">' +
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
          '<div class="pr-card"><div class="title">' +
          escapeHtml(p.title) +
          '</div><div class="meta">#' +
          p.id +
          " · " +
          escapeHtml(p.author || "") +
          " → " +
          escapeHtml(p.targetRepoName || "") +
          "</div></div>"
        );
      })
      .join("");
  }

  function handleAppUpdate(update) {
    var p = update && update.payload;
    if (!p || typeof p !== "object") return;

    if (p.type === "REPO_SNAPSHOT" && p.ownerAddr && p.repoId) {
      var key = p.ownerAddr + "::" + p.repoId;
      pendingSnapshots[key] = { files: p.files || {} };
      log("Snapshot recibido de " + (p.ownerName || p.ownerAddr) + "/" + p.repoName);
      if (
        viewMode === "guest" &&
        currentRepo &&
        currentRepo.ownerAddr === p.ownerAddr &&
        currentRepo.id === p.repoId
      ) {
        guestSnapshot = pendingSnapshots[key];
        refreshTree();
        setStatus("snapshot ok", true);
      }
      return;
    }

    if (p.type === "WANT_SNAPSHOT") {
      // Solo el owner responde
      if (p.ownerAddr !== myAddr) return;
      var repo = myRepos.find(function (r) {
        return r.id === p.repoId;
      });
      if (repo) {
        publishSnapshot(repo);
        log("Respondiendo WANT_SNAPSHOT a " + (p.fromName || p.fromAddr));
      }
      return;
    }

    if (p.type === "ISSUE_CREATE" && p.issue) {
      if (!issues.some(function (i) {
        return i.id === p.issue.id && i.authorAddr === p.issue.authorAddr;
      })) {
        issues.push(p.issue);
        renderIssues();
      }
    }
    if (p.type === "PR_CREATE" && p.pr) {
      if (!prs.some(function (x) {
        return x.id === p.pr.id && x.authorAddr === p.pr.authorAddr;
      })) {
        prs.push(p.pr);
        renderPRs();
      }
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

  function promptOpenLink() {
    if (!window.GitXDCUI) return;
    window.GitXDCUI.openModal(
      "Abrir enlace de repo",
      '<p>Pega el enlace <code>gitxdc://invite/…</code> que te compartieron:</p>' +
        '<div class="form-row"><textarea id="modal-link-input" rows="4" placeholder="gitxdc://invite/..."></textarea></div>',
      [
        { label: "Cancelar" },
        {
          label: "Abrir",
          primary: true,
          onClick: function () {
            var t = document.getElementById("modal-link-input");
            openInviteFromText(t ? t.value : "");
          }
        }
      ]
    );
  }

  function promptNewRepo() {
    if (!window.GitXDCUI) return;
    window.GitXDCUI.openModal(
      "Nuevo repositorio",
      '<div class="form-row"><label>Nombre</label>' +
        '<input type="text" id="modal-repo-name" placeholder="mi-proyecto" /></div>',
      [
        { label: "Cancelar" },
        {
          label: "Crear",
          primary: true,
          onClick: function () {
            var t = document.getElementById("modal-repo-name");
            createRepo(t ? t.value : "repo");
          }
        }
      ]
    );
  }

  function wireUi() {
    setupTabs();

    var home = document.getElementById("btn-home");
    if (home) home.onclick = showHome;

    var openL = document.getElementById("btn-open-link");
    if (openL) openL.onclick = promptOpenLink;
    var openLH = document.getElementById("btn-open-link-home");
    if (openLH) openLH.onclick = promptOpenLink;

    var share = document.getElementById("btn-share");
    if (share) share.onclick = shareCurrentRepo;

    var clone = document.getElementById("btn-clone");
    if (clone)
      clone.onclick = function () {
        cloneGuestRepo();
      };

    var newRepo = document.getElementById("btn-new-repo");
    if (newRepo) newRepo.onclick = promptNewRepo;

    var save = document.getElementById("btn-save");
    if (save)
      save.onclick = function () {
        saveFile();
      };

    var sync = document.getElementById("btn-sync");
    if (sync)
      sync.onclick = function () {
        if (viewMode === "owner" && currentRepo) publishSnapshot(currentRepo);
        else if (viewMode === "guest" && currentRepo) {
          requestSnapshot({
            ownerAddr: currentRepo.ownerAddr,
            repoId: currentRepo.id
          });
        }
      };

    window.GitXDCApp = {
      createFileAt: createFileAt,
      doCommit: doCommit,
      importFiles: importFiles,
      resetRepo: resetRepo,
      createIssue: createIssue,
      createPR: createPR,
      canWrite: canWrite,
      isOwner: canWrite,
      getOwner: function () {
        return currentRepo
          ? { addr: currentRepo.ownerAddr, name: currentRepo.ownerName }
          : {};
      }
    };
    if (window.GitXDCUI && window.GitXDCUI.wire) {
      window.GitXDCUI.wire(window.GitXDCApp);
    }
  }

  async function boot() {
    setStatus("boot...");
    log("Boot GitXDC multi-repo");

    git = resolveExport(window.git);
    LightningFS = resolveExport(window.LightningFS || window.lightningFS);

    myAddr = (window.webxdc && window.webxdc.selfAddr) || "local";
    myName = (window.webxdc && window.webxdc.selfName) || "User";

    wireUi();

    if (window.webxdc && window.webxdc.setUpdateListener) {
      try {
        window.webxdc.setUpdateListener(handleAppUpdate, 0);
      } catch (e) {
        log("setUpdateListener: " + e.message, "warn");
      }
    }

    if (!LightningFS) {
      setStatus("sin FS");
      log("LightningFS no cargado", "error");
      showHome();
      return;
    }

    try {
      fs = new LightningFS("gitxdc-fs");
      pfs = fs.promises;
      try {
        await pfs.mkdir("/repos");
      } catch (e) {}
      await loadCatalog();

      if (window.GitXDCEditor) {
        window.GitXDCEditor.init(
          document.getElementById("editor-container")
        );
        window.GitXDCEditor.onChange(function () {
          if (!canWrite()) return;
          dirty = true;
          var b = document.getElementById("btn-save");
          if (b) b.disabled = false;
        });
      }

      showHome();
      setStatus("listo", true);
      log("Listo — usuario " + myName);
    } catch (e) {
      setStatus("error: " + (e.message || e));
      log(String(e.stack || e), "error");
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
