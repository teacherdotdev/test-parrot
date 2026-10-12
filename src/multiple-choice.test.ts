import { describe, expect, test } from 'bun:test'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { history, undo } from '@milkdown/kit/prose/history'
import {
  TRUE_FALSE_LABELS,
  answerMoveTarget,
  choiceNodeIsLocked,
  moveChoice,
  moveChoiceWithCursor,
  newAnswerIndex,
  newChoicePosition,
  newTrueFalseNode,
  selectCorrectChoice,
  setChoiceLock,
} from './multiple-choice'
import { cleanDocument, type ProseMirrorJSON } from './question-doc'

const schema = new Schema({
  nodes: {
    doc: { content: 'multipleChoice' },
    text: { group: 'inline' },
    paragraph: { group: 'block', content: 'inline*' },
    multipleChoiceChoice: {
      content: 'paragraph block*',
      attrs: { correct: { default: false } },
    },
    multipleChoice: { content: 'multipleChoiceChoice+' },
  },
})

function build(correctIndex: number | null) {
  const choice = schema.nodes.multipleChoiceChoice!
  const paragraph = schema.nodes.paragraph!
  const list = schema.nodes.multipleChoice!
  const doc = schema.nodes.doc!.create(
    null,
    list.create(
      null,
      [0, 1, 2].map((index) =>
        choice.create({ correct: index === correctIndex }, paragraph.create()),
      ),
    ),
  )
  let state = EditorState.create({ schema, doc })
  const view = {
    get state() {
      return state
    },
    dispatch(transaction: Parameters<typeof state.apply>[0]) {
      state = state.apply(transaction)
    },
  }
  return { get state() { return state }, view }
}

// The position directly before choice `index` in the single list.
function choicePos(state: EditorState, index: number) {
  const list = state.doc.firstChild!
  let pos = 1
  for (let i = 0; i < index; i += 1) pos += list.child(i).nodeSize
  return pos
}

describe('multiple-choice', () => {
  test('selecting a choice marks it correct and clears the others', () => {
    const editor = build(null)
    expect(selectCorrectChoice(editor.view, choicePos(editor.state, 1))).toBe(true)
    const list = editor.state.doc.firstChild!
    expect([0, 1, 2].map((i) => list.child(i).attrs.correct)).toEqual([false, true, false])
  })

  test('selecting a different choice moves the correct flag', () => {
    const editor = build(1)
    selectCorrectChoice(editor.view, choicePos(editor.state, 2))
    const list = editor.state.doc.firstChild!
    expect([0, 1, 2].map((i) => list.child(i).attrs.correct)).toEqual([false, false, true])
  })
})

describe('the True/False pair', () => {
  test('is exactly two answers, written out, with neither marked correct', () => {
    const node = newTrueFalseNode()

    expect(TRUE_FALSE_LABELS).toEqual(['True', 'False'])
    expect(node.content).toHaveLength(2)
    expect(
      node.content.map((answer) => answer.content[0]!.content?.[0]?.text),
    ).toEqual(['True', 'False'])
    expect(node.content.every((answer) => answer.attrs.correct === false)).toBe(
      true,
    )
  })

  test('gives each answer its own stable id, as a multiple-choice answer has', () => {
    const ids = [...newTrueFalseNode().content, ...newTrueFalseNode().content]
      .map((answer) => answer.attrs.id)

    expect(new Set(ids).size).toBe(4)
    expect(ids.every((id) => id.length > 0)).toBe(true)
  })
})

describe('locking an answer in the question editor', () => {
  const lockSchema = new Schema({
    nodes: {
      doc: { content: 'multipleChoice' },
      text: { group: 'inline' },
      paragraph: { group: 'block', content: 'inline*' },
      multipleChoiceChoice: {
        content: 'paragraph block*',
        attrs: { correct: { default: false }, id: { default: '' }, locked: { default: null } },
      },
      multipleChoice: { content: 'multipleChoiceChoice+' },
    },
  })

  function editorWith(texts: string[]) {
    const paragraph = lockSchema.nodes.paragraph!
    const doc = lockSchema.nodes.doc!.create(
      null,
      lockSchema.nodes.multipleChoice!.create(
        null,
        texts.map((text, index) =>
          lockSchema.nodes.multipleChoiceChoice!.create(
            { id: `c${index}` },
            paragraph.create(null, text ? lockSchema.text(text) : null),
          ),
        ),
      ),
    )
    let state = EditorState.create({ schema: lockSchema, doc })
    const view = {
      get state() { return state },
      dispatch(transaction: Parameters<typeof state.apply>[0]) { state = state.apply(transaction) },
    }
    const choice = (index: number) => state.doc.firstChild!.child(index)
    const pos = (index: number) => choicePos(state, index)
    // Retype one answer's words, as a teacher editing it in place would.
    const retype = (index: number, text: string) => {
      const from = pos(index) + 2
      view.dispatch(state.tr.insertText(text, from, from + choice(index).textContent.length))
    }
    return { view, choice, pos, retype, get doc() { return state.doc } }
  }

  test('an answer is locked as soon as it reads "All of the above", with nothing stored', () => {
    const editor = editorWith(['Mercury', ''])
    expect(choiceNodeIsLocked(editor.choice(1))).toBe(false)
    editor.retype(1, 'All of the above')
    expect(choiceNodeIsLocked(editor.choice(1))).toBe(true)
    expect(editor.choice(1).attrs.locked).toBeNull()
    // Reworded into an ordinary answer, it moves again.
    editor.retype(1, 'Venus')
    expect(choiceNodeIsLocked(editor.choice(1))).toBe(false)
  })

  test('an answer the teacher unlocked stays unlocked however it is reworded', () => {
    const editor = editorWith(['Mercury', 'All of the above'])
    setChoiceLock(editor.view, editor.pos(1), false)
    expect(choiceNodeIsLocked(editor.choice(1))).toBe(false)
    editor.retype(1, 'None of the above')
    expect(choiceNodeIsLocked(editor.choice(1))).toBe(false)
    editor.retype(1, 'Both A and B')
    expect(editor.choice(1).attrs.locked).toBe(false)
    expect(choiceNodeIsLocked(editor.choice(1))).toBe(false)
  })

  test('an ordinary answer the teacher locked stays locked', () => {
    const editor = editorWith(['Mercury', 'Venus'])
    setChoiceLock(editor.view, editor.pos(0), true)
    editor.retype(0, 'Mars')
    expect(choiceNodeIsLocked(editor.choice(0))).toBe(true)
    expect(choiceNodeIsLocked(editor.choice(1))).toBe(false)
  })

  test("the teacher's decision survives storage, and an undecided answer stores none", () => {
    const editor = editorWith(['Mercury', 'All of the above', 'None of these'])
    setChoiceLock(editor.view, editor.pos(0), true)
    setChoiceLock(editor.view, editor.pos(2), false)
    const stored = cleanDocument({ type: 'doc', content: [editor.doc.toJSON().content[0]] })
    const attrs = ((stored.content as ProseMirrorJSON[])[0]!.content as ProseMirrorJSON[])
      .map((choice) => choice.attrs)
    expect(attrs).toEqual([
      { correct: false, id: 'c0', locked: true },
      { correct: false, id: 'c1' },
      { correct: false, id: 'c2', locked: false },
    ])
  })
})

describe('reordering answers in the question editor', () => {
  const orderSchema = new Schema({
    nodes: {
      doc: { content: 'multipleChoice' },
      text: { group: 'inline' },
      paragraph: { group: 'block', content: 'inline*' },
      multipleChoiceChoice: {
        content: 'paragraph block*',
        attrs: { correct: { default: false }, id: { default: '' }, locked: { default: null } },
      },
      multipleChoice: { content: 'multipleChoiceChoice+' },
    },
  })

  type Answer = { text: string; correct?: boolean; locked?: boolean }

  function editorWith(answers: Answer[]) {
    const paragraph = orderSchema.nodes.paragraph!
    const doc = orderSchema.nodes.doc!.create(
      null,
      orderSchema.nodes.multipleChoice!.create(
        null,
        answers.map(({ text, correct = false, locked = null }, index) =>
          orderSchema.nodes.multipleChoiceChoice!.create(
            { id: `c${index}`, correct, locked },
            paragraph.create(null, text ? orderSchema.text(text) : null),
          ),
        ),
      ),
    )
    let state = EditorState.create({ schema: orderSchema, doc, plugins: [history()] })
    const view = {
      get state() { return state },
      dispatch(transaction: Parameters<typeof state.apply>[0]) { state = state.apply(transaction) },
    }
    const list = () => state.doc.firstChild!
    const texts = () => {
      const result: string[] = []
      list().forEach((choice) => result.push(choice.textContent))
      return result
    }
    const ids = () => {
      const result: string[] = []
      list().forEach((choice) => result.push(choice.attrs.id as string))
      return result
    }
    const pos = (index: number) => choicePos(state, index)
    const caretIn = (index: number, offset: number) =>
      view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos(index) + 2 + offset)))
    return { view, list, texts, ids, pos, caretIn, get state() { return state } }
  }

  test('an answer moves one place up or down, and no further than either end', () => {
    expect(answerMoveTarget(4, 2, -1)).toBe(1)
    expect(answerMoveTarget(4, 2, 1)).toBe(3)
    expect(answerMoveTarget(4, 0, -1)).toBeNull()
    expect(answerMoveTarget(4, 3, 1)).toBeNull()
    expect(answerMoveTarget(1, 0, 1)).toBeNull()
  })

  test('moving an answer keeps its id, correctness and lock', () => {
    const editor = editorWith([
      { text: 'Mercury' },
      { text: 'Venus', correct: true, locked: true },
      { text: 'Earth' },
    ])
    expect(moveChoice(editor.view, editor.pos(1), 1)).toBe(true)
    expect(editor.texts()).toEqual(['Mercury', 'Earth', 'Venus'])
    expect(editor.ids()).toEqual(['c0', 'c2', 'c1'])
    const moved = editor.list().child(2)
    expect(moved.attrs).toEqual({ id: 'c1', correct: true, locked: true })
    expect(moveChoice(editor.view, editor.pos(2), -1)).toBe(true)
    expect(moveChoice(editor.view, editor.pos(1), -1)).toBe(true)
    expect(editor.ids()).toEqual(['c1', 'c0', 'c2'])
  })

  test('nothing moves past either end', () => {
    const editor = editorWith([{ text: 'Mercury' }, { text: 'Venus' }])
    const before = editor.state.doc
    expect(moveChoice(editor.view, editor.pos(0), -1)).toBe(false)
    expect(moveChoice(editor.view, editor.pos(1), 1)).toBe(false)
    expect(editor.state.doc).toBe(before)
  })

  test('a Locked Answer moves by hand like any other: the lock governs shuffling, not authoring', () => {
    const editor = editorWith([{ text: 'Mercury' }, { text: 'Venus' }, { text: 'None of the above' }])
    expect(moveChoice(editor.view, editor.pos(2), -1)).toBe(true)
    expect(editor.texts()).toEqual(['Mercury', 'None of the above', 'Venus'])
    expect(choiceNodeIsLocked(editor.list().child(1))).toBe(true)
  })

  test('one undo puts a moved answer back', () => {
    const editor = editorWith([{ text: 'Mercury' }, { text: 'Venus' }, { text: 'Earth' }])
    moveChoice(editor.view, editor.pos(0), 1)
    expect(editor.texts()).toEqual(['Venus', 'Mercury', 'Earth'])
    expect(undo(editor.state, editor.view.dispatch)).toBe(true)
    expect(editor.texts()).toEqual(['Mercury', 'Venus', 'Earth'])
  })

  test('Alt-Arrow moves the answer holding the cursor, and the cursor goes with it', () => {
    const editor = editorWith([{ text: 'Mercury' }, { text: 'Venus' }, { text: 'Earth' }])
    editor.caretIn(2, 3) // Ear|th
    const up = moveChoiceWithCursor(-1)
    expect(up(editor.state, editor.view.dispatch)).toBe(true)
    expect(editor.texts()).toEqual(['Mercury', 'Earth', 'Venus'])
    expect(editor.state.selection.from).toBe(editor.pos(1) + 2 + 3)
    expect(up(editor.state, editor.view.dispatch)).toBe(true)
    expect(editor.texts()).toEqual(['Earth', 'Mercury', 'Venus'])
    expect(editor.state.selection.from).toBe(editor.pos(0) + 2 + 3)
    // At the top already: nothing moves, but the key is still spent.
    const before = editor.state.doc
    expect(up(editor.state, editor.view.dispatch)).toBe(true)
    expect(editor.state.doc).toBe(before)
  })

  test('a cursor in the neighbour an answer trades places with stays in the neighbour', () => {
    const editor = editorWith([{ text: 'Mercury' }, { text: 'Venus' }])
    editor.caretIn(1, 2) // Ve|nus
    moveChoice(editor.view, editor.pos(0), 1)
    expect(editor.texts()).toEqual(['Venus', 'Mercury'])
    expect(editor.state.selection.from).toBe(editor.pos(0) + 2 + 2)
  })

  describe('a new answer', () => {
    test('goes at the end when the last answer is not locked', () => {
      expect(newAnswerIndex([false, false, false])).toBe(3)
      expect(newAnswerIndex([false, true, false])).toBe(3)
      expect(newAnswerIndex([])).toBe(0)
    })

    test('goes before the trailing run of Locked Answers', () => {
      expect(newAnswerIndex([false, false, true])).toBe(2)
      expect(newAnswerIndex([false, false, true, true])).toBe(2)
      // A locked answer with an unlocked one after it is not trailing.
      expect(newAnswerIndex([false, true, false, true])).toBe(3)
    })

    test('goes at the end when every answer is locked', () => {
      expect(newAnswerIndex([true, true, true])).toBe(3)
    })

    test('in the editor lands above “None of the above”, locked by its wording or by the teacher', () => {
      const editor = editorWith([
        { text: 'Mercury' },
        { text: 'Venus' },
        { text: 'All of the above' },
        { text: 'Pluto', locked: true },
      ])
      expect(newChoicePosition(editor.list(), 0)).toBe(editor.pos(2))
      const unlocked = editorWith([{ text: 'Mercury' }, { text: 'None of the above', locked: false }])
      expect(newChoicePosition(unlocked.list(), 0)).toBe(unlocked.state.doc.content.size - 1)
    })
  })
})
