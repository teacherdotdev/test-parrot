import fs from 'node:fs'
import path from 'node:path'
import type { Connect, Plugin } from 'vite'
import { marked } from 'marked'
import { fillImageTags } from './src/image-tag-list'

/**
 * `/extract` is a plain HTML page, not a route of the app. Its readers are AI
 * assistants that fetch a URL — they never run the SPA's JavaScript, so the
 * instructions have to be in the markup itself. The page is rendered from
 * public/extract.md, which stays published raw at `/extract.md`, so the two
 * cannot drift. The dev server renders it per request; a build emits
 * `extract.html`, which Vercel's `cleanUrls` serves at `/extract`.
 *
 * Both are served with the image tag list filled in: an assistant that
 * fetches a link was given no labeled copy, so every picture it writes names
 * its page. `/extract.md` is overwritten with that filled copy for the same
 * reason — the source keeps the slot, a reader never sees it.
 */
const SOURCE = 'public/extract.md'

export function renderExtractPage(markdown: string): string {
  const body = marked.parse(markdown, { async: false })
  const title = /^# (.+)$/m.exec(markdown)?.[1] ?? 'Extract a Question Bank'
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#f7f4ed" />
    <link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />
    <link rel="icon" type="image/png" href="/icon-256.png" sizes="256x256" />
    <link rel="alternate" type="text/markdown" href="/extract.md" />
    <title>${escapeHtml(title)} · Test Parrot</title>
    <meta name="description" content="Instructions for converting an existing test into a Question Bank file that Test Parrot can import." />
    <style>
      body { margin: 0; background: #f7f4ed; color: #2f2419; font: 15px/1.6 system-ui, -apple-system, 'Segoe UI', sans-serif; }
      header { display: flex; align-items: center; gap: 10px; padding: 14px 24px; border-bottom: 1px solid #e8dfd2; background: #fffaf3; }
      header img { width: 28px; height: 28px; }
      header a { color: #4e3b2f; font-weight: 600; text-decoration: none; }
      header small { margin-left: auto; color: #6e5b4d; }
      header small a { font-weight: 500; text-decoration: underline; text-underline-offset: 4px; }
      header button {
        padding: 6px 12px; border: 1px solid #d8c8b8; border-radius: 8px; background: #f7eee3;
        color: #4e3b2f; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
      }
      header button:hover { background: #ebddcd; }
      main { max-width: 760px; margin: 0 auto; padding: 28px 24px 64px; }
      h1 { margin: 0 0 14px; font-size: 26px; }
      h2 { margin: 32px 0 10px; font-size: 19px; }
      h3 { margin: 22px 0 8px; font-size: 16px; }
      a { color: #9f5037; font-weight: 600; text-underline-offset: 4px; }
      ul, ol { padding-left: 24px; }
      li { margin-bottom: 4px; }
      code { padding: 1px 5px; border-radius: 4px; background: #f2e9dc; font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace; font-size: 13px; }
      pre { padding: 12px 14px; border: 1px solid #e8dfd2; border-radius: 8px; background: #fffaf3; overflow-x: auto; line-height: 1.5; }
      pre code { padding: 0; background: none; }
    </style>
  </head>
  <body>
    <header>
      <img src="/icon-256.png" alt="" />
      <a href="/">Test Parrot</a>
      <small>Also available as <a href="/extract.md">plain Markdown</a></small>
      <button type="button" id="copy">Copy instructions</button>
    </header>
    <main>
${body}
    </main>
    <script>
      // Copies the Markdown, not the rendered page, so it pastes into a chat
      // exactly as an assistant would read it from /extract.md. Closing tags
      // are escaped so the source can never end this script early.
      const source = ${JSON.stringify(markdown).replace(/<\//g, '<\\/')}
      const button = document.getElementById('copy')
      button.addEventListener('click', () => {
        navigator.clipboard.writeText(source).then(() => {
          button.textContent = 'Copied'
          setTimeout(() => { button.textContent = 'Copy instructions' }, 2000)
        })
      })
    </script>
  </body>
</html>
`
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

export function extractPage(): Plugin {
  let source = SOURCE
  const markdown = () => fillImageTags(fs.readFileSync(source, 'utf8'), null)
  const render = () => renderExtractPage(markdown())
  let outDir = 'dist'
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url?.split('?')[0]
    if (url === '/extract.md') {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
      res.end(markdown())
      return
    }
    if (url !== '/extract') return next()
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(render())
  }
  return {
    name: 'extract-page',
    configResolved(config) {
      source = path.resolve(config.root, SOURCE)
      outDir = path.resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      server.middlewares.use(serve)
    },
    configurePreviewServer(server) {
      server.middlewares.use(serve)
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'extract.html', source: render() })
    },
    // Public files are copied as they are, after the bundle; the filled copy
    // replaces the template once they have been.
    closeBundle() {
      const published = path.join(outDir, 'extract.md')
      if (fs.existsSync(published)) fs.writeFileSync(published, markdown())
    },
  }
}
