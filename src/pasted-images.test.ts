import { describe, expect, test } from 'bun:test'
import { safePastedImageSource } from './pasted-images'

describe('safePastedImageSource', () => {
  test('keeps local and ordinary image URLs', () => {
    expect(safePastedImageSource('/local-images/abc')).toBe('/local-images/abc')
    expect(safePastedImageSource('https://example.com/image.png')).toBe(
      'https://example.com/image.png',
    )
    expect(safePastedImageSource('diagram.png')).toBe('diagram.png')
  })

  test('keeps image data URLs and rejects other data URLs', () => {
    expect(safePastedImageSource('data:image/png;base64,abc')).toBe(
      'data:image/png;base64,abc',
    )
    expect(safePastedImageSource('data:text/html,<script></script>')).toBeUndefined()
  })

  test('rejects scriptable and non-image schemes', () => {
    expect(safePastedImageSource('javascript:alert(1)')).toBeUndefined()
    expect(safePastedImageSource('file:///tmp/image.png')).toBeUndefined()
  })
})
