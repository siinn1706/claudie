# Claudie

A Windows desktop app that talks to your local **Claude Code** through the official Agent SDK and draws the chat over live ASCII wallpapers, with Clawd at your side: 15 animated themes with music and sounds, 278 animations from the ASCII Magic library, Wallpaper Engine wallpapers, and your own videos, images and GIFs.

Made by [Nguyễn Văn Nam](https://github.com/siinn1706). A fork of [Claudinho](https://github.com/Lu1sR0/claudinho) ([meuclaudinho.com.br](https://meuclaudinho.com.br)) by [Luis Roberto](https://luisrobertoportifolio.com) that adds English and Vietnamese interfaces next to the original Portuguese.
## Run

1. Install [Claude Code](https://code.claude.com/docs/en/setup) and sign in.
2. Download `Claudie-Setup.exe` from [Releases](https://github.com/siinn1706/claudie/releases/latest) and run it. It is not code-signed, so SmartScreen asks first: More info → Run anyway. Requires Windows 10 or 11.

**Sign-in:** by default the app uses your Claude Code login (your plan). Anthropic's Agent SDK docs say third-party apps should not offer claude.ai login without approval, so read [the note in the SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) and decide for yourself. Customize → General → Account lets you use an **Anthropic API key** instead (billed per use, encrypted by the OS).

### From source

```bash
npm install
npm start          # open the app (or double-click "Abrir Claudie.bat")
npm run dist       # build the installer into dist/
```

## Language

Customize → General → Language: Portuguese, English or Vietnamese. The default is Vietnamese, and switching applies immediately. Claude replies in whatever language you write in; the titles and news it writes for the app follow the interface language.

The source code stays in Portuguese. [`src/renderer/i18n/i18n.js`](src/renderer/i18n/i18n.js) swaps each visible text node and the `title`, `placeholder`, `aria-label` and `alt` attributes using the dictionaries in [`src/renderer/i18n/parts/`](src/renderer/i18n/parts/), keyed by the Portuguese text, with `{0}` for values that change. Your messages, Claude's replies and code are never touched. The main process uses the same dictionaries for native dialogs and exports ([`src/i18n.js`](src/i18n.js)). To translate a new string, add its Portuguese text as a key in a parts file.

## Features

### Conversations

- **Project folder** (sidebar): the folder Claude Code works in.
- **List**: "All" shows Claude Code conversations from every project (terminal, the Claude app's Code tab, other windows), labeled with the project name; "This folder" shows only the current folder's. The list syncs whenever a conversation changes, and ⟳ forces a refresh. Opening a conversation from another project moves the window to that folder; the + on a project header (on hover) starts a new conversation right in that project. Changing folders while Claude works leaves the running turn going in the background. claude.ai web/app chats do not appear: they live on Anthropic's servers with no official access.
- **Menu ⋯**: pin, archive, duplicate, export to Markdown, rename, delete, open in another window, group and color. Archiving hides a conversation (not while it is running); "Archived", below the list, shows them (including ones the Claude app archived) with "Unarchive". Search (Ctrl+K) also looks inside messages. Groups are folders you can drag conversations into.
- **Per-conversation settings**: model, permission mode, effort and Ultracode are saved per conversation (a new one starts in Automatic permission mode on Opus 5.5 at medium effort, or with the last choice made in a new one) and apply right away to the running turn; anything Claude Code can't change mid-turn applies from the next message.
- **Multiple windows**: Ctrl+Shift+N opens a new window; each window has its own conversation.
- `/new` starts a new conversation.

### Talking to Claude

- **Model and permissions**: pick them in the sidebar; each menu explains its options. "Bypass permissions" (red chip) lets Claude edit files and run commands without asking; it is only in the permission menu, asks for confirmation in a native dialog showing the folder, is saved for that conversation only (a new one starts in Automatic, a branch falls back to Ask), and never appears in plan approval or the shortcut cycle. Deny rules and hooks of Claude Code still apply. In "Ask" mode, each tool that needs approval shows a card with Allow, Always this session and Deny; "Tell Claude what to do instead" is sent along with Deny. When Claude presents a plan (plan mode), the card renders it as Markdown and lets you approve into Ask, Edit without asking or Auto, or keep planning with a note.
- **Effort**: the bar next to the model sets how much Claude thinks, from Default to Maximum.
- **Ultracode**: the switch on the effort card makes Claude build a multi-agent workflow for each task (Claude Code's `ultracode`). It uses much more of your limit and needs workflows enabled in Claude Code (on Pro, `enableWorkflows` in `/config`) and a model with the xhigh level.
- **Computer control** (Windows only, off by default): the switch at the bottom of the permission menu lets Claude see the primary display and drive the mouse and keyboard through a built-in `computer-use` server. It is per conversation (saved with its model and mode; turning it on or off reopens that conversation's Claude Code, and a new conversation starts with it off). The first time Claude touches an app in a conversation, a card shows the app, its window title and its level; the approval lasts until that conversation's Claude Code closes. Levels: browsers and trading apps are view-only; terminals, Explorer and editors accept clicks and scrolling but not typing or key presses; everything else is fully controllable. Password managers, the Start menu, Settings, Task Manager, UAC and any app in Customize > General > "Blocked apps" are always refused, as are Claudie's own windows (except to look), `Win` combos and Ctrl+Esc. Elevated (administrator) windows, the lock screen and UAC can't be controlled: Windows blocks it, and Claudie reports it. Esc stops it: it is a global key only while an action is running, interrupts the turn, and a banner above the input says so. Plan mode allows looking only, and remote or scheduled turns are refused. Limits: primary display only; screenshots show every visible window (not just the one in focus), and they are kept in the conversation's transcript on disk and in the tool cards; on-screen text is treated as data, not instructions, but there is no injection classifier, so keep it off around sensitive windows.
- **Attachments**: the paperclip, dragging files onto the window, or pasting images (Ctrl+V). Images go to Claude (ones too large for the API are shrunk automatically; if they still don't fit, the app warns and doesn't send them); other files are opened by path. Click an image to view it full size; Esc closes.
- **Commands**: type `/` to see the app's commands and Claude Code's (skills, `/compact`, `/review`…). Arrows select, Tab completes, Enter runs. `!command` asks Claude to run it in the terminal.
- **File mentions**: type `@` to list files and folders in the conversation's folder (respects `.gitignore` in git repos) and type to filter. Arrows/Tab/Enter pick, Esc closes; picking a folder inserts `@folder/` and continues inside it. The `@path` is sent to Claude as text.
- **Claude's questions** become a form with the options; **large pastes** become an attachment you can open and edit; new conversations get an **automatic title**; when the plan limit is hit you get a warning and "Continue on its own when it resets".

### While Claude works

- You can open another conversation or start a new one; the running one continues in the background (a spinner in the list, or an amber dot when it is waiting for approval), and its reply and pending cards are there when you return. Messages you send (Enter, the send button next to stop, or Ctrl+X then Ctrl+S) go into the running turn, as in Claude Code; slash commands, and anything sent as the turn ends, are queued and go out when it finishes.
- Each conversation you send to keeps its own Claude Code process open until Claudie quits, and every new message is a new turn in it. Background tasks, permissions allowed for the session and loaded tools carry over between turns; when Claude starts a turn by itself (for example, after a background task finishes), the window showing that conversation follows it. A model, mode or ultracode change it can't take while open, or deleting the conversation or its worktree, closes the process, and the next message reopens it.
- Reasoning appears in a collapsible block, each tool becomes a block on the top rail (click to jump to it; right-click to restore files to before that point), edits show as +/− diffs, and the wallpaper reacts (ripples, rhythm).
- Claude's plan (TodoWrite or the Task* tools) stays pinned above the input and returns when you reopen the conversation. The meter next to the send button shows how much context is used, and the clock beside it counts down until the prompt cache expires (5 min or 1 h, whichever the API recorded); sending before then reuses the cached context.
- **Tool output**: cards show the start of the result and "Show all" loads the rest; images returned by a tool appear in the card (click to enlarge). Reopened conversations restore cards with their result and status. A subagent's (Task/Agent) activity is listed inside its card with a tool count.
- **Background tasks**: commands, agents, monitors and ultracode workflows show in an "In the background" strip above the input. The strip and the counter next to the input ("2 tasks") open a "Background tasks" window like Claude Desktop's. "Running" shows a card per task with elapsed time, tokens and tools; a workflow shows its phases (done/total, one square per agent, and an agent table with tokens and duration when expanded), and every task has a stop button (workflows ask for a second click). "Completed" keeps the last 100 per conversation while the app is open, with status (Completed, Failed, Stopped), duration and summary. Phases come from the workflow script's `meta`; agents and tokens are read (read-only) from what Claude Code writes to disk. Esc closes.
- **Notifications**: with the window in the background, you're notified when Claude finishes or needs approval.

### Replies and undo

- **Replies**: copy, read aloud, and **branch from here** (a new conversation starting at that reply; the original stays intact). Each message shows its time. Long replies come folded, with a table of contents and "Read the full reply".
- **Undo**: hover one of your messages and click the arrow: files Claude changed from that point on are restored (with a preview first).

### Git, terminal and connectors

- **Git and worktrees**: the folder's current branch shows next to the title (also inside a worktree). "New conversation in a worktree" (sidebar) asks for a short name, creates a new branch with `git worktree add` in `<folder>/.claude/worktrees` (if the project already uses it) or in `<folder>-worktrees/`, and opens a conversation there. Deleting a worktree's last conversation offers to remove it (with confirmation; uncommitted changes block it).
- **Pull requests**: with the GitHub CLI (`gh`) installed and the folder in a GitHub repo, the details panel shows the branch's PR (number, title, state and checks summary), with buttons to open it in the browser or create one (`git push -u origin HEAD` then `gh pr create --fill`, only on click and after confirmation).
- **Terminal**: the top button (or Ctrl+`) opens a terminal in the conversation's folder, without a pty: PowerShell (or `pwsh`) on Windows, bash/zsh elsewhere. Enter runs, ↑/↓ browse history, Ctrl+C (or the stop button) kills the running command and restarts the shell, and "Send to Claude" attaches the last command's output to your message. ANSI colors are stripped; the shell closes with the window.
- **Connectors (MCP)**: the details panel (Ctrl+J) shows each connector with status, scope and tool count. You can disable and enable them (also applies to later messages in that folder), reconnect, remove (`claude mcp remove`), and "Add connector" creates one (local command, http or sse, with env vars or headers) via `claude mcp add`. Claude Code errors show in the panel. claude.ai connectors are display-only; manage them at claude.ai/settings/connectors. Nothing runs without your click.
- **Remote Control**: the phone button at the top puts the open conversation, with its history, on claude.ai/code and in the Claude app, as Claude Desktop does. Messages sent from there show up in Claudie. Needs a Claude subscription login and a conversation that has started; turning it off (or closing Claudie) ends the link.

### Floating windows

Drag by the title, resize from the corner, and pin to keep one open in the same place, even after restarting the app:

- **Chat changes** (top button): in a git folder, the real diff against the last commit, with a file list, totals, open file and revert with confirmation, refreshed after each turn. The "This conversation" tab lists only what Claude changed, with diffs and "Undo from here".
- Claude's **plan**, highlighted.
- The **music player** (on the sound button).

### Wallpapers

- **Themes**: ask Claude (*"put the chat on Honu Lagoon"*), type `/theme`, `/theme koi` or `/theme default`, or use the 🎨 Themes button.
- **Library**: 278 animations from [ASCII Magic](https://www.ascii-magic.com/ascii) in 9 categories (landscapes, cities, cosmos, weather and nature, animals, algorithms, arcade, occasions and mascots; the list lives in `tools/indice-magia.mjs`), with search. `/wallpaper cat` opens the search; Claude can also find and apply one (*"give me a rain background"*).
- **Mine**: create in [ASCII Motion](https://www.ascii-motion.com), export as JSON and import (button, `/import`, or drag the file onto the tab). Layerless `.asciimtn` sessions work too.
- **Right-click** the wallpaper for a radial menu.
- **Sound**: the button at the top (starts muted).

### Customize

Sidebar or `/customize`:

- **General**: send with Enter or Ctrl+Enter, **performance** (Automatic, Maximum or Light), show reasoning, automatic titles, Clawd, reactive wallpaper, notifications, language and **account** (Claude Code login or API key).
- **Background**: your images, GIFs and videos as wallpaper (also by dragging onto the Mine tab), plus **Wallpaper Engine** video and web wallpapers (scene ones only run inside Wallpaper Engine), with fit, dim, blur and video sound.
- **Colors**: preset palettes, accent, text and glass colors, glass opacity and blur, light or dark glass.
- **Fonts**: interface and code fonts (from the web or your own .ttf/.otf/.woff), text size and chat width.
- **Sounds**: your own sounds for send, finish, approval request, error, wallpaper click and app open.
- **Music**: your tracks in order or shuffled, replacing the theme music or alongside it (controls also on the sound button).
- **Icon and name**: window and taskbar icon, optionally in the sidebar, and the app name.

Files are copied into `%APPDATA%\Claudie\pessoal`; "Reset everything" restores the defaults.

### Clawd

Claude Code's mascot is everywhere. On launch it assembles from tiles; on the home screen it follows the mouse, waves when you hover, jumps and sparks on click, and sleeps when you're idle; next to the input it mirrors Claude (thinks, types, calls you, jumps when done); in the sidebar and the "thinking" indicator it sways and types.

- **Grab Clawd** next to the input: it dangles from the cursor, falls when released (and gets dizzy if thrown), and walks back. Click it and it jumps and talks. Sometimes it peeks from behind the sidebar when you hover a project.
- **Clawd talks**: from time to time it comments on the project, shares Claude and Anthropic trivia, gives app tips and brings news (one quick search a day). Click it for the next one; turn it off in Customize → General.
- **Plan usage** (top button): Clawd works out at the gym, tiring as the 5-hour session fills and sleeping at the limit, with the reset time. Also shows the week and per-model usage.
- It is also the app icon; running the app with `VIVO_ATALHOS=1` creates a `Claudie.lnk` shortcut with that icon in the Start Menu and the app folder.

### Shortcuts and credits

- Ctrl+Shift+Space shows Claudie from anywhere; Ctrl+/ lists all shortcuts.
- **Esc** interrupts the running reply (a pending permission card is denied). When a menu, picker, panel, floating window or popover is open, Esc closes that first and a second Esc interrupts; it is ignored while typing in other fields and during IME composition.
- Ctrl+Shift+M cycles Ask, Accept edits, Plan and Auto (also while Claude works); Ctrl+Shift+I, Ctrl+Shift+E and Ctrl+Shift+P open the model, effort and permission menus (press again to close).
- **Credits** (sidebar): who made each artwork and each part of the app.

## Project structure

- `src/main.js`: the window and the bridge to Claude Code (`query()` from `@anthropic-ai/claude-agent-sdk`), permissions and the theme tools Claude can call.
- `src/computador.js`: computer control (the `computer-use` server): Win32 input and window checks through `koffi`, screen capture and coordinate mapping, the per-app gate and the Esc stop.
- `src/preload.cjs`: the calls the window can make.
- `src/renderer/`: the interface (`index.html`, `app.css`, `app.js`) and the wallpaper engine (`wallpapers/`).
- `src/renderer/wallpapers/arte.mjs`: plays ASCII Magic pieces and imported animations; `magia-indice.js` is generated by `node tools/indice-magia.mjs`.
- `src/renderer/personalizar.js`: the Customize panel.
- `src/renderer/extras.js`, `clawd-arte.js`, `clawd.js`, `interface.js`, `os.js`: reasoning, diffs, undo, questions, limits, Clawd, the activity rail, floating windows and the radial menu.
- `src/renderer/simulador.js`: opens the interface in a regular browser with fake replies, for working on visuals without Claude Code.
- `docs/pesquisa-melhorias.md`: what users ask Claude for most and design concepts, with what's done and what's left (in Portuguese).

## Testing

- `node tools/teste-sdk.mjs`: a short question through the SDK, to check login and streaming.
- `VIVO_LOG=1 VIVO_TESTE="message" npm start`: sends the message on launch and logs events to the terminal (`VIVO_ANEXO=file` attaches a file).
- With `VIVO_PASTA` or `VIVO_JS` set, the app uses a separate profile (`%APPDATA%\Claudie-teste`), so tests don't touch your settings and can run while the app is open.
- `VIVO_MOTION=file.json` imports an ASCII Motion animation on launch. `VIVO_JS="expression" VIVO_FOTO=screen.png` runs code in the window and saves a screenshot.

## License and credits

[MIT](LICENSE). Copyright (c) 2026 Nguyễn Văn Nam for Claudie, and Copyright (c) 2026 Luis Roberto for the original Claudinho code it builds on; both notices stay in the license, as MIT requires. Library animations come from the [ascii-magic-art](https://www.ascii-magic.com/ascii) package (MIT). The Claude Agent SDK belongs to Anthropic and follows its terms.

An independent fan project, not affiliated with or endorsed by Anthropic. Claude, Claude Code and Clawd are trademarks of Anthropic.
