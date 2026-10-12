// Copy settings: how mathematics travels when Questions are copied or
// dragged out. One preference for this browser, set from the Question Bank
// Pop-over and followed by every Copy.

import { useSyncExternalStore } from 'react'
import type { CopyMathMode } from './question-copy'

const KEY = 'test-parrot-copy-math'
const listeners = new Set<() => void>()

function read(): CopyMathMode {
  try {
    return window.localStorage.getItem(KEY) === 'word' ? 'word' : 'picture'
  } catch {
    return 'picture'
  }
}

let current: CopyMathMode | null = null

export function copyMathMode(): CopyMathMode {
  current ??= read()
  return current
}

export function setCopyMathMode(mode: CopyMathMode): void {
  current = mode
  try {
    window.localStorage.setItem(KEY, mode)
  } catch {
    // Kept for this visit when the browser keeps nothing.
  }
  listeners.forEach((listener) => listener())
}

export function useCopyMathMode(): CopyMathMode {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    copyMathMode,
  )
}
