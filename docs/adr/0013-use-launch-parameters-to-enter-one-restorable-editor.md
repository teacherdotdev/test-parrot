---
status: accepted
---

# Use launch parameters to enter one restorable editor

The editor is an Exam editor. `/editor` opens one Exam beside the Question Banks it composes from, with the Exam in the left lane and the banks as tabs in a resizable right pane; the Exam's name is typed in the document bar and on the page's own title line, which are the same field. There is no bank-only editor mode.

The home screen launches `/editor` with a one-time `exam` or `new` query parameter rather than using different routes for the same interface. The editor consumes that intent, stores the active Exam and its Question Bank tab workspace in IndexedDB, and replaces the URL with bare `/editor`; refresh restores the last active Exam from IndexedDB, while browser Back navigates between product screens rather than replaying editor selections. Opening an Exam from within the editor changes only the active Exam, carries the currently visible bank tabs into that Exam's workspace, and does not merge its previously remembered tabs. Tab state is keyed by Exam and by nothing else. Filters are remembered independently per bank tab, and dragging Questions between banks is not supported. Workspace state remains separate from Exam content, so tab changes do not affect Save, unsaved status, or Export. Concurrent editor tabs are unsupported for now.

A Question Bank is a destination rather than a launch intent. `/question-bank?id=<uuid>` is a durable address that opens that bank full screen in the dashboard chrome, reached by breadcrumb from the Question Bank collection, and reload and Back both find the same bank. It offers the same list, filters and Question editor the editor's pane offers, and no Exam composition at all: opening a bank creates no Exam, and no gesture on the page creates one.
