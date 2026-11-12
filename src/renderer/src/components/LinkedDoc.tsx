import { useCallback, useEffect, useRef, useState } from 'react'
import { Annotation, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { findBar } from './find'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting } from '@codemirror/language'
import type { LinkedDoc } from '@shared/types'
import { baseName } from '@shared/names'
import { resolveLink } from '@shared/links'
import { flushEditors, useStore } from '../store'
import Editor, { decodePath, mdHighlight, theme } from './Editor'
import { linkContext, livePreview, refreshLinks } from './livePreview'
import { editorHost } from './host'
import { frontmatterSyntax } from './frontmatterSyntax'
import Toc, { readHeadings, type Heading } from './Toc'

// Linked docs: a doc whose frontmatter has `source: <file in the project's repo>` shows that file,
// read-only, in place of its own text (src/main/linkedDocs.ts works out and reads the file).
// The Markdown button (Ctrl+Shift+M) shows the doc's own text instead, to change or remove the link.

interface Props {
  tabId: number
  docId: number
  path: string
  active: boolean
}

const projectFile = (path: string) => /^(projects\/[^/]+)\//.exec(path)?.[1] + '/project.md'
const say = (what: string) => (e: unknown) =>
  alert(`${what}\n\n${(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`)

/** A note's tab: the editor, or the linked file when the note is a linked doc */
export default function DocTab(props: Props) {
  const raw = useStore((s) => !!s.rawDocs[props.docId])
  // undefined: not looked at yet (nothing is drawn, so an ordinary note's editor is only made once)
  const [linked, setLinked] = useState<LinkedDoc | null | undefined>(undefined)
  const pathRef = useRef(props.path)
  pathRef.current = props.path
  const alive = useRef(true)
  useEffect(() => () => void (alive.current = false), [])

  const check = useCallback(async () => {
    await flushEditors().catch(() => undefined) // a `source` just typed in the markdown view has to be on disk
    const doc = await window.api.linkedDoc(pathRef.current).catch(() => null)
    if (alive.current) setLinked(doc)
  }, [])

  // On opening, and on coming back from the markdown view (never while typing in the editor)
  useEffect(() => {
    if (!raw) void check()
  }, [raw, props.path, check])

  const showing = !!linked && !raw
  const file = linked?.file
  useEffect(() => {
    if (!showing) return
    const offVault = window.api.onChanged((events) => {
      const mine = [pathRef.current, projectFile(pathRef.current)]
      if (events.some((e) => mine.includes(e.path))) void check() // the link itself, or the project's repo folder
    })
    const offFile = window.api.onLinkedChanged((changed) => {
      if (changed === file) void check()
    })
    return () => {
      offVault()
      offFile()
    }
  }, [showing, file, check])

  if (showing) return <LinkedView doc={linked} path={props.path} docId={props.docId} active={props.active} />
  if (linked === undefined && !raw) return <div className="doc" hidden={!props.active} />
  return <Editor {...props} />
}

/** Marks the one change the read-only view lets through: the file's text arriving from disk */
const fromDisk = Annotation.define<boolean>()

/** A path written in the file, as a full path: beside the file, or from the repo's top for a leading slash */
function beside(doc: LinkedDoc, written: string): string {
  const parts = (written.startsWith('/') ? doc.root : doc.file.replace(/[\\/][^\\/]*$/, '')).split(/[\\/]+/)
  for (const s of written.split(/[\\/]+/)) {
    if (s === '..') parts.pop()
    else if (s && s !== '.') parts.push(s)
  }
  return parts.join('/')
}

const when = (ms: number) =>
  new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function LinkedView({ doc, path, docId, active }: { doc: LinkedDoc; path: string; docId: number; active: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const docRef = useRef(doc)
  docRef.current = doc
  const pathRef = useRef(path)
  pathRef.current = path
  const tocOpen = useStore((s) => s.tocOpen)
  const toggleRaw = useStore((s) => s.toggleRaw)
  const [headings, setHeadings] = useState<Heading[]>([])
  const [scrolledTo, setScrolledTo] = useState(0)

  useEffect(() => {
    const store = useStore.getState
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: '',
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          // Nothing in the page (a ticked checkbox, say) may change what's shown: it's the file, as it is on disk
          EditorState.changeFilter.of((tr) => tr.annotation(fromDisk) === true),
          EditorView.contentAttributes.of({ tabindex: '0' }), // so Ctrl+F and Ctrl+A work in here
          highlightSelectionMatches(),
          findBar,
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [frontmatterSyntax] }),
          syntaxHighlighting(mdHighlight),
          linkContext.of({
            notes: () => store().notes,
            from: () => pathRef.current,
            open: (target, newTab) => {
              const found = resolveLink(target, pathRef.current, store().notes)
              if (found) void store().openFile(found, { newTab })
            },
            // Relative links lead to other files in the repo
            openUrl: (url) => void window.api.linkedAct(pathRef.current, 'link', url).catch(say("Couldn't follow that link."))
          }),
          editorHost.of({
            ask: (title, opts) => store().ask(title, opts),
            menu: (x, y, items) => store().openMenu({ x, y, items }),
            saveImage: async () => null,
            pickImage: async () => null,
            embedSrc: () => null,
            // Pictures come from beside the file, not from the vault
            imageSrc: (p) =>
              /^(https?|data|blob|wp-file):/i.test(p) ? p : `wp-file://x/${encodeURIComponent(beside(docRef.current, decodePath(p)))}`
          }),
          livePreview,
          theme,
          keymap.of(searchKeymap)
        ]
      })
    })
    viewRef.current = view
    const onScroll = () => {
      if (store().tocOpen) setScrolledTo(view.lineBlockAtHeight(view.scrollDOM.scrollTop - view.documentPadding.top + 32).from)
    }
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true })
    const off = useStore.subscribe((s, prev) => {
      if (s.notes !== prev.notes) view.dispatch({ effects: refreshLinks.of(null) })
    })
    return () => {
      off()
      view.destroy()
      viewRef.current = null
    }
  }, [])

  // The file's text, again whenever it changes on disk (keeping your place)
  const text = doc.content ?? ''
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (view.state.doc.toString() !== text) {
      const top = view.scrollDOM.scrollTop
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, annotations: fromDisk.of(true) })
      requestAnimationFrame(() => (view.scrollDOM.scrollTop = top))
    }
    view.requestMeasure() // it may have been hidden until now (a missing file that has just turned up)
    if (tocOpen) setHeadings(readHeadings(view.state, baseName(pathRef.current)))
  }, [text, tocOpen])

  useEffect(() => {
    if (active) viewRef.current?.requestMeasure()
  }, [active])

  const jumpTo = (pos: number) => {
    setScrolledTo(pos)
    viewRef.current?.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 24 }) })
  }
  const act = (action: 'open' | 'code' | 'reveal', what: string) => () => void window.api.linkedAct(path, action).catch(say(what))
  const shown = doc.content !== null

  return (
    <div className="doc" hidden={!active}>
      {tocOpen && shown && <Toc headings={headings} scrolledTo={scrolledTo} onJump={jumpTo} />}
      <div className="linked">
        <div className="linked-head">
          <span className="linked-badge" title="This doc shows a file from the project's repository. It's read-only here: edit the file itself.">
            Linked file
          </span>
          <span className="linked-path" title={doc.file || doc.source}>
            {doc.source}
          </span>
          {shown && <span className="linked-when">Changed {when(doc.modified)}</span>}
          <button className="btn small" disabled={!shown} title="Open the file in the program that edits markdown on this PC" onClick={act('open', "Couldn't open the file.")}>
            Open in editor
          </button>
          <button className="btn small" disabled={!shown} onClick={act('code', "Couldn't open VS Code.")}>
            VS Code
          </button>
          <button className="btn small" disabled={!doc.file} onClick={act('reveal', "Couldn't show it in Explorer.")}>
            Show in Explorer
          </button>
          <button
            className="btn small"
            title="Show this doc's own text, where `source` names the file to show (Ctrl+Shift+M)"
            onClick={() => toggleRaw(docId)}
          >
            Change link
          </button>
        </div>
        {doc.note && <div className="linked-note">{doc.note}</div>}
        {!shown && (
          <div className="linked-problem">
            <strong>There's nothing to show for this linked doc.</strong>
            <p>{doc.problem}</p>
            <p className="dim">
              It links to <code>{doc.source}</code>. Change link (or Ctrl+Shift+M) shows the doc's own text, where you can fix or remove that.
            </p>
          </div>
        )}
        <div className="editor" ref={host} hidden={!shown} />
      </div>
    </div>
  )
}
