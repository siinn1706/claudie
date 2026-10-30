// Background tasks of a turn: workflows (ultracode), agents, shells, monitors.
// The stream messages (task_started / task_progress / task_updated /
// task_notification / background_tasks_changed) feed one small state per turn;
// the window gets it as plain snapshots. A workflow's phases and per-agent
// tokens are not in the typed stream, so they come from the undocumented
// workflow_progress array when it is there, from the workflow script's meta
// block, and from the run's journal and agent transcripts on disk (read only,
// appended bytes only, while the run is alive).
import fs from "node:fs";
import path from "node:path";

const MAX_CONCLUIDAS = 100, MAX_SESSOES = 60, MAX_AGENTES = 200, MAX_FASES = 64, CORTE = 200, ATRASO = 300, POLL = 1500;
const corta = (s) => (s == null ? "" : String(s).slice(0, CORTE));
const num = (v) => (Number.isFinite(+v) ? +v : 0);
const tempo = (v) => (typeof v === "number" ? v : typeof v === "string" && Number.isFinite(Date.parse(v)) ? Date.parse(v) : 0);

// Finished tasks live per conversation for the whole app session, newest first.
const concluidasPorSessao = new Map();
export const concluidasDe = (chave) => concluidasPorSessao.get(chave) || [];
export const esqueceTarefas = (chave) => concluidasPorSessao.delete(chave);
function guardaConcluida(chave, item) {
  let l = concluidasPorSessao.get(chave);
  if (!l) { l = []; concluidasPorSessao.set(chave, l); if (concluidasPorSessao.size > MAX_SESSOES) concluidasPorSessao.delete(concluidasPorSessao.keys().next().value); }
  l.unshift(item); if (l.length > MAX_CONCLUIDAS) l.length = MAX_CONCLUIDAS;
}

// ---- the meta block of a workflow script ---------------------------------------------------
// `export const meta = { name, description, phases: [...] }` is a pure literal:
// a small parser reads it, nothing is evaluated.
export function parseMetaWorkflow(script) {
  const s = String(script || ""), m = /export\s+const\s+meta\s*=\s*/.exec(s);
  if (!m) return null;
  const n = s.length; let i = m.index + m[0].length;
  const ws = () => {
    for (;;) {
      while (i < n && /\s/.test(s[i])) i++;
      if (s.startsWith("//", i)) { while (i < n && s[i] !== "\n") i++; }
      else if (s.startsWith("/*", i)) { const f = s.indexOf("*/", i + 2); i = f < 0 ? n : f + 2; }
      else return;
    }
  };
  const ESC = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", 0: "\0" };
  const str = () => {
    const q = s[i++]; let o = "";
    while (i < n && s[i] !== q) {
      if (s[i] === "\\") {
        const c = s[++i]; i++;
        if (c === "u") { o += String.fromCharCode(parseInt(s.slice(i, i + 4), 16)); i += 4; }
        else if (c === "x") { o += String.fromCharCode(parseInt(s.slice(i, i + 2), 16)); i += 2; }
        else if (c !== "\n") o += c in ESC ? ESC[c] : c;
      } else {
        if (q === "`" && s[i] === "$" && s[i + 1] === "{") throw new Error("interpolation");
        o += s[i++];
      }
    }
    if (i >= n) throw new Error("unterminated");
    i++; return o;
  };
  const val = (d) => {
    if (d > 8) throw new Error("deep");
    ws(); const c = s[i];
    if (c === "{") {
      i++; const o = {};
      for (;;) {
        ws(); if (s[i] === "}") { i++; return o; }
        let k;
        if (s[i] === "'" || s[i] === '"') k = str();
        else { const id = /^[A-Za-z_$][\w$]*/.exec(s.slice(i, i + 80)); if (!id) throw new Error("key"); k = id[0]; i += k.length; }
        ws(); if (s[i++] !== ":") throw new Error("colon");
        o[k] = val(d + 1); ws();
        if (s[i] === ",") i++; else if (s[i] !== "}") throw new Error("object");
      }
    }
    if (c === "[") {
      i++; const a = [];
      for (;;) {
        ws(); if (s[i] === "]") { i++; return a; }
        a.push(val(d + 1)); ws();
        if (s[i] === ",") i++; else if (s[i] !== "]") throw new Error("array");
      }
    }
    if (c === "'" || c === '"' || c === "`") return str();
    const lit = /^(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|true|false|null)\b/i.exec(s.slice(i, i + 40));
    if (!lit) throw new Error("value");
    i += lit[0].length; return JSON.parse(lit[0].toLowerCase());
  };
  try {
    const o = val(0);
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    const fases = (Array.isArray(o.phases) ? o.phases : []).slice(0, MAX_FASES).map((f) => typeof f === "string" ? { titulo: corta(f), detalhe: "" } : { titulo: corta(f?.title ?? f?.name), detalhe: corta(f?.detail ?? f?.description) });
    return { nome: corta(o.name), descricao: corta(o.description), fases };
  } catch { return null; }
}

// What the undocumented agent "state" can say, in one place.
export function estadoAgente(raw) {
  const s = String(raw || "").toLowerCase();
  if (/done|complet|finish|success/.test(s)) return "done";
  if (/err|fail/.test(s)) return "error";
  if (/stop|kill|cancel|abort/.test(s)) return "stopped";
  if (/queue|wait|pend/.test(s)) return "queued";
  return "running";
}
const final = (e) => e === "done" || e === "error" || e === "stopped";

// ---- state ---------------------------------------------------------------------------------
export function iniciaTarefas(t) {
  Object.assign(t, { tarefas: new Map(), filhos: new Map(), wfMetas: [], wfInfo: new Map(), fundoTimer: null, vigia: null, concSujo: false });
}
const visivel = (x) => x.tipo === "local_workflow" || x.bg;
const novaTarefa = (m, bg = m.is_backgrounded !== false) => ({
  id: m.task_id, runId: m.run_id || "", tipo: m.task_type || (m.subagent_type ? "local_agent" : ""), descricao: corta(m.description), nome: corta(m.workflow_name),
  pai: m.parent_task_id || "", bg, inicio: Date.now(), tokens: 0, usos: 0, duracaoMs: 0, ultimaFerr: "", resumo: "", fases: [], agentes: new Map(), dir: "", detalhe: "",
});

// A workflow agent by id (or by index until its id is known).
function agente(x, chave, indice) {
  let a = x.agentes.get(chave) || (indice != null && x.agentes.get("i" + indice));
  if (a) { if (a.chave !== chave) { x.agentes.delete(a.chave); a.chave = chave; x.agentes.set(chave, a); } return a; }
  if (x.agentes.size >= MAX_AGENTES) return null;
  a = { chave, indice: indice ?? null, rotulo: "", fase: "", faseIndice: null, estado: "queued", inicio: 0, fim: 0, ultimaFerr: "", resumo: "", tokens: null, tokensDisco: null, erro: "" };
  x.agentes.set(chave, a); return a;
}
// workflow_progress: phases and agents by index, so a delta and a full snapshot merge alike.
export function mesclaWorkflow(x, itens) {
  for (const it of itens) {
    if (!it || typeof it !== "object") continue;
    if (it.type === "workflow_agent") {
      const a = agente(x, it.agentId || "i" + it.index, num(it.index)); if (!a) continue;
      if (it.label) a.rotulo = corta(it.label);
      if (it.phaseIndex != null) a.faseIndice = num(it.phaseIndex);
      if (it.phaseTitle) a.fase = corta(it.phaseTitle);
      if (it.state != null) a.estado = estadoAgente(it.state);
      a.inicio = tempo(it.startedAt) || a.inicio;
      if (final(a.estado) && !a.fim) a.fim = tempo(it.lastProgressAt) || Date.now();
      if (it.lastToolName) a.ultimaFerr = corta(it.lastToolName);
      const r = it.lastToolSummary || it.resultPreview; if (r) a.resumo = corta(r);
      const tk = it.tokens ?? it.totalTokens ?? it.usage?.total_tokens; if (tk != null) a.tokens = num(tk);
      if (it.error) a.erro = corta(typeof it.error === "string" ? it.error : it.error.message);
    } else if (it.type === "workflow_phase" && it.index != null) {
      const i = num(it.index); if (i < 0 || i >= MAX_FASES) continue;
      const f = x.fases[i] || {};
      x.fases[i] = { titulo: corta(it.title) || f.titulo || "", detalhe: corta(it.detail) || f.detalhe || "" };
    }
  }
}
function aplicaInfo(t, x) {
  const info = t.wfInfo.get(x.id);
  if (info) { x.dir = info.dir || x.dir; if (info.runId && !x.runId) x.runId = info.runId; }
  if (!x.meta) {
    let k = t.wfMetas.findIndex((m) => m.toolUseId && m.toolUseId === x.toolUseId);
    if (k < 0 && x.nome) k = t.wfMetas.findIndex((m) => m.meta.nome === x.nome);
    if (k < 0 && info?.meta) x.meta = info.meta;
    else if (k < 0 && t.wfMetas.length) k = 0;
    if (!x.meta && k >= 0) x.meta = t.wfMetas.splice(k, 1)[0].meta;
  }
  if (x.meta) {
    if (!x.nome) x.nome = x.meta.nome;
    x.detalhe = x.meta.descricao || x.detalhe;
    x.meta.fases.forEach((f, i) => { if (!x.fases[i]) x.fases[i] = f; });
  }
  if (x.dir) iniciaVigia(t);
}
const lerScript = (p) => { try { return fs.statSync(p).size < (1 << 20) ? fs.readFileSync(p, "utf8") : ""; } catch { return ""; } };
// The Workflow tool call: its script (inline or on disk) says the phases.
export function workflowEntrada(t, toolUseId, entrada) {
  const meta = parseMetaWorkflow(entrada?.script || (entrada?.scriptPath ? lerScript(entrada.scriptPath) : ""));
  if (meta) { t.wfMetas.push({ toolUseId, meta }); if (t.wfMetas.length > 20) t.wfMetas.shift(); }
}
// Its result: where the run writes its transcripts, and the script path.
export function workflowSaida(t, r) {
  if (!r || typeof r !== "object" || !r.taskId) return;
  const meta = r.scriptPath ? parseMetaWorkflow(lerScript(r.scriptPath)) : null;
  t.wfInfo.set(String(r.taskId), { dir: r.transcriptDir ? String(r.transcriptDir) : "", runId: r.runId ? String(r.runId) : "", meta });
  const x = t.tarefas.get(String(r.taskId));
  if (x) { aplicaInfo(t, x); agenda(t); }
}

function registra(t, x, estado, d = {}) {
  const u = d.usage || {};
  const item = {
    id: x.id, runId: x.runId, tipo: x.tipo, nome: x.nome, descricao: x.detalhe && x.tipo === "local_workflow" ? x.detalhe : x.descricao, estado,
    resumo: corta(d.summary || x.resumo), tokens: num(u.total_tokens) || tokensDe(x), usos: num(u.tool_uses) || x.usos,
    duracaoMs: num(u.duration_ms) || x.duracaoMs || Date.now() - x.inicio, fim: Date.now(), nAgentes: x.agentes.size,
  };
  guardaConcluida(t.sessionId || t.tid, item); t.concSujo = true; return item;
}
const estadoFinal = (s) => (s === "killed" ? "stopped" : s === "completed" || s === "failed" || s === "stopped" ? s : "");
function fecha(t, id, estado, d) {
  const x = t.tarefas.get(id); if (!x) return false;
  t.tarefas.delete(id);
  for (const [k, v] of t.filhos) if (v === id) t.filhos.delete(k);
  if (visivel(x)) registra(t, x, estado, d);
  if (t.vigia && ![...t.tarefas.values()].some((y) => y.tipo === "local_workflow" && y.dir)) { clearInterval(t.vigia); t.vigia = null; }
  return true;
}
const tokensDe = (x) => x.tokens || [...x.agentes.values()].reduce((s, a) => s + (a.tokens ?? a.tokensDisco ?? 0), 0);

// ---- the stream ----------------------------------------------------------------------------
// Returns true when the message was a background-task one.
export function trataMensagem(t, msg) {
  if (msg.type !== "system") return false;
  const sub = msg.subtype, id = msg.task_id;
  if (sub === "background_tasks_changed") {
    // The whole set of live tasks: what is not there any more is gone (its
    // notification, if it comes, still adds the finished row).
    const vivas = new Set(msg.tasks.filter((x) => !x.ambient).map((x) => x.task_id));
    for (const [k, x] of t.tarefas) if (visivel(x) && !vivas.has(k)) { t.tarefas.delete(k); for (const [c, w] of t.filhos) if (w === k) t.filhos.delete(c); }
    for (const x of msg.tasks) if (!x.ambient && !t.tarefas.has(x.task_id) && !t.filhos.has(x.task_id) && t.tarefas.get(x.parent_task_id)?.tipo !== "local_workflow") t.tarefas.set(x.task_id, novaTarefa(x, true));
    enviaFundo(t, true); return true;
  }
  if (sub === "task_started") {
    if (msg.ambient || msg.skip_transcript) return true;
    const pai = t.tarefas.get(msg.parent_task_id);
    if (pai?.tipo === "local_workflow") {
      // An agent of a workflow, not a card of its own.
      const a = agente(pai, id); if (a) { a.rotulo = corta(msg.description); a.estado = "running"; a.inicio = Date.now(); t.filhos.set(id, pai.id); }
    } else {
      const x = novaTarefa(msg); x.toolUseId = msg.tool_use_id || "";
      t.tarefas.set(id, x);
      if (x.tipo === "local_workflow") aplicaInfo(t, x);
    }
    agenda(t); return true;
  }
  if (sub === "task_progress") {
    const dono = t.filhos.get(id), x = t.tarefas.get(dono || id); if (!x) return true;
    if (x.runId && msg.run_id && msg.run_id < x.runId) return true; // a late frame
    const a = dono ? x.agentes.get(id) : x;
    if (a) {
      if (msg.usage) { a.tokens = num(msg.usage.total_tokens); if (!dono) { a.usos = num(msg.usage.tool_uses); a.duracaoMs = num(msg.usage.duration_ms); } }
      if (msg.last_tool_name) a.ultimaFerr = corta(msg.last_tool_name);
      if (msg.summary) a.resumo = corta(msg.summary);
    }
    if (!dono && Array.isArray(msg.workflow_progress)) mesclaWorkflow(x, msg.workflow_progress);
    agenda(t); return true;
  }
  if (sub === "task_updated") {
    const p = msg.patch || {}, dono = t.filhos.get(id), x = t.tarefas.get(dono || id); if (!x) return true;
    if (dono) { const a = x.agentes.get(id), e = estadoFinal(p.status); if (a && e) { a.estado = e === "completed" ? "done" : e === "failed" ? "error" : "stopped"; a.fim = Date.now(); if (p.error) a.erro = corta(p.error); } agenda(t); return true; }
    if (p.is_backgrounded != null) x.bg = p.is_backgrounded;
    if (p.description) x.descricao = corta(p.description);
    const e = estadoFinal(p.status);
    if (e) { fecha(t, id, e); enviaFundo(t, true); } else agenda(t);
    return true;
  }
  if (sub === "task_notification") {
    if (msg.ambient || msg.skip_transcript) return true;
    const e = estadoFinal(msg.status) || "completed", dono = t.filhos.get(id);
    if (dono) { const a = t.tarefas.get(dono)?.agentes.get(id); if (a) { a.estado = e === "completed" ? "done" : e === "failed" ? "error" : "stopped"; a.fim = Date.now(); if (msg.usage) a.tokens = num(msg.usage.total_tokens); } t.filhos.delete(id); agenda(t); return true; }
    if (t.tarefas.has(id)) fecha(t, id, e, { summary: msg.summary, usage: msg.usage });
    else {
      // Already closed by a patch: the notification adds its summary and numbers. Never seen: a row from the notification alone.
      const l = concluidasDe(t.sessionId || t.tid), c = l.find((r) => r.id === id);
      if (c) { c.estado = e; if (msg.summary) c.resumo = corta(msg.summary); if (msg.usage) { c.tokens = num(msg.usage.total_tokens) || c.tokens; c.usos = num(msg.usage.tool_uses) || c.usos; c.duracaoMs = num(msg.usage.duration_ms) || c.duracaoMs; } t.concSujo = true; }
      else {
        const u = msg.usage || {};
        guardaConcluida(t.sessionId || t.tid, { id, runId: msg.run_id || "", tipo: "", nome: "", descricao: corta(msg.summary), estado: e, resumo: "", tokens: num(u.total_tokens), usos: num(u.tool_uses), duracaoMs: num(u.duration_ms), fim: Date.now(), nAgentes: 0 });
        t.concSujo = true;
      }
    }
    enviaFundo(t, true); return true;
  }
  return false;
}
// The turn is over: what was still running died with it.
export function fechaTudo(t) {
  clearInterval(t.vigia); t.vigia = null;
  if (!t.tarefas) return;
  for (const id of [...t.tarefas.keys()]) fecha(t, id, "stopped");
  enviaFundo(t, true);
}

// ---- snapshot for the window ---------------------------------------------------------------
function serializa(x) {
  const o = { id: x.id, runId: x.runId, tipo: x.tipo, nome: x.nome, descricao: x.tipo === "local_workflow" && x.detalhe ? x.detalhe : x.descricao, inicio: x.inicio, tokens: tokensDe(x), usos: x.usos, ultimaFerr: x.ultimaFerr, resumo: x.resumo };
  if (x.tipo !== "local_workflow") return o;
  const fases = Array.from({ length: x.fases.length }, (_, i) => ({ i, titulo: x.fases[i]?.titulo || "", detalhe: x.fases[i]?.detalhe || "", agentes: [] })), soltos = [];
  let feitos = 0;
  for (const a of x.agentes.values()) {
    let i = a.faseIndice != null && fases[a.faseIndice] ? a.faseIndice : a.fase ? fases.findIndex((f) => f.titulo === a.fase) : -1;
    if (i < 0 && a.fase && fases.length < MAX_FASES) { fases.push({ i: fases.length, titulo: a.fase, detalhe: "", agentes: [] }); i = fases.length - 1; }
    if (final(a.estado)) feitos++;
    (i >= 0 ? fases[i].agentes : soltos).push({ k: a.chave, rotulo: a.rotulo || a.chave, estado: a.estado, inicio: a.inicio, fim: a.fim, tokens: a.tokens ?? a.tokensDisco, ultimaFerr: a.ultimaFerr, resumo: a.resumo, erro: a.erro });
  }
  if (soltos.length) fases.push({ i: fases.length, titulo: "", detalhe: "", agentes: soltos });
  return { ...o, fases, nAgentes: x.agentes.size, nFeitos: feitos };
}
export const fundoLista = (t, comConcluidas = true) => ({ ativas: [...(t.tarefas?.values() || [])].filter(visivel).map(serializa), ...(comConcluidas ? { concluidas: concluidasDe(t.sessionId || t.tid) } : {}) });
// At most one event per ATRASO ms: workflow progress can arrive many times a second.
function agenda(t) { if (!t.fundoTimer) t.fundoTimer = setTimeout(() => { t.fundoTimer = null; manda(t); }, ATRASO); }
function manda(t) {
  const comConcluidas = t.concSujo; t.concSujo = false;
  t.ev({ tipo: "fundo", sessaoId: t.sessionId, ...fundoLista(t, comConcluidas) });
}
export function enviaFundo(t, ja = false) { if (!ja) return agenda(t); clearTimeout(t.fundoTimer); t.fundoTimer = null; manda(t); }

// ---- the run's files on disk ---------------------------------------------------------------
function iniciaVigia(t) {
  if (t.vigia) return;
  t.vigia = setInterval(() => {
    let vivos = 0, mudou = false;
    for (const x of t.tarefas.values()) if (x.tipo === "local_workflow" && x.dir) { vivos++; mudou = leWorkflow(x) || mudou; }
    if (!vivos) { clearInterval(t.vigia); t.vigia = null; }
    else if (mudou) agenda(t);
  }, POLL);
  t.vigia.unref?.();
}
// Complete lines appended to a file since the last read.
function leNovas(arq, st) {
  let fd;
  try {
    fd = fs.openSync(arq, "r");
    const tam = fs.fstatSync(fd).size;
    if (tam < st.pos) { st.pos = 0; st.resto = Buffer.alloc(0); }
    if (tam === st.pos) return [];
    const buf = Buffer.alloc(Math.min(tam - st.pos, 1 << 20)), n = fs.readSync(fd, buf, 0, buf.length, st.pos);
    st.pos += n;
    const tudo = Buffer.concat([st.resto, buf.subarray(0, n)]), fim = tudo.lastIndexOf(10);
    if (fim < 0) { st.resto = tudo; return []; }
    st.resto = tudo.subarray(fim + 1);
    return tudo.subarray(0, fim).toString("utf8").split("\n").filter(Boolean);
  } catch { return []; } finally { if (fd != null) try { fs.closeSync(fd); } catch {} }
}
function leWorkflow(x) {
  if (!x.pasta) {
    x.pasta = [x.dir, x.runId && path.join(x.dir, x.runId)].find((c) => c && fs.existsSync(path.join(c, "journal.jsonl"))) || "";
    if (!x.pasta) return false;
    x.jornal = { pos: 0, resto: Buffer.alloc(0) };
  }
  let mudou = false;
  for (const l of leNovas(path.join(x.pasta, "journal.jsonl"), x.jornal)) {
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (!o?.agentId || !/^[\w-]+$/.test(o.agentId)) continue;
    const a = agente(x, o.agentId); if (!a) continue;
    if (o.type === "started") { if (o.label) a.rotulo = corta(o.label); if (o.phase) a.fase = corta(o.phase); if (a.estado === "queued") a.estado = "running"; mudou = true; }
    else if (o.type === "result" || /fail|error/.test(String(o.type))) { if (!final(a.estado)) { a.estado = o.type === "result" ? "done" : "error"; a.fim = Date.now(); } mudou = true; }
  }
  // Per-agent tokens and time from each agent's transcript; a finished agent is read once more.
  for (const a of x.agentes.values()) {
    if (!/^[\w-]+$/.test(a.chave) || a.lido) continue;
    a.arq ??= { pos: 0, resto: Buffer.alloc(0), msgs: new Map() };
    for (const l of leNovas(path.join(x.pasta, `agent-${a.chave}.jsonl`), a.arq)) {
      const ts = /"timestamp":"([^"]+)"/.exec(l); if (ts) { const v = Date.parse(ts[1]); if (v) { a.inicio ||= v; a.t1 = v; } }
      if (!l.includes('"type":"assistant"') || !l.includes('"usage"')) continue;
      try { const m = JSON.parse(l).message, u = m?.usage; if (u && m.id) a.arq.msgs.set(m.id, num(u.input_tokens) + num(u.output_tokens) + num(u.cache_creation_input_tokens)); } catch {}
    }
    const soma = [...a.arq.msgs.values()].reduce((s, v) => s + v, 0);
    if (soma !== a.tokensDisco && soma) { a.tokensDisco = soma; mudou = true; }
    if (final(a.estado)) { a.lido = true; if (a.t1) a.fim = a.t1; mudou = true; }
  }
  return mudou;
}
