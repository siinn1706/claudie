// The details panel on the right, like the Claude app's: where Claude is
// working, how the context is filling up (by category, with a compact
// button), which connectors are up, and the files this conversation changed.
// It refreshes when opened and after each turn.

const info = document.createElement("aside");
info.className = "info"; info.id = "info"; info.setAttribute("aria-label", "Detalhes da conversa");
document.getElementById("app").append(info);
const botaoInfo = document.createElement("button");
botaoInfo.className = "icone"; botaoInfo.id = "infoBtn"; botaoInfo.title = "Detalhes (Ctrl+J)";
botaoInfo.innerHTML = svg('<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M15 4.5v15"/>');
$("som").before(botaoInfo);

const abertas = new Set(le("infoAbertas", ["ambiente", "contexto", "conectores", "saidas"]));
const k = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(".0", "") + "M" : n >= 1000 ? (n / 1000).toFixed(1).replace(".0", "") + "k" : String(n));
// Category colours: messages blue, built-in tools orange, connector tools
// teal, the rest grey (free space darker).
const corCategoria = (nome, tipo) => /mensag|messages/i.test(nome) ? "#4a8fe0" : /mcp tool/i.test(nome) && tipo !== "deferred" ? "#2bb39a" : /system tools/i.test(nome) && tipo !== "deferred" ? "#e8803a"
  : tipo === "free" ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.32)";

function secao(id, titulo, extra, corpo) {
  const aberta = abertas.has(id);
  return `<section class="info-sec${aberta ? " aberta" : ""}" data-sec="${id}"><button class="info-cab">${esc(titulo)}${svg('<path d="m8 10 4 4 4-4"/>')}<span class="info-extra">${extra || ""}</span></button><div class="info-corpo">${corpo}</div></section>`;
}
let dados = null, carregando = false, deNovo = false;
async function atualizaInfo() {
  if (!document.body.classList.contains("info-aberta")) return;
  if (carregando) { deNovo = true; return; }
  carregando = true; info.classList.add("carregando");
  try { dados = await vivo.painel(); } catch { dados = null; }
  carregando = false; info.classList.remove("carregando");
  desenhaInfo();
  if (deNovo) { deNovo = false; atualizaInfo(); }
}
// Connector management: turn off/on, reconnect, remove and add. The work runs in
// the main process (the SDK for the running query, the Claude Code CLI for the
// config files); the form draft lives here so a refresh does not wipe it.
let mcpForm = null, mcpMsg = null, mcpOcupado = "", mcpConfirma = "";
const MCP_ESTADO = { connected: "conectado", failed: "falhou", "needs-auth": "precisa de login", pending: "conectando", disabled: "desligado" };
const MCP_ESCOPO = { user: "todos os projetos", project: "compartilhado no projeto", local: "só neste projeto", claudeai: "claude.ai", managed: "da organização", plugin: "plugin", dynamic: "temporário" };
function mcpLinha(x) {
  const claudeai = x.escopo === "claudeai" || x.nome.startsWith("claude.ai "), ocupado = mcpOcupado === x.nome;
  const meta = [x.embutido ? "" : MCP_ESCOPO[x.escopo] || x.escopo, x.ferramentas == null ? "" : x.ferramentas === 1 ? "1 ferramenta" : window.t("{0} ferramentas", x.ferramentas)].filter(Boolean).join(" · ");
  const bt = (a, txt, cls = "") => `<button class="mcp-bt ${cls}" data-mcp="${a}" data-nome="${esc(x.nome)}" data-escopo="${esc(x.escopo)}"${ocupado ? " disabled" : ""}>${txt}</button>`;
  let acoes = "";
  if (claudeai) acoes = `<button class="mcp-bt" data-mcp-link="https://claude.ai/settings/connectors">Gerenciar no claude.ai</button>`;
  else if (!x.embutido) {
    acoes = bt(x.estado === "disabled" ? "ligar" : "desligar", x.estado === "disabled" ? "Ligar" : "Desligar");
    if (x.estado !== "disabled") acoes += bt("reconectar", "Reconectar");
    if (["user", "project", "local"].includes(x.escopo)) acoes += mcpConfirma === x.nome ? bt("remover", "Confirmar remoção", "perigo") : bt("remover", "Remover");
  }
  return `<div class="con-bloco"><div class="con" title="${esc(x.erro)}"><i class="${x.estado}"></i><span>${esc(x.nome)}</span><em>${ocupado ? "…" : MCP_ESTADO[x.estado] || x.estado}</em></div>`
    + (meta ? `<div class="con-meta">${esc(meta)}</div>` : "") + (x.erro && x.estado === "failed" ? `<div class="con-erro">${esc(x.erro)}</div>` : "")
    + (acoes ? `<div class="con-acoes">${acoes}</div>` : "") + `</div>`;
}
function mcpRodape() {
  const f = mcpForm, campo = (n, ph, tipo = "text") => `<input type="${tipo}" data-f="${n}" placeholder="${ph}" value="${esc(f[n] || "")}" spellcheck="false" autocomplete="off">`, area = (n, ph) => `<textarea data-f="${n}" rows="2" placeholder="${ph}" spellcheck="false">${esc(f[n] || "")}</textarea>`;
  const msg = mcpMsg ? `<div class="${mcpMsg.erro ? "con-erro" : "con-ok"}">${esc(mcpMsg.erro || mcpMsg.ok)}</div>` : "";
  if (!f) return `${msg}<button class="btn mcp-novo" data-mcp-form="abre">Adicionar conector</button>`;
  const http = f.transporte !== "stdio";
  return `${msg}<div class="mcp-form">
    ${campo("nome", "Nome (ex.: github)")}
    <select data-f="transporte"><option value="stdio"${f.transporte === "stdio" ? " selected" : ""}>Comando local (stdio)</option><option value="http"${f.transporte === "http" ? " selected" : ""}>Servidor remoto (http)</option><option value="sse"${f.transporte === "sse" ? " selected" : ""}>Servidor remoto (sse)</option></select>
    ${http ? campo("url", "https://…") : campo("comando", "Comando e argumentos (ex.: npx -y pacote)")}
    <select data-f="escopo">${["local", "user", "project"].map((e) => `<option value="${e}"${f.escopo === e ? " selected" : ""}>${MCP_ESCOPO[e]}</option>`).join("")}</select>
    ${http ? area("cabecalhos", "Cabeçalhos (Nome: valor, um por linha)") : area("env", "Variáveis (NOME=valor, uma por linha)")}
    <div class="mcp-form-bt"><button class="btn" data-mcp-form="fecha">Cancelar</button><button class="btn forte" data-mcp-form="envia"${mcpOcupado === "novo" ? " disabled" : ""}>Adicionar</button></div></div>`;
}
async function mcpExecuta(acao, nome, escopo) {
  if (acao === "remover" && mcpConfirma !== nome) { mcpConfirma = nome; desenhaInfo(); return; }
  mcpConfirma = ""; mcpOcupado = nome; mcpMsg = null; desenhaInfo();
  const r = await vivo.mcpAcao(acao, nome, escopo).catch((e) => ({ erro: String(e?.message || e) }));
  mcpOcupado = ""; mcpMsg = r.erro ? { erro: r.erro } : acao === "remover" && dados?.rodando ? { ok: "Removido. A resposta em andamento só muda na próxima mensagem." } : null;
  desenhaInfo(); atualizaInfo();
}
async function mcpEnvia() {
  mcpOcupado = "novo"; mcpMsg = null; desenhaInfo();
  const r = await vivo.mcpAdicionar(mcpForm).catch((e) => ({ erro: String(e?.message || e) }));
  mcpOcupado = "";
  if (r.erro) mcpMsg = { erro: r.erro };
  else { mcpForm = null; mcpMsg = { ok: dados?.rodando ? "Conector adicionado. A resposta em andamento só o usa na próxima mensagem." : "Conector adicionado." }; }
  desenhaInfo(); atualizaInfo();
}
function mcpLiga() {
  info.querySelectorAll("[data-mcp]").forEach((b) => (b.onclick = () => mcpExecuta(b.dataset.mcp, b.dataset.nome, b.dataset.escopo)));
  info.querySelectorAll("[data-mcp-link]").forEach((b) => (b.onclick = () => vivo.link(b.dataset.mcpLink)));
  info.querySelectorAll("[data-mcp-form]").forEach((b) => (b.onclick = () => {
    const a = b.dataset.mcpForm;
    if (a === "abre") { mcpForm = { transporte: "stdio", escopo: "local" }; mcpMsg = null; desenhaInfo(); info.querySelector('[data-f="nome"]')?.focus(); }
    else if (a === "fecha") { mcpForm = null; mcpMsg = null; desenhaInfo(); }
    else mcpEnvia();
  }));
  info.querySelectorAll("[data-f]").forEach((c) => c.addEventListener(c.tagName === "SELECT" ? "change" : "input", () => { mcpForm[c.dataset.f] = c.value; if (c.dataset.f === "transporte") desenhaInfo(); }));
}
function desenhaInfo() {
  const a = dados?.ambiente || {}, c = dados?.contexto, con = dados?.conectores || [];
  const nomePasta = (a.pasta || "").split(/[\\/]/).filter(Boolean).pop() || "";
  let h = `<div class="info-topo"><b>Detalhes</b><button class="icone" data-a="atualiza" title="Atualizar">${svg('<path d="M19.5 12a7.5 7.5 0 0 1-13.1 5"/><path d="M4.5 12a7.5 7.5 0 0 1 13.1-5"/><path d="M17.6 3.5v3.6H14M6.4 20.5v-3.6H10"/>')}</button><button class="icone" data-a="fecha" title="Fechar">${ICONE.erro}</button></div>`;
  h += secao("ambiente", "Ambiente", "", `
    <div class="info-linha">${svg('<rect x="3.5" y="5" width="17" height="11" rx="1.5"/><path d="M2.5 19h19"/>')}<span>Este computador</span><em>${esc(a.computador || "")}</em></div>
    <button class="info-linha clicavel" data-a="pasta" title="${esc(a.pasta || "")}">${ICONE.pasta}<span>${esc(nomePasta)}</span><em>${esc(a.pasta || "")}</em></button>
    ${a.ramo ? `<div class="info-linha">${ICONE.ramo}<span>${esc(a.ramo)}</span><em>branch</em></div>` : ""}
    ${a.modelo ? `<div class="info-linha">${svg('<path d="M12 3.5v3m0 11v3m8.5-8.5h-3m-11 0h-3m14-6-2.1 2.1M8.6 15.4l-2.1 2.1m0-11 2.1 2.1m6.8 6.8 2.1 2.1"/>')}<span>${esc(a.modelo)}</span></div>` : ""}`);
  if (c) {
    const usadas = c.categorias.filter((x) => x.tipo !== "deferred");
    const barra = usadas.map((x) => `<i style="width:${(x.tokens / c.max) * 100}%;background:${corCategoria(x.nome, x.tipo)}"></i>`).join("");
    const linhas = c.categorias.map((x) => `<div class="ctx-cat${x.tipo === "deferred" ? " adiada" : ""}"><i style="background:${corCategoria(x.nome, x.tipo)}"></i><span>${esc(x.nome)}</span><em>${k(x.tokens)}</em><b>${x.tipo === "deferred" ? "—" : ((x.tokens / c.max) * 100).toFixed(1).replace(".", ",") + "%"}</b></div>`).join("");
    h += secao("contexto", "Contexto", `${Math.round(c.pct)}%`, `
      <div class="ctx-topo"><b>${Math.round(c.pct)}% usado</b><span>${k(c.total)} / ${k(c.max)}</span></div>
      <div class="ctx-barra">${barra}</div><div class="ctx-cats">${linhas}</div>
      <div class="ctx-base"><span>Compacta sozinho perto do limite</span><button class="btn" data-a="compacta"${rodando || !sessaoAtual ? " disabled" : ""}>Compactar sessão</button></div>`);
  } else h += secao("contexto", "Contexto", "", `<p class="info-vazio">${dados?.erro ? "Não deu para ler o contexto agora." : carregando ? "Lendo…" : "Abra ou comece uma conversa."}</p>`);
  const ok = con.filter((x) => x.estado === "connected").length;
  h += secao("conectores", "Conectores", con.length ? `${ok} de ${con.length}` : "", `${con.length ? con.map(mcpLinha).join("") : `<p class="info-vazio">Nenhum conector configurado.</p>`}${mcpRodape()}`);
  const arquivos = typeof alteracoes === "function" ? [...alteracoes().keys()] : [];
  h += secao("saidas", "Saídas", arquivos.length ? String(arquivos.length) : "", arquivos.length
    ? arquivos.map((f) => `<div class="saida"><button class="clicavel" data-abre="${esc(f)}" title="${esc(f)}">${svg('<path d="m9 8-4 4 4 4M15 8l4 4-4 4"/>')}<span>${esc(f.split(/[\\/]/).pop())}</span></button><button class="icone" data-mostra="${esc(f)}" title="Mostrar na pasta">${ICONE.pasta}</button></div>`).join("")
    : `<p class="info-vazio">Nenhum arquivo mudado nesta conversa.</p>`);
  info.innerHTML = h;
  mcpLiga();
  info.querySelectorAll(".info-cab").forEach((b) => (b.onclick = () => { const s = b.parentElement, id = s.dataset.sec; s.classList.toggle("aberta"); s.classList.contains("aberta") ? abertas.add(id) : abertas.delete(id); guarda("infoAbertas", [...abertas]); }));
  info.querySelector('[data-a="atualiza"]').onclick = atualizaInfo;
  info.querySelector('[data-a="fecha"]').onclick = () => alternaInfo(false);
  info.querySelector('[data-a="pasta"]')?.addEventListener("click", () => vivo.abrirArquivo(a.pasta));
  info.querySelector('[data-a="compacta"]')?.addEventListener("click", () => envia("/compact"));
  info.querySelectorAll("[data-abre]").forEach((b) => (b.onclick = () => vivo.abrirArquivo(b.dataset.abre)));
  info.querySelectorAll("[data-mostra]").forEach((b) => (b.onclick = () => vivo.abrirArquivo(b.dataset.mostra, true)));
}
function alternaInfo(v = !document.body.classList.contains("info-aberta")) {
  document.body.classList.toggle("info-aberta", v); guarda("infoAberta", v);
  botaoInfo.classList.toggle("on", v);
  if (v) { desenhaInfo(); atualizaInfo(); }
}
botaoInfo.onclick = () => alternaInfo();
addEventListener("keydown", (e) => { if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "j") { e.preventDefault(); alternaInfo(); } });
aoEvento((ev) => { if (ev.tipo === "parado" || ev.tipo === "sessao") setTimeout(atualizaInfo, 400); });
// opening another conversation or folder refreshes it too
for (const id of ["nova", "pasta"]) $(id).addEventListener("click", () => setTimeout(atualizaInfo, 600));
lista.addEventListener("click", () => setTimeout(atualizaInfo, 800));
if (le("infoAberta", false)) alternaInfo(true);

// Background work of the running turn (shells, agents, monitors): a strip above
// the plan, filled by the "fundo" events and emptied when the turn ends.
const fundoEl = document.createElement("div");
fundoEl.className = "fundo"; fundoEl.setAttribute("aria-label", "Em segundo plano");
$("plano").before(fundoEl);
const tipoFundo = (tipo = "") => /bash|shell/.test(tipo) ? "Comando" : /agent/.test(tipo) ? "Agente" : /monitor/.test(tipo) ? "Monitor" : /workflow/.test(tipo) ? "Fluxo" : "Tarefa";
function desenhaFundo(tarefas = []) {
  fundoEl.innerHTML = tarefas.length ? `<div class="fundo-cab"><b>Em segundo plano</b><em>${tarefas.length}</em></div>` + tarefas.map((x) => `<div class="fundo-item"><i></i><b>${esc(tipoFundo(x.tipo))}</b><span title="${esc(x.descricao || "")}">${esc(x.descricao || "")}</span></div>`).join("") : "";
  fundoEl.classList.toggle("on", tarefas.length > 0);
}
const limpaFundo = () => desenhaFundo([]);
aoEvento((ev) => { if (ev.tipo === "fundo") desenhaFundo(ev.tarefas); else if (ev.tipo === "inicio" || ev.tipo === "parado") limpaFundo(); });
