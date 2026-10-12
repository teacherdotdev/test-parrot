# Multi-Exam and Question Bank Redesign

This document summarizes the accepted multi-resource product behavior. Canonical vocabulary lives in [`CONTEXT.md`](../CONTEXT.md); architectural decisions live in [`docs/adr/`](adr/).

## Resource model

### Question Banks and Questions

- A Question Bank is an independently reusable, named resource.
- Each Question belongs to exactly one Question Bank.
- A Question Bank can contribute Questions to many Exams, and an Exam can reference Questions from many Question Banks.
- Exams hold live Question references. Confirmed Question edits therefore appear in every referencing Exam without making those Exams unsaved or recently opened.
- Question Banks save confirmed changes immediately; they have no Working Copy or bank-level Save action. The Question editor supports ordinary text Undo before Save, but a committed shared edit has no application-level Undo and must be edited back explicitly.
- A new bank is named **Untitled Question Bank**. A pristine empty placeholder is cleaned up when abandoned.
- Moving Questions between banks is future scope.

### Exams and Working Copies

- An Exam is mutable, has a durable UUID, and defaults to the name **Untitled Exam**. Its editable state is its Working Copy; exports do not create a separate Exam family.
- Every Exam has an explicitly saved state and one continuously backed-up Working Copy.
- **Save** replaces the saved state with the Working Copy.
- **Save As** atomically creates and saves a new Exam named `<current name> Copy`, moves the Working Copy and Undo history to it, restores the source Exam to its saved state, and clears the source history.
- Duplicate names are allowed. A single Exam name is used on Home, in the editor, on output pages, and in filenames.
- Exams cannot be deleted. The application may silently discard only an Exam whose saved state and Working Copy are both the same empty **Untitled Exam** and which has no Export Records.
- A pristine empty Exam is cleaned up when leaving it and by a startup sweep. A rename or any other Working Copy difference preserves it; Question Bank tabs alone do not.

### Export Records

- Export does not save the Exam. It snapshots the current Working Copy.
- Every successful export creates a separate immutable, undeletable Export Record attached to the Exam UUID, including repeated identical exports and historical re-exports.
- An Export Record stores only the format and Content Selection actually produced, plus the visible Exam name, complete question presentation, and resolved Layout Plans. Only content-addressed Media Assets are shared.
- Historical records are view-only and may only be exactly re-exported in their recorded format and Content Selection. They cannot create or modify Exams.
- Historical re-export creates another Export Record.
- Export History is available only through its owning Exam; there is no global recent-export row.

## Home and collections

Home contains two horizontal resume sections:

1. **Recent Exams**, ordered by when each Exam was last opened.
2. **Recently Updated Question Banks**, ordered by substantive bank updates.

Each has **New** and **View all** actions. `/exams` and `/question-banks` provide searchable full collections.

Exam cards show:

- the current Working Copy's first-page preview;
- Exam name;
- last-opened time;
- Question count;
- an **Unsaved changes** badge when applicable.

Question Bank cards show:

- bank name;
- Question count;
- representative Topics;
- **Used in N Exams**;
- last-updated time.

A bank is updated by creation, rename, or Question creation, duplication, editing, or deletion—including Question edits opened from an Exam. Opening, filtering, composing an Exam, or exporting does not update it.

Question usage appears on Home/collection surfaces, in the full Question editor, and in destructive confirmations. It does not appear on compact Question Bank rows in the editor.

## Entering and restoring the editor

The routes are:

```text
/                 Home
/exams            All Exams
/question-banks   All Question Banks
/editor           Editor
/about             About
/privacy           Privacy
```

Home and collection screens launch one editor with one-time query parameters:

```text
/editor?new=1
/editor?exam=<uuid>
/editor?bank=<uuid>
```

The editor consumes the parameter, persists the active workspace in IndexedDB, and replaces the URL with `/editor`. A bare `/editor` or refresh restores the latest workspace from IndexedDB. Browser Back moves between product screens rather than replaying editor selections.

- Launching an Exam from outside the editor restores its remembered Question Bank tabs.
- Launching a bank enters bank-only mode. Browsing banks creates no Exam; the first Add/drop creates a blank-saved Untitled Exam and a Working Copy containing the Question.
- Opening an Exam inside the editor keeps the currently visible bank tabs and makes them that Exam's new remembered workspace.
- There is no in-editor action to abandon an active Exam for bank-only mode.
- Opening banks inside the editor adds or focuses tabs.
- Tabs, active bank, per-tab search/filter state, pane layout, and similar navigation are workspace state. They do not dirty the Exam or affect Export.
- Concurrent editor tabs are unsupported for now.

## Authoring behavior

Retained actions:

- Add or insert a banked Question.
- Manual Replace with any unused Question in the same Question Section.
- Remove a Question from an Exam.
- Reorder Questions within their Question Sections.
- Duplicate a Question.
- Shuffle selected Question order.
- Shuffle selected Multiple Choice answer order.
- Set 1, 2, or 4 columns for selected Multiple Choice Questions.
- Undo and Redo Exam Working Copy actions.

Removed or deferred actions:

- automatic Replace with Equivalent Questions;
- creating a new Question directly from an Exam;
- creating an Exam from Export History;
- editing or restoring an Export Record;
- moving Questions between banks;
- dragging Questions between bank tabs;
- native browser Print.

Questions are created only in the active Question Bank and added to an Exam separately. One Question ID can occur at most once in an Exam. Duplicate creates a new Question in the original's bank and inserts it after the original.

Question Type is fixed at creation. A Question opened from the Exam uses the same canonical editor, identifies its owning bank, and shows **Used in N Exams** without changing the active bank tab.

Manual Replace keeps the outgoing position and answer-column setting and uses the incoming Question's authored answer order. An inserted Multiple Choice Question uses the column setting immediately above it in the Multiple Choice section, or below when inserted first; an empty section starts at 1 column. Remove clears the removed reference's answer order and column setting.

Stable choice IDs preserve Exam answer order across wording, formatting, correctness, and answer wording edits. Adding or removing choices resets every referencing Exam to complete authored answer order without dirtying those Exams.

## Save, recovery, and Undo

Editor status distinguishes:

- **Saved**;
- **Unsaved changes · backed up locally**;
- **Backing up…**;
- **Backup failed**.

Normal navigation does not prompt because Working Copies survive. Switching or closing warns only when the latest backup is pending or failed.

`Cmd/Ctrl+S` invokes Save. Save uses the latest in-memory Working Copy, supersedes older pending writes, and does not clear Undo. Undo after Save makes the Exam unsaved again.

Undo histories are session-only and separate per Exam. Save does not clear them. Save As moves the current history to the new Exam and clears the source history. Refresh clears Undo but retains Working Copies. Discard restores saved Exam state, keeps latest live Question Content and Export History, leaves bank tabs alone, and clears Undo/Redo. Exam Undo never modifies canonical Question Bank content. A committed shared Question edit must be edited back explicitly; permanent Question or bank deletion clears affected histories and cannot be undone.

## Shared edits and deletion

Confirmed Question edits commit before propagating across live Exam references. On persistence failure, the Question editor remains open and durable and visible state stays unchanged.

Ordinary edits need no propagation confirmation. Permanent deletion is available from the full Question editor, not compact bank rows:

- unused Questions receive lightweight irreversible confirmation;
- used Questions list all affected Exams before confirmation;
- successful deletion atomically removes the Question from its bank, every saved Exam, and every Working Copy while preserving unrelated changes and all Export Records.

Question Bank deletion is available from Home and the full bank collection, not the editor pane. A populated bank's confirmation shows Question count, affected Exam count, per-Exam impact, and that Export History remains unchanged. An empty bank receives lighter confirmation. Successful deletion atomically cascades through current Exams, closes related editors and tabs, and leaves historical output intact.

## Export behavior

Normal Export defaults to PDF and Student Test + Answer Key; normal-export preferences are global and do not dirty an Exam. Export is blocked for:

- an empty Exam;
- unresolved required media;
- pending or failed Working Copy backup.

Missing correctness, Difficulty, or Topics do not block export. A missing correct answer produces a blank key entry.

The final Export action captures the resolved Working Copy at that moment and locks the editor while preparing. If referenced Question state invalidates an earlier preview, the preview refreshes before export. The complete artifact is prepared first, then the Export Record and required media commit atomically, then browser download begins. Failure before commit creates neither record nor download; browser cancellation after commit does not roll history back.

Normal filenames are `<Exam name>.pdf` or `<Exam name>.docx`. An unsaved rename is captured in the artifact and Export Record without changing the saved Exam.

Historical view shows captured Exam name, timestamp, format, Content Selection, and Question count. Its only actions are **Back to Exam** and fixed-format **Re-export PDF/DOCX**. Exact re-export preserves recorded semantics, page assignment, and topology; package bytes and metadata may differ.

Cmd/Ctrl+P opens normal Export for the active, non-empty Exam and never invokes native browser Print. Historical re-export remains an explicit record action.

## Local durability

The redesign starts with an empty IndexedDB generation and ignores rather than migrates or deletes previous localStorage, IndexedDB, and Cache Storage generations.

IndexedDB stores Question Banks, Exams, Working Copies, workspace state, Export Records, Layout Plans, and content-addressed Media Assets. URL parameters carry launch intent only; localStorage is not the authoring persistence layer.

The application requests persistent browser storage after the first meaningful Exam or Question Bank state—not a disposable placeholder. Home explains that data is saved in this browser and should be exported or backed up externally, and warns when persistent storage is denied.

Media is garbage-collected only when no Question, saved Exam, Working Copy, or Export Record references it.
