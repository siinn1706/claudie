// Finds the Claude Code the person installed and says how to launch it.
// On Windows `where claude` lists npm's extensionless POSIX shim first, which
// cannot be executed; here every candidate is turned into something launchable
// (a .exe or the package's cli.js) and must answer `--version` before it is used.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile, execFileSync } from "node:child_process";

const arquivo = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const SCRIPT = /\.m?js$/i;

// cli.js runs inside Electron's own node; anything else is a native binary.
export function comandoClaude(exe, args = [], env = process.env) {
  return SCRIPT.test(exe)
    ? { cmd: process.execPath, args: [exe, ...args], env: { ...env, ELECTRON_RUN_AS_NODE: "1" } }
    : { cmd: exe, args, env };
}

// The launchable files an installed @anthropic-ai/claude-code package can hold.
function doPacote(dir, platform, arch) {
  const nativo = platform === "win32" ? "claude.exe" : "claude", plat = `claude-code-${platform}-${arch}`;
  return [path.join(dir, "cli.js"), path.join(dir, "bin", nativo), path.join(dir, "node_modules", "@anthropic-ai", plat, nativo), path.join(dir, "..", plat, nativo)].filter(arquivo);
}
const pacoteEm = (pasta) => path.join(pasta, "node_modules", "@anthropic-ai", "claude-code");

// npm's .cmd shim names its target relative to its own folder (%dp0%\...).
function alvosDoShim(cmd, platform, arch) {
  let txt = ""; try { txt = fs.readFileSync(cmd, "utf8"); } catch { return []; }
  const dir = path.dirname(cmd), achados = [];
  for (const m of txt.matchAll(/%~?dp0%?[\\/]+([^"\r\n%]+?\.(?:exe|m?js))/gi)) {
    const alvo = path.join(dir, ...m[1].split(/[\\/]+/));
    if (!/^node\.exe$/i.test(path.basename(alvo)) && arquivo(alvo)) achados.push(alvo);
  }
  return [...achados, ...doPacote(pacoteEm(dir), platform, arch)];
}

// One candidate path (whatever `where` printed) to the files that can really be launched.
export function lancaveis(c, platform = process.platform, arch = process.arch) {
  if (!c) return [];
  if (platform !== "win32") {
    let real; try { real = fs.realpathSync(c); } catch { return []; }
    if (!arquivo(real)) return [];
    if (SCRIPT.test(real)) return [real];
    try { fs.accessSync(real, fs.constants.X_OK); return [real]; } catch { return []; }
  }
  const ext = path.extname(c).toLowerCase();
  if (ext === ".exe" || ext === ".js" || ext === ".mjs") return arquivo(c) ? [c] : [];
  if (ext === ".cmd" || ext === ".bat") return alvosDoShim(c, platform, arch);
  // the extensionless sh shim and the .ps1 are only the neighbours of the real .cmd/.exe
  const base = ext === ".ps1" ? c.slice(0, -4) : ext === "" ? c : null;
  if (!base) return [];
  return [...alvosDoShim(base + ".cmd", platform, arch), ...(arquivo(base + ".exe") ? [base + ".exe"] : [])];
}

const naoRuim = (exe, env) => {
  const c = comandoClaude(exe, ["--version"], env);
  try { execFileSync(c.cmd, c.args, { env: c.env, timeout: 10000, windowsHide: true, stdio: "ignore" }); return true; }
  catch (e) { return e.code === "ETIMEDOUT"; } // slow to start is still started
};
const ondeEstaClaude = (platform) => {
  try { return execFileSync(platform === "win32" ? "where" : "which", ["claude"], { encoding: "utf8", windowsHide: true }).split(/\r?\n/).map((x) => x.trim()).filter(Boolean); } catch { return []; }
};
// Same two probes without blocking the main thread.
const naoRuimAsync = (exe, env) => new Promise((ok) => {
  const c = comandoClaude(exe, ["--version"], env);
  execFile(c.cmd, c.args, { env: c.env, timeout: 10000, windowsHide: true }, (e) => ok(!e || e.killed === true));
});
const ondeEstaClaudeAsync = (platform) => new Promise((ok) => {
  execFile(platform === "win32" ? "where" : "which", ["claude"], { encoding: "utf8", windowsHide: true }, (e, out) => ok(e ? [] : String(out).split(/\r?\n/).map((x) => x.trim()).filter(Boolean)));
});

// The search itself, as a generator: it yields {onde} / {verifica} questions and the
// sync and async drivers below answer them, so both share one set of rules.
function* busca({ env, platform, arch, home, appdata }) {
  const nativo = platform === "win32" ? "claude.exe" : "claude";
  const brutos = [env.CLAUDE_CODE_PATH, path.join(home, ".local", "bin", nativo), ...(yield { onde: platform })];
  const vistos = new Set(), tentativas = [];
  const prova = function* (exe) {
    const k = platform === "win32" ? exe.toLowerCase() : exe;
    if (vistos.has(k)) return false;
    vistos.add(k);
    if (yield { verifica: exe }) return true;
    tentativas.push(exe); return false;
  };
  const primeiro = function* (lista) { for (const e of lista) if (yield* prova(e)) return e; return null; };
  for (const c of brutos.filter(Boolean)) {
    const lista = lancaveis(c, platform, arch);
    if (!lista.length) { if (arquivo(c)) tentativas.push(c); continue; }
    const ok = yield* primeiro(lista);
    if (ok) return { exe: ok, tentativas };
  }
  const globais = [appdata && pacoteEm(path.join(appdata, "npm")), platform !== "win32" && "/usr/local/lib/node_modules/@anthropic-ai/claude-code"].filter(Boolean);
  for (const g of globais) { const ok = yield* primeiro(doPacote(g, platform, arch)); if (ok) return { exe: ok, tentativas }; }
  return { exe: null, tentativas };
}
const opcoes = ({ env = process.env, platform = process.platform, arch = process.arch, home = os.homedir(), appdata = env.APPDATA || "" } = {}) => ({ env, platform, arch, home, appdata });

// Returns { exe, tentativas }: exe is null when nothing starts (the SDK's own copy may still do).
export function acharClaudeExe({ onde = ondeEstaClaude, verifica = naoRuim, ...resto } = {}) {
  const o = opcoes(resto), g = busca(o);
  let r = g.next();
  while (!r.done) r = g.next("onde" in r.value ? onde(r.value.onde) : verifica(r.value.verifica, o.env));
  return r.value;
}
export async function acharClaudeExeAsync({ onde = ondeEstaClaudeAsync, verifica = naoRuimAsync, ...resto } = {}) {
  const o = opcoes(resto), g = busca(o);
  let r = g.next();
  while (!r.done) r = g.next("onde" in r.value ? await onde(r.value.onde) : await verifica(r.value.verifica, o.env));
  return r.value;
}
