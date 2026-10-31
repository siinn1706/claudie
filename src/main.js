// Main process: the window, and the bridge to Claude Code through the Agent
// SDK. Every turn is a query() that resumes the conversation's session; its
// messages are forwarded to the window as small events, and tool permission
// requests wait for the person's answer in the window.

import { app, BrowserWindow, ipcMain, dialog, shell, globalShortcut, nativeImage, protocol, net, safeStorage } from "electron";
import { query as querySdk, listSessions, getSessionMessages, renameSession, deleteSession, forkSession, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import atualizador from "electron-updater";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, execFile, spawn } from "node:child_process";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { acharClaudeExe, acharClaudeExeAsync, comandoClaude } from "./claude-exe.js";
import { DICIONARIO, IDIOMAS, IDIOMA_PADRAO, criaT } from "./i18n.js";
import { iniciaTarefas, trataMensagem, fechaTudo, fundoLista, concluidasDe, esqueceTarefas, workflowEntrada, workflowSaida } from "./tarefas.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const idioma = () => (IDIOMAS.includes(config?.visual?.geral?.idioma) ? config.visual.geral.idioma : IDIOMA_PADRAO);
const t = criaT(idioma), tr = t; // tr: turno() declares its own local t
// Text Claude writes for the app (titles, news) follows the interface language.
const NOME_IDIOMA = { pt: "português do Brasil", en: "inglês", vi: "vietnamita" };

// On Windows a bare name is looked up in the child's cwd before PATH, and the cwd is the
// project folder: git, gh and the shell are resolved from PATH here instead (absolute
// entries only), so a project can't plant its own git.exe.
const exesResolvidos = new Map();
function resolveExe(nome) {
  if (process.platform !== "win32") return nome;
  if (exesResolvidos.has(nome)) return exesResolvidos.get(nome);
  const exts = path.extname(nome) ? [""] : (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  let achado = nome;
  procura: for (const d of (process.env.PATH || "").split(";")) {
    const dir = d.trim().replace(/^"|"$/g, "");
    if (!dir || !path.isAbsolute(dir)) continue;
    for (const x of exts) { const c = path.join(dir, nome + x); try { if (fs.statSync(c).isFile()) { achado = c; break procura; } } catch {} }
  }
  exesResolvidos.set(nome, achado);
  return achado;
}

// ---- which Claude Code runs, and how it signs in --------------------------------------
// The installer does not carry Claude Code: the app uses the one the person
// installed (where claude, the native installer's folder, or npm's). In
// development the SDK's own copy is the fallback. Sign-in is Claude Code's own
// login, or an Anthropic API key the person saves here (encrypted by the OS).
// (claude-exe.js turns what `where` lists into something launchable and checks it starts)
let claudeExe, claudeTentativas = [];
function acharClaude() {
  if (claudeExe === undefined) { const r = acharClaudeExe(); claudeExe = r.exe; claudeTentativas = r.tentativas; }
  return claudeExe;
}
// Warms the same cache without blocking the main thread (the sync lookup runs the probes inline).
function aquecerClaude() {
  if (claudeExe !== undefined) return;
  acharClaudeExeAsync().then((r) => { if (claudeExe === undefined) { claudeExe = r.exe; claudeTentativas = r.tentativas; } }).catch(() => {});
}
const temClaudeEmbutido = () => { try { return fs.existsSync(path.join(path.dirname(fileURLToPath(import.meta.resolve("@anthropic-ai/claude-agent-sdk"))), "..", "claude-agent-sdk-" + process.platform + "-" + process.arch)); } catch { return false; } };
function chaveApi() {
  if (!config.chaveApi) return "";
  try { return safeStorage.decryptString(Buffer.from(config.chaveApi, "base64")); } catch { return ""; }
}
// every query goes through here: the person's Claude Code and the chosen sign-in
function query(args) {
  const exe = acharClaude();
  if (!exe && !temClaudeEmbutido()) throw new Error(claudeTentativas.length
    ? t("Não consegui iniciar o Claude Code neste computador. Tentei: {0}. Instale a versão nativa em code.claude.com/docs/en/setup (ou defina CLAUDE_CODE_PATH) e abra o Claudie de novo.", claudeTentativas.slice(0, 4).join("; "))
    : t("Não encontrei o Claude Code neste computador. Instale em code.claude.com/docs/en/setup e abra o Claudie de novo."));
  const extra = {};
  if (exe) extra.pathToClaudeCodeExecutable = exe;
  const chave = config.entrar === "chave" ? chaveApi() : "";
  if (chave) extra.env = { ...process.env, ANTHROPIC_API_KEY: chave };
  return querySdk({ ...args, options: { ...extra, ...args.options } });
}
const configPath = () => path.join(app.getPath("userData"), "config.json");

const TEMAS = {
  claude: "Claude Code", clouds: "Cloud Drift", lagoon: "Honu Lagoon", koi: "Koi Pond", jelly: "Jellyfish",
  boats: "Paper Boats", fireflies: "Fireflies", moonlit: "Moonlit", lareira: "Lareira", chuva: "Chuva Lo-fi",
  galaxia: "Galáxia Distante", sakura: "Jardim Sakura", aurora: "Aurora", codigo: "Chuva de Código", arcade: "Arcade",
};

// The ASCII Magic pieces (ascii-magic-art, MIT), from the index that
// tools/indice-magia.mjs writes for the window.
const MAGIA = (() => {
  try {
    const s = fs.readFileSync(path.join(here, "renderer", "wallpapers", "magia-indice.js"), "utf8");
    const { cats, pecas } = JSON.parse(s.slice(s.indexOf("=") + 1).trim().replace(/;$/, ""));
    return { cats: Object.fromEntries(cats), pecas: new Map(pecas.map(([slug, nome, cat, nota, tags]) => [slug, { slug, nome, cat, nota, tags }])) };
  } catch { return { cats: {}, pecas: new Map() }; }
})();
function buscaMagia(busca = "", categoria = "") {
  const termos = busca.toLowerCase().split(/\s+/).filter(Boolean);
  const pontos = (p) => {
    if (categoria && p.cat !== categoria) return -1;
    if (!termos.length) return 1;
    const nome = p.nome.toLowerCase(), resto = `${p.slug} ${p.tags} ${p.nota} ${p.cat}`.toLowerCase();
    let n = 0;
    for (const t of termos) { const r = new RegExp("(^|[^a-z0-9])" + t.replace(/[^a-z0-9-]/g, "")); n += r.test(nome) ? 3 : r.test(resto) ? 1 : 0; }
    return n;
  };
  return [...MAGIA.pecas.values()].map((p) => [pontos(p), p]).filter(([n]) => n > 0).sort((a, b) => b[0] - a[0]).map(([, p]) => p);
}

const PADROES = { model: "claude-opus-5-5", modo: "auto", esforco: "medium" };
let config = { cwd: path.join(app.getPath("home"), "projetos"), ...PADROES, ultracode: false, padroes: 0 };
// Each window holds its own conversation: the session it shows and that
// conversation's Claude Code, if one is open (atual; atual.ativo while a turn
// runs). Every conversation sent to keeps its Claude Code open until Claudie
// quits (turnos), so background tasks, session permissions and loaded tools
// outlive the turn. The settings and the project folder are shared.
const janelas = new Map();   // webContents id -> { win, sessionId, atual, cwd }
let principal = null;        // the first window: global shortcut and test hooks
const J = (e) => janelas.get(e.sender.id);
const pendentes = new Map(); // permission request id -> { resolve, suggestions, input, t }
const turnos = new Set();    // every open Claude Code: { tid, j, q, ac, caixa, sessionId, cwd, ativo, ... }
let ultimoLimite = null;     // the last rate_limit_info any Claude Code reported (its window and reset time)
const vivaDe = (id) => id && [...turnos].find((t) => t.sessionId === id && !t.caixa?.fechada);
const turnoDe = (id) => { const t = vivaDe(id); return t?.ativo ? t : undefined; };
// Model, permission mode, effort and ultracode belong to each conversation
// (config.porSessao); the top-level values are only what a new one starts with.
const MODOS = ["default", "acceptEdits", "plan", "auto"];
const cfgSessao = (id) => ({ model: config.model || "", modo: config.modo || "default", esforco: config.esforco || "", ultracode: !!config.ultracode, ...(id && config.porSessao?.[id]) });
const cfgJ = (j) => cfgSessao(j?.sessionId);
const guardaCfg = (id, c) => { (config.porSessao ||= {})[id] = { model: c.model || "", modo: c.modo || "default", esforco: c.esforco || "", ultracode: !!c.ultracode }; };
// Pushes a change into a running turn; what the CLI refuses waits for the next message.
async function aplicaNoTurno(t, m) {
  const falhou = [];
  const tenta = async (chave, fn) => { try { await fn(); } catch { falhou.push(chave); } };
  if ("modo" in m) await tenta("modo", () => t.q.setPermissionMode(m.modo || "default"));
  if ("model" in m) await tenta("model", () => t.q.setModel(m.model || undefined));
  if ("esforco" in m) await tenta("esforco", () => t.q.applyFlagSettings({ effortLevel: m.esforco || null }));
  // A Claude Code started without Dynamic Workflows can't take ultracode live; it reopens with them on.
  if ("ultracode" in m) await tenta("ultracode", () => { if (m.ultracode && !t.workflows) throw new Error(); return t.q.applyFlagSettings({ ultracode: !!m.ultracode }); });
  return falhou;
}
const AVISO_SEM_WORKFLOWS = "O ultracode precisa de Dynamic Workflows, que o Claude Code não liberou nesta conta ou versão. Esta conversa segue sem ele.";
function avisaTurnos() {
  const rodando = [...turnos].filter((t) => t.sessionId && t.ativo).map((t) => t.sessionId);
  const aguardando = [...turnos].filter((t) => t.sessionId && t.pendentes.size).map((t) => t.sessionId);
  for (const o of janelas.values()) enviarEvento(o, { tipo: "turnos", rodando, aguardando });
}

// Paths that come from the window or from a file we don't own are only trusted
// inside a root: symlinks are resolved first, so a link can't lead out of it.
const sobRaiz = (raiz, alvo) => { const r = path.relative(raiz, alvo); return r === "" || (r !== ".." && !r.startsWith(".." + path.sep) && !path.isAbsolute(r)); };
const caminhoReal = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
// A path written inside a project file, resolved against that folder; null if it escapes.
function dentroDaPasta(pasta, rel) {
  if (typeof rel !== "string" || !rel || path.isAbsolute(rel)) return null;
  const raiz = caminhoReal(pasta), alvo = raiz && caminhoReal(path.resolve(raiz, rel));
  return alvo && sobRaiz(raiz, alvo) && alvo !== raiz ? alvo : null;
}
// What "abrir_arquivo" may touch: the folders being worked in, the app's own
// files and what the person attached. Only plain viewable file types are opened
// by their default app; anything else is just shown in its folder.
const anexosPermitidos = new Set();
const ABRIVEL = /\.(txt|md|markdown|json|jsonc|csv|tsv|log|xml|ya?ml|toml|ini|html?|css|svg|png|jpe?g|gif|webp|bmp|ico|avif|pdf|mp3|wav|ogg|flac|mp4|webm|mov|mkv)$/i;
function dentroDeRaizPermitida(alvo) {
  const raizes = [config.cwd, ...[...janelas.values()].flatMap((j) => [j.cwd, j.atual?.cwd]), ...[...turnos].map((t) => t.cwd), path.join(app.getPath("userData"), "pessoal"), path.join(app.getPath("userData"), "motion"), ...anexosPermitidos];
  return raizes.some((r) => { const real = r && caminhoReal(r); return real && sobRaiz(real, alvo); });
}
// A UNC path (\\host\share) would make realpath reach out over the network, sending the
// person's credentials, before any check: only one under an allowed root is resolved.
const caminhoRealSeguro = (abs) => (/^[\\/]{2}/.test(abs) && !dentroDeRaizPermitida(abs) ? null : caminhoReal(abs));
function abreArquivo(caminho, naPasta) {
  const alvo = typeof caminho === "string" && caminho ? caminhoRealSeguro(path.resolve(caminho)) : null;
  if (!alvo || !dentroDeRaizPermitida(alvo)) return false;
  let pasta = false; try { pasta = fs.statSync(alvo).isDirectory(); } catch {}
  if (pasta) shell.openPath(alvo);
  else if (naPasta || !ABRIVEL.test(alvo)) shell.showItemInFolder(alvo);
  else shell.openPath(alvo);
  return true;
}

function lerConfig() {
  // Settings saved under the app's earlier names are carried over.
  const antigos = ["Tessela", "claude-vivo"].map((n) => path.join(app.getPath("appData"), n, "config.json"));
  for (const p of [configPath(), ...antigos]) { try { config = { ...config, ...JSON.parse(fs.readFileSync(p, "utf8")) }; break; } catch {} }
  // New conversations start in auto mode on Opus 5.5 at medium effort; older saved defaults move once.
  if ((config.padroes || 0) < 2) { Object.assign(config, PADROES, { padroes: 2 }); salvarConfig(); }
  if (!fs.existsSync(config.cwd)) config.cwd = app.getPath("home");
}
function salvarConfig() {
  try { fs.mkdirSync(path.dirname(configPath()), { recursive: true }); fs.writeFileSync(configPath() + ".tmp", JSON.stringify(config, null, 2)); fs.renameSync(configPath() + ".tmp", configPath()); } catch {}
}
const enviarEvento = (j, ev) => {
  if (process.env.VIVO_LOG) console.log("[evento]", ev.tipo, ev.tema || ev.nome || ev.ferramenta || ev.modelo || ev.detalhe || ev.texto || "");
  if (j?.win && !j.win.isDestroyed()) j.win.webContents.send("evento", ev);
};

// The themes, as tools Claude can call: suggest one (a card with Aplicar and
// Prévia in the chat) or apply one right away. The same for the pieces of the
// ASCII Magic library, which Claude searches first.
const texto = (t) => ({ content: [{ type: "text", text: t }] });
const peca = (slug) => MAGIA.pecas.get(String(slug).trim().toLowerCase());
const semPeca = (slug) => ({ ...texto(`Não existe a peça "${slug}". Use buscar_fundo para achar o nome certo.`), isError: true });
// Cards belong to the turn's conversation; applying a theme is for the whole window.
const servidorTemasPara = (t) => createSdkMcpServer({
  name: "claudie",
  version: "0.2.0",
  instructions: `Este app mostra papéis de parede ASCII animados atrás da conversa. Há dois tipos: os ${Object.keys(TEMAS).length} temas do Claudie (interativos, com música) e a biblioteca ASCII Magic, com ` +
    `${MAGIA.pecas.size} animações. Quando a pessoa pedir um tema ou um visual, prefira um tema do Claudie se algum combinar; senão use buscar_fundo (em inglês: os nomes e tags da biblioteca são em inglês) e depois sugerir_fundo ou aplicar_fundo. ` +
    "Responda sempre no idioma em que a pessoa escreve. " +
    "Use as ferramentas de sugerir para mostrar um cartão (a pessoa decide aplicar), e as de aplicar só se ela pedir para aplicar direto. Temas da Claudie: " +
    Object.entries(TEMAS).map(([id, nome]) => `${id} (${nome})`).join(", ") + ". Categorias da biblioteca: " + Object.entries(MAGIA.cats).map(([id, nome]) => `${id} (${nome})`).join(", ") + ".",
  tools: [
    tool("sugerir_tema", "Mostra na conversa um cartão do tema, com prévia animada e os botões Aplicar e Prévia.", { tema: z.enum(Object.keys(TEMAS)) },
      async ({ tema }) => { t.ev({ tipo: "cartao_tema", tema }); return texto(`Cartão do tema ${TEMAS[tema]} mostrado. A pessoa decide se aplica.`); }, { alwaysLoad: true }),
    tool("aplicar_tema", "Aplica o tema no fundo do app agora.", { tema: z.enum(Object.keys(TEMAS)) },
      async ({ tema }) => { enviarEvento(t.j, { tipo: "aplicar_tema", tema }); return texto(`Tema ${TEMAS[tema]} aplicado.`); }, { alwaysLoad: true }),
    tool("buscar_fundo", "Busca animações na biblioteca ASCII Magic por palavras em inglês (ex.: ocean night, cat, rain, galaxy) e/ou categoria. Devolve até 15 peças: id, nome, categoria e descrição.",
      { busca: z.string().describe("Palavras em inglês; vazio para listar a categoria"), categoria: z.string().optional().describe("Id da categoria, opcional") },
      async ({ busca, categoria }) => {
        const r = buscaMagia(busca, categoria || "").slice(0, 15);
        return texto(r.length ? r.map((p) => `${p.slug} — ${p.nome} (${p.cat}): ${p.nota}`).join("\n") : "Nada encontrado. Tente outras palavras em inglês ou outra categoria.");
      }, { alwaysLoad: true }),
    tool("sugerir_fundo", "Mostra na conversa um cartão de uma animação da biblioteca, com Aplicar e Prévia.", { peca: z.string().describe("Id da peça, de buscar_fundo") },
      async ({ peca: id }) => { const p = peca(id); if (!p) return semPeca(id); t.ev({ tipo: "cartao_arte", chave: `magia:${p.slug}` }); return texto(`Cartão de ${p.nome} mostrado. A pessoa decide se aplica.`); }, { alwaysLoad: true }),
    tool("aplicar_fundo", "Aplica uma animação da biblioteca no fundo do app agora.", { peca: z.string().describe("Id da peça, de buscar_fundo") },
      async ({ peca: id }) => { const p = peca(id); if (!p) return semPeca(id); enviarEvento(t.j, { tipo: "aplicar_arte", chave: `magia:${p.slug}` }); return texto(`${p.nome} aplicada no fundo.`); }, { alwaysLoad: true }),
  ],
});
const FERRAMENTAS_TEMA = ["sugerir_tema", "aplicar_tema", "buscar_fundo", "sugerir_fundo", "aplicar_fundo"].map((n) => `mcp__claudie__${n}`);
// Newer models get the task tools only when a session names them; they are
// bookkeeping (the plan the window shows), so they also need no approval.
const FERRAMENTAS_PLANO = ["TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TodoWrite"];

// Attachments: images go to Claude as image blocks (read here when they come
// as a path), every file with a path is also listed so Claude can open it.
const IMAGEM = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
// Each message goes with an id of ours, so the window can later undo the file
// changes made after it (file checkpoints are kept per user message). Slash
// commands go as plain text, which is how Claude Code runs them.
// The API refuses an image over 5 MB of base64 or 8000 px on a side: bigger ones
// are shrunk (PNG first, JPEG when that is still too big) or left out.
const LIMITE_B64 = 5_000_000, LADO_MAX = 8000, ARQUIVO_MAX = 40 * 1024 * 1024;
function ajustaImagem(dados, mime) {
  const img = nativeImage.createFromBuffer(Buffer.from(dados, "base64")), { width: w, height: h } = img.getSize();
  if (dados.length <= LIMITE_B64 && (!w || Math.max(w, h) <= LADO_MAX)) return { dados, mime };
  if (!w || !h) return null; // not a format Electron can decode, so it can't be shrunk
  const inicio = Math.min(1, LADO_MAX / Math.max(w, h));
  for (const jpeg of mime === "image/png" ? [false, true] : [true]) {
    for (let i = 0, escala = inicio; i < 8; i++, escala *= 0.75) {
      const r = escala < 1 ? img.resize({ width: Math.max(1, Math.round(w * escala)), height: Math.max(1, Math.round(h * escala)), quality: "best" }) : img;
      const b64 = (jpeg ? r.toJPEG(85) : r.toPNG()).toString("base64");
      if (b64.length <= LIMITE_B64) return { dados: b64, mime: jpeg ? "image/jpeg" : "image/png" };
    }
  }
  return null;
}
function montaPrompt(texto, anexos = [], uuid, avisa = () => {}) {
  if (!anexos.length && texto.startsWith("/")) return { type: "user", uuid, message: { role: "user", content: texto }, parent_tool_use_id: null };
  const imagens = [], caminhos = [], largadas = [];
  for (const a of anexos) {
    let { dados, mime } = a;
    if (a.caminho) {
      caminhos.push(a.caminho);
      const tipo = IMAGEM[path.extname(a.caminho).toLowerCase()];
      try {
        if (tipo && fs.statSync(a.caminho).size <= ARQUIVO_MAX) { dados = fs.readFileSync(a.caminho).toString("base64"); mime = tipo; }
        else if (tipo) { dados = null; largadas.push(path.basename(a.caminho)); }
      } catch {}
    }
    if (!dados || !Object.values(IMAGEM).includes(mime)) continue;
    let ok = null;
    try { ok = ajustaImagem(dados, mime); } catch {}
    if (ok) imagens.push({ type: "image", source: { type: "base64", media_type: ok.mime, data: ok.dados } });
    else largadas.push(a.nome || (a.caminho && path.basename(a.caminho)) || "imagem");
  }
  let corpo = texto;
  if (caminhos.length) corpo += `${corpo ? "\n\n" : ""}Arquivos anexados:\n${caminhos.map((c) => `- ${c}`).join("\n")}`;
  if (largadas.length) {
    avisa(`${largadas.map((n) => t("Imagem grande demais para enviar: {0}", n)).join("\n")}`);
    corpo += `${corpo ? "\n\n" : ""}(${largadas.length} imagem(ns) anexada(s) não foram enviadas por serem grandes demais: ${largadas.join(", ")}.)`;
  }
  const conteudo = imagens.length ? [...imagens, { type: "text", text: corpo || "Veja a imagem anexada." }] : corpo;
  return { type: "user", uuid, message: { role: "user", content: conteudo }, parent_tool_use_id: null };
}
// The prompt of a conversation's Claude Code: every message sent to it, mid-turn
// or as a new turn, until it is closed (Claudie quits or it has to restart).
function caixaDeEntrada(primeira) {
  const caixa = { fila: [primeira], fechada: false, acorda: null };
  caixa.poe = (m) => { if (caixa.fechada) return false; caixa.fila.push(m); caixa.acorda?.(); return true; };
  caixa.fecha = () => { caixa.fechada = true; caixa.acorda?.(); };
  caixa.gerador = (async function* () {
    for (;;) {
      while (caixa.fila.length) yield caixa.fila.shift();
      if (caixa.fechada) return;
      await new Promise((r) => (caixa.acorda = r)); caixa.acorda = null;
    }
  })();
  return caixa;
}

// A short title for a new conversation, from its first exchange: a small
// model, no tools, no settings, and nothing saved as a session of its own.
async function tituloAutomatico(j, id, pergunta, resposta, dir = j.cwd) {
  let titulo = "";
  try {
    for await (const m of query({
      prompt: `Dê um título curto (de 2 a 6 palavras, em ${NOME_IDIOMA[idioma()]}, sem aspas e sem ponto final) para esta conversa.\n\nPedido: ${pergunta.slice(0, 600)}\n\nResposta: ${resposta.slice(0, 600)}`,
      options: { cwd: dir, model: "claude-haiku-5-5", tools: [], maxTurns: 1, persistSession: false, settingSources: [], systemPrompt: "Você só responde com um título curto." },
    })) if (m.type === "result" && m.subtype === "success") titulo = String(m.result || "").split("\n")[0].replace(/^["'“”*#\s]+|["'“”*.\s]+$/g, "").slice(0, 60);
  } catch {}
  if (!titulo) return;
  try { await renameSession(id, titulo, { dir }); enviarEvento(j, { tipo: "titulo", id, titulo }); } catch {}
}

// Claude Code's own slash commands, with descriptions. They come from a
// query: the one of a running turn when there is one, otherwise a short idle
// one is opened just to ask (no message is sent, nothing is spent). The list is
// kept per folder for a while.
async function comandos(j) {
  const cwd = j?.cwd || config.cwd;
  return comCache(`comandos|${cwd}`, 10 * 60e3, async () => {
    const lista = await comConsulta(j || { cwd }, (q) => q.supportedCommands());
    return lista.map((c) => ({ nome: c.name, descricao: c.description || "", dica: c.argumentHint || "" }));
  });
}

// Files and folders of a conversation's folder for the "@" picker: what git
// tracks or does not ignore, otherwise a bounded walk skipping the usual build
// and dependency folders. Shallow paths first so the cap drops the deepest.
const ARQUIVOS_MAX = 5000, PASTAS_PULADAS = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "target", "__pycache__", "venv", ".venv"]);
const listaGit = (cwd) => new Promise((ok) => execFile(resolveExe("git"), ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 10000 }, (erro, saida) => ok(erro ? null : saida.split("\0").filter(Boolean).map((f) => f.replace(/\\/g, "/")))));
async function andaPasta(cwd) {
  const achados = [], fila = [""];
  while (fila.length && achados.length < ARQUIVOS_MAX * 2) {
    const rel = fila.shift();
    let itens = [];
    try { itens = await fs.promises.readdir(path.join(cwd, rel), { withFileTypes: true }); } catch { continue; }
    for (const d of itens) {
      const c = rel + d.name;
      if (d.isDirectory()) { if (!PASTAS_PULADAS.has(d.name)) { achados.push(c + "/"); fila.push(c + "/"); } } else achados.push(c);
    }
  }
  return achados;
}
async function arquivos(j, atualiza) {
  const cwd = j?.cwd || config.cwd;
  if (atualiza) respostas.delete(`arquivos|${cwd}`);
  return comCache(`arquivos|${cwd}`, 30e3, async () => {
    let caminhos = await listaGit(cwd);
    if (caminhos) {
      const pastas = new Set();
      for (const f of caminhos) for (let i = f.indexOf("/"); i >= 0; i = f.indexOf("/", i + 1)) pastas.add(f.slice(0, i + 1));
      caminhos = [...pastas, ...caminhos];
    } else caminhos = await andaPasta(cwd);
    const prof = (c) => c.replace(/\/$/, "").split("/").length;
    return caminhos.sort((a, b) => prof(a) - prof(b) || a.localeCompare(b)).slice(0, ARQUIVOS_MAX).map((c) => c.endsWith("/") ? { c: c.slice(0, -1), d: true } : { c, d: false });
  });
}

// Animations made in ASCII Motion (ascii-motion.app): its JSON export, a saved
// session (.asciimtn, flat frames) or plain text, reduced to frames of lines
// with their colours and kept in the app's data folder.
const pastaMotion = () => path.join(app.getPath("userData"), "motion");
const cores = (v) => { if (!v) return {}; if (typeof v === "string") { try { return JSON.parse(v); } catch { return {}; } } return v; };
function leMotion(conteudo, nomeArquivo) {
  const nome = path.basename(nomeArquivo).replace(/\.(json|asciimtn|txt)$/i, "");
  let o = null;
  try { o = JSON.parse(conteudo); } catch {}
  let anim;
  if (o && Array.isArray(o.frames) && o.canvas) {
    const fps = o.animation?.frameRate || 12;
    anim = { nome: o.metadata?.title || nome, w: o.canvas.width, h: o.canvas.height, fundo: o.canvas.backgroundColor, quadros: o.frames.slice(0, 3000).map((f) => ({
      linhas: Array.isArray(f.content) ? f.content.map(String) : String(f.contentString ?? f.content ?? "").split("\n"),
      fg: cores(f.colors?.foreground), bg: cores(f.colors?.background), dur: f.duration || 1000 / fps })) };
  } else if (o && Array.isArray(o.animation?.frames) && o.canvas) {
    const w = Math.min(400, Math.max(0, Number(o.canvas.width) | 0)), h = Math.min(400, Math.max(0, Number(o.canvas.height) | 0)), fps = o.animation.frameRate || 12;
    anim = { nome: o.name || nome, w, h, fundo: o.canvas.canvasBackgroundColor, quadros: o.animation.frames.slice(0, 3000).map((f) => {
      const linhas = Array.from({ length: h }, () => Array(w).fill(" ")), fg = {}, bg = {};
      for (const [k, c] of Object.entries(f.data || {})) {
        const [x, y] = k.split(",").map(Number);
        if (!(x >= 0 && x < w && y >= 0 && y < h) || !c) continue;
        linhas[y][x] = c.char || " ";
        if (c.color) fg[k] = c.color;
        if (c.bgColor && c.bgColor !== "transparent") bg[k] = c.bgColor;
      }
      return { linhas: linhas.map((l) => l.join("").replace(/\s+$/, "")), fg, bg, dur: f.duration || 1000 / fps };
    }) };
  } else if (o) {
    throw new Error("Esse arquivo do ASCII Motion tem camadas. No ASCII Motion, use Export → JSON e importe o arquivo .json.");
  } else {
    const quadros = conteudo.replace(/\r/g, "").split(/\n-{3,}\n/).map((q) => ({ linhas: q.split("\n"), fg: {}, bg: {}, dur: 100 }));
    anim = { nome, w: 0, h: 0, quadros };
  }
  anim.quadros = anim.quadros.filter((q) => q.linhas.length).slice(0, 3000);
  if (!anim.quadros.length) throw new Error("Nenhum quadro no arquivo.");
  anim.w = Math.min(400, Math.max(anim.w || 0, ...anim.quadros.map((q) => Math.max(0, ...q.linhas.map((l) => [...l].length)))));
  anim.h = Math.min(400, Math.max(anim.h || 0, ...anim.quadros.map((q) => q.linhas.length)));
  if (!anim.fundo || anim.fundo === "transparent") anim.fundo = "#0d0d0f";
  return anim;
}
function importaMotion(arquivo) {
  if (fs.statSync(arquivo).size > 40 * 1024 * 1024) throw new Error("Arquivo grande demais (máx. 40 MB).");
  const anim = leMotion(fs.readFileSync(arquivo, "utf8"), arquivo);
  const base = anim.nome.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "animacao";
  anim.id = `${base}-${crypto.randomBytes(3).toString("hex")}`;
  fs.mkdirSync(pastaMotion(), { recursive: true });
  fs.writeFileSync(path.join(pastaMotion(), anim.id + ".json"), JSON.stringify(anim));
  return { id: anim.id, nome: anim.nome, quadros: anim.quadros.length };
}
const idMotion = (id) => String(id).replace(/[^a-z0-9-]/g, "");

// Personal files: backgrounds (images, GIFs, videos), sounds, music, fonts and
// the app icon, copied into the app's data folder so they keep working if the
// originals move. The window gets them back as file:// URLs.
const TIPOS = {
  fundos: { nome: "Imagem, GIF ou vídeo", ext: ["png", "jpg", "jpeg", "webp", "gif", "avif", "mp4", "webm", "mov", "m4v"] },
  sons: { nome: "Som", ext: ["mp3", "wav", "ogg", "m4a", "flac", "aac", "opus"] },
  musica: { nome: "Música", ext: ["mp3", "wav", "ogg", "m4a", "flac", "aac", "opus"] },
  fontes: { nome: "Fonte", ext: ["ttf", "otf", "woff", "woff2"] },
  icone: { nome: "Ícone", ext: ["png", "ico", "jpg", "jpeg"] },
};
const pastaPessoal = (tipo) => path.join(app.getPath("userData"), "pessoal", tipo);
const itemPessoal = (tipo, arquivo) => ({ id: arquivo, nome: arquivo.replace(/^[0-9a-f]{6}-/, "").replace(/\.[^.]+$/, ""), url: pathToFileURL(path.join(pastaPessoal(tipo), arquivo)).href, ext: path.extname(arquivo).slice(1).toLowerCase() });
function listaPessoal(tipo) {
  if (!TIPOS[tipo]) return [];
  let itens = [];
  try { itens = fs.readdirSync(pastaPessoal(tipo)).filter((f) => TIPOS[tipo].ext.includes(path.extname(f).slice(1).toLowerCase())).map((f) => itemPessoal(tipo, f)); } catch {}
  return tipo === "fundos" ? [...itens, ...listaWeb()] : itens;
}
function copiaPessoal(tipo, origem, nome) {
  const ext = path.extname(origem).slice(1).toLowerCase();
  if (!TIPOS[tipo]?.ext.includes(ext)) throw new Error(`Formato .${ext} não serve para ${TIPOS[tipo]?.nome.toLowerCase() || tipo}.`);
  const base = (nome || path.basename(origem, path.extname(origem))).replace(/[^\p{L}\p{N} _().-]+/gu, "").trim().slice(0, 60) || tipo;
  const arquivo = `${crypto.randomBytes(3).toString("hex")}-${base}.${ext}`;
  fs.mkdirSync(pastaPessoal(tipo), { recursive: true });
  fs.copyFileSync(origem, path.join(pastaPessoal(tipo), arquivo));
  return itemPessoal(tipo, arquivo);
}
const arquivoPessoal = (tipo, id) => path.join(pastaPessoal(tipo), path.basename(String(id)));

// Wallpaper Engine (Steam): the video and web wallpapers the person has. Scenes
// are drawn by Wallpaper Engine's own renderer and only run inside it, so they
// are counted and left out. A web wallpaper is copied whole and runs in a
// sandboxed frame with no access to the app.
function bibliotecasSteam() {
  let raiz = "C:\\Program Files (x86)\\Steam";
  try {
    const r = execFileSync("reg", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"], { encoding: "utf8", windowsHide: true });
    const m = /SteamPath\s+REG_SZ\s+(.+)/.exec(r); if (m) raiz = m[1].trim();
  } catch {}
  // the registry and libraryfolders.vdf spell the same folder in different case
  const libs = new Map(), poe = (p) => { const n = path.normalize(p); libs.set(n.toLowerCase(), libs.get(n.toLowerCase()) || n); };
  poe(raiz);
  try { for (const m of fs.readFileSync(path.join(raiz, "steamapps", "libraryfolders.vdf"), "utf8").matchAll(/"path"\s+"([^"]+)"/g)) poe(m[1].replace(/\\\\/g, "\\")); } catch {}
  return [...libs.values()];
}
const lerProjeto = (pasta) => { try { return JSON.parse(fs.readFileSync(path.join(pasta, "project.json"), "utf8").replace(/^\uFEFF/, "")); } catch { return null; } };
function listaWallpaperEngine() {
  const itens = [], vistos = new Set();
  let cenas = 0, achou = false;
  for (const lib of bibliotecasSteam()) {
    const we = path.join(lib, "steamapps", "common", "wallpaper_engine", "projects");
    for (const base of [path.join(lib, "steamapps", "workshop", "content", "431960"), path.join(we, "myprojects"), path.join(we, "defaultprojects")]) {
      let pastas; try { pastas = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { continue; }
      achou = true;
      for (const d of pastas) {
        const pasta = path.join(base, d.name), p = lerProjeto(pasta);
        if (!p || vistos.has(pasta)) continue;
        vistos.add(pasta);
        const tipo = String(p.type || "").toLowerCase();
        if (tipo !== "video" && tipo !== "web") { if (tipo === "scene") cenas++; continue; }
        // project.json is someone else's file: its paths must stay inside the project folder
        if (!dentroDaPasta(pasta, p.file)) continue;
        const prev = dentroDaPasta(pasta, p.preview);
        itens.push({ pasta, nome: String(p.title || d.name).trim().slice(0, 80), tipo, preview: prev ? pathToFileURL(prev).href : null });
      }
    }
  }
  itens.sort((a, b) => a.nome.localeCompare(b.nome, "pt"));
  return { achou, itens, cenas };
}
// Shims so a web wallpaper starts the way it does inside Wallpaper Engine: its
// audio and media hooks exist (and stay quiet), and its settings arrive with
// the defaults from project.json once the page has loaded.
const shimWeb = (props) => `// Claudie: o que o Wallpaper Engine daria a este papel de parede.
(function () {
  var nada = function () {};
  ["wallpaperRegisterAudioListener", "wallpaperRegisterMediaStatusListener", "wallpaperRegisterMediaPropertiesListener", "wallpaperRegisterMediaThumbnailListener", "wallpaperRegisterMediaPlaybackListener", "wallpaperRegisterMediaTimelineListener"].forEach(function (k) { window[k] = nada; });
  window.addEventListener("load", function () {
    var l = window.wallpaperPropertyListener || {};
    try { if (l.applyGeneralProperties) l.applyGeneralProperties({ fps: 60 }); } catch (e) {}
    try { if (l.applyUserProperties) l.applyUserProperties(${JSON.stringify(props || {})}); } catch (e) {}
    try { if (l.setPaused) l.setPaused(false); } catch (e) {}
  });
})();
`;
const pastaWeb = () => path.join(app.getPath("userData"), "pessoal", "web");
function listaWeb() {
  let dirs; try { dirs = fs.readdirSync(pastaWeb(), { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return []; }
  return dirs.flatMap((d) => {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(pastaWeb(), d.name, "claudie.json"), "utf8"));
      return [{ id: d.name, nome: m.nome, ext: "web", url: `claudie-we://${d.name}/${m.file.split(/[\\/]/).map(encodeURIComponent).join("/")}`, preview: m.preview ? pathToFileURL(path.join(pastaWeb(), d.name, m.preview)).href : null }];
    } catch { return []; }
  });
}
async function importaWallpaperEngine(pasta) {
  if (!listaWallpaperEngine().itens.some((i) => i.pasta === pasta)) throw new Error("Esse papel de parede não está mais na biblioteca do Wallpaper Engine.");
  const p = lerProjeto(pasta), nome = String(p.title || "Wallpaper Engine").trim().slice(0, 60);
  const arquivo = dentroDaPasta(pasta, p.file);
  if (!arquivo) throw new Error("Esse papel de parede aponta para um arquivo fora da sua pasta.");
  if (String(p.type).toLowerCase() === "video") return copiaPessoal("fundos", arquivo, nome);
  const id = `${crypto.randomBytes(3).toString("hex")}-${nome.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "web"}`;
  const dest = path.join(pastaWeb(), id);
  // links are not copied: one pointing outside would be served from the copy
  await fs.promises.cp(pasta, dest, { recursive: true, filter: async (src) => !(await fs.promises.lstat(src)).isSymbolicLink() });
  fs.writeFileSync(path.join(dest, "claudie-we.js"), shimWeb(p.general?.properties));
  const html = path.join(dest, p.file), h = fs.readFileSync(html, "utf8"), tag = '<script src="claudie-we.js"></script>';
  fs.writeFileSync(html, /<head[^>]*>/i.test(h) ? h.replace(/<head[^>]*>/i, (m) => m + tag) : tag + h);
  fs.writeFileSync(path.join(dest, "claudie.json"), JSON.stringify({ nome, file: p.file, preview: dentroDaPasta(pasta, p.preview) ? p.preview : null }));
  return listaWeb().find((i) => i.id === id);
}
// The window icon: the person's own, or the mosaic mark.
function aplicaIcone() {
  const id = config.visual?.icone;
  let img = id ? nativeImage.createFromPath(arquivoPessoal("icone", id)) : null;
  if (!img || img.isEmpty()) img = nativeImage.createFromPath(path.join(here, "icone.png"));
  for (const j of janelas.values()) try { j.win.setIcon(img); } catch {}
}

// A turn belongs to its conversation, not to the window: the person may open
// another one while it runs. Its events carry the turn id (tid), and the turn
// keeps what a window needs to pick it up again (the reply being written, the
// open permission cards).
// A turn starts: new id, fresh replay state, and the window following it.
function comecaTurno(t, uuid, comando) {
  Object.assign(t, { tid: uuid, n: 0, parcial: "", subs: [], resposta: "", ativo: true });
  t.ev({ tipo: "inicio", uuid: comando ? null : uuid, sid: t.sessionId });
  avisaTurnos();
}
// The turn is over; the conversation's Claude Code stays open for the next one.
function fimDoTurno(t, aviso) {
  // A turn that ends (or a process that dies while idle) must not leave cards waiting for an answer.
  for (const id of [...t.pendentes.keys()]) {
    pendentes.get(id)?.resolve({ behavior: "deny", message: "Cancelado." }); pendentes.delete(id);
    t.pendentes.delete(id); aviso({ tipo: "permissao_fim", id });
  }
  if (!t.ativo) return;
  t.ativo = false;
  if (t.sessionId) esquece(t.sessionId);
  aviso({ tipo: "parado", id: t.sessionId });
  avisaTurnos();
  const p = t.primeiro; t.primeiro = null;
  if (p && t.sessionId && config.visual?.geral?.titulo !== false && t.resposta && !p.startsWith("/")) tituloAutomatico(t.j, t.sessionId, p, t.resposta, t.cwd);
}
// A choice the open Claude Code can't take, or a folder change, closes it; the
// next message reopens the conversation with it.
const encerra = (t) => t.caixa?.fecha();
// Closes them for good and waits (a few seconds at most) until they exit.
const fechaEspera = (ts) => { for (const t of ts) { encerra(t); t.ac.abort(); } return Promise.race([Promise.all(ts.map((t) => t.saiu)), new Promise((ok) => setTimeout(ok, 4000))]); };
async function turno(j, texto, anexos) {
  const viva = vivaDe(j.sessionId);
  if (viva && !viva.ativo && !viva.reiniciar && viva.cwd === j.cwd) {
    const uuid = crypto.randomUUID();
    viva.j = j; j.atual = viva;
    comecaTurno(viva, uuid, !anexos.length && texto.startsWith("/"));
    viva.caixa.poe(montaPrompt(texto, anexos, uuid, (m) => enviarEvento(j, { tipo: "erro", texto: m })));
    return;
  }
  if (viva) encerra(viva);
  const ac = new AbortController(), uuid = crypto.randomUUID(), geral = config.visual?.geral || {};
  const t = { tid: uuid, j, q: null, ac, sessionId: j.sessionId, cwd: j.cwd, n: 0, parcial: "", pendentes: new Map(), subs: [], resposta: "", ativo: false };
  t.saiu = new Promise((ok) => (t.sair = ok));
  let comecou = false;
  iniciaTarefas(t);
  const ev = t.ev = (x) => {
    t.n++;
    // Subagent activity is kept (bounded) so a window that opens the turn later can redraw it.
    if (x.tipo.startsWith("sub_")) { t.subs.push(x); if (t.subs.length > 400) t.subs.shift(); }
    if (x.tipo === "texto_inicio") t.parcial = "";
    else if (x.tipo === "texto") t.parcial += x.delta;
    enviarEvento(t.j, { ...x, tid: t.tid, n: t.n });
  };
  const novo = !t.sessionId;
  if (novo) t.primeiro = texto;
  let contexto = 0, pedidoEm = 0;
  t.cfg = { ...cfgJ(j) };
  // Until the query exists the window follows no tagged stream, so a setup failure is sent untagged.
  const aviso = (x) => (t.q ? ev(x) : enviarEvento(t.j, x));
  try {
  t.caixa = caixaDeEntrada(montaPrompt(texto, anexos, uuid, (m) => enviarEvento(j, { tipo: "erro", texto: m })));
  const q = t.q = query({
    prompt: t.caixa.gerador,
    options: {
      cwd: t.cwd,
      model: t.cfg.model || undefined,
      resume: t.sessionId || undefined,
      permissionMode: t.cfg.modo,
      effort: t.cfg.esforco || undefined,
      // Ultracode: Claude plans a workflow of many agents for each real task. It
      // only works with Dynamic Workflows on, so Claudie turns that on for this session.
      settings: t.cfg.ultracode ? { ultracode: true, enableWorkflows: true } : undefined,
      enableFileCheckpointing: true,
      thinking: geral.raciocinio === false ? undefined : { type: "adaptive", display: "summarized" },
      includePartialMessages: true,
      abortController: ac,
      systemPrompt: { type: "preset", preset: "claude_code" },
      mcpServers: { claudie: servidorTemasPara(t) },
      allowedTools: [...FERRAMENTAS_TEMA, ...FERRAMENTAS_PLANO],
      canUseTool: (toolName, input, { signal, suggestions, decisionReason }) => new Promise((resolve) => {
        if (!t.ativo) comecaTurno(t, crypto.randomUUID(), true);
        const id = crypto.randomUUID();
        pendentes.set(id, { resolve, suggestions, input, t, toolName });
        // Claude asking the person something: the choices become a form.
        const pedido = toolName === "AskUserQuestion" ? { tipo: "pergunta", id, perguntas: input.questions || [] }
          : { tipo: "permissao", id, ferramenta: toolName, entrada: input, motivo: decisionReason ?? null, temSempre: !!suggestions?.length };
        t.pendentes.set(id, pedido); ev(pedido); avisaTurnos();
        signal.addEventListener("abort", () => {
          if (pendentes.delete(id)) { t.pendentes.delete(id); resolve({ behavior: "deny", message: "Cancelado." }); ev({ tipo: "permissao_fim", id }); avisaTurnos(); }
        });
      }),
    },
  });
  turnos.add(t);
  j.atual = t;
  comecaTurno(t, uuid, !anexos.length && texto.startsWith("/")); comecou = true;
  if (desligadosMcp(t.cwd).length) q.mcpServerStatus().then((st) => aplicaDesligados(q, t.cwd, st)).catch(() => {});
  avisaTurnos();
    for await (const msg of q) {
      // Claude can start a turn by itself while idle (a background task finished,
      // a message sent as the last turn ended); the window showing it follows it.
      if (!t.ativo && !msg.parent_tool_use_id && (msg.type === "assistant" || msg.type === "stream_event" && msg.event?.type === "message_start")) comecaTurno(t, crypto.randomUUID(), true);
      if (msg.session_id && msg.session_id !== t.sessionId) {
        t.sessionId = msg.session_id;
        if (novo && !config.porSessao?.[t.sessionId]) { guardaCfg(t.sessionId, t.cfg); salvarConfig(); }
        if (t.j.atual === t) t.j.sessionId = t.sessionId;
        ev({ tipo: "sessao", id: t.sessionId }); avisaTurnos();
      }
      if (msg.type === "system" && msg.subtype === "thinking_tokens") {
        ev({ tipo: "pensando", tokens: msg.estimated_tokens });
      } else if (msg.type === "system" && msg.subtype === "init") {
        ev({ tipo: "info", modelo: msg.model, cwd: msg.cwd, modo: msg.permissionMode });
        t.workflows = !!msg.tools?.includes("Workflow");
        if (t.cfg.ultracode && !t.workflows) ev({ tipo: "aviso", texto: AVISO_SEM_WORKFLOWS });
      } else if (trataMensagem(t, msg)) {
        // background tasks: tarefas.js keeps the state and sends the "fundo" snapshots
      } else if (msg.type === "stream_event" && !msg.parent_tool_use_id) {
        const e = msg.event;
        if (e.type === "message_start") pedidoEm = Date.now();
        if (e.type === "content_block_start" && e.content_block.type === "text") ev({ tipo: "texto_inicio" });
        if (e.type === "content_block_delta" && e.delta.type === "text_delta") { t.resposta += e.delta.text; ev({ tipo: "texto", delta: e.delta.text }); }
        if (e.type === "content_block_start" && e.content_block.type === "thinking") ev({ tipo: "raciocinio_inicio" });
        if (e.type === "content_block_delta" && e.delta.type === "thinking_delta") ev({ tipo: "raciocinio", delta: e.delta.thinking });
      } else if (msg.type === "assistant" && !msg.parent_tool_use_id) {
        // The finished message is in the transcript now; nothing left to replay.
        t.parcial = "";
        for (const b of msg.message.content) {
          if (b.type === "tool_use") { ev({ tipo: "ferramenta", id: b.id, nome: b.name, entrada: b.input }); if (b.name === "Workflow") workflowEntrada(t, b.id, b.input); }
        }
        // The id of a reply with text, so the window can branch from it.
        if (msg.message.content.some((b) => b.type === "text" && b.text.trim())) ev({ tipo: "marca", uuid: msg.uuid });
        // What the last request carried is how full the context is.
        const u = msg.message.usage;
        if (u) contexto = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
        // The prompt cache lives for its TTL from the last request that wrote or
        // read it; what was written says whether that TTL is 5 minutes or 1 hour.
        if (u && (u.cache_read_input_tokens || u.cache_creation_input_tokens)) {
          const c = u.cache_creation;
          t.cacheTtl = c?.ephemeral_1h_input_tokens ? 3600 : c?.ephemeral_5m_input_tokens ? 300 : t.cacheTtl || 300;
          ev({ tipo: "cache", ate: (pedidoEm || Date.now()) + t.cacheTtl * 1000, ttl: t.cacheTtl });
        }
        if (msg.error) ev({ tipo: "erro", texto: `Erro da API: ${msg.error}` });
        // Already known to be over the limit, Claude Code answers with a synthetic
        // message and no rate_limit_event: the limit card still has to show.
        if (msg.error === "rate_limit" && t.limiteDito !== t.tid) {
          t.limiteDito = t.tid;
          const r = ultimoLimite?.resetsAt, futuro = r && (r < 1e12 ? r * 1000 : r) > Date.now();
          ev({ tipo: "limite", info: { ...ultimoLimite, status: "rejected", resetsAt: futuro ? r : undefined } });
        }
      } else if (msg.type === "user" && !msg.parent_tool_use_id && Array.isArray(msg.message?.content)) {
        workflowSaida(t, msg.tool_use_result);
        for (const b of msg.message.content) {
          if (b.type === "tool_result") {
            const corpo = textoDoResultado(b.content), maior = corpo.length > SAIDA_VISTA;
            if (maior) guardaSaida(b.tool_use_id, corpo);
            ev({ tipo: "ferramenta_fim", id: b.tool_use_id, erro: !!b.is_error, saida: corpo.slice(0, SAIDA_VISTA), maior, imagens: imagensDoResultado(b.content), tarefa: tarefaDoResultado(msg.tool_use_result, corpo) });
          }
        }
      } else if (msg.parent_tool_use_id && (msg.type === "assistant" || msg.type === "user") && Array.isArray(msg.message?.content)) {
        // What a subagent does shows inside its parent card; its text stays out of the reply.
        const pai = msg.parent_tool_use_id;
        for (const b of msg.message.content) {
          if (b.type === "tool_use") ev({ tipo: "sub_ferramenta", pai, id: b.id, nome: b.name, entrada: enxuto(b.input) });
          else if (b.type === "tool_result") ev({ tipo: "sub_ferramenta_fim", pai, id: b.tool_use_id, erro: !!b.is_error });
        }
      } else if (msg.type === "rate_limit_event") {
        ultimoLimite = msg.rate_limit_info || ultimoLimite;
        if (msg.rate_limit_info?.status === "rejected") t.limiteDito = t.tid;
        ev({ tipo: "limite", info: msg.rate_limit_info });
      } else if (msg.type === "result") {
        ev({ tipo: "fim", ok: msg.subtype === "success" && !msg.is_error, duracao: msg.duration_ms, detalhe: msg.subtype });
        const usos = Object.values(msg.modelUsage || {});
        const janela = Math.max(0, ...usos.map((m) => m.contextWindow || 0));
        const saida = usos.reduce((n, m) => n + (m.outputTokens || 0), 0);
        if (janela && contexto) ev({ tipo: "uso", contexto, janela, saida });
        fimDoTurno(t, ev);
      }
    }
  } catch (err) {
    if (!ac.signal.aborted) {
      const msg = String(err?.message || err);
      aviso({ tipo: "erro", texto: /failed to launch/i.test(msg) && claudeExe ? tr("O Claude Code em {0} não iniciou. Instale a versão nativa em code.claude.com/docs/en/setup ou defina CLAUDE_CODE_PATH com um Claude Code que funcione.", claudeExe) : msg });
    }
  } finally {
    // Claude Code closed (quit, restart, stop or crash): what it still ran died with it.
    t.caixa?.fecha();
    turnos.delete(t);
    if (t.j.atual === t) t.j.atual = null;
    fechaTudo(t);
    // A setup failure before the turn began still has to release the window.
    if (!t.ativo && t.pendentes.size) fimDoTurno(t, aviso); // cards raised while idle die with the process
    if (t.ativo) fimDoTurno(t, aviso); else { if (!comecou) enviarEvento(t.j, { tipo: "parado", id: t.sessionId }); avisaTurnos(); }
    t.sair();
  }
}
// A tool result: the live event carries its start (SAIDA_VISTA chars) and the
// pictures; the full text stays here, bounded, for the "Ver tudo" button.
const SAIDA_VISTA = 4000, SAIDA_MAX = 1 << 20, SAIDAS_TOTAL = 24 << 20, SAIDAS_QTD = 200, FOTO_MAX = 3_000_000;
const saidasCheias = new Map();
let saidasBytes = 0;
function guardaSaida(id, texto) {
  const velho = saidasCheias.get(id);
  if (velho != null) { saidasBytes -= velho.length; saidasCheias.delete(id); }
  const s = texto.slice(0, SAIDA_MAX);
  saidasCheias.set(id, s); saidasBytes += s.length;
  // Least recently stored goes first, by count and by total size.
  for (const [k, v] of saidasCheias) {
    if (saidasBytes <= SAIDAS_TOTAL && saidasCheias.size <= SAIDAS_QTD) break;
    saidasCheias.delete(k); saidasBytes -= v.length;
  }
}
const textoDoResultado = (c) => typeof c === "string" ? c : (c || []).filter((x) => x.type === "text").map((x) => x.text).join("\n");
// Pictures in a result as data URLs; very large ones are left out.
function imagensDoResultado(c) {
  if (!Array.isArray(c)) return [];
  return c.filter((x) => x.type === "image" && x.source?.type === "base64" && x.source.data?.length <= FOTO_MAX).slice(0, 4).map((x) => `data:${x.source.media_type};base64,${x.source.data}`);
}
// A tool input small enough for a live event: long strings cut, nested values dropped.
const enxuto = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 300) : typeof v === "object" ? undefined : v]));
// What a task tool gave back, for the plan: the new task's id, or the whole
// list. The structured result is preferred; the text ("Task #3 created") is
// what the transcript keeps.
function tarefaDoResultado(r, corpo = "") {
  if (r && typeof r === "object") {
    if (r.task?.id) return { id: String(r.task.id) };
    if (Array.isArray(r.tasks)) return { lista: r.tasks.map((x) => ({ id: String(x.id), subject: x.subject, status: x.status })) };
  }
  const m = /^Task #(\w+) created/m.exec(corpo);
  return m ? { id: m[1] } : undefined;
}

// History of a Claude Code session, reduced to what the window draws.
async function historico(id, dir) {
  const msgs = await getSessionMessages(id, dir ? { dir } : undefined);
  const out = [];
  for (const m of msgs) {
    if (m.parent_tool_use_id) continue;
    const c = m.message?.content;
    if (m.isMeta || m.isCompactSummary) continue;
    if (m.type === "user") {
      if (typeof c === "string") { if (!c.trimStart().startsWith("<")) out.push({ papel: "eu", texto: c, uuid: m.uuid }); }
      else if (Array.isArray(c)) {
        const t = c.filter((b) => b.type === "text").map((b) => b.text).join("\n"), imagens = c.filter((b) => b.type === "image");
        // Pictures sent inline come back as data URLs, so they open in the preview.
        const fotos = imagens.filter((b) => b.source?.type === "base64").map((b) => `data:${b.source.media_type};base64,${b.source.data}`);
        if ((t && !t.startsWith("<")) || imagens.length) out.push({ papel: "eu", texto: t, imagens: imagens.length - fotos.length, fotos, uuid: m.uuid });
        // What the task tools answered, so the plan can be rebuilt.
        for (const b of c) {
          if (b.type !== "tool_result") continue;
          const corpo = textoDoResultado(b.content);
          const tarefa = tarefaDoResultado(m.toolUseResult ?? m.tool_use_result, corpo);
          // Result text (cut) and status, so a reopened card shows what happened.
          out.push({ papel: "resultado", id: b.tool_use_id, tarefa, erro: !!b.is_error, saida: corpo.slice(0, SAIDA_VISTA), maior: corpo.length > SAIDA_VISTA });
        }
      }
    } else if (m.type === "assistant" && Array.isArray(c)) {
      for (const b of c) {
        if (b.type === "text" && b.text.trim()) out.push({ papel: "claude", texto: b.text, uuid: m.uuid });
        if (b.type === "tool_use") out.push({ papel: "ferramenta", id: b.id, nome: b.name, entrada: b.input });
      }
    }
  }
  return out;
}

// A window; with a session id it opens straight on that conversation.
function criarJanela(sessao) {
  const win = new BrowserWindow({
    width: sessao ? 1180 : 1440, height: sessao ? 820 : 920, minWidth: 940, minHeight: 620,
    backgroundColor: "#262624",
    title: config.visual?.nome || "Claudie",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#00000000", symbolColor: "#e9e6e1", height: 44 },
    webPreferences: { preload: path.join(here, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: !!process.env.VIVO_GRAVAR },
  });
  // VIVO_GRAVAR="pasta" (tests and demo videos): the window renders offscreen
  // at 30 fps and, between "@@gravar:on" and "@@gravar:off" logged by the page,
  // each frame is saved as a JPEG with its time, for ffmpeg.
  if (process.env.VIVO_GRAVAR && !principal) {
    const dir = process.env.VIVO_GRAVAR, tempos = [];
    let gravando = false, n = 0, t0 = 0;
    fs.mkdirSync(dir, { recursive: true });
    win.webContents.setFrameRate(30);
    win.webContents.on("console-message", (e) => {
      if (e.message === "@@gravar:on") { gravando = true; t0 = performance.now(); }
      if (e.message === "@@gravar:off") { gravando = false; fs.writeFileSync(path.join(dir, "tempos.json"), JSON.stringify(tempos)); }
    });
    win.webContents.on("paint", (_e, _r, img) => {
      if (!gravando) return;
      const nome = String(n++).padStart(5, "0") + ".jpg";
      tempos.push([nome, Math.round(performance.now() - t0)]);
      fs.writeFile(path.join(dir, nome), img.toJPEG(90), () => {});
    });
  }
  // (VIVO_PASTA: a folder for test runs, never saved)
  const j = { win, sessionId: null, atual: null, cwd: (!principal && process.env.VIVO_PASTA) || config.cwd }, id = win.webContents.id;
  janelas.set(id, j);
  if (!principal) principal = j;
  win.on("closed", () => {
    // A turn running here stops; an idle Claude Code stays open for the conversation.
    for (const t of turnos) if (t.j === j && t.ativo) t.ac.abort();
    j.fechada = true;
    janelas.delete(id);
    terminalMata(j);
    if (principal === j) principal = janelas.values().next().value || null;
  });
  win.loadFile(path.join(here, "renderer", "index.html"), sessao ? { query: { sessao } } : undefined);
  aplicaIcone();
  win.on("page-title-updated", (e) => { if (config.visual?.nome) { e.preventDefault(); win.setTitle(config.visual.nome); } });
  // Window warnings and errors reach the terminal, where `npm start` shows them.
  win.webContents.on("console-message", (e) => { if (e.level === "warning" || e.level === "error") console.log(`[janela ${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`); });
  win.webContents.on("render-process-gone", (_e, d) => console.log(`[janela] caiu: ${d.reason} (${d.exitCode})`));
  win.webContents.on("unresponsive", () => console.log("[janela] travou"));
  win.webContents.on("did-finish-load", () => {
    console.log("[janela] carregada");
    if (j !== principal || sessao) return;
    // VIVO_TESTE="..." sends that message on start: an end-to-end check.
    // VIVO_MOTION="arquivo" imports an ASCII Motion file on start.
    if (process.env.VIVO_MOTION) { try { console.log("[motion]", importaMotion(process.env.VIVO_MOTION)); } catch (e) { console.log("[motion] erro:", e.message); } }
    // VIVO_JS="expressão" runs in the window after load and prints the result;
    // VIVO_FOTO="arquivo.png" saves a picture of the window right after.
    // VIVO_TAMANHO="1024x700" sets the window size for the test.
    if (process.env.VIVO_TAMANHO) { const [w, h] = process.env.VIVO_TAMANHO.split("x").map(Number); win.setSize(w, h); }
    // VIVO_METRICAS=1 prints the CPU each process used while the expression ran.
    if (process.env.VIVO_JS) win.webContents.setBackgroundThrottling(false), win.moveTop(), setTimeout(async () => {
      if (process.env.VIVO_METRICAS) app.getAppMetrics();
      try { console.log("[js]", JSON.stringify(await win.webContents.executeJavaScript(process.env.VIVO_JS, true))); } catch (e) { console.log("[js] erro:", e.message); }
      if (process.env.VIVO_METRICAS) {
        const m = app.getAppMetrics(), por = {};
        for (const p of m) por[p.type] = (por[p.type] || 0) + p.cpu.percentCPUUsage;
        console.log("[metricas]", JSON.stringify(Object.fromEntries(Object.entries(por).map(([k, v]) => [k, +v.toFixed(1)]))), "total", m.reduce((a, p) => a + p.cpu.percentCPUUsage, 0).toFixed(1));
      }
      // VIVO_QUADRO="expressão" runs in every frame inside the window (web wallpapers)
      if (process.env.VIVO_QUADRO) for (const f of win.webContents.mainFrame.frames) try { console.log("[quadro]", f.url, JSON.stringify(await f.executeJavaScript(process.env.VIVO_QUADRO, true))); } catch (e) { console.log("[quadro] erro:", e.message); }
      if (process.env.VIVO_FOTO) fs.writeFileSync(process.env.VIVO_FOTO, (await win.webContents.capturePage()).toPNG());
    }, 4500);
    if (process.env.VIVO_TESTE) turno(j, process.env.VIVO_TESTE, process.env.VIVO_ANEXO ? [{ caminho: process.env.VIVO_ANEXO }] : []);
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  return j;
}
// A conversation running in another window can't be opened to send here too.
const emOutra = (j, id) => { const t = turnoDe(id); return !!t && t.j !== j && !t.j.fechada; };

ipcMain.handle("estado", (e) => ({ ...config, ...cfgJ(J(e)), cwd: J(e).cwd, sessionId: J(e).sessionId, rodando: !!J(e).atual?.ativo, temas: TEMAS, janelas: janelas.size }));
ipcMain.handle("enviar", (e, texto, anexos) => {
  const j = J(e);
  if (j.atual?.ativo || (turnoDe(j.sessionId) && !emOutra(j, j.sessionId))) return false;
  if (j.sessionId && emOutra(j, j.sessionId)) { enviarEvento(j, { tipo: "erro", texto: "Essa conversa está rodando em outra janela. Espere ela terminar." }); return false; }
  turno(j, String(texto), Array.isArray(anexos) ? anexos : []); return j.atual?.tid || true;
});
// A message for the turn running in this window; false once it can no longer take one.
ipcMain.handle("injetar", (e, texto, anexos) => {
  const t = J(e).atual, s = String(texto || "");
  if (!t?.ativo || !t.caixa || t.caixa.fechada || (!Array.isArray(anexos) || !anexos.length) && s.startsWith("/")) return false;
  const m = montaPrompt(s, Array.isArray(anexos) ? anexos : [], crypto.randomUUID(), (x) => enviarEvento(t.j, { tipo: "erro", texto: x }));
  return typeof m !== "string" && t.caixa.poe(m);
});
// Paths the preload read from real dropped File objects; the window can't forge these.
ipcMain.on("anexo_soltou", (_e, p) => { if (typeof p === "string" && p) anexosPermitidos.add(p); });
ipcMain.handle("janela_nova", (_e, sessao) => { criarJanela(sessao || undefined); });
ipcMain.handle("arquivos", async (e, atualiza) => { try { return await arquivos(J(e), !!atualiza); } catch (err) { console.log("[arquivos]", err?.message || err); return []; } });
ipcMain.handle("comandos", async (e) => { try { return await comandos(J(e)); } catch (e) { console.log("[comandos]", e?.message || e); return []; } });
ipcMain.handle("anexar", async (e) => {
  const r = await dialog.showOpenDialog(J(e).win, { title: t("Anexar arquivos"), defaultPath: J(e).cwd, properties: ["openFile", "multiSelections"] });
  if (!r.canceled) r.filePaths.forEach((p) => anexosPermitidos.add(p));
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle("motion_importar", async (e, caminho) => {
  let arquivo = caminho;
  if (!arquivo) {
    const r = await dialog.showOpenDialog(J(e).win, { title: t("Importar animação do ASCII Motion"), filters: [{ name: "ASCII Motion", extensions: ["json", "asciimtn", "txt"] }], properties: ["openFile"] });
    if (r.canceled || !r.filePaths[0]) return null;
    arquivo = r.filePaths[0];
  }
  try { return importaMotion(arquivo); } catch (e) { return { erro: String(e?.message || e) }; }
});
// Listed without blocking the main process: a file is only parsed again when its mtime changes, and a corrupt one is skipped.
const indiceMotion = new Map(); // file name -> { quando, item }
ipcMain.handle("motion_lista", async () => {
  try {
    const pasta = pastaMotion(), nomes = (await fs.promises.readdir(pasta)).filter((f) => f.endsWith(".json")), itens = [];
    for (const f of nomes) {
      try {
        const p = path.join(pasta, f), quando = (await fs.promises.stat(p)).mtimeMs;
        let e = indiceMotion.get(f);
        if (e?.quando !== quando) { const a = JSON.parse(await fs.promises.readFile(p, "utf8")); e = { quando, item: { id: a.id, nome: a.nome, quadros: a.quadros.length, quando } }; indiceMotion.set(f, e); }
        itens.push(e.item);
      } catch { indiceMotion.delete(f); }
    }
    for (const f of indiceMotion.keys()) if (!nomes.includes(f)) indiceMotion.delete(f);
    return itens.sort((a, b) => b.quando - a.quando);
  } catch { return []; }
});
ipcMain.handle("motion_ler", (_e, id) => { try { return JSON.parse(fs.readFileSync(path.join(pastaMotion(), idMotion(id) + ".json"), "utf8")); } catch { return null; } });
ipcMain.handle("motion_apagar", (_e, id) => { try { fs.unlinkSync(path.join(pastaMotion(), idMotion(id) + ".json")); return true; } catch { return false; } });
ipcMain.handle("parar", async (e) => { const a = J(e).atual; if (a?.ativo) { try { await a.q.interrupt(); } catch { a.ac.abort(); } } });
// Stops one background task (not the whole turn); the stream then reports it as stopped.
ipcMain.handle("parar_tarefa", async (e, id) => {
  const a = J(e).atual;
  if (!a?.tarefas.has(id)) return false;
  try { await a.q.stopTask(id); return true; } catch { return false; }
});
ipcMain.handle("permissao", (_e, { id, decisao, texto, modo }) => {
  const p = pendentes.get(id); if (!p) return;
  pendentes.delete(id); p.t.pendentes.delete(id); avisaTurnos();
  const feedback = String(texto || "").trim().slice(0, 2000), plano = p.toolName === "ExitPlanMode";
  if (decisao === "negar") p.resolve({ behavior: "deny", message: feedback ? (plano ? `A pessoa quer ajustar o plano antes de seguir: ${feedback}` : `A pessoa negou e pediu: ${feedback}`) : "A pessoa negou." });
  else if (plano) {
    // Approving a plan leaves plan mode for the mode the person chose, in the running turn and in the saved choice.
    const novo = MODOS.includes(modo) && modo !== "plan" ? modo : "default";
    p.resolve({ behavior: "allow", updatedPermissions: [{ type: "setMode", mode: novo, destination: "session" }] });
    mudaConfig(p.t.j, { modo: novo }, p.t.sessionId);
  } else p.resolve({ behavior: "allow", updatedPermissions: decisao === "sempre" ? p.suggestions : undefined });
});
// The side panel: where Claude works (computer, folder, git branch, model),
// how full the context is by category, and the state of each connector (MCP
// server). Context and connectors come from Claude Code itself: the running
// turn when there is one, otherwise a short idle query on the conversation.
// In a linked worktree ".git" is a file pointing at the real git directory.
function ramoGit(dir) {
  for (let d = dir, i = 0; d && i < 30; d = path.dirname(d), i++) {
    try {
      const g = path.join(d, ".git"), ptr = fs.statSync(g).isFile() ? /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(g, "utf8")) : null;
      const h = fs.readFileSync(path.join(ptr ? path.resolve(d, ptr[1].trim()) : g, "HEAD"), "utf8").trim();
      return h.startsWith("ref:") ? h.split("/").slice(2).join("/") : h.slice(0, 8);
    } catch {}
    if (path.dirname(d) === d) break;
  }
  return "";
}
ipcMain.handle("ramo", (e) => ramoGit(J(e)?.cwd));
// Every helper question goes through here so Claude Code (and the MCP servers
// it loads) starts at most once for it: a running turn of the conversation
// answers directly, and idle callers share one short query that closes when the
// last of them is done.
const ociosas = new Map(); // folder|session|model -> { q, n, fecha }
async function comConsulta(j, fn) {
  const rodando = j.atual || vivaDe(j.sessionId);
  if (rodando?.q && !rodando.caixa?.fechada) return fn(rodando.q);
  const chave = `${j.cwd}|${j.sessionId || ""}|${cfgJ(j).model || ""}`;
  let o = ociosas.get(chave);
  if (!o) {
    const ac = new AbortController();
    let solta;
    const espera = new Promise((r) => (solta = r));
    const q = query({ prompt: (async function* () { await espera; })(), options: { cwd: j.cwd, resume: j.sessionId || undefined, model: cfgJ(j).model || undefined, abortController: ac, systemPrompt: { type: "preset", preset: "claude_code" }, mcpServers: { claudie: servidorTemasPara(j) } } });
    o = { q, n: 0, fecha() { ociosas.delete(chave); solta(); ac.abort(); q.return?.().catch(() => {}); } };
    ociosas.set(chave, o);
  }
  o.n++;
  try { return await fn(o.q); } finally { if (--o.n === 0) o.fecha(); }
}
// Results of those questions: asked again while one is in flight they share its
// answer, and a fresh one is reused for ttl ms (a failure is not kept).
const respostas = new Map(), emVoo = new Map();
function comCache(chave, ttl, fn) {
  const r = respostas.get(chave);
  // expired entries are dropped once the map grows, so folders no longer viewed don't pile up
  if (respostas.size > 40) for (const [k, v] of respostas) if (Date.now() - v.quando > 10 * 60000) respostas.delete(k);
  if (r && Date.now() - r.quando < ttl) return Promise.resolve(r.valor);
  if (emVoo.has(chave)) return emVoo.get(chave);
  const p = fn().then((valor) => { respostas.set(chave, { quando: Date.now(), valor }); return valor; }).finally(() => emVoo.delete(chave));
  emVoo.set(chave, p);
  return p;
}
// A turn changes the context and the usage, so what was read for its conversation is stale.
const esquece = (id) => { for (const k of respostas.keys()) if (k.endsWith(`|${id}`)) respostas.delete(k); };
// Connector management. Which servers the person turned off is kept per folder
// (Query.toggleMcpServer only lasts for that query); add and remove go through
// the Claude Code CLI itself so the config files stay Claude Code's own.
const chaveMcp = (cwd) => path.resolve(cwd).toLowerCase();
const desligadosMcp = (cwd) => config.mcpDesligados?.[chaveMcp(cwd)] || [];
function guardaDesligado(cwd, nome, desligado) {
  const lista = new Set(desligadosMcp(cwd));
  desligado ? lista.add(nome) : lista.delete(nome);
  config.mcpDesligados = { ...config.mcpDesligados, [chaveMcp(cwd)]: [...lista] };
  salvarConfig();
}
async function aplicaDesligados(q, cwd, st) {
  const alvo = desligadosMcp(cwd).filter((n) => st.some((c) => c.name === n && c.status !== "disabled"));
  for (const n of alvo) { try { await q.toggleMcpServer(n, false); } catch {} }
  return alvo.length > 0;
}
const esquecePainel = () => { for (const k of respostas.keys()) if (k.startsWith("painel|")) respostas.delete(k); };
function claudeCli(args, cwd) {
  const exe = acharClaude();
  if (!exe) return Promise.resolve({ erro: "Não encontrei o Claude Code neste computador." });
  const c = comandoClaude(exe, args);
  return new Promise((ok) => execFile(c.cmd, c.args, { cwd, encoding: "utf8", windowsHide: true, timeout: 45000, maxBuffer: 1 << 20, env: c.env },
    (erro, saida, err) => ok(erro ? { erro: String(err || saida || erro.message).trim().slice(0, 1500) } : { saida: String(saida).trim().slice(0, 1500) })));
}
// command line of a stdio server: split on spaces, keeping "quoted parts" together
const quebraComando = (txt) => [...txt.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
const ESCOPOS_MCP = ["user", "project", "local"];
// Claude Code reads its connectors when it starts: idle ones close now, running ones after the turn.
const reabreConversas = () => { for (const t of turnos) if (t.ativo) t.reiniciar = true; else encerra(t); };
ipcMain.handle("mcp_acao", async (e, { acao, nome, escopo }) => {
  const j = J(e);
  if (typeof nome !== "string" || !nome || nome.startsWith("claude.ai ") || nome === "claudie") return { erro: "Esse conector não pode ser mudado aqui." };
  try {
    if (acao === "remover") {
      if (!ESCOPOS_MCP.includes(escopo)) return { erro: "Esse conector não vem de um arquivo de configuração." };
      const r = await claudeCli(["mcp", "remove", nome, "-s", escopo], j.cwd);
      if (!r.erro) { guardaDesligado(j.cwd, nome, false); esquecePainel(); reabreConversas(); }
      return r;
    }
    if (acao === "ligar" || acao === "desligar") {
      const ligar = acao === "ligar";
      guardaDesligado(j.cwd, nome, !ligar); esquecePainel();
      await comConsulta(j, (q) => q.toggleMcpServer(nome, ligar));
      return {};
    }
    if (acao === "reconectar") { await comConsulta(j, (q) => q.reconnectMcpServer(nome)); esquecePainel(); return {}; }
  } catch (err) { esquecePainel(); return { erro: String(err?.message || err) }; }
  return { erro: "Ação desconhecida." };
});
ipcMain.handle("mcp_adicionar", async (e, d) => {
  const j = J(e), nome = String(d?.nome || "").trim(), escopo = d?.escopo;
  if (!/^[\w.-]{1,64}$/.test(nome)) return { erro: "Use só letras, números, ponto, hífen e sublinhado no nome." };
  if (!ESCOPOS_MCP.includes(escopo)) return { erro: "Escolha o escopo." };
  const linhas = (x) => String(x || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const env = linhas(d.env), cab = linhas(d.cabecalhos);
  if (env.some((l) => !/^[A-Za-z_]\w*=/.test(l))) return { erro: "Variáveis no formato NOME=valor, uma por linha." };
  let args;
  if (d.transporte === "stdio") {
    const cmd = quebraComando(String(d.comando || ""));
    if (!cmd.length) return { erro: "Informe o comando do servidor." };
    args = ["mcp", "add", nome, "-s", escopo, ...env.flatMap((l) => ["-e", l]), "--", ...cmd];
  } else if (d.transporte === "http" || d.transporte === "sse") {
    const url = String(d.url || "").trim();
    if (!/^https?:\/\/\S+$/.test(url)) return { erro: "Informe um endereço http(s) válido." };
    if (cab.some((l) => !/^[\w-]+:\s*\S/.test(l))) return { erro: "Cabeçalhos no formato Nome: valor, um por linha." };
    args = ["mcp", "add", nome, url, "-t", d.transporte, "-s", escopo, ...cab.flatMap((l) => ["-H", l])];
  } else return { erro: "Escolha o tipo de conector." };
  const r = await claudeCli(args, j.cwd);
  if (!r.erro) { esquecePainel(); reabreConversas(); }
  return r;
});
ipcMain.handle("painel", async (e) => {
  const j = J(e);
  const ambiente = { computador: os.hostname(), pasta: j.cwd, ramo: ramoGit(j.cwd), modelo: cfgJ(j).model || "" };
  try {
    // connectors are still connecting right after start: give them a few seconds
    const consulta = () => comConsulta(j, async (q) => {
      const ctx = await q.getContextUsage({ detail: "summary" });
      let st = await q.mcpServerStatus();
      for (let i = 0; i < 12 && st.some((c) => c.status === "pending"); i++) { await new Promise((r) => setTimeout(r, 500)); st = await q.mcpServerStatus(); }
      // servers the person turned off stay off in new queries
      if (await aplicaDesligados(q, j.cwd, st)) st = await q.mcpServerStatus();
      return [ctx, st];
    });
    // a running turn is asked live; only an idle conversation is cached
    const [contexto, conectores] = j.atual?.ativo || turnoDe(j.sessionId) ? await consulta() : await comCache(`painel|${j.cwd}|${cfgJ(j).model || ""}|${j.sessionId || ""}`, 20e3, consulta);
    return {
      ambiente: { ...ambiente, modelo: contexto?.model || ambiente.modelo },
      contexto: contexto && { total: contexto.totalTokens, max: contexto.maxTokens, pct: contexto.percentage, categorias: (contexto.categories || []).map((c) => ({ nome: c.name, tokens: c.tokens, cor: c.color, tipo: c.kind || (c.isDeferred ? "deferred" : "used") })), memoria: (contexto.memoryFiles || []).map((m) => ({ caminho: m.path, tokens: m.tokens })) },
      conectores: (conectores || []).map((c) => ({ nome: c.name, estado: c.status, erro: c.error || "", escopo: c.scope || c.source || "", ferramentas: c.tools?.length ?? null, tipo: c.config?.type || "", embutido: c.source === "sdk" || c.name === "claudie" })),
      rodando: !!(j.atual?.ativo || turnoDe(j.sessionId)),
    };
  } catch (err) { return { ambiente, erro: String(err?.message || err) }; }
});
// Plan usage: the subscription's windows (5 hours, week, per model) and this
// session's totals, as Claude Code's /usage reads them. The SDK marks this
// call experimental, so any failure just means "no data".
// `fundo` (background polling) never starts a Claude Code just to ask: with none open it answers from the cache.
ipcMain.handle("uso", async (e, fundo) => {
  try {
    const j = J(e), consulta = () => comConsulta(j, (q) => q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }));
    const chave = `uso|${j.cwd}|${cfgJ(j).model || ""}|${j.sessionId || ""}`, aberto = j.atual || vivaDe(j.sessionId);
    let u;
    if (fundo && !(aberto?.q && !aberto.caixa?.fechada)) { u = respostas.get(chave)?.valor; if (!u) return { erro: "ocioso" }; }
    else u = j.atual?.ativo || turnoDe(j.sessionId) ? await consulta() : await comCache(chave, 60e3, consulta);
    const janelas = Object.entries(u?.rate_limits || {}).filter(([, v]) => v && typeof v === "object" && "utilization" in v)
      .map(([id, v]) => ({ id, uso: v.utilization, renova: v.resets_at }));
    return { plano: u?.subscription_type || null, disponivel: !!u?.rate_limits_available, janelas, sessao: u?.session ? { custo: u.session.total_cost_usd, linhas: [u.session.total_lines_added, u.session.total_lines_removed], ms: u.session.total_api_duration_ms } : null };
  } catch (err) { return { erro: String(err?.message || err) }; }
});
// News for Clawd to tell: once a day a small model does a quick web search
// for what is new with Claude, Claude Code and Anthropic; the answer is kept
// on disk and reused until the next day.
ipcMain.handle("novidades", async () => {
  const arq = path.join(app.getPath("userData"), "novidades.json");
  try { const c = JSON.parse(fs.readFileSync(arq, "utf8")); if (Date.now() - c.quando < 20 * 3600e3 && c.itens?.length) return c.itens; } catch {}
  let texto = "";
  try {
    for await (const m of query({
      prompt: "Pesquise na web as novidades mais recentes (últimas semanas) sobre a Anthropic, o Claude e o Claude Code. Responda só com 4 frases curtas em " + NOME_IDIOMA[idioma()] + ", uma por linha, sem marcadores nem links, cada uma com um fato novo e concreto (no máximo 120 caracteres cada). Se não achar nada recente, responda vazio.",
      options: { cwd: app.getPath("home"), model: "claude-haiku-5-5", tools: ["WebSearch"], allowedTools: ["WebSearch"], maxTurns: 4, persistSession: false, settingSources: [], systemPrompt: "Você pesquisa e resume notícias com precisão. Nunca invente." },
    })) if (m.type === "result" && m.subtype === "success") texto = String(m.result || "");
  } catch {}
  const itens = texto.split(/\r?\n/).map((l) => l.replace(/^[-*•\d.\s]+/, "").trim()).filter((l) => l.length > 15 && l.length < 200).slice(0, 5);
  if (itens.length) try { fs.writeFileSync(arq, JSON.stringify({ quando: Date.now(), itens })); } catch {}
  return itens;
});
// Files Claude changed open in their own app, or show in their folder.
ipcMain.handle("abrir_arquivo", (_e, caminho, naPasta) => abreArquivo(caminho, naPasta));
// A file named in a reply (relative to the conversation's folder, absolute, file:// or
// percent-encoded by the markdown). Images come back as a URL for the preview; the rest
// opens as "abrir_arquivo" would. Same roots, so a link can't reach outside the folders.
const IMAGEM_LINK = /\.(png|jpe?g|gif|webp|bmp|ico|avif|svg)$/i;
ipcMain.handle("abrir_link", (e, href) => {
  const j = J(e);
  let alvo = typeof href === "string" ? href.trim() : "";
  if (!alvo) return { erro: "nao_achou" };
  // [file](src/a.js#L42) and [file](src/a.js:42): the line suffix is not part of the name
  const sufixo = /(#.*|\?.*|:\d+(:\d+)?)$/, decodifica = (x) => { try { return decodeURIComponent(x); } catch { return x; } };
  let candidatos;
  try {
    if (/^file:/i.test(alvo)) {
      const u = new URL(alvo);
      if (u.hostname && u.hostname !== "localhost") return { erro: "fora" };
      alvo = fileURLToPath(alvo.split(/[?#]/)[0]);
      candidatos = [alvo, alvo.replace(sufixo, "")];
    } else candidatos = [decodifica(alvo), decodifica(alvo.replace(sufixo, ""))];
  } catch { return { erro: "nao_achou" }; }
  const base = j?.atual?.cwd || j?.cwd || config.cwd;
  let real = null;
  for (const c of candidatos) if ((real = caminhoRealSeguro(path.resolve(base, c)))) break;
  if (!real) return { erro: "nao_achou" };
  if (!dentroDeRaizPermitida(real)) return { erro: "fora" };
  if (IMAGEM_LINK.test(real) && fs.statSync(real).isFile()) return { imagem: pathToFileURL(real).href, nome: path.basename(real) };
  return abreArquivo(real) ? { ok: true } : { erro: "fora" };
});

// Review of the working tree against HEAD for the "changes" window. Git runs
// with execFile in the conversation's folder only; output is bounded and
// files too large or binary are only noted.
const GIT_MAX = 12 * 1024 * 1024, GIT_ARQ_MAX = 200 * 1024, GIT_NOVOS_MAX = 200, ARVORE_VAZIA = "4b825dc642cb6eb9a060e54bf8d69288fbcb8904";
const git = (cwd, args, max = GIT_MAX, timeout = 20000) => new Promise((ok) => execFile(resolveExe("git"), ["-c", "core.quotepath=false", ...args], { cwd, encoding: "utf8", windowsHide: true, maxBuffer: max, timeout }, (erro, saida, err) => ok({ erro, saida: saida || "", err: String(err || "") })));
function fatiaDiff(bruto) {
  const arquivos = [];
  for (const parte of bruto.split(/^diff --git /m).slice(1)) {
    const h = parte.search(/^@@ /m), cab = parte.slice(0, h < 0 ? parte.length : h);
    const novo = /^new file mode/m.test(cab), apagado = /^deleted file mode/m.test(cab), binario = /^Binary files|^GIT binary patch/m.test(cab);
    const m = cab.match(/^\+\+\+ b\/([^\t\r\n]+)/m) || cab.match(/^--- a\/([^\t\r\n]+)/m) || cab.match(/^a\/(.+) b\/\1$/m);
    if (!m) continue;
    let diff = binario ? "" : parte.slice(cab.length), mais = 0, menos = 0;
    for (const l of diff.split("\n")) { if (l[0] === "+") mais++; else if (l[0] === "-") menos++; }
    const grande = diff.length > GIT_ARQ_MAX;
    if (grande) diff = diff.slice(0, diff.lastIndexOf("\n", GIT_ARQ_MAX));
    arquivos.push({ caminho: m[1], estado: novo ? "A" : apagado ? "D" : "M", binario, grande, mais, menos, diff });
  }
  return arquivos;
}
function arquivoNovo(cwd, rel) {
  const base = { caminho: rel, estado: "A", novo: true, mais: 0, menos: 0, diff: "" };
  try {
    const abs = path.join(cwd, rel), st = fs.statSync(abs); if (!st.isFile()) return null;
    if (st.size > GIT_ARQ_MAX) return { ...base, grande: true };
    const buf = fs.readFileSync(abs);
    if (buf.length === 0) return base;
    if (buf.subarray(0, 8192).includes(0)) return { ...base, binario: true };
    const linhas = buf.toString("utf8").replace(/\r?\n$/, "").split(/\r?\n/);
    return { ...base, mais: linhas.length, diff: `@@ -0,0 +1,${linhas.length} @@\n` + linhas.map((l) => "+" + l).join("\n") };
  } catch { return null; }
}
ipcMain.handle("git_alteracoes", async (e) => {
  const cwd = J(e)?.cwd;
  if (!cwd || !fs.existsSync(cwd)) return { git: false };
  const dentro = await git(cwd, ["rev-parse", "--is-inside-work-tree"], 1024);
  if (dentro.erro || dentro.saida.trim() !== "true") return { git: false };
  const temHead = !(await git(cwd, ["rev-parse", "--verify", "-q", "HEAD"], 1024)).erro;
  const d = await git(cwd, ["diff", temHead ? "HEAD" : ARVORE_VAZIA, "--no-color", "--no-ext-diff", "--no-renames", "--relative", "-U3", "--", "."]);
  // a diff past the buffer still comes back as far as it got
  const arquivos = d.saida ? fatiaDiff(d.saida) : [];
  const soltos = await git(cwd, ["ls-files", "--others", "--exclude-standard", "-z", "--", "."], 4 * 1024 * 1024);
  const nomes = soltos.saida.split("\0").filter(Boolean), tem = new Set(arquivos.map((a) => a.caminho));
  for (const rel of nomes.slice(0, GIT_NOVOS_MAX)) { if (tem.has(rel)) continue; const a = arquivoNovo(cwd, rel.replace(/\\/g, "/")); if (a) arquivos.push(a); }
  for (const a of arquivos) a.abs = path.join(cwd, a.caminho);
  arquivos.sort((a, b) => a.caminho.localeCompare(b.caminho));
  return { git: true, arquivos, truncado: (!!d.erro && !!d.saida) || nomes.length > GIT_NOVOS_MAX };
});
// Undo one file's changes: restore tracked files from HEAD, delete new ones.
ipcMain.handle("git_reverter", async (e, rel) => {
  const cwd = J(e)?.cwd, raiz = cwd && caminhoReal(cwd);
  if (!raiz || typeof rel !== "string" || !rel) return { ok: false, erro: "Sem pasta." };
  const abs = path.resolve(raiz, rel);
  // a deleted folder is recreated by the restore, so check its nearest ancestor that still exists
  let acima = path.dirname(abs), pai = caminhoReal(acima);
  while (!pai && acima !== path.dirname(acima)) { acima = path.dirname(acima); pai = caminhoReal(acima); }
  if (!sobRaiz(raiz, abs) || abs === raiz || !pai || !sobRaiz(raiz, pai)) return { ok: false, erro: "Fora da pasta." };
  const alvo = path.relative(raiz, abs).replace(/\\/g, "/");
  const falha = (r) => ({ ok: false, erro: r.err.trim() || String(r.erro.message) });
  if (!(await git(raiz, ["cat-file", "-e", "HEAD:./" + alvo], 1024)).erro) {
    const r = await git(raiz, ["--literal-pathspecs", "restore", "--source=HEAD", "--staged", "--worktree", "--", alvo], 1024 * 1024);
    return r.erro ? falha(r) : { ok: true };
  }
  if (!(await git(raiz, ["--literal-pathspecs", "ls-files", "--error-unmatch", "--", alvo], 1024 * 1024)).erro) { const r = await git(raiz, ["--literal-pathspecs", "rm", "-f", "-q", "--", alvo], 1024 * 1024); if (r.erro) return falha(r); }
  try { fs.rmSync(abs, { force: true }); return { ok: true }; } catch (x) { return { ok: false, erro: String(x.message || x) }; }
});

// Answers to Claude's questions go back as the tool's input with the answers.
ipcMain.handle("responder", (_e, { id, respostas }) => {
  const p = pendentes.get(id); if (!p) return;
  pendentes.delete(id); p.t.pendentes.delete(id); avisaTurnos();
  if (!respostas) p.resolve({ behavior: "deny", message: "A pessoa preferiu não responder." });
  else p.resolve({ behavior: "allow", updatedInput: { ...p.input, answers: respostas } });
});
// Undo: put the files back as they were when a message was sent. A short
// query on the conversation does it when no turn is running.
ipcMain.handle("desfazer", async (e, { uuid, simular }) => {
  const { sessionId, atual, cwd } = J(e);
  if (!sessionId || !uuid) return { canRewind: false, error: "Sem conversa." };
  if (atual) return await atual.q.rewindFiles(uuid, { dryRun: !!simular }).catch((e) => ({ canRewind: false, error: String(e.message || e) }));
  const ac = new AbortController();
  let solta;
  const espera = new Promise((r) => (solta = r));
  const q = query({ prompt: (async function* () { await espera; })(), options: { cwd, resume: sessionId, enableFileCheckpointing: true, abortController: ac } });
  try { return await q.rewindFiles(uuid, { dryRun: !!simular }); }
  catch (e) { return { canRewind: false, error: String(e.message || e) }; }
  finally { solta(); ac.abort(); q.return?.().catch(() => {}); }
});
// A running turn keeps going in the background; the window starts afresh.
ipcMain.handle("nova", (e) => { const j = J(e); j.sessionId = null; j.atual = null; enviarEvento(j, { tipo: "config", ...cfgJ(j) }); return true; });
// The Claude app (Code tab) keeps its own record of each conversation — the
// title it shows, whether it is archived — next to the transcript Claude Code
// writes. Reading those records lets the list use the same names the person
// sees there. Read-only; files are re-read only when they change.
const pastasDoApp = () => {
  const bases = [path.join(process.env.LOCALAPPDATA || "", "Claude-Data"), path.join(app.getPath("appData"), "Claude")];
  const out = [];
  for (const b of bases) {
    try {
      if (fs.existsSync(path.join(b, "claude-code-sessions"))) out.push(path.join(b, "claude-code-sessions"));
      for (const d of fs.readdirSync(b)) if (fs.existsSync(path.join(b, d, "claude-code-sessions"))) out.push(path.join(b, d, "claude-code-sessions"));
    } catch {}
  }
  return out;
};
const registrosDoApp = new Map(); // file -> { mtime, info }
function titulosDoApp() {
  const porSessao = new Map(), vistos = new Set();
  const anda = (d) => { let itens = []; try { itens = fs.readdirSync(d, { withFileTypes: true }); } catch {} for (const it of itens) { const p = path.join(d, it.name); if (it.isDirectory()) anda(p); else if (/^local_.*\.json$/.test(it.name)) le(p); } };
  const le = (p) => {
    vistos.add(p);
    try {
      const mtime = fs.statSync(p).mtimeMs, c = registrosDoApp.get(p);
      let info = c?.mtime === mtime ? c.info : null;
      if (!info) {
        const j = JSON.parse(fs.readFileSync(p, "utf8"));
        info = { cli: j.cliSessionId, titulo: j.title || "", doUsuario: j.titleSource === "user", arquivada: !!j.isArchived, quando: j.lastActivityAt || 0 };
        registrosDoApp.set(p, { mtime, info });
      }
      if (info.cli) porSessao.set(info.cli, info);
    } catch {}
  };
  for (const d of pastasDoApp()) anda(d);
  for (const p of registrosDoApp.keys()) if (!vistos.has(p)) registrosDoApp.delete(p);
  return porSessao;
}

// Conversations: this window's folder, or every project Claude Code has
// worked in (the terminal, the Claude app, other windows: all the same files).
// Scratch folders the Claude app makes for loose chats count as one project.
const projeto = (cwd) => {
  if (!cwd) return "Sem pasta";
  if (/[\\/]scratch-workspaces[\\/]|[\\/]scratch-\d{4}-\d\d-\d\d-[0-9a-f]+$/i.test(cwd)) return "Rascunhos";
  return cwd.split(/[\\/]/).filter(Boolean).pop();
};
ipcMain.handle("sessoes", async (e, { todas } = {}) => {
  try {
    const lista = await listSessions(todas ? { limit: 600 } : { dir: J(e).cwd, limit: 300 }), doApp = titulosDoApp();
    return lista.map((s) => {
      const a = doApp.get(s.sessionId);
      // a name the person gave wins (in the app or here); then the app's own title
      const titulo = (a?.doUsuario && a.titulo) || s.customTitle || a?.titulo || s.summary || s.firstPrompt || "Sem título";
      return { id: s.sessionId, titulo, quando: Math.max(s.lastModified || 0, a?.quando || 0), cwd: s.cwd || "", projeto: projeto(s.cwd), doApp: !!a, arquivada: !!a?.arquivada };
    });
  } catch { return []; }
});
// Opening a conversation from another project moves this window there, so
// Claude keeps working in the right folder.
ipcMain.handle("saida", (e, id) => saidasCheias.get(String(id)) ?? null);
ipcMain.handle("abrir_sessao", async (e, id, cwd) => {
  const j = J(e);
  if (cwd && cwd !== j.cwd && fs.existsSync(cwd)) j.cwd = cwd;
  j.sessionId = id; j.atual = null;
  let hist = [];
  try { hist = await historico(id, cwd || j.cwd); } catch {}
  if (j.sessionId !== id) return null;
  // A turn of this conversation still running (here or left in the
  // background): the window picks it up where it is, after the transcript.
  // An idle one (open in another window or not) comes to this window.
  const t = vivaDe(id);
  const cfg = cfgSessao(id);
  if (!t || (t.ativo && t.j !== j && !t.j.fechada)) return { hist, cfg, fundo: { ativas: [], concluidas: concluidasDe(id, cwd || j.cwd) } };
  t.j = j; j.atual = t;
  if (!t.ativo) return { hist, cfg, fundo: fundoLista(t) };
  return { hist, cfg, fundo: fundoLista(t), turno: { tid: t.tid, n: t.n, parcial: t.parcial, pendentes: [...t.pendentes.values()], subs: t.subs } };
});
// Branch: a new conversation with this one up to a reply (or all of it).
ipcMain.handle("ramificar", async (e, { id, uuid, titulo, cwd }) => {
  const j = J(e), origem = id || j.sessionId;
  if (!origem || (j.atual?.ativo && origem === j.sessionId)) return null;
  try {
    const dir = cwd && fs.existsSync(cwd) ? cwd : j.cwd;
    const r = await forkSession(origem, { dir, upToMessageId: uuid || undefined, title: titulo || undefined });
    guardaCfg(r.sessionId, cfgSessao(origem)); salvarConfig();
    j.cwd = dir; j.sessionId = r.sessionId;
    return { id: r.sessionId, titulo: titulo || "Ramo", cwd: dir };
  } catch (e) { console.log("[ramificar]", e?.message || e); return null; }
});
// Export a conversation as Markdown, where the person chooses.
ipcMain.handle("exportar", async (e, { id, titulo, cwd }) => {
  const nome = (titulo || t("conversa")).replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || t("conversa");
  const r = await dialog.showSaveDialog(J(e).win, { title: t("Exportar conversa"), defaultPath: path.join(app.getPath("documents"), nome + ".md"), filters: [{ name: "Markdown", extensions: ["md"] }] });
  if (r.canceled || !r.filePath) return null;
  try {
  const partes = [`# ${titulo || t("Conversa")}`, ""];
  for (const m of await historico(id, cwd || J(e).cwd)) {
    if (m.papel === "eu") partes.push(t("**Você:**") + (m.imagens ? " " + (m.imagens > 1 ? t("_({0} imagens)_", m.imagens) : t("_(1 imagem)_")) : ""), "", m.texto || "", "");
    else if (m.papel === "claude") partes.push("**Claude:**", "", m.texto, "");
    else partes.push(t("> Ferramenta: {0}", m.nome), "");
  }
  fs.writeFileSync(r.filePath, partes.join("\n"));
  return r.filePath;
  } catch (err) { return { erro: String(err?.message || err) }; }
});
// Search inside the conversations of this folder, not only their titles.
// The text of each one is kept until it changes, within a size budget: the Map
// keeps insertion order, so the least recently searched go first.
const textoDasSessoes = new Map();
const MAX_SESSOES_EM_CACHE = 150, MAX_CARACTERES_EM_CACHE = 20_000_000;
function guardaTexto(id, c) {
  textoDasSessoes.delete(id); textoDasSessoes.set(id, c);
  let total = 0;
  for (const v of textoDasSessoes.values()) total += v.texto.length;
  for (const k of textoDasSessoes.keys()) {
    if (textoDasSessoes.size <= MAX_SESSOES_EM_CACHE && total <= MAX_CARACTERES_EM_CACHE) break;
    if (k === id) continue;
    total -= textoDasSessoes.get(k).texto.length; textoDasSessoes.delete(k);
  }
}
ipcMain.handle("buscar", async (e, termo, todas) => {
  const t = String(termo || "").toLowerCase().trim();
  if (t.length < 2) return [];
  const achados = [];
  for (const s of await listSessions(todas ? { limit: 200 } : { dir: J(e).cwd, limit: 120 }).catch(() => [])) {
    let c = textoDasSessoes.get(s.sessionId);
    if (!c || c.quando !== s.lastModified) {
      const h = await historico(s.sessionId, s.cwd).catch(() => []);
      c = { quando: s.lastModified, texto: h.filter((m) => m.texto).map((m) => m.texto).join("\n") };
      guardaTexto(s.sessionId, c);
    } else { textoDasSessoes.delete(s.sessionId); textoDasSessoes.set(s.sessionId, c); }
    const i = c.texto.toLowerCase().indexOf(t);
    if (i >= 0) achados.push({ id: s.sessionId, trecho: (i > 40 ? "…" : "") + c.texto.slice(Math.max(0, i - 40), i + t.length + 70).replace(/\s+/g, " ") });
  }
  return achados;
});
ipcMain.handle("focar", (e) => { const w = J(e).win; if (w.isMinimized()) w.restore(); w.show(); w.focus(); });
ipcMain.handle("renomear", async (e, { id, titulo, cwd }) => { try { await renameSession(id, titulo, { dir: cwd || J(e).cwd }); return true; } catch { return false; } });
ipcMain.handle("apagar", async (e, id, cwd) => {
  if (turnoDe(id)) return false;
  const viva = vivaDe(id); if (viva) await fechaEspera([viva]);
  try {
    await deleteSession(id, { dir: cwd || J(e).cwd });
    textoDasSessoes.delete(id); esqueceTarefas(id);
    if (config.porSessao?.[id]) { delete config.porSessao[id]; salvarConfig(); }
    for (const o of janelas.values()) if (o.sessionId === id) { o.sessionId = null; if (o !== J(e)) enviarEvento(o, { tipo: "apagada", id }); }
    return true;
  } catch { return false; }
});
ipcMain.handle("pasta", async (e) => {
  const j = J(e);
  const r = await dialog.showOpenDialog(j.win, { title: t("Pasta do projeto"), defaultPath: j.cwd, properties: ["openDirectory"] });
  if (r.canceled || !r.filePaths[0]) return null;
  // A turn running here keeps its own folder and goes on in the background.
  config.cwd = j.cwd = r.filePaths[0]; j.sessionId = null; j.atual = null; salvarConfig(); return j.cwd;
});
// A new conversation straight in a project from the sidebar, no folder dialog.
ipcMain.handle("nova_em", (e, cwd) => {
  const j = J(e);
  if (!cwd || !fs.existsSync(cwd)) return null;
  config.cwd = j.cwd = cwd; j.sessionId = null; j.atual = null; salvarConfig();
  enviarEvento(j, { tipo: "config", ...cfgJ(j) });
  return j.cwd;
});
// Worktrees: a new conversation on its own branch in its own folder. It goes
// under <repo>/.claude/worktrees when the project already uses that, else next
// to the repo in <repo>-worktrees. Git runs with argument arrays only.
const mesmoCaminho = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const slugRamo = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
// The main repo's folder, and whether cwd is a linked worktree of it.
async function infoWorktree(cwd) {
  if (!cwd || !fs.existsSync(cwd)) return null;
  const r = await git(cwd, ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir"], 4096);
  const [topo, dir, comum] = r.saida.split(/\r?\n/).map((x) => x.trim());
  if (r.erro || !topo || !comum) return null;
  return { topo, raiz: path.dirname(comum), ligado: !mesmoCaminho(dir, comum) };
}
ipcMain.handle("worktree_info", async (e, cwd) => { const w = await infoWorktree(cwd); return w ? { git: true, ligado: w.ligado, raiz: w.raiz, topo: w.topo } : { git: false }; });
ipcMain.handle("worktree_criar", async (e, texto) => {
  const j = J(e);
  if (j.atual?.ativo) return { erro: t("Espere o Claude terminar para criar um worktree.") };
  const w = await infoWorktree(j.cwd);
  if (!w) return { erro: t("Esta pasta não é um repositório git.") };
  const base = fs.existsSync(path.join(w.raiz, ".claude", "worktrees")) ? path.join(w.raiz, ".claude", "worktrees") : w.raiz + "-worktrees";
  const nome = slugRamo(texto) || "conversa";
  let ramo = nome, dir = path.join(base, ramo);
  for (let i = 2; i < 50; i++) {
    const existe = !(await git(j.cwd, ["rev-parse", "--verify", "-q", "refs/heads/" + ramo], 1024)).erro;
    if (!existe && !fs.existsSync(dir)) break;
    ramo = `${nome}-${i}`; dir = path.join(base, ramo);
  }
  const r = await git(j.cwd, ["worktree", "add", "-b", ramo, dir]);
  if (r.erro) return { erro: (r.err || String(r.erro.message)).trim().split("\n").pop() };
  config.cwd = j.cwd = dir; j.sessionId = null; salvarConfig();
  return { cwd: dir, ramo };
});
ipcMain.handle("worktree_remover", async (e, cwd) => {
  const w = await infoWorktree(cwd);
  if (!w?.ligado) return { erro: t("Esta pasta não é um worktree.") };
  const nela = [...turnos].filter((x) => x.cwd && mesmoCaminho(x.cwd, w.topo));
  if (nela.some((x) => x.ativo)) return { erro: t("Há uma resposta em andamento nesta pasta.") };
  if (nela.length) await fechaEspera(nela);
  // a terminal sitting in the folder would hold it open on Windows
  const dentro = (c) => { const rel = path.relative(w.topo, c || ""); return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)); };
  let matou = false;
  for (const o of janelas.values()) if (o.term && dentro(o.term.cwd)) { terminalMata(o, true); matou = true; }
  if (matou) await new Promise((ok) => setTimeout(ok, 400));
  // from the main repo, so the folder being removed is not git's own cwd; no --force: uncommitted work keeps it
  const r = await git(w.raiz, ["worktree", "remove", w.topo]);
  if (r.erro) return { erro: (r.err || String(r.erro.message)).trim().split("\n").pop() };
  for (const o of janelas.values()) if (mesmoCaminho(o.cwd, w.topo)) { o.cwd = w.raiz; o.sessionId = null; if (config.cwd && mesmoCaminho(config.cwd, w.topo)) config.cwd = w.raiz; }
  salvarConfig();
  return { cwd: w.raiz };
});

// The branch's pull request through the GitHub CLI, when it is installed:
// reading is automatic, pushing and creating only on a click.
const gh = (cwd, args, timeout = 20000) => new Promise((ok) => execFile(resolveExe("gh"), args, { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 4 << 20, timeout, env: { ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" } }, (erro, saida, err) => ok({ erro, saida: saida || "", err: String(err || "") })));
const CHECK_FALHA = /^(FAILURE|ERROR|TIMED_OUT|CANCELLED|ACTION_REQUIRED|STARTUP_FAILURE)$/, CHECK_OK = /^(SUCCESS|NEUTRAL|SKIPPED)$/;
ipcMain.handle("pr_info", async (e) => {
  const cwd = J(e)?.cwd, ramo = ramoGit(cwd);
  if (!cwd || !ramo || !fs.existsSync(cwd)) return { gh: false };
  const r = await gh(cwd, ["pr", "view", "--json", "number,title,state,url,statusCheckRollup"]);
  if (r.erro?.code === "ENOENT") return { gh: false };
  if (r.erro) return /no pull requests found/i.test(r.err) ? { gh: true, ramo, pr: null } : { gh: false };
  try {
    const d = JSON.parse(r.saida), cs = (d.statusCheckRollup || []).map((c) => String(c.conclusion || c.state || c.status || "").toUpperCase());
    const checks = { total: cs.length, ok: cs.filter((c) => CHECK_OK.test(c)).length, falhas: cs.filter((c) => CHECK_FALHA.test(c)).length };
    checks.pendentes = checks.total - checks.ok - checks.falhas;
    return { gh: true, ramo, pr: { numero: d.number, titulo: d.title, estado: d.state, url: d.url, checks } };
  } catch { return { gh: false }; }
});
ipcMain.handle("pr_criar", async (e) => {
  const cwd = J(e)?.cwd, ramo = ramoGit(cwd);
  if (!cwd || !ramo) return { erro: t("Esta pasta não está num ramo do git.") };
  const p = await git(cwd, ["push", "-u", "origin", "HEAD"], 1 << 20, 90000);
  if (p.erro) return { erro: (p.err || String(p.erro.message)).trim().split("\n").pop() };
  const r = await gh(cwd, ["pr", "create", "--fill"], 60000);
  if (r.erro) return { erro: (r.err || String(r.erro.message)).trim().split("\n").pop() };
  return { url: r.saida.trim().split(/\s+/).filter((x) => /^https?:/.test(x)).pop() || "" };
});

// Integrated terminal: one persistent shell per window, fed through stdin (no
// pty), its output streamed back as "terminal" events. Stopping kills the
// whole process tree and starts a fresh shell; closing the window or quitting
// kills it too, so nothing is left running.
function comandoDoTerminal() {
  if (process.platform !== "win32") return [process.env.SHELL || "/bin/bash", ["-s"]];
  const pwsh = resolveExe("pwsh");
  return [path.isAbsolute(pwsh) ? pwsh : resolveExe("powershell.exe"), ["-NoLogo", "-NoProfile", "-NoExit", "-Command", "-"]];
}
function terminalMata(j, sincrono) {
  const term = j.term;
  j.term = null;
  if (!term?.p.pid || term.p.exitCode !== null) return;
  if (process.platform === "win32") {
    const args = ["/pid", String(term.p.pid), "/T", "/F"];
    if (sincrono) { try { execFileSync("taskkill", args, { windowsHide: true, stdio: "ignore" }); } catch {} } else execFile("taskkill", args, { windowsHide: true }, () => {});
  } else { try { process.kill(-term.p.pid, "SIGTERM"); } catch { term.p.kill("SIGTERM"); } }
}
function terminalLiga(j) {
  if (j.term && mesmoCaminho(j.term.cwd, j.cwd) && j.term.p.exitCode === null) return j.term;
  terminalMata(j);
  const [exe, args] = comandoDoTerminal();
  const p = spawn(exe, args, { cwd: fs.existsSync(j.cwd) ? j.cwd : os.homedir(), windowsHide: true, detached: process.platform !== "win32", env: { ...process.env, NO_COLOR: "1", TERM: "dumb" } });
  const term = { p, cwd: j.cwd };
  j.term = term;
  const sai = (d) => { if (j.term === term) enviarEvento(j, { tipo: "terminal", texto: d }); };
  p.stdout.setEncoding("utf8"); p.stderr.setEncoding("utf8");
  p.stdout.on("data", sai); p.stderr.on("data", sai);
  p.stdin.on("error", () => {});
  p.on("error", (err) => { if (j.term === term) { j.term = null; enviarEvento(j, { tipo: "terminal", texto: String(err?.message || err) + "\n", fim: true }); } });
  p.on("exit", () => { if (j.term === term) { j.term = null; enviarEvento(j, { tipo: "terminal", fim: true }); } });
  if (process.platform === "win32") p.stdin.write("[Console]::OutputEncoding = [Text.UTF8Encoding]::new(); $OutputEncoding = [Text.UTF8Encoding]::new()\n");
  return term;
}
ipcMain.handle("term_enviar", (e, linha) => {
  const j = J(e);
  if (!j || typeof linha !== "string" || linha.length > 20000) return false;
  const term = terminalLiga(j);
  try { term.p.stdin.write(linha.replace(/\r?\n?$/, "\n\n")); return true; } catch { return false; }
});
ipcMain.handle("term_parar", (e) => { const j = J(e); if (!j) return false; terminalMata(j); terminalLiga(j); return true; });

// A change of model, mode, effort or ultracode goes to the conversation it was made in (or, in a new
// one, to the defaults) and into the turns running there; the rest of config is shared.
async function mudaConfig(j, mudanca, id = j.sessionId) {
  const m = {};
  for (const k of ["model", "modo", "esforco", "ultracode"]) if (k in mudanca) m[k] = k === "ultracode" ? !!mudanca[k] : String(mudanca[k] || "");
  if (m.modo && !MODOS.includes(m.modo)) delete m.modo;
  const turnosAfetados = [...turnos].filter((t) => t.q && !t.caixa?.fechada && ((id && t.sessionId === id) || (!id && t === j.atual)));
  if (id) guardaCfg(id, { ...cfgSessao(id), ...m });
  else Object.assign(config, m);
  for (const t of turnosAfetados) t.cfg = { ...t.cfg, ...m };
  salvarConfig(); avisaConfig();
  const falhou = new Set();
  for (const t of turnosAfetados) {
    const nao = await aplicaNoTurno(t, m);
    if (nao.length) t.reiniciar = true;
    for (const k of nao) falhou.add(k);
  }
  return [...falhou];
}
ipcMain.handle("config", async (e, mudanca) => {
  const { model, modo, esforco, ultracode, ...resto } = mudanca || {}, j = J(e);
  if (Object.keys(resto).length) { config = { ...config, ...resto }; salvarConfig(); }
  const depois = await mudaConfig(j, Object.fromEntries(Object.entries({ model, modo, esforco, ultracode }).filter(([, v]) => v !== undefined)));
  return { ...config, ...cfgJ(j), depois };
});
// Each window shows the choices of the conversation it holds.
function avisaConfig() { for (const o of janelas.values()) enviarEvento(o, { tipo: "config", ...cfgJ(o) }); }
// Everything the person customised (colours, fonts, sounds, music, icon, name).
ipcMain.handle("visual", () => config.visual || {});
// Sync, so the window can translate itself before it first paints.
ipcMain.on("i18n", (e) => { e.returnValue = { idioma: idioma(), dicionario: DICIONARIO }; });
ipcMain.handle("visual_salvar", (_e, visual) => {
  const antes = config.visual || {};
  config.visual = visual && typeof visual === "object" ? visual : {}; salvarConfig();
  if (antes.icone !== config.visual.icone) aplicaIcone();
  if (config.visual.nome) for (const o of janelas.values()) o.win.setTitle(config.visual.nome);
  for (const o of janelas.values()) if (o !== J(_e)) enviarEvento(o, { tipo: "visual", visual: config.visual });
  return config.visual;
});
ipcMain.handle("pessoal_lista", (_e, tipo) => listaPessoal(tipo));
ipcMain.handle("pessoal_importar", async (e, tipo, caminhos) => {
  if (!TIPOS[tipo]) return { erro: "Tipo desconhecido." };
  let lista = Array.isArray(caminhos) ? caminhos.filter(Boolean) : [];
  if (!lista.length) {
    const r = await dialog.showOpenDialog(J(e).win, { title: t("Escolher {0}", t(TIPOS[tipo].nome).toLocaleLowerCase()), filters: [{ name: t(TIPOS[tipo].nome), extensions: TIPOS[tipo].ext }], properties: ["openFile", ...(tipo === "icone" ? [] : ["multiSelections"])] });
    if (r.canceled) return { itens: [] };
    lista = r.filePaths;
  }
  const itens = [], erros = [];
  for (const c of lista) { try { itens.push(copiaPessoal(tipo, c)); } catch (e) { erros.push(String(e.message || e)); } }
  return { itens, erro: erros[0] };
});
ipcMain.handle("pessoal_apagar", (_e, tipo, id) => {
  try {
    const web = path.join(pastaWeb(), path.basename(String(id)));
    if (tipo === "fundos" && fs.existsSync(path.join(web, "claudie.json"))) fs.rmSync(web, { recursive: true, force: true });
    else if (TIPOS[tipo]) fs.unlinkSync(arquivoPessoal(tipo, id));
    return true;
  } catch { return false; }
});
ipcMain.handle("conta", () => ({ entrar: config.entrar || "login", temChave: !!config.chaveApi, claude: acharClaude(), cifra: safeStorage.isEncryptionAvailable() }));
ipcMain.handle("conta_salvar", (_e, { entrar, chave }) => {
  if (entrar === "login" || entrar === "chave") config.entrar = entrar;
  if (typeof chave === "string") {
    const c = chave.trim();
    if (!c) delete config.chaveApi;
    else if (!safeStorage.isEncryptionAvailable()) return { erro: "O sistema não oferece armazenamento seguro para a chave." };
    else config.chaveApi = safeStorage.encryptString(c).toString("base64");
  }
  salvarConfig();
  return { entrar: config.entrar || "login", temChave: !!config.chaveApi };
});
// ---- first launch check: Claude Code installed and signed in --------------------------
// The window asks once when the app opens. Missing Claude Code is installed with
// Anthropic's own script; signing in runs `claude auth login`, whose page link and
// "paste the code" prompt come to the window, or takes an API key saved above.
async function achaClaudeAsync() {
  if (claudeExe === undefined) { const r = await acharClaudeExeAsync(); if (claudeExe === undefined) { claudeExe = r.exe; claudeTentativas = r.tentativas; } }
  return claudeExe;
}
const rodaClaude = (exe, args) => new Promise((ok) => {
  const c = comandoClaude(exe, args);
  execFile(c.cmd, c.args, { env: c.env, timeout: 30000, windowsHide: true, encoding: "utf8" }, (e, out) => ok(e && !out ? null : String(out || "")));
});
ipcMain.handle("claude_checa", async () => {
  const exe = await achaClaudeAsync();
  if (!exe) return { instalado: temClaudeEmbutido(), logado: temClaudeEmbutido() ? null : false };
  const versao = ((await rodaClaude(exe, ["--version"])) || "").trim().split(/\s/)[0];
  if (config.entrar === "chave" && chaveApi()) return { instalado: true, versao, logado: true, metodo: "chave" };
  let s = null; try { s = JSON.parse((await rodaClaude(exe, ["auth", "status", "--json"])) || "null"); } catch {}
  // A Claude Code too old to say leaves the decision to its own first run.
  if (!s || typeof s.loggedIn !== "boolean") return { instalado: true, versao, logado: null };
  return { instalado: true, versao, logado: s.loggedIn, metodo: s.authMethod, email: s.email || "" };
});
let instalando = null, entrando = null;
const linhasPara = (e, fonte) => {
  let resto = "";
  return (b) => {
    const partes = (resto + b.toString()).split(/\r?\n/); resto = partes.pop();
    // the login prompt has no newline: send what is left when it looks like one
    if (/>\s*$/.test(resto)) { partes.push(resto); resto = ""; }
    for (const l of partes) if (l.trim()) enviarEvento(J(e), { tipo: "claude_setup", fonte, linha: l.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").slice(0, 2000) });
  };
};
ipcMain.handle("claude_instalar", (e) => instalando ??= new Promise((ok) => {
  const win = process.platform === "win32";
  const p = win
    ? spawn(resolveExe("powershell"), ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "irm https://claude.ai/install.ps1 | iex"], { windowsHide: true })
    : spawn("/bin/bash", ["-c", "curl -fsSL https://claude.ai/install.sh | bash"]);
  const linha = linhasPara(e, "instalar");
  p.stdout.on("data", linha); p.stderr.on("data", linha);
  const fim = async (codigo) => { instalando = null; claudeExe = undefined; const exe = await achaClaudeAsync(); ok({ ok: !!exe, codigo, exe }); };
  p.on("error", (err) => { linha(Buffer.from(String(err.message || err) + "\n")); fim(-1); });
  p.on("close", fim);
}));
ipcMain.handle("claude_entrar", async (e, { console: daConsole } = {}) => {
  const exe = await achaClaudeAsync();
  if (!exe) return { erro: "O Claude Code não está instalado." };
  try { entrando?.kill(); } catch {}
  const c = comandoClaude(exe, ["auth", "login", ...(daConsole ? ["--console"] : [])]);
  const p = entrando = spawn(c.cmd, c.args, { env: c.env, windowsHide: true });
  const linha = linhasPara(e, "entrar");
  p.stdout.on("data", linha); p.stderr.on("data", linha);
  p.on("error", (err) => linha(Buffer.from(String(err.message || err) + "\n")));
  p.on("close", (codigo) => { if (entrando === p) entrando = null; enviarEvento(J(e), { tipo: "claude_setup", fonte: "entrar", fim: true, codigo }); });
  return { ok: true };
});
ipcMain.handle("claude_codigo", (_e, codigo) => {
  if (!entrando || typeof codigo !== "string" || !codigo.trim()) return false;
  try { entrando.stdin.write(codigo.trim() + "\n"); return true; } catch { return false; }
});
ipcMain.handle("claude_entrar_cancela", () => { try { entrando?.kill(); } catch {} entrando = null; return true; });
ipcMain.handle("we_lista", () => listaWallpaperEngine());
ipcMain.handle("we_importar", async (_e, pasta) => { try { return { item: await importaWallpaperEngine(String(pasta)) }; } catch (e) { return { erro: String(e.message || e) }; } });
ipcMain.handle("barra", (e, claro) => { try { J(e).win.setTitleBarOverlay({ color: "#00000000", symbolColor: claro ? "#10323c" : "#e9e6e1" }); } catch {} });
ipcMain.handle("link", (_e, url) => { if (/^https?:/.test(url)) shell.openExternal(url); });

// The app was called Tessela before: its window storage (theme, sound, the
// intro already seen) and imported animations come along on the first start.
function trazDoNomeAntigo() {
  const antes = path.join(app.getPath("appData"), "Tessela"), agora = app.getPath("userData");
  for (const item of ["Local Storage", "motion"]) {
    const de = path.join(antes, item), para = path.join(agora, item);
    try { if (fs.existsSync(de) && !fs.existsSync(para)) fs.cpSync(de, para, { recursive: true }); } catch {}
  }
}

// Sync: any conversation written anywhere (the terminal, the Claude app,
// another window) updates every window's list a moment later.
function vigiaSessoes() {
  const pasta = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(app.getPath("home"), ".claude"), "projects");
  let timer = null;
  const avisa = () => { clearTimeout(timer); timer = setTimeout(() => { for (const j of janelas.values()) enviarEvento(j, { tipo: "sessoes_mudaram" }); }, 900); };
  // a watched folder that is deleted or renamed emits 'error' on Windows: without a listener that is an uncaught exception
  const vigia = (d, cb) => { try { fs.watch(d, { recursive: true }, cb).on("error", () => {}); } catch (e) { console.log("[sync] sem vigia:", e.message); } };
  try { fs.mkdirSync(pasta, { recursive: true }); } catch {} // a fresh install still gets live sync
  vigia(pasta, (_t, nome) => { if (!nome || /\.jsonl$/i.test(nome)) avisa(); });
  // the Claude app's records too: a title changed there shows up here
  for (const d of pastasDoApp()) vigia(d, avisa);
}

// Ctrl+Shift+Space brings the window up from anywhere (and hides it again).
function atalhoGlobal() {
  globalShortcut.register("Control+Shift+Space", () => {
    const win = (BrowserWindow.getFocusedWindow() && janelas.get(BrowserWindow.getFocusedWindow().webContents.id)?.win) || principal?.win;
    if (!win) return;
    if (win.isFocused()) win.minimize();
    else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  });
}

// One identity for the window and its shortcuts, so a pinned shortcut and the
// open window share one taskbar button and one icon.
const APP_ID = "com.claudie.app";
app.setAppUserModelId(APP_ID);
// the canvases, videos and web wallpapers go straight to the GPU
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
// Test runs (VIVO_PASTA / VIVO_JS) use a profile of their own, so they never
// touch the person's settings and can run with the app open.
if (process.env.VIVO_PASTA || process.env.VIVO_JS) app.setPath("userData", path.join(app.getPath("appData"), process.env.VIVO_PERFIL || "Claudie-teste"));
// A second copy only hands over to the first: it quits and sets nothing up.
const instanciaUnica = !!process.env.VIVO_ATALHOS || app.requestSingleInstanceLock();
if (!instanciaUnica) app.quit();
app.on("second-instance", () => {
  const w = principal?.win; if (!w) return;
  if (w.isMinimized()) w.restore(); w.show(); w.focus();
});
// Shortcuts that open the app with its icon: the Start Menu (where Windows
// lets you pin it to the taskbar) and the project folder.
// Run once with VIVO_ATALHOS=1.
function criaAtalhos() {
  const alvo = { target: process.execPath, args: `"${app.getAppPath()}"`, cwd: app.getAppPath(), icon: path.join(here, "icone.ico"), iconIndex: 0, appUserModelId: APP_ID, description: "Claudie: o Claude Code com papéis de parede vivos" };
  const lugares = [path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "Claudie.lnk"), path.join(app.getAppPath(), "Claudie.lnk")];
  for (const l of lugares) console.log("[atalho]", shell.writeShortcutLink(l, fs.existsSync(l) ? "replace" : "create", alvo) ? "ok" : "falhou", l);
}

// Web wallpapers are served from claudie-we://<id>/…: in a sandboxed frame a
// file:// page can't load its own scripts and images, a page on its own scheme
// can, and still can't reach anything outside its folder.
protocol.registerSchemesAsPrivileged([{ scheme: "claudie-we", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
function servePapelWeb() {
  protocol.handle("claudie-we", async (req) => {
    const u = new URL(req.url), raiz = path.join(pastaWeb(), path.basename(u.hostname));
    const arquivo = path.normalize(path.join(raiz, decodeURIComponent(u.pathname)));
    if (!arquivo.startsWith(raiz + path.sep)) return new Response("", { status: 403 });
    try {
      const r = await net.fetch(pathToFileURL(arquivo).href);
      return new Response(r.body, { status: r.status, headers: { "content-type": r.headers.get("content-type") || "application/octet-stream", "access-control-allow-origin": "*" } });
    } catch { return new Response("", { status: 404 }); }
  });
}

// ---- updates ---------------------------------------------------------------------------
// The installed app looks for a new release on GitHub (latest.yml next to the
// installer) a little after it opens and every six hours, downloads it in the
// background and tells the windows. It installs on "Reiniciar agora" or by
// itself the next time the app closes. Running from the code (npm start) it
// stays quiet. VIVO_FEED="http://..." points it at a test server instead.
let atualizacao = { estado: "parado", versao: app.getVersion() };
const avisaAtualizacao = (mudanca) => {
  atualizacao = { ...atualizacao, ...mudanca };
  if (process.env.VIVO_LOG || process.env.VIVO_FEED) console.log("[atualizacao]", JSON.stringify(atualizacao));
  for (const j of janelas.values()) enviarEvento(j, { tipo: "atualizacao", ...atualizacao });
};
let procuraAtualizacao = async () => avisaAtualizacao({ estado: "desligada" });
function iniciaAtualizacoes() {
  if (!(app.isPackaged || process.env.VIVO_FEED) || (process.env.VIVO_JS && !process.env.VIVO_FEED)) { atualizacao.estado = "desligada"; return; }
  const { autoUpdater } = atualizador;
  autoUpdater.autoDownload = true; autoUpdater.autoInstallOnAppQuit = !process.env.VIVO_FEED; autoUpdater.logger = null;
  if (process.env.VIVO_FEED) { autoUpdater.forceDevUpdateConfig = true; autoUpdater.setFeedURL({ provider: "generic", url: process.env.VIVO_FEED }); }
  autoUpdater.on("checking-for-update", () => avisaAtualizacao({ estado: "procurando" }));
  autoUpdater.on("update-not-available", () => avisaAtualizacao({ estado: "em_dia", nova: null }));
  autoUpdater.on("update-available", (i) => avisaAtualizacao({ estado: "baixando", nova: i.version, notas: i.releaseNotes || "", progresso: 0 }));
  autoUpdater.on("download-progress", (p) => avisaAtualizacao({ estado: "baixando", progresso: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (i) => avisaAtualizacao({ estado: "pronta", nova: i.version, progresso: 100 }));
  autoUpdater.on("error", (e) => avisaAtualizacao({ estado: "erro", detalhe: String(e?.message || e).split(/\r?\n/)[0].slice(0, 160) }));
  procuraAtualizacao = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(procuraAtualizacao, process.env.VIVO_FEED ? 1500 : 10000);
  setInterval(procuraAtualizacao, 6 * 3600e3);
  ipcMain.handle("atualizacao_instalar", () => { if (atualizacao.estado === "pronta") setImmediate(() => autoUpdater.quitAndInstall(false, true)); });
}
ipcMain.handle("atualizacao", () => atualizacao);
ipcMain.handle("atualizacao_procurar", () => { if (!["procurando", "baixando", "pronta"].includes(atualizacao.estado)) procuraAtualizacao(); return atualizacao; });

// Remote Control: Claude Code's own server (`claude remote-control`) in the
// window's folder, so claude.ai/code and the Claude app can start and drive
// sessions on this computer. Unlike the turns, it keeps running while it is on;
// the sessions it makes land in the conversation list like any other.
let remoto = { estado: "desligado", cwd: "", url: "", texto: "" }, remotoProc = null;
function avisaRemoto(mudanca) {
  remoto = { ...remoto, ...mudanca };
  for (const o of janelas.values()) enviarEvento(o, { tipo: "remoto", ...remoto });
}
function ligaRemoto(cwd) {
  const exe = acharClaude();
  if (!exe) return avisaRemoto({ estado: "erro", texto: "O Remote Control precisa do Claude Code instalado neste computador." });
  const c = comandoClaude(exe, ["remote-control", "--name", `Claudie · ${path.basename(cwd)}`]);
  const p = spawn(c.cmd, c.args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: c.env });
  remotoProc = p;
  avisaRemoto({ estado: "conectando", cwd, url: "", texto: "" });
  let resto = "";
  // The server redraws a small status screen: "Connected" (or "Ready"), the
  // pre-created session as a terminal hyperlink, and the environment's link.
  const le = (b) => {
    if (remotoProc !== p) return; // output still in flight from a server that was stopped
    const linhas = (resto + b.toString()).split(/\r?\n|\r/);
    resto = linhas.pop();
    for (const cru of linhas) {
      const sessao = cru.match(/\x1b\]8;;(https:\/\/claude\.ai\/code\/session_[^\x07\x1b]+)/)?.[1];
      const l = cru.replace(/\x1b\][^\x07]*\x07/g, "").replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").trim();
      if (!l) continue;
      const url = sessao || (!remoto.url.includes("/session_") && l.match(/https:\/\/claude\.ai\/code\S*/)?.[0]);
      if (url && url !== remoto.url) avisaRemoto({ url });
      if (/\b(Connected|Ready)\b/.test(l) && remoto.estado !== "pronto") avisaRemoto({ estado: "pronto" });
      if (/not trusted/i.test(l)) avisaRemoto({ texto: "Esta pasta ainda não é confiável para o Claude Code. Abra o claude nela uma vez no terminal e aceite." });
      else if (/^Error:/i.test(l)) avisaRemoto({ texto: l.replace(/^Error:\s*/i, "") });
    }
  };
  p.stdout.on("data", le); p.stderr.on("data", le);
  p.on("error", (e) => { if (remotoProc === p) { remotoProc = null; avisaRemoto({ estado: "erro", url: "", texto: String(e?.message || e) }); } });
  p.on("exit", () => {
    if (remotoProc !== p) return;
    remotoProc = null;
    avisaRemoto(remoto.texto ? { estado: "erro", url: "" } : { estado: "desligado", url: "" });
  });
}
function desligaRemoto() {
  const p = remotoProc;
  remotoProc = null;
  // the server starts a worker per session, so the whole tree goes
  if (p?.pid && p.exitCode === null) {
    if (process.platform === "win32") { try { execFileSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch {} }
    else p.kill("SIGTERM");
  }
  if (remoto.estado !== "desligado") avisaRemoto({ estado: "desligado", url: "", texto: "" });
}
ipcMain.handle("remoto", () => remoto);
ipcMain.handle("remoto_ligar", (e, ligar) => {
  if (!ligar) desligaRemoto();
  else if (!remotoProc) ligaRemoto(J(e).cwd);
  return remoto;
});
app.on("before-quit", () => { desligaRemoto(); for (const t of turnos) { encerra(t); t.ac.abort(); } for (const j of janelas.values()) terminalMata(j, true); });

app.whenReady().then(() => {
  if (!instanciaUnica) return;
  if (process.env.VIVO_ATALHOS) { criaAtalhos(); app.quit(); return; }
  servePapelWeb(); trazDoNomeAntigo(); lerConfig(); criarJanela(); setTimeout(aquecerClaude, 1500); atalhoGlobal(); vigiaSessoes(); iniciaAtualizacoes();
});
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => app.quit());
