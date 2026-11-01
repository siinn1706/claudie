---
phase: 5
title: "Scheduled tasks, tray, keep-awake"
status: pending
priority: P2
effort: "2-3 days"
dependencies: []
---

# Phase 05: Scheduled tasks, tray, keep-awake

## Goal

Let the user schedule unattended Claude Code runs (hourly, daily, weekdays, weekly, cron) that keep working while the app sits in the tray, with an always-present tray icon, close-to-tray, open-at-login and keep-awake while Claude works.

## Context

- Locked decisions (follow exactly): `research/decisions.md`, "Scheduler" bullet. Code scout with line refs: `research/scout-scheduler-tray.json` (line numbers verified against `src/main.js`; always locate by function name).
- Naming: `tarefas` already means background tasks of a turn (`src/tarefas.js`, `src/renderer/tarefas.js`, IPC `parar_tarefa`). Everything here uses `agendada*` / `ag-` / `rotina`.
- Scheduled runs are NOT conversations of a window: no `turno()`, no `janelas` entry, not in `turnos`. They are one-shot `query()` calls (the wrapper at `query(args)` in main.js, which resolves the Claude exe, API key, throws synchronously if Claude Code is missing) that persist as ordinary sessions in the task's folder, so the sidebar lists them via `vigiaSessoes()`.
- Existing helpers reused: `MODOS`, `cfgSessao`/`guardaCfg`, `salvarConfig` (tmp+rename), `enviarEvento` broadcast loop, `avisaTurnos`, `aplicaIcone`, `atalhoGlobal` body, `second-instance`, `before-quit`, `criaT(idioma)`, `janelinha()` in `src/renderer/os.js`, `chaveT` in `personalizar.js`.
- No new dependency. Electron APIs: `Tray`, `Menu`, `Notification`, `powerSaveBlocker`, `powerMonitor`.

## Design

### Data: `app.getPath('userData')/agendadas.json` (array, atomic write)
```js
{ id /*crypto.randomUUID()*/, nome, prompt, cwd, model /*""=default*/, modo /*in MODOS, default "auto"*/,
  repete: { tipo: "horaria"|"diaria"|"dias_uteis"|"semanal"|"cron", minuto, hora, dia /*0-6, 0=Sun*/, cron /*"*/15 9-17 * * 1-5"*/ },
  pausada, proxima /*epoch ms*/,
  ultima: { inicio, fim, estado: "ok"|"erro"|"parada"|"perdida", sessionId, erro, custo },
  historico: [ /* last 30 */ { inicio, fim, estado, sessionId, resumo /*<=200 chars*/, recuperada, manual } ] }
```
Not stored in `config.json` (rewritten on every setting change). Factor `gravaJson(arquivo, obj)` out of `salvarConfig` and use it for both.

### `src/agendadas.js` (ESM, no Electron import, no import of main.js)
Pure, exported, side-effect free (testable with `node -e`):
- `parseCron(expr)`: 5 fields, supports `*`, `n`, `a-b`, `*/n`, `a-b/n`, comma lists; ranges min 0-59, hour 0-23, dom 1-31, month 1-12, dow 0-6 (7 = Sunday); throws `Error` with a Portuguese message naming the field. Standard cron rule: if both dom and dow are restricted, match either.
- `proximaCron(c, depoisDe)`: start at `depoisDe` (seconds zeroed, +1 min) and skip ahead: month mismatch jumps to the 1st of the next month, day mismatch (dom/dow rule) to the next day 00:00, hour mismatch to the next hour, only the minute steps singly; bounded to 5 years of candidates; local `Date` components (DST-safe). Returns epoch ms or `null` (`0 0 29 2 *` resolves to the next leap day).
- `validaRepete(r)`: clamps/validates, returns normalised `repete` or throws; a cron whose `proximaCron` is `null` throws "Nenhuma execução no próximo ano" (save and the preview treat `null` as a validation error).
- `proximaExecucao(repete, depoisDe)`: horaria (next `minuto` past the hour), diaria (`hora:minuto`), dias_uteis (Mon-Fri), semanal (`dia` at `hora:minuto`), cron via `proximaCron`.

Stateful, via injected context:
`iniciaAgenda({ arquivo, rodaQuery, renomeia, guardaCfgSessao, existePasta, avisa, notifica, tr, modos, aoMudarEnergia })` returns the controller `{ lista, salvar, apagar, pausar, rodar, parar, historico, proximas, rodandoQtd, ativasQtd, idsRodando, aborta, acorda }`. In main.js `guardaCfgSessao = (id, c) => { guardaCfg(id, c); salvarConfig(); }` (`guardaCfg` alone only mutates `config.porSessao`).
- Constants: `JANELA_RECUPERA = 24*3600e3`, `GRACA = 2*60e3`, `LIMITE_EXECUCAO = 60*60e3`, `MAX_TURNOS = 100`, `MAX_HISTORICO = 30`, concurrency 1.
- Load: parse file, drop invalid entries, re-validate `modo` (not in `modos` becomes `auto`), clamp strings, recompute `proxima` for non-paused tasks without a valid one.
- `rearma()`: one `setTimeout` for the earliest non-paused `proxima`, delay capped at `2**31-1`; on fire call `venceu()`. `powerMonitor.on('resume')` (wired in main.js) calls `ctrl.acorda()`, which after a 20 s delay (network is usually not back sooner) runs `venceu()` and `rearma()`.
- `venceu()` (every call: timer, resume, startup): for each non-paused task with `proxima <= now`: if `now - proxima <= GRACA` it is a normal on-time run; else if `<= JANELA_RECUPERA` it runs once with `recuperada:true`; else a `perdida` history entry is written without running. Then one enqueue (coalesced), `proxima = proximaExecucao(repete, now)`, persist. The window check applies on every call, so a multi-day sleep never replays old slots.
- `fila`: array of task ids plus `executando` flag; the task is resolved by id when its turn starts (skipped if deleted) and run from a snapshot copy (`{...t}`), so edits during a run do not change it. Manual "run now" does not move `proxima`. A slot still queued at quit is lost (`proxima` was already advanced); accepted, not persisted, noted in the README.
- Edge cases: `parar(id)` removes the id from `fila` and aborts it when running. `apagar(id)` does the same, then removes the task. `salvar` of a running task takes effect from the next run. `finally` writes history/`ultima` only if the task still exists (no resurrection). Manual `rodar` of a task already queued or running is a no-op.
- `executaAgendada`: validate `existePasta(cwd)` (else `erro` "pasta sumiu") and `modo`; `ac = new AbortController()`; `rodando.set(id,{ac,inicio,sessionId:null})`; a wall-clock `setTimeout(LIMITE_EXECUCAO)` that sets `esgotou = true` and calls `ac.abort()`; `aoMudarEnergia()`. The prompt is a one-message async generator, because the SDK needs streaming input when `canUseTool` is set (the reason `turno()` uses `caixaDeEntrada(...).gerador`); it is closed when the `result` message arrives, otherwise the `for await` never ends. Inject `caixaDeEntrada` as `criaCaixa` (it stays in main.js) rather than duplicating it. Then
```js
const caixa = criaCaixa(/* one user message with t.prompt, same shape as montaPrompt returns */);
const q = rodaQuery({ prompt: caixa.gerador, options: { cwd: t.cwd, model: t.model || undefined, permissionMode: t.modo, maxTurns: MAX_TURNOS,
  extraArgs: {}, settingSources: ["user", "project", "local"],
  systemPrompt: { type: "preset", preset: "claude_code" }, abortController: ac,
  canUseTool: async () => ({ behavior: "deny", message: tr("Execução agendada: ninguém para aprovar.") }) } });
for await (const m of q) {
  if (m.session_id && !st.sessionId) { st.sessionId = m.session_id; guardaCfgSessao(m.session_id, { model: t.model, modo: t.modo }); avisa(); }
  if (m.type === "result") { /* subtype, is_error, result, total_cost_usd */ caixa.fecha(); }
}
```
  `extraArgs: {}` replaces the wrapper's default `{ chrome: null }` (it spreads `args.options` last), so unattended runs never load Claude in Chrome; interactive sessions keep it. `rodaQuery` call and loop sit in try/catch/finally (the wrapper throws synchronously when Claude is not found). `finally`, each step wrapped so a throw never blocks the queue: clear the timeout, `caixa.fecha()`, delete from `rodando`; when `sessionId` is set, `renomeia(sessionId, `${t.nome} - ${data}`, t.cwd)` (the jsonl exists by now; one retry after 1 s, log on failure; skipped if aborted before any output); abort means `parada`, or `erro` "tempo esgotado" when `esgotou`; push history (cap 30), set `ultima`, persist, `notifica(t, ultima)`, `aoMudarEnergia()`, `avisa()`, `executando=false`, drain the queue. A failed login is recorded and notified, never retried in a loop. Hooks, MCP servers and CLAUDE.md of the task folder apply and run unattended (as in a normal session); the editor says so.
- Step 0 of the build: verify with a real `VIVO_AGENDA_AGORA` run that the SDK accepts the generator prompt together with `canUseTool`, ends on `result` and leaves a renameable session, before building the UI.
- `avisa()` broadcasts `{tipo:"agendadas", lista}` (lista with `rodando` flag per task).

### IPC (main.js, all `ipcMain.handle`, input sanitised in agendadas.js)
`agendadas`, `agendada_salvar` (create/update; returns `{tarefa}` or `{erro}`), `agendada_apagar(id)`, `agendada_pausar(id, bool)` (resume recomputes `proxima`), `agendada_rodar(id)`, `agendada_parar(id)`, `agendada_historico(id)`, `agendada_proxima(repete)` (next 3 runs as epoch ms, or `{erro}`; the renderer debounces it ~300 ms). Folder choice reuses the existing folder-dialog handler (`pasta`). Events main to window: `agendadas`, `abrir_agendadas`, `foco_entrada`, `abrir_sessao_pedido {id, cwd}`.

### Main-process glue (`src/main.js`)
- Imports: add `Tray, Menu, Notification, powerSaveBlocker, powerMonitor`.
- `mostraJanela()`: the restore/show/focus path of `atalhoGlobal` on `principal` (creates a window if none); used by tray, `second-instance`, notification click and the show branch of the shortcut. `atalhoGlobal` keeps its minimize-if-focused branch.
- `ultimaVisivel = (j) => ![...janelas.values()].some(o => o !== j && o.win.isVisible())` (does not exist yet).
- `iconeAtual()`: extract the image computation from `aplicaIcone`; tray uses a 32 px resize (or the `.ico`), sharp at 125-200% DPI; refresh on icon change.
- `criaBandeja()` / `montaMenuBandeja()`: always created; tooltip `Claudie`; items Show, New window (`criarJanela()`), New conversation (`mostraJanela()`, new-conversation state as in `nova`, event `foco_entrada`; the Quick Entry window belongs to its own phase), Scheduled tasks (`mostraJanela()` + `abrir_agendadas`; submenu with up to 5 next runs), "N running" label, separator, Quit (`sairDeVez = true; app.quit()`). `tray.on('click', mostraJanela)`. `bandeja` and a `Set` of live notifications live at module scope (locals get garbage-collected and the icon or click handler vanishes). Rebuilt on language change, agenda change, turns change. Destroyed in `will-quit`. Labels via `criaT(idioma)`.
- Close-to-tray: in `criarJanela`, before `win.on('closed')`: `win.on('close', ev => { if (!sairDeVez && ultimaVisivel(j) && deveFicarNaBandeja()) { ev.preventDefault(); win.hide(); avisaBandeja(); } })`. `deveFicarNaBandeja() = geral.fecharNaBandeja !== false && (ctrl.ativasQtd()>0 || [...turnos].some(t=>t.ativo) || ctrl.rodandoQtd()>0)`. One-time notice "Claudie continua na bandeja" guarded by `config.avisouBandeja`. `window-all-closed` becomes `() => { if (!deveFicarNaBandeja()) app.quit(); }`.
- Idle-hidden: when the last turn or run ends, no window is visible and `deveFicarNaBandeja()` is false, call `app.quit()` so a hidden app never lingers with nothing to do (matches the decision: quit when nothing runs and no task is enabled).
- Quit paths: `sairDeVez = true` in `before-quit`, in a `session-end` handler (Windows logoff/shutdown, so `preventDefault` in `close` cannot stall it) and right before `autoUpdater.quitAndInstall`; the `close` intercept is skipped whenever it is set.
- Hidden window: no new IPC. The renderer pauses the Clawd and wallpaper timers on `document.hidden` through the existing `visibilitychange` listener (app.js, next to the video pause); `win.hide()` sets it. Add a main-side hide/show event only if `VIVO_METRICAS` shows a leak.
- Keep-awake: `atualizaEnergia()` as sketched in the scout design (`prevent-app-suspension`, only when `geral.manterAcordado !== false` and a turn or run is active); called from `avisaTurnos()`, the agenda's `aoMudarEnergia`, `aplicaGeral()`. `avisaTurnos` also adds `ctrl.idsRodando()` to `rodando` so scheduled sessions show the sidebar spinner; it and `atualizaEnergia` use `ctrl?.` guards (`ctrl` is built in `whenReady`).
- Resume guard: `turno()` and `emOutra` also refuse when `ctrl?.idsRodando().includes(sessionId)`, with an `erro` event "Esta execução agendada ainda está em andamento" and a Stop affordance (`agendada_parar`), so a second Claude Code never writes the same jsonl.
- `aplicaGeral()` (called from `visual_salvar` and at startup): `app.setLoginItemSettings({ openAtLogin: !!abrirNoLogin, args: ["--oculto"] })` only when `app.isPackaged`; rebuild tray menu; `atualizaEnergia()`.
- `process.argv.includes("--oculto")` is the hidden-start signal (our own `args`; `wasOpenedAtLogin` is not relied on); call `app.getLoginItemSettings({ args: ["--oculto"] })` so the status reads correctly on Windows. First window created with `show:false`, only when the tray exists. `second-instance` uses `mostraJanela()`.
- `before-quit`: `sairDeVez = true; ctrl?.aborta()` (stop timer, abort running scheduled runs), release the blocker.
- `whenReady`: after `criarJanela()` call `criaBandeja(); ctrl = iniciaAgenda({...}); powerMonitor.on("resume", ctrl.acorda)`. Test hook: env `VIVO_AGENDA_AGORA=<id>` runs that task at launch.
- Notification (main process, gated by `config.visual.geral.notificacoes !== false`): title = task name, body generic ("Concluída" / "Falhou", translated) so model output never reaches the lock screen (the summary shows only in the history window); click runs `mostraJanela()` then `enviarEvento(principal,{tipo:"abrir_sessao_pedido",id,cwd})`.

### Renderer
- `index.html`: `#agendadasBtn` (`.linha`, clock svg, "Tarefas agendadas") in `.side-base`; `<script src="agendadas.js">` after `tarefas.js`.
- `src/renderer/agendadas.js` (prefix `ag`, shape of `renderer/tarefas.js`): `abreAgendadas()` opens `janelinha("agendadas", ..., {largura:520})` listing tasks (name, repeat summary, next run, last-result chip, running state; buttons Run now / Stop, Pause/Resume, History, Edit, Delete) and "+ Nova". Editor `janelinha("agendada-editor")`: name, prompt, folder (existing folder dialog), model select (same options as `mostraEscolhas`), mode select (the 4 `MODOS`, default `auto`, with a note that nobody approves tools unattended and that the folder's hooks and MCP servers run unattended), repeat type with conditional fields (time, weekday, cron text) and live next-3-runs preview via `vivo.agendadaProxima`. History view lists runs with "Abrir conversa" calling `abreSessao`. Delete asks for confirmation.
- `app.js` `aoEvento` switch: `agendadas` (re-render if open, update badge), `abrir_agendadas`, `foco_entrada` (`entrada.focus()`), `abrir_sessao_pedido` (`abreSessao`).
- `personalizar.js`: add `fecharNaBandeja:true, abrirNoLogin:false, manterAcordado:true` to the `geral` defaults and three `chaveT` rows in the geral tab.
- `preload.cjs`: `agendadas`, `agendadaSalvar`, `agendadaApagar`, `agendadaPausar`, `agendadaRodar`, `agendadaParar`, `agendadaHistorico`, `agendadaProxima`.

## Files to Create / Modify

- Create `src/agendadas.js` - schedule math, store, queue, headless run, notify hook.
- Create `src/renderer/agendadas.js` - list, editor and history windows.
- Create `src/renderer/i18n/parts/agendadas.json` - pt keys with en and vi for every new string (renderer and main `t()`).
- Modify `src/main.js` - imports, `gravaJson`, `mostraJanela`, `iconeAtual`, tray, close-to-tray, energy, `aplicaGeral`, IPC, hooks in `avisaTurnos`/`before-quit`/`whenReady`/`window-all-closed`/`second-instance`.
- Modify `src/preload.cjs` - eight `vivo.agendada*` bridges.
- Modify `src/renderer/index.html` - sidebar button and script tag.
- Modify `src/renderer/app.js` - new event cases, hidden-window pause.
- Modify `src/renderer/personalizar.js` - three toggles and defaults.
- Modify `src/renderer/app.css` - `ag-*` styles using existing theme variables.
- Modify `README.md` - feature paragraph and `VIVO_AGENDA_AGORA`.

## Tasks & Steps

1. [ ] `git switch feat/desktop-parity`; confirm phases 01-04 are committed.
2. [ ] Write the pure part of `src/agendadas.js` (`parseCron`, `proximaCron`, `validaRepete`, `proximaExecucao`); `node --check`; run the pure-function cases (see Verification).
3. [ ] Add the stateful part: load/validate, store, `rearma`, `venceu`, catch-up, queue, `executaAgendada`, history, controller API.
4. [ ] In `main.js` extract `gravaJson`, `mostraJanela`, `iconeAtual`; build `ctrl` in `whenReady` with the injected context; add IPC handlers and the `agendadas` broadcast.
5. [ ] Run Step 0 (generator prompt plus `canUseTool` against a real run). Add `atualizaEnergia()`, the `avisaTurnos` hook, `aplicaGeral()` and the `visual_salvar` call.
6. [ ] Add tray (`criaBandeja`, `montaMenuBandeja`), close-to-tray intercept, `window-all-closed`, `second-instance`, `before-quit`, `will-quit`, `--oculto`, notification.
7. [ ] Add the preload bridges, sidebar button, `renderer/agendadas.js`, event cases, settings toggles, hidden-window pause, CSS.
8. [ ] Add `parts/agendadas.json` (en and vi for each string); `JSON.parse` it.
9. [ ] Update README; `node --check` every touched JS file; run the Verification checks.
10. [ ] One commit: `feat(agenda): add scheduled tasks, tray, close-to-tray and keep-awake` (no AI reference, no plan IDs).

## Security & Safety

- Unattended runs have file/shell access: the folder and mode are the boundary. Validate `cwd` exists, `modo` in `MODOS` on save and on load (an externally edited file with an unknown mode falls back to `auto`, never a higher mode). `bypassPermissions` is not offered, per decisions.md.
- `canUseTool` denies everything the mode does not already allow; no approver exists. Claude in Chrome is off for scheduled runs (`extraArgs: {}`). A 60 min timeout and `maxTurns` bound runaway cost and queue blocking.
- Notifications show only the task name and a generic status.
- Schedule file lives only in userData; strings sliced (`nome` 80, `prompt` 20000, `cron` 100); ids looked up, never used as paths.
- `setLoginItemSettings` only when `app.isPackaged`; the test profile uses a separate userData.
- Quit aborts running scheduled queries; no orphan `claude.exe`. Tray menu and notifications never include prompt text beyond the task name and a 200-char result summary.

## Acceptance Criteria

- Creating, editing, pausing, deleting and running a task from the UI works; invalid cron or missing folder shows a clear error.
- `proximaExecucao` returns correct local-time results for hourly, daily, weekdays (skips Sat/Sun), weekly and `*/15 9-17 * * 1-5`; invalid cron throws.
- A due task runs once, in the task folder with the chosen model/mode; the run appears in the sidebar titled `<name> - <date>` with the chosen model/mode, with a spinner while running.
- Catch-up: missed within 24 h runs exactly once with `recuperada:true`; older is logged `perdida` without running. Runs are serialised.
- Completion fires a Windows notification (respecting the notifications setting); clicking opens the run's conversation.
- Tray icon always present; every menu item works; Quit leaves no electron/claude processes.
- Clicking X with a turn running or any enabled task hides to tray and the work continues; otherwise the app quits. Tray click restores.
- Keep-awake blocker is active only while a turn or run is active and the setting is on.
- Open-at-login toggle registers only in packaged builds and starts hidden in the tray.
- All new strings render in pt, en and vi.

## Verification

- `node --check src/main.js && node --check src/agendadas.js && node --check src/preload.cjs && node --check src/renderer/agendadas.js && node --check src/renderer/app.js && node --check src/renderer/personalizar.js`
- `node -e "JSON.parse(require('fs').readFileSync('src/renderer/i18n/parts/agendadas.json','utf8'))"`
- Pure math: `node -e "import('./src/agendadas.js').then(m=>{const d=new Date(2026,10,1,8,0).getTime();for(const r of [{tipo:'horaria',minuto:5},{tipo:'diaria',hora:9,minuto:0},{tipo:'dias_uteis',hora:9,minuto:0},{tipo:'semanal',dia:0,hora:7,minuto:30},{tipo:'cron',cron:'*/15 9-17 * * 1-5'}])console.log(r.tipo,new Date(m.proximaExecucao(r,d)).toString());try{m.parseCron('61 * * * *')}catch(e){console.log('ok',e.message)}})"`
- Run a task: `set VIVO_PASTA=F:\tmp&& set VIVO_LOG=1&& npm start`; create "say hi" task (acceptEdits), Run now; check log, sidebar session, history, notification.
- Script it: `VIVO_JS="vivo.agendadaRodar('<id>')" VIVO_FOTO=ag.png npm start`; also `VIVO_AGENDA_AGORA=<id>`.
- Resume guard: while a scheduled run is going, open its session and send a message: refused. Timeout: temporarily lower `LIMITE_EXECUCAO`, confirm `erro` "tempo esgotado" and the queue moving on. Pure math: `0 0 29 2 *` returns quickly; an unmatchable cron fails validation.
- Catch-up: set `proxima` to 2 h ago in the test profile's `agendadas.json`, restart: one run, `recuperada:true`. Set 30 h ago: `perdida`, no run. Paused task never fires.
- Tray and close-to-tray as in Acceptance Criteria; `tasklist | findstr /i "electron claude"` after Quit is empty.
- Keep-awake: log `powerSaveBlocker.isStarted(id)` under `VIVO_LOG`; `powercfg /requests` during a run.
- Open-at-login: packaged build (`npm run dist`), toggle, check Task Manager Startup; sign out/in starts hidden.
- Hidden-window CPU (`document.hidden` pause): compare `VIVO_METRICAS` visible vs hidden.

## Risks & Rollback

- Hidden renderer burns CPU with wallpaper: pause on `document.hidden`; verify with metrics.
- Wake-up bursts: serialised queue plus coalesced slots plus 24 h window. `setTimeout` drift across sleep: re-arm on `resume`; delay capped.
- Login expiry makes runs fail: error recorded and notified, no retry.
- Toasts may not show in dev (needs AUMID/Start Menu shortcut); verify in a packaged build.
- SDK option names (`permissionMode`, `canUseTool` deny shape, result fields) come from existing main.js usage; confirm against the Agent SDK docs since node_modules is not readable.
- Rollback: `git revert` the phase commit; `agendadas.json` is only read by this code and can be left or deleted.

## Docs impact

- `README.md` (English): feature paragraph (scheduled tasks, tray, close-to-tray, open at login, keep-awake, settings names) and `VIVO_AGENDA_AGORA` in the Testing section.
- No other evergreen docs unless `docs/` has a settings table; if so add the three `geral` toggles.

## Red-team notes

Verified against `src/main.js` and applied: generator prompt with `canUseTool` (streaming-input pattern of `turno()`, closed on `result`) plus a Step 0 real-run check; resume guard on running scheduled sessions; rename in `finally` with one retry, `guardaCfgSessao` also saves config; catch-up window on every `venceu()` and 20 s resume delay; 60 min timeout, `maxTurns`, wrapped `finally`; id-based queue, snapshot and delete/stop semantics (a queued slot lost at quit is accepted and documented); skip-ahead `proximaCron`, `null` as validation error, debounced preview; `ultimaVisivel` defined (confirmed missing), `session-end` and `quitAndInstall` set `sairDeVez`; `extraArgs: {}` (confirmed the wrapper injects `chrome`) and explicit `settingSources`; module-scope `bandeja`/notifications, generic toast body; hidden pause via existing `visibilitychange` (confirmed in app.js), no new IPC; tray item "New conversation", `atalhoGlobal` toggle kept; 32 px tray, `ctrl?.` guards, `--oculto` argv signal, `getLoginItemSettings` args, idle-hidden auto-quit.
Rejected: none. Adjustment: `dontAsk` not used (outside the decided picker set); the `canUseTool` deny stays.
