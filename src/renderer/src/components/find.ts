import { EditorSelection, StateEffect, StateField, type Extension } from '@codemirror/state'
import { EditorView, runScopeHandlers, type Panel, type ViewUpdate } from '@codemirror/view'
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  search,
  searchPanelOpen,
  setSearchQuery
} from '@codemirror/search'

/** Counting stops here: "999+" is as much as anyone needs to know */
const MAX_COUNT = 999

const scrollTo = (range: { from: number; to: number }) =>
  EditorView.scrollIntoView(EditorSelection.range(range.from, range.to), { y: 'nearest', yMargin: 60 })

const setTyping = StateEffect.define<boolean>()

/** True while the cursor is in the find box: the editor "has focus" then too, but nobody is editing (toolbar.ts) */
export const findFocused = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setTyping)) value = e.value
    return value && searchPanelOpen(tr.state)
  }
})

/**
 * Find in this note (Ctrl+F): a small bar at the top right with the text, "2 of 7", previous/next and close.
 * It sits on CodeMirror's own search (searchKeymap opens and closes it, and gives F3 / Shift+F3), with our panel
 * in place of the stock one. Plain text, ignoring case; no replace.
 */
function findPanel(view: EditorView): Panel {
  const dom = document.createElement('div')
  dom.className = 'cm-find'

  const input = document.createElement('input')
  input.className = 'cm-find-input'
  input.placeholder = 'Find in note'
  input.spellcheck = false
  input.setAttribute('main-field', 'true') // how openSearchPanel finds the box to focus
  input.setAttribute('aria-label', 'Find in note')
  input.value = getSearchQuery(view.state).search

  const count = document.createElement('span')
  count.className = 'cm-find-count'

  const button = (label: string, title: string, run: () => unknown) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'cm-find-btn'
    b.textContent = label
    b.title = title
    b.setAttribute('aria-label', title)
    b.onmousedown = (e) => e.preventDefault() // typing carries on in the box
    b.onclick = () => run()
    return b
  }

  dom.append(
    input,
    count,
    button('↑', 'Previous (Shift+Enter)', () => findPrevious(view)),
    button('↓', 'Next (Enter)', () => findNext(view)),
    button('✕', 'Close (Esc)', () => closeSearchPanel(view))
  )

  // As you type: show the first match from where the cursor is, without leaving the box
  input.oninput = () => {
    const query = new SearchQuery({ search: input.value, literal: true })
    view.dispatch({ effects: setSearchQuery.of(query) })
    if (!query.valid) return
    let hit = query.getCursor(view.state, view.state.selection.main.from).next()
    if (hit.done) hit = query.getCursor(view.state).next()
    if (hit.done) return
    view.dispatch({
      selection: EditorSelection.range(hit.value.from, hit.value.to),
      effects: scrollTo(hit.value),
      userEvent: 'select.search'
    })
  }

  // Keeps findFocused in step with where the cursor is. Never straight away: the box is focused and blurred in the
  // middle of the editor's own updates (opening and closing the bar), when nothing may be dispatched.
  let checking = false
  const noteFocus = () => {
    if (checking) return
    checking = true
    queueMicrotask(() => {
      checking = false
      if (!dom.isConnected) return
      const typing = view.root.activeElement === input
      if (view.state.field(findFocused, false) !== typing) view.dispatch({ effects: setTyping.of(typing) })
    })
  }
  input.onfocus = noteFocus
  input.onblur = noteFocus

  dom.onkeydown = (e) => {
    if (runScopeHandlers(view, e, 'search-panel')) e.preventDefault() // Esc, F3, Ctrl+F
    else if (e.key === 'Enter' && e.target === input) {
      e.preventDefault()
      ;(e.shiftKey ? findPrevious : findNext)(view)
    }
  }

  const recount = () => {
    const query = getSearchQuery(view.state)
    if (!query.valid) {
      count.textContent = ''
      dom.classList.remove('none')
      return
    }
    const sel = view.state.selection.main
    const matches = query.getCursor(view.state)
    let total = 0
    let current = 0
    for (let m = matches.next(); !m.done && total <= MAX_COUNT; m = matches.next()) {
      total++
      if (m.value.from === sel.from && m.value.to === sel.to) current = total
    }
    const all = total > MAX_COUNT ? `${MAX_COUNT}+` : String(total)
    count.textContent = total === 0 ? 'No matches' : current ? `${current} of ${all}` : all
    dom.classList.toggle('none', total === 0)
  }
  recount()

  return {
    dom,
    top: true,
    mount: () => {
      input.select()
      noteFocus()
    },
    update(u: ViewUpdate) {
      noteFocus() // focus events don't always come (a window in the background)
      let asked = false
      for (const tr of u.transactions)
        for (const e of tr.effects)
          if (e.is(setSearchQuery)) {
            asked = true
            // Ctrl+F with text selected looks for that text
            if (e.value.search !== input.value) input.value = e.value.search
          }
      if (asked || u.docChanged || u.selectionSet) recount()
    }
  }
}

const findTheme = EditorView.theme({
  '.cm-panels.cm-panels-top': {
    position: 'absolute',
    top: '10px',
    right: '24px',
    left: 'auto',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    backgroundColor: 'var(--panel)',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)'
  },
  '.cm-find': { display: 'flex', alignItems: 'center', gap: '2px', padding: '4px', fontFamily: 'var(--sans)', fontSize: '13px' },
  '.cm-find-input': {
    font: 'inherit',
    width: '200px',
    color: 'var(--text-strong)',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '4px 8px',
    outline: 'none'
  },
  '.cm-find-input:focus': { borderColor: 'var(--accent)' },
  '.cm-find.none .cm-find-input': { borderColor: '#ef6b6b' },
  '.cm-find-count': {
    minWidth: '64px',
    padding: '0 6px',
    textAlign: 'center',
    whiteSpace: 'nowrap',
    color: 'var(--text-dim)',
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums'
  },
  '.cm-find-btn': {
    width: '24px',
    height: '24px',
    display: 'grid',
    placeItems: 'center',
    border: 'none',
    borderRadius: '5px',
    background: 'transparent',
    color: 'var(--text-dim)',
    font: 'inherit',
    cursor: 'pointer'
  },
  '.cm-find-btn:hover': { background: 'var(--hover)', color: 'var(--text-strong)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--highlight) 60%, transparent)' }
})

export const findBar: Extension = [findFocused, search({ top: true, createPanel: findPanel, scrollToMatch: scrollTo }), findTheme]

/** Ctrl+F from anywhere in the window: find in the note on screen. False when there isn't one. */
export function openFind(): boolean {
  for (const el of document.querySelectorAll<HTMLElement>('.doc:not([hidden]) .cm-editor')) {
    const view = el.offsetParent ? EditorView.findFromDOM(el) : null
    if (view) return openSearchPanel(view)
  }
  return false
}
