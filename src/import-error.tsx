import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { aiFixRequest } from './import-file-route'
import { supportMailto } from './support-email'

/**
 * A file an AI made that Test Parrot cannot import is almost always fixed by
 * the AI that made it: the error says exactly what is wrong, and the chat that
 * wrote the file can write it again. So that error comes with the way back —
 * copy it, paste it into the same chat — rather than leaving a teacher to read
 * a validation message they were never meant to act on themselves. And any
 * error says who can help with the file.
 */

export function ImportError({ message, aiMade = false }: {
  message: string
  /** Whether the file was one an AI made, which it can make again. */
  aiMade?: boolean
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])
  return <div className="home-error import-error" role="alert">
    <p>{message}</p>
    {aiMade && <div className="import-error-fix">
      <span>
        <strong>Made by an AI?</strong> Copy this error, paste it into the same chat and ask it
        to fix the file. Then drop the new file here.
      </span>
      <button
        type="button"
        className="secondary-button"
        onClick={() => void navigator.clipboard.writeText(aiFixRequest(message)).then(() => setCopied(true))}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {copied ? 'Copied' : 'Copy error'}
      </button>
    </div>}
    <p className="import-error-help">
      Having trouble? <a href={supportMailto('Trouble importing into Test Parrot', { askForFile: true })}>Email us your file</a> and we’ll help.
    </p>
  </div>
}
