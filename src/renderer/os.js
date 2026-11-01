// "Claudie OS": small glass windows that float over the wallpaper (the
// review of every change in the conversation, the plan, the music player),
// a radial menu on right-click, a terminal mode in the composer, and undo
// reachable from the activity rail.

// ---- floating windows -------------------------------------------------------------------
// Dragged by the title bar, closed with ×; where each one was left is kept.
const janelinhas = new Map();
// Pinned windows stay where they were left, can't be dragged or closed by
// accident and open again by themselves the next time the app starts.
const ABRE_JANELINHA = {};
const lerJ = (k, padrao) => { try { return JSON.parse(localStorage.getItem(k)) ?? padrao; } catch { return padrao; } };
const fixasJ = new Set(lerJ("jl:fixas", []));
const guardaFixas = () => { try { localStorage.setItem("jl:fixas", JSON.stringify([...fixasJ])); } catch {} };
const ALFINETE = '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6"/></svg>';
function janelinha(id, titulo, { largura = 420, altura = null, aoFechar } = {}) {
  if (janelinhas.has(id)) { const j = janelinhas.get(id); j.el.classList.add("on"); traz(j.el); return j; }
  const el = document.createElement("section"), main = document.querySelector("main");
  const tam = lerJ("jl:tam:" + id, null);
  el.className = "janelinha on"; el.dataset.id = id;
  el.style.width = (tam?.w ?? largura) + "px"; if (tam?.h || altura) el.style.height = (tam?.h ?? altura) + "px";
  el.innerHTML = `<header><b>${esc(titulo)}</b><button class="icone fixar" title="Fixar aqui">${ALFINETE}</button><button class="icone fechar" title="Fechar">${ICONE.erro}</button></header><div class="jl-corpo"></div>`;
  main.append(el);
  const pos = lerJ("jl:" + id, null), r = main.getBoundingClientRect();
  const x = pos?.x ?? Math.max(20, r.width - largura - 28 - janelinhas.size * 48), y = pos?.y ?? 64 + janelinhas.size * 40;
  el.style.left = x + "px"; el.style.top = y + "px"; cabeNaTela(el);
  const j = { el, corpo: el.querySelector(".jl-corpo") };
  janelinhas.set(id, j);
  const guardaPos = () => { try { localStorage.setItem("jl:" + id, JSON.stringify({ x: el.offsetLeft, y: el.offsetTop })); } catch {} };
  const fixa = (sim) => {
    el.classList.toggle("fixa", sim); sim ? fixasJ.add(id) : fixasJ.delete(id); guardaFixas();
    const b = el.querySelector(".fixar"); b.title = sim ? "Soltar" : "Fixar aqui"; b.setAttribute("aria-pressed", sim);
    if (sim) guardaPos();
  };
  fixa(fixasJ.has(id));
  el.querySelector(".fixar").onclick = () => fixa(!el.classList.contains("fixa"));
  const fecha = () => { fixa(false); el.classList.remove("on"); aoFechar?.(); setTimeout(() => { if (!el.classList.contains("on")) { el.remove(); janelinhas.delete(id); } }, 220); };
  el.querySelector("header .fechar").onclick = fecha;
  j.fecha = fecha;
  el.addEventListener("pointerdown", () => traz(el));
  const cab = el.querySelector("header");
  cab.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button") || el.classList.contains("fixa")) return;
    const x0 = e.clientX - el.offsetLeft, y0 = e.clientY - el.offsetTop, rr = main.getBoundingClientRect();
    cab.setPointerCapture(e.pointerId); el.classList.add("movendo");
    const move = (m) => { el.style.left = Math.max(-el.offsetWidth + 80, Math.min(rr.width - 60, m.clientX - x0)) + "px"; el.style.top = Math.max(0, Math.min(rr.height - 40, m.clientY - y0)) + "px"; };
    const solta = () => { cab.removeEventListener("pointermove", move); el.classList.remove("movendo"); guardaPos(); };
    cab.addEventListener("pointermove", move); cab.addEventListener("pointerup", solta, { once: true });
  });
  // the size it was left at (the corner handle is CSS resize)
  let timerTam = 0;
  new ResizeObserver(() => { clearTimeout(timerTam); timerTam = setTimeout(() => { if (el.isConnected && el.classList.contains("on")) try { localStorage.setItem("jl:tam:" + id, JSON.stringify({ w: el.offsetWidth, h: el.style.height ? el.offsetHeight : null })); } catch {} }, 300); }).observe(el);
  traz(el);
  return j;
}
// a window saved in a bigger window (or a monitor that is gone) comes back into view
function cabeNaTela(el) {
  const r = document.querySelector("main").getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(el.offsetLeft, r.width - el.offsetWidth - 8)) + "px";
  el.style.top = Math.max(8, Math.min(el.offsetTop, r.height - Math.min(el.offsetHeight, r.height - 16) - 8)) + "px";
}
addEventListener("resize", () => janelinhas.forEach((j) => cabeNaTela(j.el)));
// after every window type has registered how to open itself, the pinned ones come back
setTimeout(() => fixasJ.forEach((id) => ABRE_JANELINHA[id]?.()), 1500);
let zTopo = 20;
const traz = (el) => (el.style.zIndex = ++zTopo);

// ---- every change in the conversation ---------------------------------------------------
// Files Claude edited or created, with their diffs, grouped by file; each
// change can be undone from the message that started it.
function alteracoes() {
  const porArquivo = new Map();
  for (const c of col.querySelectorAll(".ferr")) {
    if (!/^(Edit|MultiEdit|Write)$/.test(c._nome || "") || c.querySelector(".estado.erro")) continue;
    const f = c._entrada?.file_path || c._entrada?.notebook_path; if (!f || !diffDe(c._nome, c._entrada)) continue;
    let dono = (c.closest(".ferr-grupo") || c).previousElementSibling; while (dono && !dono.classList.contains("eu")) dono = dono.previousElementSibling;
    (porArquivo.get(f) || porArquivo.set(f, []).get(f)).push({ card: c, dono });
  }
  return porArquivo;
}
ABRE_JANELINHA.alteracoes = () => abreAlteracoes();
// Real working-tree diff against HEAD when the folder is a git repository;
// the per-conversation list (what Claude touched) is the other tab, and the
// only view without git.
let altModo = "git", altGit = null, altSeq = 0;
const altAbertos = new Map(); // file -> is its diff expanded
const altNome = (f) => f.split(/[\\/]/).pop();
const altPasta = (f) => f.split(/[\\/]/).slice(-3, -1).join("/");
// unified diff text from git -> the same rows the other diffs use, plus line numbers
function diffGitHtml(texto, caminho = "") {
  let velho = 0, novo = 0, n = 0, html = "";
  for (const l of texto.split("\n")) {
    if (!l) continue;
    if (++n > 600) { html += '<div class="l corte"><i>⋯</i><code>(diff longo, cortado)</code></div>'; break; }
    const h = l.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/);
    if (h) { velho = +h[1]; novo = +h[2]; html += `<div class="l hunk"><u></u><u></u><i>⋯</i><code>${esc(l)}</code></div>`; continue; }
    if (l[0] === "\\") continue;
    const s = l[0] === "+" ? "mais" : l[0] === "-" ? "menos" : "";
    const lado = s === "menos" ? "E" : "D", linha = lado === "E" ? velho : novo;
    html += `<div class="l ${s}" data-arq="${esc(caminho)}" data-linha="${linha}" data-lado="${lado}" data-chave="${esc(caminho)}|${lado}|${linha}">${BOTAO_COMENTAR}<u>${s === "mais" ? "" : velho}</u><u>${s === "menos" ? "" : novo}</u><i>${s === "mais" ? "+" : s === "menos" ? "−" : ""}</i><code>${esc(l.slice(1)) || " "}</code></div>`;
    if (s !== "mais") velho++;
    if (s !== "menos") novo++;
  }
  return `<div class="diff">${html}</div>`;
}
function abreAlteracoes() {
  const j = janelinha("alteracoes", "Alterações da conversa", { largura: 760, altura: 520 });
  j.corpo.classList.add("alt");
  j.corpo.innerHTML = '<div class="alt-topo"><div class="alt-abas"></div><button class="btn" data-revisa title="Pedir ao Claude para revisar as mudanças atuais">Revisar mudanças</button><button class="btn" data-atual title="Reler o git agora">Atualizar</button></div><div class="alt-conteudo"></div>';
  const abas = j.corpo.querySelector(".alt-abas"), cont = j.corpo.querySelector(".alt-conteudo");
  const modo = () => (altGit?.git ? altModo : "conv");
  const desenhaConv = () => {
    const mapa = alteracoes();
    if (!mapa.size) { cont.innerHTML = '<p class="jl-vazio">Nenhum arquivo foi mudado nesta conversa ainda.</p>'; return; }
    let mais = 0, menos = 0;
    cont.innerHTML = [...mapa].map(([f, lista], k) => {
      const blocos = lista.map(({ card }) => diffDe(card._nome, card._entrada, card.dataset.id));
      blocos.forEach((b) => { const m = b.contagem.match(/\+(\d+).*?−(\d+)/); if (m) { mais += +m[1]; menos += +m[2]; } });
      return `<details class="arq-alt"${mapa.size < 4 ? " open" : ""}><summary>${ICONE.editar}<b title="${esc(f)}">${esc(altNome(f))}</b><small>${esc(altPasta(f))}</small><span class="n">${lista.length}×</span></summary>`
        + lista.map(({ dono }, n) => `<div class="mud">${blocos[n].html}<div class="mud-b"><button class="btn" data-ir="${k}:${n}">Ver na conversa</button>${dono?.dataset.uuid ? `<button class="btn" data-desfaz="${k}:${n}">Desfazer a partir daqui</button>` : ""}</div></div>`).join("") + "</details>";
    }).join("");
    cont.insertAdjacentHTML("afterbegin", `<div class="jl-resumo"><b>${mapa.size} arquivo${mapa.size > 1 ? "s" : ""}</b><em class="contagem"><b>+${mais}</b><s>−${menos}</s></em></div>`);
    const lista = [...mapa.values()];
    reaplicaRascunhos(cont);
    cont.querySelectorAll("[data-ir]").forEach((b) => (b.onclick = () => { const [k, n] = b.dataset.ir.split(":").map(Number), c = lista[k][n].card; c.closest(".ferr-grupo")?.classList.add("aberto"); c.scrollIntoView({ behavior: "smooth", block: "center" }); c.classList.remove("piscando"); void c.offsetWidth; c.classList.add("piscando"); }));
    cont.querySelectorAll("[data-desfaz]").forEach((b) => (b.onclick = () => { const [k, n] = b.dataset.desfaz.split(":").map(Number), d = lista[k][n].dono; d.scrollIntoView({ behavior: "smooth", block: "center" }); desfazDaqui(d); }));
  };
  const desenhaGit = () => {
    const a = altGit.arquivos;
    if (!a.length) { cont.innerHTML = '<p class="jl-vazio">Nenhuma mudança em relação ao último commit.</p>'; return; }
    const mais = a.reduce((s, f) => s + f.mais, 0), menos = a.reduce((s, f) => s + f.menos, 0);
    const estado = (f) => (f.novo ? "U" : f.estado);
    cont.innerHTML = `<div class="jl-resumo"><b>${a.length} arquivo${a.length > 1 ? "s" : ""}</b><em class="contagem"><b>+${mais}</b><s>−${menos}</s></em></div>`
      + (altGit.truncado ? '<p class="jl-vazio">Há mudanças demais: só uma parte aparece.</p>' : "")
      + `<div class="alt-git"><nav class="alt-lista">${a.map((f, k) => `<button data-k="${k}" title="${esc(f.caminho)}"><span class="est est-${estado(f)}">${estado(f)}</span><b>${esc(altNome(f.caminho))}</b><em class="contagem"><b>+${f.mais}</b><s>−${f.menos}</s></em></button>`).join("")}</nav>`
      + `<div class="alt-diffs">${a.map((f, k) => {
        const aberto = altAbertos.has(f.caminho) ? altAbertos.get(f.caminho) : a.length < 4;
        const aviso = f.binario ? "Arquivo binário: o diff não é mostrado." : f.grande ? "Arquivo grande demais: o diff está cortado." : "";
        return `<details class="arq-alt" data-k="${k}"${aberto ? " open" : ""}><summary><span class="est est-${estado(f)}">${estado(f)}</span><b title="${esc(f.caminho)}">${esc(altNome(f.caminho))}</b><small>${esc(altPasta(f.caminho))}</small><em class="contagem"><b>+${f.mais}</b><s>−${f.menos}</s></em></summary>`
          + `<div class="mud">${f.diff ? diffGitHtml(f.diff, f.caminho) : ""}${aviso ? `<p class="jl-vazio alt-nota">${aviso}</p>` : ""}<div class="mud-b"><button class="btn" data-abre="${k}">Abrir arquivo</button><button class="btn" data-reverte="${k}">${f.novo ? "Apagar arquivo novo" : f.estado === "D" ? "Restaurar arquivo" : "Reverter mudanças"}</button></div></div></details>`;
      }).join("")}</div></div>`;
    reaplicaRascunhos(cont);
    cont.querySelectorAll("details").forEach((d) => d.addEventListener("toggle", () => altAbertos.set(a[+d.dataset.k].caminho, d.open)));
    cont.querySelectorAll(".alt-lista button").forEach((b) => (b.onclick = () => { const d = cont.querySelector(`details[data-k="${b.dataset.k}"]`); d.open = true; d.scrollIntoView({ behavior: "smooth", block: "start" }); }));
    cont.querySelectorAll("[data-abre]").forEach((b) => (b.onclick = async () => { if (!(await vivo.abrirArquivo(a[+b.dataset.abre].abs))) nota("Não deu pra abrir: o arquivo está fora das pastas desta conversa.", true); }));
    // reverting needs a second click: the first one only arms the button
    cont.querySelectorAll("[data-reverte]").forEach((b) => (b.onclick = async () => {
      const f = a[+b.dataset.reverte];
      if (!b.dataset.arma) {
        b.dataset.arma = b.textContent; b.textContent = f.novo ? "Confirmar: apagar?" : "Confirmar: reverter?"; b.classList.add("perigo");
        setTimeout(() => { if (b.isConnected && b.dataset.arma) { b.textContent = b.dataset.arma; delete b.dataset.arma; b.classList.remove("perigo"); } }, 4000);
        return;
      }
      b.disabled = true;
      const r = await vivo.gitReverter(f.caminho);
      if (!r?.ok) nota(`Não deu: ${r?.erro || ""}`);
      busca();
    }));
  };
  // a comment box open in the list keeps the page as it is; it is drawn again when the box closes
  let pendente = false;
  const desenha = () => {
    if (cont.querySelector(".cm-caixa")) { pendente = true; return; }
    pendente = false;
    const m = modo(), sc = cont.scrollTop;
    abas.innerHTML = altGit?.git ? `<button class="btn${m === "git" ? " forte" : ""}" data-m="git">Todas as mudanças</button><button class="btn${m === "conv" ? " forte" : ""}" data-m="conv">Desta conversa</button>` : "";
    abas.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => { altModo = b.dataset.m; desenha(); }));
    j.corpo.querySelector("[data-atual]").hidden = m !== "git";
    j.corpo.querySelector("[data-revisa]").hidden = m !== "git";
    m === "git" ? desenhaGit() : desenhaConv();
    cont.scrollTop = sc;
  };
  const busca = async () => {
    const n = ++altSeq, r = await vivo.gitAlteracoes().catch(() => null);
    if (n !== altSeq || !j.el.isConnected) return;
    altGit = r; desenha();
  };
  j.corpo.querySelector("[data-atual]").onclick = busca;
  j.corpo.querySelector("[data-revisa]").onclick = revisaMudancas;
  if (j.aoFecharCaixa) removeEventListener("comentario-fechado", j.aoFecharCaixa);
  j.aoFecharCaixa = () => { if (!j.el.isConnected) return removeEventListener("comentario-fechado", j.aoFecharCaixa); if (pendente) desenha(); };
  addEventListener("comentario-fechado", j.aoFecharCaixa);
  // the per-conversation tab follows the chat; the git one is re-read when asked or when a turn ends
  j.redesenha = () => { if (modo() === "conv") desenha(); };
  j.busca = busca;
  desenha(); busca();
}
// Asks Claude to review the working tree and report the findings as a card.
function revisaMudancas() {
  return envia("Revise as mudanças atuais do repositório: rode git status --short e git diff HEAD e leia também os arquivos não rastreados (a janela de mudanças os mostra). Depois chame a ferramenta mcp__claudie__report_findings uma vez com cada achado (file, line, severity, summary, suggestion); não liste os achados em texto.");
}
aoEvento((ev) => { if (ev.tipo === "parado" || ev.tipo === "sessao") janelinhas.get("alteracoes")?.busca?.(); });
const botaoAlt = document.createElement("button");
botaoAlt.className = "icone alt-btn"; botaoAlt.title = "Alterações da conversa"; botaoAlt.innerHTML = `${svg('<path d="M8 4v12M4 8h8M14 17h6"/><rect x="3" y="3" width="18" height="18" rx="3"/>')}<i class="badge"></i>`;
$("atalhosBtn").before(botaoAlt);
botaoAlt.onclick = abreAlteracoes;
function contaAlteracoes() {
  const n = alteracoes().size;
  botaoAlt.querySelector(".badge").textContent = n || ""; botaoAlt.classList.toggle("tem", n > 0);
  janelinhas.get("alteracoes")?.redesenha?.();
}
// subtree: tool cards added inside an existing .ferr-grupo also count; text deltas are ignored
new MutationObserver((ms) => { if (!ms.some((m) => (m.target === col && m.removedNodes.length) || [...m.addedNodes].some((n) => n.nodeType === 1 && (n.matches?.(".ferr, .ferr-grupo") || n.querySelector?.(".ferr"))))) return; clearTimeout(contaAlteracoes.t); contaAlteracoes.t = setTimeout(contaAlteracoes, 200); }).observe(col, { childList: true, subtree: true });

// ---- the plan in a window of its own ----------------------------------------------------
const plano = $("plano"), lugarDoPlano = plano.parentElement, depoisDoPlano = plano.nextElementSibling;
function destacaPlano() {
  const j = janelinha("plano", "Plano do Claude", { largura: 320, aoFechar: () => { lugarDoPlano.insertBefore(plano, depoisDoPlano); plano.classList.remove("solto"); } });
  plano.classList.add("solto"); j.corpo.append(plano);
}
new MutationObserver(() => {
  const topo = plano.querySelector(".plano-topo");
  if (topo && !topo.querySelector(".solta")) {
    const b = document.createElement("span"); b.className = "solta"; b.title = plano.classList.contains("solto") ? "" : "Abrir numa janela";
    b.innerHTML = svg('<path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>');
    b.onclick = (e) => { e.stopPropagation(); if (!plano.classList.contains("solto")) destacaPlano(); };
    topo.append(b);
  }
}).observe(plano, { childList: true });

// ---- music player ------------------------------------------------------------------------
ABRE_JANELINHA.player = () => abrePlayer();
function abrePlayer() {
  const j = janelinha("player", "Música", { largura: 300 });
  const desenha = () => {
    const fx = musica.faixas, tocando = VIS.musica?.ligada && !musica.audio.paused;
    if (!fx.length) { j.corpo.innerHTML = '<p class="jl-vazio">Nenhuma música ainda.</p><div class="mud-b"><button class="btn forte" data-a="add">Adicionar músicas…</button></div>'; j.corpo.querySelector("[data-a=add]").onclick = () => abrePersonal("musica"); return; }
    const atualF = fx[musica.indice];
    j.corpo.innerHTML = `<div class="player"><div class="disco${tocando ? " gira" : ""}">${mosaicoMini()}</div><div class="faixa"><b>${esc(atualF?.nome || "")}</b><small>${musica.indice + 1} de ${fx.length}</small></div></div>
      <div class="controles"><button class="icone" data-a="ant" title="Anterior">${svg('<path d="M18 6v12l-9-6zM6.5 6v12"/>')}</button><button class="icone grande" data-a="toca" title="Tocar ou pausar">${tocando ? svg('<path d="M9 6v12M15 6v12"/>') : svg('<path d="M8 5.5v13l10-6.5z"/>')}</button><button class="icone" data-a="prox" title="Próxima">${svg('<path d="M6 6v12l9-6zM17.5 6v12"/>')}</button></div>
      <input class="vol" type="range" min="0" max="1" step="0.05" value="${pega("musica.volume")}" aria-label="Volume" />
      <ol class="faixas">${fx.map((f, k) => `<li class="${k === musica.indice ? "on" : ""}" data-k="${k}">${esc(f.nome)}</li>`).join("")}</ol>`;
    j.corpo.querySelector('[data-a="ant"]').onclick = () => { if (!VIS.musica?.ligada) musica.liga(true); musica.anterior(); };
    j.corpo.querySelector('[data-a="prox"]').onclick = () => { if (!VIS.musica?.ligada) musica.liga(true); else musica.proxima(); };
    j.corpo.querySelector('[data-a="toca"]').onclick = () => musica.liga(!tocando);
    j.corpo.querySelector(".vol").oninput = (e) => { poe("musica.volume", +e.target.value); musica.audio.volume = +e.target.value; salva(); };
    j.corpo.querySelectorAll(".faixas li").forEach((li) => (li.onclick = () => { poe("musica.ligada", true); salva(); musica.tocaFaixa(+li.dataset.k); }));
  };
  desenha(); desenhaPlayer = desenha;
}
let desenhaPlayer = null;
addEventListener("musica", () => janelinhas.has("player") && desenhaPlayer?.());
{
  const b = document.createElement("button");
  b.className = "som-player"; b.textContent = "Abrir o player";
  b.onclick = () => { $("somPop").classList.remove("on"); abrePlayer(); };
  $("somPop").append(b);
}

// ---- radial menu -----------------------------------------------------------------------------
// Right-click on the wallpaper (not on text or controls) opens a ring of actions.
const radial = document.createElement("div");
radial.className = "radial"; document.body.append(radial);
const ACOES_RADIAL = [
  ["Nova conversa", svg('<path d="M12 5v14M5 12h14"/>'), () => novaConversa()],
  ["Temas", ICONE.tema, () => abrePicker()],
  ["Personalizar", svg('<path d="M4.5 19.5c1.5 0 3.5-.5 4.2-2.2.7-1.7-.2-3.3-1.7-3.3s-2.5 1.6-2.5 3c0 1-.5 2-1 2.5zM9.5 13l9-9.5a1.6 1.6 0 0 1 2.3 2.3L11.5 15"/>'), () => abrePersonal()],
  ["Navegador", svg('<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M3 9.5h18M6.5 7h.01M9.5 7h.01"/>'), () => alternaNavegador()],
  ["Alterações", svg('<path d="M8 4v12M4 8h8M14 17h6"/><rect x="3" y="3" width="18" height="18" rx="3"/>'), () => abreAlteracoes()],
  ["Música", svg('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'), () => abrePlayer()],
  ["Nova janela", ICONE.janela, () => vivo.janelaNova()],
  ["Atalhos", svg('<rect x="3" y="6.5" width="18" height="11" rx="2.5"/><path d="M7 10.5h.01M10.5 10.5h.01M14 10.5h.01M17 10.5h.01M8 14h8"/>'), () => abreAtalhos()],
  ["Esforço", svg('<path d="M4.5 16a7.5 7.5 0 1 1 15 0"/><path d="m12 16 3.5-4.5"/>'), () => document.querySelectorAll(".escolha .chip")[2]?.click()],
];
function abreRadial(x, y) {
  const R = 86;
  radial.innerHTML = `<div class="radial-centro">${mosaicoMini()}</div>` + ACOES_RADIAL.map(([n, ic], k) => {
    const a = (k / ACOES_RADIAL.length) * Math.PI * 2 - Math.PI / 2;
    return `<button style="--x:${Math.cos(a) * R}px;--y:${Math.sin(a) * R}px;--d:${k * 18}ms" data-k="${k}" title="${n}">${ic}<span>${n}</span></button>`;
  }).join("");
  radial.style.left = Math.max(110, Math.min(innerWidth - 110, x)) + "px"; radial.style.top = Math.max(110, Math.min(innerHeight - 110, y)) + "px";
  radial.querySelectorAll("button").forEach((b) => (b.onclick = () => { fechaRadial(); ACOES_RADIAL[+b.dataset.k][2](); }));
  radial.classList.add("on");
}
const fechaRadial = () => radial.classList.remove("on");
addEventListener("contextmenu", (e) => {
  if (e.target.closest("input, textarea, a, pre, code, .msg, .ferr, .perm, .pergunta, .menu, .janelinha, .personal, .creditos, .side, .dock, .top")) return;
  e.preventDefault(); abreRadial(e.clientX, e.clientY);
});
addEventListener("pointerdown", (e) => { if (!e.target.closest(".radial")) fechaRadial(); });
addEventListener("keydown", (e) => { if (e.key === "Escape") { fechaRadial(); for (const j of janelinhas.values()) if (!j.el.classList.contains("fixa") && j.el.matches(":focus-within")) j.fecha(); } });

// ---- terminal mode ------------------------------------------------------------------------------
// "!comando" asks Claude to run that command and show the output.
entrada.addEventListener("input", () => $("composer").classList.toggle("modo-terminal", entrada.value.startsWith("!")));
entrada.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.shiftKey || !entrada.value.startsWith("!") || (geral().enviar === "ctrl" && !e.ctrlKey)) return;
  const cmd = entrada.value.slice(1).trim(); if (!cmd) return;
  e.preventDefault(); e.stopImmediatePropagation();
  entrada.value = ""; ajustaAltura(); atualizaEnviar(); $("composer").classList.remove("modo-terminal");
  envia(`Rode no terminal e mostre a saída:\n\`\`\`\n${cmd}\n\`\`\``);
}, true);

// ---- rewind from the activity rail -----------------------------------------------------------
// Right-click on a tile: undo the file changes from the message that led to it.
trilho.addEventListener("contextmenu", (e) => {
  const t = e.target.closest(".tile"); if (!t) return;
  e.preventDefault(); e.stopPropagation();
  const cards = [...col.querySelectorAll(".ferr")].slice(-60), c = cards[[...trilho.children].indexOf(t)];
  let dono = c && (c.closest(".ferr-grupo") || c).previousElementSibling; while (dono && !dono.classList.contains("eu")) dono = dono.previousElementSibling;
  const r = t.getBoundingClientRect();
  menu.innerHTML = `<button data-a="ir">${svg('<path d="M12 5v14m-5-5 5 5 5-5"/>')}Ir até aqui</button>${dono?.dataset.uuid ? `<button data-a="volta">${svg('<path d="M9 7.5 4.5 12 9 16.5"/><path d="M5 12h9.5a5 5 0 0 1 0 10H12"/>')}Voltar os arquivos para antes daqui</button>` : ""}`;
  menu.style.left = Math.min(r.left, innerWidth - 280) + "px"; menu.style.top = r.bottom + 6 + "px"; menu.classList.add("on");
  menu.querySelector('[data-a="ir"]').onclick = () => { fechaMenu(); t.click(); };
  menu.querySelector('[data-a="volta"]')?.addEventListener("click", () => { fechaMenu(); dono.scrollIntoView({ behavior: "smooth", block: "center" }); desfazDaqui(dono); });
});
