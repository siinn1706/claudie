---
phase: 6
title: "Customize: plugins, skills, MCP logs, connector catalog and auth"
status: completed
priority: P2
effort: "1.5 days"
dependencies: []
---

# Phase 06: Customize: plugins, skills, MCP logs, connector catalog and auth

## Goal

Add Plugins, Skills and Connectors (catalog, sign-in, logs) tabs to the existing Customize panel, backed by the Claude Code CLI and SDK, so plugins, skills and remote connectors can be managed without leaving the app.

## Context

- Scout: `research/scout-customize-ecosystem.json` (integration points, CLI contracts). SDK/CLI facts: `research/research-sdk-facts.md`. Locked decisions: `research/decisions.md` (Customize bullet: new tabs inside the existing Customize panel, no new page; skills enable/disable only if an official setting exists, otherwise list/open/create/delete; skill zip import out of scope).
- Line numbers re-checked against source (they may drift; use function names): `query()` main.js:66, `comConsulta` 978, `comCache` 997, `guardaDesligado` 1014, `esquecePainel` 1025, `claudeCli` 1026 (execFile, 45 s timeout, `maxBuffer: 1<<20`, output cut to 1500 chars, error path returns `err || saida`), `ESCOPOS_MCP` 1035, `reabreConversas` 1037, `mcp_acao` 1038 (only rejects `claude.ai *` and `claudie`), `mcp_adicionar` 1058, `painel` 1080, `linhasPara` 1634, `claude_entrar` 1654, `before-quit` 1832, `enviarEvento` 190, `comandos()` 317 (10 min cache `comandos|<cwd>`). `comandoClaude` lives in `src/claude-exe.js`.
- Renderer: `ABAS`/`desenhaAba`/`ACOES`/`abrePersonal` in `personalizar.js`; connector rows `mcpLinha`/`mcpRodape`/`mcpExecuta` and the private `mcpForm` in `painel.js`. Events reach the renderer through `vivo.aoEvento`.
- CLI facts (claude 2.1.316): `claude plugin list --json [--available]`, `plugin install|enable|disable|uninstall|update <id> [--scope scope] [--json]` (result is one JSON object on the last stdout line: `outcome`, `message`, `failureCode`, `shownCommand`), `plugin marketplace add|list|remove|update`, `claude mcp login <name>` and `claude mcp logout <name>`. Research confirms `--scope`; the `-s` alias must be verified in task 2 before use. The SDK has no OAuth API, so sign-in is `claude mcp login` followed by `reconnectMcpServer`.

## Design

**Config/state.** No new persisted config. In-memory only: `logsMcp` (Map `cwd|nome` -> string[], 200 lines max), `entrandoMcp` (single global login), `filaPlugins` (promise chain).

**Main process: new file `src/extensoes.js`** (ESM, pure helpers, no Electron import so it can be `node --check`ed and exercised with `node -e`):
- `lerSkills(cwd)`: scans `~/.claude/skills/*` and `<cwd>/.claude/skills/*` with `fs.statSync` (not Dirent, so symlinked/junction folders are listed), requires `SKILL.md`. Skills are identified by the **folder basename** (`pasta`), never the frontmatter name. Frontmatter parser (`^---\r?\n([\s\S]*?)\r?\n---`) handles `key: value`, strips matching quotes, and handles `>`/`|` block scalars (first folded line) -> `{pasta, nome, descricao, origem:'user'|'projeto'}`.
- `caminhoSkill(origem, pasta, cwd)`: validates `pasta` with `/^[^\\/:*?"<>|]+$/`, rejects `.` and `..`, resolves inside the computed root and asserts `path.relative` stays inside. Used by apagar and abrir.
- `criarSkill({nome, descricao, escopo}, cwd)`: `nome` `/^[a-z0-9-]{1,64}$/` (new skills only), `descricao` 1..500 chars without line breaks, folder must not exist, `mkdir` + template `SKILL.md`; `description` is written as a `JSON.stringify`'d double-quoted YAML scalar so `:`, `#`, `[` etc. stay valid.
- `apagarSkill(origem, pasta, cwd)`: via `caminhoSkill`, requires `SKILL.md`, then `fs.rmSync(recursive)` (on a symlinked folder this removes only the link).
- `catalogo()` reads `src/catalogo-conectores.json`. `nomeMcpValido(nome)`: `/^[\w.-]{1,64}$/` and not starting with `-`. `fonteMercadoValida(fonte)`: see Security.
- `ansi(txt)` strips escape codes; `redige(txt)` masks `Bearer <token>` and `token|key|secret|authorization` values; `ringLog(mapa, chave, chunk)` splits lines, applies ansi + redige, pushes, caps at 200.

**CLI helpers.**
- `claudeCli(args, cwd, opc)` gets a third param `{timeout = 45000, max = 1500, maxBuffer = 1 << 20}`; existing call sites unchanged.
- New standalone `claudeJson(args, cwd, {timeout})` written with its own `execFile` (does not wrap the `claudeCli` error branch): `maxBuffer: 16 << 20`, stdin closed immediately (`child.stdin.end()`) so a consent prompt cannot hang, output not truncated. It parses the last non-empty stdout line (`--json` action results) or the whole stdout (list commands) even when the exit code is non-zero (e.g. `already_in_goal_state`) and returns `{erro: message, codigo: failureCode}`; only when nothing parses does it fall back to trimmed stderr. On timeout (45 s lists, 180 s install/update) it kills the process tree (`taskkill /T /F /PID` on Windows, `kill` elsewhere) and returns `{erro, terminal: true}`.
- When `acharClaude()` is null (only the SDK-embedded binary exists), the three tabs render a clear empty state (Portuguese key: install Claude Code to manage this) instead of failing.

**IPC channels** (all validate input in main; paths are computed in main only):

| Channel | Input | Output |
|---|---|---|
| `plugins_lista` | none | `{instalados, disponiveis, mercados}` or `{erro}` (`comCache("plugins|"+cwd, 20e3)`; two parallel `claudeJson`: `plugin list --json --available` returns `{installed, available}`, and `plugin marketplace list --json`) |
| `plugin_acao` | `{acao: instalar\|ativar\|desativar\|desinstalar\|atualizar, id, escopo}` | `{ok, mensagem}` or `{erro, terminal?}` |
| `mercado_acao` | `{acao: add\|remove\|update, fonte, nome, escopo}` | same |
| `skills_lista` | none | `{skills, comandosPlugin}` (second list from `comandos(j)` filtered to names containing `:`, read-only, labelled "plugin commands and skills") |
| `skill_criar` / `skill_apagar` | see helpers | `{ok, pasta}` or `{erro}`; both then delete every `comandos|*` key from `respostas` and call `reabreConversas()` (running turns get `reiniciar`) |
| `skills_pasta` | `{origem}` | `shell.openPath` on the computed dir (mkdir first) |
| `skill_abrir` | `{origem, pasta}` | `shell.showItemInFolder` on the computed `SKILL.md` |
| `mcp_logs` / `mcp_logs_limpar` | `{nome}` | `{linhas: string[]}`; `nomeMcpValido` first |
| `mcp_acao` (extend) | `acao: 'entrar'\|'sair'\|'terminal'` | `entrar` returns `{ok:true}` and streams `{tipo:'mcp_login', nome, linha, fim, codigo}` |
| `conectores_catalogo` | none | catalog entries with `jaAdicionado` from a fresh uncached `comConsulta(j, q => q.mcpServerStatus())` raced against a 3 s timeout; match by config URL when status exposes it, plus name |

**Mutation serialization.** `plugin_acao` and `mercado_acao` run through one main-side promise queue (`filaPlugins = filaPlugins.then(fn, fn)`), so a double click or a second window never runs two writes against the plugin settings at once.

**Action mapping** (`plugin_acao`): `['plugin', verbo, id, '--scope', escopo, '--json']` with verbo from `{instalar:'install', ativar:'enable', desativar:'disable', desinstalar:'uninstall', atualizar:'update'}`; `desinstalar` adds `--keep-data` when task 2 confirms the flag. `id` `/^[\w.@-]{1,120}$/` and not starting with `-`; `escopo` in `ESCOPOS_MCP`. After success: `respostas.delete` for `plugins|*` and `comandos|*`, `esquecePainel()`, `reabreConversas()`. If the JSON result has `shownCommand`, or `claudeJson` timed out, return `{erro: <message>, terminal: true}` and the renderer says to finish in a terminal (Portuguese key, translated). `mercado_acao` maps to `['plugin','marketplace','add',fonte,'--scope',escopo,'--json']`, `remove <nome>`, `update [nome]` (`nome` validated like plugin ids). The UI shows the resolved source in a confirm step before `add`, and a two-step confirm for marketplace removal (warns it uninstalls its plugins) and for plugin `Desinstalar`.

**MCP logs.** In `query()` add `extra.stderr` (caller-supplied `args.options.stderr` wins by the existing spread order). Conversation queries pass a label `cwd`; the hook buffers under `cwd|*` and attributes a line to `cwd|nome` when it contains a name from `nomesMcp` (Map `cwd` -> Set of names). `nomesMcp` is seeded from `mcpServerStatus` at conversation query start and refreshed in the `painel` handler. The throwaway queries in `comConsulta` and the panel pass no label and are skipped, so their startup noise never lands in a ring. All text goes through `ringLog` (ANSI stripped, credentials redacted). In `painel`, each `failed` server's `error` is pushed once per distinct text. Task 2 verifies what the CLI emits on stderr; add `extraArgs: {"debug-to-stderr": null}` only after confirming it is a valid flag that does not flood (ring cap; drop unrelated lines over 500 chars).

**MCP sign-in.** `mcp_acao` starts with `nomeMcpValido(nome)` (new check at the top, next to the existing `claude.ai *`/`claudie` guard, covering remover/ligar/reconectar/entrar/sair/terminal); `mcp_logs*` use the same check. Plugin-provided names like `plugin:x:y` are refused for login with a clear message. Pass `--` before the name where the CLI supports it (task 2). `entrar`: spawn `comandoClaude(exe, ['mcp','login',nome])` with `cwd: j.cwd` (local/project scopes resolve from the folder) and `stdio: ['ignore','pipe','pipe']`, reusing `linhasPara` generalized with an event-type/name parameter (DRY; `j` captured once at spawn instead of the lazy `J(e)`). One login at a time globally (`entrandoMcp`); a second request returns `{erro}` "login already running", which also avoids two OAuth loopback callbacks. The child lives in a Set that `before-quit` kills; the 3 min timer is cleared on close, and on timeout or spawn error the child is killed and `{tipo:'mcp_login', nome, fim:true, codigo}` is emitted. On code 0: `esquecePainel()`, `comConsulta(j, q => q.reconnectMcpServer(nome))`, `reabreConversas()`. `sair`: `claudeCli(['mcp','logout',nome], j.cwd)`, then `esquecePainel(); reabreConversas()`. The "paste the redirect URL" no-browser case has no stdin path; it falls back to the terminal button. `terminal` builds the command from `comandoClaude(exe, ['mcp','login',nome])` (cmd + args + env, so a `cli.js` shim keeps `ELECTRON_RUN_AS_NODE`); on Windows `spawn('cmd', ['/c','start','""','cmd','/k', c.cmd, ...c.args], {env: c.env, cwd: j.cwd, detached: true})` with space-containing paths quoted (the empty quoted argument is the window title); on darwin/linux it uses the platform terminal opener, and the button is hidden when none is found.

**Connector catalog** `src/catalogo-conectores.json`: `[{id, nome, descricao, url, transporte:'http'|'sse', categoria, auth:'oauth'|'chave'}]`, about 12 well-known remote servers (Notion, Linear, Sentry, GitHub, Atlassian, Asana, Stripe, PayPal, Figma, Cloudflare, Context7, Vercel). Every URL and transport must be verified from the vendor's docs during implementation (Atlassian and Asana may be `sse`); drop any entry that cannot be verified. GitHub is `auth:'chave'` (PAT). `Adicionar` calls a shared helper `adicionaMcp(j, d)` extracted from the `mcp_adicionar` handler body (the handler becomes a one-line wrapper) with `{nome:id, transporte, url, escopo:'user'}`; the renderer marks the card added locally right after success, because every add empties the painel cache. For `oauth` the card then offers `Entrar`; for `chave` it calls `window.mcpAbreForm(prefill)`, a new global in `painel.js` that sets `mcpForm` (transporte, url, nome) and opens the Details panel.

**Renderer: new `src/renderer/extensoes.js`** (script tag after `personalizar.js`) exporting `window.desenhaExtensoes(aba, corpo, nota)`, which returns `true` when it handled the tab. `personalizar.js`: three `ABAS` entries (`plugins`, `skills`, `conectores`) and one call at the top of `desenhaAba` (`if (window.desenhaExtensoes?.(abaP, corpoP, nota)) return;`). Each tab keeps local state in module variables, wires clicks with `data-ext`, and keeps a **render token per tab**: an async result is applied only when the active tab and token still match. Every CLI, marketplace or skill-derived string (plugin descriptions are third-party) is escaped with the existing `esc`, including `data-ext` attribute values; log text is set via `textContent`, never `innerHTML`. A shared `window.extLogView(pre, linhas)` and the `mcp_login` listener (via `vivo.aoEvento`, live output in an `.ext-log` block) live in `extensoes.js` and serve both places. The **Connectors tab** has the catalog plus an "installed connectors" list (painel data) with a Logs toggle per server, which delivers the decisions.md "MCP logs" tab inside Customize. `painel.js` gains `Entrar` (estado `needs-auth`), `Sair` (http/sse connected, non-embedded), a per-row `Logs` button using `extLogView` with Refresh/Clear, `mcpAbreForm`, and `Catálogo` in `mcpRodape` calling `abrePersonal('conectores')`; Details-panel login output shows in the row's `.ext-log` through the shared listener.

**Skill enable/disable.** Not shipped. The only candidate is a `Skill(name)` permission deny rule inside Claude Code's own settings files, which would make the app edit another tool's config (scope choice, merge, clobbering). decisions.md allows this: the tab offers list, open, create and delete. Task 1 still records whether a dedicated per-skill off switch exists; if so, it is a separate change.

## Files to Create / Modify

- `src/extensoes.js` - create: pure helpers listed above.
- `src/catalogo-conectores.json` - create: verified remote connector catalog.
- `src/renderer/extensoes.js` - create: Plugins, Skills, Connectors tab renderers, shared log view and login listener.
- `src/renderer/i18n/parts/extensoes.json` - create: pt key -> `{en, vi}` for every new string (same shape as `conectores.json`).
- `src/main.js` - modify: `query` stderr hook, `claudeCli` options + `claudeJson`, `adicionaMcp` extraction, `linhasPara` generalization, validation at top of `mcp_acao`, new IPC handlers, `before-quit` login kill, log feed in `painel`.
- `src/preload.cjs` - modify: `pluginsLista, pluginAcao, mercadoAcao, skillsLista, skillCriar, skillApagar, skillsPasta, skillAbrir, mcpLogs, mcpLogsLimpar, conectoresCatalogo` one-liners after `mcpAdicionar`.
- `src/renderer/personalizar.js` - modify: three `ABAS` entries and the hook.
- `src/renderer/painel.js` - modify: `Entrar`, `Sair`, `Logs`, `Catálogo`, `mcpAbreForm`.
- `src/renderer/index.html` - modify: `<script src="extensoes.js">` after `personalizar.js`.
- `src/renderer/app.css` - modify: `.ext-card`, `.ext-log` (mono, `max-height`, scroll), small rules reusing `.pz-*`, `.con-bloco`, `.mcp-bt`.
- `README.md` - modify: Customize section (see Docs impact).

## Tasks & Steps

1. [x] Spike (read-only): confirm from docs whether a dedicated per-skill disable setting exists and whether MCP debug output needs `debug-to-stderr`; record as two lines in the commit body, not in code comments.
2. [x] Run `claude plugin list --json --available`, `plugin marketplace list --json`, `claude mcp login --help`, `plugin install --help`; confirm shapes, `--scope` vs `-s`, `--keep-data`, whether `--` is accepted, and that `list --available` is `{installed, available}`.
3. [x] Create `src/extensoes.js`; exercise `lerSkills` (quoted, block-scalar, symlink, underscore/capital folder names), `criarSkill` (description with `:`/`#`), `caminhoSkill` traversal rejection, `redige`, `ringLog` with `node -e` against a temp dir.
4. [x] Extend `claudeCli` (opc) and write standalone `claudeJson` (maxBuffer, stdin end, parse on non-zero exit, tree kill on timeout).
5. [x] Add `nomeMcpValido` check at the top of `mcp_acao`; add `stderr` hook in `query()`, `logsMcp`, `nomesMcp`, redaction, failed-error push in `painel`, and `mcp_logs`/`mcp_logs_limpar`.
6. [x] Extract `adicionaMcp`; add `conectores_catalogo` and write `catalogo-conectores.json` with verified URLs/transports.
7. [x] Implement `mcp_acao` `entrar`/`sair`/`terminal` (cwd, single login, `before-quit` kill, timer cleanup, generalized `linhasPara`, reconnect, `reabreConversas`).
8. [x] Implement `plugins_lista`, `plugin_acao`, `mercado_acao` with validation, `filaPlugins` and cache invalidation.
9. [x] Implement skills IPC; `skill_criar`/`skill_apagar` drop `comandos|*` and call `reabreConversas()`.
10. [x] Add preload bridges.
11. [x] Build `extensoes.js` tabs (render tokens, escaping, empty state); hook into `personalizar.js`; script tag and CSS.
12. [x] Update `painel.js` controls (Entrar, Sair, Logs, Catálogo, `mcpAbreForm`).
13. [x] Write `i18n/parts/extensoes.json` (en + vi) covering every new Portuguese string, including `painel.js` ones.
14. [x] Update README; run Verification; commit `feat(customize): manage plugins, skills and connectors from Customize`.

## Security & Safety

- Renderer input is never trusted: skill `nome` (create) `/^[a-z0-9-]{1,64}$/`, skill `pasta` (delete/open) `/^[^\\/:*?"<>|]+$/` minus `.`/`..` and checked inside the computed root, plugin `id` `/^[\w.@-]{1,120}$/` not starting with `-`, MCP names `nomeMcpValido` (`/^[\w.-]{1,64}$/`, no leading `-`) enforced in `mcp_acao`, `mcp_logs*`, scopes from `ESCOPOS_MCP`. CLI is invoked with an args array via `execFile`/`spawn` (no shell string); `--` before user-supplied names where supported.
- Marketplace `fonte` whitelist (`fonteMercadoValida`): `owner/repo` (`/^[\w.-]+\/[\w.-]+$/`), an `https://` URL (git or marketplace.json), or an existing local directory checked in main with `fs`; everything else is rejected (no `ssh://`, `file://`, `ext::` transports, no leading `-`, max 300 chars). The resolved source is shown in the confirm step before `add`. Marketplace plugins are third-party code that runs later, so the UI shows source marketplace and scope before `Instalar`, and any `shownCommand` consent is deferred to a terminal (`--accept-command` is never passed).
- Skill paths are computed in main from `origem`+`pasta` and the conversation's `cwd`; `skill_apagar` refuses unless the target contains `SKILL.md`, with two-step confirmation in the UI. Plugin `Desinstalar` and marketplace removal are two-step too.
- Catalog `Adicionar` is always an explicit click; remote servers get no credentials from the app. OAuth tokens are handled entirely by Claude Code (`mcp login`); the app relays CLI output lines (ANSI stripped, redacted, 2000 chars/line) and never writes them to disk.
- MCP logs live in memory only, capped, redacted, with a Clear button. Names `claude.ai *` and `claudie` stay protected.
- Plugin/marketplace mutations are serialized in main; CLI children for plugin and login commands never have an open stdin and are killed on timeout, window quit or app quit.

## Acceptance Criteria

- Customize shows Plugins, Skills and Connectors tabs; no new page or sidebar button; switching tabs mid-load never writes a stale result into another tab.
- Plugins tab lists marketplaces, installed and available plugins; install, enable/disable, update, uninstall (confirmed) and marketplace add (source whitelisted) / remove work against a local marketplace directory, lists refresh, open conversations restart afterwards; two rapid clicks run one mutation at a time.
- A plugin needing terminal consent, or a timeout, surfaces a "finish in a terminal" message instead of hanging or auto-accepting; a large `--available` list loads (no maxBuffer failure).
- Skills tab lists user and project skills (including symlinked folders and folder names with underscores/capitals) with description and origin, creates a valid `SKILL.md` (descriptions containing `:` or `#` stay valid YAML), opens the folder/file, deletes after confirmation; created/deleted skills change the `/` menu without restarting the app (cache dropped, conversations reopened). No enable/disable toggle (see Design).
- Connectors tab: catalog lists verified entries, marks already-added ones (also right after adding), adds with one click (scope user), offers `Entrar` for OAuth ones and the prefilled form for `chave` ones; an installed-connector list with Logs.
- A `needs-auth` server in the Details panel shows `Entrar`; clicking spawns `claude mcp login` in the conversation's folder, streams output, and on success the server becomes `connected`; a second concurrent login is refused; failure offers "Abrir no terminal". `Sair` logs out.
- `Logs` shows buffered output for that conversation's server (and the failure reason for failed servers) with Refresh and Clear; no ephemeral-query noise; tokens redacted.
- All new strings have `en` and `vi`; invalid ids/names/sources (`-s`, `--help`, `../x`, `ssh://...`) are rejected with an error, never passed to the CLI.

## Verification

- `node --check` on each of `src/main.js`, `src/extensoes.js`, `src/preload.cjs`, `src/renderer/extensoes.js`, `src/renderer/personalizar.js`, `src/renderer/painel.js` (one per call).
- `node -e` JSON.parse of `src/catalogo-conectores.json` and `src/renderer/i18n/parts/extensoes.json`; every key has non-empty `en` and `vi`.
- `claude plugin list --json --available`, `claude plugin marketplace list --json`, `claude mcp login --help` (shapes match Design).
- `VIVO_JS="abrePersonal('plugins')" VIVO_FOTO=plugins.png npm start`; repeat for `skills` and `conectores`.
- Skills round trip in a temp `VIVO_PASTA`: `VIVO_JS="vivo.skillCriar({nome:'demo-skill',descricao:'a: b #c',escopo:'projeto'}).then(r=>console.log(JSON.stringify(r)))"`; confirm file, list, `/` menu entry, then delete.
- Plugin round trip with a local marketplace folder: add, install, disable, enable, update, uninstall; `VIVO_LOG=1` shows conversations restarting.
- MCP logs/login: stdio server that exits immediately shows its failure in Logs; a remote OAuth catalog server shows `needs-auth`, `Entrar` opens the browser flow; quitting the app mid-login leaves no `claude` child.
- Manual: `-s`, `--help`, `../x`, uppercase names and `ssh://x` sources are refused in each form.

## Risks & Rollback

- stderr attribution is heuristic: unmatched lines go to the conversation's general bucket; the debug flag is added only if verified.
- Plugin commands may need a TTY: handled by closed stdin, timeout kill and the terminal message.
- Catalog URLs/transports can go stale: small list, verified at implementation, removal is a JSON edit.
- Stale UI after changes: invalidate `plugins|*`, `comandos|*`, painel cache and `reabreConversas()` on every mutation.
- Rollback: revert the single phase commit; no data migration (created skills and installed plugins remain Claude Code's own files).

## Docs impact

README.md (English): extend the Customize feature section with Plugins, Skills and Connectors (catalog, sign-in, logs), note that plugin and `mcp login` support need an external recent Claude Code CLI (verified on 2.1.316), and add `src/extensoes.js`, `src/renderer/extensoes.js` and `src/catalogo-conectores.json` to the project structure list. No other docs.

## Red-team notes

Applied (all verified against main.js/claude-exe.js): MCP/marketplace validation gaps, `claudeJson` buffer and parse-on-failure, stdin closed and tree kill, login `cwd`/single login/quit cleanup/`linhasPara` reuse, terminal command via `comandoClaude`, per-conversation log keys with redaction, skill identification by folder basename and YAML quoting, cache invalidation for skills, catalog `jaAdicionado`/transport/GitHub/`mcpAbreForm`, mutation queue and uninstall confirm, render tokens and escaping, Connectors-tab logs, two-call plugin list and empty state.
Resolved by choice: skills toggle dropped (editing Claude Code's settings is out of proportion; decisions.md only requires it if an official setting exists). Partially adjusted: `-s` replaced by `--scope` pending task 2; `--keep-data` and `--` are used only if task 2 confirms them. Rejected: none.
