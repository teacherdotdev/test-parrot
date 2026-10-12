import JSZip from 'jszip'

/**
 * A minimal Excel workbook, for tests: the parts a real .xlsx carries and a
 * reader needs — content types, the workbook and its relationships, shared
 * strings and one or more worksheets. Cells are written the ways Excel
 * writes them: a string as a shared string (or inline, or as rich-text
 * runs), a number or boolean as its value, a formula with its cached value.
 */

export type TestCell =
  | string
  | number
  | boolean
  | null
  | { inline: string }
  | { runs: string[] }
  | { formula: string; value: string | number }

/** Rows of cells; a row may be placed at a row number, leaving rows out. */
export type TestSheet = { name?: string; rows: (TestCell[] | { row: number; cells: TestCell[] })[] }

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const columnName = (index: number) => {
  let name = ''
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name
  }
  return name
}

export async function xlsx(sheets: TestSheet[] | TestSheet): Promise<Uint8Array> {
  const list = Array.isArray(sheets) ? sheets : [sheets]
  const shared: string[] = []
  const sharedXml: string[] = []
  const sharedIndex = (xml: string, key: string) => {
    let index = shared.indexOf(key)
    if (index < 0) {
      index = shared.length
      shared.push(key)
      sharedXml.push(xml)
    }
    return index
  }
  const cellXml = (cell: TestCell, reference: string): string => {
    if (cell === null) return ''
    if (typeof cell === 'string') {
      return `<c r="${reference}" t="s"><v>${sharedIndex(`<si><t xml:space="preserve">${escape(cell)}</t></si>`, `t:${cell}`)}</v></c>`
    }
    if (typeof cell === 'number') return `<c r="${reference}"><v>${cell}</v></c>`
    if (typeof cell === 'boolean') return `<c r="${reference}" t="b"><v>${cell ? 1 : 0}</v></c>`
    if ('inline' in cell) return `<c r="${reference}" t="inlineStr"><is><t>${escape(cell.inline)}</t></is></c>`
    if ('runs' in cell) {
      const runs = cell.runs.map((run, index) => `<r>${index ? '<rPr><b/></rPr>' : ''}<t xml:space="preserve">${escape(run)}</t></r>`).join('')
      return `<c r="${reference}" t="s"><v>${sharedIndex(`<si>${runs}<rPh sb="0" eb="1"><t>phonetic</t></rPh></si>`, `r:${cell.runs.join('|')}`)}</v></c>`
    }
    const type = typeof cell.value === 'string' ? ' t="str"' : ''
    return `<c r="${reference}"${type}><f>${escape(cell.formula)}</f><v>${escape(String(cell.value))}</v></c>`
  }

  const zip = new JSZip()
  list.forEach((sheet, sheetIndex) => {
    let next = 1
    const rows = sheet.rows.map((entry) => {
      const { row, cells } = Array.isArray(entry) ? { row: next, cells: entry } : entry
      next = row + 1
      return `<row r="${row}">${cells.map((cell, column) => cellXml(cell, `${columnName(column)}${row}`)).join('')}</row>`
    })
    zip.file(
      `xl/worksheets/sheet${list.length - sheetIndex}.xml`,
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        `<sheetData>${rows.join('')}</sheetData></worksheet>`,
    )
  })
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      list.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      '</Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
  )
  // The workbook's first sheet is stored last, so a reader that trusts
  // `sheet1.xml` rather than the workbook's order reads the wrong one.
  zip.file(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<sheets>${list.map((sheet, index) => `<sheet name="${escape(sheet.name ?? `Sheet${index + 1}`)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets>` +
      '</workbook>',
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      list.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet${list.length - index}.xml"/>`).join('') +
      '</Relationships>',
  )
  zip.file(
    'xl/sharedStrings.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${sharedXml.join('')}</sst>`,
  )
  return zip.generateAsync({ type: 'uint8array' })
}
