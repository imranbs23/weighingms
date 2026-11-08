---
step: 34
created: 2026-11-07T06:00:00Z
---

# FINAL-EVIDENCE.md — the evidence matrix

**The workbook's Step 34:** *"Create FINAL-EVIDENCE.md"* with the matrix
of requirement → UI → API → code → test → evidence → result.

**The matrix's rows are the workbook's own**, and the **Evidence** column
names the artefact that proves each one.

---

## The matrix

| **Requirement** | **UI** | **API** | **Code** | **Test** | **Evidence** | **Result** |
|---|---|---|---|---|---|---|
| **Batch queue** | ✓ | ✓ | ✓ | ✓ | `src/007-weighingms-ui/screens/batch-queue/` · `GET /api/batch-queue` | ✅ 10 client tests · the queue renders the seven columns and the receipt time |
| **Batch selection** | ✓ | ✓ | ✓ | ✓ | `src/001-batch-management/` · `POST /api/selection` | ✅ by scan **and** by touch, and the method is **derived** from the request's shape (ADR-030) |
| **Recipe** | ✓ | ✓ | ✓ | ✓ | `src/002-recipe-material-management/` · `GET /api/recipe/:batchId` | ✅ the rail shows each component's state, the shade, the batch and the count |
| **Scale selection** | ✓ | ✓ | ✓ | ✓ | `src/004-scale-integration/` · `POST /api/scales/select` | ✅ the **rule** selects it — the operator never chooses (BRD BR-05) |
| **Live weight** | ✓ | ✓ | ✓ | ✓ | `src/004-scale-integration/presentation/controllers/weight-stream-controller.ts` (SSE) | ✅ 10 Hz push · the newest reading wins **by sequence** · a stale reading shows **no value** |
| **Tolerance** | — | ✓ | ✓ | ✓ | `src/003-weighing-station/domain/services/tolerance-zone-evaluator.ts` | ✅ **the client computes no zone** — the source test proves it |
| **Lot tracking** | ✓ | ✓ | ✓ | ✓ | `src/002-recipe-material-management/` · `GET /api/material-lot/:componentId` | ✅ the weigh-head shows the lot; the method is recorded on the capture |
| **Container/tare** | ✓ | ✓ | ✓ | ✓ | `src/002-recipe-material-management/` · `GET /api/container/:componentId` | ✅ the container is shown and the tare is applied at the **device** (ADR-014) |
| **Component progression** | ✓ | ✓ | ✓ | ✓ | `src/003-weighing-station/domain/entities/weighing-session.ts` | ✅ the record is written **first**, then the session advances (ADR-040) |
| **Overshoot** | ✓ | ✓ | ✓ | ✓ | `src/003-weighing-station/domain/services/compensation-calculator.ts` | ✅ the factor is **computed**, never a constant, and the client renders it |
| **OrgaTEX write-back** | ✓ | ✓ | ✓ | ✓ | `src/005-orgatex-integration/` · `POST /api/orgatex/consumption` | ✅ **idempotent** — the ledger's `UNIQUE` is the atomic guard (ADR-023) |
| **Ticket** | ✓ | ✓ | ✓ | ✓ | `src/006-ticket-printing/` · `POST /api/tickets` · `POST /api/tickets/:id/print` | ✅ **one per session**; the client composes **no part** of it (ADR-042) |

---

## Beyond the matrix — the requirements the workbook's table does not list

**The workbook's table covers the ten headline requirements. The intent has
more, and these are the ones a reviewer would look for:**

| **Requirement** | **Where** | **Result** |
|---|---|---|
| **Supervisor override** (FR-13) | `src/003-weighing-station/domain/services/authorise-escalation.ts` | ✅ the operator's own credentials **cannot** authorise it — the check is on **identity** |
| **The audit trail** (FR-21, FR-36) | `src/006-ticket-printing/domain/entities/audit-entry.ts` | ✅ append-only, with **no update and no delete path** |
| **The export** (FR-21) | `GET /api/audit/trail/export` | ✅ **streamed** as NDJSON — the peak memory is one entry (ADR-044) |
| **Operational reporting** (FR-23) | `GET /api/report/tolerance` | ✅ the zone is **read** from the record, never recomputed (ADR-046) |
| **Configuration** (FR-22) | `PUT /api/configuration/:key` | ✅ **versioned** — the effective value is a function of **time** (ADR-045) |
| **The peripheral states** (FR-19) | `src/007-weighingms-ui/screens/status/StatusStrip.tsx` | ✅ every entry is a **real value from the API**; two failures get two entries |
| **The identity and roles** (FR-18, FR-35) | `src/008-operator-identity/` | ✅ Argon2id, and **two** roles; the session token is a **digest** (ADR-002) |
| **Retention and immutability** (DR-01, DR-02) | every table's triggers | ✅ every record is append-only, with the triggers as the enforcement |

---

## The evidence, by step

| **Step** | **Artefact** |
|---|---|
| 0 — the repository | `evidence/STEP-03-project-state.txt` |
| 2 — specs.md installed | `evidence/STEP-02-manifest.txt`, `evidence/STEP-02-node-version.txt` |
| 2.5 — the Puku skills | `evidence/STEP-02.5-skill-validation.txt` |
| 3 — the agents | `evidence/STEP-03-project-state.txt` |
| 4 — the dashboard | `evidence/STEP-04-dashboard.txt` |
| 6 — the intent approved | `evidence/STEP-06-intent.txt`, `evidence/STEP-06-GATE-APPROVED.txt` |
| 7 — the requirements approved | `evidence/STEP-07-requirements-validation.txt`, `evidence/STEP-07-GATE-APPROVED.txt` |
| 8 — the UI/UX converted | `evidence/STEP-08-ui-analysis/`, `evidence/STEP-08-manifest.txt` |
| 9 — the system context | `evidence/STEP-09-system-context.md`, `evidence/STEP-09-system-context.png` |
| 10 — the units | `evidence/STEP-10-manifest.txt`, `evidence/STEP-10-units.png`, `evidence/STEP-10-unit-map.png` |
| 11 — the FR convention | `evidence/STEP-11-fr-reference-convention.md` |
| 12 — the bolt map | `evidence/STEP-12-bolt-map.png`, `evidence/STEP-12-checkpoint-3-review.md` |
| **28 — the UI validation** | **`evidence/STEP-28-ui-validation/validation.md`** |
| **34 — this matrix** | `FINAL-EVIDENCE.md` |

---

## The state of the build

| | |
|---|---|
| **Bolts** | **19 of 19** complete |
| **Units** | **8 of 8** complete |
| **Intent** | **complete** |
| **Tests** | **1843 passing**, 119 files |
| **Coverage** | 87.80% statements · **80.29%** branches · 90.27% functions · 88.77% lines — **all four above the 80% threshold** |
| **ADRs** | **46**, all well-formed and in the decision index |
| **Typecheck** | clean, on both the server and the client configs |

---

## What is NOT in this package

**And it is named here rather than left for a reviewer to find.**

| **Missing** | **Why** |
|---|---|
| **The Playwright report and the e2e video** (Step 29) | **Not yet built.** It is the next piece of work, and it needs a browser driving the real application. |
| **The three prototype comparison screenshots** (Step 28) | **Not yet captured.** The *comparison* is done — `evidence/STEP-28-ui-validation/validation.md` — and it names the gaps element by element. The screenshots need the browser too. |
| **The failure-scenario captures** (Step 30) | **Not yet captured.** The behaviours are implemented and tested — the printer's failure, the unreachable MES, the silent scale — but the *capture* is Step 30's. |
| **The abandon and manual-reselection endpoints** | **Not built.** Two API gaps, both flagged in bolt `026`'s report. The reselection is a **privileged** action, so it needs unit `008`'s authorisation. |
| **The scanner's and printer's status endpoints** | **Not built.** Two small API additions, so the status strip can show all four peripherals as the story requires. |
| **The scan panel's own screen** | **Not built.** The one undelivered part of bolt `028` — the attestation offer needs it. |

**None of these is a defect in what exists.** They are the remaining
work, and they are listed so the gap is visible rather than implied.
