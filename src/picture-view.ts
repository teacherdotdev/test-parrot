import type { Ctx } from '@milkdown/kit/ctx'
import { imageBlockSchema } from '@milkdown/kit/component/image-block'
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import { NodeSelection, Plugin } from '@milkdown/kit/prose/state'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { CENTRE } from './centring'
import { centrable } from './centring-editor'
import { saveImage } from './local-images'
import {
  clampSize,
  isWholeCrop,
  keptAspect,
  legacyRatioOf,
  normalizedCrop,
  pictureCropOf,
  pictureSizeOf,
  sizeAfterCrop,
  WHOLE_CROP,
  type CropBox,
  type PictureCrop,
} from './picture-geometry'

/**
 * A block picture in the question editor, drawn the way Google Docs draws one,
 * at its Default Picture Size: how wide it prints is each Exam's to decide,
 * on the sheet (ADR-0050), so nothing here resizes it. One click selects it.
 * A double click, or Enter while it is selected, crops it in place:
 * black handles on the part it keeps, the rest of the picture shown faded
 * around it, and a drag inside slides the picture under the crop. Enter, a
 * click outside or another double click keeps the crop; Escape puts back the
 * crop it had. A right click offers Reset crop and the caption.
 *
 * What it writes is the picture's `size` and `crop` (see `picture-geometry`),
 * never new bytes: the Media Asset stays whole, so a crop can always be
 * widened again.
 */

/** Dispatched, bubbling, by a right click on a picture. The listener shows a
 *  menu at `point` and calls back what the teacher chooses. */
export const PICTURE_MENU_EVENT = 'test-parrot:picture-menu'

export type PictureMenuRequest = {
  point: { x: number; y: number }
  cropped: boolean
  captioned: boolean
  /** Whether the picture may be centred where it stands, and whether it is. */
  centrable: boolean
  centred: boolean
  resetCrop: () => void
  toggleCaption: () => void
  toggleCentre: () => void
}

/** Asks a picture's view to start cropping; sent by Enter on a selected one. */
const START_CROP_EVENT = 'test-parrot:start-crop'

// ---- Schema ---------------------------------------------------------------

function cropFromDom(dom: HTMLElement): PictureCrop | null {
  try {
    return pictureCropOf({ crop: JSON.parse(dom.dataset.crop ?? 'null') })
  } catch {
    return null
  }
}

/** Gives Crepe's image block its `size` and `crop`, and keeps both when a
 *  picture is copied and pasted inside the editor. */
export function configurePictures(ctx: Ctx) {
  ctx.update(imageBlockSchema.key, (prev) => (context) => {
    const spec = prev(context)
    return {
      ...spec,
      attrs: { ...spec.attrs, size: { default: null }, crop: { default: null } },
      parseDOM: [{
        tag: 'img[data-type="image-block"]',
        getAttrs: (dom) => {
          if (!(dom instanceof HTMLElement)) return false
          const size = Number(dom.dataset.size)
          const ratio = Number(dom.getAttribute('ratio') ?? 1)
          return {
            src: dom.getAttribute('src') || '',
            caption: dom.getAttribute('caption') || '',
            ratio: Number.isFinite(ratio) && ratio > 0 ? ratio : 1,
            size: Number.isFinite(size) && size > 0 ? clampSize(size) : null,
            crop: cropFromDom(dom),
          }
        },
      }],
      toDOM: (node) => ['img', {
        'data-type': 'image-block',
        src: node.attrs.src,
        caption: node.attrs.caption,
        ratio: String(node.attrs.ratio ?? 1),
        ...(node.attrs.size !== null ? { 'data-size': String(node.attrs.size) } : {}),
        ...(node.attrs.crop ? { 'data-crop': JSON.stringify(node.attrs.crop) } : {}),
      }],
    }
  })
}

/** Enter on a selected picture crops it. */
export const pictureKeys = $prose(() => new Plugin({
  props: {
    handleKeyDown(view, event) {
      if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false
      const { selection } = view.state
      if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'image-block') return false
      if (!selection.node.attrs.src || selection.node.attrs.pending) return false
      view.nodeDOM(selection.from)?.dispatchEvent(new CustomEvent(START_CROP_EVENT))
      return true
    },
  },
}))

// ---- View -----------------------------------------------------------------

const CORNERS = ['nw', 'ne', 'sw', 'se'] as const
const EDGES = ['n', 's', 'e', 'w'] as const
type Corner = (typeof CORNERS)[number]
type Edge = (typeof EDGES)[number]

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement) => {
  const created = document.createElement(tag)
  created.className = className
  parent?.append(created)
  return created
}

const percent = (value: number) => `${value * 100}%`

/** Places a whole picture inside a window showing only the part `box` keeps. */
function placeWhole(image: HTMLElement, box: CropBox) {
  const width = box.right - box.left
  const height = box.bottom - box.top
  image.style.width = percent(1 / width)
  image.style.height = percent(1 / height)
  image.style.left = percent(-box.left / width)
  image.style.top = percent(-box.top / height)
}

type Cropping = {
  /** The crop as it was, to put back on Escape. */
  before: CropBox
  box: CropBox
  /** The whole picture's width and height on screen. */
  wide: number
  high: number
  /** Where the whole picture's top-left sits, from the frame's. */
  x: number
  y: number
  overlay: HTMLElement
  window: HTMLElement
  /** The frame's width when cropping began: the kept part's, on screen. */
  shown: number
  cleanup: () => void
}

export function pictureView(initial: ProseMirrorNode, view: EditorView, getPos: () => number | undefined): NodeView {
  let node = initial
  let cropping: Cropping | null = null
  let captionShown = Boolean(node.attrs.caption)
  let captionTimer = 0

  const dom = element('div', 'picture-block')
  dom.contentEditable = 'false'
  const frame = element('div', 'picture-frame', dom)
  const window_ = element('div', 'picture-window', frame)
  const image = element('img', 'picture-image', window_)
  image.draggable = false
  const caption = element('input', 'picture-caption', dom)
  caption.placeholder = 'Write a caption'
  caption.setAttribute('aria-label', 'Caption')
  const empty = element('div', 'picture-empty', dom)

  const positionOf = () => getPos()
  const setAttrs = (attrs: Record<string, unknown>) => {
    const pos = positionOf()
    if (pos === undefined) return
    const current = view.state.doc.nodeAt(pos)
    if (!current) return
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...attrs }))
  }
  const containerWidth = () => dom.clientWidth || frame.getBoundingClientRect().width || 1

  // ---- Drawing the picture as it is ----

  const draw = () => {
    const src = String(node.attrs.src ?? '')
    dom.classList.toggle('is-empty', !src)
    frame.hidden = !src
    empty.hidden = Boolean(src)
    if (image.getAttribute('src') !== src) image.setAttribute('src', src)
    image.alt = String(node.attrs.caption ?? '')
    const size = pictureSizeOf(node.attrs)
    const crop = pictureCropOf(node.attrs)
    frame.classList.toggle('is-cropped', Boolean(crop))
    if (crop) {
      frame.style.width = percent(size ?? 1)
      window_.style.aspectRatio = String(keptAspect(crop))
      placeWhole(image, crop)
    } else {
      window_.style.aspectRatio = ''
      image.style.width = image.style.height = image.style.left = image.style.top = ''
      if (size !== null) frame.style.width = percent(size)
      else {
        // One no one has resized since Crepe's handle: the size it fit at,
        // scaled by Crepe's ratio, never wider than its column.
        const ratio = legacyRatioOf(node.attrs)
        frame.style.width = image.naturalWidth
          ? `min(${image.naturalWidth * ratio}px, ${percent(Math.min(1, ratio))})`
          : ''
      }
    }
    const text = String(node.attrs.caption ?? '')
    if (document.activeElement !== caption) caption.value = text
    caption.hidden = !captionShown && !text
  }
  image.addEventListener('load', () => draw())

  // ---- Cropping in place ----

  const layoutCrop = (state: Cropping) => {
    state.overlay.style.left = `${state.x}px`
    state.overlay.style.top = `${state.y}px`
    state.overlay.style.width = `${state.wide}px`
    state.overlay.style.height = `${state.high}px`
    const { box } = state
    state.window.style.left = percent(box.left)
    state.window.style.top = percent(box.top)
    state.window.style.width = percent(box.right - box.left)
    state.window.style.height = percent(box.bottom - box.top)
    placeWhole(state.window.querySelector('img')!, box)
  }

  const finishCrop = (keep: boolean) => {
    const state = cropping
    if (!state) return
    cropping = null
    state.cleanup()
    state.overlay.remove()
    dom.classList.remove('is-cropping')
    const box = normalizedCrop(state.box)
    const same = ['left', 'top', 'right', 'bottom'].every((side) =>
      Math.abs(box[side as keyof CropBox] - state.before[side as keyof CropBox]) < 0.001)
    if (!keep || same) {
      draw()
      return
    }
    const size = sizeAfterCrop(state.shown, containerWidth(), state.before, box)
    setAttrs({
      crop: isWholeCrop(box) ? null : { ...box, width: image.naturalWidth, height: image.naturalHeight },
      size,
    })
  }

  const startCrop = () => {
    if (cropping || !view.editable || !node.attrs.src || !image.naturalWidth) return
    const before = pictureCropOf(node.attrs) ?? WHOLE_CROP
    const shown = frame.getBoundingClientRect().width
    const wide = shown / (before.right - before.left)
    const high = wide * image.naturalHeight / image.naturalWidth
    const overlay = element('div', 'picture-cropping', frame)
    const ghost = element('img', 'picture-ghost', overlay)
    ghost.src = image.src
    ghost.draggable = false
    const cropWindow = element('div', 'picture-crop-window', overlay)
    const kept = element('img', 'picture-crop-image', cropWindow)
    kept.src = image.src
    kept.draggable = false
    const grips = [...CORNERS, ...EDGES].map((grip) => {
      const handle = element('span', 'picture-crop-handle', cropWindow)
      handle.dataset.grip = grip
      return handle
    })
    const state: Cropping = {
      before: { left: before.left, top: before.top, right: before.right, bottom: before.bottom },
      box: { left: before.left, top: before.top, right: before.right, bottom: before.bottom },
      wide,
      high,
      x: -before.left * wide,
      y: -before.top * high,
      overlay,
      window: cropWindow,
      shown,
      cleanup: () => undefined,
    }

    const drag = (start: PointerEvent, grip: Corner | Edge | 'pan') => {
      start.preventDefault()
      start.stopPropagation()
      const from = { ...state.box }
      const origin = { x: state.x, y: state.y }
      const move = (event: PointerEvent) => {
        const dx = (event.clientX - start.clientX) / state.wide
        const dy = (event.clientY - start.clientY) / state.high
        if (grip === 'pan') {
          // The picture slides under a crop that stays where it is.
          const across = Math.max(-from.left, Math.min(1 - from.right, -dx))
          const down = Math.max(-from.top, Math.min(1 - from.bottom, -dy))
          state.box = { left: from.left + across, right: from.right + across, top: from.top + down, bottom: from.bottom + down }
          state.x = origin.x - across * state.wide
          state.y = origin.y - down * state.high
        } else {
          const next = { ...from }
          if (grip.includes('w')) next.left = Math.max(0, Math.min(from.right - 0.02, from.left + dx))
          if (grip.includes('e')) next.right = Math.min(1, Math.max(from.left + 0.02, from.right + dx))
          if (grip.includes('n')) next.top = Math.max(0, Math.min(from.bottom - 0.02, from.top + dy))
          if (grip.includes('s')) next.bottom = Math.min(1, Math.max(from.top + 0.02, from.bottom + dy))
          state.box = next
        }
        layoutCrop(state)
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }
    grips.forEach((handle) => handle.addEventListener('pointerdown', (event) => drag(event, handle.dataset.grip as Corner | Edge)))
    cropWindow.addEventListener('pointerdown', (event) => {
      if (event.target === cropWindow || event.target === kept) drag(event, 'pan')
    })
    overlay.addEventListener('dblclick', (event) => {
      event.preventDefault()
      event.stopPropagation()
      finishCrop(true)
    })

    // Enter keeps the crop and Escape puts it back — before the question
    // dialog, which would otherwise take Escape as closing it.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      finishCrop(event.key === 'Enter')
    }
    const onOutside = (event: PointerEvent) => {
      if (!overlay.contains(event.target as Node)) finishCrop(true)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onOutside, true)
    state.cleanup = () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onOutside, true)
    }
    cropping = state
    dom.classList.add('is-cropping')
    layoutCrop(state)
  }

  frame.addEventListener('dblclick', (event) => {
    if (cropping) return
    event.preventDefault()
    startCrop()
  })
  dom.addEventListener(START_CROP_EVENT, startCrop)

  // ---- The menu, the caption and an empty picture ----

  frame.addEventListener('contextmenu', (event) => {
    if (!view.editable || cropping) return
    event.preventDefault()
    const detail: PictureMenuRequest = {
      point: { x: event.clientX, y: event.clientY },
      cropped: pictureCropOf(node.attrs) !== null,
      captioned: captionShown || Boolean(node.attrs.caption),
      centrable: (() => {
        const pos = positionOf()
        return pos !== undefined && centrable(view.state, pos, node)
      })(),
      centred: node.attrs.align === CENTRE,
      toggleCentre: () => {
        setAttrs({ align: node.attrs.align === CENTRE ? null : CENTRE })
        view.focus()
      },
      resetCrop: () => {
        const crop = pictureCropOf(node.attrs)
        if (!crop) return
        setAttrs({ crop: null, size: sizeAfterCrop(frame.getBoundingClientRect().width, containerWidth(), crop, WHOLE_CROP) })
        // A right click never focused the editor; undo should reach it.
        view.focus()
      },
      toggleCaption: () => {
        if (captionShown || node.attrs.caption) {
          captionShown = false
          setAttrs({ caption: '' })
          view.focus()
        } else {
          captionShown = true
          draw()
          caption.focus()
        }
      },
    }
    dom.dispatchEvent(new CustomEvent(PICTURE_MENU_EVENT, { bubbles: true, detail }))
  })

  const commitCaption = () => {
    window.clearTimeout(captionTimer)
    if (caption.value !== node.attrs.caption) setAttrs({ caption: caption.value })
  }
  caption.addEventListener('input', () => {
    window.clearTimeout(captionTimer)
    captionTimer = window.setTimeout(commitCaption, 800)
  })
  caption.addEventListener('blur', () => {
    commitCaption()
    if (!caption.value) {
      captionShown = false
      draw()
    }
  })
  caption.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      caption.blur()
    }
  })

  const upload = element('label', 'secondary-button picture-upload', empty)
  upload.textContent = 'Upload picture'
  const file = element('input', 'picture-upload-input', upload)
  file.type = 'file'
  file.accept = 'image/*'
  file.addEventListener('change', () => {
    const chosen = file.files?.[0]
    file.value = ''
    if (chosen) void saveImage(chosen).then((src) => setAttrs({ src }), () => undefined)
  })
  const link = element('input', 'picture-link', empty)
  link.placeholder = 'or paste a link and press Enter'
  link.setAttribute('aria-label', 'Picture link')
  link.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (link.value.trim()) setAttrs({ src: link.value.trim() })
  })

  draw()

  return {
    dom,
    update: (next) => {
      if (next.type !== node.type || next.attrs.pending) return false
      if (cropping) finishCrop(false)
      node = next
      draw()
      return true
    },
    selectNode: () => dom.classList.add('is-selected'),
    deselectNode: () => {
      dom.classList.remove('is-selected')
      // Selection moves during a view update: keep the crop after it.
      if (cropping) queueMicrotask(() => finishCrop(true))
    },
    stopEvent: (event) => {
      const target = event.target as Node | null
      if (!target) return false
      if (cropping) return true
      if (caption.contains(target) || empty.contains(target)) return true
      return event.type === 'contextmenu' || event.type === 'dblclick'
    },
    ignoreMutation: () => true,
    destroy: () => {
      window.clearTimeout(captionTimer)
      if (cropping) {
        cropping.cleanup()
        cropping = null
      }
    },
  }
}
