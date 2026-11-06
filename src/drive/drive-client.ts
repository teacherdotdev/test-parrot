// What Sync with Drive needs from a cloud drive (ADR-0052), small enough that
// the sync logic is tested against a fake and another provider (OneDrive) is
// another implementation of it. Nothing here knows about Google.

export const FOLDER_MIME = 'application/vnd.google-apps.folder'
export const PDF_MIME = 'application/pdf'
export const ZIP_MIME = 'application/zip'

/** What a Test Parrot file in Drive is, read from its app properties. */
export type DriveKind = 'root' | 'folder' | 'bank' | 'exam' | 'backup'

/** The app properties every Test Parrot file carries: ids and revision
 *  information only, each pair well under Drive's 124-byte limit. The
 *  content itself is the package inside the PDF. */
export type TestParrotProperties = {
  /** Marks a file as Test Parrot's, so one query finds them all. */
  tpApp: '1'
  tpKind: DriveKind
  /** The local id of the Resource or Folder it holds. */
  tpId?: string
  /** The Resource's last modified time when it was sent, for matching a
   *  restored browser's Resources to their Drive Copies. */
  tpMod?: string
}

export type DriveFile = {
  id: string
  name: string
  mimeType: string
  parents: string[]
  /** Changes when, and only when, the file's content does. */
  md5Checksum?: string
  trashed: boolean
  ownedByMe: boolean
  /** Whether this account may replace the file's content. */
  canEdit: boolean
  /** The owner's email, when it is someone else. */
  owner?: string
  appProperties: Partial<TestParrotProperties> & Record<string, string>
}

export type DriveChange = {
  name?: string
  /** Moves the file into this one folder. */
  parent?: string
  appProperties?: Record<string, string>
  trashed?: boolean
}

export type DriveAccount = { email: string; name?: string }

export interface DriveClient {
  account(): Promise<DriveAccount>
  /** Every Test Parrot file and folder this app can see, out of trash. */
  list(): Promise<DriveFile[]>
  /** One file, trashed or not; null once it is gone or out of reach. */
  get(id: string): Promise<DriveFile | null>
  /** Creates an empty file or a folder; `parent` null means My Drive. */
  create(file: { name: string; parent: string | null; mimeType: string; appProperties: Record<string, string> }): Promise<DriveFile>
  /** Replaces a file's content, and changes its metadata alongside. */
  upload(id: string, bytes: Uint8Array, mimeType: string, change?: DriveChange): Promise<DriveFile>
  update(id: string, change: DriveChange): Promise<DriveFile>
  download(id: string): Promise<Uint8Array>
  /** How many people other than the owner the file is shared with. */
  sharedWith(id: string): Promise<number>
}

/** A refusal Drive gave, with its HTTP status. */
export class DriveError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'DriveError'
  }
}
