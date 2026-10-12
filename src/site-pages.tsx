import type { PersistentStorageStatus } from './durable-storage'
import { AppShell } from './app-shell'

const SUPPORT_EMAIL = 'support@teacher.dev'

export function AboutPage({
  persistentStorage,
}: {
  persistentStorage: PersistentStorageStatus
}) {
  return (
    <AppShell
      crumbs={[{ label: 'Home', href: '/' }, { label: 'About' }]}
      persistentStorage={persistentStorage}
    >
      <div className="site-prose">
        <h1>About</h1>
        <p className="site-lede">
          A free tool for teachers who need the same test in more than one order.
        </p>

        <section className="site-card">
          <div className="site-card-heading">
            <img src="/edtechathon-logo.svg" alt="" width={40} height={40} />
            <h2>From the EdTech-a-thon</h2>
          </div>
          <p>
            Test Parrot is a project from the{' '}
            <a href="https://edtechathon.com" target="_blank" rel="noopener noreferrer">
              EdTech-a-thon
            </a>
            , a community of builders making free tools for classrooms. Learn more about who we
            are and what else we're building at{' '}
            <a href="https://edtechathon.com" target="_blank" rel="noopener noreferrer">
              edtechathon.com
            </a>
            .
          </p>

          <figure className="site-photo">
            <img src="/edtechathon-2026.jpg" alt="Participants of the 2026 EdTech-a-thon" />
            <figcaption>EdTech-a-thon 2026</figcaption>
          </figure>
        </section>

        <section className="site-card">
          <h2>Our promise</h2>
          <ul className="site-promise">
            <li>
              <strong>Zero paywalls.</strong>
            </li>
            <li>
              <strong>Zero ads.</strong>
            </li>
            <li>
              <strong>Zero tracking of personal data.</strong>
            </li>
          </ul>
        </section>

        <section className="site-card">
          <h2>Feedback &amp; ideas</h2>
          <p>
            We'd love to hear from you. Tell us what's working, what's not, or pitch us an idea
            for a tool you wish existed. We're here to help.
          </p>
          <a
            className="site-button"
            href={`mailto:${SUPPORT_EMAIL}?subject=Test%20Parrot%20feedback`}
          >
            Email {SUPPORT_EMAIL}
          </a>
        </section>
      </div>
    </AppShell>
  )
}

export function PrivacyPage({
  persistentStorage,
}: {
  persistentStorage: PersistentStorageStatus
}) {
  return (
    <AppShell
      crumbs={[{ label: 'Home', href: '/' }, { label: 'Privacy' }]}
      persistentStorage={persistentStorage}
    >
      <div className="site-prose">
        <h1>Privacy</h1>
        <p className="site-lede">What we collect, what we don't, and why.</p>

        <section className="site-card">
          <p>
            Test Parrot does not collect personal information from teachers or students. We use
            Cloudflare Web Analytics to anonymously count the number of visits, which helps us
            understand how Test Parrot is being used in classrooms. Cloudflare Web Analytics is
            cookieless, does not fingerprint visitors, and does not track users across other
            sites; see Cloudflare's{' '}
            <a
              href="https://www.cloudflare.com/privacypolicy/"
              target="_blank"
              rel="noopener noreferrer"
            >
              privacy policy
            </a>{' '}
            for details. We do not share, sell, or otherwise transfer any visitor data to third
            parties.
          </p>
          <p>
            Your exams stay on your own computer. The test you are writing, the versions you save,
            and any images you paste in are stored by your browser on your device, and never leave
            it. Nothing you type is uploaded to us or to anyone else, and exports are built in
            your browser and saved straight to your downloads.
          </p>
          <p>
            Questions or concerns? Email{' '}
            <a href={`mailto:${SUPPORT_EMAIL}?subject=Test%20Parrot%20privacy`}>
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        </section>
      </div>
    </AppShell>
  )
}
