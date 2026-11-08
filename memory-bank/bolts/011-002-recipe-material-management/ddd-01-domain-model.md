---
stage: model
bolt: 011-002-recipe-material-management
created: 2026-11-05T23:50:00Z
---

## Static Model: 002-recipe-material-management (bolt 011)

### Entities

- **MaterialIdentity**: the verification that the material in hand is the
  material the recipe calls for — `componentId`, `verifiedBy`, `verifiedAt`,
  `operatorId`, `barcode?`, `attestedClaims`.

  It is a **fact about the past** and therefore immutable (BRD DR-02). The
  verification either happened, with an operator and a moment, or it did not.

- **MaterialLotCapture**: the supplier lot used against a component —
  `componentId`, `lotNumber`, `materialCode`, `captureMethod`, `capturedBy`,
  `capturedAt`, `recordedAt`.

  Also immutable, and also **append-only**: a later capture for the same
  component does not overwrite the earlier one.

### Value Objects

| Value object | Shape | Rules |
|---|---|---|
| **VerificationMethod** | `SCAN` \| `ATTESTATION` | A **closed set of two**, and the closure is the point: it is the traceability distinction (B-6, BRD BR-11), and a third value would have to be named by somebody who has not thought about what it means. `SCAN` means the operator presented the material's code to the scanner; `ATTESTATION` means the operator confirmed the identity on screen. |
| **CaptureMethod** | `SOURCE` \| `SCAN` \| `KEYED_IN` | A **closed set of three** — and this is the design that accommodates **CQ-08** without a rewrite. Whether containers carry a lot barcode or the lot is keyed in is FCI's unanswered question, so all three routes are **the same operation with different evidence**. `SOURCE` means OrgaTEX held the lot; `SCAN` means the operator scanned it; `KEYED_IN` means the operator typed it. |
| **LotNumber** (unit `005`'s) | bounded, trimmed identifier | **Reused, not redefined.** It is an **identifier**, not a quantity — and the story is explicit: *"the lot identifier embeds a quantity-like token, it is not converted to a number and never to a float"* (BRD NFR-16). |
| **AttestedClaims** | a set of claim names | The **attested-claims set** the story asks for, so that adding a lot claim later does not require a schema change. It is a **set**, because an attestation asserts a set of facts, and a set has no order and no duplicates. |
| **MaterialCode** | the dyestuff code the capture is against | The **material**, not the component slot — the same distinction ADR-032 preserved. |
| **OperatorId** (unit `008`'s) | the badge id | **Reused, not redefined.** The capture is attributable to a person (BRD BR-11, A-09). |

### Aggregates

| Aggregate Root | Members | Invariants |
|----------------|---------|------------|
| **MaterialIdentity** | the record | 1. **Immutable** once written (BRD DR-02). 2. It names **exactly one** operator and **exactly one** component. 3. Its method is one of two. 4. A `SCAN` carries the scanned code; an `ATTESTATION` carries the operator's claims and **no** code. 5. Its timestamp is the moment of the act. |
| **MaterialLotCapture** | the record | 1. **Immutable** once written. 2. It names **exactly one** operator and **exactly one** component. 3. Its method is one of three. 4. A `SOURCE` capture is the MES's own lot and is **not** locally overwritten (the story's first edge case). 5. Its timestamp is the moment of the capture. |

### Why there is **no** aggregate root over the set of captures

The lot captures for a component are a **history**, not a mutable "current
lot". The story's edge case is explicit:

> *"Two different lots are captured for the same component in one weighing →
> the most recent capture for that component is the effective one, and the
> superseded capture is retained in the record rather than deleted."*

So the table is **append-only**, the effective capture is **the newest row**,
and there is no "current lot" column — exactly ADR-029's argument, applied to
the lot (DR-02).

**Why the material identity is a separate aggregate from the lot.** They are
different facts with different evidence and different lifetimes. The identity
answers *"is this the right material?"*; the lot answers *"which batch of it?"*.
A scan may establish the first and not the second; a lot may be keyed in
without a scan. Coupling them would force one of the two to be derived from
the other, and both are independently attested facts.

### Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| **MaterialIdentityVerified** | A component's material identity was verified | `componentId`, `method`, `operatorId`, `at`, `barcode?` |
| **MaterialIdentityMismatch** | A scanned code named a **different** material | `componentId`, `scannedCode`, `expectedCode` — a **hard stop**, and the event carries both codes because the operator must be told which was expected and which was presented |
| **MaterialLotCaptured** | A lot was captured against a component | `componentId`, `lotNumber`, `method`, `operatorId`, `at` |
| **LotCaptureRefused** | A capture was refused | `componentId`, `reason` — the reason **code** only |

### Domain Services

- **MaterialIdentityVerifier**: decides whether the material presented to a
  component is the material the recipe calls for.

  The rule is small and the consequences are not: a **matching** scan
  verifies; a **mismatching** scan is a **hard stop** that names both codes
  and can **never** be downgraded to an attestation (BRD FR-10); an
  **unreadable** scan is an offer of the attestation path, never a silent
  skip (BRD FR-19, BRD IR-15, BRD IR-18).

- **LotCaptureService**: captures a lot against a component, by whichever of
  the three routes the evidence supports, and records **which** route it was.

  The three routes are one operation with different evidence — that is the
  whole of CQ-08's accommodation.

- **LotValidator**: a presence-and-format check, plus an **optional**
  upstream existence check. It does **not** compute or apply a tolerance
  rule (BRD FR-03, BRD FR-04) — the unit does not own tolerances.

### Repository Interfaces

| Repository | Entity | Methods | Persisted? |
|---|---|---|---|
| **MaterialIdentityRepository** | `MaterialIdentity` | `save(identity)`, `latestFor(componentId)` | **Yes** |
| **MaterialLotRepository** | `MaterialLotCapture` | `save(capture)`, `latestFor(componentId)` | **Yes** |
| **DyestuffScanner** | — (a read) | `read(): Promise<ScanOutcome>` | **No.** It is a **port** over the device. |
| **DyestuffMasterSource** | — (a read) | `read(componentId): Promise<LotLookupOutcome>` | **No.** It is a **port** over the MES seam. |

**Both repositories are append-only**, with the same two shapes ADR-029
settled: no update, no delete, and `BEFORE UPDATE` / `BEFORE DELETE`
triggers that abort.

**Why these ARE persisted, when the recipe was not.** ADR-031 refused to
persist the recipe because it is a **projection of somebody else's truth** —
it can be re-fetched, and a persisted copy would be a stale-looking-fresh
risk.

A material identity and a lot capture are the opposite case: they describe
something that **physically happened at this station** and that the MES has
**no idea** about. Asking the MES again would not produce the operator's
attestation. So they cannot be re-derived, and they must be durable
(BRD DR-01: retained ≥ 5 years).

The distinction is the same one the whole product turns on: **the MES's
truth is not written down; the station's own acts are.**

### Ubiquitous Language

- **Identity** — the verification that the material in hand is the material
  the recipe calls for.
- **Verification** — how that was established: `SCAN` or `ATTESTATION`.
- **Attestation** — the operator confirming the identity on screen. A
  **decision**, never a silent substitution for a scan.
- **Mismatch** — a scanned code that names a **different** material. A
  **hard stop**, not a warning.
- **Lot** — the supplier's batch of a material.
- **Capture** — the recording of a lot against a component.
- **Capture method** — where the lot came from: `SOURCE`, `SCAN` or
  `KEYED_IN`.
- **Effective capture** — the newest capture for a component. Derived, never
  stored as a flag.

---

## Constraints carried into the Technical Design

1. **A mismatch is a hard stop.** It cannot be downgraded to an attestation,
   and the refusal names **both** the scanned code and the expected one.
2. **An attestation is never entered silently.** It happens only on an
   explicit operator confirmation, and it is recorded with the operator and
   the time.
3. **A scan never downgrades an attestation, and an attestation never
   downgrades a scan.** A later matching scan supersedes an attestation
   (and the attestation is retained); a later attestation does **not**
   supersede a scan (BRD FR-10).
4. **The operator comes from the session**, never from a request body. The
   schema has no operator field.
5. **The method is derived, never supplied.** The request's *shape* says
   which route it was — a `code` means the scanner, a `lotNumber` means the
   operator keyed it. This is ADR-030's rule, applied to the scanner.
6. **A refusal writes nothing.** The refusal path returns before the
   repository is touched.
7. **The lot is an identifier, never a quantity.** No float conversion, ever
   (BRD NFR-16).
8. **Every quantity and identifier is bounded.** An empty lot is a refusal
   naming the missing lot; a lot longer than 64 characters is a refusal
   naming the maximum. The value is **trimmed**, never truncated.
9. **No prose crosses the boundary.** Codes and data only (BRD NFR-11).
10. **The upstream's lot is not silently overwritten locally.** Correcting a
    source-held lot is an upstream data matter.

---

## The edge cases, answered

| Scenario | Where it is answered |
|----------|----------------------|
| A scan matches the required component's dyestuff code | `MaterialIdentityVerifier` → verified with `SCAN`, the code and the timestamp stored |
| A scan does **not** match | `MaterialIdentityVerifier` → `MaterialIdentityMismatch`; a **hard stop**; the refusal names both codes; **no** attestation may override it |
| A scan fails — the code is unreadable or unknown | The affected step is **not silently skipped**: the operator is told the scanner produced no code and the **attestation path is offered** |
| The operator attests | Verified with `ATTESTATION`, with the operator id, the time and the claims; recorded as an attributable decision |
| A component is not yet verified | The dispensing step is **blocked** — `RecipeComponent.canProceed` is already false for a component with no class, and the identity check is the second gate |
| A lot is held by OrgaTEX | Captured with `SOURCE`, read through the adapter |
| OrgaTEX does not hold the lot, and the operator scans one | Captured with `SCAN` |
| OrgaTEX does not hold the lot, and the operator keys one in | Captured with `KEYED_IN` |
| A lot is submitted empty | Refused with a validation error naming the missing lot; **nothing** is stored |
| A lot is keyed in with surrounding whitespace | Trimmed before validation and storage; the **stored** value is the trimmed form |
| A lot is longer than 64 characters | Refused with a validation error naming the maximum; **not** truncated |
| The same lot is captured for two components | **Both** are stored — a lot may legitimately serve several components, and it is not de-duplicated |
| Two lots are captured for one component | The **newest** is effective; the superseded capture is **retained**, not deleted |
| The upstream lot is wrong, and the operator believes it | The upstream value is displayed as `SOURCE`; correcting it is an upstream data matter and is **not** silently overwritten locally |
| The scanned lot code resolves to nothing | Refused with a visible reason; the operator may key the lot in instead |
| The upstream is unreachable and the lot must be scanned | The scan and keyed-in paths **remain available**, and the capture method records that the lot was not source-held |

---

## Open points carried forward

- **The scanner's device contract** (Q-03). The scanner is reached through a
  **port**, and the Dummy Scanner's `POST /api/scan` is a training contract
  behind that boundary. Whether the same physical device serves the batch
  card, the dyestuff code and the lot code is FCI's question — so the
  **port** is declared per consumer, and the *device* stays a single shared
  instance (ADR-033).
- **The lot's existence upstream.** Whether the MES can be asked *"is this
  lot known?"* is **A-09 / IR-04**, and the story makes the upstream
  existence check **optional** — the capture stands on its own evidence
  without it.
- **Whether the lot belongs to the recipe's component or to the material.**
  The BRD's `WEIGHING_RECORD` references `lot_id`, and a lot may serve
  several components. The capture is therefore against the **component**,
  with the material code copied — the same "the material, not the slot"
  distinction ADR-032 preserved.
