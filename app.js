/** app.js — carga 8 partes de app-source */
(function () {
  "use strict";
  var N = 8;
  var parts = new Array(N);
  var done = 0;
  function finish() {
    try {
      (0, eval)(parts.join(""));
    } catch (e) {
      console.error("[GitXDC] fallo carga app:", e);
      var s = document.getElementById("status");
      if (s) s.textContent = "error carga app";
    }
  }
  function loadOne(i) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", "app-src-part-" + i + ".js", true);
    xhr.onload = function () {
      if (xhr.status === 200 || xhr.status === 0) {
        parts[i] = xhr.responseText;
        done++;
        if (done === N) finish();
      } else console.error("Falta app-src-part-" + i + ".js");
    };
    xhr.onerror = function () { console.error("Error part " + i); };
    xhr.send();
  }
  for (var i = 0; i < N; i++) loadOne(i);
})();
