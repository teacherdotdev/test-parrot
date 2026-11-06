// Signing in to Google from the browser alone (ADR-0052): Google Identity
// Services' token model, the `drive.file` scope and nothing else. A token
// lasts about an hour and is kept only in memory; asking for one must happen
// inside the click that needs it, so Google's popup shows only when it has
// to ask for consent or a sign-in.

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const GIS_SRC = 'https://accounts.google.com/gsi/client'

export function googleClientId(): string {
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? ''
}

export function googleApiKey(): string {
  return (import.meta.env.VITE_GOOGLE_API_KEY as string | undefined)?.trim() ?? ''
}

/** Without a client ID every Drive feature is hidden. */
export function driveConfigured(): boolean {
  return googleClientId() !== ''
}

type TokenResponse = { access_token?: string; expires_in?: number | string; error?: string; error_description?: string; scope?: string }
type TokenClient = {
  callback: (response: TokenResponse) => void
  error_callback?: (error: { type?: string; message?: string }) => void
  requestAccessToken: (options?: { prompt?: string; login_hint?: string }) => void
}
type GoogleAccounts = {
  oauth2: {
    initTokenClient: (config: {
      client_id: string
      scope: string
      callback: (response: TokenResponse) => void
      error_callback?: (error: { type?: string; message?: string }) => void
    }) => TokenClient
    hasGrantedAllScopes?: (response: TokenResponse, scope: string) => boolean
    revoke?: (token: string, done?: () => void) => void
  }
}
declare global {
  interface Window { google?: { accounts?: GoogleAccounts; picker?: unknown }; gapi?: { load: (name: string, done: () => void) => void } }
}

const scripts = new Map<string, Promise<void>>()
export function loadScript(src: string): Promise<void> {
  let loading = scripts.get(src)
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = src
      script.async = true
      script.onload = () => resolve()
      script.onerror = () => { scripts.delete(src); reject(new DriveAuthError('offline', 'Google could not be reached. Check your connection and try again.')) }
      document.head.append(script)
    })
    scripts.set(src, loading)
  }
  return loading
}

/** Loads Google's sign-in script ahead of the click, so the click itself
 *  can open the popup straight away. */
export function preloadGoogle(): void {
  if (driveConfigured()) void loadScript(GIS_SRC).catch(() => undefined)
}

export type AuthProblem = 'blocked-by-admin' | 'denied' | 'popup' | 'scope' | 'offline' | 'other'

export class DriveAuthError extends Error {
  constructor(readonly problem: AuthProblem, message: string) {
    super(message)
    this.name = 'DriveAuthError'
  }
}

/** What to tell the teacher, in plain words. */
export function authProblemMessage(problem: AuthProblem): string {
  switch (problem) {
    case 'blocked-by-admin':
      return 'Your school’s Google account doesn’t allow Test Parrot yet. Your school’s Google admin needs to allow Test Parrot (as a third-party app with access to Google Drive) before you can sync. Everything still works in this browser.'
    case 'denied':
      return 'Google Drive wasn’t connected, because access wasn’t allowed. Nothing was changed.'
    case 'scope':
      return 'Test Parrot needs permission to see the files it makes in your Drive. Try again and leave that box ticked.'
    case 'popup':
      return 'The Google sign-in window didn’t open, or was closed. Allow pop-ups for this site and try again.'
    case 'offline':
      return 'Google could not be reached. Check your connection and try again.'
    default:
      return 'Google sign-in didn’t finish. Try again.'
  }
}

export function problemOf(error: string | undefined, description = ''): AuthProblem {
  const text = `${error ?? ''} ${description}`.toLowerCase()
  if (text.includes('admin_policy_enforced') || text.includes('org_internal') || text.includes('admin') || text.includes('policy')) return 'blocked-by-admin'
  if (text.includes('access_denied')) return 'denied'
  if (text.includes('popup')) return 'popup'
  return 'other'
}

// The token is kept for its hour in this browser's storage, so a new tab (a
// Drive Copy's banner link, say) or a reload does not ask Google again. Its
// key is outside the `test-parrot:` keys an Account Backup carries.
const TOKEN_KEY = 'drive-sync-token'
type Token = { value: string; expiresAt: number }
let token: Token | null = null
let client: TokenClient | null = null

function storedToken(): Token | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY)
    return raw ? JSON.parse(raw) as Token : null
  } catch {
    return null
  }
}

function keepToken(next: Token | null) {
  token = next
  try {
    if (next) localStorage.setItem(TOKEN_KEY, JSON.stringify(next))
    else localStorage.removeItem(TOKEN_KEY)
  } catch { /* storage unavailable: memory only */ }
}

export function cachedToken(now = Date.now()): string | null {
  token ??= storedToken()
  return token && token.expiresAt - 60_000 > now ? token.value : null
}

export function forgetToken(): void {
  keepToken(null)
}

/**
 * A Drive token. Call from the click that needs it: with a token still good
 * it answers at once; otherwise it asks Google, which shows its popup only
 * when it needs the teacher.
 */
export async function requestDriveToken(options: { loginHint?: string; consent?: boolean } = {}): Promise<string> {
  const cached = cachedToken()
  if (cached && !options.consent) return cached
  await loadScript(GIS_SRC)
  const accounts = window.google?.accounts
  if (!accounts) throw new DriveAuthError('offline', authProblemMessage('offline'))
  return new Promise<string>((resolve, reject) => {
    const callback = (response: TokenResponse) => {
      if (response.error || !response.access_token) {
        const problem = problemOf(response.error, response.error_description)
        reject(new DriveAuthError(problem, authProblemMessage(problem)))
        return
      }
      if (accounts.oauth2.hasGrantedAllScopes && !accounts.oauth2.hasGrantedAllScopes(response, DRIVE_SCOPE)) {
        reject(new DriveAuthError('scope', authProblemMessage('scope')))
        return
      }
      keepToken({ value: response.access_token, expiresAt: Date.now() + Number(response.expires_in ?? 3600) * 1000 })
      resolve(response.access_token)
    }
    const errorCallback = (error: { type?: string; message?: string }) => {
      const problem: AuthProblem = error.type?.startsWith('popup') ? 'popup' : problemOf(error.type, error.message)
      reject(new DriveAuthError(problem, authProblemMessage(problem)))
    }
    client ??= accounts.oauth2.initTokenClient({ client_id: googleClientId(), scope: DRIVE_SCOPE, callback, error_callback: errorCallback })
    client.callback = callback
    client.error_callback = errorCallback
    client.requestAccessToken({
      prompt: options.consent ? 'consent' : '',
      ...(options.loginHint ? { login_hint: options.loginHint } : {}),
    })
  })
}

/** Disconnect: forget the token here. The grant is not revoked, because
 *  revoking it could also take away the files a teammate handed over, and
 *  Disconnect leaves Drive as it is. */
export function disconnectGoogle(): void {
  keepToken(null)
  client = null
}
