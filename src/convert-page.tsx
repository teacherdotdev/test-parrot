import { ImportFileDrop } from './import-file-drop'
import { LandingHeader } from './landing-page'
import { Footer, Link } from './site-chrome'

/**
 * The second onboarding page, for a teacher with a test already in hand. It
 * asks for one thing, the test, as Imports does for a new import — and takes
 * the file the AI gives back the same way.
 */
export function ConvertPage({
  dropped,
  onOpenImport,
}: {
  dropped: { file: File; id: number } | null
  onOpenImport: (file: File, waitingImportId?: string) => void
}) {
  return (
    <div className="landing landing--onboarding landing--convert">
      <LandingHeader>
        <Link href="/get-started" className="site-link">
          Back
        </Link>
        <Link href="/about" className="site-link">
          About
        </Link>
      </LandingHeader>

      <main className="convert">
        <div className="convert-head">
          <h1>Convert a test you already have</h1>
          <p className="landing-lede">
            A question file from Blackboard, Canvas, Moodle or another tool comes straight in, with
            no AI. Any other test — a PDF, a Word document, a photo — an AI assistant turns into a
            file Test Parrot imports: your questions, the test laid out as you gave it, and its
            pictures.
          </p>
        </div>

        <div className="convert-body">
          <ImportFileDrop dropped={dropped} onOpenImport={onOpenImport} />
        </div>
      </main>

      <Footer />
    </div>
  )
}
