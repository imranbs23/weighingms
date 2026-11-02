---
bolt: 003-004-scale-integration
created: 2026-10-30T23:40:00Z
status: accepted
superseded_by: null
---

# ADR-010: `ZEROED` does not block weighing

## Context

The story `002-detect-disconnection-and-block-weighing` defines the
device-status vocabulary and then states a rule about it:

> Device status vocabulary: `CONNECTED`, `DISCONNECTED`, `ZEROED`, `BUSY`,
> `OVER_CAPACITY`, plus `calibrationState`. **Only `CONNECTED` is a state in
> which weighing may proceed.**

Read literally, that is a closed list with one member. `DISCONNECTED`,
`ZEROED`, `BUSY` and `OVER_CAPACITY` all block weighing, and the only state
in which a weighing may proceed is `CONNECTED`.

But `ZEROED` means **the scale has been zeroed** — and zeroing a scale
against a container is precisely what **tare** is. Bolt `004` of this same
unit (`003-tare-scale-against-container`) exists to apply the container's
tare to the scale, and the story for it says:

> **Given** a container has been tared, **When** a weight is read from the
> scale, **Then** the reading reflects the material dispensed into the
> container and not the container itself.

So the two statements contradict each other:

- Story 002: a `ZEROED` scale may not be weighed on.
- Story 003 / bolt 004: the tare operation puts the scale into `ZEROED`,
  and a weighing must then proceed on it — that is the entire point of
  taring.

A reading that blocks weighing when the scale is zeroed would mean **tare
prevents the weighing it exists to enable**. Every tared weighing would be
refused with a reason that names a state the operator deliberately created.

This is a genuine contradiction in the source material, not a subtlety. It
has to be resolved somewhere, and resolving it silently would leave the next
reader unable to tell whether the rule was considered or overlooked.

## Decision

**`ZEROED` does not block weighing.**

The rule *"only `CONNECTED` may proceed"* is read as **"only a *connected*
device may proceed"** — that is, the rule is about the **link**, and the
four non-`CONNECTED` states each block for their own named reason.

The gate, in full precedence order:

1. Link is `DOWN` → blocked, `SCALE_DISCONNECTED`.
2. Link is `UNKNOWN` (never heard from) → blocked, `SCALE_NOT_RESPONDING`.
3. Calibration is expired or unreadable → blocked, `CALIBRATION_EXPIRED`.
4. Device reports `OVER_CAPACITY` → blocked, `OVER_CAPACITY`.
5. Device reports `BUSY` → blocked, `SCALE_BUSY`.
6. **Otherwise → allowed.** This includes `ZEROED` and `CONNECTED`.

### The rule, stated once

> The gate is about the **link** and the **device's health**, not about
> whether the scale happens to be showing zero.
>
> `ZEROED` is a *state of readiness*, not a fault.

### What this does not change

`ZEROED` remains in the published vocabulary and remains visible on the
status strip. The prototype's status strip shows "SCALE 3 kg · READY", and
a zeroed scale is ready. The state is reported; it is simply not a blocker.

`ZEROED` is also the state bolt `004` will use to express "the container
tare has been applied", so it needs to exist and be distinguishable from
`CONNECTED` — the operator and the audit trail both need to know a tare is
in force.

### The consequence for the published status

Because the gate has one answer per blocked reason and `ZEROED` is not one
of them, a zeroed scale reports `status: "ZEROED"` and
`canWeigh: { allowed: true }` simultaneously. That is not a contradiction —
it is the same shape as a scale that is `CONNECTED` and happens to be
reading zero.

## Rationale

The literal reading was rejected because it makes the product incoherent: it
means a station that has been correctly prepared for a weighing refuses that
weighing. The operator's response would be to remove the tare, at which
point the reading includes the container's weight, and the weighing is wrong
in the way that matters — silently, because a tare that was applied and then
removed looks like a tare that was never applied.

The reading was narrowed to the link because the **other three** statuses
block for independent, sensible reasons and the story's own edge-case table
confirms each of them individually:

- *"The device reports a load above its capacity | The device status is
  `OVER_CAPACITY` and weighing on it is blocked; this is distinct from a
  disconnection."*
- The story's calibration criterion: *"the weighing is blocked with a stated
  reason identifying the expired calibration."*
- The disconnection criteria block on `DISCONNECTED`.

Every non-`CONNECTED` status is given its **own named block reason** in
story 002's gate. `ZEROED` is the only one of the five that has no such
reason — and its absence is the tell. A status that blocks needs a reason
to give; `ZEROED` has none in the source material, because there is no
failure to describe. It is a *condition*, not a *fault*.

This is the same shape as ADR-007 in the identity unit, where a refusal
reason that existed but was unreachable pointed at a missing field. Here, a
status that exists but has no block reason points at a status that is not a
blocker.

### Alternatives Considered

| Alternative | Pros | Cons | Why Rejected |
|-------------|------|------|--------------|
| **`ZEROED` does not block** (adopted) | Tare works; the rule is coherent; each blocking status has a named reason | Requires reading "only `CONNECTED`" as "only connected" | The literal reading makes tare impossible |
| **`ZEROED` blocks** (the literal reading) | Matches the sentence exactly | Tare prevents the weighing it enables; a correctly prepared station refuses its weighing; the operator's workaround produces a silently wrong reading | The product becomes incoherent, and the failure mode is a wrong weight rather than an error |
| **Rename `ZEROED` to something that does not read as a status** | Removes the contradiction by avoiding the word | The state still exists and still needs a name; a rename does not change the semantics; the next reader hits the same question | Hides the ambiguity instead of resolving it |
| **Split the vocabulary into "status" and "readiness"** — `ZEROED` moves out of the status list | Semantically tidier | The prototype's status strip renders one state per scale; a second axis changes the UI contract in unit `007`; the vocabulary is pinned by the story | A larger change to an approved contract, to solve a problem that one line of interpretation solves |

## Consequences

### Positive

- **Tare works.** Bolt `004` can apply a tare and the weighing proceeds.
- The gate's reasons are complete: every blocking state names exactly one
  reason, and the reasons cover every actual fault the source material
  describes.
- The published status and the gate answer are independent, so the status
  strip can show "ZEROED" while the gate says "allowed" — which is
  accurate, not contradictory.

### Negative

- **The story's sentence is not followed literally.** A reader comparing the
  story to the implementation will find a difference and must be told why.
  That is why this ADR exists.
- The gate has a rule that is not "the status is `CONNECTED`". A future
  developer reading only the gate code might not see the reasoning, so the
  comment must state it.
- A reviewer checking conformance against the story's wording alone will
  raise this as a discrepancy. It should be answered with this ADR, not
  with a code change.

### Risks

- **The literal reading is reinstated in a later bolt** by a developer who
  reads the story and not this ADR. *Mitigation*: the "Read when" field in
  the decision index names the exact scenario — changing the gate, or
  wondering why a zeroed scale is allowed.
- **The contradiction is read as a defect in the story** and the story is
  "corrected" upstream without this reasoning travelling with it.
  *Mitigation*: this ADR records the reasoning rather than just the outcome,
  so a correction upstream has something to be checked against.

## Related

- **Stories**: 002-detect-disconnection-and-block-weighing (this bolt);
  003-tare-scale-against-container (bolt `004`, the contradiction's other side)
- **Requirements**: FR-7, FR-8, BRD FR-19, BRD IR-12, BRD IR-13, AC-14
- **Standards**: `units/004-scale-integration/unit-brief.md` § Scale status;
  `stories/002-detect-disconnection-and-block-weighing.md` § Technical Notes
- **Previous ADRs**: ADR-007 (same diagnostic pattern — a value that exists
  but is unreachable points at a missing piece of the model)
