// Google Picker: how a teacher hands Test Parrot a Drive file it cannot see
// yet under `drive.file` (ADR-0052). Picking a file grants the app that one
// file. Picking a folder is not documented to grant what is inside it, so the
// Picker offers files, several at once.

import { googleApiKey, googleClientId, loadScript, requestDriveToken } from './google-auth'

const GAPI_SRC = 'https://apis.google.com/js/api.js'

/** The Cloud project number the Picker grants files to: the number that
 *  starts the OAuth client ID, unless `VITE_GOOGLE_APP_ID` says otherwise. */
export function pickerAppId(): string {
  const configured = (import.meta.env.VITE_GOOGLE_APP_ID as string | undefined)?.trim()
  return configured || googleClientId().split('-')[0] || ''
}

type PickerNamespace = {
  DocsView: new (viewId?: unknown) => {
    setMimeTypes(types: string): unknown
    setIncludeFolders(include: boolean): unknown
    setSelectFolderEnabled(enabled: boolean): unknown
    setFileIds?(ids: string): unknown
    setMode?(mode: unknown): unknown
  }
  ViewId: { DOCS: unknown }
  DocsViewMode?: { LIST: unknown }
  Feature: { MULTISELECT_ENABLED: unknown; SUPPORT_DRIVES?: unknown }
  Action: { PICKED: string; CANCEL: string }
  Response: { ACTION: string; DOCUMENTS: string }
  Document: { ID: string }
  PickerBuilder: new () => PickerBuilder
}
type PickerBuilder = {
  setAppId(id: string): PickerBuilder
  setOAuthToken(token: string): PickerBuilder
  setDeveloperKey(key: string): PickerBuilder
  addView(view: unknown): PickerBuilder
  enableFeature(feature: unknown): PickerBuilder
  setTitle(title: string): PickerBuilder
  setCallback(callback: (data: Record<string, unknown>) => void): PickerBuilder
  build(): { setVisible(visible: boolean): void }
}

async function pickerNamespace(): Promise<PickerNamespace> {
  await loadScript(GAPI_SRC)
  await new Promise<void>((resolve) => window.gapi!.load('picker', () => resolve()))
  return (window.google as unknown as { picker: PickerNamespace }).picker
}

/**
 * Shows the Picker and resolves with the ids of the files picked, or an empty
 * list when the teacher cancels. `fileIds` preselects files: the one a
 * teammate's banner link names.
 */
export async function pickDriveFiles(options: { fileIds?: string[]; multiple?: boolean; title?: string } = {}): Promise<string[]> {
  const token = await requestDriveToken()
  const picker = await pickerNamespace()
  const view = new picker.DocsView(picker.ViewId.DOCS)
  view.setMimeTypes('application/pdf')
  view.setIncludeFolders(true)
  view.setSelectFolderEnabled(false)
  if (options.fileIds?.length) view.setFileIds?.(options.fileIds.join(','))
  return new Promise<string[]>((resolve) => {
    let builder = new picker.PickerBuilder()
      .setAppId(pickerAppId())
      .setOAuthToken(token)
      .addView(view)
      .setTitle(options.title ?? 'Choose Test Parrot files from Google Drive')
      .setCallback((data) => {
        const action = data[picker.Response.ACTION]
        if (action === picker.Action.PICKED) {
          const documents = (data[picker.Response.DOCUMENTS] as Record<string, string>[] | undefined) ?? []
          resolve(documents.map((document) => document[picker.Document.ID]!).filter(Boolean))
        } else if (action === picker.Action.CANCEL) {
          resolve([])
        }
      })
    if (googleApiKey()) builder = builder.setDeveloperKey(googleApiKey())
    if (options.multiple !== false) builder = builder.enableFeature(picker.Feature.MULTISELECT_ENABLED)
    if (picker.Feature.SUPPORT_DRIVES) builder = builder.enableFeature(picker.Feature.SUPPORT_DRIVES)
    builder.build().setVisible(true)
  })
}
