// Second wave of what people ask Claude apps for: Claude's reasoning shown as
// it thinks, edits shown as diffs, undoing file changes from a message on,
// Claude's questions as a form, the plan's usage limits, automatic titles,
// long pasted text kept as an editable chip, and the wallpaper reacting to
// what Claude is doing.

// ---- diffs -----------------------------------------------------------------------------
// Edits, multi-edits and new files as lines taken out and put in, with a few
// lines of context; the summary gets a +/− count.
function linhasDiff(antes, depois) {
  const a = String(antes ?? "").split("\n"), b = String(depois ?? "").split("\n");
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0; while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  const ctx = 2, out = [];
  for (let k = Math.max(0, i - ctx); k < i; k++) out.push([" ", a[k]]);
  for (let k = i; k < a.length - j; k++) out.push(["-", a[k]]);
  for (let k = i; k < b.length - j; k++) out.push(["+", b[k]]);
  for (let k = a.length - j; k < Math.min(a.length, a.length - j + ctx); k++) out.push([" ", a[k]]);
  return out;
}
// With a card id the rows can be commented on (attributes plus a "+" button); without
// one (the permission card) they are plain.
function diffDe(nome, e, cartao = null) {
  if (!e) return null;
  let grupos;
  if (nome === "Edit" && "old_string" in e) grupos = [linhasDiff(e.old_string, e.new_string)];
  else if (nome === "MultiEdit" && Array.isArray(e.edits)) grupos = e.edits.map((x) => linhasDiff(x.old_string, x.new_string));
  else if (nome === "Write" && typeof e.content === "string") grupos = [e.content.split("\n").map((l) => ["+", l])];
  else return null;
  const escrita = nome === "Write", arq = e.file_path || "";
  let mais = 0, menos = 0, n = 0, k = 0;
  const html = grupos.map((g) => g.map(([s, l], idx) => {
    if (s === "+") mais++; if (s === "-") menos++;
    if (++n > 400) return "";
    const i = k++;
    const cm = cartao == null ? "" : ` data-arq="${esc(arq)}" data-linha="${escrita ? idx + 1 : ""}" data-lado="${s === "-" ? "E" : "D"}" data-chave="${esc(cartao)}:${i}"`;
    return `<div class="l ${s === "+" ? "mais" : s === "-" ? "menos" : ""}"${cm}>${cartao == null ? "" : BOTAO_COMENTAR}<i>${s === " " ? "" : s === "-" ? "−" : "+"}</i><code>${esc(l) || " "}</code></div>`;
  }).join("")).join('<div class="l corte"><i>⋯</i></div>');
  return { html: `<div class="diff">${html}${n > 400 ? '<div class="l corte"><i>⋯</i><code>(diff longo, cortado)</code></div>' : ""}</div>`, contagem: `<em class="contagem"><b>+${mais}</b><s>−${menos}</s></em>`, mais, menos };
}

// ---- comments on diff lines --------------------------------------------------------------
// Rows of a diff carry data-arq / data-linha / data-lado (D = new side, E = old side) and
// data-chave, their identity: card id and row index for Edit/Write cards, file, side and
// line for git diffs. The comments wait in a bar above the composer and go out as one message.
const BOTAO_COMENTAR = '<button class="cm-mais" aria-label="Comentar nesta linha" title="Comentar nesta linha">+</button>';
const rascunhos = []; // { id, conv, chave, arq, linha, lado, texto, trecho, git, velho }
let convRascunho = 0, rascunhoSeq = 0;
const trechoDe = (row) => (row.querySelector("code")?.textContent || "").trim();
const limpaTexto = (s) => String(s ?? "").replace(/[\r\n]+/g, " ").replace(/`/g, "'");
const achaRascunho = (row) => rascunhos.find((d) => d.chave === row.dataset.chave && (!d.git || d.trecho === trechoDe(row)));
const rotuloRascunho = (d) => baseNome(d.arq) + (d.linha != null ? ":" + d.linha : "");
function formataComentarios(lista) {
  const por = new Map();
  for (const d of lista) { const a = limpaTexto(d.arq); por.set(a, [...(por.get(a) || []), d]); }
  const lado = (d) => (d.lado === "E" ? "antigo" : "novo");
  const corpo = [...por].map(([a, ds]) => a + "\n" + ds.map((d) => {
    const txt = String(d.texto).trim();
    if (d.linha != null) return `- linha ${d.linha} (lado ${lado(d)}): ${txt}`;
    return `- trecho (lado ${lado(d)}): ${txt}\n  \`\`\`\n  ${limpaTexto(d.trecho).slice(0, 300)}\n  \`\`\``;
  }).join("\n")).join("\n\n");
  return "Comentários de revisão no diff (linhas conforme o diff no momento do comentário):\n\n" + corpo;
}
const marcaLinha = (row, sim) => row.classList.toggle("comentada", sim);
function fechaCaixaComentario() {
  const c = document.querySelector(".cm-caixa");
  if (!c) return;
  c.remove(); dispatchEvent(new CustomEvent("comentario-fechado"));
}
function abreCaixaComentario(row) {
  const chave = row.dataset.chave, trecho = trechoDe(row);
  fechaCaixaComentario();
  // closing a box may redraw the Changes window: find the row again
  if (!row.isConnected) row = [...document.querySelectorAll(".diff .l[data-chave]")].find((r) => r.dataset.chave === chave && trechoDe(r) === trecho);
  if (!row) return;
  const d = achaRascunho(row), caixa = document.createElement("div");
  caixa.className = "cm-caixa";
  caixa.innerHTML = '<textarea rows="3"></textarea><div class="cm-acoes"><button class="btn forte" data-salva>Salvar</button><button class="btn" data-cancela>Cancelar</button></div>';
  const ta = caixa.querySelector("textarea");
  ta.value = d?.texto || ""; ta.placeholder = window.t("Comentário sobre esta linha");
  row.after(caixa);
  caixa.querySelector("[data-salva]").onclick = () => salvaRascunho(row, ta.value);
  caixa.querySelector("[data-cancela]").onclick = fechaCaixaComentario;
  ta.focus();
}
function salvaRascunho(row, texto) {
  const t = String(texto).trim(), d = achaRascunho(row);
  if (!t) { if (d) removeRascunho(d); else fechaCaixaComentario(); return; }
  if (d) d.texto = t;
  else rascunhos.push({ id: ++rascunhoSeq, conv: convRascunho, chave: row.dataset.chave, arq: row.dataset.arq || "", linha: row.dataset.linha ? +row.dataset.linha : null, lado: row.dataset.lado || "D", texto: t, trecho: trechoDe(row), git: !!row.closest(".alt-diffs"), velho: false });
  reaplicaRascunhos(document);
  desenhaBarraComentarios(); fechaCaixaComentario();
}
// Unmarks the rows that no longer have a draft.
const reconfereMarcas = () => document.querySelectorAll(".diff .l.comentada").forEach((r) => { if (!achaRascunho(r)) marcaLinha(r, false); });
function removeRascunho(d) {
  const i = rascunhos.indexOf(d); if (i >= 0) rascunhos.splice(i, 1);
  reconfereMarcas(); desenhaBarraComentarios(); fechaCaixaComentario();
}
// Empties the drafts (all, or just the ones given), their marks and, when none is left, the bar.
function limpaRascunhos(lista = null) {
  if (lista) lista.forEach((d) => { const i = rascunhos.indexOf(d); if (i >= 0) rascunhos.splice(i, 1); });
  else { rascunhos.length = 0; convRascunho++; }
  reconfereMarcas(); fechaCaixaComentario(); desenhaBarraComentarios();
}
// After a diff is drawn again, put the marks back; a git comment whose line no longer
// matches (line number or text changed) keeps its chip, flagged as outdated.
function reaplicaRascunhos(raiz) {
  if (!raiz) return;
  const linhas = [...raiz.querySelectorAll(".l[data-chave]")];
  for (const r of linhas) marcaLinha(r, !!achaRascunho(r));
  let mudou = false;
  for (const d of rascunhos) {
    if (!d.git) continue;
    const dessa = linhas.filter((r) => r.dataset.arq === d.arq);
    if (!dessa.length) continue;
    const velho = !dessa.some((r) => r.dataset.chave === d.chave && trechoDe(r) === d.trecho);
    if (velho !== d.velho) { d.velho = velho; mudou = true; }
  }
  if (mudou) desenhaBarraComentarios();
}
function desenhaBarraComentarios() {
  let bar = document.getElementById("comentariosBar");
  const lista = rascunhos.filter((d) => d.conv === convRascunho);
  if (!bar) {
    bar = document.createElement("div"); bar.id = "comentariosBar"; bar.hidden = true;
    document.getElementById("composer").before(bar);
  }
  bar.hidden = !lista.length;
  bar.textContent = "";
  if (!lista.length) return;
  const n = document.createElement("b"); n.textContent = window.t("{0} comentários pendentes", lista.length);
  const chips = document.createElement("span"); chips.className = "cm-chips";
  for (const d of lista) {
    const c = document.createElement("span"); c.className = "cm-chip" + (d.velho ? " velho" : "");
    c.title = d.velho ? window.t("Linha mudou desde o comentário") : d.texto;
    const l = document.createElement("span"); l.textContent = rotuloRascunho(d);
    const x = document.createElement("button"); x.className = "cm-x"; x.textContent = "×"; x.setAttribute("aria-label", window.t("Remover comentário"));
    x.onclick = () => removeRascunho(d);
    c.append(l, x); chips.append(c);
  }
  const env = document.createElement("button"); env.className = "btn forte"; env.textContent = window.t("Enviar comentários") + " (Ctrl+Enter)";
  env.onclick = () => enviaComentarios();
  const lim = document.createElement("button"); lim.className = "btn"; lim.textContent = window.t("Limpar");
  lim.onclick = () => limpaRascunhos();
  bar.append(n, chips, env, lim);
}
addEventListener("idioma", () => desenhaBarraComentarios());
document.addEventListener("click", (e) => {
  const b = e.target.closest?.(".cm-mais"); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  abreCaixaComentario(b.closest(".l"));
});
// Esc cancels and Ctrl+Enter saves inside the comment box; nothing else hears these keys.
addEventListener("keydown", (e) => {
  const caixa = e.target.closest?.(".cm-caixa"); if (!caixa) return;
  if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); fechaCaixaComentario(); }
  else if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); e.stopImmediatePropagation(); caixa.querySelector("[data-salva]").click(); }
}, true);

// ---- Claude's reasoning --------------------------------------------------------------
// Streams into a quiet block while Claude thinks, then folds into one line.
let racEl = null, racTexto = "", racT0 = 0, racAgendado = false;
function abreRaciocinio() {
  fechaRaciocinio(); fechaSegmento(); tiraPensando();
  racEl = bloco("raciocinio"); racTexto = ""; racT0 = performance.now();
  racEl.innerHTML = `<button class="rac-topo">${mosaicoMini()}<b>Raciocinando…</b></button><div class="rac-texto"></div>`;
  racEl.classList.add("aberto", "vivo");
  racEl.querySelector(".rac-topo").onclick = (e) => e.currentTarget.parentElement.classList.toggle("aberto");
}
function maisRaciocinio(delta) {
  if (!racEl) abreRaciocinio();
  racTexto += delta;
  if (racAgendado) return;
  racAgendado = true;
  setTimeout(() => { racAgendado = false; if (!racEl) return; const t = racEl.querySelector(".rac-texto"); t.textContent = racTexto; t.scrollTop = t.scrollHeight; desce(); }, 60);
}
function fechaRaciocinio() {
  if (!racEl) return;
  const s = Math.max(1, Math.round((performance.now() - racT0) / 1000));
  racEl.querySelector(".rac-texto").textContent = racTexto;
  racEl.querySelector(".rac-topo").innerHTML = `${svg('<path d="m9 6 6 6-6 6"/>')}<b>Raciocínio</b><small>${s}s</small>`;
  racEl.classList.remove("aberto", "vivo"); racEl = null;
}
// The 3×3 mark as a tiny live indicator.
// (Once the 3×3 mark; now a tiny Clawd.)
const mosaicoMini = () => `<span class="mosaico-mini">${clawdSvg()}</span>`;

// ---- Claude's questions ----------------------------------------------------------------
function pergunta(ev) {
  fechaRaciocinio(); fechaSegmento(); tiraPensando();
  const el = bloco("pergunta"), escolhas = ev.perguntas.map(() => new Set());
  el.dataset.id = ev.id;
  el.innerHTML = `<div class="t">${svg('<circle cx="12" cy="12" r="8.5"/><path d="M9.8 9.5a2.3 2.3 0 1 1 3.2 2.1c-.7.3-1 .8-1 1.5v.4M12 16.5h.01"/>')}<span>O Claude quer saber</span></div>` +
    ev.perguntas.map((q, k) => `<div class="q" data-k="${k}">${q.header ? `<span class="rotulo">${esc(q.header)}</span>` : ""}<p>${esc(q.question)}</p>
      <div class="ops">${(q.options || []).map((o, n) => `<button class="op" data-n="${n}"><b>${esc(o.label)}</b>${o.description ? `<small>${esc(o.description)}</small>` : ""}</button>`).join("")}</div>
      <input class="outra" placeholder="Ou escreva outra resposta…" /></div>`).join("") +
    `<div class="b"><button class="btn forte" data-a="ok">Responder</button><button class="btn" data-a="pular">Pular</button></div>`;
  el.querySelectorAll(".q").forEach((qEl) => {
    const k = +qEl.dataset.k, multi = !!ev.perguntas[k].multiSelect;
    qEl.querySelectorAll(".op").forEach((b) => (b.onclick = () => {
      const n = +b.dataset.n;
      if (multi) escolhas[k].has(n) ? escolhas[k].delete(n) : escolhas[k].add(n);
      else { escolhas[k].clear(); escolhas[k].add(n); }
      qEl.querySelectorAll(".op").forEach((x) => x.classList.toggle("on", escolhas[k].has(+x.dataset.n)));
    }));
  });
  const fecha = (texto) => { el.className = "resolvido"; el.innerHTML = `${ICONE.ok}<span>${esc(texto)}</span>`; mostraPensando(); };
  el.querySelector('[data-a="ok"]').onclick = () => {
    const respostas = {};
    ev.perguntas.forEach((q, k) => {
      const outra = el.querySelector(`.q[data-k="${k}"] .outra`).value.trim();
      const marcadas = [...escolhas[k]].map((n) => q.options[n].label);
      respostas[q.question] = outra || marcadas.join(", ");
    });
    if (Object.values(respostas).some((v) => !v)) { nota("Responda todas as perguntas (ou clique em Pular)."); return; }
    vivo.responder(ev.id, respostas); fecha(Object.values(respostas).join(" · "));
  };
  el.querySelector('[data-a="pular"]').onclick = () => { vivo.responder(ev.id, null); fecha("Pulou a pergunta"); };
  forcaDesce();
}

// ---- plan limits ----------------------------------------------------------------------------
// The subscription's usage windows: shown with the context meter, a warning
// near the end, and when the limit is hit, an offer to carry on by itself.
const JANELA = { five_hour: "janela de 5 horas", seven_day: "semana", seven_day_opus: "semana (Opus)", seven_day_sonnet: "semana (Sonnet)" };
let limite = null, timerContinua = null, cardLimite = null;
// A reset time in seconds, milliseconds or an ISO string, as milliseconds.
const msDe = (s) => (typeof s === "number" ? (s < 1e12 ? s * 1000 : s) : Date.parse(s));
const quando = (s) => { const d = new Date(msDe(s)); return d.toLocaleString(i18n.local(), { weekday: d.toDateString() === new Date().toDateString() ? undefined : "short", hour: "2-digit", minute: "2-digit" }); };
function mostraLimite(info, alvo) {
  limite = info;
  const uso = info.utilization == null ? null : Math.round(info.utilization > 1 ? info.utilization : info.utilization * 100);
  const m = $("medidor");
  m.dataset.plano = uso == null ? "" : `\nPlano: ${uso}% da ${JANELA[info.rateLimitType] || "janela atual"}${info.resetsAt ? `, renova ${quando(info.resetsAt)}` : ""}.`;
  m.title = (m.title || "").split("\nPlano:")[0] + m.dataset.plano;
  if (info.status === "allowed_warning") nota(`Você já usou ${uso ?? "boa parte"}% da ${JANELA[info.rateLimitType] || "janela"} do seu plano.`);
  if (info.status === "rejected") {
    // One card per hit: a second report of the same limit (event and synthetic message) redraws it.
    const el = alvo || (cardLimite?.isConnected && cardLimite === col.lastElementChild ? cardLimite : (cardLimite = bloco("limite")));
    // No reset time in the report: the plan's usage windows know it.
    if (!info.resetsAt) {
      const j = usoDados?.janelas?.find((x) => x.id === (info.rateLimitType || "five_hour"));
      if (j?.renova && msDe(j.renova) > Date.now()) info = { ...info, resetsAt: j.renova };
      else if (!info.perguntou) vivo.uso(false).then((d) => { if (d?.janelas) usoDados = d; if (d?.janelas && el.isConnected && !el.querySelector("button")) mostraLimite({ ...info, perguntou: true }, el); }).catch(() => {});
    }
    el.innerHTML = `<b>Você chegou no limite do plano.</b><span>${info.resetsAt ? `Libera ${quando(info.resetsAt)}.` : "Libera em breve."}</span>${info.resetsAt ? '<button class="btn forte">Continuar sozinho quando liberar</button>' : ""}`;
    el.querySelector("button")?.addEventListener("click", (e) => {
      const ms = msDe(info.resetsAt) - Date.now() + 60000;
      const conversa = sessaoAtual, titulo = $("titulo").textContent;
      clearTimeout(timerContinua);
      timerContinua = setTimeout(async () => {
        if (!conversa) return;
        if (sessaoAtual !== conversa) { if (rodando) return; await abreSessao(conversa, titulo); }
        envia("Pode continuar de onde parou.");
      }, Math.max(5000, ms));
      e.currentTarget.textContent = `Combinado: continua ${quando(info.resetsAt)}`; e.currentTarget.disabled = true;
    });
    forcaDesce();
  }
}

// ---- undo file changes from a message on --------------------------------------------
async function desfazDaqui(el) {
  if (rodando) { nota("Espere o Claude terminar para desfazer."); return; }
  const uuid = el.dataset.uuid;
  if (!uuid) { nota("Essa mensagem não tem ponto de restauração."); return; }
  el.nextElementSibling?.classList.contains("desfaz-card") && el.nextElementSibling.remove();
  const previa = await vivo.desfazer(uuid, true);
  const n = previa?.filesChanged?.length || 0;
  if (!previa?.canRewind || !n) { nota(previa?.error ? `Não deu: ${previa.error}` : "Nenhum arquivo mudou depois desta mensagem."); return; }
  const card = document.createElement("div");
  card.className = "desfaz-card";
  card.innerHTML = `<span>Voltar <b>${n} arquivo${n > 1 ? "s" : ""}</b> <em class="contagem"><b>+${previa.insertions || 0}</b><s>−${previa.deletions || 0}</s></em> para como estava${n > 1 ? "m" : ""} antes desta mensagem?</span><small>${previa.filesChanged.map((f) => esc(f.split(/[\\/]/).pop())).join(", ")}</small><div class="b"><button class="btn forte">Desfazer</button><button class="btn">Cancelar</button></div>`;
  el.after(card);
  const [sim, nao] = card.querySelectorAll("button");
  nao.onclick = () => card.remove();
  sim.onclick = async () => {
    const r = await vivo.desfazer(uuid, false);
    card.remove();
    if (!r?.canRewind) { nota(`Não deu: ${r?.error || "erro desconhecido"}`, true); return; }
    aviso(`Arquivos restaurados: ${(r.filesChanged || previa.filesChanged).map((f) => f.split(/[\\/]/).pop()).join(", ")}. O Claude não sabe disso; conte a ele se for continuar.`);
  };
}

// ---- long pasted text -------------------------------------------------------------------
// Big pastes become a chip (seen and edited on click) instead of flooding the box.
entrada.addEventListener("paste", (e) => {
  if (e.clipboardData?.files?.length) return;
  const t = e.clipboardData?.getData("text") || "", linhas = t.split("\n").length;
  if (t.length < 1500 && linhas < 25) return;
  e.preventDefault();
  anexos.push({ tipo: "texto", nome: `Texto colado · ${linhas} linha${linhas > 1 ? "s" : ""}`, conteudo: t });
  desenhaAnexos();
});
function editaColado(a) {
  creditosCaixa.innerHTML = `<div class="cred-topo"><span class="marca"><b>${esc(a.nome)}</b></span><button class="icone" id="fechaCreditos" title="Fechar (Esc)">${ICONE.erro}</button></div>
    <textarea class="colado-texto" spellcheck="false"></textarea><div class="b colado-b"><button class="btn forte" data-a="salva">Salvar</button><button class="btn" data-a="tira">Remover</button></div>`;
  const ta = creditosCaixa.querySelector("textarea"); ta.value = a.conteudo;
  creditosCaixa.querySelector("#fechaCreditos").onclick = fechaCreditos;
  creditosCaixa.querySelector('[data-a="salva"]').onclick = () => { a.conteudo = ta.value; const n = ta.value.split("\n").length; a.nome = `Texto colado · ${n} linha${n > 1 ? "s" : ""}`; fechaCreditos(); desenhaAnexos(); };
  creditosCaixa.querySelector('[data-a="tira"]').onclick = () => { anexos.splice(anexos.indexOf(a), 1); fechaCreditos(); desenhaAnexos(); };
  creditos.classList.add("on"); ta.focus();
}

// ---- what Claude is doing ------------------------------------------------------------------
// One state for the whole window: parado, pensando, escrevendo, ferramenta,
// esperando. The wallpaper answers (ripples on the built-in themes, faster
// library pieces and videos), and so does anything listening for it.
let estadoClaude = "parado", ultimaOndaClaude = 0;
function mudaEstado(e, extra) {
  estadoClaude = e;
  document.body.dataset.claude = e;
  dispatchEvent(new CustomEvent("estado-claude", { detail: { estado: e, ...extra } }));
  const vel = geral().reage === false ? 1 : e === "parado" ? 1 : e === "esperando" ? 0.5 : 1.6;
  window.Arte?.velocidade?.(vel);
  document.querySelectorAll("#midia video").forEach((v) => (v.playbackRate = vel));
}
function ondaClaude(forte) {
  if (geral().reage === false || atual < 0) return;
  const r = document.getElementById("composer").getBoundingClientRect();
  const x = forte ? big.W * (0.2 + Math.random() * 0.6) : r.left + r.width / 2, y = forte ? big.H * (0.25 + Math.random() * 0.5) : r.top;
  big.add(ripple(x, y, agora(), { speed: forte ? 170 : 120, life: forte ? 1.2 : 1.6, force: forte ? 150 : 90, alpha: forte ? 0.45 : 0.3 }));
}
setInterval(() => {
  if (estadoClaude === "parado" || document.hidden) return;
  const agoraMs = performance.now(), passo = estadoClaude === "esperando" ? 1300 : estadoClaude === "pensando" ? 2300 : 3200;
  if (agoraMs - ultimaOndaClaude > passo) { ultimaOndaClaude = agoraMs; ondaClaude(false); }
}, 250);

aoEvento((ev) => {
  switch (ev.tipo) {
    case "inicio": {
      mudaEstado("pensando");
      if (ev.uuid) { const meus = [...col.querySelectorAll(".msg.eu:not([data-uuid])")]; if (meus.length) meus[meus.length - 1].dataset.uuid = ev.uuid; }
      break;
    }
    case "raciocinio_inicio": abreRaciocinio(); mudaEstado("pensando"); break;
    case "raciocinio": maisRaciocinio(ev.delta); break;
    case "texto_inicio": fechaRaciocinio(); mudaEstado("escrevendo"); break;
    case "ferramenta": fechaRaciocinio(); mudaEstado("ferramenta", { nome: ev.nome }); ondaClaude(true); break;
    case "ferramenta_fim": mudaEstado("pensando"); break;
    case "permissao": fechaRaciocinio(); mudaEstado("esperando"); break;
    case "pergunta": pergunta(ev); mudaEstado("esperando"); window.somEvento?.("permissao"); avisaSistema("O Claude tem uma pergunta", ev.perguntas?.[0]?.question || ""); break;
    case "limite": mostraLimite(ev.info); break;
    case "titulo": if (ev.id === sessaoAtual) $("titulo").textContent = ev.titulo; carregaSessoes(); break;
    case "erro": mudaEstado("erro"); setTimeout(() => estadoClaude === "erro" && mudaEstado("parado"), 1600); break;
    case "parado": fechaRaciocinio(); if (estadoClaude !== "erro") mudaEstado("parado", { terminou: true }); break;
  }
});
// A click on Permitir / Negar puts Claude back to work.
col.addEventListener("click", (e) => { if (e.target.closest(".perm .btn, .pergunta .btn")) mudaEstado("pensando"); });
