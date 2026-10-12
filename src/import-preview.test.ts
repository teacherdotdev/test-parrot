// The import review previews the Exam an import would create through the
// export's own Layout Plan, so a Short Answer position shows the room it will
// arrive with: blank or ruled, as tall as the record says, or the lines its
// Paper Style rules where it says nothing.

import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { importedExam, importPreviewPlan } from './import-preview'
import { inspectImportRecord, type ImportProposal } from './package-import'
import { unmeasured, type QuestionItem } from './export-plan'

const examples = join(import.meta.dir, '..', 'public', 'formats', 'package', '0.1.0', 'examples')

async function proposalWith(exam: Record<string, unknown>): Promise<ImportProposal> {
  const example = await Bun.file(join(examples, 'bank-and-exam.json')).json()
  return inspectImportRecord(new TextEncoder().encode(JSON.stringify({ ...example, exams: [exam] })))
}

// In the example bank, `q5` is a Short Answer Question and `q1` Multiple Choice.
const record = (extra: Record<string, unknown>, position: Record<string, unknown> = {}) => ({
  format: 'test-parrot/exam',
  formatVersion: '0.4.0',
  name: 'Preview',
  sections: [{ title: 'Short Answer', instructions: '' }],
  positions: [
    { question: { bank: 'cells', question: 'q5' }, section: 0, ...position },
    { question: { bank: 'cells', question: 'q1' }, section: 0 },
  ],
  ...extra,
})

async function previewedShortAnswer(exam: Record<string, unknown>): Promise<QuestionItem> {
  const proposal = await proposalWith(exam)
  const selected = importedExam(proposal, proposal.exams[0]!.key)!
  const items = importPreviewPlan(selected, unmeasured).pages
    .flatMap((page) => page.items)
    .flatMap((item) => (item.kind === 'question' ? [item] : []))
  return items.find((item) => item.question.type === 'open')!
}

describe('the import preview’s plan', () => {
  test('rules the lines a position carries, as tall as it says', async () => {
    const item = await previewedShortAnswer(record({}, { workSpace: { height: 96, style: 'lines', fill: false } }))
    expect(item.workSpace).toMatchObject({ style: 'lines', lines: 3, height: 24 + 2 * 32 })
  })

  test('leaves the blank room a position carries, unruled', async () => {
    const item = await previewedShortAnswer(record({}, { workSpace: { height: 64, style: 'blank', fill: false } }))
    expect(item.workSpace).toMatchObject({ style: 'blank', lines: 0, height: 24 + 32 })
  })

  test('rules the lines the Exam’s Paper Style supplies where a position carries none', async () => {
    const classic = await previewedShortAnswer(record({ paperStyle: 'classic' }))
    expect(classic.workSpace).toMatchObject({ style: 'lines', lines: 3, pitch: 32 })
    const condensed = await previewedShortAnswer(record({ paperStyle: 'condensed' }))
    expect(condensed.workSpace).toMatchObject({ style: 'lines', lines: 3, pitch: 24 })
  })

  test('keeps a position’s “None” over the lines its style would rule', async () => {
    const item = await previewedShortAnswer(
      record({ paperStyle: 'classic' }, { workSpace: { height: 0, style: 'blank', fill: false } }),
    )
    expect(item.workSpace!.height).toBe(0)
  })

  test('leaves no room where neither the position nor a Standard Exam asks for any', async () => {
    const item = await previewedShortAnswer(record({}))
    expect(item.workSpace!.height).toBe(0)
  })
})
