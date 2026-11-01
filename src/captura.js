// Screen capture for the paperclip: a list of screens and windows, one of them
// grabbed whole, or a region dragged on a dim overlay. Images stay in memory and
// travel as base64; every Claudie window is hidden while the picture is taken and
// shown again in all paths. main.js passes the windows and the overlay's preload.

import { desktopCapturer, screen, BrowserWindow } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const doisDig = (n) => String(n).padStart(2, "0");
const nomeArquivo = () => {
  const d = new Date();
  return `captura-${d.getFullYear()}${doisDig(d.getMonth() + 1)}${doisDig(d.getDate())}-${doisDig(d.getHours())}${doisDig(d.getMinutes())}${doisDig(d.getSeconds())}.png`;
};
// A picture over about 5 MB is halved in size until it fits what the message path accepts.
const MAX_PNG = 5 * 1024 * 1024;
function resultado(img) {
  let png = img.toPNG();
  for (let i = 0; png.length > MAX_PNG && i < 4; i++) {
    const { width, height } = img.getSize();
    img = img.resize({ width: Math.max(1, Math.round(width / 2)), height: Math.max(1, Math.round(height / 2)), quality: "best" });
    png = img.toPNG();
  }
  return { nome: nomeArquivo(), dados: png.toString("base64"), mime: "image/png" };
}
const vivas = (lista) => lista.filter((w) => w && !w.isDestroyed());

export function iniciaCaptura({ pasta, preload, trava }) {
  const urlOverlay = pathToFileURL(path.join(pasta, "captura-regiao.html")).href.toLowerCase();
  let capturando = false, overlay = null, pendente = null;

  // Hides the visible windows, runs fn, and always shows them again (aoVoltar runs last).
  async function comEscondidas(janelas, fn, aoVoltar) {
    const visiveis = vivas(janelas).filter((w) => w.isVisible());
    for (const w of visiveis) w.hide();
    await espera(200);
    try { return await fn(); }
    finally {
      for (const w of vivas(visiveis)) w.show();
      aoVoltar?.();
    }
  }

  async function listaFontes(proprias) {
    const ids = new Set(vivas(proprias).map((w) => w.getMediaSourceId()));
    const fontes = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 200 }, fetchWindowIcons: false });
    return fontes
      .filter((s) => !ids.has(s.id) && (s.id.startsWith("screen:") || s.name.trim()))
      .map((s) => ({ id: s.id, nome: s.name, tipo: s.id.startsWith("screen:") ? "screen" : "window", thumb: s.thumbnail.isEmpty() ? "" : s.thumbnail.toDataURL() }));
  }

  // The size in real pixels of the screen a source shows.
  async function tamanhoDaTela(id) {
    const leves = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } });
    const src = leves.find((s) => s.id === id);
    const d = screen.getAllDisplays().find((x) => String(x.id) === src?.display_id) || screen.getPrimaryDisplay();
    return { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
  }

  async function capturaFonte(id, janelas, aoVoltar) {
    if (capturando) return null;
    capturando = true;
    try {
      const tipo = id.startsWith("screen:") ? "screen" : "window";
      const tamanho = tipo === "screen" ? await tamanhoDaTela(id) : { width: 3840, height: 2160 };
      return await comEscondidas(janelas, async () => {
        const fontes = await desktopCapturer.getSources({ types: [tipo], thumbnailSize: tamanho, fetchWindowIcons: false });
        const src = fontes.find((s) => s.id === id);
        return src && !src.thumbnail.isEmpty() ? resultado(src.thumbnail) : null;
      }, aoVoltar);
    } finally { capturando = false; }
  }

  function fechaOverlay() {
    const o = overlay; overlay = null;
    if (o && !o.isDestroyed()) o.destroy();
  }

  // The overlay's answer: only from its own window and page.
  const doOverlay = (e) => !!overlay && !overlay.isDestroyed() && e.sender === overlay.webContents && String(e.senderFrame?.url || "").toLowerCase() === urlOverlay;
  function recebeRect(e, r) {
    if (!pendente || !doOverlay(e)) return;
    const n = [r?.x, r?.y, r?.w, r?.h];
    pendente(n.every((v) => Number.isFinite(v)) ? { x: r.x, y: r.y, w: r.w, h: r.h } : null);
  }
  function recebeCancela(e) { if (pendente && doOverlay(e)) pendente(null); }

  // Waits for the rectangle (CSS pixels of the overlay) or a cancel; 60 s at most.
  function pedeRetangulo(display) {
    return new Promise((resolve) => {
      const fim = (v) => { clearTimeout(limite); pendente = null; resolve(v); };
      const limite = setTimeout(() => fim(null), 60000);
      pendente = fim;
      overlay = new BrowserWindow({
        x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height,
        transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, fullscreenable: false, resizable: false, movable: false, show: false,
        webPreferences: { preload, sandbox: true, contextIsolation: true },
      });
      const o = overlay;
      trava(o);
      o.setAlwaysOnTop(true, "screen-saver");
      o.setBounds(display.bounds);
      o.once("ready-to-show", () => { if (!o.isDestroyed()) { o.show(); o.focus(); } });
      o.on("closed", () => { if (pendente === fim) fim(null); });
      o.on("blur", () => { if (pendente === fim) fim(null); });
      o.loadFile(path.join(pasta, "captura-regiao.html"));
    });
  }

  async function capturaRegiao(display, janelas, aoVoltar) {
    if (capturando) return null;
    capturando = true;
    try {
      const fator = display.scaleFactor || 1;
      const tamanho = { width: Math.round(display.size.width * fator), height: Math.round(display.size.height * fator) };
      return await comEscondidas(janelas, async () => {
        const fontes = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: tamanho });
        const src = fontes.find((s) => s.display_id === String(display.id)) || (screen.getAllDisplays().length === 1 ? fontes[0] : null);
        if (!src || src.thumbnail.isEmpty()) return null;
        let r;
        try { r = await pedeRetangulo(display); } finally { fechaOverlay(); }
        if (!r) return null;
        const img = src.thumbnail, { width: W, height: H } = img.getSize();
        const x = Math.max(0, Math.min(W - 1, Math.round(r.x * fator))), y = Math.max(0, Math.min(H - 1, Math.round(r.y * fator)));
        const w = Math.min(W - x, Math.round(r.w * fator)), h = Math.min(H - y, Math.round(r.h * fator));
        if (w < 8 || h < 8) return null;
        return resultado(img.crop({ x, y, width: w, height: h }));
      }, aoVoltar);
    } finally { fechaOverlay(); capturando = false; }
  }

  return { listaFontes, capturaFonte, capturaRegiao, recebeRect, recebeCancela, fechaOverlay, ocupado: () => capturando };
}
