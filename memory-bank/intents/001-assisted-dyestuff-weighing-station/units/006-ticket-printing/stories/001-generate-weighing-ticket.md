---
id: 001-generate-weighing-ticket
unit: 006-ticket-printing
intent: 001-assisted-dyestuff-weighing-station
status: complete
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: true
---

# Story: 001-generate-weighing-ticket

## User Story

**As a** weighing operator
**I want** a weighing ticket produced for the batch I have just completed
**So that** the ticket accompanies the container to the dyeing machine and records exactly what was weighed

## Acceptance Criteria

- [ ] **Given** a batch whose last component has been confirmed, **When** the batch completes, **Then** exactly one ticket is generated for that session and is available to print (BRD FR-17, BRD FR-27).
- [ ] **Given** a generated ticket, **When** its lines are read, **Then** it carries the batch identity (batch identifier, order reference, machine reference, shade) and the operator identity and generation date (BRD FR-17).
- [ ] **Given** a generated ticket, **When** its component lines are read, **Then** each component line carries the component identifier, material code, target quantity, actual quantity, unit, lot number, container identifier, scale identifier, the tolerance zone at confirmation, the operator identifier and the timestamp (BRD FR-17, BRD FR-18).
- [ ] **Given** a generated ticket, **When** the tolerance outcome is read, **Then** the ticket states the overall tolerance outcome for the batch (BRD FR-17).
- [ ] **Given** a ticket is generated, **When** any quantity on it is compared with the recorded weighing, **Then** the value is identical and is stored and rendered as a fixed-point decimal with no floating-point rounding (NFR-2, BRD NFR-16).
- [ ] **Given** the configured template identifier is read, **When** the ticket is rendered, **Then** the template used is recorded on the ticket, and the ticket content and layout are determined by configuration rather than by compiled code (BRD FR-17, BRD FR-22, BRD IR-16).

## Technical Notes

- The ticket is a **read model over the immutable weighing records**, not a second copy of the truth. It is rendered from `003-weighing-station`'s confirmed records plus the batch identity from `001-batch-management`.
- **The ticket's physical format is not invented here.** The prototype itself states that label content is invented (PROTO view 3), so AC-10 is not satisfiable in this build and Q-11/Q-12 remain open. The ticket carries the weighing record plus batch identity; the *format* — layout, fields rendered, symbology, printer language, paper size — is a configuration value. No story, test or seed data may assert a specific physical label layout as fact.
- The template is therefore selected by `templateId` and stored on the `Ticket` entity, so a reprint months later renders the same template version it originally did.
- Quantity arithmetic uses fixed-point decimal throughout; no floating point is permitted in the persisted line values (NFR-2, BRD NFR-16).
- `Ticket.generatedAt`, `Ticket.language` and `Ticket.templateId` are captured at generation time so a later locale or template change does not alter an existing ticket.
- Retention: tickets and ticket lines are retained for ≥ 5 years (DR-01).
- A `reprintOf` field is reserved on the entity; story `003-reprint-ticket-with-reason` populates it.

## Dependencies

### Requires
- Unit 003 confirmed weighing records and batch completion state (`003-weighing-station`).
- Batch identity fields carried onto the ticket (`001-batch-management`).
- Operator identity stamped onto each line (`008-operator-identity` story 001).
- The configured ticket template (`005-change-configuration-and-language`).

### Enables
- 002-print-ticket-and-track-job
- 003-reprint-ticket-with-reason
- 004-record-and-export-audit-trail
- 006-report-on-tolerance-failures-and-overrides

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| A batch is completed twice (retry after an ambiguous response) | Exactly one ticket per session; generation is idempotent and the existing ticket is returned. |
| The template configured at generation time is later changed | The existing ticket retains its original `templateId` and content; only newly generated tickets use the new template. |
| A component was abandoned and re-weighed | Only the confirmed weighing record appears as a ticket line; the abandoned attempt appears nowhere on the ticket. |
| A quantity is in kilograms and another in grams | Each line keeps its own unit; no cross-unit conversion is performed at render time. |
| The ticket is generated for a session with a failed OrgaTEX write-back | The ticket is still generated from the local confirmed records; write-back state is a separate concern. |

## Out of Scope

- Deciding whether a weighing is within tolerance — unit 003.
- Sending the ticket to a printer — story 002.
- Reprint marking and the reprint reason — story 003.
- The physical label layout, symbology, printer language or paper size — not settled (Q-11, Q-12, AC-10).
- The OrgaTEX consumption posting and batch status advance — unit 005 / BRD FR-16.
