import { describe, expect, test } from 'bun:test'
import {
  choicesOf,
  createQuestion,
  newSectionWording,
  orderedChoices,
  orderedQuestions,
  questionsInSection,
  sectionsOf,
  topicsOf,
} from './exam'
import { workSpaceOf, type Question, type SectionTarget } from './exam'
import {
  createAuthoringState,
  createExamStore,
  createMemoryBackend,
  loadExamStore,
} from './exam-store'
import type {
  AuthoringState,
  DurableAuthoringBackend,
  ExamStore,
  SavedState,
} from './exam-store'
import { STORAGE_NAME } from './indexeddb-authoring'
import {
  DEFAULT_EXPORT_CONFIGURATION,
  prepareExport,
  prepareHistoricalExport,
} from './export-preparation'
import { unmeasured } from './export-plan'
import { shownChoices } from './hidden-answers'

function memory(initial: AuthoringState | null = null) {
  return createMemoryBackend<AuthoringState>(initial)
}

async function freshStore() {
  const backend = memory()
  const savedBackend = createMemoryBackend<SavedState>()
  const store = await loadExamStore(backend, savedBackend)
  return { backend, savedBackend, store }
}

/** The ids in the Question Bank, in the order it stores them. */
const bankIds = (store: ExamStore) =>
  store.getState().questionBank.questions.map((question) => question.id)

/** The ids the Working Copy renders, in the order they appear on the page. */
const renderedIds = (store: ExamStore) => {
  const { exam, arrangement } = store.selectedExam()
  return orderedQuestions(exam, arrangement).map((question) => question.id)
}

/** A target beside one question: after it, or before it. */
const beside = (
  questionId: string,
  placement: 'before' | 'after' = 'after',
): SectionTarget => ({ kind: 'question', questionId, placement })

/** The Working Copy's Sections, as ids, in print order. */
const sectionIds = (store: ExamStore) => sectionsOf(store.selectedExam().exam).map(({ id }) => id)

/** Each Section's questions, as ids, in print order. */
const sectionContents = (store: ExamStore) => {
  const { exam, arrangement } = store.selectedExam()
  return sectionsOf(exam).map((section) =>
    questionsInSection(exam, arrangement, section.id).map(({ id }) => id),
  )
}

/** A store holding `count` banked questions, all of them on the Working Copy. */
async function withExamWorkingCopy(count: number, type: Question['type'] = 'multiple-choice') {
  const { backend, savedBackend, store } = await freshStore()
  const questions: Question[] = []
  for (let index = 0; index < count; index += 1) {
    const question = createQuestion(type)
    questions.push(question)
    store.createInQuestionBank(question)
    store.addToWorkingCopy(question)
  }
  await store.whenSettled()
  return { backend, savedBackend, store, questions }
}

describe('a fresh installation', () => {
  test('starts with an empty Question Bank and an empty Working Copy', async () => {
    const { store } = await freshStore()
    const state = store.getState()
    expect(state.questionBank.questions).toEqual([])
    expect(state.workingCopy.questionIds).toEqual([])
    expect(state.dirty).toBe(false)
    expect(store.selectedExam().exam.questions).toEqual([])
  })

  test('stores under new identifiers, so the earlier generation is never read', () => {
    // ADR-0009: the historical storage generation is another cutover. Data written by
    // both earlier authoring generations is left where it is and never read.
    expect(STORAGE_NAME).not.toBe('exam-authoring-v2')
    expect(STORAGE_NAME).not.toBe('exam-saved-v2')
  })

  test('ignores state stored in the earlier shape', async () => {
    const earlier = {
      exam: { title: 'Written before the cutover', questions: [createQuestion('open')] },
      arrangements: [{ id: 'v1', letter: 'A', questionOrder: [], choiceOrder: {} }],
      currentArrangementId: 'v1',
      dirty: false,
    }
    const store = await loadExamStore(memory(earlier as unknown as AuthoringState))
    expect(store.getState().questionBank.questions).toEqual([])
    expect(store.getState().workingCopy.questionIds).toEqual([])
  })

  test('falls back to an empty exam when the stored state is corrupt', async () => {
    const store = await loadExamStore(memory({ nonsense: true } as unknown as AuthoringState))
    expect(store.getState().questionBank.questions).toEqual([])
    expect(store.getState().workingCopy.questionIds).toEqual([])
    expect(store.getState().dirty).toBe(false)
  })

  test('drops a stored answer arrangement whose choices are not arrays of strings, keeping the draft', async () => {
    const question = createQuestion('multiple-choice')
    for (const choiceOrder of [
      { [question.id]: 5 },
      { [question.id]: ['valid-id', 5] },
    ]) {
      const corrupt = {
        questionBank: { questions: [question] },
        workingCopy: {
          title: 'Corrupt answer order',
          questionIds: [question.id],
          choiceOrder,
        },
        dirty: false,
      }

      const store = await loadExamStore(memory(corrupt as unknown as AuthoringState))

      // One unreadable setting costs that setting, not the teacher's work: the
      // authored answer order applies.
      expect(store.getState().workingCopy).toEqual({
        title: 'Corrupt answer order',
        questionIds: [question.id],
      })
      expect(store.selectedExam().exam.questions.map(({ id }) => id)).toEqual([question.id])
    }
  })
})

describe('creating Question Content', () => {
  test('banks a question without putting it on the Working Copy', async () => {
    const { store } = await freshStore()
    const question = createQuestion('multiple-choice')

    store.createInQuestionBank(question)

    expect(bankIds(store)).toEqual([question.id])
    expect(store.getState().workingCopy.questionIds).toEqual([])
    expect(renderedIds(store)).toEqual([])
  })

  test('banks a question and puts it on the Working Copy in one action', async () => {
    const { store } = await freshStore()
    const question = createQuestion('open')

    store.createInQuestionBank(question)
    store.addToWorkingCopy(question)

    expect(bankIds(store)).toEqual([question.id])
    expect(renderedIds(store)).toEqual([question.id])
  })

  test('places a new question immediately after the one it was added below', async () => {
    const { store, questions } = await withExamWorkingCopy(2)
    const inserted = createQuestion('multiple-choice')

    store.createInQuestionBank(inserted)
    store.addToWorkingCopy(inserted, beside(questions[0]!.id))

    expect(renderedIds(store)).toEqual([
      questions[0]!.id,
      inserted.id,
      questions[1]!.id,
    ])
  })
})

describe('the Working Copy references the Question Bank', () => {
  test('adds an unused bank question to the Working Copy', async () => {
    const { store } = await freshStore()
    const question = createQuestion('open')
    store.createInQuestionBank(question)

    store.addToWorkingCopy(question.id)

    expect(renderedIds(store)).toEqual([question.id])
    expect(bankIds(store)).toEqual([question.id])
  })

  test('adds several bank questions in order as one undoable action', () => {
    const questions = [
      createQuestion('multiple-choice'),
      createQuestion('multiple-choice'),
      createQuestion('open'),
    ]
    const initial: AuthoringState = {
      questionBank: { questions },
      workingCopy: { title: 'Bulk composition', questionIds: [questions[0]!.id] },
      dirty: false,
    }
    const store = createExamStore({ backend: memory(initial), initial })

    store.addManyToWorkingCopy([questions[1]!.id, questions[2]!.id, questions[0]!.id])

    expect(renderedIds(store)).toEqual(questions.map(({ id }) => id))
    store.undo()
    expect(renderedIds(store)).toEqual([questions[0]!.id])
  })

  test('inserts several questions beside a target without reversing them', () => {
    const questions = Array.from({ length: 4 }, () => createQuestion('multiple-choice'))
    const initial: AuthoringState = {
      questionBank: { questions },
      workingCopy: { title: 'Bulk insertion', questionIds: [questions[0]!.id, questions[3]!.id] },
      dirty: false,
    }
    const store = createExamStore({ backend: memory(initial), initial })

    store.addManyToWorkingCopy([questions[1]!.id, questions[2]!.id], beside(questions[0]!.id))

    expect(renderedIds(store)).toEqual(questions.map(({ id }) => id))
  })

  test('holds a question at most once, however often it is added', async () => {
    const { store, questions } = await withExamWorkingCopy(2)
    const before = store.getState()

    store.addToWorkingCopy(questions[0]!.id)
    store.addToWorkingCopy(questions[0]!.id, beside(questions[1]!.id))

    expect(store.getState().workingCopy.questionIds).toEqual([
      questions[0]!.id,
      questions[1]!.id,
    ])
    // Refused, so nothing happened at all: an add that changes nothing is not
    // an authoring action and must not cost an undo step.
    expect(store.getState()).toBe(before)
  })

  test('refuses a reference to Question Content that is not banked', async () => {
    const { store } = await freshStore()
    store.addToWorkingCopy('never-banked')
    expect(store.getState().workingCopy.questionIds).toEqual([])
    expect(store.canUndo()).toBe(false)
  })

  test('stores references rather than copies, so an edit reaches the page', async () => {
    const { store, questions } = await withExamWorkingCopy(1, 'open')
    const edited = {
      ...questions[0]!,
      doc: { type: 'doc', content: [{ type: 'paragraph' }] },
    }

    store.updateInQuestionBank(edited)

    expect(store.selectedExam().exam.questions[0]!.doc).toEqual(edited.doc)
    expect(bankIds(store)).toEqual([questions[0]!.id])
  })

  test('edits a bank-only question without adding it to the Working Copy', async () => {
    const { store } = await freshStore()
    const question = createQuestion('open')
    store.createInQuestionBank(question)

    store.updateInQuestionBank({
      ...question,
      doc: { type: 'doc', content: [{ type: 'paragraph' }] },
    })

    expect(store.getState().questionBank.questions[0]!.doc).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    })
    expect(store.getState().workingCopy.questionIds).toEqual([])
  })

  test('banks a question it has never seen, so a save is never lost', async () => {
    const { store } = await freshStore()
    const question = createQuestion('open')

    store.updateInQuestionBank(question)

    expect(bankIds(store)).toEqual([question.id])
    expect(store.getState().workingCopy.questionIds).toEqual([])
  })

  test('refuses to change a Question Type after creation', async () => {
    const { store, questions } = await withExamWorkingCopy(2)
    const before = store.getState()

    store.updateInQuestionBank({ ...questions[0]!, type: 'open' })

    expect(store.getState()).toBe(before)
    expect(store.selectedExam().exam.questions[0]!.type).toBe('multiple-choice')
  })
})

describe('Remove', () => {
  test('excludes a question from the Working Copy without deleting it', async () => {
    const { store, questions } = await withExamWorkingCopy(2)

    store.removeFromWorkingCopy([questions[0]!.id])

    expect(renderedIds(store)).toEqual([questions[1]!.id])
    expect(bankIds(store)).toEqual(questions.map((question) => question.id))
    expect(store.getState().questionBank.questions[0]).toEqual(questions[0]!)
  })

  test('excludes a whole selection as one action', async () => {
    const { store, questions } = await withExamWorkingCopy(3)

    store.removeFromWorkingCopy([questions[0]!.id, questions[2]!.id])

    expect(renderedIds(store)).toEqual([questions[1]!.id])
    expect(store.canUndo()).toBe(true)
    store.undo()
    expect(renderedIds(store)).toEqual(questions.map((question) => question.id))
  })

  test('leaves a Removed question available to add again', async () => {
    const { store, questions } = await withExamWorkingCopy(1)
    store.removeFromWorkingCopy([questions[0]!.id])

    store.addToWorkingCopy(questions[0]!.id)

    expect(renderedIds(store)).toEqual([questions[0]!.id])
  })
})

describe('Insert', () => {
  test('inserts an unused bank question after a chosen Working Copy question', async () => {
    const { store, questions } = await withExamWorkingCopy(2)
    const spare = createQuestion('multiple-choice')
    store.createInQuestionBank(spare)

    store.addToWorkingCopy(spare.id, beside(questions[0]!.id))

    expect(renderedIds(store)).toEqual([questions[0]!.id, spare.id, questions[1]!.id])
  })

  test('inserts an unused bank question before a chosen Working Copy question', async () => {
    const { store, questions } = await withExamWorkingCopy(2)
    const spare = createQuestion('multiple-choice')
    store.createInQuestionBank(spare)

    store.addToWorkingCopy(spare.id, beside(questions[1]!.id, 'before'))

    expect(renderedIds(store)).toEqual([questions[0]!.id, spare.id, questions[1]!.id])
  })

  test('inherits the visual Multiple Choice neighbor layout, using below at the top and one for an empty section', async () => {
    const { store } = await freshStore()
    const first = createQuestion('multiple-choice', 2)
    const second = createQuestion('multiple-choice', 2)
    const beforeFirst = createQuestion('multiple-choice', 2)
    const emptySectionFirst = createQuestion('open', 2)
    store.createInQuestionBank(first)
    store.addToWorkingCopy(first)
    store.createInQuestionBank(second)
    store.addToWorkingCopy(second)
    store.createInQuestionBank(beforeFirst)
    store.createInQuestionBank(emptySectionFirst)
    store.setQuestionColumns([first.id], 4)
    store.setQuestionColumns([second.id], 1)

    store.addToWorkingCopy(beforeFirst.id, beside(first.id, 'before'))
    store.addToWorkingCopy(emptySectionFirst.id)

    expect(store.getState().workingCopy.columns?.[beforeFirst.id]).toBe(4)
    expect(store.getState().workingCopy.columns?.[emptySectionFirst.id]).toBeUndefined()

    const lone = createQuestion('multiple-choice', 4)
    const empty = await freshStore()
    empty.store.createInQuestionBank(lone)
    empty.store.addToWorkingCopy(lone.id)
    expect(empty.store.getState().workingCopy.columns?.[lone.id]).toBe(1)
  })

  test('inserts before the first question of a Question Section', async () => {
    // The only placement that cannot be expressed as "after something": the
    // top edge of the first rendered question in its section.
    const { store, questions } = await withExamWorkingCopy(2)
    const spare = createQuestion('multiple-choice')
    store.createInQuestionBank(spare)

    store.addToWorkingCopy(spare.id, beside(questions[0]!.id, 'before'))

    expect(renderedIds(store)).toEqual([spare.id, questions[0]!.id, questions[1]!.id])
  })

  test('inserts before a question whose Working Copy neighbour is in the other section', () => {
    // A Working Copy written before Sections were stored may interleave the
    // types in its stored order, while the rendered order groups them. An
    // insertion is placed against the *rendered* neighbour, so the two cannot
    // disagree about where the question landed.
    const [first, shortAnswer, second, spare] = [
      createQuestion('multiple-choice'),
      createQuestion('open'),
      createQuestion('multiple-choice'),
      createQuestion('multiple-choice'),
    ]
    const initial: AuthoringState = {
      questionBank: { questions: [first!, shortAnswer!, second!, spare!] },
      workingCopy: { title: 'Interleaved', questionIds: [first!.id, shortAnswer!.id, second!.id] },
      dirty: false,
    }
    const store = createExamStore({ backend: memory(initial), initial })

    store.addToWorkingCopy(spare!.id, beside(second!.id, 'before'))

    expect(renderedIds(store)).toEqual([first!.id, spare!.id, second!.id, shortAnswer!.id])
    // Once stored, the Working Copy's order is the order it prints.
    expect(store.getState().workingCopy.questionIds).toEqual(renderedIds(store))
  })

  test('inserts before a question of another type, in its Section', async () => {
    const { store, questions } = await withExamWorkingCopy(1, 'multiple-choice')
    const shortAnswer = createQuestion('open')
    store.createInQuestionBank(shortAnswer)
    store.addToWorkingCopy(shortAnswer, { kind: 'new-section', afterSectionId: sectionIds(store)[0]! })
    const spare = createQuestion('multiple-choice')
    store.createInQuestionBank(spare)

    store.addToWorkingCopy(spare.id, beside(shortAnswer.id, 'before'))

    expect(sectionContents(store)).toEqual([[questions[0]!.id], [spare.id, shortAnswer.id]])
  })

  test('inserts a question of another type between two of one type', async () => {
    const { store, questions } = await withExamWorkingCopy(2, 'multiple-choice')
    const shortAnswer = createQuestion('open')
    store.createInQuestionBank(shortAnswer)

    store.addToWorkingCopy(shortAnswer.id, beside(questions[0]!.id))

    expect(sectionContents(store)).toEqual([[questions[0]!.id, shortAnswer.id, questions[1]!.id]])
  })

  test('an insert is exactly one undo step', async () => {
    const { store, questions } = await withExamWorkingCopy(2)
    const spare = createQuestion('multiple-choice')
    store.createInQuestionBank(spare)

    store.addToWorkingCopy(spare.id, beside(questions[0]!.id, 'before'))
    store.undo()

    expect(renderedIds(store)).toEqual([questions[0]!.id, questions[1]!.id])
    expect(bankIds(store)).toEqual([questions[0]!.id, questions[1]!.id, spare.id])

    store.redo()
    expect(renderedIds(store)).toEqual([spare.id, questions[0]!.id, questions[1]!.id])
  })
})

describe('classifying a question', () => {
  test('saves Difficulty and Topics as one authoring action', async () => {
    const { store, questions, backend } = await withExamWorkingCopy(1)

    store.updateInQuestionBank({
      ...questions[0]!,
      difficulty: 'hard',
      topics: ['Cell division'],
    })
    await store.whenSettled()

    const banked = store.getState().questionBank.questions[0]!
    expect(banked.difficulty).toBe('hard')
    expect(topicsOf(banked)).toEqual(['Cell division'])
    expect(store.getState().dirty).toBe(true)
    expect(backend.value?.questionBank.questions[0]?.difficulty).toBe('hard')

    store.undo()
    expect(store.getState().questionBank.questions[0]!.difficulty).toBeUndefined()
  })

  test('classifies a bank-only question without putting it on the Working Copy', async () => {
    const { store } = await freshStore()
    const question = createQuestion('open')
    store.createInQuestionBank(question)

    store.updateInQuestionBank({ ...question, difficulty: 'easy', topics: ['Algebra'] })

    expect(store.getState().workingCopy.questionIds).toEqual([])
    expect(topicsOf(store.getState().questionBank.questions[0]!)).toEqual(['Algebra'])
  })
})

describe('moving a reference', () => {
  test('moves one question to an exact position on the Working Copy', async () => {
    const { store, questions } = await withExamWorkingCopy(3)

    store.moveInWorkingCopy([questions[2]!.id], beside(questions[0]!.id, 'before'))

    expect(renderedIds(store)).toEqual([
      questions[2]!.id,
      questions[0]!.id,
      questions[1]!.id,
    ])
  })

  test('moves a selection as one block, preserving its order', async () => {
    const { store, questions } = await withExamWorkingCopy(4)

    store.moveInWorkingCopy([questions[0]!.id, questions[1]!.id], beside(questions[3]!.id))

    expect(renderedIds(store)).toEqual([
      questions[2]!.id,
      questions[3]!.id,
      questions[0]!.id,
      questions[1]!.id,
    ])
  })

  test('moves a question into another Question Section, beside one of another type', async () => {
    const { store } = await freshStore()
    const multipleChoice = createQuestion('multiple-choice')
    const shortAnswer = createQuestion('open')
    store.createInQuestionBank(multipleChoice)
    store.addToWorkingCopy(multipleChoice)
    store.createInQuestionBank(shortAnswer)
    store.addToWorkingCopy(shortAnswer, { kind: 'new-section', afterSectionId: null })

    store.moveInWorkingCopy([shortAnswer.id], beside(multipleChoice.id, 'before'))

    expect(sectionContents(store)).toEqual([[shortAnswer.id, multipleChoice.id], []])
  })

  test('a move that changes nothing is not an authoring action', async () => {
    const { store, questions } = await withExamWorkingCopy(2)
    const before = store.getState()

    store.moveInWorkingCopy([questions[0]!.id], beside(questions[1]!.id, 'before'))

    expect(store.getState()).toBe(before)
    // Nothing was recorded, so undo reaches past it to the last real action.
    store.undo()
    expect(renderedIds(store)).toEqual([questions[0]!.id])
  })
})

describe('shuffling selected answers', () => {
  test('independently shuffles selected Multiple Choice answers, preserves correctness, and undoes once', async () => {
    const { store } = await freshStore()
    const first = createQuestion('multiple-choice')
    const second = createQuestion('multiple-choice')
    const shortAnswer = createQuestion('open')
    const ineligible = {
      ...createQuestion('multiple-choice'),
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph' },
          {
            type: 'multipleChoice',
            content: [
              {
                type: 'multipleChoiceChoice',
                attrs: { id: 'only-choice', correct: true },
                content: [{ type: 'paragraph' }],
              },
            ],
          },
        ],
      },
    }
    for (const question of [first, second, shortAnswer, ineligible]) {
      store.createInQuestionBank(question)
      store.addToWorkingCopy(question)
    }
    const beforeFirst = choicesOf(first).map((choice) => choice.id)
    const beforeSecond = choicesOf(second).map((choice) => choice.id)

    store.shuffleSelectedAnswers([first.id, second.id, shortAnswer.id, ineligible.id])

    const { exam, arrangement } = store.selectedExam()
    const renderedFirst = exam.questions.find((question) => question.id === first.id)!
    const renderedSecond = exam.questions.find((question) => question.id === second.id)!
    expect(arrangement.choiceOrder[first.id]).toHaveLength(beforeFirst.length)
    expect(arrangement.choiceOrder[second.id]).toHaveLength(beforeSecond.length)
    expect(arrangement.choiceOrder[first.id]).not.toEqual(beforeFirst)
    expect(arrangement.choiceOrder[second.id]).not.toEqual(beforeSecond)
    expect(arrangement.choiceOrder[shortAnswer.id]).toBeUndefined()
    expect(arrangement.choiceOrder[ineligible.id]).toBeUndefined()
    expect(choicesOf(renderedFirst).map((choice) => choice.id)).toEqual(beforeFirst)
    expect(orderedChoices(renderedFirst, arrangement).find((choice) => choice.correct)?.id)
      .toBe(choicesOf(first).find((choice) => choice.correct)?.id)
    expect(choicesOf(renderedSecond).map((choice) => choice.id)).toEqual(beforeSecond)

    store.undo()
    expect(store.selectedExam().arrangement.choiceOrder).toEqual({})
    expect(store.canUndo()).toBe(true)
    store.undo()
    expect(renderedIds(store)).toEqual([first.id, second.id, shortAnswer.id])
  })

  test('does not record an answer shuffle when every selection is ineligible', async () => {
    const { store, questions } = await withExamWorkingCopy(1, 'open')
    const before = store.getState()

    store.shuffleSelectedAnswers([questions[0]!.id])

    expect(store.getState()).toBe(before)
  })
})

describe('hiding incorrect answers on the Working Copy', () => {
  function capitals(): Question {
    const answers = [['Lyon', false], ['Paris', true], ['Nice', false], ['Lille', false], ['None of these', false]] as const
    return {
      id: crypto.randomUUID(),
      type: 'multiple-choice',
      columns: 2,
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Which city is the capital of France?' }] },
          {
            type: 'multipleChoice',
            content: answers.map(([text, correct]) => ({
              type: 'multipleChoiceChoice',
              attrs: { id: crypto.randomUUID(), correct },
              content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
            })),
          },
        ],
      },
    }
  }

  test('shows fewer incorrect answers as one undo step, keeping the Question whole, and survives a shuffle', async () => {
    const { store } = await freshStore()
    const question = capitals()
    store.createInQuestionBank(question)
    store.addToWorkingCopy(question)
    const authored = choicesOf(question).map(({ id }) => id)

    store.setShownIncorrect([question.id], 2)

    const shownNow = () => {
      const { exam, arrangement } = store.selectedExam()
      return shownChoices(exam.questions[0]!, arrangement)
    }
    expect(store.getState().workingCopy.hiddenAnswers?.[question.id]).toHaveLength(2)
    expect(shownNow().map(({ id }) => id)).toContain(authored[1])
    expect(shownNow().at(-1)!.id).toBe(authored[4])
    expect(shownNow()).toHaveLength(3)
    expect(choicesOf(store.getState().questionBank.questions[0]!).map(({ id }) => id)).toEqual(authored)

    store.shuffleSelectedAnswers([question.id])
    expect(store.getState().workingCopy.hiddenAnswers?.[question.id]).toHaveLength(2)
    expect(shownNow()).toHaveLength(3)

    store.undo()
    store.undo()
    expect(store.getState().workingCopy.hiddenAnswers).toBeUndefined()
    expect(shownNow()).toHaveLength(5)
  })

  test('a duplicate hides what its original hides', async () => {
    const { store } = await freshStore()
    const question = capitals()
    store.createInQuestionBank(question)
    store.addToWorkingCopy(question)
    store.setShownIncorrect([question.id], 1)

    store.duplicateInWorkingCopy(question.id)

    const { exam, arrangement } = store.selectedExam()
    const [original, copy] = exam.questions
    const words = (question: Question) =>
      shownChoices(question, arrangement).map((choice) => JSON.stringify(choice.node.content))
    expect(words(copy!)).toHaveLength(2)
    expect(words(copy!)).toEqual(words(original!))
  })
})

describe('shuffling selected questions', () => {
  test('shuffles the selected scope within each Question Section as one undo step', async () => {
    const { store } = await freshStore()
    const multipleChoice = [
      createQuestion('multiple-choice'),
      createQuestion('multiple-choice'),
      createQuestion('multiple-choice'),
    ]
    const shortAnswer = [createQuestion('open'), createQuestion('open')]
    for (const question of [...multipleChoice, ...shortAnswer]) store.createInQuestionBank(question)
    store.addManyToWorkingCopy(multipleChoice.map(({ id }) => id))
    store.addManyToWorkingCopy(shortAnswer.map(({ id }) => id), {
      kind: 'new-section',
      afterSectionId: null,
    })

    store.shuffleSelectedQuestions([
      multipleChoice[0]!.id,
      multipleChoice[2]!.id,
      shortAnswer[0]!.id,
      shortAnswer[1]!.id,
    ])

    const shuffled = renderedIds(store)
    expect(shuffled.slice(0, 3)).toEqual([
      multipleChoice[2]!.id,
      multipleChoice[1]!.id,
      multipleChoice[0]!.id,
    ])
    expect(shuffled.slice(3)).toEqual([shortAnswer[1]!.id, shortAnswer[0]!.id])
    store.undo()
    expect(renderedIds(store)).toEqual([
      ...multipleChoice.map((question) => question.id),
      ...shortAnswer.map((question) => question.id),
    ])
  })

  test('does not record an action when no section has two selected questions', async () => {
    const { store, questions } = await withExamWorkingCopy(2)
    const before = store.getState()

    store.shuffleSelectedQuestions([questions[0]!.id])

    expect(store.getState()).toBe(before)
  })
})

describe('Question Sections on the Working Copy', () => {
  /** A store whose Exam prints two Multiple Choice Sections around a Short
   *  Answer one: [m1 m2] [o1] [m3 m4]. */
  async function twoMultipleChoiceSections() {
    const { backend, savedBackend, store } = await freshStore()
    const [m1, m2, o1, m3, m4] = [
      createQuestion('multiple-choice'),
      createQuestion('multiple-choice'),
      createQuestion('open'),
      createQuestion('multiple-choice'),
      createQuestion('multiple-choice'),
    ] as const
    for (const question of [m1, m2, o1, m3, m4]) store.createInQuestionBank(question)
    store.addManyToWorkingCopy([m1.id, m2.id])
    store.addToWorkingCopy(o1.id, { kind: 'new-section', afterSectionId: sectionIds(store)[0]! })
    store.addManyToWorkingCopy([m3.id, m4.id], { kind: 'new-section', afterSectionId: sectionIds(store)[1]! })
    const [first, shortAnswer, second] = sectionIds(store) as [string, string, string]
    await store.whenSettled()
    return { backend, savedBackend, store, m1, m2, o1, m3, m4, first, shortAnswer, second }
  }

  test('a question moves into any other Section, whatever types it holds', async () => {
    const { store, m1, m2, o1, m3, m4, shortAnswer } = await twoMultipleChoiceSections()
    expect(sectionContents(store)).toEqual([[m1.id, m2.id], [o1.id], [m3.id, m4.id]])

    store.moveInWorkingCopy([m1.id], beside(m4.id, 'before'))
    expect(sectionContents(store)).toEqual([[m2.id], [o1.id], [m3.id, m1.id, m4.id]])

    store.moveInWorkingCopy([m2.id], { kind: 'section-end', sectionId: shortAnswer })
    expect(sectionContents(store)).toEqual([[], [o1.id, m2.id], [m3.id, m1.id, m4.id]])

    store.moveInWorkingCopy([o1.id], beside(m3.id))
    expect(sectionContents(store)).toEqual([[], [m2.id], [m3.id, o1.id, m1.id, m4.id]])
  })

  test('a mixed selection moves whole, every type of it', async () => {
    const { store, m1, m2, o1, m3, m4, first } = await twoMultipleChoiceSections()

    store.moveInWorkingCopy([m1.id, o1.id, m4.id], { kind: 'section-end', sectionId: first })

    expect(sectionContents(store)).toEqual([[m2.id, m1.id, o1.id, m4.id], [], [m3.id]])
  })

  test('a Section a move empties stays, on the sheet and in export alike', async () => {
    const { store, m1, m2, o1, m3, m4, first, second } = await twoMultipleChoiceSections()

    store.moveInWorkingCopy([m1.id, m2.id], { kind: 'section-end', sectionId: second })

    expect(sectionContents(store)).toEqual([[], [o1.id], [m3.id, m4.id, m1.id, m2.id]])
    expect(store.getState().workingCopy.sections?.map(({ id }) => id)).toContain(first)
    const exported = prepareExport({
      examId: 'exam-1',
      ...store.selectedExam(),
      configuration: DEFAULT_EXPORT_CONFIGURATION,
      history: store.exportHistory(),
      measure: unmeasured,
      createdAt: '2026-09-04T12:00:00.000Z',
      createId: () => 'record-1',
    })
    const printedSections = exported.record.plans.flatMap((plan) =>
      plan.pages.flatMap((page) =>
        page.items.flatMap((item) => (item.kind === 'section-heading' ? [item.sectionId] : [])),
      ),
    )
    expect(printedSections.length).toBeGreaterThan(0)
    expect(printedSections).toContain(first)
  })

  test('a new-Section target makes one Section directly below the one given, untitled when what moves mixes types', async () => {
    const { store, m1, m2, o1, m3, m4, first } = await twoMultipleChoiceSections()

    store.moveInWorkingCopy([o1.id, m2.id], { kind: 'new-section', afterSectionId: first })

    const sections = sectionsOf(store.selectedExam().exam)
    expect(sections).toHaveLength(4)
    expect(sections[1]).toMatchObject({ title: '', instructions: '' })
    // m2 prints before o1, and keeps doing so.
    expect(sectionContents(store)).toEqual([[m1.id], [m2.id, o1.id], [], [m3.id, m4.id]])
  })

  test('Add with no target goes to the end of the last Section, whatever its type', async () => {
    const { store, m1, m2, o1, m3, m4 } = await twoMultipleChoiceSections()
    const choice = createQuestion('multiple-choice')
    const trueFalse = createQuestion('true-false')
    store.createInQuestionBank(choice)
    store.createInQuestionBank(trueFalse)

    store.addToWorkingCopy(choice.id)
    store.addToWorkingCopy(trueFalse.id)

    expect(sectionContents(store)).toEqual([
      [m1.id, m2.id],
      [o1.id],
      [m3.id, m4.id, choice.id, trueFalse.id],
    ])
  })

  test('Add all with mixed types into an empty Exam makes one untitled Section, in the order given', async () => {
    const { store } = await freshStore()
    const questions = [
      createQuestion('true-false'),
      createQuestion('multiple-choice'),
      createQuestion('open'),
      createQuestion('true-false'),
    ]
    for (const question of questions) store.createInQuestionBank(question)

    store.addManyToWorkingCopy(questions.map(({ id }) => id))

    const sections = sectionsOf(store.selectedExam().exam)
    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject({ title: '', instructions: '' })
    expect(sectionContents(store)).toEqual([questions.map(({ id }) => id)])
    store.undo()
    expect(store.getState().workingCopy.questionIds).toEqual([])
  })

  test('Add all of one type into an empty Exam makes one Section worded for that type', async () => {
    const { store } = await freshStore()
    const questions = [createQuestion('open'), createQuestion('open')]
    for (const question of questions) store.createInQuestionBank(question)

    store.addManyToWorkingCopy(questions.map(({ id }) => id))

    const sections = sectionsOf(store.selectedExam().exam)
    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject(newSectionWording('open'))
  })

  test('several bank questions dropped on the new-Section target make one Section, in the order dragged, worded only if they share a type', async () => {
    const { store, first } = await twoMultipleChoiceSections()
    const [shortAnswer, choice, another] = [
      createQuestion('open'),
      createQuestion('multiple-choice'),
      createQuestion('open'),
    ]
    for (const question of [shortAnswer, choice, another]) store.createInQuestionBank(question)

    store.addManyToWorkingCopy([shortAnswer.id, choice.id], { kind: 'new-section', afterSectionId: first })
    expect(sectionContents(store)[1]).toEqual([shortAnswer.id, choice.id])
    expect(sectionsOf(store.selectedExam().exam)[1]).toMatchObject({ title: '', instructions: '' })

    store.addManyToWorkingCopy([another.id], { kind: 'new-section', afterSectionId: first })
    expect(sectionsOf(store.selectedExam().exam)[1]).toMatchObject(newSectionWording('open'))
  })

  test('Add all to a target adds every question there, whatever its type', async () => {
    const { store, m1, m2, o1, m3, m4, second } = await twoMultipleChoiceSections()
    const choice = createQuestion('multiple-choice')
    const shortAnswer = createQuestion('open')
    const trueFalse = createQuestion('true-false')
    for (const question of [choice, shortAnswer, trueFalse]) store.createInQuestionBank(question)

    store.addManyToWorkingCopy([shortAnswer.id, choice.id], beside(m1.id))
    expect(sectionContents(store)[0]).toEqual([m1.id, shortAnswer.id, choice.id, m2.id])

    store.addToWorkingCopy(trueFalse.id, { kind: 'section-end', sectionId: second })
    expect(sectionContents(store).slice(1)).toEqual([[o1.id], [m3.id, m4.id, trueFalse.id]])
  })

  test('moves a Section up or down past its neighbour, and a move off either end costs nothing', async () => {
    const { store, first, shortAnswer, second } = await twoMultipleChoiceSections()

    store.moveSection(first, 1)
    expect(sectionIds(store)).toEqual([shortAnswer, first, second])
    store.moveSection(second, -1)
    expect(sectionIds(store)).toEqual([shortAnswer, second, first])

    const before = store.getState()
    store.moveSection(shortAnswer, -1)
    store.moveSection(first, 1)
    expect(store.getState()).toBe(before)

    store.undo()
    expect(sectionIds(store)).toEqual([shortAnswer, first, second])
  })

  test('deleting a Section Removes its questions, keeps them banked, and one undo restores them', async () => {
    const { store, m1, m2, o1, m3, m4, first, shortAnswer, second } = await twoMultipleChoiceSections()

    store.deleteSection(first)

    expect(sectionIds(store)).toEqual([shortAnswer, second])
    expect(renderedIds(store)).toEqual([o1.id, m3.id, m4.id])
    expect(bankIds(store)).toContain(m1.id)
    expect(store.getState().workingCopy.sectionOf?.[m1.id]).toBeUndefined()

    store.undo()
    expect(sectionIds(store)).toEqual([first, shortAnswer, second])
    expect(sectionContents(store)).toEqual([[m1.id, m2.id], [o1.id], [m3.id, m4.id]])
  })

  test('starting a new Section at a question is one undoable step that marks the Working Copy changed', async () => {
    const { store, m1, m2, o1, m3, m4, first, shortAnswer, second } = await twoMultipleChoiceSections()

    store.splitSection(m2.id)

    const made = sectionIds(store)[1]!
    expect(sectionIds(store)).toEqual([first, made, shortAnswer, second])
    expect(sectionContents(store)).toEqual([[m1.id], [m2.id], [o1.id], [m3.id, m4.id]])
    expect(sectionsOf(store.selectedExam().exam)[1]).toMatchObject(newSectionWording('multiple-choice'))
    expect(renderedIds(store)).toEqual([m1.id, m2.id, o1.id, m3.id, m4.id])
    expect(store.getState().dirty).toBe(true)

    const before = store.getState()
    store.splitSection(m1.id)
    expect(store.getState()).toBe(before)

    store.undo()
    expect(sectionIds(store)).toEqual([first, shortAnswer, second])
    expect(sectionContents(store)).toEqual([[m1.id, m2.id], [o1.id], [m3.id, m4.id]])
  })

  test('moving a selection to a new Section puts it where its first question was, in one undo step', async () => {
    const { store, m1, m2, o1, m3, m4, first, shortAnswer, second } = await twoMultipleChoiceSections()

    store.moveToNewSection([m3.id, m2.id])

    const made = sectionIds(store)[1]!
    expect(sectionIds(store)).toEqual([first, made, shortAnswer, second])
    expect(sectionContents(store)).toEqual([[m1.id], [m2.id, m3.id], [o1.id], [m4.id]])

    store.undo()
    expect(sectionContents(store)).toEqual([[m1.id, m2.id], [o1.id], [m3.id, m4.id]])
  })

  test('inserting an empty Section names it, and it stays on the sheet and in export', async () => {
    const { store, first, shortAnswer, second } = await twoMultipleChoiceSections()

    const made = store.insertSection(shortAnswer, 'above')

    expect(sectionIds(store)).toEqual([first, made, shortAnswer, second])
    expect(sectionContents(store)[1]).toEqual([])
    expect(store.insertSection('gone', 'below')).toBeNull()

    store.undo()
    expect(sectionIds(store)).toEqual([first, shortAnswer, second])
  })

  test('merging Sections keeps this Section\'s wording, deletes the other, and one undo brings it back', async () => {
    const { store, m1, m2, o1, m3, m4, first, shortAnswer, second } = await twoMultipleChoiceSections()
    store.setSectionHeading(second, { title: 'Bonus' })

    store.mergeSection(second, -1)

    expect(sectionIds(store)).toEqual([first, second])
    expect(sectionContents(store)).toEqual([[m1.id, m2.id], [o1.id, m3.id, m4.id]])
    expect(sectionsOf(store.selectedExam().exam)[1]!.title).toBe('Bonus')
    expect(renderedIds(store)).toEqual([m1.id, m2.id, o1.id, m3.id, m4.id])

    const before = store.getState()
    store.mergeSection(first, -1)
    expect(store.getState()).toBe(before)

    store.undo()
    expect(sectionIds(store)).toEqual([first, shortAnswer, second])
    expect(sectionContents(store)).toEqual([[m1.id, m2.id], [o1.id], [m3.id, m4.id]])
  })

  test('a Section is reworded alone, not every Section worded as it was', async () => {
    const { store, second } = await twoMultipleChoiceSections()

    store.setSectionHeading(second, { title: 'Bonus' })

    expect(sectionsOf(store.selectedExam().exam).map(({ title }) => title)).toEqual([
      'Multiple Choice',
      'Short Answer',
      'Bonus',
    ])
  })

  test('shuffling selected questions keeps each within its own Section', async () => {
    const { store, m1, m2, o1, m3, m4 } = await twoMultipleChoiceSections()

    store.shuffleSelectedQuestions([m1.id, m2.id, m3.id, m4.id])

    expect(sectionContents(store)).toEqual([[m2.id, m1.id], [o1.id], [m4.id, m3.id]])
  })

  test('a duplicate lands directly after its original, in its original’s Section', async () => {
    const { store, m1, m2, o1, m3, m4 } = await twoMultipleChoiceSections()

    store.duplicateInWorkingCopy(m4.id)

    const copyId = renderedIds(store).at(-1)!
    expect(copyId).not.toBe(m4.id)
    expect(sectionContents(store)).toEqual([[m1.id, m2.id], [o1.id], [m3.id, m4.id, copyId]])

    store.duplicateInWorkingCopy(m1.id)
    expect(sectionContents(store)[0]).toHaveLength(3)
    expect(sectionContents(store)[0]![0]).toBe(m1.id)
  })

  test('Sections survive a reload from the Working Copy backup', async () => {
    const { backend, savedBackend, store, second } = await twoMultipleChoiceSections()
    store.setSectionHeading(second, { instructions: '' })
    await store.whenSettled()
    const contents = sectionContents(store)

    const reloaded = await loadExamStore(backend, savedBackend)

    expect(sectionContents(reloaded)).toEqual(contents)
    expect(sectionsOf(reloaded.selectedExam().exam)[2]).toMatchObject({ id: second, instructions: '' })
  })

  test('a Working Copy written before Sections were stored keeps its wording when its Sections are first stored', () => {
    const [choice, shortAnswer, spare] = [
      createQuestion('multiple-choice'),
      createQuestion('open'),
      createQuestion('open'),
    ]
    const initial: AuthoringState = {
      questionBank: { questions: [choice!, shortAnswer!, spare!] },
      workingCopy: {
        title: 'Legacy',
        questionIds: [shortAnswer!.id, choice!.id],
        sectionHeadings: { open: { title: 'Essays', instructions: '' } },
      },
      dirty: false,
    }
    const store = createExamStore({ backend: memory(initial), initial })
    expect(sectionsOf(store.selectedExam().exam).map(({ id }) => id)).toEqual(['multiple-choice', 'open'])

    store.addToWorkingCopy(spare!.id)

    const { workingCopy } = store.getState()
    // Kept: nothing the teacher wrote is thrown away by storing Sections.
    expect(workingCopy.sectionHeadings).toEqual({ open: { title: 'Essays', instructions: '' } })
    expect(workingCopy.sections).toEqual([
      { id: 'multiple-choice', ...newSectionWording('multiple-choice') },
      { id: 'open', title: 'Essays', instructions: '' },
    ])
    expect(sectionContents(store)).toEqual([[choice!.id], [shortAnswer!.id, spare!.id]])

    store.undo()
    expect(store.getState().workingCopy.sectionHeadings).toEqual({
      open: { title: 'Essays', instructions: '' },
    })
  })

  test('wording written before Sections were stored, for a type the Exam had none of, begins that type\'s first Section', () => {
    const [choice, essay] = [createQuestion('multiple-choice'), createQuestion('open')]
    const legacy = { open: { title: 'Essays', instructions: 'Write in full sentences.' } }

    // An Exam with nothing on it yet: its first Question starts its first Section.
    const empty: AuthoringState = {
      questionBank: { questions: [choice!, essay!] },
      workingCopy: { title: 'Legacy', questionIds: [], sectionHeadings: legacy },
      dirty: false,
    }
    const first = createExamStore({ backend: memory(empty), initial: empty })
    first.addToWorkingCopy(essay!.id)
    expect(first.getState().workingCopy.sections).toEqual([
      { id: expect.any(String), title: 'Essays', instructions: 'Write in full sentences.' },
    ])

    // An Exam with other Questions: a new Section for this type starts from it too.
    const other: AuthoringState = {
      questionBank: { questions: [choice!, essay!] },
      workingCopy: { title: 'Legacy', questionIds: [choice!.id], sectionHeadings: legacy },
      dirty: false,
    }
    const second = createExamStore({ backend: memory(other), initial: other })
    second.addToWorkingCopy(essay!.id, { kind: 'new-section', afterSectionId: null })
    expect(second.getState().workingCopy.sections?.at(-1)).toMatchObject({
      title: 'Essays',
      instructions: 'Write in full sentences.',
    })
  })
})

describe('duplicating', () => {
  test('banks a copy after the original with fresh identities and the visible presentation', async () => {
    const { store, questions } = await withExamWorkingCopy(2)
    const original = questions[0]!
    store.setQuestionColumns([original.id], 4)
    store.shuffleSelectedAnswers([original.id])
    const visibleOrder = store.selectedExam().arrangement.choiceOrder[original.id]!

    store.duplicateInWorkingCopy(original.id)

    const copyId = renderedIds(store)[1]!
    const copy = store.getState().questionBank.questions.find(({ id }) => id === copyId)!
    const originalChoiceIds = choicesOf(original).map(({ id }) => id)
    const copiedChoiceIds = choicesOf(copy).map(({ id }) => id)
    const expectedCopiedOrder = visibleOrder.map((id) => copiedChoiceIds[originalChoiceIds.indexOf(id)]!)
    expect(copyId).not.toBe(original.id)
    expect(copiedChoiceIds.every((id) => !originalChoiceIds.includes(id))).toBe(true)
    expect(renderedIds(store)).toEqual([original.id, copyId, questions[1]!.id])
    expect(store.getState().workingCopy.columns?.[copyId]).toBe(4)
    expect(store.getState().workingCopy.choiceOrder?.[copyId]).toEqual(expectedCopiedOrder)
    expect(bankIds(store)).toHaveLength(3)

    store.undo()
    expect(renderedIds(store)).toEqual(questions.map(({ id }) => id))
  })
})

describe('the dirty flag and persistence', () => {
  test('Save does not overwrite authoring work made while an earlier write settles', async () => {
    let working: AuthoringState | null = null
    let saved: SavedState | null = null
    let releaseFirstWrite = () => undefined
    let firstWrite = true
    let queued = Promise.resolve()
    const schedule = (operation: () => Promise<void> | void) => {
      const result = queued.then(operation)
      queued = result.catch(() => undefined)
      return result
    }
    const backend: DurableAuthoringBackend = {
      read: async () => working,
      readSaved: async () => saved,
      readExportHistory: async () => ({ records: [] }),
      write: (value) =>
        schedule(async () => {
          if (firstWrite) {
            firstWrite = false
            await new Promise<void>((resolve) => {
              releaseFirstWrite = resolve
            })
          }
          working = structuredClone(value)
        }),
      initialize: (value, initialWorking) =>
        schedule(() => {
          saved = structuredClone(value)
          working = structuredClone(initialWorking)
        }),
      commitSaved: (value) =>
        schedule(() => {
          saved = structuredClone(value)
          working = { ...structuredClone(value), dirty: false }
        }),
      commitExportRecord: async () => undefined,
    }
    const store = await loadExamStore(backend)
    const first = createQuestion('multiple-choice')
    const addedWhileSaving = createQuestion('open')
    store.createInQuestionBank(first)
    store.addToWorkingCopy(first)
    await Promise.resolve()

    const saving = store.save()
    store.createInQuestionBank(addedWhileSaving)
    releaseFirstWrite()
    await saving
    await store.whenSettled()

    const reloaded = await loadExamStore(backend)
    expect(bankIds(reloaded)).toEqual([first.id, addedWhileSaving.id])
    expect(renderedIds(reloaded)).toEqual([first.id])
  })

  test('dirty compares the Working Copy composition with the saved Exam', async () => {
    const { store, questions } = await withExamWorkingCopy(1)
    await store.save()

    // Canonical content stays live but is not the saved Exam composition.
    store.updateInQuestionBank({ ...questions[0]!, columns: 4 })
    expect(store.getState().dirty).toBe(false)

    store.setTitle('Chem Unit 3')
    expect(store.getState().dirty).toBe(true)
    store.setTitle('Untitled Exam')
    expect(store.getState().dirty).toBe(false)

    // Save retains command history; Undo afterward returns to an unsaved copy.
    store.setTitle('Saved title')
    await store.save()
    store.undo()
    expect(store.getState().workingCopy.title).toBe('Untitled Exam')
    expect(store.getState().dirty).toBe(true)
  })

  test('section wording and heading size are saved Exam presentation that reaches the rendered Exam', async () => {
    const { store } = await withExamWorkingCopy(1)
    await store.save()

    const [sectionId] = sectionIds(store)
    store.setSectionHeading(sectionId!, { title: 'Choose One', instructions: '' })
    expect(store.getState().dirty).toBe(true)
    expect(store.selectedExam().exam.sections).toEqual([
      { id: sectionId!, title: 'Choose One', instructions: '' },
    ])
    store.setHeadingSize('small')
    expect(store.selectedExam().exam.headingSize).toBe('small')

    // Worded as it was saved, and at the default size, the Working Copy
    // matches the saved Exam again.
    store.setSectionHeading(sectionId!, newSectionWording('multiple-choice'))
    store.setHeadingSize('normal')
    expect(store.getState().workingCopy.sections).toEqual([
      { id: sectionId!, ...newSectionWording('multiple-choice') },
    ])
    expect(store.getState().workingCopy.headingSize).toBeUndefined()
    expect(store.selectedExam().exam.headingSize).toBeUndefined()
    expect(store.getState().dirty).toBe(false)

    store.undo()
    expect(store.selectedExam().exam.headingSize).toBe('small')
  })

  test('text size is saved Exam presentation, and normal stores nothing', async () => {
    const { store } = await withExamWorkingCopy(1)
    await store.save()

    store.setTextSize('large')
    expect(store.getState().dirty).toBe(true)
    expect(store.selectedExam().exam.textSize).toBe('large')

    store.setTextSize('normal')
    expect(store.getState().workingCopy.textSize).toBeUndefined()
    expect(store.selectedExam().exam.textSize).toBeUndefined()
    expect(store.getState().dirty).toBe(false)
  })

  test('the Paper Style is saved Exam presentation, undoable, and Standard stores nothing', async () => {
    const { store } = await withExamWorkingCopy(1)
    await store.save()

    store.setPaperStyle('classic')
    expect(store.getState().dirty).toBe(true)
    expect(store.selectedExam().exam.paperStyle).toBe('classic')

    store.setPaperStyle('standard')
    expect(store.getState().workingCopy.paperStyle).toBeUndefined()
    expect(store.selectedExam().exam.paperStyle).toBeUndefined()
    expect(store.getState().dirty).toBe(false)

    store.undo()
    expect(store.selectedExam().exam.paperStyle).toBe('classic')
  })

  test('a Working Copy stored before the Paper Style was renamed keeps its style', async () => {
    const stored = createAuthoringState()
    const legacy = {
      ...stored,
      workingCopy: { ...stored.workingCopy, questionStyle: 'condensed' },
    } as unknown as AuthoringState
    const store = await loadExamStore(memory(legacy), createMemoryBackend<SavedState>())
    expect(store.getState().workingCopy.paperStyle).toBe('condensed')
    expect(store.getState().workingCopy).not.toHaveProperty('questionStyle')
  })

  test('a Working Copy stored with the withdrawn Paper Details loads without them', async () => {
    const stored = createAuthoringState()
    const withDetails = {
      ...stored,
      workingCopy: {
        ...stored.workingCopy,
        paperStyle: 'exam-board',
        paperDetails: { subject: 'Biology', paperCode: 'BIO-1', candidateFields: ['name'] },
      },
    } as unknown as AuthoringState
    const store = await loadExamStore(memory(withDetails), createMemoryBackend<SavedState>())
    expect(store.getState().workingCopy.paperStyle).toBe('exam-board')
    expect(store.getState().workingCopy).not.toHaveProperty('paperDetails')
    expect(store.selectedExam().exam).not.toHaveProperty('paperDetails')
  })

  test('header lines are saved Exam presentation, and the default stores nothing', async () => {
    const { store } = await withExamWorkingCopy(1)
    await store.save()

    store.setHeaderLine('first', 'Student: ____')
    expect(store.getState().dirty).toBe(true)
    expect(store.selectedExam().exam.header).toEqual({ first: 'Student: ____' })

    store.setHeaderLine('first', null)
    expect(store.getState().workingCopy.header).toBeUndefined()
    expect(store.selectedExam().exam.header).toBeUndefined()
    expect(store.getState().dirty).toBe(false)

    store.undo()
    expect(store.selectedExam().exam.header).toEqual({ first: 'Student: ____' })
  })

  test('page margins are saved Exam presentation, and the default stores nothing', async () => {
    const { store } = await withExamWorkingCopy(1)
    await store.save()

    store.setMargins(['top', 'right', 'bottom', 'left'], 1)
    expect(store.getState().dirty).toBe(true)
    expect(store.selectedExam().exam.margins).toEqual({ top: 1, right: 1, bottom: 1, left: 1 })

    store.setMargins(['left'], 1.25)
    expect(store.selectedExam().exam.margins).toEqual({ top: 1, right: 1, bottom: 1, left: 1.25 })

    store.setMargins(['top', 'right', 'bottom', 'left'], 0.75)
    expect(store.getState().workingCopy.margins).toBeUndefined()
    expect(store.selectedExam().exam.margins).toBeUndefined()
    expect(store.getState().dirty).toBe(false)

    store.undo()
    expect(store.selectedExam().exam.margins).toEqual({ top: 1, right: 1, bottom: 1, left: 1.25 })
  })

  test('one scrub of a margin field is one undo step', async () => {
    const { store } = await withExamWorkingCopy(1)
    await store.save()

    store.setMargins(['top', 'right', 'bottom', 'left'], 0.8)
    store.setMargins(['top', 'right', 'bottom', 'left'], 0.9, { continuing: true })
    store.setMargins(['top', 'right', 'bottom', 'left'], 1.1, { continuing: true })
    expect(store.selectedExam().exam.margins?.top).toBe(1.1)

    store.undo()
    expect(store.selectedExam().exam.margins).toBeUndefined()
    store.redo()
    expect(store.selectedExam().exam.margins?.top).toBe(1.1)
  })

  test('a change that changes nothing costs no undo step, dirty flag, or write', async () => {
    // The store's one-action invariant cuts both ways: an action that leaves
    // the state exactly as it found it is not an action. Setting the title it
    // already has, or the column count already in force, must not hand the
    // teacher an undo step that appears to do nothing.
    const cases: Array<(store: ExamStore, question: Question) => void> = [
      (store) => store.setTitle('Chem Unit 3'),
      (store, question) => store.setQuestionColumns([question.id], 4),
      (store) => store.setSectionHeading(sectionIds(store)[0]!, { title: 'Essays' }),
      (store) => store.setHeadingSize('large'),
      (store) => store.setHeaderLine('later', ''),
      (store) => store.setTextSize('small'),
      (store) => store.setMargins(['bottom'], 1),
      (store) => store.setPaperStyle('condensed'),
    ]
    for (const act of cases) {
      const { backend, store, questions } = await withExamWorkingCopy(1)
      await store.save()
      const before = store.getState()

      act(store, questions[0]!)
      await store.save()
      const changed = store.getState()
      const writes = backend.writes

      // The same action again, with nothing left for it to do.
      act(store, questions[0]!)
      await store.whenSettled()

      expect(store.getState()).toBe(changed)
      expect(store.getState().dirty).toBe(false)
      expect(backend.writes).toBe(writes)

      // One undo steps past the real change, not a phantom one. The saved
      // comparison correctly marks this earlier arrangement as unsaved.
      store.undo()
      expect(store.getState().workingCopy).toEqual(before.workingCopy)
      expect(store.getState().dirty).toBe(true)
    }
  })

  test('adding a bank-only question to the Working Copy raises the dirty flag', async () => {
    const { store } = await freshStore()
    const question = createQuestion('open')
    store.createInQuestionBank(question)
    await store.save()

    store.addToWorkingCopy(question.id)

    expect(store.getState().dirty).toBe(true)
  })

  test('export records unsaved work without replacing the explicit saved Exam', async () => {
    const { store, questions } = await withExamWorkingCopy(1, 'open')
    await store.save()
    store.setTitle('Unsaved export title')
    const selected = store.selectedExam()
    const exported = prepareExport({
      examId: 'exam-1',
      ...selected,
      configuration: DEFAULT_EXPORT_CONFIGURATION,
      history: store.exportHistory(),
      measure: unmeasured,
      createdAt: '2026-09-04T12:00:00.000Z',
      createId: () => 'record-1',
    })

    await store.publish(exported.record)

    expect(store.exportHistory().records).toEqual([exported.record])
    expect(store.getState().dirty).toBe(true)
    await store.discard()
    expect(store.getState().workingCopy.title).toBe('Untitled Exam')
    expect(renderedIds(store)).toEqual([questions[0]!.id])
  })

  test('historical re-export appends a new event without changing current authoring', async () => {
    const { backend, savedBackend, store } = await withExamWorkingCopy(1, 'open')
    await store.save()
    const prepared = prepareExport({
      examId: 'exam-1',
      ...store.selectedExam(),
      configuration: DEFAULT_EXPORT_CONFIGURATION,
      history: store.exportHistory(),
      measure: unmeasured,
      createdAt: '2026-09-04T12:00:00.000Z',
      createId: () => 'record-1',
    })
    await store.publish(prepared.record)
    store.setTitle('Unsaved live work')
    await store.whenSettled()
    const before = store.getState()
    const saved = structuredClone(savedBackend.value)
    const writes = backend.writes

    const historical = prepareHistoricalExport({
      record: prepared.record,
      createdAt: '2026-09-04T12:01:00.000Z',
      createId: () => 'record-2',
    })
    await store.publish(historical.record)

    expect(store.exportHistory().records.map(({ id }) => id)).toEqual(['record-1', 'record-2'])
    expect(store.getState()).toBe(before)
    expect(savedBackend.value).toEqual(saved)
    expect(backend.writes).toBe(writes)
  })

  test('a refresh restores the Question Bank, the Working Copy and the dirty flag', async () => {
    const { backend, store, questions } = await withExamWorkingCopy(2)
    const bankOnly = createQuestion('open')
    store.createInQuestionBank(bankOnly)
    store.moveInWorkingCopy([questions[1]!.id], beside(questions[0]!.id, 'before'))
    store.setTitle('Chem Unit 3')
    await store.whenSettled()

    const reloaded = await loadExamStore(backend)

    expect(reloaded.getState().workingCopy.title).toBe('Chem Unit 3')
    expect(bankIds(reloaded)).toEqual([
      questions[0]!.id,
      questions[1]!.id,
      bankOnly.id,
    ])
    expect(renderedIds(reloaded)).toEqual([questions[1]!.id, questions[0]!.id])
    // The recovered Working Copy becomes the initial saved baseline only for
    // legacy data that predates explicit saved snapshots.
    expect(reloaded.getState().dirty).toBe(false)
  })

  test('bank-only work is durable even though it is on no exam', async () => {
    const { backend, store } = await freshStore()
    const question = createQuestion('open')
    store.createInQuestionBank(question)
    await store.whenSettled()

    const reloaded = await loadExamStore(backend)

    expect(bankIds(reloaded)).toEqual([question.id])
    expect(reloaded.getState().workingCopy.questionIds).toEqual([])
  })

  test('saving clears the dirty flag and reloads without a working draft', async () => {
    const { savedBackend, store, questions } = await withExamWorkingCopy(1)
    store.setTitle('Persisted')

    await store.save()

    expect(store.getState().dirty).toBe(false)
    expect(store.hasSavedExam()).toBe(true)
    const reloaded = await loadExamStore(memory(), savedBackend)
    expect(reloaded.getState().workingCopy.title).toBe('Persisted')
    expect(renderedIds(reloaded)).toEqual([questions[0]!.id])
    expect(reloaded.getState().dirty).toBe(false)
  })

  test('discard restores the last saved Question Bank and Working Copy', async () => {
    const { store, questions } = await withExamWorkingCopy(2)
    await store.save()
    store.removeFromWorkingCopy([questions[0]!.id])
    store.setTitle('Changed')

    await store.discard()

    expect(store.getState().workingCopy.title).toBe('Untitled Exam')
    expect(renderedIds(store)).toEqual(questions.map((question) => question.id))
    expect(store.getState().dirty).toBe(false)
  })

  test('Discard before the first user Save retains canonical Question Content', async () => {
    const { store } = await freshStore()
    const question = createQuestion('open')
    store.createInQuestionBank(question)
    store.addToWorkingCopy(question)

    await store.discard()

    expect(bankIds(store)).toEqual([question.id])
    expect(store.getState().workingCopy.questionIds).toEqual([])
    expect(store.getState().dirty).toBe(false)
  })

  test('Discard restores the saved arrangement while retaining latest Question Content', async () => {
    const { store, questions } = await withExamWorkingCopy(1, 'open')
    await store.save()
    const saved = questions[0]!
    store.updateInQuestionBank({
      ...saved,
      columns: 4,
      doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Latest wording' }] }] },
    })
    store.setTitle('Changed title')

    await store.discard()

    expect(store.getState().workingCopy.title).toBe('Untitled Exam')
    expect(store.getState().questionBank.questions[0]).toMatchObject({
      id: saved.id,
      columns: 4,
      doc: { content: [{ content: [{ text: 'Latest wording' }] }] },
    })
    expect(store.selectedExam().exam.questions[0]!.columns).toBe(saved.columns)
    expect(store.canUndo()).toBe(false)
    expect(store.canRedo()).toBe(false)
  })

  test('reports a failed Working Copy backup without losing the in-memory change', async () => {
    const backend: Backend<AuthoringState> = {
      read: async () => null,
      write: async () => { throw new Error('storage unavailable') },
    }
    const store = await loadExamStore(backend)

    store.setTitle('Still in memory')
    expect(store.backupStatus()).toBe('pending')
    await store.whenSettled()

    expect(store.backupStatus()).toBe('failed')
    expect(store.getState().workingCopy.title).toBe('Still in memory')
    expect(store.getState().dirty).toBe(true)
  })

  test('subscribers are notified of a change', async () => {
    const { store } = await freshStore()
    let notified = 0
    const unsubscribe = store.subscribe(() => {
      notified += 1
    })
    store.setTitle('One')
    expect(notified).toBe(1)
    unsubscribe()
    store.setTitle('Two')
    expect(notified).toBe(1)
  })

  test('snapshots keep stable identities while nothing changes', async () => {
    const { store } = await withExamWorkingCopy(1)
    const state = store.getState()
    const selected = store.selectedExam()
    expect(store.getState()).toBe(state)
    expect(store.selectedExam()).toBe(selected)
  })
})

describe('Save As', () => {
  test('moves a dirty Working Copy and its Undo history into a separately saved Exam', async () => {
    const { store, questions } = await withExamWorkingCopy(2)
    await store.save()
    store.setTitle('Biology quiz')
    store.moveInWorkingCopy([questions[1]!.id], beside(questions[0]!.id, 'before'))
    const sourceBefore = structuredClone(store.getState())
    let copied: import('./exam-store').SaveAsSnapshot | undefined

    const session = await store.saveAs(async (snapshot) => { copied = structuredClone(snapshot) })

    expect(copied?.targetInitial).toMatchObject({
      dirty: false,
      workingCopy: { title: 'Biology quiz Copy', questionIds: [questions[1]!.id, questions[0]!.id] },
    })
    expect(copied?.targetInitial.questionBank.questions.map(({ id }) => id)).toEqual(
      sourceBefore.questionBank.questions.map(({ id }) => id),
    )
    expect(copied?.sourceRestored.workingCopy).toMatchObject({
      title: 'Untitled Exam', questionIds: [questions[0]!.id, questions[1]!.id], columns: expect.any(Object),
    })
    expect(store.getState().workingCopy.title).toBe('Untitled Exam')
    expect(renderedIds(store)).toEqual([questions[0]!.id, questions[1]!.id])
    expect(store.canUndo()).toBe(false)
    expect(store.canRedo()).toBe(false)

    const target = createExamStore({
      backend: memory(),
      saved: copied!.targetInitial,
      initial: copied!.targetInitial,
      initialHistory: session.history,
    })
    expect(target.getState().dirty).toBe(false)
    expect(target.canUndo()).toBe(true)
    target.undo()
    expect(target.getState().dirty).toBe(true)
  })

  test('copies a clean Exam and leaves it unchanged if the durable operation fails', async () => {
    const { store } = await freshStore()
    await store.save()
    const before = store.getState()

    await expect(store.saveAs(async () => { throw new Error('disk full') })).rejects.toThrow('disk full')

    expect(store.getState()).toBe(before)
    expect(store.getState().dirty).toBe(false)
    expect(store.getState().workingCopy.title).toBe('Untitled Exam')
  })
})

describe('undo and redo', () => {
  test('each authoring action is exactly one step in both directions', async () => {
    const { store } = await freshStore()
    const first = createQuestion('multiple-choice')
    const second = createQuestion('multiple-choice')

    store.createInQuestionBank(first)
    store.addToWorkingCopy(first)
    store.createInQuestionBank(second)
    store.addToWorkingCopy(second.id)
    store.moveInWorkingCopy([second.id], beside(first.id, 'before'))
    store.removeFromWorkingCopy([first.id])
    expect(renderedIds(store)).toEqual([second.id])

    store.undo()
    expect(renderedIds(store)).toEqual([second.id, first.id])
    store.undo()
    expect(renderedIds(store)).toEqual([first.id, second.id])
    store.undo()
    expect(renderedIds(store)).toEqual([first.id])
    expect(bankIds(store)).toEqual([first.id, second.id])
    store.undo()
    expect(bankIds(store)).toEqual([first.id])
    store.undo()
    expect(renderedIds(store)).toEqual([])
    store.undo()
    expect(bankIds(store)).toEqual([])
    expect(store.canUndo()).toBe(false)

    store.redo()
    expect(bankIds(store)).toEqual([first.id])
    store.redo()
    store.redo()
    store.redo()
    store.redo()
    store.redo()
    expect(renderedIds(store)).toEqual([second.id])
    expect(store.canRedo()).toBe(false)
  })

  test('undoing a Remove puts the reference back where it was', async () => {
    const { store, questions } = await withExamWorkingCopy(3)

    store.removeFromWorkingCopy([questions[1]!.id])
    store.undo()

    expect(renderedIds(store)).toEqual(questions.map((question) => question.id))
  })

  test('a new action after an undo clears the redo branch', async () => {
    const { store } = await freshStore()
    store.setTitle('First')
    store.undo()
    store.setTitle('Second')

    expect(store.canRedo()).toBe(false)
    expect(store.getState().workingCopy.title).toBe('Second')
  })

  test('restored history is mirrored, so a refresh agrees with the screen', async () => {
    const { backend, store } = await freshStore()
    store.setTitle('Changed')
    store.undo()
    await store.whenSettled()

    expect(backend.value?.workingCopy.title).toBe('Untitled Exam')
  })

  test('forced deletion clears history and cannot be restored by Undo or Discard', async () => {
    const { store, questions } = await withExamWorkingCopy(2)
    await store.save()
    store.setTitle('Unsaved title')
    store.acceptForcedDeletion([questions[0]!.id])

    expect(renderedIds(store)).toEqual([questions[1]!.id])
    expect(store.canUndo()).toBe(false)
    expect(store.canRedo()).toBe(false)

    await store.discard()
    expect(renderedIds(store)).toEqual([questions[1]!.id])
    expect(store.getState().workingCopy.title).toBe('Untitled Exam')
  })

  test('an untouched store has nothing to undo or redo', async () => {
    const { store } = await freshStore()
    expect(store.canUndo()).toBe(false)
    expect(store.canRedo()).toBe(false)
    expect(createAuthoringState().dirty).toBe(false)
  })
})

describe('work space', () => {
  test('is Exam presentation: set on the Working Copy, snapped to whole lines, never on the Question', async () => {
    const { store, questions } = await withExamWorkingCopy(1, 'open')
    const [question] = questions

    store.setQuestionWorkSpace([question!.id], { height: 150, style: 'lines' })

    expect(store.getState().workingCopy.workSpace?.[question!.id]).toEqual({
      height: 160,
      style: 'lines',
      fill: false,
    })
    expect(store.selectedExam().exam.workSpace?.[question!.id]?.height).toBe(160)
    expect(store.getState().questionBank.questions[0]).not.toHaveProperty('workSpace')
  })

  test('changes only the fields given, and taking all the room away stores "None"', async () => {
    const { store, questions } = await withExamWorkingCopy(1, 'open')
    const id = questions[0]!.id

    store.setQuestionWorkSpace([id], { height: 128, style: 'lines' })
    store.setQuestionWorkSpace([id], { fill: true })
    expect(store.getState().workingCopy.workSpace?.[id]).toEqual({
      height: 128,
      style: 'lines',
      fill: true,
    })

    store.setQuestionWorkSpace([id], { height: 0, fill: false })
    expect(store.getState().workingCopy.workSpace?.[id]).toEqual({ height: 0, style: 'lines', fill: false })
  })

  test('keeps "None" picked under Standard as none when the Exam takes a style that rules lines', async () => {
    const { store, questions } = await withExamWorkingCopy(2, 'open')
    const [chosen, untouched] = questions.map(({ id }) => id) as [string, string]
    // Under Standard the position already prints no room; picking None is
    // still the teacher's own setting.
    store.setQuestionWorkSpace([chosen], { height: 0, fill: false })
    expect(store.getState().workingCopy.workSpace?.[chosen]).toEqual({ height: 0, style: 'blank', fill: false })
    // A position the teacher never touched stores nothing.
    expect(store.getState().workingCopy.workSpace?.[untouched]).toBeUndefined()

    for (const style of ['classic', 'condensed', 'exam-board'] as const) {
      store.setPaperStyle(style)
      const { exam } = store.selectedExam()
      expect(workSpaceOf(exam, chosen).height, style).toBe(0)
      // …while the untouched one takes the style's lines.
      expect(workSpaceOf(exam, untouched), style).toMatchObject({ height: 96, style: 'lines' })
    }
  })

  test('under a Paper Style that rules lines, starts from its lines, and keeps "None" as a setting of its own', async () => {
    const { store, questions } = await withExamWorkingCopy(1, 'open')
    const id = questions[0]!.id
    store.setPaperStyle('classic')
    // Nothing stored: the position prints the style's three lines.
    expect(store.getState().workingCopy.workSpace?.[id]).toBeUndefined()

    store.setQuestionWorkSpace([id], { fill: true })
    expect(store.getState().workingCopy.workSpace?.[id]).toEqual({ height: 96, style: 'lines', fill: true })

    // Taking the room away is stored, so it wins over the style's lines.
    store.setQuestionWorkSpace([id], { height: 0, fill: false })
    expect(store.getState().workingCopy.workSpace?.[id]).toEqual({ height: 0, style: 'lines', fill: false })
    expect(store.selectedExam().exam.workSpace?.[id]?.height).toBe(0)
  })

  test('is never changed by switching Paper Style', async () => {
    const { store, questions } = await withExamWorkingCopy(1, 'open')
    const id = questions[0]!.id
    store.setQuestionWorkSpace([id], { height: 160, style: 'blank' })
    const stored = store.getState().workingCopy.workSpace
    for (const style of ['classic', 'condensed', 'standard'] as const) {
      store.setPaperStyle(style)
      expect(store.getState().workingCopy.workSpace).toEqual(stored)
    }
  })

  test('leaves every other Question Type in a selection alone', async () => {
    const { store, questions } = await withExamWorkingCopy(1, 'multiple-choice')
    const shortAnswer = createQuestion('open')
    store.createInQuestionBank(shortAnswer)
    store.addToWorkingCopy(shortAnswer)

    store.setQuestionWorkSpace([questions[0]!.id, shortAnswer.id], { height: 96 })

    expect(Object.keys(store.getState().workingCopy.workSpace ?? {})).toEqual([shortAnswer.id])
  })

  test('is one undo step, marks the Exam unsaved, and is kept by Save', async () => {
    const { store, questions } = await withExamWorkingCopy(1, 'open')
    const id = questions[0]!.id
    await store.save()

    store.setQuestionWorkSpace([id], { height: 96 })
    expect(store.getState().dirty).toBe(true)
    store.undo()
    expect(store.getState().workingCopy.workSpace?.[id]).toBeUndefined()
    expect(store.getState().dirty).toBe(false)

    store.redo()
    await store.save()
    expect(store.getState().dirty).toBe(false)
    expect(store.getState().workingCopy.workSpace?.[id]?.height).toBe(96)
  })

  test('costs nothing when it changes nothing', async () => {
    const { backend, store, questions } = await withExamWorkingCopy(1, 'open')
    const id = questions[0]!.id
    store.setQuestionWorkSpace([id], { height: 96 })
    await store.whenSettled()
    const before = store.getState()
    const writes = backend.writes

    store.setQuestionWorkSpace([id], { height: 96 })
    await store.whenSettled()

    expect(store.getState()).toBe(before)
    expect(backend.writes).toBe(writes)
  })

  test('goes with a Removed question, and is copied by Duplicate', async () => {
    const { store, questions } = await withExamWorkingCopy(2, 'open')
    const [first, second] = questions
    store.setQuestionWorkSpace([first!.id], { height: 160, style: 'lines' })
    store.setQuestionWorkSpace([second!.id], { height: 64 })

    store.removeFromWorkingCopy([second!.id])
    expect(store.getState().workingCopy.workSpace?.[second!.id]).toBeUndefined()

    store.duplicateInWorkingCopy(first!.id)
    const copyId = store.getState().workingCopy.questionIds.find(
      (id) => id !== first!.id,
    )!
    expect(store.getState().workingCopy.workSpace?.[copyId]).toEqual({
      height: 160,
      style: 'lines',
      fill: false,
    })
  })

  test('survives a reload from the Working Copy backup', async () => {
    const { backend, savedBackend, store, questions } = await withExamWorkingCopy(1, 'open')
    const id = questions[0]!.id
    store.setQuestionWorkSpace([id], { height: 96, style: 'lines', fill: true })
    await store.whenSettled()

    const reloaded = await loadExamStore(backend, savedBackend)

    expect(reloaded.getState().workingCopy.workSpace?.[id]).toEqual({
      height: 96,
      style: 'lines',
      fill: true,
    })
  })
})

describe('a Matching question’s Word Bank layout', () => {
  /** A store whose Word Bank answers all measure `width` wide. */
  async function measuredStore(width: number) {
    const backend = memory()
    const savedBackend = createMemoryBackend<SavedState>()
    const store = await loadExamStore(backend, savedBackend, () => width)
    return store
  }

  test('is concrete from the moment a Matching question is added, by the fit rule when it can measure', async () => {
    const { store, questions } = await withExamWorkingCopy(2, 'matching')
    // Nothing measures here, so a short bank goes beside by its count.
    expect(store.getState().workingCopy.wordBankLayout).toEqual({
      [questions[0]!.id]: 'beside',
      [questions[1]!.id]: 'beside',
    })

    const wide = await measuredStore(2000)
    const tooWide = createQuestion('matching')
    wide.createInQuestionBank(tooWide)
    wide.addManyToWorkingCopy([tooWide])
    expect(wide.getState().workingCopy.wordBankLayout).toEqual({ [tooWide.id]: 'above' })

    const narrow = await measuredStore(40)
    const fits = createQuestion('matching')
    narrow.createInQuestionBank(fits)
    narrow.addToWorkingCopy(fits.id)
    expect(narrow.getState().workingCopy.wordBankLayout).toEqual({ [fits.id]: 'beside' })
  })

  test('arrives above under Classic, whatever fits', async () => {
    const store = await measuredStore(40)
    store.setPaperStyle('classic')
    const question = createQuestion('matching')
    store.createInQuestionBank(question)
    store.addToWorkingCopy(question)
    expect(store.getState().workingCopy.wordBankLayout).toEqual({ [question.id]: 'above' })
  })

  test('is set on Matching questions alone, one undo step each', async () => {
    const { store, questions } = await withExamWorkingCopy(2, 'matching')
    const multipleChoice = createQuestion('multiple-choice')
    store.createInQuestionBank(multipleChoice)
    store.addToWorkingCopy(multipleChoice)
    const [first, second] = questions.map(({ id }) => id)
    await store.save()

    store.setWordBankLayout([first!, second!, multipleChoice.id], 'above')
    expect(store.getState().workingCopy.wordBankLayout).toEqual({ [first!]: 'above', [second!]: 'above' })
    expect(store.selectedExam().exam.wordBankLayout).toEqual({ [first!]: 'above', [second!]: 'above' })
    expect(store.getState().dirty).toBe(true)

    // Choosing what a question already prints changes nothing.
    store.setWordBankLayout([first!], 'above')
    store.setWordBankLayout([second!], 'beside')
    expect(store.getState().workingCopy.wordBankLayout).toEqual({ [first!]: 'above', [second!]: 'beside' })

    store.undo()
    expect(store.getState().workingCopy.wordBankLayout).toEqual({ [first!]: 'above', [second!]: 'above' })
    store.undo()
    expect(store.getState().workingCopy.wordBankLayout).toEqual({ [first!]: 'beside', [second!]: 'beside' })
    expect(store.getState().dirty).toBe(false)
  })

  test('is set again when the Paper Style changes only where the teacher did not choose it, in one undo step', async () => {
    const store = await measuredStore(40)
    const questions = [createQuestion('matching'), createQuestion('matching'), createQuestion('matching')]
    for (const question of questions) store.createInQuestionBank(question)
    store.addManyToWorkingCopy(questions)
    const [first, second, third] = questions.map(({ id }) => id)
    const layouts = () => store.getState().workingCopy.wordBankLayout
    expect(layouts()).toEqual({ [first!]: 'beside', [second!]: 'beside', [third!]: 'beside' })

    store.setWordBankLayout([first!], 'above')
    expect(store.getState().workingCopy.wordBankLayoutSet).toEqual({ [first!]: true })

    store.setPaperStyle('classic')
    expect(layouts()).toEqual({ [first!]: 'above', [second!]: 'above', [third!]: 'above' })
    // A choice made under Classic holds too.
    store.setWordBankLayout([second!], 'beside')
    store.setPaperStyle('standard')
    // Standard → Classic → Standard restores every layout the teacher did not
    // choose, and moves none they did.
    expect(layouts()).toEqual({ [first!]: 'above', [second!]: 'beside', [third!]: 'beside' })
    store.setPaperStyle('condensed')
    store.setPaperStyle('classic')
    expect(layouts()).toEqual({ [first!]: 'above', [second!]: 'beside', [third!]: 'above' })
    store.setPaperStyle('standard')
    expect(layouts()).toEqual({ [first!]: 'above', [second!]: 'beside', [third!]: 'beside' })
    // Choosing the style the Exam already has changes nothing.
    store.setPaperStyle('standard')

    store.undo()
    expect(store.getState().workingCopy.paperStyle).toBe('classic')
    expect(layouts()).toEqual({ [first!]: 'above', [second!]: 'beside', [third!]: 'above' })
  })

  test('a flip the teacher made is never moved by a change of style, even back to where it fits', async () => {
    const store = await measuredStore(2000)
    const question = createQuestion('matching')
    store.createInQuestionBank(question)
    store.addToWorkingCopy(question)
    expect(store.getState().workingCopy.wordBankLayout).toEqual({ [question.id]: 'above' })
    store.setWordBankLayout([question.id], 'beside')
    for (const style of ['classic', 'condensed', 'standard', 'classic'] as const) {
      store.setPaperStyle(style)
      expect(store.getState().workingCopy.wordBankLayout).toEqual({ [question.id]: 'beside' })
    }
    expect(store.selectedExam().exam.wordBankLayoutSet).toEqual({ [question.id]: true })
  })

  test('records the teacher’s choice only when they flip, undoably, and never on arrival', async () => {
    const { store, questions } = await withExamWorkingCopy(2, 'matching')
    const [first, second] = questions.map(({ id }) => id)
    expect(store.getState().workingCopy).not.toHaveProperty('wordBankLayoutSet')
    await store.save()

    store.setWordBankLayout([first!], 'above')
    expect(store.getState().workingCopy.wordBankLayoutSet).toEqual({ [first!]: true })
    expect(store.getState().dirty).toBe(true)
    store.undo()
    expect(store.getState().workingCopy.wordBankLayoutSet ?? {}).toEqual({})
    expect(store.getState().dirty).toBe(false)

    // A duplicate takes its original's layout, and whether the teacher chose it.
    store.setWordBankLayout([first!], 'above')
    store.duplicateInWorkingCopy(first!)
    store.duplicateInWorkingCopy(second!)
    const copies = store.getState().workingCopy.questionIds.filter((id) => id !== first && id !== second)
    expect(copies).toHaveLength(2)
    expect(store.getState().workingCopy.wordBankLayoutSet).toEqual({ [first!]: true, [copies[0]!]: true })
    store.removeFromWorkingCopy([first!])
    expect(store.getState().workingCopy.wordBankLayoutSet).toEqual({ [copies[0]!]: true })
  })

  test('reads a position stored without one by its count, and stores it once set', async () => {
    const { store, questions } = await withExamWorkingCopy(1, 'matching')
    const id = questions[0]!.id
    const state = store.getState()
    const unplaced = { ...state.workingCopy }
    delete unplaced.wordBankLayout
    const reloaded = createExamStore({
      backend: memory(),
      initial: { ...state, workingCopy: unplaced },
      saved: { questionBank: state.questionBank, workingCopy: unplaced },
    })
    expect(reloaded.selectedExam().exam).not.toHaveProperty('wordBankLayout')
    // It prints beside by its count, so choosing beside changes nothing.
    reloaded.setWordBankLayout([id], 'beside')
    expect(reloaded.getState().dirty).toBe(false)
    reloaded.setWordBankLayout([id], 'above')
    expect(reloaded.getState().workingCopy.wordBankLayout).toEqual({ [id]: 'above' })
  })

  test('goes with a question Removed from the Exam, and comes with a duplicate', async () => {
    const { store, questions } = await withExamWorkingCopy(2, 'matching')
    const [first, second] = questions.map(({ id }) => id)
    store.setWordBankLayout([first!, second!], 'above')
    store.duplicateInWorkingCopy(first!)
    const copied = store.getState().workingCopy.questionIds.find((id) => id !== first && id !== second)!
    expect(store.getState().workingCopy.wordBankLayout?.[copied]).toBe('above')
    store.removeFromWorkingCopy([second!])
    expect(store.getState().workingCopy.wordBankLayout).not.toHaveProperty(second!)
  })
})
