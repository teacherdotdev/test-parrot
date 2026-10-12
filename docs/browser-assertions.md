# Browser assertions

Playwright tests should prove a user-visible outcome or a browser contract. A
test is strong when its setup names the state, its action uses the same control
the user has, and its assertion names the resulting behavior. Keep pure rules
in unit tests and use the browser for rendering, interaction, persistence, and
browser-only timing.

The difference is usually visible in a few lines:

```ts
// Strong: the user action and resulting state are both explicit.
await page.getByRole('button', { name: /^Add .* to the exam$/ }).click()
await expect(page.locator('.exam-question')).toHaveCount(1)

// Weak: a present box does not prove that the action worked.
expect(await page.locator('.exam-question').boundingBox()).toBeTruthy()
```

## Strong patterns

Use accessible roles and labels for controls, then assert the outcome at the
boundary the user can observe. For example,
`question-bank.e2e.ts:47-65` creates a question through the New question menu,
then checks both the Working Copy and the Question Bank's visible state. The test
does not depend on a React component name to perform the action.

Use relationships for geometry. `workspace-layout.e2e.ts:48-67` checks the
Question Bank share of the workspace and the sheet's fixed printable width
after moving the divider. Those values express product constraints. A geometry
test should also exercise the interaction that is supposed to change the
geometry.

Exercise the scroll container before asserting it. The sticky-bank regression
at `workspace-layout.e2e.ts:70-82` wheels over the Working Copy and checks page
scroll plus the bank's position. If bank scrolling is a separate behavior,
another test can seed enough rows to overflow the bank, wheel over the bank,
and check that the bank's `scrollTop` changes while the page scroll position
stays put. Checking only `scrollWidth > clientWidth`
(`workspace-layout.e2e.ts:112-124`) proves that overflow exists, not that a
user can scroll it.

Treat those as separate contracts when the product has both page scrolling and
bank scrolling: keep the draft/sticky regression small, then add an independent
long-bank test for the bank's own overflow behavior.

Wait for outcomes, not elapsed time. Playwright's web-first assertions retry
until the expected state is observable. Use `expect.poll` when the state lives
outside a locator, as in the scroll checks in
`workspace-layout.e2e.ts:76-77` or the image readiness check in
`pasted-images.e2e.ts:185-192`. A deliberate delayed response is useful for a
race regression, but the assertion must prove the eventual result; a sleep by
itself is not evidence.

Make a regression test red against the old behavior. Tie the fixture and
assertion to the defect's trigger, then verify that the changed behavior is
observable through the public boundary. The media cases in
`pasted-images.e2e.ts:225-280` are good examples: each has a distinct failure
mode and checks the visible unresolved or captured result.

Inspect persistence directly only when persistence is the contract. The media
deduplication check at `pasted-images.e2e.ts:195-223` opens IndexedDB to verify
one content-addressed asset. That is justified for storage identity, but a
rendering test should prefer the rendered result and reload behavior. Direct
database names, class names, and implementation attributes make broad tests
fragile.

## Weak assertions to avoid

Do not turn a visual preference into a blocking product requirement. Exact
colors, shadows, cursor values, and pixel coordinates belong in a browser test
only when the issue or an explicit UI contract requires them. A reviewer may
mention consistency or style as a follow-up, but it should not delay acceptance
of correct behavior.

Do not assert that an event happened when the real requirement is its effect.
`window.scrollY > 0`, a nonzero bounding box, or `scrollWidth > clientWidth`
is only a useful intermediate fact. Pair it with the intended target's changed
position, visible content, or scroll offset.

Do not combine unrelated acceptance claims into one long test. The
reconciliation test in `historical-reconciliation.e2e.ts:66-112` is valuable,
but comparison rendering, cancellation, focus trapping, overrides, and Undo
are separate failure surfaces. Separate tests make a failed gate actionable
and prevent an early assertion from masking later coverage.

Before adding another browser test, check whether an existing test already
proves the same invariant. `question-bank.e2e.ts:35-45` and
`workspace-layout.e2e.ts:48-67` both cover the initial narrower-bank geometry;
keep one canonical test and spend the saved browser run on a missing boundary.
