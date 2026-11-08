---
stage: implement
bolt: 026-007-weighingms-ui
created: 2026-11-06T23:40:00Z
---

# Implementation Walkthrough: Confirm and Advance (Bolt 026)

## What was built

**The action row, the surplus panel and the escalation panel.**

```text
src/007-weighingms-ui/
├── api/
│   └── endpoints.ts       + confirm, select, surplus, escalate, authorise
├── state/
│   └── action-store.ts    Zustand — the confirm action's flag AND reason
└── screens/weigh/
    ├── WeighScreen.tsx
    ├── ActionRow.tsx      the confirm, its reason, and the abandon
    ├── SurplusPanel.tsx   the surplus, the factor, the revised targets
    └── EscalationPanel.tsx  the supervisor's override
```

## The five rules, and where each is enforced

### 1. The confirm button is enabled by the API's zone

**`confirmActionFor(zone, extras)`** — a **pure function** in the domain
layer of the client, and it takes the **reported** zone.

**It returns BOTH the flag and the reason** — and the reason is **never
empty**, in any state. A disabled action with no reason is the failure the
story names: *"never a silently dead control on a gloved terminal, which is
a support call rather than a design choice."*

**And the reason distinguishes the cases** the operator can act on — the
weight is short, near, over, under; the scale is disconnected; the
calibration has expired; an override is required; the API is unreachable.

**And the client never confirms optimistically.** An unreachable API
disables the action with a stated reason, and the client shows no success
it cannot verify (BRD FR-20).

### 2. The progression is the API's

**After every action the client re-reads the session** and renders the
`activeComponentId` the API reports.

**It never computes "the first pending one" from its own rail** — and the
source test proves it: no `.find()` over a `PENDING` state anywhere in
`screens/`.

### 3. The surplus factor is RENDERED

**The panel shows the API's `factor`, `surplusAmount`, `surplusPercent` and
`recalculated[]`** — and the source test proves the client carries **no**
constant and derives **no** factor and **no** revised target.

### 4. Both ways forward are offered

**Accept and decline are rendered equally**, and both are live. A panel
that only offers one way forward is a nudge dressed as a control.

**And declining is recorded, and the batch is HELD** — the client does not
confirm it.

### 5. The escalation prompt states that a reason is required

**The prompt says so**, and the authorise button is **disabled without a
reason** — so the requirement is visible *before* the press, not after.

**And the prompt asks for a DISTINCT supervisor's** id and secret — it
never offers the operator's own credentials as a way through.

**And the state is explicit** — `data-awaiting` on the panel, and the
awaiting-supervisor notice — and the weighing is **not** confirmed while
it is open.

## The API the client uses — and it already existed

| The client calls | The body's ONLY field |
|---|---|
| `POST /api/session/confirm` | `componentId` |
| `POST /api/session/select` | `componentId` |
| `POST /api/surplus/accept` | `componentId` |
| `POST /api/surplus/decline` | `componentId` |
| `POST /api/escalation/authorise` | `authorisationId`, `supervisorId`, `secret`, `reason` |

**Every request body carries the component id and nothing else** — no
zone, no quantity, no operator, no factor. The zone is the domain's, the
quantity is the device's, the operator is the session's, and the factor is
the rule's.

## What the client does NOT do

- **It does not compute a zone.** It renders the API's.
- **It does not compute a factor.** It renders the rule's.
- **It does not compute a progression.** It renders the API's
  `activeComponentId`.
- **It does not derive a revised target.** It renders the rule's.
- **It does not confirm optimistically.** It shows what the API says.
