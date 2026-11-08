---
stage: plan
bolt: 026-007-weighingms-ui
created: 2026-11-06T23:20:00Z
---

# Implementation Plan: Confirm and Advance (Bolt 026)

## What this bolt is

**The action row, the surplus panel and the escalation panel** — the three
controls the operator uses to act on what the API reports.

**A `simple-construction-bolt`** — plan → implement → test. And the
client owns no functional requirement.

## The facts I checked before planning

**Every API this bolt needs already exists, and every quantity is already
computed by the domain.** That is the decisive fact — the client has
nothing to calculate.

| The client needs | What exists |
|---|---|
| The zone | `GET /api/session/zone` — the domain's |
| The confirm | `POST /api/session/confirm` — the body's **only** field is `componentId`; the zone and the quantity are the domain's |
| The session and the rail | `GET /api/session` — `activeComponentId` and the component states |
| The surplus | `GET /api/surplus` — `overshoot`, `surplusAmount`, `unit`, `surplusPercent` |
| The proposal | `POST /api/surplus` — `factor`, `recalculated[]` with `originalTarget` and `revisedTarget`, **every quantity a string** |
| The decision | `POST /api/surplus/accept` and `/decline` — the body's **only** field is `componentId` |
| The escalation | `GET /api/escalation/:componentId` |
| The override | `POST /api/escalation/authorise` — `authorisationId`, `supervisorId`, `secret`, `reason` |

**And the surplus controller's own header says it:**

> *"The body carries no `factor`, no `surplusAmount` and no
> `revisedTarget`. The factor is **computed** by the one compensation
> implementation, the surplus is the **reading's**, and the revised targets
> are the **rule's**. A client that could assert any of them could assert a
> recalculation it liked (ADR-038)."*

**So the panel renders the factor, the surplus and the revised targets —
and computes none of them.**

## The five decisions

### 1. The confirm button is enabled by the API's zone — and NEVER optimistically

**The story is explicit, and it is a security-shaped rule:**

> *"the confirm action is enabled only when the reported zone is `OK`, and
> it is disabled in every other zone with the **reason** for its
> unavailability shown to the operator — the client computes no zone of its
> own and takes the zone as received."*

**And a disabled action ALWAYS states its reason:**

> *"A disabled action always states its reason. … never a silently dead
> control on a gloved terminal, which is a support call rather than a
> design choice."*

**So the button carries an `enabled` flag AND a `reason` key**, and the
reason is rendered next to it.

**And the reason distinguishes the cases the operator can act on** — the
weight is still short, the weight is over tolerance, the scale is not
connected, the scale is out of calibration, an override is required.

**And the client does NOT confirm optimistically.** The edge case: *"The
API is unreachable when the operator confirms → the action is disabled with
a stated reason; the client does not confirm optimistically and does not
show a success it cannot verify" (BRD FR-20).**

### 2. The progression is the API's — the client renders `activeComponentId`

> *"Progression is a domain transition, not a UI navigation. … the client
> renders the resulting snapshot. **The client does not decide which
> component is next and does not compute 'the first pending one' from its
> own copy of the rail** — it renders the `activeComponentId` the API
> reports."*

**So after a confirmation the client re-reads the session and renders what
it says.** It never computes the next component itself.

**And a `DONE` row's touch is REFUSED with a stated reason** — *"a control
that does nothing when touched teaches the operator that the screen is
unreliable."* So the touch is not silently ignored; it states that the
component is already complete.

### 3. The surplus factor is RENDERED, never derived

> *"The surplus ratio is `surplus ÷ totalRemainingTarget`, **never a
> hard-coded constant**. The prototype's `1.026` is its own worked example
> … and it is correct only for that one example. The factor is derived per
> proposal from the surplus the API reports and the remaining total the API
> reports; **the client does not carry a constant and does not re-derive
> the revised targets, it renders them**."*

**So the panel shows the API's `factor`, the API's `surplusAmount`, and
the API's `recalculated[]` — and the source test proves the client carries
no constant and no derivation.**

### 4. Accepting AND declining are both offered

> *"Accepting and declining the proposal are both legitimate. … **The UI
> does not push the operator toward acceptance** — a panel that only offers
> one way forward is a nudge dressed as a control."*

**So both buttons are rendered, equally.** And declining is **recorded** and
the batch is **held** — the over-dose is not confirmed.

### 5. The escalation prompt states that a REASON IS REQUIRED, and enforces it

> *"The escalation prompt states that a reason is required, and enforces
> it. The reason field is **mandatory at the request boundary**, not merely
> required by convention, and the supervisor's authentication is a separate
> thing from the reason: **neither alone completes the override**."*

**And the prompt never offers the operator's own credentials as a way
through** — *"the operator who raised the request cannot authorise it."*

**And the prompt enters an explicit AWAITING-SUPERVISOR state** in which
the weighing is **not** confirmed.

## The architecture

```text
src/007-weighingms-ui/
├── api/
│   └── endpoints.ts       + confirm, select, surplus, escalate, authorise
├── state/
│   └── action-store.ts     Zustand — the action row's state
└── screens/weigh/
    ├── WeighScreen.tsx
    ├── components.tsx      + the action row
    ├── SurplusPanel.tsx
    └── EscalationPanel.tsx
```

## The tests

| Suite | What it proves |
|---|---|
| **Unit — the action row** | The button is enabled **only** for the zone `OK`; every other zone disables it **with a reason**; the reason is never empty. |
| **Unit — the progression** | After a confirmation the client renders the API's `activeComponentId` — and **never** computes the next component from its own rail. |
| **Component — the surplus panel** | The surplus, the percentage, the factor and each component's original and revised targets are **rendered**; **both** accept and decline are offered; declining is recorded and the batch is held. |
| **Component — the escalation panel** | The prompt states that a reason is required; the override is refused without one; the state is **awaiting supervisor** and the weighing is **not** confirmed. |
| **Component — the source** | The client carries **no** surplus constant, **no** factor derivation, and **no** zone computation; **no** operator-facing literal. |
| **Component — the targets** | Every action's touch target is **≥ 15 mm** and legible at 1.5 m. |

## What this bolt does NOT do

- **The review-and-print screen** — story `004`.
- **The peripheral degraded states** — story `005`.
- **The end-to-end Playwright suite** — the last UI bolt.
- **The manual scale reselection's mechanics** — the API's. The client
  offers the action to a supervisor and posts it; the authorisation is
  unit `008`'s.
