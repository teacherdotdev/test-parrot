/**
 * Whether this device has been through the front door. Set the moment the
 * onboarding page is reached, so a teacher who chose a blank Exam and then
 * went Home finds Home there — not the pitch again. A device with work on it
 * counts as welcomed whether or not it ever saw the page.
 */
const WELCOMED_KEY = 'test-parrot:welcomed'

export function hasBeenWelcomed(): boolean {
  try {
    return localStorage.getItem(WELCOMED_KEY) === 'true'
  } catch {
    return false
  }
}

export function markWelcomed(): void {
  try {
    localStorage.setItem(WELCOMED_KEY, 'true')
  } catch {
    // Without storage every visit is a first visit, which is at least honest.
  }
}
