---
stage: design
bolt: 030-003-weighing-station
created: 2026-11-11T08:20:00Z
---

## Technical Design: 003-weighing-station (bolt 030)

### The flow

```text
pour lands OVER (at rest)
  │
  ├─ client: GET /api/surplus ─────────────► surplus INFO panel (amount, %)
  │
  ├─ operator: Re-tare (F2) ───────────────► re-weigh from zero (unchanged)
  │
  └─ operator: Supervisor override
        │ POST /api/escalation {componentId}      → escalation ESCALATED, with its `subject`
        │ supervisor at the terminal: badge, PIN, reason
        │ POST /api/identity/authorisations       → unit 008 authorises
        │     {supervisorId, secret, action: CONFIRM_COMPONENT, subject, reason}
        │ POST /api/escalation/authorise          → consumed once; OverrideRecord written
        │     {authorisationId, supervisorId, secret, reason}
        ▼
     escalation AUTHORISED  →  OK · Confirm enabled ("authorised by supervisor")
        │ POST /api/session/confirm
        ▼
     gate: OVER + authorised override → ALLOWED, zoneAtConfirm OVER
     record written with the POURED quantity; escalation cleared; next component
```

### Layer by layer

**Domain / application (unit 003)**

| Change | Where | Detail |
|---|---|---|
| Escalate **every** over-dose | `escalate-overdose.ts` | Remove the `COMPENSABLE` refusal. The surplus must still be OVER (`NOT_AVAILABLE` otherwise). The `isCompensable` option is dropped. |
| The gate admits an authorised override | `confirm-weighing.ts` | New option `authorisedOverride(componentId, weight): boolean`. When the zone is `OVER` and it returns true, the outcome is `ALLOWED` with `zoneAtConfirm: 'OVER'`. Every other zone path is unchanged. |
| What counts as authorised | `composition-root.ts` | The current escalation is for the **active component** in the **current session**, its state is `AUTHORISED`, and the current weight is **no greater than** the over-tolerance weight the escalation was raised at. A heavier pour after the authorisation, for example after a re-tare and a second over-pour, needs a new authorisation. |
| Single use | `composition-root.ts` + `session-controller.ts` | After a confirmation of the escalated component, the escalation is cleared (`clearEscalation`). Unit 008's consumption record already makes the authorisation id itself single-use (ADR-006). |

Note on naming: the escalation's `surplusAmount` field holds the
**over-tolerance weight** at the moment the escalation was raised (bolt 016
wiring). The comparison uses it as such. This is documented in the ADR, not
renamed, to keep the bolt-016 record and API stable.

**Presentation (unit 003)**

| Change | Detail |
|---|---|
| `serialiseEscalation` adds `subject` | `sessionId/componentId`, the scope's own subject. The client presents it to unit 008 so the authorisation is issued for exactly this component; unit 008 refuses any other (ADR-003). |
| Session confirm route | After a `CONFIRMED` outcome, clear the escalation for that component. |

No new endpoint and no schema change: `weighing_records.zone_at_confirm`
already admits `OVER`, and `override_records` is the audit link
(session + component).

**Client (unit 007)**

| Change | Detail |
|---|---|
| Surplus **info** panel | When OVER at rest, `GET /api/surplus` (read-only): the amount, the percentage, and the two recovery actions. **`POST /api/surplus` (the compensation proposal) is no longer called**; Accept/Decline are gone from the operator view. |
| Override button | Enabled only while the zone is OVER. Raises the escalation. |
| Escalation panel | Supervisor badge, PIN and reason. **No "authorisation id" field**: the client requests it from unit 008 with the escalation's `subject` and passes it straight on. A refusal shows the uniform message (ADR-004); the PIN field is cleared. |
| Confirm action | New extra `overrideAuthorised`: an OVER zone with an authorised escalation enables confirm, with the reason "Over tolerance — authorised by supervisor (reason recorded)." |
| Completion detail and ticket | A record with zone `OVER` is shown as **"OVER · overridden"**. Under this rule an OVER record can only exist through an authorised override (invariant 1), so the zone alone is the marking. |

**Endpoints (`src/007-weighingms-ui/api/endpoints.ts`)**: `fetchSurplus`
(exists), `raiseEscalation` (exists), `requestSupervisorAuthorisation` (new:
`POST /api/identity/authorisations`), `authoriseEscalation` (exists).

### Failure behaviour

| Case | Result |
|---|---|
| Wrong supervisor PIN, an operator's badge, or a subject mismatch | Unit 008 gives a uniform 403 → "The authorisation was refused." Nothing is recorded; confirm stays disabled |
| Override raised while not OVER | 409 `NOT_ESCALATABLE` → message; nothing raised |
| Pour heavier than the authorised weight | The gate refuses `ZONE_OVER`; a new override is needed |
| Re-tare back into tolerance | The ordinary `OK` path; the authorised escalation goes unused and is cleared at the confirmation |
| Same authorisation id presented twice | Unit 008 refuses the second consumption (ADR-006) |

### Tests (Stage 5)

- **Unit:** the gate (OVER with and without an override; a heavier weight; another component); escalation for a compensable surplus.
- **Integration:** the whole override path with seeded `SUP-001`: raise, authorise, consume, confirm. The record has zone `OVER` and the poured quantity; an override record exists. Refusals: wrong PIN, the operator as supervisor, a reused authorisation id, a heavier pour.
- **UI:** the info panel replaces the proposal (no `POST /api/surplus`); the panel has no authorisation-id field; confirm is enabled only after authorisation.
- **E2E:** the Step 30 over-tolerance scenario continues through the override to a confirmation; screenshots `STEP-24-overshoot-ui.png` and `STEP-24-overshoot-test.png`.
- The existing tests for the bolt 016 "compensable refuses escalation" behaviour are **updated**, not deleted, to assert the new rule.
