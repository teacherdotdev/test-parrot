// A question's content, rendered as plain elements.
//
// The exam page is a view of the printed test, not an editor: nothing here is
// contenteditable and no ProseMirror instance is involved. The editor's schema
// is still the source of truth for what a node means, so the node names below
// are the Crepe/Milkdown ones, and anything unrecognised falls back to its
// children rather than disappearing.

import { useContext, type CSSProperties, type ReactNode } from 'react'
import katex from 'katex'
import { isCentred } from './centring'
import { pendingImageOf, type PendingImageReference, type ProseMirrorJSON } from './question-doc'
import { keptAspect, legacyRatioOf, pictureCropOf, pictureKey as pictureKeyOf, pictureSizeOf, type PictureCrop } from './picture-geometry'
import { SheetPicture } from './sheet-pieces'
import { PictureSlotContext } from './picture-slot'
import { BLANK_LINE } from './blank'

function attrsOf(node: ProseMirrorJSON): Record<string, unknown> {
  const attrs = node.attrs
  return typeof attrs === 'object' && attrs !== null
    ? (attrs as Record<string, unknown>)
    : {}
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function childrenOf(node: ProseMirrorJSON): ProseMirrorJSON[] {
  return Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []
}

function renderAll(node: ProseMirrorJSON): ReactNode[] {
  return childrenOf(node).map((child, index) => renderNode(child, index))
}

// KaTeX renders to a string of its own markup; the expression itself comes from
// the teacher's own document.
function Tex({ value, display }: { value: string; display: boolean }) {
  const html = katex.renderToString(value, {
    throwOnError: false,
    displayMode: display,
  })
  return (
    <span
      className={display ? 'doc-math doc-math--block' : 'doc-math'}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

// A block picture at its Authored Image Size (see `picture-geometry.ts`).
//
// This has to be plain markup, with no script behind it: the exam page is
// paginated by measuring this same markup off-screen (`dom-measure.ts`), where
// no load handler ever runs.
//
// A sized picture is its share of the column. A Picture Crop is a window that
// share wide, shaped like the part it keeps, with the whole picture placed
// inside it so only that part shows — the crop's own record of the picture's
// size is what lets the window take its shape before the picture loads.
//
// A picture with only Crepe's legacy ratio uses `zoom`, the one CSS property
// that scales a picture's own size while leaving it in the flow; it leaves
// percentages alone, so the cap is the column scaled by the same ratio, which
// is exactly "the size it fit at, times the ratio".
const percent = (value: number) => `${Math.round(value * 1e4) / 1e2}%`

function legacyImageStyle(ratio: number): CSSProperties | undefined {
  return ratio === 1 ? undefined : { zoom: ratio, maxWidth: `calc(100% * ${Math.min(1, ratio)})` }
}

function croppedPicture(src: string, alt: string, size: number, crop: PictureCrop): ReactNode {
  const width = crop.right - crop.left
  const height = crop.bottom - crop.top
  return (
    <span className="doc-crop" style={{ width: percent(size), aspectRatio: String(Math.round(keptAspect(crop) * 1e4) / 1e4) }}>
      <img
        src={src}
        alt={alt}
        style={{
          width: percent(1 / width),
          height: percent(1 / height),
          left: percent(-crop.left / width),
          top: percent(-crop.top / height),
        }}
      />
    </span>
  )
}

function blockPicture(attrs: Record<string, unknown>, alt: string): ReactNode {
  const src = text(attrs.src)
  const size = pictureSizeOf(attrs)
  const crop = pictureCropOf(attrs)
  if (crop) return croppedPicture(src, alt, size ?? 1, crop)
  if (size !== null) return <img src={src} alt={alt} style={{ width: percent(size) }} />
  return <img src={src} alt={alt} style={legacyImageStyle(legacyRatioOf(attrs))} />
}

function withMarks(node: ProseMirrorJSON, content: ReactNode): ReactNode {
  const marks = Array.isArray(node.marks)
    ? (node.marks as ProseMirrorJSON[])
    : []
  return marks.reduce<ReactNode>((inner, mark) => {
    const attrs = attrsOf(mark)
    switch (mark.type) {
      case 'strong':
        return <strong>{inner}</strong>
      case 'emphasis':
        return <em>{inner}</em>
      case 'inlineCode':
        return <code>{inner}</code>
      case 'strike_through':
        return <s>{inner}</s>
      case 'subscript':
        return <sub>{inner}</sub>
      case 'superscript':
        return <sup>{inner}</sup>
      case 'link':
        return (
          <a href={text(attrs.href)} title={text(attrs.title) || undefined}>
            {inner}
          </a>
        )
      default:
        return inner
    }
  }, content)
}

function renderNode(node: ProseMirrorJSON, key: number): ReactNode {
  const attrs = attrsOf(node)
  // A Centred block says so on its element; the stylesheet centres it.
  const align = isCentred(node) ? 'center' : undefined
  switch (node.type) {
    case 'text':
      return <span key={key}>{withMarks(node, text(node.text))}</span>
    case 'hardbreak':
      return <br key={key} />
    case 'paragraph': {
      const content = renderAll(node)
      // ProseMirror gives an empty paragraph a trailing break so it still
      // occupies a line in the editor. Reproduce that in the read-only view;
      // an empty <p> alone has no line box and adjacent margins collapse.
      return <p key={key} data-align={align}>{content.length > 0 ? content : <br />}</p>
    }
    case 'heading': {
      const level = Math.min(Math.max(Number(attrs.level) || 1, 1), 6)
      const Heading = `h${level}` as 'h1'
      return <Heading key={key}>{renderAll(node)}</Heading>
    }
    case 'blockquote':
      return <blockquote key={key}>{renderAll(node)}</blockquote>
    case 'bullet_list':
      return <ul key={key}>{renderAll(node)}</ul>
    case 'ordered_list':
      return (
        <ol key={key} start={Number(attrs.order) || undefined}>
          {renderAll(node)}
        </ol>
      )
    case 'list_item':
      return (
        <li key={key} data-checked={attrs.checked === true ? 'true' : undefined}>
          {renderAll(node)}
        </li>
      )
    case 'code_block': {
      const source = childrenOf(node)
        .map((child) => text(child.text))
        .join('')
      // Crepe stores display maths as a latex code block.
      if (text(attrs.language).toLowerCase() === 'latex') {
        return <Tex key={key} value={source} display />
      }
      return (
        <pre key={key}>
          <code>{source}</code>
        </pre>
      )
    }
    case 'math_inline':
      return <Tex key={key} value={text(attrs.value)} display={false} />
    // A Blank prints as its line, never its answer (see `blank.ts`).
    case 'blank':
      return <span key={key} className="doc-blank">{BLANK_LINE}</span>
    case 'hr':
      return <hr key={key} />
    case 'image': {
      const pending = pendingImageOf(node)
      return (
        <Slot key={key} pictureKey={attrs.pictureKey} inline>
          {pending
            ? <PictureNeeded pending={pending} inline />
            : <img src={text(attrs.src)} alt={text(attrs.alt)} title={text(attrs.title) || undefined} />}
        </Slot>
      )
    }
    case 'image-block': {
      const caption = text(attrs.caption)
      const pending = pendingImageOf(node)
      return (
        <figure key={key} className="doc-figure" data-align={align}>
          <Slot pictureKey={attrs.pictureKey}>
            {pending
              ? <PictureNeeded pending={pending} />
              : <SheetPicture
                  pictureKey={pictureKeyOf(attrs)}
                  plannedSize={pictureSizeOf(attrs)}
                  render={(size) => blockPicture(size === null ? attrs : { ...attrs, size }, caption)}
                />}
          </Slot>
          {caption && <figcaption>{caption}</figcaption>}
        </figure>
      )
    }
    // Two or three equal Panels across the line, centred against one another;
    // see `.doc-side-by-side` in styles.css.
    case 'sideBySide': {
      const panels = childrenOf(node)
      return (
        <div
          key={key}
          className="doc-side-by-side"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, panels.length)}, minmax(0, 1fr))` }}
        >
          {panels.map((panel, index) => (
            <div key={index} className="doc-panel">
              {renderAll(panel)}
            </div>
          ))}
        </div>
      )
    }
    case 'sideBySidePanel':
      return <div key={key} className="doc-panel">{renderAll(node)}</div>
    case 'table':
      return (
        <table key={key} className="doc-table" data-align={align}>
          <tbody>{renderAll(node)}</tbody>
        </table>
      )
    case 'table_header_row':
    case 'table_row':
      return <tr key={key}>{renderAll(node)}</tr>
    case 'table_header':
      return <th key={key}>{renderAll(node)}</th>
    case 'table_cell':
      return <td key={key}>{renderAll(node)}</td>
    default:
      return <div key={key}>{renderAll(node)}</div>
  }
}

/** A picture a preview lets the teacher change, drawn the way the preview
 *  says; anywhere else, just the picture. */
function Slot({ pictureKey, inline = false, children }: { pictureKey: unknown; inline?: boolean; children: ReactNode }) {
  const slot = useContext(PictureSlotContext)
  return <>{slot && typeof pictureKey === 'string' ? slot(pictureKey, children, inline) : children}</>
}

/** A Pending Image, read-only: a clear box in the picture's place saying
 *  which picture belongs there. */
export function PictureNeeded({ pending, inline = false }: { pending: PendingImageReference; inline?: boolean }) {
  const named = 'image' in pending ? `IMG ${pending.image}` : `page ${pending.page}`
  return (
    <span className="picture-needed" data-inline={inline ? 'true' : undefined} role="img" aria-label={`Picture needed: ${named}`}>
      Picture needed
      <small>{named}</small>
    </span>
  )
}

/** The blocks of a question document, rendered read-only. */
export function DocView({
  content,
  className,
}: {
  content: readonly ProseMirrorJSON[]
  className?: string
}) {
  return (
    <div className={['doc-content', className].filter(Boolean).join(' ')}>
      {content.map((node, index) => renderNode(node, index))}
    </div>
  )
}
