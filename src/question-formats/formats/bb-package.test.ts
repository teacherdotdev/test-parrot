import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { inspectImportValue } from '../../package-import'
import { readQuestionFile } from '..'
import { blankAnswers, blocksText } from '../rich-text'

const fixture = (path: string) => new Uint8Array(readFileSync(new URL(`../fixtures/${path}`, import.meta.url)))
const encode = (text: string) => new TextEncoder().encode(text)
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (character) => character.charCodeAt(0),
)

/** A file read, then checked by the import every Test Parrot file goes through. */
async function read(name: string, bytes: Uint8Array) {
  const reading = await readQuestionFile({ name, bytes })
  const proposal = await inspectImportValue(reading.record, undefined, reading.files)
  return { reading, proposal, questions: reading.record.bank.questions }
}

const text = (document: { content: unknown[] } | undefined) =>
  document ? blocksText(document.content as never) : ''

async function zip(files: Record<string, Uint8Array | string>) {
  const archive = new JSZip()
  for (const [path, content] of Object.entries(files)) archive.file(path, content)
  return archive.generateAsync({ type: 'uint8array' })
}

const manifest = (resources: string) => `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="man00001" xmlns:bb="http://www.blackboard.com/content-packaging/">
  <organizations default="toc00001"><organization identifier="toc00001"/></organizations>
  <resources>${resources}</resources>
</manifest>`

describe('Blackboard Test Generator pool download', () => {
  test('reads the generator’s own sample output', async () => {
    const { reading, proposal, questions } = await read('sampleOutput.zip', fixture('bb-package/oc-sample-output.zip'))
    expect(reading.format).toBe('bb-package')
    expect(proposal).toBeTruthy()
    expect(reading.found).toBe(6)
    expect(reading.record.bank.name).toBe('test quiz')
    expect(questions.map((question) => question.type)).toEqual([
      'multiple-choice', 'multiple-choice', 'true-false', 'short-answer', 'fill-in-the-blank', 'matching',
    ])
    expect(questions.map((question) => text(question.stem))).toEqual([
      'Which of the following is a prime number?',
      'Which of the following is a prime number?',
      '3 is a prime number.',
      'Tell me your life story.',
      'Two plus two equals _____.',
      'Match the number with it\'s spelling. :)',
    ])
    // Question 1 is Multiple Answer: it comes in with none marked, and says so.
    expect(questions[0]!.choices!.map((choice) => text(choice.content))).toEqual(['2', '3', '4', '5', '6', '7'])
    expect(questions[0]!.choices!.every((choice) => !choice.correct)).toBe(true)
    expect(reading.issues.map((issue) => issue.code)).toContain('multiple-answer')
    expect(questions[1]!.choices!.map((choice) => [text(choice.content), choice.correct])).toEqual([
      ['4', false], ['5', true], ['6', false],
    ])
    expect(questions[2]!.choices!.map((choice) => choice.correct)).toEqual([true, false])
    expect(blankAnswers(questions[4]!.stem.content)).toEqual(['four / 4'])
    const matching = questions[5]!
    expect(matching.prompts!.map((prompt) => text(prompt.content))).toEqual(['12', '1', '3', '4'])
    const answerOf = (index: number) =>
      text(matching.wordBank!.find((answer) => answer.id === matching.prompts![index]!.answer)?.content)
    expect([0, 1, 2, 3].map(answerOf)).toEqual(['twelve', 'one', 'three', 'four'])
    // A Blackboard 5 pool gives no points, so nothing has Points.
    expect(questions.every((question) => question.points === undefined)).toBe(true)
  })

  test('reads the pool’s .dat on its own, and without assuming its name', async () => {
    const archive = await JSZip.loadAsync(fixture('bb-package/oc-sample-output.zip'))
    const dat = await archive.file('res00001.dat')!.async('uint8array')
    const bare = await read('res00001.dat', dat)
    expect(bare.reading.format).toBe('bb-package')
    expect(bare.questions).toHaveLength(6)

    const renamed = await read('pool.zip', await zip({
      'imsmanifest.xml': manifest('<resource bb:file="chapter-two.dat" bb:title="Chapter 2" identifier="res00007" type="assessment/x-bb-pool" xml:base="res00007"/>'),
      'chapter-two.dat': dat,
    }))
    expect(renamed.reading.format).toBe('bb-package')
    expect(renamed.questions).toHaveLength(6)
  })
})

describe('Blackboard QTI pool and test export', () => {
  const pool = () => fixture('bb-package/qti-pool.dat')

  async function exportZip(extra: Record<string, Uint8Array | string> = {}, resources = '') {
    return zip({
      'imsmanifest.xml': manifest(
        `<resource bb:file="res00001.dat" bb:title="Astronomy basics" identifier="res00001" type="assessment/x-bb-qti-pool" xml:base="res00001"/>${resources}`,
      ),
      '.bb-package-info': 'cx.package.info.version=6.0\n',
      'res00001.dat': pool(),
      'csfiles/home_dir/Pictures__xid-4060800_1/mars__xid-4060915_1.png': PNG,
      ...extra,
    })
  }

  test('reads every question type Blackboard exports', async () => {
    const { reading, proposal, questions } = await read('ExportFile_ASTRO101.zip', await exportZip())
    expect(reading.format).toBe('bb-package')
    expect(proposal).toBeTruthy()
    expect(reading.record.bank.name).toBe('Astronomy basics')
    expect(reading.found).toBe(10)
    expect(questions.map((question) => question.type)).toEqual([
      'multiple-choice', 'multiple-choice', 'true-false', 'short-answer', 'matching',
      'fill-in-the-blank', 'short-answer', 'short-answer', 'fill-in-the-blank',
    ])

    const [choice, multiple, trueFalse, essay, matching, blank, numeric, ordering, blanks] = questions
    // Each item's qmd_absolutescore_max of 10 is its Points, the Matching set's for the set.
    expect(questions.map((question) => question.points)).toEqual(questions.map(() => 10))
    expect(text(choice!.stem)).toBe('Which planet is shown?')
    expect(choice!.choices!.map((each) => [text(each.content), each.correct])).toEqual([
      ['Venus', false], ['Mars', true], ['Jupiter', false],
    ])
    // The xid picture came in from csfiles as a Media Asset.
    const picture = choice!.stem.content.find((node) => (node as { type: string }).type === 'block-image') as { asset: string; alt?: string }
    expect(picture.alt).toBe('A red planet')
    expect(reading.record.media.map((asset) => asset.id)).toContain(picture.asset)

    expect(text(multiple!.stem)).toBe('Select all the prime numbers.')
    expect(multiple!.choices!.every((each) => !each.correct)).toBe(true)
    expect(reading.issues.find((issue) => issue.code === 'multiple-answer')?.message).toContain('(a, c)')

    expect(trueFalse!.choices!.map((each) => each.correct)).toEqual([true, false])
    expect(text(essay!.suggestedAnswer)).toBe('The tilt of its axis.')

    expect(matching!.prompts!.map((prompt) => text(prompt.content))).toEqual(['France', 'Japan'])
    const answerOf = (index: number) =>
      text(matching!.wordBank!.find((answer) => answer.id === matching!.prompts![index]!.answer)?.content)
    expect([answerOf(0), answerOf(1)]).toEqual(['Paris', 'Tokyo'])
    expect(matching!.wordBank!.map((answer) => text(answer.content))).toContain('Lima')

    // The question's own underscores are where its Blank goes.
    expect(text(blank!.stem)).toBe('Water is made of hydrogen and _____.')
    expect(blankAnswers(blank!.stem.content)).toEqual(['oxygen / O'])
    expect(text(numeric!.suggestedAnswer)).toBe('3.14 (± 0.01)')
    expect(text(ordering!.suggestedAnswer).split(/\n+/)).toEqual(['Mercury', 'Earth', 'Mars'])
    // Each `[name]` in the text is its blank's place.
    expect(text(blanks!.stem)).toBe('Roses are _____ and violets are _____.')
    expect(blankAnswers(blanks!.stem.content)).toEqual(['red / crimson', 'blue'])

    // The Hot Spot question is left out, and says why.
    const hotSpot = reading.issues.find((issue) => issue.code === 'unsupported-type')
    expect(hotSpot?.severity).toBe('error')
    expect(hotSpot?.message).toBe('Question 10: Test Parrot has no “Hot Spot” questions, so it was left out.')
  })

  test('an item worth a fraction of a point comes in unpointed', async () => {
    const dat = new TextDecoder().decode(pool())
    const first = dat.indexOf('<qmd_absolutescore_max>10.000000000000000</qmd_absolutescore_max>', dat.indexOf('<item '))
    const halved = dat.slice(0, first) + '<qmd_absolutescore_max>2.500000000000000</qmd_absolutescore_max>'
      + dat.slice(first + '<qmd_absolutescore_max>10.000000000000000</qmd_absolutescore_max>'.length)
    const { questions } = await read('res00001.dat', encode(halved))
    expect(questions.map((question) => question.points).slice(0, 2)).toEqual([undefined, 10])
  })

  test('a Random Block brings in its pool’s questions once', async () => {
    const test = `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop>
  <assessment title="Midterm">
    <assessmentmetadata><bbmd_assessmenttype>Test</bbmd_assessmenttype></assessmentmetadata>
    <section>
      <sectionmetadata><bbmd_sectiontype>Subsection</bbmd_sectiontype></sectionmetadata>
      <section title="Random Block">
        <sectionmetadata><bbmd_sectiontype>Random Block</bbmd_sectiontype></sectionmetadata>
        <selection_ordering>
          <selection><sourcebank_ref>res00001</sourcebank_ref><selection_number>3</selection_number></selection>
        </selection_ordering>
      </section>
    </section>
  </assessment>
</questestinterop>`
    const { reading, questions } = await read('midterm.zip', await zip({
      'imsmanifest.xml': manifest(
        '<resource bb:file="res00002.dat" bb:title="Midterm" identifier="res00002" type="assessment/x-bb-qti-test" xml:base="res00002"/>' +
        '<resource bb:file="res00001.dat" bb:title="Astronomy basics" identifier="res00001" type="assessment/x-bb-qti-pool" xml:base="res00001"/>',
      ),
      'res00002.dat': test,
      'res00001.dat': pool(),
    }))
    expect(reading.format).toBe('bb-package')
    expect(questions).toHaveLength(9)
    expect(new Set(questions.map((question) => text(question.stem))).size).toBe(9)
    expect(reading.record.bank.name).toBe('midterm')
    expect(questions[0]!.topics).toEqual(['Astronomy basics'])
    // Its picture is missing from this export, so it is left out, and said so.
    expect(reading.issues.some((issue) => issue.code === 'picture-missing' && issue.message.startsWith('Question 1:'))).toBe(true)
  })

  test('is not QTI’s: a Blackboard export goes to Blackboard’s reader', async () => {
    const { reading } = await read('export.zip', await exportZip())
    const qti = reading.candidates.find((candidate) => candidate.id === 'qti')
    expect(reading.candidates[0]!.id).toBe('bb-package')
    expect(qti?.score ?? 0).toBeLessThan(0.3)
  })
})

describe('Blackboard files that try something', () => {
  test('an external entity is never expanded', async () => {
    const dat = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE POOL [ <!ENTITY secret SYSTEM "file:///etc/passwd"> ]>
<POOL>
  <TITLE value="Hostile" />
  <QUESTIONLIST><QUESTION id="q1" class="QUESTION_ESSAY" /></QUESTIONLIST>
  <QUESTION_ESSAY id="q1"><BODY><TEXT>Tell me &secret; please.</TEXT></BODY></QUESTION_ESSAY>
</POOL>`
    const { reading, questions } = await read('hostile.dat', encode(dat))
    expect(reading.format).toBe('bb-package')
    expect(questions).toHaveLength(1)
    const stem = text(questions[0]!.stem)
    expect(stem).not.toContain('root:')
    expect(stem).toContain('Tell me')
  })

  test('a script or event handler in a stem does not survive', async () => {
    const dat = `<?xml version="1.0" encoding="utf-8"?>
<POOL>
  <TITLE value="Hostile" />
  <QUESTIONLIST><QUESTION id="q1" class="QUESTION_ESSAY" /></QUESTIONLIST>
  <QUESTION_ESSAY id="q1"><BODY><TEXT>&lt;p&gt;Explain.&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src="x.png" onerror="alert(2)"&gt;&lt;a href="javascript:alert(3)"&gt;here&lt;/a&gt;&lt;/p&gt;</TEXT></BODY></QUESTION_ESSAY>
</POOL>`
    const { reading, questions } = await read('hostile.dat', encode(dat))
    const stem = JSON.stringify(questions[0]!.stem)
    expect(text(questions[0]!.stem)).toBe('Explain.here')
    expect(stem).not.toContain('alert')
    expect(stem).not.toContain('onerror')
    expect(stem).not.toContain('javascript')
    expect(reading.issues.some((issue) => issue.code === 'picture-missing')).toBe(true)
  })

  test('a .dat that is not well-formed reports it rather than failing', async () => {
    const archive = await zip({
      'imsmanifest.xml': manifest('<resource bb:file="res00001.dat" identifier="res00001" type="assessment/x-bb-qti-pool"/><resource bb:file="missing.dat" identifier="res00002" type="assessment/x-bb-qti-pool"/>'),
      'res00001.dat': '<questestinterop><assessment title="Broken"><section><item>',
    })
    await expect(readQuestionFile({ name: 'broken.zip', bytes: archive }, { format: 'bb-package' })).rejects.toThrow(/not well-formed/)
  })
})
