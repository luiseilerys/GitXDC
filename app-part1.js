/**
 * app.js — GitXDC (part 1/2 — concatenated by build.sh)
 * - Cada usuario tiene SUS repos (pantalla Inicio)
 * - Comparte un enlace personal → otro abre en modo invitado
 * - Invitado: ver, clonar, abrir PR
 * - PR solo desde clone, con diff, merge solo del owner original
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

  var myRepos = [];
  var currentRepo = null;
  var viewMode = "home";
  var guestSnapshot = null;
  var pendingSnapshots = {};

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
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

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
    var rh = document.getElementById("ro-hint");
    if (rh) rh.style.display = "none";
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
    var rh = document.getElementById("ro-hint");
    if (rh) rh.style.display = "inline";
    setHeaderButtons("guest");
    refreshTree();
    log("Modo invitado: " + currentRepo.ownerName + "/" + currentRepo.name);
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
          '"><div class="repo-card-title">' +
          escapeHtml(r.name) +
          '</div><div class="repo-card-meta">' +
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
    var result = [], i, name, st;
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

  /* --- continued in app-part2.js --- */
