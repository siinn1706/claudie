---
phase: 9
title: "@-mention apps for computer use"
status: completed
priority: P1
depends_on: [2, 4]
---

# @-mention apps for computer use

User request (2026-11-01): computer use must let the user tag apps with `@` in the composer, like Claude Desktop.

## Context

- `src/computador.js` already gates each app on first touch with the permission card `mcp__computer-use__app` and stores approved exe names in `t.cu.apps` (a Set, reset when the conversation's process closes). Tiers come from `nivelDe(exe)`; the blocklist comes from `bloqueados(cfg)`.
- `src/renderer/app.js` handles the `@ mentions` picker (`mencaoAtual`, `mostraMencoes`, `escolheMencao`), which lists files from `vivo.arquivos`.

## Requirements

1. When computer use is on for the current conversation, the `@` picker shows an **Apps** group above the files. It lists the apps that have a visible top-level window, plus the Start menu apps, each with its name, icon, and tier badge (view, click, or full). Use `app.getFileIcon` for the icon, and filter the list with the same fuzzy scoring as files. Blocklisted apps and Claudie itself are not listed.
2. Choosing an app inserts `@AppName` and shows it as a chip in the composer, the same way attachments are shown (with an × button to remove it).
3. On send, each mentioned app is pre-approved for the turn: its exe goes into `t.cu.apps`, so no first-touch card appears for it. The turn's prompt also gets one line: "The user granted computer control of: AppName (exe, tier)." The tier and the blocklist are still enforced; a mention never lifts a tier.
4. If computer use is off and the user types `@` followed by an app name, show a hint item, "Turn on computer control to mention apps", that turns it on through the existing toggle.
5. Strings are translated to en and vi. README gets a line describing the feature.

## Files

- `src/computador.js`: an exported `listaApps()` that enumerates visible windows (EnumWindows + the exe path through the existing helpers) and reads `.lnk` targets from both Start Menu Programs folders. It caches the result for 30 s and filters out the blocklist and Claudie. Also an exported `preAprova(t, exes)`.
- `src/main.js`: an IPC handler `apps-computador` that returns `[{nome, exe, nivel, icone}]`. The send path accepts `apps: [exe]`, calls `preAprova`, and appends the prompt line.
- `src/preload.cjs`: `vivo.appsComputador()`.
- `src/renderer/app.js`, `app.css`: the picker group, the chips, and passing `apps` on send.
- The i18n parts and README.

## Acceptance

- With computer use on, typing `@no` lists Notepad with its icon and tier, and choosing it adds a chip.
- After sending "open @Notepad and type hi", Claude controls Notepad with no first-touch card. Another app still triggers the card.
- A blocklisted app (for example 1Password) never appears. A view-tier app (Chrome) still refuses clicks.
- `node --check` passes on the touched JS, and the i18n JSON parses.
