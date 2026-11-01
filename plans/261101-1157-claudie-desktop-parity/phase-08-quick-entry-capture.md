---
phase: 8
title: "Quick Entry, claudie:// links, screen capture"
status: completed
priority: P3
effort: "2d"
dependencies: ["05"]
---

# Phase 08: Quick Entry, claudie:// links, screen capture

## Goal

Add a global Quick Entry window (Ctrl+Alt+Space), `claudie://` deep links that always ask before sending, and screen/window/region capture attached to the composer as an image.

## Context

- Code scout with integration points: [scout-quick-entry-capture.json](research/scout-quick-entry-capture.json). Locate code by function name, not line number: `criarJanela`, `atalhoGlobal`, `instanciaUnica`, `ajustaImagem`/`montaPrompt`, IPC `enviar`/`nova_em`/`anexar`, renderer `aoEvento`, `envia`, `novaConversa`, `novaNoProjeto`, `anexaArquivos`, `$("clipe").onclick`, `abreEscolha`/`fechaEscolhas`.
- Locked decisions ([decisions.md](research/decisions.md), "Quick Entry" line): frameless always-on-top window, default Ctrl+Alt+Space (configurable), new conversation by default with a "current conversation" toggle targeting the last focused window; `claudie://` registered in packaged builds, in dev only with `VIVO_LINK=1`; `claudie://new?prompt=&cwd=` always asks; `claudie://session/<id>` opens a new window; paperclip becomes a two-item popover (Files, Screenshot); region overlay covers the display under the cursor.
- Electron facts ([research-electron-views.md](research/research-electron-views.md) sections 3, 6, 7): `register` returns false when the accelerator is taken; Windows delivers the link in `argv` for cold start and `second-instance`; `desktopCapturer` thumbnails need `thumbnailSize` = display pixels for full resolution; electron-builder `protocols` is unverified for NSIS, so runtime `setAsDefaultProtocolClient` is the primary path.
- Phase 05 dependency: windows can be hidden to the tray (`close` intercepted, `janelas` keeps them, turns keep running). That is not in the repo until phase 05 lands (today `window-all-closed` calls `app.quit()` unconditionally), so step 1 verifies it. Quick Entry must `show()` the target window, and the Quick Entry/overlay windows must never keep the process alive.
- Attachments already travel as `{nome, dados(b64), mime, url}` through `envia()` -> IPC `enviar` -> `montaPrompt` (runs `ajustaImagem`). No new send path.
- `J(e)` is undefined for Quick Entry and overlay senders. Their IPC uses dedicated channels with a sender check (`e.sender` plus `e.senderFrame.url` equal to the expected `rapida.html` / `captura-regiao.html` file URL).

## Design

**Config** (`config.entradaRapida = { atalho: "Control+Alt+Space", ligada: true }`; `lerConfig` merges unknown keys, no migration). `rapidaErro` (module var) holds the last registration error.

**Main-process state** (`src/main.js`): `let rapida = null` (hidden window, created once), `let ultimaFocada = null` (set in `criarJanela` via `win.on("focus")`, cleared in `closed`), `let linkPendente = null`, `let capturaGesto = null` (one-use capture token), `filaLinks` (array, one dialog at a time). Helper `alvo()` = `ultimaFocada` if alive, else `principal`, else the first of `[...janelas.values()]`, else `criarJanela()`.

**Quick Entry window** (`src/rapida.html`, `src/rapida.js`, `src/preload-rapida.cjs`):
- `criaRapida()`: `new BrowserWindow({ width: 640, height: 168, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, show: false, webPreferences: { preload: preload-rapida.cjs, sandbox: true, contextIsolation: true } })`, `setAlwaysOnTop(true, "screen-saver")`, `loadFile("rapida.html")`, `on("blur", escondeRapida)` (ignored while a capture runs and for ~200 ms after every `show()`/re-show, so foreground-lock focus flicker cannot hide it). On this window and the overlay: `will-navigate` and `will-frame-navigate` call `preventDefault`, and `setWindowOpenHandler(() => ({ action: "deny" }))`.
- `mostraRapida()`: position on `screen.getDisplayNearestPoint(screen.getCursorScreenPoint())`, centred horizontally, top at 28% of `workArea`; `show(); focus(); webContents.send("rapida:abre", { novaPadrao })`. `novaPadrao` is always true on every open; the toggle is an explicit per-open choice and is not remembered. `alterna()` hides when visible.
- Renderer: textarea (Enter sends, Shift+Enter newline, Esc hides, IME-safe via `isComposing`; this Esc/IME handling is local to `rapida.js`, separate from the main window's global Escape handler), image paste plus `dragover`/`drop` `preventDefault` with dropped images routed through the same FileReader path (copy it from `anexaArquivos`), attachment chips, toggle chip `Nova conversa` / `Conversa atual`, camera button.
- Preload bridge `rapida`: `enviar({texto, anexos, nova})`, `fechar()`, `capturar()`, `aoAbrir(fn)`, `i18n: () => ipcRenderer.sendSync("i18n")` (the existing `ipcMain.on("i18n")` handler does not use `J(e)`, so it works unchanged). `rapida.html` and the overlay load `renderer/i18n/i18n.js` (or a small `t()`) as a same-origin script, and every label, placeholder and toggle string goes through `t()`. Overlay preload bridge `captura`: `rect({x,y,w,h})`, `cancelar()`, `aoIniciar(fn)` (can live in the same `preload-rapida.cjs`, both windows are sandboxed with the same two-line pattern).
- CSP meta in both HTML files: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data:`. No Claudie IPC beyond the bridge; `script-src 'self'` already admits the same-origin i18n script, relax nothing else.

**IPC (main)** — all guarded by `e.sender === rapida?.webContents` (or the overlay's) and the expected `e.senderFrame.url`:

| Channel | Direction | Payload | Result |
|---|---|---|---|
| `rapida_enviar` | quick -> main | `{texto, anexos, nova}` (text <= 100000 chars, <= 6 images, mime `image/(png\|jpeg\|gif\|webp)`, b64 only; each b64 <= ~7 MB, total <= ~20 MB, validated with `/^[A-Za-z0-9+/=]+$/`) | hides, targets window, dispatches |
| `rapida_capturar` | quick -> main | none | `{nome, dados, mime}` or null |
| `rapida_atalho` | Customize -> main (`J(e)` ok) | `{atalho?, ligada?}`; either change calls `registraRapida()` then `salvarConfig()` | `{ok, erro?}` |
| `janela_pronta` | main window -> main | none | sets `j.pronta`, flushes `j.fila`; `j.pronta` is reset to false on `did-start-loading` |
| `captura_gesto` | main window -> main | none | arms `capturaGesto` (one use, ~30 s expiry); sent only from the click handler of the popover's Screenshot item |
| `captura_fontes` | main window -> main | none | consumes the gesture token, else rejects; `[{id, nome, tipo, thumb}]`, ids remembered for the next call only |
| `captura_fonte` | main window -> main | `id` | rejected unless `id` was in the immediately preceding `captura_fontes` result; `{nome, dados, mime}` or null |
| `captura_regiao` | main window -> main | none | consumes the gesture token, else rejects; `{nome, dados, mime}` or null |
| `captura_rect` / `captura_cancela` | overlay -> main | rect / none | resolves the pending capture |

**Dispatch** (queue until the renderer is initialised):
```js
function despachaParaJanela(j, ev) {
  if (j.pronta) enviarEvento(j, ev); else (j.fila ||= []).push(ev);
}
ipcMain.handle("janela_pronta", (e) => { const j = J(e); j.pronta = true; for (const ev of j.fila?.splice(0) || []) enviarEvento(j, ev); });
```
`rapida_enviar` target: `const j = alvo()` (never dereferences a null `principal`); then `escondeRapida()`, `j.win.show()` (restore if minimized), `focus()`, `despachaParaJanela(j, { tipo: "entrada_rapida", texto, anexos, nova })`.

**Renderer** (`src/renderer/app.js`): new `case "entrada_rapida"` in `aoEvento`:
```js
async function entradaRapida(ev) {
  if (ev.cwd) { mostraPasta(ev.cwd); todosComandos = buscandoComandos = null; carregaSessoes(); }
  if (ev.nova) await novaConversa();
  if (!ev.texto && !(ev.anexos || []).length) return;
  const rascunho = { texto: entrada.value, anexos };
  anexos = (ev.anexos || []).map((a) => ({ ...a, url: "data:" + a.mime + ";base64," + a.dados }));
  try { await envia(ev.texto || ""); }
  finally { if (!ev.nova) { entrada.value = rascunho.texto; anexos = rascunho.anexos; desenhaAnexos(); ajustaAltura(); } }
}
```
The composer is touched only when there is something to send, and a draft in the current conversation is saved and restored (`envia(textoForcado)` already exists; it must be made to read the swapped `anexos`, which it does today by reading the module variable, so verify and adjust minimally). `envia()` already handles a busy turn (inject) and restores text on failure. A link `cwd` is applied to the target window only (see Deep links), not through global config. `vivo.janelaPronta()` is called inside the `boasVindas(cb)` callback after the intro is removed and `entrada.focus()`, and directly in the `sessao || e.janelas > 1` branch after its awaits; `criarJanela` resets `j.pronta = false` on `did-start-loading`, so a reload re-queues events.

**Shortcut registration**: `registraRapida()` unregisters the previous accelerator, then `globalShortcut.register(config.entradaRapida.atalho, alterna)` when `ligada`; a false return sets `rapidaErro` and, in the setter, restores the previous accelerator. `rapida_atalho` validates with `/^((Control|Ctrl|Alt|Shift|Super|CommandOrControl)\+)+([A-Z0-9]|F\d{1,2}|Space|Tab|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete)$/i`, then normalises modifiers to a canonical set (Control/Ctrl/CommandOrControl -> Control, plus Alt, Shift, Super). It requires Control, Alt or Super in the set (Shift alone is rejected, so no `Shift+A`), and rejects a set+key equal to `atalhoGlobal`'s (compared canonically, so `Shift+Ctrl+Space` is caught too). `globalShortcut.isRegistered(accel)` is checked before `register` (already ours means duplicate, not taken by another app). Saves via `salvarConfig()`. Customize 'geral' tab gets a recorder row (readonly input that captures `keydown` into an Electron accelerator string; Esc cancels) plus an on/off switch that calls `vivo.rapidaAtalho({ligada})` (the `config.entradaRapida` key is outside `config.visual`, so the `visual` channel is not used). Error text shown under the row.

**Screen capture** (`src/captura.js`, imports only `electron`; main.js passes the windows to exclude):
- `listaFontes(excluir)`: `desktopCapturer.getSources({ types: ["screen","window"], thumbnailSize: {width: 320, height: 200}, fetchWindowIcons: false })`, drop ids equal to `win.getMediaSourceId()` of Claudie windows and empty-name windows; map to `{id, nome, tipo: id.startsWith("screen:") ? "screen" : "window", thumb: thumbnail.toDataURL()}`.
- `capturaFonte(id, escondidas)`: hide every Claudie window including Quick Entry (`hide()`), wait 200 ms, `getSources` with `thumbnailSize = display.size * scaleFactor` for screens (match `String(display.id) === src.display_id`) or 3840x2160 for windows, find by id, `thumbnail.toPNG()`; in `finally` restore the windows that were visible, and when the caller was Quick Entry `show()` + `focus()` it again and re-arm blur (200 ms grace).
- `capturaRegiao(display, escondidas)`: grab the display at full pixel size, open the overlay (`transparent, frame:false, alwaysOnTop "screen-saver", skipTaskbar, hasShadow:false, fullscreenable:false`, `setBounds(display.bounds)`, `focus()`), wait for `captura_rect` or `captura_cancela`; a 60 s failsafe timer, Esc and right click all cancel. Crop `img.crop({ x: round(x*sf), y: round(y*sf), width: round(w*sf), height: round(h*sf) })` clamped to image size, reject < 8x8. A module `capturando` flag allows one capture at a time. The overlay always closes and all hidden windows are restored in `finally` (same Quick Entry re-show rule).
- File name `captura-AAAAMMDD-HHMMSS.png`; result `{nome, dados: png.toString("base64"), mime: "image/png"}`.
- Overlay (`src/captura-regiao.html`/`.js`): full-window dim layer, drag draws a clear rectangle with size label, crosshair cursor; release sends CSS-px rect, Esc/right-click cancels.

**Composer UI**: `#clipe` click opens a small popover with `Arquivos...` (existing handler) and `Captura de tela...` (its click handler first calls `vivo.capturaGesto()`). The popover and the picker both use the `.escolha` class and sit directly after their trigger button in `index.html` (`abreEscolha` relies on `pop.previousElementSibling`; the pointerdown closer ignores only clicks inside `.escolha`); both register with `popAberto`, and the picker's close function is added to the global Escape handler in `app.js`. The picker: first tile `Selecionar região`, then thumbnails from `vivo.capturaFontes()`. Result is pushed with `anexos.push({nome, dados, mime, url:"data:image/png;base64,"+dados}); desenhaAnexos()`. New strings go through `t()`.

**Deep links**:
- `registraProtocolo()` in `whenReady`: return early if `VIVO_PASTA || VIVO_JS || VIVO_ATALHOS`, or if `!app.isPackaged && !process.env.VIVO_LINK`. Dev: `if (process.defaultApp) { if (process.argv.length >= 2) app.setAsDefaultProtocolClient("claudie", process.execPath, [path.resolve(process.argv[1])]); } else app.setAsDefaultProtocolClient("claudie")`.
- `linkDoArgv = (argv) => argv.find((a) => /^claudie:\/\//i.test(a))`. Cold start: `linkPendente = linkDoArgv(process.argv)` right after the lock, handled once the principal window is `pronta` (flush in `janela_pronta` for `principal`). Warm: `second-instance` becomes `(_e, argv)` (still shows the window) then `tratarLink(linkDoArgv(argv))`; add `app.on("open-url", ...)`.
- `tratarLink(raw)`: `new URL(raw.replace(/^"|"$/g, ""))` in try/catch, `protocol === "claudie:"`, `acao = u.hostname`.
  - `new`: `j = alvo()`. `prompt = (searchParams.get("prompt") || "").slice(0, 8000)`; a prompt starting with `/` is rejected (it would run a local UI command or a slash command), noted in the dialog. `cwd = searchParams.get("cwd")` kept only if `validaCwd(cwd)` (absolute, not UNC `\\`/`//` prefix, `fs.statSync(cwd).isDirectory()`); invalid cwd is dropped and named in the dialog. The dialog is skipped only for a link with neither prompt nor cwd (bare new conversation: `despachaParaJanela` with `nova:true`). Any link carrying a prompt or a cwd shows the native confirm, always with the folder. Before the dialog the target window is restored, shown and focused (it may be hidden to the tray), and links go through `filaLinks` so one dialog is open at a time. Dialog: `dialog.showMessageBox(j.win, { type: "question", buttons: [t("Enviar"), t("Cancelar")], defaultId: 1, cancelId: 1, noLink: true, title: t("Link do Claudie"), message: t("Um link quer iniciar uma conversa no Claudie"), detail: pasta + "\n\n" + limpa(prompt) })` where `limpa` strips control and bidi characters (the full capped prompt, not truncated to hide content). Only on "Enviar": `despachaParaJanela(j, { tipo: "entrada_rapida", texto: prompt, anexos: [], nova: true, cwd })`.
  - `session/<id>`: `u.pathname.slice(1)` must match `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`; focus the window already showing it, else `criarJanela(id)`. Nothing is sent.
  - anything else: ignored (log line).
- `defineCwd(j, cwd, { global = true })` extracted from the `nova_em` body (set `j.cwd`, reset `sessionId`/`atual`, and when `global` set `config.cwd`, `salvarConfig`, `enviarEvento config`); `nova_em` calls it with `global: true`. Link-supplied cwd uses `global: false`: it is applied only to the target window and that conversation's config (`config.porSessao` once the session exists), never persisted as the global `config.cwd`. In the renderer, `entradaRapida` shows the folder via `mostraPasta(ev.cwd)` for that window only.

**Quit hygiene**: in `criarJanela` `closed` handler, `if (janelas.size === 0) { rapida?.destroy(); rapida = null; fechaOverlay(); if (!escondendoNaBandeja()) app.quit(); }` (`escondendoNaBandeja` is phase 05's hide-to-tray condition; without it a hidden Quick Entry or overlay would keep `window-all-closed` from firing). `will-quit` already calls `globalShortcut.unregisterAll()`. The shortcut stays registered while windows are hidden to the tray, so Quick Entry works from the tray state.

## Files to Create / Modify

| Path | Action | Change |
|---|---|---|
| `src/captura.js` | create | `listaFontes`, `capturaFonte`, `capturaRegiao` using `desktopCapturer`/`screen`/`nativeImage` |
| `src/rapida.html` | create | Quick Entry markup, meta CSP, transparent glass card |
| `src/rapida.js` | create | Textarea, send/paste/toggle/camera logic over the `rapida` bridge |
| `src/preload-rapida.cjs` | create | Sandbox-safe `rapida` and `captura` bridges |
| `src/captura-regiao.html` | create | Overlay markup and CSP |
| `src/captura-regiao.js` | create | Drag-to-select rectangle, Esc/right-click cancel |
| `src/renderer/i18n/parts/entrada-rapida.json` | create | pt key -> en/vi for every new string |
| `src/main.js` | modify | Electron imports (`screen`, `desktopCapturer`), config default, `ultimaFocada`, `despachaParaJanela`, quick window + shortcut, IPC channels, `defineCwd`, protocol registration, `tratarLink`, single-instance argv, `closed` cleanup |
| `src/preload.cjs` | modify | `capturaGesto`, `capturaFontes`, `capturaFonte`, `capturaRegiao`, `rapidaAtalho`, `janelaPronta` |
| `src/renderer/app.js` | modify | `entrada_rapida` event, clipe popover, capture picker, `janelaPronta()`, Ctrl+/ list entry |
| `src/renderer/index.html` | modify | Attach popover and picker containers beside `#clipe` |
| `src/renderer/app.css` | modify | Attach popover, picker grid, capture chip styles |
| `src/renderer/personalizar.js` | modify | Quick Entry shortcut recorder row and on/off switch in the 'geral' tab |
| `package.json` | modify | `build.protocols: [{ name: "Claudie", schemes: ["claudie"] }]` |
| `README.md` | modify | Feature bullets, shortcuts line, link format, testing note |

## Tasks & Steps

1. [x] Confirm on branch `feat/desktop-parity` and verify phase 05 exists: the `close` interception, hide-to-tray and `janelas` semantics are present in `src/main.js`. If not, stop and report; do not assume them. Re-read `criarJanela`, the single-instance block and `whenReady` as phase 05 left them.
2. [x] Add `defineCwd(j, cwd)`; make `nova_em` use it.
3. [x] Add `ultimaFocada`, `j.pronta`/`j.fila`, `despachaParaJanela`, IPC `janela_pronta`; reset `j.pronta` on `did-start-loading`; call `vivo.janelaPronta()` in the `boasVindas` callback and in the `sessao || e.janelas > 1` branch, and expose it in `preload.cjs`.
4. [x] Write `src/captura.js` and the overlay files; wire IPC `captura_gesto`, `captura_fontes`, `captura_fonte`, `captura_regiao`, `captura_rect`, `captura_cancela` with the `capturando` flag and `finally` restore.
5. [x] Replace the `#clipe` handler with the two-item popover; build the picker; push results into `anexos`; register the picker with `popAberto` and the Escape handler.
6. [x] Write the Quick Entry window files, `criaRapida/mostraRapida/escondeRapida/alterna`, `rapida_enviar`, `rapida_capturar`, navigation lockdown and `i18n` in `preload-rapida.cjs`; add the `entrada_rapida` renderer case.
7. [x] Add `registraRapida`, `rapida_atalho` with validation and rollback; add the Customize recorder row, the on/off switch (`rapidaAtalho({ligada})`) and the Ctrl+/ entry.
8. [x] Add `registraProtocolo`, `linkDoArgv`, `tratarLink`, `validaCwd`; update `second-instance`, `open-url`, cold-start `linkPendente` flush; add `protocols` to `package.json`.
9. [x] Add the `closed` cleanup for the Quick Entry window and overlay; after closing the last window confirm with `Get-Process electron` that nothing is left.
10. [x] Fill `entrada-rapida.json` (pt/en/vi) for every new string; run all checks below.
11. [ ] Update README; commit `feat(quick-entry): add quick entry window, claudie links and screen capture` on `feat/desktop-parity` (no push, no AI reference, no plan or phase IDs).

## Security & Safety

- Deep-link text is untrusted. A link carrying a prompt or a cwd is never acted on without the native confirm (not renderer HTML), default and cancel button = Cancel, showing the folder and the full capped prompt with control/bidi characters stripped. Only a bare new-conversation link skips it. A link cwd is never persisted into global config (it would otherwise load project hooks, `.mcp.json` and `CLAUDE.md` from an attacker-chosen folder on the next message). Links are queued, one dialog at a time. No setting disables this.
- `cwd` must be an absolute existing directory, never UNC (an NTLM lookup would leak credentials), checked again in `defineCwd`.
- `session/<id>` accepts only a UUID shape and sends nothing.
- Quick Entry and overlay IPC check `e.sender` identity and `e.senderFrame.url`; no handler uses `J(e)` for them. Windows are sandboxed, context-isolated, with meta CSP, no Node, and navigation/new-window lockdown (dropped files cannot navigate them).
- Payload caps: 100000 chars text, 6 images, ~7 MB per image and ~20 MB total, mime allowlist, base64 regex; `ajustaImagem` shrinks large images at send time.
- Capture is user-initiated, enforced in main: the main-window channels require a one-use gesture token armed by the Screenshot menu click, `captura_fonte` accepts only ids from the immediately preceding listing, and calls are rate-limited (the `capturando` flag allows one at a time). A compromised renderer therefore cannot silently screenshot. Screenshots stay in memory (never written to disk), reach Claude only if the user sends. Claudie windows are excluded from the source list and all hidden during capture, always restored in `finally`.
- Dev and test profiles never register `claudie://` unless `VIVO_LINK=1`.

## Acceptance Criteria

- Ctrl+Alt+Space from any app shows Quick Entry centred on the cursor's display; pressing again, Esc or blur hides it.
- Enter always sends into a new conversation of the last focused window by default, even when that window has an idle open conversation (toggle switches to the current conversation); text and pasted/captured images arrive as a normal user message with image blocks.
- Changing the shortcut in Customize re-registers it; a taken accelerator shows an error and keeps the previous one; Ctrl+Shift+Space and its reorderings (`Shift+Ctrl+Space`, `CommandOrControl+Shift+Space`) and Shift-only combos are rejected; the on/off switch registers/unregisters.
- Quick Entry works while the app sits in the tray (window hidden); closing the last real window quits the app with no leftover electron process; an unsent draft in the target conversation survives a Quick Entry or link send into it.
- `claudie://new?prompt=...&cwd=...` shows the native confirm; Cancel does nothing, Enviar creates a conversation in that folder and sends. Same on cold start. UNC or missing cwd is ignored; prompts over 8000 chars are capped; a link with a cwd but no prompt also asks; a leading `/` prompt is rejected; only a bare `claudie://new` skips the dialog. Global `config.cwd` is unchanged after any link.
- `claudie://session/<valid id>` opens a window on that session; an invalid id or unknown action does nothing.
- Paperclip opens Files/Screenshot; the picker lists screens and windows (not Claudie); region drag crops the correct pixels on a scaled display; Esc cancels; the Claudie window is restored in every path.
- All new UI strings exist in pt/en/vi; README documents the features.

## Verification

- `node --check src/main.js; node --check src/captura.js; node --check src/rapida.js; node --check src/captura-regiao.js; node --check src/preload.cjs; node --check src/preload-rapida.cjs; node --check src/renderer/app.js; node --check src/renderer/personalizar.js` (each separately).
- `node -e "JSON.parse(require('fs').readFileSync('src/renderer/i18n/parts/entrada-rapida.json','utf8'))"`, then confirm each new `t("...")`/UI key is present.
- Launch check: `VIVO_JS="document.getElementById('clipe').click(), document.title" VIVO_FOTO=shot.png npm start`, read the screenshot (popover renders, no console errors).
- Manual Quick Entry: run `npm start`, use the shortcut from another app, send a text, then a pasted image, then a capture; check new/current toggle; occupy the accelerator elsewhere and change it in Customize.
- Manual deep link (dev): `$env:VIVO_LINK=1; npm start`, then `Start-Process "claudie://new?prompt=ola&cwd=F:/Nam/UIT/Claudie"`; repeat with the app closed; try `claudie://session/<real id>`, a bad id, `claudie://new?cwd=\\host\share`, and an 8000+ char prompt.
- Manual capture on a 125%/150% display: compare the PNG pixel size with rect x scaleFactor; check `VIVO_LOG=1 VIVO_TESTE="describe the image"` style send shows an image block.
- Packaged: `npm run dist`, install, `reg query HKCU\Software\Classes\claudie`, open the link from Win+R.
- Afterwards list and stop only the electron processes started by these tests (`Get-Process electron`), restore the real `claudie://` handler if a dev run changed it.

## Risks & Rollback

- Handler hijack: a dev run could replace the installed app's `claudie://` registration. Mitigated by the `VIVO_LINK` gate; if it happens, reinstall or re-run the packaged app once.
- Ctrl+Alt+Space can be taken (register false) or mistyped by AltGr layouts: surfaced as an error, accelerator configurable, switch to turn it off.
- Black or empty window thumbnails (protected/GPU windows) on Windows; screens and region still work.
- Mixed-DPI multi-monitor: overlay is limited to one display; crop uses that display's `scaleFactor`.
- Overlay can sit under another top-most window: same `screen-saver` level, focus on open, 60 s failsafe, Esc always closes.
- Events arriving before the renderer is ready are queued in `j.fila`; `janelaPronta()` fires only after the intro, and `j.pronta` resets on reload, so nothing is dropped or races the intro.
- Rollback: revert the single phase commit; `config.entradaRapida` is ignored by older code and removing `protocols` leaves no residue besides the HKCU key, removable with `reg delete HKCU\Software\Classes\claudie /f`.

## Docs impact

- `README.md`: feature bullets for Quick Entry (shortcut and toggle), `claudie://new?prompt=&cwd=` and `claudie://session/<id>` (confirm shown whenever a prompt or folder is present), screen capture from the paperclip; "Shortcuts and credits" gains the Quick Entry shortcut; "Testing" gains the `VIVO_LINK=1` dev-registration note and how to try a link.
- No other docs need changes.

## Red-team notes

Applied (verified against source): link confirm for any prompt/cwd and no global cwd persist (`nova_em` at `main.js` sets and persists `config.cwd`); `novaPadrao` always true (matches decisions.md); `i18n` sendSync in `preload-rapida.cjs` (`ipcMain.on("i18n")` ignores `J(e)`); capture gesture token and id check; navigation lockdown and `senderFrame.url` check (main window alone has `setWindowOpenHandler`); `j.pronta` reset and `janelaPronta()` moved into the `boasVindas` callback (init IIFE ends before the intro, confirmed in `app.js`); draft preservation; shortcut canonicalisation and `isRegistered`; `rapida_atalho` carries `ligada`; capture re-show/blur grace, `String(display.id)`; dialog parent shown first, link queue, `alvo()`, strict UUID, control/bidi strip, leading `/` rejected; payload byte caps and null-safe fallback; phase 05 existence check plus `app.quit()` fallback (`window-all-closed` still quits unconditionally today); Escape/`.escolha` wiring.

Rejected: none outright. The finding that phase 05 is absent from the repo is accepted as a precondition check, not a defect: this phase depends on 05 and runs after it.
