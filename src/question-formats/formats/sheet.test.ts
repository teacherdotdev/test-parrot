import { describe, expect, test } from 'bun:test'
import JSZip from 'jszip'
import { decodeText } from '../text'
import type { FormatInput } from '../types'
import { readZip } from '../zip'
import { readSheet } from './sheet'
import { xlsx } from './test-xlsx'

const encode = (text: string) => new TextEncoder().encode(text)

async function sheetOf(name: string, bytes: Uint8Array) {
  const zip = await readZip(bytes)
  const input: FormatInput = {
    name,
    bytes,
    text: () => (zip ? '' : decodeText(bytes).text),
    zip: async () => zip,
  }
  return readSheet(input)
}

describe('reading a spreadsheet', () => {
  test('a CSV keeps quoted commas and line breaks, and each row the line it starts on', async () => {
    const sheet = await sheetOf('q.csv', encode('Question,Answer\n"Name a colour, any colour","red\nor blue"\n\nLast,one\n'))
    expect(sheet!.source).toBe(',')
    expect(sheet!.rows).toEqual([
      { fields: ['Question', 'Answer'], line: 1 },
      { fields: ['Name a colour, any colour', 'red\nor blue'], line: 2 },
      { fields: [''], line: 4 },
      { fields: ['Last', 'one'], line: 5 },
    ])
  })

  test('a semicolon CSV with decimal commas splits on the semicolon', async () => {
    const sheet = await sheetOf('q.csv', encode('Question;Answer;Points\nWhat is half of 5?;2,5;1\nWhat is 1,5 + 1?;2,5;1,5\n'))
    expect(sheet!.source).toBe(';')
    expect(sheet!.rows[1]!.fields).toEqual(['What is half of 5?', '2,5', '1'])
  })

  test('a tab-delimited file splits on tabs, commas and all', async () => {
    const sheet = await sheetOf('q.txt', encode('Term\tDefinition\nLead, a metal\tPb\n'))
    expect(sheet!.source).toBe('\t')
    expect(sheet!.rows[1]!.fields).toEqual(['Lead, a metal', 'Pb'])
  })

  test('an .xlsx reads its first worksheet, cell by cell, with the values Excel last calculated', async () => {
    const bytes = await xlsx([
      {
        name: 'Questions',
        rows: [
          ['Question', 'Answer', 'Points', 'Checked'],
          { row: 3, cells: [{ runs: ['Which is ', 'largest'] }, { inline: 'Jupiter' }, 0.1, true] },
          { row: 4, cells: [null, null, { formula: 'B3&"!"', value: 'Jupiter!' }, { formula: '1+1', value: 2 }] },
        ],
      },
      { name: 'Notes', rows: [['Not questions']] },
    ])
    const sheet = await sheetOf('q.xlsx', bytes)
    expect(sheet!.source).toBe('xlsx')
    expect(sheet!.rows).toEqual([
      { fields: ['Question', 'Answer', 'Points', 'Checked'], line: 1 },
      // Rich-text runs are joined, their phonetic guides left out; 0.1 is
      // read as typed, not as Excel stores it.
      { fields: ['Which is largest', 'Jupiter', '0.1', 'TRUE'], line: 3 },
      // Skipped cells are empty; a formula is its cached value, never run.
      { fields: ['', '', 'Jupiter!', '2'], line: 4 },
    ])
  })

  test('a ZIP that is not a workbook is not a spreadsheet', async () => {
    const zip = new JSZip()
    zip.file('notes.txt', 'hello')
    expect(await sheetOf('notes.zip', await zip.generateAsync({ type: 'uint8array' }))).toBeNull()
  })
})
