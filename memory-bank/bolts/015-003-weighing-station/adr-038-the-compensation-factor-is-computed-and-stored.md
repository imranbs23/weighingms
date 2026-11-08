---
bolt: 015-003-weighing-station
created: 2026-11-06T07:10:00Z
status: accepted
---

# ADR-038: The compensation factor is computed from this surplus and this remaining total, and the applied factor is stored

## Context

This is the **highest-risk rule in the build**, and the BRD says so itself:
assumption **A-08** is marked **High** risk, and BRD R-03 flags it as *"the
most likely misunderstanding in the document"*.

FR-22 says: *"Where compensable, calculate revised targets for all remaining
components preserving recipe ratio."* And the story is explicit about what
that means:

> **The compensation factor is proportional and computed, not constant.**
> `factor = surplus ÷ totalRemainingTarget`, and each remaining component's
> revised target is `originalTarget × (1 + factor)`.

The prototype in `docs/customize-weighing-station.html` uses a **constant
`1.026`**. The story says plainly what that constant is:

> *"The prototype's `1.026` is NOT a rule. It is the prototype's own worked
> example — a surplus of `+2.4 g` on `94.0 g`, i.e. `+2.6%`, in a prototype
> whose remaining total happened to be `94.0 g`. A constant of `1.026` is
> correct only for that one example and wrong for every other surplus."*

And it pins **two** cases that prove the point:

| Surplus | Remaining total | Factor |
|---|---|---|
| `2.4000 g` | `94.0000 g` | `0.025532` |
| `2.4000 g` | `188.0000 g` | `0.012766` |

**A constant `1.026` is right for the first and wrong for the second.**

And there is a second problem, which is easier to miss. **Q-06 asks FCI
directly what "surplus compensation" means**, and it is unanswered. The
story anticipates both answers:

> *"If the answer to `Q-06` turns out to be 'surplus compensation just means
> displaying the excess', the compensation path is **deleted** rather than
> rewritten."*

So the implementation has to satisfy two things at once:

1. the rule must be **correct** — proportional, computed, not a constant; and
2. the rule must be **isolated** — a different answer from FCI must change
   **one place**, not require a rewrite of the domain, the persistence and the
   endpoints.

## Decision

**The factor is computed from this surplus and this remaining total. The
proposal and the compensability decision share ONE implementation. And the
applied factor is STORED on the proposal.**

1. **`factor = surplus ÷ totalRemainingTarget`**, in fixed-point decimal,
   half-up at the storage precision. Never a constant.

2. **`revisedTarget = originalTarget × (1 + factor)`**, in fixed-point
   decimal, half-up at the storage precision.

3. **The compensability decision and the proposal generation are ONE
   implementation.** The story requires it: *"the compensability check and
   the proposal generation share one rule implementation so they can never
   disagree."*

4. **The applied `factor` is stored on the proposal row.** The story
   requires it: *"the implementation records which rule it applied, so that a
   different answer from FCI to `Q-06` changes one place rather than
   requiring a rewrite."*

5. **The sum is preserved.** The revised targets sum to the original
   remaining total plus the surplus, within one unit at the last stored
   place — *"the surplus is fully and only distributed."*

6. **The proposal is PRESENTED, not applied.** It becomes effective only on
   the operator's acceptance.

## Rationale

### Why the factor must be computed

**Because a constant is only right for the one surplus it was derived
from.**

The prototype's `1.026` is `1 + 2.4/94` — the factor for a surplus of
`2.4 g` on a remaining total of `94.0 g`. Use that same `1.026` on a
surplus of `2.4 g` against a remaining total of `188.0 g` and the revised
targets sum to `188.0 × 1.026 = 192.888 g` — a surplus of **4.888 g**
distributed when only **2.4 g** was over-dosed. **The batch would be given
more material than it needed, and the error would be invisible** — the
numbers still add up, they just add up to the wrong thing.

And the error scales with the surplus: the bigger the over-dose, the bigger
the excess material the constant injects. A recipe that consistently
over-doses by 10% would silently receive 10% extra material on every
component — and a shade that came out wrong would have **no trace** of why.

**The proportional rule distributes exactly the surplus.** With the factor
`surplus ÷ totalRemainingTarget`, every remaining target grows in
proportion, the ratio between the components is **preserved** — which is the
whole point, because the ratio *is* the shade — and the total grows by
exactly the surplus.

### Why the compensability decision and the proposal must share ONE implementation

**Because they answer the same question from two sides, and two
implementations of one question eventually disagree.**

"Is this surplus compensable?" and "what would the compensation be?" are
the same computation. If the decision is made by a rule that computes a
proposal and throws it away, and the proposal is built by a second rule,
then:

- the decision could say "compensable" while the proposal's arithmetic
  produces a negative revised target — so the operator is shown a
  proposal that is arithmetically impossible;
- or the proposal could be buildable while the decision says "not
  compensable" — so a compensable surplus escalates to a supervisor.

Either way the operator sees something the product cannot deliver. **One
implementation removes the possibility**, and the story requires it in as
many words.

### Why the applied factor is STORED

**Because the record is the evidence of which rule produced the revision,
and the question is still open.**

Q-06 is unanswered. If FCI answers *"surplus compensation just means
displaying the excess"*, the compensation path is **deleted** — and then the
**stored** factors are what remain: a row per over-dose saying what was
proposed, at what factor, and what the operator decided. The audit trail
survives the deletion of the feature, and the revision can be reconstructed.

And the reverse: if FCI answers with a **different proportional rule** — a
different rounding, a different treatment of the last component, a cap —
then the stored factor shows **which** rule produced **each** revision. A
batch weighed under the old rule and a batch weighed under the new one are
both explicable, because each row carries what it did.

Without the stored factor, a revision is a number with no provenance — and
the recipe ratio it was supposed to preserve cannot be checked.

### Why the proposal is presented, not applied

**Because the operator is the one who decides whether the batch is changed.**

FR-22 says the revised targets are *"presented for acceptance"*. So the
proposal is a **decision waiting for a decision**, and the model says so: the
proposal carries its own **status**.

**And the status is a transition, not a mutation.** The `PROPOSED` row is
untouched, and the acceptance is a **new row** carrying the same
`proposal_id`. So the history shows that the proposal was made **before** it
was decided — which is the shape of an audit trail, and the same
append-only rule every other record in this product follows.

### Why the arithmetic is fixed-point decimal

**Because a factor computed in a float is a factor that does not add up.**

`2.4 ÷ 94` in IEEE-754 is `0.025531914893617023…`, and multiplying a
`74.0 g` target by it gives `75.88936170212766…`. Rounded to 4 places that
is `75.8894` — which happens to match the story's worked number — but the
**sum** of the revised targets is `96.40000000000001`, not `96.4000`, and
whether it rounds to the right answer depends on the order of the
operations.

In decimal, the factor is `0.025532` **exactly** at 4 places, and each
revised target is computed from that **one** number — so every component
is scaled by the same factor and the sum is the sum, to the last stored
place.

The story demands it: *"The division is performed in fixed-point decimal
with a defined rounding (half-up at the storage precision of 4 dp). No float
appears anywhere in the factor or the revised targets"* (BRD NFR-16, C-11).

## Consequences

### Positive

- **The revision distributes exactly the surplus**, and the shade ratio is
  preserved.
- **The compensability decision and the proposal cannot disagree** — one
  implementation.
- **Each revision carries its own provenance** — the stored factor says what
  rule produced it.
- **A different answer from FCI changes one place** — the calculator — and
  the history remains explicable.
- **The sum is preserved** to the last stored place, and the test suite
  proves it.

### Negative

- **`decimal.js` is on the proposal's path.** It is already a dependency and
  already used by the zone and the scale's conversion, so this is not a new
  dependency — but the proposal's arithmetic is now the third place it
  appears.
- **The factor is stored, so the table carries a derived value.** That is
  deliberate — it is the **provenance** — and it means the stored factor
  and the rule could disagree if the rule changed and the row was written
  before the change. That is the point: the row records what happened, not
  what the rule says today.
- **The proposal carries its own status, so there are two rows per
  proposal.** The history is complete, and the query for "the current
  decision" is the newest row for the `proposal_id`.

### Risks

- **A future agent replaces the proportional formula with the prototype's
  `1.026`**, because it is in the prototype and looks like the rule.
  *Mitigation*: the decision index's "Read when" points here, and this ADR
  shows the arithmetic — `188.0 × 1.026` distributes `4.888 g` when only
  `2.4 g` was over-dosed.
- **A future agent computes the compensability decision separately from the
  proposal.** *Mitigation*: the same index entry; the story requires one
  implementation, and this ADR says why two would fail.
- **A future agent drops the stored factor** as a "derived value that can be
  recomputed". *Mitigation*: the same index entry; it cannot be recomputed
  once the rule changes, and it is the evidence of which rule applied.

## Related

- **Stories**: `005-detect-overdose-and-calculate-surplus`,
  `006-apply-surplus-compensation`
- **Requirements**: FR-20, FR-21, FR-22, FR-24 · BRD FR-11, FR-12, FR-13,
  FR-21 · BRD DR-01, R-03 · BRD NFR-16 · A-08, Q-06
- **Previous ADRs**: ADR-008 (the weight crosses the wire as a decimal
  string — the same fixed-point discipline); ADR-034 (the station's own acts
  are durable — the proposal is one of them); ADR-029 (the append-only
  record, and the newest row is the effective one — the proposal's status
  transition follows the same shape); ADR-037 (the zone's boundaries and
  the fixed-point threshold — the same decimal discipline on the arithmetic,
  one step further from the reading)
- **Standards**: `standards/tech-stack.md` § "Testing" — *"explicit unit
  tests on tolerance boundary values ... using the decimal library, to prove
  fixed-point behaviour at the boundaries"*
