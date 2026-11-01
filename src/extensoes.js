// Helpers for the Customize tabs (plugins, skills, connectors): reading and
// writing skill folders, validating what the window sends before it reaches the
// Claude Code CLI, and the in-memory connector log. No Electron import, so the
// file can be checked and exercised on its own with node.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));

// ---- validation -------------------------------------------------------------------------
export const nomeMcpValido = (nome) => typeof nome === "string" && /^[\w.-]{1,64}$/.test(nome) && !nome.startsWith("-");
export const idPluginValido = (id) => typeof id === "string" && /^[\w.@-]{1,120}$/.test(id) && !id.startsWith("-");
export const nomeSkillValido = (nome) => typeof nome === "string" && /^[a-z0-9-]{1,64}$/.test(nome);

// Where a marketplace comes from: owner/repo, an https URL, or a folder that exists.
export function fonteMercadoValida(fonte) {
  if (typeof fonte !== "string") return false;
  const f = fonte.trim();
  if (!f || f.length > 300 || f.startsWith("-") || /[\0\r\n]/.test(f)) return false;
  if (/^[\w.-]+\/[\w.-]+$/.test(f) && !/^\.{1,2}\//.test(f)) return true;
  if (/^https:\/\/[^\s/]+\S*$/.test(f)) return true;
  if (/^[\\/]{2}/.test(f)) return false; // UNC share: the app would contact that host
  if (/^[a-z][a-z0-9+.-]*:/i.test(f) && !/^[a-z]:[\\/]/i.test(f)) return false; // any other scheme (ssh:, file:, ext::)
  try { return path.isAbsolute(f) && fs.statSync(f).isDirectory(); } catch { return false; }
}

// ---- skills -----------------------------------------------------------------------------
const raizSkills = (origem, cwd) => origem === "user" ? path.join(os.homedir(), ".claude", "skills") : origem === "projeto" ? path.join(cwd, ".claude", "skills") : null;

// key: value lines, with quotes stripped and > / | block scalars folded to their first line
export function lerFrontmatter(txt) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(txt).replace(/^﻿/, ""));
  const r = {};
  if (!m) return r;
  const linhas = m[1].split(/\r?\n/);
  for (let i = 0; i < linhas.length; i++) {
    const k = /^([\w-]+):\s*(.*)$/.exec(linhas[i]);
    if (!k) continue;
    let v = k[2].trim();
    if (/^[>|][+-]?$/.test(v)) {
      v = "";
      for (let j = i + 1; j < linhas.length && /^\s/.test(linhas[j]); j++) { if (linhas[j].trim()) { v = linhas[j].trim(); break; } }
    } else if (/^"[\s\S]*"$/.test(v)) {
      try { v = JSON.parse(v); } catch { v = v.slice(1, -1); }
    } else if (/^'[\s\S]*'$/.test(v)) v = v.slice(1, -1).replace(/''/g, "'");
    r[k[1]] = v;
  }
  return r;
}

const ehPasta = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const ehArquivo = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

export function lerSkills(cwd) {
  const achadas = [];
  for (const origem of ["user", "projeto"]) {
    const raiz = raizSkills(origem, cwd);
    let nomes = [];
    try { nomes = fs.readdirSync(raiz); } catch { continue; }
    for (const pasta of nomes) {
      const arq = path.join(raiz, pasta, "SKILL.md");
      if (!ehPasta(path.join(raiz, pasta)) || !ehArquivo(arq)) continue;
      let fm = {};
      try { fm = lerFrontmatter(fs.readFileSync(arq, "utf8")); } catch {}
      achadas.push({ pasta, nome: fm.name || pasta, descricao: fm.description || "", origem });
    }
  }
  return achadas.sort((a, b) => a.pasta.localeCompare(b.pasta));
}

// The folder of a skill, computed here from where it lives and its folder name; never taken from the window as a path.
export function caminhoSkill(origem, pasta, cwd) {
  const raiz = raizSkills(origem, cwd);
  if (!raiz) throw new Error("Origem de skill inválida.");
  if (typeof pasta !== "string" || !/^[^\\/:*?"<>|\x00-\x1f]+$/.test(pasta) || pasta === "." || pasta === "..") throw new Error("Nome de skill inválido.");
  const alvo = path.resolve(raiz, pasta), rel = path.relative(path.resolve(raiz), alvo);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Nome de skill inválido.");
  return alvo;
}

export const pastaDeSkills = (origem, cwd) => raizSkills(origem, cwd);

export function criarSkill({ nome, descricao, escopo }, cwd) {
  if (!nomeSkillValido(nome)) return { erro: "Use só letras minúsculas, números e hífen no nome (até 64)." };
  const desc = String(descricao ?? "").trim();
  if (!desc || desc.length > 500 || /[\r\n]/.test(desc)) return { erro: "Descreva a skill em uma linha de até 500 caracteres." };
  if (escopo !== "user" && escopo !== "projeto") return { erro: "Escolha onde guardar a skill." };
  const dir = caminhoSkill(escopo, nome, cwd);
  if (fs.existsSync(dir)) return { erro: "Já existe uma skill com esse nome." };
  fs.mkdirSync(dir, { recursive: true });
  const modelo = `---\nname: ${nome}\ndescription: ${JSON.stringify(desc)}\n---\n\n# ${nome}\n\nWrite here what Claude should do when this skill applies: the steps, the rules and any examples.\n`;
  fs.writeFileSync(path.join(dir, "SKILL.md"), modelo, "utf8");
  return { ok: true, pasta: nome };
}

export function apagarSkill(origem, pasta, cwd) {
  const dir = caminhoSkill(origem, pasta, cwd);
  if (!ehArquivo(path.join(dir, "SKILL.md"))) return { erro: "Essa pasta não é uma skill." };
  fs.rmSync(dir, { recursive: true, force: true });
  return { ok: true };
}

// ---- connector catalog ------------------------------------------------------------------
export function catalogo() {
  try { return JSON.parse(fs.readFileSync(path.join(aqui, "catalogo-conectores.json"), "utf8")); } catch { return []; }
}

// ---- connector log ----------------------------------------------------------------------
export const ansi = (txt) => String(txt).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, "");
export const redige = (txt) => String(txt)
  .replace(/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 ***")
  .replace(/((?:set-)?cookie|authorization|proxy-authorization)\s*:.*/gi, "$1: ***")
  .replace(/((?:token|key|secret|password)["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi, "$1***");
export const LINHAS_MAX = 200;

// Appends the lines of a chunk (clean and redacted) to the ring kept under `chave`.
export function ringLog(mapa, chave, chunk) {
  const lista = mapa.get(chave) || [];
  for (const l of ansi(chunk).split(/\r?\n/)) {
    const limpa = redige(l).trimEnd();
    if (limpa.trim()) lista.push(limpa.slice(0, 2000));
  }
  if (lista.length > LINHAS_MAX) lista.splice(0, lista.length - LINHAS_MAX);
  mapa.set(chave, lista);
  return lista;
}
