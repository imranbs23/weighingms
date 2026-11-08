---
stage: design
bolt: 011-002-recipe-material-management
created: 2026-11-06T00:10:00Z
---

## Technical Design: 002-recipe-material-management (bolt 011)

### Architecture Pattern

**Hexagonal (ports and adapters), with the seam owned by the consumer** — the
same shape as bolt 010, and the same reasoning (ADR-028, ADR-032).

This bolt adds **two ports** and **two repositories**:

| Port | What it is | Bound to |
|---|---|---|
| `DyestuffScanner` | The barcode device | The station's **single** scanner instance |
| `DyestuffMasterSource` | The MES's dyestuff-master / lot read | Unit `005`'s reader |

And it adds **two repositories**, because — unlike the recipe — the identity
and the lot are the station's **own facts** and must be durable (ADR-031's
distinction).

### Layer Structure

```text
┌──────────────────────────────────────────────────────────────────┐
│ Presentation                                                     │
│   MaterialIdentityController  POST /api/material-identity        │
│   MaterialLotController        POST /api/material-lot             │
│   (Zod schemas on the boundary)                                   │
├──────────────────────────────────────────────────────────────────┤
│ Application                                                      │
│   VerifyMaterialIdentity      scan / attest                       │
│   CaptureMaterialLot          source / scan / keyed-in           │
├──────────────────────────────────────────────────────────────────┤
│ Domain                                                           │
│   MaterialIdentity            the aggregate — an immutable act     │
│   MaterialLotCapture          the aggregate — an immutable act     │
│   VerificationMethod          SCAN | ATTESTATION                  │
│   CaptureMethod               SOURCE | SCAN | KEYED_IN            │
│   AttestedClaims              the attested-claims set              │
│   MaterialIdentityVerifier    the comparison rule                  │
│   LotCaptureService           the capture rule                    │
│   LotValidator                presence, format, optional upstream  │
│   MaterialIdentityRepository  THE PORT                            │
│   MaterialLotRepository       THE PORT                            │
│   DyestuffScanner             THE PORT (the device)               │
│   DyestuffMasterSource        THE PORT (the MES seam)             │
├──────────────────────────────────────────────────────────────────┤
│ Infrastructure                                                   │
│   CompositionRoot              binds every port in ONE place       │
│   SqliteMaterialIdentityRepository   append-only                  │
│   SqliteMaterialLotRepository        append-only                  │
│   MaterialDatabase             the unit's tables and migrations    │
└──────────────────────────────────────────────────────────────────┘
```

### API Design

#### `POST /api/material-identity` — verify the material in hand

The unit's own endpoint for the **verification**. One verb, and the verb is
the story's: the identity is *established*, not edited.

| Status | Meaning | Body |
|---|---|---|
| **201** | The identity was verified | `{ identity: {...} }` |
| **400** | The body is not a verification request | `{ error: "VALIDATION_ERROR" }` |
| **401** | No operator session | `{ error: "UNAUTHENTICATED" }` |
| **404** | The recipe holds no such component | `{ error: "COMPONENT_NOT_FOUND" }` |
| **409** | The scan **mismatched** — a hard stop | `{ error: "MATERIAL_MISMATCH", scannedCode, expectedCode }` |
| **503** | The scanner could not be read | `{ error: "SCANNER_UNAVAILABLE" }` |

**The body carries exactly one of `code` or `attestation`:**

```json
{ "componentId": "DYE-4471-Y", "code": "DYE-4471" }
```

```json
{ "componentId": "DYE-4471-Y", "attestation": { "dyestuffCode": "DYE-4471" } }
```

- A `code` means the **scanner** read it — the method is `SCAN`, and it is
  **derived** from the body's shape, never supplied (ADR-030's rule).
- An `attestation` means the operator confirmed it on screen — the method is
  `ATTESTATION`, also derived.

**There is no `verifiedBy` field, and no `operatorId` field.** The operator
comes from the **session**; the method is derived from the shape. A client
that could choose either could write a false attribution or a false method
into an immutable traceability record (ADR-030, ADR-005).

**The `409` names both codes.** The story requires it: *"the reason names
the scanned code and the expected code"*. This is the one place the station
does name values in a refusal — and it is deliberate, because the operator
must be told **which** material was expected and **which** was presented.
Both are codes, not prose (BRD NFR-11).

#### `POST /api/material-lot` — capture the lot against a component

| Status | Meaning | Body |
|---|---|---|
| **201** | The lot was captured | `{ capture: {...} }` |
| **400** | The body is not a capture, or the lot is empty or too long | `{ error: "VALIDATION_ERROR", fields: [...] }` |
| **401** | No operator session | `{ error: "UNAUTHENTICATED" }` |
| **404** | The recipe holds no such component | `{ error: "COMPONENT_NOT_FOUND" }` |
| **409** | The scanned lot resolved to nothing | `{ error: "LOT_NOT_RECOGNISED" }` |
| **503** | The MES could not be reached and the lot was source-held | `{ error: "ORGATEX_UNAVAILABLE", reason }` |

**The body carries exactly one of `lotNumber` or `code`:**

```json
{ "componentId": "DYE-4471-Y", "lotNumber": "2026-0387" }
```

```json
{ "componentId": "DYE-4471-Y", "code": "L-77120" }
```

- A `lotNumber` means the operator **keyed it in** — the method is
  `KEYED_IN`, derived from the shape.
- A `code` means the **scanner** read it — the method is `SCAN`, derived.
- A `SOURCE` capture is **not** a client request at all: it is the MES's own
  lot, read through the adapter, and it is captured by the station when it
  prepares the component. So there is **no** body shape that produces
  `SOURCE` — a client cannot claim the MES held a lot.

**And there is no `captureMethod` field.** The method is derived, exactly as
ADR-030 derives the selection's.

**The MES's own lot is preferred when it exists.** The capture service first
asks the `DyestuffMasterSource` whether the MES holds a lot for the
component. If it does, that lot is captured as `SOURCE` — and the operator's
keyed-in value is **not** used to overwrite it (the story's first edge case:
*"correcting a source-held lot is an upstream data matter"*).

**When the MES holds no lot,** the operator's scan or keyed-in value is
captured instead. And when the MES is **unreachable**, the scan and
keyed-in paths **remain available** — the station keeps working (BRD
FR-20) — and the capture method records that the lot was not source-held.

#### `GET /api/material-lot/:componentId` — the effective capture

A read of the newest capture for a component. `200` with the capture, or
`200` with `capture: null` when there is none — **never a `404`**, because
"not captured yet" is a **state**, and it is the first thing the rail
renders.

#### Authentication

**An operator session is required** (ADR-020). A **supervisor is not** —
verifying a material and capturing a lot are not privileged actions. The
identity unit's `PrivilegedAction` set is tolerance override, manual scale
reselection and calibration bypass, and neither of these is in it.

### Data Model

Two tables, both **append-only**.

#### `material_identities`

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | The **insertion sequence** — the tie-breaker (ADR-029's rule) |
| `component_id` | `TEXT NOT NULL` | The recipe slot |
| `material_code` | `TEXT NOT NULL` | The material the component calls for |
| `verified_by` | `TEXT NOT NULL CHECK (verified_by IN ('SCAN','ATTESTATION'))` | The **closed set in the storage layer** — a third method cannot be written even by a path that bypasses the domain |
| `verified_at` | `TEXT NOT NULL` | The moment of the act |
| `operator_id` | `TEXT NOT NULL` | From the session |
| `barcode` | `TEXT NULL` | The scanned code, **only** when the method is `SCAN` |
| `attested_claims` | `TEXT NULL` | The claims, **only** when the method is `ATTESTATION` |
| `recorded_at` | `TEXT NOT NULL` | The moment of the write — kept apart from the act, as unit `001`'s selection does |

**There is no `is_current` column.** The effective identity is the newest
row: `ORDER BY verified_at DESC, id DESC` — a **total** order, so two
terminals read the same answer.

**`BEFORE UPDATE` and `BEFORE DELETE` triggers that `RAISE(ABORT, ...)`.**
A repository with no update method is a convention; a trigger is a
guarantee — it holds against a migration script and against any future unit
that decides to write here (ADR-029).

#### `material_lot_captures`

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | The insertion sequence |
| `component_id` | `TEXT NOT NULL` | The recipe slot |
| `lot_number` | `TEXT NOT NULL` | The supplier's lot — an **identifier**, never a quantity |
| `material_code` | `TEXT NOT NULL` | The material it was captured against |
| `capture_method` | `TEXT NOT NULL CHECK (capture_method IN ('SOURCE','SCAN','KEYED_IN'))` | The closed set in the storage layer |
| `captured_by` | `TEXT NOT NULL` | From the session |
| `captured_at` | `TEXT NOT NULL` | The moment of the capture |
| `recorded_at` | `TEXT NOT NULL` | The moment of the write |

**No `superseded_at`, no `is_active`.** The effective capture is the newest
row — the story's edge case, and ADR-029's argument, applied to the lot.

**And the lot is NOT de-duplicated.** Two components may share a lot, and
both captures are stored.

### The scanner — ONE device, TWO ports, ONE instance

This is the decision ADR-033 records, and it is the one genuinely tricky
thing in this bolt.

**The facts.** The workbook requires a Dummy Scanner with
`POST /api/scan`. Unit `001` already owns a `BatchScanner` port over it, and
its `DummyBatchScanner` is the training device. Unit `002` now needs to
read **two** more things through the same physical device: a **dyestuff
code** (story 002) and a **lot code** (story 003).

**The naive shape** is for unit `002` to declare its own scanner port and
its own adapter. That gives **two devices** — and two devices that are
really one means two sources of truth for "what was just scanned", two
adapters to keep in step, and a station where the batch card and the
dyestuff code go to different places.

**The chosen shape** is:

1. **Two ports, one device.** Unit `002` declares `DyestuffScanner` (its own
   port, because a port belongs to its consumer — ADR-028's rule), and the
   composition root binds it to the **same `DummyBatchScanner` instance**
   unit `001` uses. The instance is shared, so the device state cannot
   drift.
2. **The device is shared; the ports are per-consumer.** Unit `001` reads a
   *batch* code through `BatchScanner`; unit `002` reads a *material* or
   *lot* code through `DyestuffScanner`. The domain rules for each are the
   consumer's own, and neither unit imports the other's port.
3. **A read is CONSUMED.** The device forgets a code after it is read, so
   one card cannot satisfy two reads. That is the device's behaviour, not
   either unit's rule — and it is already how `DummyBatchScanner` behaves.

**The consequence for the domain:** the scanner's outcome carries **only a
code** — it does not say whether the code was a batch, a material or a lot.
**That classification is the consumer's job.** Unit `001` resolves its code
against the released queue; unit `002` resolves its code against the
recipe's component, and the lot path resolves it against the lot master.
A code that matches none of them is a **refusal naming what was expected**,
not a device error — the device read a code perfectly well.

### The MES's dyestuff master — the port, not the second read

`DyestuffMasterSource` answers *"does the MES hold a lot for this
component?"*. It is a **port unit `002` owns**, bound in the composition
root to a reader over unit `005`'s seam.

**The question it answers is narrow, and the narrowness is the point.** The
alternative — a full dyestuff-master read, with the name and the colour and
every lot the MES knows — would be a second contact and a second cache for
one component's facts (ADR-032). This bolt needs exactly one answer: *the
lot the MES holds for this component, if any.*

**And when the MES holds no lot, the answer is `NO_LOT`** — not an error. A
component without a source-held lot is the **normal** case for the scan and
keyed-in paths, and it must not look like a failure.

### Security Design

| Concern | Approach |
|---|---|
| **Session** | Required (ADR-020). The operator comes from `req.currentOperator` — never from the body. |
| **Client-supplied method** | There is **no** `verifiedBy` and **no** `captureMethod` field in either schema. The method is **derived** from the body's shape. |
| **Client-supplied operator** | There is **no** `operatorId` field. It comes from the session. |
| **An attestation entered silently** | The attestation path requires an **explicit** `attestation` object naming the claimed code. There is no implicit default, and the schema requires the claim to be present. |
| **A mismatch downgraded** | Structurally impossible: the mismatch path returns **before** the repository is touched, and the attestation path is a **different endpoint call with a different body**. There is no parameter that says "ignore the mismatch". |
| **Unbounded identifiers** | `ComponentId`, `DyestuffCode` and `LotNumber` (unit `005`'s) bound at 64 characters. A lot longer than that is refused **naming the maximum**, never truncated. |
| **Diagnostics leaking** | The refusal bodies carry **codes**. The mismatch carries the two codes — required by the story — and the MES's own error text never crosses. |
| **Immutability** | No update path, no delete path, and the database's triggers. |

### NFR Implementation

| Requirement | Design approach |
|---|---|
| **NFR-16 — no float for quantities** | The lot is an **identifier**, never a quantity, and is stored as text. The story is explicit: *"the lot identifier embeds a quantity-like token, it is not converted to a number and never to a float."* |
| **NFR-3 / FR-20 — available during an outage** | When the MES is unreachable, the **scan and keyed-in paths remain available**. The upstream's existence check is **optional** — the capture stands on its own evidence. |
| **DR-01 — retained ≥ 5 years** | The tables are append-only, with no pruning path. A pruning policy would be FCI's decision, and the same one the selection table waits for. |
| **DR-02 — immutable** | Append-only, with the triggers. |
| **NFR-11 — no prose at the boundary** | Codes and data only. |

### Integration Plan

**Bound in the composition root, and nowhere else:**

```text
src/api/server.ts
  └── buildRecipeMaterialModule({
        source: orgatex.recipeReader,          // bolt 010
        scanner: batches.scanner,               // the SAME scanner instance
        master: orgatex.dyestuffMasterReader,   // unit 005's master reader
        identities: new SqliteMaterialIdentityRepository(...),
        lots: new SqliteMaterialLotRepository(...),
      })
```

**What this bolt adds to unit `005`:** a **dyestuff-master reader** over the
existing seam — `readDyestuffLot(componentId)` on the adapter, returning
the lot the MES holds or `null`. **Minimal and additive**: no new outcome
kind, no change to the queue's or the recipe's reads, no change to the
cache.

**What this bolt adds to the API surface:** two paths,
`/api/material-identity` and `/api/material-lot`.

### Testing Plan

| Suite | What it proves |
|---|---|
| **Unit — the verifier** | A matching scan verifies; a mismatching scan is a hard stop naming both codes; an unreadable scan offers the attestation path; the method is derived, never supplied. |
| **Unit — the capture service** | The three methods; the MES's lot wins and is not overwritten; an unreachable MES leaves the operator's paths available; a refusal writes **nothing**. |
| **Unit — the validator** | Empty is refused; whitespace is trimmed; 65 characters is refused; 64 is accepted; the value is never truncated. |
| **Unit — the value objects** | `VerificationMethod` and `CaptureMethod` are closed sets; `AttestedClaims` is a set. |
| **Integration — the endpoints** | `201` with the record; the operator is from the session; the method is derived; a mismatch is a `409` naming both codes; an empty lot is a `400`; a lot over 64 is a `400`; no session is a `401`. |
| **Integration — the append-only history** | Two captures for one component: the newest is effective and the older is **retained**; the same lot for two components: **both** stored. |
| **Persistence** | The triggers abort an update and a delete; the closed-set `CHECK` refuses a third method; the newest-row ordering is total. |
| **Security** | No session → `401`; no client-supplied operator or method; the mismatch cannot be downgraded; the diagnostics never leak. |
| **Composition root** | Every port is bound to the one it was given — including the **same** scanner instance unit `001` uses, so a second device would be visible in one place. |

### Open points carried forward

1. **The lot's upstream existence check.** Whether the MES can be asked *"is
   this lot known?"* is A-09 / IR-04, and the check is **optional**. If FCI
   answers "yes", the master port grows a second method; the capture
   service does not change.
2. **The scanner's device contract** (Q-03). The port is the boundary and
   the Dummy's shape is a training contract. A real scanner replaces the
   adapter without touching the domain.
3. **Whether a lot belongs to the material or the component.** The capture
   is against the **component** with the material code copied — the BRD's
   `WEIGHING_RECORD` references `lot_id`, and a lot may serve several
   components.
