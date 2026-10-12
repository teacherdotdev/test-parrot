/** Where a teacher reaches a person: for help, and for what Test Parrot
 *  should read that it does not yet. */
export const SUPPORT_EMAIL = 'support@teacher.dev'

/** What an email about an import opens with: the file is what shows what
 *  went wrong, so the teacher is asked for it before writing anything. */
const ATTACH_YOUR_FILE =
  'Please attach the PDF or file you tried to import, so we can see what went wrong.\n\nWhat happened:\n'

/** A link that starts an email to support about one thing. An import's
 *  email asks for the file itself. */
export const supportMailto = (subject: string, { askForFile = false } = {}) =>
  `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}` +
  (askForFile ? `&body=${encodeURIComponent(ATTACH_YOUR_FILE)}` : '')
