// How any screen reaches the Question Bank Pop-over, which is rendered above
// every route by `PopOverProvider` (see question-bank-pop-over.tsx).

import { createContext, useContext } from 'react'

type PopOver = {
  /** Whether this browser can pop a window over others. Where it cannot, the
   *  ways in are hidden rather than shown and failing. */
  supported: boolean
  /** Open the Pop-over on this bank, adding its tab or switching to it. */
  open: (bankId: string) => void
}

export const PopOverContext = createContext<PopOver>({ supported: false, open: () => undefined })

export function usePopOver(): PopOver {
  return useContext(PopOverContext)
}
