# Build Plan — Waypoint (Project & Notes Desktop App)

Electron desktop app blending Obsidian (local markdown vault), Notion (nested pages, easy file ops), Miro (canvas boards) and Jira (tasks/boards), with git-backed data and Windows 11 integration.

## Guiding principles
- **Plain files first.** Everything lives in a normal folder ("vault"): Markdown with YAML frontmatter for notes, docs and tasks; small JSON files only where Markdown can't work (canvas boards, app settings). Any text editor and any git client can read it.
- **Fast.** No database as source of truth — an in-memory index rebuilt from disk, kept fresh with a file watcher. Cache is disposable and git-ignored.
- **Small phases, each one usable.** Every phase ends with a build you run, a short checklist of things to try, and a feedback round before moving on. Priorities can be reshuffled at any checkpoint.

## Stack
- Electron + Vite + TypeScript (electron-vite), React, Zustand
- Markdown editor: CodeMirror 6, Obsidian-style live preview (syntax hidden except on the line being edited)
- File watching: chokidar · Search: MiniSearch (in-memory full text)
- Git: simple-git (uses the installed git, so credentials just work)
- Canvas: Excalidraw (MIT, stores as JSON)
- Packaging: electron-builder → Windows NSIS installer

## Vault layout
```
vault/
  .app/                      settings.json, icons.json, project-order.json (committed), cache/ (git-ignored)
  notes/                     free-form notes, nest as deep as you like
  projects/
    <project-slug>/
      project.md             frontmatter = the project's settings (see Phase 2); body = overview
      docs/                  nested markdown pages (older projects: wiki/)
      tasks/                 TASK-001.md … (frontmatter: status, priority, due, assignee)
      boards/                *.excalidraw canvas files
  ideas/                     quick captures, one note each
```

## Phases

### Phase 0 — Skeleton — DONE (2026-10-30)
- App window, choose/create a vault folder, remember it
- Sidebar file tree of the vault; open a markdown file, edit, autosave
- Placeholder Home page and basic layout (sidebar · main pane · top bar)
- Dev run + first Windows build
- Round 2 (from Bill's feedback): live preview editor; rename notes/folders (F2, right-click menu,
  click the title in the top bar); a note's file name follows its `# title` while they match
- **Checkpoint:** does the shell feel right — layout, speed, editor feel?

### Phase 1 — Notes & file operations — BUILT, awaiting feedback
- Delete (to Recycle Bin, with confirm) / duplicate ("<name> copy") (rename landed in Phase 0)
- Drag-and-drop move and nest in the tree (folders auto-open on hover; empty space = vault root);
  "Move to…" folder picker. Copy = Duplicate then move.
- `[[wiki links]]` by note name (path only when names clash), `[[` autocomplete, click to follow,
  click a missing link to create it; "Linked from" backlinks panel (Ctrl+Shift+B); links in other
  notes are rewritten when a note or folder is renamed or moved
- Quick switcher (Ctrl+P: find or create), full-text search (Ctrl+Shift+F, MiniSearch in main),
  Obsidian-style tabs (click replaces, Ctrl/middle-click = new tab), restored on relaunch
- **Checkpoint:** file handling vs Notion/Obsidian expectations

### Phase 2 — Projects, docs, resources, Home — BUILT (unattended), awaiting review
- Projects are a first-class type: "Create project" makes `projects/<slug>/project.md` with
  default folders; sidebar/Home list projects, not just folders
- `project.md` frontmatter holds the project's settings, edited through a form in the app
  (any editor can still change the YAML). Draft shape, to confirm at the start of Phase 2:
  ```yaml
  status: active            # idea | active | paused | done
  tags: [client, web]
  created: 2026-10-30
  repo:                     # the project's code repository (separate from the vault's own git)
    path: C:\Users\me\source\repos\example   # open in Explorer / VS Code / Fork
    remote: https://github.com/me/example     # open in browser
  links:                    # remote links, open in the default browser
    - { title: Staging, url: https://staging.example.com }
  bookmarks:                # local files/folders: open, or reveal in Explorer
    - { title: Designs, path: D:\Work\example\designs }
  ```
- Project overview page: settings form + rendered overview + quick actions (open repo, links)
- Project docs (nested pages; renamed from "wiki" at Bill's request)
- Home/overview dashboard: active projects, recent notes, upcoming tasks
- **Checkpoint:** is the project structure right before tasks build on it?

### Phase 3 — Tasks (Jira-lite) — BUILT (unattended), awaiting review
- Tasks as markdown files with frontmatter; IDs per project
- Kanban board (drag between statuses) and sortable list view
- Priorities, due dates, labels, links to notes/docs
- Cross-project "My work" view on Home
- **Checkpoint:** workflow states and fields actually wanted

### Phase 4 — Git integration — BUILT (unattended), awaiting review
- Init/attach repo for the vault; status indicator
- Commit (with message), pull, push; optional auto-commit on interval
- File history and diff view; conflict notice
- **Checkpoint:** manual vs automatic syncing preference

### Phase 5 — Windows 11 integration — BUILT (unattended), awaiting review
- Jump list: recent projects/notes, "New note", "Quick capture", "Open Home"
- Native toast notifications with action buttons
- Tray icon, start with Windows (optional), global quick-capture hotkey
- **Checkpoint:** what belongs in the jump list and tray

### Phase 6 — Prodding / nudges — BUILT (unattended), awaiting review
- Nudge engine: overdue/due-soon tasks, stale projects, "pick one thing" prompts
- Configurable schedule, quiet hours, snooze, "don't nag about this"
- Notification clicks deep-link into the right task/project
- **Checkpoint:** tune frequency and tone so it helps without annoying

### Phase 7 — Canvas boards (Miro-like) — BUILT (unattended), awaiting review
- Excalidraw boards per project
- Drop notes/tasks onto a board as linked cards
- **Checkpoint:** how much whiteboard is needed

### Phase 8 — Polish & release — BUILT (unattended), awaiting review
- Themes (light/dark), keyboard shortcut map, settings page
- Performance pass on large vaults
- Installer, auto-update, backups

### Claude Code connector (MCP) — M1–M5 BUILT (0.10.0), awaiting feedback
A local MCP server bundled with Waypoint (runs via Waypoint.exe in node mode, no Node install, no hosting) that
works directly on the vault, so Claude Code sessions in a project's repo can read and keep its tasks and docs up to date.
- **M1 Read-only:** list/get projects, list/get tasks, read/list/search notes, inbox; current project = the session's
  folder matched against project repo paths. Checkpoint: ask Claude "what's open on this project?"
- **M2 Write:** create/update tasks, create/edit/append notes, inbox, project settings, rename/move with link updates;
  never deletes; every change logged. Checkpoint: Claude moves a task and the board updates live
- **M3 Connect:** "Connect to Claude Code" on the project page (registers the server for the Code tab and terminal,
  writes an uncommitted CLAUDE.local.md naming the project + standing instructions); "Open in Claude Code"
- **M4 Memory + session logs:** per-project claude/ notes Claude reads and keeps; dated session entries
- **M5 Visibility:** "Changed by Claude" feed on the project page and Home; undo from the feed
- **Send to Claude Code (0.10.2), awaiting feedback:** a button on the open task and a right-click item on tasks
  (board, Home, project page) start a new session on that task in the project's repo

## Feedback loop at every checkpoint
1. Deliver the build + a 5-minute "try this" checklist
2. Bill reports what feels off, what's missing, what to drop
3. Iterate on that phase until he's happy, then re-confirm the next phase's scope

## Decisions log
- 2026-10-30: Code lives at C:\Users\me\source\repos\waypoint
- 2026-10-30: Obsidian-style CodeMirror editor; React + TypeScript; phase order as written
- 2026-10-30: Working name "Waypoint" (easy to rename)
- 2026-10-30: Native Win11 title bar buttons (hidden title bar + overlay), dark theme first
- 2026-10-30: Development moved to Claude Code running locally on Bill's PC
- 2026-10-30: Node upgraded 20.11 → 26 LTS (Vite 7 / electron-vite 4 need ≥20.19); Electron 37 (EOL) → 45
- 2026-10-30: Editor switched to live preview (Bill: raw markdown felt unfinished)
- 2026-10-30: Rename pulled forward into Phase 0; note file name tracks its `# title` while they match
- 2026-10-30: Project settings live in `project.md` frontmatter (one file; replaces separate resources.md);
  includes the project's own git repo (local path + remote) alongside links and bookmarks
- 2026-10-30: Top-level `projects/` folder can't be renamed from the app (the project model relies on it)
- 2026-10-30: Phase 0 signed off. Phase 1 scope: all four areas (file ops, wiki links, Ctrl+P + search, tabs)
- 2026-10-30: Wiki links by note name, Obsidian-compatible; shortest unique path when names clash;
  nearest note wins a tie. A missing link's note is created next to the linking note
- 2026-10-30: Tabs behave like Obsidian; a note is only ever open in one tab (opening it again switches)
- 2026-10-30: Links on a rendered line follow on plain click; on the line being edited, Ctrl+click
- 2026-10-30: Packaged app has no application menu (its Ctrl+R/Ctrl+W accelerators fought the app's)
- 2026-10-30: Bill (going to sleep): build Phases 2–8 unattended, stopping only at a genuine blocker, with
  a checklist per phase for him to review afterwards. Code goes under local git, one commit per phase,
  never pushed. Testing uses a scratch vault only, never W:\wpvault.
- 2026-10-30: Tasks: Backlog → To do → Doing → Done; IDs prefixed per project (e.g. WEB-001); priority,
  due date, labels
- 2026-10-30: Vault git: manual commit/pull/push + status; optional auto-commit every 15 min, off by
  default; push only when the vault already has a remote
- 2026-10-30: Nudges show inside the app when its window is in front, else as a Windows toast. Toasts only
  appear in the installed app (Windows drops them for apps without a Start-menu entry, e.g. dev builds)
- 2026-10-30: Closing the window keeps Waypoint in the tray (setting, on by default) so hotkey + nudges work
- 2026-10-30: Boards are .excalidraw JSON files (Excalidraw 0.18, lazy-loaded, fonts served locally); note/task
  cards link back with waypoint://open/<path>. Vulnerable Excalidraw sub-deps pinned via npm overrides
- 2026-10-30: Defaults chosen by Claude (Bill to veto at review): project YAML as drafted in Phase 2;
  quick-capture hotkey Ctrl+Alt+W (Ctrl+Alt+Space was already taken on Bill's PC); start-with-Windows off by default; nudges at most every 2 h,
  weekdays 09:00–18:00, snoozable; canvas = Excalidraw; Phase 8 adds light theme + settings page +
  vault zip backups, skips auto-update (needs a release server)
- 2026-10-30: Phase 8: light/system theme, Settings page (Windows, nudges, backups, shortcuts), daily zip backups
  via Windows tar (no .git), lighter refresh on autosave, NSIS installer dist/Waypoint-Setup-0.0.1.exe.
  Auto-update skipped (needs a release server).
- 2026-11-03: Inbox and Captures combined into Ideas: every quick capture is a new note in ideas/, named after its first
  line, with no option to append to a single file. inbox.md is gone; on opening a vault, an old notes/Captures moves to
  ideas/, and an old inbox.md moves there as one note if it has content (an empty one goes to the Recycle Bin).
  Connector tools became add_idea and list_ideas.

## Review checklist for Bill (all unattended phases)
1. Install dist/Waypoint-Setup-0.0.1.exe (unsigned, so SmartScreen warns: More info → Run anyway).
2. Projects: sidebar + → create; set status, tags, repo path (Open in VS Code), links, bookmarks.
3. Tasks: Open board → add tasks, drag between columns, click a card → properties bar; Home → My work.
4. Git: sidebar Git → Start versioning → edit → Commit; ⟲ on a note shows history and diffs.
5. Windows: Ctrl+Alt+W quick capture → new note under Ideas; right-click the taskbar icon for the jump list; tray ◆ menu; closing keeps it in the tray.
6. Nudges: Settings → Nudge me now (in-app banner when focused, toast otherwise); Don't nag / Snooze.
7. Boards: project page → New board → Add note or task card → click its link icon.
8. Settings: theme Light/System; Backups → choose folder → Back up now.
- 2026-10-30: Icons for every content type live in .app/icons.json (path → emoji or img:<file>), pictures in
  .app/icons/ (copied from a file or downloaded once from a URL), served via wp-icon://; picking uses Windows' emoji
  panel (app.showEmojiPanel). Icons follow renames/moves and are dropped on delete
- 2026-10-31: Claude Code integration via a local MCP server (M1–M5 above). Local sessions only (no cloud). Claude may
  write tasks/docs/settings but never deletes. Bill uses the desktop app's Code tab mostly; terminal should work too.
  Costs nothing extra beyond normal Claude usage (tool lists/results are a little context per session)
- 2026-10-31: M1 server is src/mcp/server.ts, built to out/main/mcp.js and run as `Waypoint.exe <app.asar>/out/main/mcp.js`
  with ELECTRON_RUN_AS_NODE=1 over stdio. Vault from --vault, WAYPOINT_VAULT, else the app's config.json. Registered by
  hand with `claude mcp add` until M3 adds the button
- 2026-10-31: Claude is an optional add-on, never a dependency (Bill): Waypoint never calls Claude, every feature works
  without it, and there is no in-app "Ask Claude". The connector is a separate script Claude Code starts; the app only
  answers a local pipe (src/main/bridge.ts) that nothing else uses
- 2026-10-31: M2 write tools: create/update tasks (status, fields, dated progress notes), create/edit (exact replacements,
  all-or-nothing)/append (optionally under a heading)/rewrite notes, inbox, create/update projects, rename/move with link
  and icon updates. No delete tool; .app/, dot-folders and the vault layout (projects/, notes/, inbox.md, project.md,
  tasks/) are refused. Every change appended to .app/claude-log.jsonl (for the M5 feed). With the app open, the connector
  saves open editors first and asks the app to do renames/moves (tabs follow; no watcher lock on folders)
- 2026-10-31: M3: project page "Claude Code" card (Connect to Claude Code / Refresh instructions / Open in Claude / Open in
  terminal) and Settings → Claude Code (optional): show/hide every Claude control, Connect/Disconnect. Connecting runs
  `claude mcp add-json <name> --scope user` (works for the desktop Code tab and the terminal; dev builds register as
  waypoint-dev). Instructions go in a Waypoint-managed section of the repo's CLAUDE.local.md (rest of the file kept),
  listed in .git/info/exclude so it's never committed. "Open in Claude" uses the documented claude://code/new?folder=&q=
  link; "Open in terminal" runs claude in Windows Terminal at the repo. No Claude Code installed = a note, nothing breaks
- 2026-10-31: M4: Claude's notes per project live in projects/<slug>/claude/ (plain notes, created only when Claude first
  writes): Memory.md (waypoint_remember files one point under a heading: Conventions, Decisions, Gotchas, Notes…) and
  sessions/YYYY-MM-DD.md (waypoint_log_session: "## HH:MM · title" with summary, Done, Next, Tasks; local time).
  waypoint_overview includes the memory (first 3000 chars) and the last session; waypoint_read_memory gives more.
  The Claude Code card lists Memory and the 5 newest session logs; claude/ is left out of the page's Docs/Other notes
- 2026-10-31: M5: "Changed by Claude" feed (project page: that project's changes; Home: all, with project names), newest
  first, Undo per change. Undo doesn't rely on the vault's git (it may have no commit between changes): the connector
  keeps each edited file's old text in .app/cache/claude-undo/<id>.md for 30 days. Undo restores it (warning first if
  the file changed since), renames/moves back (links follow), or offers to bin something Claude created (Bill's own
  delete, with the usual confirm). Undos are appended to the log as { undoes: id }; the log itself is never rewritten
- 2026-11-01: Projects can be reordered by dragging them in the sidebar. The order is a list of slugs in
  .app/project-order.json (its own file, so saving settings.json can't clobber it; committed with the vault). Projects
  not in it go after, alphabetically; finished projects still sit at the bottom. Renaming a project folder keeps its place
- 2026-11-02: Send a task to Claude Code (Bill; default route is the terminal, switchable in Settings → Claude Code, prefs.claudeSendTo; the other route stays on the right-click menu): "Send to Claude" on the task bar and "Send to Claude Code" / "Send to Claude
  app" on task menus. The terminal route runs `claude "<prompt>"` in the repo, so work starts straight away. The Claude app
  route uses claude://code/new, which by design only pre-fills: Bill confirms the folder and presses Enter. The prompt names
  the task and has Claude read it with waypoint_get_task; it's reduced to plain characters because it passes through command
  lines. Not set up yet = one dialog offering to connect and write CLAUDE.local.md first. Claude moves the task to Doing itself
- 2026-11-02: Fixed "Open in terminal": wt.exe is a Store app alias that existsSync can't see, so it always fell back to a
  console window, and Node's escaping of start's quoted title stopped that running claude. Now found with where.exe; the
  fallback uses verbatim arguments
- 2026-11-03: Notion-style nesting on plain files (Bill asked for dragging notes into notes and reordering). A note's sub-pages live
  in a folder of the same name beside it (Plan.md + Plan/), which the sidebar draws as one row; the note itself doesn't move, so
  nesting changes no links to it. An existing note and folder with the same name therefore become one row. The pair moves, renames,
  duplicates and deletes together; a folder left empty is removed. Folders the layout depends on (notes, projects, a project's docs,
  wiki, tasks, boards, claude) never pair up, and tasks, the inbox and project.md can't take sub-pages. Dropping on a row's top or
  bottom quarter places it between rows, the middle puts it inside. Order is in .app/tree-order.json (folder → names; own file like
  project-order.json, committed with the vault); anything not listed goes after, folders first, then by name. Docs/tasks/boards stay
  pinned at the top of a project
- 2026-11-03: Contents pane on the left of the note (☰ on the path bar, Ctrl+Shift+O; open or closed is remembered per PC). Headings come
  from the parsed document, so "# " in code or frontmatter doesn't count; the title line matching the file name is left out
- 2026-11-03: Back/forward (arrows on the tab bar, Alt+Left/Right, mouse side buttons). One history per window, not per tab, so following
  a link to a note already open in another tab can still go back; closed notes reopen, deleted ones are skipped. Not kept between launches
- 2026-11-03: One-page website in site/ (static: index.html, img/, no build step). Colours follow the app; the viewer's light or dark setting picks
  matching screenshots. Each section is labelled with the path where that feature keeps its files. Screenshots come from the real app and a made-up
  vault: after UI changes, npm run build, then node site/tools/capture.mjs (throwaway vault and app profile; the real vault and settings aren't touched).
  The download button opens the latest GitHub release
- 2026-11-03: Source made public at github.com/billowper/waypoint (Bill's choice, over a releases-only repo). Installers are GitHub releases, tagged vX.Y.Z,
  with only the .exe attached (no auto-update, so no blockmap or latest.yml). The earlier "never pushed" rule no longer applies. No licence chosen yet
