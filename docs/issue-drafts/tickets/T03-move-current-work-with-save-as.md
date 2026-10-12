# T03: Move current work into a new Exam with Save As

## What to build

Add Save As as the one intentional Exam-copying workflow. It works for clean or changed Exams, creates a separate Exam named by appending **Copy**, and moves the visible Working Copy and editing session into that new Exam while returning the source Exam to its last saved state.

## Acceptance criteria

- [ ] Save As is available for clean and changed Exams and does not require unique names or an additional naming dialog.
- [ ] The new Exam receives a new durable UUID and the visible name with ` Copy` appended, including repeated `Copy` suffixes when used repeatedly.
- [ ] The exact visible Working Copy becomes the new Exam's explicitly saved initial state, including Question references, order, answer order, and column layout.
- [ ] The current session's Undo/Redo history moves to the new Exam, so Undo can make the new Exam unsaved relative to its initial saved state.
- [ ] The source Exam returns to its prior saved state and its Undo/Redo history is cleared.
- [ ] The current editor switches to the new Exam and copies the visible Question Bank workspace into that Exam's workspace.
- [ ] Source Export History remains attached only to the source Exam, and the new Exam begins without Export Records.
- [ ] Canonical Questions are still live references; Save As does not duplicate Question Content.
- [ ] The entire operation is one IndexedDB transaction. Failure leaves the source Exam, its Working Copy, workspace, and active editor unchanged and creates no new Exam.
- [ ] Home immediately exposes both independent Exams and reopening either shows its correct state.
- [ ] Store, IndexedDB, browser, keyboard, failure, and Undo tests cover clean and dirty Save As behavior.

## Blocked by

- T02 — Save, discard, and recover each Exam Working Copy.
