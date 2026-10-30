---
id: 003-confirm-weighing-and-advance
unit: 007-weighingms-ui
intent: 001-assisted-dyestuff-weighing-station
status: draft
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: false
---

# Story: 003-confirm-weighing-and-advance

## User Story

**As a** weighing operator
**I want** to confirm a weighing and have the station advance to the next component on its own
**So that** I can work through a batch without touching the keyboard or deciding what comes next

## Acceptance Criteria

- [ ] **Given** the session snapshot reports a zone, **When** the action row renders, **Then** the confirm action is enabled only when the reported zone is `OK`, and it is disabled in every other zone with the **reason** for its unavailability shown to the operator — the client computes no zone of its own and takes the zone as received (FR-10, BRD FR-18, BRD AC-04, FR-9).
- [ ] **Given** the confirm action is enabled, **When** the operator confirms, **Then** the request carries the signed-in operator's identity, and the resulting weighing record is attributable to that operator together with the target, the actual quantity, the scale, the lot and the timestamp (FR-18, BRD FR-25, BRD AC-07).
- [ ] **Given** a component has been confirmed, **When** the confirmation completes, **Then** the confirmed component's state becomes `DONE`, the **first `PENDING` component in recipe order** becomes `ACTIVE`, the recipe rail shows the new active component and the weigh view moves to it — progression is by recipe order, not by operator choice (FR-14, BRD FR-06, BRD FR-14).
- [ ] **Given** a component is `DONE`, **When** the operator attempts to select it in the recipe rail, **Then** the selection is rejected and the rail states that the component is already complete — `DONE` is terminal and cannot be re-selected or re-weighed (FR-14, C-08, BRD FR-19).
- [ ] **Given** the API reports a surplus proposal, **When** the surplus panel renders, **Then** it shows the surplus as an absolute quantity and a percentage, each affected component's original target and its revised target, and the proportional factor derived as `surplus ÷ totalRemainingTarget` — never a hard-coded constant — together with the statement that the remaining components are recalculated to preserve the shade ratio (FR-11, FR-12, BRD FR-22, A-08).
- [ ] **Given** a surplus proposal is shown, **When** the operator accepts it, **Then** the remaining components' targets are revised by the proposed amounts and the revised targets are shown in the rail; **when** the operator declines it, **Then** the decline is accepted, the proposal is recorded as declined and the batch is held rather than confirmed (FR-12, BRD FR-24, BRD FR-21).
- [ ] **Given** the API reports an escalation, **When** the escalation panel renders, **Then** the operator is offered supervisor override or discard-and-re-weigh, the prompt states that a **reason is required**, and the request enters an explicit awaiting-supervisor state in which the weighing is **not** confirmed (FR-13, BRD FR-23, BRD AC-06).
- [ ] **Given** an escalation prompt is open, **When** a supervisor authenticates and supplies a non-empty reason, **Then** the override is recorded with the authorising supervisor, the reason and the time, and the confirmation becomes available; **when** it is attempted without supervisor authentication or without a reason, **Then** it is refused and the weighing remains unconfirmed (FR-13, BRD FR-24, BRD FR-35, BRD AC-06).
- [ ] **Given** a component is in progress, **When** the operator uses the abandon / reset action, **Then** the dispense returns to zero for the current component, no weighing record is written, and the component returns to `PENDING` (FR-10, BRD FR-19).
- [ ] **Given** manual scale reselection is offered, **When** the action is rendered, **Then** it is available to a **supervisor only** and cannot be completed without supervisor authentication; the operator's own credentials cannot authorise it, and the privileged action is written to the audit trail with the actor, the event type, the detail and the time (FR-21, BRD FR-08, BRD FR-35, BRD FR-36).
- [ ] **Given** any element of the action row, the surplus panel or the escalation panel is inspected, **When** the client source is searched, **Then** **no user-visible literal string is written in a component** — every label, reason, button caption and prompt comes from the locale bundle (FR-22, BRD NFR-11).
- [ ] **Given** an action on the weigh view is rendered, **When** its dimensions are measured, **Then** its touch target is at least 15 mm and every operator-facing label is legible at 1.5 m (NFR-4, BRD NFR-07, BRD NFR-08).

## Technical Notes

- **The client NEVER computes the zone — it receives it.** The zone, the surplus proposal, the escalation and the component states all arrive in the session snapshot from unit 003. Two classifications of the same reading in two places is the failure mode this avoids, and it is also the reason the confirm button's disabled state can be trusted: the button renders the same verdict the service will enforce. The service refuses a confirmation whose *current* zone is not `OK`, so the gate is enforced in the domain layer and the disabled button is only the visual half of it (FR-10, BRD FR-18, BRD AC-04).
- **A disabled action always states its reason.** The confirm action carries a `reason` field alongside its `enabled` flag, and the reason is rendered next to the button — never a silently dead control on a gloved terminal, which is a support call rather than a design choice. The reason distinguishes the cases the operator can actually act on: the weight is still short, the weight is over tolerance, the scale is not connected, the scale is out of calibration, and an override is required (FR-10, BRD FR-19, BRD IR-13, FR-7).
- **The surplus ratio is `surplus ÷ totalRemainingTarget`, never a hard-coded constant.** The prototype's `1.026` is its own worked example — a `+2.4 g` surplus on a `94.0 g` target in a prototype whose remaining total happened to be `94.0 g` — and it is correct only for that one example. The factor is derived per proposal from the surplus the API reports and the remaining total the API reports; the client does not carry a constant and does not re-derive the revised targets, it renders them (FR-12, A-08, BRD R-03).
- **The surplus panel is shown only when the API reports a surplus**, mirroring the prototype's `surplus.classList.toggle("on", z === "over")`. Its visibility rule is a rendering concern and belongs to this unit; the domain exposes the surplus and the proposal and never decides what the operator should see (FR-11, BRD FR-20).
- **Accepting and declining the proposal are both legitimate.** The proposal is presented for acceptance and is not applied until the operator accepts it; declining is recorded and the batch is held. The UI does not push the operator toward acceptance — a panel that only offers one way forward is a nudge dressed as a control (FR-12, BRD FR-24).
- **The escalation prompt states that a reason is required, and enforces it.** The reason field is mandatory at the request boundary, not merely required by convention, and the supervisor's authentication is a separate thing from the reason: neither alone completes the override. The operator who raised the request cannot authorise it, so the prompt never offers the operator's own credentials as a way through (FR-13, BRD AC-06, BRD FR-35, BRD NFR-12).
- **Progression is a domain transition, not a UI navigation.** The `DONE` state of the confirmed component and the `ACTIVE` state of the next are one atomic transition with the record write, and the client renders the resulting snapshot. The client does not decide which component is next and does not compute "the first pending one" from its own copy of the rail — it renders the `activeComponentId` the API reports (FR-14, BRD FR-14).
- **`DONE` is terminal and the rail says so.** A `DONE` row is not selectable; a touch on it is refused with a stated reason rather than being silently ignored, because a control that does nothing when touched teaches the operator that the screen is unreliable (FR-14, C-08).
- **Abandon / reset returns the dispense to zero.** It writes no record, it does not mark the component `DONE`, and the component returns to `PENDING`. It is the operator's escape from a mis-dispensed component, so it must never leave a partial quantity behind (FR-10, BRD FR-19).
- **Manual scale reselection is a privileged action.** It is offered only to a supervisor, requires authentication, and is audited with the actor, the event type, the detail and the time. Credentials are never shared between roles, so the prompt never accepts the operator's credentials as a substitute (FR-21, BRD FR-08, BRD FR-35, BRD FR-36, BRD NFR-13).
- **Every operator-facing string is a locale key** (FR-22, BRD NFR-11): the button captions, the disabled reasons, the surplus heading and footnote, the escalation prompt and the mandatory-reason notice. A test asserts the client source contains no user-visible literal strings.
- The action row's function keys (F1 confirm, F2 re-tare, F4 quit) and their touch equivalents dispatch the **same** actions; a key press and a tap are not two code paths (BRD FR-19, FR-22).
- Touch targets ≥ 15 mm and legibility at 1.5 m are testable assertions, not aspirations — a component test measures the rendered target.

## Dependencies

### Requires
- Unit 003's session snapshot, zone and confirm endpoint (`004-gate-confirmation-on-zone`).
- Unit 003's surplus proposal and its accept/decline path (`005-detect-overdose-and-calculate-surplus`, `006-apply-surplus-compensation`).
- Unit 003's escalation, supervisor authorisation and discard-and-re-weigh path (`007-escalate-non-compensable-overdose`).
- Unit 003's component progression and the `DONE` terminal rule (`008-advance-to-next-component`).
- Unit 002's recipe rail with each component's state.
- Unit 008's signed-in operator identity and the supervisor authentication prompt.
- The locale bundle endpoint from unit 006 (story 005).

### Enables
- 004-review-and-print-ticket
- 005-show-peripheral-degraded-states

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| The zone changes between the operator seeing `OK` and pressing confirm | The confirmation is refused; the gate reads the **current** zone at confirmation time, not the zone last displayed (FR-10, BRD AC-04). |
| The confirm request is submitted twice | The second attempt does not write a second record; confirmation is idempotent per component in a session. |
| The last component in the recipe is confirmed | No component becomes `ACTIVE`; the session moves to the completion view (FR-15, BRD FR-14). |
| A `PENDING` component out of recipe order is selected | Accepted; the weight resets to zero; the previously `ACTIVE` component returns to `PENDING` and no record is written for it (FR-14, BRD FR-19). |
| The scale disconnects while the escalation prompt is open | The confirmation still requires the scale to be connected; the override remains valid for its scope and validity window (BRD IR-13, BRD FR-13). |
| The supervisor is also the requesting operator | The request cannot be self-authorised; a distinct authenticated supervisor must authorise it (BRD FR-35, BRD NFR-12). |
| The supervisor authenticates but leaves the reason blank | The override is refused and the reason prompt stays open — the reason is mandatory (BRD AC-06). |
| The escalation is declined, or no supervisor authorises it | The weighing is not confirmed and the batch is held (BRD FR-13). |
| The surplus is `0.0000 g` after rounding | No proposal is presented; the revised targets equal the originals and the panel does not appear (FR-12, BRD FR-21). |
| There are no remaining components to absorb the surplus | No proposal is produced; the session escalates instead (FR-12, BRD FR-13). |
| The operator abandons a component mid-dispense | The weight returns to zero, no record is written, and the component returns to `PENDING` (FR-10, BRD FR-19). |
| Power is lost immediately after the confirmation response | The confirmed weighing survives; on resume the component is `DONE` and the next is `ACTIVE` (NFR-3, BRD NFR-05). |
| The API is unreachable when the operator confirms | The action is disabled with a stated reason; the client does not confirm optimistically and does not show a success it cannot verify (BRD FR-20). |
| The locale changes while a panel is open | The open panel's text re-renders in the new language from the locale bundle, with no redeployment (BRD FR-22, BRD NFR-11). |

## Out of Scope

- The confirmation gate, the zone and the tolerance rules — unit 003 (`004-gate-confirmation-on-zone`, FR-9, FR-10).
- Surplus detection and the compensability decision — unit 003 (`005-detect-overdose-and-calculate-surplus`, FR-11).
- The proportional recalculation and the revised targets — unit 003 (`006-apply-surplus-compensation`, FR-12).
- The supervisor override's mechanics, scope, expiry and audit entry — unit 003 (`007-escalate-non-compensable-overdose`, FR-13, BRD FR-35).
- Component progression and the `DONE` terminal transition — unit 003 (`008-advance-to-next-component`, FR-14).
- The scale-selection rule and the scale's calibration state — unit 003 (`001-select-scale-automatically`, FR-7).
- Operator identity and the authentication mechanism — unit 008 (FR-18, FR-21).
- The recipe's content, ordering and tolerance rules — unit 002 (FR-3).
- The ticket, the completion summary and the print controls — unit 006 and story 004 (FR-17).
- The peripheral status strip and the other degraded states — story 005 (FR-19).
