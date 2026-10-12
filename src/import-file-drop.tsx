import { useEffect, useRef, useState } from 'react'
import { UploadCloud } from 'lucide-react'
import { SupportedSources, TextOnlyChoices } from './import-choices'
import { ImportError } from './import-error'
import { routeImportFile } from './import-file-route'
import { TEST_FILE_TYPES } from './source-file'
import { navigate } from './use-route'

/**
 * The one place an import starts: a drop for the test itself, a question
 * file from another tool, or the file an AI made from a test (see
 * `routeImportFile`). Questions a teacher has only as text can be pasted and
 * are read the same way a dropped text file is. A new import, or the one in
 * progress a file answers, opens on its page in Imports.
 */
export function ImportFileDrop({
  dropped,
  onOpenImport,
}: {
  /** A file dropped anywhere on the page, taken as if dropped on the zone. */
  dropped: { file: File; id: number } | null
  /** Open the import dialog for a file, continuing the import it answers
   *  when there is one. */
  onOpenImport: (file: File, waitingImportId?: string) => void
}) {
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<{ message: string; aiMade?: boolean } | null>(null)

  const take = async (file: File) => {
    setError(null)
    setReading(true)
    const route = await routeImportFile(file)
    setReading(false)
    if (route.to === 'error') return setError(route)
    if (route.to === 'import') return onOpenImport(file)
    const id = route.to === 'waiting' ? route.waiting.id : route.waitingImportId
    navigate(`/import?id=${encodeURIComponent(id)}`)
    if (route.to === 'answer') onOpenImport(file, id)
  }

  const taken = useRef<number | null>(null)
  useEffect(() => {
    if (!dropped || taken.current === dropped.id) return
    taken.current = dropped.id
    void take(dropped.file)
  })

  return <>
    {error && <ImportError message={error.message} aiMade={error.aiMade} />}
    <label className="bank-import-drop convert-drop">
      <input
        type="file"
        aria-label="Your test, a question file, or the file your AI gave back"
        accept={`${TEST_FILE_TYPES},application/json,.json`}
        disabled={reading}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void take(file)
        }}
      />
      <UploadCloud aria-hidden="true" />
      <strong>{reading ? 'Reading your file…' : 'Drop your test or question file here'}</strong>
      <span>or click to choose it</span>
    </label>
    <SupportedSources />
    <TextOnlyChoices busy={reading} onPaste={(file) => void take(file)} />
  </>
}
