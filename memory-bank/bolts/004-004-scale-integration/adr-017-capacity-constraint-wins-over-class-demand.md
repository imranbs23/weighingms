---
bolt: 004-004-scale-integration
created: 2026-10-31T03:20:00Z
status: accepted
superseded_by: null
---

# ADR-017: The capacity constraint wins over the scale-class demand

## Context

The selection rule has **two** constraints: the component's **target
quantity** and the **scale class** the component demands (precision or
floor). The story states the case where they conflict:

> | The scale class demands precision but the target is 4 kg | The two
> constraints conflict. The capacity constraint wins — the floor scale is
> selected and the selection's reason records the conflict, because a 4 kg
> load cannot be weighed on a 3 kg scale. |

The story therefore names the outcome — the floor scale — and adds a
second requirement: the selection's **reason records the conflict**. What
the story does not say is *why* the capacity constraint wins rather than
the class constraint, and that "why" is the decision.

The two constraints are not peers, and the asymmetry is what makes the
choice answerable rather than arbitrary.

The **capacity** constraint is a property of the **physics**: a 3 kg
scale cannot hold 4 kg. There is no configuration, no operator override
and no clever tare that changes what the load cell can bear. A load
exceeding the capacity is not a smaller quantity of dyestuff — it is a
broken scale, a damaged platform and a spillage.

The **class** constraint is a property of the **requirement**: the
component asks to be weighed on a precise instrument. It is a statement
about measurement quality, not about whether the weighing is possible. A
4 kg quantity of soda ash measured on a 10 g-resolution floor scale is
still a 4 kg quantity of soda ash, recorded to within 10 g — which is
within the tolerance band for a dry auxiliary.

## Decision

**When the capacity constraint and the scale-class demand conflict, the
capacity constraint wins. The floor scale is selected, and the selection's
reason is `CLASS_CONFLICT_RESOLVED_BY_CAPACITY`.**

The conflict is **never silently resolved**. The reason is a closed
enumeration value — not prose, not a flag — so a consumer reading the
selection cannot miss it.

## Rationale

**1. The class constraint cannot be satisfied at all in the conflict
case, so honouring it produces no selection whatsoever.**

The class demands precision. The precision device is the 3 kg scale. The
target is 4 kg. There is no world in which both hold. If the class
constraint won, the rule would return **no device** — for a 4 kg sack of
soda ash that the floor scale is sitting right there, ready to weigh.

That outcome is strictly worse than every alternative:

| Outcome | Result |
|---------|--------|
| Class wins → no selection | A weighable 4 kg component cannot be weighed at all |
| Capacity wins → floor scale, conflict recorded | The component is weighed, and the loss of precision is visible in the record |

The second is not merely "less bad". It is the only outcome in which the
weighing **happens** while the fact that the demanded precision was not
available is **still recorded**.

**2. A capacity violation is a physical impossibility; a class mismatch
is a quality preference.**

A 4 kg load on a 3 kg scale is not a "less accurate measurement". It is
an overloaded instrument. Bolt `003` established that the device reports
`OVER_CAPACITY` as a status, and the story's edge cases for the tare
refuse the operation when the device is over capacity. The selection rule
must not route a load to a device that will refuse it — the rule has to
respect the constraint the device itself enforces.

The class constraint has no equivalent enforcement. Nothing breaks if a
soda ash is measured on the floor scale; the measurement is simply
coarser, and the tolerance band is checked against the recorded quantity.

**3. The reason must record the conflict, because the consumer needs to
know the measurement is coarser than asked for.**

This is the part of the story's requirement that carries the most
weight. If the selection simply returned the floor scale, the consumer
would have no way to know that the class demand was not met — and the
class demand is precisely what the consumer needs in order to decide
whether the coarser measurement is acceptable for *this* component.

Because the reason is a **closed set**, "the class was not met" is
expressible and distinguishable from "the class was met". A consumer that
wants to warn the operator can match on it; a consumer that wants to
record it can store it. A prose reason assembled at the call site would
be unmatchable and would drift.

**4. The conflict is recorded rather than resolved away, because the
conflict is information.**

Nothing in the design says the class demand was wrong. The class demand
came from unit `002`, which owns the component's identity and its
requirement. If a 4 kg component demands precision, that is a fact about
the component's requirements, and it may be right — the resolution may be
that the component's requirement should change, or that a larger
precision scale should be bought.

A rule that quietly overrides the class demand destroys that signal. The
recorded conflict keeps it visible, and it is visible **in the durable
record** — unit `003` snapshots the selection onto the weighing record.

**5. The alternative — selecting the smallest-capability candidate — is
forced by the geometry, not chosen for its own sake.**

When the demanded class matches none of the candidates, *something* must
be selected, and the candidates are precisely the devices whose capacity
is at least the target. The smallest of them is the closest match to the
demanded capability — a 32 kg floor scale is closer to "precision" than
a 64 kg one would be. Choosing the smallest also has the practical
property of leaving the larger device free.

The choice is the **only** one consistent with the two constraints, so
the decision is forced rather than made. The reason still records that
it was forced.

### Alternatives Considered

| Alternative | Pros | Cons | Why Rejected |
|-------------|------|------|--------------|
| **Capacity wins; the floor scale is selected; the reason records the conflict** (adopted) | The weighing happens; the conflict is durably visible; the rule never routes a load to a device that will refuse it; the class demand's signal is preserved | The measurement is coarser than the component demanded | Coarser-but-correct beats not-weighed. The coarseness is recorded, so it is never invisible |
| **The class constraint wins; no device is selected** | The component's stated requirement is honoured exactly | A 4 kg component cannot be weighed at all, while a suitable scale is connected and idle | A constraint that makes the weighing impossible has failed at its job |
| **Split the quantity across devices** | Every part is within every device's capacity | The story explicitly forbids it ("it does not split the quantity across devices"); it also invents a dispensing behaviour nobody asked for | Forbidden by the source material, and it invents a business process |
| **Select the device and drop the class demand silently** | The operator sees a working selection | The consumer cannot tell the measurement was coarser than demanded; the class demand's signal is destroyed | The story explicitly requires the conflict to be recorded |
| **Select the device and warn, but select by class preference** | — | Selects a device that cannot hold the load, and the device reports `OVER_CAPACITY` | Routes a load to an instrument that will refuse it, turning a rule into a runtime failure |
| **Refuse the whole component until the operator resizes it** | Forces the mismatch to be resolved upstream | Requires operator input for a routine weighing, which the story forbids (FR-7, BRD BR-05); and the mismatch is often a data-entry error upstream, not a weighing problem | The story's whole point is that the operator is never asked |

## Consequences

### Positive

- **Every component that can be weighed is weighed.** No target is
  refused for a reason that a connected, capable device could satisfy.
- **The conflict is visible in the durable record**, because the reason
  is snapshotted onto the weighing record by unit `003`.
- **The rule never routes a load to an over-capacity device**, so the
  `OVER_CAPACITY` status is never produced by the selection rule itself.
- **The reason is machine-matchable**, so a consumer can distinguish
  "the class was not met" from "the class was met" without parsing
  prose.
- The **class demand's signal survives**, so unit `002` can be told that
  a component's requirement and its quantity disagree.

### Negative

- **The measurement can be coarser than the component demanded**, and
  nothing in this unit prevents that from mattering. The consumer has to
  act on the reason.
- **The conflict is detected, not resolved.** The system's answer is "I
  weighed it, and the precision you asked for was not available" — the
  upstream requirement still disagrees with the quantity.
- A consumer that ignores the reason **will not notice** the conflict.
  The rule reports it; acting on it is the consumer's job.

### Risks

- **A consumer treats every selection as equally good** and does not
  check the reason. *Mitigation*: the reason is a closed enumeration
  with a distinct value for the conflict, so a consumer can match on it
  without string parsing; and the alternative — refusing to weigh — is
  worse for every other case.
- **A component's class demand is systematically wrong** upstream, and the
  station keeps weighing it on the floor scale without anyone noticing.
  *Mitigation*: the reason is recorded on the weighing record, so the
  pattern is visible in the data rather than invisible at the station.
- **The smallest-capability candidate is chosen, and a larger device
  would have been more appropriate.** *Mitigation*: the smallest
  candidate is the closest match to the demanded capability and leaves
  the larger device free; and the reason records the conflict so a
  consumer that cares can escalate.

## Related

- **Stories**: 004-select-scale-by-capacity
- **Requirements**: FR-7, BRD BR-05, BRD AC-02
- **Standards**: `units/004-scale-integration/stories/004-select-scale-by-capacity.md`
  § Edge Cases — "The scale class demands precision but the target is 4 kg"
- **Previous ADRs**: ADR-008 (quantities cross the wire as decimal strings
  — the capacities and targets compared in this rule are exact decimals);
  ADR-009 (the same "the absence of a mechanism is the enforcement"
  reasoning — the conflict is recorded because there is nowhere else for it
  to go)
