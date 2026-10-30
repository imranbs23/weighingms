---
id: 007-escalate-non-compensable-overdose
unit: 003-weighing-station
intent: 001-assisted-dyestuff-weighing-station
status: draft
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: false
---

# Story: 007-escalate-non-compensable-overdose

## User Story

**As a** dyehouse supervisor
**I want** to authorise a non-compensable over-dose with a recorded reason
**So that** an unavoidable excess is released deliberately and traceably, and never silently

## Acceptance Criteria

- [ ] **Given** an over-dose that cannot be compensated, **When** the operator requests an override, **Then** the session enters the `ESCALATED` state, an explicit awaiting-supervisor state, and the weighing is **not** confirmed (BRD FR-13, BRD FR-23, BRD AC-06).
- [ ] **Given** an override request is awaiting authorisation, **When** a supervisor authenticates and supplies a reason, **Then** the override is recorded with the authorising supervisor, the reason and the time, and the weighing can then be confirmed (BRD FR-13, BRD FR-24, BRD FR-35).
- [ ] **Given** an override request is awaiting authorisation, **When** the request is completed without supervisor authentication and a recorded reason, **Then** the override is refused and the weighing remains unconfirmed (BRD FR-13, BRD AC-06, BRD FR-35).
- [ ] **Given** the operator raised the override request, **When** the authorisation is attempted, **Then** the operator's own credentials cannot authorise it — the authoriser must be a distinct, authenticated supervisor (BRD FR-13, BRD FR-21, NFR-6, BRD NFR-12).
- [ ] **Given** an override is granted, **When** it is applied, **Then** it is scoped to **one** action (this confirmation) and **one** subject (this component of this session), it expires after a defined short validity period, and it cannot be reused for a later confirmation (BRD FR-13, BRD FR-21, NFR-6, BRD NFR-12).
- [ ] **Given** no supervisor authorises the override, **When** the escalation times out or is declined, **Then** the weighing is not confirmed and the batch is held (BRD FR-13).

## Technical Notes

- **Escalation requires three things: a supervisor, a reason, and an audit entry.** All three are mandatory; the authorisation cannot be completed without supervisor authentication and a recorded reason (BRD AC-06, BRD FR-35).
- **The operator cannot authorise their own escalation.** The authoriser must be authenticated as a supervisor and must be a different principal from the requester. Credentials are never shared between roles (BRD NFR-12, NFR-6).
- **The authorisation is scoped and expiring.** It is bound to one action (`confirmComponent`) and one subject (the specific `componentId` in the specific `sessionId`), and carries a short validity period after which it is void. A stale or mismatched authorisation is refused, not silently applied. This satisfies NFR-12 and `C-09` (privileged actions are authenticated and audited).
- The override record captures: the authorising supervisor's identity, the reason, the time, the component and session it applies to, the surplus it covers, and the resulting weighing. All privileged actions are written to the audit trail with actor, event type, detail and time, and audit records are immutable and exportable (BRD FR-36, BRD NFR-13, BRD FR-21).
- The weighing written under an override records its `zoneAtConfirm` as the zone that was in force at confirmation — the over-dose zone — **not** `OK`, so the exception is visible in the record and in reporting (BRD FR-11, BRD FR-23).
- The override record and the weighing record are both retained ≥ 5 years (BRD DR-01).
- The operator is offered the alternatives of supervisor override or discard-and-re-weigh; discarding discards the dispense and resets the weight to zero (BRD FR-13, BRD FR-19).
- Assumption `A-08` / `Q-06` bind this story: if "surplus compensation" turns out to mean only displaying the excess, the non-compensable branch and this story's path are **deleted** rather than rewritten.
- All quantities on the override (the surplus it covers) are fixed-point decimal (BRD NFR-16).

## Dependencies

### Requires
- 005-detect-overdose-and-calculate-surplus (the over-dose and its surplus)
- 006-apply-surplus-compensation (the compensability decision that leads here when it fails)

### Enables
- 004-gate-confirmation-on-zone (consumes a valid override as the only route out of `OVER`)

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| The operator is also a supervisor | The operator's own request cannot be self-authorised; a distinct supervisor must authorise it |
| A supervisor authenticates but gives no reason | The override is refused; the reason is mandatory (BRD AC-06) |
| The authorisation has expired | The override is refused; the session returns to `ESCALATED` awaiting a fresh authorisation |
| The authorisation was issued for a different component or session | Refused — the authorisation is scoped to one action and one subject |
| The same authorisation is presented twice for a second confirmation | Refused on the second use; the authorisation is single-use |
| The supervisor is on the session but is not the requesting operator | Accepted, provided authentication, a reason and scope all hold |
| No supervisor authorises | The weighing is not confirmed and the batch is held |
| The scale disconnects while awaiting authorisation | The override remains valid for its scope and validity window; the confirmation still requires the scale to be connected |

## Out of Scope

- The authentication mechanism and the operator directory → `008-operator-identity`, `Q-08`.
- Audit-trail export and operational reporting of overrides → `BRD FR-21` infrastructure, `BRD FR-23`.
- The compensability rule itself → story 006.
- The confirm-gate exception mechanics → story 004.
