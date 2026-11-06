import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { baseName } from '@shared/names'
import { linkTextFor } from '@shared/links'
import { linkContext } from './livePreview'
import { slashMenu } from './slashMenu'

/** Typing "[[" suggests notes; picking one completes the link (and its closing brackets). */
function wikiLinks(ctx: CompletionContext): CompletionResult | null {
  const before = ctx.matchBefore(/\[\[[^[\]\n|#]*$/)
  if (!before) return null
  const link = ctx.state.facet(linkContext)
  if (!link) return null
  const notes = link.notes()
  const closed = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2) === ']]'
  const self = link.from()
  return {
    from: before.from + 2,
    validFor: /^[^[\]\n|#]*$/,
    options: notes
      .filter((p) => p !== self)
      .map((p) => {
        const text = linkTextFor(p, notes)
        const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''
        return {
          label: baseName(p),
          detail: dir,
          apply: (view, _c, from, to) => {
            const insert = closed ? text : `${text}]]`
            view.dispatch({
              changes: { from, to, insert },
              selection: { anchor: from + text.length + 2 } // after the closing ]]
            })
          }
        }
      })
  }
}

export const wikiComplete = autocompletion({
  override: [wikiLinks, slashMenu],
  icons: false,
  activateOnTyping: true
})
