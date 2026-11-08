---
stage: model
bolt: 015-003-weighing-station
created: 2026-11-06T06:35:00Z
---

## Static Model: 003-weighing-station (bolt 015)

### Entities

- **SurplusProposal**: the recalculation offered to the operator — `surplusAmount`,
  `surplusPercent?`, `factor`, `recalculatedComponents[]`, `status`
  (`PROPOSED` | `ACCEPTED` | `DECLINED`), `createdAt`.

  It is **presented, not applied**. The operator accepts it; only then are
  the remaining targets revised. So the proposal carries its own **status**,
  and the status is the record of what the operator decided.

- **ComponentRecalculation**: one component's original and revised target —
  `componentId`, `originalTarget`, `revisedTarget`.

### Value Objects

| Value object | Shape | Rules |
|---|---|---|
| **Overshoot** | a `WeightValue` | `value − (target + tolerance)` — **how far past the tolerance maximum**. Never negative. |
| **Surplus** | a `WeightValue` | `value − target` — **the excess over the target**. This is what the status line says ("SURPLUS +2.4 g") and what the panel shows. |
| **SurplusFactor** | a decimal | `surplus ÷ totalRemainingTarget` — **computed, never a constant** (A-08). |
| **Compensability** | `COMPENSABLE` \| `NOT_COMPENSABLE` | The decision, and its reason. A **closed set of two**, because there are exactly two branches: a proposal, or an escalation. |

### The three quantities, and why they must not be conflated

This is the whole of the story's second technical note, and it is the thing
most likely to be implemented wrongly:

| Quantity | Formula | What it means |
|---|---|---|
| **Overshoot** | `value − (target + tolerance)` | How far past the **tolerance maximum** the reading is |
| **Surplus** | `value − target` | The excess over the **target** — the status line's "SURPLUS +n" |
| **Factor** | `surplus ÷ totalRemainingTarget` | The proportion each remaining target grows by |

**The story's worked example pins them apart:**

> *"a target of `94.0000 g` and a tolerance of `0.5000 g`, when the reading is
> `96.4000 g`, then an over-dose is detected and the surplus above the
> tolerance maximum is `1.9000 g`"*

That is the **overshoot**: `96.4000 − 94.5000 = 1.9000`.

> *"a reading of `96.4000 g` against a target of `94.0000 g`, when the surplus
> is calculated, then the surplus is the amount above the **target**
> (`+2.4000 g`)"*

That is the **surplus**: `96.4000 − 94.0000 = 2.4000`.

**So the story's first acceptance criterion calls the overshoot "the
surplus", and its third calls the surplus "the surplus".** They are two
different quantities, and the story's own worked numbers differ by exactly
the tolerance — `1.9000` and `2.4000`. The implementation therefore carries
**both**, under their own names, and the API reports both. The story's prose
is ambiguous; the numbers are not.

### The factor is DERIVED, and the prototype's constant is not a rule

**This is assumption A-08 — the BRD's own flagged highest-likelihood
misunderstanding (BRD R-03, Q-06).**

The prototype's `1.026` is **its own worked example**: a surplus of
`+2.4 g` on a `94.0 g` target, i.e. `+2.6%`, in a prototype whose remaining
total happened to be `94.0 g`.

The rule is **proportional**:

```text
factor = surplus ÷ totalRemainingTarget
revisedTarget = originalTarget × (1 + factor)
```

And the story pins **two** cases that prove it is a formula and not a
constant:

| Surplus | Remaining total | Factor |
|---|---|---|
| `2.4000 g` | `94.0000 g` | `0.025532` |
| `2.4000 g` | `188.0000 g` | `0.012766` |

A constant `1.026` is correct only for the first and **wrong** for the
second. So the factor is **computed**, and the unit brief requires the rule
to be *"tested against the proportional formula, not against the prototype's
example constant"*.

**And the sum is preserved.** The story fixes it: with a surplus of
`2.4000 g` and a remaining total of `94.0000 g`, the revised targets sum to
`96.4000 g` — the original plus the surplus, fully and only distributed.

### The compensation's scope

**Revised targets apply to the REMAINING components only.** The component
that was over-dosed is not recalculated by its own proposal; it is handled
by the over-dose path. So the proposal is computed over the components
**after** the active one.

And **no remaining components means no proposal** — the surplus cannot be
absorbed, so the session escalates.

### Aggregates

| Aggregate Root | Members | Invariants |
|----------------|---------|------------|
| **SurplusProposal** | the proposal and its recalculations | 1. It is **presented, not applied** — the status is `PROPOSED` until the operator decides. 2. The factor is **computed** from this surplus and this remaining total — never a constant. 3. The recalculated components are the **remaining** ones only. 4. The revised targets **preserve the ratio** — each is its original times `(1 + factor)`. 5. The sum of the revised targets equals the original remaining total plus the surplus, within one unit at the last stored place. 6. A **zero surplus** produces **no proposal** — there is nothing to distribute. 7. A revised target that would fall **below zero** makes the surplus **not compensable**. |

### Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| **OverdoseDetected** | The zone is `OVER` | `componentId`, `overshoot`, `surplus`, `surplusPercent?` |
| **SurplusProposed** | A compensable proposal was built | `componentId`, `factor`, `surplusAmount`, `surplusPercent?` |
| **CompensationAccepted** | The operator accepted the proposal | `componentId`, `factor`, the revised targets |
| **CompensationDeclined** | The operator declined | `componentId`, `surplusAmount` |
| **OverdoseNotCompensable** | The surplus cannot be absorbed | `componentId`, `surplusAmount`, `reason` |

### Domain Services

- **OverdoseDetector**: detects the over-dose and quantifies it. It **does
  not recompute the zone** — the zone engine owns that (bolt `014`), and a
  second implementation of the `OVER` condition would be a second answer to
  the same question.

- **CompensationCalculator**: the proportional rule. It computes the
  factor, the revised targets, and the **compensability decision** — and
  the story requires the last two to **share one implementation**, so they
  can never disagree.

### Repository Interfaces

| Repository | Entity | Methods | Persisted? |
|---|---|---|---|
| **SurplusProposalRepository** | `SurplusProposal` | `save(proposal)`, `latestFor(componentId)` | **Yes** — the story requires it: *"the proposal itself is persisted as one row per over-dose"* |

**And the applied compensation is recorded** with the authorising user and
the reason, retained ≥ 5 years (BRD FR-24, BRD DR-01). The proposal's
`status` carries the decision, and the record is **immutable** once written
— a status change is a **new** row, not an update (ADR-034's rule).

### Ubiquitous Language

- **Over-dose** — the reading is above the tolerance band.
- **Overshoot** — how far past the tolerance maximum it is.
- **Surplus** — the excess over the target.
- **Factor** — the proportion each remaining target grows by.
- **Remaining components** — the components after the active one.
- **Proposal** — the recalculation, presented for acceptance.
- **Compensable** — the surplus can be absorbed by the remaining
  components under the proportional rule.
- **Not compensable** — it cannot, so the session escalates.

---

## Constraints carried into the Technical Design

1. **The zone is NOT recomputed.** The over-dose is the `OVER` zone, and the
   zone engine owns it. This story detects and quantifies.
2. **Overshoot and surplus are DIFFERENT quantities**, and both are
   reported. Conflating them is the first way to get this wrong.
3. **The factor is COMPUTED**, never the prototype's `1.026` constant
   (A-08).
4. **Every division and multiplication is fixed-point decimal**, half-up at
   the storage precision. No float.
5. **The proposal is presented, not applied.** It is applied only on the
   operator's acceptance.
6. **Revised targets apply to the REMAINING components only.**
7. **A zero surplus produces no proposal.**
8. **A revised target below zero makes the surplus NOT compensable.**
9. **The ratio is preserved** — each revised target is its original times
   `(1 + factor)`.
10. **A zero target has no percentage** — the percentage is undefined and
    is **omitted**, not zero.
11. **The surplus is NOT accumulated** across readings — it reflects the
    latest accepted reading.
12. **The compensation is recorded** with the authorising user and the
    reason (BRD FR-24).

---

## The edge cases, answered

| Scenario | Where it is answered |
|----------|----------------------|
| A reading exactly at `target + tolerance` | Not an over-dose — the zone is `OK` and no surplus is produced |
| A reading one unit above `target + tolerance` | Over-dose detected; the overshoot is `0.0001` at the storage precision |
| The target is zero | The surplus percentage is **undefined**; it is omitted and only the absolute surplus is reported |
| The zone moves from `OVER` back to `OK` | The surplus is **withdrawn** — the zone is recomputed on every reading |
| The reading is in a different unit from the target | Rejected **before** the surplus calculation; the previous valid state is retained |
| Multiple readings arrive in the `OVER` zone | The surplus reflects the **latest** accepted reading; it is not accumulated |
| A surplus of `2.4000 g` and a remaining total of `94.0000 g` | Factor `0.025532` — a **result**, not a constant |
| A surplus of `2.4000 g` and a remaining total of `188.0000 g` | Factor `0.012766` — a constant `1.026` would be wrong here |
| A surplus of `0.0000 g` | Factor `0`; the revised targets equal the originals; **no proposal** is presented |
| No remaining components | The surplus cannot be absorbed — no proposal; escalate |
| A revised target would fall below zero | The surplus is **not compensable**; escalate |
| The operator declines | The proposal is recorded as declined; the over-dose is not confirmed; the batch is held |
| The operator accepts, then a later reading changes | The accepted proposal **stands** for the remaining components; it is not silently recomputed |

---

## Open points carried forward

- **A-08 / Q-06 is FCI's question** — and the answer changes **one place**. The
  story is explicit: *"the implementation records which rule it applied, so
  that a different answer from FCI to Q-06 changes one place rather than
  requiring a rewrite"* — and *"if the answer turns out to be 'surplus
  compensation just means displaying the excess', the compensation path is
  **deleted** rather than rewritten."*
- **The supervisor escalation** — bolt `016`. The `NOT_COMPENSABLE` branch
  ends there, and it is where the authorisation is consumed.
- **The weighing written under an override** records its `zoneAtConfirm` as
  the zone in force at confirmation — the **over-dose zone**, not `OK` — so
  the exception is visible in the record and in reporting (BRD FR-11, FR-23).
  Bolt `016` owns that.
