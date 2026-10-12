// The exam sheet's selected piece — one picture or one Work Space — and how a
// picture's size is set, shared by the sheet and the pieces drawn on it. See
// `sheet-pieces.tsx` (ADR-0050).

import { createContext } from 'react'

/** The one selected piece of the sheet: a picture, as
 *  `picture:<question id>:<pictureKey>`, or a Work Space, as `space:<id>`. */
export type SheetPiece = string

export const picturePieceOf = (questionId: string, key: string): SheetPiece => `picture:${questionId}:${key}`
export const spacePieceOf = (positionId: string): SheetPiece => `space:${positionId}`

export type SheetPieces = {
  selected: SheetPiece | null
  select: (piece: SheetPiece | null) => void
  /** Sets how wide this Exam prints one of a question's pictures, as a share
   *  of its container. */
  onResizePicture?: (questionId: string, picture: string, size: number) => void
  /** The size a released corner drag still draws a picture at, until the
   *  sheet has been planned with it, or `null` for the size it is planned at
   *  (`work-space-preview.ts`). */
  heldPictureSize?: (piece: SheetPiece, planned: number | null) => number | null
  /** Holds a released drag's size for a picture whose size was just set. */
  holdPictureSize?: (piece: SheetPiece, size: number) => void
}

export const SheetPiecesContext = createContext<SheetPieces | null>(null)

/** Which question the pictures below belong to. */
export const SheetQuestionContext = createContext<string | null>(null)
