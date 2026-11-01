---
phase: 4
title: "In-app browser pane and dev servers"
status: pending
priority: P2
effort: "~1.5 days"
dependencies: ["02"]
---

# Phase 04: In-app browser pane and dev servers

## Goal

Dock a real browser (a `WebContentsView`) beside the chat that the person and Claude can both drive, with per-site approval for Claude (once per site per conversation), and start/stop the project's `.claude/launch.json` dev servers from the pane or from Claude.

## Context

- Locked choices (do not contradict): [decisions.md](research/decisions.md), "Browser pane" line. Docked column beside the chat; partition `persist:claudie-preview`; loopback and launch.json URLs skip approval; other sites ask once per site per conversation through the permission card (no persistent list); chat links stay external, Alt+click opens them in the pane; Claude in Chrome stays enabled and a system-prompt line prefers the in-app browser for localhost previews.
- Scout: [scout-browser-pane.json](research/scout-browser-pane.json). Electron facts: [research-electron-views.md](research/research-electron-views.md) section 1-2. CDP `Input.*` and `Accessibility.getFullAXTree` are unverified there: confirm at https://chromedevtools.github.io/devtools-protocol/ before coding step 6.
- Phase 02 (dependency) extracts `pedePermissao(t, toolName, input, { signal, suggestions, decisionReason })` from `canUseTool`, and appends to `systemPrompt` in `turn()`. Re-read both first and extend them; do not extract a second approval helper. Confirm the helper keeps the `if (!t.ativo) comecaTurno(...)` line so a card raised while idle opens a turn; add it back if phase 02 dropped it.
- Verified anchors (names first, lines drift): `resolveExe`, `dentroDaPasta`, `salvarConfig`, `texto`, `servidorTemasPara` (MCP server `claudie`, also called with a window `j` from `comConsulta`), `FERRAMENTAS_TEMA`, `ajustaImagem(dados, mime)` returning `{ dados, mime }` or `null`, `criarJanela` (`minWidth: 940`, `titleBarOverlay` height 44, `closed` handler sets `j.fechada = true` then `terminalMata(j)`), `setWindowOpenHandler`, `ipcMain.handle("permissao")`, `terminalMata`/`terminalLiga`, `before-quit`. Window state is `j = { win, sessionId, atual, cwd, term, fechada }` in `janelas`; `J(e)` resolves it from an IPC event; a turn `t` has `t.j`, `t.tid`, `t.sessionId`, `t.pendentes`.
- Renderer: three grid rules must change, not one: `.app` (app.css line 30), `body.recolhido .app` (31, re-declares columns) and the `.app { var(--lado) 1fr var(--info) }` rule (~870). `.info` uses `padding-top: 44px` to clear the window controls.
- Constraint: a native view paints above all DOM and swallows keyboard focus; floating `janelinha`s and menus cannot cover it, and the renderer sees no key events while the view is focused.

## Design

**New module `src/navegador.js`** (ESM, injected deps, like `tarefas.js`): `export function iniciaNavegador(deps)` returns `{ navegadorFecha, ferramentasNavegador, esqueceSites, FERRAMENTAS_NAVEGADOR }` and registers the IPC handlers. `deps = { ipcMain, session, WebContentsView, J, janelas, enviarEvento, resolveExe, dentroDaPasta, matarArvore, ajustaImagem, pedePermissao, texto, tr, tool, z }` (`tr` from `src/i18n.js`).

State per window, lazy: `j.nav = { view, pronto, fila: Promise, procs: Map(nome -> { p, port, url, log: [], sonda }), claude: false }`. Session approvals are module-level `aprovados: Map(chave -> Set(host))`, key = `t.sessionId || "tid:" + t.tid` resolved at call time (migrate the `tid:` entry to the session id once it exists), so they survive process restarts (`viva.reiniciar`, cwd/model/mode/Customize changes); `esqueceSites(sessionId)` is called from the conversation-delete path. In-flight cards are deduplicated by `emVoo: Map(chave+host -> Promise)`.

**Pane (`navegadorGarante(j)`)**: returns `null` and does nothing when `j.fechada || j.win.isDestroyed()`. Otherwise `new WebContentsView({ webPreferences: { partition: "persist:claudie-preview", sandbox: true, contextIsolation: true, nodeIntegration: false } })`, no preload, `addChildView`, `setVisible(false)`. Once per process on the partition: permission request/check handlers deny all; `will-download` calls `preventDefault()`. On the view's `webContents`:
- `will-navigate` and `will-redirect`: `preventDefault()` unless http(s); when `j.nav.claude` is set (a Claude-initiated load) also cancel if the target host is not allowed (loopback, launch host, or in `aprovados`), recording the host so the tool returns "needs approval for HOST: call browser_navigate with that URL" (that call raises the card). Person-driven navigation is not gated here.
- `will-prevent-unload`: `preventDefault()` (proceed, so `beforeunload` cannot stall a load).
- `setWindowOpenHandler`: http(s) loads in the same view through the same checks, returns `deny`.
- `did-start-loading`, `did-stop-loading`, `did-navigate`, `did-navigate-in-page`, `page-title-updated`, `did-fail-load` call `emiteEstado(j)`.
- `before-input-event`: for Esc and the app shortcuts (Ctrl+N, Ctrl+B, Ctrl+Shift+B/M/I/E/P) call `preventDefault()` and send `{ tipo: "nav_tecla", key, ctrl, shift, alt }`; the renderer dispatches a synthetic `KeyboardEvent` on `document`, so Esc interrupt, menu closing and every shortcut keep working while the pane has focus.

Skipped entirely when `VIVO_GRAVAR` is set (offscreen window).

**Lifecycle**: `win.on("close", ev => { if (!ev.defaultPrevented) navegadorFecha(j) })` registered after phase 05's hide-to-tray handler, so a hidden window keeps its view and servers; the `closed` handler calls `navegadorFecha(j)` again as an idempotent fallback. `navegadorFecha(j, sincrono)`: kill every proc and stop its poll, `view.webContents.close()` (try), `removeChildView` (try), `j.nav = null`. Every `browser_*` and `servidor_*` tool begins with `if (!j || j.fechada || j.win.isDestroyed()) return erro("janela fechada")`, never recreating a view (an idle conversation can outlive the window, and `t.j` then points at the dead `j`). Servers deliberately survive hide-to-tray and stop on real close or quit.

**URL normalization `normalizaUrl(txt)`**: trim; reject any scheme other than http/https; bare `localhost`, `127.0.0.1`, `[::1]` get `http://`; any other bare host gets `https://`. Returns `null` if invalid.

**IPC (`ipcMain.handle`, all via `J(e)`)**
| channel | payload | effect |
|---|---|---|
| `nav_abrir` | `url` | person-typed, no approval; normalize, ensure view, `loadURL` (catch rejection), emit `nav_mostrar`; an invalid URL returns an error string already passed through `tr()` |
| `nav_acao` | `"voltar" \| "avancar" \| "recarregar" \| "parar"` | `wc.navigationHistory.goBack/goForward`, `wc.reload`, `wc.stop` |
| `nav_area` | `{x,y,width,height} \| null` | accept only `Number.isFinite` values, clamp to non-negative, `setBounds(rounded)` + `setVisible(!!rect)`; resolves `j.nav.pronto` |
| `nav_estado` | none | returns current state |
| `nav_servidores` | none | `[{ nome, rodando, url, port }]` from launch.json plus running state |
| `nav_servidor_iniciar` / `nav_servidor_parar` | `nome` | the person's click is consent (no card) |

Events over the existing stream: `{ tipo: "nav_estado", url, titulo, voltar, avancar, carregando }`, `{ tipo: "nav_servidor", nome, estado: "iniciando" | "rodando" | "parado", url, erro? }`, `{ tipo: "nav_mostrar" }`, `{ tipo: "nav_tecla", ... }`.

**Approval, independent of permission mode.** `canUseTool` is skipped in `bypassPermissions` and `auto`, so no tool here relies on it. Every gate raises its card from inside the tool handler through phase 02's `pedePermissao`, extended with an optional `site` field stored on the pending entry. The `permissao` IPC handler gets one branch: when `p.site` is set, `"sim"` resolves `{ behavior: "allow" }` and anything else denies; there is no "always" decision (session scope only). The card shows `input` (host for sites; resolved command, args, cwd and env key names for servers), so what the person approves is what runs.

**Approver check `semAprovador(t)`**: true when `!t?.pendentes` (a window object from `comConsulta`), `!t.j`, `t.j.fechada`, the window is destroyed or not visible (hidden to tray), or the turn is a scheduled run (`t.agendada`, or no `t.j`). It makes `garanteSite` and `servidor_iniciar/parar` return an `isError` "no one to approve" result instead of waiting for an answer that cannot come. `ferramentasNavegador(t)` returns `{}` when `!t?.pendentes`, and `servidorTemasPara` is spread with it only for real turns, so idle consultation queries never get these tools.

**Site gate `garanteSite(t, url)`** returns `null` when allowed, else an `isError` result:
```js
const host = new URL(url).hostname, chave = chaveSessao(t);
if (loopback(host) || launchHosts(j).has(host) || aprovados.get(chave)?.has(host)) return null;
if (semAprovador(t)) return erro(tr("Ninguém para aprovar o acesso a {host}", { host }));
let p = emVoo.get(chave + host);
if (!p) { p = pedePermissao(t, "mcp__claudie__browser", { url, host }, { decisionReason: tr("Claude quer abrir {host}", { host }), site: host }).finally(() => emVoo.delete(chave + host)); emVoo.set(chave + host, p); }
const r = await p;
if (r.behavior !== "allow") return erro(tr("A pessoa negou o acesso a {host}", { host }));
(aprovados.get(chave) ?? aprovados.set(chave, new Set()).get(chave)).add(host);
```
`loopback` = `localhost`, `127.0.0.1`, `::1`, `*.localhost`. README note: loopback is allowed on every port (not only launch.json ports), so Claude can reach any local service. All tool calls on a view run through `j.nav.fila` (a promise chain), so parallel tool calls are serialized. Every `browser_*` tool except navigate re-checks `garanteSite(t, wc.getURL())`, so a page the person navigated to is gated too.

**MCP tools** (via `...ferramentasNavegador(t)` in `servidorTemasPara`, each `{ alwaysLoad: true }`, zod schemas, Portuguese descriptions):
- `browser_navigate({ url })`: normalize, `garanteSite`, ensure view, emit `nav_mostrar`, await `j.nav.pronto` (cap 2 s; if the view is still not visible return "painel oculto por outra janela"), set `j.nav.claude = true`, `loadURL` with its rejection caught (ERR_ABORTED resolves normally), resolve on `did-stop-loading` or `did-fail-load` (cap 15 s), clear the flag; a host blocked at `will-redirect` returns the needs-approval error; recheck the final URL as a backstop. Returns title + URL.
- `browser_screenshot()`: fail with "painel oculto" if the view is not visible; `capturePage()` with a 5 s timeout, reject empty images; resize to the view's CSS-pixel size so the model's x,y match what CDP clicks expect (say so in the tool description); `ajustaImagem(b64, "image/png")` returns `{ dados, mime }` or `null` (null -> error); result `{ content: [{ type: "image", data: r.dados, mimeType: r.mime }] }`.
- `browser_read({ modo?: "texto" | "arvore" })`: `texto` = `document.body.innerText` capped at 20000 chars, prefixed `URL:`/`Título:`; `arvore` = `Accessibility.getFullAXTree` flattened to `role "name"` lines (cap 400 nodes, no refs: click and type take a selector or coordinates only). Output is wrapped as untrusted page content.
- `browser_click({ seletor?, x?, y? })`, `browser_type({ seletor, texto, enviar? })`: `debugger.attach("1.3")` once per view (try/catch, re-attach on `detach`); selector resolved by `Runtime.evaluate` (`scrollIntoView`, center of `getBoundingClientRect`), then `Input.dispatchMouseEvent` pressed/released; type focuses, `Input.insertText`, optional Enter key event.
- `servidor_listar()`, `servidor_logs({ nome })` (last 50 lines): no card.
- `servidor_iniciar({ nome })`, `servidor_parar({ nome })`: **not** in `allowedTools`, and gated in the handler: after `semAprovador`, `pedePermissao(t, "mcp__claudie__servidor_iniciar", { nome, comando, args, cwd, env: Object.keys(env) }, ...)` on every call (no memory), in any permission mode. `servidor_parar` shows the name and port.

`FERRAMENTAS_NAVEGADOR` = the five `browser_*` names + `servidor_listar` + `servidor_logs`, prefixed `mcp__claudie__`, spread into `allowedTools`. Append a sentence to the server `instructions`. System prompt: phase 02 already sets `systemPrompt.append`; build `append` from a fragment list (`[...fragmentos].join("\n\n")`) or concatenate to what exists, never assign over it. This phase's fragment: "Para visualizar páginas locais (localhost, servidores de desenvolvimento) prefira as ferramentas browser_* do app, que mostram a página ao lado da conversa; use o Claude in Chrome só quando precisar do navegador real da pessoa." Main turn only.

**Dev servers**: `<cwd>/.claude/launch.json` `{ version, configurations: [{ name, runtimeExecutable, runtimeArgs?, port?, url?, cwd?, env? }] }`.
- `leLaunch(j)`: read + `JSON.parse` in try/catch; keep entries with string `name`/`runtimeExecutable`, string-array `runtimeArgs`, integer `port` 1-65535, string-map `env`; `url` is kept only if it parses as http(s) with a loopback host, otherwise dropped. Entry cwd = `dentroDaPasta(j.cwd, cfg.cwd)` or `j.cwd`. `launchHosts(j)` = loopback hosts only, derived from a valid `url` or `port`; a non-loopback host is never trusted and needs the card.
- `servidorIniciar(j, nome)`: error if already in `j.nav.procs`; if `port` is set and it accepts a connection (probe both `127.0.0.1` and `::1`), return error "porta ocupada" naming the port (never pick another, never kill foreign processes). Spawn `resolveExe(runtimeExecutable)`; on win32 a `.cmd`/`.bat` runs as `spawn("cmd.exe", ["/d","/s","/c", '"' + [exe, ...args].map(q).join(" ") + '"'], { windowsVerbatimArguments: true, ... })` where `q` double-quotes and rejects values containing any of `" % ! ^ & | < >` (cmd expands `%VAR%` even inside quotes). Options: `{ cwd, env: { ...process.env, ...cfg.env, ...(port ? { PORT: String(port) } : {}) }, windowsHide: true, detached: process.platform !== "win32" }`. Capture stdout/stderr into a 200-line ring buffer.
- Readiness: with `port`, poll every 500 ms up to 60 s trying `127.0.0.1` then `::1`, then emit `rodando` and load `url || http://localhost:port`; without `port`, emit `rodando` right at spawn. The poll is cancelled in the `exit`/`error` handler, which also deletes the entry and emits `parado` (with `erro` when it died before ready).
- `matarArvore(p, sincrono)`: extracted from `terminalMata` (taskkill `/PID /T /F` on win32, `process.kill(-pid, "SIGTERM")` elsewhere); `terminalMata` and dev servers both call it.

**Renderer `src/renderer/navegador.js`**: `aside.navegador` in grid column 4. CSS: `body.nav-aberto { --nav: min(520px, 40vw) }`; all three grid rules include `var(--nav, 0px)` and the chat column is `minmax(0, 1fr)`; opening the pane while `innerWidth < 1280` auto-collapses the sidebar (`recolhe(true)`) and restores it on close; with the info panel open `--nav` shrinks to `min(520px, 30vw)`. `.navegador` has `padding-top: 44px` like `.info`, so the toolbar and close button clear the window controls. Toolbar: back, forward, reload/stop, URL input, servers dropdown, close. `ResizeObserver` on `.nav-tela` plus window `resize` call `vivo.navArea(rect)`. Overlay hiding: send `vivo.navArea(null)` only while a visible overlay element (modal, menu, popover, lightbox, radial menu, `janelinha`) has a bounding rect intersecting the pane rect; pinned (`.fixa`) windows that do not overlap never hide it. Detection via a `MutationObserver` on `document.body` plus the selector list found by grep in step 9. Toggle button before `#infoBtn`, shortcut Ctrl+Shift+B; in `app.js` (~1151) the Ctrl+B sidebar handler gets `&& !e.shiftKey`, and the Ctrl+Shift+B handler returns after toggling the pane. The renderer handles `nav_tecla` as above. Servers dropdown lists `vivo.navServidores()` with Iniciar/Parar and a running dot; errors come back as already-translated strings from the main process and show in a toast. Alt+click on a conversation link (`abreLinkDaConversa`) calls `vivo.navAbrir(url)`; plain click keeps `shell.openExternal`.

## Files to Create / Modify

| Path | Action | Change |
|---|---|---|
| `src/navegador.js` | create | pane, URL normalization, site gate, IPC, MCP tools, launch.json and dev-server lifecycle |
| `src/renderer/navegador.js` | create | docked pane UI, bounds sync, overlay hiding, key forwarding, servers menu, toggle button |
| `src/renderer/i18n/parts/navegador.json` | create | pt key -> en/vi for every new string, including text returned by the main process (format of `remoto.json`) |
| `src/main.js` | modify | import `WebContentsView`, `session`; extend phase 02's `pedePermissao` with the `site` field; extract `matarArvore`; wire `iniciaNavegador`; tools in `servidorTemasPara` (real turns only); `allowedTools`; append fragment; `permissao` site branch; `close`/`closed`/`before-quit` hooks; `esqueceSites` on conversation delete; `VIVO_FOTO` also saves the view |
| `src/preload.cjs` | modify | expose `navAbrir`, `navAcao`, `navArea`, `navEstado`, `navServidores`, `navServidorIniciar`, `navServidorParar` |
| `src/renderer/app.js` | modify | `permissao(ev)` site line (Sim/Negar, host shown); `ROTULO`/`PEDIDO`/icon entries for `browser_*` and `servidor_*`; Alt+click link; route `nav_*` events; Ctrl+B `!e.shiftKey` |
| `src/renderer/app.css` | modify | column 4 in the three grid rules, `.navegador`, `.nav-tela`, toolbar |
| `src/renderer/index.html` | modify | `<script src="navegador.js">` after `terminal.js` |
| `src/renderer/interface.js` | modify | Ctrl+Shift+B toggle |
| `src/renderer/os.js` | modify | radial action "Navegador" (`ACOES_RADIAL`) |
| `README.md` | modify | feature section and testing notes |

## Tasks & Steps

- [ ] 1. `git branch --show-current` is `feat/desktop-parity` with phase 02 committed; re-read the anchors and phase 02's `pedePermissao` and `systemPrompt.append`.
- [ ] 2. In `main.js` extract `matarArvore(p, sincrono)` from `terminalMata`; make `terminalMata` call it. `node --check`.
- [ ] 3. Extend phase 02's `pedePermissao` with the optional `site` field and add the `p.site` branch in the `permissao` handler. Existing cards stay unchanged; the `comecaTurno` line stays.
- [ ] 4. Write `src/navegador.js` part 1: `normalizaUrl`, `loopback`, `navegadorGarante` with all hardening and key forwarding, state events, IPC `nav_abrir/acao/area/estado`, `close` hook.
- [ ] 5. Part 2: `aprovados`/`emVoo`, `semAprovador`, `garanteSite`, per-view queue, debugger helper.
- [ ] 6. Part 3: the five `browser_*` tools with schemas (verify CDP method params in the protocol docs first).
- [ ] 7. Part 4: `leLaunch`, `servidorIniciar/Parar`, dual-stack probe, readiness, ring buffer, `navegadorFecha`, IPC `nav_servidores/iniciar/parar`, tools `servidor_*` with handler-level cards.
- [ ] 8. Wire in `main.js`: `iniciaNavegador`; spread tools into `servidorTemasPara` for turns only; `FERRAMENTAS_NAVEGADOR` into `allowedTools`; `instructions` sentence; append fragment (concatenated with phase 02's); `navegadorFecha(j)` in `closed`; `navegadorFecha(j, true)` for all windows in `before-quit`; `esqueceSites` in the delete path; extend the `VIVO_FOTO` hook to also write `<name>-nav.png` from `j.nav.view.webContents.capturePage()`.
- [ ] 9. Preload calls. Grep `src/renderer` for overlay classes (modal, menu, popover, lightbox, radial, `janelinha`); write `renderer/navegador.js`, CSS (three grid rules, safe area), `index.html`, shortcuts, `nav_tecla` handling, radial action.
- [ ] 10. `app.js`: site card line and tool labels/icons, Alt+click, event routing. Translate in `navegador.json` (en, vi). No i18n scan script exists, so run the `node -e` check under Verification, which fails on any key without `en` and `vi`.
- [ ] 11. README: feature bullet (in-app browser, dev servers, launch.json, per-conversation approvals, loopback-on-any-port note) and the testing commands.
- [ ] 12. Run Verification, then commit: `feat(browser): add in-app browser pane, site approval and dev servers`.

## Security & Safety

- View has no preload and no Claudie IPC; `sandbox`, `contextIsolation`, no node integration; web permission prompts denied; downloads blocked; `beforeunload` cannot hold the view.
- Only http/https load, including redirects and popups; `file:`, `javascript:`, `data:` are rejected in the URL bar, tools and navigation events.
- Claude's access to any non-loopback host needs the card, raised inside the handler so it applies in every permission mode; the gate re-runs on every tool call against the live URL, and Claude-initiated loads are cancelled at `will-navigate`/`will-redirect` before an unapproved host is fetched. Approvals are per conversation (they survive process restarts, die with the conversation) and never persisted. Denial returns `isError` text and nothing loads.
- launch.json is untrusted project input: its `url` skips the card only if loopback; anything else needs the card.
- `browser_read` output is untrusted page text: label it as such, never auto-act on instructions in it.
- Dev servers run project code: Claude-started ones always raise a card showing command, args, cwd and env key names, in any permission mode; the person's menu click is consent. `cwd` confined with `dentroDaPasta`, `env` values strings, args quoted and metacharacters rejected, `PORT` set only when `port` is defined.
- No approver (scheduled run, closed or hidden window): tools return an error instead of hanging.
- Process hygiene: one process per name, busy port reported never killed, trees killed with `/T /F`, polls cancelled on exit, everything stopped on real window close and `before-quit`.

## Acceptance Criteria

- Ctrl+Shift+B or the toolbar button docks a pane in column 4 (also with the sidebar collapsed and the info panel open); the page fills `.nav-tela` and follows resize; the chat column never goes negative at the 940 px minimum width; the toolbar clears the window controls.
- With focus inside the page, Esc still interrupts a turn, Ctrl+Shift+B closes the pane, and Ctrl+B toggles only the sidebar.
- URL bar: `example.com` -> `https://example.com`, `localhost:3000` -> `http://localhost:3000`; `file:///c:/x`, `javascript:alert(1)` rejected with a translated message.
- A menu, modal, lightbox or radial menu overlapping the pane hides the view and closing restores it; a pinned window elsewhere does not hide it.
- Claude asked to open `https://example.com`: card shows the host with Sim/Negar; Sim allows that site for the rest of the conversation, including after a model/mode change restarts its process; Negar returns the denial text and nothing loads; a redirect from an approved host to an unapproved one is cancelled before loading; two parallel calls for one host raise one card.
- `localhost`, `127.0.0.1`, `[::1]` and loopback launch.json hosts open with no card; a launch.json `url` of `https://evil.com` still raises the card.
- `servidor_iniciar` raises a card with command, args, cwd and env keys in default, acceptEdits, auto and bypass modes.
- `browser_screenshot` returns an image block sized to the view's CSS pixels; `browser_read` returns text and tree modes; click/type work on a test page; with the pane hidden the tools return a clear error, not a blank image.
- launch.json entries appear in the servers menu; start loads the page once the port answers (IPv4 or IPv6 listener); an entry without `port` shows `rodando` at once; stop removes it; a second start or an occupied port returns an error without spawning; an early exit stops the poll and shows `parado`.
- After the window is actually closed (not hidden to tray) or the app quits, no listener remains on the dev-server port; servers keep running while hidden to tray.
- A tool call from a conversation whose window closed returns an error and creates no view.
- Chat links still open in the system browser; Alt+click opens in the pane. Claude in Chrome still loads; the system-prompt line is present alongside phase 02's text.
- `node --check` passes on every touched JS file; `navegador.json` parses with en and vi for every key.

## Verification

```
node --check src/main.js && node --check src/navegador.js && node --check src/preload.cjs && node --check src/renderer/navegador.js && node --check src/renderer/app.js && node --check src/renderer/interface.js && node --check src/renderer/os.js
node -e "const j=JSON.parse(require('fs').readFileSync('src/renderer/i18n/parts/navegador.json','utf8'));for(const [k,v] of Object.entries(j))if(!v.en||!v.vi)throw new Error('missing '+k)"
```
`VIVO_FOTO` uses `win.webContents.capturePage()`, which does not include a child `WebContentsView`; step 8 extends the hook to write the view too. To answer a card in a headless run, use `VIVO_JS` with a later timer calling `vivo.permissao(id, "sim")` (or `"nao"`) for the pending id.
1. Pane: `VIVO_JS="vivo.navAbrir('https://example.com').then(()=>new Promise(r=>setTimeout(r,2500)))" VIVO_FOTO=nav.png npm start`; `nav.png` shows the docked toolbar and `.nav-tela`, `nav-nav.png` shows the page.
2. Dev server: temp folder with `.claude/launch.json` `{"version":"0.0.1","configurations":[{"name":"web","runtimeExecutable":"node","runtimeArgs":["-e","require('http').createServer((q,r)=>r.end('ok')).listen(5199)"],"port":5199}]}`; `VIVO_PASTA=<folder> VIVO_JS="vivo.navServidorIniciar('web').then(()=>new Promise(r=>setTimeout(r,4000)))" VIVO_FOTO=srv.png npm start`; `curl http://localhost:5199` returns `ok`; `srv-nav.png` shows it. Repeat with `.listen(5199,'::1')`.
3. Orphans: after quitting, `netstat -ano | findstr 5199` is empty; repeat closing only a secondary window.
4. Busy port: a manual `node` listener on 5199, then `vivo.navServidorIniciar('web')` returns the busy-port error and spawns nothing.
5. Claude flow: `VIVO_LOG=1 VIVO_PASTA=<folder> VIVO_TESTE="Open https://example.com in the browser pane, read it and take a screenshot" npm start`; expect the card for `example.com`, answered through `vivo.permissao`, then `browser_navigate/read/screenshot` events. Repeat answering Negar (error text, no load). Repeat in bypass mode with `servidor_iniciar` to confirm the card still appears.
6. Manual: `vivo.navAbrir('file:///c:/windows/win.ini')` and a `javascript:` URL are rejected; open the model picker over the pane and confirm the view hides; press Esc and Ctrl+Shift+B with focus in the page.

## Risks & Rollback

- Native view over DOM: mitigated by docking, intersect-based overlay hiding and key forwarding; a missed overlay class shows the page above it (fix the selector list).
- Debugger attach fails when DevTools is open or already attached: single attach per view, re-attach on `detach`, clear error.
- Windows `.cmd` spawn quoting: metacharacters rejected; npm grandchildren handled by `/T /F`.
- `capturePage` on a hidden view is blank: tools check visibility and fail clearly instead.
- Offscreen recording (`VIVO_GRAVAR`) skips the pane.
- Rollback: revert the single phase commit; the `persist:claudie-preview` partition can be deleted from the profile. No new config key is written.

## Docs impact

README (English): the in-app browser pane (toolbar, Ctrl+Shift+B, Alt+click links), Claude's `browser_*` and `servidor_*` tools with per-conversation site approval (and that loopback is allowed on any port), `.claude/launch.json` support with a minimal example, and the `VIVO_JS="vivo.navAbrir(...)"` check in the Testing section. No other docs.

## Red-team notes

Applied (verified against source or sibling phases): handler-level cards for server tools and sites in all modes (phase 02 states `canUseTool` is skipped in bypass/auto); reuse of phase 02's `pedePermissao` and its `comecaTurno` line; `systemPrompt.append` fragments; session approvals keyed by session id at module level; loopback-only launch.json `url`; `will-redirect`/`will-navigate` gating, per-view queue, card dedupe; no-approver/closed/hidden guards (phase 05 hides with `win.hide()` and denies everything in `canUseTool`); `VIVO_FOTO` hook extended (confirmed it captures the host window only); key forwarding plus `!e.shiftKey` (app.js ~1151 has no shift check); three grid rules, 44 px safe area, `--nav` clamp (minWidth 940); intersect-based overlay hiding (`.fixa` persisted); dev-server items 1-6; lifecycle on `close` and `j.fechada` guards; refs dropped, screenshot resized, `{ dados, mime }` mapped; downloads, `will-prevent-unload`, `loadURL` rejection, `nav_area` validation; persistent site list removed (outside the locked per-conversation scope); i18n one-liner replaces the nonexistent scan and main-process strings go through `tr()`; `comConsulta` gets no browser tools.
Rejected: none outright. Partial: the loopback-any-port concern is within the locked decision, so it is documented in the README instead of restricted.
