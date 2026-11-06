import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import { Facet } from '@codemirror/state'
import { SLASH_ITEMS } from './blocks'

/** On in the page view; the markdown view has no slash menu (paths have slashes in them) */
export const slashMenuOn = Facet.define<boolean, boolean>({ combine: (v) => v.some(Boolean) })

const CODE = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText', 'CodeInfo', 'URL', 'Frontmatter'])

/**
 * Typing "/" at the start of a line or after a space opens a menu of blocks to add. It's a source
 * for the editor's autocomplete (wikiComplete.ts), so it shares its keys and look.
 */
export function slashMenu(ctx: CompletionContext): CompletionResult | null {
  if (!ctx.state.facet(slashMenuOn)) return null
  const typed = ctx.matchBefore(/\/[\w -]{0,24}$/)
  if (!typed) return null
  const before = typed.from > 0 ? ctx.state.sliceDoc(typed.from - 1, typed.from) : ''
  if (before && !/\s/.test(before)) return null
  // Not in code, links or frontmatter
  for (let n: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(ctx.state).resolveInner(typed.from, -1); n; n = n.parent) {
    if (CODE.has(n.name)) return null
  }
  return {
    from: typed.from + 1,
    validFor: /^[\w -]*$/,
    options: SLASH_ITEMS.map((item, i) => ({
      label: item.label,
      detail: item.hint,
      boost: -i, // the menu's own order when nothing's typed yet
      apply: (view, _c, from, to) => item.run(view, from - 1, to)
    }))
  }
}
