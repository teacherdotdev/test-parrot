// What the app shell's New menu and breadcrumbs do, provided by the app and
// overridden by the Library page for its own drops (ADR-0051).

import { createContext, type DragEvent } from 'react'

/** What the New menu can make. Whatever it makes lands in `folderId`. */
export type NewKind = 'folder' | 'exam' | 'bank' | 'import' | 'convert' | 'drive'
export type LibraryActions = {
  onNew: (kind: NewKind, folderId: string | null) => void
  /** Things dropped on a breadcrumb move into its Folder. */
  onDropInto?: (folderId: string | null, event: DragEvent) => void
  /** Whether a drag over a breadcrumb carries things that can move. */
  canDrop?: (event: DragEvent) => boolean
}
export const LibraryActionsContext = createContext<LibraryActions | null>(null)
