// The out-of-band export comparison.
//
// This is the heavyweight diagnostic, not part of `bun test` and not part of
// `bun run test:e2e`. It is invoked by `bun run test:exports`, which checks its
// prerequisites first. See `docs/export-testing.md` for the invocation policy.
//
// What it does, per fixture, at the highest seam the product has:
//
//   1. Seeds the real application with the fixture and lets it settle.
//   2. Captures the dialog's clean print-reference preview as the Reference PDF
//      with the pinned Playwright Chromium.
//   3. Downloads the real PDF and DOCX through that same dialog.
//   4. Renders that DOCX to PDF with the pinned LibreOffice Comparison Engine.
//   5. Compares both artifacts' page count, dimensions and ordered content.
//   6. Compares the DOCX's structural fingerprint against the Layout Plan.
//
// Everything it produced is kept when it fails, in `export-artifacts/`.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import JSZip from 'jszip'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import {
  comparePdfs,
  describePdfDifferences,
  equationWords,
  pdfManifest,
  type PdfManifest,
} from './pdf-manifest'
import { checkPrerequisites, environmentReport } from './export-environment'
import { seedAuthoringState } from './seed-authoring'
import { FIXTURES, PIXEL_PNG, type Fixture } from '../src/export-fixtures'
import { imageSourcesOf } from '../src/export-media'
import { orderedChoices, type Question } from '../src/exam'
import type { ProseMirrorJSON } from '../src/question-doc'
import { buildExportDocument, STUDENT_TEST } from '../src/export-plan'
import {
  plansOf,
  prepareExport,
  arrangementRange,
  EMPTY_EXPORT_HISTORY,
  type ExportConfiguration,
} from '../src/export-preparation'
import {
  compareFingerprints,
  describeDifferences,
  exportDocumentFingerprint,
  layoutFingerprint,
} from '../src/export-fingerprint'
import { printDocumentFingerprint } from '../src/print-fingerprint'
import { docxFingerprint } from '../src/docx-fingerprint'

const ARTIFACTS = join(process.cwd(), 'export-artifacts')

function configurationOf(): ExportConfiguration {
  return {
    format: 'docx',
    selection: { test: true, answerKey: true },
  }
}

// The issue contract requires the dedicated PDF adapter to pass every fixture,
// not only composites. Keep one matrix for PDF so newly added supported
// vocabulary cannot bypass heavyweight page-parity acceptance.
const fixtures = FIXTURES

// DOCX conversion remains the older diagnostic subset: its exhaustive
// structural coverage is dependency-free, while LibreOffice page comparison is
// retained for the costly composite and boundary cases.
const DOCX_COMPARED = new Set([
  'a realistic composite exam',
  'a four-column choice grid with an empty cell',
  'inline and block images',
  'a table with a header row',
  'a question that moves whole to the next page',
])

/** Every equation source the printed document contains, read back out of its
 *  own fingerprint rather than guessed at from the exam. */
function mathSourcesOf(fingerprint: {
  pages: readonly { content: readonly string[] }[]
}): string[] {
  return fingerprint.pages.flatMap((page) =>
    page.content.flatMap((line) =>
      [...line.matchAll(/⟨math:([^⟩]*)⟩/g)].map((match) => match[1] ?? ''),
    ),
  )
}

function slug(name: string): string {
  return name
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

function convertToPdf(docx: string, outputDirectory: string): string {
  const profile = join(outputDirectory, 'libreoffice-profile')
  const result = spawnSync(
    'soffice',
    [
      '--headless',
      '--norestore',
      '--nolockcheck',
      `-env:UserInstallation=file://${profile}`,
      '--convert-to',
      'pdf:writer_pdf_Export',
      '--outdir',
      outputDirectory,
      docx,
    ],
    {
      encoding: 'utf8',
      timeout: 180_000,
      env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
    },
  )
  if (result.status !== 0) {
    throw new Error(
      `LibreOffice conversion failed:\n${result.stdout}\n${result.stderr}`,
    )
  }
  return docx.replace(/\.docx$/, '.pdf')
}

function record(directory: string, name: string, contents: string): void {
  writeFileSync(join(directory, name), contents)
}

/** The historical package must retain actual Media Asset bytes, not merely an
 * image relationship or MIME type. Normalize their part names away while
 * retaining a content hash for every packaged byte sequence. */
async function packagedMediaHashes(bytes: Uint8Array): Promise<string[]> {
  const archive = await JSZip.loadAsync(bytes)
  return await Promise.all(
    Object.entries(archive.files)
      .filter(([name, file]) => name.startsWith('word/media/') && !file.dir)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(async ([, file]) =>
        createHash('sha256').update(await file.async('nodebuffer')).digest('hex'),
      ),
  )
}

function manifestText(manifest: PdfManifest): string {
  return manifest.pages
    .map(
      (page) =>
        `# page ${page.number} — ${page.width}x${page.height} pts\n${page.words.join(' ')}`,
    )
    .join('\n\n')
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  const prerequisites = checkPrerequisites()
  if (!prerequisites.ok) throw new Error(prerequisites.report)
  mkdirSync(ARTIFACTS, { recursive: true })
  record(ARTIFACTS, 'environment.txt', environmentReport(prerequisites.tools))
})

for (const fixture of fixtures) {
  test(`print and DOCX describe the same document: ${fixture.name}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000)
    const directory = join(ARTIFACTS, slug(fixture.name))
    rmSync(directory, { recursive: true, force: true })
    mkdirSync(directory, { recursive: true })

    // The plans the application will prepare for itself, prepared here too so
    // recorded artifacts describe the same canonical test/key publication.
    const configuration = configurationOf()
    const plans = plansOf(
      prepareExport({
        examId: 'diagnostic-exam',
        exam: fixture.exam,
        arrangement: fixture.arrangement,
        configuration,
        history: EMPTY_EXPORT_HISTORY,
        measure: fixture.measure,
        createdAt: '2026-09-04T12:00:00.000Z',
      }),
    )
    const pageSize = plans[0]!.pageSize
    record(directory, 'fixture.json', JSON.stringify(fixture.exam, null, 2))
    record(
      directory,
      'export-document.json',
      JSON.stringify(
        exportDocumentFingerprint(
          buildExportDocument(fixture.exam, fixture.arrangement, STUDENT_TEST),
        ),
        null,
        2,
      ),
    )
    record(
      directory,
      'layout-plan.json',
      JSON.stringify(layoutFingerprint(plans), null, 2),
    )

    await seed(page, fixture)
    // The active fixture Exam is restored by the bare editor route.
    await page.goto('/editor')
    await page.locator('.exam-page').first().waitFor()
    // Media Assets own image bytes. Fixture documents are rewritten to the
    // same content-addressed references the application persists before their
    // normalized authoring records are seeded.
    if (imageSourcesOf(plans).length > 0) {
      await seedImages(page, fixture)
      await page.goto('/editor')
      await page.locator('.exam-page').first().waitFor()
    }
    await settle(page)

    // 1. The Reference PDF, from the clean print-reference preview configured
    //    through the real export dialog.
    const referencePdf = join(directory, 'reference.pdf')
    await configureExport(page, { ...configuration, format: 'pdf' })
    await page.locator('.export-preview .exam-page').first().waitFor()
    await settle(page)
    const printMarkup = await page.evaluate(
      () => document.querySelector('.export-preview')?.outerHTML ?? '',
    )
    await page.evaluate(() => {
      document.documentElement.dataset.exportReferencePrint = 'true'
    })
    await page.addStyleTag({
      content: `
      @media print {
        .dialog-backdrop { display: block !important; position: static !important; padding: 0 !important; }
        .export-dialog { display: block !important; width: auto !important; height: auto !important; max-height: none !important; box-shadow: none !important; }
        .dialog-header, .export-controls, .export-actions { display: none !important; }
        .export-publication-body, .export-preview { display: block !important; padding: 0 !important; overflow: visible !important; background: #fff !important; }
        .export-preview .exam-workspace { display: block !important; }
      }
    `,
    })
    await page.pdf({
      path: referencePdf,
      width: '8.5in',
      height: '11in',
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      printBackground: false,
      preferCSSPageSize: false,
    })
    // 2. The dedicated PDF adapter, downloaded through the same publication
    // workflow and compared directly with the Reference PDF.
    await page.reload()
    await page.locator('.exam-page').first().waitFor()
    await settle(page)
    await configureExport(page, { ...configuration, format: 'pdf' })
    const [pdfDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download PDF' }).click(),
    ])
    const exportedPdf = join(directory, 'export.pdf')
    await pdfDownload.saveAs(exportedPdf)

    // 3. The real DOCX for the retained conversion subset. Every fixture still
    // exercises PDF; DOCX's full semantic matrix remains in the fast suite.
    let docx: string | null = null
    if (DOCX_COMPARED.has(fixture.name)) {
      await page.reload()
      await page.locator('.exam-page').first().waitFor()
      await settle(page)
      await configureExport(page, { ...configuration, format: 'docx' })
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Download DOCX' }).click(),
      ])
      docx = join(directory, 'export.docx')
      await download.saveAs(docx)
    }

    // The media-rich composite is downloaded again through Export History,
    // not the live Working Copy action. This exercises the stored-plan path:
    // changing the current layout engine or Question Bank cannot alter it.
    if (fixture.name === 'a realistic composite exam' && docx) {
      // Destroy the live source after publication. A history export which
      // reads current Question Content, Media Assets, or a new Layout Plan
      // cannot match the original package below.
      const liveQuestions = page.locator('.draft-document:not([hidden]) .exam-question')
      while (await liveQuestions.count()) {
        await liveQuestions.first().click()
        await page.keyboard.press('Delete')
      }
      await expect(liveQuestions).toHaveCount(0)

      await page.getByRole('button', { name: 'Export History' }).click()
      const history = page.getByLabel('Export History')
      await history.locator('.export-history-item').first().click()
      const [historicalDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Re-export DOCX', exact: true }).click(),
      ])
      const historical = join(directory, 'historical-export.docx')
      await historicalDownload.saveAs(historical)
      const originalBytes = readFileSync(docx)
      const historicalBytes = readFileSync(historical)
      expect(await docxFingerprint(historicalBytes)).toEqual(
        await docxFingerprint(originalBytes),
      )
      expect(await packagedMediaHashes(historicalBytes)).toEqual(
        await packagedMediaHashes(originalBytes),
      )
    }

    // 4. Structural parity, against the document the browser actually laid out
    //    — real measurement, real page assignment, not a plan this file built
    //    for itself. The plan is written out beside it as a diagnostic only.
    const printed = printDocumentFingerprint(printMarkup, {
      title: fixture.exam.title,
      arrangement: arrangementRange(plans.map((one) => one.arrangement.letter)),
      width: pageSize.width,
      height: pageSize.height,
      margins: pageSize.margins,
    })
    record(directory, 'print-document.json', JSON.stringify(printed, null, 2))
    const structural = docx
      ? compareFingerprints(printed, await docxFingerprint(readFileSync(docx)))
      : []
    record(directory, 'structural-report.txt', describeDifferences(structural))

    // 5. Page parity: compare the dedicated adapter directly for every fixture,
    // and DOCX through the Comparison Engine for its retained subset.
    const reference = pdfManifest(referencePdf)
    const generated = pdfManifest(exportedPdf)
    const converted = docx ? pdfManifest(convertToPdf(docx, directory)) : null
    record(directory, 'reference-manifest.txt', manifestText(reference))
    if (converted) record(directory, 'docx-manifest.txt', manifestText(converted))
    const ignoredPdfWords = equationWords(mathSourcesOf(printed))
    // List markers are structural rather than semantic words. Chromium's
    // extractor omits CSS list markers while the dedicated adapter exposes its
    // real markers; topology is asserted in the dependency-free fingerprints.
    ignoredPdfWords.add('•')
    for (let marker = 1; marker <= 100; marker += 1) {
      ignoredPdfWords.add(`${marker}.`)
    }
    // Superscript/subscript extraction order is coordinate-driven and may
    // separate a script digit from its base. Formatting is asserted in the
    // adapter tests and fingerprints; omit standalone script digits here.
    const scriptContent = printed.pages.flatMap((page) => page.content).join(' ')
    for (const match of scriptContent.matchAll(
      /«(?:subscript|superscript)»([^«]*)«\/»/g,
    )) {
      ignoredPdfWords.add(match[1] ?? '')
    }
    const generatedPaged = comparePdfs(reference, generated, ignoredPdfWords)
    const paged = converted
      ? comparePdfs(
          reference,
          converted,
          ignoredPdfWords,
        )
      : []
    record(directory, 'pdf-manifest.txt', manifestText(generated))
    record(directory, 'pdf-page-report.txt', describePdfDifferences(generatedPaged))
    record(directory, 'page-report.txt', describePdfDifferences(paged))

    const failed = structural.length > 0 || generatedPaged.length > 0 || paged.length > 0
    if (failed) {
      await testInfo.attach('structural-report', {
        path: join(directory, 'structural-report.txt'),
      })
      await testInfo.attach('pdf-page-report', {
        path: join(directory, 'pdf-page-report.txt'),
      })
      await testInfo.attach('page-report', {
        path: join(directory, 'page-report.txt'),
      })
    } else {
      // Nothing failed, so nothing needs explaining. Only failures keep bytes.
      rmSync(join(directory, 'libreoffice-profile'), {
        recursive: true,
        force: true,
      })
    }

    expect(describeDifferences(structural)).toBe('no differences')
    expect(describePdfDifferences(generatedPaged)).toBe('no differences')
    expect(describePdfDifferences(paged)).toBe('no differences')
  })
}

/** Rewrites fixture image references to one content-addressed Media Asset. */
async function seedImages(
  page: import('@playwright/test').Page,
  fixture: Fixture,
): Promise<void> {
  const owned = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) =>
      character.charCodeAt(0),
    )
    const file = new File([bytes], 'fixture.png', { type: 'image/png' })
    const { saveImage } = await import('/src/local-images.ts')
    return saveImage(file)
  }, Buffer.from(PIXEL_PNG.data).toString('base64'))
  const replace = (node: ProseMirrorJSON): ProseMirrorJSON => ({
    ...node,
    attrs:
      node.type === 'image' || node.type === 'image-block'
        ? { ...(node.attrs as object), src: owned }
        : node.attrs,
    content: Array.isArray(node.content)
      ? node.content.map((child) => replace(child as ProseMirrorJSON))
      : node.content,
  })
  const exam = {
    ...fixture.exam,
    questions: fixture.exam.questions.map((question) => ({
      ...question,
      doc: replace(question.doc),
    })),
  }
  await seedAuthoringState(page, {
    questionBank: { questions: authoredInArrangementOrder({ ...fixture, exam }) },
    workingCopy: {
      title: exam.title,
      questionIds: fixture.arrangement.questionOrder,
    },
    dirty: false,
  })
}

/** Drives the real one-export dialog to one Content Selection. */
async function configureExport(
  page: import('@playwright/test').Page,
  configuration: ExportConfiguration,
): Promise<void> {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Export' })
  await dialog.waitFor()
  await dialog.getByRole('radio', {
    name: configuration.format.toUpperCase(),
  }).check()
  await dialog
    .getByRole('checkbox', { name: 'Student test' })
    .setChecked(configuration.selection.test)
  await dialog
    .getByRole('checkbox', { name: 'Answer key' })
    .setChecked(configuration.selection.answerKey)
}

/** The fixture's questions with their answers already in the fixture arrangement's
 *  order. A Working Copy records no choice order — answers print in the order
 *  they were authored in — so a fixture that permuted its answers is seeded
 *  with them authored that way, which is the same paper by another route. */
function authoredInArrangementOrder(fixture: Fixture): Question[] {
  return fixture.exam.questions.map((question) => {
    const ordered = orderedChoices(question, fixture.arrangement)
    if (ordered.length === 0) return question
    const content = (question.doc.content as ProseMirrorJSON[]).map((node) =>
      node.type === 'multipleChoice'
        ? { ...node, content: ordered.map((choice) => choice.node) }
        : node,
    )
    return { ...question, doc: { ...question.doc, content } }
  })
}

/** The fixture, put where the application looks for its authoring state. */
async function seed(
  page: import('@playwright/test').Page,
  fixture: Fixture,
): Promise<void> {
  await seedAuthoringState(page, {
    questionBank: { questions: authoredInArrangementOrder(fixture) },
    workingCopy: {
      title: fixture.exam.title,
      questionIds: fixture.arrangement.questionOrder,
    },
    dirty: false,
  })
}

/** Fonts and images decide the page's real height, and the application
 *  repaginates once they have settled. Wait for that, not for a fixed delay. */
async function settle(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts?.ready
    await Promise.all(
      Array.from(document.images)
        .filter((image) => !image.complete)
        .map(
          (image) =>
            new Promise((resolve) => {
              image.addEventListener('load', resolve, { once: true })
              image.addEventListener('error', resolve, { once: true })
            }),
        ),
    )
  })
  // One more frame after the last re-measurement the application schedules.
  await page.waitForTimeout(500)
}
