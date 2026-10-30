---
unit: 006-ticket-printing
intent: 001-assisted-dyestuff-weighing-station
phase: inception
status: draft
created: 2026-10-30T04:05:00Z
updated: 2026-10-30T04:05:00Z
---

# Unit Brief: Ticket, Printing, Audit & Configuration

## Purpose

Produce the weighing ticket and label, and the administrative record around
privileged actions.

This unit answers "what was printed, what was done to the system and by
whom, and how is the station configured?" — the questions that outlive the
weighing itself. It is deliberately **not** where a weighing happens; it is
where a weighing becomes paperwork, an audit entry, or a report.

## Scope

### In Scope

- **Ticket generation** — rendering the weighing ticket and label from a
  template over a session's records.
- **Print jobs** — creating, tracking and completing them; marking
  **reprints** distinctly from first prints.
- The **audit trail** for privileged actions: append-only, immutable,
  exportable, retained ≥ 5 years.
- **Configuration** — scale thresholds, tolerance overrides, label template,
  and every other operational setting — changeable **without a
  redeployment**.
- **Localisation** — all operator-facing text externalised (NFR-11), with
  the language selectable at runtime.
- **Operational reporting** over the recorded weighings.

### Out of Scope

- The weighing that produced the records → `003-weighing-station`.
- What OrgaTEX does with the consumption → `005-orgatex-integration`.
- Rendering the ticket on screen → `007-weighingms-ui`.
- Deciding *whether* a weighing is over tolerance → `003-weighing-station`.

---

## Assigned Requirements

| FR | Requirement | Priority |
|----|-------------|----------|
| FR-17 | Ticket generation | Must |
| FR-21 | Privileged actions and audit trail | Must |
| FR-22 | Configuration and localisation | Must |
| FR-23 | Operational reporting | Must |

---

## Domain Concepts

### Key Entities

| Entity | Description | Attributes |
|--------|-------------|------------|
| `Ticket` | The rendered weighing record for a batch | `id`, `sessionId`, `batchId`, `templateId`, `lines[]`, `generatedAt`, `language`, `reprintOf`? |
| `TicketLine` | One component's line on the ticket | `componentId`, `materialCode`, `targetQuantity`, `actualQuantity`, `unit`, `lotNumber`, `containerId`, `scaleId`, `zoneAtConfirm`, `operatorId`, `timestamp` |
| `PrintJob` | A request to print a ticket | `id`, `ticketId`, `state` (`QUEUED` \| `PRINTING` \| `DONE` \| `FAILED`), `attemptedAt`, `completedAt`, `error`?, `isReprint` |
| `AuditEntry` | An immutable record of a privileged action | `id`, `action`, `actorId`, `actorRole`, `subject`, `reason`, `occurredAt`, `metadata`, `sequence` |
| `ConfigurationEntry` | One configurable setting | `key`, `value`, `category`, `updatedAt`, `updatedBy`, `version` |
| `LocaleBundle` | Operator-facing text for one language | `locale`, `strings{}`, `version` |

### Key Operations

| Operation | Description | Inputs | Outputs |
|-----------|-------------|--------|---------|
| `generateTicket` | Render a ticket from a session's records | `sessionId`, `templateId`, `locale` | `Ticket` |
| `printTicket` | Send a ticket to the printer | `ticketId` | `PrintJob` |
| `reprintTicket` | Re-print, marked as a reprint | `ticketId`, `reason` | `PrintJob` with `isReprint` |
| `recordAudit` | Append an entry to the audit trail | action, actor, subject, reason | `AuditEntry` |
| `getAuditTrail` | Query the audit trail | filter (actor, action, date) | `AuditEntry[]` |
| `exportAudit` | Export the audit trail | format, filter | export artefact |
| `getConfiguration` | Read the effective configuration | — | `ConfigurationEntry[]` |
| `setConfiguration` | Change a setting, with an audit entry | key, value, actor | updated `ConfigurationEntry` |
| `getLocale` | Load the operator-facing strings | locale | `LocaleBundle` |
| `buildReport` | Produce an operational report | period, scope | report artefact |

### The audit trail is a domain concept, not a log file

The audit trail records **privileged actions** — the actions that require
supervisor authorisation or change the system's behaviour rather than
merely record a weighing. Three properties make it a domain concept rather
than a logging side-effect:

1. **Append-only.** Entries are never updated or deleted. This mirrors the
   immutability rule that applies to weighing records (BRD DR-02), and it
   is the reason the storage is a table with a monotonic sequence rather
   than a text file.
2. **Attributed and reasoned.** Every entry carries the actor, their role,
   the subject acted upon, and a **reason**. The reason is not optional:
   BRD C-09 and NFR-12 both turn on a supervisor authorisation being
   *justified*, and an audit entry without a reason cannot demonstrate
   justification.
3. **Retained and exportable.** ≥ 5 years (DR-01) and exportable on
   demand, because the trail exists to be read by someone other than the
   person who wrote it.

**Rule 2 (workbook): no invented requirements.** Which actions count as
"privileged" is derived from the BRD's own constraints — supervisor
over-dose authorisation (FR-13, C-09), configuration changes (FR-22), and
reprints — rather than from an invented taxonomy.

### Configuration without redeployment

FR-22 requires that operational settings be changeable without rebuilding
and redeploying. The values the BRD names are **scale thresholds, tolerance
overrides, and the label template**; language is grouped with them because
it has the same property.

Two rules govern the configuration store, and both exist because of the
same underlying concern — that a setting can change what a weighing means:

1. **A configuration change is itself audited.** A tolerance override that
   is not attributable has changed the meaning of the weighings around it.
2. **A setting that overrides a recipe value records what it overrode and
   why.** The override is visible on the weighing record; the original
   value is not erased.

The second rule is what prevents a configuration capability from becoming
a way to launder a weighing. Tolerance overrides are, in the end, a way to
make an out-of-tolerance weight acceptable — so their use is attributed,
bounded and retained like everything else.

### Printing must not cost a weighing

B-7 is the governing failure boundary for this unit: **a printer failure
must not cost a weighing.** The recording of a weighing and the printing
of its ticket are therefore separate operations with separate outcomes. A
failed print leaves the weighing recorded and the print job in `FAILED`
with a visible error, and the ticket can be printed later.

**Rule 2 (workbook): no invented requirements.** The prototype itself says
*"Label content is invented"*, and that statement is carried forward as
P-13 / Q-12 / AC-10 rather than being turned into a contract. The ticket
template is therefore **configuration** (which is how FR-22 already wants
it), and the content it carries is the weighing record plus the batch
identity — not an invented format.

---

## Story Summary

| Metric | Count |
|--------|-------|
| Total Stories | 6 |
| Must Have | 5 |
| Should Have | 1 |
| Could Have | 0 |

### Stories

| Story ID | Title | Priority | Status |
|----------|-------|----------|--------|
| 001 | Generate the weighing ticket for a completed batch | Must | Planned |
| 002 | Print the ticket and track the print job | Must | Planned |
| 003 | Re-print a ticket, marked as a reprint with a reason | Must | Planned |
| 004 | Record and export the audit trail for privileged actions | Must | Planned |
| 005 | Change configuration and language without a redeployment | Must | Planned |
| 006 | Report on tolerance failures and overrides | Should | Planned |

---

## Dependencies

### Depends On

| Unit | Reason |
|------|--------|
| `003-weighing-station` | What was weighed — the records the ticket is rendered from. |
| `001-batch-management` | The batch identity carried on the ticket. |
| `008-operator-identity` | The operator on the ticket and in the audit trail. |

### Depended By

| Unit | Reason |
|------|--------|
| `007-weighingms-ui` | The ticket preview, the print controls, the audit view and the settings screen. |

### External Dependencies

| System | Purpose | Risk |
|--------|---------|------|
| Printer | Producing the physical ticket and label | **Moderate** — B-7; language and symbology deliberately not invented (Q-11) |

---

## Technical Context

### Suggested Technology

TypeScript strict · Express 4 · Zod for validation · SQLite via
better-sqlite3, **append-only** for audit entries and print jobs ·
fixed-point decimal for every quantity on a ticket line · locale bundles
as JSON resources loaded at runtime (no build-time embedding, so a language
can be added without a redeployment).

### Integration Points

| Integration | Type | Protocol |
|-------------|------|----------|
| `003-weighing-station` | API (internal) | REST/JSON |
| `001-batch-management` | API (internal) | REST/JSON |
| `008-operator-identity` | API (internal) | REST/JSON |
| `007-weighingms-ui` | API (internal) | REST/JSON |
| Printer | API (external, via adapter) | **Training contract** — `POST /api/print` |

### Data Storage

| Data | Type | Volume | Retention |
|------|------|--------|-----------|
| Tickets | SQL | One row per ticket | ≥ 5 years (DR-01) |
| Ticket lines | SQL | One row per component per ticket | ≥ 5 years (DR-01) |
| Print jobs | SQL | One row per print attempt | ≥ 5 years (DR-01) |
| Audit entries | SQL, **append-only** | One row per privileged action | ≥ 5 years (DR-01) |
| Configuration | SQL | One row per key | Current + version history |
| Locale bundles | JSON resource files | One per language | — |

---

## Constraints

- **No floating point for quantities** on ticket lines (BRD NFR-16).
- **Audit entries are never updated or deleted.**
- Every privileged action carries an **actor, a role and a reason**.
- Configuration changes take effect **without a redeployment** (FR-22).
- All operator-facing text is **externalised** (NFR-11).
- **A printer failure never costs a weighing** (B-7).
- A **reprint is distinguishable from a first print** and carries a reason.
- Ticket content is a **training artefact** — the physical format is not
  invented here (AC-10 is not satisfiable in this build).

---

## Success Criteria

### Functional

- [ ] A ticket is generated for a completed batch, carrying every component
      with its target, actual, unit, lot, container, scale, zone at
      confirmation, operator and timestamp.
- [ ] The ticket is printed, and the print job's state is visible.
- [ ] A failed print leaves the weighing recorded and the ticket printable
      later.
- [ ] A reprint is marked as a reprint and carries a reason.
- [ ] Every privileged action produces an immutable audit entry with actor,
      role, subject and reason.
- [ ] The audit trail can be queried and exported.
- [ ] Configuration — scale thresholds, tolerance overrides, label template
      — can be changed at runtime, and each change is audited.
- [ ] The operator interface can run in a different language without a
      redeployment.

### Non-Functional

- [ ] Audit entries and tickets survive an immediate power loss (NFR-05).
- [ ] Audit entries and tickets are retained for ≥ 5 years (DR-01).
- [ ] All ticket quantities are fixed-point decimal.

### Quality

- [ ] The append-only property of the audit trail is covered by a test
      asserting that no update or delete path exists.
- [ ] The printer-failure path is covered by a test asserting the weighing
      record still exists after a failed print.
- [ ] The reprint marking is covered by a test distinguishing it from a
      first print.
- [ ] Every operator-facing string is covered by a test asserting no
      user-visible text is hard-coded in the client.
- [ ] Code reviewed and approved.

---

## Bolt Suggestions

| Bolt | Type | Stories | Objective |
|------|------|---------|-----------|
| `006-ticket-printing-1` | DDD | 001, 002 | The `Ticket` and `PrintJob` model, the template rendering, and the printer adapter |
| `006-ticket-printing-2` | DDD | 003 | Reprint marking and the print-failure boundary |
| `006-ticket-printing-3` | DDD | 004 | The append-only audit trail, its queries and its export |
| `006-ticket-printing-4` | DDD | 005 | The configuration store and the locale bundles |
| `006-ticket-printing-5` | DDD | 006 | The operational report over tolerance failures, overrides and configuration changes |

---

## Notes

**This unit was deliberately widened.** The workbook suggested "Ticket &
Printing". Ticket and printing are kept, but the audit trail, the
configuration store, the localisation bundles and the operational reporting
are folded in with them. The reason is that all five share the same
characteristic: they are **supporting capabilities with a different owner
and a different change rate**. The label template changes when FCI chooses
a printer; the language changes when a second site appears; the audit format
follows the retention policy; the reports follow management's questions.
None of that should ever require re-opening the weighing logic.

A reviewer who prefers those separated can split them without difficulty —
they share no state, only the records they read.

**The ticket's content is not invented.** The prototype says so itself, and
AC-10 is carried forward as not satisfiable in this build. What the ticket
carries is the weighing record plus the batch identity — facts the system
already holds — and its *format* is a configuration value, which is how
FR-22 already requires it to be.

**The audit trail is where FR-21's real weight sits.** NFR-12 and C-09
both require a supervisor's over-dose authorisation to be authenticated,
attributed and justified. That justification is the audit entry. This unit
owns the trail; unit 003 owns the decision to escalate and unit 008 owns
the authentication.

**The configuration store has a sharp edge, and it is deliberate.** A
tolerance override is a way to make an out-of-tolerance weight
acceptable. That is why overrides are audited, why the original value is
retained alongside the override, and why the override is visible on the
weighing record itself rather than only in a settings screen.
