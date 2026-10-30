// "Tarefas em segundo plano": the sheet with everything running behind the
// chat (ultracode workflows with their phases and agents, background agents,
// shells, monitors) and what finished, like the Background tasks sheet of
// Claude Desktop. The main process keeps the state per turn and sends "fundo"
// snapshots {ativas, concluidas}; this file draws the strip's chip and the
// sheet, a janelinha. Cards are built once per task / phase / agent and then
// only their text and classes change, so a live update never flickers.

let fundoVisto = { ativas: [], concluidas: [] }, tfSheet = null, tfTimer = 0;
const tfAberto = { rodando: true, concluidas: false }, tfFases = new Set(), tfLidas = new Set(), tfArma = new Map();
const TF_ESTADO = { completed: "Concluída", failed: "Falhou", stopped: "Parada" };
const TF_ICONE = {
  completed: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'), failed: svg('<path d="M7 7l10 10M17 7 7 17"/>'), stopped: svg('<rect x="7" y="7" width="10" height="10" rx="1.5"/>'),
};
const TF_CHEV = svg('<path d="m9 6 6 6-6 6"/>');
const tfFormato = {};
// 790100 -> "790,1 mil" (pt), "790.1K" (en): the compact form of the interface language
const tfNum = (n) => {
  const l = window.i18n?.local?.() || "pt-BR";
  return (tfFormato[l] ||= new Intl.NumberFormat(l, { notation: "compact", maximumFractionDigits: 1 })).format(n);
};
// 2648000 -> "44min 8s"
function tfDur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}min` : m ? `${m}min ${s % 60}s` : `${s}s`;
}
const tfTxt = (el, v) => { if (el.textContent !== v) el.textContent = v; };
const tfOculta = (el, sim) => { if (el.hidden !== sim) el.hidden = sim; };
const tfClasse = (el, c) => { if (el.className !== c) el.className = c; };
// A time: ticking while it has no end, fixed once it has one.
function tfTempo(el, ini, fim) {
  if (!ini) { tfTxt(el, ""); delete el.dataset.vivo; return; }
  if (fim) { tfTxt(el, tfDur(fim - ini)); delete el.dataset.vivo; } else { el.dataset.vivo = ini; tfTxt(el, tfDur(Date.now() - ini)); }
}
// The elements of `itens` in order, one per key: built once, updated in place, the stale ones removed.
function tfSync(pai, mapa, itens, chave, cria, atualiza) {
  const ficam = new Set();
  itens.forEach((it, i) => {
    const k = chave(it); ficam.add(k);
    let el = mapa.get(k);
    if (!el) mapa.set(k, (el = cria(it)));
    if (pai.children[i] !== el) pai.insertBefore(el, pai.children[i] || null);
    atualiza(el, it);
  });
  for (const [k, el] of mapa) if (!ficam.has(k)) { el.remove(); mapa.delete(k); }
}
const tfEl = (html, cls, tag = "div") => { const e = document.createElement(tag); e.className = cls; e.innerHTML = html; return e; };
const tfQ = (el, s) => el.querySelector(s);

// ---- state, strip chip --------------------------------------------------------------------
function aplicaFundo(ev) {
  if (ev.ativas) fundoVisto.ativas = ev.ativas;
  if (ev.concluidas) fundoVisto.concluidas = ev.concluidas;
  desenhaFundo(fundoVisto.ativas); desenhaChip(); desenhaTarefas();
}
const limpaFundo = () => aplicaFundo({ ativas: [], concluidas: [] });
aoEvento((ev) => { if (ev.tipo === "fundo") aplicaFundo(ev); });

const chipTarefas = document.createElement("button");
chipTarefas.className = "tf-chip"; chipTarefas.title = "Tarefas em segundo plano";
chipTarefas.innerHTML = '<i class="tf-gira"></i><b></b><span></span>';
$("cache").before(chipTarefas);
chipTarefas.onclick = () => abreTarefas();
// The sheet also has its place in the top bar, like the other panels.
const botaoTarefas = document.createElement("button");
botaoTarefas.className = "icone tf-btn"; botaoTarefas.title = "Tarefas em segundo plano";
botaoTarefas.innerHTML = `${svg('<rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M7.5 9h3M7.5 13h6M7.5 17h4"/><circle cx="16.5" cy="9" r="1.2"/>')}<i class="badge"></i>`;
$("infoBtn").before(botaoTarefas);
botaoTarefas.onclick = () => abreTarefas();
function desenhaChip() {
  const n = fundoVisto.ativas.length;
  chipTarefas.classList.toggle("on", n > 0);
  tfTxt(tfQ(botaoTarefas, ".badge"), n ? String(n) : ""); botaoTarefas.classList.toggle("tem", n > 0);
  tfTxt(tfQ(chipTarefas, "b"), String(n)); tfTxt(chipTarefas.lastChild, n === 1 ? "tarefa" : "tarefas");
}

// ---- the sheet ----------------------------------------------------------------------------
ABRE_JANELINHA.tarefas = () => abreTarefas();
function abreTarefas() {
  const j = janelinha("tarefas", "Tarefas em segundo plano", { largura: 420, aoFechar: () => { tfSheet = null; clearInterval(tfTimer); tfTimer = 0; } });
  if (tfSheet?.j === j && j.el.isConnected) { j.el.focus({ preventScroll: true }); return; }
  j.corpo.classList.add("tf");
  j.corpo.innerHTML = ["rodando", "concluidas"].map((s) => `<section class="tf-sec" data-sec="${s}"><button class="tf-sec-cab" aria-expanded="${tfAberto[s]}"><span class="tf-chev">${TF_CHEV}</span><b>${s === "rodando" ? "Rodando" : "Concluídas"}</b><em></em></button><div class="tf-lista"></div></section>`).join("")
    + '<p class="jl-vazio" hidden>Nenhuma tarefa em segundo plano</p>';
  tfSheet = { j, cards: new Map(), linhas: new Map(), vazio: tfQ(j.corpo, ".jl-vazio"), sec: {} };
  for (const s of j.corpo.querySelectorAll(".tf-sec")) {
    const k = s.dataset.sec, cab = tfQ(s, ".tf-sec-cab");
    tfSheet.sec[k] = { el: s, lista: tfQ(s, ".tf-lista"), n: tfQ(s, "em") };
    cab.onclick = () => { tfAberto[k] = !tfAberto[k]; cab.setAttribute("aria-expanded", tfAberto[k]); desenhaTarefas(); };
  }
  j.el.tabIndex = -1; j.el.focus({ preventScroll: true });
  desenhaTarefas();
}
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && tfSheet && document.activeElement === document.body && !document.querySelector(".personal.on, .lightbox.on")) tfSheet.j.fecha();
});

function desenhaTarefas() {
  const s = tfSheet; if (!s || !s.j.el.isConnected) return;
  const { ativas, concluidas } = fundoVisto;
  tfOculta(s.sec.rodando.el, !ativas.length); tfOculta(s.sec.concluidas.el, !concluidas.length); tfOculta(s.vazio, !!(ativas.length || concluidas.length));
  tfTxt(s.sec.rodando.n, String(ativas.length)); tfTxt(s.sec.concluidas.n, String(concluidas.length));
  for (const k of ["rodando", "concluidas"]) s.sec[k].el.classList.toggle("fechada", !tfAberto[k]);
  if (tfAberto.rodando) tfSync(s.sec.rodando.lista, s.cards, ativas, (x) => x.id, criaCard, atualizaCard);
  if (tfAberto.concluidas) tfSync(s.sec.concluidas.lista, s.linhas, concluidas, (x) => `${x.id}:${x.fim}`, criaLinha, atualizaLinha);
  // one timer for every ticking time, only while something runs
  if (ativas.length && !tfTimer) tfTimer = setInterval(tfTick, 1000);
  else if (!ativas.length && tfTimer) { clearInterval(tfTimer); tfTimer = 0; }
}
function tfTick() {
  if (!tfSheet?.j.el.isConnected) { clearInterval(tfTimer); tfTimer = 0; return; }
  const agora = Date.now();
  for (const el of tfSheet.j.corpo.querySelectorAll("[data-vivo]")) tfTxt(el, tfDur(agora - +el.dataset.vivo));
}

// a running task
function criaCard(x) {
  const el = tfEl(`<div class="tf-l1"><i class="tf-ponto"></i><b class="tf-nome"></b><span class="tf-tipo"></span><time class="tf-tempo"></time><button class="icone tf-parar" title="Parar tarefa">${TF_ICONE.stopped}</button></div>
    <p class="tf-desc"></p><div class="tf-meta"><span class="tf-ag"></span><span class="tf-tk"></span><span class="tf-us"></span></div><div class="tf-fases"></div><p class="tf-ultima"></p>`, "tf-card", "article");
  el._fases = new Map();
  const b = tfQ(el, ".tf-parar");
  b.onclick = async () => {
    const id = el.dataset.id, wf = el.dataset.tipo === "local_workflow";
    // a workflow stops many agents at once: the first click only arms the button
    if (wf && !tfArma.has(id)) {
      tfArma.set(id, setTimeout(() => { tfArma.delete(id); b.classList.remove("perigo"); b.title = "Parar tarefa"; }, 4000));
      b.classList.add("perigo"); b.title = "Confirmar: parar?"; return;
    }
    clearTimeout(tfArma.get(id)); tfArma.delete(id);
    b.disabled = true; b.classList.remove("perigo");
    const ok = await vivo.pararTarefa(id).catch(() => false);
    if (!ok) { b.disabled = false; nota("Não foi possível parar", true); }
  };
  return el;
}
function atualizaCard(el, x) {
  const wf = x.tipo === "local_workflow";
  el.dataset.id = x.id; el.dataset.tipo = x.tipo;
  tfTxt(tfQ(el, ".tf-nome"), (wf && x.nome) || x.descricao || tipoFundo(x.tipo));
  tfTxt(tfQ(el, ".tf-tipo"), tipoFundo(x.tipo));
  tfTempo(tfQ(el, ".tf-tempo"), x.inicio, 0);
  const desc = tfQ(el, ".tf-desc"); tfTxt(desc, wf ? x.descricao : ""); tfOculta(desc, !wf || !x.descricao || x.descricao === x.nome);
  const ag = tfQ(el, ".tf-ag"), tk = tfQ(el, ".tf-tk"), us = tfQ(el, ".tf-us");
  tfTxt(ag, x.nAgentes ? (x.nAgentes === 1 ? "1 agente" : `${x.nAgentes} agentes`) : ""); tfOculta(ag, !x.nAgentes);
  tfTxt(tk, x.tokens ? `${tfNum(x.tokens)} tokens` : ""); tfOculta(tk, !x.tokens);
  tfTxt(us, x.usos ? (x.usos === 1 ? "1 ferramenta" : `${x.usos} ferramentas`) : ""); tfOculta(us, !x.usos);
  tfOculta(tfQ(el, ".tf-meta"), !x.nAgentes && !x.tokens && !x.usos);
  const ult = tfQ(el, ".tf-ultima"), t = x.resumo || x.ultimaFerr || ""; tfTxt(ult, t); tfOculta(ult, !t);
  const fs = tfQ(el, ".tf-fases"); tfOculta(fs, !x.fases?.length);
  if (x.fases) tfSync(fs, el._fases, x.fases, (f) => `${x.id}:${f.i}`, criaFase, (e, f) => atualizaFase(e, f, `${x.id}:${f.i}`));
}

// a phase of a workflow: squares for the agents, the table of them when open
function criaFase() {
  const el = tfEl(`<button class="tf-fase-cab" aria-expanded="false"><span class="tf-chev">${TF_CHEV}</span><b class="tf-ft"></b><span class="tf-sq"></span><em class="tf-fc"></em></button><div class="tf-ags"></div>`, "tf-fase");
  el._ags = new Map();
  tfQ(el, ".tf-fase-cab").onclick = () => {
    const k = el.dataset.k; tfFases.has(k) ? tfFases.delete(k) : tfFases.add(k);
    el.classList.toggle("aberta", tfFases.has(k)); tfQ(el, ".tf-fase-cab").setAttribute("aria-expanded", tfFases.has(k));
    desenhaTarefas(); // fills the agent table of the phase just opened
  };
  return el;
}
const TF_FIM = new Set(["done", "error", "stopped"]);
function atualizaFase(el, f, k) {
  el.dataset.k = k;
  const aberta = tfFases.has(k), feitos = f.agentes.filter((a) => TF_FIM.has(a.estado)).length;
  el.classList.toggle("aberta", aberta); tfQ(el, ".tf-fase-cab").setAttribute("aria-expanded", aberta);
  el.classList.toggle("vazia", !f.agentes.length); el.classList.toggle("completa", f.agentes.length > 0 && feitos === f.agentes.length);
  tfTxt(tfQ(el, ".tf-ft"), f.titulo || "Agentes"); tfTxt(tfQ(el, ".tf-fc"), `${feitos}/${f.agentes.length}`);
  const sq = tfQ(el, ".tf-sq");
  while (sq.children.length < f.agentes.length) sq.append(document.createElement("i"));
  while (sq.children.length > f.agentes.length) sq.lastChild.remove();
  f.agentes.forEach((a, i) => tfClasse(sq.children[i], "e-" + a.estado));
  // the table is only kept in sync while the phase is open
  if (aberta) tfSync(tfQ(el, ".tf-ags"), el._ags, f.agentes, (a) => a.k, criaAgente, atualizaAgente);
}
function criaAgente() { return tfEl('<i class="tf-pt"></i><span class="tf-ar"></span><span class="tf-at"></span><time class="tf-atempo"></time><small class="tf-au"></small>', "tf-agente"); }
function atualizaAgente(el, a) {
  tfClasse(tfQ(el, ".tf-pt"), "tf-pt e-" + a.estado);
  tfTxt(tfQ(el, ".tf-ar"), a.rotulo); tfTxt(tfQ(el, ".tf-at"), a.tokens != null ? tfNum(a.tokens) : "");
  tfTempo(tfQ(el, ".tf-atempo"), a.inicio, TF_FIM.has(a.estado) ? a.fim || a.inicio : 0);
  const u = tfQ(el, ".tf-au"), t = a.erro || a.resumo || a.ultimaFerr || ""; tfTxt(u, t); tfOculta(u, !t);
}

// a finished task
function criaLinha() {
  const el = tfEl('<div class="tf-l1"><span class="tf-ic"></span><span class="tf-tipo"></span><b class="tf-nome"></b><span class="tf-estado"></span><time class="tf-tempo"></time></div><p class="tf-resumo"></p>', "tf-conc");
  el.onclick = () => { const k = el.dataset.k; tfLidas.has(k) ? tfLidas.delete(k) : tfLidas.add(k); el.classList.toggle("aberta", tfLidas.has(k)); };
  return el;
}
function atualizaLinha(el, x) {
  el.dataset.k = `${x.id}:${x.fim}`; el.classList.toggle("aberta", tfLidas.has(el.dataset.k));
  const ic = tfQ(el, ".tf-ic"); tfClasse(ic, "tf-ic e-" + x.estado); if (ic.dataset.e !== x.estado) { ic.dataset.e = x.estado; ic.innerHTML = TF_ICONE[x.estado] || ""; }
  tfTxt(tfQ(el, ".tf-tipo"), tipoFundo(x.tipo));
  tfTxt(tfQ(el, ".tf-nome"), (x.tipo === "local_workflow" && x.nome) || x.descricao || x.nome || tipoFundo(x.tipo));
  tfTxt(tfQ(el, ".tf-estado"), TF_ESTADO[x.estado] || "");
  tfTxt(tfQ(el, ".tf-tempo"), x.duracaoMs ? tfDur(x.duracaoMs) : "");
  const r = tfQ(el, ".tf-resumo"); tfTxt(r, x.resumo || ""); tfOculta(r, !x.resumo);
  el.title = [x.tokens ? `${tfNum(x.tokens)} tokens` : "", x.nAgentes ? `${x.nAgentes} agentes` : ""].filter(Boolean).join(" · ");
}
