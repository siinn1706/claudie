// ---------------------------------------------------------------------------
// Subjects, drawn in local units facing +x.

// Claude spark: tapered rays around a soft core; rays reach toward `toward`.
function spark(g, R, t, cols, toward = null, reach = 0) {
  const n = 12;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + t * 0.05 + (hash(k, 3) - 0.5) * 0.12;
    const pull = toward == null ? 0 : Math.max(0, Math.cos(a - toward)) ** 3 * reach;
    const len = R * (0.72 + 0.28 * hash(k, 1)) * (1 + 0.05 * Math.sin(t * 1.6 + k * 1.7) + pull * 0.45), w = R * (0.1 + 0.04 * hash(k, 2));
    g.save(); g.rotate(a);
    g.beginPath(); g.moveTo(0, -w); g.quadraticCurveTo(len * 0.55, -w * 0.75, len, 0); g.quadraticCurveTo(len * 0.55, w * 0.75, 0, w); g.closePath();
    g.fillStyle = k % 2 ? cols[0] : cols[1]; g.fill(); g.restore();
  }
  circ(g, 0, 0, R * 0.2, cols[2]);
}

// Sea turtle from above, drawn for legibility at tile size: a dark domed
// shell with light scutes, and pale skin (head, flippers) set well apart
// from it so the silhouette reads as a turtle.
function turtle(g, t, ph) {
  const f = Math.sin(t * 3.6 + ph), pele = "#d6cf9a", peleEsc = "#a89c5e";
  for (const m of [-1, 1]) {
    g.save(); g.translate(55, 72 * m); g.rotate(m * (0.85 + 0.5 * f));
    ell(g, -6, 74 * m, 32, 100, 0.22 * m, peleEsc); ell(g, -4, 68 * m, 19, 78, 0.22 * m, pele); g.restore();
    g.save(); g.translate(-98, 52 * m); g.rotate(m * (2.4 - 0.3 * f)); ell(g, 0, 32 * m, 22, 42, 0, peleEsc); g.restore();
  }
  ell(g, -150, 0, 26, 9, 0, peleEsc);
  ell(g, 128, 0, 34, 26, 0, peleEsc); ell(g, 170, 0, 44, 35, 0, pele);
  ell(g, 186, -16, 7, 6, 0, "#231d0c"); ell(g, 186, 16, 7, 6, 0, "#231d0c");
  ell(g, 0, 0, 136, 106, 0, "#8a7634");
  const sh = g.createRadialGradient(-14, 0, 10, 0, 0, 122); sh.addColorStop(0, "#5c5020"); sh.addColorStop(1, "#332c10");
  ell(g, -2, 0, 122, 93, 0, sh);
  g.fillStyle = "#a08a40";
  for (const [x, y, r] of [[58, 0, 30], [6, 0, 34], [-50, 0, 30], [34, -54, 26], [-22, -58, 26], [34, 54, 26], [-22, 58, 26]]) {
    g.beginPath(); for (let k = 0; k < 6; k++) g.lineTo(x + r * Math.cos((k * TAU) / 6), y + r * 0.78 * Math.sin((k * TAU) / 6)); g.fill();
  }
}
function manta(g, t) {
  const f = Math.sin(t * 2.5), span = 300 + 22 * f, back = -40 - 30 * f;
  g.beginPath(); g.moveTo(-110, 0); g.lineTo(-330, 4 * f); g.lineWidth = 9; g.strokeStyle = "#1c2733"; g.stroke();
  g.beginPath(); g.moveTo(96, -42); g.quadraticCurveTo(40, -span * 0.75, back, -span); g.quadraticCurveTo(-60, -110, -118, -26);
  g.lineTo(-118, 26); g.quadraticCurveTo(-60, 110, back, span); g.quadraticCurveTo(40, span * 0.75, 96, 42); g.closePath(); g.fillStyle = "#1e2b3a"; g.fill();
  for (const m of [-1, 1]) { ell(g, 120, 40 * m, 34, 12, 0.35 * m, "#26364a"); ell(g, 18, 82 * m, 70, 30, -0.5 * m, "#e9eef0"); ell(g, -10, 150 * m, 40, 18, -0.6 * m, "#8fa3b0"); }
}
function tang(g, t, ph) {
  const b = 0.35 * Math.sin(t * 18 + ph);
  g.save(); g.translate(-30, 0); g.rotate(b); g.beginPath(); g.moveTo(0, 0); g.lineTo(-34, -22); g.lineTo(-28, 0); g.lineTo(-34, 22); g.closePath(); g.fillStyle = "#f2c200"; g.fill(); g.restore();
  ell(g, 8, 0, 46, 18, 0, "#ffd61f"); ell(g, 40, 0, 12, 10, 0, "#ffe46a");
}
function hibiscus(g, s) {
  for (let k = 0; k < 5; k++) { g.save(); g.rotate((k * TAU) / 5); ell(g, 52 * s, 0, 52 * s, 40 * s, 0, "#ef3b5a"); ell(g, 40 * s, 0, 30 * s, 22 * s, 0, "#d42448"); g.restore(); }
  circ(g, 0, 0, 22 * s, "#8a0f2e");
  g.save(); g.rotate(0.6); ell(g, 44 * s, 0, 40 * s, 6 * s, 0, "#ffd84a"); circ(g, 84 * s, 0, 11 * s, "#ffe27a"); g.restore();
}

// Koi seen from above: a tapering body on a waving spine, round head with
// eyes, pectoral fins, a fan tail, and the colour pattern clipped to the body.
function koi(g, t, pal, ph) {
  const N = 14, pts = [];
  for (let k = 0; k <= N; k++) { const u = k / N; pts.push([62 - u * 150, Math.sin(t * 4 + ph - u * 3.4) * (1.5 + u * u * 15)]); }
  const wid = (u) => (u < 0.16 ? 20 + (u / 0.16) * 13 : 33 * Math.pow(1 - (u - 0.16) / 0.84, 0.8) + 4);
  const [tx, ty] = pts[N], [px, py] = pts[N - 2];
  g.save(); g.translate(tx, ty); g.rotate(Math.atan2(ty - py, tx - px) + Math.sin(t * 4 + ph - 3.6) * 0.25);
  g.beginPath(); g.moveTo(-6, 0); g.bezierCurveTo(10, -10, 34, -42, 54, -38); g.quadraticCurveTo(34, 0, 54, 38); g.bezierCurveTo(34, 42, 10, 10, -6, 0);
  g.fillStyle = pal.fin; g.fill(); g.restore();
  const flap = Math.sin(t * 2.6 + ph) * 0.3, [fx, fy] = pts[3];
  for (const m of [-1, 1]) { g.save(); g.translate(fx, fy + m * 26); g.rotate(m * (2.2 + flap)); ell(g, 22, 0, 28, 12, 0, pal.fin); g.restore(); }
  const [bx, by] = pts[9];
  for (const m of [-1, 1]) { g.save(); g.translate(bx, by + m * 9); g.rotate(m * 2.6); ell(g, 9, 0, 11, 5, 0, pal.fin); g.restore(); }
  g.beginPath();
  for (let k = 0; k <= N; k++) g.lineTo(pts[k][0], pts[k][1] - wid(k / N));
  for (let k = N; k >= 0; k--) g.lineTo(pts[k][0], pts[k][1] + wid(k / N));
  g.closePath(); g.moveTo(pts[0][0] + 20, pts[0][1]); g.ellipse(pts[0][0], pts[0][1], 22, 21, 0, 0, TAU);
  g.fillStyle = pal.body; g.fill();
  g.save(); g.clip();
  for (const [u, side, rx, ry, c] of pal.patches) { const p = pts[Math.round(u * N)]; ell(g, p[0], p[1] + side, rx, ry, 0, c); }
  g.restore();
  for (const m of [-1, 1]) circ(g, pts[0][0] + 8, pts[0][1] + m * 12, 3.5, "#141418");
}

function jelly(g, t, c1, c2, ph, glow) {
  const p = Math.sin(t * 1.8 + ph), rx = 60 * (1 + 0.08 * p), ry = 50 * (1 - 0.1 * p);
  g.lineCap = "round";
  for (let k = 0; k < 6; k++) {
    const x0 = (k / 5 - 0.5) * rx * 1.5;
    g.beginPath(); g.moveTo(x0, 4);
    for (let s = 1; s <= 7; s++) g.lineTo(x0 + Math.sin(t * 2 + ph + k + s * 0.7) * (4 + s * 1.8), s * 22);
    g.lineWidth = k % 2 ? 9 : 6; g.strokeStyle = k % 3 ? c2 : c1; g.stroke();
  }
  for (let k = 0; k < 3; k++) {                 // frilly oral arms
    g.beginPath(); g.moveTo((k - 1) * 14, 6);
    for (let s = 1; s <= 5; s++) g.lineTo((k - 1) * 14 + Math.sin(t * 1.4 + ph + s + k) * 9, s * 18);
    g.lineWidth = 12; g.strokeStyle = c1; g.stroke();
  }
  g.beginPath(); g.ellipse(0, 0, rx, ry, 0, Math.PI, TAU);
  for (let k = 0; k <= 6; k++) { const x = rx - (k / 6) * rx * 2; g.quadraticCurveTo(x + rx / 6, 12 + 4 * p, x, 0); }
  g.fillStyle = glow ? `rgb(${mix(hx(c1), [255, 255, 255], glow * 0.4).map((v) => v | 0)})` : c1; g.fill();
  ell(g, 0, -ry * 0.38, rx * 0.55, ry * 0.4, 0, c2);
}

function boat(g, white, shade) {
  g.beginPath(); g.moveTo(-72, -8); g.lineTo(72, -8); g.lineTo(46, 24); g.lineTo(-46, 24); g.closePath(); g.fillStyle = shade; g.fill();
  g.beginPath(); g.moveTo(-72, -8); g.lineTo(72, -8); g.lineTo(60, 7); g.lineTo(-60, 7); g.closePath(); g.fillStyle = white; g.fill();
  g.beginPath(); g.moveTo(-36, -8); g.lineTo(0, -74); g.lineTo(0, -8); g.closePath(); g.fillStyle = white; g.fill();
  g.beginPath(); g.moveTo(36, -8); g.lineTo(0, -74); g.lineTo(0, -8); g.closePath(); g.fillStyle = shade; g.fill();
}

function cloud(g, s, top, bottom) {
  const lobes = [[-64, 10, 34], [-24, -16, 46], [28, -22, 52], [70, 4, 36], [10, 14, 42], [-96, 22, 22], [100, 22, 22]];
  for (const [x, y, r] of lobes) circ(g, x * s, (y + 10) * s, r * s, bottom);
  for (const [x, y, r] of lobes) circ(g, x * s, y * s, r * s, top);
  g.fillStyle = top; g.fillRect(-100 * s, 4 * s, 200 * s, 26 * s);
}

// ---------------------------------------------------------------------------
// Themes. `wake`: the pointer leaves ripples in the water. `click`: what a
// click spawns. Effects with a `draw` are drawn among the subjects, as tiles.

const ripple = (x, y, t, o = {}) => ({ kind: "ripple", x, y, t, life: o.life ?? 1.8, speed: o.speed ?? 300, force: o.force ?? 650, alpha: o.alpha ?? 1, chars: o.chars });

const THEMES = [
  {
    id: "claude", name: "Claude Code", light: false,
    grid: "rgba(255,236,220,0.035)", accent: hx("#e08a64"), sprinkle: ["#f5c4a8", "#ffffff"], trailGlyph: "·'.",
    bg(ctx, { W, H, t }) {
      ctx.fillStyle = rad(ctx, W * 0.72, H * 0.28, 0, Math.max(W, H) * 0.75, [[0, "#3b2217"], [0.4, "#1b130f"], [1, "#0b0908"]]); ctx.fillRect(0, 0, W, H);
      glowAt(ctx, W * 0.72, H * 0.28, Math.min(W, H) * 0.42, "rgba(224,128,90,A)", 0.12 + 0.03 * Math.sin(t));
    },
    ambient({ W, H, t, cw, ch }, glyph) {
      for (let k = 0; k < 40; k++) {
        const x = hash(k, 1) * W + Math.sin(t * 0.3 + k) * 20, y = ((hash(k, 2) * H - t * (6 + hash(k, 3) * 10)) % H + H) % H;
        glyph(Math.floor(x / cw), Math.floor(y / ch), "·", `rgba(224,138,100,${0.2 + 0.3 * hash(k, 5)})`);
      }
    },
    click(x, y, t, R) { R.add({ kind: "burst", x, y, t, life: 1.6 }); },
    scene(g, env) {
      const { W, H, t, k, mouse } = env;
      const pulse = env.effects.filter((f) => f.kind === "burst").reduce((m, f) => Math.max(m, 1 - (t - f.t) / f.life), 0);
      const [x, y] = env.body("spark", W * 0.72, H * 0.28, "flee", 280, 0.35);
      const R = Math.min(W, H) * 0.22 * (1 + pulse * 0.12);
      const toward = mouse ? Math.atan2(mouse.y - y, mouse.x - x) - t * 0.05 : null;
      const hs = env.hovered("spark");
      g.save(); g.translate(x, y); g.rotate(hs >= 0 ? (1 - Math.exp(-hs * 1.5)) * 1.2 : 0); spark(g, R, t, ["#d97757", "#c96846", "#eea684"], toward, env.near(x, y, 520)); g.restore();
      env.hit("spark", x, y, R * 0.75, "spark");
      const [bx, by] = env.body("mini", W * 0.16, H * 0.22, "flee", 220, 1);
      g.save(); g.translate(bx, by + Math.sin(t * 2) * 6); spark(g, Math.min(W, H) * 0.05, -t * 2 - Math.max(0, env.hovered("mini")) * 6, ["#d97757", "#b85a3c", "#f0b090"]); g.restore();
      env.hit("mini", bx, by, Math.min(W, H) * 0.06, "mini");
      for (const f of env.effects) if (f.kind === "burst") {
        const age = (t - f.t) / f.life;
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * TAU + hash(i, f.t) * 0.4, d = age * 200 * k * (0.7 + hash(i, 2) * 0.6);
          g.save(); g.translate(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d); g.globalAlpha = 1 - age; spark(g, 14 * k * (1 - age * 0.5), t * 3, ["#e08a64", "#c96846", "#f5c4a8"]); g.restore();
        }
      }
    },
  },
  {
    id: "clouds", name: "Cloud Drift", light: true,
    grid: "rgba(255,255,255,0.09)", accent: hx("#ffffff"), shadow: "rgba(40,100,160,0.08)",
    bg(ctx, { W, H }) {
      ctx.fillStyle = lin(ctx, 0, 0, 0, H, [[0, "#4ea2e6"], [0.55, "#93cbf3"], [1, "#d9effc"]]); ctx.fillRect(0, 0, W, H);
      glowAt(ctx, W * 0.85, H * 0.1, Math.min(W, H) * 0.5, "rgba(255,250,225,A)", 0.45);
    },
    ambient({ W, H, t, cw, ch }, glyph) {
      for (let k = 0; k < 4; k++) {
        const x = ((hash(k, 7) * W + t * 40) % (W + 200)) - 100, y = H * (0.12 + 0.25 * hash(k, 8)) + Math.sin(t * 2 + k) * 6;
        glyph(Math.floor(x / cw), Math.floor(y / ch), Math.sin(t * 6 + k) > 0 ? "v" : "^", "rgba(30,70,110,0.55)");
      }
    },
    click(x, y, t, R) { R.add({ kind: "puff", x, y, t, life: 2.2 }); R.add(ripple(x, y, t, { chars: "·", alpha: 0.6, force: 900, speed: 380, life: 1.2 })); },
    scene(g, env) {
      const { W, H, t, k } = env;
      const specs = [[0.02, 0.14, 1.35, 12], [0.48, 0.3, 1.0, 8], [0.78, 0.1, 1.15, 10], [0.3, 0.52, 0.85, 6], [0.92, 0.48, 1.4, 14]];
      specs.forEach(([x0, y0, s, sp], i) => {
        const span = W + 600, x = ((x0 * span + t * sp * 2.2) % span) - 300;
        const [px, py] = env.body("c" + i, x, y0 * H + Math.sin(t * 0.4 + x0 * 9) * 8, "flee", 300, 0.8);
        const h = env.hovered("c" + i), puff = h >= 0 ? 1 + 0.08 * Math.sin(h * 7) * Math.exp(-h * 1.5) : 1;
        g.save(); g.translate(px, py); cloud(g, s * k * 1.7 * puff, "#ffffff", "#cfe4f6"); g.restore();
        env.hit("c" + i, px, py, 100 * s * k * 1.7, "cloud");
      });
      for (const f of env.effects) if (f.kind === "puff") {
        const age = (t - f.t) / f.life;
        for (let i = 0; i < 3; i++) {
          g.save(); g.translate(f.x + (i - 1) * 50 * k + age * 40 * k, f.y - age * 30 * k); g.globalAlpha = 1 - age;
          cloud(g, (0.25 + age * 0.35) * k * (1 + hash(i, 4) * 0.4), "#ffffff", "#dcebf8"); g.restore();
        }
      }
    },
  },
  {
    id: "lagoon", name: "Honu Lagoon", light: true, wake: true,
    grid: "rgba(255,255,255,0.07)", accent: hx("#ffffff"), shadow: "rgba(4,60,84,0.14)",
    bg(ctx, { W, H, t }) {
      ctx.fillStyle = lin(ctx, 0, 0, W * 0.45, H * 0.9, [[0, "#b2f4e8"], [0.42, "#4ad6d6"], [0.78, "#1aa8ca"], [1, "#0e80b6"]]); ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.globalCompositeOperation = "screen";
      for (let k = 0; k < 4; k++) {
        const off = ((t / 24.5 + k / 4) % 1) * (W + H) * 1.2 - H * 0.6;
        ctx.fillStyle = lin(ctx, off, 0, off + 260, 160, [[0, "rgba(255,255,255,0)"], [0.5, "rgba(255,255,240,0.1)"], [1, "rgba(255,255,255,0)"]]); ctx.fillRect(0, 0, W, H);
      }
      ctx.restore();
    },
    ambient({ cw, ch, t }, glyph, R) {
      const w = TAU / 24.5;
      for (let j = 0; j < R.rows; j++) for (let i = 0; i < R.cols; i++) {
        const x = i * cw, y = j * ch;
        const v = Math.sin(x * 0.011 + y * 0.004 + w * 2 * t + 1.6 * Math.sin(y * 0.007 - w * 3 * t)) + Math.sin(-x * 0.006 + y * 0.012 - w * 3 * t + 1.6 * Math.sin(x * 0.008 + w * 2 * t)) + Math.sin(x * 0.009 - y * 0.009 + w * 4 * t);
        if (v > 1.7) { const k = Math.min(1, (v - 1.7) / 1.1); glyph(i, j, k > 0.6 ? "~" : k > 0.3 ? "-" : "·", `rgba(255,255,255,${0.14 + 0.36 * k})`); }
      }
    },
    click(x, y, t, R) { R.add(ripple(x, y, t)); },
    scene(g, env) {
      const { W, H, t, k } = env, w = TAU / 24.5;
      const path = (cx, cy, rx, ry, sp, ph) => (tt) => [W * cx + W * rx * Math.cos(sp * w * tt + ph), H * cy + H * ry * Math.sin(sp * w * tt + ph)];
      const put = (key, fn, s, mode, kind, r, draw) => {
        const [x0, y0] = fn(t), [x1, y1] = fn(t + 0.05), [x, y] = env.body(key, x0, y0, mode, 240, 1), a = Math.atan2(y1 - y0, x1 - x0), h = env.hovered(key);
        g.save(); g.translate(x, y); g.rotate(a); g.scale(s * k, s * k); draw(h); g.restore();
        env.hit(key, x, y, r * s * k, kind);
        return [x, y, a, h];
      };
      // A touched turtle paddles faster and lets out a string of bubbles.
      const bolhas = (x, y, h) => {
        if (h < 0 || h > 2.2) return;
        for (let i = 0; i < 6; i++) { const age = h - i * 0.16; if (age > 0) circ(g, x + Math.sin(age * 6 + i) * 7 * k, y - age * 80 * k, (3.5 + (i % 2) * 2.5) * k, `rgba(235,255,255,${clamp(1 - age / 1.8)})`); }
      };
      put("manta", path(0.5, 0.42, 0.42, 0.34, -1, 3.6), 0.44, "flee", "manta", 280, (h) => manta(g, t + Math.max(0, h) * 1.5));
      const [ax, ay, , ah] = put("t1", path(0.5, 0.45, 0.4, 0.3, 1, 0.3), 0.62, "curious", "turtle", 150, (h) => turtle(g, t + Math.max(0, h) * 2.2, 0));
      bolhas(ax, ay, ah);
      const [bx, by, , bh] = put("t2", path(0.45, 0.4, 0.3, 0.32, -1, 1.5), 0.5, "curious", "turtle", 150, (h) => turtle(g, t + Math.max(0, h) * 2.2, 2));
      bolhas(bx, by, bh);
      const [sx, sy, sa, sh] = put("school", path(0.5, 0.36, 0.38, 0.22, 2, 5), 1, "flee", "school", 130, () => {});
      const spread = 0.52 * k * (1 + (sh >= 0 ? 0.9 * Math.exp(-sh * 1.4) : 0));
      [[0, 0], [-110, -60], [-110, 65], [-220, -10], [-215, -120], [-215, 115]].forEach(([fx, fy], i) => {
        const ca = Math.cos(sa), sn = Math.sin(sa), wob = 12 * Math.sin(t * 1.8 + i);
        g.save(); g.translate(sx + (fx * ca - (fy + wob) * sn) * spread, sy + (fx * sn + (fy + wob) * ca) * spread); g.rotate(sa); g.scale(k * 0.62, k * 0.62); tang(g, t + Math.max(0, sh), i); g.restore();
      });
      [[0, 0.16, 0.48], [0.5, 0.7, 0.4]].forEach(([p0, y0, s], i) => {
        const u = (p0 + t / 49) % 1, [fx, fy] = env.body("f" + i, -100 + u * (W + 200), H * y0 + Math.sin(t * 0.5 + i) * 20, "flee", 200, 1), h = env.hovered("f" + i);
        g.save(); g.translate(fx, fy); g.rotate(w * t + i * 3 + (h >= 0 ? (1 - Math.exp(-h * 2)) * 2.4 : 0)); g.scale(k, k); hibiscus(g, s); g.restore();
        env.hit("f" + i, fx, fy, 95 * s * k, "flower");
      });
    },
  },
  {
    id: "koi", name: "Koi Pond", light: false, wake: true,
    grid: "rgba(220,255,240,0.045)", accent: hx("#d8ffe8"), shadow: "rgba(0,30,25,0.28)",
    bg(ctx, { W, H, t }) {
      ctx.fillStyle = rad(ctx, W * 0.55, H * 0.42, 0, Math.max(W, H) * 0.8, [[0, "#2a8a7f"], [0.55, "#196258"], [1, "#0c3631"]]); ctx.fillRect(0, 0, W, H);
      for (let k = 0; k < 5; k++) glowAt(ctx, W * hash(k, 1) + Math.sin(t * 0.2 + k) * 60, H * hash(k, 2), Math.min(W, H) * 0.25, "rgba(190,255,220,A)", 0.06);
    },
    ambient({ W, H, t, cw, ch }, glyph) {
      for (let k = 0; k < 24; k++) {
        const x = hash(k, 3) * W, y = hash(k, 4) * H, b = (Math.sin(t * 1.1 + k * 2) + 1) / 2;
        if (b > 0.65) glyph(Math.floor(x / cw), Math.floor(y / ch), "o", `rgba(220,255,240,${(b - 0.65) * 0.7})`);
      }
    },
    click(x, y, t, R) { R.add({ kind: "food", x, y, t, life: 6 }); R.add(ripple(x, y, t, { alpha: 0.7, speed: 220, life: 1.4, force: 200 })); },
    scene(g, env) {
      const { W, H, t, k } = env;
      const pads = [[0.1, 0.18, 78], [0.86, 0.14, 88], [0.08, 0.7, 70], [0.9, 0.62, 64]];
      pads.forEach(([px, py, r], i) => {
        const [x, y] = env.body("p" + i, px * W, py * H, "flee", 160, 0.25);
        const rr = r * k * 1.15;
        env.hit("p" + i, x, y, rr, "pad");
        g.save(); g.translate(x, y); g.rotate(i * 1.7 + Math.sin(t * 0.1 + i) * 0.1);
        g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, rr, 0.32, TAU - 0.02); g.closePath(); g.fillStyle = i % 2 ? "#3f9e4c" : "#4fae55"; g.fill();
        g.lineWidth = 3 * k; g.strokeStyle = "#2f7d3b"; for (let v = 1; v < 6; v++) { const a = 0.3 + (v / 6) * (TAU - 0.3); g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * rr * 0.85, Math.sin(a) * rr * 0.85); g.stroke(); }
        if (i === 1 || i === 2) {
          g.save(); g.translate(-rr * 0.25, rr * 0.2);
          for (let p = 0; p < 8; p++) { g.save(); g.rotate((p * TAU) / 8 + 0.2); ell(g, 26 * k, 0, 26 * k, 11 * k, 0, "#ff8fbf"); g.restore(); }
          for (let p = 0; p < 6; p++) { g.save(); g.rotate((p * TAU) / 6); ell(g, 15 * k, 0, 15 * k, 8 * k, 0, "#ffc4dc"); g.restore(); }
          circ(g, 0, 0, 8 * k, "#ffd84a"); g.restore();
        }
        g.restore();
      });
      const fishes = [
        { pal: { body: "#fbf7ef", fin: "rgba(255,244,236,0.9)", patches: [[0, 0, 18, 16, "#e8401c"], [0.36, -8, 30, 24, "#e8401c"], [0.64, 8, 22, 16, "#e8401c"]] }, p: [0.5, 0.36, 0.3, 0.2, 0.2, 0] },
        { pal: { body: "#ffb42a", fin: "rgba(255,214,130,0.9)", patches: [[0, 0, 20, 18, "#ffe08a"], [0.5, 0, 14, 40, "#ffc53d"]] }, p: [0.44, 0.44, 0.34, 0.24, -0.17, 2] },
        { pal: { body: "#202027", fin: "rgba(70,70,84,0.92)", patches: [[0.05, 0, 17, 16, "#e5482a"], [0.32, 10, 24, 16, "#f3f0e8"], [0.5, -10, 24, 18, "#e5482a"], [0.78, 5, 16, 10, "#f3f0e8"]] }, p: [0.56, 0.4, 0.26, 0.26, 0.23, 4] },
      ];
      fishes.forEach(({ pal, p: [cx, cy, rx, ry, sp, ph] }, i) => {
        const at = (tt) => [W * cx + W * rx * Math.cos(sp * tt + ph), H * cy + H * ry * Math.sin(sp * tt * 1.3 + ph)];
        const [x0, y0] = at(t), [x, y, vx, vy] = env.body("k" + i, x0, y0, "curious", 420, 1), [x1, y1] = at(t + 0.08);
        const ang = Math.atan2(y1 - y0 + vy * 0.08, x1 - x0 + vx * 0.08), prev = env.mem.get("kang" + i) ?? ang, dA = Math.atan2(Math.sin(ang - prev), Math.cos(ang - prev));
        env.mem.set("kang" + i, prev + dA * Math.min(1, env.dt * 3));
        const h = env.hovered("k" + i);
        g.save(); g.translate(x, y); g.rotate(env.mem.get("kang" + i)); g.scale(k * 1.55, k * 1.55); koi(g, t + Math.max(0, h) * 2.5, pal, i * 1.7); g.restore();
        env.hit("k" + i, x, y, 80 * k * 1.55, "koi");
      });
      for (const f of env.effects) if (f.kind === "food") {
        const age = (t - f.t) / f.life;
        g.save(); g.globalAlpha = 1 - age;
        for (let i = 0; i < 4; i++) circ(g, f.x + (hash(i, f.t) - 0.5) * 30 * k, f.y + (hash(f.t, i) - 0.5) * 22 * k + age * 8, 6 * k, "#b07a3a");
        g.restore();
      }
    },
  },
  {
    id: "jelly", name: "Jellyfish", light: false,
    grid: "rgba(160,200,255,0.05)", accent: hx("#9fd0ff"), sprinkle: ["#ffffff"],
    bg(ctx, { W, H, t }) {
      ctx.fillStyle = lin(ctx, 0, 0, 0, H, [[0, "#0f4373"], [0.5, "#08223f"], [1, "#020a17"]]); ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.globalCompositeOperation = "screen";
      for (let k = 0; k < 4; k++) {
        const x = W * (0.12 + 0.25 * k) + Math.sin(t * 0.2 + k) * 60;
        ctx.fillStyle = lin(ctx, x, 0, x + 120, H, [[0, "rgba(140,200,255,0.11)"], [1, "rgba(140,200,255,0)"]]);
        ctx.beginPath(); ctx.moveTo(x - 30, 0); ctx.lineTo(x + 60, 0); ctx.lineTo(x + 260, H); ctx.lineTo(x + 120, H); ctx.fill();
      }
      ctx.restore();
    },
    ambient({ W, H, t, cw, ch }, glyph) {
      for (let k = 0; k < 70; k++) {
        const x = hash(k, 1) * W + Math.sin(t * 0.5 + k) * 10, y = ((hash(k, 2) * H - t * (5 + 8 * hash(k, 3))) % H + H) % H;
        glyph(Math.floor(x / cw), Math.floor(y / ch), "·", `rgba(170,215,255,${0.15 + 0.3 * hash(k, 5)})`);
      }
    },
    click(x, y, t, R) { R.add({ kind: "bubbles", x, y, t, life: 3 }); },
    scene(g, env) {
      const { W, H, t, k } = env;
      const js = [[0.14, 1.15, "#ff8fc8", "#ffc6e4", 12], [0.4, 0.85, "#b49cff", "#dcd0ff", 9], [0.66, 1.3, "#ff9f7a", "#ffd2bd", 14], [0.88, 0.95, "#8fe3ff", "#d0f4ff", 10]];
      js.forEach(([px, s, c1, c2, sp], i) => {
        const span = H + 600, y = span - ((t * sp + hash(i, 9) * span) % span) - 200, x = px * W + Math.sin(t * 0.3 + i * 2) * 50;
        const [qx, qy] = env.body("j" + i, x, y, "flee", 260, 0.7);
        const h = env.hovered("j" + i);
        g.save(); g.translate(qx, qy); g.rotate(Math.sin(t * 0.4 + i) * 0.12); g.scale(s * k * 1.3, s * k * 1.3); jelly(g, t + Math.max(0, h) * 1.6, c1, c2, i * 1.3, Math.max(env.near(qx, qy, 260), h >= 0 ? 0.8 : 0)); g.restore();
        env.hit("j" + i, qx, qy, 70 * s * k * 1.3, "jelly");
      });
      for (const f of env.effects) if (f.kind === "bubbles") {
        const age = t - f.t;
        for (let i = 0; i < 9; i++) circ(g, f.x + (hash(i, 1) - 0.5) * 60 * k + Math.sin(age * 3 + i) * 8, f.y - age * (60 + hash(i, 2) * 80) * k, (4 + hash(i, 3) * 6) * k, `rgba(200,235,255,${0.9 * (1 - age / f.life)})`);
      }
    },
  },
  {
    id: "boats", name: "Paper Boats", light: true, wake: true,
    grid: "rgba(255,255,255,0.07)", accent: hx("#ffffff"), shadow: "rgba(20,60,70,0.16)",
    bg(ctx, { W, H }) { ctx.fillStyle = lin(ctx, 0, 0, 0, H, [[0, "#9cc9cc"], [0.5, "#6aa3ab"], [1, "#3e7681"]]); ctx.fillRect(0, 0, W, H); },
    ambient({ t }, glyph, R) {
      for (let j = 0; j < R.rows; j++) for (let i = 0; i < R.cols; i++) {
        const v = Math.sin(i * 0.35 - t * 1.2 + Math.sin(j * 0.6 + t * 0.4) * 1.5) + Math.sin(j * 0.9 + t * 0.3);
        if (v > 1.5) glyph(i, j, v > 1.78 ? "~" : "-", `rgba(255,255,255,${(v - 1.5) * 0.55})`);
      }
    },
    click(x, y, t, R) { R.add(ripple(x, y, t, { force: 900 })); },
    scene(g, env) {
      const { W, H, t, k } = env;
      const bs = [[0.08, 0.24, 1.15, 6, 0], [0.5, 0.15, 0.85, 4, 1], [0.78, 0.36, 1.3, 7, 0], [0.3, 0.6, 1.0, 5, 2]];
      bs.forEach(([px, py, s, sp, cor], i) => {
        const span = W + 400, x = ((px * span + t * sp * 3) % span) - 200, y = py * H + Math.sin(t * 1.4 + i) * 7;
        const [qx, qy, vx] = env.body("b" + i, x, y, "flee", 260, 0.9);
        const h = env.hovered("b" + i), balanco = h >= 0 ? Math.sin(h * 9) * 0.22 * Math.exp(-h * 1.3) : 0;
        env.hit("b" + i, qx, qy, 75 * s * k * 1.6, "boat");
        g.save(); g.translate(qx, qy); g.rotate(Math.sin(t * 1.1 + i) * 0.07 + clamp(vx / 600, -0.35, 0.35) + balanco); g.scale(s * k * 1.6, s * k * 1.6);
        boat(g, cor === 1 ? "#ef6a4c" : cor === 2 ? "#f6d24a" : "#fbf8f1", cor === 1 ? "#c24a30" : cor === 2 ? "#d9b02a" : "#d6cfbf"); g.restore();
      });
      for (let i = 0; i < 4; i++) {
        const x = ((hash(i, 3) * W + t * 12) % (W + 100)) - 50, [qx, qy] = env.body("l" + i, x, hash(i, 4) * H * 0.8, "flee", 180, 1);
        g.save(); g.translate(qx, qy); g.rotate(t * 0.3 + i); ell(g, 0, 0, 18 * k, 8 * k, 0, i % 2 ? "#e2893a" : "#c9b23c"); g.restore();
      }
    },
  },
  {
    id: "fireflies", name: "Fireflies", light: false,
    grid: "rgba(200,255,200,0.035)", accent: hx("#f6ff8a"), liftTo: [255, 255, 200], trailGlyph: "·.",
    flies(env) {
      const { W, H, t } = env;
      if (env._flies && env._fliesT === t) return env._flies;
      const out = [];
      for (let i = 0; i < 22; i++) {
        const x = hash(i, 1) * W + Math.sin(t * 0.25 + i) * 70, y = H * (0.12 + 0.6 * hash(i, 2)) + Math.sin(t * 0.33 + i * 2) * 40;
        const b = clamp(Math.sin(t * (0.7 + hash(i, 3) * 0.8) + i * 7) * 1.4 - 0.2);
        const [px, py] = env.body("f" + i, x, y, "attract", 300, 0.9);
        out.push([px, py, Math.max(b, env.near(px, py, 160))]);
      }
      for (const f of env.effects) if (f.kind === "swarm") {
        const age = (t - f.t) / f.life;
        for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU + age * 2, d = age * 160 * env.k + 10; out.push([f.x + Math.cos(a) * d, f.y + Math.sin(a) * d - age * 40, (1 - age) * (0.6 + 0.4 * Math.sin(t * 9 + i))]); }
      }
      env._flies = out; env._fliesT = t;
      return out;
    },
    click(x, y, t, R) { R.add({ kind: "swarm", x, y, t, life: 2.5 }); },
    bg(ctx, env) {
      const { W, H } = env;
      ctx.fillStyle = lin(ctx, 0, 0, 0, H, [[0, "#0c2119"], [0.6, "#07130e"], [1, "#030806"]]); ctx.fillRect(0, 0, W, H);
      glowAt(ctx, W * 0.15, H * 0.08, Math.min(W, H) * 0.5, "rgba(170,210,190,A)", 0.08);
      ctx.fillStyle = "#06100c";
      for (let x = 0; x < W; x += 6) { const h = H * (0.2 + 0.1 * Math.sin(x * 0.01) + 0.06 * Math.sin(x * 0.037)); ctx.fillRect(x, H * 0.62 - h * 0.5, 6, H); }
      for (const [x, y, b] of this.flies(env)) if (b > 0.05) glowAt(ctx, x, y, 64, "rgba(230,255,120,A)", b * 0.3);
    },
    scene(g, env) {
      const { W, H, t, k } = env;
      g.lineCap = "round";
      for (let i = 0; i < W / 14; i++) {
        const x0 = hash(i, 5) * W, h = H * (0.1 + 0.2 * hash(i, 6)), [mx] = env.body("g" + i, x0, H - h * 0.6, "flee", 140, 0.6);
        const sway = Math.sin(t * 0.9 + x0 * 0.01) * 16 + (mx - x0);
        g.beginPath(); g.moveTo(x0, H + 10); g.quadraticCurveTo(x0 + sway * 0.4, H - h * 0.5, x0 + sway, H - h);
        g.lineWidth = 7 * k + 4; g.strokeStyle = ["#2f7d3d", "#3f9a4c", "#1f5a2c", "#56b05a"][i % 4]; g.stroke();
      }
      this.flies(env).forEach(([x, y, b], i) => { if (b > 0.3) { circ(g, x, y, 7 + 4 * b, b > 0.75 ? "#fbff9a" : "#d6f04a"); if (i < 22) env.hit("f" + i, x, y, 26, "fly"); } });
    },
  },
  {
    id: "moonlit", name: "Moonlit", light: false,
    grid: "rgba(180,200,255,0.05)", accent: hx("#c9d6ff"), sprinkle: ["#ffffff", "#ffe9a8"], trailGlyph: "*+·",
    bg(ctx, { W, H }) {
      ctx.fillStyle = lin(ctx, 0, 0, 0, H, [[0, "#0a1236"], [0.6, "#14275f"], [1, "#22407e"]]); ctx.fillRect(0, 0, W, H);
      glowAt(ctx, W * 0.74, H * 0.22, Math.min(W, H) * 0.4, "rgba(220,215,170,A)", 0.12);
    },
    ambient({ W, H, t, cw, ch, mouse }, glyph) {
      for (let k = 0; k < 110; k++) {
        const x = hash(k, 1) * W, y = hash(k, 2) * H * 0.8;
        const near = mouse ? clamp(1 - Math.hypot(x - mouse.x, y - mouse.y) / 200) : 0;
        const b = clamp((Math.sin(t * (0.8 + hash(k, 3) * 2) + k) + 1) / 2 + near);
        glyph(Math.floor(x / cw), Math.floor(y / ch), b > 0.85 ? "*" : b > 0.5 ? "+" : "·", `rgba(230,236,255,${0.2 + b * 0.7})`);
      }
    },
    click(x, y, t, R) { R.add({ kind: "star", x, y, t, life: 1.3 }); },
    scene(g, env) {
      const { W, H, t, k } = env;
      const [mx, my] = env.body("moon", W * 0.74, H * 0.22, "flee", 240, 0.3), r = 100 * k;
      env.hit("moon", mx, my, r, "moon");
      g.save(); g.translate(mx, my);
      circ(g, 0, 0, r, "#ddd3a6");
      circ(g, -r * 0.3, -r * 0.2, r * 0.16, "#bfb488"); circ(g, -r * 0.5, r * 0.35, r * 0.12, "#bfb488"); circ(g, -r * 0.05, r * 0.55, r * 0.09, "#c7bc90");
      g.globalCompositeOperation = "destination-out"; circ(g, r * 0.5, -r * 0.18, r * 0.9, "#000"); g.globalCompositeOperation = "source-over";
      g.restore();
      const cl = [[0.06, 0.2, 1.25, 5], [0.55, 0.38, 1.5, 3], [0.25, 0.58, 1.05, 4], [0.85, 0.66, 1.2, 6]];
      cl.forEach(([px, py, s, sp], i) => {
        const span = W + 800, x = ((px * span + t * sp * 4) % span) - 400, [qx, qy] = env.body("c" + i, x, py * H, "flee", 280, 0.7);
        env.hit("c" + i, qx, qy, 170 * s * k, "cloud");
        g.save(); g.translate(qx, qy); g.scale(s * k, s * k);
        const rr = (x, y, w, h, c) => { g.beginPath(); g.roundRect(x, y, w, h, h / 2); g.fillStyle = c; g.fill(); };
        rr(-180, 12, 360, 38, "#4a5ea0"); rr(-125, -20, 240, 38, "#5b70b4"); rr(-62, -48, 136, 32, "#7286c8"); rr(-210, 34, 170, 22, "#3e5190");
        g.restore();
      });
      for (const f of env.effects) if (f.kind === "star") {
        const age = (t - f.t) / f.life, hx0 = f.x - age * 420 * k, hy0 = f.y + age * 200 * k;
        for (let s = 0; s < 12; s++) circ(g, hx0 + s * 16 * k, hy0 - s * 7.6 * k, (13 - s * 0.8) * k, `rgba(255,250,230,${Math.min(1, (1 - age) * 1.4) * (1 - s / 12)})`);
      }
    },
  },
];
