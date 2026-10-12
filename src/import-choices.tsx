import { useId, useState } from 'react'
import { ClipboardPaste } from 'lucide-react'
import { SUPPORTED_SOURCES } from './question-formats/catalog'

/** What an AI assistant converts, named first because most tests arrive as
 *  one of these. */
const CONVERTED_SOURCES = ['PDFs', 'Word documents', 'Photos']

/**
 * What sits under every drop zone that starts an import: what it takes,
 * converted or read straight in, and, for questions a teacher has only as text, a
 * box to paste them into — read the way a dropped text file is.
 */

export function SupportedSources() {
  return <div className="import-sources" aria-label="Supported question files">
    <span>Supports</span>
    <ul>{[...CONVERTED_SOURCES, ...SUPPORTED_SOURCES].map((source) => <li key={source}>{source}</li>)}</ul>
  </div>
}

export function TextOnlyChoices({ busy, onPaste }: {
  busy: boolean
  /** The pasted questions, as the text file they would have been saved as. */
  onPaste: (file: File) => void
}) {
  const textId = useId()
  const [pasting, setPasting] = useState(false)
  const [pasted, setPasted] = useState('')

  return pasting ? (
      <form
        className="import-paste"
        onSubmit={(event) => {
          event.preventDefault()
          if (pasted.trim()) onPaste(new File([pasted], 'Pasted questions.txt', { type: 'text/plain' }))
        }}
      >
        <label htmlFor={textId}>Paste your questions</label>
        <textarea
          id={textId}
          value={pasted}
          rows={10}
          spellCheck={false}
          autoFocus
          placeholder={'MC\nWhich planet is closest to the Sun?\nVenus\n*Mercury\nMars\n\nTF\nThe Sun is a star.\nT'}
          onChange={(event) => setPasted(event.target.value)}
        />
        <p>
          Written for the Blackboard Test Generator, Blackboard, Aiken, GIFT, Respondus or another
          format Test Parrot reads. Leave a blank line between questions.
        </p>
        <div className="import-paste-actions">
          <button type="button" className="secondary-button" onClick={() => setPasting(false)}>Cancel</button>
          <button type="submit" className="primary-button" disabled={busy || !pasted.trim()}>
            Read my questions
          </button>
        </div>
      </form>
    ) : (
      <p className="convert-text-only">
        Only have it as text?{' '}
        <button type="button" className="link-button" disabled={busy} onClick={() => setPasting(true)}>
          <ClipboardPaste aria-hidden="true" /> Paste your questions
        </button>
      </p>
    )
}
