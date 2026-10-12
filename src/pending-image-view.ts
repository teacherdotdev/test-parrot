import type { Ctx } from '@milkdown/kit/ctx'
import { nodeViewCtx } from '@milkdown/kit/core'
import { imageBlockSchema } from '@milkdown/kit/component/image-block'
import { imageSchema } from '@milkdown/kit/preset/commonmark'
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import type { EditorView, NodeViewConstructor } from '@milkdown/kit/prose/view'
import { $viewAsync } from '@milkdown/kit/utils'
import { pictureView } from './picture-view'
import { pendingImageOf, type PendingImageReference, type ProseMirrorJSON } from './question-doc'

/**
 * Pending Images in the question editor. Both image nodes declare a `pending`
 * attribute, so loading a Question never drops what a Pending Image names,
 * and a Pending Image is drawn as a “picture needed” block that says which
 * picture belongs there and offers Resolve — Crepe's own image view has
 * nothing to show for an image with no source.
 */

/** Dispatched, bubbling, by a “picture needed” block's Resolve button. The
 *  listener resolves it by calling `apply` with an owned image source, and
 *  the Authored Image Size it arrives at when that is known. */
export const RESOLVE_IMAGE_EVENT = 'test-parrot:resolve-image'

export type ResolveImageRequest = {
  pending: PendingImageReference
  alt: string
  caption: string
  apply: (src: string, size?: number) => void
}

const withPending = <Spec extends { attrs?: Record<string, unknown> }>(prev: (ctx: Ctx) => Spec) => (ctx: Ctx): Spec => {
  const spec = prev(ctx)
  return { ...spec, attrs: { ...spec.attrs, pending: { default: null } } }
}

export function configurePendingImages(ctx: Ctx) {
  ctx.update(imageBlockSchema.key, withPending)
  ctx.update(imageSchema.key, withPending)
}

function pendingView(node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined, inline: boolean) {
  const pending = pendingImageOf(node.toJSON() as ProseMirrorJSON)!
  const named = 'image' in pending ? `IMG ${pending.image}` : `page ${pending.page}`
  const dom = document.createElement(inline ? 'span' : 'div')
  dom.className = 'picture-needed'
  if (inline) dom.dataset.inline = 'true'
  dom.contentEditable = 'false'
  dom.setAttribute('role', 'group')
  dom.setAttribute('aria-label', `Picture needed: ${named}`)
  dom.append('Picture needed')
  const small = document.createElement('small')
  small.textContent = named
  dom.append(small)
  const resolve = document.createElement('button')
  resolve.type = 'button'
  resolve.className = 'secondary-button'
  resolve.textContent = 'Resolve'
  resolve.addEventListener('click', (event) => {
    event.preventDefault()
    const detail: ResolveImageRequest = {
      pending,
      alt: String(node.attrs.alt ?? ''),
      caption: String(node.attrs.caption ?? ''),
      apply: (src, size) => {
        const pos = getPos()
        if (pos === undefined) return
        const current = view.state.doc.nodeAt(pos)
        if (!current) return
        // Only a block image has a size of its own; an inline one follows its line.
        const sized = size !== undefined && 'size' in current.attrs ? { size } : {}
        view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, src, pending: null, ...sized }))
      },
    }
    dom.dispatchEvent(new CustomEvent(RESOLVE_IMAGE_EVENT, { bubbles: true, detail }))
  })
  dom.append(resolve)
  return {
    dom,
    // Resolved, it is an ordinary image again, drawn by Crepe's own view.
    update: (next: ProseMirrorNode) => next.type === node.type && next.attrs.pending !== null && next.attrs.pending === node.attrs.pending,
    stopEvent: (event: Event) => event.target === resolve,
    ignoreMutation: () => true,
  }
}

/** Crepe's view for every inline image, and ours for every block picture
 *  (`picture-view.ts`), except a Pending Image's. Registered after Crepe's,
 *  which it wraps, and before the editor view that reads them. */
function wrapping(type: typeof imageBlockSchema.node, inline: boolean) {
  return $viewAsync(type, async (ctx) => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    const inner = ctx.get(nodeViewCtx).find(([id]) => id === type.id)?.[1] as NodeViewConstructor | undefined
    const wrapped: NodeViewConstructor = (node, view, getPos, ...rest) =>
      node.attrs.pending
        ? pendingView(node, view, getPos, inline)
        : !inline
          ? pictureView(node, view, getPos)
          : inner
            ? inner(node, view, getPos, ...rest)
            : (null as unknown as ReturnType<NodeViewConstructor>)
    return wrapped
  })
}

export const pendingImageBlockView = wrapping(imageBlockSchema.node, false)
export const pendingInlineImageView = wrapping(imageSchema.node as unknown as typeof imageBlockSchema.node, true)
