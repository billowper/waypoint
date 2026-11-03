# Waypoint — notes for Claude Code

Electron desktop app combining Obsidian (local markdown vault), Notion (nested pages, easy file moves),
Miro (canvas boards) and Jira (tasks/kanban), with git-versioned data and deep Windows 11 integration
(jump list, toast notifications) plus periodic "prods" to work on things. Owner: Bill (Windows 11, UK).

Full phased plan: `docs/build-plan.md`. Keep its Decisions log and phase status up to date.

## How we work
- Build in phases. At the end of each phase: get it running, give Bill a short "try this" checklist,
  **stop and ask for feedback**, iterate on that phase until he's happy, then confirm scope for the next phase.
- Don't jump ahead to later phases unasked.
- Prefer plain files: Markdown + YAML frontmatter for content, small JSON only where Markdown can't work.
  No database as source of truth; the in-memory index is rebuilt from disk.

## Current status
- **Phase 0 done** (2026-10-30): skeleton + live preview + rename. Needs Node ≥20.19 (Bill's PC: Node 26 LTS).
- **Phase 1 built and tested in the app** (2026-10-30): delete/duplicate, drag-drop + "Move to…", [[wiki links]]
  with autocomplete/backlinks/link rewriting on rename+move, Ctrl+P, full-text search, tabs.
  Phases 2–8 then built unattended overnight (2026-10-30); see the review checklist at the end of docs/build-plan.md. **Awaiting Bill’s review of Phases 1–8.**
- **Claude Code connector M1–M5 built** (2026-10-31, 0.10.0): MCP server `src/mcp/` (server.ts read tools, writeTools.ts,
  memoryTools.ts for projects/<slug>/claude/ memory + session logs, common.ts). Reuses src/main vault/projects/tasks/notesIndex/iconMap/relink/bridge — keep those free of Electron imports.
  While the app has a vault open it serves a named pipe (bridge.ts) so the connector can flush editors and relocate via
  the app. M3 UI: src/main/claudeCode.ts + components/ClaudeCode.tsx (prefs.claudeCode hides it all; WAYPOINT_CLAUDE_HOME
  points it at a scratch ~/.claude.json for testing). Claude stays optional: the app must never depend on or call Claude.
  Change log + undo snapshots: src/main/claudeLog.ts (feed + undo in index.ts / ClaudeCode.tsx).
- **Sidebar project reordering** (2026-11-01, 0.10.1): drag project rows; order in `.app/project-order.json`.
- **Send tasks to Claude Code** (2026-11-02, 0.10.2): TaskBar button + `taskMenu` (menus.ts) → `claude:send-task` (index.ts) →
  `taskPrompt`/`openInClaudeTerminal`/`openInClaudeApp` (claudeCode.ts). Only the terminal route auto-starts; claude:// links never send.
- **Ideas replace the inbox** (2026-11-03, 0.12.0): every quick capture is a note in `IDEAS_DIR` (ideas/, `Vault.addIdea`), shown as the Ideas
  sidebar section. `moveCapturesToIdeas` (index.ts) moves notes/Captures and inbox.md there once per vault (`ideasMoved` in .app/settings.json).
  Connector tools: waypoint_add_idea, waypoint_list_ideas.
- **Nested pages, contents pane, back/forward** (2026-11-03, 0.11.0, awaiting Bill's review): a note's sub-pages are the same-named
  folder beside it (Plan.md + Plan/). `src/shared/nesting.ts` `arrange` merges each pair into one row and applies `.app/tree-order.json`
  (src/main/treeOrder.ts); `state.tree` stays what's on disk. `Vault.move/rename/duplicate` carry the folder and `movedPath` follows it, so
  tabs, icons, links and recents need nothing extra. Contents pane: `components/Toc.tsx`, driven from Editor.tsx. Back/forward: window-wide
  `navBack`/`navForward` in store.ts, recorded in `setTabs`.
- **Website** (2026-11-03): static page in `site/`, published to billowper.github.io/waypoint by `.github/workflows/pages.yml` on push. Retake screenshots with `npm run build` then `node site/tools/capture.mjs` (sample vault in `site/tools/demo-vault.mjs`). Update the version in `site/index.html` on release; installers go on GitHub releases (`gh release create vX.Y.Z dist/Waypoint-Setup-X.Y.Z.exe`).
- Then: Phase 2 with Bill's project spec (settings in `project.md` frontmatter — see build plan; confirm the
  YAML shape with him first).
- Windows gotcha: chokidar holds handles on watched folders, so any folder rename/move/delete must run inside
  `withFolderUnlocked` (`src/main/index.ts`), which pauses the watcher.
- Layout gotcha: only panes scroll. Keep `.app { grid-template-rows: minmax(0, 1fr) }`, the `min-height: 0`s,
  and `overflow: clip` on html/body/#root, or long notes stop scrolling and the window gets shifted
  out of reach when the editor scrolls the cursor into view.
- Multi-window: content windows (src/main/windows.ts) each run their own store/tabs. A note/board is only open in
  one window (`claimOpen`); renames/moves/deletes are broadcast (vault:moved/removed) after flushing other
  windows; file events go to every window. Dev builds use AUMID com.billlowe.waypoint.dev (never the real one).
- Renames/moves go through `relocate()` in main (recent list, link rewriting, index rebuild). In the renderer,
  file ops call `flushEditors()` then `enqueue()` so saves never land on a path that just moved.

## Stack and layout
- electron-vite + React 19 + TypeScript, Zustand, CodeMirror 6 (Obsidian-style live preview, `livePreview.ts`), chokidar.
- `src/main` — window (hidden title bar + native Win11 caption overlay), vault file access (`vault.ts`, all
  paths vault-relative and checked so nothing escapes the vault), config in userData (`config.ts`), file watcher,
  in-memory note index for search/backlinks/link rewriting (`notesIndex.ts`, MiniSearch).
- `src/preload` — `window.api` bridge (contextIsolation + sandbox on). Types in `src/shared/types.ts`;
  helpers shared by main and UI in `src/shared/names.ts` and `src/shared/links.ts` (parse/resolve [[links]]).
- `src/renderer/src` — `store.ts` (Zustand: tabs, file ops, save queue, editor hooks), components (Sidebar,
  FileTree, SearchPanel, Editor + livePreview + wikiComplete, Backlinks, TopBar = TabBar + PathBar, Picker,
  Home, Welcome, Prompt, ContextMenu). Open tabs are remembered per vault in localStorage.
- `dev.cmd` — double-click launcher that installs and runs, logging to setup.log / dev.log.

## Commands
- `npm run dev` · `npm run typecheck` · `npm run build` · `npm run dist` (NSIS installer to dist/)
