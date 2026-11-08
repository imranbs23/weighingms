---
stage: test
bolt: 011-002-recipe-material-management
status: complete
updated: 2026-11-06T00:45:00Z
---

# Test Report: Recipe & Material Management (Bolt 011: identity and lot)

## Summary

| Measure | Value |
|---|---|
| **Test files** | 68 passed, 0 failed |
| **Tests** | **1348 passed**, 0 failed |
| **Typecheck** | clean (`tsc --noEmit`) |
| **Coverage (all files)** | 91.20% statements · 85.57% branches · 93.38% functions · 92.08% lines |
| **Coverage threshold** | 80% on all four — **met** |
| **New tests** | **77** (32 unit + 14 persistence + 19 integration + 12 security) |
| **Baseline before the bolt** | 1271 tests, 64 files |
| **Defects found by the tests** | **2**, both fixed (below) |

---

## What the tests prove

### The comparison is EXACT

A dyestuff code is an identifier, not a natural-language name. Two codes that
differ only in case are two different codes — and **folding them would make a
wrong material look like a right one**. The test asserts that `dye-4471`
against `DYE-4471` is a **mismatch**, not a match.

The presented code is **trimmed** before the comparison, because the
identifier's own factory trims — but nothing else is normalised.

### A mismatch is a HARD STOP, and it writes nothing

The refusal names **both** codes — the scanned one and the expected one —
because the story requires it and because the operator must be told which was
presented and which was expected. And the refusal path returns **before** the
repository is touched, so the history contains only acts that happened and a
refused verification can never be the effective one.

### An unreadable scan is NOT a mismatch

It is a `503`, and the **attestation path remains available** (BRD FR-19,
BRD IR-15, BRD IR-18). The two are different facts: a mismatch is *"you
presented the wrong material"*; an unreadable scan is *"the machine could
not be read"* — and only the second offers the fallback.

### The method is DERIVED, never supplied

Neither schema has a `verifiedBy`, a `captureMethod` or an `operatorId`
field, and Zod **strips** unknown keys — so a client that sends one has it
dropped, not ignored. The tests assert both: a client sending
`verifiedBy: 'ATTESTATION'` with a `code` gets `SCAN`, and a client sending
`operatorId: 'OP-SOMEONE-ELSE'` gets the session's operator.

### A scan never downgrades an attestation, and an attestation never downgrades a scan

- **Attestation, then scan** → two rows, and the **newest** is the scan. The
  attestation is **retained** in the history.
- **Scan, then attestation** → the attestation is **refused** and **not
  recorded**. The scan is the stronger claim — it says the machine read a
  label — and the story is explicit that an attestation *"is not permitted to
  downgrade a scan."*

### The three lot routes are ONE operation with different evidence

| Route | The method | Proven |
|---|---|---|
| The MES held it | `SOURCE` | The Dummy MES's own lot is captured as `SOURCE` |
| The operator scanned it | `SCAN` | The request's shape decides it |
| The operator keyed it in | `KEYED_IN` | The request's shape decides it |

**The MES's lot wins, and is not overwritten locally** — correcting a
source-held lot is an upstream data matter (BRD §9.3).

**And the operator's paths remain available during an outage.** An
unreachable MES is **not** a refusal: the keyed-in path still works, and
the capture method records that the lot was **not** source-held.

### The lot is an identifier, never a quantity

- It is **trimmed** before validation and storage — the stored value is the
  trimmed form.
- It is **refused**, not truncated, at 65 characters — and the error names
  the maximum.
- It is never converted to a number, because a lot that embeds a
  quantity-like token is still an identifier (BRD NFR-16).

### The history is append-only, and the database says so

The **triggers** refuse an `UPDATE` and a `DELETE` on both tables — a
repository convention would hold against a careless caller, and a trigger
holds against everyone (ADR-034). The storage layer also carries the closed
sets as `CHECK` constraints, so a third method cannot be written even by a
path that bypasses the domain.

And the **lot is not de-duplicated**: the same lot for two components is
**two rows**, because a lot may legitimately serve several components.

### The effective record is the newest row, with a total order

Two rows landing in the same millisecond are ordered by the **insertion
sequence** — so "the latest" has exactly one answer, and two terminals
reading it cannot disagree.

---

## The two defects the tests found

Both were fixed at the **root cause**, not in the test.

### Defect 1 — the attestation-after-scan refusal reported a MISMATCH

**Found by:** `tests/unit/material-identity-and-lot.test.ts` — *"an
attestation does NOT downgrade a scan — it is REFUSED"*.

**Symptom.** The outcome was `MISMATCHED` with the scanned code and the
expected code, when the situation was *"the material is already verified by
a scan and you may not downgrade it"*.

**Root cause.** The first implementation reused the mismatch outcome,
because both are refusals. But they are **different facts**: a mismatch
means *"you presented the wrong material"*, and it is a **hard stop**; an
already-scanned component means *"nothing is wrong — the material **is**
verified"*. Reporting the second as the first tells the operator they
presented the wrong material when they did not, and it names a scanned code
that never mismatched anything.

**The fix.** A **separate outcome**, `ALREADY_VERIFIED_BY_SCAN`, with its
own refusal body. The scan is the stronger claim, the attestation is not
recorded, and the scan stays effective.

### Defect 2 — the validation error named the body, not the field

**Found by:** `tests/integration/material-api.test.ts` — *"refuses an EMPTY
lot, naming the missing lot"* and *"refuses a lot over 64 characters"*.

**Symptom.** Both refusals answered `400` with
`fields: [{ path: 'body', message: 'must carry exactly one of lotNumber or
code' }]` — which is **wrong twice over**. The path was `body` rather than
`lotNumber`, and the message described a *different* problem (the body
shape) from the one that actually occurred (the value).

**Root cause.** The controller hard-coded one generic field error for every
schema failure, because the identity and the lot schemas had only ever
failed on the "exactly one of" refinement.

**The fix.** The controller now reports **Zod's own issues**, field by
field. So an empty lot answers `path: 'lotNumber', message: 'is required'`
and an over-long lot answers `path: 'lotNumber', message: 'must not exceed
64 characters'` — which is what the story asks for in as many words: *"a
validation error naming the missing lot"* and *"naming the maximum
length"*.

---

## Deliberately not delivered

- **The dyestuff master read** (BRD IR-03) beyond the **narrow** lot read.
  The name and the colour stay **optional** on the recipe payload
  (ADR-032), and a full master read would be a second contact and a second
  cache for one component's facts.
- **The lot's upstream existence check.** The story makes it **optional**,
  and the capture stands on its own evidence without it (A-09 / IR-04).
- **The container and the tare.** That is **bolt 012's** scope.
- **The dispenser gate.** The story's *"an unverified component cannot begin
  dispensing"* is enforced by unit `003`'s session, which owns the
  progression; this bolt records the verification and exposes it.
- **Any pruning of the two tables.** A pruning policy would be FCI's, and
  the same one the selection table waits for.

---

## Acceptance-criteria validation

| Criterion | Status | Where it is proved |
|---|---|---|
| A matching scan verifies, with the code and the timestamp stored | ✅ | `material-api.test.ts` — the method, the code, the operator and the moment |
| A mismatching scan is a hard stop naming both codes, and no attestation may override it | ✅ | `material-api.test.ts` + `material-identity-and-lot.test.ts` — the `409`, both codes, and nothing written |
| An unreadable code falls back to the attestation path, and the step is not silently skipped | ✅ | `material-api.test.ts` — the `503`, and the attestation that then succeeds |
| An attestation stores the operator id, the timestamp and the claims | ✅ | `material-identity-and-lot.test.ts` — `ATTESTATION`, the claims, and the operator |
| An attested component is distinguishable from a scanned one | ✅ | The method is stored, and the storage layer's `CHECK` makes it a closed set |
| A component that is not yet verified cannot begin dispensing | ✅ by construction | `RecipeComponent.canProceed` — and unit `003` owns the gate |
| The lot is retrieved from OrgaTEX with the method `SOURCE` | ✅ | `material-api.test.ts` + the Dummy MES's own lots |
| A scanned lot is captured with the method `SCAN` | ✅ | The shape derives it |
| A keyed-in lot is captured with the method `KEYED_IN` | ✅ | The shape derives it |
| The weighing record carries the lot | ✅ | The capture is the durable record unit `003` reads (BRD FR-25) |
| An empty lot is refused, naming the missing lot, and nothing is stored | ✅ | `material-api.test.ts` — the field, the message, and no row |
| The capture carries the operator id and the timestamp | ✅ | Every capture carries both |
| The lot is trimmed before it is stored | ✅ | The stored value is the trimmed form |
| A lot over 64 characters is refused, naming the maximum, and not truncated | ✅ | The `400`, the message, and nothing stored |
| The same lot for two components is not de-duplicated | ✅ | Two rows, both readable |
| Two lots for one component: the newest is effective, the older is retained | ✅ | The effective row and the retained row |
| The upstream's lot is not silently overwritten locally | ✅ | `SOURCE` wins, and the operator's value is not used against it |
| The upstream is unreachable and the lot must be scanned | ✅ | The operator's path remains available, and the method records it |

## Recommendations

- **Bolt 012** owns the container and the tare, and it will need the
  component's **effective** identity and lot — both are readable through
  the two `GET` endpoints this bolt adds.
- **Unit 003** owns the dispenser gate. It must read the effective identity
  before it lets a component be weighed — and it must treat
  `ALREADY_VERIFIED_BY_SCAN` and a mismatch as **different** refusals.
- **The scanner's device contract** (Q-03) remains unconfirmed. The port is
  the boundary, and a real scanner replaces the adapter without touching
  the domain (ADR-033).
