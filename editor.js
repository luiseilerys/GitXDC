/**
 * editor.js — Wrapper de CodeMirror 6 para GitXDC
 * Comentarios en español.
 */

(function () {
  "use strict";

  /** Instancia del editor */
  let view = null;

  /** Extensiones de lenguaje por extensión de archivo */
  const langMap = {
    js: () => window.CodeMirrorBundle.javascript(),
    mjs: () => window.CodeMirrorBundle.javascript(),
    cjs: () => window.CodeMirrorBundle.javascript(),
    ts: () => window.CodeMirrorBundle.javascript({ typescript: true }),
    jsx: () => window.CodeMirrorBundle.javascript({ jsx: true }),
    tsx: () => window.CodeMirrorBundle.javascript({ jsx: true, typescript: true }),
    json: () => window.CodeMirrorBundle.json(),
    md: () => window.CodeMirrorBundle.markdown(),
    markdown: () => window.CodeMirrorBundle.markdown(),
    html: () => window.CodeMirrorBundle.html(),
    htm: () => window.CodeMirrorBundle.html(),
    css: () => window.CodeMirrorBundle.css(),
    scss: () => window.CodeMirrorBundle.css(),
    toml: () => null,
    txt: () => null
  };

  /**
   * Obtiene la extensión de lenguaje para una ruta.
   * @param {string} path
   * @returns {import("@codemirror/language").LanguageSupport|null}
   */
  function getLanguage(path) {
    const ext = (path.split(".").pop() || "").toLowerCase();
    const factory = langMap[ext];
    return factory ? factory() : null;
  }

  /**
   * Inicializa el editor en el contenedor.
   * @param {HTMLElement} container
   * @param {object} opts - { onChange?: (doc: string) => void }
   */
  function init(container, opts = {}) {
    const { EditorView, EditorState, basicSetup, oneDark } = window.CodeMirrorBundle;

    const extensions = [
      basicSetup,
      oneDark,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && opts.onChange) {
          opts.onChange(update.state.doc.toString());
        }
      })
    ];

    const state = EditorState.create({
      doc: "",
      extensions
    });

    view = new EditorView({
      state,
      parent: container
    });
  }

  /**
   * Carga contenido en el editor y aplica el lenguaje de la ruta.
   * @param {string} content
   * @param {string} path
   */
  function setContent(content, path) {
    if (!view) return;
    const { EditorState, basicSetup, oneDark } = window.CodeMirrorBundle;
    const lang = getLanguage(path);
    const extensions = [basicSetup, oneDark];
    if (lang) extensions.push(lang);

    // Mantener el listener de cambio si existe
    const currentListener = view.state.facet(window.CodeMirrorBundle.EditorView.updateListener);
    // Reconstruir estado
    view.setState(
      EditorState.create({
        doc: content || "",
        extensions: [
          ...extensions,
          window.CodeMirrorBundle.EditorView.updateListener.of((update) => {
            if (update.docChanged && window.__editor_onChange) {
              window.__editor_onChange(update.state.doc.toString());
            }
          })
        ]
      })
    );
  }

  /**
   * Devuelve el contenido actual del editor.
   * @returns {string}
   */
  function getContent() {
    if (!view) return "";
    return view.state.doc.toString();
  }

  /**
   * Limpia el editor.
   */
  function clear() {
    setContent("", "");
  }

  /**
   * Registra callback de cambio.
   * @param {(doc: string) => void} cb
   */
  function onChange(cb) {
    window.__editor_onChange = cb;
  }

  // Exportar API global
  window.GitXDCEditor = {
    init,
    setContent,
    getContent,
    clear,
    onChange
  };
})();
