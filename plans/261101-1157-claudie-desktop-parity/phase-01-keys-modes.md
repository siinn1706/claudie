---
phase: 1
title: "Esc interrupt, picker shortcuts, bypass mode"
status: completed
priority: P1
effort: "3-4h"
dependencies: []
---

# Phase 01: Esc interrupt, picker shortcuts, bypass mode

## Goal

Make Esc interrupt the running turn (after closing anything open), add keyboard shortcuts for the mode cycle and the model, effort and permission pickers, and add a confirmed `bypassPermissions` mode reachable only from the picker.

## Context

- Locked decisions: [decisions.md](research/decisions.md) (bypass rules, Esc priority, shortcut letters). Code scout: [scout-keys-modes.json](research/scout-keys-modes.json). SDK facts: [research-sdk-facts.md](research/research-sdk-facts.md) (`bypassPermissions` needs `allowDangerouslySkipPermissions: true` at start and for `setPermissionMode`; deny/ask rules and hooks still apply).
- Locked shortcuts: Ctrl+Shift+M cycles default, acceptEdits, plan, auto. Ctrl+Shift+I model picker, Ctrl+Shift+E effort picker, Ctrl+Shift+P mode picker. (The scout proposed Ctrl+Shift+L for the model; the decision says I and wins.)
- Verified in source (names first, lines may drift):
  - `src/main.js`: `MODOS` (l.125), `cfgSessao`/`cfgJ` (126-127; `cfgSessao` spreads `porSessao[id]` unvalidated), `guardaCfg` (128), `aplicaNoTurno` (130), `query({ options })` with `permissionMode: t.cfg.modo` (~597), `ipcMain.handle("permissao")` plan branch using `MODOS.includes(modo) && modo !== "plan"` (~951), `mudaConfig` (~1541), `ipcMain.handle("config")` (~1558), `avisaConfig` (~1565), `ipcMain.handle("parar")` (~937, interrupt with abort fallback), `dialog` already imported, translator `t = criaT(idioma)` (l.22). A new session copies `t.cfg` into `porSessao` at the init event (~641).
  - No `Menu.setApplicationMenu` call exists, so Electron's default menu is active (its View menu owns Ctrl+Shift+I = DevTools).
  - `src/renderer/app.js`: `entrada` keydown (~437-453; Esc stops propagation for mention/command menus at 444/450 and calls `fechaPicker()` at 453), capture handler for the lightbox (~611), `rodando`/`setRodando`, `$("enviar").onclick` (`rodando ? vivo.parar() : envia()`), `mostraEscolhas`/`guardaEscolha`/`$("modo").onchange` (~1004-1008), `ESCOLHAS`, `abreEscolha`/`fechaEscolhas`/`montaEscolha`/`ICONES_MODO`/`menuEscolha` (~1041-1075), window `keydown` (~1148-1156), `bibBusca` Esc (~1374), `abreAtalhos` (~1738), inline rename inputs (855, 946), `case "config": mostraEscolhas(ev)` (~360), `nota()`.
  - Script order in `src/renderer/index.html`: `app.js` loads before `os.js`, `painel.js`, `tarefas.js`, `terminal.js`. So `app.js`'s window listener runs first and cannot rely on `e.defaultPrevented` set by the others. Use DOM queries instead.
  - `os.js` Esc: `fechaRadial()` (the radial element is `div.radial`, class `on` when open, no id) plus closes `.janelinha` that are `:focus-within` and not `.fixa`. `tarefas.js` Esc: closes `tfSheet` when `document.activeElement === document.body`. `terminal.js` Esc refocuses the composer.

## Design

### Esc

No new IPC. Esc stays an in-window DOM handler (never `globalShortcut`). It reuses `vivo.parar()` (`ipcMain "parar"`).

```js
const interrompe = () => { if (rodando) vivo.parar(); };
// True when Esc has something to close. Closes what app.js owns; only reports what os.js/tarefas.js will close.
function fechaAlgo() {
  if (aberto de app.js) { fechaPicker(); fechaMenu(); fechaComandos(); fechaEscolhas(); fechaCreditos(); fechaPersonal();
    somPop.classList.remove("on"); remotoPop.classList.remove("on"); return true; }
  return !!document.querySelector(".radial.on, .janelinha:not(.fixa):focus-within") || tarefasAbertaSemFoco();
}
```

"aberto de app.js" is the same set the current line-1155 handler closes (picker `.open`, menu, commands menu, `popAberto`, `creditos`, personal, `somPop`, `remotoPop` with class `on`); read each element's actual variable there, do not invent ids. `tarefasAbertaSemFoco = () => tfSheet && !tfSheet.j.el.classList.contains("fixa") && document.activeElement === document.body`, mirroring the `tarefas.js` Esc condition (`tfSheet` is a top-level `let` in a classic script, visible to `app.js` at event time). No `os.js` change is needed (`janelinha` already sets `el.dataset.id`).

Window handler: `if (e.key === "Escape") { if (!e.isComposing && e.keyCode !== 229 && !e.repeat) { if (fechaAlgo()) { if (!document.activeElement || document.activeElement === document.body) entrada.focus(); } else if (!inputAlheio(e)) interrompe(); } return; }` with `inputAlheio = (e) => e.target.closest?.("input, textarea") && e.target !== entrada` (covers rename inputs, perm feedback input, `bibBusca`, terminal input, Customize inputs). A pending permission/question card does not stop the interrupt: it denies the card through the existing abort handler. Esc with no running turn is a no-op. `keyCode 229` covers the Windows TSF/Vietnamese IME Esc that cancels a composition with `isComposing` false. After `fechaAlgo()` closes something, focus returns to `entrada` if it fell to `body` (a popover `.opcao` was hiding), so typing continues and a second Esc interrupts. Remove `if (e.key === "Escape") fechaPicker();` in the `entrada` handler (~453) and the `bibBusca` Esc handler (~1374) so the window handler owns picker closing.

### Shortcuts

In the window keydown, next to the Ctrl+Shift+N rule, with a `ctrlKey && shiftKey && !altKey` guard on `e.code` (layout independent), each with `preventDefault()` and `return`:

| Combo (`e.code`) | Action |
|---|---|
| Ctrl+Shift+M (`KeyM`) | `cicloModo()` |
| Ctrl+Shift+I (`KeyI`) | `abreEscolhaDe("modelo")` |
| Ctrl+Shift+E (`KeyE`) | `abreEscolhaDe("esforco")` |
| Ctrl+Shift+P (`KeyP`) | `abreEscolhaDe("modo")` |

- `montaEscolha` registers `botoesEscolha[id] = btn`. Check that the effort picker (~1080+) registers under `"esforco"` too (via `montaEscolha` or its own button).
- `abreEscolhaDe(id)`: `botoesEscolha[id]?.click()`. It goes through `abreEscolha`, which toggles and closes any other open picker; when the toggle closes it, call `entrada.focus()`. After opening, focus the selected `.opcao` (or the effort control) so arrows and Enter work.
- `cicloModo()`: `ordem = ["default","acceptEdits","plan","auto"]`; `next = ordem[(ordem.indexOf($("modo").value) + 1) % ordem.length]` (from bypass, `indexOf` is -1 so it goes to default). Compute from a renderer-local `modoPendente ?? $("modo").value` (set on each press, cleared when the `config` event whose `modo` equals it arrives), so rapid presses never cycle from a stale value. Set `$("modo").value`, dispatch `change` (reuses `guardaEscolha`, so it works mid-turn), refresh the chips, and show a keyed toast `nota(tr("Modo: {0}", rotuloDoModo))` where the label is the translated option text (new key `Modo: {0}` in `app.json` with en and vi; follow how existing dynamic `{0}` strings are translated in `app.js`). Bypass is never in the cycle, so the shortcut can never raise the dialog.

### Bypass mode

- `MODOS` gains `"bypassPermissions"`. Plan approval stays safe: `MODOS.includes(modo) && modo !== "plan" && modo !== "bypassPermissions"`.
- `query` options get `allowDangerouslySkipPermissions: true` only when `t.cfg.modo === "bypassPermissions"` at process start, so a process opened in another mode cannot be moved into bypass by a Remote Control client (`ligaRemoto`) without the native dialog. Entering bypass from another mode therefore always sets `t.reiniciar` (rework `aplicaNoTurno`: bypass in or out of the mode forces a reopen on the next message instead of live `setPermissionMode`; other mode changes stay live). Leaving bypass also reopens, so the flag is not left on. After each init event compare `msg.permissionMode` with `t.cfg.modo`; on mismatch (CLI refused, or a remote client switched it) sync `t.cfg.modo` to the reported value, `guardaCfg`, `avisaConfig()` and `nota()` a warning.
- `cfgSessao` sanitizes: `modo: MODOS.includes(x.modo) ? x.modo : "default"` (apply after the `porSessao` spread). This also hardens against hand-edited `config.json` and makes the rollback safe: a stored bypass never reaches the SDK without the flag.
- Confirmation lives in main so every entry path goes through it:

```js
async function confirmaBypass(j) {
  const r = await dialog.showMessageBox(j.win, { type: "warning", noLink: true, buttons: [t("Cancelar"), t("Ativar")], defaultId: 0, cancelId: 0,
    message: t("Ignorar todas as permissões?"),
    detail: t("O Claude vai editar arquivos e rodar comandos sem pedir aprovação. Use só em pastas e projetos em que você confia.") });
  return r.response === 1;
}
// in ipcMain.handle("config"), before mudaConfig:
if (modo === "bypassPermissions" && cfgJ(j).modo !== "bypassPermissions") {
  if (j.confirmandoBypass) return { ...config, ...cfgJ(j), depois: [] };   // dialog already open
  const id = j.sessionId; j.confirmandoBypass = true;                       // capture before the await
  const ok = await confirmaBypass(j).finally(() => { j.confirmandoBypass = false; });
  if (!ok || j.sessionId !== id) { avisaConfig(); return { ...config, ...cfgJ(j), depois: [] }; }  // chip reverts via the "config" event
  // else continue: mudaConfig(j, m, id)
}
```

  `confirmaBypass` adds `j.cwd` to the dialog `detail` (the folder that gets bypass), via a `{0}` placeholder key. If the conversation changed during the dialog, the request is dropped.

  Reuse the existing `t` translator in `main.js`; add the new keys to the i18n parts (see Files). Check that "Cancelar" already exists.
- Never the global default: in `mudaConfig`'s no-id branch (`Object.assign(config, m)`) bypass must not reach `config.modo`. For a conversation without `sessionId`, keep it on the window object: set `j.modoBypass = true` and have `cfgJ(j)` return `{ ...cfgSessao(j.sessionId), modo: "bypassPermissions" }` when `!j.sessionId && j.modoBypass`. Any other `modo` change sets `j.modoBypass = false`. `j.sessionId` is cleared at `nova` (~1255), the delete handler (~1400), folder pick (~1409), ~1415, ~1448 and ~1465, so add one helper `limpaConversa(j)` (`j.sessionId = null; j.atual = null; j.modoBypass = false`) and call it from every one of those sites (keep any extra statements on the line, e.g. the `cwd` assignments); step 4 greps `sessionId = null` to prove none is left. Where `j.sessionId` is assigned (~642, ~1318, ~1340) also clear `j.modoBypass`.
- Branching (`ramificar`, ~1339) copies the source's stored config: a fork of a bypass conversation downgrades `bypassPermissions` to `default` (`guardaCfg(r.sessionId, { ...cfgSessao(origem), modo: ... })`). Resuming an existing conversation keeps its stored mode (red chip shows it; resume was confirmed when entered). When the first turn creates the session, `guardaCfg(t.sessionId, t.cfg)` at the init event stores bypass for that conversation only.
- Not offered in plan approval (whitelist above) and not offered for scheduled tasks (a later phase owns that list; it must not include bypass).
- UI: `<option value="bypassPermissions">Ignorar permissões</option>` after Automatic in `#modo`; `ESCOLHAS.modo.itens.bypassPermissions` description (en and vi); `ICONES_MODO.bypassPermissions` (warning triangle path, falls back to default if missing); a red `.chip` accent class (in `src/renderer/app.css`) applied when the value is bypass. Confirm the plan card's mode buttons do not list bypass.
- Shortcut list (`abreAtalhos`): reword the Esc row to "Interromper a resposta (se nada estiver aberto, fecha menus e painéis)" and add rows for Ctrl + Shift + M, I, E, P.

### Other Esc sources

- `terminal.js` needs no change: `inputAlheio` covers its input and focus has left a floating window by the time `os.js` runs.
- Rename/create inputs (`app.js` 855, 946, `painel.js` 205) are covered by `inputAlheio`; no change.

## Files to Create / Modify

| Path | Action | Change |
|---|---|---|
| `src/main.js` | Modify | `MODOS` + bypass, conditional `allowDangerouslySkipPermissions`, `aplicaNoTurno` reopen rule, init-mode sync, `cfgSessao` mode sanitizing, plan whitelist, `confirmaBypass`, `config` guard (captured id, single dialog), `cfgJ` overlay, `j.modoBypass`, `limpaConversa(j)` at every `sessionId = null` site, fork downgrade |
| `src/renderer/app.js` | Modify | `interrompe`, `fechaAlgo`, `inputAlheio`, Esc handler, four shortcuts, `botoesEscolha`/`abreEscolhaDe`/`cicloModo`, bypass description/icon/chip class, `modoPendente`, shortcut rows, focus return, drop the two redundant Esc closers |
| `src/renderer/index.html` | Modify | bypass `<option>` in `#modo` |
| `src/renderer/app.css` | Modify | red accent for the bypass chip |
| `src/renderer/i18n/parts/app.json` | Modify | en/vi for new shortcut rows, bypass description, `Modo: {0}` toast, dialog strings (`{0}` folder) |
| `src/renderer/i18n/parts/html-extras-themes.json` | Modify | en/vi for "Ignorar permissões" next to "Automático" |
| `README.md` | Modify | features: Esc interrupt, picker shortcuts, bypass mode |

## Tasks & Steps

- [x] 1. Create the branch: `git switch -c feat/desktop-parity` (from main; untracked `plans/` stays).
- [x] 2. Re-read the functions listed in Context at their current lines before editing.
- [x] 3. Main: extend `MODOS`; sanitize in `cfgSessao`; patch the plan whitelist; conditional `allowDangerouslySkipPermissions`; `aplicaNoTurno` reopen rule; init-mode sync.
- [x] 4. Main: add `confirmaBypass`; guard in `ipcMain "config"`; the `j.modoBypass` overlay in `cfgJ` and the no-id branch of `mudaConfig`; `limpaConversa(j)` at every site (`grep -n "sessionId = null" src/main.js` must show none left outside the helper); fork downgrade in `ramificar`.
- [x] 5. HTML and renderer: bypass option, description, icon, chip accent.
- [x] 6. Renderer: `botoesEscolha` registry (modo, modelo, esforco), `abreEscolhaDe`, `cicloModo`.
- [x] 7. Renderer: `interrompe`, `fechaAlgo`, `inputAlheio`; rewrite the Esc branch of the window handler; delete the two redundant `fechaPicker` Esc closers.
- [x] 8. Renderer: add the four shortcuts; update `abreAtalhos` rows.
- [x] 9. Define `tarefasAbertaSemFoco` per the Esc design (no `os.js` or `terminal.js` edits).
- [x] 10. Collision check: run the app and press Ctrl+Shift+I; confirm `preventDefault()` in the page stops Electron's DevTools accelerator. If the default menu still fires, replace the application menu with the default template minus the DevTools accelerator (do not use `setApplicationMenu(null)`, it loses Edit shortcuts).
- [x] 11. i18n: en and vi for every new string; `JSON.parse` both files, and check each new key exists in the dictionary (see Verification).
- [x] 12. README: update the permission-mode, per-conversation and shortcut text (~lines 34, 40, 112): Esc, the four shortcuts, bypass with its confirmation.
- [ ] 13. Run Verification, then commit: `feat(app): esc interrupt, picker shortcuts and bypass permissions mode` (no AI references).

## Security & Safety

- Bypass is reachable only from the mode picker and only after a main-process native warning dialog (default button Cancel). The renderer cannot skip it; the cycle shortcut, plan approval and scheduled tasks never enter it.
- Never saved as the default for new conversations; stored per conversation, and every path that clears `sessionId` also clears the pending-bypass flag, so a new conversation starts in Automatic. Forks downgrade to Ask; resuming keeps the stored mode.
- Remote Control: the flag is passed only to a process started in bypass, so a remote client cannot raise a normal process into bypass; an init/mode mismatch is synced back and warned.
- Deny rules, ask rules and hooks still apply in bypass (SDK behavior per sdk-facts); do not promise more in UI text.
- Esc is never a `globalShortcut`, so it cannot steal Esc system-wide. `allowDangerouslySkipPermissions` is never present unless bypass was confirmed first.
- IME composition (including `keyCode 229`) and key repeat never interrupt, avoiding accidental stops while typing Vietnamese.

## Acceptance Criteria

- Esc with the composer focused and a turn running stops the turn; with no turn it does nothing.
- With any of a picker, mention or command menu, shortcut list, Customize panel, lightbox, radial menu, focused non-pinned floating window, tasks sheet, or sound/remote popover open, Esc closes only that and the turn keeps running; a second Esc interrupts.
- Esc inside a rename input, the terminal input, `bibBusca` or the permission feedback input never interrupts.
- Esc with a pending permission card interrupts and the card resolves as denied.
- Ctrl+Shift+M cycles Ask, Accept edits, Plan, Auto and wraps (from bypass goes to Ask), also mid-turn, with a toast naming the mode.
- Ctrl+Shift+I/E/P open the model, effort and permission menus; pressing again closes; none opens DevTools.
- Choosing "Ignorar permissões" shows a native warning. Cancel leaves chip and `config.json` unchanged. Activate stores `modo: "bypassPermissions"` in that conversation's `porSessao`, the init event reports it, and a Bash/Edit call runs without a card.
- A brand-new conversation after using bypass starts in Automatic; reopening the bypass conversation resumes in bypass.
- The plan approval card still offers only Ask, Edit without asking, Auto.
- Ctrl+/ lists the new rows in pt, en and vi.

## Verification

```bash
node --check src/main.js && node --check src/renderer/app.js && node --check src/renderer/os.js && node --check src/renderer/terminal.js
node -e "for (const f of ['app','html-extras-themes']) JSON.parse(require('fs').readFileSync('src/renderer/i18n/parts/'+f+'.json','utf8'))"
node -e "const f=require('fs'),d=f.readFileSync('src/renderer/i18n/parts/app.json','utf8')+f.readFileSync('src/renderer/i18n/parts/html-extras-themes.json','utf8'); for (const k of ['Modo: {0}','Ignorar todas as permissões?','Ignorar permissões']) if(!d.includes(k)) throw new Error('missing '+k)"
VIVO_JS="document.querySelector('#modo').options.length" VIVO_FOTO=out.png npm start
VIVO_LOG=1 VIVO_TESTE="run a long bash sleep 60 then say done" npm start
```

Manual (separate profile): start a long turn and press Esc; open the model picker (Ctrl+Shift+I) then Esc twice; walk every surface in the acceptance list; cycle with Ctrl+Shift+M mid-turn and check `porSessao` in `config.json`; choose bypass (Cancel, then Activate) and run a Bash tool; restart and reopen it; start a new chat; screenshot Ctrl+/ in pt, en, vi via `VIVO_JS` + `VIVO_FOTO`.

## Risks & Rollback

- Ctrl+Shift+I may still trigger DevTools through the default menu: handled in step 10.
- `fechaAlgo` mirrors `os.js`/`tarefas.js` rules by DOM query; if they drift, Esc would close and interrupt together. Mitigation: the acceptance walk-through.
- A managed policy (`disableBypassPermissionsMode`) may make the CLI refuse bypass: the process reopens in a mode it will not honor and the chip would show a mode that is not active. The init-event comparison syncs `modo` back and warns (`t.reiniciar` is one-shot, so there is no loop).
- Rollback: `git revert` the phase commit; no migration (a stored `bypassPermissions` falls back to default because `cfgSessao` validates against `MODOS`, which the revert restores to the old list).

## Docs impact

README feature section (English): Esc interrupt behavior, the four shortcuts, and the bypass permission mode with its confirmation. No other docs.

## Red-team notes

Applied (verified in source): conditional `allowDangerouslySkipPermissions`; `limpaConversa(j)` at all six `sessionId = null` sites; `cfgSessao` sanitizing (main.js:126 spreads unvalidated); `.radial.on` (os.js:237 has no id); fork downgrade (`ramificar` copies config); captured `id` and single-dialog guard; focus return after Esc; drop os.js/terminal.js changes (`dataset.id` exists at os.js:20, `tfSheet` is global, mirror tarefas.js:96); `modoPendente`; `keyCode 229`; keyed `Modo: {0}` toast and en/vi key check; risk text reworded and `app.css` named.
Rejected: none. The Remote Control bypass-switch behavior is unverified against SDK docs, so the fix is defensive (flag only in bypass, init-mode sync).
