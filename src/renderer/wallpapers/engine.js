// ---------------------------------------------------------------------------
// Engine: each theme paints a background, then draws its subjects as vector
// shapes into a small supersampled layer; every cell of the grid averages its
// samples and is painted as a rounded tile carrying a glyph (the technique of
// the lagoon reference). On top of that, the pointer has physics: subjects are
// springs that flee, approach or follow it, and clicks spawn theme effects.

const TAU = Math.PI * 2;
const hash = (a, b, c = 0) => { const h = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return h - Math.floor(h); };
const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const hx = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const lum = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const ell = (g, x, y, rx, ry, rot, fill) => { g.beginPath(); g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot || 0, 0, TAU); g.fillStyle = fill; g.fill(); };
const circ = (g, x, y, r, fill) => ell(g, x, y, r, r, 0, fill);
const lin = (ctx, x0, y0, x1, y1, stops) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); stops.forEach(([k, c]) => g.addColorStop(k, c)); return g; };
const rad = (ctx, x, y, r0, r1, stops) => { const g = ctx.createRadialGradient(x, y, r0, x, y, r1); stops.forEach(([k, c]) => g.addColorStop(k, c)); return g; };
const glowAt = (ctx, x, y, r, color, a) => { ctx.fillStyle = rad(ctx, x, y, 0, r, [[0, color.replace("A", a)], [1, color.replace("A", 0)]]); ctx.fillRect(x - r, y - r, r * 2, r * 2); };
const RAMP = "8%XSSt%t;:";

function Renderer(canvas, opt) {
  const ctx = canvas.getContext("2d");
  const oc = document.createElement("canvas"), ox = oc.getContext("2d", { willReadFrequently: true });
  const self = { canvas, ctx, cw: opt.cw, ch: opt.ch, ss: opt.ss, W: 0, H: 0, cols: 0, rows: 0, trail: null, effects: [], bodies: new Map(), mem: new Map(), hits: [], hover: new Map() };

  self.resize = (W, H) => {
    const dpr = opt.dpr ?? Math.min(2, devicePixelRatio || 1);
    self.W = W; self.H = H; self.dpr = dpr;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    self.cols = Math.ceil(W / self.cw); self.rows = Math.ceil(H / self.ch);
    oc.width = self.cols * self.ss; oc.height = self.rows * self.ss;
    self.trail = new Float32Array(self.cols * self.rows);
  };
  self.reset = () => { self.bodies.clear(); self.mem.clear(); self.hover.clear(); self.effects = []; self.trail && self.trail.fill(0); };

  const sample = (draw) => {
    const { cols, rows, ss, cw, ch } = self;
    ox.setTransform(1, 0, 0, 1, 0, 0); ox.clearRect(0, 0, oc.width, oc.height);
    ox.globalCompositeOperation = "source-over"; ox.globalAlpha = 1;
    ox.setTransform(ss / cw, 0, 0, ss / ch, 0, 0);
    draw(ox);
    const d = ox.getImageData(0, 0, oc.width, oc.height).data, out = new Float32Array(cols * rows * 4), rw = oc.width * 4, n = ss * ss;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let v = 0; v < ss; v++) for (let u = 0, p = (j * ss + v) * rw + i * ss * 4; u < ss; u++, p += 4) { const al = d[p + 3]; r += d[p] * al; g += d[p + 1] * al; b += d[p + 2] * al; a += al; }
      const o = (j * cols + i) * 4;
      if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; out[o + 3] = a / (255 * n); }
    }
    return out;
  };

  const glyph = (i, j, s, fill) => { ctx.fillStyle = fill; ctx.fillText(s, i * self.cw + self.cw / 2, j * self.ch + self.ch / 2 + 1); };

  // Pointer trail: light the cells it crosses.
  self.mark = (x, y) => {
    const ci = Math.floor(x / self.cw), cj = Math.floor(y / self.ch);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= self.cols || j >= self.rows) continue;
      const k = j * self.cols + i; self.trail[k] = Math.max(self.trail[k], 1 - (Math.abs(di) + Math.abs(dj)) * 0.3);
    }
  };
  self.add = (fx) => self.effects.push(fx);

  self.frame = (theme, t, dt, mouse) => {
    const { cw, ch, cols, rows, W, H } = self;
    ctx.setTransform(self.dpr, 0, 0, self.dpr, 0, 0);
    self.effects = self.effects.filter((f) => t - f.t < f.life);
    self.hits = [];
    const ripples = self.effects.filter((f) => f.kind === "ripple");
    const lure = [...self.effects].reverse().find((f) => f.kind === "food");

    const env = {
      W, H, t, dt, mouse, cw, ch, k: opt.k ?? Math.min(W, H) / 1000,
      // A subject the pointer can touch: the page plays its sound on enter.
      hit: (key, x, y, r, kind) => self.hits.push({ key, x, y, r, kind }),
      hovered: (key) => (self.hover.has(key) ? t - self.hover.get(key) : -1), effects: self.effects, mem: self.mem, lure,
      near: (x, y, R = 220) => (mouse ? clamp(1 - Math.hypot(x - mouse.x, y - mouse.y) / R) : 0),
      // A subject on a spring: `mode` says how it answers the pointer.
      body(key, x, y, mode = "flee", R = 260, F = 1) {
        let b = self.bodies.get(key);
        if (!b) self.bodies.set(key, (b = { ox: 0, oy: 0, vx: 0, vy: 0 }));
        let tx = 0, ty = 0;
        const target = mode === "curious" && lure ? lure : mouse;
        if (target) {
          const px = x + b.ox, py = y + b.oy, dx = px - target.x, dy = py - target.y, d = Math.hypot(dx, dy) || 1, n = clamp(1 - d / R);
          const fast = mouse && mouse.speed > 380;
          if (n > 0) {
            if (mode === "flee" || (mode === "curious" && fast && target === mouse)) {
              const s = n ** 1.4 * R * 0.55 * F * (1 + clamp((mouse?.speed ?? 0) / 900));
              tx = b.ox + (dx / d) * s; ty = b.oy + (dy / d) * s;
            } else if (mode === "curious" && (target !== mouse || mouse.speed < 120)) {
              const s = Math.max(0, d - 70 * env.k) * 0.8 * n ** 0.5 * F;
              tx = b.ox - (dx / d) * s; ty = b.oy - (dy / d) * s;
            } else if (mode === "attract") {
              const s = d * 0.85 * n ** 0.4 * F;
              tx = b.ox - (dx / d) * s; ty = b.oy - (dy / d) * s;
            } else { tx = b.ox; ty = b.oy; }
          }
        }
        for (const r of ripples) {
          const age = t - r.t, rr = age * r.speed, dx = x + b.ox - r.x, dy = y + b.oy - r.y, d = Math.hypot(dx, dy) || 1;
          if (Math.abs(d - rr) < 40) { b.vx += (dx / d) * r.force * dt; b.vy += (dy / d) * r.force * dt; }
        }
        const stiff = mode === "attract" ? 5 : 3.2, damp = mode === "attract" ? 3.4 : 2.6;
        b.vx += ((tx - b.ox) * stiff - b.vx * damp) * dt * (target ? 1 : 0.6);
        b.vy += ((ty - b.oy) * stiff - b.vy * damp) * dt * (target ? 1 : 0.6);
        if (!target) { b.vx -= b.ox * 1.8 * dt; b.vy -= b.oy * 1.8 * dt; }
        b.ox += b.vx * dt; b.oy += b.vy * dt;
        return [x + b.ox, y + b.oy, b.vx, b.vy];
      },
    };

    theme.bg(ctx, env);
    ctx.fillStyle = theme.grid;
    for (let x = 0; x < W; x += cw) ctx.fillRect(x, 0, 1, H);
    for (let y = 0; y < H; y += ch) ctx.fillRect(0, y, W, 1);

    ctx.font = `600 ${Math.round(ch * 0.6)}px "Geist Mono", ui-monospace, monospace`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    if (theme.ambient) theme.ambient(env, glyph, self);

    // Water ripples drawn as rings of glyphs.
    for (const r of ripples) {
      const age = t - r.t, rr = age * r.speed, fade = 1 - age / r.life;
      const steps = Math.max(12, Math.floor((rr * TAU) / cw));
      for (let s = 0; s < steps; s++) {
        const a = (s / steps) * TAU, x = r.x + Math.cos(a) * rr, y = r.y + Math.sin(a) * rr * 0.92;
        glyph(Math.floor(x / cw), Math.floor(y / ch), r.chars ? r.chars[s % r.chars.length] : s % 3 ? "~" : "o", `rgba(255,255,255,${0.55 * fade * r.alpha})`);
      }
    }

    const L = sample((g) => theme.scene(g, env));
    const acc = theme.accent, lantern = mouse ? 140 : 0;

    // Shadow: the subjects' silhouette, one cell down-right.
    if (theme.shadow) {
      ctx.fillStyle = theme.shadow;
      for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
        if (L[(j * cols + i) * 4 + 3] > 0.4) ctx.fillRect((i + 1) * cw + 2, (j + 1) * ch + 2, cw - 4, ch - 4);
      }
    }

    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const k = j * cols + i, o = k * 4, a = L[o + 3];
      const x = i * cw, y = j * ch, cx = x + cw / 2, cy = y + ch / 2;
      const near = lantern ? clamp(1 - Math.hypot(cx - mouse.x, cy - mouse.y) / lantern) : 0;
      let ring = 0;
      for (const r of ripples) { const age = t - r.t, rr = age * r.speed, d = Math.hypot(cx - r.x, cy - r.y); ring = Math.max(ring, clamp(1 - Math.abs(d - rr) / 24) * (1 - age / r.life) * r.alpha); }
      const tr = self.trail ? (self.trail[k] *= Math.pow(0.05, dt)) : 0;

      if (a < 0.2) {
        const glow = Math.max(near * near * 0.55, tr * 0.7, ring * 0.6);
        if (glow > 0.03) {
          if (theme.trailGlyph && tr > near * near) glyph(i, j, theme.trailGlyph[(k + Math.floor(t * 4)) % theme.trailGlyph.length], rgb(acc, glow * 0.9));
          else { ctx.fillStyle = rgb(acc, glow * 0.28); ctx.beginPath(); ctx.roundRect(x + 2, y + 2, cw - 4, ch - 4, 3); ctx.fill(); }
        }
        continue;
      }
      let c = [L[o], L[o + 1], L[o + 2]];
      const lift = Math.max(near * 0.28, ring * 0.5);
      if (lift) c = mix(c, theme.liftTo || [255, 255, 255], lift);
      if (a < 0.5) {                       // soft edge: a smaller, fainter tile
        const s = 0.45 + a * 0.5;
        ctx.fillStyle = rgb(c, clamp(a * 1.8)); ctx.beginPath(); ctx.roundRect(cx - (cw - 3) * s / 2, cy - (ch - 3) * s / 2, (cw - 3) * s, (ch - 3) * s, 2); ctx.fill();
        continue;
      }
      const grow = 1 + near * 0.16, w = (cw - 3) * grow, h = (ch - 3) * grow;
      ctx.fillStyle = rgb(c); ctx.beginPath(); ctx.roundRect(cx - w / 2, cy - h / 2, w, h, 3); ctx.fill();
      const flick = hash(i, j, Math.floor(t * 1.5)), l = lum(c);
      const chr = RAMP[clamp(Math.floor(1 + l * 5 + flick * 4), 0, RAMP.length - 1)];
      ctx.fillStyle = flick < 0.02 && theme.sprinkle ? theme.sprinkle[((flick * 100) | 0) % theme.sprinkle.length] : rgb(l < 0.45 ? mix(c, [255, 255, 255], 0.45) : mix(c, [0, 0, 0], 0.42), 0.6);
      ctx.fillText(chr, cx, cy + 1);
    }
    if (theme.post) theme.post(ctx, env, self);
    if (self.troca) cobre(theme, t);
  };

  // Theme change: the old picture stays on top and is eaten cell by cell by
  // a wave that starts at `x, y`, its front a line of bright tiles in the new
  // theme's accent, so the new theme surfaces from under the old one.
  self.transicao = (x, y, t, dur = 1.15) => {
    const img = document.createElement("canvas");
    img.width = canvas.width; img.height = canvas.height;
    img.getContext("2d").drawImage(canvas, 0, 0);
    self.troca = { img, x, y, t, dur };
  };
  function cobre(theme, t) {
    const { cw, ch, cols, rows, W, H, dpr } = self, tr = self.troca, p = (t - tr.t) / tr.dur;
    if (p >= 1.08) { self.troca = null; return; }
    const longe = Math.max(Math.hypot(tr.x, tr.y), Math.hypot(W - tr.x, tr.y), Math.hypot(tr.x, H - tr.y), Math.hypot(W - tr.x, H - tr.y));
    const quando = (i, j) => (Math.hypot(i * cw + cw / 2 - tr.x, j * ch + ch / 2 - tr.y) / longe) * 0.86 + hash(i, j, 9) * 0.14;
    const acc = theme.accent;
    for (let j = 0; j < rows; j++) {
      let ini = -1;
      for (let i = 0; i <= cols; i++) {
        const velho = i < cols && quando(i, j) > p;
        if (velho && ini < 0) ini = i;
        if (!velho && ini >= 0) {
          ctx.drawImage(tr.img, ini * cw * dpr, j * ch * dpr, (i - ini) * cw * dpr, ch * dpr, ini * cw, j * ch, (i - ini) * cw, ch);
          ini = -1;
        }
        if (i < cols) {
          const d = p - quando(i, j);
          if (d >= 0 && d < 0.07) {
            const a = 1 - d / 0.07, x = i * cw, y = j * ch;
            ctx.fillStyle = rgb(mix(acc, [255, 255, 255], 0.35), 0.85 * a); ctx.beginPath(); ctx.roundRect(x + 1.5, y + 1.5, cw - 3, ch - 3, 3); ctx.fill();
            glyph(i, j, RAMP[(hash(i, j, Math.floor(t * 20)) * RAMP.length) | 0], rgb([20, 20, 24], 0.55 * a));
          }
        }
      }
    }
  }
  return self;
}
