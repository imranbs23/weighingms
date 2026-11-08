---
stage: design
bolt: 018-003-weighing-station
created: 2026-11-06T05:55:00Z
---

## Technical Design: 003-weighing-station (bolt 018)

### Architecture Pattern

**Hexagonal (ports and adapters), with the seam owned by the consumer** — the
same shape as the previous bolts.

**And this bolt's defining property is that it adds a port over ANOTHER
UNIT'S SERVICES, not over an external system.** Unit `005` already owns
the OrgaTEX write path.

### Layer Structure

```text
┌──────────────────────────────────────────────────────────────────┐
│ Presentation                                                     │
│   BatchSummaryController   GET /api/batch/summary                │
├──────────────────────────────────────────────────────────────────┤
│ Application                                                      │
│   CompleteBatch            the write-back, then the summary       │
├──────────────────────────────────────────────────────────────────┤
│ Domain                                                           │
│   BatchSummary             the facts                              │
│   ToleranceVerdict         YES | NO                               │
│   WriteBackState           CONFIRMED | PENDING | FAILED          │
│   TotalDispensedCalculator PURE — convert, then sum               │
│   OrgatexWriteBackPort     THE PORT (unit 005's services)        │
├──────────────────────────────────────────────────────────────────┤
│ Infrastructure                                                   │
│   (no new table — the summary is computed, not stored)           │
└──────────────────────────────────────────────────────────────────┘
```

### API Design

#### `GET /api/batch/:batchId/summary` — the summary

`200` with the summary, or `200` with `summary: null` when the batch is
not complete.

**And there is a `POST` for the completion** — the write-back is a write,
so it is a `POST`, and it is **idempotent**: a retry after an ambiguous
failure must not double-post (BRD IR-08, C-14).

#### `POST /api/batch/:batchId/complete` — the completion

| Status | Meaning | Body |
|---|---|---|
| **200** | The batch is complete | `{ summary }` |
| **409** | The batch is not complete | `{ error: "BATCH_NOT_COMPLETE" }` |

### The port over unit 005's services

```ts
export interface OrgatexWriteBackPort {
  /** Post one consumption. Unit 005's idempotency ledger is the guard. */
  postConsumption(request: ConsumptionRequest): Promise<PostingOutcome>;
  /** Advance the batch's status to `WEIGHED` — only when all postings resolve. */
  advanceBatchStatus(batchId: BatchId): Promise<BatchStatusWriteOutcome>;
}
```

**And unit 005's `ConsumptionPostingService` and
`BatchStatusWriteService` satisfy it structurally** — the composition root
binds them directly, with no adapter class and **no second implementation
of any guard** (the same rule ADR-039 set for the authorisation).

### The total — the conversion and the sum

**Pure, and in the domain.** The calculator:

1. takes the confirmed records' quantities;
2. **converts** each into the summary's unit — kilograms — exactly;
3. **sums** them in fixed-point decimal;
4. returns the total as a `WeightValue`.

**And the conversion is exact.** `decimal.js`, and the unit `004`
converter's rates — not a float division. `0.5 kg` is `500 g`, never
`499.9999999 g`.

**And the summation is in ONE unit.** The story's example: `500.0 g` +
`24.000 kg` = `24.500 kg`. So the grams are converted **before** they are
added — not added as a string and not added as a float.

**The unit is chosen once**, for the whole total — and it is kilograms,
because the recipe's auxiliaries are in kilograms and a kilogram total is
the one an operator reads.

### The verdict

**`YES` only when EVERY confirmed record's `zoneAtConfirm` is `OK`.**

And it is computed from the **records** — so an authorised override, whose
record carries the **over-dose** zone (bolt `016`), makes the verdict `NO`
automatically. **The verdict does not need to know about overrides at
all** — it reads the zone, and the zone already says what happened.

**And it is a two-valued verdict** — `YES` or `NO`. There is no
"partially within tolerance", because a batch is either shippable within
tolerance or it is not.

### The write-back's order, and its independence

**The write-back is driven AFTER the batch's completion is recorded, and
its outcome does not gate the completion.**

```text
1. the batch is COMPLETE (bolt 017's progression said so)
2. post each confirmed record's consumption   → unit 005
3. advance the batch's status to WEIGHED       → unit 005
4. compute the summary
5. report the write-back's state — CONFIRMED | PENDING | FAILED
```

**And step 5's outcome does not change step 1.** A `PENDING` write-back
means the MES could not be reached; the material is weighed and in the
container regardless, and the queue will deliver it when the link returns
(BRD FR-30, FR-31, NFR-03).

### The records the summary reads

**Only the confirmed ones.** The story's edge case: *"a component was
abandoned and re-weighed before completion → only the confirmed record
counts towards the total and the component count; the abandoned attempt
contributes nothing."*

**And the records are immutable** — so the summary reads them and never
writes them (BRD DR-02, C-12).

### The session's states at completion

**`COMPLETE`, and no component remains `PENDING`** — invariant 4.

**And the elapsed time is measured from the session's `startedAt`** — which
is persisted, so it survives a restart and the elapsed time includes an
interruption.

### Data Model

**No new table.** The summary is **computed**, not stored — it is a
projection of the records, and a stored copy would be a second thing to
keep in step with the records.

### Security Design

| Concern | Approach |
|---|---|
| **Session** | Required (ADR-020). A summary is about the operator's own work. |
| **A client-supplied total** | There is **no** field for it. The total is computed from the records. |
| **A client-supplied verdict** | There is **no** field for it. The verdict is computed from the records' zones. |
| **A client-supplied operator** | There is **no** field for it. The operator comes from the session — and the consumption posting's schema has **no** `operatorId` field either (unit 005's rule). |
| **A client-supplied idempotency key** | There is **no** field for it. The key is **derived** by unit 005 from the weighing's identity. |
| **A client-chosen batch** | The batch must be the session's, and the completion requires the session to be `COMPLETE`. |
| **Double-posting** | Unit 005's **ledger** — the atomic guard, unchanged. |

### NFR Implementation

| Requirement | Design approach |
|---|---|
| **BRD IR-08 / C-14 — the write-back is idempotent** | Unit 005's ledger. This bolt calls `post` and does not re-check. |
| **BRD FR-30 / FR-31 / NFR-03 — weighing continues when the MES is unreachable** | The write-back's outcome does not gate the completion; the summary reports `PENDING`. |
| **BRD FR-15 / NFR-16 / C-11 — the total is fixed-point, converted and summed** | `decimal.js`, in the domain, in one unit. |
| **BRD FR-26 / FR-29** | The summary carries the batch id, the counts, the elapsed time and the operator. |
| **BRD AC-08** | The summary states the release and names the target machine. |
| **BRD DR-01 / DR-02** | The summary **reads** the immutable records and retains nothing of its own. |

### Testing Plan

| Suite | What it proves |
|---|---|
| **Unit — the total** | Grams and kilograms are **converted and summed** — `500.0 g` + `24.000 kg` = `24.500 kg`; and the sum is exact, not a float artefact. |
| **Unit — the verdict** | `YES` only when **every** zone is `OK`; an `OVER` (an authorised override) makes it `NO`; and it is **two-valued**. |
| **Unit — the elapsed time** | It is measured from the session's `startedAt` — so an interruption is **included**. |
| **Integration — the summary** | The `200` carries the counts, the total, the verdict, the write-back state and the release statement; an incomplete batch is a `409`. |
| **Integration — the write-back** | The consumptions are posted and the status advanced; a **retry** does not double-post. |
| **Persistence** | The records are **unchanged** by the summary. |
| **Security** | No session → `401`; a client-supplied total, verdict, operator or idempotency key is **dropped**; the summary never mutates a record. |

### Open points carried forward

1. **The ticket** — unit `006`. The summary states the release; the ticket
   is printed elsewhere.
2. **The queue's delivery** — unit `005`'s sync queue delivers a pending
   posting when the link returns. This bolt reports the pending state; it
   does not drive the queue.
3. **The summary's rendering** — unit `007`. The content is here; the
   screen is there.
