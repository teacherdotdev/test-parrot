// The out-of-band comparison's environment.
//
// The heavyweight diagnostic renders DOCX through LibreOffice and inspects both
// PDFs with Poppler. Neither is a dependency of the application or of `bun
// test`; both must be present, pinned and reported before a comparison result
// means anything. This module is the one place that knows what is required and
// how to say so when it is missing.

import { spawnSync } from 'node:child_process'

export type Tool = {
  name: string
  command: string
  /** How to ask the tool what it is. */
  versionArgs: string[]
  /** What the reader should do when it is not there. */
  install: string
  /** What it is for, so a missing tool explains itself. */
  role: string
}

export const TOOLS: readonly Tool[] = [
  {
    name: 'Playwright Chromium',
    command: 'bunx',
    versionArgs: ['playwright', '--version'],
    install: 'bunx playwright install chromium',
    role: 'captures the Reference PDF from the print Export Adapter',
  },
  {
    name: 'LibreOffice',
    command: 'soffice',
    versionArgs: ['--version'],
    install: 'apt-get install -y libreoffice-writer  (or: brew install --cask libreoffice)',
    role: 'the Comparison Engine: renders the generated DOCX to PDF',
  },
  {
    name: 'Poppler pdftotext',
    command: 'pdftotext',
    versionArgs: ['-v'],
    install: 'apt-get install -y poppler-utils  (or: brew install poppler)',
    role: 'extracts the ordered content of each PDF page',
  },
  {
    name: 'Poppler pdfinfo',
    command: 'pdfinfo',
    versionArgs: ['-v'],
    install: 'apt-get install -y poppler-utils  (or: brew install poppler)',
    role: 'reads each PDF page’s count and dimensions',
  },
]

export type ToolStatus = Tool & { version: string | null }

function firstLine(value: string): string {
  return value.split('\n').map((line) => line.trim()).find(Boolean) ?? ''
}

export function inspect(tool: Tool): ToolStatus {
  const result = spawnSync(tool.command, tool.versionArgs, {
    encoding: 'utf8',
    // Poppler writes its version to stderr; LibreOffice to stdout.
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  })
  if (result.error) return { ...tool, version: null }
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const version = firstLine(output)
  return { ...tool, version: version || null }
}

export type Prerequisites = {
  ok: boolean
  tools: ToolStatus[]
  /** What to print when something is missing. Actionable, never a shrug. */
  report: string
}

export function checkPrerequisites(): Prerequisites {
  const tools = TOOLS.map(inspect)
  const missing = tools.filter((tool) => tool.version === null)
  if (missing.length === 0) {
    return {
      ok: true,
      tools,
      report: tools
        .map((tool) => `  ${tool.name}: ${tool.version}`)
        .join('\n'),
    }
  }
  return {
    ok: false,
    tools,
    report: [
      'The export comparison needs tools this machine does not have.',
      '',
      ...missing.flatMap((tool) => [
        `  ${tool.name} (${tool.command}) — ${tool.role}`,
        `    install: ${tool.install}`,
      ]),
      '',
      'This diagnostic is deliberately outside `bun test` and outside CI.',
      'Nothing was skipped silently: install the tools above and run it again.',
    ].join('\n'),
  }
}

/** The environment a comparison ran in, recorded beside its artifacts so drift
 *  is visible when a result has to be explained later. */
export function environmentReport(tools: readonly ToolStatus[]): string {
  return [
    `date: ${new Date().toISOString()}`,
    `platform: ${process.platform} ${process.arch}`,
    `node: ${process.version}`,
    'locale: LANG=C LC_ALL=C TZ=UTC (pinned for the comparison)',
    'paper: US Letter, 8.5in x 11in, zero PDF margin (the sheet is the plan’s own)',
    ...tools.map((tool) => `${tool.name}: ${tool.version ?? 'MISSING'}`),
  ].join('\n')
}
