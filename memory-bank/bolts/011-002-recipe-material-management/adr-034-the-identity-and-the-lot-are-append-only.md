---
bolt: 011-002-recipe-material-management
created: 2026-11-06T00:35:00Z
status: accepted
---

# ADR-034: The identity and the lot are the station's own facts, and they are append-only

## Context

This bolt records two things: a **material identity** (the material in hand
is the material the recipe calls for) and a **lot capture** (this supplier
batch of it). Both describe something that **physically happened at this
station**, and both must survive into the weighing record and the audit
trail (BRD FR-25, BRD BR-11, BRD BR-14, DR-01, DR-02).

Three questions have to be answered, and they pull in different directions.

**First: are these persisted at all?** ADR-031 just refused to persist the
**recipe** — because it is a projection of somebody else's truth, it can be
re-fetched, and a persisted copy would be a stale-looking-fresh risk. It
would be easy to read that ADR as a general rule for this unit: *"unit 002
persists nothing."*

**Second: how is the "current" one found?** The story's edge case is
explicit:

> *"Two different lots are captured for the same component in one weighing →
> the most recent capture for that component is the effective one, and the
> superseded capture is retained in the record rather than deleted."*

And the same shape for the identity: an operator attests, then scans a
matching code — *"the later scan supersedes the attestation, and the
superseded attestation is not silently deleted"* — but an operator who
scans a matching code and *then* attests does **not** downgrade it.

**Third: what does the operator get to choose?** The method (`SCAN` or
`ATTESTATION`; `SOURCE`, `SCAN` or `KEYED_IN`) and the operator id are both
facts about the act. The method is derivable from the request's shape; the
operator comes from the session. Neither belongs in a request body.

## Decision

**Both records are persisted, both are strictly append-only, and neither
client-supplied fact is accepted.**

1. **They ARE persisted — two tables.** `material_identities` and
   `material_lot_captures`.

2. **Append-only.** No `update`, no `delete` in the repository, and
   `BEFORE UPDATE` / `BEFORE DELETE` triggers that `RAISE(ABORT, ...)`.

3. **The effective record is the NEWEST ROW** — `ORDER BY verified_at DESC,
   id DESC` and `ORDER BY captured_at DESC, id DESC`. **No `is_active`, no
   `superseded_at`, no pointer table.**

4. **The `id` is the insertion sequence** — `INTEGER PRIMARY KEY
   AUTOINCREMENT` — and it is what breaks a tie when two records land in
   the same millisecond.

5. **The method is DERIVED from the request's shape**, and the **operator
   comes from the session**. There is no `verifiedBy` field, no
   `captureMethod` field and no `operatorId` field in either schema.

6. **A refusal writes NOTHING.** The refusal path returns before the
   repository is touched.

7. **The method's closed set is in the storage layer** — `CHECK
   (verified_by IN ('SCAN','ATTESTATION'))` and `CHECK (capture_method IN
   ('SOURCE','SCAN','KEYED_IN'))` — so a third method cannot be written even
   by a path that bypasses the domain.

## Rationale

### Why they ARE persisted, when the recipe is not

ADR-031's reasoning, applied exactly, **separates** two different things —
and that is what settles this:

| | Owner | Can it be re-derived? | Durable? |
|---|---|---|---|
| The **recipe** | OrgaTEX | **Yes** — ask the MES again | **No** |
| The **identity** | the station | **No** — the MES has no idea the operator attested | **Yes** |
| The **lot capture** | the station | **No** — the MES has no idea which lot the operator used | **Yes** |

The recipe is a **copy of somebody else's truth**. A persisted copy of it
risks being stale-looking-fresh: a row written before a power cut, read
back afterwards, carries a pre-restart `receivedAt`, and its age is
*mathematically correct* — which is exactly the problem.

An identity and a lot capture are **not copies of anybody's truth**. They
are the station's own **acts** — and they are the *only* record of those
acts. Asking the MES again would not produce the operator's attestation; the
MES was never there. So they cannot be re-derived, and therefore they must
be written down.

**The distinction is the one the whole product turns on: the MES's truth is
not written down; the station's own acts are.** ADR-031 refused the recipe
for exactly the reason this ADR requires these two to be persisted.

And the story's own storage note agrees: *"One identity row per component
per weighing, retained ≥ 5 years"* and *"One lot row per component per
weighing, retained ≥ 5 years"* (BRD DR-01).

### Why append-only, and why the newest row is the effective one

The identity and the lot are **facts about the past**. *"At 08:14:22,
operator OP-001 attested that the material in hand was DYE-4471"* does not
stop being true when a later scan confirms it. BRD DR-02 requires that such
a record not be revised — and corrections are **new records**.

The obvious shapes all mutate history:

- a mutable row — one row per component, overwritten;
- a `superseded_at` column — a later process stamping the moment a record
  stopped being current;
- an `is_active` flag — a flag flipped on the old one.

Each is a **mutation of a historical record**, and each creates a **second
source of truth** that a partial failure could leave inconsistent. This is
the argument ADR-029 made for the batch selection, and it applies unchanged
— a selection and an attestation are the same kind of thing: a recorded act
by a person at a moment.

So the table is append-only, and **"the current identity"** and **"the
current lot"** are **derived** as the newest row. The story requires the
superseded capture to be *retained*, and this is the only shape that
retains it.

**And the ordering is TOTAL.** `verified_at` alone is ambiguous when two
records land in the same millisecond, and "the latest" must have exactly one
answer — two terminals reading the effective capture must not be able to
disagree. The `id` is the insertion sequence, so the tie breaks in the
order the acts **happened**, not at random (ADR-029's rule).

### Why the method is derived and the operator comes from the session

Two facts about the act, and **neither** may be supplied by the client.

**The operator.** A body field would let a request credit the capture to
somebody who was not at the station — and the capture is an immutable
traceability record, so a false attribution could only ever be
**contradicted, never corrected**. This is the same rule the identity unit
established for the authorisation's operator (ADR-005), and the same rule
bolt 009 applied to the batch selection.

**The method.** The method is **derivable from the request's shape**: a
`code` came from the scanner, a `lotNumber` was keyed in, an `attestation`
was confirmed on screen. A client that could choose the method could record
a scan that never happened — and a *scan* is a stronger claim than an
attestation, because it says the machine read a label. ADR-030 derived the
selection's method for exactly this reason, and the rule generalises.

**And the `SOURCE` method has no client shape at all.** The MES's own lot
is captured by the **station**, through the adapter, when it prepares the
component — not by a request. So a client cannot claim the MES held a lot,
and the schema has no way to say it.

### Why a refusal writes nothing

The refusal path returns **before** the repository is touched. So the
history contains only acts that happened — and a refused capture can never
be the effective one. This is the same rule bolt 009 applied to the batch
selection's refusal, and it is why the "effective" row is always a real
act.

### Why the closed set is in the storage layer

The domain's closed set is a **convention**; the `CHECK` constraint is a
**guarantee**. It holds against a migration script, a repair script, and
any future unit that decides to write here — the same argument ADR-029
made for `selection_method`.

A third method would have to be named by somebody who has not thought about
what it means: is `ATTESTED_THEN_SCANNED` a method? A sequence of two
methods? The closed set says **no** — the *history* holds the sequence, and
the *current* record holds one method.

## Consequences

### Positive

- **The station's acts are durable** — the audit trail can answer *"which
  lot was in the bucket, and how do we know?"* five years later.
- **The history is complete.** A superseded attestation is **retained**, so
  the trail shows that the material was first attested and then confirmed
  by scan — which is exactly what B-6 asks for.
- **The immutable path is structural.** No update method, and the database
  aborts one anyway.
- **No client can write a false attribution or a false method.** The schema
  has neither field.
- **The "current" answer is derived**, so it cannot disagree with the
  history it comes from.

### Negative

- **Two tables and a migration.** Unit `002` is no longer a read-only
  unit, and the recipe's "nothing is persisted" property now has to be
  stated per-artefact rather than per-unit.
- **A later capture never replaces the earlier one.** The table grows with
  every capture, and there is no pruning path. That is the intended cost —
  a pruning policy would be FCI's, and the same one the selection table
  waits for.
- **The effective record needs an ordering, and the clock must be sane.**
  A capture's `captured_at` comes from the injected clock, and the `id`
  breaks the tie — so a clock that jumps backwards does not make "the
  latest" ambiguous.

### Risks

- **A future agent adds an `is_current` column** to either table, to make
  the lookup a single row. *Mitigation*: the decision index's "Read when"
  points here, and this ADR names the mutation of history that it would
  cause.
- **A future agent reuses ADR-031's reasoning to refuse to persist these**,
  reading *"the recipe is not persisted"* as a unit-wide rule. *Mitigation*:
  the table at the top of this ADR — the distinction between the MES's truth
  and the station's acts — is the whole answer, and the decision index's
  "Read when" points here for anyone about to persist or not persist
  something in this unit.
- **A future agent adds a `verifiedBy` field** to the schema because "the
  client might want to say it was a scan". *Mitigation*: the same index
  entry; ADR-030's rule applies to every method in this product.

## Related

- **Stories**: `002-verify-dyestuff-identity-by-scan-or-attestation`,
  `003-capture-and-validate-dyestuff-lot`
- **Requirements**: FR-4, FR-5, FR-25 · BRD FR-09, FR-10, FR-11, FR-19,
  FR-25 · BRD DR-01, DR-02, BR-14 · A-09, B-6
- **Previous ADRs**: ADR-031 (the recipe is not persisted, and the station's
  working copy is in memory — the contrast this ADR extends with the
  station's own durable acts); ADR-029 (the selection record is append-only
  and the active selection is the newest row — the rule both tables
  inherit); ADR-030 (the method is derived from the request's shape — the
  rule applied to the identity's and the lot's methods); ADR-005 (the
  authorisation's reason is stored in clear text — the same "an
  attributable record must be readable later" reasoning); ADR-033 (one
  scanner, two ports, one instance — the device both ports read through)
- **Standards**: `standards/tech-stack.md` § "Database" — SQLite for the
  product's durable records, with append-only rows and immutable confirmed
  records
