// Inline previews for mermaid, svg and html code blocks (Code/Preview toggle) and the
// Artifacts window: the html, svg and markdown files Claude wrote in this conversation.
// Previews are static: an iframe with an empty sandbox (no scripts, no same-origin).

const CSP_PREVIA = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";
const docPrevia = (corpo) => `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP_PREVIA}"><style>html,body{background:#fff;color:#111}body{margin:12px;font:14px system-ui,sans-serif}svg{max-width:100%;height:auto}</style>${corpo}`;
let promessaMermaid, seqMermaid = 0;
function carregaMermaid() { // lazy and memoized: the bundle loads with the first mermaid block
  return promessaMermaid ||= new Promise((ok, falha) => {
    const s = document.createElement("script"); s.src = "vendor/mermaid.min.js";
    s.onload = () => {
      if (typeof mermaid?.render !== "function") { promessaMermaid = null; return falha(new Error("mermaid")); }
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default" }); ok();
    };
    s.onerror = () => { promessaMermaid = null; falha(new Error("mermaid")); };
    document.head.append(s);
  });
}
// The full srcdoc for a fence; throws when it can't be drawn.
async function previaDe(lang, codigo) {
  if (lang === "mermaid") {
    await carregaMermaid();
    const id = "m" + ++seqMermaid;
    try { return docPrevia((await mermaid.render(id, codigo)).svg); } finally { document.getElementById("d" + id)?.remove(); }
  }
  return docPrevia(codigo);
}
function iframePrevia(doc) {
  const f = document.createElement("iframe");
  f.setAttribute("sandbox", ""); f.className = "codigo-previa"; f.srcdoc = doc;
  return f;
}

// Adds the Code/Preview toggle to a finished code box. mermaid and svg open on Preview.
function montaPrevia(caixa, lang, codigo) {
  const pre = caixa.querySelector("pre"), copiar = caixa.querySelector(".codigo-topo button");
  const b = document.createElement("button"); b.className = "codigo-vis"; b.textContent = "Visualizar";
  copiar.before(b);
  let verPrevia = false, ocupado = false;
  const aplica = () => {
    pre.hidden = verPrevia; if (caixa._frame) caixa._frame.hidden = !verPrevia;
    b.textContent = verPrevia ? "Código" : "Visualizar";
  };
  const alterna = async () => {
    if (ocupado) return;
    if (verPrevia) { verPrevia = false; aplica(); return; }
    ocupado = true;
    try {
      caixa._previa ||= previaDe(lang, codigo);
      const doc = await caixa._previa;
      if (!caixa._frame) { caixa._frame = iframePrevia(doc); pre.after(caixa._frame); }
      caixa.querySelector(".codigo-erro")?.remove();
      verPrevia = true; aplica(); desce();
    } catch {
      caixa._previa = null;
      if (!caixa.querySelector(".codigo-erro")) { const e = document.createElement("div"); e.className = "codigo-erro"; e.textContent = t("Não deu pra desenhar o diagrama."); caixa.append(e); }
    } finally { ocupado = false; }
  };
  b.onclick = alterna;
  if (lang !== "html" && lang !== "htm") alterna();
}

// ---- the files Claude wrote in this conversation ------------------------------------------
const EXT_ARTEFATO = /\.(html?|svg|md|markdown)$/i;
function artefatos() {
  const mapa = new Map();
  for (const c of col.querySelectorAll(".ferr")) {
    if (!/^(Write|Edit|MultiEdit)$/.test(c._nome || "") || !c.querySelector("summary .estado.ok")) continue;
    const f = c._entrada?.file_path;
    if (typeof f !== "string" || !EXT_ARTEFATO.test(f)) continue;
    const antes = mapa.get(f);
    mapa.set(f, { f, nome: f.split(/[\\/]/).pop(), ext: f.match(EXT_ARTEFATO)[1].toLowerCase(), card: c, escrita: c._nome === "Write" ? c : antes?.escrita });
  }
  return mapa;
}
const docDeArtefato = (ext, texto) => docPrevia(/^(md|markdown)$/.test(ext) ? md(texto) : texto);

let artSeq = 0, artSel = null; // artSel: { f, card } of the file shown
function abreArtefatos() {
  const j = janelinha("artefatos", "Artefatos da conversa", { largura: 620, altura: 460, aoFechar: () => { artSeq++; artSel = null; } });
  j.corpo.classList.add("art");
  j.corpo.innerHTML = '<div class="art-lista"></div><div class="art-previa"></div>';
  const lista = j.corpo.querySelector(".art-lista"), painel = j.corpo.querySelector(".art-previa");
  const mostraTexto = (a, texto, aviso) => {
    painel.innerHTML = `<div class="art-barra"><b title="${esc(a.f)}">${esc(a.nome)}</b><button class="btn" data-vis></button><button class="btn" data-abrir>Abrir arquivo</button></div>${aviso ? `<p class="art-nota">${esc(aviso)}</p>` : ""}<div class="art-vista"></div>`;
    const vista = painel.querySelector(".art-vista"), vis = painel.querySelector("[data-vis]");
    let previa = true;
    const desenha = () => {
      vis.textContent = previa ? "Código" : "Visualizar";
      if (previa) vista.replaceChildren(iframePrevia(docDeArtefato(a.ext, texto)));
      else { const p = document.createElement("pre"); p.className = "art-codigo"; p.textContent = texto; vista.replaceChildren(p); }
    };
    vis.onclick = () => { previa = !previa; desenha(); };
    painel.querySelector("[data-abrir]").onclick = () => vivo.abrirArquivo(a.f);
    desenha();
  };
  const mostraMsg = (txt) => { painel.innerHTML = `<p class="jl-vazio">${esc(txt)}</p>`; };
  const carrega = async (a) => {
    const seq = ++artSeq;
    painel.innerHTML = "";
    const r = await vivo.artefatoLer(a.f);
    if (seq !== artSeq) return;
    if (r?.texto != null) return mostraTexto(a, r.texto);
    const copia = r?.erro === "leitura" && a.escrita?._entrada?.content;
    if (typeof copia === "string") mostraTexto(a, copia, "Cópia do que o Claude escreveu, não lida do disco.");
    else mostraMsg("Não deu pra ler o arquivo.");
  };
  const desenhaLista = () => {
    const mapa = artefatos();
    lista.replaceChildren();
    if (!mapa.size) { artSeq++; artSel = null; lista.innerHTML = '<p class="jl-vazio">Nenhum artefato nesta conversa ainda.</p>'; painel.innerHTML = ""; return; }
    for (const a of mapa.values()) {
      const b = document.createElement("button");
      b.className = "art-item"; b.title = a.f; b.classList.toggle("sel", artSel?.f === a.f);
      b.innerHTML = `<span>${esc(a.nome)}</span><em>${esc(a.ext)}</em>`;
      b.onclick = () => { artSel = { f: a.f, card: a.card }; desenhaLista(); carrega(a); };
      lista.append(b);
    }
    // the file shown stays selected; it is read again only when a newer call touched it
    const atual = artSel && mapa.get(artSel.f);
    if (artSel && !atual) { artSeq++; artSel = null; painel.innerHTML = ""; }
    else if (atual && atual.card !== artSel.card) { artSel.card = atual.card; carrega(atual); }
  };
  j.redesenha = desenhaLista;
  desenhaLista();
  if (artSel && artefatos().get(artSel.f)) carrega(artefatos().get(artSel.f));
}
ABRE_JANELINHA.artefatos = () => abreArtefatos();

const botaoArt = document.createElement("button");
botaoArt.className = "icone art-btn"; botaoArt.title = "Artefatos da conversa";
botaoArt.innerHTML = `${svg('<path d="M12 3l2.4 5.6L20 11l-5.6 2.4L12 19l-2.4-5.6L4 11l5.6-2.4z"/>')}<i class="badge"></i>`;
$("atalhosBtn").before(botaoArt);
botaoArt.onclick = abreArtefatos;
function contaArtefatos() {
  const n = artefatos().size;
  botaoArt.querySelector(".badge").textContent = n || ""; botaoArt.classList.toggle("tem", n > 0);
  janelinhas.get("artefatos")?.redesenha?.();
}
const agendaArtefatos = () => { clearTimeout(contaArtefatos.t); contaArtefatos.t = setTimeout(contaArtefatos, 200); };
// new or removed tool cards, and a card turning ok or failed (its .estado class changes)
new MutationObserver((ms) => {
  if (ms.some((m) => m.type === "attributes" ? m.target.classList.contains("estado")
    : (m.target === col && m.removedNodes.length) || [...m.addedNodes].some((n) => n.nodeType === 1 && (n.matches?.(".ferr, .ferr-grupo") || n.querySelector?.(".ferr"))))) agendaArtefatos();
}).observe(col, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
aoEvento((ev) => { if (ev.tipo === "parado" || ev.tipo === "sessao") agendaArtefatos(); });
