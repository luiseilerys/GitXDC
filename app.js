/** app.js — carga app-src-a.js + app-src-b.js, concat y eval */
(function () {
  "use strict";
  var parts = ["", ""];
  var done = 0;
  function finish() {
    try {
      (0, eval)(parts[0] + parts[1]);
    } catch (e) {
      console.error("[GitXDC] fallo carga app:", e);
      var s = document.getElementById("status");
      if (s) s.textContent = "error carga app";
    }
  }
  function loadOne(i, name) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", name, true);
    xhr.onload = function () {
      if (xhr.status === 200 || xhr.status === 0) {
        parts[i] = xhr.responseText;
        done++;
        if (done === 2) finish();
      } else {
        console.error("Falta " + name);
      }
    };
    xhr.onerror = function () { console.error("Error cargando " + name); };
    xhr.send();
  }
  loadOne(0, "app-src-a.js");
  loadOne(1, "app-src-b.js");
})();
