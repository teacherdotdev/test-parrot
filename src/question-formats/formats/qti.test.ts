import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { inspectImportValue } from '../../package-import'
import { readQuestionFile } from '..'
import { blankAnswers, blocksText } from '../rich-text'

const fixtures = fileURLToPath(new URL('../fixtures/qti/', import.meta.url))
const fixture = (path: string) => new Uint8Array(readFileSync(join(fixtures, path)))
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

/** A fixture folder zipped, the way Canvas downloads it. */
function folder(path: string, skip: (file: string) => boolean = () => false) {
  const files: Record<string, Uint8Array> = {}
  const walk = (at: string) => {
    for (const name of readdirSync(join(fixtures, path, at))) {
      const relative = at ? `${at}/${name}` : name
      if (statSync(join(fixtures, path, relative)).isDirectory()) walk(relative)
      else if (!skip(relative)) files[relative] = fixture(`${path}/${relative}`)
    }
  }
  walk('')
  return zip(files)
}

describe('Canvas classic quiz export', () => {
  test('reads every question type, once, with its picture', async () => {
    const { reading, proposal, questions } = await read('unit-1-science-quiz-export.zip', await folder('canvas-export'))
    expect(reading.format).toBe('qti')
    expect(proposal).toBeTruthy()
    expect(reading.record.bank.name).toBe('Unit 1 Science Quiz')
    // Eleven questions and a text-only passage; the non_cc copy is not read again.
    expect(reading.found).toBe(11)
    expect(questions.map((question) => question.type)).toEqual([
      'multiple-choice', 'true-false', 'short-answer', 'fill-in-the-blank', 'multiple-choice', 'fill-in-the-blank',
      'matching', 'short-answer', 'short-answer', 'short-answer',
    ])
    const [choice, trueFalse, shortAnswer, blanks, multiple, dropdowns, matching, numeric, essay, upload] = questions
    // Each item's points_possible of 1.0 is one point, the Matching set's for the set.
    expect(questions.map((question) => question.points)).toEqual(questions.map(() => 1))

    expect(text(choice!.stem)).toBe('Which gas do plants take in?')
    expect(choice!.choices!.map((each) => [text(each.content), each.correct])).toEqual([
      ['Oxygen', false], ['Carbon dioxide', true], ['Helium', false],
    ])
    const picture = choice!.stem.content.find((node) => (node as { type: string }).type === 'block-image') as { asset: string }
    expect(reading.record.media.map((asset) => asset.id)).toEqual([picture.asset])

    expect(trueFalse!.choices!.map((each) => each.correct)).toEqual([false, true])
    // A short answer has no place for a blank; each `[name]` is its blank's.
    expect(text(shortAnswer!.suggestedAnswer)).toBe('Au / au')
    expect(text(blanks!.stem)).toBe('Roses are _____, violets are _____.')
    expect(blankAnswers(blanks!.stem.content)).toEqual(['red / crimson', 'blue'])
    expect(multiple!.choices!.map((each) => text(each.content))).toEqual(['Whale', 'Shark', 'Bat'])
    expect(reading.issues.find((issue) => issue.code === 'multiple-answer')?.message).toContain('(a, c)')
    // A drop-down holds its right choice, and the teacher is told.
    expect(text(dropdowns!.stem)).toBe('Water boils at _____ degrees Celsius.')
    expect(blankAnswers(dropdowns!.stem.content)).toEqual(['100'])
    expect(reading.issues.find((issue) => issue.code === 'dropdown-blank')?.message).toBe(
      'Question 6: Test Parrot has no drop-down blanks, so each came in as a Blank holding its correct choice.',
    )

    expect(matching!.prompts!.map((prompt) => text(prompt.content))).toEqual(['France', 'Japan'])
    const answerOf = (index: number) =>
      text(matching!.wordBank!.find((answer) => answer.id === matching!.prompts![index]!.answer)?.content)
    expect([answerOf(0), answerOf(1)]).toEqual(['Paris', 'Tokyo'])
    expect(matching!.wordBank!.map((answer) => text(answer.content))).toEqual(['Paris', 'Tokyo', 'Lima'])

    expect(text(numeric!.suggestedAnswer)).toBe('9.81 (± 0.01)')
    expect(text(essay!.stem)).toBe('Describe the water cycle.')
    expect(text(upload!.stem)).toBe('Upload your lab report.')

    const codes = reading.issues.map((issue) => [issue.severity, issue.code])
    expect(codes).toContainEqual(['info', 'not-a-question'])
    expect(codes).toContainEqual(['error', 'unsupported-type'])
    expect(reading.issues.find((issue) => issue.code === 'unsupported-type')?.message).toBe(
      'Question 11: Test Parrot has no “calculated_question” questions, so it was left out.',
    )
  })

  test('reads the quiz alone, as a bare .xml', async () => {
    const { reading, questions } = await read('g8f3c2a.xml', fixture('canvas-export/g8f3c2a/g8f3c2a.xml'))
    expect(reading.format).toBe('qti')
    expect(questions).toHaveLength(10)
    // Its picture is in the package, not here: left out, and said so.
    expect(reading.issues.some((issue) => issue.code === 'picture-missing' && issue.message.startsWith('Question 1:'))).toBe(true)
  })
})

describe('QTI 2.1 and 2.2 items', () => {
  test('a choice item, its prompt and picture', async () => {
    const { reading, questions } = await read('choice.xml', fixture('qti21-choice.xml'))
    expect(reading.format).toBe('qti')
    expect(questions).toHaveLength(1)
    expect(text(questions[0]!.stem)).toBe('Look at the sign in the picture.\nWhat does the sign ask you to do?')
    expect(questions[0]!.choices!.map((each) => [text(each.content), each.correct])).toEqual([
      ['Cut the grass.', false], ['Stay off the grass.', true], ['Water the grass.', false],
    ])
    // A bare item file has no picture to bring in.
    expect(reading.issues.map((issue) => issue.code)).toContain('picture-missing')
  })

  test('matching, text entry and ordering', async () => {
    const match = await read('match.xml', fixture('qti21-match.xml'))
    expect(match.reading.format).toBe('qti')
    const [matching] = match.questions
    expect(text(matching!.stem)).toBe('Match each book to its author.')
    expect(matching!.prompts!.map((prompt) => text(prompt.content))).toEqual(['Hamlet', 'Emma'])
    const answerOf = (index: number) =>
      text(matching!.wordBank!.find((answer) => answer.id === matching!.prompts![index]!.answer)?.content)
    expect([answerOf(0), answerOf(1)]).toEqual(['William Shakespeare', 'Jane Austen'])
    expect(matching!.wordBank!.map((answer) => text(answer.content))).toContain('Charles Dickens')

    const entry = await read('entry.xml', fixture('qti21-text-entry.xml'))
    expect(text(entry.questions[0]!.stem)).toBe('The capital of Canada is _____.')
    expect(entry.questions[0]!.type).toBe('fill-in-the-blank')
    expect(blankAnswers(entry.questions[0]!.stem.content)).toEqual(['Ottawa'])

    const order = await read('order.xml', fixture('qti21-order.xml'))
    expect(order.questions[0]!.type).toBe('short-answer')
    expect(text(order.questions[0]!.suggestedAnswer).split(/\n+/)).toEqual([
      'Ask a question', 'Test the hypothesis', 'Draw a conclusion',
    ])
  })

  test('a package: its test names the bank, and pictures come from inside it', async () => {
    const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" identifier="MANIFEST-1">
  <organizations/>
  <resources>
    <resource identifier="test" type="imsqti_test_xmlv2p1" href="test.xml"><file href="test.xml"/></resource>
    <resource identifier="choice" type="imsqti_item_xmlv2p1" href="items/choice.xml"><file href="items/choice.xml"/><file href="items/images/sign.png"/></resource>
    <resource identifier="match" type="imsqti_item_xmlv2p1" href="items/match.xml"><file href="items/match.xml"/></resource>
  </resources>
</manifest>`
    const testXml = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentTest xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1" identifier="t1" title="English reading check">
  <testPart identifier="p1" navigationMode="linear" submissionMode="individual">
    <assessmentSection identifier="s1" title="Section" visible="true">
      <assessmentItemRef identifier="choice" href="items/choice.xml"/>
      <assessmentItemRef identifier="match" href="items/match.xml"/>
    </assessmentSection>
  </testPart>
</assessmentTest>`
    const { reading, questions } = await read('reading-check.zip', await zip({
      'imsmanifest.xml': manifest,
      'test.xml': testXml,
      'items/choice.xml': fixture('qti21-choice.xml'),
      'items/match.xml': fixture('qti21-match.xml'),
      'items/images/sign.png': PNG,
    }))
    expect(reading.format).toBe('qti')
    expect(reading.record.bank.name).toBe('English reading check')
    expect(questions.map((question) => question.type)).toEqual(['multiple-choice', 'matching'])
    expect(reading.record.media).toHaveLength(1)
    expect(reading.issues.filter((issue) => issue.code === 'picture-missing')).toEqual([])
  })
})

describe('QTI points kept as Points', () => {
  const qti12 = (items: string) => encode(`<?xml version="1.0" encoding="UTF-8"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2">
  <assessment ident="a1" title="Weather"><section ident="root_section">${items}</section></assessment>
</questestinterop>`)
  const essay = (ident: string, wording: string, extra: string) => `
      <item ident="${ident}" title="Question">${extra}
        <presentation>
          <material><mattext>${wording}</mattext></material>
          <response_str ident="r" rcardinality="Single"><render_fib rows="5"/></response_str>
        </presentation>
      </item>`

  test('a QTI 1.2 item keeps a whole-number weighting or SCORE maximum, and drops a fraction', async () => {
    const { reading, questions } = await read('weather.xml', qti12([
      essay('i1', 'Describe a storm.', '<itemmetadata><qtimetadata><qtimetadatafield><fieldlabel>qmd_weighting</fieldlabel><fieldentry>2</fieldentry></qtimetadatafield></qtimetadata></itemmetadata>'),
      essay('i2', 'Describe fog.', '<resprocessing><outcomes><decvar varname="SCORE" vartype="Decimal" minvalue="0" maxvalue="3"/></outcomes></resprocessing>'),
      essay('i3', 'Describe hail.', '<resprocessing><outcomes><decvar varname="SCORE" vartype="Decimal" minvalue="0" maxvalue="1.5"/></outcomes></resprocessing>'),
      essay('i4', 'Describe sleet.', ''),
    ].join('')))
    expect(reading.format).toBe('qti')
    expect(questions.map((question) => question.points)).toEqual([2, 3, undefined, undefined])
  })

  test('a Canvas item’s points_possible is its Points, never its SCORE percentage', async () => {
    const canvas = (points: string) => `<itemmetadata><qtimetadata>
          <qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>essay_question</fieldentry></qtimetadatafield>
          <qtimetadatafield><fieldlabel>points_possible</fieldlabel><fieldentry>${points}</fieldentry></qtimetadatafield>
        </qtimetadata></itemmetadata>
        <resprocessing><outcomes><decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/></outcomes></resprocessing>`
    const { questions } = await read('weather.xml', qti12([
      essay('i1', 'Describe a storm.', canvas('4.0')),
      essay('i2', 'Describe fog.', canvas('0.5')),
      essay('i3', 'Describe hail.', canvas('0.0')),
    ].join('')))
    expect(questions.map((question) => question.points)).toEqual([4, undefined, undefined])
  })

  test('a QTI 2.1 item’s MAXSCORE, and a QTI 3.0 item’s SCORE normal-maximum', async () => {
    const qti21 = await read('storm.xml', encode(`<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1" identifier="storm" title="Storm" adaptive="false" timeDependent="false">
  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="string"/>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"/>
  <outcomeDeclaration identifier="MAXSCORE" cardinality="single" baseType="float"><defaultValue><value>4</value></defaultValue></outcomeDeclaration>
  <itemBody><p>Describe a storm.</p><extendedTextInteraction responseIdentifier="RESPONSE"/></itemBody>
</assessmentItem>`))
    expect(qti21.reading.format).toBe('qti')
    expect(qti21.questions[0]!.points).toBe(4)

    const qti30 = await read('fog.xml', encode(`<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="fog" title="Fog" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float" normal-maximum="2"/>
  <qti-item-body><p>Describe fog.</p><qti-extended-text-interaction response-identifier="RESPONSE"/></qti-item-body>
</qti-assessment-item>`))
    expect(qti30.reading.format).toBe('qti')
    expect(qti30.questions[0]!.points).toBe(2)

    // An item whose SCORE gives no maximum is unpointed.
    const plain = await read('choice.xml', fixture('qti21-choice.xml'))
    expect(plain.questions[0]!.points).toBeUndefined()
  })
})

describe('QTI 3.0 items', () => {
  test('a multiple-response choice item', async () => {
    const { reading, questions } = await read('primes.xml', fixture('qti30-choice.xml'))
    expect(reading.format).toBe('qti')
    expect(text(questions[0]!.stem)).toBe('Which of these numbers are prime?\nSelect all that apply.')
    expect(questions[0]!.choices!.map((each) => text(each.content))).toEqual(['2', '4', '7'])
    expect(reading.issues.find((issue) => issue.code === 'multiple-answer')?.message).toContain('(a, c)')
  })

  test('a text entry and a drop-down in one sentence', async () => {
    const { reading, questions } = await read('rivers.xml', fixture('qti30-text-entry.xml'))
    expect(reading.format).toBe('qti')
    expect(questions[0]!.type).toBe('fill-in-the-blank')
    expect(text(questions[0]!.stem)).toBe('London stands on the _____, and Paris on the _____.')
    expect(blankAnswers(questions[0]!.stem.content)).toEqual(['Thames / River Thames', 'Seine'])
    expect(reading.issues.map((issue) => issue.code)).toContain('dropdown-blank')
  })
})

describe('QTI detection and safety', () => {
  test('a Blackboard pool .dat is left to Blackboard’s reader', async () => {
    const dat = `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop><assessment title="Pool"><section><item title="Q">
<itemmetadata><bbmd_questiontype>Essay</bbmd_questiontype></itemmetadata>
<presentation><flow class="Block"><flow class="QUESTION_BLOCK"><flow class="FORMATTED_TEXT_BLOCK"><material><mat_extension><mat_formattedtext type="HTML">Why?</mat_formattedtext></mat_extension></material></flow></flow></flow></presentation>
</item></section></assessment></questestinterop>`
    const { reading } = await read('res00001.dat', encode(dat))
    expect(reading.format).toBe('bb-package')
  })

  test('Moodle XML is not QTI', async () => {
    const reading = await readQuestionFile({ name: 'quiz.xml', bytes: encode('<?xml version="1.0"?><quiz><question type="essay"><questiontext><text>Why?</text></questiontext></question></quiz>') }).catch(() => null)
    expect(reading?.format ?? null).not.toBe('qti')
  })

  test('an external entity is never expanded, and a script does not survive', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE questestinterop [ <!ENTITY secret SYSTEM "file:///etc/passwd"> ]>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2">
  <assessment ident="a1" title="Hostile">
    <section ident="root_section">
      <item ident="i1" title="Question">
        <presentation>
          <material><mattext texttype="text/html">&lt;p&gt;Why &amp;secret;?&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src="x.png" onerror="alert(2)"&gt;&lt;/p&gt;</mattext></material>
          <response_str ident="response1" rcardinality="Single"><render_fib/></response_str>
        </presentation>
      </item>
      <item ident="i2" title="Question">
        <presentation><material><mattext>Say &secret;</mattext></material><response_str ident="r" rcardinality="Single"><render_fib/></response_str></presentation>
      </item>
    </section>
  </assessment>
</questestinterop>`
    const { reading, questions } = await read('hostile.xml', encode(xml))
    expect(reading.format).toBe('qti')
    expect(questions).toHaveLength(2)
    const json = JSON.stringify(questions)
    expect(json).not.toContain('root:')
    expect(json).not.toContain('alert')
    expect(json).not.toContain('onerror')
    expect(text(questions[0]!.stem)).toBe('Why &secret;?')
  })
})
