// A context menu: the floating list of actions a right-click puts under the
// cursor, and the same list the question's grip opens beside itself.
//
// Hand-rolled rather than pulled in as a dependency, but modelled on shadcn/ui's
// ContextMenu (which wraps Radix) — the same anatomy, items, separators, labels
// and a radio group, and the same behaviour: open at a point, flip rather than
// overflow the viewport, take the keyboard, and close on Escape, on a click
// outside, or as soon as something is chosen.
//
// It portals onto `document.body` and positions itself `fixed`, because the
// sheet it is opened over is `overflow: hidden` and would otherwise clip it.
// That is the one structural difference from the gutter this replaced, which
// could stay inside the page precisely because it never left the sheet.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'

/** Where the menu should appear, in viewport coordinates. */
export type MenuPoint = { x: number; y: number }

/** Which way the menu hangs from its point. `'right'` puts its left edge on
 * the point and grows rightwards, the way a menu falls under a right-click;
 * `'left'` puts its right edge there and grows leftwards, for a menu opened
 * from a control it should sit beside rather than cover. Only the menu knows
 * how wide it is, so this is its decision to make, not the caller's. */
export type MenuSide = 'right' | 'left'

export type MenuItem =
  // Actions use the leading slot for their icon. Radio rows keep that slot for
  // the selected dot and may put a format-preview icon beside it.
  | {
      kind: 'action'
      label: string
      onSelect: () => void
      icon?: ReactNode
      destructive?: boolean
      disabled?: boolean
    }
  | {
      kind: 'radio'
      label: string
      checked: boolean
      onSelect: () => void
      icon?: ReactNode
      /** A line under the label saying what choosing it does. */
      description?: string
      /** A small decorative picture of what choosing it looks like, drawn in
       *  place of the icon, wider than one; the label still says it. */
      preview?: ReactNode
    }
  // An option that is on or off on its own, beside rather than among a set of
  // radios. Its leading slot is its icon; the tick sits where a radio's dot does.
  | {
      kind: 'checkbox'
      label: string
      checked: boolean
      onSelect: () => void
      icon?: ReactNode
      disabled?: boolean
    }
  | {
      kind: 'submenu'
      label: string
      items: readonly SubmenuItem[]
      icon?: ReactNode
      /** What is chosen in it now, shown beside the label. */
      value?: string
      /** Shown but not openable, with `description` saying why. */
      disabled?: boolean
      /** A line under the label, such as why it is disabled. */
      description?: string
    }
  | { kind: 'label'; label: string }
  | { kind: 'separator' }

type SubmenuItem = Extract<MenuItem, { kind: 'action' | 'radio' }>

/** The rows a keyboard can land on. Labels and separators are skipped over. */
function isFocusable(item: MenuItem): boolean {
  return (item.kind === 'action' || item.kind === 'radio' || item.kind === 'checkbox' || item.kind === 'submenu')
    && !('disabled' in item && item.disabled)
}

/** The last row End should land on. Written out rather than `findLastIndex`,
 * which this project's TypeScript lib does not carry. */
function lastFocusableIndex(items: readonly MenuItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (isFocusable(items[index]!)) return index
  }
  return -1
}

/** A row's label, and the line under it that says what choosing it does. */
function ItemLabel({ label, description }: { label: string; description?: string }) {
  if (!description) return <span className="context-menu-item-label">{label}</span>
  return (
    <span className="context-menu-item-label">
      {label}
      <span className="context-menu-item-description">{description}</span>
    </span>
  )
}

// How close to the viewport edge the menu may sit before it is pushed back in.
const VIEWPORT_MARGIN = 8
/** How long a hover-open submenu outlives the pointer leaving it. A hand
 *  heading for the flyout rarely travels straight across: it clips the row
 *  below, or the gap beside it, on the way. */
const SUBMENU_CLOSE_DELAY = 300

export function ContextMenu({
  point,
  side = 'right',
  items,
  ariaLabel,
  onClose,
}: {
  point: MenuPoint
  side?: MenuSide
  items: readonly MenuItem[]
  ariaLabel: string
  onClose: () => void
}) {
  const menu = useRef<HTMLDivElement | null>(null)
  const itemElements = useRef<(HTMLButtonElement | null)[]>([])
  const submenuElements = useRef<(HTMLButtonElement | null)[]>([])
  const [position, setPosition] = useState<MenuPoint>(point)
  const [active, setActive] = useState(() => items.findIndex(isFocusable))
  const [openSubmenu, setOpenSubmenu] = useState<number | null>(null)
  const [submenuActive, setSubmenuActive] = useState(0)
  const closeTimer = useRef<number | undefined>(undefined)
  const cancelSubmenuClose = () => window.clearTimeout(closeTimer.current)
  const closeSubmenuSoon = () => {
    cancelSubmenuClose()
    closeTimer.current = window.setTimeout(() => setOpenSubmenu(null), SUBMENU_CLOSE_DELAY)
  }
  useEffect(() => cancelSubmenuClose, [])

  // Placed before the browser paints, so the menu is never seen in the wrong
  // spot. It hangs the way `side` asks, flips to the other side rather than
  // run off the viewport, drops above the point rather than off the bottom,
  // and is clamped either way so it can never end up outside entirely.
  useLayoutEffect(() => {
    const element = menu.current
    if (!element) return
    // `offsetWidth`/`offsetHeight`, not `getBoundingClientRect`: the open
    // animation starts at `scale(0.96)` and the rect would report the
    // transformed box, placing a left-hanging menu 4% of its width off.
    const { offsetWidth: width, offsetHeight: height } = element
    const maxX = window.innerWidth - width - VIEWPORT_MARGIN
    const maxY = window.innerHeight - height - VIEWPORT_MARGIN
    const wanted = side === 'left' ? point.x - width : point.x
    const flipped = side === 'left' ? point.x : point.x - width
    const fits = wanted >= VIEWPORT_MARGIN && wanted <= maxX
    const x = fits ? wanted : flipped
    const y = point.y > maxY ? point.y - height : point.y
    setPosition({
      x: Math.max(VIEWPORT_MARGIN, Math.min(x, maxX)),
      y: Math.max(VIEWPORT_MARGIN, Math.min(y, maxY)),
    })
  }, [point, side])

  // Roving tabindex: exactly one row is tabbable and it is the one that holds
  // focus, so arrow keys move a real focus ring rather than a painted-on one.
  useEffect(() => {
    if (active < 0) {
      menu.current?.focus()
      return
    }
    itemElements.current[active]?.focus()
  }, [active])

  useEffect(() => {
    if (openSubmenu === null) return
    setSubmenuActive(0)
    submenuElements.current[0]?.focus()
  }, [openSubmenu])

  useEffect(() => {
    // Capture, so the menu is dismissed before the click reaches whatever is
    // underneath it: closing the menu must never also select the question it
    // was opened on.
    const onPointerDown = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose()
    }
    // Any scroll — the window's or the workspace's — leaves the menu stranded
    // away from what it was opened on, so it closes rather than drifting.
    document.addEventListener('pointerdown', onPointerDown, true)
    // The menu takes focus as it opens, and focusing it can scroll an ancestor
    // that was not showing the spot it opened at. That scroll is the menu's own
    // doing rather than the teacher moving the page out from under it, so
    // closing on scroll starts a frame later — otherwise a menu opened low on a
    // scrollable page closes itself the instant it appears.
    const frame = requestAnimationFrame(() => {
      window.addEventListener('scroll', onClose, true)
      window.addEventListener('resize', onClose)
    })
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const step = (from: number, delta: number): number => {
    const total = items.length
    for (let moved = 1; moved <= total; moved += 1) {
      const index = (((from + delta * moved) % total) + total) % total
      if (isFocusable(items[index]!)) return index
    }
    return from
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActive((index) => step(index, 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setActive((index) => step(index, -1))
        break
      case 'Home':
        event.preventDefault()
        setActive(items.findIndex(isFocusable))
        break
      case 'End':
        event.preventDefault()
        setActive(lastFocusableIndex(items))
        break
      case 'Escape':
        // Stopped here: the question dialog and the print panel both listen
        // for Escape further up, and closing the menu is the whole of what
        // this key means while it is open.
        event.preventDefault()
        event.stopPropagation()
        onClose()
        break
      case 'ArrowRight': {
        const item = items[active]
        if (item?.kind !== 'submenu') break
        event.preventDefault()
        setOpenSubmenu(active)
        break
      }
      case 'Tab':
        event.preventDefault()
        onClose()
        break
    }
  }

  const onSubmenuKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
    items: readonly SubmenuItem[],
  ) => {
    event.stopPropagation()
    const last = items.length - 1
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setSubmenuActive((index) => (index + 1) % items.length)
        break
      case 'ArrowUp':
        event.preventDefault()
        setSubmenuActive((index) => (index - 1 + items.length) % items.length)
        break
      case 'Home':
        event.preventDefault()
        setSubmenuActive(0)
        break
      case 'End':
        event.preventDefault()
        setSubmenuActive(last)
        break
      case 'ArrowLeft':
      case 'Escape':
        event.preventDefault()
        setOpenSubmenu(null)
        itemElements.current[active]?.focus()
        break
      case 'Tab':
        event.preventDefault()
        onClose()
        break
    }
  }

  useEffect(() => {
    if (openSubmenu === null) return
    submenuElements.current[submenuActive]?.focus()
  }, [openSubmenu, submenuActive])

  return createPortal(
    <div
      ref={menu}
      className="context-menu"
      role="menu"
      aria-label={ariaLabel}
      tabIndex={-1}
      data-side={side}
      style={{ left: position.x, top: position.y }}
      onKeyDown={onKeyDown}
      // A right-click inside the menu is a miss, not a request for a second
      // menu on top of this one.
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => {
        if (item.kind === 'separator') {
          return <div key={index} className="context-menu-separator" role="separator" />
        }
        if (item.kind === 'label') {
          return (
            <div key={index} className="context-menu-label">
              {item.label}
            </div>
          )
        }
        if (item.kind === 'submenu') {
          const open = openSubmenu === index
          return (
            <div
              key={index}
              className="context-menu-submenu"
              onMouseEnter={() => {
                if (item.disabled) return
                cancelSubmenuClose()
                setActive(index)
                setOpenSubmenu(index)
              }}
              // The wrapper contains both the parent row and its flyout, so
              // crossing into the submenu does not close it. Leaving that
              // combined hit area does, after a grace period: a hover-open
              // submenu must not linger over the next menu action, but nor
              // should it vanish under a hand still on its way there.
              onMouseLeave={closeSubmenuSoon}
            >
              <button
                ref={(element) => {
                  itemElements.current[index] = element
                }}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={open}
                className="context-menu-item"
                tabIndex={index === active ? 0 : -1}
                disabled={item.disabled}
                onFocus={() => setActive(index)}
                // Opens, never toggles: a pointer has already opened it by
                // hovering on its way to the click, which would otherwise
                // close it again under the hand that asked for it.
                onClick={() => setOpenSubmenu(index)}
              >
                <span className="context-menu-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <ItemLabel label={item.label} description={item.description} />
                {item.value && <span className="context-menu-item-value">{item.value}</span>}
                <span className="context-menu-submenu-arrow" aria-hidden="true">›</span>
              </button>
              {open && (
                <div
                  className="context-submenu"
                  role="menu"
                  aria-label={item.label}
                  onKeyDown={(event) => onSubmenuKeyDown(event, item.items)}
                >
                  {item.items.map((child, childIndex) => (
                    <button
                      key={childIndex}
                      ref={(element) => {
                        submenuElements.current[childIndex] = element
                      }}
                      type="button"
                      role={child.kind === 'radio' ? 'menuitemradio' : 'menuitem'}
                      aria-checked={child.kind === 'radio' ? child.checked : undefined}
                      className="context-menu-item"
                      tabIndex={childIndex === submenuActive ? 0 : -1}
                      onMouseEnter={() => setSubmenuActive(childIndex)}
                      onClick={() => {
                        child.onSelect()
                        onClose()
                      }}
                    >
                      {child.kind === 'radio' && child.preview ? (
                        <span className="context-menu-preview" aria-hidden="true">
                          {child.preview}
                        </span>
                      ) : (
                        <span className="context-menu-icon" aria-hidden="true">
                          {child.icon}
                        </span>
                      )}
                      <ItemLabel
                        label={child.label}
                        description={child.kind === 'radio' ? child.description : undefined}
                      />
                      {child.kind === 'radio' && (
                        <span className="context-menu-radio-indicator" aria-hidden="true">
                          {child.checked && <span className="context-menu-dot" />}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        }
        const destructive = item.kind === 'action' && item.destructive
        return (
          <button
            key={index}
            ref={(element) => {
              itemElements.current[index] = element
            }}
            type="button"
            role={
              item.kind === 'radio'
                ? 'menuitemradio'
                : item.kind === 'checkbox'
                  ? 'menuitemcheckbox'
                  : 'menuitem'
            }
            aria-checked={item.kind === 'radio' || item.kind === 'checkbox' ? item.checked : undefined}
            className={
              destructive
                ? 'context-menu-item context-menu-item--destructive'
                : 'context-menu-item'
            }
            tabIndex={index === active ? 0 : -1}
            disabled={'disabled' in item && item.disabled}
            // Hovering moves the keyboard's place too, so the mouse and the
            // arrow keys never disagree about which row is next. A sibling row
            // also ends a hover-open submenu, once the pointer has plainly
            // settled there; otherwise its flyout outlives the row that
            // opened it.
            onMouseEnter={() => {
              if ('disabled' in item && item.disabled) return
              setActive(index)
              closeSubmenuSoon()
            }}
            onClick={() => {
              item.onSelect()
              onClose()
            }}
          >
            {item.kind === 'radio' && item.preview ? (
              <span className="context-menu-preview" aria-hidden="true">{item.preview}</span>
            ) : (
              <span
                className={item.kind === 'radio' ? 'context-menu-format-icon' : 'context-menu-icon'}
                aria-hidden="true"
              >
                {item.icon}
              </span>
            )}
            <ItemLabel
              label={item.label}
              description={item.kind === 'radio' ? item.description : undefined}
            />
            {item.kind === 'radio' && (
              <span className="context-menu-radio-indicator" aria-hidden="true">
                {item.checked && <span className="context-menu-dot" />}
              </span>
            )}
            {item.kind === 'checkbox' && (
              <span className="context-menu-radio-indicator" aria-hidden="true">
                {item.checked && <Check className="context-menu-check" />}
              </span>
            )}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
