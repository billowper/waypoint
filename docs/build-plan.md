# Build Plan — Waypoint (Project & Notes Desktop App)

Electron desktop app blending Obsidian (local markdown vault), Notion (nested pages, easy file ops), Miro (canvas boards) and Jira (tasks/boards), with git-backed data and Windows 11 integration.

## Guiding principles
- **Plain files first.** Everything lives in a normal folder ("vault"): Markdown with YAML frontmatter for notes, wikis and tasks; small JSON files only where Markdown can't work (canvas boards, app settings). Any text editor and any git client can read it.
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
  .app/                      settings.json (committed), cache/ (git-ignored)
  notes/                     free-form notes, nest as deep as you like
  projects/
    <project-slug>/
      project.md             frontmatter = the project's settings (see Phase 2); body = overview
      wiki/                  nested markdown pages
      tasks/                 TASK-001.md … (frontmatter: status, priority, due, assignee)
      boards/                *.excalidraw canvas files
  inbox.md                   quick-capture target
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

### Phase 2 — Projects, wikis, resources, Home — BUILT (unattended), awaiting review
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
- Project wiki (nested pages)
- Home/overview dashboard: active projects, recent notes, upcoming tasks
- **Checkpoint:** is the project structure right before tasks build on it?

### Phase 3 — Tasks (Jira-lite)
- Tasks as markdown files with frontmatter; IDs per project
- Kanban board (drag between statuses) and sortable list view
- Priorities, due dates, labels, links to notes/wiki pages
- Cross-project "My work" view on Home
- **Checkpoint:** workflow states and fields actually wanted

### Phase 4 — Git integration
- Init/attach repo for the vault; status indicator
- Commit (with message), pull, push; optional auto-commit on interval
- File history and diff view; conflict notice
- **Checkpoint:** manual vs automatic syncing preference

### Phase 5 — Windows 11 integration
- Jump list: recent projects/notes, "New note", "Quick capture", "Open Home"
- Native toast notifications with action buttons
- Tray icon, start with Windows (optional), global quick-capture hotkey
- **Checkpoint:** what belongs in the jump list and tray

### Phase 6 — Prodding / nudges
- Nudge engine: overdue/due-soon tasks, stale projects, "pick one thing" prompts
- Configurable schedule, quiet hours, snooze, "don't nag about this"
- Notification clicks deep-link into the right task/project
- **Checkpoint:** tune frequency and tone so it helps without annoying

### Phase 7 — Canvas boards (Miro-like)
- Excalidraw boards per project
- Drop notes/tasks onto a board as linked cards
- **Checkpoint:** how much whiteboard is needed

### Phase 8 — Polish & release
- Themes (light/dark), keyboard shortcut map, settings page
- Performance pass on large vaults
- Installer, auto-update, backups

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
- 2026-10-30: Defaults chosen by Claude (Bill to veto at review): project YAML as drafted in Phase 2;
  quick-capture hotkey Ctrl+Alt+Space; start-with-Windows off by default; nudges at most every 2 h,
  weekdays 09:00–18:00, snoozable; canvas = Excalidraw; Phase 8 adds light theme + settings page +
  vault zip backups, skips auto-update (needs a release server)
