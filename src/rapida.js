// Quick Entry: a line of text (and pictures) that goes to Claude from anywhere.
// Enter sends it into a new conversation of the last window used, or into its
// current one with the toggle; the main process does the rest.
const $ = (id) => document.getElementById(id);
const cartao = $("cartao"), entrada = $("entrada"), anexosEl = $("anexos"), alterna = $("alterna"), notaEl = $("nota");
const MAX_IMAGENS = 6, MAX_BYTES = 5 * 1024 * 1024;
let anexos = [], nova = true, notaTimer = null;

const nota = (texto) => { notaEl.textContent = texto ? t(texto) : ""; clearTimeout(notaTimer); if (texto) notaTimer = setTimeout(() => (notaEl.textContent = ""), 4000); };
const desenhaAlterna = () => { alterna.textContent = t(nova ? "Nova conversa" : "Conversa atual"); alterna.classList.toggle("atual", !nova); };
function desenhaAnexos() {
  anexosEl.innerHTML = "";
  anexos.forEach((a, i) => {
    const d = document.createElement("div"); d.className = "anexo"; d.title = a.nome;
    const img = document.createElement("img"); img.src = "data:" + a.mime + ";base64," + a.dados; img.alt = a.nome;
    const x = document.createElement("button"); x.type = "button"; x.textContent = "×"; x.title = t("Remover");
    x.onclick = () => { anexos.splice(i, 1); desenhaAnexos(); entrada.focus(); };
    d.append(img, x); anexosEl.append(d);
  });
  anexosEl.classList.toggle("on", anexos.length > 0);
}
function poeImagem(a) {
  if (anexos.length >= MAX_IMAGENS) return nota("No máximo 6 imagens.");
  if (a.dados.length * 0.75 > MAX_BYTES) return nota("Imagem grande demais (máx. 5 MB).");
  anexos.push(a); desenhaAnexos();
}
async function anexaArquivos(lista) {
  for (const f of lista) {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) { nota("Só dá pra anexar imagens aqui."); continue; }
    if (f.size > MAX_BYTES) { nota("Imagem grande demais (máx. 5 MB)."); continue; }
    const dados = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(",")[1]); fr.readAsDataURL(f); });
    poeImagem({ nome: f.name || "imagem colada.png", dados, mime: f.type });
  }
  entrada.focus();
}

async function envia() {
  const texto = entrada.value.trim();
  if (!texto && !anexos.length) return;
  const ok = await rapida.enviar({ texto, anexos: anexos.map(({ nome, dados, mime }) => ({ nome, dados, mime })), nova });
  if (ok === false) nota("Não deu pra enviar agora."); else reinicia();
}
function reinicia() {
  entrada.value = ""; anexos = []; nova = true; notaEl.textContent = "";
  desenhaAnexos(); desenhaAlterna(); entrada.focus();
}

entrada.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { if (e.isComposing || e.keyCode === 229) return; e.preventDefault(); rapida.fechar(); return; }
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); envia(); }
});
addEventListener("keydown", (e) => { if (e.key === "Escape" && !e.isComposing && e.keyCode !== 229) rapida.fechar(); });
entrada.addEventListener("paste", (e) => {
  const l = [...(e.clipboardData?.files || [])];
  if (l.length && !e.clipboardData.getData("text/plain")) { e.preventDefault(); anexaArquivos(l); }
});
// A dropped file must never navigate this window: images attach, the rest is ignored.
addEventListener("dragover", (e) => { e.preventDefault(); cartao.classList.add("solta"); });
addEventListener("dragleave", () => cartao.classList.remove("solta"));
addEventListener("drop", (e) => { e.preventDefault(); cartao.classList.remove("solta"); anexaArquivos([...(e.dataTransfer?.files || [])]); });
alterna.onclick = () => { nova = !nova; desenhaAlterna(); entrada.focus(); };
$("camera").onclick = async () => {
  const r = await rapida.capturar();
  if (r) poeImagem(r);
  entrada.focus();
};
addEventListener("idioma", desenhaAlterna);
// The text and pictures stay across hide and show; only a sent message clears them.
rapida.aoAbrir((d) => { nova = d?.novaPadrao !== false; notaEl.textContent = ""; desenhaAlterna(); entrada.focus(); });
reinicia();
