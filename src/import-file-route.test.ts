import { describe, expect, test } from 'bun:test'
import { aiFixRequest, routeImportFile } from './import-file-route'

describe('routeImportFile', () => {
  test('an AI-made file that cannot be read is an error the AI can fix', async () => {
    const file = new File(['{"format":"not-a-parrot-file"}'], 'test.parrot.json', { type: 'application/json' })
    const route = await routeImportFile(file)
    expect(route.to).toBe('error')
    expect(route).toMatchObject({ aiMade: true })
  })

  test('a file of no importable kind is not one to hand back to an AI', async () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const route = await routeImportFile(file)
    expect(route.to).toBe('error')
    expect(route).not.toMatchObject({ aiMade: true })
  })

  test('a question file from another tool is imported as it is, with no AI', async () => {
    const file = new File(
      ['MC\nWhich planet is closest to the Sun?\nVenus\n*Mercury\n'],
      'chapter 1.txt',
      { type: 'text/plain' },
    )
    expect(await routeImportFile(file)).toEqual({ to: 'import' })
  })
})

describe('aiFixRequest', () => {
  test('carries the error verbatim and asks for the file back', () => {
    const request = aiFixRequest('Question 3 has no stem.')
    expect(request).toContain('Question 3 has no stem.')
    expect(request).toContain('fix the file')
  })
})
