export type PersistentStorageStatus =
  'granted' | 'denied' | 'not-requested' | 'unavailable'

const DENIED_KEY = 'test-parrot:persistent-storage-denied'
let requestInThisSession: Promise<'granted' | 'denied'> | null = null

export async function persistentStorageStatus(): Promise<PersistentStorageStatus> {
  if (!navigator.storage?.persisted) return 'unavailable'
  try {
    if (await navigator.storage.persisted()) return 'granted'
  } catch {
    return 'unavailable'
  }
  return localStorage.getItem(DENIED_KEY) === 'true'
    ? 'denied'
    : 'not-requested'
}

/** Ask only after meaningful work exists. Repeated calls are harmless: once
 * granted browsers report that state without prompting again. */
export function requestPersistentStorage(): Promise<
  'granted' | 'denied' | 'unavailable'
> {
  if (typeof localStorage === 'undefined') return Promise.resolve('unavailable')
  if (localStorage.getItem(DENIED_KEY) === 'true')
    return Promise.resolve('denied')
  if (!navigator.storage?.persist) return Promise.resolve('unavailable')
  if (requestInThisSession) return requestInThisSession
  requestInThisSession = (async () => {
    try {
      if (await navigator.storage.persisted?.()) {
        localStorage.removeItem(DENIED_KEY)
        return 'granted'
      }
      const granted = await navigator.storage.persist()
      if (granted) localStorage.removeItem(DENIED_KEY)
      else localStorage.setItem(DENIED_KEY, 'true')
      return granted ? 'granted' : 'denied'
    } catch {
      localStorage.setItem(DENIED_KEY, 'true')
      return 'denied'
    }
  })()
  return requestInThisSession
}
