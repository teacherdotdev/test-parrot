import type { AuthoringState, SavedState } from "./exam-store";
import type { ExamWorkingCopy } from "./question-bank";

function withoutQuestionReferences(
  draft: ExamWorkingCopy,
  questionIds: ReadonlySet<string>,
): ExamWorkingCopy {
  const remaining = draft.questionIds.filter((id) => !questionIds.has(id));
  const columns = Object.fromEntries(
    Object.entries(draft.columns ?? {}).filter(([id]) => !questionIds.has(id)),
  );
  const workSpace = Object.fromEntries(
    Object.entries(draft.workSpace ?? {}).filter(([id]) => !questionIds.has(id)),
  );
  const choiceOrder = Object.fromEntries(
    Object.entries(draft.choiceOrder ?? {}).filter(
      ([id]) => !questionIds.has(id),
    ),
  );
  const hiddenAnswers = Object.fromEntries(
    Object.entries(draft.hiddenAnswers ?? {}).filter(
      ([id]) => !questionIds.has(id),
    ),
  );
  // A deleted Question leaves its Section; the Section itself stays, as an
  // emptied Section always does.
  const sectionOf = Object.fromEntries(
    Object.entries(draft.sectionOf ?? {}).filter(([id]) => !questionIds.has(id)),
  );
  return {
    ...draft,
    questionIds: remaining,
    ...(draft.columns === undefined ? {} : { columns }),
    ...(draft.workSpace === undefined ? {} : { workSpace }),
    ...(draft.choiceOrder === undefined ? {} : { choiceOrder }),
    ...(draft.hiddenAnswers === undefined ? {} : { hiddenAnswers }),
    ...(draft.sectionOf === undefined ? {} : { sectionOf }),
  };
}

function sameExamWorkingCopy(left: ExamWorkingCopy, right: ExamWorkingCopy): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Remove canonical Questions and their presentation state from one Exam.
 * Deletion is forced external reconciliation, not an Exam edit: saved and
 * Working Copy are transformed together and existing unrelated differences
 * are retained. */
export function withoutQuestions(
  working: AuthoringState,
  saved: SavedState | null,
  questionIds: ReadonlySet<string>,
): { working: AuthoringState; saved: SavedState | null } {
  const nextWorkingDraft = withoutQuestionReferences(
    working.workingCopy,
    questionIds,
  );
  const nextSaved = saved
    ? {
        ...saved,
        questionBank: {
          questions: saved.questionBank.questions.filter(
            ({ id }) => !questionIds.has(id),
          ),
        },
        workingCopy: withoutQuestionReferences(saved.workingCopy, questionIds),
      }
    : null;
  const nextWorking: AuthoringState = {
    ...working,
    questionBank: {
      questions: working.questionBank.questions.filter(
        ({ id }) => !questionIds.has(id),
      ),
    },
    workingCopy: nextWorkingDraft,
    dirty: nextSaved
      ? !sameExamWorkingCopy(nextWorkingDraft, nextSaved.workingCopy)
      : working.dirty,
  };
  return { working: nextWorking, saved: nextSaved };
}
