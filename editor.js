/**
 * editor.js — CodeMirror 6 wrapper (tolerante si falta el vendor)
 */
(function () {
  "use strict";

  var view = null;
  var plainTa = null;

  function hasCM() {
    return !!(window.CodeMirrorBundle && window.CodeMirrorBundle.EditorView);
  }

  function getLanguage(path) {
    if (!hasCM()) return null;
    var ext = (path.split(".").pop() || "").toLowerCase();
    var B = window.CodeMirrorBundle;
    try {
      if (ext === "js" || ext === "mjs" || ext === "cjs") return B.javascript();
      if (ext === "json") return B.json();
      if (ext === "md" || ext === "markdown") return B.markdown();
      if (ext === "html" || ext === "htm") return B.html();
      if (ext === "css") return B.css();
    } catch (_) {}
    return null;
  }

  function init(container) {
    if (!container) return;
    if (hasCM()) {
      var B = window.CodeMirrorBundle;
      var extensions = [B.basicSetup, B.oneDark];
      view = new B.EditorView({
        state: B.EditorState.create({ doc: "", extensions: extensions }),
        parent: container
      });
    } else {
      // Fallback textarea si no hay CodeMirror
      plainTa = document.createElement("textarea");
      plainTa.style.cssText = "width:100%;height:100%;background:#0d1117;color:#e6edf3;border:0;padding:12px;font-family:monospace;font-size:13px;resize:none;";
      container.appendChild(plainTa);
      console.warn("[GitXDC] CodeMirror no disponible — textarea fallback");
    }
  }

  function setContent(content, path) {
    content = content || "";
    if (view && hasCM()) {
      var B = window.CodeMirrorBundle;
      var extensions = [B.basicSetup, B.oneDark];
      var lang = getLanguage(path || "");
      if (lang) extensions.push(lang);
      extensions.push(
        B.EditorView.updateListener.of(function (update) {
          if (update.docChanged && window.__editor_onChange) {
            window.__editor_onChange(update.state.doc.toString());
          }
        })
      );
      view.setState(B.EditorState.create({ doc: content, extensions: extensions }));
    } else if (plainTa) {
      plainTa.value = content;
      plainTa.oninput = function () {
        if (window.__editor_onChange) window.__editor_onChange(plainTa.value);
      };
    }
  }

  function getContent() {
    if (view) return view.state.doc.toString();
    if (plainTa) return plainTa.value;
    return "";
  }

  function clear() {
    setContent("", "");
  }

  function onChange(cb) {
    window.__editor_onChange = cb;
  }

  window.GitXDCEditor = { init: init, setContent: setContent, getContent: getContent, clear: clear, onChange: onChange };
})();
