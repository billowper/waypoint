<p align="center">
  <img src="site/icon.png" width="96" height="96" alt="Waypoint logo: an amber diamond on a dark rounded square">
</p>

<h1 align="center">Waypoint</h1>

<p align="center">
  Notes, projects, docs and tasks in a plain-Markdown, git-friendly vault.<br>
  <a href="https://billowper.github.io/waypoint/">Website</a> · <a href="https://github.com/billowper/waypoint/releases/latest">Download for Windows 11</a>
</p>

<picture>
  <source media="(prefers-color-scheme: light)" srcset="site/img/note-light.webp">
  <img src="site/img/note-dark.webp" alt="Waypoint showing a note with live preview, a contents pane, nested pages in the sidebar and a Linked from panel">
</picture>

## Features

- **Notes:** Markdown with live preview, `[[wiki links]]` with autocomplete, a Linked from panel, and links that update when notes are renamed or moved.
- **Nested pages:** drag a note onto another to make it a sub-page. On disk, sub-pages sit in a folder named after the note.
- **Finding things:** a quick switcher, full-text search, a contents pane, tabs, back and forward, and multiple windows.
- **Projects:** each one keeps its docs, tasks and boards together, with its status, repo, links and bookmarks.
- **Tasks:** a kanban board and sortable list, with priorities, due dates and labels. Each task is a Markdown file.
- **Boards:** Excalidraw canvases, with cards that link back to notes and tasks.
- **Git:** commit, pull and push from the sidebar, history and diffs for any note, and optional auto-commit.
- **Windows 11:** a global quick-capture hotkey that files notes under Ideas, a jump list, a tray icon, notifications, and nudges about overdue work.
- **Your choice of look:** light and dark themes, an accent colour (per project if you like), fonts and interface scale.
- **Backups:** optional daily zip snapshots to a folder you choose.
- **Claude Code (optional):** a local connector lets Claude Code sessions read and update a project's tasks and docs. It can't delete anything, and every change is logged with undo. Waypoint never calls Claude itself, and every feature works without it.

## Your vault

A vault is a normal folder that any text editor or git client can read. Edits made outside the app show up live.

```
ideas/                  quick captures, one note each
notes/                  free-form notes, nested as deep as you like
projects/
  <project>/
    project.md          settings (frontmatter) and overview
    docs/               nested pages
    tasks/              one Markdown file per task
    boards/             .excalidraw canvases
.app/                   icons, ordering and settings
```

## Download

Windows installers are on the [releases page](https://github.com/billowper/waypoint/releases/latest). The installer isn't code-signed yet, so SmartScreen warns you the first time: choose More info, then Run anyway.

## Shortcuts

| Keys | Action |
| --- | --- |
| Ctrl+Alt+W | Quick capture, from any app |
| Ctrl+Alt+F | Quick search, from any app |
| Ctrl+N | New note |
| Ctrl+P | Find or create a note |
| Ctrl+Shift+F | Search all notes |
| Ctrl+F | Find in note |
| Ctrl+Shift+H | Home |
| Ctrl+Shift+O | Contents pane |
| Ctrl+Shift+B | Linked from panel |
| Ctrl+T, Ctrl+W | New tab, close tab |
| Ctrl+Tab | Next tab |
| Alt+Left, Alt+Right | Back, forward |
| F2 | Rename |
| Del | Delete the selected tree item (to the Recycle Bin) |
| Ctrl+, | Settings |

## Build from source

Needs Node.js 20.19+ (22 or 26 LTS recommended).

```powershell
npm install
npm run dev        # launches the app with hot reload
npm run typecheck
npm run dist       # Windows installer in dist/
```

## Project layout

```
src/main       Electron main process: windows, vault file access, file watcher, search index, git, Windows integration
src/preload    Safe bridge exposing window.api to the UI
src/renderer   React UI: CodeMirror editor, sidebar, tabs, task board, canvas
src/shared     Types and helpers used by both sides
src/mcp        The optional Claude Code connector
site           The website. site/tools retakes its screenshots from the real app
```

## Licence

[MIT](LICENSE)
