---
stage: design
bolt: 015-003-weighing-station
created: 2026-11-06T06:55:00Z
---

## Technical Design: 003-weighing-station (bolt 015)

### Architecture Pattern

**Hexagonal (ports and adapters), with the seam owned by the consumer** — the
same shape as the previous bolts.

This bolt adds **two domain services** (the detector and the calculator), **two
value objects** (the proposal and the recalculation), and **one repository**.

**And it adds NO new port over the outside world.** The zone comes from bolt
`014`'s engine; the target, the tolerance and the remaining components come
from unit `002`'s working copy; the reading comes from the session.

### Layer Structure

```text
┌──────────────────────────────────────────────────────────────────┐
│ Presentation                                                     │
│   SurplusController     GET  /api/surplus                       │
│                        POST /api/surplus/accept                 │
│                        POST /api/surplus/decline                │
│   (Zod schemas on the boundary)                                   │
├──────────────────────────────────────────────────────────────────┤
│ Application                                                      │
│   DetectOverdose         the over-dose and its quantities         │
│   ProposeCompensation    the proposal and its decision           │
├──────────────────────────────────────────────────────────────────┤
│ Domain                                                           │
│   SurplusProposal        the aggregate — presented, then decided   │
│   ComponentRecalculation one component's original and revised     │
│   OverdoseDetector       detects and quantifies                   │
│   CompensationCalculator the proportional rule — ONE implementation │
│   SurplusProposalRepository  THE PORT                            │
├──────────────────────────────────────────────────────────────────┤
│ Infrastructure                                                   │
│   CompositionRoot              binds the port in ONE place        │
│   ProposalDatabase             the table and migration            │
│   SqliteSurplusProposalRepository   append-only                  │
└──────────────────────────────────────────────────────────────────┘
```

### API Design

#### `GET /api/surplus` — the over-dose and its quantities

`200` with the over-dose facts, or `200` with `surplus: null` when the zone
is not `OVER`.

**The body carries BOTH quantities**, under their own names:

```json
{
  "surplus": {
    "componentId": "DYE-4471-Y",
    "value": "96.4000",
    "unit": "g",
    "overshoot": "1.9000",
    "surplusAmount": "2.4000",
    "surplusPercent": "2.02",
    "factor": "0.025532",
    "compensable": true,
    "recalculated": [
      { "componentId": "AUX-0101", "originalTarget": "20.0000", "revisedTarget": "20.5106" }
    ]
  }
}
```

**And `surplusPercent` is `null` when the target is zero** — the percentage
is undefined there, and it is **omitted**, not zero.

#### `POST /api/surplus/accept` and `POST /api/surplus/decline`

The operator's decision on a presented proposal.

| Status | Meaning | Body |
|---|---|---|
| **200** | The proposal was accepted or declined | `{ proposal: {...} }` |
| **400** | The body is not a decision | `{ error: "VALIDATION_ERROR" }` |
| **401** | No operator session | `{ error: "UNAUTHENTICATED" }` |
| **404** | There is no proposal for this component | `{ error: "PROPOSAL_NOT_FOUND" }` |
| **409** | The proposal is already decided | `{ error: "PROPOSAL_ALREADY_DECIDED" }` |

**There is no `factor` field, no `surplusAmount` field and no `revisedTarget`
field in either body.** The proposal is **the domain's**, computed by the
rule; a client that could assert a factor could assert any recalculation it
liked.

### Data Model

#### `surplus_proposals` — append-only

| Column | Type | Notes |
|---|---|---|
| `proposal_id` | `TEXT NOT NULL PRIMARY KEY` | The proposal's identity — a **uuid** |
| `component_id` | `TEXT NOT NULL` | The component that was over-dosed |
| `session_id` | `TEXT NOT NULL` | The session it belongs to |
| `surplus_amount` | `TEXT NOT NULL` | The excess over the target |
| `overshoot` | `TEXT NOT NULL` | The excess over the tolerance maximum |
| `surplus_percent` | `TEXT NULL` | `null` when the target is zero |
| `factor` | `TEXT NOT NULL` | The **computed** factor — never a constant |
| `status` | `TEXT NOT NULL CHECK (status IN ('PROPOSED','ACCEPTED','DECLINED'))` | The operator's decision |
| `recalculated_json` | `TEXT NOT NULL` | The revised targets, as data |
| `operator_id` | `TEXT NOT NULL` | Who raised it / decided it |
| `reason` | `TEXT NULL` | The reason, when one was given (BRD FR-24) |
| `created_at` | `TEXT NOT NULL` | When the proposal was made |
| `decided_at` | `TEXT NULL` | When it was decided |
| `recorded_at` | `TEXT NOT NULL` | When the row was written |

**The proposal is APPEND-ONLY**, and the decision is a **new row** carrying
the same `proposal_id` — the same pattern as ADR-029's `superseded_at` idea
but with the mutation on the **new** row instead of the old one. The original
`PROPOSED` row is untouched, so the history shows that the proposal was made
before it was decided.

**And `factor` is stored.** The story requires it: *"the implementation
records which rule it applied, so that a different answer from FCI to Q-06
changes one place rather than requiring a rewrite."* A stored factor is the
**evidence** of which rule produced the revision.

### The proportional rule — ONE implementation

**The compensability decision and the proposal generation share one
implementation**, and the story requires it: *"the compensability check and
the proposal generation share one rule implementation so they can never
disagree."*

`CompensationCalculator` therefore does both:

```text
propose(surplus, remainingComponents) →
  { factor, recalculated[], compensable, reason? }
```

**And it computes the factor from THIS surplus and THIS remaining total** —
never the prototype's `1.026`.

### The arithmetic, in fixed-point decimal

| Step | Formula | Rounding |
|---|---|---|
| The factor | `surplus ÷ totalRemainingTarget` | half-up, 4 dp |
| A revised target | `originalTarget × (1 + factor)` | half-up, 4 dp |
| The surplus percentage | `surplus ÷ target × 100` | half-up, 4 dp |

**Every one of them is `decimal.js`.** No float appears in the factor, the
revised targets, or the percentage (BRD NFR-16, C-11).

**And the story's worked numbers are the test suite.** With a surplus of
`2.4000 g` and a remaining total of `94.0000 g`:

- the factor is `0.025532`;
- a `20.0000 g` component revises to `20.5106 g`;
- a `74.0000 g` component revises to `75.8894 g`;
- and the two sum to `96.4000 g` — the original plus the surplus.

**The sum is preserved**, and that is the property the story fixes: *"the
surplus is fully and only distributed."*

### The compensability decision

The surplus is **compensable** when:

1. there is **at least one** remaining component (no remaining components →
   the surplus cannot be absorbed);
2. the surplus is **not zero** (nothing to distribute);
3. **every** revised target is **at or above zero**.

Otherwise it is **not compensable**, and the session escalates — bolt
`016`'s path.

### Security Design

| Concern | Approach |
|---|---|
| **Session** | Required (ADR-020). The operator comes from `req.currentOperator`. |
| **A client-supplied factor** | There is **no** `factor` field in the decision body. The factor is **computed**. |
| **A client-supplied revised target** | There is **no** `revisedTarget` field. The recalculation is the rule's. |
| **A client-supplied surplus** | There is **no** `surplusAmount` field. The surplus is the reading's. |
| **Applying without a decision** | The proposal is **presented, not applied**, and the apply path is only reachable through the acceptance — which is a **state transition** on a `PROPOSED` proposal. |
| **Deciding twice** | The decision path refuses a proposal that is already decided — a `409`. The original row is untouched either way. |
| **Immutability** | Append-only, with the triggers. |

### NFR Implementation

| Requirement | Design approach |
|---|---|
| **BRD NFR-16 / C-11 — fixed-point, never float** | Every division and multiplication is `decimal.js`, half-up at the storage precision. |
| **BRD R-03 — A-08 is the highest-risk rule** | The factor is **computed**, the rule is **one implementation**, and the applied factor is **stored** — so a different answer from FCI changes one place. |
| **BRD FR-24 / DR-01 — the compensation is recorded** | The proposal's row carries the factor, the status, the operator and the reason, and it is retained ≥ 5 years. |
| **BRD FR-22 — the revised targets are presented for acceptance** | The proposal is **not** applied until the operator accepts it. |

### Integration Plan

**Bound in the composition root, and nowhere else:**

```text
src/api/server.ts
  └── buildWeighingStationModule({
        workingCopy: recipes.workingCopy,   // unit 002's
        selection: new ScaleSelectionAdapter(scales.registry),
        sessions: ...,
        records: ...,
        proposals: new SqliteSurplusProposalRepository(...),
      })
```

**What this bolt adds to other units: nothing.** The zone is bolt `014`'s, the
recipe is unit `002`'s, the reading is the session's.

**What this bolt adds to the API surface:** three paths under `/api/surplus`.

### Testing Plan

| Suite | What it proves |
|---|---|
| **Unit — the detector** | The overshoot and the surplus are **different quantities**, with the story's worked numbers; a non-`OVER` zone produces **no** surplus; a zero target omits the percentage; the surplus is not accumulated. |
| **Unit — the calculator** | The factor is `0.025532` for one total and `0.012766` for another — the story's two cases, proving it is a formula; the revised targets are the story's numbers; the sum is preserved; the ratio is preserved; a zero surplus produces no proposal; a negative revised target is not compensable. |
| **Unit — the proposal** | It is **presented, not applied**; the decision is recorded; the original row is untouched. |
| **Integration — the endpoints** | The surplus is reported with both quantities; the accept and decline paths; a `409` on a second decision; a `401` without a session. |
| **Persistence** | The proposal round-trips; the triggers abort an update and a delete; the closed-set `CHECK` refuses a fourth status. |
| **Security** | No session → `401`; a client-supplied factor is dropped; the diagnostics never leak. |

### Open points carried forward

1. **A-08 / Q-06** — FCI's question. The rule is **one implementation** and
   the applied factor is **stored**, so the answer changes one place.
2. **The escalation** — bolt `016`. The `NOT_COMPENSABLE` branch ends
   there.
3. **The revised targets' effect on the session** — the session's
   component targets are unit `002`'s facts, and a revision must not mutate
   the recipe. The revision lives on the **proposal**, and the session
   consults it. Bolt `017`'s progression reads it.
