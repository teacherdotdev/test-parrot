import { expect, test, type BrowserContext, type Page } from '@playwright/test'

// Sync with Drive (ADR-0052) against a stubbed Google: the Identity Services
// script hands out a token at once, and every Drive API call is answered by
// an in-memory Drive shared by every browser context in a test. No test
// talks to Google. The app shows Drive only with a client ID, so run with
// VITE_GOOGLE_CLIENT_ID set, e.g.
//   VITE_GOOGLE_CLIENT_ID=e2e PLAYWRIGHT_PORT=4291 npx playwright test scripts/drive-sync.e2e.ts

test.skip(!process.env.VITE_GOOGLE_CLIENT_ID, 'needs VITE_GOOGLE_CLIENT_ID for the dev server')

type FakeFile = {
  id: string
  name: string
  mimeType: string
  parents: string[]
  owner: string
  trashed: boolean
  appProperties: Record<string, string>
  bytes: Buffer
  readers: Set<string>
}

class FakeGoogle {
  files = new Map<string, FakeFile>()
  private next = 1
  /** Files each account has handed to the app (drive.file). */
  granted = new Map<string, Set<string>>()

  view(file: FakeFile, email: string) {
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      parents: file.parents,
      ...(file.mimeType.includes('folder') ? {} : { md5Checksum: `${file.bytes.length}-${hash(file.bytes)}` }),
      trashed: file.trashed,
      ownedByMe: file.owner === email,
      capabilities: { canEdit: file.owner === email || file.readers.has(email) },
      owners: [{ emailAddress: file.owner }],
      appProperties: file.appProperties,
    }
  }

  share(id: string, email: string) {
    this.files.get(id)!.readers.add(email)
  }

  visible(file: FakeFile, email: string) {
    return file.owner === email || (file.readers.has(email) && this.granted.get(email)?.has(file.id))
  }

  /** Answers one Drive API request as `email`. */
  async handle(email: string, method: string, url: URL, headers: Record<string, string>, body: Buffer | null) {
    const path = url.pathname
    const json = (value: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(value) })
    if (path.endsWith('/about')) return json({ user: { emailAddress: email, displayName: email } })
    // What picking a file in the stubbed Picker does: hands it to the app.
    if (path.endsWith('/fake-picker/grant')) {
      const picked = url.searchParams.get('id')!
      if (!this.granted.has(email)) this.granted.set(email, new Set())
      this.granted.get(email)!.add(picked)
      return json({})
    }
    const match = path.match(/\/files(?:\/([^/]+))?(\/permissions)?$/)
    if (!match) return json({ error: { message: 'unknown' } }, 404)
    const id = match[1] ? decodeURIComponent(match[1]) : undefined
    if (!id && method === 'GET') {
      return json({ files: [...this.files.values()].filter((file) => !file.trashed && this.visible(file, email)).map((file) => this.view(file, email)) })
    }
    if (!id && method === 'POST') {
      const meta = JSON.parse(body!.toString()) as { name: string; mimeType: string; parents: string[]; appProperties: Record<string, string> }
      const file: FakeFile = { id: `drive-${this.next++}`, ...meta, owner: email, trashed: false, bytes: Buffer.alloc(0), readers: new Set() }
      this.files.set(file.id, file)
      return json(this.view(file, email))
    }
    const file = this.files.get(id!)
    if (!file || !this.visible(file, email)) return json({ error: { message: 'File not found' } }, 404)
    if (match[2]) return json({ permissions: [{ role: 'owner' }, ...[...file.readers].map(() => ({ role: 'writer' }))] })
    if (method === 'GET' && url.searchParams.get('alt') === 'media') return { status: 200, contentType: file.mimeType, body: file.bytes }
    if (method === 'GET') return json(this.view(file, email))
    let meta: Record<string, unknown> = {}
    const type = headers['content-type'] ?? ''
    if (type.startsWith('multipart/related')) {
      const boundary = type.split('boundary=')[1]!
      const parts = body!.toString('latin1').split(`--${boundary}`).slice(1, -1)
      const [metaPart, mediaPart] = parts.map((part) => part.slice(part.indexOf('\r\n\r\n') + 4, -2))
      meta = JSON.parse(metaPart!)
      file.bytes = Buffer.from(mediaPart!, 'latin1')
    } else if (body) {
      meta = JSON.parse(body.toString())
    }
    if (typeof meta.name === 'string') file.name = meta.name
    if (typeof meta.trashed === 'boolean') file.trashed = meta.trashed
    if (meta.appProperties) file.appProperties = { ...file.appProperties, ...(meta.appProperties as Record<string, string>) }
    const add = url.searchParams.get('addParents')
    if (add) file.parents = [add]
    return json(this.view(file, email))
  }

  byName(name: string) {
    return [...this.files.values()].find((file) => file.name === name && !file.trashed)
  }
}

function hash(bytes: Buffer) {
  let value = 2166136261
  for (const byte of bytes) value = Math.imul(value ^ byte, 16777619) >>> 0
  return value.toString(16)
}

/** Google, stubbed for one browser signed in as `email`. */
async function signInAs(context: BrowserContext, google: FakeGoogle, email: string) {
  await context.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `window.google = Object.assign(window.google || {}, { accounts: { oauth2: {
      initTokenClient(config) {
        const client = { callback: config.callback, error_callback: config.error_callback,
          requestAccessToken() { setTimeout(() => client.callback({ access_token: 'token-${email}', expires_in: 3600, scope: config.scope }), 0) } }
        return client
      },
      hasGrantedAllScopes() { return true },
    } } })`,
  }))
  // The Picker picks whatever it was asked to preselect.
  await context.route('https://apis.google.com/js/api.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `window.gapi = { load(name, done) {
      const picker = {
        ViewId: { DOCS: 'docs' }, Feature: { MULTISELECT_ENABLED: 'multi' },
        Action: { PICKED: 'picked', CANCEL: 'cancel' }, Response: { ACTION: 'action', DOCUMENTS: 'docs' }, Document: { ID: 'id' },
        DocsView: class { setMimeTypes() {} setIncludeFolders() {} setSelectFolderEnabled() {} setFileIds(ids) { window.__pickerIds = ids.split(',') } },
        PickerBuilder: class {
          setAppId() { return this } setOAuthToken() { return this } setDeveloperKey() { return this } addView() { return this }
          enableFeature() { return this } setTitle() { return this } setCallback(callback) { this.callback = callback; return this }
          build() { const callback = this.callback; return { setVisible() {
            const ids = window.__pickerIds || []
            Promise.all(ids.map((id) => fetch('https://www.googleapis.com/fake-picker/grant?id=' + id)))
              .then(() => callback({ action: 'picked', docs: ids.map((id) => ({ id })) }))
          } } }
        },
      }
      window.google = Object.assign(window.google || {}, { picker }); done()
    } }`,
  }))
  await context.route('https://www.googleapis.com/**', async (route) => {
    const request = route.request()
    const answer = await google.handle(email, request.method(), new URL(request.url()), await request.allHeaders(), request.postDataBuffer())
    await route.fulfill({ status: answer.status, contentType: answer.contentType, body: answer.body, headers: { 'Access-Control-Allow-Origin': '*' } })
  })
}

async function seedBank(page: Page, name: string, text: string) {
  await page.goto('/about')
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
  await page.evaluate(async ({ name, text }) => {
    const { createQuestionBankWorkspaceService } = (await import(
      /* @vite-ignore */ '/src/question-bank-workspaces.ts'
    )) as typeof import('../src/question-bank-workspaces')
    const banks = createQuestionBankWorkspaceService()
    const bank = await banks.create()
    await banks.commit(bank.id, { kind: 'rename', name })
    await banks.commit(bank.id, {
      kind: 'create-question',
      question: {
        id: crypto.randomUUID(),
        type: 'open',
        columns: 1,
        doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
      },
    })
  }, { name, text })
}

async function connectAndSync(page: Page) {
  await page.getByRole('button', { name: /^Sync with Drive/ }).click()
  await page.getByRole('button', { name: 'Connect Google Drive' }).click()
}

test('a teacher syncs one browser to Drive and brings it all down in another', async ({ browser }) => {
  test.setTimeout(120_000)
  const google = new FakeGoogle()

  const first = await browser.newContext()
  await signInAs(first, google, 'teacher@school.org')
  const page = await first.newPage()
  await seedBank(page, 'Fractions', 'What is one half of six?')
  await page.goto('/')
  await connectAndSync(page)
  await expect(page.getByRole('banner').getByRole('status')).toHaveText('Synced: 1 sent to Drive.', { timeout: 60_000 })
  const copy = google.byName('Fractions.pdf')!
  expect(copy.bytes.subarray(0, 5).toString()).toBe('%PDF-')
  expect(copy.bytes.toString('latin1')).toContain(`/open?drive=${copy.id}`)
  expect(google.byName('Test Parrot account backup.zip')).toBeTruthy()
  await expect(page.getByTestId('sync-dot')).toHaveCount(0)
  await first.close()

  // A second browser, same teacher: it syncs alongside, and the bank comes down.
  const second = await browser.newContext()
  await signInAs(second, google, 'teacher@school.org')
  const other = await second.newPage()
  await other.goto('/')
  await connectAndSync(other)
  await expect(other.getByText('Your Drive already has Test Parrot work from another computer.')).toBeVisible()
  await other.getByRole('button', { name: 'Sync this browser' }).click()
  await expect(other.getByRole('banner').getByRole('status')).toHaveText('Synced: 1 brought down.', { timeout: 60_000 })
  await other.goto('/')
  await other.getByText('Fractions', { exact: true }).first().dblclick()
  await expect(other.getByText('What is one half of six?')).toBeVisible()
  await second.close()

  // A third: Restore from Drive replaces this browser's account with the backup.
  const third = await browser.newContext()
  await signInAs(third, google, 'teacher@school.org')
  const restoring = await third.newPage()
  await restoring.goto('/')
  await connectAndSync(restoring)
  await restoring.getByRole('button', { name: 'Use the work in Drive' }).click()
  await expect(restoring.getByText('Fractions', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
  // Disconnect stops syncing, and leaves the work and the Drive files alone.
  await restoring.goto('/settings')
  await restoring.getByRole('button', { name: 'Disconnect' }).click()
  await expect(restoring.getByRole('button', { name: 'Connect Google Drive' })).toBeVisible()
  await restoring.goto('/')
  await expect(restoring.getByText('Fractions', { exact: true }).first()).toBeVisible()
  expect(google.byName('Fractions.pdf')).toBeTruthy()
  await third.close()
})

async function renameBank(page: Page, from: string, to: string) {
  await page.evaluate(async ({ from, to }) => {
    const { createQuestionBankWorkspaceService } = (await import(
      /* @vite-ignore */ '/src/question-bank-workspaces.ts'
    )) as typeof import('../src/question-bank-workspaces')
    const banks = createQuestionBankWorkspaceService()
    const bank = (await banks.recent()).find((candidate) => candidate.name === from)!
    await banks.commit(bank.id, { kind: 'update-provenance', provenance: { description: to } })
  }, { from, to })
}

test('a teammate opens a shared bank from its banner link, and settles a conflict with Keep both', async ({ browser }) => {
  test.setTimeout(120_000)
  const google = new FakeGoogle()
  const owner = await browser.newContext()
  await signInAs(owner, google, 'owner@school.org')
  const ownerPage = await owner.newPage()
  await seedBank(ownerPage, 'Fractions', 'What is one half of six?')
  await ownerPage.goto('/')
  await connectAndSync(ownerPage)
  await expect(ownerPage.getByRole('banner').getByRole('status')).toHaveText('Synced: 1 sent to Drive.', { timeout: 60_000 })
  const file = google.byName('Fractions.pdf')!
  google.share(file.id, 'mate@school.org')

  // The teammate follows the banner's link. drive.file cannot read the file
  // yet, so the Picker opens with it preselected, and picking it opens it.
  const mate = await browser.newContext()
  await signInAs(mate, google, 'mate@school.org')
  const matePage = await mate.newPage()
  await matePage.goto(`/open?drive=${file.id}`)
  await matePage.getByRole('button', { name: 'Open in Test Parrot' }).click()
  await expect(matePage.getByText('What is one half of six?')).toBeVisible({ timeout: 30_000 })

  // Both change it; the teammate's sync skips it and offers the choice.
  await renameBank(ownerPage, 'Fractions', 'Owner notes')
  await ownerPage.getByRole('button', { name: /^Sync with Drive/ }).click()
  await expect(ownerPage.getByRole('banner').getByRole('status')).toHaveText('Synced: 1 sent to Drive.', { timeout: 60_000 })
  await renameBank(matePage, 'Fractions', 'Teammate notes')
  await matePage.goto('/')
  await matePage.getByRole('button', { name: /^Sync with Drive/ }).click()
  const conflict = matePage.getByRole('group', { name: 'Fractions' })
  await expect(conflict).toBeVisible({ timeout: 60_000 })
  await conflict.getByRole('button', { name: 'Keep both' }).click()
  await expect(conflict).toHaveCount(0, { timeout: 60_000 })
  await expect(matePage.getByText('Fractions (your copy)', { exact: true }).first()).toBeVisible()
  expect(google.byName('Fractions (your copy).pdf')).toBeTruthy()
  await owner.close()
  await mate.close()
})
