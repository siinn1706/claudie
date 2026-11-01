---
title: "Claudie: Claude Desktop parity (8 features)"
description: "Close the top eight gaps between Claudie and Claude Desktop found in the gap analysis, computer use included."
status: pending
priority: P1
effort: 12d
branch: feat/desktop-parity
tags: [feature, frontend, backend]
blockedBy: []
blocks: []
created: 2026-11-01
---

# Claudie: Claude Desktop parity

Source: [gap analysis](../reports/gap-analysis-261101-1056-claudie-vs-claude-desktop.md). Locked decisions: [research/decisions.md](research/decisions.md).

## Outcome

Claudie gains the eight highest-value Claude Desktop capabilities it lacks, each usable end to end on Windows, translated (pt/en/vi), documented in README, and committed as one conventional commit per phase on `feat/desktop-parity`.

## Constraints and non-goals

- Plain JS ESM, no bundler, no TypeScript. One new native dependency allowed: `koffi`. Mermaid is vendored.
- Every phase edits `src/main.js` and `src/renderer/app.js`, so phases run sequentially, never in parallel.
- Not in scope: cloud sessions, Dispatch, cloud routines, account memory, claude.ai artifact sharing, skill zip import, macOS/Linux builds.

## Phases

| # | Phase | Priority | Depends on | Status |
|---|---|---|---|---|
| 01 | [Esc interrupt, picker shortcuts, bypass mode](phase-01-keys-modes.md) | P1 | none | completed |
| 02 | [Computer use MVP](phase-02-computer-use.md) | P1 | 01 | completed |
| 03 | [Inline mermaid/svg/html and Artifacts window](phase-03-inline-render.md) | P2 | none | completed |
| 04 | [In-app browser pane and dev servers](phase-04-browser-pane.md) | P2 | 02 | completed |
| 05 | [Scheduled tasks, tray, keep-awake](phase-05-scheduler-tray.md) | P2 | none | completed |
| 06 | [Customize: plugins, skills, MCP logs, connector catalog and auth](phase-06-customize-ecosystem.md) | P2 | none | completed |
| 07 | [Inline diff comments and review card](phase-07-diff-review.md) | P2 | none | completed |
| 08 | [Quick Entry, claudie:// links, screen capture](phase-08-quick-entry-capture.md) | P3 | 05 | completed |
| 09 | [@-mention apps for computer use](phase-09-computer-use-app-mentions.md) | P1 | 02, 04 | completed |

## Acceptance criteria (whole plan)

- Each phase's acceptance criteria pass, verified by `node --check` on touched JS, JSON parse of touched i18n files, and an app launch check described in the phase.
- No regression in existing flows: sending, permission cards, Esc closing menus, background tasks, Remote Control.
- README feature list describes every new user-visible feature.
- One commit per phase, conventional format, no AI references.

## Research

- Code scouts per feature: `research/scout-*.json`
- Windows input and computer-use schema: [research-win-input.md](research/research-win-input.md)
- Electron APIs: [research-electron-views.md](research/research-electron-views.md)
- Agent SDK and CLI facts: [research-sdk-facts.md](research/research-sdk-facts.md)
