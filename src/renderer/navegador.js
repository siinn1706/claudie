// The browser pane: a column to the right of the chat holding a real page (a
// native view the main process owns, see src/navegador.js). This file is its
// toolbar and the glue: it tells the main process which rectangle the page
// fills, hides the page while a menu or window overlaps it (a native view
// paints above all DOM), forwards keys pressed inside the page, and lists the
// dev servers of .claude/launch.json.

const navEl = document.createElement("aside");
navEl.className = "navegador"; navEl.id = "navegador"; navEl.setAttribute("aria-label", "Navegador");
navEl.innerHTML = `<div class="nav-barra">
  <button class="icone" data-a="voltar" title="Página anterior" disabled>${svg('<path d="M15 6l-6 6 6 6"/>')}</button>
  <button class="icone" data-a="avancar" title="Página seguinte" disabled>${svg('<path d="M9 6l6 6-6 6"/>')}</button>
  <button class="icone" data-a="recarregar" title="Recarregar">${svg('<path d="M19.5 12a7.5 7.5 0 0 1-13.1 5"/><path d="M4.5 12a7.5 7.5 0 0 1 13.1-5"/><path d="M17.6 3.5v3.6H14M6.4 20.5v-3.6H10"/>')}</button>
  <input class="nav-url" id="navUrl" placeholder="Digite um endereço" spellcheck="false" autocomplete="off" aria-label="Endereço">
  <button class="icone" data-a="servidores" title="Servidores de desenvolvimento">${svg('<rect x="4" y="4.5" width="16" height="6" rx="2"/><rect x="4" y="13.5" width="16" height="6" rx="2"/><path d="M8 7.5h.01M8 16.5h.01"/>')}</button>
  <button class="icone" data-a="fecha" title="Fechar navegador (Ctrl+Shift+B)">${ICONE.erro}</button>
</div>
<div class="nav-servs" id="navServs" role="menu" aria-label="Servidores de desenvolvimento"></div>
<div class="nav-tela" id="navTela"><p class="nav-vazio">Digite um endereço acima ou peça ao Claude para abrir uma página.</p></div>`;
$("app").append(navEl);
const navUrl = $("navUrl"), navTela = $("navTela"), navServs = $("navServs");
const navBtn = (a) => navEl.querySelector(`[data-a="${a}"]`);
const botaoNav = document.createElement("button");
botaoNav.className = "icone"; botaoNav.id = "navBtn"; botaoNav.title = "Navegador (Ctrl+Shift+B)";
botaoNav.innerHTML = svg('<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M3 9.5h18M6.5 7h.01M9.5 7h.01"/>');
$("infoBtn").before(botaoNav);

const navAberto = () => document.body.classList.contains("nav-aberto");
let navCarregando = false, navColapsou = false;

// ---- opening and closing ---------------------------------------------------------------------
// A narrow window gives the page the room by folding the sidebar, and gives it back on close.
function alternaNavegador(v = !navAberto()) {
  if (v === navAberto()) return;
  document.body.classList.toggle("nav-aberto", v); botaoNav.classList.toggle("on", v);
  if (v) {
    if (innerWidth < 1280 && !document.body.classList.contains("recolhido")) { document.body.classList.add("recolhido"); navColapsou = true; }
    vivo.navEstado().then(mostraEstadoNav);
  } else {
    if (navColapsou) { document.body.classList.remove("recolhido"); navColapsou = false; }
    fechaServsNav();
  }
  agendaAreaNav();
}
window.alternaNavegador = alternaNavegador;
botaoNav.onclick = () => alternaNavegador();

// ---- the rectangle the page fills ------------------------------------------------------------
// Sent only when it changes; null hides the page (pane closed, or something is over it).
const SOBREPOE = ".menu.on, .escolha-pop.on, .som-pop.on, .picker.open, .comandos.on, .mencoes.on, .radial.on, .creditos.on, .personal.on, .lightbox.on, .prep-fundo, .janelinha.on, .nav-servs.on";
function coberto(r) {
  for (const el of document.querySelectorAll(SOBREPOE)) {
    const b = el.getBoundingClientRect(), m = el.classList.contains("radial") ? 110 : 0; // the ring around the click point
    if (!m && (!b.width || !b.height)) continue;
    if (b.left - m < r.right && b.right + m > r.left && b.top - m < r.bottom && b.bottom + m > r.top) return true;
  }
  return false;
}
let quadroNav = 0, areaNav = "";
function enviaAreaNav() {
  let rect = null;
  if (navAberto()) {
    const r = navTela.getBoundingClientRect();
    if (r.width > 1 && r.height > 1 && !coberto(r)) rect = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  }
  const chave = JSON.stringify(rect);
  if (chave === areaNav) return;
  areaNav = chave; vivo.navArea(rect);
}
function agendaAreaNav() { if (!quadroNav) quadroNav = requestAnimationFrame(() => { quadroNav = 0; enviaAreaNav(); }); }
new ResizeObserver(agendaAreaNav).observe(navTela);
addEventListener("resize", agendaAreaNav);
// Only a change to an overlay (or to something that holds one) can move the page's rectangle.
const tocaSobreposto = (n) => n.nodeType === 1 && (n.matches(SOBREPOE) || !!n.querySelector(SOBREPOE));
new MutationObserver((rs) => {
  if (!navAberto()) return;
  if (rs.some((m) => m.type === "attributes" ? m.target.matches(SOBREPOE) || m.target.classList.contains("nav-aberto") || m.target === document.body : [...m.addedNodes, ...m.removedNodes].some(tocaSobreposto))) agendaAreaNav();
}).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "hidden"] });

// ---- toolbar ---------------------------------------------------------------------------------
const ICONE_PARAR = svg('<path d="M6 6l12 12M18 6L6 18"/>'), ICONE_RECARREGAR = navBtn("recarregar").innerHTML;
function mostraEstadoNav(e) {
  navBtn("voltar").disabled = !e?.voltar; navBtn("avancar").disabled = !e?.avancar;
  const carrega = !!e?.carregando;
  if (carrega !== navCarregando) { navCarregando = carrega; navBtn("recarregar").innerHTML = carrega ? ICONE_PARAR : ICONE_RECARREGAR; navBtn("recarregar").title = carrega ? "Parar" : "Recarregar"; }
  if (document.activeElement !== navUrl) navUrl.value = e?.url || "";
  navUrl.title = e?.titulo || "";
  navTela.classList.toggle("com-pagina", !!e?.url);
}
async function abreNaBarra() {
  const valor = navUrl.value.trim();
  if (!valor) return;
  const erro = await vivo.navAbrir(valor);
  if (erro) nota(erro, true); else navUrl.blur();
}
navUrl.addEventListener("keydown", (e) => { if (e.key === "Enter") abreNaBarra(); if (e.key === "Escape") { navUrl.blur(); e.stopPropagation(); } });
navUrl.addEventListener("focus", () => navUrl.select());
navEl.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-a]");
  if (!b || b.disabled) return;
  const a = b.dataset.a;
  if (a === "fecha") alternaNavegador(false);
  else if (a === "servidores") navServs.classList.contains("on") ? fechaServsNav() : abreServsNav();
  else if (a === "recarregar") vivo.navAcao(navCarregando ? "parar" : "recarregar");
  else vivo.navAcao(a);
});

// ---- dev servers (.claude/launch.json) -------------------------------------------------------
const servEstado = new Map(); // name -> "iniciando" | "rodando"
async function desenhaServsNav() {
  const lista = await vivo.navServidores();
  if (!lista.length) { navServs.innerHTML = `<p class="nav-serv-vazio">Nenhum servidor em .claude/launch.json</p>`; return agendaAreaNav(); }
  navServs.innerHTML = lista.map((s) => {
    const est = s.rodando ? (servEstado.get(s.nome) || "rodando") : "";
    return `<div class="nav-serv" role="menuitem"><i class="nav-ponto ${est}"></i><span title="${esc(s.comando || "")}"><b>${esc(s.nome)}</b><small>${esc(s.url || "")}</small>${s.comando ? `<small class="nav-serv-cmd">${esc(s.comando)}</small>` : ""}</span><button class="btn" data-n="${esc(s.nome)}" data-a="${s.rodando ? "parar" : "iniciar"}">${s.rodando ? "Parar" : "Iniciar"}</button></div>`;
  }).join("");
  navServs.querySelectorAll("button[data-n]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    const erro = await (b.dataset.a === "iniciar" ? vivo.navServidorIniciar(b.dataset.n) : vivo.navServidorParar(b.dataset.n));
    if (erro) nota(erro, true);
    desenhaServsNav();
  }));
}
async function abreServsNav() { navServs.classList.add("on"); await desenhaServsNav(); agendaAreaNav(); }
function fechaServsNav() { navServs.classList.remove("on"); agendaAreaNav(); }
addEventListener("pointerdown", (e) => { if (navServs.classList.contains("on") && !e.target.closest(".nav-servs, [data-a=servidores]")) fechaServsNav(); });
// Esc closes the list first, before it can interrupt the turn
addEventListener("keydown", (e) => { if (e.key === "Escape" && navServs.classList.contains("on")) { fechaServsNav(); e.stopImmediatePropagation(); } }, true);

// ---- events from the main process ------------------------------------------------------------
aoEvento((ev) => {
  switch (ev.tipo) {
    case "nav_estado": mostraEstadoNav(ev); break;
    case "nav_mostrar": alternaNavegador(true); areaNav = ""; agendaAreaNav(); break; // the view may have just been created: send the rectangle again
    case "nav_servidor":
      if (ev.estado === "parado") servEstado.delete(ev.nome); else servEstado.set(ev.nome, ev.estado);
      if (ev.erro) nota(ev.erro, true);
      if (navServs.classList.contains("on")) desenhaServsNav();
      break;
    // a key pressed inside the page: the window's own shortcuts (Esc, Ctrl+N/B, Ctrl+Shift+B/M/I/E/P) still work
    case "nav_tecla": document.dispatchEvent(new KeyboardEvent("keydown", { key: ev.key, code: ev.code, ctrlKey: ev.ctrl, shiftKey: ev.shift, altKey: ev.alt, repeat: ev.repeat, bubbles: true, cancelable: true })); break;
  }
});
