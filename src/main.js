// Main process: the window, and the bridge to Claude Code through the Agent
// SDK. Every turn is a query() that resumes the conversation's session; its
// messages are forwarded to the window as small events, and tool permission
// requests wait for the person's answer in the window.

import { app, BrowserWindow, Menu, Tray, Notification, powerSaveBlocker, powerMonitor, ipcMain, dialog, shell, globalShortcut, nativeImage, protocol, net, safeStorage, session, WebContentsView, screen } from "electron";
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
import { servidorComputadorPara, FERRAMENTAS_COMPUTADOR, PROMPT_COMPUTADOR, liberaControle, liberaTudo, listaApps, appsMencionados, preAprova, linhaApps } from "./computador.js";
import { iniciaNavegador, FERRAMENTAS_NAVEGADOR, PROMPT_NAVEGADOR } from "./navegador.js";
import { iniciaAgenda, traduzErro, validaRepete, proximaExecucao } from "./agendadas.js";
import { nomeMcpValido, idPluginValido, fonteMercadoValida, lerSkills, criarSkill, apagarSkill, caminhoSkill, pastaDeSkills, catalogo, ansi, redige, ringLog } from "./extensoes.js";
import { iniciaCaptura } from "./captura.js";
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
  if (claudeExe !== undefined) return Promise.resolve();
  return acharClaudeExeAsync().then((r) => { if (claudeExe === undefined) { claudeExe = r.exe; claudeTentativas = r.tentativas; } }).catch(() => {});
}
const temClaudeEmbutido = () => { try { return fs.existsSync(path.join(path.dirname(fileURLToPath(import.meta.resolve("@anthropic-ai/claude-agent-sdk"))), "..", "claude-agent-sdk-" + process.platform + "-" + process.arch)); } catch { return false; } };
function chaveApi() {
  if (!config.chaveApi) return "";
  try { return safeStorage.decryptString(Buffer.from(config.chaveApi, "base64")); } catch { return ""; }
}
// What Claude Code prints about its connectors, kept in memory per conversation folder and
// server (cwd|name, cwd|* for lines that name none), capped, ANSI-stripped and redacted. Only
// conversation queries pass logMcp: the throwaway helper queries would fill it with start-up noise.
const logsMcp = new Map(), nomesMcp = new Map(); // nomesMcp: cwd -> names of its connectors
// whole-name match, so "git" does not claim a line about "github"
function citaNome(l, n) {
  for (let i = l.indexOf(n); i >= 0; i = l.indexOf(n, i + 1)) {
    if (!/[\w.-]/.test(l[i - 1] ?? " ") && !/[\w.-]/.test(l[i + n.length] ?? " ")) return true;
  }
  return false;
}
// a folder nobody has open any more keeps no connector names or logs
function esquecePastaMcp(cwd) {
  nomesMcp.delete(cwd);
  for (const m of [logsMcp, ultimaFalhaMcp]) for (const k of [...m.keys()]) if (k.startsWith(cwd + "|")) m.delete(k);
}
function alimentaLogMcp(cwd, chunk) {
  const nomes = nomesMcp.get(cwd);
  for (const l of ansi(chunk).split(/\r?\n/)) {
    if (!/mcp/i.test(l)) continue;
    const nome = /MCP server "([^"]+)"/.exec(l)?.[1] || (nomes && [...nomes].find((n) => citaNome(l, n)));
    ringLog(logsMcp, `${cwd}|${nome || "*"}`, l);
  }
}
// Without it Claude Code skips next-prompt suggestions near the usage limit and in many sessions.
process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION ??= "true";
// every query goes through here: the person's Claude Code and the chosen sign-in
function query({ logMcp, ...args }) {
  const exe = acharClaude();
  if (!exe && !temClaudeEmbutido()) throw new Error(claudeTentativas.length
    ? t("Não consegui iniciar o Claude Code neste computador. Tentei: {0}. Instale a versão nativa em code.claude.com/docs/en/setup (ou defina CLAUDE_CODE_PATH) e abra o Claudie de novo.", claudeTentativas.slice(0, 4).join("; "))
    : t("Não encontrei o Claude Code neste computador. Instale em code.claude.com/docs/en/setup e abra o Claudie de novo."));
  // SDK runs are non-interactive, where Claude Code loads Claude in Chrome only with --chrome
  const extra = { extraArgs: { chrome: null } };
  if (logMcp) { extra.extraArgs["debug-to-stderr"] = null; extra.extraArgs.debug = "mcp"; extra.stderr = (d) => alimentaLogMcp(logMcp, String(d)); }
  if (exe) extra.pathToClaudeCodeExecutable = exe;
  const chave = config.entrar === "chave" ? chaveApi() : "";
  if (chave) extra.env = { ...process.env, ANTHROPIC_API_KEY: chave, ...(config.urlApi ? { ANTHROPIC_BASE_URL: config.urlApi } : {}) };
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
let config = { cwd: path.join(app.getPath("home"), "projetos"), ...PADROES, ultracode: false, padroes: 0, entradaRapida: { atalho: "Control+Alt+Space", ligada: true } };
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
// Model, permission mode, effort, ultracode and computer control belong to each conversation
// (config.porSessao); the top-level values are only what a new one starts with.
const MODOS = ["default", "acceptEdits", "plan", "auto", "bypassPermissions"];
const BYPASS = "bypassPermissions";
const ROTULO_MODO = { default: "Perguntar", acceptEdits: "Aceitar edições", plan: "Modo plano", auto: "Automático", bypassPermissions: "Ignorar permissões" };
// The default for new conversations is never bypass, even if a hand-edited config says so.
const cfgSessao = (id) => {
  const x = { model: config.model || "", modo: config.modo === BYPASS ? "default" : config.modo || "default", esforco: config.esforco || "", ultracode: !!config.ultracode, computador: false, ...(id && config.porSessao?.[id]) };
  return { ...x, modo: MODOS.includes(x.modo) ? x.modo : "default" };
};
// Bypass of a conversation that has no session yet lives on the window, never in config.
// Computer control chosen before the first message waits on the window too (the global default stays off).
const cfgJ = (j) => ({ ...cfgSessao(j?.sessionId), ...(!j?.sessionId && j?.modoBypass ? { modo: BYPASS } : {}), ...(!j?.sessionId && j?.computadorPendente ? { computador: true } : {}) });
// Forgets the conversation a window held (and a bypass or computer control chosen for it).
const limpaConversa = (j) => { j.sessionId = null; j.atual = null; j.modoBypass = false; j.computadorPendente = false; };
const guardaCfg = (id, c) => { (config.porSessao ||= {})[id] = { model: c.model || "", modo: c.modo || "default", esforco: c.esforco || "", ultracode: !!c.ultracode, computador: !!c.computador }; };
// Pushes a change into a running turn; what the CLI refuses waits for the next message.
async function aplicaNoTurno(t, m) {
  const falhou = [];
  const tenta = async (chave, fn) => { try { await fn(); } catch { falhou.push(chave); } };
  if ("modo" in m) {
    // The bypass switch is only honored by a Claude Code started with it, so entering or leaving it reopens.
    const entra = m.modo === BYPASS && !t.comBypass, sai = m.modo !== BYPASS && t.comBypass;
    if (entra || sai) falhou.push("modo");
    else await tenta("modo", () => t.q.setPermissionMode(m.modo || "default"));
  }
  if ("model" in m) await tenta("model", () => t.q.setModel(m.model || undefined));
  if ("esforco" in m) await tenta("esforco", () => t.q.applyFlagSettings({ effortLevel: m.esforco || null }));
  // A Claude Code started without Dynamic Workflows can't take ultracode live; it reopens with them on.
  if ("ultracode" in m) await tenta("ultracode", () => { if (m.ultracode && !t.workflows) throw new Error(); return t.q.applyFlagSettings({ ultracode: !!m.ultracode }); });
  // The computer-use server is part of what a Claude Code opens with: it reopens.
  if ("computador" in m) await tenta("computador", () => { throw new Error(); });
  return falhou;
}
const AVISO_SEM_WORKFLOWS = "O ultracode precisa de Dynamic Workflows, que o Claude Code não liberou nesta conta ou versão. Esta conversa segue sem ele.";
// Scheduled tasks, tray and keep-awake (ctrl exists once the app is ready; sairDeVez is set on every way out).
let ctrl = null, bandeja = null, sairDeVez = false, bloqueioEnergia = null, menuBandejaChave = "";
const notificacoes = new Set(); // a toast that is garbage-collected loses its click handler
function avisaTurnos() {
  const rodando = [...turnos].filter((t) => t.sessionId && t.ativo).map((t) => t.sessionId).concat(ctrl?.idsRodando() || []);
  const aguardando = [...turnos].filter((t) => t.sessionId && t.pendentes.size).map((t) => t.sessionId);
  for (const o of janelas.values()) enviarEvento(o, { tipo: "turnos", rodando, aguardando });
  mudouAtividade();
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
// A JSON file written whole through a temporary file, so a crash never leaves half of it.
function gravaJson(arquivo, obj) {
  try { fs.mkdirSync(path.dirname(arquivo), { recursive: true }); fs.writeFileSync(arquivo + ".tmp", JSON.stringify(obj, null, 2)); fs.renameSync(arquivo + ".tmp", arquivo); } catch {}
}
function salvarConfig() { gravaJson(configPath(), config); }
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
// The browser tools exist only for a real turn (t.pendentes), never for the idle queries of comConsulta (t is a window there).
const servidorTemasPara = (t) => createSdkMcpServer({
  name: "claudie",
  version: "0.2.0",
  instructions: `Este app mostra papéis de parede ASCII animados atrás da conversa. Há dois tipos: os ${Object.keys(TEMAS).length} temas do Claudie (interativos, com música) e a biblioteca ASCII Magic, com ` +
    `${MAGIA.pecas.size} animações. Quando a pessoa pedir um tema ou um visual, prefira um tema do Claudie se algum combinar; senão use buscar_fundo (em inglês: os nomes e tags da biblioteca são em inglês) e depois sugerir_fundo ou aplicar_fundo. ` +
    "Responda sempre no idioma em que a pessoa escreve. " +
    "Quando a pessoa pedir uma revisão das mudanças no app, chame report_findings uma vez em vez de escrever a lista de achados. " +
    "Use as ferramentas de sugerir para mostrar um cartão (a pessoa decide aplicar), e as de aplicar só se ela pedir para aplicar direto. Temas da Claudie: " +
    Object.entries(TEMAS).map(([id, nome]) => `${id} (${nome})`).join(", ") + ". Categorias da biblioteca: " + Object.entries(MAGIA.cats).map(([id, nome]) => `${id} (${nome})`).join(", ") + "." +
    (t?.pendentes ? " O painel do navegador do app mostra páginas ao lado da conversa: use browser_navigate, browser_screenshot, browser_read, browser_click e browser_type; servidor_listar, servidor_logs, servidor_iniciar e servidor_parar cuidam dos servidores de .claude/launch.json." : ""),
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
    tool("report_findings",
      "Mostra na conversa um cartão de revisão com os achados (arquivo, linha, severidade, resumo, sugestão). Chame uma vez ao terminar uma revisão e não repita a lista em texto.",
      {
        achados: z.array(z.object({
          file: z.string().max(2000),
          line: z.coerce.number().int().min(1).nullish(),
          severity: z.enum(["critical", "high", "medium", "low", "info"]),
          summary: z.string().max(2000),
          suggestion: z.string().max(2000).nullish(),
        })).max(200),
        resumo: z.string().max(2000).optional(),
      },
      async ({ achados, resumo }) => texto(`${achados.length} achados mostrados na conversa.${resumo ? " Resumo: " + resumo : ""} Não repita a lista em texto.`),
      { alwaysLoad: true }),
    ...ferramentasNavegador(t),
  ],
});
const FERRAMENTAS_TEMA = ["sugerir_tema", "aplicar_tema", "buscar_fundo", "sugerir_fundo", "aplicar_fundo", "report_findings"].map((n) => `mcp__claudie__${n}`);
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
function montaPrompt(texto, anexos = [], uuid, avisa = () => {}, extra = "") {
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
  if (extra) corpo += `${corpo ? "\n\n" : ""}${extra}`;
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
  const caixa = { fila: primeira ? [primeira] : [], fechada: false, acorda: null };
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
function iconeAtual() {
  const id = config.visual?.icone;
  let img = id ? nativeImage.createFromPath(arquivoPessoal("icone", id)) : null;
  if (!img || img.isEmpty()) img = nativeImage.createFromPath(path.join(here, "icone.png"));
  return img;
}
function aplicaIcone() {
  const img = iconeAtual();
  for (const j of janelas.values()) try { j.win.setIcon(img); } catch {}
  try { bandeja?.setImage(img.resize({ width: 32, height: 32 })); } catch {}
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
  liberaControle(t);
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
// A card in the conversation's window that waits for the person's answer (or asks a question). Used by
// canUseTool and by the computer-use gate, whose tools are allowed in advance and so never reach it.
function pedePermissao(t, toolName, input, { signal, suggestions, decisionReason, site } = {}) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve({ behavior: "deny", message: "Cancelado." });
    if (!t.ativo) comecaTurno(t, crypto.randomUUID(), true);
    const id = crypto.randomUUID();
    pendentes.set(id, { resolve, suggestions, input, t, toolName, site });
    // Claude asking the person something: the choices become a form.
    const pedido = toolName === "AskUserQuestion" ? { tipo: "pergunta", id, perguntas: input.questions || [] }
      : { tipo: "permissao", id, ferramenta: toolName, entrada: input, motivo: decisionReason ?? null, temSempre: !!suggestions?.length };
    t.pendentes.set(id, pedido); t.ev(pedido); avisaTurnos();
    signal?.addEventListener("abort", () => {
      if (pendentes.delete(id)) { t.pendentes.delete(id); resolve({ behavior: "deny", message: "Cancelado." }); t.ev({ tipo: "permissao_fim", id }); avisaTurnos(); }
    });
  });
}
const depsComputador = { pedePermissao, enviarEvento, config: () => config, janelas, tr };
const { navegadorFecha, ferramentasNavegador, esqueceSites } = iniciaNavegador({ ipcMain, session, WebContentsView, J, janelas, enviarEvento, resolveExe, dentroDaPasta, matarArvore, ajustaImagem, pedePermissao, texto, tr, tool, z });
// texto null opens the conversation's Claude Code without a message (Remote Control).
// The mentioned apps a message grants (none for a slash command, whose text goes out as typed);
// they are approved with preAprova once the message is accepted.
const appsDaMensagem = (t, texto, apps) => (texto.startsWith("/") ? [] : appsMencionados(t, apps, config));
async function turno(j, texto, anexos, apps) {
  if (ocupadaPorAgenda(j, j.sessionId)) return;
  const viva = vivaDe(j.sessionId);
  if (viva && !viva.ativo && !viva.reiniciar && viva.cwd === j.cwd) {
    const uuid = crypto.randomUUID();
    viva.j = j; j.atual = viva; viva.remoto = false;
    comecaTurno(viva, uuid, !anexos.length && texto.startsWith("/"));
    const concedidos = await appsDaMensagem(viva, texto, apps);
    viva.caixa.poe(montaPrompt(texto, anexos, uuid, (m) => enviarEvento(j, { tipo: "erro", texto: m }), linhaApps(concedidos)));
    preAprova(viva, concedidos);
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
  t.comBypass = t.cfg.modo === BYPASS;
  // Until the query exists the window follows no tagged stream, so a setup failure is sent untagged.
  const aviso = (x) => (t.q ? ev(x) : enviarEvento(t.j, x));
  try {
  const concedidos = texto === null ? [] : await appsDaMensagem(t, texto, apps);
  t.caixa = caixaDeEntrada(texto === null ? null : montaPrompt(texto, anexos, uuid, (m) => enviarEvento(j, { tipo: "erro", texto: m }), linhaApps(concedidos)));
  preAprova(t, concedidos);
  const q = t.q = query({
    logMcp: t.cwd,
    prompt: t.caixa.gerador,
    options: {
      cwd: t.cwd,
      model: t.cfg.model || undefined,
      resume: t.sessionId || undefined,
      permissionMode: t.cfg.modo,
      // Only a process opened in bypass can be switched into it (a Remote Control client included).
      allowDangerouslySkipPermissions: t.cfg.modo === BYPASS ? true : undefined,
      effort: t.cfg.esforco || undefined,
      // Ultracode: Claude plans a workflow of many agents for each real task. It
      // only works with Dynamic Workflows on, so Claudie turns that on for this session.
      settings: t.cfg.ultracode ? { ultracode: true, enableWorkflows: true } : undefined,
      enableFileCheckpointing: true,
      thinking: geral.raciocinio === false ? undefined : { type: "adaptive", display: "summarized" },
      includePartialMessages: true,
      // After each turn Claude Code predicts the next prompt; it shows in the composer.
      promptSuggestions: true,
      abortController: ac,
      systemPrompt: { type: "preset", preset: "claude_code", append: [PROMPT_NAVEGADOR, ...(t.cfg.computador ? [PROMPT_COMPUTADOR] : [])].join("\n\n") },
      mcpServers: { claudie: servidorTemasPara(t), ...(t.cfg.computador ? { "computer-use": servidorComputadorPara(t, depsComputador) } : {}) },
      allowedTools: [...FERRAMENTAS_TEMA, ...FERRAMENTAS_PLANO, ...FERRAMENTAS_NAVEGADOR, ...(t.cfg.computador ? FERRAMENTAS_COMPUTADOR : [])],
      canUseTool: (toolName, input, opcoes) => pedePermissao(t, toolName, input, opcoes),
    },
  });
  turnos.add(t);
  j.atual = t;
  if (texto !== null) comecaTurno(t, uuid, !anexos.length && texto.startsWith("/"));
  comecou = true;
  if (querRemoto.has(t.sessionId)) ligaRemoto(t);
  if (desligadosMcp(t.cwd).length) q.mcpServerStatus().then((st) => aplicaDesligados(q, t.cwd, st)).catch(() => {});
  avisaTurnos();
    for await (const msg of q) {
      // A message sent from claude.ai/code or the Claude app shows here as the person's own.
      if (!t.ativo && msg.type === "user" && !msg.parent_tool_use_id && !msg.isReplay) {
        const c = msg.message?.content, txt = typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b.type === "text").map((b) => b.text).join("\n") : "";
        if (txt.trim()) { comecaTurno(t, crypto.randomUUID(), true); t.remoto = true; ev({ tipo: "remoto_msg", texto: txt }); }
      }
      // Claude can start a turn by itself while idle (a background task finished,
      // a message sent as the last turn ended); the window showing it follows it.
      if (!t.ativo && !msg.parent_tool_use_id && (msg.type === "assistant" || msg.type === "stream_event" && msg.event?.type === "message_start")) { comecaTurno(t, crypto.randomUUID(), true); t.remoto = true; }
      if (msg.session_id && msg.session_id !== t.sessionId) {
        t.sessionId = msg.session_id;
        if (novo && !config.porSessao?.[t.sessionId]) { guardaCfg(t.sessionId, t.cfg); salvarConfig(); }
        if (t.j.atual === t) { t.j.sessionId = t.sessionId; t.j.modoBypass = false; t.j.computadorPendente = false; }
        ev({ tipo: "sessao", id: t.sessionId }); avisaTurnos();
      }
      if (msg.type === "system" && msg.subtype === "bridge_state") {
        estadoRemoto(t, msg);
      } else if (msg.type === "system" && msg.subtype === "thinking_tokens") {
        ev({ tipo: "pensando", tokens: msg.estimated_tokens });
      } else if (msg.type === "system" && msg.subtype === "init") {
        ev({ tipo: "info", modelo: msg.model, cwd: msg.cwd, modo: msg.permissionMode });
        // The first init says what the CLI really started with (it can refuse bypass); the window follows it.
        if (msg.permissionMode && msg.permissionMode !== t.cfg.modo) {
          const era = t.cfg.modo;
          t.comBypass = msg.permissionMode === BYPASS;
          // A bypass the CLI reports is never saved: only the confirmation dialog can store it.
          if (!t.comBypass) {
            t.cfg = { ...t.cfg, modo: msg.permissionMode };
            if (t.sessionId) guardaCfg(t.sessionId, { ...cfgSessao(t.sessionId), modo: msg.permissionMode });
            salvarConfig(); avisaConfig();
          }
          ev({ tipo: "aviso", texto: tr("O Claude Code não aceitou o modo pedido ({0}) e abriu em outro modo.", tr(ROTULO_MODO[era] || era)) });
        }
        if (Array.isArray(msg.mcp_servers)) nomesMcp.set(t.cwd, new Set(msg.mcp_servers.map((s) => s.name)));
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
      } else if (msg.type === "prompt_suggestion") {
        // Arrives after the result, when the turn is already over: it goes to the window by conversation, not by turn.
        if (msg.suggestion) enviarEvento(t.j, { tipo: "sugestao", sid: t.sessionId, texto: String(msg.suggestion).slice(0, 2000) });
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
    liberaControle(t);
    turnos.delete(t);
    if (t.j.fechada && ![...turnos].some((o) => o.cwd === t.cwd)) esquecePastaMcp(t.cwd);
    // The bridge went with it; it comes back when the conversation opens again.
    if (remotos.has(t.sessionId)) avisaRemoto(t.sessionId, { estado: "desligado", url: "", texto: "" });
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
    // started at login (--oculto) the first window waits in the tray, when there is one
    show: !(process.argv.includes("--oculto") && bandeja && !principal && !process.env.VIVO_JS),
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
  // events for the renderer wait until it has finished starting (a reload starts it again)
  win.webContents.on("did-start-navigation", (d) => { if (d.isMainFrame && !d.isSameDocument) j.pronta = false; });
  win.on("focus", () => { ultimaFocada = j; });
  // The last window hides to the tray while something still has to run; a hidden window keeps its turns.
  win.on("close", (ev) => {
    if (sairDeVez || !ultimaVisivel(j) || !deveFicarNaBandeja()) return;
    ev.preventDefault(); win.hide(); avisaBandeja();
  });
  // Windows logoff or shutdown: the close that follows must not be held back.
  win.on("session-end", () => { sairDeVez = true; });
  // Dev servers and the page view go with the window itself (a hidden window keeps them).
  win.on("close", (ev) => { if (!ev.defaultPrevented) navegadorFecha(j); });
  win.on("closed", () => {
    // A turn running here stops; an idle Claude Code stays open for the conversation.
    for (const t of turnos) if (t.j === j && t.ativo) t.ac.abort();
    j.fechada = true;
    janelas.delete(id);
    terminalMata(j);
    navegadorFecha(j);
    for (const p of filhosMcp) if (p.janela === j) matarArvore(p);
    if (principal === j) principal = janelas.values().next().value || null;
    if (ultimaFocada === j) ultimaFocada = null;
    // A hidden Quick Entry or overlay would keep the process alive after the last window.
    if (!janelas.size) { rapida?.destroy(); rapida = null; captura.fechaOverlay(); if (!deveFicarNaBandeja()) app.quit(); }
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
      if (process.env.VIVO_FOTO) {
        fs.writeFileSync(process.env.VIVO_FOTO, (await win.webContents.capturePage()).toPNG());
        // the page view is a separate surface: capturePage of the window does not include it
        try { if (j.nav?.view) fs.writeFileSync(process.env.VIVO_FOTO.replace(/\.png$/i, "") + "-nav.png", (await j.nav.view.webContents.capturePage()).toPNG()); } catch (e) { console.log("[foto] erro:", e.message); }
      }
    }, 4500);
    if (process.env.VIVO_TESTE) turno(j, process.env.VIVO_TESTE, process.env.VIVO_ANEXO ? [{ caminho: process.env.VIVO_ANEXO }] : []);
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  return j;
}
// A conversation running in another window can't be opened to send here too.
const emOutra = (j, id) => { const t = turnoDe(id); return !!t && t.j !== j && !t.j.fechada; };
// A scheduled run still writing a session: a second Claude Code on it would write the same transcript.
function ocupadaPorAgenda(j, id) {
  if (!id || !ctrl?.idsRodando().includes(id)) return false;
  enviarEvento(j, { tipo: "erro", texto: t("Esta execução agendada ainda está em andamento") });
  enviarEvento(j, { tipo: "agendada_ocupada", id });
  return true;
}

ipcMain.handle("estado", (e) => ({ ...config, ...cfgJ(J(e)), cwd: J(e).cwd, sessionId: J(e).sessionId, rodando: !!J(e).atual?.ativo, temas: TEMAS, janelas: janelas.size, entradaRapida: cfgRapida(), rapidaErro }));
ipcMain.handle("enviar", (e, texto, anexos, apps) => {
  const j = J(e);
  if (j.atual?.ativo || (turnoDe(j.sessionId) && !emOutra(j, j.sessionId))) return false;
  if (ocupadaPorAgenda(j, j.sessionId)) return false;
  if (j.sessionId && emOutra(j, j.sessionId)) { enviarEvento(j, { tipo: "erro", texto: "Essa conversa está rodando em outra janela. Espere ela terminar." }); return false; }
  turno(j, String(texto), Array.isArray(anexos) ? anexos : [], Array.isArray(apps) ? apps : []); return j.atual?.tid || true;
});
// A message for the turn running in this window; false once it can no longer take one.
ipcMain.handle("injetar", async (e, texto, anexos, apps) => {
  const t = J(e).atual, s = String(texto || "");
  if (!t?.ativo || !t.caixa || t.caixa.fechada || (!Array.isArray(anexos) || !anexos.length) && s.startsWith("/")) return false;
  const concedidos = await appsDaMensagem(t, s, Array.isArray(apps) ? apps : []);
  const m = montaPrompt(s, Array.isArray(anexos) ? anexos : [], crypto.randomUUID(), (x) => enviarEvento(t.j, { tipo: "erro", texto: x }), linhaApps(concedidos));
  if (typeof m === "string" || t.caixa.fechada || !t.caixa.poe(m)) return false;
  preAprova(t, concedidos);
  return true;
});
// Paths the preload read from real dropped File objects; the window can't forge these.
ipcMain.on("anexo_soltou", (_e, p) => { if (typeof p === "string" && p) anexosPermitidos.add(p); });
ipcMain.handle("janela_nova", (_e, sessao) => { criarJanela(sessao || undefined); });
ipcMain.handle("arquivos", async (e, atualiza) => { try { return await arquivos(J(e), !!atualiza); } catch (err) { console.log("[arquivos]", err?.message || err); return []; } });
// The apps the @ picker offers while computer control is on (empty elsewhere than Windows).
ipcMain.handle("apps_computador", async (e) => {
  try { return (await listaApps(config, !!cfgJ(J(e)).computador)).map(({ nome, exe, nivel, icone }) => ({ nome, exe, nivel, icone })); } catch (err) { console.log("[apps]", err?.message || err); return []; }
});
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
  // A site card has no "always": only a plain yes lets the page load.
  if (p.site) return p.resolve(decisao === "sim" ? { behavior: "allow" } : { behavior: "deny", message: "A pessoa negou." });
  const feedback = String(texto || "").trim().slice(0, 2000), plano = p.toolName === "ExitPlanMode";
  if (decisao !== "sim" && decisao !== "sempre") p.resolve({ behavior: "deny", message: feedback ? (plano ? `A pessoa quer ajustar o plano antes de seguir: ${feedback}` : `A pessoa negou e pediu: ${feedback}`) : "A pessoa negou." });
  else if (plano) {
    // Approving a plan leaves plan mode for the mode the person chose, in the running turn and in the saved choice.
    const novo = MODOS.includes(modo) && modo !== "plan" && modo !== BYPASS ? modo : "default";
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
function claudeCli(args, cwd, { timeout = 45000, max = 1500, maxBuffer = 1 << 20 } = {}) {
  const exe = acharClaude();
  if (!exe) return Promise.resolve({ erro: "Não encontrei o Claude Code neste computador." });
  const c = comandoClaude(exe, args);
  return new Promise((ok) => execFile(c.cmd, c.args, { cwd, encoding: "utf8", windowsHide: true, timeout, maxBuffer, env: c.env },
    (erro, saida, err) => ok(erro ? { erro: String(err || saida || erro.message).trim().slice(0, max) } : { saida: String(saida).trim().slice(0, max) })));
}
// Same CLI for the Customize tabs: --json results, long output, and children that never wait for input.
// The last stdout line of an action holds its result ({outcome, message, failureCode, shownCommand});
// a list prints the whole document. A non-zero exit still carries a result, so it is parsed first.
function leJson(txt) {
  const s = String(txt || "").trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch {}
  const linhas = s.split(/\r?\n/);
  try { return JSON.parse(linhas.filter(Boolean).pop()); } catch {}
  // a notice printed before the document: parse from the first line that opens it
  const i = linhas.findIndex((l) => /^[{[]/.test(l));
  if (i > 0) { try { return JSON.parse(linhas.slice(i).join("\n")); } catch {} }
  return null;
}
function claudeJson(args, cwd, { timeout = 45000 } = {}) {
  const exe = acharClaude();
  if (!exe) return Promise.resolve({ erro: "Não encontrei o Claude Code neste computador.", semClaude: true });
  const c = comandoClaude(exe, args);
  return new Promise((ok) => {
    let estourou = false, timer;
    const filho = execFile(c.cmd, c.args, { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 16 << 20, env: c.env, detached: process.platform !== "win32" }, (erro, saida, err) => {
      clearTimeout(timer);
      if (estourou) return ok({ erro: "O Claude Code demorou demais para responder.", terminal: true });
      const dados = leJson(saida);
      if (dados && !Array.isArray(dados) && typeof dados === "object" && "outcome" in dados) {
        return ok(dados.outcome === "ok" ? { dados } : { dados, erro: String(dados.message || err || "Não deu certo.").slice(0, 1500), codigo: dados.failureCode });
      }
      if (dados != null) return ok({ dados });
      if (!erro) return ok({ dados: null, texto: String(saida).trim().slice(0, 1500) });
      ok({ erro: String(err || saida || erro?.message || "Resposta inesperada do Claude Code.").trim().slice(0, 1500) });
    });
    filho.stdin?.end();
    timer = setTimeout(() => { estourou = true; matarArvore(filho); }, timeout);
  });
}

// command line of a stdio server: split on spaces, keeping "quoted parts" together
const quebraComando = (txt) => [...txt.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
const ESCOPOS_MCP = ["user", "project", "local"];
// Claude Code reads its connectors when it starts: idle ones close now, running ones after the turn.
const reabreConversas = () => { for (const t of turnos) if (t.ativo) t.reiniciar = true; else encerra(t); };
// One connector sign-in at a time: `claude mcp login` opens a loopback callback, so two would fight over it.
let entrandoMcp = null;
const filhosMcp = new Set();
function mcpEntrar(j, nome) {
  const exe = acharClaude();
  if (!exe) return { erro: "Não encontrei o Claude Code neste computador." };
  if (entrandoMcp) return { erro: "Já há um login de conector em andamento." };
  const c = comandoClaude(exe, ["mcp", "login", nome]);
  const p = spawn(c.cmd, c.args, { cwd: j.cwd, env: c.env, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  p.janela = j; entrandoMcp = p; filhosMcp.add(p);
  const linha = linhasPara(j, (l) => ({ tipo: "mcp_login", nome, linha: redige(l) }));
  p.stdout.on("data", linha); p.stderr.on("data", linha);
  let acabou = false;
  const timer = setTimeout(() => matarArvore(p), 3 * 60e3);
  const fim = async (codigo) => {
    if (acabou) return;
    acabou = true; clearTimeout(timer); filhosMcp.delete(p);
    if (entrandoMcp === p) entrandoMcp = null;
    if (codigo === 0) {
      esquecePainel();
      try { await comConsulta(j, (q) => q.reconnectMcpServer(nome)); } catch {}
      esquecePainel(); reabreConversas();
    }
    enviarEvento(j, { tipo: "mcp_login", nome, fim: true, codigo });
  };
  p.on("error", (err) => { linha(Buffer.from(String(err.message || err) + "\n")); matarArvore(p); fim(-1); });
  p.on("close", (codigo) => fim(codigo ?? -1));
  return { ok: true };
}
// The same login in a terminal window of its own, for the case that needs a prompt (paste the redirect URL).
const TERMINAIS_LINUX = [["x-terminal-emulator", "-e"], ["gnome-terminal", "--"], ["konsole", "-e"], ["xterm", "-e"]];
const terminalLinux = () => {
  for (const [exe, flag] of TERMINAIS_LINUX) for (const d of (process.env.PATH || "").split(path.delimiter)) if (d && fs.existsSync(path.join(d, exe))) return [exe, flag];
  return null;
};
const terminalExterno = () => process.platform === "win32" || process.platform === "darwin" || !!terminalLinux();
function mcpTerminal(j, nome) {
  const exe = acharClaude();
  if (!exe) return { erro: "Não encontrei o Claude Code neste computador." };
  const c = comandoClaude(exe, ["mcp", "login", nome]);
  const op = { cwd: j.cwd, env: c.env, detached: true, stdio: "ignore" };
  let p;
  if (process.platform === "win32") {
    // start "" cmd /k "<command>": the empty quoted argument is the window title, the outer quotes keep the command in one piece
    // cmd expands %NAME% even inside quotes and has no escape for it on a command line
    if ([c.cmd, ...c.args, j.cwd].some((x) => x.includes("%"))) return { erro: "Um caminho com % não abre no terminal do Windows." };
    const q = (x) => (/[\s&()^|<>]/.test(x) ? `"${x}"` : x);
    p = spawn(resolveExe("cmd"), ["/c", "start", '""', "cmd", "/k", `"${[c.cmd, ...c.args].map(q).join(" ")}"`], { ...op, windowsVerbatimArguments: true });
  } else if (process.platform === "darwin") {
    const sh = (x) => "'" + x.replace(/'/g, "'\\''") + "'";
    const cmd = `cd ${sh(j.cwd)} && ` + [c.cmd, ...c.args].map(sh).join(" ");
    p = spawn("osascript", ["-e", `tell application "Terminal" to do script "${cmd.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`, "-e", 'tell application "Terminal" to activate'], op);
  } else {
    const t = terminalLinux();
    if (!t) return { erro: "Não encontrei um terminal neste computador." };
    p = spawn(t[0], [t[1], c.cmd, ...c.args], op);
  }
  p.on("error", () => {});
  p.unref();
  return { ok: true };
}
ipcMain.handle("mcp_acao", async (e, { acao, nome, escopo }) => {
  const j = J(e);
  if (typeof nome !== "string" || !nome || nome.startsWith("claude.ai ") || nome === "claudie" || nome === "computer-use") return { erro: "Esse conector não pode ser mudado aqui." };
  // a name reaches the CLI as an argument: only plain names. The SDK calls take any name the session reports (plugins name theirs plugin:x:y).
  const soSdk = acao === "ligar" || acao === "desligar" || acao === "reconectar";
  if (!soSdk && !nomeMcpValido(nome)) return { erro: nome.startsWith("plugin:") ? "Os conectores de plugins são geridos pelo plugin." : "Nome de conector inválido." };
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
    if (acao === "entrar") return mcpEntrar(j, nome);
    if (acao === "terminal") return mcpTerminal(j, nome);
    if (acao === "sair") {
      const r = await claudeCli(["mcp", "logout", nome], j.cwd);
      if (!r.erro) { esquecePainel(); reabreConversas(); }
      return r;
    }
  } catch (err) { esquecePainel(); return { erro: String(err?.message || err) }; }
  return { erro: "Ação desconhecida." };
});
// Adds a connector through the CLI (the form and the catalog both land here).
async function adicionaMcp(j, d) {
  const nome = String(d?.nome || "").trim(), escopo = d?.escopo;
  if (!/^[\w.-]{1,64}$/.test(nome) || nome.startsWith("-")) return { erro: "Use só letras, números, ponto, hífen e sublinhado no nome." };
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
}
ipcMain.handle("mcp_adicionar", (e, d) => adicionaMcp(J(e), d));
// What Claude Code printed for one connector of this conversation's folder.
ipcMain.handle("mcp_logs", (e, { nome } = {}) => {
  if (!nomeMcpValido(nome)) return { erro: "Nome de conector inválido." };
  return { linhas: logsMcp.get(`${J(e).cwd}|${nome}`) || [] };
});
ipcMain.handle("mcp_logs_limpar", (e, { nome } = {}) => {
  if (!nomeMcpValido(nome)) return { erro: "Nome de conector inválido." };
  logsMcp.delete(`${J(e).cwd}|${nome}`);
  return { linhas: [] };
});
// The catalog, each entry marked when this folder already has that server (by URL or by name).
ipcMain.handle("conectores_catalogo", async (e) => {
  const j = J(e);
  let st = null, timer;
  try { st = await Promise.race([comConsulta(j, (q) => q.mcpServerStatus()), new Promise((r) => (timer = setTimeout(() => r(null), 3000)))]); } catch {}
  clearTimeout(timer);
  const nomes = new Set((st || []).map((c) => c.name)), urls = new Set((st || []).map((c) => c.config?.url).filter(Boolean));
  return { semClaude: !acharClaude(), itens: catalogo().map((c) => ({ ...c, jaAdicionado: nomes.has(c.id) || urls.has(c.url) })) };
});

// ---- plugins ---------------------------------------------------------------------------
// Everything goes through the Claude Code CLI so the plugin settings stay Claude Code's own.
// Writes run one at a time: a double click or a second window never edits the settings twice at once.
let filaPlugins = Promise.resolve();
const naFila = (fn) => (filaPlugins = filaPlugins.then(fn, fn));
const VERBOS_PLUGIN = { instalar: "install", ativar: "enable", desativar: "disable", desinstalar: "uninstall", atualizar: "update" };
const invalidaPlugins = () => {
  for (const k of respostas.keys()) if (k.startsWith("plugins|") || k.startsWith("comandos|")) respostas.delete(k);
  esquecePainel(); reabreConversas();
};
// What the CLI says about a write: done, or an error; consent that needs a terminal is never accepted for the person.
function resultadoPlugin(r) {
  if (r.dados?.shownCommand) return { erro: r.dados.message || r.erro || "Este plugin pede uma confirmação no terminal.", terminal: true };
  if (r.terminal) return { erro: r.erro, terminal: true };
  if (r.erro && r.codigo !== "already_in_goal_state") return { erro: r.erro };
  invalidaPlugins();
  return { ok: true, mensagem: r.dados?.message || r.texto || "" };
}
ipcMain.handle("plugins_lista", async (e) => {
  const j = J(e);
  if (!acharClaude()) return { semClaude: true };
  try {
    return await comCache(`plugins|${j.cwd}`, 20e3, async () => {
      const [a, m] = await Promise.all([claudeJson(["plugin", "list", "--json", "--available"], j.cwd), claudeJson(["plugin", "marketplace", "list", "--json"], j.cwd)]);
      if (a.erro || !a.dados) throw new Error(a.erro || "Resposta inesperada do Claude Code.");
      return {
        instalados: (a.dados?.installed || []).map((p) => ({ id: p.id, versao: p.version || "", escopo: p.scope || "", ativo: !!p.enabled })),
        disponiveis: (a.dados?.available || []).map((p) => ({ id: p.pluginId, nome: p.name, descricao: String(p.description || "").slice(0, 300), mercado: p.marketplaceName || "", versao: p.version || "" })),
        mercados: (Array.isArray(m.dados) ? m.dados : []).map((x) => ({ nome: x.name, fonte: x.repo || x.url || x.path || x.source || "" })),
      };
    });
  } catch (err) { return { erro: String(err?.message || err) }; }
});
ipcMain.handle("plugin_acao", (e, d) => {
  const j = J(e), verbo = VERBOS_PLUGIN[d?.acao];
  if (!verbo) return { erro: "Ação desconhecida." };
  if (!idPluginValido(d.id)) return { erro: "Identificador de plugin inválido." };
  if (!ESCOPOS_MCP.includes(d.escopo)) return { erro: "Escolha o escopo." };
  const args = ["plugin", verbo, d.id, "--scope", d.escopo, ...(verbo === "uninstall" ? ["--keep-data"] : []), "--json"];
  return naFila(async () => resultadoPlugin(await claudeJson(args, j.cwd, { timeout: verbo === "install" || verbo === "update" ? 180e3 : 45e3 })));
});
ipcMain.handle("mercado_acao", (e, d) => {
  const j = J(e), nome = typeof d?.nome === "string" ? d.nome.trim() : "";
  let args;
  if (d?.acao === "add") {
    if (!fonteMercadoValida(d.fonte)) return { erro: "Fonte inválida: use usuario/repositorio, um endereço https ou uma pasta existente." };
    if (!ESCOPOS_MCP.includes(d.escopo)) return { erro: "Escolha o escopo." };
    args = ["plugin", "marketplace", "add", d.fonte.trim(), "--scope", d.escopo, "--json"];
  } else if (d?.acao === "remove" || d?.acao === "update") {
    if (nome ? !idPluginValido(nome) : d.acao === "remove") return { erro: "Nome de marketplace inválido." };
    args = d.acao === "remove" ? ["plugin", "marketplace", "remove", nome, "--json"] : ["plugin", "marketplace", "update", ...(nome ? [nome, "--json"] : [])];
  } else return { erro: "Ação desconhecida." };
  return naFila(async () => {
    const r = await claudeJson(args, j.cwd, { timeout: 180e3 });
    return resultadoPlugin(r);
  });
});

// ---- skills ----------------------------------------------------------------------------
const aposSkills = () => { for (const k of respostas.keys()) if (k.startsWith("comandos|")) respostas.delete(k); reabreConversas(); };
ipcMain.handle("skills_lista", async (e) => {
  const j = J(e);
  let cmds = [], timer;
  try { cmds = await Promise.race([comandos(j), new Promise((r) => (timer = setTimeout(() => r([]), 6000)))]); } catch {}
  clearTimeout(timer);
  return { semClaude: !acharClaude(), skills: lerSkills(j.cwd), comandosPlugin: cmds.filter((c) => c.nome.includes(":")).map((c) => ({ nome: c.nome, descricao: c.descricao })) };
});
ipcMain.handle("skill_criar", (e, d) => {
  try {
    const r = criarSkill({ nome: d?.nome, descricao: d?.descricao, escopo: d?.escopo }, J(e).cwd);
    if (r.ok) aposSkills();
    return r;
  } catch (err) { return { erro: String(err?.message || err) }; }
});
ipcMain.handle("skill_apagar", (e, d) => {
  try {
    const r = apagarSkill(d?.origem, d?.pasta, J(e).cwd);
    if (r.ok) aposSkills();
    return r;
  } catch (err) { return { erro: String(err?.message || err) }; }
});
ipcMain.handle("skills_pasta", async (e, d) => {
  const dir = pastaDeSkills(d?.origem, J(e).cwd);
  if (!dir) return { erro: "Origem de skill inválida." };
  try { fs.mkdirSync(dir, { recursive: true }); } catch (err) { return { erro: String(err?.message || err) }; }
  const falha = await shell.openPath(dir);
  return falha ? { erro: falha } : { ok: true };
});
ipcMain.handle("skill_abrir", (e, d) => {
  try {
    const arq = path.join(caminhoSkill(d?.origem, d?.pasta, J(e).cwd), "SKILL.md");
    if (!fs.existsSync(arq)) return { erro: "Essa pasta não é uma skill." };
    shell.showItemInFolder(arq);
    return { ok: true };
  } catch (err) { return { erro: String(err?.message || err) }; }
});
// The reason a server failed goes into its log once per distinct text, and the names feed the log attribution.
const ultimaFalhaMcp = new Map();
function registraFalhasMcp(cwd, status) {
  nomesMcp.set(cwd, new Set(status.map((c) => c.name)));
  for (const c of status) {
    const chave = `${cwd}|${c.name}`;
    if (c.status !== "failed" || !c.error) { ultimaFalhaMcp.delete(chave); continue; }
    if (ultimaFalhaMcp.get(chave) === c.error) continue;
    ultimaFalhaMcp.set(chave, c.error);
    ringLog(logsMcp, chave, c.error);
  }
}
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
    registraFalhasMcp(j.cwd, conectores || []);
    return {
      ambiente: { ...ambiente, modelo: contexto?.model || ambiente.modelo },
      contexto: contexto && { total: contexto.totalTokens, max: contexto.maxTokens, pct: contexto.percentage, categorias: (contexto.categories || []).map((c) => ({ nome: c.name, tokens: c.tokens, cor: c.color, tipo: c.kind || (c.isDeferred ? "deferred" : "used") })), memoria: (contexto.memoryFiles || []).map((m) => ({ caminho: m.path, tokens: m.tokens })) },
      conectores: (conectores || []).map((c) => ({ nome: c.name, estado: c.status, erro: c.error || "", escopo: c.scope || c.source || "", ferramentas: c.tools?.length ?? null, tipo: c.config?.type || "", embutido: c.source === "sdk" || c.name === "claudie" || c.name === "computer-use" })),
      terminalExterno: terminalExterno(),
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
// Text of an html/svg/markdown file Claude wrote, for the Artifacts window. Read-only, same
// roots as "abrir_arquivo", plain preview types only and a size cap.
ipcMain.handle("artefato_ler", (e, caminho) => {
  if (typeof caminho !== "string" || !caminho) return { erro: "fora" };
  const j = J(e), base = j?.atual?.cwd || j?.cwd || config.cwd;
  const abs = path.resolve(base, caminho), real = caminhoRealSeguro(abs);
  const TIPO = /\.(html?|svg|md|markdown)$/i;
  // a file that no longer exists has no real path: inside an allowed folder it is a failed read
  if (!real) return { erro: dentroDeRaizPermitida(abs) && TIPO.test(abs) ? "leitura" : "fora" };
  if (!dentroDeRaizPermitida(real)) return { erro: "fora" };
  if (!TIPO.test(real)) return { erro: "tipo" };
  try {
    const st = fs.statSync(real);
    if (!st.isFile() || st.size > 2 * 1024 * 1024) return { erro: "grande" };
    return { texto: fs.readFileSync(real, "utf8"), nome: path.basename(real) };
  } catch { return { erro: "leitura" }; }
});
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
ipcMain.handle("nova", (e) => { const j = J(e); limpaConversa(j); enviarEvento(j, { tipo: "config", ...cfgJ(j) }); return true; });
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
  j.sessionId = id; j.atual = null; j.modoBypass = false;
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
    guardaCfg(r.sessionId, { ...cfgSessao(origem), modo: cfgSessao(origem).modo === BYPASS ? "default" : cfgSessao(origem).modo, computador: false }); salvarConfig();
    j.cwd = dir; j.sessionId = r.sessionId; j.modoBypass = false;
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
ipcMain.handle("renomear", async (e, { id, titulo, cwd }) => { if (ctrl?.idsRodando().includes(id)) return false; try { await renameSession(id, titulo, { dir: cwd || J(e).cwd }); return true; } catch { return false; } });
ipcMain.handle("apagar", async (e, id, cwd) => {
  if (turnoDe(id) || ctrl?.idsRodando().includes(id)) return false;
  const viva = vivaDe(id); if (viva) await fechaEspera([viva]);
  try {
    await deleteSession(id, { dir: cwd || J(e).cwd });
    textoDasSessoes.delete(id); esqueceTarefas(id); esqueceSites(id);
    if (config.porSessao?.[id]) { delete config.porSessao[id]; salvarConfig(); }
    for (const o of janelas.values()) if (o.sessionId === id) { limpaConversa(o); if (o !== J(e)) enviarEvento(o, { tipo: "apagada", id }); }
    return true;
  } catch { return false; }
});
ipcMain.handle("pasta", async (e, soEscolher) => {
  const j = J(e);
  const r = await dialog.showOpenDialog(j.win, { title: t("Pasta do projeto"), defaultPath: j.cwd, properties: ["openDirectory"] });
  if (r.canceled || !r.filePaths[0]) return null;
  if (soEscolher) return r.filePaths[0]; // a folder for something else (a scheduled task): the conversation stays as it is
  // A turn running here keeps its own folder and goes on in the background.
  config.cwd = j.cwd = r.filePaths[0]; limpaConversa(j); salvarConfig(); return j.cwd;
});
// A new conversation in a folder of this window. From the sidebar (global) the folder also becomes the
// default for new windows; a folder that came from a link (not global) is checked strictly and never saved.
function defineCwd(j, cwd, { global = true } = {}) {
  if (global ? !cwd || !fs.existsSync(cwd) : !validaCwd(cwd)) return null;
  j.cwd = cwd; limpaConversa(j);
  if (global) { config.cwd = cwd; salvarConfig(); }
  enviarEvento(j, { tipo: "config", ...cfgJ(j) });
  return j.cwd;
}
// A new conversation straight in a project from the sidebar, no folder dialog.
ipcMain.handle("nova_em", (e, cwd) => defineCwd(J(e), cwd));
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
  config.cwd = j.cwd = dir; limpaConversa(j); salvarConfig();
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
  for (const o of janelas.values()) if (mesmoCaminho(o.cwd, w.topo)) { o.cwd = w.raiz; limpaConversa(o); if (config.cwd && mesmoCaminho(config.cwd, w.topo)) config.cwd = w.raiz; }
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
// A child process and everything it started (taskkill /T on Windows, the process group elsewhere).
function matarArvore(p, sincrono) {
  if (!p?.pid || p.exitCode !== null) return;
  if (process.platform === "win32") {
    const args = ["/pid", String(p.pid), "/T", "/F"];
    if (sincrono) { try { execFileSync("taskkill", args, { windowsHide: true, stdio: "ignore" }); } catch {} } else execFile("taskkill", args, { windowsHide: true }, () => {});
  } else { try { process.kill(-p.pid, "SIGTERM"); } catch { p.kill("SIGTERM"); } }
}
function terminalMata(j, sincrono) {
  const term = j.term;
  j.term = null;
  if (term) matarArvore(term.p, sincrono);
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

// A change of model, mode, effort, ultracode or computer control goes to the conversation it was made in (or, in a new
// one, to the defaults) and into the turns running there; the rest of config is shared.
async function mudaConfig(j, mudanca, id = j.sessionId) {
  const m = {};
  for (const k of ["model", "modo", "esforco", "ultracode", "computador"]) if (k in mudanca) m[k] = k === "ultracode" || k === "computador" ? !!mudanca[k] : String(mudanca[k] || "");
  if (m.modo && !MODOS.includes(m.modo)) delete m.modo;
  const turnosAfetados = [...turnos].filter((t) => t.q && !t.caixa?.fechada && ((id && t.sessionId === id) || (!id && t === j.atual)));
  if (id) guardaCfg(id, { ...cfgSessao(id), ...m });
  else {
    // A conversation not yet started can be in bypass, but the default for new ones never is.
    if ("modo" in m) j.modoBypass = m.modo === BYPASS;
    if ("computador" in m) j.computadorPendente = m.computador;
    const { modo, computador, ...resto } = m;
    Object.assign(config, resto, modo && modo !== BYPASS ? { modo } : {});
  }
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
async function confirmaBypass(j) {
  const r = await dialog.showMessageBox(j.win, {
    type: "warning", noLink: true, buttons: [t("Cancelar"), t("Ativar")], defaultId: 0, cancelId: 0,
    message: t("Ignorar todas as permissões?"),
    detail: t("O Claude vai editar arquivos e rodar comandos sem pedir aprovação. Use só em pastas e projetos em que você confia.\n\nPasta: {0}", j.cwd || ""),
  });
  return r.response === 1;
}
ipcMain.handle("config", async (e, mudanca) => {
  const { model, modo, esforco, ultracode, computador, ...resto } = mudanca || {}, j = J(e);
  if (modo === BYPASS && cfgJ(j).modo !== BYPASS) {
    const devolve = () => ({ ...config, ...cfgJ(j), depois: [] });
    if (j.confirmandoBypass) return devolve();
    const id = j.sessionId; j.confirmandoBypass = true;
    const ok = await confirmaBypass(j).finally(() => { j.confirmandoBypass = false; });
    if (!ok || j.sessionId !== id) { avisaConfig(); return devolve(); }
  }
  if (Object.keys(resto).length) { config = { ...config, ...resto }; salvarConfig(); }
  const depois = await mudaConfig(j, Object.fromEntries(Object.entries({ model, modo, esforco, ultracode, computador }).filter(([, v]) => v !== undefined)));
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
  config.visual = visual && typeof visual === "object" ? visual : {};
  // Apps Claude may never control by computer use: the comma-separated field of Customize, as lowercased names.
  config.computerUse = { ...config.computerUse, bloqueados: String(config.visual.geral?.computerBloqueio || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean) };
  salvarConfig();
  if (antes.icone !== config.visual.icone) aplicaIcone();
  aplicaGeral();
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
ipcMain.handle("conta", () => ({ entrar: config.entrar || "login", temChave: !!config.chaveApi, urlApi: config.urlApi || "", claude: acharClaude(), cifra: safeStorage.isEncryptionAvailable() }));
ipcMain.handle("conta_salvar", (_e, { entrar, chave, url }) => {
  if (entrar === "login" || entrar === "chave") config.entrar = entrar;
  // The API key's endpoint (ANTHROPIC_BASE_URL): a proxy or gateway; empty goes back to Anthropic's.
  if (typeof url === "string") {
    const u = url.trim();
    if (!u) delete config.urlApi;
    else {
      let p = null;
      try { p = new URL(u); } catch {}
      if (!p || !/^https?:$/.test(p.protocol) || p.username || p.password) return { erro: "Endereço inválido: use um http:// ou https:// sem usuário e senha." };
      config.urlApi = p.href.replace(/\/+$/, "");
    }
  }
  if (typeof chave === "string") {
    const c = chave.trim();
    if (!c) delete config.chaveApi;
    else if (!safeStorage.isEncryptionAvailable()) return { erro: "O sistema não oferece armazenamento seguro para a chave." };
    else config.chaveApi = safeStorage.encryptString(c).toString("base64");
  }
  salvarConfig();
  return { entrar: config.entrar || "login", temChave: !!config.chaveApi, urlApi: config.urlApi || "" };
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
// Reads a child's output line by line (ANSI stripped, 2000 chars at most) and sends each as the event evento(line) builds.
const linhasPara = (j, evento) => {
  let resto = "";
  return (b) => {
    const partes = (resto + b.toString()).split(/\r?\n/); resto = partes.pop();
    // the login prompt has no newline: send what is left when it looks like one
    if (/>\s*$/.test(resto)) { partes.push(resto); resto = ""; }
    for (const l of partes) if (l.trim()) enviarEvento(j, evento(ansi(l).slice(0, 2000)));
  };
};
ipcMain.handle("claude_instalar", (e) => instalando ??= new Promise((ok) => {
  const win = process.platform === "win32";
  const p = win
    ? spawn(resolveExe("powershell"), ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "irm https://claude.ai/install.ps1 | iex"], { windowsHide: true })
    : spawn("/bin/bash", ["-c", "curl -fsSL https://claude.ai/install.sh | bash"]);
  const linha = linhasPara(J(e), (linha) => ({ tipo: "claude_setup", fonte: "instalar", linha }));
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
  const linha = linhasPara(J(e), (linha) => ({ tipo: "claude_setup", fonte: "entrar", linha }));
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

// ---- tray, scheduled tasks, keep-awake -----------------------------------------------------------------
// Brings a window up from wherever it is (hidden in the tray, minimized, behind others), or opens one.
function mostraJanela(win = principal?.win) {
  if (!win || win.isDestroyed()) { if (!janelas.size) criarJanela(); win = principal?.win; if (!win) return; }
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}
// Runs fn on the main window once its page has loaded (a window the tray just opened is still loading).
function naJanelaPronta(fn) {
  const j = principal; if (!j) return;
  const w = j.win.webContents;
  if (w.isLoading()) w.once("did-finish-load", () => fn(j)); else fn(j);
}
const ultimaVisivel = (j) => ![...janelas.values()].some((o) => o !== j && (o.win.isVisible() || o.win.isMinimized()));
const emAtividade = () => [...turnos].some((x) => x.ativo) || (ctrl?.rodandoQtd() || 0) > 0;
const deveFicarNaBandeja = () => config.visual?.geral?.fecharNaBandeja !== false && (emAtividade() || (ctrl?.ativasQtd() || 0) > 0);
// A toast in the main process (the window may be hidden). Held in a Set until it closes so its click still works.
function notifica(titulo, corpo, aoClicar) {
  if (config.visual?.geral?.notificacoes === false || !Notification.isSupported()) return;
  const n = new Notification({ title: titulo, body: corpo, icon: iconeAtual() });
  notificacoes.add(n);
  const solta = () => { notificacoes.delete(n); if (!notificacoes.size) mudouAtividade(); };
  n.on("click", () => { solta(); aoClicar?.(); });
  n.on("close", solta);
  setTimeout(solta, 10 * 60e3);
  n.show();
}
function avisaBandeja() {
  if (config.avisouBandeja) return;
  config.avisouBandeja = true; salvarConfig();
  notifica("Claudie", t("Claudie continua na bandeja"), () => mostraJanela());
}
const LOCAL = { pt: "pt-BR", en: "en-US", vi: "vi-VN" };
function montaMenuBandeja() {
  if (!bandeja) return;
  const ativos = [...turnos].filter((x) => x.ativo).length + (ctrl?.rodandoQtd() || 0), proximas = ctrl?.proximas(5) || [];
  const chave = JSON.stringify([idioma(), ativos, proximas]);
  if (chave === menuBandejaChave) return;
  menuBandejaChave = chave;
  const abreAgendadas = () => { mostraJanela(); naJanelaPronta((j) => enviarEvento(j, { tipo: "abrir_agendadas" })); };
  const quando = (ms) => new Date(ms).toLocaleString(LOCAL[idioma()], { dateStyle: "short", timeStyle: "short" });
  const rotulo = (s) => String(s).replace(/&/g, "&&");
  try {
    bandeja.setContextMenu(Menu.buildFromTemplate([
      { label: t("Mostrar o Claudie"), click: () => mostraJanela() },
      { label: t("Nova janela"), click: () => criarJanela() },
      { label: t("Nova conversa"), click: () => { mostraJanela(); naJanelaPronta((j) => enviarEvento(j, { tipo: "foco_entrada", nova: true })); } },
      { label: t("Tarefas agendadas"), submenu: [
        { label: t("Abrir tarefas agendadas"), click: abreAgendadas },
        ...(proximas.length ? [{ type: "separator" }, ...proximas.map((p) => ({ label: rotulo(`${p.nome} - ${quando(p.proxima)}`), click: abreAgendadas }))] : []),
      ] },
      ...(ativos ? [{ type: "separator" }, { label: t("{0} em execução", ativos), enabled: false }] : []),
      { type: "separator" },
      { label: t("Sair"), click: () => { sairDeVez = true; app.quit(); } },
    ]));
  } catch (e) { console.log("[bandeja]", e.message); }
}
function criaBandeja() {
  try {
    bandeja = new Tray(iconeAtual().resize({ width: 32, height: 32 }));
    bandeja.setToolTip("Claudie");
    bandeja.on("click", () => mostraJanela());
    montaMenuBandeja();
  } catch (e) { bandeja = null; console.log("[bandeja] sem ícone:", e.message); }
}
// The computer stays awake while Claude works (a turn or a scheduled run), if the person wants that.
function atualizaEnergia() {
  const quer = config.visual?.geral?.manterAcordado !== false && emAtividade();
  if (quer && bloqueioEnergia === null) bloqueioEnergia = powerSaveBlocker.start("prevent-app-suspension");
  else if (!quer && bloqueioEnergia !== null) { powerSaveBlocker.stop(bloqueioEnergia); bloqueioEnergia = null; }
  if (process.env.VIVO_LOG) console.log("[energia]", bloqueioEnergia !== null && powerSaveBlocker.isStarted(bloqueioEnergia) ? "ativa" : "desligada");
}
// A hidden app that has nothing left to do (the last turn ended, no task is enabled) closes instead of lingering.
function mudouAtividade() {
  atualizaEnergia(); montaMenuBandeja();
  if (sairDeVez || !bandeja || !janelas.size || deveFicarNaBandeja() || notificacoes.size) return;
  if (![...janelas.values()].some((o) => o.win.isVisible() || o.win.isMinimized())) app.quit();
}
// The settings that live outside the window: start at login (installed app only), the tray menu and the energy state.
let loginAplicado;
function aplicaGeral() {
  const abrir = !!config.visual?.geral?.abrirNoLogin;
  if (app.isPackaged && loginAplicado === undefined) { try { loginAplicado = app.getLoginItemSettings({ args: ["--oculto"] }).openAtLogin; } catch { loginAplicado = false; } }
  if (app.isPackaged && abrir !== loginAplicado) {
    loginAplicado = abrir;
    try { app.setLoginItemSettings({ openAtLogin: abrir, args: ["--oculto"] }); } catch {}
    if (process.env.VIVO_LOG) console.log("[login]", JSON.stringify(app.getLoginItemSettings({ args: ["--oculto"] })));
  }
  montaMenuBandeja(); atualizaEnergia();
}
function iniciaAgendadas() {
  ctrl = iniciaAgenda({
    arquivo: path.join(app.getPath("userData"), "agendadas.json"), grava: gravaJson,
    rodaQuery: query, criaCaixa: caixaDeEntrada,
    renomeia: (id, titulo, cwd) => renameSession(id, titulo, { dir: cwd }),
    guardaCfgSessao: (id, c) => { guardaCfg(id, c); salvarConfig(); },
    existePasta: (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } },
    avisa: () => { for (const o of janelas.values()) enviarEvento(o, { tipo: "agendadas", lista: ctrl?.lista() || [] }); avisaTurnos(); },
    notifica: (tarefa, r) => {
      if (process.env.VIVO_LOG) console.log("[agenda] fim:", tarefa.nome, r.estado, r.erro || "");
      notifica(tarefa.nome, t(r.estado === "ok" ? "Concluída" : "Falhou"), () => {
        mostraJanela();
        if (r.sessionId) naJanelaPronta((j) => enviarEvento(j, { tipo: "abrir_sessao_pedido", id: r.sessionId, cwd: tarefa.cwd }));
      });
    },
    tr: t, modos: MODOS.filter((m) => m !== BYPASS), aoMudarEnergia: mudouAtividade,
    log: (...a) => { if (process.env.VIVO_LOG) console.log(...a); },
  });
  powerMonitor.on("resume", ctrl.acorda);
  for (const o of janelas.values()) enviarEvento(o, { tipo: "agendadas", lista: ctrl.lista() });
  avisaTurnos();
  // VIVO_AGENDA_AGORA="id" runs that task as soon as the app starts (a test of the headless run)
  if (process.env.VIVO_AGENDA_AGORA) console.log("[agenda] agora:", process.env.VIVO_AGENDA_AGORA, ctrl.rodar(process.env.VIVO_AGENDA_AGORA));
}
const idTexto = (v) => (typeof v === "string" ? v : "");
ipcMain.handle("agendadas", () => ctrl?.lista() || []);
ipcMain.handle("agendada_salvar", (_e, dados) => { try { return { tarefa: ctrl.salvar(dados) }; } catch (e) { return { erro: traduzErro(e, t) }; } });
ipcMain.handle("agendada_apagar", (_e, id) => !!ctrl?.apagar(idTexto(id)));
ipcMain.handle("agendada_pausar", (_e, id, pausada) => !!ctrl?.pausar(idTexto(id), !!pausada));
ipcMain.handle("agendada_rodar", (_e, id) => !!ctrl?.rodar(idTexto(id)));
ipcMain.handle("agendada_parar", (_e, id) => !!ctrl?.parar(idTexto(id)));
ipcMain.handle("agendada_historico", (_e, id) => ctrl?.historico(idTexto(id)) || []);
// The next three runs of a repeat rule, for the preview in the editor.
ipcMain.handle("agendada_proxima", (_e, repete) => {
  try {
    const r = validaRepete(repete), proximas = [];
    for (let d = Date.now(), i = 0; i < 3; i++) { d = proximaExecucao(r, d); if (!d) break; proximas.push(d); }
    return { proximas };
  } catch (e) { return { erro: traduzErro(e, t) }; }
});

// Ctrl+Shift+Space brings the window up from anywhere (and hides it again).
function atalhoGlobal() {
  globalShortcut.register("Control+Shift+Space", () => {
    const win = (BrowserWindow.getFocusedWindow() && janelas.get(BrowserWindow.getFocusedWindow().webContents.id)?.win) || principal?.win;
    if (win?.isFocused()) win.minimize();
    else mostraJanela(win);
  });
}

// ---- Quick Entry, claudie:// links and screen capture ---------------------------------------------------------
// Quick Entry is a small frameless window on its own shortcut: a line of text (and pictures) that goes to the
// last window used, as a new conversation or into its current one. Its IPC and the capture overlay's are never
// resolved through J(e): the sender and its page are checked instead.
let rapida = null, rapidaErro = "", rapidaGraca = 0, acelRapida = null, ultimaFocada = null;
let capturaGesto = 0, fontesPermitidas = null, linkPendente = null, abrindoLink = false;
const filaLinks = [];
const ARQ_RAPIDA = path.join(here, "rapida.html");
const URL_RAPIDA = pathToFileURL(ARQ_RAPIDA).href.toLowerCase();
// config.json is hand-editable: a bad shortcut falls back to the default and only an explicit false turns it off.
const cfgRapida = () => {
  const c = config.entradaRapida || {};
  return { atalho: (typeof c.atalho === "string" && normalizaAtalho(c.atalho).acel) || "Control+Alt+Space", ligada: c.ligada !== false };
};
const captura = iniciaCaptura({ pasta: here, preload: path.join(here, "preload-rapida.cjs"), trava: travaNavegacao });

// These pages never navigate (a dropped file would otherwise replace them) and open no windows.
function travaNavegacao(w) {
  const bloqueia = (e) => e.preventDefault();
  w.webContents.on("will-navigate", bloqueia);
  w.webContents.on("will-frame-navigate", bloqueia);
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}
const daRapida = (e) => !!rapida && !rapida.isDestroyed() && e.sender === rapida.webContents && String(e.senderFrame?.url || "").toLowerCase() === URL_RAPIDA;
// The window a Quick Entry message or a link goes to: the last one used, else the main one, else a new one.
function alvo() {
  if (ultimaFocada && !ultimaFocada.fechada) return ultimaFocada;
  if (principal && !principal.fechada) return principal;
  return [...janelas.values()][0] || criarJanela();
}
const mostraAlvo = (j) => { if (j.win.isDestroyed()) return; if (j.win.isMinimized()) j.win.restore(); j.win.show(); j.win.focus(); };
// Events for a window's page wait in line until it has said it is ready (after the intro).
function despachaParaJanela(j, ev) {
  if (j.pronta) enviarEvento(j, ev); else { (j.fila ||= []).push(ev); if (j.fila.length > 20) j.fila.shift(); }
}
ipcMain.handle("janela_pronta", (e) => {
  const j = J(e); if (!j) return;
  j.pronta = true;
  for (const ev of j.fila?.splice(0) || []) enviarEvento(j, ev);
  if (j === principal && linkPendente) { const l = linkPendente; linkPendente = null; tratarLink(l); }
});
const todasJanelas = () => [...janelas.values()].map((j) => j.win).concat(rapida ? [rapida] : []);

function criaRapida() {
  const w = new BrowserWindow({
    width: 640, height: 168, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, show: false, hasShadow: false,
    webPreferences: { preload: path.join(here, "preload-rapida.cjs"), sandbox: true, contextIsolation: true },
  });
  w.setAlwaysOnTop(true, "screen-saver");
  travaNavegacao(w);
  // Focus can flicker right after it opens, and the screen picker takes it on purpose: neither hides it.
  w.on("blur", () => { if (Date.now() < rapidaGraca || captura.ocupado()) return; escondeRapida(); });
  w.on("closed", () => { if (rapida === w) rapida = null; });
  w.loadFile(ARQ_RAPIDA);
  return w;
}
function escondeRapida() { if (rapida && !rapida.isDestroyed() && rapida.isVisible()) rapida.hide(); }
function mostraRapida() {
  if (!rapida || rapida.isDestroyed()) rapida = criaRapida();
  const a = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea, [largura] = rapida.getSize();
  rapida.setPosition(Math.round(a.x + (a.width - largura) / 2), Math.round(a.y + a.height * 0.28));
  rapidaGraca = Date.now() + 200;
  rapida.show(); rapida.focus();
  const abre = () => { if (rapida && !rapida.isDestroyed()) rapida.webContents.send("rapida:abre", { novaPadrao: true }); };
  if (rapida.webContents.isLoading()) rapida.webContents.once("did-finish-load", abre); else abre();
}
function alternaRapida() {
  if (captura.ocupado()) return;
  if (rapida && !rapida.isDestroyed() && rapida.isVisible()) escondeRapida(); else mostraRapida();
}
// Back from a capture started in Quick Entry: shown and focused again, with the usual grace against the focus flicker.
function voltaRapida() {
  if (!rapida || rapida.isDestroyed()) return;
  rapidaGraca = Date.now() + 200; rapida.show(); rapida.focus();
}

const TECLAS_ATALHO = ["Space", "Tab", "Enter", "Up", "Down", "Left", "Right", "Home", "End", "PageUp", "PageDown", "Insert", "Delete"];
const RE_ATALHO = /^((Control|Ctrl|Alt|Shift|Super|CommandOrControl)\+)+([A-Z0-9]|F\d{1,2}|Space|Tab|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete)$/i;
const ATALHO_GLOBAL = "Control+Shift+Space";
// Modifiers in one canonical order and the key spelled the Electron way; the shortcut needs Control, Alt or Super
// (Shift alone would swallow a letter) and cannot be the one that shows the window.
function normalizaAtalho(bruto) {
  const s = String(bruto || "").trim();
  if (!RE_ATALHO.test(s)) return { erro: t("Atalho inválido. Use modificadores e uma tecla, como Ctrl+Alt+Espaço.") };
  const partes = s.split("+"), tecla = partes.pop();
  const mods = new Set(partes.map((m) => { m = m.toLowerCase(); return /^(ctrl|control|commandorcontrol)$/.test(m) ? "Control" : m === "alt" ? "Alt" : m === "shift" ? "Shift" : "Super"; }));
  if (!["Control", "Alt", "Super"].some((m) => mods.has(m))) return { erro: t("Inclua Ctrl, Alt ou a tecla Windows no atalho.") };
  const f = /^f(\d{1,2})$/i.exec(tecla);
  if (f && (+f[1] < 1 || +f[1] > 24)) return { erro: t("Atalho inválido. Use modificadores e uma tecla, como Ctrl+Alt+Espaço.") };
  const nome = f ? "F" + +f[1] : TECLAS_ATALHO.find((k) => k.toLowerCase() === tecla.toLowerCase()) || tecla.toUpperCase();
  const acel = [...["Control", "Alt", "Shift", "Super"].filter((m) => mods.has(m)), nome].join("+");
  if (acel === ATALHO_GLOBAL) return { erro: t("Esse atalho já mostra o Claudie de qualquer lugar.") };
  return { acel };
}
// Registers the shortcut (or only releases it when off); a taken one leaves the error for Customize.
function registraRapida(acel = cfgRapida().atalho, ligada = cfgRapida().ligada) {
  if (acelRapida) { globalShortcut.unregister(acelRapida); acelRapida = null; }
  rapidaErro = "";
  if (!ligada) return { ok: true };
  let ok = false;
  try { ok = !globalShortcut.isRegistered(acel) && globalShortcut.register(acel, alternaRapida); } catch {}
  if (!ok) { rapidaErro = t("O atalho {0} não está disponível: outro app já o usa.", acel); return { ok: false, erro: rapidaErro }; }
  acelRapida = acel;
  return { ok: true };
}
// Customize changes the shortcut or turns it off; a shortcut that cannot be taken leaves the previous one in place.
ipcMain.handle("rapida_atalho", (e, m) => {
  if (!J(e)) return { ok: false, erro: "" };
  const antes = cfgRapida(), depois = { ...antes };
  if (typeof m?.atalho === "string") {
    const n = normalizaAtalho(m.atalho);
    if (n.erro) return { ok: false, erro: n.erro };
    depois.atalho = n.acel;
  }
  if (typeof m?.ligada === "boolean") depois.ligada = m.ligada;
  const r = registraRapida(depois.atalho, depois.ligada);
  if (!r.ok) { registraRapida(antes.atalho, antes.ligada); rapidaErro = r.erro; return r; }
  config.entradaRapida = depois; salvarConfig();
  return { ok: true, ...depois };
});

const IMAGEM_OK = /^image\/(png|jpeg|gif|webp)$/, B64 = /^[A-Za-z0-9+/=]+$/;
const MAX_IMAGEM_B64 = 7 * 1024 * 1024, MAX_TOTAL_B64 = 20 * 1024 * 1024;
// What Quick Entry may hand over: text up to 100000 characters and up to 6 pictures within the size caps.
function validaRapida(d) {
  if (!d || typeof d.texto !== "string" || d.texto.length > 100000 || !Array.isArray(d.anexos) || d.anexos.length > 6) return null;
  let total = 0;
  const anexos = [];
  for (const a of d.anexos) {
    if (!a || typeof a.dados !== "string" || typeof a.mime !== "string" || !IMAGEM_OK.test(a.mime) || !a.dados || a.dados.length > MAX_IMAGEM_B64 || !B64.test(a.dados)) return null;
    total += a.dados.length;
    if (total > MAX_TOTAL_B64) return null;
    anexos.push({ nome: String(a.nome || "imagem").slice(0, 120), dados: a.dados, mime: a.mime });
  }
  if (!d.texto.trim() && !anexos.length) return null;
  return { texto: d.texto, anexos };
}
ipcMain.handle("rapida_enviar", (e, d) => {
  if (!daRapida(e)) return false;
  const v = validaRapida(d);
  if (!v) return false;
  const j = alvo();
  escondeRapida(); mostraAlvo(j);
  despachaParaJanela(j, { tipo: "entrada_rapida", texto: v.texto, anexos: v.anexos, nova: d.nova !== false });
  return true;
});
ipcMain.on("rapida_fechar", (e) => { if (daRapida(e)) escondeRapida(); });
const telaDoCursor = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
ipcMain.handle("rapida_capturar", (e) => {
  if (!daRapida(e)) return null;
  return captura.capturaRegiao(telaDoCursor(), todasJanelas(), voltaRapida).catch(() => null);
});

// Screen capture from the paperclip: the Screenshot menu item arms a one-use token, a listing can be asked for once
// per token, and a window or screen is only taken if it was in the last listing. The token limits repeats; it does
// not prove a click, since it is armed from the renderer itself.
const usaGesto = () => { const ok = Date.now() < capturaGesto; capturaGesto = 0; return ok; };
ipcMain.handle("captura_gesto", (e) => { if (!J(e)) return false; capturaGesto = Date.now() + 30000; return true; });
ipcMain.handle("captura_fontes", async (e) => {
  if (!J(e) || !usaGesto()) return null;
  try {
    const lista = await captura.listaFontes(todasJanelas());
    fontesPermitidas = new Set(lista.map((s) => s.id));
    return lista;
  } catch (err) { console.log("[captura]", err?.message || err); return []; }
});
ipcMain.handle("captura_fonte", async (e, id) => {
  const j = J(e), ok = typeof id === "string" && !!fontesPermitidas?.has(id);
  fontesPermitidas = null;
  if (!j || !ok) return null;
  return captura.capturaFonte(id, todasJanelas(), () => mostraAlvo(j)).catch(() => null);
});
ipcMain.handle("captura_regiao", (e) => {
  const j = J(e);
  if (!j || !usaGesto()) return null;
  return captura.capturaRegiao(telaDoCursor(), todasJanelas(), () => mostraAlvo(j)).catch(() => null);
});
ipcMain.on("captura_rect", (e, r) => captura.recebeRect(e, r));
ipcMain.on("captura_cancela", (e) => captura.recebeCancela(e));

// claudie:// links. Registered for the installed app; a run from source only with VIVO_LINK=1, so it never takes the
// installed app's registration. Windows hands a link over in argv (a cold start, or second-instance).
const linkDoArgv = (argv) => (argv || []).find((a) => /^"?claudie:\/\//i.test(a));
function registraProtocolo() {
  if (process.env.VIVO_PASTA || process.env.VIVO_JS || process.env.VIVO_ATALHOS || (!app.isPackaged && !process.env.VIVO_LINK)) return;
  try {
    if (process.defaultApp) { if (process.argv.length >= 2) app.setAsDefaultProtocolClient("claudie", process.execPath, [path.resolve(process.argv[1]), "--"]); }
    else app.setAsDefaultProtocolClient("claudie", process.execPath, ["--"]);
  } catch (e) { console.log("[link] não registrou:", e?.message || e); }
}
// An absolute folder that exists; never a network path (looking one up would hand over the person's credentials).
function validaCwd(c) {
  if (typeof c !== "string" || !c || /^[\\/]{2}/.test(c) || !path.isAbsolute(c)) return false;
  try { return fs.statSync(c).isDirectory(); } catch { return false; }
}
// Text from a link shown in a native box without control or bidirectional characters that could hide what it says.
const INVISIVEL = /[\u200b-\u200d\u2028\u2029\u2060\ufeff]/g;
const limpaLink = (s) => String(s).replace(INVISIVEL, "").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function tratarLink(bruto) {
  let u;
  try { u = new URL(String(bruto).replace(/^"|"$/g, "")); } catch { return; }
  if (u.protocol !== "claudie:") return;
  const acao = u.hostname.toLowerCase();
  if (acao === "new") { filaLinks.push(u); processaLinks(); }
  else if (acao === "session") {
    const id = u.pathname.slice(1);
    if (!UUID.test(id)) return console.log("[link] conversa inválida ignorada");
    const aberta = [...janelas.values()].find((o) => o.sessionId === id && !o.fechada);
    if (aberta) mostraAlvo(aberta); else criarJanela(id);
  } else console.log("[link] ação ignorada:", limpaLink(acao).slice(0, 40));
}
// One dialog at a time: a second link waits for the answer to the first.
async function processaLinks() {
  if (abrindoLink) return;
  abrindoLink = true;
  try { while (filaLinks.length) await linkNovo(filaLinks.shift()); }
  catch (e) { console.log("[link]", e?.message || e); }
  finally { abrindoLink = false; }
}
async function linkNovo(u) {
  const j = alvo(), avisos = [];
  let prompt = (u.searchParams.get("prompt") || "").slice(0, 8000);
  const cwdBruto = u.searchParams.get("cwd");
  // A leading "/" would run an app command or a slash command of Claude Code.
  if (prompt.trimStart().startsWith("/")) { prompt = ""; avisos.push(t("O texto do link começava com \"/\" e foi ignorado.")); }
  let cwd = null;
  if (cwdBruto) {
    if (validaCwd(cwdBruto)) cwd = path.resolve(cwdBruto);
    else avisos.push(t("A pasta do link não é válida e foi ignorada: {0}", limpaLink(cwdBruto).slice(0, 300)));
  }
  mostraAlvo(j);
  // Only a bare new-conversation link goes without asking.
  if (!u.searchParams.get("prompt") && !cwdBruto) return despachaParaJanela(j, { tipo: "entrada_rapida", texto: "", anexos: [], nova: true });
  // The box shows the start of the text with blank runs collapsed, so nothing can be pushed out of sight.
  const limpo = limpaLink(prompt).replace(/\n\s*\n+/g, "\n").trim();
  const textoDoLink = limpo.length > 800 ? limpo.slice(0, 800) + "\n" + t("(+{0} caracteres)", limpo.length - 800) : limpo;
  const r = await dialog.showMessageBox(j.win, {
    type: "question", buttons: [t("Enviar"), t("Cancelar")], defaultId: 1, cancelId: 1, noLink: true,
    title: t("Link do Claudie"), message: t("Um link quer iniciar uma conversa no Claudie"),
    detail: [t("Pasta: {0}", cwd || j.cwd || ""), ...avisos, "", textoDoLink].join("\n"),
  });
  if (r.response !== 0) return;
  const destino = j.fechada ? alvo() : j;
  // The folder lives on this window's conversation only, never in the saved default.
  if (cwd) defineCwd(destino, cwd, { global: false });
  despachaParaJanela(destino, { tipo: "entrada_rapida", texto: prompt, anexos: [], nova: true, cwd: cwd || undefined });
}
app.on("open-url", (e, url) => { e.preventDefault(); tratarLink(url); });

// One identity for the window and its shortcuts, so a pinned shortcut and the
// open window share one taskbar button and one icon. Run from source it has an
// identity of its own: a shortcut left by the dev Electron would otherwise lend
// the installed app its name and icon ("Electron") on the taskbar.
const APP_ID = app.isPackaged ? "com.claudie.app" : "com.claudie.app.dev";
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
// A link that started the app (Windows passes it in argv) waits for the main window to be ready.
linkPendente = linkDoArgv(process.argv) || null;
app.on("second-instance", (_e, argv) => { mostraJanela(); const l = linkDoArgv(argv); if (l) tratarLink(l); });
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
  ipcMain.handle("atualizacao_instalar", () => { if (atualizacao.estado === "pronta") setImmediate(() => { sairDeVez = true; autoUpdater.quitAndInstall(false, true); }); });
}
ipcMain.handle("atualizacao", () => atualizacao);
ipcMain.handle("atualizacao_procurar", () => { if (!["procurando", "baixando", "pronta"].includes(atualizacao.estado)) procuraAtualizacao(); return atualizacao; });

// Remote Control: the open conversation itself, history included, on
// claude.ai/code and in the Claude app, as Claude Desktop does it. The bridge
// lives in the conversation's Claude Code, so turning it on opens that one if
// it is closed, and a conversation whose Claude Code reopens (a model change, a
// folder change) connects again.
const remotos = new Map(); // sessionId -> { estado, url, texto }
const querRemoto = new Map(); // sessionId -> name, for the ones the person turned on
function avisaRemoto(sid, mudanca) {
  const r = { estado: "desligado", url: "", texto: "", ...remotos.get(sid), ...mudanca };
  if (r.estado === "desligado" && !r.texto) remotos.delete(sid); else remotos.set(sid, r);
  for (const o of janelas.values()) enviarEvento(o, { tipo: "remoto", sid, ...r });
}
async function ligaRemoto(t) {
  const sid = t.sessionId, nome = querRemoto.get(sid);
  avisaRemoto(sid, { estado: "conectando", url: "", texto: "" });
  try {
    const r = await t.q.enableRemoteControl(true, nome || undefined);
    if (querRemoto.has(sid)) avisaRemoto(sid, { url: r?.session_url || "" });
  } catch (err) {
    querRemoto.delete(sid);
    avisaRemoto(sid, { estado: "erro", url: "", texto: String(err?.message || err).split(/\r?\n/)[0] });
  }
}
// What the bridge reports about itself while the conversation is open.
function estadoRemoto(t, msg) {
  if (!querRemoto.has(t.sessionId)) return;
  if (msg.state === "connected" || msg.state === "ready") avisaRemoto(t.sessionId, { estado: "pronto", texto: "" });
  else if (msg.state === "failed" || msg.state === "policy_disabled") { querRemoto.delete(t.sessionId); avisaRemoto(t.sessionId, { estado: "erro", url: "", texto: msg.detail || "O Remote Control caiu." }); }
  else avisaRemoto(t.sessionId, { estado: "conectando" });
}
ipcMain.handle("remoto", () => Object.fromEntries(remotos));
ipcMain.handle("remoto_ligar", async (e, ligar, nome) => {
  const j = J(e), sid = j.sessionId;
  if (!sid) return void avisaRemoto("", { estado: "erro", texto: "Mande uma mensagem primeiro: o Remote Control leva esta conversa, e ela ainda não começou." });
  if (!ligar) {
    querRemoto.delete(sid);
    const t = vivaDe(sid);
    try { await t?.q.enableRemoteControl(false); } catch {}
    return void avisaRemoto(sid, { estado: "desligado", url: "", texto: "" });
  }
  querRemoto.set(sid, String(nome || "").slice(0, 80));
  const t = vivaDe(sid);
  // A conversation open in another folder reopens here first.
  if (t && t.cwd === j.cwd) await ligaRemoto(t);
  else { if (t) encerra(t); turno(j, null, []); }
});
app.on("before-quit", () => { sairDeVez = true; ctrl?.aborta(); if (bloqueioEnergia !== null) { powerSaveBlocker.stop(bloqueioEnergia); bloqueioEnergia = null; } liberaTudo(); for (const p of filhosMcp) matarArvore(p, true); for (const t of turnos) { encerra(t); t.ac.abort(); } for (const j of janelas.values()) { terminalMata(j, true); navegadorFecha(j, true); } });

app.whenReady().then(() => {
  if (!instanciaUnica) return;
  if (process.env.VIVO_ATALHOS) { criaAtalhos(); app.quit(); return; }
  // The default menu minus DevTools, whose Ctrl+Shift+I belongs to the model picker.
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: "editMenu" }, { label: "View", submenu: [{ role: "reload" }, { role: "forceReload" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] }, { role: "windowMenu" }]));
  servePapelWeb(); trazDoNomeAntigo(); lerConfig(); criaBandeja(); criarJanela(); aquecerClaude().then(iniciaAgendadas); aplicaGeral(); setTimeout(aquecerClaude, 1500); atalhoGlobal(); registraProtocolo(); registraRapida(); vigiaSessoes(); iniciaAtualizacoes();
  // Quick Entry is made hidden ahead of time so its shortcut answers at once.
  if (cfgRapida().ligada && !process.env.VIVO_JS) setTimeout(() => { if (!rapida && janelas.size) rapida = criaRapida(); }, 2000);
});
app.on("will-quit", () => { globalShortcut.unregisterAll(); bandeja?.destroy(); bandeja = null; });
app.on("window-all-closed", () => { if (!deveFicarNaBandeja()) app.quit(); });
