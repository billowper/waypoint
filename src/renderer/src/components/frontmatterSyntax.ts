import type { MarkdownConfig } from '@lezer/markdown'

/**
 * Parse a leading "---\nkey: value\n---" block as one Frontmatter node, so its YAML isn't read as
 * markdown (otherwise "---" becomes a rule and the last YAML line a setext heading).
 */
export const frontmatterSyntax: MarkdownConfig = {
  defineNodes: [{ name: 'Frontmatter', block: true }],
  parseBlock: [
    {
      name: 'Frontmatter',
      before: 'HorizontalRule',
      parse(cx, line) {
        if (cx.lineStart !== 0 || line.text.trimEnd() !== '---') return false
        const from = cx.lineStart
        while (cx.nextLine()) {
          if (line.text.trimEnd() === '---') {
            const to = cx.lineStart + line.text.length
            cx.nextLine()
            cx.addElement(cx.elt('Frontmatter', from, to))
            return true
          }
        }
        // Unclosed: treat the rest as frontmatter rather than garbling it
        cx.addElement(cx.elt('Frontmatter', from, cx.prevLineEnd()))
        return true
      }
    }
  ]
}
