// ---------------------------------------------------------------------------
// Sound, synthesised with Web Audio: no files. Each theme has a bed (sea
// waves, water, wind, crickets) under a calm generative score (soft chords
// and a wandering pentatonic melody, all through a long reverb), and a voice
// for each subject the pointer touches, for moving through water and for a
// click. Off by default; the browser only lets audio start after a gesture.

const Som = (() => {
  let ctx = null, master = null, reverb = null, noiseBuf = null, ligado = false, volume = 0.7, tema = null, pararAmbiente = null;

  // A stereo impulse response of decaying noise: a soft hall, no file needed.
  function salao(seg = 3.2) {
    const n = Math.floor(ctx.sampleRate * seg), ir = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6); }
    return ir;
  }

  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.ratio.value = 3;
    master = ctx.createGain(); master.gain.value = 0;
    master.connect(comp).connect(ctx.destination);
    const conv = ctx.createConvolver(); conv.buffer = salao();
    reverb = ctx.createGain(); reverb.gain.value = 0.9;
    reverb.connect(conv).connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = (b + 0.02 * w) / 1.02; d[i] = w * 0.6 + b * 3; }
  }

  const agora = () => ctx.currentTime;
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const ganho = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const filtro = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const ruido = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(0, Math.random() * 2.5); return s; };
  const lfo = (rate, depth, param) => { const o = ctx.createOscillator(); o.frequency.value = rate; const g = ganho(depth); o.connect(g).connect(param); o.start(); return o; };
  const pan = (v) => { const p = ctx.createStereoPanner(); p.pan.value = v; return p; };
  // Sends a node to `out` dry and into the hall by `molhado`.
  const saida = (node, out, molhado = 0.3) => { node.connect(out); if (molhado) { const s = ganho(molhado); node.connect(s).connect(out.wet || reverb); } };

  function tom({ type = "sine", f0, f1 = f0, dur = 0.2, vol = 0.2, at = 0, attack = 0.006, out = master, molhado = 0.15 }) {
    const t = agora() + at, o = ctx.createOscillator(), g = ganho(0);
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); saida(g, out, molhado); o.start(t); o.stop(t + dur + 0.05);
  }
  function sopro({ type = "bandpass", f0 = 800, f1 = f0, q = 1, dur = 0.3, vol = 0.2, at = 0, attack = 0.02, out = master, molhado = 0.1 }) {
    const t = agora() + at, s = ctx.createBufferSource(), b = filtro(type, f0, q), g = ganho(0);
    s.buffer = noiseBuf; s.loop = true;
    b.frequency.setValueAtTime(f0, t); b.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(b).connect(g); saida(g, out, molhado); s.start(t, Math.random() * 2); s.stop(t + dur + 0.05);
  }
  const notas = (fs, passo, o) => fs.forEach((f, i) => tom({ ...o, f0: f, at: (o.at || 0) + i * passo }));

  // ---- instruments for the score --------------------------------------------
  // Each plays one note `m` (MIDI) into `out` at volume `v`.
  const TIMBRES = {
    // Music box: a bright fundamental with fast-fading upper partials.
    caixinha(m, v, out) {
      const f = hz(m);
      tom({ f0: f, dur: 2.6, vol: v, out, molhado: 0.55 });
      tom({ f0: f * 2, dur: 0.9, vol: v * 0.32, out, molhado: 0.55 });
      tom({ f0: f * 3.01, dur: 0.35, vol: v * 0.12, out, molhado: 0.55 });
    },
    // Plucked string (ukulele, kalimba): triangle through a closing filter.
    dedilhado(m, v, out) {
      const t = agora(), f = hz(m), o = ctx.createOscillator(), lp = filtro("lowpass", f * 6, 0.8), g = ganho(0);
      o.type = "triangle"; o.frequency.value = f;
      lp.frequency.setValueAtTime(f * 7, t); lp.frequency.exponentialRampToValueAtTime(f * 1.4, t + 0.6);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      o.connect(lp).connect(g); saida(g, out, 0.45); o.start(t); o.stop(t + 1.7);
    },
    // Koto: a pluck that bends up into the note.
    koto(m, v, out) {
      const f = hz(m);
      tom({ type: "triangle", f0: f * 0.97, f1: f, dur: 1.9, vol: v, out, molhado: 0.6, attack: 0.003 });
      tom({ f0: f * 2, dur: 0.6, vol: v * 0.25, out, molhado: 0.6 });
    },
    // Glass bell: inharmonic partials, long ring.
    sino(m, v, out) {
      const f = hz(m);
      tom({ f0: f, dur: 4, vol: v, out, molhado: 0.7, attack: 0.02 });
      tom({ f0: f * 2.76, dur: 1.8, vol: v * 0.25, out, molhado: 0.7, attack: 0.02 });
      tom({ f0: f * 5.4, dur: 0.7, vol: v * 0.08, out, molhado: 0.7 });
    },
    // Soft electric piano: sine pair with a slow tremolo.
    teclado(m, v, out) {
      const t = agora(), f = hz(m), g = ganho(0);
      [1, 2].forEach((k, i) => { const o = ctx.createOscillator(); o.frequency.value = f * k; const gg = ganho(i ? 0.18 : 1); o.connect(gg).connect(g); o.start(t); o.stop(t + 2.6); });
      const trem = lfo(4.5, v * 0.25, g.gain);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
      saida(g, out, 0.4); trem.stop(t + 2.6);
    },
    // Breathy flute: sine with vibrato and a little air.
    flauta(m, v, out) {
      const t = agora(), f = hz(m), o = ctx.createOscillator(), g = ganho(0);
      o.frequency.value = f; const vib = lfo(5, f * 0.006, o.frequency);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.12); g.gain.setValueAtTime(v, t + 0.9); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
      o.connect(g); saida(g, out, 0.5); o.start(t); o.stop(t + 1.9); vib.stop(t + 1.9);
      sopro({ type: "bandpass", f0: f * 2, q: 2, dur: 0.5, vol: v * 0.15, out, molhado: 0.3 });
    },
    // Brassy pad voice: detuned saws through a filter that opens and closes.
    metal(m, v, out) {
      const t = agora(), f = hz(m), lp = filtro("lowpass", 300, 1.2), g = ganho(0);
      [-7, 7].forEach((c) => { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; o.detune.value = c; o.connect(lp); o.start(t); o.stop(t + 2.4); });
      lp.frequency.setValueAtTime(300, t); lp.frequency.linearRampToValueAtTime(1600, t + 0.35); lp.frequency.exponentialRampToValueAtTime(500, t + 2.2);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.3);
      lp.connect(g); saida(g, out, 0.55);
    },
    // Synth arpeggio pluck: a square through a snapping filter.
    arp(m, v, out) {
      const t = agora(), f = hz(m), o = ctx.createOscillator(), lp = filtro("lowpass", 2400, 4), g = ganho(0);
      o.type = "square"; o.frequency.value = f;
      lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(400, t + 0.25);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(lp).connect(g); saida(g, out, 0.4); o.start(t); o.stop(t + 0.4);
    },
    // Chiptune square: a short 8-bit blip.
    chip(m, v, out) { tom({ type: "square", f0: hz(m), dur: 0.16, vol: v, out, molhado: 0.1, attack: 0.002 }); },
  };

  // Generative score: soft chords that change every `compasso` seconds and a
  // melody that wanders the scale by small steps, with rests.
  function partitura(out, nos, cada, o) {
    let acorde = 0, passo = Math.floor(o.escala.length / 2);
    const tocaAcorde = () => {
      const t = agora(), notasAc = o.acordes[acorde++ % o.acordes.length], dur = o.compasso + 4;
      const lp = filtro("lowpass", o.brilho ?? 900, 0.5), g = ganho(0);
      lp.connect(g); saida(g, out, 0.6);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.pad, t + 2.5); g.gain.setValueAtTime(o.pad, t + dur - 3.5); g.gain.linearRampToValueAtTime(0, t + dur);
      notasAc.forEach((m) => [-5, 5].forEach((cents) => { const os = ctx.createOscillator(); os.type = o.ondaPad ?? "triangle"; os.frequency.value = hz(m); os.detune.value = cents; os.connect(lp); os.start(t); os.stop(t + dur + 0.1); }));
    };
    tocaAcorde();
    const id = setInterval(() => { if (ligado && !out.parado) tocaAcorde(); }, o.compasso * 1000);
    nos.push({ stop: () => clearInterval(id) });
    cada(o.intervalo[0], o.intervalo[1], () => {
      if (Math.random() < (o.pausa ?? 0.2)) return;
      passo = Math.max(0, Math.min(o.escala.length - 1, passo + [-2, -1, -1, 1, 1, 2, 0][Math.floor(Math.random() * 7)]));
      TIMBRES[o.timbre](o.escala[passo], o.vol * (0.75 + Math.random() * 0.25), out);
      if (Math.random() < (o.dupla ?? 0.15)) setTimeout(() => ligado && TIMBRES[o.timbre](o.escala[Math.min(o.escala.length - 1, passo + 2)], o.vol * 0.6, out), 280);
    });
  }

  // A short koto phrase: three or four notes falling down the scale.
  function partituraKoto(out) {
    const esc = [62, 63, 67, 69, 70, 74, 75, 79], i = 3 + Math.floor(Math.random() * 4);
    for (let j = 0; j < 3 + Math.floor(Math.random() * 2); j++) setTimeout(() => ligado && TIMBRES.koto(esc[Math.max(0, i - j)], 0.05, out), j * 260);
  }

  // ---- beds -------------------------------------------------------------------
  // One sea wave: noise swelling in and brightening as it breaks, then foam,
  // placed somewhere left or right.
  function onda(out, forca = 1) {
    const t = agora(), dur = 5.5 + Math.random() * 3, s = ctx.createBufferSource(), lp = filtro("lowpass", 220, 0.4), g = ganho(0.0001), p = pan(Math.random() * 1.2 - 0.6);
    s.buffer = noiseBuf; s.loop = true;
    lp.frequency.setValueAtTime(220, t); lp.frequency.linearRampToValueAtTime(1300 + Math.random() * 900, t + dur * 0.42); lp.frequency.exponentialRampToValueAtTime(260, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.17 * forca, t + dur * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(lp).connect(g).connect(p); saida(p, out, 0.25); s.start(t, Math.random() * 2); s.stop(t + dur + 0.1);
    sopro({ type: "highpass", f0: 2600, f1: 4200, dur: dur * 0.5, vol: 0.025 * forca, at: dur * 0.38, attack: 0.6, out, molhado: 0.3 });
  }
  function cama(build) {
    const out = ganho(0), wet = ganho(1), nos = [], timers = [];
    out.connect(master); wet.connect(reverb); out.wet = wet;
    // One entry per ticker: `id` always holds the pending timeout.
    const cada = (min, max, fn) => { const t = {}; const tick = () => { if (ligado && !out.parado) fn(); t.id = setTimeout(tick, (min + Math.random() * (max - min)) * 1000); }; t.id = setTimeout(tick, Math.random() * min * 1000); timers.push(t); };
    build(out, nos, cada);
    out.gain.setTargetAtTime(1, agora(), 1.2);
    return () => {
      out.parado = true;
      out.gain.setTargetAtTime(0, agora(), 0.35); wet.gain.setTargetAtTime(0, agora(), 0.35);
      timers.forEach((t) => clearTimeout(t.id));
      setTimeout(() => { nos.forEach((n) => { try { n.stop(); } catch {} }); out.disconnect(); wet.disconnect(); }, 2000);
    };
  }
  const camada = (out, nos, { tipo = "lowpass", f = 500, q = 0.7, vol = 0.08, taxa = 0.1, prof = 0.03, varre = 0 }) => {
    const n = ruido(), b = filtro(tipo, f, q), g = ganho(vol);
    n.connect(b).connect(g).connect(out); nos.push(n, lfo(taxa, prof, g.gain));
    if (varre) nos.push(lfo(taxa * 0.6, varre, b.frequency));
  };
  // A held drone: a few detuned oscillators under a low-pass, breathing slowly.
  const zumbido = (out, nos, fs, vol, corte = 900) => {
    const lp = filtro("lowpass", corte), g = ganho(1);
    lp.connect(g).connect(out); nos.push(lfo(0.07, 0.25, g.gain));
    fs.forEach((f, i) => { const o = ctx.createOscillator(); o.type = i % 2 ? "triangle" : "sine"; o.frequency.value = f; o.detune.value = (i - 1) * 6; const v = ganho(vol); o.connect(v).connect(lp); o.start(); nos.push(o); });
  };
  const mar = (out, nos, cada, forca = 1) => {
    camada(out, nos, { f: 180, vol: 0.05 * forca, taxa: 0.05, prof: 0.02 });
    onda(out, forca); cada(3.2, 6.5, () => onda(out, forca));
  };
  const grilo = (v = 1, out = master) => { for (let i = 0; i < 3; i++) tom({ type: "triangle", f0: 4300, f1: 4200, dur: 0.035, vol: 0.014 * v, at: i * 0.055, out, molhado: 0.2 }); };

  const AMBIENTES = {
    claude: (out, nos, cada) => {
      partitura(out, nos, cada, { timbre: "teclado", escala: [60, 62, 64, 67, 69, 72, 74, 76], acordes: [[48, 52, 55, 59], [45, 48, 52, 55], [41, 45, 48, 52], [43, 47, 50, 53]], compasso: 8, pad: 0.035, vol: 0.06, intervalo: [1.2, 2.6], brilho: 700 });
      camada(out, nos, { tipo: "highpass", f: 5000, vol: 0.006, taxa: 0.2, prof: 0.003 });
    },
    clouds: (out, nos, cada) => {
      camada(out, nos, { tipo: "bandpass", f: 600, q: 0.5, vol: 0.05, taxa: 0.08, prof: 0.03, varre: 300 });
      partitura(out, nos, cada, { timbre: "flauta", escala: [74, 76, 78, 81, 83, 86, 88], acordes: [[50, 57, 66], [47, 54, 62], [43, 50, 59], [45, 52, 61]], compasso: 9, pad: 0.03, vol: 0.05, intervalo: [1.6, 3.2], pausa: 0.3 });
      cada(5, 11, () => notas([2600 + Math.random() * 600, 3300, 2900], 0.09, { f1: 3600, dur: 0.07, vol: 0.02, out }));
    },
    lagoon: (out, nos, cada) => {
      mar(out, nos, cada, 1);
      partitura(out, nos, cada, { timbre: "dedilhado", escala: [60, 62, 64, 67, 69, 72, 74, 76], acordes: [[48, 55, 64], [45, 52, 60], [41, 48, 57], [43, 50, 59]], compasso: 8, pad: 0.025, vol: 0.07, intervalo: [0.9, 2.2], dupla: 0.25 });
      cada(3, 7, () => tom({ f0: 300 + Math.random() * 250, f1: 950, dur: 0.11, vol: 0.04, out }));
    },
    koi: (out, nos, cada) => {
      camada(out, nos, { f: 650, vol: 0.05, taxa: 0.1, prof: 0.025 });
      partitura(out, nos, cada, { timbre: "koto", escala: [62, 63, 67, 69, 70, 74, 75, 79], acordes: [[50, 57], [46, 53], [43, 50], [45, 52]], compasso: 10, pad: 0.03, vol: 0.075, intervalo: [1.6, 3.6], pausa: 0.3, ondaPad: "sine" });
      cada(6, 14, () => notas([hz(86), hz(91), hz(88)], 0.12, { dur: 1.6, vol: 0.015, out, molhado: 0.7 }));
    },
    jelly: (out, nos, cada) => {
      camada(out, nos, { f: 220, vol: 0.055, taxa: 0.05, prof: 0.025 });
      partitura(out, nos, cada, { timbre: "sino", escala: [62, 65, 67, 69, 72, 74, 77], acordes: [[38, 45, 53, 57], [41, 48, 55, 60], [36, 43, 52, 55]], compasso: 12, pad: 0.04, vol: 0.05, intervalo: [2, 4.5], pausa: 0.25, ondaPad: "sine", brilho: 600 });
      cada(2.5, 6, () => tom({ f0: 260 + Math.random() * 200, f1: 800, dur: 0.12, vol: 0.035, out }));
    },
    boats: (out, nos, cada) => {
      mar(out, nos, cada, 0.9);
      partitura(out, nos, cada, { timbre: "caixinha", escala: [65, 67, 69, 72, 74, 77, 79, 81], acordes: [[41, 48, 57], [46, 53, 62], [48, 55, 64], [45, 52, 60]], compasso: 8, pad: 0.025, vol: 0.05, intervalo: [1.1, 2.4] });
    },
    fireflies: (out, nos, cada) => {
      camada(out, nos, { tipo: "bandpass", f: 400, q: 0.6, vol: 0.025, taxa: 0.06, prof: 0.012 });
      cada(0.6, 1.5, () => grilo(1, out)); cada(1.6, 4, () => grilo(0.5, out));
      partitura(out, nos, cada, { timbre: "dedilhado", escala: [67, 69, 71, 74, 76, 79, 81], acordes: [[43, 50, 59], [40, 47, 55], [36, 43, 52], [38, 45, 54]], compasso: 9, pad: 0.025, vol: 0.055, intervalo: [1.4, 3], pausa: 0.3 });
    },
    // Moonlit: a lullaby. Slow music box over warm chords, far crickets.
    moonlit: (out, nos, cada) => {
      partitura(out, nos, cada, { timbre: "caixinha", escala: [57, 60, 62, 64, 67, 69, 72, 74, 76], acordes: [[45, 52, 60], [41, 48, 57], [48, 55, 64], [43, 50, 59]], compasso: 10, pad: 0.04, vol: 0.055, intervalo: [1.6, 3], pausa: 0.25, dupla: 0.1, ondaPad: "sine", brilho: 650 });
      cada(2.5, 6, () => grilo(0.35, out));
      camada(out, nos, { tipo: "bandpass", f: 350, q: 0.5, vol: 0.015, taxa: 0.04, prof: 0.008 });
    },
    // Fireplace: low roar, random crackles and pops, then lo-fi piano.
    lareira: (out, nos, cada) => {
      camada(out, nos, { f: 260, vol: 0.06, taxa: 0.3, prof: 0.02 });
      cada(0.05, 0.35, () => sopro({ type: "bandpass", f0: 1500 + Math.random() * 3000, q: 2, dur: 0.02 + Math.random() * 0.04, vol: 0.03 + Math.random() * 0.07, attack: 0.001, out, molhado: 0.1 }));
      cada(1.5, 4, () => sopro({ type: "highpass", f0: 900, dur: 0.06, vol: 0.12, attack: 0.001, out, molhado: 0.2 }));
      partitura(out, nos, cada, { timbre: "teclado", escala: [57, 60, 62, 64, 67, 69, 72, 74], acordes: [[45, 52, 55, 60], [41, 48, 52, 57], [43, 50, 53, 59], [40, 47, 50, 55]], compasso: 9, pad: 0.028, vol: 0.05, intervalo: [1.4, 3], pausa: 0.3, brilho: 650 });
    },
    // Rain on the window: steady patter, drops ticking on the glass, vinyl
    // crackle and soft lo-fi chords.
    chuva: (out, nos, cada) => {
      camada(out, nos, { tipo: "bandpass", f: 2600, q: 0.4, vol: 0.07, taxa: 0.1, prof: 0.015 });
      camada(out, nos, { f: 500, vol: 0.03, taxa: 0.07, prof: 0.01 });
      cada(0.08, 0.5, () => tom({ f0: 2200 + Math.random() * 2400, f1: 1800, dur: 0.03, vol: 0.012 + Math.random() * 0.02, out, molhado: 0.15 }));
      cada(0.04, 0.25, () => sopro({ type: "highpass", f0: 4000, dur: 0.008, vol: 0.02 * Math.random(), attack: 0.001, out, molhado: 0 }));
      partitura(out, nos, cada, { timbre: "teclado", escala: [62, 64, 65, 69, 72, 74, 76], acordes: [[38, 50, 53, 57, 60], [43, 50, 53, 59], [48, 52, 55, 59, 62], [45, 52, 55, 60]], compasso: 8, pad: 0.03, vol: 0.05, intervalo: [1.2, 2.6], pausa: 0.25, brilho: 600 });
    },
    // Space: a deep drone and slow, broad chords with a brass voice.
    galaxia: (out, nos, cada) => {
      zumbido(out, nos, [36.7, 55], 0.04, 200);
      partitura(out, nos, cada, { timbre: "metal", escala: [50, 53, 55, 57, 60, 62, 65, 67], acordes: [[38, 45, 50, 53], [34, 41, 46, 50], [41, 48, 53, 57], [36, 43, 48, 52]], compasso: 10, pad: 0.035, vol: 0.045, intervalo: [2, 4], pausa: 0.35, ondaPad: "sawtooth", brilho: 500 });
    },
    // Sakura garden: breeze, a shakuhachi-like flute in a Japanese scale, a
    // warbler now and then.
    sakura: (out, nos, cada) => {
      camada(out, nos, { tipo: "bandpass", f: 700, q: 0.5, vol: 0.035, taxa: 0.09, prof: 0.02, varre: 250 });
      partitura(out, nos, cada, { timbre: "flauta", escala: [62, 64, 65, 69, 70, 74, 76, 77], acordes: [[50, 57, 62], [46, 53, 58], [45, 52, 57], [43, 50, 55]], compasso: 10, pad: 0.025, vol: 0.05, intervalo: [1.6, 3.4], pausa: 0.3, ondaPad: "sine" });
      cada(3, 8, () => partituraKoto(out));
      cada(7, 15, () => notas([hz(91), hz(96), hz(93), hz(98)], 0.11, { dur: 0.12, vol: 0.02, out, f1: hz(100) }));
    },
    // Aurora: wind over snow and a slow shimmering bell pad.
    aurora: (out, nos, cada) => {
      camada(out, nos, { tipo: "bandpass", f: 500, q: 0.5, vol: 0.04, taxa: 0.05, prof: 0.025, varre: 200 });
      zumbido(out, nos, [110, 164.8, 220, 277.2], 0.012, 1600);
      partitura(out, nos, cada, { timbre: "sino", escala: [69, 71, 73, 76, 78, 81, 83, 85], acordes: [[45, 52, 57, 61], [42, 49, 54, 57], [38, 45, 50, 54], [40, 47, 52, 56]], compasso: 12, pad: 0.03, vol: 0.04, intervalo: [1.8, 4], pausa: 0.25, ondaPad: "sine", brilho: 900 });
    },
    // Falling code: a low hum, sparse digital chirps and a cold arpeggio.
    codigo: (out, nos, cada) => {
      zumbido(out, nos, [41.2, 61.7], 0.03, 250);
      cada(0.1, 0.6, () => tom({ type: "square", f0: 1800 + Math.random() * 3000, dur: 0.015, vol: 0.012, out, molhado: 0.05 }));
      partitura(out, nos, cada, { timbre: "arp", escala: [52, 55, 57, 59, 62, 64, 67, 69], acordes: [[40, 47, 52], [36, 43, 48], [38, 45, 50], [35, 42, 47]], compasso: 8, pad: 0.02, vol: 0.03, intervalo: [0.22, 0.5], pausa: 0.35, dupla: 0, ondaPad: "sawtooth", brilho: 500 });
    },
    // Arcade: a chiptune loop, bass and lead in squares.
    arcade: (out, nos, cada) => {
      const baixo = [45, 45, 52, 45, 43, 43, 50, 43, 41, 41, 48, 41, 40, 40, 47, 44];
      let n = 0;
      const id = setInterval(() => { if (ligado) { TIMBRES.chip(baixo[n % baixo.length] - 12, 0.1, out); n++; } }, 220);
      nos.push({ stop: () => clearInterval(id) });
      partitura(out, nos, cada, { timbre: "chip", escala: [69, 72, 74, 76, 79, 81, 84], acordes: [[57, 64]], compasso: 16, pad: 0.001, vol: 0.05, intervalo: [0.22, 0.44], pausa: 0.35, dupla: 0, ondaPad: "square", brilho: 300 });
    },
  };

  // ---- interaction voices -----------------------------------------------------
  const FX = {
    bolha: (v = 1) => tom({ f0: 260 + Math.random() * 260, f1: 900 + Math.random() * 400, dur: 0.11, vol: 0.06 * v }),
    tartaruga: () => { tom({ f0: 150, f1: 240, dur: 0.16, vol: 0.2 }); tom({ f0: 135, f1: 210, dur: 0.18, vol: 0.17, at: 0.17 }); for (let i = 0; i < 4; i++) setTimeout(() => FX.bolha(0.8), 260 + i * 110); },
    manta: () => sopro({ f0: 700, f1: 160, q: 0.8, dur: 0.9, vol: 0.16, attack: 0.15, molhado: 0.4 }),
    cardume: () => { for (let i = 0; i < 6; i++) tom({ type: "triangle", f0: 1300 + Math.random() * 900, dur: 0.05, vol: 0.05, at: i * 0.035 }); },
    flor: () => TIMBRES.sino(84, 0.06, master),
    carpa: () => { tom({ f0: 680, f1: 130, dur: 0.09, vol: 0.16 }); sopro({ type: "highpass", f0: 2500, dur: 0.08, vol: 0.05 }); },
    folha: () => tom({ f0: 220, f1: 140, dur: 0.12, vol: 0.12 }),
    comida: () => { for (let i = 0; i < 4; i++) tom({ f0: 1600 + Math.random() * 600, f1: 900, dur: 0.07, vol: 0.06, at: i * 0.07 + Math.random() * 0.03 }); },
    respingo: () => { sopro({ type: "lowpass", f0: 3200, f1: 500, dur: 0.5, vol: 0.2, attack: 0.005, molhado: 0.3 }); FX.bolha(); setTimeout(() => FX.bolha(0.7), 120); },
    agua: (v) => sopro({ f0: 450, f1: 1500, q: 0.9, dur: 0.3, vol: 0.03 + 0.12 * v, attack: 0.05 }),
    nuvem: () => sopro({ type: "bandpass", f0: 1600, f1: 900, q: 0.5, dur: 0.7, vol: 0.06, attack: 0.2, molhado: 0.4 }),
    rajada: () => sopro({ f0: 300, f1: 1100, q: 0.6, dur: 1.2, vol: 0.18, attack: 0.25, molhado: 0.3 }),
    estrela: () => [72, 76, 79].forEach((m, i) => setTimeout(() => TIMBRES.teclado(m, 0.06, master), i * 60)),
    faisca: () => tom({ type: "triangle", f0: 1800 + Math.random() * 1200, dur: 0.05, vol: 0.025 }),
    explosao: () => [72, 76, 79, 84, 88].forEach((m, i) => setTimeout(() => TIMBRES.caixinha(m, 0.05, master), i * 55)),
    sino: () => TIMBRES.sino(69 + [0, 3, 5, 7][Math.floor(Math.random() * 4)], 0.07, master),
    bolhas: () => { for (let i = 0; i < 7; i++) setTimeout(() => FX.bolha(1.1), i * 90 + Math.random() * 40); },
    papel: () => { sopro({ type: "highpass", f0: 3800, dur: 0.1, vol: 0.06 }); sopro({ type: "highpass", f0: 3000, dur: 0.12, vol: 0.05, at: 0.11 }); },
    vagalume: () => TIMBRES.caixinha(91 + [0, 2, 4][Math.floor(Math.random() * 3)], 0.025, master),
    enxame: () => [79, 83, 86, 88, 91, 95].forEach((m, i) => setTimeout(() => TIMBRES.caixinha(m, 0.03, master), i * 60)),
    lua: () => TIMBRES.sino(57, 0.07, master),
    cadente: () => { tom({ f0: 2600, f1: 500, dur: 0.9, vol: 0.05, molhado: 0.5 }); sopro({ type: "highpass", f0: 6000, f1: 2000, dur: 0.8, vol: 0.04, molhado: 0.5 }); },
    fogo: () => { for (let i = 0; i < 6; i++) sopro({ type: "bandpass", f0: 1800 + Math.random() * 2500, q: 2, dur: 0.03, vol: 0.12, attack: 0.001, at: i * 0.05 + Math.random() * 0.04 }); sopro({ type: "lowpass", f0: 900, f1: 200, dur: 0.8, vol: 0.12, attack: 0.05 }); },
    atica: () => { FX.fogo(); setTimeout(FX.fogo, 180); sopro({ f0: 200, f1: 1200, q: 0.5, dur: 0.6, vol: 0.15, attack: 0.1 }); },
    ronrona: () => { const t = agora(), o = ctx.createOscillator(), g = ganho(0), am = lfo(24, 0.05, g.gain); o.type = "sawtooth"; o.frequency.value = 46; const lp = filtro("lowpass", 220); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.3); g.gain.linearRampToValueAtTime(0, t + 2.2); o.connect(lp).connect(g); saida(g, master, 0.1); o.start(t); o.stop(t + 2.3); am.stop(t + 2.3); },
    planta: () => { sopro({ type: "highpass", f0: 3500, dur: 0.15, vol: 0.05 }); sopro({ type: "highpass", f0: 2800, dur: 0.18, vol: 0.04, at: 0.12 }); },
    caneca: () => TIMBRES.teclado(76, 0.05, master),
    trovao: () => { sopro({ type: "lowpass", f0: 1800, f1: 60, dur: 3.2, vol: 0.32, attack: 0.02, molhado: 0.5 }); sopro({ type: "lowpass", f0: 300, f1: 40, dur: 4, vol: 0.22, attack: 0.4, at: 0.2, molhado: 0.6 }); },
    pew: () => { tom({ type: "square", f0: 1500, f1: 180, dur: 0.18, vol: 0.05 }); tom({ type: "square", f0: 1400, f1: 160, dur: 0.18, vol: 0.04, at: 0.12 }); },
    nave: () => TIMBRES.metal(38, 0.09, master),
    salto: () => { sopro({ type: "bandpass", f0: 200, f1: 3500, q: 1.2, dur: 0.8, vol: 0.18, attack: 0.5 }); tom({ type: "sawtooth", f0: 60, f1: 900, dur: 0.9, vol: 0.06 }); setTimeout(() => sopro({ type: "lowpass", f0: 3000, f1: 100, dur: 1.4, vol: 0.2, attack: 0.005, molhado: 0.6 }), 820); },
    placa: () => { const t = agora(), o = ctx.createOscillator(), g = ganho(0); o.type = "square"; o.frequency.value = 120; g.gain.setValueAtTime(0, t); for (let i = 0; i < 6; i++) g.gain.setValueAtTime(i % 2 ? 0 : 0.03, t + i * 0.04); g.gain.setValueAtTime(0, t + 0.26); o.connect(g); saida(g, master, 0.1); o.start(t); o.stop(t + 0.3); },
    carro: () => sopro({ f0: 300, f1: 1400, q: 1.5, dur: 0.7, vol: 0.12, attack: 0.3, molhado: 0.3 }),
    abajur: () => TIMBRES.teclado(81, 0.04, master),
    arvore: () => { FX.planta(); [86, 89, 91].forEach((m, i) => setTimeout(() => TIMBRES.caixinha(m, 0.03, master), i * 90)); },
    torii: () => TIMBRES.koto(62, 0.07, master),
    vento: () => sopro({ f0: 400, f1: 1600, q: 0.5, dur: 1.4, vol: 0.14, attack: 0.3, molhado: 0.4 }),
    raposa: () => { tom({ f0: 900, f1: 1400, dur: 0.12, vol: 0.07 }); tom({ f0: 1000, f1: 1500, dur: 0.1, vol: 0.06, at: 0.16 }); },
    cabana: () => TIMBRES.sino(64, 0.06, master),
    surto: () => [69, 73, 76, 81, 85].forEach((m, i) => setTimeout(() => TIMBRES.sino(m, 0.04, master), i * 120)),
    cubo: () => { for (let i = 0; i < 5; i++) tom({ type: "square", f0: 400 + i * 220, dur: 0.05, vol: 0.03, at: i * 0.05 }); },
    terminal: () => { for (let i = 0; i < 6; i++) sopro({ type: "highpass", f0: 3000, dur: 0.02, vol: 0.05, at: i * 0.07 + Math.random() * 0.03, attack: 0.001 }); },
    decodifica: () => { for (let i = 0; i < 10; i++) tom({ type: "square", f0: 300 + Math.random() * 2000, dur: 0.03, vol: 0.03, at: i * 0.035 }); },
    alien: () => { tom({ type: "square", f0: 220, f1: 330, dur: 0.08, vol: 0.05 }); tom({ type: "square", f0: 330, f1: 220, dur: 0.08, vol: 0.05, at: 0.09 }); },
    ufo: () => { const t = agora(), o = ctx.createOscillator(), g = ganho(0.04), vib = lfo(8, 120, o.frequency); o.type = "square"; o.frequency.value = 700; o.connect(g); saida(g, master, 0.1); o.start(t); o.stop(t + 0.8); vib.stop(t + 0.8); },
    tiro: () => { tom({ type: "square", f0: 1200, f1: 300, dur: 0.12, vol: 0.05 }); setTimeout(() => ligado && sopro({ type: "lowpass", f0: 2000, f1: 200, dur: 0.35, vol: 0.12, attack: 0.002 }), 520); },
    holo: () => TIMBRES.sino(76, 0.04, master),
  };

  const VOZES = {
    claude: { hover: { spark: "estrela", mini: "faisca" }, clique: "explosao" },
    clouds: { hover: { cloud: "nuvem" }, clique: "rajada" },
    lagoon: { hover: { turtle: "tartaruga", manta: "manta", school: "cardume", flower: "flor" }, clique: "respingo", agua: true },
    koi: { hover: { koi: "carpa", pad: "folha" }, clique: "comida", agua: true },
    jelly: { hover: { jelly: "sino" }, clique: "bolhas" },
    boats: { hover: { boat: "papel" }, clique: "respingo", agua: true },
    fireflies: { hover: { fly: "vagalume" }, clique: "enxame" },
    moonlit: { hover: { moon: "lua", cloud: "nuvem" }, clique: "cadente" },
    lareira: { hover: { fogo: "fogo", gato: "ronrona", abajur: "abajur" }, clique: "atica" },
    chuva: { hover: { planta: "planta", caneca: "caneca" }, clique: "trovao" },
    galaxia: { hover: { caca: "pew", nave: "nave" }, clique: "salto" },
    sakura: { hover: { arvore: "arvore", torii: "torii" }, clique: "vento" },
    aurora: { hover: { raposa: "raposa", cabana: "cabana" }, clique: "surto" },
    codigo: { hover: { cubo: "cubo", terminal: "terminal" }, clique: "decodifica" },
    arcade: { hover: { alien: "alien", ufo: "ufo" }, clique: "tiro" },
  };

  let ultimaAgua = 0;
  return {
    get ligado() { return ligado; },
    ligar(v) {
      ligado = v;
      if (v) { init(); ctx.resume(); master.gain.setTargetAtTime(volume, agora(), 0.3); if (tema) this.tema(tema, true); }
      else if (ctx) { master.gain.setTargetAtTime(0, agora(), 0.2); if (pararAmbiente) { pararAmbiente(); pararAmbiente = null; } }
    },
    volume(v) { volume = v; if (ctx && ligado) master.gain.setTargetAtTime(v, agora(), 0.1); },
    tema(id, forcar = false) {
      if (id === tema && !forcar) return;
      tema = id;
      if (!ligado || !ctx) return;
      if (pararAmbiente) pararAmbiente();
      pararAmbiente = AMBIENTES[id] ? cama(AMBIENTES[id]) : null;
    },
    toque(id, kind) { const n = ligado && VOZES[id]?.hover[kind]; if (n) FX[n](); },
    clique(id) { const n = ligado && VOZES[id]?.clique; if (n) FX[n](); },
    mexer(id, speed) {
      if (!ligado || !VOZES[id]?.agua || speed < 220) return;
      const t = performance.now(); if (t - ultimaAgua < 140) return; ultimaAgua = t;
      FX.agua(Math.min(1, speed / 1600));
    },
  };
})();
