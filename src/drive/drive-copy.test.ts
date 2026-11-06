import { describe, expect, test } from 'bun:test'
import { PDFDocument } from 'pdf-lib'
import { remapIds, withOpenBanner, openUrl } from './drive-copy'

describe('Drive Copy', () => {
  test('the banner links page 1 to the file in Test Parrot', async () => {
    const pdf = await PDFDocument.create()
    pdf.addPage([612, 792])
    const stamped = await withOpenBanner(await pdf.save(), openUrl('file-1', undefined, 'https://testparrot.com'))
    const text = new TextDecoder('latin1').decode(stamped)
    expect(text).toContain('https://testparrot.com/open?drive=file-1')
    expect((await PDFDocument.load(stamped)).getPageCount()).toBe(1)
  })

  test('ids are remapped in values and keys alike, and nothing else changes', () => {
    const map = new Map([['fresh-1', 'stable-1']])
    expect(remapIds({ questionIds: ['fresh-1', 'other'], columns: { 'fresh-1': 2 }, title: 'fresh' }, map))
      .toEqual({ questionIds: ['stable-1', 'other'], columns: { 'stable-1': 2 }, title: 'fresh' })
  })
})

describe('reading a Drive Copy', () => {
  test('its package is read back from the PDF, banner and all', async () => {
    const { AFRelationship } = await import('pdf-lib')
    const { attachedPackage } = await import('./drive-copy')
    const pdf = await PDFDocument.create()
    pdf.addPage([612, 792])
    pdf.addPage([612, 792])
    const zip = new Uint8Array([80, 75, 3, 4, 9, 9, 9])
    await pdf.attach(zip, 'parrot.zip', { mimeType: 'application/zip', description: 'pdf-canonical-extraction', afRelationship: AFRelationship.Source })
    const stamped = await withOpenBanner(await pdf.save({ useObjectStreams: false }), openUrl('f', undefined, 'https://testparrot.com'))
    expect(await attachedPackage(stamped, 'pdf-canonical-extraction')).toEqual(zip)
    expect(await attachedPackage(stamped, 'something else')).toBeNull()
  })
})
