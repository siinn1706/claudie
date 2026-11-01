// "Tarefas agendadas": Claude Code runs that start by themselves (see src/agendadas.js).
// Three floating windows: the list (run now, pause, history, edit, delete), the editor
// (what to do, where, with which model and mode, how often, with a preview of the next runs)
// and the history of one task. The main process owns the schedule and sends the whole list
// as {tipo:"agendadas", lista} whenever it changes.

let agLista = [], agJanela = null, agPreviewTimer = 0, agPreviewN = 0;
const agArma = new Map(); // delete buttons waiting for the second click
const AG_MODOS = [["default", "Perguntar"], ["acceptEdits", "Aceitar edições"], ["plan", "Modo plano"], ["auto", "Automático"]];
const AG_MODELOS = [["", "Padrão"], ["claude-opus-5-5", "Opus 5.5"], ["claude-sonnet-5-5", "Sonnet 5.5"], ["claude-haiku-5-5", "Haiku 5.5"], ["claude-fable-5-1", "Fable 5.1"]];
const AG_TIPOS = [["horaria", "A cada hora"], ["diaria", "Todo dia"], ["dias_uteis", "Dias úteis"], ["semanal", "Toda semana"], ["cron", "Expressão cron"]];
const AG_ESTADO = { ok: "Concluída", erro: "Falhou", parada: "Parada", perdida: "Perdida" };
const AG_RELOGIO = svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>');

const agLocal = () => window.i18n?.local?.() || "pt-BR";
const agQuando = (ms) => (ms ? new Date(ms).toLocaleString(agLocal(), { dateStyle: "short", timeStyle: "short" }) : "");
const agDataCurta = (ms) => { const d = new Date(ms), p = (n) => String(n).padStart(2, "0"); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const agHora = (r) => `${String(r.hora).padStart(2, "0")}:${String(r.minuto).padStart(2, "0")}`;
const agDia = (n) => new Date(2026, 10, 1 + n).toLocaleDateString(agLocal(), { weekday: "long" });
const agPasta = (p) => String(p || "").split(/[\\/]/).filter(Boolean).pop() || p;
function agResumo(r) {
  const t = window.t;
  if (r.tipo === "horaria") return t("A cada hora, no minuto {0}", r.minuto);
  if (r.tipo === "diaria") return t("Todo dia às {0}", agHora(r));
  if (r.tipo === "dias_uteis") return t("Dias úteis às {0}", agHora(r));
  if (r.tipo === "semanal") return t("{0} às {1}", agDia(r.dia), agHora(r));
  return t("Cron: {0}", r.cron);
}
// a stored value that is not in the list keeps its own option, so saving never swaps it for the default
const agOpcoes = (lista, atual) => (atual && !lista.some(([v]) => v === atual) ? [...lista, [atual, esc(atual)]] : lista)
  .map(([v, n]) => `<option value="${esc(v)}"${v === atual ? " selected" : ""}>${n}</option>`).join("");
const agDur = (ms) => { const s = Math.max(0, Math.round(ms / 1000)), m = Math.floor(s / 60); return m ? `${m}min ${s % 60}s` : `${s}s`; };

// ---- state, sidebar button ---------------------------------------------------------------------------
function agAplica(lista) {
  agLista = Array.isArray(lista) ? lista : [];
  const ativas = agLista.filter((t) => !t.pausada).length, rodando = agLista.filter((t) => t.rodando).length;
  const el = $("agendadasNome");
  el.textContent = rodando ? window.t("{0} em execução", rodando) : ativas ? String(ativas) : "";
  desenhaAgendadas();
}
aoEvento((ev) => {
  if (ev.tipo === "agendadas") agAplica(ev.lista);
  else if (ev.tipo === "abrir_agendadas" || ev.tipo === "agendada_ocupada") abreAgendadas();
  else if (ev.tipo === "abrir_sessao_pedido") agAbreSessao(ev.id, ev.cwd);
});
vivo.agendadas().then(agAplica).catch(() => {});
$("agendadasBtn").onclick = () => abreAgendadas();

// A run opened from a notification: its title is the one the main process gave the session.
async function agAbreSessao(id, cwd, titulo) {
  const t = agLista.find((x) => x.ultima?.sessionId === id);
  await carregaSessoes();
  abreSessao(id, titulo || tituloDe(id) || (t ? `${t.nome} - ${agDataCurta(t.ultima.inicio)}` : window.t("Tarefa agendada")), cwd || t?.cwd);
}

// ---- the list ---------------------------------------------------------------------------------------------
ABRE_JANELINHA.agendadas = () => abreAgendadas();
function abreAgendadas() {
  const j = janelinha("agendadas", "Tarefas agendadas", { largura: 520, aoFechar: () => { agJanela = null; } });
  agJanela = j;
  j.corpo.classList.add("ag");
  desenhaAgendadas();
}
function desenhaAgendadas() {
  const j = agJanela; if (!j || !j.el.isConnected) return;
  const foco = document.activeElement?.closest?.(".ag-card")?.dataset.id;
  j.corpo.innerHTML = `<div class="ag-topo"><button class="btn forte" data-nova>+ Nova tarefa</button></div>` +
    (agLista.length ? agLista.map(agCard).join("") : '<p class="jl-vazio">Nenhuma tarefa agendada</p>');
  j.corpo.querySelector("[data-nova]").onclick = () => abreEditorAgendada();
  for (const el of j.corpo.querySelectorAll(".ag-card")) agLiga(el);
  for (const id of agArma.keys()) armaApagar(j.corpo.querySelector(`.ag-card[data-id="${CSS.escape(id)}"] [data-acao="apagar"]`));
  if (foco) j.corpo.querySelector(`.ag-card[data-id="${CSS.escape(foco)}"] button`)?.focus({ preventScroll: true });
}
function agCard(t) {
  const u = t.ultima, estado = t.rodando ? "rodando" : t.naFila ? "fila" : u?.estado || "";
  const chip = t.rodando ? "Rodando" : t.naFila ? "Na fila" : u ? AG_ESTADO[u.estado] : "";
  const proxima = t.pausada ? window.t("Pausada") : t.proxima ? window.t("Próxima: {0}", agQuando(t.proxima)) : "";
  const ultima = u ? window.t("Última: {0}", agQuando(u.fim || u.inicio)) + (u.estado === "erro" && u.erro ? ` · ${window.t(u.erro)}` : "") : "";
  const botao = (acao, rotulo, extra = "") => `<button class="btn" data-acao="${acao}"${extra}>${rotulo}</button>`;
  return `<article class="ag-card${t.pausada ? " pausada" : ""}" data-id="${esc(t.id)}">
    <div class="ag-l1"><i class="ag-ponto${t.rodando ? " roda" : ""}"></i><b data-sem-traducao>${esc(t.nome)}</b>${chip ? `<span class="ag-chip e-${estado}">${chip}</span>` : ""}</div>
    <p class="ag-meta"><span>${esc(agResumo(t.repete))}</span> · <span data-sem-traducao>${esc(agPasta(t.cwd))}</span></p>
    <p class="ag-meta">${esc([proxima, ultima].filter(Boolean).join(" · "))}</p>
    <div class="ag-acoes">${t.rodando || t.naFila ? botao("parar", "Parar") : botao("rodar", "Rodar agora")}${botao("pausar", t.pausada ? "Retomar" : "Pausar")}${botao("historico", "Histórico")}${botao("editar", "Editar")}${botao("apagar", "Apagar")}</div>
  </article>`;
}
const armaApagar = (b) => { if (b) { b.classList.add("perigo"); b.textContent = window.t("Confirmar: apagar?"); } };
function agLiga(el) {
  const id = el.dataset.id;
  const acoes = {
    rodar: () => vivo.agendadaRodar(id),
    parar: () => vivo.agendadaParar(id),
    pausar: () => vivo.agendadaPausar(id, !agLista.find((t) => t.id === id)?.pausada),
    historico: () => abreHistoricoAgendada(id),
    editar: () => abreEditorAgendada(id),
    apagar: (b) => {
      // a deleted task takes its history with it: the first click only arms the button
      if (!agArma.has(id)) {
        agArma.set(id, setTimeout(() => { agArma.delete(id); const atual = document.querySelector(`.ag-card[data-id="${CSS.escape(id)}"] [data-acao="apagar"]`); if (atual) { atual.classList.remove("perigo"); atual.textContent = window.t("Apagar"); } }, 4000));
        armaApagar(b); return;
      }
      clearTimeout(agArma.get(id)); agArma.delete(id);
      return vivo.agendadaApagar(id);
    },
  };
  for (const b of el.querySelectorAll("[data-acao]")) b.onclick = () => acoes[b.dataset.acao](b);
}

// ---- the editor -------------------------------------------------------------------------------------------
async function abreEditorAgendada(id) {
  const t = id ? agLista.find((x) => x.id === id) : null;
  const j = janelinha("agendada-editor", t ? "Editar tarefa" : "Nova tarefa", { largura: 460, aoFechar: () => { clearTimeout(agPreviewTimer); } });
  let cwd = t?.cwd || "";
  if (!cwd) cwd = (await vivo.estado().catch(() => null))?.cwd || "";
  const r = t?.repete || { tipo: "diaria", minuto: 0, hora: 9, dia: 1, cron: "" };
  const c = j.corpo;
  c.classList.add("ag", "ag-form");
  c.innerHTML = `
    <label class="ag-campo"><span>Nome</span><input type="text" data-f="nome" maxlength="80" /></label>
    <label class="ag-campo"><span>O que o Claude deve fazer</span><textarea data-f="prompt" rows="5" maxlength="20000" placeholder="Ex.: Rode os testes e resuma o que falhou"></textarea></label>
    <div class="ag-campo"><span>Pasta</span><div class="ag-pasta"><code data-f="pasta" data-sem-traducao></code><button class="btn" data-escolhe>Escolher</button></div></div>
    <div class="ag-duplo">
      <label class="ag-campo"><span>Modelo</span><select data-f="model">${agOpcoes(AG_MODELOS, t?.model || "")}</select></label>
      <label class="ag-campo"><span>Permissões</span><select data-f="modo">${agOpcoes(AG_MODOS, t?.modo || "auto")}</select></label>
    </div>
    <p class="ag-nota">Ninguém aprova nada durante a execução: o que o modo não libera é negado. Os hooks, os servidores MCP e o CLAUDE.md da pasta rodam sem supervisão, como numa conversa normal.</p>
    <label class="ag-campo"><span>Repetir</span><select data-f="tipo">${agOpcoes(AG_TIPOS, r.tipo)}</select></label>
    <div class="ag-duplo ag-quando">
      <label class="ag-campo" data-so="semanal"><span>Dia da semana</span><select data-f="dia">${[0, 1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}"${n === r.dia ? " selected" : ""}>${esc(agDia(n))}</option>`).join("")}</select></label>
      <label class="ag-campo" data-so="diaria dias_uteis semanal"><span>Horário</span><input type="time" data-f="hora" /></label>
      <label class="ag-campo" data-so="horaria"><span>No minuto</span><input type="number" data-f="minuto" min="0" max="59" /></label>
      <label class="ag-campo ag-largo" data-so="cron"><span>Cron (minuto hora dia mês dia-da-semana)</span><input type="text" data-f="cron" maxlength="100" placeholder="*/15 9-17 * * 1-5" spellcheck="false" /></label>
    </div>
    <div class="ag-previa"><span>Próximas execuções</span><ul></ul></div>
    <p class="ag-erro" hidden></p>
    <div class="ag-rodape"><button class="btn" data-cancela>Cancelar</button><button class="btn forte" data-salva>Salvar</button></div>`;
  const f = (k) => c.querySelector(`[data-f="${k}"]`);
  f("nome").value = t?.nome || ""; f("prompt").value = t?.prompt || "";
  f("pasta").textContent = cwd; f("pasta").title = cwd;
  f("hora").value = agHora(r); f("minuto").value = r.minuto; f("cron").value = r.cron || "";
  const erro = c.querySelector(".ag-erro");
  const mostraErro = (m) => { erro.textContent = m || ""; erro.hidden = !m; };
  const repete = () => {
    const [hora, minuto] = (f("hora").value || "0:0").split(":").map(Number);
    const tipo = f("tipo").value;
    return { tipo, hora, minuto: tipo === "horaria" ? Number(f("minuto").value) : minuto, dia: Number(f("dia").value), cron: f("cron").value };
  };
  const atualizaCampos = () => {
    const tipo = f("tipo").value;
    for (const el of c.querySelectorAll("[data-so]")) el.hidden = !el.dataset.so.split(" ").includes(tipo);
  };
  const previa = () => {
    clearTimeout(agPreviewTimer);
    const n = ++agPreviewN, ul = c.querySelector(".ag-previa ul");
    agPreviewTimer = setTimeout(async () => {
      const res = await vivo.agendadaProxima(repete()).catch(() => ({ erro: "" }));
      if (n !== agPreviewN || !c.isConnected) return;
      ul.innerHTML = res.erro ? `<li class="ruim">${esc(res.erro)}</li>` : res.proximas.map((ms) => `<li>${esc(agQuando(ms))}</li>`).join("");
    }, 300);
  };
  for (const el of c.querySelectorAll("[data-f]")) { el.addEventListener("input", () => { atualizaCampos(); previa(); mostraErro(""); }); el.addEventListener("change", () => { atualizaCampos(); previa(); }); }
  atualizaCampos(); previa();
  c.querySelector("[data-escolhe]").onclick = async () => {
    const p = await vivo.pasta(true);
    if (p) { cwd = p; f("pasta").textContent = p; f("pasta").title = p; mostraErro(""); }
  };
  c.querySelector("[data-cancela]").onclick = () => j.fecha();
  const salva = c.querySelector("[data-salva]");
  salva.onclick = async () => {
    salva.disabled = true;
    const res = await vivo.agendadaSalvar({ id: t?.id, nome: f("nome").value, prompt: f("prompt").value, cwd, model: f("model").value, modo: f("modo").value, repete: repete() }).catch((e) => ({ erro: String(e?.message || e) }));
    salva.disabled = false;
    if (res.erro) return mostraErro(res.erro);
    j.fecha(); abreAgendadas();
  };
  f("nome").focus();
}

// ---- the history of one task ---------------------------------------------------------------------------------
async function abreHistoricoAgendada(id) {
  const t = agLista.find((x) => x.id === id); if (!t) return;
  const j = janelinha("agendada-historico", "Histórico", { largura: 480 });
  j.el.querySelector("header b").textContent = `${window.t("Histórico")} · ${t.nome}`;
  j.corpo.classList.add("ag");
  j.corpo.innerHTML = '<p class="jl-vazio">Carregando…</p>';
  const itens = await vivo.agendadaHistorico(id).catch(() => []);
  if (!j.el.isConnected) return;
  j.corpo.innerHTML = itens.length ? itens.map((h, i) => `<article class="ag-hist">
      <div class="ag-l1"><span class="ag-chip e-${h.estado}">${AG_ESTADO[h.estado]}</span><b data-sem-traducao>${esc(agQuando(h.inicio))}</b>${h.recuperada ? `<span class="ag-tag">${window.t("Recuperada")}</span>` : ""}${h.manual ? `<span class="ag-tag">${window.t("Manual")}</span>` : ""}<em>${h.estado === "perdida" ? "" : esc(agDur(h.fim - h.inicio))}${h.custo ? ` · $${h.custo.toFixed(3)}` : ""}</em></div>
      ${h.resumo || h.erro ? `<p class="ag-resumo" data-sem-traducao>${esc(h.estado === "erro" && h.erro ? window.t(h.erro) : h.resumo)}</p>` : ""}
      ${h.sessionId ? `<button class="btn" data-abre="${i}">Abrir conversa</button>` : ""}
    </article>`).join("") : '<p class="jl-vazio">Nenhuma execução ainda</p>';
  for (const b of j.corpo.querySelectorAll("[data-abre]")) {
    const h = itens[Number(b.dataset.abre)];
    b.onclick = () => agAbreSessao(h.sessionId, t.cwd, `${t.nome} - ${agDataCurta(h.inicio)}`);
  }
}
