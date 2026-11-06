---
status: accepted
---

# Sync with Drive from the browser, file by file, skipping conflicts

Teachers keep asking for two things Test Parrot cannot do while everything lives in one browser: their work on another device, and a Question Bank shared with colleagues. We have also told a teacher that Drive sync is coming. Test Parrot's promise is that a teacher's work stays on their device and that we sign no data agreements, so whatever we build must run in the browser and talk only to the teacher's own Google Drive. There is no Test Parrot backend.

## Decisions

**The browser is the working copy; Drive holds the synced copy.** The storage button in the header becomes Sync with Drive ("Sync"). One click syncs every Resource both ways: changed only here, it goes up; changed only in Drive (a teammate, or the teacher's other browser), it comes down; changed in both since this browser last synced it, it is a conflict. Sync never runs on its own. A yellow dot on the button says it is time: an unsynced change more than a day old, or a connected browser that has never synced.

**Authorization uses Google Identity Services' token model** (`google.accounts.oauth2.initTokenClient`) with the `drive.file` scope only, and no backend. A token lasts about an hour, and the request has to run inside the Sync click, so Google shows a popup only when it needs consent or a sign-in. The client ID comes from `VITE_GOOGLE_CLIENT_ID`, and the Picker's API key from `VITE_GOOGLE_API_KEY`. Without a client ID every Drive feature is hidden and the app is exactly what it was. One Google account per browser; Disconnect stops syncing and touches neither the browser's work nor Drive. A school whose Workspace admin blocks third-party apps gets a plain explanation that the admin must allow Test Parrot.

**What Drive holds.** A "Test Parrot" folder in My Drive, with the Library's Folders mirrored as subfolders and one PDF per Resource, its Drive Copy: a Question Bank's Question Bank File, or an Exam's student test followed by its answer key with its Test Parrot Package attached (the existing Exam PDF export). The attached package is the authoritative content; `appProperties` carry only ids and revision information for lookup (each key and value pair is limited to 124 bytes). Beside the files sits one Account Backup, replaced on every sync, so a new browser can Restore from Drive with Export History and preferences that packages do not carry. Page 1 of every Drive Copy, and of no PDF exported for students, opens with an "Open in Test Parrot" banner linking to `/open?drive=<fileId>`; files are therefore created first and filled second, to learn their id.

**Drive Copies keep identity.** An exported PDF's package numbers its Questions and answers by position, as the record formats require. A Drive Copy carries the same package plus a small identity map in the package zip (`drive.json`), from each package-local id to the Question's and answer's stable local id. Any importer that does not know it ignores it. Sync uses it to update a bank in place and to let an incoming Exam link to the Questions of a bank this browser already holds as a Drive Copy; otherwise that Exam's Questions arrive as the Exam's own bank, as an import does.

**Trash is mirrored when the teacher syncs.** A Resource the teacher owns sends its Drive Copy to Drive's trash, for everyone it is shared with, and the warning says how many people that is. A Shared Resource someone else owns only leaves this teacher's Library.

**Sharing is Drive's own.** A Shared Resource stays one live Drive file that every teammate syncs. A teammate brings one in with Add from Google Drive (Google Picker), or by following the banner: `drive.file` cannot read a file until the teacher hands it to Test Parrot, so the banner's link opens the Picker with that file preselected.

**Conflicts are skipped and offered, never merged.** A file changed on both sides is left alone during the sync and listed afterwards with two choices: Use theirs replaces the browser's copy; Keep both keeps the browser's version as a new Resource, "<name> (your copy)", uploaded as a new file, and then takes theirs.

## Considered options

**`drive.file` versus full `drive`.** Full `drive` (or `drive.readonly`) would let Test Parrot see a shared folder's contents and any file a teacher has access to without the Picker. It is a restricted scope: Google requires a security assessment for it, and it would give a web page every file in a teacher's Drive, which contradicts what we promise. `drive.file` is non-sensitive and limits Test Parrot to files it made or the teacher handed it. The cost is a Picker step whenever a teammate's file is new to a browser.

**A browser working copy with explicit sync versus live sync.** Live sync would mean background polling, Drive's change feed, a token that must be refreshed without a click (GIS's token model cannot do that silently), and conflicts arriving mid-edit. A Sync button keeps every Drive call inside a click the teacher made, keeps the app fully usable offline and without Drive, and makes conflicts a list the teacher reads once. The cost is that work done on one device is not on another until both have synced; the dot nudges.

**"Skip and offer" versus merging.** A Question Bank or Exam could be merged Question by Question, but deciding what a removed Question or a reordered Exam means across two editors is guesswork, and a wrong merge silently loses a teacher's work. Skipping the file and offering Use theirs or Keep both never loses anything, and conflicts are rare among a few teachers sharing a bank.

## The open fact: does picking a folder grant its files?

We checked Google's documentation (the Picker overview, the desktop and mobile Picker guide, which documents `allow_folder_selection`, and "Choose Google Drive API scopes") on 2026-11-06. None of them says that selecting a folder in the Picker under `drive.file` grants access to the files inside it. The documentation describes `drive.file` purely per file ("files that you open with an app or that the user shares with an app"), and developer forum reports say access appears only after each file is picked. Because it is undocumented, we do not rely on it: **Add from Google Drive offers multi-select of files**, and a teammate picks the files of a shared folder rather than the folder.

## Consequences

- What a sync considers changed in the browser is a Resource's last modified time, compared with the one recorded when this browser last synced it; in Drive it is the file's content checksum. That bookkeeping is per browser and lives outside the account, so an Account Backup never carries it, and restoring one clears it. A restored browser matches its Resources to their Drive Copies by the ids in `appProperties`.
- An Exam's Drive Copy is its Working Copy: what the teacher sees. Bringing one down sets both its saved state and Working Copy, and keeps its Export History.
- An Exam's Drive Copy changes only when the Exam does. A change to a bank's Questions updates that bank's Drive Copy, not every Exam's; the Exam's PDF shows the Questions as they were when it was last sent.
- What the record formats cannot say, such as a Question's own default answer columns, does not travel between browsers, as with any import.
- An empty Question Bank or Exam has no Drive Copy until it has a Question, because neither file can be made empty.
- Registering Test Parrot in Drive's "Open with" menu is out of scope.
- A OneDrive provider may follow; the sync logic talks to Drive through a small interface, so another provider is another implementation of it.
