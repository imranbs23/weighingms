---
bolt: 004-004-scale-integration
created: 2026-10-31T03:05:00Z
status: accepted
superseded_by: null
---

# ADR-015: The tare is never persisted

## Context

The tare is the device's zero reference. Once applied, it persists into
every subsequent reading until it is replaced.

The unit brief's Data Storage table says:

> | Tare state | In memory, per device | One per device | — |

and the story's technical notes say:

> Tare state is held **in memory, per device**. It is not persisted: tare
> is a property of the current session, and a stale tare read back after a
> restart would be a wrong number rather than an inconvenience.

So the source material states the answer. What it does not state is
**why**, and the reason is worth recording — because a developer adding a
`scale_devices.tare_value` column would be "restoring" something the
design deliberately does not have, and the harm is not obvious at the
moment of writing.

The question is what happens after a restart. The tare is the difference
between "the scale reports 1214 g" and "the scale reports 1000 g". If a
stale tare survives a restart and the device has since been re-zeroed
against a different container — or the operator has replaced the
container without re-taring — then the scale reports a number that
excludes a container's weight that is not there.

## Decision

**Do not persist the tare. There is no `TareRepository`, and the
`scale_devices` table gains no tare column.**

The tare lives in memory, on the `ScaleDevice` aggregate, for the
lifetime of the process.

## Rationale

**1. A stale tare is a wrong number, and a wrong number is the failure
this whole unit exists to prevent.**

Bolt `003`'s governing rule is that "no reading" and "a reading of zero"
must never be confused — because a plausible wrong weight is what an
operator acts on. A stale tare is the same class of failure: a plausible
wrong weight, produced by a device that is reporting correctly but is
zeroed against a container that is no longer on it.

The tare is the **most dangerous** quantity in the product to get wrong,
because it is the one that silently changes what every subsequent reading
*means*.

**2. The tare's lifetime is the session's lifetime.**

A tare is established by weighing an empty container or by taking a
value from the container master. Both are acts in a weighing session.
The session ends; the tare has no meaning after it.

Persisting a tare would extend its lifetime past the thing it belongs to,
and the only way to know it should not be honoured would be to store the
session alongside it — which is unit `003`'s data, not this unit's.

**3. On restart, the correct tare is *unknown*, and "unknown" must not be
rendered as "zero".**

The tare's absence is a distinct state from a tare of zero (S-12). A
device with no tare in force reports gross weight. If the tare were
persisted, a restarted device would report net weight against a tare
nobody can see — and the operator would have no way to know that the
container's weight was being subtracted.

Restarting without the tare is the **honest** state: the device reports
gross weight, the tare is visibly absent from the status view, and the
operator's next action is to re-tare. That is a recoverable situation.
A silently-stale tare is not.

**4. The absence of a repository is the enforcement.**

ADR-009 established this reasoning for readings, and it applies with even
more force here: a persisted tare needs a repository, and a repository
needs a schema. If neither exists, the mistake requires someone to
**deliberately invent** a table and a column — not to copy a pattern from
a neighbouring unit. The mistake becomes conspicuous.

**5. There is no diagnostic need that persistence would serve.**

The durable facts an investigation needs are the **confirmed weighing
record** (which carries the confirmed net quantity and, once unit `003`
records it, the tare in force at confirmation), the **disconnection gap**,
and the **audit trail**. None of them is the live tare state.

### Alternatives Considered

| Alternative | Pros | Cons | Why Rejected |
|-------------|------|------|--------------|
| **In memory, per device; no repository** (adopted) | A stale tare is impossible; the device's state after a restart is honest; the session's tare has the session's lifetime | The tare is lost on restart and must be re-established | The tare must be re-established anyway — the operator re-tares for the new container. Restarting is not a special case |
| **Persist the tare in `scale_devices`** | The tare survives a restart; a status view can show it after a restart | A stale tare is read back as live — a **wrong number**; the tare outlives the session it belongs to; the device cannot distinguish "this tare is current" from "this tare was current when the process stopped" | Persisting the one quantity whose staleness silently changes the meaning of every reading |
| **Persist the tare with the session id that established it** | The staleness is detectable | Requires this unit to know about unit `003`'s sessions — an inverted dependency between two units that are deliberately independent; and the tare is still readable by a consumer that does not check | Detection requires every consumer to check, which is the advisory-guard pattern ADR-009 rejected |
| **Persist the tare with a timestamp and expire it** | The staleness is bounded | The expiry period is a second magic number; a tare that expires mid-session would silently change the meaning of every reading; the operator would be told a different quantity with no explanation | A timeout on the zero reference is a silent wrong number with a timer on it |
| **Re-read the tare from the container master on restart** | The tare is always current | The tare may have been established by *weighing* the empty container, which the master does not hold; and the device may still be on a different container | Reconstructs a tare that may never have existed, and still cannot know which container is on the scale |

## Consequences

### Positive

- **A stale tare cannot be read back as a live one.** Not "should not" —
  cannot. There is nothing stored to read.
- The device's state after a restart is **honest**: gross weight, and a
  visibly absent tare.
- The `scale_devices` table is unchanged by this bolt, so there is **no
  migration** and no schema to reason about.
- The tare's lifetime matches the thing it belongs to — the session.

### Negative

- **The tare is lost on restart.** An operator who restarts the station
  mid-session must re-tare. This is a real operational cost and it is the
  direct consequence of the decision.
- A **post-mortem cannot read the tare** that was in force at the time
  from this unit. It must come from the weighing record, which carries
  the confirmed quantity and — once unit `003` records it — the tare.
- The rule must be **restated** to every future developer who wants to
  store the tare, which is why this ADR exists.

### Risks

- **A future bolt adds a `tare_value` column** to `scale_devices`, for
  "just the current value" or for a status view.
  *Mitigation*: this ADR is in the decision index with a "Read when" field
  that names the scenario, and the absent `TareRepository` interface is
  the structural answer — the column would have to be invented
  deliberately rather than added by copying a pattern.
- **A developer concludes that "not persisted" means "not auditable"**.
  *Mitigation*: the weighing record is the audit trail, and it is where
  the tare belongs — it is a fact about a *weighing*, not about a device.
- **The operator restarts the station and does not notice the tare is
  gone**, and weighs a container without re-taring.
  *Mitigation*: the tare's absence is **visible** — the status view
  reports no tare in force, and the reading is gross. The operator sees
  a container's weight on the scale and re-tares. The failure mode is
  "the number looks wrong to the operator", which is the recoverable kind.

## Related

- **Stories**: 003-tare-scale-against-container
- **Requirements**: FR-6, BRD FR-11, BRD NFR-16
- **Standards**: `units/004-scale-integration/unit-brief.md` § Data Storage
  — "Tare state | In memory, per device | One per device | —"
- **Previous ADRs**: ADR-009 (the same structural argument for readings:
  the absence of the repository is the enforcement)
