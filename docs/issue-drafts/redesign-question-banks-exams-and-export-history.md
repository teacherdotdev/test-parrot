# Redesign Question Banks, mutable Exams, and per-Exam Export History

<!-- Intended GitHub label: ready-for-agent -->

## Problem Statement

Test Parrot currently treats one Question Bank and one Exam Draft as a paired authoring state, and turns exports into deduplicated, immutable, adjective–noun Versions. That model does not match how teachers organize or revisit their work.

Teachers need Question Banks and Exams to be independent reusable resources. One Exam may draw from several Question Banks, and one Question Bank may contribute Questions to several Exams. A teacher should be able to open a bank, browse or edit it without creating an Exam, place several banks beside an Exam as tabs, and compose with live references to canonical Questions.

Teachers also expect an Exam to behave like a mutable document. Save should update it, while Save As should continue the current work under a separate Exam. Exporting is a different intention: it should record exactly what was produced without freezing the editable Exam, manufacturing a Version name, deduplicating matching output, or forcing the current Working Copy to be saved.

The current storage, history, navigation, and terminology encode the rejected model. They cannot represent multiple Exams, multiple Question Banks, independent Working Copies, per-Exam workspace tabs, or event-oriented Export History without a fresh normalized generation.

## Solution

Make Question Banks and Exams first-class, independent resources with a many-to-many usage relationship through live Question references. Each Question belongs to exactly one Question Bank. Each Exam has a stable UUID, an explicitly saved state, and one continuously backed-up Working Copy. New Exams are named **Untitled Exam**; Save updates the Exam, and Save As atomically moves the current Working Copy into a new Exam named `<current name> Copy` while restoring the source Exam to its saved state.

Add a Home screen centered on editable resources: horizontally scrolling **Recent Exams** and **Recently Updated Question Banks** sections, each with New and View all actions. Full Exam and Question Bank collection screens provide search. Opening either resource enters the same `/editor` screen through one-time launch parameters. Question Banks appear as tabs on the left; the active Exam, when present, appears on the right. Opening a bank alone creates no Exam. Adding the first Question from bank-only mode creates an Untitled Exam.

Replace immutable Versions and Version History with per-Exam Export Records and Export History. Export snapshots the visible Working Copy without saving it. Every successful normal or historical export creates a distinct immutable, undeletable Export Record attached to the Exam UUID. Each record retains only the exact format and Content Selection produced, its complete recorded question presentation, its resolved Layout Plans, and references to content-addressed Media Assets. Historical records can be viewed and exactly re-exported, but never restored into or used to create an Exam.

Start a fresh IndexedDB generation for multiple Question Banks, multiple Exams, Working Copies, editor workspace state, Export Records, Layout Plans, and Media Assets. Ignore rather than migrate or delete previous browser storage generations.

## User Stories

1. As a teacher, I want Question Banks and Exams to be separate resources, so that neither resource is artificially owned by the other.
2. As a teacher, I want one Exam to use Questions from several Question Banks, so that I can combine material from different units or sources.
3. As a teacher, I want one Question Bank to contribute to several Exams, so that I can reuse canonical Questions without copying them.
4. As a teacher, I want each Question to have one canonical Question Bank, so that I always know where shared Question Content is maintained.
5. As a teacher, I want Exams to reference current canonical Questions, so that correcting a Question updates every Exam that uses it.
6. As a teacher, I want shared Question edits to leave Exam save state and recency alone, so that a bank correction does not pretend I edited dozens of Exams.
7. As a teacher, I want a Question editor to show how many Exams use the Question, so that I understand the reach of a shared edit.
8. As a teacher, I want compact Question Bank rows to stay focused on composition rather than global usage, so that the bank remains easy to scan.
9. As a teacher, I want Question Bank cards to show how many Exams use the bank, so that I can discover reuse from the resource-management surface.
10. As a teacher, I want to inspect the Exams using a Question Bank, so that I can understand its current role before changing or deleting it.
11. As a teacher, I want Question Type fixed when a Question is created, so that a shared edit cannot unexpectedly move Questions between sections in many Exams.
12. As a teacher, I want Question Metadata to organize and find Questions without affecting output, so that Difficulty and Topics remain authoring aids.
13. As a teacher, I want to create Questions only inside an active Question Bank, so that every Question has an explicit canonical owner.
14. As a teacher, I want adding a newly created Question to an Exam to be a separate action, so that Question creation does not silently alter an Exam.
15. As a teacher, I want Duplicate to create a new Question in the original Question Bank, so that the copy has a clear canonical home.
16. As a teacher, I want one Question identity to occur at most once in an Exam, so that repeated use requires an intentional duplicate with independent identity.
17. As a teacher, I want manual Replace to accept any unused Question in the same Question Section, so that my explicit choice is not blocked by metadata.
18. As a teacher, I want automatic replacement by equivalence removed, so that the product does not infer interchangeability for me.
19. As a teacher, I want Replace to preserve the outgoing position and answer-column layout, so that the structure I chose remains stable.
20. As a teacher, I want a replacement to begin with the incoming Question's authored answer order, so that old answer arrangements do not leak between Questions.
21. As a teacher, I want an inserted Multiple Choice Question to inherit the column layout immediately above it, so that nearby layout remains consistent.
22. As a teacher, I want the first Multiple Choice Question to inherit the layout below it when one exists, so that insertion at the top behaves consistently.
23. As a teacher, I want an empty Multiple Choice section to begin at one column, so that arbitrary rich answers get a safe explicit layout.
24. As a teacher, I want only one-, two-, and four-column layouts, so that output never depends on an automatic column-selection rule.
25. As a teacher, I want answer order and answer-column layout owned by the Exam, so that different Exams can present the same canonical Question differently.
26. As a teacher, I want wording, formatting, correctness, and answer wording edits to preserve Exam answer order when choice identities are stable, so that compatible bank edits do not destroy arrangement.
27. As a teacher, I want adding or removing answer choices to reset each referencing Exam to complete authored answer order, so that the system never invents a hybrid arrangement.
28. As a teacher, I want removing a Question from an Exam to clear that reference's answer order and column layout, so that re-adding it starts as a fresh composition action.
29. As a teacher, I want Add, manual Replace, Remove, reorder, Duplicate, question shuffle, answer shuffle, and column formatting to remain available, so that the useful composition workflow survives the redesign.
30. As a teacher, I want Vary actions to remain ordinary undoable Exam edits, so that export does not compose or randomize my paper.
31. As a teacher, I want Question Bank changes to save immediately after confirmation, so that banks do not introduce another document-level Save workflow.
32. As a teacher, I want a failed Question save to leave the editor open and all visible shared content unchanged, so that partial propagation cannot occur.
33. As a teacher, I want ordinary shared Question edits to avoid repetitive confirmation prompts, so that the intended live-reference benefit remains usable.
34. As a teacher, I want Question editing through an Exam to update the Question's owning bank, so that there is still one canonical record.
35. As a teacher, I want editing a Question through an Exam to leave my active Question Bank tab unchanged, so that my browsing context is not disrupted.
36. As a teacher, I want a new Exam to receive a stable UUID and the name Untitled Exam, so that it is a normal Exam rather than a separate Draft resource.
37. As a teacher, I want a blank New Exam to be persisted immediately, so that it has a saved baseline for Working Copy behavior.
38. As a teacher, I want an untouched, empty Untitled Exam with no history to disappear when abandoned, so that placeholders do not clutter Home.
39. As a teacher, I want an unsaved rename or other meaningful change to preserve an otherwise empty Exam, so that backed-up work is never silently discarded.
40. As a teacher, I want Question Bank tabs alone not to preserve an empty Untitled Exam, so that navigation state does not create meaningless resources.
41. As a teacher, I want the application to sweep abandoned pristine Exams on startup, so that a crash or closed tab does not leave placeholders behind.
42. As a teacher, I want every Exam to have one explicitly saved state and one backed-up Working Copy, so that Save remains meaningful without risking refresh loss.
43. As a teacher, I want the status bar to distinguish Saved, Unsaved changes backed up locally, Backing up, and Backup failed, so that I understand both intent and durability.
44. As a teacher, I want Save to replace the saved Exam with the exact visible Working Copy, so that saved state is explicit.
45. As a keyboard user, I want Cmd/Ctrl+S to Save and suppress the browser Save Page action, so that document saving follows familiar controls.
46. As a teacher, I want Save to preserve Undo history, so that I can undo afterward and knowingly return to an unsaved state.
47. As a teacher, I want Save As available for both clean and changed Exams, so that it also covers intentional copying.
48. As a teacher, I want Save As to create a new Exam named by appending Copy, so that it requires no naming ceremony.
49. As a teacher, I want duplicate Exam names allowed, so that naming rules do not block ordinary work.
50. As a teacher, I want Save As to move my current Working Copy and Undo history to the new Exam, so that I continue exactly where I was working.
51. As a teacher, I want Save As to restore the source Exam to its saved state and clear its Undo history, so that the same unsaved changes do not remain on both Exams.
52. As a teacher, I want Save As to be atomic, so that failure leaves the source Exam and Working Copy unchanged.
53. As a teacher, I want Discard changes to restore saved Exam composition while retaining latest live Question Content, so that discard does not roll shared Questions backward.
54. As a teacher, I want Discard to retain Export History and Question Bank tabs, so that it affects only Exam content and presentation state.
55. As a teacher, I want Discard to clear Undo and Redo, so that discarded changes cannot reappear through stale history.
56. As a teacher, I want Working Copies to survive refresh while Undo history remains session-only, so that recovery does not require a durable command log.
57. As a teacher, I want separate Undo histories per Exam, so that Undo in one Exam cannot change another.
58. As a teacher, I want normal navigation to avoid unsaved-change prompts after backup succeeds, so that switching resources is frictionless.
59. As a teacher, I want a warning when backup is pending or failed, so that I do not leave while current changes may be lost.
60. As a teacher, I want stale pending backup writes prevented from overwriting a newer Save, so that completion order cannot corrupt state.
61. As a teacher, I want no Exam deletion action, so that durable Exams and their attached Export History remain stable.
62. As a teacher, I want a Home screen with Recent Exams, so that I can resume work quickly.
63. As a teacher, I want Recent Exams ordered by when I last opened them, so that the row reflects my recent navigation.
64. As a teacher, I want Exam cards to show the Working Copy preview, name, last-opened time, Question count, and unsaved status, so that the card matches what will open.
65. As a teacher, I want a searchable All Exams collection, so that permanent Exams remain discoverable beyond the recent row.
66. As a teacher, I want a Home section for Recently Updated Question Banks, so that actively maintained content is easy to reopen.
67. As a teacher, I want bank cards to show name, Question count, representative Topics, usage count, and updated time, so that I can identify useful banks quickly.
68. As a teacher, I want bank recency updated by creation, rename, and Question creation, duplication, editing, or deletion, so that it reflects substantive bank changes.
69. As a teacher, I want opening, filtering, Exam composition, and export not to update bank recency, so that the timestamp remains meaningful.
70. As a teacher, I want a searchable All Question Banks collection, so that banks beyond the preview row remain discoverable.
71. As a new teacher, I want Home to create no default resources, so that I begin with clear New Exam and New Question Bank choices.
72. As a teacher, I want one editor screen for bank-focused and Exam-focused work, so that moving between them does not feel like entering different products.
73. As a teacher, I want Home launches to use one-time exam, bank, or new parameters, so that links can express initial intent without making URL state authoritative.
74. As a teacher, I want the editor URL normalized to `/editor` after launch, so that later in-editor navigation and refresh use persisted workspace state.
75. As a teacher, I want bare `/editor` and refresh to restore my latest workspace from IndexedDB, so that I return to where I left off.
76. As a teacher, I want browser Back to move between product screens rather than replay every resource switch, so that browser navigation stays understandable.
77. As a teacher, I want opening an Exam from Home or a collection to restore its remembered Question Bank tabs, so that its editing context returns.
78. As a teacher, I want opening a Question Bank from Home to enter bank-only mode, so that I can browse or edit the bank without creating an Exam.
79. As a teacher, I want the first Add or drop from bank-only mode to create an Untitled Exam atomically, so that composition begins without a separate setup dialog.
80. As a teacher, I want opening an Exam inside the editor to keep the currently visible bank tabs, so that switching documents does not disrupt my current palette.
81. As a teacher, I want those carried tabs to become the target Exam's remembered workspace, so that later external reopening reflects what I last used with it.
82. As a teacher, I want opening an additional bank inside the editor to add or focus its tab, so that I can mix banks without returning Home.
83. As a teacher, I want no in-editor action that abandons an active Exam for bank-only mode, so that this state exists only through a clear external bank launch.
84. As a teacher, I want each bank tab to remember independent search and filter values, so that research in one bank does not overwrite another.
85. As a teacher, I want bank tabs, active bank, filters, pane layout, and similar navigation excluded from Exam Save and Export, so that workspace state is not document content.
86. As a teacher, I want missing launch resources reported and the last valid workspace restored, so that stale URLs do not create accidental Exams.
87. As a teacher, I want refresh recovery supported without promising synchronized concurrent browser tabs, so that the initial local-first scope remains bounded.
88. As a teacher, I want Export to snapshot the visible Working Copy without saving it, so that saving and producing output remain separate intentions.
89. As a teacher, I want an unsaved Exam rename to appear in the artifact and Export Record, so that output matches the visible document.
90. As a teacher, I want every successful export to create a distinct Export Record, so that Export History records actual output events.
91. As a teacher, I want identical repeated exports to remain separate records, so that history does not collapse separate events into one Version.
92. As a teacher, I want each Export Record attached to the durable Exam UUID, so that renaming the Exam does not break its history.
93. As a teacher, I want each Export Record to retain the Exam name visible at export time, so that historical output remains honest after a rename.
94. As a teacher, I want an Export Record to retain only the format and Content Selection actually produced, so that history describes the event rather than a hidden package.
95. As a teacher, I want test-only, key-only, and combined output supported, so that I can produce the artifact I need.
96. As a teacher, I want PDF and Student Test + Answer Key to be the normal defaults, so that the common complete package requires no setup.
97. As a teacher, I want normal export preferences remembered globally without dirtying an Exam, so that output controls remain convenient but non-authoring.
98. As a teacher, I want an empty Exam blocked from export, so that history does not contain empty output.
99. As a teacher, I want unresolved required media to block export and identify affected Questions, so that recorded output stays reproducible.
100. As a teacher, I want a Multiple Choice Question without a correct answer to remain exportable with a blank key entry, so that incomplete keys do not block output.
101. As a teacher, I want missing Difficulty or Topics never to block export, so that organizational metadata stays optional.
102. As a teacher, I want Export blocked while Working Copy backup is unhealthy, so that an artifact cannot exist without its promised durable association and history.
103. As a teacher, I want the final Export action to capture one resolved state and lock the editor while preparing, so that the preview and artifact cannot drift.
104. As a teacher, I want a stale preview refreshed when referenced Questions change, so that Export cannot quietly produce old live content.
105. As a teacher, I want the complete artifact prepared before its Export Record commits, so that failed packaging creates no phantom history.
106. As a teacher, I want Export Record and required Media Asset persistence atomic, so that history is never missing required content.
107. As a teacher, I want download to begin only after history commits, so that I never receive output absent from Export History.
108. As a teacher, I want browser download cancellation not to roll back a committed Export Record, so that unknowable browser behavior cannot rewrite history.
109. As a teacher, I want normal filenames to use the Exam name and selected extension, so that downloads remain familiar.
110. As a teacher, I want Export History within its Exam, so that output history remains attached to the document that produced it.
111. As a teacher, I want Export Records listed newest first with captured name, time, format, Content Selection, and Question count, so that repeated events remain distinguishable.
112. As a teacher, I want to view an Export Record through its stored Layout Plans, so that current Questions and current layout code cannot alter it.
113. As a teacher, I want historical view limited to Back to Exam and fixed-format Re-export, so that immutable output cannot become an editing surface.
114. As a teacher, I want historical re-export to keep the recorded format and Content Selection, so that re-export means reproducing the same output.
115. As a teacher, I want historical re-export to create a new Export Record, so that every produced artifact remains represented.
116. As a teacher, I want historical re-export to remain on the historical view after success, so that the operation does not disturb my Working Copy.
117. As a teacher, I want exact historical output to preserve recorded semantics, media, page assignment, and topology without requiring identical package bytes, so that reproducibility is meaningful across package generation.
118. As a teacher, I want historical records unable to create or restore Exams, so that Export History remains observational.
119. As a teacher, I want Cmd/Ctrl+P to open normal Export for the active non-empty Exam, so that native browser Print cannot bypass clean preview and history.
120. As a teacher, I want historical re-export to remain an explicit record action rather than a print shortcut, so that the shortcut always refers to current work.
121. As a teacher, I want permanently deleting a used Question to list every affected Exam, so that I understand the destructive scope.
122. As a teacher, I want confirmed Question deletion to remove it atomically from its bank, every saved Exam, and every Working Copy, so that no dangling references remain.
123. As a teacher, I want Question deletion to preserve unrelated unsaved Exam changes, so that a shared destructive action does not erase other work.
124. As a teacher, I want an unused Question to use a lighter irreversible confirmation, so that safety reflects actual impact.
125. As a teacher, I want Question deletion available from the full Question editor rather than compact bank rows, so that destructive action has enough context.
126. As a teacher, I want Question Bank deletion to show Question count, affected Exams, and per-Exam impact, so that a cascade is explicit.
127. As a teacher, I want deleting a bank to remove all its Questions from current Exams while preserving Export Records, so that editable state and historical output remain distinct.
128. As a teacher, I want empty-bank deletion to use lightweight but irreversible confirmation, so that no-impact cleanup stays simple.
129. As a teacher, I want bank deletion available from Home and All Question Banks rather than the composition pane, so that resource management stays in resource-management surfaces.
130. As a teacher, I want failed destructive transactions to change nothing, so that cross-resource operations never partially commit.
131. As a teacher, I want destructive deletion to clear affected selection, editor, drag, and Undo state after commit, so that no stale interaction can revive deleted data.
132. As a teacher, I want an empty named Question Bank retained after its final Question is deleted, so that intentional organizational resources do not disappear.
133. As a teacher, I want only pristine empty Untitled Question Banks cleaned up automatically, so that abandoned placeholders do not clutter Home.
134. As a teacher, I want content-addressed Media Assets shared and deduplicated, so that reusable Questions and historical output do not duplicate image bytes unnecessarily.
135. As a teacher, I want media garbage-collected only when no current or historical resource references it, so that exact history never loses an image.
136. As a teacher, I want a fresh IndexedDB generation for the redesign, so that the new model is not burdened by unreliable migration from rejected structures.
137. As a teacher, I want old browser storage ignored rather than actively deleted, so that cutover does not require compatibility cleanup.
138. As a teacher, I want meaningful Exams, Question Banks, Working Copies, workspaces, Export Records, Layout Plans, and Media Assets stored in IndexedDB, so that refresh restores the local-first product.
139. As a teacher, I want localStorage excluded from authoring persistence, so that one durable storage boundary owns coherent state.
140. As a teacher, I want persistent browser storage requested after my first meaningful resource is committed, so that authored work receives the strongest available local durability.
141. As a teacher, I want pristine placeholders not to trigger a storage request, so that an abandoned click does not prompt for durability.
142. As a teacher, I want Home to explain that data is saved in this browser and important work should be exported or backed up, so that local durability is not mistaken for cloud archival.
143. As a teacher, I want persistent-storage denial explained without blocking ordinary local work, so that I understand the weaker durability condition.
144. As a teacher, I want the print-reference, PDF, and DOCX paths to consume the same Export Document and Layout Plan, so that formats cannot reconstruct different Exams.
145. As a teacher, I want export parity checked by semantic content, page assignment, and structural topology, so that output formats preserve the same paper.

## Implementation Decisions

- Replace the one-Question-Bank/one-Exam-Draft aggregate with independent Question Bank, Question, Exam, Working Copy, Workspace, Export Record, Layout Plan, and Media Asset records.
- Give every Question Bank, Question, Exam, and Export Record a stable UUID. Each Question stores exactly one owning Question Bank ID. Exams store live Question IDs plus Exam-specific order and presentation state.
- Model Question Bank-to-Exam usage as a derived many-to-many relationship through the Questions referenced by saved Exam state or its Working Copy. Do not persist a second authoritative attachment list.
- Keep each Question identity unique within one Exam. Duplicate creates a new Question and new choice identities in the original bank.
- Persist Question Bank changes immediately after confirmation. There is no bank-level Working Copy or Save command.
- Commit shared Question edits before publishing them to visible Exam projections. A failed commit keeps the Question editor state available and leaves canonical and projected state unchanged.
- Keep Question Type immutable after creation.
- Preserve Exam answer arrangement when the complete stable choice-ID set is unchanged. Adding or removing choice IDs clears that Question's answer arrangement in every saved Exam and Working Copy so authored order applies.
- Keep answer order and answer-column layout in Exam state. Supported layouts are exactly one, two, and four columns.
- For insertion, inherit the Multiple Choice visual neighbor's column layout: immediately above, or immediately below when inserted first; use one column when the section has no neighbor.
- For Replace, retain the outgoing reference's fixed position and column layout while using the incoming Question's authored answer order.
- For Duplicate within an Exam, create a new canonical Question in the source bank, insert it after the original, and initially preserve the visible answer order and column layout with fresh identities.
- Remove automatic replacement by Equivalent Questions and remove direct Question creation from the Exam. Questions are authored in the active Question Bank and added separately.
- Give every Exam an explicitly saved state and exactly one continuously backed-up Working Copy. The Working Copy owns the visible name, Question references, question order, answer order, column layout, and other Exam-level presentation settings.
- Create new Exams with a blank saved state and the name Untitled Exam. Create one immediately for New Exam; from bank-only mode, create one atomically with the first Add or drop.
- Automatically delete only an Exam whose saved state and Working Copy both equal the pristine blank Untitled Exam and which has no Export Records. Recheck this predicate when leaving and during startup cleanup.
- Save replaces saved Exam state with the latest in-memory Working Copy, superseding older pending backup writes. Save does not clear Undo.
- Save As is one atomic operation. It creates and saves a new UUID named by appending Copy to the visible name, moves the Working Copy and session Undo history to it, restores the source to saved state with cleared history, copies the current workspace, and switches the editor. Duplicate names are valid.
- Discard restores saved Exam state, retains latest canonical Questions and Export History, leaves workspace tabs unchanged, and clears Undo/Redo.
- Maintain session-only Undo/Redo histories per Exam. Refresh preserves Working Copies but clears command history. Exam Undo never edits canonical Questions.
- Expose Saved, Unsaved changes backed up locally, Backing up, and Backup failed states. Warn during navigation or close only while backup is pending or failed.
- Keep Exams undeletable except for automatic pristine-placeholder cleanup. Keep Export Records undeletable.
- Use a separate IndexedDB Workspace boundary for active Exam, open Question Bank tabs, active tab, per-tab filters, pane state, and the latest active editor workspace. Workspace changes do not dirty, Save, Discard, or Export an Exam.
- Use Home, All Exams, All Question Banks, Editor, About, and Privacy as distinct screens. Use `/editor?new=1`, `/editor?exam=<uuid>`, and `/editor?bank=<uuid>` as one-time launch intents, consume them with history replacement, and restore bare `/editor` from IndexedDB.
- Launching an Exam outside the editor restores its remembered tabs. Launching a bank enters bank-only mode. Opening an Exam inside the editor carries currently visible tabs into the target Exam rather than restoring or merging its prior tabs.
- Do not offer an in-editor command to abandon an active Exam for bank-only mode. Opening another bank while editing adds or focuses a tab.
- Report missing launch resources, consume the invalid intent, and restore the last valid workspace rather than creating a resource.
- Treat concurrent editor browser tabs as unsupported. Serialize writes or use durable revision checks so stale completions cannot overwrite newer state; cross-tab live synchronization is outside scope.
- Organize Home around Recent Exams and Recently Updated Question Banks. Add searchable All Exams and All Question Banks screens.
- Order Recent Exams by last opened. Order Question Banks by substantive updates: creation, rename, or Question creation, duplication, editing, or deletion. Opening, filtering, Exam composition, and export do not update bank recency.
- Show Exam Working Copy previews and unsaved status on Exam cards. Show Question count, representative Topics, usage count, and last-updated time on bank cards.
- Show individual Question usage in the full Question editor and destructive confirmations, but not compact bank rows. Let Home/collection usage views open an Exam through the ordinary external editor launch.
- Keep Export Fingerprint as parity/comparison vocabulary only; it no longer identifies or deduplicates a domain resource.
- Remove Version, Version History, Exam Draft, Question Revision, Question Reconciliation, and Use as Draft as current domain entities and workflows.
- Every normal or historical export creates a distinct immutable Export Record attached to the durable Exam UUID. Never deduplicate matching events or assign adjective–noun names.
- Store only the actual format and Content Selection, visible Working Copy name, complete question presentation, and resolved Layout Plans for one event. Share only content-addressed Media Assets.
- Default normal export to PDF and Student Test + Answer Key. Keep normal format and Content Selection as global preferences outside Exam state.
- Block export for an empty Exam, unresolved required media, or unhealthy Working Copy backup. Permit missing correctness with a blank key entry and permit missing Question Metadata.
- At final submission, capture the latest resolved Working Copy, refresh stale preview if a referenced Question changed, and lock the editor through preparation.
- Prepare the complete artifact before atomically committing the Export Record and required Media Assets, then initiate browser download. Preparation or persistence failure creates neither record nor download; browser cancellation after commit does not roll history back.
- Use `<Exam name>.pdf` and `<Exam name>.docx` filenames. Capture an unsaved visible name without saving it to the Exam.
- Historical view consumes only stored record state. It offers Back to Exam and fixed-format re-export with no format or Content Selection controls. Re-export creates another record under the same Exam and preserves the captured historical name.
- Route Cmd/Ctrl+P to normal Export for the active non-empty Exam. Keep historical re-export explicit. Continue suppressing native browser Print as a product path.
- Preserve the shared Export Document and Layout Plan architecture across print-reference, PDF, and DOCX Export Adapters. Export Records store resolved plans so historical output never invokes the current layout engine.
- Make Question and Question Bank deletion atomic across canonical records, saved Exams, Working Copies, and relevant workspace records. Commit before closing UI or propagating visible changes; failure leaves everything unchanged.
- Offer permanent Question deletion from the full Question editor. Use lightweight confirmation when unused and affected-Exam review when used. Do not add committed shared edits or deletion to Exam Undo.
- Offer bank deletion from Home and All Question Banks, not the editor pane. Show full cascade impact for populated banks and lighter irreversible confirmation for empty banks. Close related editors and tabs only after commit.
- Keep affected Exams even if deletion empties them. Export Records remain untouched.
- Store immutable media bytes by content hash. Garbage-collect an asset only when no Question, saved Exam, Working Copy, or Export Record references it.
- Request persistent browser storage after the first meaningful Exam or Question Bank state commits, not for pristine placeholders. Treat denial as weaker durability and explain it on Home.
- Start with a fresh IndexedDB generation. Ignore rather than migrate or actively delete previous localStorage, IndexedDB, and Cache Storage generations. Do not use localStorage for new authoring persistence.

## Testing Decisions

- Prefer four existing high seams rather than testing new private helpers: the application authoring boundary, the real IndexedDB adapter, the browser workflow, and the existing export-preparation/parity boundary.
- At the application authoring boundary, test complete observable state transitions for multiple banks and Exams: live references, Save, Save As, Discard, per-Exam Working Copies, per-Exam Undo, insertion inheritance, Replace, Duplicate, shared choice-set changes, placeholder cleanup, and atomic deletion results.
- Keep this application boundary broad enough that React components call semantic operations rather than assembling multi-resource transactions themselves. Tests should assert resulting Exams, banks, Working Copies, workspaces, and histories—not helper calls or object-spread details.
- At the real IndexedDB adapter seam, test fresh-generation startup, normalized multi-resource reads and writes, write serialization/revision protection, Save As atomicity, shared Question propagation, cascade aborts, placeholder cleanup, Export Record transactions, Media Asset retention, persistent-storage outcomes, and recovery after reload.
- Use real browser IndexedDB in adapter integration tests rather than mocking request order. Assert all-or-nothing durable outcomes after reopening the database.
- At the browser seam, test user-visible Home, collection, routing, editor tabs, focus, keyboard, Save state, composition, deletion, Export, and Export History workflows. Assertions should name visible resources and resulting content rather than component state, CSS geometry alone, or generated IDs.
- Extend the existing Question Bank browser coverage as prior art for creating/editing Questions, searchable/filterable bank rows, Add/Remove, and persistence. Add multiple banks and verify independent filters and tabs.
- Extend the existing drag/drop and workspace tests as prior art for Insert, Replace, empty-section targets, same-section reordering, no cross-bank drag, and one-step Undo.
- Extend the existing answer-column coverage as prior art for neighbor inheritance, Replace inheritance, Duplicate, Remove/re-add reset, and bulk 1/2/4-column formatting.
- Extend the existing store tests as prior art for atomic semantic actions, saved-versus-working state, dirty/no-op behavior, Undo/Redo, and live Question projection. Remove equivalence-replacement coverage and add cross-Exam propagation and cascade cases.
- Replace current historical reconciliation tests with assertions that Export History is view-only and offers no path to create, restore, or modify an Exam.
- Replace Version reuse assertions with event assertions: every normal and historical export appends one record, including identical output, while leaving saved Exam state unchanged.
- At the export-preparation boundary, test that one event retains only selected content, captures the visible Working Copy name and exact question presentation, validates empty/media/backup conditions, and never uses metadata or a fingerprint to deduplicate history.
- Retain Export Document and Layout Plan suites as prior art for semantic derivation, page packing, grids, headers, footers, answer keys, blank correctness, links, images, and explicit breaks.
- Retain adapter parity suites for print-reference, PDF, and DOCX. Assert equivalent semantics, page assignment, and topology rather than package bytes, coordinates, renderer wrapping, or raster identity.
- Run the documented heavyweight export comparison because this redesign changes export preparation, persisted Layout Plans, historical re-export, and both product Export Adapters.
- Browser coverage should include:
  - first-use empty Home;
  - recent and full collections;
  - ordering by Exam open and bank update;
  - one-time launch parameter consumption and refresh restoration;
  - bank-only entry without Exam creation;
  - first-drop Exam creation and pristine cleanup;
  - external versus internal Exam opening tab behavior;
  - Save, Save As, Discard, status announcements, and shortcuts;
  - navigation with healthy, pending, and failed backup;
  - canonical Question propagation without Exam dirtying;
  - stable and changed choice-set behavior;
  - usage visibility in allowed surfaces and absence from compact rows;
  - lightweight and cascading deletion confirmation, transaction failure, focus recovery, and post-commit tab/editor cleanup;
  - normal Export of unsaved Working Copy state;
  - fixed historical re-export and a newly appended record;
  - no historical editing/restoration controls;
  - Cmd/Ctrl+P routing and native-print suppression;
  - persistent-storage messaging.
- A good test proves behavior visible at a domain or user boundary: resource membership, saved/working state, output history, durable transaction result, restored workspace, accessible announcement, or artifact semantics. Avoid assertions about React state, private helper names, IndexedDB request ordering, random draw counts, generated UUID values, raw OOXML, or pixel coordinates unless geometry itself is the user-visible contract.
- Validate with the standard unit suite, browser end-to-end suite, build, lint, and heavyweight export comparison.

## Out of Scope

- A formal Exam family or parent project grouping related Exams.
- A formal Version entity, adjective–noun Version naming, fingerprint-based Version identity, or deduplication of matching exports.
- Restoring, editing, or creating an Exam from an Export Record.
- Question Reconciliation or stale historical Question workflows.
- Automatic Replace with Equivalent Questions.
- Creating a Question directly from an Exam.
- Moving Questions between Question Banks.
- Dragging Questions from one bank tab into another.
- Allowing the same Question identity to appear more than once in one Exam.
- Changing Question Type after creation.
- Automatic answer-column layout.
- A new Vary toolbar or export-time randomization.
- Multiple simultaneously visible Question Bank panes; the first UI uses tabs.
- A command to leave an active Exam for bank-only mode from inside the editor.
- A global Recent Exports feed or global Export History screen.
- Deleting Exams or Export Records, aside from automatic cleanup of a pristine empty Untitled Exam.
- Undoing committed shared Question edits or destructive deletion through Exam Undo.
- Persisting Undo/Redo history across refresh.
- Synchronized concurrent browser tabs, collaborative editing, multiple teachers, or conflict resolution.
- Accounts, cloud sync, remote backup, cross-device workspace restoration, or compliance-grade archival durability.
- Migrating or deleting data from prior browser storage generations.
- Changing output format or Content Selection during historical re-export.
- Byte-identical historical packages, renderer-specific line wrapping, coordinate identity, font identity, or raster parity.
- Native browser Print or Save as PDF as a product output path.

## Further Notes

- This specification supersedes the current one-bank/one-Exam-Draft and immutable-Version product model. The accepted redesign decisions are recorded in ADR-0011 through ADR-0017; older conflicting ADRs are marked superseded.
- The term **Version** may still appear informally in an Exam name chosen by a teacher, but it is not a domain object. Current vocabulary is Question Bank, Question, Exam, Working Copy, Export Record, and Export History.
- Export Fingerprint remains useful for cross-adapter testing and diagnostics, not for domain identity or history deduplication.
- The existing implementation documentation should be updated together with implementation so that it continues to describe running code rather than this future state.
- The intended issue label is `ready-for-agent`, but this draft has not been published to GitHub.
