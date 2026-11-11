---
bolt: 030-003-weighing-station
created: 2026-11-11T09:00:00Z
status: accepted
---

# ADR-047: OVER is confirmed only through a scoped, single-use supervisor override, and nothing is recalculated

## Context

The workbook's Step 24 asks for a defined overshoot rule, chosen by a human.
The project owner chose **option C, supervisor-gated**
(`evidence/STEP-24-overshoot-decision.md`).

What existed before this bolt:

- Bolt `014`'s gate refused `OVER` **always**.
- Bolt `015` proposed a proportional recalculation of the remaining
  components. Accepting it changed nothing: the targets were not applied
  and the over-dosed component still could not be confirmed.
- Bolt `016` built the escalation and the override record, but **only for a
  non-compensable over-dose**, and an `AUTHORISED` escalation opened
  nothing. So BRD FR-18's *"or after authorised override"* had no path.

The brief marks the recalculation as its highest-risk assumption (A-08,
open questions Q25, Q26, Q33).

## Decision

**An `OVER` weighing is confirmed only through a supervisor override that
is authorised for that component in that session, used once, and recorded.
No recipe is recalculated.**

1. **The escalation is offered for every over-dose.** The `COMPENSABLE`
   refusal in `EscalateOverdose` is removed.
2. **The gate admits `OVER` only with an authorised override.**
   `ConfirmWeighing` takes an `authorisedOverride(componentId, weight)`
   predicate. It is true only when the station's current escalation:
   - is for the **active component** in the **current session**,
   - is `AUTHORISED`, and
   - was raised at a weight **no lower than** the current weight.

   Then the outcome is `ALLOWED` with `zoneAtConfirm: 'OVER'`. `UNDER` and
   `NEAR` are unchanged.
3. **The override is single-use.** The escalation is cleared after the
   component is confirmed. Unit `008`'s consumption record already refuses
   a second use of the same authorisation id (ADR-006).
4. **The recorded quantity is the poured quantity.** The record is an
   ordinary weighing record with zone `OVER`; the override record for the
   same session and component is its audit link. No new column.
5. **The supervisor authenticates at the terminal.** The client asks unit
   `008` for an authorisation with the escalation's `subject`
   (`sessionId/componentId`), then presents it to the escalation. The
   operator never types an authorisation id.
6. **The surplus is shown for information only.** The compensation proposal
   is withdrawn from the operator UI; its code (bolt `015`) stays, unused.

## Rationale

### Why a supervisor, and not an automatic rule

Brief FR-18 and FR-23 name an authorised override as the way forward. An
automatic acceptance (for example "within 2 % over is fine") would be a
tolerance change in disguise, and tolerances belong to the recipe and the
versioned configuration (ADR-045), not to the gate.

### Why nothing is recalculated

Recalculation rests on assumption A-08, which the brief itself rates as the
most likely misunderstanding: FCI may mean only "display the excess". A
wrong recalculation changes the shade of every later component in the
batch. Holding it back until Q25/Q26 are answered costs some dyestuff; the
alternative risks the batch.

### Why the weight is bounded by the authorised weight

The supervisor authorised **that pour**. If the operator re-tares and pours
more, the supervisor has not seen the new amount. A lower or equal weight
is still inside what was authorised; a higher one needs a new
authorisation.

### Why the field named `surplusAmount` is compared as a weight

Bolt `016` wired the escalation's `surplusAmount` to the zone's reading
weight at the moment the escalation was raised, so it already holds the
over-tolerance weight. Renaming it would change the bolt `016` record, the
override record's column and its API. This ADR records the meaning instead.

### Why the zone alone marks the record as overridden

Under this rule an `OVER` record can exist only through an authorised
override (invariant 1 of the model). So the completion view and the ticket
show `OVER` as **"OVER · overridden"** without a new field, and the override
record gives the supervisor, the reason and the time.

## Consequences

### Positive

- FR-18, FR-23 and FR-24 are met as written.
- The operator is never stuck: re-tare and re-weigh, or ask a supervisor.
- The supervisor's own credentials and role are required: the
  authorisation id alone is not a credential (ADR-003), and every refusal
  looks the same (ADR-004). Every override is recorded with its reason.
- No schema change and no new endpoint.

### Negative

- Over-dosed material is either thrown away or accepted as poured. The
  shade is not corrected by later components.
- The escalation is held in memory (bolt `016`). A server restart between
  the authorisation and the confirmation loses it, and the supervisor must
  authorise again. The override record itself is durable.

### Risks

- **A future agent re-enables the proposal** because the code is still
  there. *Mitigation*: this ADR and the decision index; the proposal waits
  for FCI's answer to Q25/Q26.
- **A future agent lets the client send "overridden: true"**. *Mitigation*:
  the gate derives the basis from the server's own escalation state; a
  client never asserts it.

## Related

- **Stories**: `004-gate-confirmation-on-zone`,
  `007-escalate-non-compensable-overdose`
- **Requirements**: BRD FR-18, FR-19, FR-20, FR-23, FR-24 · assumption A-08
  · open questions Q25, Q26, Q33
- **Previous ADRs**: ADR-039 (this unit consumes unit `008`'s authorisation
  and re-checks nothing); ADR-038 (the compensation factor, now unused by
  the UI); ADR-045 (tolerances are versioned configuration); ADR-006 (an
  authorisation is consumed once); ADR-003 (the authorisation id is not a
  bearer credential); ADR-004 (one uniform refusal); ADR-005 (the reason is
  stored in clear text)
- **Evidence**: `evidence/STEP-24-overshoot-decision.md`
