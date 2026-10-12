// How a Multiple Choice question's answers are laid out, drawn: four rows for
// one column, a two-by-two grid, four across. The Exam editor's Answer columns
// menu and the Question Bank Pop-over's column toggle draw the same marks.

import type { ColumnSetting } from './exam'

export function ColumnLayoutIcon({
  columns,
  withDataAttribute = true,
}: {
  columns: ColumnSetting
  withDataAttribute?: boolean
}) {
  const strokes = columns === 1
    ? [
        'M1.5 2h15',
        'M1.5 5.33h15',
        'M1.5 8.67h15',
        'M1.5 12h15',
      ]
    : columns === 2
      ? [
          'M1.5 3.5h6',
          'M10.5 3.5h6',
          'M1.5 10.5h6',
          'M10.5 10.5h6',
        ]
      : [
          'M1.5 7h1.5',
          'M6 7h1.5',
          'M10.5 7h1.5',
          'M15 7h1.5',
        ]
  return (
    <svg
      viewBox="0 0 18 14"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
      data-column-layout={withDataAttribute ? columns : undefined}
    >
      {strokes.map((stroke) => (
        <path key={stroke} d={stroke} strokeLinecap="round" />
      ))}
    </svg>
  )
}
