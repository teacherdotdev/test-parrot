import { useEffect, useState } from 'react'
import { Upload } from 'lucide-react'
import { isQuestionFileName } from './question-formats/catalog'

/**
 * Dropping a Question Bank File anywhere on the site imports it.
 *
 * The listeners are on the window in the capture phase, so a Question Bank
 * File dropped over the editor is taken before Milkdown sees it. Everything
 * else — a pasted image dragged into a question, an internal authoring drag —
 * is left strictly alone: nothing is intercepted unless the pointer is
 * carrying a file this app can actually import.
 *
 * A drop over an element marked `data-import-bank-id` — a Question Bank's
 * page, or the editor's open bank — names that bank, so the import defaults
 * to adding into it. The overlay lets the pointer through so the element under
 * it can be read.
 */

/** Where a drop lands: the bank marked under the pointer, if any. */
function bankUnder(target: EventTarget | null): { id: string; name: string } | null {
  const element = target instanceof Element ? target.closest<HTMLElement>('[data-import-bank-id]') : null
  const id = element?.dataset.importBankId
  return id ? { id, name: element.dataset.importBankName ?? '' } : null
}

const WORD_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** A Test Parrot file, a Word document, or a question file from another
 *  tool, by the types a drag declares. A Word document is read as questions
 *  or converted, as the Import dialog decides. */
const IMPORTABLE_TYPES = new Set([
  'application/pdf', 'application/json', WORD_TYPE,
  'text/plain', 'text/csv', 'text/tab-separated-values', 'text/xml', 'application/xml',
  'application/zip', 'application/x-zip-compressed',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

/** A photo of a test, taken only where dropping a test is the page's point:
 *  anywhere else a dragged picture is meant for a question. */
const isPhoto = (type: string) => type.startsWith('image/')

function importable(file: File, tests: boolean): boolean {
  return IMPORTABLE_TYPES.has(file.type) || /\.(pdf|json|docx)$/i.test(file.name) || isQuestionFileName(file.name) ||
    (tests && isPhoto(file.type))
}

/** Read from a `dragover`, where the files themselves are not yet readable and
 *  only the declared item types are. A file whose type the OS did not declare
 *  is not claimed, so an unrelated drag keeps its normal behaviour. */
function carriesImportableFile(transfer: DataTransfer | null, tests: boolean): boolean {
  if (!transfer) return false
  if (!Array.from(transfer.types).includes('Files')) return false
  return Array.from(transfer.items).some(
    (item) => item.kind === 'file' && (IMPORTABLE_TYPES.has(item.type) || (tests && isPhoto(item.type))),
  )
}

export function BankFileDropTarget({
  onFile,
  tests = false,
}: {
  onFile: (file: File, targetBankId?: string) => void
  /** Whether a photo of a test is taken too: where a conversion starts. */
  tests?: boolean
}) {
  const [over, setOver] = useState(false)
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null)
  useEffect(() => {
    const claim = (event: DragEvent) => {
      if (!carriesImportableFile(event.dataTransfer, tests)) return false
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      return true
    }
    const onDragOver = (event: DragEvent) => {
      if (!claim(event)) return
      setOver(true)
      const next = bankUnder(event.target)
      setTarget((current) => current?.id === next?.id && current?.name === next?.name ? current : next)
    }
    const onDragLeave = (event: DragEvent) => {
      // Only the drag actually leaving the window clears the overlay; moving
      // between elements inside it fires `dragleave` constantly.
      if (event.relatedTarget === null) setOver(false)
    }
    const onDrop = (event: DragEvent) => {
      if (!claim(event)) {
        setOver(false)
        return
      }
      setOver(false)
      const file = Array.from(event.dataTransfer?.files ?? []).find((candidate) => importable(candidate, tests))
      if (file) onFile(file, bankUnder(event.target)?.id)
    }
    const onDragEnd = () => setOver(false)
    window.addEventListener('dragover', onDragOver, true)
    window.addEventListener('dragleave', onDragLeave, true)
    window.addEventListener('drop', onDrop, true)
    window.addEventListener('dragend', onDragEnd, true)
    return () => {
      window.removeEventListener('dragover', onDragOver, true)
      window.removeEventListener('dragleave', onDragLeave, true)
      window.removeEventListener('drop', onDrop, true)
      window.removeEventListener('dragend', onDragEnd, true)
    }
  }, [onFile, tests])
  if (!over) return null
  return (
    <div className="bank-drop-overlay" role="presentation">
      <div className="bank-drop-card">
        <Upload aria-hidden="true" />
        {target ? <>
          <strong>Drop to add to {target.name || 'this Question Bank'}</strong>
          <span>Its Questions are added to this bank, and any Exams come too</span>
        </> : tests ? <>
          <strong>Drop your test here</strong>
          <span>Its PDF or Word document, a photo of it, or the file your AI gave back</span>
        </> : <>
          <strong>Drop to import</strong>
          <span>A question file from another tool, your test, or a Test Parrot file</span>
        </>}
      </div>
    </div>
  )
}
