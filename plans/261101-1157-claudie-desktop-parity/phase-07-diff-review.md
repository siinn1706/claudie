---
phase: 7
title: "Inline diff comments and review card"
status: completed
priority: P2
effort: "1 day"
dependencies: []
---

# Phase 07: Inline diff comments and review card

## Goal

Let the user comment on individual diff lines (Changes window and Edit cards), collect the comments in a pending bar above the composer and send them as one message, and let Claude answer a review request with a `report_findings` tool that renders a findings card with Fix / Walk through / Apply-all buttons.

## Context

- Scout with file:line points: `research/scout-diff-review.json`. Locked decision: "Diff review: pending-comments bar above the composer, used by both the Chat changes window and Edit cards. `report_findings` tool on the existing `claudie` in-process MCP server renders a review card" (`research/decisions.md`).
- Re-verified in source (lines drift, use names):
  - `src/renderer/os.js`: `diffGitHtml(texto)` (~l.90) builds rows `<div class="l mais|menos|"><u>velho</u><u>novo</u><i>..</i><code>`; `abreAlteracoes()` (~l.105) with `desenhaConv` (~l.111, reuses `diffDe`) and `desenhaGit` (~l.126, calls `diffGitHtml(f.diff)` ~l.138); `desenha()` (~l.157) is also called from `j.redesenha` (~l.172, every tool card during a turn) and `busca()`.
  - `src/renderer/extras.js`: `linhasDiff`, `diffDe(nome, e)` (~l.21). Edit/MultiEdit input has only `old_string/new_string`, so no absolute file line numbers.
  - `src/renderer/app.js`: `ROTULO`/`rotulo` (~l.184), `ferramenta(id,nome,e,fim)` (~l.191; the `fechaRaciocinio(); fechaSegmento(); tiraPensando();` calls come right after the `PLANO` guard; used live and in history replay), `ferramentaFim` (~l.258, returns silently for unknown ids), `envia(textoForcado)` (~l.399; returns undefined on every path today), `LOCAIS` slash list, `bloco(cls, html)`, `nota()`, `atualizaEnviar`, `novaConversa`/`abreSessao`, `abreLinkDaConversa` (~l.688), capture-phase Esc (~l.611), bubbling Esc (~l.1155).
  - `src/main.js`: `texto()` helper, `servidorTemasPara(t)` (`tool(name, desc, zodShape, handler, {alwaysLoad:true})`), `FERRAMENTAS_TEMA` fed to `allowedTools` so those tools skip the permission card; the `ferramenta` event is emitted from the complete assistant message (~l.666), never from partial stream events; IPC `abrir_link` (~l.1142) resolves against the conversation cwd, `abrir_arquivo` uses `path.resolve(caminho)` against the app cwd.
  - i18n: `src/renderer/i18n/i18n.js` reads every `*.json` in `src/renderer/i18n/parts/`, so a new part file is auto-discovered. Format: `{ "pt key": { "en": "...", "vi": "..." } }`, see `alteracoes-git.json`. `deixa()` skips text nodes inside `.msg`/`.raciocinio` unless inside `button`/`summary`, and anything inside `[data-sem-traducao]`.
- Generated prompts must not start with `/` (slash handling in the main-process prompt builder).
- No new IPC and no new dependency. Everything but the tool lives in the renderer.

## Design

### A) Inline comments (renderer)

Module state (extras.js, loaded before os.js/app.js as the other globals are):

```js
// draft: { id, conv, chave, arq, linha (number|null), lado: "D"|"E", texto, trecho }
const rascunhos = [];
```

- `D` = new (right) side, `E` = old (left) side. Context and `+` rows are `D` (line = new number), `-` rows are `E` (line = old number).
- Row markup gains `data-arq`, `data-linha`, `data-lado`. Hunk/`corte` rows get none. `trecho` is not an attribute: it is read from the row's `<code>` text at comment time. Each commentable row gets `<button class="cm-mais" aria-label="Comentar nesta linha" title="Comentar nesta linha">+</button>` over the `<i>` cell (Edit rows have no `<u>` gutter). A real `<button>` is keyboard focusable. CSS: `.diff .l{position:relative}` and `.cm-mais{position:sticky;left:0}` so it stays visible when the diff scrolls horizontally.
  - `diffGitHtml(texto, caminho)`: new `caminho` param, `data-arq` on every row; lines come from the running `velho`/`novo` counters.
  - `diffDe(nome, e)`: add `caminho = e.file_path`. Write rows: `linha = index+1`, lado `D`. Edit/MultiEdit rows: empty `data-linha`.
- Row identity (never `arq + trecho` alone: `}`, blank lines and repeated Edit cards collide):
  - Card rows: `ferramenta()` sets `d.dataset.id = id`; the draft `chave` is `cartaoId + ":" + indiceDaLinha` (row index inside that card's diff).
  - Git rows: `chave` is `(arq, lado, linha)` and the draft also stores `trecho`. `reaplicaRascunhos` re-marks a row only when `(arq, lado, linha, trecho)` all match; otherwise the chip stays and is flagged outdated (`.velho`, tooltip "Linha mudou desde o comentário"), so a refresh that shifts line numbers never marks the wrong row.
- One delegated `click` handler on `document` for `.cm-mais`:
  - `abreCaixaComentario(rowEl)`: inserts `<div class="cm-caixa"><textarea/><div><button data-salva>Salvar</button><button data-cancela>Cancelar</button></div></div>` after the row. The box sits inside the `.diff` scroller (`overflow:auto; max-height:320px`), so it uses `position:sticky;left:0;width:min(520px,100%)` to avoid clipping and horizontal scroll. One box at a time. `+` on a row that already has a draft edits that draft.
  - `salvaRascunho(rowEl, texto)`: push/update in `rascunhos` (stamp `conv` with the current conversation/session id), add `.comentada`, call `desenhaBarraComentarios()`.
- Esc ordering contract: the box's Esc (cancel) and Ctrl+Enter (save) are handled by a `keydown` listener registered in the capture phase on `window` at extras.js load, active when `e.target.closest('.cm-caixa')`, and ending in `e.stopImmediatePropagation()`. Neither the app-wide Esc from the shortcuts phase (interrupt turn, close menus, close non-pinned floating windows, per `decisions.md`) nor the existing bubbling Esc in app.js then fires. The shortcuts phase's Esc handler additionally returns early when `document.activeElement?.closest('.cm-caixa')`, so the contract holds regardless of listener order.
- `reaplicaRascunhos(raiz)`: after any re-render of a diff (end of `desenhaGit`, `desenhaConv`, and when `ferramenta()` builds a card), re-mark rows per the identity rules.
- `desenhaBarraComentarios()`: renders `<div id="comentariosBar">` before `#composer` (created once, hidden when `rascunhos` is empty): `window.t('{0} comentários pendentes', n)`, chips `arq:linha` each with a remove `x` (unmarks the row), buttons "Enviar comentários" (shows Ctrl+Enter) and "Limpar". The bar is dynamic, so labels come from `window.t(...)` at render time.
- Conversation scope: `novaConversa()` and `abreSessao()` call `limpaRascunhos()` (empties `rascunhos`, removes marks, hides the bar). `enviaComentarios` also sends only drafts whose `conv` equals the current one.
- `formataComentarios(lista)` returns text starting with a letter. `arq` and `trecho` are sanitized before going into the message: newlines collapsed, backticks replaced with `'`, trecho cut to 300 chars.

```
Comentários de revisão no diff (linhas conforme o diff no momento do comentário):

arquivo.js
- linha 42 (lado novo): texto do comentário
- trecho (lado antigo): texto do comentário
  ```
  const x = 1;
  ```
```

  Grouped by file; `linha N` when `linha != null`, else `trecho` plus a fenced snippet.
- `envia()` contract change (app.js): returns `true` when the text was sent, injected or queued, `false` on empty input or when `vivo.enviar` failed. Existing callers ignore the value. `enviaComentarios()`: `if (await envia(t)) limpaRascunhos();`, so a failed send keeps bar and drafts.
- Ctrl+Enter: `keydown` on `document` (capture) calls `enviaComentarios()` only when `rascunhos.length`, no anexos, mentions/commands popovers off, and focus is the empty composer `entrada` or `document.body`. Any other focused `input,textarea,[contenteditable]` (permission-card `fb` input, sidebar search, Customize fields) is skipped. A non-empty composer falls through to `entrada`'s own handler untouched; with `geral().enviar === 'ctrl'`, Ctrl+Enter on the empty composer sends the comments.
- Redraw safety: the guard is at the top of `desenha()` in `abreAlteracoes`: `if (cont.querySelector('.cm-caixa')) { pendente = true; return; }`. Save/cancel redraws when `pendente` is set. This covers `busca()`, `j.redesenha` (fires for every tool card during a turn), tab buttons and the redraw after a revert.

### B) `report_findings` tool (main.js)

Added to the `tools` array of `servidorTemasPara`:

```js
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
```

- Append `"report_findings"` to the `FERRAMENTAS_TEMA` name list (auto-allowed, no card; the hidden sibling session at ~l.987 reuses `servidorTemasPara`, no change).
- One sentence appended to the server `instructions`: after a review request, call `report_findings` once instead of writing the list.
- The card renders from the `tool_use` event (complete assistant message, never partial stream events), before zod validates. `.nullish()`/`coerce` keep typical model output valid; if the SDK still rejects the input the model retries, and the renderer removes the failed card on `ferramenta_fim` with `erro` (see C) so the user never sees a duplicate list.
- No `ROTULO` entry: `ferramenta()` returns before `rotulo()`, and an auto-allowed tool never reaches `pedido()`.

### C) Review card (app.js)

- `ferramenta(id, nome, e, fim)`: after the `PLANO` guard and after `fechaRaciocinio(); fechaSegmento(); tiraPensando();` (the branch moves below those three calls so the card never lands inside a live reasoning/text segment): `if (nome === "mcp__claudie__report_findings") { ferramentas.set(id, cartaoRevisao(e)); return; }`. History replay uses the same function, so the card survives reopening a conversation.
- `ferramentaFim(id, erro, ...)`: when the stored node is a review card (`classList.contains("achados")`) and `erro` is set, remove it; otherwise return as today.
- `cartaoRevisao(e)` returns `bloco("achados claude")`, deliberately without the `msg` class (`deixa()` would skip its spans/divs in en/vi). Static labels (severity badges, header counts, "Nenhum achado.", resumo label) use `window.t(...)` at render time; model text (summary, suggestion, resumo) gets `data-sem-traducao`. Guard `Array.isArray(e?.achados)` (safety net only). Sorted critical > high > medium > low > info; header with `resumo`, counts and "Aplicar todas as correções" (hidden at 0 findings, empty state "Nenhum achado."). Each finding: severity badge, `file:line` link, summary, suggestion, buttons "Corrigir este" and "Explicar passo a passo". All model text goes through `esc()` and is cut to 2000 chars again in the renderer.
- `file:line` link uses `vivo.abrirLink(file + (line ? ":" + line : ""))` (IPC `abrir_link`: resolves against the conversation cwd, strips `:line`/`#`, decodes percent-encoding). Handle the result like `abreLinkDaConversa`: `r.imagem` calls `abreImagem`; `r.erro === "fora"` or any other error calls `nota(...)` with the existing "Não deu pra abrir" text. `vivo.abrirArquivo` is not used (relative paths would resolve against the app cwd).
- Prompts passed to `envia(prompt)` never embed model-written `summary`/`suggestion` (a poisoned diff could otherwise turn a click into a user-role instruction while the default mode is auto). They reference findings by index in the `report_findings` call already in the transcript; only the `file:line` locator is included, cut to 200 chars:
  - fix: `Corrija o achado #${n} do relatório report_findings acima (arquivo ${file}:${line}) e só ele.`
  - walk: `Explique passo a passo o achado #${n} do relatório report_findings acima (arquivo ${file}:${line}), sem editar nada.`
  - all: `Aplique as correções de todos os achados do relatório report_findings acima, um por um, de #1 a #${N}.`
- "Aplicar todas as correções" is arm-then-confirm, same pattern as `data-reverte` in os.js (~l.144): first click changes the label to "Confirmar: aplicar todas?" for a few seconds, the second click sends, timeout disarms.

### D) Review trigger

`revisaMudancas()` (os.js, global): `envia("Revise as mudanças atuais do repositório: rode git status --short e git diff HEAD e leia também os arquivos não rastreados (a janela de mudanças os mostra). Depois chame a ferramenta mcp__claudie__report_findings uma vez com cada achado (file, line, severity, summary, suggestion); não liste os achados em texto.")`. Wired to a new "Revisar mudanças" button in the `alt-topo` bar of `abreAlteracoes` (visible in git mode, next to Atualizar) and to the app-only `/review-changes` in `envia()` (beside `/customize`: `limpa(); revisaMudancas(); return;`) plus a `LOCAIS` entry `{ nome: "review-changes", descricao: "Pedir ao Claude para revisar as mudanças atuais" }`.

## Files to Create / Modify

| Path | Action | Change |
|---|---|---|
| `src/main.js` | Modify | `report_findings` tool, instructions sentence, add to `FERRAMENTAS_TEMA` |
| `src/renderer/extras.js` | Modify | `rascunhos` state, comment box/bar/format helpers, capture Esc/Ctrl+Enter for the box, row attributes in `diffDe` |
| `src/renderer/os.js` | Modify | `diffGitHtml(texto, caminho)` attributes, redraw guard at top of `desenha()`, "Revisar mudanças" button, `revisaMudancas()` |
| `src/renderer/app.js` | Modify | `ferramenta`/`ferramentaFim` handling, `cartaoRevisao`, `envia` return value, `enviaComentarios`, Ctrl+Enter, Esc guard, reset in `novaConversa`/`abreSessao`, `/review-changes`, `LOCAIS` |
| `src/renderer/app.css` | Modify | `.cm-mais`, `.cm-caixa`, `.l.comentada`, `#comentariosBar`, `.achados` cards (+ `body.light` variants) |
| `src/renderer/i18n/parts/diff-review.json` | Create | pt key to en/vi for all new strings |
| `src/renderer/simulador.js` | Modify | required: emit a `report_findings` tool event and an `Edit` event for the screenshot check |
| `README.md` | Modify | feature bullets (see Docs impact) |

## Tasks & Steps

1. - [x] Confirm branch `feat/desktop-parity` (current from earlier phases) and a clean tree.
2. - [x] extras.js: `rascunhos`, `formataComentarios`, `limpaRascunhos`, `abreCaixaComentario`, `salvaRascunho`, `reaplicaRascunhos`, `desenhaBarraComentarios`, document click delegation, capture-phase box Esc/Ctrl+Enter.
3. - [x] extras.js `diffDe`: emit `data-arq/linha/lado` and `.cm-mais`; Write rows get index+1; Edit rows get null line.
4. - [x] os.js `diffGitHtml`: `caminho` param, attributes and button; pass `f.caminho` from `desenhaGit`; `reaplicaRascunhos(cont)` after `desenhaGit` and `desenhaConv`.
5. - [x] os.js `desenha()`: top-of-function guard (`.cm-caixa` open sets `pendente` and returns); redraw on save/cancel.
6. - [x] os.js: "Revisar mudanças" button (`data-revisa`), `revisaMudancas()`; hide button outside git mode in `desenha()`.
7. - [x] app.js: `envia` returns true/false; `enviaComentarios`; bar send/clear handlers; capture Ctrl+Enter with focus guards; Esc early return; `limpaRascunhos()` in `novaConversa`/`abreSessao`; `/review-changes` in `envia`; `LOCAIS` entry.
8. - [x] app.js: `ferramenta` branch after the three close calls, `d.dataset.id = id` on cards, `ferramentaFim` removal on error, `cartaoRevisao` with index-based prompts and arm-then-confirm.
9. - [x] main.js: tool (with bounded zod), instructions sentence, `FERRAMENTAS_TEMA` entry.
10. - [x] app.css: `.diff .l{position:relative}`; sticky `.cm-mais` (opacity 0 to 1 on `.l:hover` and `:focus-visible`); sticky `.cm-caixa`; `.comentada`, `.velho`, bar, severity badges; light theme variants.
11. - [x] i18n: `diff-review.json` (Comentar nesta linha, Salvar, Cancelar, `{0} comentários pendentes`, Enviar comentários, Limpar, Revisar mudanças, Corrigir este, Explicar passo a passo, Aplicar todas as correções, Confirmar: aplicar todas?, Nenhum achado., Linha mudou desde o comentário, severity labels, counts, slash description).
12. - [x] simulador.js: scripted `report_findings` and `Edit` events.
13. - [x] README: bullets under "Git, terminal and connectors".
14. - [ ] Run Verification, then one commit `feat(review): comment on diff lines and show review findings` (no plan/phase IDs).

## Security & Safety

- All finding fields and comment text are model/user text: insert only via `esc()` or `textContent`; never as raw HTML or inside inline handlers.
- Card buttons never paste model-written summary/suggestion into a user-role prompt: they reference findings by index and include only a truncated `file:line` locator. "Aplicar todas" needs a confirming second click. Fix/apply still only send chat messages; edits go through the normal permission mode.
- `file:line` opens through `vivo.abrirLink`, which resolves against the conversation cwd and refuses paths outside the allowed roots.
- `report_findings` is read-only (returns a string, touches no files or windows), so auto-allowing it adds no capability. zod caps the array at 200 and strings at 2000; the renderer truncates again.
- Generated prompts start with a letter so they cannot become slash commands; comment text sits after the header line, and `arq`/`trecho` are stripped of newlines and backticks before entering the fenced snippet.

## Acceptance Criteria

- Hovering (or keyboard-focusing) a diff row in "Todas as mudanças", "Desta conversa" and a chat Edit/Write card shows a `+` button; clicking opens an inline textarea under that row, not clipped by the scroller.
- Saving marks the row `.comentada` and the bar shows "N pending" with removable chips; Clear empties it and removes the marks.
- Send (button, or Ctrl+Enter with empty composer and focus on the composer/body) sends one message listing comments grouped by file with line or snippet; injected into a running turn or starting a turn otherwise. The bar clears only when the send succeeded; a failed send keeps it.
- Ctrl+Enter does nothing while focus is in another input/textarea (permission feedback, search, Customize).
- Esc inside a comment box cancels only the box: it does not interrupt the turn, close the Changes window or popovers.
- A background refresh, a tool card added during a turn, or a tab click in the Changes window does not destroy an open comment box or saved marks.
- Starting a new conversation or opening another session clears pending comments and the bar.
- Edit-card comments are keyed to their card and row, so identical lines never share a mark; git-diff comments carry the correct line number and a refresh that shifts lines marks an outdated chip instead of a wrong row.
- `/review-changes` and the "Revisar mudanças" button send the review prompt (which includes untracked files); the `report_findings` call renders a card in correct order (after any closed reasoning/text segment) with no permission prompt and no raw JSON; an errored call removes its card.
- Card text is translated in en/vi except model text; file links open relative paths; fix/walk/apply buttons send index-based prompts; Apply-all needs a confirm click; reopening the conversation re-renders the card.
- Light theme renders correctly; no console errors.

## Verification

- `node --check` on each of `src/main.js`, `src/renderer/app.js`, `src/renderer/os.js`, `src/renderer/extras.js`, `src/renderer/simulador.js` (one call per file).
- `node -e "JSON.parse(require('fs').readFileSync('src/renderer/i18n/parts/diff-review.json','utf8'))"`.
- Git-dirty folder screenshot: `VIVO_PASTA=<dirty git dir> VIVO_JS="abreAlteracoes(); setTimeout(()=>document.querySelector('.alt-diffs .cm-mais').click(),800)" VIVO_FOTO=out.png npm start`; check box, then a second run that saves a draft and shows the bar.
- Simulator (required): emit `{tipo:'ferramenta',id:'r1',nome:'mcp__claudie__report_findings',entrada:{achados:[...]}}` and an `Edit` tool event; verify card, buttons, order and Edit-card comment.
- Live: `VIVO_LOG=1 VIVO_TESTE="/review-changes" npm start` in a dirty repo with an untracked file; confirm one `report_findings` call, no permission card, card rendered.
- Manual: send a comment while a turn is running (injected); Esc and Ctrl+Enter inside the box and inside the permission feedback input; start a new conversation with pending comments; light theme and en/vi; trigger Changes refresh while typing in a box.

## Risks & Rollback

- Edit/MultiEdit input has no file line numbers: comments use a snippet (documented in the message).
- Line numbers go stale if the file changes afterwards; the message header says lines refer to the diff at comment time, and stale git rows show as outdated chips.
- Diffs are cut at 600 (git) and 400 (cards) lines: no comment buttons past the cut.
- The model may list findings in text instead of calling the tool; the instructions sentence and the trigger prompt both name the tool, and no card appears in that case (acceptable fallback).
- `envia()` now returns a boolean; callers that ignore it are unaffected.
- Rollback: revert the single commit; no persisted data, config keys or IPC are added.

## Docs impact

README.md (English), "Git, terminal and connectors": add bullets for commenting on diff lines (pending bar, Ctrl+Enter), the "Review changes" button / `/review-changes`, and the findings card with Fix / Walk through / Apply all. No other docs change.

## Red-team notes

All findings were checked against source and applied; none rejected. Adjustments to the suggested fixes:

- Prompt laundering: applied index-based prompts plus arm-then-confirm and zod/renderer caps; only a truncated `file:line` locator is kept so the model can find the finding.
- `abrirArquivo` relative path: confirmed (`path.resolve(caminho)` in `abreArquivo`); switched to `abrirLink`.
- Redraw guard: confirmed `desenha()` is called from `j.redesenha`; guard moved there.
- `envia` return value, Esc capture contract (per `decisions.md` Esc semantics), Ctrl+Enter focus guards, draft reset, row keys, i18n (`deixa()` skips `.msg`), card ordering and `ferramentaFim`, zod `.nullish()`, untracked files, CSS (`.diff` scroller, sticky button/box) and dead wiring (no `ROTULO`, `resumo` used in tool result, `simulador.js` required): all confirmed and applied.
- The "partial streamed input" comment was wrong (main.js emits `ferramenta` from the complete message); justification dropped, guard kept as a safety net.
