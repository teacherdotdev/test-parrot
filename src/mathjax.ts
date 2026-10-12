// MathJax, for the formulas that leave the browser's own KaTeX rendering: a
// copied Question's picture or Word equation, and the PDF Export Adapter's
// glyph outlines. It is loaded the first time a formula needs it, once.

import type { LiteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import type { LiteElement } from 'mathjax-full/js/adaptors/lite/Element.js'

export type MathJaxTools = {
  adaptor: LiteAdaptor
  /** The formula as MathJax's `<svg>`, every glyph an outline of its own.
   *  Throws on some input MathJax cannot parse. */
  svg: (source: string, display: boolean) => LiteElement
  mathml: (source: string, display: boolean) => string
}

let mathJax: Promise<MathJaxTools> | null = null

/** MathJax's TeX to SVG and to MathML, loaded the first time it is needed. */
export function mathJaxTools(): Promise<MathJaxTools> {
  mathJax ??= (async () => {
    const [
      { mathjax }, { TeX }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler },
      { AllPackages }, { SerializedMmlVisitor }, { STATE },
    ] = await Promise.all([
      import('mathjax-full/js/mathjax.js'),
      import('mathjax-full/js/input/tex.js'),
      import('mathjax-full/js/output/svg.js'),
      import('mathjax-full/js/adaptors/liteAdaptor.js'),
      import('mathjax-full/js/handlers/html.js'),
      import('mathjax-full/js/input/tex/AllPackages.js'),
      import('mathjax-full/js/core/MmlTree/SerializedMmlVisitor.js'),
      import('mathjax-full/js/core/MathItem.js'),
    ])
    const adaptor = liteAdaptor()
    RegisterHTMLHandler(adaptor)
    const document = mathjax.document('', {
      InputJax: new TeX({ packages: AllPackages }),
      OutputJax: new SVG({ fontCache: 'none' }),
    })
    const visitor = new SerializedMmlVisitor()
    return {
      adaptor,
      // `convert` wraps the `<svg>` in a container of its own.
      svg: (source, display) =>
        adaptor.firstChild(document.convert(source, { display })) as LiteElement,
      mathml: (source, display) => {
        const serialized = visitor.visitTree(document.convert(source, { display, end: STATE.CONVERT }))
        // One line: some editors read the whitespace between elements as text.
        return serialized.replace(/>\s+</g, '><')
      },
    }
  })()
  return mathJax
}
