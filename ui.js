/**
 * ui.js — Modales GitXDC (sin prompt). Respeta modo solo lectura.
 */
(function () {
  "use strict";

  function openModal(title, bodyHtml, buttons) {
    var overlay = document.getElementById("modal");
    if (!overlay) {
      console.error("Modal #modal no encontrado");
      return;
    }
    document.getElementById("modal-title").textContent = title;
    document.getElementById("modal-body").innerHTML = bodyHtml;
    var actions = document.getElementById("modal-actions");
    actions.innerHTML = "";
    (buttons || []).forEach(function (b) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = b.label;
      if (b.primary) btn.className = "primary";
      if (b.danger) btn.className = "danger";
      btn.onclick = async function () {
        if (b.close !== false) closeModal();
        if (b.onClick) await b.onClick();
      };
      actions.appendChild(btn);
    });
    overlay.style.display = "flex";
    var closeBtn = document.getElementById("modal-close");
    if (closeBtn) closeBtn.onclick = closeModal;
    overlay.onclick = function (e) {
      if (e.target === overlay) closeModal();
    };
  }

  function closeModal() {
    var overlay = document.getElementById("modal");
    if (overlay) overlay.style.display = "none";
  }

  function denyGuest(app) {
    var owner = app.getOwner ? app.getOwner() : {};
    openModal(
      "Solo lectura",
      "<p>Este repo pertenece a <strong>" +
        (owner.name || owner.addr || "otro usuario") +
        "</strong>.</p>" +
        "<p>Puedes ver el codigo. Los PR se abren desde un <em>clone</em>.</p>",
      [{ label: "Entendido", primary: true }]
    );
  }

  function wire(app) {
    if (!app) {
      console.error("GitXDCApp no disponible");
      return;
    }

    function el(id) {
      return document.getElementById(id);
    }

    function requireWrite(fn) {
      return function () {
        if (app.canWrite && !app.canWrite()) {
          denyGuest(app);
          return;
        }
        return fn.apply(null, arguments);
      };
    }

    if (el("btn-new-file")) {
      el("btn-new-file").onclick = requireWrite(function () {
        openModal(
          "Nuevo archivo",
          '<div class="form-row"><label>Ruta (ej. src/app.js)</label>' +
            '<input type="text" id="modal-filepath" placeholder="archivo.txt" /></div>' +
            '<div class="form-row"><label>Contenido inicial</label>' +
            '<textarea id="modal-filecontent"></textarea></div>',
          [
            { label: "Cancelar" },
            {
              label: "Crear",
              primary: true,
              onClick: async function () {
                var name = (el("modal-filepath").value || "").trim();
                var content = el("modal-filecontent").value || "";
                if (!name) return;
                await app.createFileAt(name, content);
              }
            }
          ]
        );
        setTimeout(function () {
          var i = el("modal-filepath");
          if (i) i.focus();
        }, 30);
      });
    }

    if (el("btn-commit")) {
      el("btn-commit").onclick = requireWrite(function () {
        openModal(
          "Crear commit",
          '<div class="form-row"><label>Mensaje</label>' +
            '<input type="text" id="modal-commit-msg" value="Update" /></div>',
          [
            { label: "Cancelar" },
            {
              label: "Commit",
              primary: true,
              onClick: async function () {
                var msg = (el("modal-commit-msg").value || "").trim() || "Update";
                await app.doCommit(msg);
              }
            }
          ]
        );
      });
    }

    if (el("btn-import") && el("file-import")) {
      el("btn-import").onclick = requireWrite(function () {
        el("file-import").click();
      });
      el("file-import").onchange = function () {
        if (app.canWrite && !app.canWrite()) {
          denyGuest(app);
          el("file-import").value = "";
          return;
        }
        app.importFiles(el("file-import").files);
        el("file-import").value = "";
      };
    }

    if (el("btn-reset-repo")) {
      el("btn-reset-repo").onclick = requireWrite(function () {
        openModal(
          "Reiniciar repositorio",
          '<p style="color:var(--text-muted);margin-bottom:12px">Solo el owner.</p>',
          [
            { label: "Cancelar" },
            {
              label: "Reiniciar",
              danger: true,
              onClick: async function () {
                await app.resetRepo();
              }
            }
          ]
        );
      });
    }

    if (el("btn-new-issue")) {
      el("btn-new-issue").onclick = function () {
        openModal(
          "Nuevo issue",
          '<div class="form-row"><label>Titulo</label><input type="text" id="modal-issue-title" /></div>' +
            '<div class="form-row"><label>Descripcion</label><textarea id="modal-issue-body"></textarea></div>',
          [
            { label: "Cancelar" },
            {
              label: "Crear",
              primary: true,
              onClick: function () {
                var title = (el("modal-issue-title").value || "").trim();
                if (!title) return;
                app.createIssue(title, el("modal-issue-body").value || "");
              }
            }
          ]
        );
      });
    }

    if (el("btn-new-pr")) {
      el("btn-new-pr").onclick = function () {
        openModal(
          "Nuevo pull request",
          '<p style="color:var(--text-muted);font-size:12px;margin-bottom:8px">' +
            "Como en GitHub: solo desde un <strong>repo clonado</strong>. " +
            "Se envia el diff al dueno original; solo el puede hacer merge.</p>" +
            '<div class="form-row"><label>Titulo</label><input type="text" id="modal-pr-title" /></div>' +
            '<div class="form-row"><label>Descripcion</label><textarea id="modal-pr-body"></textarea></div>',
          [
            { label: "Cancelar" },
            {
              label: "Abrir PR",
              primary: true,
              onClick: async function () {
                var title = (el("modal-pr-title").value || "").trim();
                if (!title) return;
                await app.createPR(title, "clone", "main", el("modal-pr-body").value || "");
              }
            }
          ]
        );
      });
    }

    if (el("btn-new-branch")) {
      el("btn-new-branch").onclick = requireWrite(function () {
        openModal(
          "Nueva rama",
          '<div class="form-row"><label>Nombre de la rama</label>' +
            '<input type="text" id="modal-branch-name" placeholder="feature/mi-cambio" /></div>',
          [
            { label: "Cancelar" },
            {
              label: "Crear y cambiar",
              primary: true,
              onClick: async function () {
                var name = (el("modal-branch-name").value || "").trim();
                if (!name) return;
                await app.createBranch(name, true);
              }
            }
          ]
        );
      });
    }
  }

  window.GitXDCUI = { openModal: openModal, closeModal: closeModal, wire: wire };
})();
