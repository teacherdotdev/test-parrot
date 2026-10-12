// Question selection: click to select, Cmd/Ctrl-click to toggle, Shift-click
// to extend a range, Cmd/Ctrl-A for everything shown, clear on background
// click or Escape.
//
// This is its own hook — not folded into `ExamPage` — because selection drives
// both page chrome and selection-wide actions. `App` owns one instance and
// passes it down so every interaction reads the same selected ids and anchor.

import { useCallback, useRef, useState } from 'react'

export type ClickModifiers = {
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
}

export type Selection = {
  selectedIds: ReadonlySet<string>
  isSelected: (questionId: string) => boolean
  /**
   * A click on a question, given the ids in on-page order (so Shift-click can
   * compute a range) and which modifiers were held.
   */
  selectOne: (
    questionId: string,
    orderedIds: readonly string[],
    modifiers: ClickModifiers,
  ) => void
  /** The hover checkbox: always toggles, regardless of modifiers. */
  toggle: (questionId: string) => void
  /** This question and nothing else — what an authoring action leaves selected
   *  when it has put a question somewhere. Not a click, so it takes no
   *  modifiers and needs no on-page order to interpret them against. */
  select: (questionId: string) => void
  /** Exactly these questions, given in on-page order — Cmd/Ctrl-A. The first
   *  becomes the anchor, so a Shift-click afterwards extends from the top. */
  selectAll: (orderedIds: readonly string[]) => void
  clear: () => void
}

export function useSelection(): Selection {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  // The last question explicitly clicked (not Shift-clicked), so a Shift-click
  // has somewhere to extend a range from.
  const anchor = useRef<string | null>(null)

  const select = useCallback((questionId: string) => {
    setSelectedIds(new Set([questionId]))
    anchor.current = questionId
  }, [])

  const selectOne = useCallback(
    (questionId: string, orderedIds: readonly string[], modifiers: ClickModifiers) => {
      if (modifiers.shiftKey && anchor.current) {
        const from = orderedIds.indexOf(anchor.current)
        const to = orderedIds.indexOf(questionId)
        if (from !== -1 && to !== -1) {
          const [start, end] = from <= to ? [from, to] : [to, from]
          setSelectedIds(new Set(orderedIds.slice(start, end + 1)))
          return
        }
      }
      if (modifiers.metaKey || modifiers.ctrlKey) {
        setSelectedIds((previous) => {
          const next = new Set(previous)
          if (next.has(questionId)) next.delete(questionId)
          else next.add(questionId)
          return next
        })
        anchor.current = questionId
        return
      }
      select(questionId)
    },
    [select],
  )

  const toggle = useCallback((questionId: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(questionId)) next.delete(questionId)
      else next.add(questionId)
      return next
    })
    anchor.current = questionId
  }, [])

  const selectAll = useCallback((orderedIds: readonly string[]) => {
    setSelectedIds(new Set(orderedIds))
    anchor.current = orderedIds[0] ?? null
  }, [])

  const clear = useCallback(() => {
    setSelectedIds(new Set())
    anchor.current = null
  }, [])

  const isSelected = useCallback(
    (questionId: string) => selectedIds.has(questionId),
    [selectedIds],
  )

  return { selectedIds, isSelected, selectOne, toggle, select, selectAll, clear }
}
