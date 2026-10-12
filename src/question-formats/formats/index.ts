import type { FormatSpec } from '../types'
import { aiken } from './aiken'
import { bbGenerator } from './bb-generator'
import { bbPackage } from './bb-package'
import { bbTsv } from './bb-tsv'
import { d2lCsv } from './d2l-csv'
import { flashcards } from './flashcards'
import { gift } from './gift'
import { kahoot } from './kahoot'
import { moodleXml } from './moodle-xml'
import { qti } from './qti'
import { respondus } from './respondus'
import { respondusCsv } from './respondus-csv'
import { spreadsheet } from './spreadsheet'
import { text2qti } from './text2qti'

/**
 * Every format Test Parrot reads, in the order that breaks a tie between
 * them: a package before plain text, a specific format before a general one,
 * and among the plain-text formats that share `1.` / `a)` / `*b)` the
 * Blackboard Test Generator's first, since the others add markers of their
 * own that score them higher when present.
 */
export const FORMATS: readonly FormatSpec[] = [
  bbPackage,
  qti,
  moodleXml,
  bbTsv,
  d2lCsv,
  respondusCsv,
  kahoot,
  bbGenerator,
  respondus,
  aiken,
  text2qti,
  gift,
  spreadsheet,
  flashcards,
]
