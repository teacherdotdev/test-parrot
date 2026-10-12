// The geometry `export-plan.ts` packed against, handed to CSS. Screen and paper
// agree only if the sheet is laid out at the size it was packed for, and the
// only way to be sure of that is for both to read the same numbers — the
// plan's own page size, margins and all. `styles.css` lays `.exam-page` out
// from these custom properties.

import type { CSSProperties } from 'react'
import { FOOTER_HEIGHT, HEADER_HEIGHT, type PageSize } from './export-plan'

export function pageGeometry(pageSize: PageSize): CSSProperties {
  return {
    '--page-width': `${pageSize.width}px`,
    '--page-height': `${pageSize.height}px`,
    '--page-margin-top': `${pageSize.margins.top}px`,
    '--page-margin-right': `${pageSize.margins.right}px`,
    '--page-margin-bottom': `${pageSize.margins.bottom}px`,
    '--page-margin-left': `${pageSize.margins.left}px`,
    '--page-header-first': `${HEADER_HEIGHT.first}px`,
    '--page-header-later': `${HEADER_HEIGHT.later}px`,
    '--page-header-answer-key': `${HEADER_HEIGHT['answer-key']}px`,
    '--page-header-answer-key-later': `${HEADER_HEIGHT['answer-key-later']}px`,
    '--page-footer': `${FOOTER_HEIGHT}px`,
  } as CSSProperties
}
