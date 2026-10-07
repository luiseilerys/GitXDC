      var bsh = document.getElementById("btn-share"); if (bsh) bsh.onclick = shareInvite;
      var bcl = document.getElementById("btn-clone"); if (bcl) bcl.onclick = cloneGuestRepo;
      var bsy = document.getElementById("btn-sync"); if (bsy) bsy.onclick = doSync;
      var bex = document.getElementById("btn-export"); if (bex) bex.onclick = doExport;
      var bnr = document.getElementById("btn-new-repo"); if (bnr) bnr.onclick = promptNewRepo;
      var bsv = document.getElementById("btn-save"); if (bsv) bsv.onclick = saveCurrentFile;
      if (window.GitXDCUI && window.GitXDCUI.wire) window.GitXDCUI.wire(window.GitXDCApp);
      else log("ui.js no cargado", "warn");
      showHome();
      setStatus("listo", true);
      log("GitXDC listo — " + myName + " (branches+commits+reviews+tree)");
    } catch (e) {
      setStatus("error: " + (e.message || e), false);
      log("Boot falló: " + (e.message || e), "error");
      console.error(e);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
