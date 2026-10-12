// The pieces of a question the exam sheet edits the way a design tool does
// (ADR-0050): its block pictures and its Work Space. Pointing at one outlines
// just that piece; a click selects it, with its question, and shows its
// handles — a picture's four corners, a Work Space's bar — and a drag on a
// handle resizes it. One piece is selected at a time, held by the sheet; a
// press anywhere else, or Escape, lets it go.
//
// A picture's chrome is drawn over it, positioned from where the picture lies,
// and takes no room: the page was measured without it.

import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { clampSize, MIN_SIZE } from './picture-geometry'
import { picturePieceOf, SheetPiecesContext, SheetQuestionContext } from './sheet-pieces-context'

const CORNERS = ['nw', 'ne', 'sw', 'se'] as const
type Corner = (typeof CORNERS)[number]

type Box = { left: number; top: number; width: number; height: number }

/** Where a picture lies within the figure it is drawn in. */
function boxOf(picture: HTMLElement): Box {
  return { left: picture.offsetLeft, top: picture.offsetTop, width: picture.offsetWidth, height: picture.offsetHeight }
}

/**
 * A block picture on the exam sheet: drawn exactly as it prints, with an
 * outline while pointed at and corner handles once selected. Outside the
 * editor's sheet — a preview, a measurement — it is the picture alone.
 */
export function SheetPicture({ pictureKey, plannedSize, render }: {
  pictureKey: string
  /** The size the picture is planned at, `null` for one never sized. */
  plannedSize: number | null
  /** The picture as it prints, at `size` when one is given. */
  render: (size: number | null) => ReactNode
}) {
  const pieces = useContext(SheetPiecesContext)
  const questionId = useContext(SheetQuestionContext)
  const anchor = useRef<HTMLSpanElement | null>(null)
  const [hovered, setHovered] = useState(false)
  const [box, setBox] = useState<Box | null>(null)
  const piece = questionId ? picturePieceOf(questionId, pictureKey) : null
  // A released drag keeps its size until the sheet is planned with it, so the
  // picture never snaps back to where the drag began first.
  const held = piece ? pieces?.heldPictureSize?.(piece, plannedSize) ?? null : null
  const children = render(held)
  const selected = piece !== null && pieces?.selected === piece
  const shown = Boolean(pieces?.onResizePicture) && (hovered || selected)

  const pictureElement = () => anchor.current?.firstElementChild as HTMLElement | null | undefined

  // Pointing at the picture, and pressing it, are read from the picture
  // itself, so the chrome never takes a pointer event that would move it.
  useEffect(() => {
    const picture = pictureElement()
    if (!picture || !pieces?.onResizePicture || !piece) return
    const enter = () => setHovered(true)
    const leave = () => setHovered(false)
    const press = (event: PointerEvent) => {
      if (event.button === 0) pieces.select(piece)
    }
    picture.addEventListener('pointerenter', enter)
    picture.addEventListener('pointerleave', leave)
    picture.addEventListener('pointerdown', press)
    return () => {
      picture.removeEventListener('pointerenter', enter)
      picture.removeEventListener('pointerleave', leave)
      picture.removeEventListener('pointerdown', press)
    }
  }, [pieces, piece])

  // The chrome follows the picture while it shows: as the page reflows, and
  // as a corner is dragged.
  useLayoutEffect(() => {
    const picture = pictureElement()
    if (!shown || !picture) return
    setBox(boxOf(picture))
    const observer = new ResizeObserver(() => setBox(boxOf(picture)))
    observer.observe(picture)
    return () => observer.disconnect()
  }, [shown])

  const resize = (corner: Corner, start: ReactPointerEvent<HTMLElement>) => {
    const picture = pictureElement()
    const figure = picture?.offsetParent as HTMLElement | null | undefined
    if (!picture || !figure || !pieces?.onResizePicture || !questionId) return
    start.preventDefault()
    start.stopPropagation()
    if (piece) pieces.select(piece)
    const handle = start.currentTarget
    handle.setPointerCapture(start.pointerId)
    // Layout pixels: the sheet may be drawn scaled.
    const scale = picture.getBoundingClientRect().width / Math.max(1, picture.offsetWidth)
    const column = Math.max(1, figure.clientWidth)
    const startWidth = picture.offsetWidth
    const aspect = picture.offsetWidth / Math.max(1, picture.offsetHeight)
    const east = corner.includes('e') ? 1 : -1
    const south = corner.includes('s') ? 1 : -1
    const before = { width: picture.style.width, zoom: picture.style.zoom, maxWidth: picture.style.maxWidth }
    let width = startWidth
    const move = (event: PointerEvent) => {
      if (event.pointerId !== start.pointerId) return
      // A corner follows whichever way the pointer moved further; the picture
      // keeps its proportions either way.
      const across = (east * (event.clientX - start.clientX)) / scale
      const down = ((south * (event.clientY - start.clientY)) / scale) * aspect
      const grow = Math.abs(across) >= Math.abs(down) ? across : down
      width = Math.max(MIN_SIZE * column, Math.min(column, startWidth + grow))
      picture.style.zoom = ''
      picture.style.maxWidth = 'none'
      picture.style.width = `${width}px`
    }
    const up = (event: PointerEvent) => {
      if (event.pointerId !== start.pointerId) return
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      picture.style.maxWidth = before.maxWidth
      if (event.type === 'pointercancel' || Math.abs(width - startWidth) < 1) {
        // Nothing was set: the picture goes back as it was.
        picture.style.width = before.width
        picture.style.zoom = before.zoom
        return
      }
      // The width stays as dragged; the held size draws it from here, and the
      // plan once it has caught up.
      const size = clampSize(width / column)
      pieces.onResizePicture?.(questionId, pictureKey, size)
      if (piece) pieces.holdPictureSize?.(piece, size)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  // Anywhere but the editor's sheet — print, a preview, a measurement — the
  // picture is drawn exactly as it prints, with nothing around it.
  if (!pieces?.onResizePicture || !questionId) return <>{children}</>
  return (
    <span className="sheet-picture" data-picture-key={pictureKey} ref={anchor}>
      {children}
      {shown && box && (
        <span
          className="sheet-picture-frame"
          data-selected={selected ? 'true' : undefined}
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        >
          {selected && CORNERS.map((corner) => (
            <span
              key={corner}
              className="sheet-picture-handle"
              data-grip={corner}
              aria-hidden="true"
              onPointerDown={(event) => resize(corner, event)}
              onClick={(event) => event.stopPropagation()}
            />
          ))}
        </span>
      )}
    </span>
  )
}
