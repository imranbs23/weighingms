---
stage: model
bolt: 014-003-weighing-station
created: 2026-11-06T04:20:00Z
---

## Static Model: 003-weighing-station (bolt 014)

### Entities

- **WeighingRecord**: the record of a completed weighing — `recordId`,
  `sessionId`, `componentId`, `actualQuantity`, `unit`, `targetAtWeighing`,
  `toleranceAtWeighing`, `zoneAtConfirm`, `scaleId`, `scaleClass`,
  `lotNumber?`, `containerId?`, `operatorId`, `weighedAt`.

  It is a **fact about the past** and therefore **immutable** (BRD DR-02,
  C-12). A correction is a **new** record that references the original.

  **It is a DIFFERENT thing from the session** (ADR-036): the session is the
  live state and is mutable; the record is an act and is not. Two tables,
  two reasons — and this bolt builds the second of them.

### Value Objects

| Value object | Shape | Rules |
|---|---|---|
| **ToleranceZone** | `OVER` \| `OK` \| `NEAR` \| `UNDER` | The four zones, exactly (C-05). A **closed set of four**, and the closure is the point: the status line, the live-weight cell and the progress bar all render the **same** zone, so they cannot disagree (FR-9). |
| **StillToWeigh** | a `WeightValue` | `max(0, target − current)`, in fixed-point, and the clamp is applied **in the domain**, not in the renderer. |
| **ZoneBounds** | `nearThreshold`, `okLower`, `okUpper` | The three derived bounds, computed **once** per component so that the comparison is against the same three numbers everywhere. |
| **WeighingConfirmation** | the confirmed record + its references | The **record of the act**, and it is append-only. |

### Aggregates

| Aggregate Root | Members | Invariants |
|----------------|---------|------------|
| **WeighingRecord** | the record | 1. **Immutable** once written (BRD DR-02, C-12). 2. It names **exactly one** operator, **one** component, **one** scale and **one** session. 3. `zoneAtConfirm` is `OK` — or the record carries the **authorisation** that permitted an `OVER` (the override path is bolt `016`'s, and this bolt consumes it). 4. The target and tolerance are **snapshotted** as they were at weighing time (BRD FR-25, BRD BR-14). 5. The actual quantity is a fixed-point decimal. |

### The four zones, and the order they are evaluated in

The rule is the unit brief's, exactly:

```text
1. OVER   if  value >  target + tolerance
2. OK     if  value >= target − tolerance
3. NEAR   if  value >= target × 0.9
4. UNDER  otherwise
```

**The order matters**, and it is not arbitrary: the first matching rule
wins. `OVER` is tested first because it is the only one that is an **exclusive**
bound; `OK` is inclusive at **both** bounds; `NEAR` is inclusive at its
bound; `UNDER` is the remainder.

| Reading | Zone | Why |
|---|---|---|
| `target + tolerance` | `OK` | `OVER` is strict `>`, so the bound itself is not over |
| `target + tolerance` + 1 ULP | `OVER` | the first rule now matches |
| `target − tolerance` | `OK` | `OK` is inclusive at both bounds |
| `target × 0.9` | `NEAR` | `NEAR` is inclusive at its bound |
| `target × 0.9` − 1 ULP | `UNDER` | nothing matched |

**And the boundaries are EXACTLY the ones the story names** — `94.5000`
against a `94.0000` target with a `0.5000` tolerance is `OK`, and `94.5001`
is `OVER`. Those are the two numbers a float implementation gets wrong, and
they are why the story demands an **exhaustive boundary suite**.

### Why `target × 0.9` is computed in fixed-point

Because `94.0000 × 0.9` in IEEE-754 is **not** `84.6000`. It is
`84.60000000000001` or thereabouts, and the boundary reading — the one the
story pins — falls on the wrong side of it.

So the multiplication is **decimal arithmetic with a defined rounding**:
half-up, at the storage precision. And the threshold is computed **once**,
when the component is selected, so every reading is compared against the
**same number** — not against a fresh multiplication that might round
differently.

### The confirmation gate

**Confirmation is impossible unless the zone is `OK`** (invariant 3, BRD
FR-10, C-07). There is **no other path** to a `WeighingRecord`.

And the gate is enforced in the **domain**, not by disabling a button in the
UI: *"a disabled button is presentation, not a control."*

The gate reads the **current** zone at confirmation time — not the zone the
operator last saw. A reading that arrived between the operator seeing `OK`
and pressing confirm changes the answer.

### Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| **ZoneComputed** | A reading was evaluated | `componentId`, `zone`, `value`, `bounds` |
| **ConfirmationRefused** | A confirmation was refused | `componentId`, `zone`, `reason` — the reason distinguishes `UNDER`, `NEAR` and `OVER`, so the UI can show the right next step |
| **WeighingConfirmed** | A confirmation was accepted | `recordId`, `componentId`, `actualQuantity`, `zoneAtConfirm` |

### Domain Services

- **ToleranceZoneEvaluator**: the pure computation. It takes a value, a
  target and a tolerance, and returns a zone. **It has no state, no
  persistence, no external contract and no failure mode of its own** — so it
  is a **pure function**, not a service with dependencies.

- **ConfirmationGate**: decides whether a confirmation may proceed, and
  writes the record when it may.

  It refuses on `UNDER`, `NEAR` and `OVER` — and the refusal carries the
  **zone**, so the caller can tell the operator what to do next. It accepts
  only on `OK`.

### Repository Interfaces

| Repository | Entity | Methods | Persisted? |
|---|---|---|---|
| **WeighingRecordRepository** | `WeighingRecord` | `save(record)`, `latestFor(componentId)` | **Yes** — append-only |

**And the weighing record's table carries `BEFORE UPDATE` and `BEFORE
DELETE` triggers that abort.** A record describes something that physically
happened, and BRD DR-02 forbids revising it. The repository has no update
path, and the database makes that true against everyone.

### Ubiquitous Language

- **Zone** — where the reading sits against the target: `OVER`, `OK`, `NEAR`
  or `UNDER`.
- **Tolerance band** — `target ± tolerance`. The `OK` zone.
- **Near threshold** — `target × 0.9`. The `NEAR` boundary.
- **Still to weigh** — `max(0, target − current)`. Never negative.
- **Confirmation** — the act that writes a `WeighingRecord`.
- **Record** — the immutable evidence of a completed weighing.

---

## Constraints carried into the Technical Design

1. **The zone is computed in the DOMAIN, and only in the domain.** The UI
   receives it; it never derives it. One computed zone feeds the status
   line, the live-weight cell and the progress bar, so they cannot disagree
   (FR-9, BRD FR-16, BRD FR-17, C-05).
2. **Every boundary is EXACT.** `target + tolerance` is `OK`; one ULP above
   is `OVER`. `target − tolerance` is `OK`. `target × 0.9` is `NEAR`; one
   ULP below is `UNDER`.
3. **`target × 0.9` is computed in fixed-point decimal**, half-up at the
   storage precision — never by multiplying a float.
4. **The bounds are computed ONCE per component**, so every reading is
   compared against the same three numbers.
5. **The still-to-weigh clamp is in the DOMAIN**, not in the renderer.
6. **Confirmation requires `OK`** — and the gate is in the domain, not in a
   disabled button.
7. **The gate reads the CURRENT zone**, not the one last displayed.
8. **The record is immutable** (BRD DR-02, C-12) — no update, no delete,
   and the triggers enforce it.
9. **The record SNAPSHOOTS the target and tolerance** as they were at
   weighing time, so a later revision in OrgaTEX cannot alter the history
   (BRD FR-25, BRD BR-14).
10. **A confirmation is IDEMPOTENT per component in a session** — a
    replayed submit does not write a second record.
11. **All arithmetic is fixed-point decimal.** No float in the comparison
    path (BRD NFR-16, C-11).
12. **No prose crosses the boundary.**

---

## The edge cases, answered

| Scenario | Where it is answered |
|----------|----------------------|
| The reading is exactly `target + tolerance` | `OK` — the `OVER` bound is strict |
| The reading is exactly `target − tolerance` | `OK` — the `OK` bound is inclusive |
| The reading is exactly `target × 0.9` | `NEAR`, not `UNDER` |
| The reading is one ULP below `target × 0.9` | `UNDER` |
| The target is zero | `target × 0.9` is zero; any positive reading is `OVER`; a zero reading is `OK` |
| The tolerance is zero | `OK` requires `value == target` exactly |
| The active component changes mid-stream | The zone is recomputed against the **new** component's target and tolerance on the next reading; the stale zone is discarded |
| No component is active | **No zone is produced** — the session exposes no zone |
| The zone changes to `OVER` between the operator seeing `OK` and pressing confirm | The confirmation is **refused** — the gate reads the current zone |
| The scale disconnects immediately before confirmation | Confirmation is **blocked** while disconnected (BRD IR-13) |
| The confirmation request is replayed | The second attempt writes **no second record** — idempotent per component in a session |
| A correction is required after confirmation | A **new** record references the original; the original is untouched |

---

## Open points carried forward

- **The tolerance model** (Q-05, A-07). The model is a percentage with an
  absolute floor and it originates in OrgaTEX. **This bolt consumes the
  resolved target and tolerance** and does not re-derive them — unit
  `002`'s recipe already carries the resolved band.
- **The `OVER` exception.** An out-of-tolerance confirmation is permitted
  only under an authorised override, and that authorisation is issued
  through story `007` — a supervisor-authenticated, reasoned, scoped,
  expiring override. **This bolt consumes that authorisation; it does not
  create it** (bolt `016`).
- **`zoneAtConfirm`.** The zone at the moment of confirmation is
  snapshotted onto the record, so a later tolerance revision cannot rewrite
  history (BRD FR-25, BRD BR-14).
