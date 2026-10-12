import { describe, expect, test } from 'bun:test'
import { kindOfFile } from './source-file'
import { isQuestionFile, isRecordFile } from './question-bank-upload'

describe('which kind of file a teacher dropped', () => {
  test('a package zip is Test Parrot’s own, while another tool’s zip is a question file', () => {
    const packageZip = new File([], 'unit-3.parrot.zip', { type: 'application/zip' })
    const qti = new File([], 'canvas-export.zip', { type: 'application/zip' })
    expect(kindOfFile(packageZip)).toBe('record')
    expect(isRecordFile(packageZip)).toBe(true)
    expect(isQuestionFile(packageZip)).toBe(false)
    expect(kindOfFile(qti)).toBe('questions')
    expect(isRecordFile(qti)).toBe(false)
  })
})
