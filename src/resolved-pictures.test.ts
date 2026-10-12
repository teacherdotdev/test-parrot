import { describe, expect, test } from 'bun:test'
import { carriedResolutions, type ResolvedPicture } from './resolved-pictures'

const picture = (name: string) => ({ asset: { id: name }, origin: 'tag' }) as unknown as ResolvedPicture

describe('pictures carried into a corrected file', () => {
  test('keep a picture whose place still names the same tag, and drop one that changed or went', () => {
    const resolutions = new Map([
      ['bank/q40/stem/0', picture('figure')],
      ['bank/q48/stem/0', picture('diagram')],
      ['bank/q9/stem/0', picture('gone')],
    ])
    const before = [
      { key: 'bank/q40/stem/0', pending: { image: 1 } },
      { key: 'bank/q48/stem/0', pending: { image: 2 } },
      { key: 'bank/q9/stem/0', pending: { page: 3 } },
    ]
    const after = [
      { key: 'bank/q40/stem/0', pending: { image: 1 } },
      { key: 'bank/q48/stem/0', pending: { image: 3 } },
      { key: 'bank/q41/stem/0', pending: { image: 1 } },
    ]
    expect([...carriedResolutions(resolutions, before, after).keys()]).toEqual(['bank/q40/stem/0'])
  })
})
