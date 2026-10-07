/** app.js — carga gzip+base64 de app-source */
(function () {
  "use strict";
  var N = 5;
  var parts = new Array(N);
  var done = 0;
  function finish() {
    try {
      var b64 = parts.join("");
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      if (typeof DecompressionStream !== "undefined") {
        var ds = new DecompressionStream("gzip");
        var blob = new Blob([bytes]);
        var stream = blob.stream().pipeThrough(ds);
        new Response(stream).text().then(function (code) {
          (0, eval)(code);
        }).catch(function (e) {
          console.error("[GitXDC] gunzip:", e);
        });
      } else {
        console.error("[GitXDC] DecompressionStream no disponible");
      }
    } catch (e) {
      console.error("[GitXDC] fallo carga:", e);
      var s = document.getElementById("status");
      if (s) s.textContent = "error carga app";
    }
  }
  function loadOne(i) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", "app-gz-" + i + ".txt", true);
    xhr.onload = function () {
      if (xhr.status === 200 || xhr.status === 0) {
        parts[i] = xhr.responseText.replace(/\s/g, "");
        done++;
        if (done === N) finish();
      }
    };
    xhr.send();
  }
  for (var i = 0; i < N; i++) loadOne(i);
})();
