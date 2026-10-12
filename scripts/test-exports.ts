// `bun run test:exports` — the single documented entry point for the
// heavyweight export comparison.
//
// It checks its prerequisites and says exactly what is missing and how to get
// it, rather than skipping quietly; then it runs the diagnostic under its own
// Playwright configuration so nothing else can pick it up by accident.

import { spawnSync } from 'node:child_process'
import { checkPrerequisites, environmentReport } from './export-environment'

const prerequisites = checkPrerequisites()

if (!prerequisites.ok) {
  console.error(prerequisites.report)
  process.exit(1)
}

console.log('Export comparison environment:')
console.log(environmentReport(prerequisites.tools))
console.log('')

const result = spawnSync(
  'bunx',
  ['playwright', 'test', '--config', 'playwright.exports.config.ts', ...process.argv.slice(2)],
  { stdio: 'inherit', env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' } },
)

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 1)
