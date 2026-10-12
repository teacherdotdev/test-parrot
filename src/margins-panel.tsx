// The Exam's Page Margins, set from the Format menu (ADR-0039).
//
// Shaped like a design tool's inspector: one number field sets all four sides
// at once, and a toggle beside it opens a field for each side. When the sides
// differ the combined field says "Mixed", and setting it sets every side.
// Every field scrubs: press on its label or icon — or on the field itself
// before it has focus — and drag sideways, and the value follows the pointer
// (`scrub-number.ts`); a press that does not move is a click, and puts the
// caret in the field to type. Nothing waits for a confirm: every change is the
// Exam's at once, and the sheet behind the panel reflows to it.
//
// A floating panel rather than rows in the Format menu itself: a menu closes on
// any scroll, and a sheet that loses a page as its margins shrink scrolls under
// the pointer mid-drag. The panel stays until Escape, its close button, or a
// press outside it.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { PanelBottom, PanelLeft, PanelRight, PanelTop, SquareDashed, X } from 'lucide-react'
import type { MenuPoint } from './context-menu'
import { MarginsIcon } from './format-icons'
import {
  MARGIN_SIDES,
  MARGIN_SIDE_LABELS,
  MARGIN_STEP,
  MAX_MARGIN,
  MIN_MARGIN,
  clampMargin,
  marginsOf,
  uniformMarginOf,
  type MarginSide,
  type PageMargins,
} from './page-margins'
import { scrubRaw, scrubValue, startsScrub, steppedValue, type ScrubRange } from './scrub-number'

const SIDE_ICONS: Record<MarginSide, ReactNode> = {
  top: <PanelTop />,
  right: <PanelRight />,
  bottom: <PanelBottom />,
  left: <PanelLeft />,
}

/** What a margin field scrubs and steps through: the margins' own range and
 *  step, and tenths of an inch with Shift. */
const MARGIN_RANGE: ScrubRange = { min: MIN_MARGIN, max: MAX_MARGIN, step: MARGIN_STEP, coarseStep: 0.1 }

/** Set on the page while a field scrubs, so the cursor stays a resize arrow
 *  wherever the pointer strays. */
const SCRUBBING_CLASS = 'margins-scrubbing'

/** Set on the page while the panel is open: every sheet draws its margins. */
const MARGIN_GUIDES_CLASS = 'margins-guides'

/** A margin as the field shows it: no trailing zeros, never a float's tail. */
function formatInches(inches: number): string {
  return String(Math.round(inches * 100) / 100)
}

const VIEWPORT_MARGIN = 8

/** One press on a field's label or unfocused field, from pointer-down to up:
 *  a click until it travels far enough sideways, a scrub from then on. */
type Gesture = {
  pointerId: number
  startX: number
  lastX: number
  /** The value as dragged so far, before it is snapped to a step. */
  raw: number
  /** The value last set, so a pixel that changes nothing sets nothing. */
  shown: number
  scrubbing: boolean
  /** Whether this drag has set a value yet: its first change makes the undo
   *  step and the rest join it (`continuing`). */
  changed: boolean
}

/** One field in inches, for one side or for all, that scrubs and types. */
function MarginControl({
  label,
  icon,
  value,
  from,
  disabled,
  onChange,
}: {
  label: string
  icon: ReactNode
  /** The inches it shows, or `null` for sides that differ. */
  value: number | null
  /** Where a scrub or an arrow key starts when it shows "Mixed". */
  from: number
  disabled: boolean
  onChange: (inches: number, continuing: boolean) => void
}) {
  const input = useRef<HTMLInputElement | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const shown = value === null ? '' : formatInches(value)
  const current = value ?? from

  // A panel closed mid-drag leaves no resize cursor behind.
  useEffect(() => () => document.body.classList.remove(SCRUBBING_CLASS), [])

  const commit = (text: string) => {
    setDraft(null)
    const inches = Number.parseFloat(text)
    if (!Number.isFinite(inches)) return
    onChange(clampMargin(inches), false)
  }

  const endGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = gesture.current
    if (!drag || drag.pointerId !== event.pointerId) return null
    gesture.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    document.body.classList.remove(SCRUBBING_CLASS)
    return drag
  }

  // The same gesture on the label, the icon and the unfocused field. The
  // press keeps focus where it was, so a drag never opens the field for
  // typing; only a press that stays put does, on release.
  const scrubHandlers = {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (disabled || event.button !== 0) return
      // A focused field is being typed in: a press there places the caret.
      if (event.currentTarget === input.current && document.activeElement === input.current) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      gesture.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        lastX: event.clientX,
        raw: current,
        shown: current,
        scrubbing: false,
        changed: false,
      }
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const drag = gesture.current
      if (!drag || drag.pointerId !== event.pointerId) return
      if (!drag.scrubbing) {
        if (!startsScrub(event.clientX - drag.startX)) return
        drag.scrubbing = true
        setDraft(null)
        document.body.classList.add(SCRUBBING_CLASS)
      }
      drag.raw = scrubRaw(drag.raw, event.clientX - drag.lastX, event.shiftKey, MARGIN_RANGE)
      drag.lastX = event.clientX
      const next = scrubValue(drag.raw, event.shiftKey, MARGIN_RANGE)
      if (next === drag.shown) return
      drag.shown = next
      onChange(next, drag.changed)
      drag.changed = true
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      const drag = endGesture(event)
      if (drag && !drag.scrubbing) {
        input.current?.focus()
        input.current?.select()
      }
    },
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => { endGesture(event) },
  }

  return (
    <div className="margins-row" data-disabled={disabled || undefined}>
      <span className="margins-row-label" title={`Drag to change ${label.toLowerCase()}`} {...scrubHandlers}>
        {label}
      </span>
      <span className="margins-field">
        <span className="margins-row-icon" aria-hidden="true" {...scrubHandlers}>{icon}</span>
        <input
          ref={input}
          type="text"
          inputMode="decimal"
          className="margins-input"
          aria-label={`${label} margin in inches`}
          aria-valuetext={value === null ? 'Mixed' : `${formatInches(value)} inches`}
          value={draft ?? shown}
          placeholder={value === null ? 'Mixed' : undefined}
          disabled={disabled}
          {...scrubHandlers}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => { if (draft !== null) commit(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit(event.currentTarget.value)
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault()
              setDraft(null)
              onChange(steppedValue(current, event.key === 'ArrowUp' ? 1 : -1, event.shiftKey, MARGIN_RANGE), false)
            } else if (event.key === 'Escape' && draft !== null) {
              // The first Escape abandons what was typed; the next closes.
              event.stopPropagation()
              setDraft(null)
            }
          }}
        />
        {(value !== null || draft !== null) && <span className="margins-unit" aria-hidden="true">in</span>}
      </span>
    </div>
  )
}

export function MarginsPanel({
  point,
  margins,
  disabled = false,
  onChange,
  onClose,
}: {
  point: MenuPoint
  margins: PageMargins | undefined
  disabled?: boolean
  /** Sets `sides` to `inches`; `continuing` a drag that already made its step. */
  onChange: (sides: readonly MarginSide[], inches: number, continuing: boolean) => void
  onClose: () => void
}) {
  const panel = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<MenuPoint>(point)
  const resolved = marginsOf(margins)
  const uniform = uniformMarginOf(margins)
  // Open on each side when the sides already differ: that is what there is
  // to see. Otherwise the one control is the whole of it until asked.
  const [expanded, setExpanded] = useState(uniform === null)

  // Clamped into the viewport before it paints, like the menu it came from.
  useLayoutEffect(() => {
    const element = panel.current
    if (!element) return
    const maxX = window.innerWidth - element.offsetWidth - VIEWPORT_MARGIN
    const maxY = window.innerHeight - element.offsetHeight - VIEWPORT_MARGIN
    setPosition({
      x: Math.max(VIEWPORT_MARGIN, Math.min(point.x, maxX)),
      y: Math.max(VIEWPORT_MARGIN, Math.min(point.y, maxY)),
    })
  }, [point, expanded])

  // The panel itself takes focus, not a field: a focused field types rather
  // than scrubs, and Escape still closes from here.
  useEffect(() => {
    panel.current?.focus()
  }, [])

  // While the panel is open every page draws its margins as a dashed line,
  // following each change as it is dragged or typed, so the teacher sees where
  // the edge of the text will fall rather than only the reflow it causes.
  useEffect(() => {
    document.body.classList.add(MARGIN_GUIDES_CLASS)
    return () => document.body.classList.remove(MARGIN_GUIDES_CLASS)
  }, [])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [onClose])

  return createPortal(
    <div
      ref={panel}
      className="margins-panel"
      role="dialog"
      aria-label="Margins"
      tabIndex={-1}
      style={{ left: position.x, top: position.y }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
    >
      <div className="margins-panel-header">
        <span className="margins-panel-title">
          <MarginsIcon className="margins-panel-icon" />
          Margins
        </span>
        <button
          type="button"
          className="margins-panel-close"
          aria-label="Close margins"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
      </div>
      <div className="margins-combined">
        <MarginControl
          label="All sides"
          icon={<MarginsIcon />}
          value={uniform}
          // Mixed sides scrub from their average, so a drag either way is a
          // real change for every side.
          from={clampMargin(MARGIN_SIDES.reduce((sum, side) => sum + resolved[side], 0) / MARGIN_SIDES.length)}
          disabled={disabled}
          onChange={(inches, continuing) => onChange(MARGIN_SIDES, inches, continuing)}
        />
        <button
          type="button"
          className="margins-expand"
          aria-label="Set each side"
          title="Set each side"
          aria-expanded={expanded}
          aria-pressed={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          <SquareDashed aria-hidden="true" />
        </button>
      </div>
      {expanded && (
        <div className="margins-sides" role="group" aria-label="Each side">
          {MARGIN_SIDES.map((side) => (
            <MarginControl
              key={side}
              label={MARGIN_SIDE_LABELS[side]}
              icon={SIDE_ICONS[side]}
              value={resolved[side]}
              from={resolved[side]}
              disabled={disabled}
              onChange={(inches, continuing) => onChange([side], inches, continuing)}
            />
          ))}
        </div>
      )}
    </div>,
    document.body,
  )
}
