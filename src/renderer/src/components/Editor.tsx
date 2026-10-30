import { useEffect, useRef } from 'react'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, keymap, drawSelection, highlightActiveLine, placeholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { completionKeymap } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { baseName, movedPath, sanitize, titleOf } from '@shared/names'
import { resolveLink } from '@shared/links'
import { enqueue, registerEditor, useStore, type Reveal, type SaveState } from '../store'
import { linkContext, livePreview, refreshLinks } from './livePreview'
import { wikiComplete } from './wikiComplete'

const SAVE_DELAY = 400
/** How long the # title has to sit still before the file is renamed to match it */
const TITLE_RENAME_DELAY = 1200

// Obsidian-ish: markdown stays visible but is styled so the document reads like a page
const mdHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.75em', fontWeight: '700', color: 'var(--text-strong)' },
  { tag: t.heading2, fontSize: '1.4em', fontWeight: '650', color: 'var(--text-strong)' },
  { tag: t.heading3, fontSize: '1.18em', fontWeight: '600', color: 'var(--text-strong)' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '600', color: 'var(--text-strong)' },
  { tag: t.strong, fontWeight: '700', color: 'var(--text-strong)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--text-dim)' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--text-dim)' },
  { tag: t.monospace, fontFamily: 'var(--mono)', color: 'var(--code)' },
  { tag: t.quote, color: 'var(--text-dim)', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--text-faint)' },
  { tag: [t.keyword, t.tagName], color: '#d8a0f0' },
  { tag: [t.string, t.attributeValue], color: '#a6d189' },
  { tag: [t.number, t.bool, t.atom], color: '#ef9f76' },
  { tag: t.comment, color: 'var(--text-faint)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.propertyName], color: '#8caaee' }
])

const theme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--text)' },
    '.cm-scroller': { fontFamily: 'var(--sans)', lineHeight: '1.7', overflow: 'auto' },
    '.cm-content': {
      maxWidth: '760px',
      margin: '0 auto',
      padding: '40px 48px 40vh',
      caretColor: 'var(--accent)'
    },
    '.cm-line': { padding: '0' },
    '&.cm-focused': { outline: 'none' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'var(--selection) !important'
    },
    '.cm-selectionMatch': { backgroundColor: 'rgba(230, 170, 80, 0.12)' },
    '.cm-placeholder': { color: 'var(--text-faint)' },
    '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--text)', borderColor: 'var(--border)' },
    '.cm-searchMatch': { backgroundColor: 'rgba(230, 170, 80, 0.25)' },
    '.cm-tooltip': {
      backgroundColor: 'var(--panel)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5)',
      overflow: 'hidden'
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--sans)', maxHeight: '16em' },
    '.cm-tooltip-autocomplete > ul > li': { padding: '4px 10px !important' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--active)',
      color: 'var(--text-strong)'
    },
    '.cm-completionDetail': { color: 'var(--text-faint)', fontStyle: 'normal', marginLeft: '10px' },
    '.cm-completionMatchedText': { textDecoration: 'none', color: 'var(--accent)' }
  },
  { dark: true }
)

interface Props {
  tabId: number
  path: string
  active: boolean
}

export default function Editor({ tabId, path, active }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // The file can be renamed while it's open; the editor keeps going under the new path
  const pathRef = useRef(path)
  pathRef.current = path
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    const store = useStore.getState
    const setSaveState = (s: SaveState) => store().setSaveState(tabId, s)
    let view: EditorView | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let titleTimer: ReturnType<typeof setTimeout> | null = null
    let lastSaved = ''
    let disposed = false
    let deleted = false // moved to the Recycle Bin: never write it back
    // While a note's file name matches its "# Title", editing the title renames the file
    let follow = false
    let renamingSelf = false

    const wantedName = (text: string) => {
      const title = titleOf(text)
      return title ? sanitize(title) : ''
    }
    const inSync = (text: string) => wantedName(text) === baseName(pathRef.current)

    const followTitle = async () => {
      if (titleTimer) clearTimeout(titleTimer)
      titleTimer = null
      const name = view ? wantedName(view.state.doc.toString()) : ''
      if (!follow || deleted || !name || name === baseName(pathRef.current)) return
      renamingSelf = true
      try {
        await store().renameTo(pathRef.current, name)
      } catch {
        follow = false // e.g. locked by another program; stop trying until reopened
      } finally {
        renamingSelf = false
      }
    }

    const save = async () => {
      if (!view || deleted) return
      if (timer) clearTimeout(timer)
      timer = null
      const text = view.state.doc.toString()
      if (text === lastSaved) return setSaveState('saved')
      setSaveState('saving')
      try {
        await enqueue(() => (deleted ? Promise.resolve() : window.api.write(pathRef.current, text)))
        lastSaved = text
        if (!disposed) setSaveState('saved')
      } catch {
        setSaveState('error')
      }
      if (follow && wantedName(text) && !inSync(text)) {
        if (titleTimer) clearTimeout(titleTimer)
        titleTimer = setTimeout(followTitle, TITLE_RENAME_DELAY)
      }
    }

    const unregister = registerEditor({
      flush: save,
      renamed(from, to) {
        if (pathRef.current === from && !renamingSelf && follow && view) {
          // Renamed from the tree: carry the new name into the note's title
          const line = view.state.doc.line(1)
          const title = titleOf(line.text)
          if (title !== null) {
            const at = line.text.indexOf(title)
            view.dispatch({
              changes: { from: line.from + at, to: line.from + at + title.length, insert: baseName(to) }
            })
          }
        }
        const moved = movedPath(pathRef.current, from, to)
        if (moved) pathRef.current = moved
        if (view) follow = inSync(view.state.doc.toString())
      },
      removed(p) {
        if (movedPath(pathRef.current, p, p)) deleted = true
      }
    })

    const openLink = async (target: string, newTab: boolean) => {
      const { notes, openFile, refresh } = store()
      const found = resolveLink(target, pathRef.current, notes)
      if (found) return openFile(found, { newTab })
      // Unresolved: create it, next to this note unless the link names a folder
      await save()
      const clean = target.replace(/\\/g, '/').replace(/\.md$/i, '')
      const slash = clean.lastIndexOf('/')
      const here = pathRef.current.includes('/') ? pathRef.current.slice(0, pathRef.current.lastIndexOf('/')) : ''
      const dir = slash === -1 ? here : clean.slice(0, slash)
      const created = await window.api.createNote(dir, clean.slice(slash + 1))
      await refresh()
      await openFile(created, { newTab })
    }

    const create = (doc: string) => {
      lastSaved = doc
      follow = inSync(doc)
      view = new EditorView({
        parent: host.current!,
        state: EditorState.create({
          doc,
          extensions: [
            history(),
            drawSelection(),
            highlightActiveLine(),
            indentOnInput(),
            bracketMatching(),
            highlightSelectionMatches(),
            EditorView.lineWrapping,
            markdown({ base: markdownLanguage, codeLanguages: languages }),
            syntaxHighlighting(mdHighlight),
            linkContext.of({ notes: () => store().notes, from: () => pathRef.current, open: openLink }),
            livePreview,
            wikiComplete,
            theme,
            placeholder('Start writing…'),
            keymap.of([
              { key: 'Mod-s', run: () => (save(), true), preventDefault: true },
              ...completionKeymap,
              indentWithTab,
              ...defaultKeymap,
              ...historyKeymap,
              ...searchKeymap
            ]),
            EditorView.updateListener.of((u) => {
              if (!u.docChanged) return
              setSaveState('unsaved')
              if (timer) clearTimeout(timer)
              timer = setTimeout(save, SAVE_DELAY)
            })
          ]
        })
      })
      viewRef.current = view
      // Select the title of a fresh "Untitled" note so typing replaces it
      const fresh = /^# (Untitled(?: \d+)?)\n\n$/.exec(doc)
      if (fresh) view.dispatch({ selection: { anchor: 2, head: 2 + fresh[1].length } })
      revealIfAsked()
      if (activeRef.current) view.focus()
    }

    // Jump to a line (and the searched-for text on it) when opened from search or backlinks
    const revealIfAsked = (r: Reveal | null = store().reveal) => {
      if (!view || !r || r.path !== pathRef.current) return
      store().clearReveal()
      const line = view.state.doc.line(Math.min(Math.max(r.line, 1), view.state.doc.lines))
      const at = r.query ? line.text.toLowerCase().indexOf(r.query.toLowerCase().split(/\s+/)[0]) : -1
      const range =
        at >= 0
          ? EditorSelection.range(line.from + at, line.from + at + r.query!.split(/\s+/)[0].length)
          : EditorSelection.cursor(line.from)
      view.dispatch({ selection: range, effects: EditorView.scrollIntoView(range, { y: 'center' }) })
      view.focus()
    }
    const offReveal = useStore.subscribe((s, prev) => {
      if (s.reveal !== prev.reveal) revealIfAsked(s.reveal)
      // Links re-check whether they resolve when notes come and go
      if (s.notes !== prev.notes && view) view.dispatch({ effects: refreshLinks.of(null) })
    })

    window.api
      .read(pathRef.current)
      .then((doc) => !disposed && create(doc))
      .catch(() => !disposed && create(''))
    setSaveState('saved')

    // Pick up edits made outside the app (another editor, git pull, link updates) if we have no
    // pending changes
    const off = window.api.onChanged(async (events) => {
      const p = pathRef.current
      if (!view || !events.some((e) => e.path === p && e.event === 'change')) return
      const disk = await window.api.read(p).catch(() => null)
      if (disk === null || disk === lastSaved || !view || p !== pathRef.current) return
      if (view.state.doc.toString() !== lastSaved) return // local edits win; they'll save shortly
      lastSaved = disk
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: disk } })
    })

    return () => {
      off()
      offReveal()
      const pendingTitle = titleTimer !== null
      save()
        .then(() => (pendingTitle || titleTimer ? followTitle() : undefined))
        .finally(() => {
          disposed = true
          unregister()
          view?.destroy()
        })
    }
  }, [tabId])

  // Hidden tabs keep their editor (and undo history); re-measure and focus when shown again
  useEffect(() => {
    const view = viewRef.current
    if (!active || !view) return
    view.requestMeasure()
    view.focus()
  }, [active])

  return <div className="editor" ref={host} hidden={!active} />
}
