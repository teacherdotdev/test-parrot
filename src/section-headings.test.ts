import { describe, expect, test } from 'bun:test'
import {
  SECTION_INSTRUCTIONS,
  SECTION_TITLE,
  isHeadingSize,
  isSectionHeadings,
  sameSectionHeadings,
  sectionHeadingOf,
  withSectionHeading,
} from './section-headings'

describe('an Exam’s section headings', () => {
  test('read as the defaults when the Exam has reworded nothing', () => {
    expect(sectionHeadingOf(undefined, 'multiple-choice')).toEqual({
      title: SECTION_TITLE['multiple-choice'],
      instructions: SECTION_INSTRUCTIONS['multiple-choice'],
      edited: false,
    })
  })

  test('read the Exam’s own wording for the part it reworded, and the default for the rest', () => {
    const headings = withSectionHeading(undefined, 'open', { title: 'Essays' })
    expect(sectionHeadingOf(headings, 'open')).toEqual({
      title: 'Essays',
      instructions: SECTION_INSTRUCTIONS.open,
      edited: true,
    })
    expect(sectionHeadingOf(headings, 'matching').edited).toBe(false)
  })

  test('keep a cleared part as an empty string, which prints nothing', () => {
    const headings = withSectionHeading(undefined, 'matching', { instructions: '' })
    expect(headings).toEqual({ matching: { instructions: '' } })
    expect(sectionHeadingOf(headings, 'matching').instructions).toBe('')
  })

  test('store only departures from the default', () => {
    expect(withSectionHeading(undefined, 'open', { title: SECTION_TITLE.open })).toBeUndefined()
    const reworded = withSectionHeading(undefined, 'open', { title: 'Essays', instructions: 'Write.' })
    expect(withSectionHeading(reworded, 'open', { title: null })).toEqual({
      open: { instructions: 'Write.' },
    })
  })

  test('set back to the default drop the section, and then the whole record', () => {
    const one = withSectionHeading(undefined, 'open', { title: 'Essays' })
    const two = withSectionHeading(one, 'matching', { title: 'Vocabulary' })
    const reset = withSectionHeading(two, 'open', { title: null, instructions: null })
    expect(reset).toEqual({ matching: { title: 'Vocabulary' } })
    expect(withSectionHeading(reset, 'matching', { title: null })).toBeUndefined()
  })

  test('leave a part alone when a change does not mention it', () => {
    const headings = withSectionHeading(undefined, 'open', { title: 'Essays', instructions: 'Write.' })
    expect(withSectionHeading(headings, 'open', { title: 'Long answers' })).toEqual({
      open: { title: 'Long answers', instructions: 'Write.' },
    })
  })
})

describe('stored section headings', () => {
  test('are readable only as known sections carrying string parts', () => {
    expect(isSectionHeadings({})).toBe(true)
    expect(isSectionHeadings({ open: { title: 'Essays', instructions: '' } })).toBe(true)
    expect(isSectionHeadings({ essay: { title: 'Essays' } })).toBe(false)
    expect(isSectionHeadings({ open: { title: 3 } })).toBe(false)
    expect(isSectionHeadings({ open: { colour: 'red' } })).toBe(false)
    expect(isSectionHeadings([])).toBe(false)
    expect(isSectionHeadings(null)).toBe(false)
  })

  test('compare alike when absent and empty', () => {
    expect(sameSectionHeadings(undefined, {})).toBe(true)
    expect(sameSectionHeadings({ open: { title: 'A' } }, { open: { title: 'A' } })).toBe(true)
    expect(sameSectionHeadings({ open: { title: 'A' } }, { open: { title: 'B' } })).toBe(false)
    expect(sameSectionHeadings({ open: { title: 'A' } }, undefined)).toBe(false)
  })

  test('a heading size is one of three', () => {
    expect(isHeadingSize('small')).toBe(true)
    expect(isHeadingSize('normal')).toBe(true)
    expect(isHeadingSize('large')).toBe(true)
    expect(isHeadingSize('huge')).toBe(false)
  })
})
