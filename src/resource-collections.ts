import type {
  ExamWorkspaceService,
  RecentExam,
  QuestionUsage,
} from './exam-workspaces'
import type {
  QuestionBankSummary,
  QuestionBankWorkspaceService,
} from './question-bank-workspaces'

export const HOME_PREVIEW_LIMIT = 6

export type QuestionBankCollectionItem = QuestionBankSummary & {
  usage: QuestionUsage[]
}

export async function questionBankCollection(
  banks: readonly QuestionBankSummary[],
  bankWorkspaces: QuestionBankWorkspaceService,
  workspaces: ExamWorkspaceService,
): Promise<QuestionBankCollectionItem[]> {
  return Promise.all(
    banks.map(async (bank) => ({
      ...bank,
      usage: await workspaces.resourceUsage(
        (await bankWorkspaces.read(bank.id))?.questions.map(({ id }) => id) ??
          [],
      ),
    })),
  )
}

const normalized = (value: string) => value.trim().toLocaleLowerCase()

export function filterExamCollection(
  exams: readonly RecentExam[],
  query: string,
): RecentExam[] {
  const needle = normalized(query)
  if (!needle) return [...exams]
  return exams.filter((exam) => normalized(exam.title).includes(needle))
}

export function filterQuestionBankCollection(
  banks: readonly QuestionBankCollectionItem[],
  query: string,
): QuestionBankCollectionItem[] {
  const needle = normalized(query)
  if (!needle) return [...banks]
  return banks.filter(
    (bank) =>
      normalized(bank.name).includes(needle) ||
      bank.topics.some((topic) => normalized(topic).includes(needle)),
  )
}

export function homePreview<T>(resources: readonly T[]): T[] {
  return resources.slice(0, HOME_PREVIEW_LIMIT)
}
