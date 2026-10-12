// The Exam an import would create, as the import review previews it.
//
// It is built the way the import builds the Exam — `planImport`, then the same
// `selectedExam` the sheet reads — so the preview lays out exactly what will
// arrive: its Sections, answer columns and order, its Paper Style and the
// Work Space each Short Answer position carries, blank or ruled, or the lines
// its style supplies where it carries none. Loaded on demand with the
// importer, since it brings the record parsers.

import type { Question } from './exam'
import { initialSelection } from './import-selection'
import { planImport } from './package-commit'
import type { ImportProposal } from './package-import'
import { planExport, type BankAnswerWidth, type LayoutPlan, type Measure } from './export-plan'
import { selectedExam, type SelectedExam } from './selected-exam'

/** The Exam an import of `proposal` would create for its Exam `examKey`, each
 *  Question passed through `resolve` — which gives a previewed picture its
 *  bytes — or `null` when that Exam has no Questions. `bankAnswerWidth` places
 *  each Word Bank a Matching position does not, as the import itself will. */
export function importedExam(
  proposal: ImportProposal,
  examKey: string,
  resolve: (question: Question) => Question = (question) => question,
  bankAnswerWidth?: BankAnswerWidth,
): SelectedExam | null {
  let next = 0
  const plan = planImport(proposal, initialSelection(proposal), () => `preview-${next++}`, new Map(), bankAnswerWidth)
  const planned = plan.exams.find(({ source }) => source === examKey)
  if (!planned || planned.saved.workingCopy.questionIds.length === 0) return null
  return selectedExam(
    { questions: planned.saved.questionBank.questions.map(resolve) },
    planned.saved.workingCopy,
  )
}

/** The student test that Exam would print, laid out by the export's own
 *  Layout Plan. */
export function importPreviewPlan(selected: SelectedExam, measure: Measure): LayoutPlan {
  return planExport({
    exam: selected.exam,
    arrangement: selected.arrangement,
    selection: { test: true, answerKey: false },
    measure,
  })
}
