import { describe, expect, test } from 'bun:test'
import { instructionsFilename } from './instructions-file'

describe('the instructions file', () => {
  test('is named after the test it converts', () => {
    expect(instructionsFilename('Unit 3 Test.pdf')).toBe('Unit 3 Test (instructions).txt')
    expect(instructionsFilename('unit-test.docx')).toBe('unit-test (instructions).txt')
    expect(instructionsFilename('quiz photo.JPG')).toBe('quiz photo (instructions).txt')
  })

  test('has a plain name when there is no test to name it after', () => {
    expect(instructionsFilename()).toBe('Test Parrot instructions.txt')
    expect(instructionsFilename('.pdf')).toBe('Test Parrot instructions.txt')
  })
})
