# Handoff: the editor refactor

A working document for the next agent picking up the Test Parrot editor
conversation. Updated 2026-09-10 on branch `crepe-editor`, after the refactor
below was built. Everything in "What shipped" landed together in the editor
refactor; the user verifies in the browser and has said not to run Playwright
on their behalf.

---

## 1. How to use this

Read `CONTEXT.md` first (the glossary — use its terms, not synonyms), then
`docs/adr/0013-use-launch-parameters-to-enter-one-restorable-editor.md`, then
this. Run `bun test`, `npx tsc -b` and `npx eslint src scripts`; keep e2e
selectors in `scripts/*.e2e.ts` in step with any copy you change, but do not
run Playwright.

The user brain-dumps feedback in bursts and expects work to continue through
them rather than stopping to confirm each item.

---

## 2. The decision this settled

The editor is an **Exam editor**. The user reversed the earlier "split it down
the middle, half bank half exam" position:

> I have gone back on it. I think this should be an exam editor... it's just
> literally too confusing to have two different things editing at the same
> time. We should de-emphasize the question banks and emphasize the editor...
> the big thing to make sure we're consistent on is that when you open a
> question bank, it does not open the exam editor by default.

So there is no bank mode, no `bank-only` workspace, and no `editorMode` flag.
`docs/adr/0013` was amended in place to say all of this; `docs/adr/0011`'s one
"bank-only workspace" clause was corrected too.

---

## 3. What shipped

### Two screens, not two modes

| Screen | Route | Component |
| --- | --- | --- |
| Exam editor | `/editor` (one-time `?exam=` / `?new=`) | `ExamEditor` in `src/App.tsx` |
| Question Bank page | `/question-bank?id=<uuid>` — a durable address, not consumed | `QuestionBankPage` in `src/App.tsx` |

`QuestionBankEditor` is gone. `main.tsx` no longer has a bank branch: `/editor`
restores the last Exam or bounces to `/`.

### `QuestionBankWorkspace` is the shared piece

`src/App.tsx` now has three components where it had two:

- **`QuestionBankWorkspace`** — one bank, open and editable: `QuestionBankPane`
  plus the create / edit / delete / share-PDF dialogs. Knows nothing about
  where it is shown. Mount it with `key={bank.id}`.
- **`QuestionBankTabsPane`** — the tab strip, and one `QuestionBankWorkspace`
  under it. Only the Exam editor mounts this.
- **`QuestionBankPage`** — the bank full screen inside `AppShell`, with
  breadcrumbs Home / Question Banks / *name*, an editable name, "Changes save
  immediately" and Bank details in the top bar, and no tabs and no Exam
  composition at all.

### The editor is an application frame

`.editor-shell` is `height: 100vh; overflow: hidden`, and
`.editor-shell > .authoring-workspace` uses `grid-template-rows: minmax(0, 1fr)`.
**That row template is load-bearing**: with the implicit `auto` row the grid
grows to its tallest pane, overflows the clipped shell, and both panes scroll
partway and then stop. Only `.editor-output` (the Exam's lane) scrolls; the
document bar and the bank pane hold still, and the bank pane is no longer
`position: sticky`, which used to drift a pixel or two at either end.

### Layout and chrome

- **Panes flipped**: Exam left, Question Bank right. `--bank-column` is now
  measured back from the right edge — see `resizeTo` in `workspace-split.tsx`
  and the flipped arrow-key direction.
- **The Exam's name is in the document bar**, top left, Google Docs style, and
  *also* still on the page's title line: one value (`store.setTitle`), two
  places. The bar's field is `aria-label="Exam name"`; the page's is
  `aria-label="Title printed on the exam"`, deliberately not a substring of the
  first so `getByRole('textbox', { name: 'Exam name' })` stays unambiguous.
  The page field sizes to its content (mirrored `::after` + `size={1}`) so the
  hover underline hugs the typed name instead of running the width of the sheet.
- **The bank is a window**: Chrome's model. `--bank-chrome` strip, active tab
  painted in `--paper-surface` and overlapping the window's top border by 1px
  (the overlap lives on `.bank-tabs-bar`, *not* on the active tab — inside the
  horizontally scrolling `.bank-tabs` it produced a second, vertical scrollbar).
  `:has(.bank-tab:first-child[data-active])` squares the window's top-left
  corner. Open Question Bank is a `+` after the last tab.
- **The bank toolbar is sticky** (`.question-bank-toolbar`) and its rule is
  drawn only once `data-scrolled` is set, so there is no line when there is
  nothing above it.
- **Working Copy status is a mark, not a sentence** (`WorkingCopyStatus`). Four
  sentences of different widths in a wrapping flex row reflowed the whole bar on
  every keystroke. The text survives in the tooltip and in an `sr-only`
  `role="status"` span that keeps `aria-label="Working Copy status"`, so the
  existing e2e assertions still read it.
- **Correct answers** are a green underlined choice with a green letter, drawn
  in colour and `text-decoration` only, so choice-grid geometry is untouched.
  `.choice-correctness-marker` survives as the screen-reader text — keep the
  class, `scripts/export-dialog.e2e.ts` asserts it never reaches an export.

### Persistence was re-keyed

`BankWorkspaceContext` is now `{ examId: string }`; `tabsKey` is always
`exam:<id>`; `EditorWorkspace.mode` is `'exam'` and nothing else.
`resumeBankWorkspace` is gone, and `open` / `create` / `import` no longer write
a `'bank-only'` tabs record or claim the active editor. Stored `exam:<id>` keys
are unchanged, so existing tab workspaces survive; a stored `mode: 'bank'`
editor record simply fails to restore and `/editor` goes Home.

---

## 4. Still open

1. **`src/App.tsx` is still ~2400 lines.** The extraction of
   `QuestionBankWorkspace` was the natural seam; `ExamEditor` is the next one
   and has not been touched.
2. **The Question Bank page is deliberately basic** — the user asked for that
   ("keep it basic for now"). It has no Bank-level Export History, no
   multi-select, no move-between-banks.
3. **`carryWorkspace` still exists** for Exam → Exam tab carrying, which ADR
   0013 still describes. It is no longer the mode-boundary shim it was.
4. **Playwright has not been run.** `scripts/question-bank-tabs.e2e.ts` was
   rewritten around the Exam editor and gained two Question Bank page tests;
   `question-deletion`, `question-bank-export`, `question-bank-import` and
   `multiple-question-banks` had their bank addresses and expectations updated.

---

## 5. Conventions

- Domain terms are capitalised as `CONTEXT.md` defines them (Exam, Question
  Bank, Working Copy, Export Record). The user writes them lowercase in chat;
  the repo does not.
- Comments explain *why*, at the altitude of the surrounding file.
- `docs/agents/domain.md`: surface ADR conflicts explicitly, never silently
  override.
- Do **not** disturb the export path. If a change touches the Export Document,
  Layout Plan, either Export Adapter, pagination, print styling, or supported
  document-node rendering, read `docs/export-testing.md` first.
