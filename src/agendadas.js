// Scheduled tasks: Claude Code runs that start by themselves (hourly, daily, on weekdays,
// weekly or by a cron expression) while the app sits in the tray. This file has no
// Electron in it: the schedule math is plain functions, and the store, the queue and the
// headless run get everything they touch from the context main.js hands to iniciaAgenda.

import fs from "node:fs";
import crypto from "node:crypto";

export const TIPOS = ["horaria", "diaria", "dias_uteis", "semanal", "cron"];
const JANELA_RECUPERA = 24 * 3600e3; // a slot missed by less than this still runs, once
const GRACA = 2 * 60e3;              // a slot this close to its time counts as on time
const LIMITE_EXECUCAO = 60 * 60e3;   // a run that takes longer is stopped
const MAX_TURNOS = 100;
const MAX_HISTORICO = 30;
const ESPERA_RETOMADA = 20e3;        // after waking up the network is rarely back sooner
const MAX_TIMEOUT = 2 ** 31 - 1;
const CINCO_ANOS = 5 * 366 * 24 * 3600e3;

// An error whose text is a Portuguese key of the dictionary: the caller translates it.
export class ErroAgenda extends Error {
  constructor(chave, ...valores) {
    super(chave.replace(/\{(\d+)\}/g, (_, i) => valores[i] ?? ""));
    this.chave = chave; this.valores = valores;
  }
}
export const traduzErro = (e, tr) => (e instanceof ErroAgenda ? tr(e.chave, ...e.valores.map((v) => (typeof v === "string" ? tr(v) : v))) : String(e?.message || e));

// ---- cron ------------------------------------------------------------------------------------
const CAMPOS = [["minuto", 0, 59], ["hora", 0, 23], ["dia do mês", 1, 31], ["mês", 1, 12], ["dia da semana", 0, 7]];
function parseCampo(txt, [nome, min, max]) {
  const valores = new Set();
  const inteiro = (s) => { if (!/^\d+$/.test(s)) throw new ErroAgenda("Cron: campo {0} inválido ({1})", nome, txt); return Number(s); };
  for (const parte of txt.split(",")) {
    const [base, passoTxt, resto] = parte.split("/");
    if (resto !== undefined || !base) throw new ErroAgenda("Cron: campo {0} inválido ({1})", nome, txt);
    const passo = passoTxt === undefined ? 1 : inteiro(passoTxt);
    if (passo < 1) throw new ErroAgenda("Cron: campo {0} inválido ({1})", nome, txt);
    let de, ate;
    if (base === "*") { de = min; ate = nome === "dia da semana" ? 6 : max; }
    else if (base.includes("-")) { const [a, b, extra] = base.split("-"); if (extra !== undefined) throw new ErroAgenda("Cron: campo {0} inválido ({1})", nome, txt); de = inteiro(a); ate = inteiro(b); }
    else { de = inteiro(base); ate = passoTxt === undefined ? de : max; }
    if (de < min || ate > max || de > ate) throw new ErroAgenda("Cron: campo {0} fora do intervalo {1}-{2}", nome, min, max);
    for (let v = de; v <= ate; v += passo) valores.add(nome === "dia da semana" && v === 7 ? 0 : v);
  }
  return valores;
}
export function parseCron(expr) {
  const partes = String(expr ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length !== 5) throw new ErroAgenda("Cron precisa de 5 campos: minuto hora dia mês dia-da-semana");
  const [min, hora, dom, mes, dow] = partes.map((p, i) => parseCampo(p, CAMPOS[i]));
  // standard rule: with both day fields restricted, either one matching is enough
  return { min, hora, dom, mes, dow, domLivre: partes[2].startsWith("*"), dowLivre: partes[4].startsWith("*") };
}
export function proximaCron(c, depoisDe) {
  let d = new Date(depoisDe);
  d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + 1);
  const limite = depoisDe + CINCO_ANOS;
  // only the minute steps singly; a wrong month, day or hour jumps to the start of the next one
  const vai = (prox) => { d = prox > d ? prox : new Date(d.getTime() + 60e3); };
  while (d.getTime() <= limite) {
    const a = d.getFullYear(), m = d.getMonth(), dia = d.getDate(), h = d.getHours();
    if (!c.mes.has(m + 1)) { vai(new Date(a, m + 1, 1, 0, 0)); continue; }
    const doDia = c.dom.has(dia), daSemana = c.dow.has(d.getDay());
    if (!(c.domLivre || c.dowLivre ? doDia && daSemana : doDia || daSemana)) { vai(new Date(a, m, dia + 1, 0, 0)); continue; }
    if (!c.hora.has(h)) { vai(new Date(a, m, dia, h + 1, 0)); continue; }
    if (!c.min.has(d.getMinutes())) { vai(new Date(a, m, dia, h, d.getMinutes() + 1)); continue; }
    return d.getTime();
  }
  return null;
}

// ---- repeat rules ----------------------------------------------------------------------------
const inteiroEm = (v, min, max, nome) => {
  const n = typeof v === "string" && v.trim() === "" ? NaN : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new ErroAgenda("{0} inválido ({1} a {2})", nome, min, max);
  return n;
};
export function validaRepete(r) {
  if (!r || typeof r !== "object" || !TIPOS.includes(r.tipo)) throw new ErroAgenda("Escolha como a tarefa se repete");
  const { tipo } = r;
  const norm = { tipo, minuto: 0, hora: 0, dia: 0, cron: "" };
  if (tipo === "cron") {
    norm.cron = String(r.cron ?? "").trim().slice(0, 100);
    const c = parseCron(norm.cron);
    if (proximaCron(c, Date.now()) === null) throw new ErroAgenda("Nenhuma execução no próximo ano");
    return norm;
  }
  norm.minuto = inteiroEm(r.minuto ?? 0, 0, 59, "Minuto");
  if (tipo !== "horaria") norm.hora = inteiroEm(r.hora ?? 0, 0, 23, "Hora");
  if (tipo === "semanal") norm.dia = inteiroEm(r.dia ?? 0, 0, 6, "Dia da semana");
  return norm;
}
// The first run strictly after `depoisDe` (epoch ms), in local time.
export function proximaExecucao(repete, depoisDe) {
  const { tipo, minuto, hora, dia, cron } = repete;
  if (tipo === "cron") return proximaCron(parseCron(cron), depoisDe);
  const base = new Date(depoisDe);
  const a = base.getFullYear(), m = base.getMonth(), d = base.getDate();
  if (tipo === "horaria") {
    for (let k = 0; k < 3; k++) { const t = new Date(a, m, d, base.getHours() + k, minuto).getTime(); if (t > depoisDe) return t; }
  }
  for (let k = 0; k <= 8; k++) {
    const cand = new Date(a, m, d + k, hora, minuto), dow = cand.getDay();
    if (cand.getTime() <= depoisDe) continue;
    if (tipo === "dias_uteis" && (dow === 0 || dow === 6)) continue;
    if (tipo === "semanal" && dow !== dia) continue;
    return cand.getTime();
  }
  return null;
}

// ---- the store, the queue and the run ------------------------------------------------------------
const texto = (v, max) => String(v ?? "").slice(0, max);
const dataCurta = (ms) => {
  const d = new Date(ms), p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const ESTADOS = ["ok", "erro", "parada", "perdida"];
function limpaRegistro(h) {
  if (!h || typeof h !== "object" || !ESTADOS.includes(h.estado)) return null;
  const n = (v) => (Number.isFinite(v) ? v : 0);
  return { inicio: n(h.inicio), fim: n(h.fim), estado: h.estado, sessionId: h.sessionId ? texto(h.sessionId, 80) : null, resumo: texto(h.resumo, 200), erro: texto(h.erro, 300), custo: n(h.custo), recuperada: !!h.recuperada, manual: !!h.manual };
}

// ctx: arquivo (schedule file), grava(file, obj), rodaQuery (the app's query()), criaCaixa (prompt box of
// a conversation), renomeia(sessionId, titulo, cwd), guardaCfgSessao(sessionId, {model, modo}),
// existePasta(path), avisa() (the schedule changed), notifica(tarefa, ultima), tr (translate), modos
// (permission modes a task may use), aoMudarEnergia() (a run started or ended), log(...).
export function iniciaAgenda(ctx) {
  const { arquivo, grava, rodaQuery, criaCaixa, renomeia, guardaCfgSessao, existePasta, avisa, notifica, tr, modos, aoMudarEnergia, log = () => {} } = ctx;
  const modoPadrao = "auto";
  let tarefas = [], temporizador = null, retomada = null;
  const rodando = new Map(); // task id -> { ac, inicio, sessionId }
  const fila = [];           // { id, recuperada, manual }
  let executando = false;

  const persiste = () => grava(arquivo, tarefas);
  const porId = (id) => tarefas.find((t) => t.id === id);

  function carrega() {
    let cru = [];
    try { cru = JSON.parse(fs.readFileSync(arquivo, "utf8")); } catch {}
    if (!Array.isArray(cru)) cru = [];
    const agora = Date.now();
    for (const x of cru) {
      if (!x || typeof x !== "object" || typeof x.id !== "string" || !x.id || typeof x.nome !== "string" || typeof x.prompt !== "string" || typeof x.cwd !== "string") continue;
      let repete;
      try { repete = validaRepete(x.repete); } catch { continue; }
      const t = {
        id: texto(x.id, 80), nome: texto(x.nome, 80), prompt: texto(x.prompt, 20000), cwd: texto(x.cwd, 1000), model: texto(x.model, 80),
        modo: modos.includes(x.modo) ? x.modo : modoPadrao, repete, pausada: !!x.pausada,
        proxima: Number.isFinite(x.proxima) ? x.proxima : 0,
        ultima: limpaRegistro(x.ultima),
        historico: (Array.isArray(x.historico) ? x.historico : []).map(limpaRegistro).filter(Boolean).slice(-MAX_HISTORICO),
      };
      if (!t.pausada && !t.proxima) t.proxima = proximaExecucao(repete, agora) ?? 0;
      tarefas.push(t);
    }
  }

  // One timer for the earliest slot; it is armed again whenever the list changes.
  function rearma() {
    clearTimeout(temporizador); temporizador = null;
    const alvos = tarefas.filter((t) => !t.pausada && t.proxima).map((t) => t.proxima);
    if (!alvos.length) return;
    temporizador = setTimeout(venceu, Math.min(MAX_TIMEOUT, Math.max(0, Math.min(...alvos) - Date.now())));
  }
  // Timer, wake-up and start: every task whose slot has passed runs once if it is recent enough.
  function venceu() {
    const agora = Date.now();
    let mudou = false;
    for (const t of tarefas) {
      if (t.pausada || !t.proxima || t.proxima > agora) continue;
      const atraso = agora - t.proxima;
      if (atraso <= JANELA_RECUPERA) enfileira(t.id, { recuperada: atraso > GRACA });
      else {
        const r = { inicio: t.proxima, fim: agora, estado: "perdida", sessionId: null, resumo: "", erro: "", custo: 0, recuperada: false, manual: false };
        t.historico = [...t.historico, r].slice(-MAX_HISTORICO); t.ultima = r;
      }
      t.proxima = proximaExecucao(t.repete, agora) ?? 0;
      mudou = true;
    }
    if (mudou) { persiste(); avisa(); }
    rearma();
  }
  function acorda() {
    clearTimeout(retomada);
    retomada = setTimeout(venceu, ESPERA_RETOMADA);
  }

  function enfileira(id, opcoes = {}) {
    if (rodando.has(id) || fila.some((i) => i.id === id)) return false;
    fila.push({ id, recuperada: !!opcoes.recuperada, manual: !!opcoes.manual });
    avisa();
    drena();
    return true;
  }
  function drena() {
    if (executando) return;
    let item, t;
    while (fila.length && !t) { item = fila.shift(); t = porId(item.id); }
    if (!t) return;
    executando = true;
    executa({ ...t }, item).catch((e) => log("[agenda] falha inesperada:", e?.message || e)).finally(() => { executando = false; drena(); });
  }

  async function executa(t, { recuperada, manual }) {
    const ac = new AbortController(), st = { ac, inicio: Date.now(), sessionId: null };
    rodando.set(t.id, st);
    let esgotou = false, estado = "ok", erro = "", custo = 0, resumo = "", caixa = null;
    const limite = setTimeout(() => { esgotou = true; ac.abort(); }, LIMITE_EXECUCAO);
    const passo = (f) => { try { return f(); } catch (e) { log("[agenda]", e?.message || e); } };
    passo(aoMudarEnergia); passo(avisa);
    try {
      if (!existePasta(t.cwd)) throw new ErroAgenda("Pasta sumiu");
      if (!modos.includes(t.modo)) throw new ErroAgenda("Modo de permissão inválido");
      caixa = criaCaixa({ type: "user", uuid: crypto.randomUUID(), message: { role: "user", content: t.prompt }, parent_tool_use_id: null });
      // the generator is closed on the result: the SDK needs streaming input with canUseTool, and it never ends otherwise
      const q = rodaQuery({
        prompt: caixa.gerador,
        options: {
          cwd: t.cwd, model: t.model || undefined, permissionMode: t.modo, maxTurns: MAX_TURNOS,
          extraArgs: {}, settingSources: ["user", "project", "local"],
          systemPrompt: { type: "preset", preset: "claude_code" }, abortController: ac,
          canUseTool: async () => ({ behavior: "deny", message: tr("Execução agendada: ninguém para aprovar.") }),
        },
      });
      for await (const m of q) {
        if (m.session_id && !st.sessionId) { st.sessionId = m.session_id; passo(() => guardaCfgSessao(m.session_id, { model: t.model, modo: t.modo })); passo(avisa); }
        if (m.type === "result") {
          custo = Number(m.total_cost_usd) || 0;
          resumo = texto(m.result, 200);
          if (m.is_error || m.subtype !== "success") { estado = "erro"; erro = texto(m.result || m.subtype, 300); }
          caixa.fecha();
        }
      }
    } catch (e) {
      if (!ac.signal.aborted) { estado = "erro"; erro = texto(e?.message || e, 300); log("[agenda] erro:", e?.message || e); }
    } finally {
      clearTimeout(limite);
      passo(() => caixa?.fecha());
      if (ac.signal.aborted) { estado = esgotou ? "erro" : "parada"; erro = esgotou ? "Tempo esgotado" : ""; }
      const sid = st.sessionId;
      if (sid) {
        const titulo = `${t.nome} - ${dataCurta(st.inicio)}`;
        for (let tentativa = 0; tentativa < 2; tentativa++) {
          try { await renomeia(sid, titulo, t.cwd); break; }
          catch (e) { if (tentativa) log("[agenda] não renomeou a sessão:", e?.message || e); else await new Promise((ok) => setTimeout(ok, 1000)); }
        }
      }
      rodando.delete(t.id);
      const fim = Date.now();
      const r = { inicio: st.inicio, fim, estado, sessionId: sid, resumo, erro, custo, recuperada: !!recuperada, manual: !!manual };
      const atual = porId(t.id);
      if (atual) {
        atual.historico = [...atual.historico, r].slice(-MAX_HISTORICO); atual.ultima = r;
        passo(persiste);
        if (estado !== "parada") passo(() => notifica(atual, r));
      }
      passo(aoMudarEnergia); passo(avisa);
    }
  }

  function parar(id) {
    const i = fila.findIndex((x) => x.id === id);
    if (i >= 0) fila.splice(i, 1);
    rodando.get(id)?.ac.abort();
    avisa();
    return true;
  }

  // What a task is made of when it comes from the window: everything is checked here.
  function salvar(dados) {
    if (!dados || typeof dados !== "object") throw new ErroAgenda("Dados inválidos");
    const nome = texto(dados.nome, 80).trim(), prompt = texto(dados.prompt, 20000).trim(), cwd = texto(dados.cwd, 1000).trim();
    if (!nome) throw new ErroAgenda("Dê um nome à tarefa");
    if (!prompt) throw new ErroAgenda("Escreva o que o Claude deve fazer");
    if (!cwd || !existePasta(cwd)) throw new ErroAgenda("Escolha uma pasta que exista");
    const modo = dados.modo || modoPadrao;
    if (!modos.includes(modo)) throw new ErroAgenda("Modo de permissão inválido");
    const repete = validaRepete(dados.repete);
    const campos = { nome, prompt, cwd, model: texto(dados.model, 80), modo, repete };
    let t = typeof dados.id === "string" ? porId(dados.id) : null;
    if (t) Object.assign(t, campos);
    else { t = { id: crypto.randomUUID(), ...campos, pausada: false, proxima: 0, ultima: null, historico: [] }; tarefas.push(t); }
    t.proxima = t.pausada ? 0 : proximaExecucao(repete, Date.now()) ?? 0;
    persiste(); rearma(); avisa();
    return publica(t);
  }
  function apagar(id) {
    parar(id);
    tarefas = tarefas.filter((t) => t.id !== id);
    persiste(); rearma(); avisa();
    return true;
  }
  function pausar(id, pausada) {
    const t = porId(id);
    if (!t) return false;
    t.pausada = !!pausada;
    t.proxima = t.pausada ? 0 : proximaExecucao(t.repete, Date.now()) ?? 0;
    persiste(); rearma(); avisa();
    return true;
  }
  function rodar(id) { return !!porId(id) && enfileira(id, { manual: true }); }

  const publica = (t) => ({ ...t, historico: undefined, rodando: rodando.has(t.id), naFila: fila.some((i) => i.id === t.id) });
  carrega();
  venceu();
  return {
    lista: () => tarefas.map(publica),
    salvar, apagar, pausar, rodar, parar,
    historico: (id) => [...(porId(id)?.historico || [])].reverse(),
    proximas: (n = 5) => tarefas.filter((t) => !t.pausada && t.proxima).sort((a, b) => a.proxima - b.proxima).slice(0, n).map((t) => ({ id: t.id, nome: t.nome, proxima: t.proxima })),
    rodandoQtd: () => rodando.size,
    ativasQtd: () => tarefas.filter((t) => !t.pausada).length,
    idsRodando: () => [...rodando.values()].map((r) => r.sessionId).filter(Boolean),
    // quitting: no timer fires again and the running queries stop
    aborta: () => { clearTimeout(temporizador); clearTimeout(retomada); temporizador = retomada = null; fila.length = 0; for (const r of rodando.values()) r.ac.abort(); },
    acorda,
  };
}
