// Locked Answers: the Multiple Choice answers that keep their letter when
// answers are shuffled (ADR-0038).
//
// An answer such as “All of the above” or “Both A and B” means something only
// in the place it was written, so it is locked by its wording until the
// teacher says otherwise. The decision is read, never stored: an answer the
// teacher has not locked or unlocked follows what it says now, so an imported
// or freshly typed “None of these” is locked the moment it reads that way,
// and one retyped into an ordinary answer moves again. Only the teacher's own
// toggle is kept, as the choice's `locked` attribute, and it outlasts any
// later rewording.

/** What a choice's `locked` attribute holds: the teacher's decision, or `null`
 *  when they have made none and the wording decides. */
export type AnswerLock = boolean | null

/** The letters an answer may name another by: A to H, more than any printed
 *  Multiple Choice question has. Roman numerals are left alone — “I and II
 *  only” names statements in the stem, not answers, and may move. */
const LETTER = '[a-h]'

const REFERENT = '(?:above|below|previous|preceding|foregoing|listed|given|mentioned)'
const NOUN = '(?:answers?|choices?|options?|responses?|statements?|ones?)'
const VERDICT = '(?: (?:is|are) (?:correct|true|right))?'

// “All of the above”, “None of these”, “Both of the above are correct”, “all
// the answers listed”, “none of the choices”, “neither of them”: a quantifier
// and something that points at the other answers. A bare “All” or “None”
// points at nothing and is an ordinary answer.
const ABOUT_THE_OTHERS = new RegExp(
  `^(?:all|none|both|neither|any|either|each)(?: one)?(?: of)?`
    + `(?:(?: the)?(?: ${NOUN})? ${REFERENT}(?: ${NOUN})?`
    + `| (?:these|those|them)(?: ${NOUN})?`
    + `| the ${NOUN})`
    + `${VERDICT}$`,
)

// “Both A and B”, “A and C only”, “A, B and C”, “neither A nor B”, “answers B
// or D”, “only A and B are correct”: two or more answers named by letter.
const BY_LETTER = new RegExp(
  `^(?:${NOUN} )?(?:both |only |neither |either )?${LETTER}(?: ${LETTER})*`
    + ` (?:and|or|nor) ${LETTER}(?: only)?${VERDICT}(?: only)?$`,
)

/** An answer's text reduced to the words that decide whether it is locked:
 *  lower case, punctuation and brackets gone, `&` read as “and”, and every
 *  run of space one space. */
function normalized(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Whether an answer's wording refers to the answers around it, which is
 *  what locks it when the teacher has not decided. */
export function readsAsLocked(text: string): boolean {
  const words = normalized(text)
  return ABOUT_THE_OTHERS.test(words) || BY_LETTER.test(words)
}

/** Whether an answer names others by their letters, as “Both A and B” does —
 *  which no longer means what it says once any answer is hidden. */
export function namesAnswersByLetter(text: string): boolean {
  return BY_LETTER.test(normalized(text))
}

/** Whether an answer keeps its letter: the teacher's decision when there is
 *  one, otherwise what its wording says. */
export function isLocked(lock: AnswerLock | undefined, text: string): boolean {
  return typeof lock === 'boolean' ? lock : readsAsLocked(text)
}
