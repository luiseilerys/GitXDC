/** app.js — carga app-b64-0..50 (base64 de app-source completo) */
(function () {
  "use strict";
  var N = 51;
  var parts = new Array(N);
  var done = 0;
  function finish() {
    try {
      var code = decodeURIComponent(escape(atob(parts.join(""))));
      (0, eval)(code);
    } catch (e) {
      console.error("[GitXDC] fallo carga app:", e);
      var s = document.getElementById("status");
      if (s) s.textContent = "error carga app";
    }
  }
  function loadOne(i) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", "app-b64-" + i + ".txt", true);
    xhr.onload = function () {
      if (xhr.status === 200 || xhr.status === 0) {
        parts[i] = xhr.responseText.replace(/\s/g, "");
        done++;
        if (done === N) finish();
      } else console.error("Falta app-b64-" + i + ".txt");
    };
    xhr.onerror = function () { console.error("Error app-b64-" + i); };
    xhr.send();
  }
  for (var i = 0; i < N; i++) loadOne(i);
})();
