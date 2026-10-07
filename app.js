/** app.js — carga app-source.js (fuente completa) */
(function () {
  "use strict";
  var s = document.createElement("script");
  s.src = "app-source.js";
  s.onerror = function () {
    console.error("[GitXDC] no se pudo cargar app-source.js");
    var st = document.getElementById("status");
    if (st) st.textContent = "error carga app";
  };
  document.head.appendChild(s);
})();
