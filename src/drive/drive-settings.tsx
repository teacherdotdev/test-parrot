import { Cloud, CloudDownload, LogOut } from 'lucide-react'
import { useDriveSync } from './drive-sync-context'
import { PRIVACY_NOTE } from './sync-button'

/** Settings' Google Drive card: the Drive Connection, Restore from Drive and
 *  Disconnect, which the header's Sync panel leaves out (ADR-0052). */
export function DriveSettings() {
  const drive = useDriveSync()
  if (!drive?.configured) return null
  const { state, busy } = drive
  return (
    <section className="site-card account-settings" aria-labelledby="settings-drive">
      <h2 id="settings-drive">Google Drive</h2>
      {!drive.connected ? (
        <>
          <p>Sync your Exams and Question Banks with your own Google Drive, to use them on another computer or share them with colleagues.</p>
          <div className="account-actions">
            <button type="button" className="primary-button account-action" disabled={busy !== null} onClick={() => void drive.connect()}>
              <Cloud aria-hidden="true" />
              {busy === 'connecting' ? 'Connecting…' : 'Connect Google Drive'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>Synced with <strong>{state.account!.email}</strong>.</p>
          <h3>Restore from Drive</h3>
          <p>
            Every sync also saves a full backup of this browser in your Drive’s Test Parrot folder. Restoring replaces
            everything in this browser with that backup, as it was at your last sync: use it on a new computer, or to
            undo what happened here since. Anything this browser hasn’t synced is lost.
          </p>
          <div className="account-actions">
            <button type="button" className="secondary-button account-action" disabled={busy !== null} onClick={() => {
              if (window.confirm('Replace everything in this browser with the backup from your last sync? Anything this browser hasn’t synced is lost.')) void drive.restoreFromDrive()
            }}>
              <CloudDownload aria-hidden="true" />
              {busy === 'restoring' ? 'Restoring…' : 'Restore from Drive'}
            </button>
          </div>
          <h3>Disconnect</h3>
          <p>Stops syncing. Your work in this browser and your files in Drive stay as they are.</p>
          <div className="account-actions">
            <button type="button" className="secondary-button account-action" disabled={busy !== null} onClick={() => drive.disconnect()}>
              <LogOut aria-hidden="true" />
              Disconnect
            </button>
          </div>
        </>
      )}
      {drive.error && <p className="account-warning" role="alert">{drive.error}</p>}
      <p className="sync-privacy">{PRIVACY_NOTE}</p>
    </section>
  )
}
