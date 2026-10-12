// What `QuestionReading` draws: a Question's full content, already in editor
// nodes, whichever Question shape it came from. See `question-reading.tsx`.

import {
  SECTION_LABELS,
  choicesOf,
  partsOf,
  promptsOf,
  topicsOf,
  type Difficulty,
  type Question,
  type Subpart,
} from './exam'
import { subpartLabelAt } from './export-plan'
import { bankLetter } from './matching'
import { blankAnswerBlocks } from './blank'
import { stemNodesOf, type ProseMirrorJSON } from './question-doc'

export type QuestionReadingContent = {
  typeLabel: string
  difficulty?: Difficulty
  topics: readonly string[]
  stem: ProseMirrorJSON[]
  /** `locked` marks a Locked Answer, which keeps its letter when answers are
   *  shuffled. */
  choices?: { id: string; content: ProseMirrorJSON[]; correct: boolean; locked?: boolean }[]
  matching?: {
    /** `letter` is the Word Bank letter the item is matched to, if any. */
    prompts: { id: string; content: ProseMirrorJSON[]; letter?: string }[]
    wordBank: { id: string; content: ProseMirrorJSON[] }[]
  }
  suggestedAnswer?: ProseMirrorJSON[]
  /** A Fill in the Blank question's Blanks' answers, in order, on one line —
   *  the stem draws each Blank as its line. */
  blankAnswers?: ProseMirrorJSON[]
  /** A Multipart question's Parts, lettered as the test prints them, each with its own
   *  answers or Subparts; the shared material is `stem`. */
  parts?: QuestionReadingPart[]
}

/** A Part as the reading draws it: lettered `a`, `b`, … — or, for a Subpart,
 *  numbered `i`, `ii`, … — with its own answers, or a Part's lead-in with the
 *  Subparts it holds. */
export type QuestionReadingPart = {
  id: string
  letter: string
  typeLabel: string
  stem: ProseMirrorJSON[]
  choices?: { id: string; content: ProseMirrorJSON[]; correct: boolean; locked?: boolean }[]
  suggestedAnswer?: ProseMirrorJSON[]
  subparts?: QuestionReadingPart[]
}

/** How a Part that holds Subparts is named where a reading names its type. */
export const SUBPARTS_LABEL = 'Subparts'

const childNodes = (node: ProseMirrorJSON): ProseMirrorJSON[] =>
  Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []

/** A Part that answers, or a Subpart, as the reading draws it. */
function readingOfPart(part: Subpart, letter: string): QuestionReadingPart {
  return {
    id: part.id,
    letter,
    typeLabel: SECTION_LABELS[part.type],
    stem: part.stem,
    ...(part.type === 'multiple-choice'
      ? {
          choices: part.choices.map((choice) => ({
            id: choice.id,
            content: childNodes(choice.node),
            correct: choice.correct,
            locked: choice.locked,
          })),
        }
      : {}),
    ...(part.suggestedAnswer ? { suggestedAnswer: childNodes(part.suggestedAnswer) } : {}),
  }
}

/** An editor Question, as the reading draws it. */
export function readingOfQuestion(question: Question): QuestionReadingContent {
  const base = {
    typeLabel: SECTION_LABELS[question.type],
    difficulty: question.difficulty,
    topics: topicsOf(question),
    stem: stemNodesOf(question.doc),
  }
  if (question.type === 'open') {
    return {
      ...base,
      ...(question.suggestedAnswer
        ? { suggestedAnswer: childNodes(question.suggestedAnswer) }
        : {}),
    }
  }
  if (question.type === 'fill-in-the-blank') {
    const answers = blankAnswerBlocks(question.doc)
    return { ...base, ...(answers.length > 0 ? { blankAnswers: answers } : {}) }
  }
  if (question.type === 'multipart') {
    return {
      ...base,
      parts: partsOf(question).map((part, index): QuestionReadingPart =>
        part.type === 'subparts'
          ? {
              id: part.id,
              letter: bankLetter(index).toLowerCase(),
              typeLabel: SUBPARTS_LABEL,
              stem: part.stem,
              subparts: part.subparts.map((subpart, subpartIndex) =>
                readingOfPart(subpart, subpartLabelAt(subpartIndex))),
            }
          : readingOfPart({ ...part, type: part.type }, bankLetter(index).toLowerCase())),
    }
  }
  if (question.type === 'matching') {
    const bank = choicesOf(question)
    const letters = new Map(bank.map((answer, index) => [answer.id, bankLetter(index)]))
    return {
      ...base,
      matching: {
        prompts: promptsOf(question).map((prompt) => ({
          id: prompt.id,
          content: childNodes(prompt.node),
          letter: letters.get(prompt.answerId),
        })),
        wordBank: bank.map((answer) => ({ id: answer.id, content: childNodes(answer.node) })),
      },
    }
  }
  return {
    ...base,
    choices: choicesOf(question).map((choice) => ({
      id: choice.id,
      content: childNodes(choice.node),
      correct: choice.correct,
      locked: choice.locked,
    })),
  }
}
