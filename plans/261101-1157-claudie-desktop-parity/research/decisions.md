# Locked decisions

User answers (2026-11-01):

- Computer use input injection: **koffi** (user32 SendInput, GetForegroundWindow, QueryFullProcessImageNameW). Add `koffi` to dependencies and `build.asarUnpack: ["node_modules/koffi/**"]`.
- Emergency stop: **Esc** global shortcut, registered only while a computer-use action is running, unregistered right after.
- Computer use scope: **per conversation**, stored with model/mode/effort in `config.porSessao` (same path as `mudaConfig`). Per-app approvals reset when the conversation's process closes.
- Git: branch `feat/desktop-parity`, one conventional commit per phase, no push.

Defaults chosen by the planner (no user input needed; reversible):

- bypassPermissions: reachable only from the mode picker, confirmed by a main-process `dialog.showMessageBox`; never part of the Ctrl+Shift+M cycle; never persisted as the global default for new conversations; never offered in plan approval; not offered for scheduled tasks.
- Esc with a pending permission/question card interrupts the turn (denies the card), like Claude Code. Esc closes open menus, popovers, lightbox, radial menu and non-pinned floating windows first.
- Shortcuts: Ctrl+Shift+M cycles default → acceptEdits → plan → auto; Ctrl+Shift+I opens the model picker; Ctrl+Shift+E opens the effort picker; Ctrl+Shift+P opens the mode picker. Phase 1 checks collisions with existing handlers.
- Inline render: ```mermaid and ```svg default to Preview, ```html defaults to Code. HTML previews run in an `iframe` with `srcdoc`, empty `sandbox` (no scripts, no same-origin) and a CSP meta. Mermaid is vendored as `src/renderer/vendor/mermaid.min.js` (MIT), not an npm dependency. Artifacts window lists files written by Write/Edit/MultiEdit in this conversation.
- Browser pane: docked `WebContentsView` (column beside the chat), partition `persist:claudie-preview`. Loopback and launch.json URLs skip site approval; other sites ask once per site per conversation through the permission card. Chat links stay external; Alt+click opens them in the pane. Claude in Chrome stays enabled; a system-prompt line tells Claude to prefer the in-app browser for localhost previews.
- Scheduler: tasks in `%APPDATA%/Claudie/agendadas.json`; kinds hourly, daily, weekdays, weekly, and 5-field cron; one run at a time (queue); catch-up runs once if the missed slot is within 24 h, otherwise logged as missed; default permission mode `auto`, choices default/acceptEdits/plan/auto. Runs are normal persisted Claude Code sessions in the task's folder, so they appear in the sidebar. Tray icon always present. Closing the last window hides to tray when any conversation is running or any task is enabled; otherwise quits. Open at login option (hidden start). Keep-awake option (powerSaveBlocker `prevent-app-suspension`) while a turn or task runs.
- Customize: new tabs inside the existing Customize panel (Plugins, Skills, Connectors catalog, MCP logs), not a new page. Skills enable/disable only if an official setting exists (verify in docs during phase 6); otherwise list, open, create and delete only. Skill zip import is out of scope.
- Diff review: pending-comments bar above the composer, used by both the Chat changes window and Edit cards. `report_findings` tool on the existing `claudie` in-process MCP server renders a review card.
- Quick Entry: separate frameless always-on-top window, default shortcut Ctrl+Alt+Space (configurable), sends to a new conversation by default with a toggle for "current conversation" of the last focused window. `claudie://` registered in packaged builds (and in dev only with `VIVO_LINK=1`); `claudie://new?prompt=&cwd=` always asks before sending; `claudie://session/<id>` opens a new window. Screen capture: the paperclip becomes a two-item popover (Files, Screenshot); region overlay covers the display under the cursor.
