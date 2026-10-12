import { describe, expect, test } from 'bun:test'
import {
  createQuestion,
  orderedChoices,
  orderedQuestions,
  questionsInSection,
  type Question,
} from './exam'
import {
  createWorkingCopy,
  createQuestionBank,
  withQuestionBanked,
  withReferenceAdded,
  type ExamWorkingCopy,
  type QuestionBank,
} from './question-bank'
import { selectedExam } from './selected-exam'
import { planExport, unmeasured } from './export-plan'
import { paragraph, text } from './export-fixtures'

function banked(...questions: Question[]): QuestionBank {
  return questions.reduce(withQuestionBanked, createQuestionBank())
}

function drafted(...questionIds: string[]): ExamWorkingCopy {
  return questionIds.reduce(
    (draft, id) => withReferenceAdded(draft, id),
    createWorkingCopy('Biology Quiz'),
  )
}

describe('the Exam rendering and export receive', () => {
  test('holds only the Question Bank records the Working Copy references', () => {
    const [first, second] = [createQuestion('multiple-choice'), createQuestion('multiple-choice')]
    const { exam } = selectedExam(banked(first!, second!), drafted(first!.id))
    expect(exam.questions.map((question) => question.id)).toEqual([first!.id])
  })

  test('arranges them in Working Copy order, not Question Bank order', () => {
    const [first, second] = [createQuestion('open'), createQuestion('open')]
    const { exam, arrangement } = selectedExam(
      banked(first!, second!),
      drafted(second!.id, first!.id),
    )
    expect(orderedQuestions(exam, arrangement).map((question) => question.id)).toEqual([
      second!.id,
      first!.id,
    ])
  })

  test('keeps the fixed Multiple Choice then Short Answer sections', () => {
    const shortAnswer = createQuestion('open')
    const multipleChoice = createQuestion('multiple-choice')
    const { exam, arrangement } = selectedExam(
      banked(shortAnswer, multipleChoice),
      drafted(shortAnswer.id, multipleChoice.id),
    )
    expect(orderedQuestions(exam, arrangement).map((question) => question.type)).toEqual([
      'multiple-choice',
      'open',
    ])
    expect(questionsInSection(exam, arrangement, 'open').map((question) => question.id)).toEqual([
      shortAnswer.id,
    ])
  })

  test('follows an edit to canonical Question Content', () => {
    const question = createQuestion('open')
    const edited = { ...question, doc: { type: 'doc', content: [paragraph(text('Edited'))] } }
    const { exam } = selectedExam(
      withQuestionBanked(banked(question), edited),
      drafted(question.id),
    )
    expect(exam.questions[0]!.doc).toEqual(edited.doc)
  })

  test('follows a referenced question into its new Question Section when its type changes', () => {
    const question = createQuestion('multiple-choice')
    const other = createQuestion('open')
    const bank = withQuestionBanked(
      banked(question, other),
      { ...question, type: 'open' },
    )
    const { exam, arrangement } = selectedExam(bank, drafted(question.id, other.id))
    expect(questionsInSection(exam, arrangement, 'multiple-choice')).toEqual([])
    expect(questionsInSection(exam, arrangement, 'open').map((item) => item.id)).toEqual([
      question.id,
      other.id,
    ])
  })

  test('takes the exam name from the Working Copy', () => {
    const { exam } = selectedExam(createQuestionBank(), drafted())
    expect(exam.title).toBe('Biology Quiz')
  })

  test('answers print in the order they were authored in', () => {
    const question = createQuestion('multiple-choice')
    const { exam, arrangement } = selectedExam(banked(question), drafted(question.id))
    expect(arrangement.choiceOrder).toEqual({})
    expect(exam.questions[0]!.doc).toEqual(question.doc)
  })

  test('keeps draft answer order apart from canonical Question Content', () => {
    const question = createQuestion('multiple-choice')
    const canonicalIds = orderedChoices(question, {
      id: 'canonical', letter: 'A', questionOrder: [question.id], choiceOrder: {},
    }).map((choice) => choice.id)
    const draft = {
      ...drafted(question.id),
      choiceOrder: { [question.id]: [...canonicalIds].reverse() },
    }

    const { exam, arrangement } = selectedExam(banked(question), draft)

    expect(orderedChoices(exam.questions[0]!, arrangement).map((choice) => choice.id))
      .toEqual([...canonicalIds].reverse())
    expect(orderedChoices(question, {
      id: 'canonical', letter: 'A', questionOrder: [question.id], choiceOrder: {},
    }).map((choice) => choice.id)).toEqual(canonicalIds)
    expect(exam.questions[0]!.doc).toEqual(question.doc)
  })
})

describe('an unused Question Bank question', () => {
  test('never reaches a Layout Plan', () => {
    const used = createQuestion('open')
    const unused = createQuestion('open')
    const { exam, arrangement } = selectedExam(banked(used, unused), drafted(used.id))
    const plan = planExport({
      exam,
      arrangement,
      selection: { test: true, answerKey: true },
      measure: unmeasured,
    })
    const planned = plan.pages.flatMap((page) =>
      page.items.flatMap((item) => (item.kind === 'question' ? [item.question.id] : [])),
    )
    expect(planned).toContain(used.id)
    expect(planned).not.toContain(unused.id)
  })

  test('does not renumber the questions that are on the Working Copy', () => {
    const first = createQuestion('open')
    const unused = createQuestion('open')
    const second = createQuestion('open')
    const { exam, arrangement } = selectedExam(
      banked(first, unused, second),
      drafted(first.id, second.id),
    )
    const plan = planExport({
      exam,
      arrangement,
      selection: { test: true, answerKey: false },
      measure: unmeasured,
    })
    const numbers = plan.pages.flatMap((page) =>
      page.items.flatMap((item) =>
        item.kind === 'question' && item.numbered ? [item.question.number] : [],
      ),
    )
    expect(numbers).toEqual([1, 2])
  })
})

describe('the derived identities', () => {
  test('survive a reordering, so unchanged content is never re-measured', () => {
    const [first, second] = [createQuestion('open'), createQuestion('open')]
    const bank = banked(first!, second!)
    const before = selectedExam(bank, drafted(first!.id, second!.id))
    const after = selectedExam(bank, drafted(second!.id, first!.id), before)
    expect(after.exam).toBe(before.exam)
    expect(after.arrangement).not.toBe(before.arrangement)
  })

  test('survive a derivation that changed nothing at all', () => {
    const question = createQuestion('open')
    const bank = banked(question)
    const before = selectedExam(bank, drafted(question.id))
    expect(selectedExam(bank, drafted(question.id), before)).toBe(before)
  })

  test('change when canonical Question Content changes', () => {
    const question = createQuestion('open')
    const before = selectedExam(banked(question), drafted(question.id))
    const after = selectedExam(
      withQuestionBanked(banked(question), {
        ...question,
        doc: { type: 'doc', content: [paragraph(text('Edited'))] },
      }),
      drafted(question.id),
      before,
    )
    expect(after.exam).not.toBe(before.exam)
    expect(after.arrangement).toBe(before.arrangement)
  })
})
