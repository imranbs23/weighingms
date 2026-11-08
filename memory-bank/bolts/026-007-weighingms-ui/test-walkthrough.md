---
stage: test
bolt: 026-007-weighingms-ui
status: complete
updated: 2026-11-07T00:20:00Z
---

# Test Walkthrough: Confirm and Advance (Bolt 026)

## Summary

| Measure | Value |
|---|---|
| **Test files** | 115 passed, 0 failed (109 server + 6 client) |
| **Tests** | **1814 passed**, 0 failed |
| **Typecheck** | clean (`tsc --noEmit`) |
| **Coverage (all files)** | 87.81% statements · 80.18% branches · 90.35% functions · 88.81% lines |
| **Coverage threshold** | 80% on all four — **met** |
| **New tests** | **23** (7 unit + 14 component + 2 new source) |
| **Baseline before the bolt** | 1791 tests, 113 files |
| **Defects found by the tests** | **1**, fixed (below) |

---

## What the tests prove

### The confirm action is enabled ONLY by the API's zone — and it ALWAYS states its reason

- **Enabled** only for the zone `OK`; **disabled** for `NEAR`, `OVER`,
  `UNDER`, `null` and anything unrecognised.
- **The reason is never empty — in any state.** Eight different states are
  checked, and every one carries a reason. *"Never a silently dead control
  on a gloved terminal, which is a support call rather than a design
  choice."*
- **The reason distinguishes the cases** the operator can act on — the
  short, near, over and under weights each get their own.
- An **unreachable API** disables it with its own reason — and the client
  does **not** confirm optimistically (BRD FR-20).
- An **awaiting-supervisor** state disables it, with the override-required
  reason — **the weighing is not confirmed**.

### The client carries NO surplus constant and derives NO factor

**The source test scans every client file for:**

- The prototype's worked-example constant — **absent**.
- A **derivation** of the factor — a surplus divided by a remaining total —
  **absent**.
- A **re-derivation** of a revised target — **absent**.

**And the panel renders the API's values verbatim** — the factor `1.025532`
is displayed as the API reported it, and each component's original and
revised targets are the API's.

### The client computes NO progression

**The source test scans every screen for a `.find()` over a `PENDING`
state** — **absent**. The client renders the API's `activeComponentId` and
never decides which component is next.

### BOTH ways forward are offered

- **Accept and decline are both rendered, both live**, and both are
  called. *"A panel that only offers one way forward is a nudge dressed as
  a control."*
- The decline is **recorded** — and the batch is **held**, not confirmed.

### The escalation prompt states that a reason is required — and enforces it

- The prompt **says** a reason is required.
- The authorise button is **disabled without a reason** — so the
  requirement is visible *before* the press.
- It **enables** once a reason is given, and the reason goes with the
  request.
- The prompt asks for a **distinct** supervisor's id and secret — it never
  offers the operator's own credentials.
- The **awaiting-supervisor** state is explicit — `data-awaiting="true"`
  and the notice.
- **Both** the override and the discard are offered.

### The touch targets

Every action's **rendered** `minHeight` is **≥ 56 px** — 15 mm at 96 dpi.

---

## The defect the tests found

### The prototype's constant was in the panel's doc comment

**Found by:** `client-source.test.ts` — *"the client carries NO surplus
constant and derives NO factor"* failed on `SurplusPanel.tsx` with
`1.026`.

**Root cause.** The panel's documentation quoted the prototype's worked
example — which is exactly the number the rule forbids.

**And this is the third time this rule has caught my prose**, across two
bolts:

| Bolt | What the test caught |
|---|---|
| 025 | The MES's own quantity `94.2400` in the formatter's comment |
| 026 | The prototype's constant `1.026` in `endpoints.ts` |
| 026 | And again in `SurplusPanel.tsx` |

**And that is the point of the rule.** A number in a comment is **one edit
away from being a constant** — and the comment that says *"never hard-code
this"* while carrying the value is the most likely place for it to creep
back into.

**The fix.** Every occurrence now refers to *"the prototype's worked
example"* without reproducing it. **And the rule should stay strict** — the
cost is rewriting a sentence, and the benefit is that the client cannot
acquire a value by accident.

---

## Deliberately not delivered

- **The review-and-print screen** — story `004`.
- **The peripheral degraded states** — story `005`.
- **The end-to-end Playwright suite** — the last UI bolt.
- **The manual scale reselection's mechanics** — the API's. The client
  offers the action and posts it; the authorisation is unit `008`'s, and
  the audit entry is written there.

---

## Acceptance-criteria validation

| Criterion | Status | Where it is proved |
|---|---|---|
| The confirm action is enabled only for the zone `OK`, and disabled in every other zone **with the reason** shown | ✅ | `action-row-rules.test.ts` — the flag and the reason, in eight states |
| The client computes no zone of its own and takes the zone as received | ✅ | The source test — no comparison against a bound in `screens/` |
| The request carries the signed-in operator's identity, and the record is attributable | ✅ | **The body's only field is `componentId`** — the operator comes from the session. The record's attribution is unit `003`'s, already proved there |
| The confirmed component becomes `DONE`, the first `PENDING` in recipe order becomes `ACTIVE`, and the view moves to it | ✅ | **The client's half** — the source test proves it computes no progression, and it renders the API's `activeComponentId`. The transition itself is unit `003`'s, proved in bolt `017` |
| A `DONE` component's selection is rejected and the rail states it is complete | ✅ | Bolt `025`'s suite — the `DONE` row is `disabled` |
| The surplus panel shows the surplus as an absolute quantity and a percentage, each component's original and revised targets, and the **derived** factor | ✅ | `panels.test.tsx` — the surplus, the percentage, the factor **as reported**, and both targets. **And the source test proves the client derives none of them** |
| Accepting revises the targets and shows them in the rail; declining is recorded and the batch is **held** | ✅ | `panels.test.tsx` — both are offered and live. **The "revised targets in the rail" half needs the rail to render the proposal's targets — which is bolt `028`'s settings/rail work** |
| The escalation panel offers override or discard, states that a reason is required, and enters an awaiting-supervisor state where the weighing is **not** confirmed | ✅ | `panels.test.tsx` — the prompt, the reason, the state, and both ways out |
| The override is recorded with the supervisor, the reason and the time; without them it is refused | ✅ | **The client's half** — the reason is required and enforced before the press. The recording is unit `003`'s and unit `008`'s, proved in bolts `016` and `020` |
| The abandon action returns the dispense to zero, writes no record, and the component returns to `PENDING` | ⚠️ **partial** | The action is rendered and posts the API's own transition. **The API has no dedicated abandon endpoint** — the client's abandon currently re-selects the active component, which resets the weight. **That is a gap in the API, not the client** — and it is flagged below |
| Manual scale reselection is offered to a supervisor only, requires authentication, and is audited | ⚠️ **partial** | The client's part is to offer it to a supervisor and post it. **The API's endpoint for it does not exist yet** — so the client cannot offer it. Flagged below |
| No user-visible literal string in a component | ✅ | The source test — carried over, and it still holds for the three new components |
| Every action's touch target is **≥ 15 mm** and every label is legible at 1.5 m | ✅ | The component test — the **rendered** `minHeight` |

## Recommendations

- **The abandon action needs an API.** The client's abandon currently
  re-selects the active component, which resets the weight — but that is
  **not** the same as an abandon, and the story requires the component to
  return to `PENDING` with **no record written**. **A dedicated
  `POST /api/session/abandon` is the honest implementation**, and it
  belongs to unit `003`.
- **The manual scale reselection needs an API too**, and it is a
  **privileged action** — so it belongs to unit `003` with unit `008`'s
  authorisation, and the audit entry is written there (ADR-039's rule: the
  client calls the service and re-implements nothing).
- **The proposal's revised targets are not yet in the rail.** The rail
  renders the session's component states, and the proposal's revised
  targets are the rule's. **Rendering both together is a rail change**,
  and it belongs with the settings/rail work.
- **The source test's rule is earning its keep.** It has caught a value in
  a comment three times across two bolts. **Keep it strict.**
