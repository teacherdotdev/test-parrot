import { useState } from 'react'
import type { PendingImageOccurrence } from './pending-images'
import { withPicture, type ResolvedPicture, type Resolutions, type ResolvingSource } from './resolved-pictures'

/** Which page a picker or a crop opens on: the one the Pending Image names. */
export function namedPage(occurrence: PendingImageOccurrence, source: ResolvingSource): number {
  const { pending } = occurrence
  if ('page' in pending) return Math.min(source.pageCount, pending.page)
  return source.tags.find(({ tag }) => tag === pending.image)?.page ?? 1
}

/** A picture choice being made, which may take a moment: the picture is
 *  taken out of the PDF, or read from the file. */
export function usePictureChoice(
  occurrences: readonly PendingImageOccurrence[],
  resolutions: Resolutions,
  onChange: (next: Resolutions) => void,
) {
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [separate, setSeparate] = useState<ReadonlySet<string>>(new Set())
  const shared = (occurrence: PendingImageOccurrence) => !separate.has(occurrence.key)
  const set = (occurrence: PendingImageOccurrence, picture: ResolvedPicture | null) =>
    onChange(withPicture(resolutions, occurrences, occurrence, picture, shared(occurrence)))
  const run = async (occurrence: PendingImageOccurrence, make: () => Promise<ResolvedPicture>) => {
    setError(null)
    setWorking(occurrence.key)
    try {
      set(occurrence, await make())
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That picture could not be used.')
      return false
    } finally {
      setWorking(null)
    }
  }
  const share = (occurrence: PendingImageOccurrence, value: boolean) => {
    const next = new Set(separate)
    if (value) next.delete(occurrence.key)
    else next.add(occurrence.key)
    setSeparate(next)
  }
  return { error, working, shared, share, set, run }
}

export type PictureChoice = ReturnType<typeof usePictureChoice>

