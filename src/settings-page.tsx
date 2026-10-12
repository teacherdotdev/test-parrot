import { BackupSettings } from './account-menu'
import { AppShell } from './app-shell'
import type { PersistentStorageStatus } from './durable-storage'

/** Where the teacher keeps a copy of their work: a backup file. */
export function SettingsPage({ persistentStorage }: { persistentStorage: PersistentStorageStatus }) {
  return (
    <AppShell
      crumbs={[{ label: 'Home', href: '/' }, { label: 'Settings' }]}
      persistentStorage={persistentStorage}
    >
      <div className="site-prose">
        <h1>Settings</h1>
        <p className="site-lede">Your work is saved in this browser. Keep a copy by exporting it.</p>
        <BackupSettings status={persistentStorage} />
      </div>
    </AppShell>
  )
}
