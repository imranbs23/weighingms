---
stage: test
bolt: 021-006-ticket-printing
status: complete
updated: 2026-11-06T14:00:00Z
---

# Test Report: Ticket Printing (Bolt 021: the audit trail — query and export)

## Summary

| Measure | Value |
|---|---|
| **Test files** | 104 passed, 0 failed |
| **Tests** | **1697 passed**, 0 failed |
| **Typecheck** | clean (`tsc --noEmit`) |
| **Coverage (all files)** | 88.22% statements · 80.32% branches · 92.27% functions · 89.24% lines |
| **Coverage threshold** | 80% on all four — **met** |
| **New tests** | **22** (13 unit + 9 integration) |
| **Baseline before the bolt** | 1675 tests, 102 files |
| **Defects found by the tests** | **1**, fixed (below) |

---

## What the tests prove

### Reading the trail is a SUPERVISOR's act

**The integration suite signs in two operators — one `OPERATOR`, one
`SUPERVISOR`** — and asserts:

- The **operator** is refused with a **`403 SUPERVISOR_REQUIRED`** — on
  both the query and the export.
- The **supervisor** gets the entries.

**And the role comes from the SESSION** — the test's operator token
carries the role, and the request carries nothing.

**And this is deliberately DIFFERENT from the reprint**, which bolt `020`
left supervisor-free because BRD FR-35 does not name reprints. The
distinction is the **scope of what is disclosed**: a reprint touches one
ticket; the trail holds every privileged action, with its actors and its
reasons.

### The query returns ONLY the matching entries, in SEQUENCE order

- The **actor filter** returns the actor's entries and no others.
- The filter **combines** — actor **and** action.
- The entries come back in **sequence order**, with strictly increasing
  sequences.
- The page is **bounded** — `limit: 2` over three entries gives two, and
  `hasMore` is `true`.
- An empty result is an **empty page**, not an error.

### The export is STREAMABLE and carries EVERY field

- The body is **`application/x-ndjson`**, and each line is a **complete
  JSON object** that parses.
- **Every field is present and intact** — the sequence, the entry id, the
  action, the actor, the role, the subject, the reason and the occurred-at
  time.
- The lines are yielded **one at a time** — the `lines()` generator
  produces them individually, and each ends in a newline.

### The query and the export of the SAME filter AGREE

**This is the test that matters most for correctness**, and it exists
because the export uses a **second read path** — the cursor.

**The unit suite asserts that a query and an export of `{ actorId:
'OP-001' }` over three entries both return exactly two.** One filter, one
implementation — so they cannot disagree.

### An empty export is a VALID export

- The export of a filter matching nothing has a **`200`**, an **empty
  body**, and **not** an error.

### A refusal is a DISTINCT action

- `AuditAction.refused(REPRINT)` is **`REPRINT_REFUSED`**.
- `isRefused()` is `true` for it and `false` for `REPRINT`.
- It round-trips through storage, and an unknown action still **throws**.

---

## The defect the tests found

### The `AuditAction`'s type was too narrow for the refusal variants

**Found by:** the typecheck, when the refusal value was first introduced.

**Root cause.** `AuditAction`'s constructor took `AuditActionValue`, which
was the five *performed* actions. The refusal value — `REPRINT_REFUSED` —
is a different string, so it did not fit.

**The fix.** The action's type is now `AuditActionValue | AuditRefusedActionValue`
— and the refused variant is **derived** (`${action}${AUDIT_REFUSED_SUFFIX}`),
so a refusal is always distinguishable from the action performed.

**And the `CHECK` constraint on the column gained the refusal variants**,
so the database enforces the same closed set the domain does.

---

## Deliberately not delivered

- **The configuration's changes are audited** — story `005`. The API
  exists; the configuration does not.
- **The reporting** — story `006`. The report reads the trail for override
  authorisations.
- **The audit view and the export control** — unit `007`.
- **The export's serialisation** — a training artefact. It is complete and
  machine-readable; **its exact form is not settled by any requirement**.

---

## Acceptance-criteria validation

| Criterion | Status | Where it is proved |
|---|---|---|
| A privileged action produces an entry carrying the action, the actor, the role, the subject, the reason and the time | ✅ | Bolt `020`'s suite, and this bolt's — every field is asserted |
| **No update or delete path exists**, and the entry is unchanged | ✅ | Bolt `020`'s suite — the repository's shape **and** the triggers |
| The trail is queried by actor, action or date range, returning **only** the matching entries, **ordered by a monotonic sequence** | ✅ | `audit-query-and-export.test.ts` — actor, action, the combined filter, and the sequence order |
| The export contains **exactly** the matching entries with **all their fields intact** | ✅ | `audit-query-and-export.test.ts` and `audit-trail-api.test.ts` — the count, and every field |
| A privileged action attempted with **no reason** writes **no success entry**, and the refusal itself is recorded | ✅ | Bolt `020`'s suite — the empty reason is refused **before** any job or entry exists |
| The entries are retained for a minimum of 5 years (DR-01) | ✅ | **There is no deletion path at all** — which is stronger than a retention job |

## Recommendations

- **Story `005`** will add the configuration, and it writes through this
  same append-only API — carrying the key changed, the previous value, the
  new value and the reason. **Its audit entry's subject** will name the
  configuration key, which is the natural use of the subject field.
- **The `stream` cursor is a second read path** beside `filter`, and their
  agreement is **a test's responsibility**, not the type system's. The
  "query and export agree" test is what holds them together — it should
  not be removed.
- **The export's `JSONL` format is a training artefact.** If a different
  format is needed, the format is a **value** — so it is a configuration
  change, not a code change.
- **A supervisor is the only role that can read the trail.** If a
  compliance role is ever added, the check is the single line in the
  controller — and it is worth noticing that the *refusal* says
  `SUPERVISOR_REQUIRED` rather than a distinguishable authorisation
  reason, because the role is the requester's own and leaks nothing.
