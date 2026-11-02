---
bolt: 004-004-scale-integration
created: 2026-10-31T03:10:00Z
status: accepted
superseded_by: null
---

# ADR-016: The net reading floors at zero

## Context

ADR-014 decided that the tare is applied at the device and that the
reading the device emits is **net** — the gross reading minus the tare.

The subtraction is arithmetic, and arithmetic on a physical quantity has a
domain that the type system does not know about. A scale with a 214 g
tare in force, on which the operator places an **empty** container and
then removes it before the next reading, produces a gross reading of
`0 g`. The net reading is `0 − 214 = −214 g`.

A negative dispensed quantity is not a thing. Nobody dispensed −214 g of
dyestuff. The scale did not report −214 g; the *subtraction* produced a
negative number from two non-negative facts.

This matters more than it might appear, because of bolt `003`'s
governing rule: a plausible wrong weight is what an operator acts on. A
negative weight on a live readout is at least *visibly* wrong, which is
better than a plausible positive one — but it is still a number the
operator did not measure, and it would propagate into the still-to-weigh
calculation, the progress bar and the tolerance zone.

The same situation arises from a tare established against the wrong
container, or a container removed mid-weigh.

The question is what the device reports when the gross reading is below
the tare.

## Decision

**The net reading floors at zero. A reading is never negative.**

The clamp is applied at the adapter, immediately after the tare
subtraction, and it applies to the **net reading only**. The tare itself
is never clamped: a tare of 214 g stays 214 g whatever the scale reads.

The clamp is a **physical fact**, not a display convenience: the quantity
of material dispensed into a container cannot be negative.

## Rationale

**1. Zero is the true lower bound of the quantity the reading means.**

The reading means "how much material is in the container". That quantity
is bounded below by zero — not approximately, not usually, but always. A
container holds material or it does not; the amount it holds is never
negative.

Reporting a negative net weight would be reporting a quantity that does
not exist.

**2. The alternative — a negative net reading — has no interpretation.**

What does −214 g mean? Not "the container is 214 g lighter than nothing".
There is no reading of the number that helps an operator, and there is no
reading of it that a downstream calculation can use. The still-to-weigh
quantity would be `max(0, target − (−214))` — the clamp is applied
downstream anyway, but by then the *live readout* has already shown a
number that should never have been shown.

**3. The clamp is not a display concern, so it must not live in the
display.**

The temptation is to floor the value in the UI, because that is where
the operator will see it. But then the API, the SSE stream and every
other consumer carry a negative quantity, and each has to decide
separately whether to clamp. The bolt `003` principle applies: a rule that
every consumer must remember is a rule that will eventually be forgotten
by one of them.

Clamping at the device means **the negative number is never produced**.
Every consumer receives a non-negative reading because the value that
exists is non-negative.

**4. Clamping at zero, not at the tare.**

An alternative clamp is to report the tare itself when the gross reading
is below it — "the reading is 214 g, which is the tare". That would be a
report of the *tare*, not of the material, and it would misrepresent what
the scale says. Zero says "there is no material in the container", which
is the truth in the situation the clamp is designed for.

**5. The tare is unaffected.**

The clamp applies to the reading, not to the tare. A tare of 214 g is
recorded as 214 g regardless of what the scale reads, and it is
subtracted from every subsequent reading that exceeds it. Only the
*result* floors.

### Alternatives Considered

| Alternative | Pros | Cons | Why Rejected |
|-------------|------|------|--------------|
| **Floor the net reading at zero, at the device** (adopted) | The negative number is never produced; every consumer gets a non-negative quantity; the clamp is stated once, in one place; it is physically true | The gross reading is not recoverable from the net one; a genuine fault (tare larger than the load) is hidden | Hiding the fault is the *status view's* job — the tare and the gross reading are both available to it. The reading is a quantity, and the quantity is never negative |
| **Report the negative net reading** | Lossless; a fault is visible in the value | The number has no interpretation; every consumer must clamp or handle it; the operator sees a negative weight | The reading means "how much material", and that is never negative. A rule every consumer must remember is a rule that will be forgotten |
| **Floor at zero in the UI only** | The operator never sees a negative | Every API consumer carries a negative quantity; each must decide separately whether to clamp; the clamp is duplicated per consumer | The same advisory-guard pattern ADR-009 rejected, applied to a quantity |
| **Floor at the tare** | A "meaningful" number in the fault case | Reports the tare as if it were the material; misrepresents what the scale says; the operator would think the container holds 214 g | The reading must report material, not the zero reference |
| **Refuse the reading entirely when the gross is below the tare** | No clamping rule needed; the fault is unmistakable | A missing reading is the failure mode bolt `003` exists to avoid, and it is reserved for *silence*. A scale that is reading 0 g is not silent — it is present and reporting, and its reading must be reported | Reserves the "no reading" state for the one condition that means it, and manufactures a false disconnection for a scale that is talking perfectly well |
| **Let the tare be negative** | No clamp needed | A negative tare is not a weight; the tare's own value is checked by the tare operation, not by the reading path | Pushes the problem upstream and makes the tare's meaning wrong |

## Consequences

### Positive

- **No consumer ever receives a negative quantity.** The rule is applied
  once, at the device, where the subtraction happens.
- The reading means exactly what it says: the quantity of material
  dispensed, which is never negative.
- **The downstream calculations need no guard.** The still-to-weigh
  quantity, the progress bar's fill and the tolerance zone all operate on
  a non-negative value.
- The tare is still recorded exactly, so the **fault is diagnosable** — the
  tare in force and the device's gross reading are both available.

### Negative

- **The gross reading is not recoverable from the net reading.** When the
  clamp engages, the difference between the gross and the net is lost
  from the stream. A consumer that wanted the gross must ask the device.
- **The clamp is invisible when it engages.** The reading simply reads
  zero. A diagnostic consumer cannot tell "the container is empty" from
  "the container is lighter than the tare" without the tare value — which
  it has, because ADR-014 put it on the reading.
- The clamp is a **second rule** a reader of the adapter has to know
  about, alongside the tare subtraction itself.

### Risks

- **A fault is masked.** A tare established against the wrong container
  makes every reading read zero, which looks like an empty container.
  *Mitigation*: the tare in force is on every reading (ADR-014), so a
  consumer that shows the tare alongside the weight sees "0 g with a
  1.850 kg tare in force", which is visibly wrong. The status view shows
  the tare and its applied time for the same reason.
- **A future adapter forgets the clamp**, and the negative value reaches
  consumers. *Mitigation*: the clamp is one line in the single place the
  tare is applied, and the adapter's tests cover the below-tare case
  explicitly.
- **A consumer concludes the clamp is a display rounding.** *Mitigation*:
  this ADR states that it is a domain rule about the quantity's range,
  not a formatting choice.

## Related

- **Stories**: 003-tare-scale-against-container
- **Requirements**: FR-6, BRD FR-11, BRD NFR-16
- **Standards**: `units/004-scale-integration/unit-brief.md` § Constraints —
  "A disconnected device is **never** represented as a zero weight" (the
  same concern, applied to the tare rather than the link)
- **Previous ADRs**: ADR-014 (the tare is applied at the device — this ADR
  is the other half of that decision); ADR-008 (quantities cross the wire
  as decimal strings)
