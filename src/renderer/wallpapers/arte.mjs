// Backgrounds from outside the built-in themes, on one canvas behind the app:
// the ASCII Magic pieces (ascii-magic-art, MIT, pieces loaded on demand) and
// animations made in ASCII Motion and imported by the person. Both are scaled
// to the window: scenes fill it edge to edge, smaller pieces sit centred.
import { paint, cellAspect, frameFor, GlyphAtlas, CELL_W, FONT } from "../../../node_modules/ascii-magic-art/runtime/canvas.js";

const PECAS = "../../../node_modules/ascii-magic-art/pieces/";
const FUNDO = "#0d0d0f";
const modulos = new Map();
const carrega = (slug) => {
  const s = String(slug).replace(/[^a-z0-9-]/g, "");
  if (!modulos.has(s)) modulos.set(s, import(`${PECAS}${s}.js`).catch((e) => { modulos.delete(s); throw e; }));
  return modulos.get(s);
};

// The look a piece asks for itself (its halftone tuning, photos in true colour).
const lookDe = (meta) => ({ ...(meta.dots || {}), ...(meta.cell === "square" ? { lift: false } : {}) });

// Cell size and offset that place cols × rows on a w × h surface.
function encaixe(w, h, cols, rows, aspect, cobre, margem = 0.08) {
  const m = cobre ? 1 : 1 - margem * 2;
  const sx = (w * m) / cols, sy = (h * m) / (rows * aspect);
  // Filling the window stops at cells of about 20 px: past that a small
  // piece turns into big blocks, so it sits centred instead.
  const cw = cobre ? Math.min(Math.max(sx, sy), Math.max(Math.min(sx, sy), Math.max(20, Math.min(w, h) / 40))) : Math.min(sx, sy), ch = cw * aspect;
  return { cw, ch, x: (w - cols * cw) / 2, y: (h - rows * ch) / 2 };
}

function desenhaMagia(ctx, w, h, mod, draw, t, cobre, atlas, dpr) {
  const meta = mod.meta, look = lookDe(meta);
  const { frame, mode } = frameFor(draw(t), meta.palette, meta, look);
  const e = encaixe(w, h, meta.cols, meta.rows, cellAspect(meta), cobre);
  paint(ctx, frame, frame.palette || meta.palette, { ...look, ...e, ink: "#e4e4e7", mode, atlas, dpr, over: true });
}

// An ASCII Motion animation: { w, h, fundo, quadros: [{ linhas, fg, bg, dur }] }.
function desenhaMotion(ctx, W, H, anim, q, cobre) {
  const aspect = 1 / CELL_W, e = encaixe(W, H, anim.w, anim.h, aspect, cobre, 0.1);
  ctx.font = `${e.cw / CELL_W}px ${FONT}`; ctx.textBaseline = "middle";
  const quadro = anim.quadros[q];
  for (const [chave, cor] of Object.entries(quadro.bg || {})) {
    const [x, y] = chave.split(",").map(Number);
    ctx.fillStyle = cor; ctx.fillRect(e.x + x * e.cw, e.y + y * e.ch, e.cw + 0.5, e.ch + 0.5);
  }
  quadro.linhas.forEach((linha, y) => {
    [...linha].forEach((c, x) => {
      if (c === " ") return;
      ctx.fillStyle = (quadro.fg && quadro.fg[`${x},${y}`]) || "#ffffff";
      ctx.fillText(c, e.x + x * e.cw, e.y + (y + 0.5) * e.ch);
    });
  });
}

const cv = document.getElementById("arte"), ctx = cv.getContext("2d");
let W = 0, H = 0, dpr = 1, tocando = null, raf = 0, seq = 0;
function ajusta() {
  dpr = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
}
addEventListener("resize", ajusta); ajusta();

// Time runs at a speed the app can change (faster while Claude works).
let velocidade = 1, antes = 0;
function laco(ms) {
  raf = requestAnimationFrame(laco);
  const p = tocando; if (!p) return;
  p.tempo = (p.tempo || 0) + (antes ? Math.min(0.1, (ms - antes) / 1000) : 0) * velocidade; antes = ms;
  const d = window.desempenho, cap = d ? (document.hasFocus() ? d.fps : d.fpsFora) : 0;
  if (ms - p.ultimo < Math.max(p.passo, cap ? 1000 / cap : 0) - 4) return;
  p.ultimo = ms;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = p.fundo; ctx.fillRect(0, 0, W, H);
  p.desenha(p.tempo);
}

window.Arte = {
  // Plays an ASCII Magic piece by slug and resolves to its meta.
  async magia(slug, { cobre = true } = {}) {
    const my = ++seq, mod = await carrega(slug);
    if (my !== seq) return mod.meta;
    const draw = mod.default(), atlas = new GlyphAtlas();
    tocando = { fundo: FUNDO, passo: 1000 / Math.min(mod.meta.fps || 20, 30), ultimo: 0, inicio: performance.now(),
      desenha: (t) => desenhaMagia(ctx, W, H, mod, draw, t, cobre, atlas, dpr) };
    if (!raf) raf = requestAnimationFrame(laco);
    return mod.meta;
  },
  // Plays an imported ASCII Motion animation.
  motion(anim, { cobre = anim.w >= 60 } = {}) {
    seq++;
    const total = anim.quadros.reduce((s, q) => s + (q.dur || 80), 0) || 1;
    tocando = { fundo: anim.fundo || FUNDO, passo: 1000 / 30, ultimo: 0, inicio: performance.now(),
      desenha: (t) => {
        let ms = (t * 1000) % total, q = 0;
        while (q < anim.quadros.length - 1 && ms >= (anim.quadros[q].dur || 80)) ms -= anim.quadros[q++].dur || 80;
        desenhaMotion(ctx, W, H, anim, q, cobre);
      } };
    if (!raf) raf = requestAnimationFrame(laco);
  },
  parar() { seq++; tocando = null; cancelAnimationFrame(raf); raf = 0; antes = 0; },
  velocidade(v) { velocidade = v; },
  // Still thumbnails, drawn once into a small canvas.
  async miniMagia(slug, canvas, { cobre = true, t = 2.5 } = {}) {
    const mod = await carrega(slug), r = canvas.getBoundingClientRect(), k = 2;
    const w = r.width || 160, h = r.height || 100;
    canvas.width = w * k; canvas.height = h * k;
    const c = canvas.getContext("2d"); c.setTransform(k, 0, 0, k, 0, 0);
    c.fillStyle = FUNDO; c.fillRect(0, 0, w, h);
    desenhaMagia(c, w, h, mod, mod.default(), t, cobre, null, k);
    return mod.meta;
  },
  // A thumbnail that plays (on hover); returns the function that stops it.
  async vivaMagia(slug, canvas, { cobre = true } = {}) {
    const mod = await carrega(slug), draw = mod.default(), r = canvas.getBoundingClientRect(), k = 2;
    const w = r.width || 160, h = r.height || 100, c = canvas.getContext("2d"), t0 = performance.now();
    canvas.width = w * k; canvas.height = h * k;
    let id = 0, parado = false;
    const quadro = () => {
      if (parado || !canvas.isConnected) return;
      c.setTransform(k, 0, 0, k, 0, 0); c.fillStyle = FUNDO; c.fillRect(0, 0, w, h);
      desenhaMagia(c, w, h, mod, draw, 2.5 + (performance.now() - t0) / 1000, cobre, null, k);
      id = setTimeout(quadro, 1000 / Math.min(mod.meta.fps || 20, 24));
    };
    quadro();
    return () => { parado = true; clearTimeout(id); };
  },
  miniMotion(anim, canvas) {
    const r = canvas.getBoundingClientRect(), k = 2, w = r.width || 160, h = r.height || 100;
    canvas.width = w * k; canvas.height = h * k;
    const c = canvas.getContext("2d"); c.setTransform(k, 0, 0, k, 0, 0);
    c.fillStyle = anim.fundo || FUNDO; c.fillRect(0, 0, w, h);
    desenhaMotion(c, w, h, anim, 0, anim.w >= 60);
  },
};
dispatchEvent(new Event("arte-pronta"));
