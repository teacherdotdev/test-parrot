import type { Ctx } from '@milkdown/kit/ctx'
import { editorViewOptionsCtx } from '@milkdown/kit/core'
import { Fragment, Slice, type Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { captureImageSource, saveImage } from './local-images'

const IMAGE_PROTOCOLS = new Set(['http:', 'https:', 'blob:'])
const pendingIngestion = new Set<Promise<unknown>>()

/** The save boundary waits for all media currently being ingested, so temporary
 * placeholders never become durable unresolved content just because Save wins
 * a race with a network capture. */
export async function settlePendingMedia(): Promise<void> {
  await Promise.allSettled([...pendingIngestion])
}

export function safePastedImageSource(value: string): string | undefined {
  const source = value.trim()
  if (!source) return undefined
  if (source.startsWith('/')) return source
  if (source.startsWith('data:')) return source.startsWith('data:image/') ? source : undefined
  try {
    const base = globalThis.location?.href ?? 'https://example.invalid/'
    const url = new URL(source, base)
    return IMAGE_PROTOCOLS.has(url.protocol) ? source : undefined
  } catch {
    return undefined
  }
}

export function pastedImageSources(html: string): string[] {
  if (!html || typeof DOMParser === 'undefined') return []
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return [...doc.querySelectorAll('img')].map((image) => image.getAttribute('src') ?? '')
}

function isOnlyPastedImage(html: string): boolean {
  if (!html || typeof DOMParser === 'undefined') return false
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.body.children.length === 1 && doc.body.firstElementChild?.tagName === 'IMG'
}

export function firstPastedImageSource(html: string): string | undefined {
  return pastedImageSources(html).map(safePastedImageSource).find(Boolean)
}

function pastedImageFile(data: DataTransfer | null): File | undefined {
  return data ? [...data.files].find((file) => file.type.startsWith('image/')) : undefined
}

/** Captures paste bytes before they can become durable Question Content. */
export async function capturePastedImage(
  source: string | undefined,
  file: File | undefined,
): Promise<string> {
  if (file) return saveImage(file)
  if (!source) throw new Error('This image could not be captured.')
  return captureImageSource(source)
}

function imageAtSource(view: EditorView, source: string): number | undefined {
  let position: number | undefined
  view.state.doc.descendants((node, pos) => {
    if (position === undefined && node.attrs.src === source) position = pos
  })
  return position
}

/** The pasted node is its own stable placeholder: later edits can move it
 * freely, and this lookup replaces that node rather than the current selection. */
function replaceImageSource(view: EditorView, source: string, replacement?: string) {
  const position = imageAtSource(view, source)
  if (position === undefined) return
  const node = view.state.doc.nodeAt(position)
  if (!node) return
  view.dispatch(replacement
    ? view.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, src: replacement })
    : view.state.tr.replaceWith(position, position + node.nodeSize, view.state.schema.text('[Image could not be captured.]')),
  )
}

type PendingImage = { source: string; placeholder: string; file?: File }

function placeholdersFor(slice: Slice, file?: File): { slice: Slice; pending: PendingImage[] } {
  const pending: PendingImage[] = []
  const rewrite = (node: ProseMirrorNode): ProseMirrorNode => {
    const content = node.content.size
      ? Fragment.fromArray(node.content.content.map(rewrite))
      : node.content
    if (node.type.name !== 'image' && node.type.name !== 'image-block') return node.copy(content)
    const source = String(node.attrs.src ?? '')
    const placeholder = `blob:pending-${crypto.randomUUID()}`
    pending.push({ source, placeholder, file: pending.length === 0 ? file : undefined })
    return node.type.create({ ...node.attrs, src: placeholder }, content, node.marks)
  }
  return {
    slice: new Slice(Fragment.fromArray(slice.content.content.map(rewrite)), slice.openStart, slice.openEnd),
    pending,
  }
}

function trackCapture(view: EditorView, source: string | undefined, file: File | undefined, placeholder: string) {
  const capture = capturePastedImage(source, file).then(
    (owned) => replaceImageSource(view, placeholder, owned),
    () => replaceImageSource(view, placeholder),
  )
  pendingIngestion.add(capture)
  void capture.finally(() => pendingIngestion.delete(capture))
}

function captureNode(view: EditorView, pending: PendingImage) {
  trackCapture(view, safePastedImageSource(pending.source), pending.file, pending.placeholder)
}

export function configurePastedImages(ctx: Ctx) {
  ctx.update(editorViewOptionsCtx, (prev) => ({
    ...prev,
    handlePaste(view, event, slice) {
      const sources = pastedImageSources(event.clipboardData?.getData('text/html') ?? '')
      const file = pastedImageFile(event.clipboardData)
      if (sources.length === 0 && !file) return prev.handlePaste?.(view, event, slice) ?? false

      if ((sources.length === 0 && file) || (sources.length === 1 && isOnlyPastedImage(event.clipboardData?.getData('text/html') ?? ''))) {
        event.preventDefault()
        const placeholder = `blob:pending-${crypto.randomUUID()}`
        const node = view.state.schema.nodes['image-block']?.createAndFill({
          src: placeholder,
          caption: '',
          ratio: 1,
        })
        if (!node) return false
        view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView())
        trackCapture(view, sources[0] && safePastedImageSource(sources[0]), file, placeholder)
        return true
      }

      // Preserve all mixed clipboard content and every image, but insert only
      // placeholder references. Each placeholder maps through later edits.
      event.preventDefault()
      const rewritten = placeholdersFor(slice, file)
      view.dispatch(view.state.tr.replaceSelection(rewritten.slice).scrollIntoView())
      for (const pending of rewritten.pending) captureNode(view, pending)
      return true
    },
  }))
}
