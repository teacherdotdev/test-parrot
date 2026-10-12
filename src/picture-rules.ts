/** A region of a page on a 0–1000 scale of its width and height, measured
 *  from the top-left corner the way a reader sees the page. */
export type PageBox = { left: number; top: number; right: number; bottom: number }

/** An image narrower than this share of the page, or shorter than its height
 *  share, is an equation, a bullet or a caption stored as a picture. */
const MIN_WIDTH = 60
const MIN_HEIGHT = 40
/** An image covering this share of the page or more is a scanned page. */
const FULL_PAGE = 0.7

/**
 * Whether an image placed on a page is a picture rather than an equation or a
 * scan — the one rule for which images get an Image Tag, whether the Source
 * Document is a PDF or a Word document.
 */
export function isPicture(box: PageBox): boolean {
  const width = box.right - box.left
  const height = box.bottom - box.top
  if (width < MIN_WIDTH || height < MIN_HEIGHT) return false
  return (width * height) / 1_000_000 < FULL_PAGE
}
