---
stage: test
bolt: 020-006-ticket-printing
status: complete
updated: 2026-11-06T11:40:00Z
---

# Test Report: Ticket Printing (Bolt 020: the reprint with its reason)

## Summary

| Measure | Value |
|---|---|
| **Test files** | 102 passed, 0 failed |
| **Tests** | **1675 passed**, 0 failed |
| **Typecheck** | clean (`tsc --noEmit`) |
| **Coverage (all files)** | 88.14% statements · 80.14% branches · 92.24% functions · 89.17% lines |
| **Coverage threshold** | 80% on all four — **met** |
| **New tests** | **25** (11 unit + 8 integration + 6 security) |
| **Baseline before the bolt** | 1650 tests, 99 files |
| **Defects found by the tests** | **1**, fixed (below) |

---

## What the tests prove

### The reason is MANDATORY, and NO print job is created without one

The unit suite proves the domain refuses an empty or whitespace-only
reason — **and the check is in the constructor**, so a call site cannot
forget it.

**And the integration suite proves the boundary:** an empty reason and an
absent reason are both a **`400 REPRINT_REASON_REQUIRED`**, and the trail
is **empty** afterwards — **no job and no audit entry exist**.

**And the reason is stored VERBATIM** — a 500-character reason comes back
500 characters long, and a non-Latin one (`'الأصل تالف — 需要重印'`) comes
back unchanged. **The bound is a validation, never a truncation.**

### The sequence is the DATABASE's, and it is MONOTONIC

- The sequence is **`null`** until the row is written — it is not the
  application's to assign.
- After the write it is **strictly increasing**, and the repository reads
  it back so the caller holds the same number the trail does.
- **Three entries recorded at the SAME instant come back in sequence
  order** — which is the edge case, because a timestamp cannot separate
  them.

### The trail is APPEND-ONLY, and the repository's SHAPE is the criterion

**The story says the success criterion is the interface, not a
convention:**

> *"The success criterion is a test asserting that no update or delete
> path exists on the repository, not a convention that callers remember."*

So the test asserts it **structurally**: the repository's prototype has
`record`, `all` and `filter` — and **no `update`, no `delete`, no
`remove`**.

**And the database refuses both anyway** — the triggers abort an `UPDATE`
and a `DELETE`.

### The marking is DERIVED, and the client supplies none of it

The security suite sends `isReprint`, `reprintOf`, `actorId` and
`actorRole` in the reprint body — and asserts **none** of them appears in
the response.

**And the trail records the SESSION's actor** — not a client-supplied one.

### The reprint changes NOTHING about the weighing

The integration suite reads every record's component, quantity and
weighed-at time before and after a reprint — and they are **identical**.

### THREE reprints are three jobs, each with its own reason

The trail holds three entries with the reasons `first`, `second` and
`third`, and their sequences are **strictly increasing**.

---

## The defect the tests found

### The `PRAGMA synchronous` statement was malformed

**Found by:** `tests/unit/audit-and-reprint.test.ts` — the audit database
failed to open with *"near 'synchronous': syntax error"*.

**Root cause.** The statement was written as `db.exec('synchronous =
FULL')` instead of `db.exec('PRAGMA synchronous = FULL')`. It is a
**syntax error**, not a silent no-op — SQLite parses the whole statement
and rejects it — so the database never opened.

**The fix.** The `PRAGMA` form. And a sweep of every database module in
the product confirmed **this was the only instance** — the other ten
already had it right.

---

## Deliberately not delivered

- **The audit trail's query and export** — story `004`. This bolt builds
  the **append-only API** and the entry's shape; the filter is here, and
  the **export** is not.
- **The rendered marking's wording** — story `005`. The wording comes from
  the configuration, and **no literal is written in this bolt's code**.
- **The reporting** — story `006`.
- **The reprint control** — unit `007`.

**And the trail is therefore WRITE-ONLY for now** — a deliberate,
temporary state: the mechanism exists and is exercised, and the query and
the export come next.

---

## Acceptance-criteria validation

| Criterion | Status | Where it is proved |
|---|---|---|
| A reprint with a non-empty reason creates a job with `isReprint` **true** and `reprintOf` pointing at the original ticket | ✅ | `audit-and-reprint.test.ts` and `reprint-api.test.ts` |
| The job carries the reason, the reprinting actor and the time, and is distinguishable from a first print in the stored record | ✅ | `reprint-api.test.ts` — the actor, the role, the reason and the sequence; and the first print is `isReprint: false` (bolt `019`'s suite) |
| A reprint with an **empty or absent** reason is **refused**, and **no print job is created** | ✅ | `reprint-api.test.ts` — the `400`, and the trail is empty |
| An append-only audit entry is written carrying the actor, the actor's role, the subject and the reason | ✅ | `reprint-api.test.ts` — all four, and the subject names the ticket **and** the job |
| The original ticket's weighing records are **unchanged** — a reprint never creates, alters or removes one | ✅ | `reprint-api.test.ts` — every record's component, quantity and time, before and after |
| The reprint is a **new print job against the existing ticket**, never a re-generation | ✅ | `reprint-api.test.ts` — the same ticket id, and the job's `reprintOf` points at it |
| The audit trail is append-only, with **no update or delete path** | ✅ | `audit-and-reprint.test.ts` — the repository's shape, **and** the triggers |
| The entries are ordered by a **monotonic sequence** | ✅ | `audit-and-reprint.test.ts` — strictly increasing, and three same-instant entries come back in order |
| The entries are retained ≥ 5 years (DR-01) | ✅ | **There is no deletion path at all** — which is stronger than a retention job |

## Recommendations

- **Story `004`** adds the export and completes the query surface. The
  filter is already here, and the **export's serialisation is a training
  artefact** whose exact form the story says is not settled.
- **The `actorRole` field records whoever pressed reprint** — which may be
  the operator, because the BRD's supervisor list (FR-35) does not name
  reprints. If that changes, the **audit entry's role** is the field to
  revisit, not the reprint's authorisation.
- **The reprint's audit entry is written whether the print succeeded or
  failed.** That is deliberate, and it is the case an auditor most needs
  to see — a requested second copy that did not arrive. If a future
  requirement says otherwise, the **write's position** is the one place to
  change.
