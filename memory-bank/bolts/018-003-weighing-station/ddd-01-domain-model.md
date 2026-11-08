---
stage: model
bolt: 018-003-weighing-station
created: 2026-11-06T05:35:00Z
---

## Static Model: 003-weighing-station (bolt 018)

### Entities

- **BatchSummary**: the batch's completion summary — the batch id, the
  counts, the elapsed time, the operator, the total dispensed, the
  tolerance verdict, the write-back result and the release statement.

  It is a **projection of what already happened**, computed from the
  immutable records. It is **not** a record of an act — the acts are the
  weighing records, and the summary only reads them (BRD DR-02, C-12).

### Value Objects

| Value object | Shape | Rules |
|---|---|---|
| **ToleranceVerdict** | `YES` \| `NO` | Whether **every** confirmed weighing was in the `OK` zone. **Two values, never three** — there is no "partially". A component confirmed under a supervisor override was **not** within tolerance, so the verdict is `NO`. |
| **TotalDispensed** | a `WeightValue` | The total, **converted and summed** — never concatenated display strings. |
| **WriteBackState** | `CONFIRMED` \| `PENDING` \| `FAILED` | The OrgaTEX write-back's outcome. **A pending write-back does not un-complete the batch.** |
| **ElapsedTime** | a `Duration` | From the session's `startedAt` to the completion moment. |

### The total is COMPUTED, not displayed

**This is the story's fifth acceptance criterion, and it is the one that
catches people:**

> *"the total dispensed is computed in fixed-point decimal with units
> converted and summed correctly — grams and kilograms are added as one
> quantity, never by concatenating display strings"*

**And the story gives the worked example:** `500.0 g` + `24.000 kg` =
`24.500 kg`.

So the arithmetic is:

```text
convert each confirmed record's quantity into ONE unit
sum them, in fixed-point decimal
report the total in that unit
```

**And the unit is chosen deliberately** — the story's example reports
kilograms, and the recipe's auxiliaries are in kilograms while the
dyestuffs are in grams. So the total is in **kilograms**, and a gram
quantity is converted before it is added.

**Why the conversion must be exact.** `decimal.js`, never a float
division — the same rule as the reading conversion (bolt `016`) and the
compensation factor (bolt `015`). `0.5 kg` is `500 g`, not
`499.9999999 g`.

**And the summary is produced by the DOMAIN**, not assembled by the UI
from display strings — the story says so explicitly. A UI that concatenated
`"500.0"` and `"24.000"` would produce `"24.000500.0"`.

### The tolerance verdict is a QUALITY SIGNAL

**"`YES` only when every confirmed weighing was in the `OK` zone."**

And the story is explicit about the override case:

> *"A component confirmed under a supervisor override (story 007) was
> **not** within tolerance, and the summary must say `NO`. This is what
> makes the summary a usable quality signal."*

**And the override is visible in the record** — bolt `016` writes the
**over-dose** zone as the record's `zoneAtConfirm`, precisely so this
verdict can be computed from the record rather than reconstructed.

**So the verdict reads `zoneAtConfirm` from the records** — and a record
whose zone is `OVER` (an authorised override) makes the verdict `NO`.

**And the summary still COMPLETES the batch.** The story's edge case: *"a
component was confirmed under a supervisor override → 'All within
tolerance' is `NO`; the summary still completes the batch."*

### The write-back is CONSUMED, not implemented

**Unit `005` already owns the entire OrgaTEX write path**, and it settled
it in its own ADRs:

| Unit 005's service | What it does | Why bolt 018 must not re-implement it |
|---|---|---|
| **`ConsumptionPostingService.post`** | Posts one consumption, with the **idempotency ledger** as the atomic guard | ADR-023 — the ledger's PRIMARY KEY is the guarantee, and a read cannot be atomic |
| **`ConsumptionPostingService.redeliver`** | Re-sends a posting that has not landed | The queue's delivery path — *"has this key been consumed?"* must have **one** implementation |
| **`BatchStatusWriteService.advanceToWeighed`** | Writes `WEIGHED` — but **only** when every one of the batch's postings is resolved | The precondition is the point: a batch whose second component has not landed is not a malformed request; it is a world whose state refuses the write |

**So this bolt calls those services and does not re-implement their
guards.** A second idempotency check here would be a second answer to
"has this key been consumed?" — and the second answer is the one nobody
tested.

**And the posting's key is DERIVED** by unit 005 from the weighing's
identity — never chosen by a client (ADR-023's rule, and the schema's
rule: the body has no `idempotencyKey` field).

### The write-back is NOT a precondition for completion

**This is the edge case that decides the design:**

> *"Weighing continues when OrgaTEX is unreachable; unsynchronised records
> are queued and transmitted on reconnection, and the summary reflects that
> the write-back is pending. A pending write-back does not un-complete the
> batch."*

**And:**

> *"OrgaTEX is unreachable at completion → the batch completes; the
> write-back is queued and the summary shows the write-back as pending, not
> confirmed."*

**So the batch's completion and the MES's acknowledgement are SEPARATE
facts.** The weighing is done — the material is in the container — and the
MES's copy catches up when the link returns.

**And this is the same shape as ADR-018's "a refusal is a value, not an
error"**: the write-back's state is reported faithfully, and none of its
states prevents the completion.

### The summary's own facts

| Fact | Where it comes from |
|---|---|
| The batch identifier | the session's |
| The components weighed, as a count of the total | the session's component states |
| The elapsed time | the session's `startedAt` → the completion moment |
| The operator | the session's |
| The total dispensed | the **confirmed records**, converted and summed |
| The tolerance verdict | the **confirmed records'** `zoneAtConfirm` |
| The write-back result and its confirmation time | unit 005's posting and status-write services |
| The release statement and the target machine | the batch's fact |

**And the elapsed time reflects the WHOLE session, including an
interruption.** The story: *"The elapsed time reflects the whole session,
including the interruption; it is not silently reset."* So it is measured
from the session's `startedAt` — which is persisted, and survives a
restart (bolt `013`) — to now.

### The release statement

**The summary states that the container is released for transport and names
the target machine** (BRD AC-08).

**And the ticket is out of scope** — the story: *"the ticket that
accompanies the container is produced by BRD FR-17 and is out of this unit's
scope; this story produces the summary content only."* So the summary
**states** the release; it does not produce the ticket. That is unit `006`.

### Aggregates

| Aggregate Root | Members | Invariants |
|----------------|---------|------------|
| **BatchSummary** | the facts above | 1. It is computed from the **confirmed records** — an abandoned attempt contributes nothing. 2. The total is **converted and summed** in fixed-point. 3. The verdict is `YES` **only** when every confirmed record's zone is `OK`. 4. The write-back's state is reported **faithfully** and **never** prevents the completion. 5. It **reads** the records and never mutates them. |

### Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| **BatchCompleted** | The last component was confirmed | `batchId`, `sessionId`, `completedCount`, `totalDispensed` |
| **BatchWriteBackConfirmed** | The MES accepted the write-back | `batchId`, `confirmedAt` |
| **BatchWriteBackPending** | The MES could not be reached | `batchId` — the batch is **not** un-completed |

### Domain Services

- **BatchSummaryService**: produces the summary from the session and the
  confirmed records, and drives unit 005's write-back.

- **TotalDispensedCalculator**: the conversion and the sum. **Pure** — no
  I/O, no clock, no database.

### Repository Interfaces

| Repository | Entity | Methods | Persisted? |
|---|---|---|---|
| **WeighingRecordRepository** (bolt `014`) | `WeighingRecord` | `latestFor` | **Yes** — append-only, and **read** here |
| **Unit 005's posting and status-write services** | — | `post`, `advanceToWeighed` | Unit 005's own tables |

### Ubiquitous Language

- **Summary** — the batch's completion report.
- **Total dispensed** — the sum of the confirmed quantities, converted and
  added.
- **Within tolerance** — every confirmed weighing was in the `OK` zone.
- **Write-back** — the posting of the consumptions and the batch's status
  to the MES.
- **Pending** — the write-back has not been confirmed. Not a failure of the
  weighing.
- **Release** — the container is released for transport to the target
  machine.

---

## Constraints carried into the Technical Design

1. **The summary is produced by the DOMAIN**, from the stored records —
   never assembled by the UI from display strings.
2. **The total is computed in fixed-point**, with units **converted**
   before summing — and the conversion is exact (decimal.js).
3. **The tolerance verdict is `YES` only when EVERY confirmed record's
   zone is `OK`** — an authorised override makes it `NO`.
4. **An override does not prevent the completion** — the batch still
   completes, and the verdict says `NO`.
5. **The write-back is unit 005's**, called — not re-implemented. The
   idempotency ledger is the atomic duplicate guard, and it is unit 005's.
6. **A pending write-back does not un-complete the batch** — the summary
   reports `PENDING` and the batch stays complete.
7. **The batch's status is written to `WEIGHED` only when every one of the
   batch's postings is resolved** — unit 005's precondition, unchanged.
8. **The elapsed time is measured from the session's `startedAt`** — so it
   includes an interruption, and it is not reset.
9. **Only the CONFIRMED records count** — an abandoned attempt contributes
   nothing to the total or the count.
10. **The summary READS the records and never mutates them** (DR-02, C-12).
11. **The ticket is NOT produced here** — the summary states the release
    and names the machine; unit `006` prints the ticket.
12. **Every quantity is a decimal string** — never a float (NFR-16).

---

## The edge cases, answered

| Scenario | Where it is answered |
|----------|----------------------|
| A component was confirmed under a supervisor override | The verdict is `NO`; the batch **still completes** |
| OrgaTEX is unreachable at completion | The batch completes; the write-back is queued; the summary shows it as **pending** |
| The write-back is retried after an ambiguous failure | The posting is **idempotent** — unit 005's ledger, not re-implemented here |
| The recipe mixes grams and kilograms | The total sums correctly after conversion — `500.0 g` + `24.000 kg` = `24.500 kg` |
| The session was interrupted and resumed | The elapsed time reflects the **whole** session — `startedAt` is persisted |
| A component was abandoned and re-weighed | Only the **confirmed** record counts; the abandoned attempt contributes nothing |
| The scale disconnects at the moment of the final confirmation | The confirmation is **blocked** while disconnected — the gate's rule (bolt `014`); the batch does not complete on a stale reading |

---

## Open points carried forward

- **The ticket** — unit `006`. The summary states the release; the ticket
  is printed elsewhere.
- **The queue's delivery** — unit `005`'s sync queue delivers a pending
  posting when the link returns. This bolt reports the pending state; it
  does not drive the queue.
- **The summary's rendering** — unit `007`. The content is here; the
  screen is there.
