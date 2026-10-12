// The heights Work Space handles' drags show on the sheet before the Exam's
// own plan draws them, by the position each sizes: a Short Answer question's
// id, or a Part's or Subpart's. A picture's corner drag is held the same way,
// its width as a share of its column standing in for a height (ADR-0050).
//
// A drag previews locally and commits once, on release (see `WorkSpaceHandle`
// in `exam-page.tsx`). The commit changes the Exam at once, but the sheet
// repaginates later — after a font or picture check, or a pause in editing —
// so for a while it still draws the plan of the Exam as it was, with the space
// at its old height. Dropping the preview on release showed exactly that: the
// space snapped back to where the drag began, then out to where it ended.
//
// So a released drag keeps its height until the sheet has caught up with it:
// until it draws a plan of the Exam the release made (or a later one), or the
// plan already draws the released height. It is decided by those values — what
// the sheet is planned from, and the height it draws — never by which plan or
// item object happens to be on screen, so a re-render that hands the sheet a
// new object for the same old plan cannot bring the old height back. And the
// sheet holds these above the questions it draws, so a question drawn afresh
// keeps its drag's height too.

import type { PlannedWorkSpace } from './export-plan'

/** Where the sheet stands: the Exam being edited, and the Exam the drawn plan
 *  was planned from, which lags it while the sheet repaginates. Compared by
 *  identity: a store hands out a new Exam for every change. */
export type SheetState = { exam: object; plannedFrom: object }

export type WorkSpacePreview = {
  /** The height on the page the drag is showing, laid out as the plan lays a
   *  stored height (`laidWorkSpaceHeight`), so the two compare. */
  height: number
  /** `null` while the pointer is down; once released with a height stored,
   *  the sheet as it stood when it was. */
  released: SheetState | null
}

/** Every drag's preview on the sheet, by the position it sizes. */
export type WorkSpacePreviews = ReadonlyMap<string, WorkSpacePreview>

export const NO_WORK_SPACE_PREVIEWS: WorkSpacePreviews = new Map()

/** A drag at `positionId` showing `height`. */
export function dragged(previews: WorkSpacePreviews, positionId: string, height: number): WorkSpacePreviews {
  return new Map(previews).set(positionId, { height, released: null })
}

/** The drag at `positionId` once the pointer is up: kept, against the sheet as
 *  it stands, when the release stored a height, and otherwise gone at once. */
export function released(
  previews: WorkSpacePreviews,
  positionId: string,
  committed: boolean,
  sheet: SheetState,
): WorkSpacePreviews {
  const preview = previews.get(positionId)
  if (!preview) return previews
  const next = new Map(previews)
  if (committed) next.set(positionId, { height: preview.height, released: sheet })
  else next.delete(positionId)
  return next
}

// Whether the sheet has moved past a release: the Exam is the one it was
// released on — nothing was stored, or it was undone — or the sheet draws a
// plan of an Exam since then.
function caughtUp(release: SheetState, sheet: SheetState): boolean {
  if (sheet.exam === release.exam) return true
  return sheet.plannedFrom !== release.plannedFrom && sheet.plannedFrom !== release.exam
}

/** The height to draw for `positionId` over `planned`, or `null` to draw the
 *  plan's own. */
export function shownHeight(
  previews: WorkSpacePreviews,
  positionId: string,
  planned: Pick<PlannedWorkSpace, 'height'>,
  sheet: SheetState,
): number | null {
  const preview = previews.get(positionId)
  if (!preview) return null
  if (preview.released === null) return preview.height
  if (planned.height === preview.height || caughtUp(preview.released, sheet)) return null
  return preview.height
}

/** The previews without the released ones the sheet has caught up with, or
 *  the same previews when there are none. */
export function settled(previews: WorkSpacePreviews, sheet: SheetState): WorkSpacePreviews {
  const done = [...previews].filter(([, preview]) => preview.released && caughtUp(preview.released, sheet))
  if (done.length === 0) return previews
  const next = new Map(previews)
  for (const [positionId] of done) next.delete(positionId)
  return next
}
