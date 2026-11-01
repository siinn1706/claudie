---
phase: 3
title: "Inline mermaid/svg/html and Artifacts window"
status: completed
priority: P2
effort: "1 day"
dependencies: []
---

# Phase 03: Inline mermaid/svg/html and Artifacts window

## Goal

Render finished ```mermaid, ```svg and ```html fences as sandboxed previews with a Code/Preview toggle, and add an Artifacts floating window that lists and previews the html/svg/md files Claude wrote in the current conversation.

## Context

- Scout: [scout-inline-render.json](research/scout-inline-render.json). Locked decisions: [decisions.md](research/decisions.md) ("Inline render" bullet). Other research files are not needed for this phase.
- Re-verified in source (names first, lines may drift):
  - `src/renderer/app.js`: `marked.use` (l.38), `md` (l.39), `decora(el)` (l.41), `fechaSegmento()` (l.123, calls `decora(segmento)` l.126), streaming `texto()` re-render every 45 ms (l.169, `decora(segmento)`), plan card (l.328), history replay (l.970, `decora(el)`), about credits (l.1584).
  - `src/renderer/os.js`: `ABRE_JANELINHA` (l.11), `janelinha(id, titulo, {largura, altura, aoFechar})` (l.16, returns `{el, corpo, fecha}`, re-raises on same id, persists pos/size/pin per id), `alteracoes()` (l.71, `.ferr` card scan using `c._nome` and `c._entrada`), `botaoAlt` inserted before `$("atalhosBtn")` (l.177), `contaAlteracoes()` (l.181), debounced `MutationObserver` on `col` (l.187).
  - `src/main.js`: `J(e)` (l.117), `dentroDeRaizPermitida` (l.162), `caminhoRealSeguro` (l.168), `abrir_arquivo` / `abrir_link` handlers (l.1137-1164).
  - `src/preload.cjs`: `abrirArquivo` (l.61). `src/renderer/index.html`: CSP meta (l.5, `script-src 'self'`, `frame-src claudie-we:`), marked script (l.148).
  - i18n parts are flat JSON `{ "<pt key>": { "en": "...", "vi": "..." } }` auto-loaded from `src/renderer/i18n/parts/` (see `alteracoes-git.json`).
- Locked: `mermaid`/`svg` default to Preview, `html` defaults to Code. HTML preview = `iframe` with `srcdoc`, empty `sandbox`, CSP meta. Mermaid vendored at `src/renderer/vendor/mermaid.min.js` (MIT), not an npm dependency. Artifacts window lists files written by Write/Edit/MultiEdit in this conversation.

## Design

**Rendering rules.** `decora(el, final = false)`. Only `fechaSegmento()` and history replay (and the plan card) pass `final = true`; streaming keeps calling `decora(segmento)` so blocks stay plain code and no iframe is built while `innerHTML` is rewritten every 45 ms. For a `.codigo` box whose lang is `mermaid|svg|html|htm` and `final` is true and `caixa.dataset.vis` is unset: set `dataset.vis = "1"`, add `<button class="codigo-vis">` to `.codigo-topo` (label `Visualizar` when showing code, `Código` when showing preview), and call `montaPrevia(caixa, lang, code.textContent)` once, lazily on first Preview. mermaid/svg start on Preview (click the toggle programmatically after build), html starts on Code. The `<pre>` stays in the DOM (hidden in preview mode) so Copiar keeps copying source. Any block over 500 KB gets no toggle (Code only).

**New file `src/renderer/artefatos.js`** (classic script, loaded after `os.js`; uses globals `esc`, `svg`, `md`, `col`, `janelinha`, `janelinhas`, `ABRE_JANELINHA`, `nota`, `vivo`, `$`):

```js
const CSP_PREVIA = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";
const docPrevia = (corpo) => `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP_PREVIA}"><style>html,body{background:#fff;color:#111}body{margin:12px;font:14px system-ui,sans-serif}svg{max-width:100%;height:auto}</style>${corpo}`;
let promessaMermaid, seqMermaid = 0;
function carregaMermaid() {            // lazy, memoized, first mermaid fence only
  return promessaMermaid ||= new Promise((ok, falha) => {
    const s = document.createElement("script"); s.src = "vendor/mermaid.min.js";
    s.onload = () => { if (typeof mermaid?.render !== "function") return falha(new Error("mermaid")); mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default" }); ok(); };
    s.onerror = () => { promessaMermaid = null; falha(new Error("mermaid")); };
    document.head.append(s);
  });
}
async function previaDe(lang, codigo) {  // -> full srcdoc string, throws on failure
  if (lang === "mermaid") { await carregaMermaid(); const id = "m" + ++seqMermaid;
    try { return docPrevia((await mermaid.render(id, codigo)).svg); } finally { document.getElementById("d" + id)?.remove(); } }
  return docPrevia(codigo);              // svg and html: the fence text itself
}
function iframePrevia(doc) { const f = document.createElement("iframe"); f.setAttribute("sandbox", ""); f.className = "codigo-previa"; f.srcdoc = doc; return f; }
```

- `montaPrevia(caixa, lang, codigo)` wires the toggle. Keep one build promise per box (`caixa._previa ||= previaDe(...)`); clicks while it is pending are ignored, so a double click never builds two iframes. First Preview inserts `iframePrevia(...)` after the `<pre>`. On error (mermaid syntax, script load) keep Code visible and add a `.codigo-erro` element whose text is `t("Não deu pra desenhar o diagrama.")` (`window.t`, i18n.js). The DOM scanner skips text under `.msg` except inside `button`/`summary`, so a bare text node there would stay Portuguese; the `t()` call avoids that. Banner messages use `nota("pt literal", true)` (the banner is scanned), never a `T()` helper (there is none).
- Preview doc is theme-independent: mermaid theme is always `default` and `docPrevia` forces `#fff` background and `#111` text (no `color-scheme` meta, so the OS preference cannot invert it). `mermaid.initialize` runs once at load, so no app-theme coupling exists to go stale.
- After an async preview build, call `desce()` only when the view was at the bottom (`desce` already checks `pertoDoFim()`); give `.codigo-previa` a fixed height so the swap from code does not drift the scroll.
- `artefatos()` copies the `alteracoes()` scan: `.ferr` cards with `_nome` in `Write|Edit|MultiEdit`, keep only cards whose `summary .estado` is `.ok` (skips `.rodando` and `.erro`), `file_path` ext matching `/\.(html?|svg|md|markdown)$/i`; returns `Map(path -> {nome, ext, card, escrita})`, later cards overwrite earlier ones (last wins, order of first appearance kept). `escrita` is the latest `Write` card for that path, tracked separately so the fallback still exists when an Edit wins.
- `abreArtefatos()`: `janelinha("artefatos", "Artefatos da conversa", {largura: 620, altura: 460})`; body = left `.art-lista` (one button per file, name + ext tag) and right `.art-previa`. Selecting calls `await vivo.artefatoLer(path)`; on `{texto, nome}` build the doc (svg/html as above; md via `md(texto)` wrapped by `docPrevia`; raw html in md is already escaped by the renderer override) and show it in `iframePrevia`, plus a Code/Preview toggle (html/md default Preview here, svg Preview) and an `Abrir arquivo` button (`vivo.abrirArquivo(path)`). Use a sequence counter (like `altSeq` in `os.js`): bump on every selection, redraw and close, and drop any `artefatoLer` result whose counter is stale. On `{erro}`: if erro is `leitura` and `escrita` exists, show `escrita._entrada.content` labelled `Cópia do que o Claude escreveu, não lida do disco.`; for `fora`, `tipo`, `grande` show `Não deu pra ler o arquivo.` (never present a snapshot as the file). Empty list: `Nenhum artefato nesta conversa ainda.` Files changed via Bash or inside sub-agent cards (not direct `.ferr` children of `col`) are not listed.
- Header button `botaoArt` (class `icone art-btn`, title `Artefatos da conversa`, `.badge` count) inserted before `$("atalhosBtn")`; `contaArtefatos()` updates badge and calls `janelinhas.get("artefatos")?.redesenha?.()`. Refresh through a debounced 200 ms `MutationObserver` on `col` using the `os.js` l.187 predicate (new `.ferr` cards, removals), widened with an `attributes` observation (`attributeFilter: ["class"]`, target `.estado`) so a card turning `.ok`/`.erro` in `ferramentaFim` (app.js) triggers a recount; plus `aoEvento` on `parado` and `sessao` (as `os.js` l.176 does for the git view). When the open window redraws it keeps the selected path and re-reads it only if that card's state changed. Registered `ABRE_JANELINHA.artefatos = () => abreArtefatos()` so a pinned window reopens. The list resets with `col` when the conversation changes.

**IPC `artefato_ler`** (main.js, next to `abrir_arquivo`):

```js
ipcMain.handle("artefato_ler", (e, caminho) => {
  if (typeof caminho !== "string" || !caminho) return { erro: "fora" };
  const j = J(e), base = j?.atual?.cwd || j?.cwd || config.cwd;   // match how abrir_link resolves its base
  const real = caminhoRealSeguro(path.resolve(base, caminho));
  if (!real || !dentroDeRaizPermitida(real)) return { erro: "fora" };
  if (!/\.(html?|svg|md|markdown)$/i.test(real)) return { erro: "tipo" };
  try { const st = fs.statSync(real); if (!st.isFile() || st.size > 2 * 1024 * 1024) return { erro: "grande" };
    return { texto: fs.readFileSync(real, "utf8"), nome: path.basename(real) }; } catch { return { erro: "leitura" }; }
});
```

Preload: `artefatoLer: (c) => ipcRenderer.invoke("artefato_ler", c)`.

**Mermaid vendoring.** In a scratch dir (not the repo): `npm pack mermaid@11` (or `npm i --prefix <scratch> mermaid@11`), copy `dist/mermaid.min.js` to `src/renderer/vendor/mermaid.min.js` and the package `LICENSE` (plus any bundled-license file shipped in the package) to `src/renderer/vendor/`, write `src/renderer/vendor/README.md` (name, exact version, MIT, source URL, note that the bundle includes third-party libraries under their own licenses listed in the shipped license files, "re-copy on upgrade"). After vendoring, confirm `typeof mermaid.render === "function"` in the app (VIVO_JS route) before wiring `carregaMermaid`. `package.json` `files: src/**/*` already packs it; no package.json change. Add `mermaid` (MIT) credit next to marked in the about box (`app.js` ~l.1584). No `index.html` CSP change; add only `<script src="artefatos.js"></script>` after `os.js`.

## Files to Create / Modify

| Path | Action | Change |
|------|--------|--------|
| `src/renderer/artefatos.js` | Create | `docPrevia`, `carregaMermaid`, `previaDe`, `montaPrevia`, `artefatos`, `abreArtefatos`, header button and badge |
| `src/renderer/vendor/mermaid.min.js` | Create | Vendored prebuilt mermaid v11 bundle |
| `src/renderer/vendor/README.md` | Create | Version, license, source, upgrade note |
| `src/renderer/vendor/LICENSE*` | Create | Mermaid LICENSE and any bundled-license file from the package |
| `src/renderer/simulador.js` | Modify | Stub `artefatoLer: async () => ({ erro: "leitura" })` on the `window.vivo` stub |
| `src/renderer/i18n/parts/inline-render.json` | Create | en/vi for new strings |
| `src/renderer/app.js` | Modify | `decora(el, final)` toggle; pass `true` in `fechaSegmento`, history replay, plan card; mermaid credit in about box |
| `src/renderer/app.css` | Modify | `.codigo-vis`, `.codigo-previa`, `.codigo-erro`, artifacts window (`.art-*`) styles near `.codigo` / `.janelinha` rules |
| `src/renderer/index.html` | Modify | Add `artefatos.js` script tag after `os.js` |
| `src/main.js` | Modify | `artefato_ler` handler |
| `src/preload.cjs` | Modify | `artefatoLer` bridge |
| `README.md` | Modify | One Features line (English) |

## Tasks & Steps

1. [x] Create branch work on `feat/desktop-parity` (phases 01-02 may not be committed first; phase order does not matter for this phase's files).
2. [x] Vendor mermaid: fetch `dist/mermaid.min.js` from a scratch npm install, copy to `src/renderer/vendor/`, write the vendor README with the exact version.
3. [x] Add `artefato_ler` in `main.js` and `artefatoLer` in `preload.cjs`; `node --check` both.
4. [x] Write `artefatos.js` (helpers, `montaPrevia`, artifacts scan, window, button, observer + `aoEvento`, `ABRE_JANELINHA.artefatos`). Add the `artefatoLer` stub in `simulador.js`.
5. [x] Change `decora` in `app.js`: add `final` param, toggle button, `dataset.vis` guard, default tab per language, 500 KB cap; update the three call sites that must pass `true`; keep streaming call unchanged.
6. [x] Add CSS for toggle button, iframe (width 100%, height ~320 px, white background, no border) and artifacts window; verify in light and dark.
7. [x] Add script tag in `index.html` after `os.js`.
8. [x] Create `inline-render.json` with the missing keys only: `Visualizar`, `Artefatos da conversa`, `Nenhum artefato nesta conversa ainda.`, `Não deu pra ler o arquivo.`, `Não deu pra desenhar o diagrama.`, `Cópia do que o Claude escreveu, não lida do disco.`. `Código` (personalizar.json) and `Abrir arquivo` (alteracoes-git.json) already exist; grep to confirm before adding. Toggle labels sit in a `button`, so the DOM scanner translates them; `.codigo-erro` uses `t()`.
9. [x] Add the about-box mermaid credit and the README feature line.
10. [x] Run Verification; fix issues; commit `feat(render): preview mermaid, svg and html fences and add an artifacts window`.

## Security & Safety

- Preview iframes: `sandbox=""` (no scripts, no same-origin, no forms, no popups, no top navigation). Never add `allow-same-origin`; never add `allow-scripts` (HTML interactivity is intentionally out of scope; the srcdoc also inherits `script-src 'self'`).
- The doc's own CSP meta (`default-src 'none'; img-src data:`) blocks network fetches and remote images from previews; it can only tighten the inherited policy.
- Mermaid runs in the parent page with `securityLevel: "strict"` (labels sanitized); the resulting SVG goes into a script-less sandbox. Confirm no CSP violation from mermaid itself (v11 should not need `unsafe-eval`); if it does, stop and re-plan rather than loosening `script-src`.
- `artefato_ler` is read-only, validated through `caminhoRealSeguro` + `dentroDeRaizPermitida` (UNC guard, symlink-resolved), extension whitelist, 2 MB cap, string-type check. It reads no file the user could not already open via `abrir_arquivo`.
- The vendored bundle ships with its MIT LICENSE (and bundled-library licenses) in `vendor/`; the about-box credit is in addition.
- Markdown artifacts go through `md()` which escapes raw html; the iframe is still sandboxed.
- `mermaid.render` leaves a temp node on error; remove `#d<id>`.

## Acceptance Criteria

- A finished reply with a ```mermaid fence shows a diagram by default; the toggle shows the source; Copiar copies the source in both modes.
- ```svg shows the image by default; ```html shows code by default and the toggle renders it statically.
- No iframe exists during streaming; blocks appear as plain code until the segment closes, then upgrade once (no duplicates after repeated `decora`).
- Restored conversations (history replay) get the same toggles.
- Invalid mermaid keeps Code visible with an error note; no console exception, no stray `#dm*` node.
- Preview iframe `sandbox` attribute is empty, `contentDocument` is inaccessible, and an html fence with `<script>` does not run.
- The header Artifacts button badge counts distinct html/svg/md files written by Write/Edit/MultiEdit in the open conversation, ignores running and failed calls (recount when a call finishes and on `parado`/`sessao`), and resets on new/other conversation.
- Artifacts window lists, previews (reflecting disk content after Edit, no stale result after switching file or closing, snapshot labelled if only the Write content is available), toggles Code/Preview, and `Abrir arquivo` launches the default app; pin survives restart.
- `artefatoLer('C:/Windows/win.ini')` returns `{erro: "fora"}`; a `.txt` inside the folder returns `{erro: "tipo"}`.
- New strings appear translated in en and vi; all i18n JSON parses.

## Verification

```
node --check src/main.js && node --check src/preload.cjs && node --check src/renderer/app.js && node --check src/renderer/os.js && node --check src/renderer/artefatos.js
node -e "for (const f of require('fs').readdirSync('src/renderer/i18n/parts')) JSON.parse(require('fs').readFileSync('src/renderer/i18n/parts/'+f,'utf8'))"
```

Manual (separate profile via env):
1. `VIVO_LOG=1 VIVO_TESTE="Draw a mermaid flowchart, an inline svg circle and a small html card, each in its own fenced block" npm start`; check toggles, defaults, copy.
2. `VIVO_JS="document.querySelector('.codigo-vis')?.click(); 'ok'" VIVO_FOTO=scratch.png npm start`; read the png in light and dark.
3. `VIVO_JS="const f=document.querySelector('.codigo-previa'); [f.sandbox.value, (()=>{try{return !!f.contentDocument}catch{return 'blocked'}})()]"` expects `['', null]` or `blocked`; read console for CSP violations (none from mermaid; one expected from html `<script>`).
4. `VIVO_JS="await vivo.artefatoLer('C:/Windows/win.ini')"` returns `{erro:"fora"}`.
5. In the Artifacts preview click into the iframe and press Esc: the window does not close (keydown stays inside the iframe; accepted limitation). With the app in dark theme a mermaid preview stays legible (white background).
6. Ask Claude to Write `demo.html`, `logo.svg`, `notes.md`, then Edit `demo.html`; badge shows 3, preview matches disk; reopen the conversation from the sidebar and confirm previews and list; new conversation empties the list.
7. `npm run dist` (or inspect `app.asar`) confirms `src/renderer/vendor/mermaid.min.js` is packed.

## Risks & Rollback

- Mermaid bundle (~3 MB) grows repo/asar; lazy loading keeps startup unaffected. Exact dist filename unverified by scout: confirm after the scratch install; if mermaid needs `unsafe-eval`, drop mermaid previews (keep svg/html) rather than relax CSP.
- Large fences/srcdoc slow; capped at 500 KB.
- Esc with focus inside a preview iframe does not reach the parent document, so neither the window-close nor the turn-interrupt Esc fires there; accepted.
- DOM-based artifact scan misses files changed via Bash and sub-agent cards and may diverge from disk after an undo; disk is the source of truth, `Write` snapshot fallback only on read failure, labelled as a snapshot.
- Dead links in previews (empty sandbox) are intended.
- Rollback: revert the single commit; no persisted data or config keys are added (window pos/pin live in localStorage under id `artefatos` and are harmless).

## Docs impact

README Features list (English): add "Inline previews of mermaid, svg and html code blocks (Code/Preview toggle, sandboxed, no scripts) and an Artifacts window listing the html, svg and markdown files Claude wrote in the conversation." Credit Mermaid (MIT) in the about box. No other docs.

## Red-team notes

Applied (all verified in source): refresh timing (`ferramenta` creates the card at tool_use start, `ferramentaFim` only changes `.estado`, `os.js` l.176 uses `aoEvento`); fixed light preview and mermaid theme `default`; `window.t` instead of `T()`, and `.msg` text skipped by `deixa()` (i18n.js l.63-65), `Código` and `Abrir arquivo` already exist; `simulador.js` stub (l.54, l.89); race guards (per-box promise, sequence counter, conditional `desce`); per-path Write snapshot with non-disk label, sub-agent limitation documented; license files and `mermaid.render` typeof check; Esc-in-iframe documented as accepted.
Rejected: none.
