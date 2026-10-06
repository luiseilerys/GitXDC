/**
 * ui.js — Modales e importación de archivos para GitXDC
 * No usa prompt()/confirm() (bloqueados en webxdc).
 */
(function () {
  "use strict";

  function openModal(title, bodyHtml, buttons) {
    const overlay = document.getElementById("modal");
    if (!overlay) {
      console.error("Modal #modal no encontrado en el DOM");
      return;
    }
    document.getElementById("modal-title").textContent = title;
    document.getElementById("modal-body").innerHTML = bodyHtml;
    const actions = document.getElementById("modal-actions");
    actions.innerHTML = "";
    (buttons || []).forEach(function (b) {
      const btn = document.createElement("button");
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
    const closeBtn = document.getElementById("modal-close");
    if (closeBtn) closeBtn.onclick = closeModal;
    overlay.onclick = function (e) {
      if (e.target === overlay) closeModal();
    };
  }

  function closeModal() {
    const overlay = document.getElementById("modal");
    if (overlay) overlay.style.display = "none";
  }

  function wire(app) {
    if (!app) {
      console.error("GitXDCApp no disponible");
      return;
    }

    function el(id) {
      return document.getElementById(id);
    }

    if (el("btn-new-file")) {
      el("btn-new-file").onclick = function () {
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
                const name = (el("modal-filepath").value || "").trim();
                const content = el("modal-filecontent").value || "";
                if (!name) return;
                await app.createFileAt(name, content);
              }
            }
          ]
        );
        setTimeout(function () {
          const i = el("modal-filepath");
          if (i) i.focus();
        }, 30);
      };
    }

    if (el("btn-commit")) {
      el("btn-commit").onclick = function () {
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
                const msg = (el("modal-commit-msg").value || "").trim() || "Update";
                await app.doCommit(msg);
              }
            }
          ]
        );
      };
    }

    if (el("btn-import") && el("file-import")) {
      el("btn-import").onclick = function () {
        el("file-import").click();
      };
      el("file-import").onchange = function () {
        app.importFiles(el("file-import").files);
        el("file-import").value = "";
      };
    }

    if (el("btn-reset-repo")) {
      el("btn-reset-repo").onclick = function () {
        openModal(
          "Reiniciar repositorio",
          '<p style="color:var(--text-muted);margin-bottom:12px">' +
            "Se recrea el repo local (IndexedDB) con un README nuevo. No se puede deshacer." +
            "</p>",
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
      };
    }

    if (el("btn-new-issue")) {
      el("btn-new-issue").onclick = function () {
        openModal(
          "Nuevo issue",
          '<div class="form-row"><label>Título</label><input type="text" id="modal-issue-title" /></div>' +
            '<div class="form-row"><label>Descripción</label><textarea id="modal-issue-body"></textarea></div>',
          [
            { label: "Cancelar" },
            {
              label: "Crear",
              primary: true,
              onClick: function () {
                const title = (el("modal-issue-title").value || "").trim();
                if (!title) return;
                app.createIssue(title, el("modal-issue-body").value || "");
              }
            }
          ]
        );
      };
    }

    if (el("btn-new-pr")) {
      el("btn-new-pr").onclick = function () {
        openModal(
          "Nuevo pull request",
          '<div class="form-row"><label>Título</label><input type="text" id="modal-pr-title" /></div>' +
            '<div class="form-row"><label>Head</label><input type="text" id="modal-pr-head" value="feature" /></div>' +
            '<div class="form-row"><label>Base</label><input type="text" id="modal-pr-base" value="main" /></div>' +
            '<div class="form-row"><label>Descripción</label><textarea id="modal-pr-body"></textarea></div>',
          [
            { label: "Cancelar" },
            {
              label: "Crear",
              primary: true,
              onClick: function () {
                const title = (el("modal-pr-title").value || "").trim();
                if (!title) return;
                app.createPR(
                  title,
                  el("modal-pr-head").value || "feature",
                  el("modal-pr-base").value || "main",
                  el("modal-pr-body").value || ""
                );
              }
            }
          ]
        );
      };
    }
  }

  window.GitXDCUI = { openModal: openModal, closeModal: closeModal, wire: wire };
})();
