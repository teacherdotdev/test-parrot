import { useEffect } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import {
  ArrowRight,
  Camera,
  FileText,
  FileType,
  Image,
  Library,
  MousePointer2,
  NotebookPen,
  PencilLine,
  Printer,
  ScanLine,
  Sparkles,
} from 'lucide-react'
import { Footer, Link } from './site-chrome'
import { markWelcomed } from './welcomed'

/**
 * The front door. A visitor who has never made anything here lands on this
 * page rather than on the resume shelves of Home, because there is nothing to
 * resume yet and everything to explain: a hero, how it works, and where the
 * work lives. Every "Get started" on it leads to the same short onboarding,
 * which is the one place the app says out loud that an Exam is built from a
 * Question Bank. Neither page wears the dashboard shell — there is no
 * breadcrumb to a place you have not been.
 */

const GET_STARTED = '/get-started'

function GetStartedButton({
  children = 'Get started — it’s free',
  className = 'landing-cta',
}: {
  children?: ReactNode
  className?: string
}) {
  return (
    <Link href={GET_STARTED} className={className}>
      {children}
      <ArrowRight aria-hidden="true" />
    </Link>
  )
}

export function LandingHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="landing-header">
      <Link href="/welcome" className="site-wordmark">
        <img className="app-logo" src="/logo.png" alt="" width={36} height={36} />
        Test Parrot
      </Link>
      <nav className="landing-nav" aria-label="Site">
        {children}
      </nav>
    </header>
  )
}

/**
 * The picture the headline makes: one exam sheet in the middle, and the
 * places a question can come from feeding into it. The sources are real
 * things a teacher has lying around, drawn as the files they are; the lines
 * are drawn once in SVG behind them so the cards can be ordinary HTML.
 */
const SOURCES = [
  { key: 'pdf', label: 'last-year.pdf', Icon: FileText, x: 2, y: 8, tilt: -4 },
  { key: 'photo', label: 'photo of a worksheet', Icon: Camera, x: 0, y: 62, tilt: 3 },
  { key: 'scan', label: 'scanned quiz', Icon: ScanLine, x: 70, y: 4, tilt: 3 },
  { key: 'docx', label: 'unit-3-test.docx', Icon: FileType, x: 66, y: 56, tilt: -3 },
  { key: 'image', label: 'a diagram', Icon: Image, x: 36, y: 86, tilt: 2 },
] as const

function HeroArt() {
  return (
    <div className="hero-art" aria-hidden="true">
      <svg className="hero-art-lines" viewBox="0 0 560 480" fill="none">
        <path d="M118 62 C 170 70, 190 110, 210 128" />
        <path d="M112 328 C 150 330, 180 300, 208 282" />
        <path d="M440 44 C 400 66, 380 100, 352 128" />
        <path d="M440 290 C 410 292, 385 276, 352 262" />
        <path d="M280 418 C 280 400, 280 380, 280 366" />
      </svg>

      {SOURCES.map(({ key, label, Icon, x, y, tilt }) => (
        <div
          key={key}
          className="hero-source"
          style={{ left: `${x}%`, top: `${y}%`, '--tilt': `${tilt}deg` } as CSSProperties}
        >
          <Icon />
          <span>{label}</span>
        </div>
      ))}

      <div className="hero-sheet">
        <div className="hero-sheet-head">
          <span className="hero-sheet-title">Unit 3 Test</span>
          <span className="hero-sheet-meta">Name ______  Date ____</span>
        </div>
        <ol className="hero-sheet-questions">
          <li>
            <span className="hero-line" style={{ width: '92%' }} />
            <span className="hero-line" style={{ width: '64%' }} />
            <span className="hero-choices">
              <i>A</i><i>B</i><i>C</i><i>D</i>
            </span>
          </li>
          <li>
            <span className="hero-line" style={{ width: '78%' }} />
            <span className="hero-figure" />
            <span className="hero-choices">
              <i>A</i><i>B</i><i>C</i><i>D</i>
            </span>
          </li>
          <li>
            <span className="hero-line" style={{ width: '86%' }} />
            <span className="hero-line" style={{ width: '40%' }} />
            <span className="hero-answer" />
          </li>
        </ol>
      </div>
    </div>
  )
}

const STEPS = [
  {
    title: 'Gather your questions',
    Icon: Sparkles,
    text:
      'Write them in the editor, or hand a test you already have — a PDF, a scan, a screenshot — to an AI with our instructions and import the file it gives back.',
  },
  {
    title: 'Keep them in a Question Bank',
    Icon: Library,
    text:
      'Every question gets a topic and a difficulty, so the one you want is a filter away. A bank is yours to reuse in as many exams as you like.',
  },
  {
    title: 'Drag them into an Exam',
    Icon: MousePointer2,
    text:
      'Pull questions from any bank onto the page. Reorder them, shuffle the questions or the answers, and make a second version in a click.',
  },
  {
    title: 'Print it',
    Icon: Printer,
    text:
      'Send it to the printer, or download it as a PDF or a Word document. Every export is kept, so the version you handed out is always there.',
  },
] as const

export function LandingPage({ returning }: {
  /** Whether there is work on this device to go back to. Only the header
   * changes: a visitor with Exams already has a Home, and is offered it. */
  returning: boolean
}) {
  return (
    <div className="landing">
      <LandingHeader>
        <a href="#how-it-works" className="site-link">
          How it works
        </a>
        <Link href="/about" className="site-link">
          About
        </Link>
        {returning && (
          <Link href="/" className="site-link">
            Home
          </Link>
        )}
        <GetStartedButton className="landing-cta landing-cta--small">Get started</GetStartedButton>
      </LandingHeader>

      <main>
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <h1>Turn anything into an exam.</h1>
            <p className="landing-lede">
              PDFs, scans, screenshots, old Word documents, questions you type yourself — Test
              Parrot gathers them into Question Banks and lays them out as a clean, printable
              exam.
            </p>
            <GetStartedButton />
            <p className="landing-fineprint">
              Runs in your browser. Nothing to install, no account to make.
            </p>
          </div>
          <HeroArt />
        </section>

        <section className="landing-band" id="how-it-works" aria-labelledby="how-it-works-heading">
          <div className="landing-section">
            <h2 id="how-it-works-heading">How it works</h2>
            <ol className="landing-steps">
              {STEPS.map(({ title, Icon, text }, index) => (
                <li key={title} className="landing-step">
                  <span className="landing-step-mark">
                    <span className="landing-step-number">{index + 1}</span>
                    <Icon aria-hidden="true" />
                  </span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="landing-section" aria-labelledby="local-heading">
          <div className="landing-local-card">
            <h2 id="local-heading">We’re completely local.</h2>
            <p>
              Test Parrot runs entirely in your browser. Your exams, Question Banks and images are
              saved on your own device and never uploaded anywhere — there is no account, no
              server, and nothing to sign up for.
            </p>
            <GetStartedButton />
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}

/**
 * The one page between "Get started" and the app. Its job is a single
 * sentence — an Exam is built from a Question Bank — and the two ways to get
 * a first bank, with the blank Exam kept as the quiet way past it. Converting
 * has a page of its own, because it is a trip out of the app and back.
 */
export function OnboardingPage({
  onNewBank,
  onNewExam,
}: {
  onNewBank: () => void
  onNewExam: () => void
}) {
  useEffect(markWelcomed, [])
  return (
    <div className="landing landing--onboarding">
      <LandingHeader>
        <Link href="/about" className="site-link">
          About
        </Link>
      </LandingHeader>

      <main className="onboarding">
        <h1>Let’s make your first Question Bank</h1>
        <p className="landing-lede">
          Exams in Test Parrot are built from Questions, and Questions live in a Question Bank. So
          the first thing to make is a bank — write it yourself, or convert materials you already
          have.
        </p>

        <div className="onboarding-choices">
          <button type="button" className="onboarding-choice" onClick={onNewBank}>
            <PencilLine aria-hidden="true" />
            <strong>Write it myself</strong>
            <span>Open an empty Question Bank and add questions in the editor, one at a time.</span>
            <em>New Question Bank</em>
          </button>
          <Link href="/get-started/convert" className="onboarding-choice">
            <Sparkles aria-hidden="true" />
            <strong>Convert what I already have</strong>
            <span>
              Give a PDF, scan or screenshot to an AI with our instructions, then import the file
              it produces.
            </span>
            <em>Convert a test</em>
          </Link>
        </div>

        <p className="onboarding-skip">
          Or skip ahead —{' '}
          <button type="button" className="onboarding-skip-button" onClick={onNewExam}>
            <NotebookPen aria-hidden="true" />
            start with a blank Exam
          </button>{' '}
          and make a bank from inside the editor.
        </p>
      </main>

      <Footer />
    </div>
  )
}
