/**
 * app-part2.js — continuación de app-part1.js
 *
 * RUNTIME (lo que empaqueta build.sh):
 *   app.js (loader N=30) + app-b64-0.txt … app-b64-29.txt
 *   → se decodifica y evalúa la app completa al abrir el .xdc
 *
 * FUENTE legible (desarrollo local):
 *   cat app-part1.js app-part2a.js app-part2b.js > app-full.js
 *   (app-part2a/b están en el historial de commits / sandbox de build)
 *
 * Contenido de esta parte (ya incluido en los chunks b64):
 *   - refreshTree, openLocalFile, openGuestFile, save, createFile, commit
 *   - lineDiff / buildPrDiff / renderDiffHtml  (diff estilo GitHub)
 *   - createPR SOLO desde clone (isClonedRepo)
 *   - mergePR / closePR SOLO si canManagePr (dueño original del repo)
 *   - cloneGuestRepo, shareInvite, openInvite, snapshot WANT/REPO_SNAPSHOT
 *   - boot + wire UI + GitXDCApp API
 */
