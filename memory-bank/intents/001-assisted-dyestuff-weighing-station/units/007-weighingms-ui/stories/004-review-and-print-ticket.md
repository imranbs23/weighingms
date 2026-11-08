---
id: 004-review-and-print-ticket
unit: 007-weighingms-ui
intent: 001-assisted-dyestuff-weighing-station
status: complete
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: true
---

# Story: 004-review-and-print-ticket

## User Story

**As a** weighing operator
**I want** to review the completed batch summary and print the ticket
**So that** the work is recorded and the paperwork is physically traceable to the container

## Acceptance Criteria

- [ ] **Given** a batch whose last component has been confirmed, **When** the completion view renders, **Then** it shows the batch summary — the batch identifier, the components weighed as a count of the total, the total dispensed, the elapsed time, the operator and the overall tolerance outcome (FR-15, BRD FR-15).
- [ ] **Given** the completion view renders the batch summary, **When** the per-component detail is read, **Then** every component is listed with its target quantity, actual quantity, unit, lot number, container identifier, scale identifier and the tolerance zone at the moment it was confirmed (FR-17, BRD FR-25, BRD AC-07).
- [ ] **Given** a completed batch, **When** the ticket preview is displayed, **Then** the preview is the ticket **rendered by the API** and shown as received, and the client composes no part of the ticket itself — no field layout, no header, no footer text is assembled in the browser (FR-17, BRD IR-16).
- [ ] **Given** a ticket preview is displayed, **When** the print action is used, **Then** a print is requested against the existing ticket, and the print job's state — queued, printing, done or failed — is visible to the operator while the job is in flight (FR-16, BRD FR-27, BRD FR-19).
- [ ] **Given** the printer is unavailable or the print attempt fails, **When** the failure is shown, **Then** the confirmed weighing remains recorded and queryable, the print job's error is displayed, the ticket is shown as **not printed** — never as printed — and the ticket can be printed later without the weighing being re-entered, re-weighed or re-confirmed (BRD FR-27, BRD FR-19, B-7).
- [ ] **Given** a ticket exists, **When** a reprint is offered, **Then** the reprint is visibly marked as a reprint, and it cannot be raised until a non-empty reason has been supplied (FR-17, BRD FR-28, BRD FR-21).
- [ ] **Given** any quantity is displayed on the completion view or in the ticket preview, **When** it is formatted, **Then** grams are shown to 1 decimal place and kilograms to 3 decimal places, formatted from a fixed-point decimal value and never parsed as a float (NFR-2, BRD NFR-16).
- [ ] **Given** a ticket is rendered, **When** its content is read, **Then** it carries the operator's identity, and the operator's identity is also shown on the completion view (FR-18, BRD FR-17).
- [ ] **Given** the completion view and the ticket preview are inspected, **When** the client source is searched, **Then** **no user-visible literal string is written in a component** — every operator-facing string, including the ticket template's text, comes from the locale bundle or from the rendered ticket the API returns (BRD FR-22, BRD NFR-11).
- [ ] **Given** an action on the completion view is rendered, **When** its dimensions are measured, **Then** its touch target is at least 15 mm and every operator-facing label is legible at 1.5 m (NFR-4, BRD NFR-07, BRD NFR-08).

## Technical Notes

- **The client never composes the ticket.** The preview is the API's rendering of the ticket, returned and displayed as received. The template is **configuration** (BRD IR-16), so a change to the ticket's layout, its fields, its language or its wording is a configuration change and needs no redeployment (BRD FR-22, BRD NFR-14). A client that assembled the ticket from its own field list would freeze that list into the build and turn every template change into a release.
- **A failed print is shown as *not printed*, never as a silent success.** This is the client-side half of B-7: recording a weighing and printing its ticket are two operations with two independent outcomes, and a printer failure must never cost a weighing (BRD FR-19). The view shows the print job's error, keeps the ticket available for a later attempt, and never renders the ticket as printed when the job did not reach `DONE`. The reverse failure — a printed job shown as pending — is equally wrong, so the displayed state is always the job's state as reported by the API.
- **A reprint is visually distinguishable from a first print and carries a reason.** The marking appears both on the stored job (`isReprint`, `reprintOf`, `reason`) and on the rendered artefact, so a paper copy in the dyehouse is self-identifying. The reason is mandatory and is refused at the request boundary, not merely recorded as blank; the reprinting action is written to the audit trail with actor, role, subject and reason (BRD FR-28, BRD FR-36, BRD NFR-13).
- **The ticket content is the weighing record plus batch identity, and nothing invented.** The physical format — layout, fields rendered, symbology, printer language, paper size — is a **training artefact**: the prototype states plainly that "Label content is invented" (PROTO view 3), so AC-10 is not satisfiable in this build and Q-11/Q-12 remain open. No component, test or seed data may assert a specific physical label layout as fact (FR-17, AC-10, Q-11).
- The completion view renders the summary the **domain** produced (unit 003 story 009), not a summary reassembled by the client from display strings. The "all within tolerance" verdict, the summed total and the OrgaTEX write-back result are all received values (FR-15).
- Decimals: 1 dp for grams, 3 dp for kilograms, per the prototype's `dp()` rule. The client receives fixed-point decimal values and **formats** them; it never parses a quantity as a float and never sums two quantities by concatenating display strings (NFR-2, BRD NFR-16).
- The print job's state is polled or streamed while it is in flight, so the operator sees "printing" rather than a dead button. The view does not optimistically declare success on the click.
- The printer's state also appears in the persistent status strip, so the operator can see a printer that is out of paper *before* completing a batch (FR-19, BRD IR-16).
- Every quantity, zone value and label on the completion view comes from the locale bundle or the API; the completion view introduces no client-side data of its own (BRD IR-07, BRD NFR-11).
- Touch targets ≥ 15 mm and legibility at 1.5 m are testable assertions, not aspirations — a component test measures the rendered target.

## Dependencies

### Requires
- Unit 003's batch completion summary (story 009, `009-complete-batch-and-summarise`).
- Unit 006's ticket preview and print endpoints (`001-generate-weighing-ticket`, `002-print-ticket-and-track-job`).
- Unit 006's reprint endpoint with its mandatory reason (`003-reprint-ticket-with-reason`).
- Unit 008's signed-in operator identity, as stamped onto the ticket.
- The locale bundle endpoint from unit 006 (story 005).

### Enables
- 005-show-peripheral-degraded-states
- 006-ticket-printing story 004 (`004-record-and-export-audit-trail`)

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| The printer is out of paper when the operator prints | The print job's error is shown, the weighing stays recorded, the ticket is shown as not printed and a later attempt is offered (BRD FR-19, BRD FR-27). |
| The print job is still running when the view is closed | The job's state is retrievable by its identifier; reopening the view shows the job's state as the API reports it, not a default (BRD FR-19). |
| The operator taps "Print ticket" twice | Two print jobs exist; the second is still a first print unless a reprint reason was supplied — the reprint marking is a property of the request, not of the count. |
| The operator leaves the completion view without printing | The ticket remains generated and printable; the batch is not rolled back and the weighing is unaffected (BRD FR-27). |
| A component was confirmed under a supervisor override | The summary's "all within tolerance" verdict is `NO`, the component still appears with its zone at confirmation, and the ticket states the overall outcome as the API reports it (FR-15, BRD FR-11). |
| A reprint is requested without a reason | The request is refused and no print job is created; the reason prompt stays open (BRD FR-28, BRD FR-21). |
| The ticket preview is requested while the API is unreachable | The view shows a degraded state with a stated reason; it does not render a stale preview as though it were current (BRD FR-20). |
| The locale changed after the ticket was generated | The ticket preview shows the rendered ticket as generated; the locale applies to the completion view's own text (BRD FR-22, BRD NFR-11). |
| The recipe mixes grams and kilograms | Each component keeps its own unit and its own decimal precision; no cross-unit conversion is performed in the client (NFR-2, BRD NFR-16). |

## Out of Scope

- The batch summary's content and the tolerance verdict — unit 003, story 009 (FR-15).
- Ticket generation, the ticket's fields and the template configuration — unit 006, story 001 (FR-17, BRD IR-16).
- The print job lifecycle and the printer adapter — unit 006, story 002 (BRD FR-19).
- The reprint marking, the mandatory reason and the audit entry — unit 006, story 003 (BRD FR-28, BRD FR-36).
- The physical ticket layout, symbology, printer language and paper size — not settled (Q-11, Q-12, AC-10).
- Operator identity and its capture at session start — unit 008, story 001 (FR-18).
- The status strip's other peripheral states — story 005.
- The OrgaTEX write-back and the batch status advance — unit 005 (BRD FR-26).
