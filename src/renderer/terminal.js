// Integrated terminal: a shell running in the conversation's folder, shown
// above the composer. The shell lives in the main process (one per window); this
// is only its screen, an input line with history, and a way to hand the last
// command's output to Claude as pasted text.

const termEl = document.createElement("div");
termEl.className = "term"; termEl.hidden = true; termEl.setAttribute("aria-label", "Terminal");
termEl.innerHTML = `<div class="term-cab"><b>Terminal</b><em id="termPasta"></em>
  <button class="btn" data-a="manda" title="Anexa a saída do último comando à mensagem">Mandar pro Claude</button>
  <button class="icone" data-a="para" title="Parar o que está rodando (Ctrl+C)">${svg('<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>')}</button>
  <button class="icone" data-a="limpa" title="Limpar">${svg('<path d="M5 7.5h14M9.5 7.5V5h5v2.5M7 7.5l1 12h8l1-12"/>')}</button>
  <button class="icone" data-a="fecha" title="Fechar terminal (Ctrl+\`)">${ICONE.erro}</button></div>
  <pre class="term-saida" id="termSaida" tabindex="0"></pre>
  <div class="term-linha"><span>&gt;</span><input id="termEntrada" spellcheck="false" autocomplete="off" placeholder="Comando (Enter executa, ↑↓ histórico)"></div>`;
$("plano").before(termEl);
const termSaida = $("termSaida"), termEntrada = $("termEntrada");
const botaoTerm = document.createElement("button");
botaoTerm.className = "icone"; botaoTerm.id = "termBtn"; botaoTerm.title = "Terminal (Ctrl+`)";
botaoTerm.innerHTML = svg('<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="m7.5 10 3 2.5-3 2.5M12.5 15h4"/>');
$("infoBtn").before(botaoTerm);

const TERM_MAX = 200000;
let termCarry = "", termQuadro = 0, termTexto = "", termInicioUltimo = 0, termPasta = "", termHist = le("termHist", []), termPos = -1, termRascunho = "";
// ANSI escapes (colours, cursor moves, titles) are dropped; a carriage return
// inside a line keeps only what came after it, like a progress bar redrawing.
const SEM_ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
const limpaSaida = (t) => t.replace(SEM_ANSI, "").replace(/\r\n/g, "\n").split("\n").map((l) => l.slice(l.lastIndexOf("\r") + 1)).join("\n");
function termDesenha() {
  const perto = termSaida.scrollHeight - termSaida.scrollTop - termSaida.clientHeight < 40;
  termSaida.textContent = termTexto;
  if (perto) termSaida.scrollTop = termSaida.scrollHeight;
}
const termAgenda = () => { if (!termQuadro) termQuadro = requestAnimationFrame(() => { termQuadro = 0; termDesenha(); }); };
function termAcrescenta(t) {
  termTexto += t;
  if (termTexto.length > TERM_MAX) { const corte = termTexto.length - TERM_MAX * 0.75; termTexto = termTexto.slice(corte); termInicioUltimo = Math.max(0, termInicioUltimo - corte); }
  termAgenda();
}
function alternaTerm(v = termEl.hidden) {
  termEl.hidden = !v; botaoTerm.classList.toggle("on", v);
  if (v) { $("termPasta").textContent = $("pasta").title; $("termPasta").title = $("pasta").title; termEntrada.focus(); termSaida.scrollTop = termSaida.scrollHeight; }
}
botaoTerm.onclick = () => alternaTerm();
addEventListener("keydown", (e) => { if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.code === "Backquote" || e.key === "`")) { e.preventDefault(); alternaTerm(); } });

async function termExecuta(linha) {
  const pasta = $("pasta").title;
  if (pasta !== termPasta) { termPasta = pasta; $("termPasta").textContent = pasta; $("termPasta").title = pasta; termAcrescenta(`# ${pasta}\n`); }
  termInicioUltimo = termTexto.length;
  termAcrescenta(`> ${linha}\n`);
  if (linha.trim() && termHist[termHist.length - 1] !== linha) { termHist.push(linha); termHist = termHist.slice(-100); guarda("termHist", termHist); }
  if (!(await vivo.termEnviar(linha))) termAcrescenta(window.t("[não deu pra enviar o comando]") + "\n");
}
async function termParar() { termAcrescenta("^C\n"); await vivo.termParar(); }
termEntrada.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { const l = termEntrada.value; termEntrada.value = ""; termPos = -1; termExecuta(l); }
  else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    if (!termHist.length) return;
    if (termPos < 0) termRascunho = termEntrada.value;
    termPos = e.key === "ArrowUp" ? Math.min(termHist.length - 1, termPos + 1) : termPos - 1;
    termEntrada.value = termPos < 0 ? termRascunho : termHist[termHist.length - 1 - termPos];
  } else if (e.ctrlKey && e.key.toLowerCase() === "c" && termEntrada.selectionStart === termEntrada.selectionEnd) { e.preventDefault(); termParar(); }
  else if (e.key === "Escape") entrada.focus();
});
termEl.querySelector('[data-a="para"]').onclick = termParar;
termEl.querySelector('[data-a="limpa"]').onclick = () => { termTexto = ""; termInicioUltimo = 0; termDesenha(); termEntrada.focus(); };
termEl.querySelector('[data-a="fecha"]').onclick = () => { alternaTerm(false); entrada.focus(); };
termEl.querySelector('[data-a="manda"]').onclick = () => {
  const bruto = termTexto.slice(termInicioUltimo).replace(/\s+$/, "");
  if (!bruto) { nota("Ainda não há saída do terminal pra mandar."); return; }
  const linhas = bruto.split("\n").slice(-300), n = linhas.length;
  anexos.push({ tipo: "texto", nome: window.t(n > 1 ? "Saída do terminal · {0} linhas" : "Saída do terminal · {0} linha", n), conteudo: `Saída do terminal em ${$("pasta").title}:\n\`\`\`\n${linhas.join("\n").slice(-30000)}\n\`\`\`` });
  desenhaAnexos(); entrada.focus();
};
aoEvento((ev) => {
  if (ev.tipo !== "terminal") return;
  // hold back a trailing lone \r or a cut-off escape sequence until the next chunk completes it
  let t = termCarry + (ev.texto || ""); termCarry = "";
  if (!ev.fim) {
    const e = t.lastIndexOf("\x1b"), resto = t.endsWith("\r") ? "\r" : e >= 0 && t.length - e < 200 && !/^(\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-Z\\-_])/.test(t.slice(e)) ? t.slice(e) : "";
    if (resto) { termCarry = resto; t = t.slice(0, -resto.length); }
  }
  if (t) termAcrescenta(limpaSaida(t));
  if (ev.fim) termAcrescenta(window.t("[o terminal foi encerrado; o próximo comando abre outro]") + "\n");
});
