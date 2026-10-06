/**
 * webxdc.js — Polyfill de desarrollo para GitXDC
 * Simula la API de webxdc en el navegador para pruebas locales.
 * En producción este archivo es proporcionado por el cliente de mensajería.
 */

(function () {
  "use strict";

  // Estado simulado
  const peers = new Map();
  let updateSerial = 0;
  const storedUpdates = [];
  let realtimeListener = null;
  const selfAddr = "dev@" + Math.random().toString(36).slice(2, 8) + ".local";
  const selfName = "DevUser-" + selfAddr.split("@")[0].slice(-4);

  // Canal realtime simulado (broadcast local)
  const realtimeChannel = {
    setListener(cb) {
      realtimeListener = cb;
    },
    send(data) {
      // Simular eco a nosotros mismos y a "peers" (solo local)
      if (realtimeListener) {
        setTimeout(() => {
          // Copia para no mutar el original
          const copy = new Uint8Array(data);
          realtimeListener(copy);
        }, 10 + Math.random() * 40);
      }
    },
    leave() {
      realtimeListener = null;
    }
  };

  window.webxdc = {
    selfAddr,
    selfName,

    /**
     * Envía una actualización persistente a todos los peers del chat.
     * @param {object} update - { payload, info?, href? }
     * @param {string} descr - Descripción corta para el chat
     */
    sendUpdate(update, descr) {
      updateSerial += 1;
      const full = {
        payload: update.payload,
        info: update.info || null,
        href: update.href || null,
        serial: updateSerial,
        max_serial: updateSerial
      };
      storedUpdates.push(full);
      // Notificar al listener local
      if (window.__webxdc_update_listener) {
        setTimeout(() => window.__webxdc_update_listener(full), 5);
      }
      console.log("[webxdc polyfill] sendUpdate:", descr, full);
    },

    /**
     * Registra el listener de actualizaciones.
     * @param {function} cb
     * @param {number} serial - desde qué serial empezar (0 = todos)
     */
    setUpdateListener(cb, serial) {
      window.__webxdc_update_listener = cb;
      // Reproducir updates ya guardados
      for (const u of storedUpdates) {
        if (u.serial > (serial || 0)) {
          setTimeout(() => cb(u), 1);
        }
      }
    },

    /**
     * Une al canal realtime experimental.
     * @returns {object} canal con setListener, send, leave
     */
    joinRealtimeChannel() {
      return realtimeChannel;
    },

    /**
     * Prepara un mensaje para enviar al chat (archivo + texto).
     * En el polyfill solo descarga el archivo.
     * @param {object} message - { file: { name, base64|blob|plainText }, text? }
     */
    async sendToChat(message) {
      console.log("[webxdc polyfill] sendToChat:", message.text || "", message.file?.name);
      if (message.file && message.file.base64) {
        const bin = atob(message.file.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: "application/octet-stream" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = message.file.name || "file.bin";
        a.click();
        URL.revokeObjectURL(a.href);
      }
      return Promise.resolve();
    },

    /**
     * Intervalo mínimo recomendado entre sendUpdate (ms).
     */
    sendUpdateInterval: 0,

    /**
     * Tamaño máximo aproximado del payload de sendUpdate.
     */
    sendUpdateMaxSize: 128000
  };

  console.log("[webxdc polyfill] cargado. selfAddr =", selfAddr, "selfName =", selfName);
})();
