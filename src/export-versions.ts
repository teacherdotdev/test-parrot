// Shuffled Versions: the arrangements an export prints when it shuffles, and
// the names they print under.
//
// A Version exists only inside its Export Record. Nothing here changes the
// Exam or its Working Copy: every arrangement is derived from the Working
// Copy's own, and it is the plans made from them that the record keeps.

import {
  movableAnswerIds,
  orderedChoices,
  orderedPartChoices,
  answeringPartsOf,
  questionsInSection,
  sectionsOf,
  variesAnswers,
  withAnswersMoved,
  type Arrangement,
  type Choice,
  type Exam,
  type RandomSource,
} from './exam'
import type { LayoutPlan } from './export-plan'
import { hiddenAnswerIdsOf, hideableAnswerIdsOf } from './hidden-answers'

/** What an export may shuffle. Question order moves only within each Question
 *  Section; answer order covers Multiple Choice answers, a Multipart
 *  question's Multiple Choice Parts, and Matching Word Banks. True/False,
 *  Matching Items, Short Answer and a Locked Answer never move. */
export type ShuffleOptions = { questions: boolean; answers: boolean }

export const NO_SHUFFLE: ShuffleOptions = { questions: false, answers: false }

/** The most Versions one export prints, however many arrangements an Exam
 *  allows: each is a whole test and key to lay out and download at once. */
export const MAX_VERSIONS = 50

/** How many Versions the dialog offers before a teacher chooses. */
export const DEFAULT_VERSION_COUNT = 2

/** Why `count` Versions cannot print when the options allow `max`, or null
 *  when they can. The dialog and preparation share it, so they refuse alike. */
export function versionCountError(count: number, max: number): string | null {
  if (max < 1) return 'Nothing on this Exam can be shuffled with these options.'
  if (!Number.isInteger(count) || count < 1 || count > max) {
    return `Choose from 1 to ${max} ${max === 1 ? 'Version' : 'Versions'} for this Exam.`
  }
  return null
}

/** Each Version a set of plans prints, in the order its papers first appear. */
export function versionNamesIn(plans: readonly LayoutPlan[]): string[] {
  return [...new Set(plans.flatMap((plan) => (plan.arrangement.version ? [plan.arrangement.version] : [])))]
}

export function shufflesAnything(shuffle: ShuffleOptions | undefined): boolean {
  return shuffle !== undefined && (shuffle.questions || shuffle.answers)
}

// One list an export may reorder, in the Working Copy's order: a Section's
// questions, or one question's or Part's answers that may move — every one
// but its Locked Answers, which keep their positions (ADR-0038). A Multiple
// Choice question that hides some of its incorrect answers also draws which
// ones each Version hides, as many as the Working Copy hides.
type ShuffleGroup = {
  kind: 'section' | 'answers'
  /** The Section's type, or the question or Part id the answers are keyed by. */
  key: string
  order: string[]
  /** A question's or Part's answers as the Working Copy orders them, locked
   *  ones included, which `order` is the movable part of. */
  answers?: Choice[]
  /** The answers a Version may hide, and how many it hides. */
  hideable?: string[]
  hidden?: number
}

// One group's draw: its order, and for answers that hide, which are hidden.
type GroupDraw = { order: string[]; hidden?: string[] }

function answerGroup(key: string, answers: Choice[], hideable: string[] = [], hidden = 0): ShuffleGroup[] {
  const order = movableAnswerIds(answers)
  // Hidden answers can still be drawn differently when only one answer moves.
  const arrangements = factorial(order.length - hidden) * combinations(hideable.length, hidden)
  if (arrangements < 2) return []
  return [{ kind: 'answers', key, order, answers, ...(hidden > 0 ? { hideable, hidden } : {}) }]
}

/** How many ways to choose `k` of `n`, saturating as `factorial` does. */
function combinations(n: number, k: number): number {
  let result = 1
  for (let index = 1; index <= k; index += 1) {
    result = Math.min((result * (n - k + index)) / index, Number.MAX_SAFE_INTEGER)
  }
  return Math.round(result)
}

/** What a student sees of one group's draw: its order, less what it hides. */
function shownOf(group: ShuffleGroup, draw: GroupDraw): string[] {
  const order = group.answers ? withAnswersMoved(group.answers, draw.order) : draw.order
  if (!draw.hidden) return order
  const hidden = new Set(draw.hidden)
  return order.filter((id) => !hidden.has(id))
}

function shuffleGroups(
  exam: Exam,
  arrangement: Arrangement,
  shuffle: ShuffleOptions,
): ShuffleGroup[] {
  const groups: ShuffleGroup[] = []
  for (const section of sectionsOf(exam)) {
    const questions = questionsInSection(exam, arrangement, section.id)
    if (shuffle.questions && questions.length > 1) {
      groups.push({ kind: 'section', key: section.id, order: questions.map(({ id }) => id) })
    }
    if (!shuffle.answers) continue
    for (const question of questions) {
      if (question.type === 'multipart') {
        for (const part of answeringPartsOf(question)) {
          if (part.type !== 'multiple-choice') continue
          groups.push(...answerGroup(part.id, orderedPartChoices(part, arrangement)))
        }
      } else if (variesAnswers(question.type)) {
        groups.push(...answerGroup(
          question.id,
          orderedChoices(question, arrangement),
          hideableAnswerIdsOf(question),
          hiddenAnswerIdsOf(question, arrangement).length,
        ))
      }
    }
  }
  return groups
}

/** A random source that always draws the same sequence from one seed, so an
 *  Export Preview and the export it previews shuffle alike. */
export function seededRandom(seed: number): RandomSource {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function factorial(n: number): number {
  let result = 1
  for (let k = 2; k <= n; k += 1) result = Math.min(result * k, Number.MAX_SAFE_INTEGER)
  return result
}

/** How many shuffled Versions these options allow on this Exam: every
 *  distinct arrangement but the Working Copy's own, up to `MAX_VERSIONS`. */
export function maxVersionCount(
  exam: Exam,
  arrangement: Arrangement,
  shuffle: ShuffleOptions,
): number {
  let arrangements = 1
  for (const group of shuffleGroups(exam, arrangement, shuffle)) {
    const hidden = group.hidden ?? 0
    const ways = factorial(group.order.length - hidden) * combinations(group.hideable?.length ?? 0, hidden)
    arrangements = Math.min(arrangements * ways, Number.MAX_SAFE_INTEGER)
  }
  return Math.min(arrangements - 1, MAX_VERSIONS)
}

function shuffled(order: readonly string[], random: RandomSource): string[] {
  const result = [...order]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[result[index], result[swap]] = [result[swap]!, result[index]!]
  }
  return result
}

/**
 * `count` arrangements, each different from every other and from the Working
 * Copy's own. Each draws every enabled list independently and uniformly, and a
 * draw that repeats one already taken is drawn again, so any arrangement the
 * options allow may come up. The caller keeps `count` within
 * `maxVersionCount`.
 */
export function shuffledArrangements({
  exam,
  arrangement,
  shuffle,
  count,
  random,
  createId,
}: {
  exam: Exam
  arrangement: Arrangement
  shuffle: ShuffleOptions
  count: number
  random: RandomSource
  createId: () => string
}): Arrangement[] {
  const groups = shuffleGroups(exam, arrangement, shuffle)
  // Versions differ in what a student sees, so a hidden answer's place is no
  // part of what makes one Version another.
  const seen = new Set([
    JSON.stringify(groups.map((group) => shownOf(group, {
      order: group.order,
      ...(group.hidden ? { hidden: hiddenAnswerIdsOf(exam.questions.find(({ id }) => id === group.key)!, arrangement) } : {}),
    }))),
  ])
  const result: Arrangement[] = []
  // Far more draws than a distinct set could ever need, so a broken random
  // source fails loudly rather than spinning.
  for (let attempt = 0; result.length < count; attempt += 1) {
    if (attempt > 1000 + count * 1000) {
      throw new Error('The Versions could not be shuffled. Please try again.')
    }
    const draws: GroupDraw[] = groups.map((group) => ({
      order: shuffled(group.order, random),
      ...(group.hidden ? { hidden: shuffled(group.hideable!, random).slice(0, group.hidden) } : {}),
    }))
    const key = JSON.stringify(groups.map((group, index) => shownOf(group, draws[index]!)))
    if (seen.has(key)) continue
    seen.add(key)

    const sections = new Map<string, string[]>()
    const choiceOrder = { ...arrangement.choiceOrder }
    const hiddenAnswers = { ...(arrangement.hiddenAnswers ?? {}) }
    groups.forEach((group, index) => {
      const draw = draws[index]!
      if (group.kind === 'section') sections.set(group.key, draw.order)
      else choiceOrder[group.key] = withAnswersMoved(group.answers!, draw.order)
      if (draw.hidden) hiddenAnswers[group.key] = draw.hidden
    })
    result.push({
      id: createId(),
      letter: arrangement.letter,
      questionOrder: sectionsOf(exam).flatMap((section) =>
        sections.get(section.id)
          ?? questionsInSection(exam, arrangement, section.id).map(({ id }) => id),
      ),
      choiceOrder,
      ...(Object.keys(hiddenAnswers).length > 0 ? { hiddenAnswers } : {}),
    })
  }
  return result
}

// Classroom-safe words, so any pair reads as a friendly, orderless name.
const ADJECTIVES = [
  'Amber', 'Bold', 'Brave', 'Breezy', 'Bright', 'Brisk', 'Calm', 'Cheery',
  'Clever', 'Cosmic', 'Curly', 'Dapper', 'Daring', 'Dazzling', 'Eager', 'Fancy',
  'Fluffy', 'Friendly', 'Frosty', 'Gentle', 'Giddy', 'Golden', 'Grand', 'Happy',
  'Hasty', 'Humble', 'Jolly', 'Jumpy', 'Keen', 'Kind', 'Lively', 'Lucky',
  'Mellow', 'Merry', 'Mighty', 'Misty', 'Nimble', 'Noble', 'Peppy', 'Plucky',
  'Polite', 'Proud', 'Quick', 'Quiet', 'Rapid', 'Rosy', 'Rusty', 'Shiny',
  'Silly', 'Silver', 'Sleepy', 'Snappy', 'Snowy', 'Sparkly', 'Speedy', 'Spry',
  'Sunny', 'Swift', 'Tidy', 'Tiny', 'Velvet', 'Witty', 'Zany', 'Zesty',
]

const NOUNS = [
  'Badger', 'Beaver', 'Bison', 'Bobcat', 'Camel', 'Cheetah', 'Chipmunk', 'Condor',
  'Cougar', 'Coyote', 'Crane', 'Dolphin', 'Eagle', 'Falcon', 'Ferret', 'Finch',
  'Fox', 'Gazelle', 'Gecko', 'Giraffe', 'Heron', 'Hippo', 'Ibis', 'Jaguar',
  'Koala', 'Lemur', 'Leopard', 'Llama', 'Lynx', 'Magpie', 'Marmot', 'Meerkat',
  'Moose', 'Narwhal', 'Newt', 'Ocelot', 'Octopus', 'Orca', 'Osprey', 'Otter',
  'Owl', 'Panda', 'Parrot', 'Pelican', 'Penguin', 'Puffin', 'Quail', 'Rabbit',
  'Raccoon', 'Raven', 'Robin', 'Salmon', 'Seal', 'Sparrow', 'Squirrel', 'Stork',
  'Swan', 'Tapir', 'Tiger', 'Toucan', 'Turtle', 'Walrus', 'Wombat', 'Zebra',
]

/**
 * `count` Version names, none of them in `taken` nor repeated among
 * themselves. A name is a random adjective and animal; once random picks
 * start colliding, every remaining pair is tried in turn from a random start,
 * so a name is always found while any is left.
 */
export function versionNames(
  count: number,
  taken: ReadonlySet<string>,
  random: RandomSource,
): string[] {
  const used = new Set(taken)
  const total = ADJECTIVES.length * NOUNS.length
  const nameAt = (index: number) =>
    `${ADJECTIVES[Math.floor(index / NOUNS.length)]} ${NOUNS[index % NOUNS.length]}`
  const names: string[] = []
  while (names.length < count) {
    let name: string | undefined
    for (let attempt = 0; attempt < 100 && name === undefined; attempt += 1) {
      const candidate = nameAt(Math.floor(random() * total))
      if (!used.has(candidate)) name = candidate
    }
    if (name === undefined) {
      const start = Math.floor(random() * total)
      for (let step = 0; step < total && name === undefined; step += 1) {
        const candidate = nameAt((start + step) % total)
        if (!used.has(candidate)) name = candidate
      }
    }
    if (name === undefined) {
      throw new Error('This Exam has used every Version name. Save it as a new Exam to keep going.')
    }
    used.add(name)
    names.push(name)
  }
  return names
}
