---
id: 001-select-batch-from-queue
unit: 007-weighingms-ui
intent: 001-assisted-dyestuff-weighing-station
status: draft
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: false
---

# Story: 001-select-batch-from-queue

## User Story

**As a** weighing operator
**I want** to see the released batches in a queue and start one by scanning its barcode or touching its row
**So that** I begin the right batch without transcribing anything by hand

## Acceptance Criteria

- [ ] **Given** the queue view is open, **When** it renders, **Then** every row shows the batch identifier, order reference, machine reference, fabric description, shade code, component count and weighing status, and the time the queue was last received is displayed (FR-1).
- [ ] **Given** the client source is inspected, **When** its data literals are searched, **Then** **no batch, recipe, component, weight or lot is defined in the client** — every such value arrives over the API (FR-1, FR-3, BRD IR-07).
- [ ] **Given** the client source is inspected, **When** the `ORGATEX · LINKED` string is searched, **Then** it is **not** present as a literal; the link state rendered is the value the API reports (BRD FR-19, BRD IR-18).
- [ ] **Given** a released batch is scanned or its row is touched, **When** the selection is made, **Then** the batch is selected and the selection is recorded with the method used (FR-2).
- [ ] **Given** a scan of an unknown or unreleased identifier, **When** it is submitted, **Then** the scan is rejected with a visible reason, no recipe is loaded, and the reason is drawn from the locale bundle rather than being a literal in a component (FR-2, FR-3, NFR-7).
- [ ] **Given** the operator-facing text is inspected, **When** the client source is searched, **Then** **no user-visible literal string is written in a component** — every operator-facing string comes from the locale bundle (BRD FR-22, BRD NFR-11).
- [ ] **Given** a queue row is rendered, **When** its dimensions are measured, **Then** its touch target is at least 15 mm and every operator-facing label is legible at 1.5 m (NFR-4, BRD NFR-07, BRD NFR-08).

## Technical Notes

- **This unit owns no functional requirement.** Every FR it exercises is consumed through the API; the client is a renderer, not a rule engine.
- **No hard-coded data in the client** (workbook Rule 5, BRD IR-07). The only things hard-coded are the design token set and the prototype's interaction rules, which are the specification rather than the data. A test asserts that the client source contains no batch, recipe or weight fixture data.
- **`ORGATEX · LINKED` is not a literal.** The status strip reads the real peripheral and link state from the API. The prototype's hard-coded `ORGATEX · LINKED` string is deliberately not carried over.
- **All operator-facing text is externalised** (NFR-7, BRD NFR-11): the seven queue column headers, the status values, the rejection reasons and every button label are locale keys. A test asserts the client source contains no user-visible literal strings.
- The locale bundle is fetched at runtime, so a language can be changed without a redeployment (BRD FR-22).
- The seven queue columns and the "last received" time come from FR-1; the filter by status is a client-side view over the fetched queue, not a second API contract.
- Selection by scan and by touch both go through the same selection action and are recorded with their method (FR-2).
- The clock in the chrome is a client concern; the *queue* receipt time is a server value and is displayed as received.
- Touch targets ≥ 15 mm and legibility at 1.5 m are testable assertions, not aspirations — a component test measures the rendered target.

## Dependencies

### Requires
- Unit 003's session API (the queue and batch selection endpoints).
- The locale bundle endpoint from unit 006 (story 005).

### Enables
- 002-watch-live-weight-and-tolerance-zone
- 003-confirm-weighing-and-advance

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| The API is unreachable when the queue view opens | The view shows a degraded state with a stated reason; it does not render a stale or empty-looking success (BRD FR-20). |
| A batch in the queue is no longer released | The row is not selectable and the reason is shown (BRD BR-03). |
| Two batches share an identifier prefix and a partial scan is submitted | The scan is rejected with a visible reason; the client does not guess a match. |
| The queue is empty | An explicit empty state is shown, with the receipt time still displayed. |
| The queue is filtered to a status that yields no rows | The empty state is shown and the filter is visibly still applied. |
| The locale bundle fetch fails | The configured fallback language is used; the queue still renders. |

## Out of Scope

- The queue source, its columns and its filtering as a business rule — FR-1, unit 001.
- Barcode scanning mechanics — the scanner is a peripheral (BRD FR-19, unit 004).
- Recipe loading and the recipe rail — FR-3, unit 002.
- Any tolerance, weighing or confirmation rule — unit 003.
