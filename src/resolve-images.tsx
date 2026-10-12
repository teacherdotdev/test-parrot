import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Crop, ImagePlus, Images, Trash2, Upload } from 'lucide-react'
import type { PendingImageOccurrence } from './pending-images'
import {
  cropChoice,
  hasPages,
  originName,
  pendingName,
  pictureSource,
  placeName,
  sharingTag,
  tagChoice,
  tagPicture,
  uploadChoice,
  type ResolvedPicture,
  type Resolutions,
  type ResolvingSource,
} from './resolved-pictures'
import type { ImageTag, PageBox } from './source-document'
import { namedPage, usePictureChoice, type PictureChoice } from './picture-choice'

const SOURCE_FILE_TYPES = 'application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx'

/**
 * Resolve Images: where a teacher confirms or replaces the picture for each
 * Pending Image — the tagged picture from their Source Document, another of
 * its pictures, a crop of any of its pages, or an uploaded file — or leaves it
 * for later. An import shows it beside the picture in its preview; afterwards
 * it is reopened from a “picture needed” block as a list. It only decides:
 * what it returns is a picture per Pending Image, which the caller writes.
 */

function statusOf(occurrence: PendingImageOccurrence, picture: ResolvedPicture | undefined, source: ResolvingSource | null) {
  if (picture) return originName(picture, source)
  const { pending } = occurrence
  if ('image' in pending && source && !source.tags.some(({ tag }) => tag === pending.image)) {
    return `Picture needed: ${source.fileName} has no IMG ${pending.image}`
  }
  return `Picture needed (${pendingName(pending)})`
}

export function TagChooser({
  source,
  page,
  current,
  onChoose,
}: {
  source: ResolvingSource
  page: number
  /** The tag whose picture is in place now. */
  current?: number
  onChoose: (tag: ImageTag) => void
}) {
  const [thumbnails, setThumbnails] = useState<ReadonlyMap<number, string>>(new Map())
  useEffect(() => {
    let live = true
    void Promise.all(
      source.tags.map(async (tag) => [tag.tag, pictureSource(await tagPicture(source, tag))] as const),
    ).then((entries) => { if (live) setThumbnails(new Map(entries)) }, () => undefined)
    return () => { live = false }
  }, [source])
  const pages = [...new Set(source.tags.map((tag) => tag.page))].sort((a, b) =>
    a === page ? -1 : b === page ? 1 : a - b,
  )
  if (pages.length === 0) return <p className="resolve-image-note">{source.fileName} has no tagged pictures. Crop one from a page instead.</p>
  return <div className="resolve-image-chooser" role="group" aria-label={`Pictures in ${source.fileName}`}>
    {pages.map((number) => (
      <section key={number}>
        {hasPages(source) && <h5>Page {number}</h5>}
        <div>
          {source.tags.filter((tag) => tag.page === number).map((tag) => (
            <button
              key={tag.tag}
              type="button"
              aria-label={`Use IMG ${tag.tag}`}
              aria-pressed={current === tag.tag}
              onClick={() => onChoose(tag)}
            >
              {thumbnails.get(tag.tag) ? <img src={thumbnails.get(tag.tag)} alt="" /> : <span className="resolve-image-thumb-loading" />}
              <span>IMG {tag.tag}</span>
            </button>
          ))}
        </div>
      </section>
    ))}
  </div>
}

export function PageCropper({
  source,
  startPage,
  onCrop,
  onCancel,
}: {
  source: ResolvingSource
  startPage: number
  onCrop: (page: number, box: PageBox) => void
  onCancel: () => void
}) {
  const [page, setPage] = useState(startPage)
  const [image, setImage] = useState<string | null>(null)
  const [box, setBox] = useState<PageBox | null>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let live = true
    setImage(null)
    setBox(null)
    void import('./source-document')
      .then(({ renderSourcePage, browserRaster }) => renderSourcePage(source.bytes, page, browserRaster))
      .then((png) => {
        if (!live) return
        const blob = new Blob([png.slice().buffer as ArrayBuffer], { type: 'image/png' })
        setImage(URL.createObjectURL(blob))
      }, () => undefined)
    return () => { live = false }
  }, [source, page])
  useEffect(() => () => { if (image) URL.revokeObjectURL(image) }, [image])

  const at = (event: ReactPointerEvent) => {
    const rect = frame.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1000, ((event.clientX - rect.left) / rect.width) * 1000)),
      y: Math.max(0, Math.min(1000, ((event.clientY - rect.top) / rect.height) * 1000)),
    }
  }
  const extend = (event: ReactPointerEvent) => {
    if (!drag.current) return
    const point = at(event)
    setBox({
      left: Math.min(drag.current.x, point.x),
      right: Math.max(drag.current.x, point.x),
      top: Math.min(drag.current.y, point.y),
      bottom: Math.max(drag.current.y, point.y),
    })
  }
  const usable = box && box.right - box.left > 5 && box.bottom - box.top > 5
  return <div className="resolve-image-cropper" role="group" aria-label="Crop a picture from a page">
    <div className="resolve-image-cropper-bar">
      <button type="button" className="secondary-button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous page</button>
      <span>Page {page} of {source.pageCount}</span>
      <button type="button" className="secondary-button" disabled={page >= source.pageCount} onClick={() => setPage(page + 1)}>Next page</button>
    </div>
    <p className="resolve-image-note">Drag a box around the picture.</p>
    <div
      ref={frame}
      className="resolve-image-page"
      aria-label={`Page ${page}`}
      role="img"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = at(event)
        setBox(null)
      }}
      onPointerMove={extend}
      onPointerUp={(event) => { extend(event); drag.current = null }}
    >
      {image ? <img src={image} alt="" draggable={false} /> : <p role="status">Rendering page {page}…</p>}
      {box && <span
        className="resolve-image-box"
        style={{
          left: `${box.left / 10}%`,
          top: `${box.top / 10}%`,
          width: `${(box.right - box.left) / 10}%`,
          height: `${(box.bottom - box.top) / 10}%`,
        }}
      />}
    </div>
    <div className="resolve-image-cropper-bar">
      <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
      <button type="button" className="secondary-button" onClick={() => onCrop(page, { left: 0, top: 0, right: 1000, bottom: 1000 })}>Use the whole page</button>
      <button type="button" className="primary-button" disabled={!usable} onClick={() => box && onCrop(page, box)}>Use this crop</button>
    </div>
  </div>
}

/**
 * Everything a teacher can do about one Pending Image: see where its picture
 * came from, pick another of the Source Document's pictures, crop one from a
 * page, upload one, or leave it for later.
 */
export function PictureChoices({
  occurrence,
  occurrences,
  source,
  resolutions,
  choice,
  onCrop,
  onSourceFile,
  chooserOpen = true,
  described = true,
}: {
  occurrence: PendingImageOccurrence
  occurrences: readonly PendingImageOccurrence[]
  source: ResolvingSource | null
  resolutions: Resolutions
  choice: PictureChoice
  /** Where cropping happens, when it is not here: a page is best cropped
   *  somewhere larger than a list row or a rail. */
  onCrop?: () => void
  /** Offered when there is no Source Document: the teacher drops it again to
   *  take pictures from it. */
  onSourceFile?: (file: File) => void
  chooserOpen?: boolean
  /** Whether to say what the picture shows, when nothing around it does. */
  described?: boolean
}) {
  const [choosing, setChoosing] = useState(chooserOpen)
  const [cropping, setCropping] = useState(false)
  const picture = resolutions.get(occurrence.key)
  const others = sharingTag(occurrences, occurrence)
  const name = placeName(occurrence)
  const tags = source?.tags.length ?? 0
  return <div className="picture-choices">
    {described && (occurrence.caption || occurrence.alt) && <p className="resolve-image-description">{occurrence.caption || occurrence.alt}</p>}
    <p className="resolve-image-status">{choice.working === occurrence.key ? 'Working…' : statusOf(occurrence, picture, source)}</p>
    {others.length > 0 && (
      <label className="resolve-image-share">
        <input
          type="checkbox"
          checked={choice.shared(occurrence)}
          onChange={(event) => choice.share(occurrence, event.target.checked)}
        />
        <span>Change the {others.length === 1 ? 'other place' : `${others.length} other places`} that {others.length === 1 ? 'uses' : 'use'} {pendingName(occurrence.pending)} too</span>
      </label>
    )}
    {!source && onSourceFile && (
      <label className="resolve-images-source">
        <ImagePlus aria-hidden="true" />
        <span>Drop your original PDF or Word document here to take pictures from it, or upload this picture.</span>
        <input
          type="file"
          accept={SOURCE_FILE_TYPES}
          aria-label="Your original test"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) onSourceFile(file)
          }}
        />
      </label>
    )}
    {source && tags > 0 && !chooserOpen && (
      <button type="button" className="secondary-button" aria-expanded={choosing} onClick={() => setChoosing(!choosing)}>
        <Images aria-hidden="true" />{picture ? 'Choose another picture' : 'Choose a picture'}
      </button>
    )}
    {source && choosing && (
      <TagChooser
        source={source}
        page={namedPage(occurrence, source)}
        current={picture?.origin.kind === 'tag' ? picture.origin.tag : undefined}
        onChoose={(tag) => void choice.run(occurrence, () => tagChoice(source, tag)).then((done) => { if (done && !chooserOpen) setChoosing(false) })}
      />
    )}
    <div className="resolve-image-actions">
      {source && hasPages(source) && (
        <button
          type="button"
          className="secondary-button"
          aria-expanded={onCrop ? undefined : cropping}
          onClick={() => (onCrop ? onCrop() : setCropping(!cropping))}
        >
          <Crop aria-hidden="true" />Crop from a page
        </button>
      )}
      <label className="secondary-button resolve-image-upload">
        <Upload aria-hidden="true" />Upload a file
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/*"
          aria-label={`Upload a picture for ${name}`}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void choice.run(occurrence, () => uploadChoice(file))
          }}
        />
      </label>
      {picture && (
        <button type="button" className="secondary-button" onClick={() => choice.set(occurrence, null)}>
          <Trash2 aria-hidden="true" />Leave for later
        </button>
      )}
    </div>
    {cropping && source && !onCrop && (
      <PageCropper
        source={source}
        startPage={namedPage(occurrence, source)}
        onCancel={() => setCropping(false)}
        onCrop={(page, box) => void choice.run(occurrence, () => cropChoice(source, page, box)).then((done) => { if (done) setCropping(false) })}
      />
    )}
  </div>
}

/** Every remaining Pending Image as a list, for resolving after an import. */
export function ResolveImages({
  occurrences,
  source,
  resolutions,
  onChange,
  onSourceFile,
  filling = false,
}: {
  occurrences: readonly PendingImageOccurrence[]
  source: ResolvingSource | null
  resolutions: Resolutions
  onChange: (next: Resolutions) => void
  onSourceFile?: (file: File) => void
  /** Whether tagged pictures are still being taken from the document. */
  filling?: boolean
}) {
  const choice = usePictureChoice(occurrences, resolutions, onChange)
  const ready = occurrences.filter(({ key }) => resolutions.has(key)).length

  return <section className="resolve-images" aria-labelledby="resolve-images-heading">
    <header className="resolve-images-head">
      <div>
        <h3 id="resolve-images-heading">Resolve Images</h3>
        <p role="status">
          {filling
            ? 'Taking pictures from your test…'
            : `${ready} of ${occurrences.length} ${occurrences.length === 1 ? 'picture' : 'pictures'} ready.`}
          {' '}Any left unresolved stay as “picture needed” and can be added later.
        </p>
      </div>
    </header>
    {!source && onSourceFile && (
      <label className="resolve-images-source">
        <ImagePlus aria-hidden="true" />
        <span>Drop your original PDF or Word document here to take pictures from it, or upload each picture below.</span>
        <input
          type="file"
          accept={SOURCE_FILE_TYPES}
          aria-label="Your original test"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) onSourceFile(file)
          }}
        />
      </label>
    )}
    {choice.error && <p className="home-error" role="alert">{choice.error}</p>}
    <ol className="resolve-images-list">
      {occurrences.map((occurrence) => {
        const picture = resolutions.get(occurrence.key)
        const name = placeName(occurrence)
        return <li key={occurrence.key} className="resolve-image" aria-label={name} data-accepted={picture ? 'true' : undefined}>
          <div className="resolve-image-picture">
            {picture
              ? <img src={pictureSource(picture.asset)} alt={occurrence.alt ?? `Picture for ${name}`} />
              : <span className="picture-needed">Picture needed<small>{pendingName(occurrence.pending)}</small></span>}
          </div>
          <div className="resolve-image-body">
            <h4>{name}</h4>
            <PictureChoices
              occurrence={occurrence}
              occurrences={occurrences}
              source={source}
              resolutions={resolutions}
              choice={choice}
              chooserOpen={false}
            />
          </div>
        </li>
      })}
    </ol>
  </section>
}
