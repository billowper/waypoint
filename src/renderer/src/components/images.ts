import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { pathForMarkdown } from './blocks'
import { editorHost } from './host'

// Pasting or dropping pictures into a note: each is saved in the vault's attachments/ folder and
// written in as ![](path relative to the note). Works in the markdown view too.

const pictures = (data: DataTransfer | null): File[] =>
  data ? [...data.files].filter((f) => f.type.startsWith('image/')) : []

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)

/** Clipboard pictures are all called image.png; give them a name that says when */
function nameFor(file: File): string {
  if (file.name && !/^image\.\w+$/i.test(file.name)) return file.name
  const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg').replace(/\+.*/, '') || 'png'
  return `pasted-image-${stamp()}.${ext}`
}

async function insertPictures(view: EditorView, files: File[], at: number | null) {
  const host = view.state.facet(editorHost)
  if (!host) return
  const paths: string[] = []
  for (const file of files) {
    const path = await host.saveImage(file, nameFor(file)).catch(() => null)
    if (path) paths.push(path)
  }
  if (!paths.length) return
  const sel = view.state.selection.main
  const from = at === null ? sel.from : Math.min(at, view.state.doc.length)
  const to = at === null ? sel.to : from
  const insert = paths.map((p) => `![](${pathForMarkdown(p)})`).join('\n')
  view.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.cursor(from + insert.length),
    userEvent: 'input.paste',
    scrollIntoView: true
  })
  view.focus()
}

export const pastePictures = EditorView.domEventHandlers({
  paste(e, view) {
    const files = pictures(e.clipboardData)
    if (!files.length) return false
    e.preventDefault()
    void insertPictures(view, files, null)
    return true
  },
  drop(e, view) {
    const files = pictures(e.dataTransfer)
    if (!files.length) return false
    e.preventDefault()
    e.stopPropagation() // not the app's own file drop
    void insertPictures(view, files, view.posAtCoords({ x: e.clientX, y: e.clientY }))
    return true
  }
})
