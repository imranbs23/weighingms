---
bolt: 004-004-scale-integration
created: 2026-10-31T03:40:00Z
status: accepted
superseded_by: null
---

# ADR-019: The selection threshold is configuration, and is unset until FCI answers

## Context

The selection rule decides which device a component is weighed on. The
story names two constraints — the target quantity and the scale class —
and the story's own acceptance criteria are fully decided by the
**capacity** constraint:

> **Given** a component whose target fits within the precision scale's 3 kg
> capacity and whose scale class demands precision, **When** the scale is
> selected, **Then** the 3 kg precision scale is selected.

> **Given** a component whose target exceeds the precision scale's capacity
> but fits within the floor scale's 32 kg capacity, **When** the scale is
> selected, **Then** the 32 kg floor scale is selected.

But the story also records an open question and an open assumption:

> **The threshold itself is still open** — Q-04 asks FCI production for
> the scale-selection threshold and the boundary behaviour, and A-06
> (scale selection is rule-based on target quantity with a defined
> threshold) binds this story until it is answered.

So the source material asserts that there **is** a threshold, that it is
**defined**, and that nobody knows what it is yet. The acceptance criteria
are nonetheless decidable, because the capacity constraint alone decides
every case they name — the story pins the boundary itself ("is within the
precision scale's capacity").

The question is what to build. Two options present themselves:

1. Implement the rule with a hard-coded threshold — the 3 kg capacity,
   which is what the acceptance criteria describe.
2. Implement the rule with a **threshold parameter** that is currently
   unset, and let the capacity constraint carry the rule until the
   parameter is set.

BRD NFR-14 also bears on this: the approved tech stack requires that
hard-coded values be **configuration**.

## Decision

**The threshold is a configuration parameter of the selection rule. It is
currently `null` — unset — and the rule is fully functional with it
unset, because the capacity constraint alone decides every case the story
names.**

Concretely:

- `ScaleSelectionRule` holds a `threshold: WeightValue | null`.
- The rule is written against a **set of `ScaleDevice`s** and a
  configuration — never against two hard-coded scales.
- The threshold is supplied by the **composition root**, so changing it
  is a configuration change and not a code change (BRD NFR-14).
- While it is unset, the rule behaves as the story's acceptance criteria
  describe, because the capacity constraint produces exactly those
  outcomes.

## Rationale

**1. The rule must not encode an answer nobody has given.**

`Q-04` asks FCI production for "the scale-selection threshold, and what
happens near the boundary". `A-06` binds the story until it is answered:
scale selection is rule-based on target quantity **with a defined
threshold**.

A threshold of 3 kg hard-coded into the rule would be an **invented
answer** — an answer to a question the production team has been asked
and has not yet answered. It happens to coincide with the 3 kg capacity,
which makes it *look* correct, and that is precisely what makes it
dangerous: a value that is right by coincidence will be trusted as if it
were right by decision.

The unit's own rule — "no invented requirements" — forbids it. A
threshold derived from a capacity is not the same fact as a threshold
FCI may define.

**2. The two numbers are not the same number, even though they coincide
today.**

- The **capacity** is a physical property of the instrument. It is in the
  device registry, it is a column in `scale_devices`, and it is what
  determines whether a load can be held at all.
- The **threshold** is a **policy** about which instrument to prefer for
  which quantity. It is a business rule about measurement quality.

Today they are both 3 kg, because the only precision scale has a 3 kg
capacity and every component that wants precision and fits is small.
The day FCI says "use the precision scale up to 2.5 kg and the floor
scale above it, because above 2.5 kg the precision scale's resolution
degrades" — or "switch at 1 kg, because the precision scale is slow above
that" — the two numbers diverge, and a rule with 3 kg baked into its
logic cannot express that.

Writing the rule against a set of devices and a configuration is what
makes the answer cheap when it arrives.

**3. The rule works fully without the threshold, so there is nothing to
guess.**

This is the fact that makes the unset threshold safe rather than a gap.

Every acceptance criterion in the story is decided by the capacity
constraint:

| Criterion | Capacity constraint's answer |
|-----------|------------------------------|
| Target fits in 3 kg, class demands precision | Only the precision scale is a candidate → selected |
| Target exceeds 3 kg, fits in 32 kg | Only the floor scale is a candidate → selected |
| Target exceeds 32 kg | No candidate → "no device can weigh this" |
| Target is exactly 3 kg | Inclusive boundary → the precision scale is a candidate |

And the story pins the boundary explicitly: "a target of exactly 3 kg is
within the precision scale's capacity". So the capacity constraint
*already* produces the threshold's behaviour for every case the story
names. The threshold is a **refinement** that has not been specified yet,
not a **missing piece** that the rule cannot function without.

That is why the rule is not blocked waiting for `Q-04`, and why the
implementation does not have to invent one.

**4. The rule's shape must not assume two scales.**

Writing `if (target <= 3kg) return SCALE_A else return SCALE_B` would
have been shorter. It is also the shape that turns every future change
into a code change: a third scale, a recalibrated capacity, a capacity
in a different unit — each becomes an edit to the rule.

Writing the rule against a **set of devices** with their capacities and
classes means the devices come from the registry, the capacities come
from the registry, and the rule asks the same questions regardless of how
many devices there are. Two today; the rule does not know or care.

**5. The threshold is configuration because BRD NFR-14 says so, and
because the story says the rule is configuration, not code.**

The story states it directly: "**The selection rule is capacity-based**
and is **configuration, not code**". The tech stack's NFR-14 says the same
thing about hard-coded values generally. The composition root is where
configuration enters, and the rule is where it is read — so the change
when `Q-04` is answered is a change to a value, in one place, with no
domain change and no test rewrite.

**6. An unset threshold is honest; a hard-coded one is not.**

An unset threshold is a *visible* statement: "the policy has not been
specified". A hard-coded 3 kg is an *invisible* statement: "the policy is
3 kg", which nobody actually decided. The first is corrected by answering
a question; the second is corrected by noticing a bug that nobody was
looking for.

## Alternatives Considered

| Alternative | Pros | Cons | Why Rejected |
|-------------|------|------|--------------|
| **Threshold as a configuration parameter, currently unset; the capacity constraint carries the rule** (adopted) | No invented answer; the rule already produces every outcome the story names; answering `Q-04` is a configuration change; the rule is written against a set of devices | The threshold is unset, so a reader must understand that the capacity constraint is doing the work | The work is *visible* — the design records the step order and the reason — and the cost is one configuration value later |
| **Hard-code the 3 kg threshold in the rule** | The simplest code; every named case works | It is an **invented answer** to an open question, disguised by coinciding with the capacity; it cannot express a threshold that differs from the capacity; it violates BRD NFR-14 and the story's own "configuration, not code" statement; every future change is a code change | A value that is right by coincidence will be trusted as if it were right by decision |
| **Hard-code the two scales and their capacities** | The rule is trivial | The capacities are duplicated — the registry already holds them; a recalibrated scale would not be reflected in the rule; the rule cannot be reused for a third device | Duplicates a fact that already has a home, and puts the copy where the change will not reach it |
| **Wait for `Q-04` and implement the rule afterwards** | No implementation risk | The bolt is blocked on an external answer that may be weeks away; the story's acceptance criteria are already fully decidable by the capacity constraint, so the wait buys nothing and delays two other stories that depend on this unit | The rule is not blocked. Blocking would be treating a missing refinement as a missing requirement |
| **Express the threshold as a fraction of the capacity** (e.g. 90%) | "Adaptive" to a capacity change | A second magic number, invented, in place of the first one; and the capacity itself is the wrong quantity to scale — the threshold is a policy about the component, not about the device's limit | Invents a rule for a question that has not been asked, and makes the rule's behaviour depend on a device property that has nothing to do with it |
| **Let the operator choose the scale** | No threshold needed | The story forbids it outright (FR-7, BRD BR-05, BRD AC-02) | Forbidden by the source material |

## Consequences

### Positive

- **No invented requirement** is encoded anywhere in the rule.
- **The rule already satisfies every acceptance criterion** in the story
  while the threshold is unset.
- **Answering `Q-04` is a one-line configuration change** in the
  composition root — no domain change, no test rewrite.
- **The rule generalises** to a third device without modification,
  because it reads a set of devices.
- The **threshold's absence is visible** in the code, rather than a
  plausible-looking constant.

### Negative

- **The rule's behaviour is currently produced by the capacity
  constraint**, and a reader who expects the threshold to be doing the
  work has to be told. The design records the step order for exactly this
  reason.
- **The two numbers coincide today**, so a developer may "simplify" the
  rule by folding the capacity into the threshold — a simplification that
  removes the answer to `Q-04`'s slot.
- **The threshold is unconfigured**, so it is untested in the running
  product. The rule's step for it exists and is exercised in the unit
  tests, but the production configuration does not set it.

### Risks

- **A developer folds the threshold away**, reasoning that it is
  redundant with the capacity. *Mitigation*: this ADR names the slot
  explicitly, the threshold is a distinct field of `ScaleSelectionRule`
  rather than an implicit behaviour, and the domain model's I-4
  interpretation records the same reasoning.
- **The capacity and the threshold diverge when `Q-04` is answered**, and
  the rule's behaviour changes in a way that surprises someone who read
  the capacity constraint as the rule. *Mitigation*: the rule's step
  order is explicit in the design, so the threshold's position in the
  sequence is known before the value arrives.
- **FCI never answers**, and the rule stays on the capacity constraint
  indefinitely. *Mitigation*: the capacity constraint produces the
  behaviour the story specifies, so an unanswered question leaves the
  product correct with respect to its acceptance criteria.

## Related

- **Stories**: 004-select-scale-by-capacity
- **Requirements**: FR-7, BRD BR-05, BRD AC-02, BRD NFR-14
- **Open questions**: `Q-04` (the scale-selection threshold and the
  boundary behaviour) — owned by FCI production; `A-06` binds the story
  until it is answered
- **Previous ADRs**: ADR-013 (the scale endpoints' session rule — the
  same "the write endpoints are guarded, the reads are not" reasoning);
  ADR-008 (quantities cross the wire as decimal strings — the threshold
  is a `WeightValue`, never a `number`)
