import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DocView } from './doc-view'

describe('DocView whitespace', () => {
  test('renders authored spaces and consecutive empty lines as printable content', () => {
    const markup = renderToStaticMarkup(
      createElement(DocView, {
        className: 'question-stem',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Show  your  work' }],
          },
          { type: 'paragraph' },
          { type: 'paragraph' },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Answer' }],
          },
        ],
      }),
    )

    expect(markup).toBe(
      '<div class="doc-content question-stem"><p><span>Show  your  work</span></p><p><br/></p><p><br/></p><p><span>Answer</span></p></div>',
    )
  })
})

describe('DocView pictures', () => {
  const figure = (attrs: Record<string, unknown>) =>
    renderToStaticMarkup(
      createElement(DocView, {
        className: 'question-stem',
        content: [{ type: 'image-block', attrs: { src: '/local-images/a', ...attrs } }],
      }),
    )

  test('a picture left at the size it fit at carries no sizing of its own', () => {
    expect(figure({})).toContain(
      '<figure class="doc-figure"><img src="/local-images/a" alt=""/></figure>',
    )
    expect(figure({ ratio: 1 })).toBe(figure({}))
    // A ratio Crepe would refuse to load reads as untouched, not as nothing.
    expect(figure({ ratio: 0 })).toBe(figure({}))
    expect(figure({ ratio: 'wide' })).toBe(figure({}))
  })

  test('a picture dragged smaller is scaled in markup alone, so pagination measures it that size', () => {
    // `zoom` scales the picture's own size; the percentage cap is unzoomed, so
    // it is the column scaled by the same ratio — half of what it fit at.
    expect(figure({ ratio: 0.5 })).toContain(
      '<img src="/local-images/a" alt="" style="zoom:0.5;max-width:calc(100% * 0.5)"/>',
    )
  })

  test('a picture dragged larger grows, but never past the column', () => {
    expect(figure({ ratio: 1.5 })).toContain(
      'style="zoom:1.5;max-width:calc(100% * 1)"',
    )
  })

  test('a sized picture is its share of the column, whatever its old ratio', () => {
    expect(figure({ size: 0.4, ratio: 0.5 })).toContain(
      '<img src="/local-images/a" alt="" style="width:40%"/>',
    )
  })

  test('a Picture Crop shows only what it keeps, shaped before the picture loads', () => {
    // The right half of a 1200 × 800 picture, its middle 50% high: 600 × 400.
    const markup = figure({ size: 0.5, crop: { left: 0.5, top: 0.25, right: 1, bottom: 0.75, width: 1200, height: 800 } })
    expect(markup).toContain('<span class="doc-crop" style="width:50%;aspect-ratio:1.5">')
    expect(markup).toContain('style="width:200%;height:200%;left:-100%;top:-50%"')
  })
})
