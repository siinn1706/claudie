// Doors for the Quick Entry window and the region overlay: a few named calls each.
// Both pages are sandboxed; the main process checks who is asking.
const { contextBridge, ipcRenderer } = require("electron");

const i18n = () => ipcRenderer.sendSync("i18n");
// the shared i18n.js reads its dictionary from window.vivo.i18n
contextBridge.exposeInMainWorld("vivo", { i18n });
contextBridge.exposeInMainWorld("rapida", {
  enviar: (dados) => ipcRenderer.invoke("rapida_enviar", dados),
  fechar: () => ipcRenderer.send("rapida_fechar"),
  capturar: () => ipcRenderer.invoke("rapida_capturar"),
  aoAbrir: (fn) => ipcRenderer.on("rapida:abre", (_e, d) => fn(d)),
  i18n,
});
contextBridge.exposeInMainWorld("captura", {
  rect: (r) => ipcRenderer.send("captura_rect", r),
  cancelar: () => ipcRenderer.send("captura_cancela"),
});
