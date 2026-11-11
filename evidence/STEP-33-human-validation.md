---
step: 33
prepared: 2026-11-11T15:05:00Z
prepared_by: Claude (the evidence, not the verdict)
verdict_by: project owner — PENDING
---

# Step 33 — Final Human Validation

> *"Do not ask: did the AI finish? Ask: did we build the product we
> intended to build?"*

This page gathers the evidence for each of the workbook's five sources. The
**verdict is the project owner's**: each section ends with a line for it.

## 1. Product Brief — does the product solve the defined problem?

The brief's problem: manual dyestuff weighing is slow, error-prone and
untraceable, and consumption is re-keyed into OrgaTEX.

| Brief intent | In the product | Evidence |
|---|---|---|
| Guide the operator through the recipe, component by component | The station picks the component and the scale; the operator only pours and confirms | Step 23 video, Step 21 |
| Prevent out-of-tolerance weighings | Confirm is blocked outside the band, at both boundaries | Step 22 |
| A defined response to an over-dose (BR-13) | Re-tare, or a supervisor override with reason (option C) | Step 24, ADR-047 |
| Traceability of every weighing (BR-11, BR-14) | Each record carries the full set, tare included | Step 25 |
| No re-keying into OrgaTEX (BR-12) | Consumption is posted at completion, idempotently, and queued when offline | Steps 26, 30 |
| A physical record travels with the container (BR-15) | The ticket, printed on the Dummy printer | Step 27 |

**Training scope, by design:** the MES, scales, scanner and printer are
Dummy APIs; the brief's open integration questions stay open (A-01, Q-01).

**Verdict:** ☐ solves the problem ☐ does not — notes: ______________________

## 2. UI/UX — does the working application reproduce the intended experience?

| Prototype screen | In the product | Evidence |
|---|---|---|
| 1 · Select batch | Queue from the API, scan or touch | Step 19 |
| 2 · Weigh | All 16 listed elements, incl. lot, container and tare | Step 20 |
| 3 · Confirm & print | Completion summary, ticket preview, print, reprint | Steps 26, 27 |
| The look | The prototype's terminal style; validated at Step 28 | `STEP-28-ui-validation/` |

**Deliberate differences:** the surplus is information-only and the
override is a supervisor sign-off (Step 24); a Prepare panel captures lot
and container (bolt 031).

**Verdict:** ☐ reproduces it ☐ does not — notes: ______________________

## 3. Requirements — does every approved requirement have an implementation?

- `requirements.md`: 23 functional requirements (FR-1 … FR-23), each traced
  to stories; **38 / 38 stories complete**, **33 / 33 bolts complete**
  (`STEP-32`), 0 status inconsistencies (`STEP-31`).
- `npm run verify:requirements` → **ALL REQUIREMENT CHECKS PASSED**;
  `npm run verify:fr-refs` → **no problems** (58 files, 38 stories).
- 48 recorded decisions (`standards/decision-index.md`).

**Verdict:** ☐ every requirement implemented ☐ gaps — notes: ______________

## 4. Acceptance Criteria — can every important behaviour be demonstrated?

| AC | Criterion | Demonstrated by | Status |
|---|---|---|---|
| AC-01 | Batch selected, correct recipe within 3 s | Step 19 (select + recipe: 588 ms in that run) | ✅ |
| AC-02 | Correct scale per component, no operator input | Step 21 | ✅ |
| AC-03 | Live weight tracks the scale, no perceptible lag | the live stream (SSE, 100 ms default interval); Steps 20–22 | ✅ |
| AC-04 | Confirmation impossible outside tolerance | Step 22 (5 boundary cases) | ✅ |
| AC-05 | Over-dose produces the agreed response | Step 24 (option C) | ✅ |
| AC-06 | Override needs supervisor authentication and a reason | Step 24 (wrong PIN refused) | ✅ |
| AC-07 | Weighing retrievable with target, actual, operator, scale, lot, timestamp | Step 25 | ✅ |
| AC-08 | Consumption appears in OrgaTEX | Step 26 (stored data) | ✅ |
| AC-09 | Offline batch reaches OrgaTEX without re-keying or duplication | Step 30 (OrgaTEX unavailable → queued → confirmed) | ✅ |
| AC-10 | Ticket prints with the agreed content | Step 27 (training content, Q-11) | ✅ |
| AC-11 | A new operator completes a batch unaided after one shift | needs real operators (A-14) | ⬜ not automatable |
| AC-12 | No slower than the paper process | needs a paper baseline (A-13, A-14) | ⬜ not measurable yet |
| AC-13 | All operator-facing text in the agreed language | every string from the locale bundle (source test); English only — the language is not yet agreed | ✅ mechanism · language open |
| AC-14 | No weighing on an out-of-calibration scale | unit tests: `CALIBRATION_EXPIRED` refuses the weighing | ✅ (unit level) |

**Verdict:** ☐ demonstrable ☐ not — notes: ______________________

## 5. Tests — can the behaviour be proven automatically?

| Suite | Result |
|---|---|
| `npm test` (unit, integration, security, UI) | **1969 / 1969** |
| `npm run test:e2e` — the complete scenario (Step 29) | 1 / 1 |
| `npm run test:e2e:failures` — the failure scenarios (Step 30) | 8 / 8 |
| `npm run test:e2e:step24` — the overshoot rule | 1 / 1 |
| `node scripts/evidence-backfill.cjs 19 … 27` — the backfilled captures | each passes |

**Verdict:** ☐ proven ☐ not — notes: ______________________

## What the owner should weigh

**Known product gaps (none blocks the scenario):**

1. The supervisor's tolerance report counts 0 overrides (it reads the audit
   trail; the override path writes none).
2. The completion view briefly shows raw string keys before its labels load.
3. The status line reads "Settling" after a supervisor authorises.
4. Videos are `.webm`, not `.mp4`.
5. A missing lot or container reads "No reading"; a lot-less posting is
   sent as `UNKNOWN`.
6. A bucket weighed empty on the training scale records a 0 kg tare.

**Evidence gaps:** the image files for Steps 0–7, 11 and 12 were never
saved (text equivalents exist for several); see `STEP-31`.

## Overall

**Did we build the product we intended to build?**
☐ Yes ☐ Yes, with the gaps above accepted ☐ No

Signed: ______________________ Date: ____________
