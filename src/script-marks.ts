import type { Ctx } from '@milkdown/kit/ctx'
import { editorViewCtx } from '@milkdown/kit/core'
import { $markSchema, $useKeymap } from '@milkdown/kit/utils'

function scriptMark(name: 'subscript' | 'superscript', tag: 'sub' | 'sup') {
  return $markSchema(name, () => ({
    excludes: name === 'subscript' ? 'superscript' : 'subscript',
    parseDOM: [{ tag }],
    toDOM: () => [tag, 0],
    parseMarkdown: {
      match: () => false,
      runner: () => undefined,
    },
    toMarkdown: {
      match: (mark) => mark.type.name === name,
      runner: () => undefined,
    },
  }))
}

export const subscriptSchema = scriptMark('subscript', 'sub')
export const superscriptSchema = scriptMark('superscript', 'sup')

type ScriptName = 'subscript' | 'superscript'

function eligibleTextRanges(ctx: Ctx) {
  const view = ctx.get(editorViewCtx)
  const { from, to } = view.state.selection
  const ranges: Array<{ from: number; to: number; marks: readonly string[] }> = []
  view.state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText || node.marks.some((mark) => mark.type.name === 'inlineCode')) {
      return
    }
    const start = Math.max(from, pos)
    const end = Math.min(to, pos + node.nodeSize)
    if (start < end) {
      ranges.push({
        from: start,
        to: end,
        marks: node.marks.map((mark) => mark.type.name),
      })
    }
  })
  return ranges
}

export function isScriptActive(ctx: Ctx, name: ScriptName) {
  const view = ctx.get(editorViewCtx)
  const type = view.state.schema.marks[name]
  if (!type) return false
  const { empty, $from } = view.state.selection
  if (empty) {
    return Boolean(type.isInSet(view.state.storedMarks ?? $from.marks()))
  }
  const ranges = eligibleTextRanges(ctx)
  return ranges.length > 0 && ranges.every((range) => range.marks.includes(name))
}

export function toggleScript(ctx: Ctx, name: ScriptName) {
  const view = ctx.get(editorViewCtx)
  const type = view.state.schema.marks[name]
  if (!type) return
  const oppositeName: ScriptName = name === 'subscript' ? 'superscript' : 'subscript'
  const opposite = view.state.schema.marks[oppositeName]
  const { empty, $from } = view.state.selection

  if (empty) {
    const marks = view.state.storedMarks ?? $from.marks()
    if (marks.some((mark) => mark.type.name === 'inlineCode')) return
    const tr = view.state.tr
    if (opposite) tr.removeStoredMark(opposite)
    if (type.isInSet(marks)) tr.removeStoredMark(type)
    else tr.addStoredMark(type.create())
    view.dispatch(tr)
    view.focus()
    return
  }

  const ranges = eligibleTextRanges(ctx)
  if (ranges.length === 0) return
  const remove = ranges.every((range) => range.marks.includes(name))
  const tr = view.state.tr
  for (const range of ranges) {
    if (opposite) tr.removeMark(range.from, range.to, opposite)
    if (remove) tr.removeMark(range.from, range.to, type)
    else tr.addMark(range.from, range.to, type.create())
  }
  view.dispatch(tr)
  view.focus()
}

export const scriptKeymap = $useKeymap('scriptKeymap', {
  ToggleSubscript: {
    shortcuts: 'Mod-,',
    command: (ctx) => () => {
      toggleScript(ctx, 'subscript')
      return true
    },
  },
  ToggleSuperscript: {
    shortcuts: 'Mod-.',
    command: (ctx) => () => {
      toggleScript(ctx, 'superscript')
      return true
    },
  },
})

export const subscriptIcon = `
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
    <path d="M5.1 5h2.4l3.1 4.3L13.7 5h2.4l-4.3 6 3.7 5.1h-2.4l-2.5-3.5-2.5 3.5H5.7L9.4 11 5.1 5Zm11.6 12.2c0-1.5 1.1-2.3 2.5-2.3 1.3 0 2.3.7 2.3 1.9 0 1-.6 1.6-1.5 2.3l-1.1.8h2.7v1.4h-4.9v-1.2l2.3-1.8c.6-.5.8-.8.8-1.2 0-.5-.3-.8-.8-.8-.6 0-.9.4-.9 1l-1.4-.1Z" />
  </svg>`

export const superscriptIcon = `
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
    <path d="M5.1 8h2.4l3.1 4.3L13.7 8h2.4l-4.3 6 3.7 5.1h-2.4l-2.5-3.5-2.5 3.5H5.7L9.4 14 5.1 8Zm11.6-5.8c0-1.5 1.1-2.3 2.5-2.3 1.3 0 2.3.7 2.3 1.9 0 1-.6 1.6-1.5 2.3l-1.1.8h2.7v1.4h-4.9V5.1L19 3.3c.6-.5.8-.8.8-1.2 0-.5-.3-.8-.8-.8-.6 0-.9.4-.9 1l-1.4-.1Z" />
  </svg>`
