# Miro board importer (parked plan)

Status: **approved but parked by Bill on 2026-11-02. Nothing is built.** Check the paths and line references against the code before picking this up.

## Context
Waypoint's boards are Excalidraw files, and Bill wants to bring existing Miro boards across as editable boards.
Miro has no usable file export: `.rtb` backups have encrypted contents, and the JSON Board Export API is Enterprise-only.
So the importer reads a board through Miro's REST API v2 using a token Bill creates once.

Agreed scope:
- API token route.
- One board at a time, by pasted link, into the current project's `boards/` folder.
- Canvas only: stickies stay stickies, with no task conversion.
- One-off copy: re-importing makes a new board, with no sync back to Miro.

## Flow
1. Project page, Boards card: new **Import from Miro** button, next to New board. Also add it to the project and folder context menus next to "New board".
2. If no token is saved, prompt for one, with a short note on creating it in Miro (needs `boards:read`).
3. Prompt for the board link and parse the board ID from `miro.com/app/board/<id>/`.
4. Fetch, convert and create the board, then open it with a summary of what was imported and skipped, e.g. "Imported 212 items, skipped 3 (2 tables, 1 embed)".

## Design

### Main process: `src/main/miro.ts` (new)
- `fetchBoard(link)`: board name, `GET /v2/boards/{id}/items` (cursor paging, `limit=50`), `GET /v2/boards/{id}/connectors`.
- Downloads image items and returns them as data URLs, since Excalidraw embeds images in the file. Limited concurrency.
- Uses `net.fetch`, as `src/main/icons.ts` does. Retries on 429 with backoff. Clear messages for 401 (bad token), 403/404 (no access or wrong link).
- Token: encrypted with Electron `safeStorage`, stored as `miroToken` in `AppConfig` (`src/main/config.ts`). It never goes in the vault (git-versioned) or in `Prefs`, and never returns to the renderer. If `safeStorage` is unavailable, fail with a message rather than store it in plain text.
- IPC in `src/main/index.ts` next to `boards:create`: `miro:has-token`, `miro:set-token`, `miro:clear-token`, `miro:fetch`. Expose them in `src/preload/index.ts`; add types to `src/shared/types.ts`.
- Only Miro's API host and the image URLs it returns are fetched; the link is reduced to a board ID, not used as a URL. Only send the token to `api.miro.com`, never to the signed image URLs.

### Conversion: `src/renderer/src/miroConvert.ts` (new)
Pure function from Miro items to Excalidraw skeletons, then `convertToExcalidrawElements` (already used in `Canvas.tsx`), which needs the renderer for text measuring. Load it with a dynamic `import()` so Excalidraw stays lazy-loaded.

| Miro | Excalidraw |
|---|---|
| `sticky_note` | filled rectangle with label, nearest colour from Excalidraw's palette |
| `shape` | rectangle / ellipse / diamond; other shapes become rectangles |
| `text` | text |
| `frame` | frame with its children |
| `image` | image, with entry in `files` |
| `card`, `app_card` | rectangle with title and description |
| `embed`, `document` | rectangle with the title and a `link` |
| connector | arrow bound to its start and end items, with caption as label |
| anything else | skipped and counted in the summary |

Conversion details:
- Miro's `x`/`y` are item centres, Excalidraw's are top-left corners, so offset by half the size.
- Items inside a frame are positioned relative to the frame, so resolve via `parent.id` to absolute coordinates.
- Rotation: degrees to radians.
- Text is HTML: convert `<p>`/`<br>` to newlines, strip other tags and decode entities using `DOMParser`, never `innerHTML` on the live page.
- Excalidraw's dark theme inverts the canvas, so stick to its own palette, as `addCard` does.

### Store: `importMiro(dir)` in `src/renderer/src/store.ts`
Modelled on `createBoard`: uses `get().ask` for the prompts, `window.api.createBoard(dir, name)` for a unique file name, writes the JSON with `serializeAsJSON` via `enqueue`, then `refresh()` and `openCanvas(path)`. Show progress, since a large board with images can take a while.

### Settings
Small **Miro** card in `src/renderer/src/components/Settings.tsx`: shows whether a token is saved, with Replace and Remove.

### Docs
Bump the version. Update `docs/build-plan.md` (Decisions log) and `CLAUDE.md` status.

## Known limits
- Tables and mind maps may not come through the API; they appear in the skipped count. Confirm against a real board.
- Hand-drawn pen strokes may not be exposed either. Same check.
- Excalidraw has a fixed set of fonts and colours, so boards will look close but not identical.
- Image-heavy boards make large `.excalidraw` files in git, because images are embedded as base64.

## Assumptions to confirm while building
Miro's docs site redirected in a loop when fetched, so these come from search snippets and memory and need checking against live responses:
- The image download format on `imageUrl` (`format=original`, `redirect=false`).
- Parent-relative coordinates for framed items.
- The exact connector response shape.
- How `convertToExcalidrawElements` handles frame bounds and arrow bindings to existing IDs (`regenerateIds: false`); check against the installed Excalidraw 0.18.

## Verification
1. `npm run typecheck` and `npm run build`.
2. `npm run dev`, and in the dev build: save a token, import a real test board from Bill containing every item type, including framed and rotated items, images and connectors.
3. Check positions against Miro side by side, arrows stay attached when a shape is dragged, and images show.
4. Close and reopen the board to confirm it saved; edit and confirm autosave.
5. Errors: bad token, a link to a board without access, a non-Miro link.
6. Confirm the token is absent from the vault and from `config.json` in plain text.
7. Give Bill a short "try this" checklist and stop for feedback, per CLAUDE.md.
