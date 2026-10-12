// Typed arrows.
//
// `->` and `<-` become `→` and `←` as they are typed, the way `--` becomes an
// em dash in a word processor. A question that says "solid -> liquid" should
// print the arrow the teacher meant, not the two characters they had to type to
// get it.
//
// These are ordinary ProseMirror input rules, so the substitution is part of the
// typing transaction: one undo puts the two characters back, and nothing runs
// over the document afterwards looking for text to rewrite. `inCodeMark: false`
// keeps code spans literal — an arrow in a snippet of code is code.

import { InputRule } from '@milkdown/kit/prose/inputrules'
import { $inputRule } from '@milkdown/kit/utils'

/** The two typed characters, replaced by the arrow they stand for. */
const arrowRule = (match: RegExp, arrow: string) =>
  new InputRule(match, arrow, { inCodeMark: false })

export const rightArrowInputRule = $inputRule(() => arrowRule(/->$/, '→'))
export const leftArrowInputRule = $inputRule(() => arrowRule(/<-$/, '←'))
