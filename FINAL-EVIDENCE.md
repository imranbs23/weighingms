---
step: 34
created: 2026-11-07T06:00:00Z
rewritten: 2026-11-11T15:15:00Z
---

# FINAL-EVIDENCE.md — the evidence matrix

**The workbook's Step 34:** *"Create FINAL-EVIDENCE.md"* with the matrix of
requirement → UI → API → code → test → evidence → result. The rows are the
workbook's own. Every file named under **Evidence** is in `evidence/`.

Rewritten on 2026-11-11 after bolts 029–033 and the Step 13–27 backfill;
the 2026-11-07 version (19 bolts) is in git history.

## The matrix

| **Requirement** | **UI** | **API** | **Code** | **Test** | **Evidence** | **Result** |
|---|---|---|---|---|---|---|
| **Batch queue** | ✓ | ✓ | ✓ | ✓ | `STEP-19-batch-screen.png`, `STEP-19-network.png`, `STEP-19-test.png`; `STEP-16/17/18` | ✅ The queue comes from the API (`GET /api/batch-queue`, reading the Dummy OrgaTEX through the adapter, ADR-028); no batch is hard-coded in the client |
| **Batch selection** | ✓ | ✓ | ✓ | ✓ | `STEP-19-*` | ✅ By scan or touch (`POST /api/selection`); the method is derived from the request (ADR-030) |
| **Recipe** | ✓ | ✓ | ✓ | ✓ | `STEP-17-dummy-data.json`, `STEP-17-api-response.png`, `STEP-19-network.png` | ✅ Five components, matching the prototype exactly (target, tolerance, unit, scale) |
| **Scale selection** | ✓ | ✓ | ✓ | ✓ | `STEP-21-scale-switch.png`, `STEP-21-scale-api.png` | ✅ The station picks the scale: Yellow RGB → 3 kg precision (g), Sodium Sulphate → 32 kg floor (kg) |
| **Live weight** | ✓ | ✓ | ✓ | ✓ | `STEP-21-scale-api.png`; `STEP-20-weigh-screen.png` | ✅ `GET /api/scales/:id/weight` is a live stream (SSE, 100 ms default); a stale reading shows no value |
| **Tolerance** | ✓ | — | ✓ | ✓ | `STEP-22-tolerance-tests.txt`, `STEP-22-tolerance-ui.png` | ✅ 93.4 no · 93.5 yes · 94.0 yes · 94.5 yes · 94.6 no, on the terminal and at the gate; the client computes no zone |
| **Lot tracking** | ✓ | ✓ | ✓ | ✓ | `STEP-20-weigh-screen.png`, `STEP-25-transaction.json` | ✅ The MES's lot is retrieved (SOURCE) or scanned / keyed; this session's lot is on the record (bolt 031) |
| **Container/tare** | ✓ | ✓ | ✓ | ✓ | `STEP-20-weigh-screen.png`, `STEP-25-confirmation.png` | ✅ Assigned in the Prepare panel; the tare (weight and source) is on the record (bolts 031–032, ADR-048) |
| **Component progression** | ✓ | ✓ | ✓ | ✓ | `STEP-23-five-component-demo.webm`, `STEP-23-video-frames.png`, `STEP-23-progression-log.txt` | ✅ Five components in order, each only when valid; the batch cannot complete until all are done (409) |
| **Overshoot** | ✓ | ✓ | ✓ | ✓ | `STEP-24-overshoot-decision.md`, `STEP-24-overshoot-ui.png`, `STEP-24-overshoot-test.png` | ✅ The human's rule (option C): never auto-confirmed, no recalculation; re-tare, or a supervisor override with reason, marked "OVER · overridden" (ADR-047) |
| **OrgaTEX write-back** | ✓ | ✓ | ✓ | ✓ | `STEP-26-ui.png`, `STEP-26-request.png`, `STEP-26-response.png`, `STEP-26-data.png`; `STEP-30-failure-tests.md` | ✅ CONFIRMED at completion; five postings stored, each with lot, operator and idempotency key; offline postings are queued and confirmed on recovery |
| **Ticket** | ✓ | ✓ | ✓ | ✓ | `STEP-27-ticket.png`, `STEP-27-printer-api.png`, `STEP-27-ticket-test.png` | ✅ All ten prototype fields, printed on the Dummy printer; the client composes no part of it (ADR-042) |

**Also asked for by the workbook:** confirmation (Step 25:
`STEP-25-confirmation.png`, `STEP-25-transaction.json`, all eight fields on
the record), the complete scenario (Step 29: `STEP-29-playwright-report/`,
`STEP-29-e2e-video.webm`), the failure scenarios (Step 30:
`STEP-30-failure-tests.md`), the UI validation (Step 28:
`STEP-28-ui-validation/`).

## Beyond the matrix

| **Requirement** | **Where** | **Result** |
|---|---|---|
| Supervisor override (FR-13, FR-21) | unit 008 authorisation, consumed by the escalation | ✅ Fresh supervisor credentials; the operator's own are refused; single use, scoped to the component |
| Audit trail (FR-21) | `src/006-ticket-printing/` | ✅ Append-only; export streamed (ADR-044) |
| Operational report (FR-23) | `GET /api/report/tolerance` | ⚠️ Lists failures; **counts 0 overrides** (it reads the audit trail; the override path writes none) |
| Configuration and language (FR-22) | `GET /api/locale`, configuration store | ✅ Versioned; every operator string from the bundle (English only: the language is not yet agreed) |
| Peripheral states (FR-19) | the status strip | ✅ Scales, scanner, printer, OrgaTEX link, each a real value from the API |
| Identity and roles (FR-18) | `src/008-operator-identity/` | ✅ Argon2id; session tokens stored as digests |
| Records immutable (DR-02) | every table's triggers | ✅ Append-only; corrections are new rows |

## The evidence, by step

| **Step** | **Artefact** |
|---|---|
| 0, 1 | — *(image files not saved; see below)* |
| 2 | `STEP-02-manifest.txt`, `STEP-02-node-version.txt` |
| 2.5 | `STEP-02.5-skill-validation.txt` |
| 3 | `STEP-03-project-state.txt` |
| 4 | `STEP-04-dashboard.txt` |
| 5 | — *(not saved)* |
| 6 | `STEP-06-intent.txt`, `STEP-06-GATE-APPROVED.txt` |
| 7 | `STEP-07-requirements-validation.txt`, `STEP-07-GATE-APPROVED.txt` |
| 8 | `STEP-08-ui-analysis/`, `STEP-08-manifest.txt` |
| 9 | `STEP-09-system-context.md`, `STEP-09-system-context.png` |
| 10 | `STEP-10-manifest.txt`, `STEP-10-units.png`, `STEP-10-unit-map.png` |
| 11 | `STEP-11-fr-reference-convention.md` |
| 12 | `STEP-12-bolt-map.png`, `STEP-12-checkpoint-3-review.md` |
| 13 | `STEP-13-bolt-list.png`, `.md` |
| 14 | `STEP-14-bolt-start.png`, `.md` |
| 15 | `STEP-15-plan.png`, `.md` |
| 16 | `STEP-16-dummy-apis.png`, `.md` |
| 17 | `STEP-17-dummy-data.json`, `STEP-17-api-response.png` |
| 18 | `STEP-18-api-tests.txt`, `STEP-18-api-results.png` |
| 19 | `STEP-19-batch-screen.png`, `STEP-19-network.png`, `STEP-19-test.png` |
| 20 | `STEP-20-weigh-screen.png`, `.md` |
| 21 | `STEP-21-scale-switch.png`, `STEP-21-scale-api.png` |
| 22 | `STEP-22-tolerance-tests.txt`, `STEP-22-tolerance-ui.png` |
| 23 | `STEP-23-five-component-demo.webm`, `STEP-23-video-frames.png`, `STEP-23-progression-log.txt` |
| 24 | `STEP-24-overshoot-decision.md`, `STEP-24-overshoot-ui.png`, `STEP-24-overshoot-test.png`, `STEP-24-overshoot-completion.png` |
| 25 | `STEP-25-confirmation.png`, `STEP-25-transaction.json` |
| 26 | `STEP-26-ui.png`, `STEP-26-request.png`, `STEP-26-response.png`, `STEP-26-data.png` |
| 27 | `STEP-27-ticket.png`, `STEP-27-printer-api.png`, `STEP-27-ticket-test.png` |
| 28 | `STEP-28-ui-validation/` |
| 29 | `STEP-29-playwright-report/`, `STEP-29-e2e-video.webm`, `STEP-29-e2e.md`, `STEP-29-unit-tests.txt` |
| 30 | `STEP-30-failure-tests.md`, `STEP-30-failure-tests/` |
| 31 | `STEP-31-project-status.md` |
| 32 | `STEP-32-final-dashboard.png`, `-overview.png`, `-specs.png`, `.md` |
| 33 | `STEP-33-human-validation.md` *(verdict pending)* |
| 34 | `FINAL-EVIDENCE.md` (this file) |

Steps 13–27 were **backfilled** on 2026-11-11: the work happened during
construction, the files were captured afterwards from the project's records
and fresh runs, and each says so. `node scripts/evidence-backfill.cjs <step>`
regenerates them.

## The state of the build

| | |
|---|---|
| **Intent** | complete |
| **Units** | 8 of 8 complete |
| **Stories** | 38 of 38 complete |
| **Bolts** | **33 of 33** complete (25 DDD, 8 simple); 0 status inconsistencies |
| **ADRs** | 48 |
| **Tests** | `npm test` **1969 / 1969**; e2e: scenario 1/1, failures 8/8, overshoot 1/1 |
| **Coverage** | 88.37% statements · 81.55% branches · 90.78% functions · 89.38% lines (`npm run test:coverage`, 2026-11-11) |
| **Typecheck** | clean, server and client |

## What is NOT in this package

| **Missing** | **Status** |
|---|---|
| Image files for Steps 0, 1, 5 | Never saved; no text equivalent |
| Image files for Steps 2–4, 6, 7, 11, 12 | Never saved; text or other equivalents listed above |
| `.mp4` videos | The videos are `.webm` (no ffmpeg on this machine) |
| Dyestuff identity check in the terminal (story 002-002) | The API exists (scan or attestation); the terminal has no screen for it |
| Abandoning a component on the server | Quit (F4) leaves the view; the session resumes. No abandon endpoint |
| Manual scale reselection | Not built (the rule always selects) |
| Override count in the tolerance report | Counts 0 (see above) |
| Cosmetic | Raw string keys flash on the completion view; "Settling" after an authorisation; "No reading" for a missing lot or container; a lot-less posting is sent as `UNKNOWN`; a bucket weighed empty on the training scale records 0 kg |

None of these blocks the workbook's scenario. They are listed so the gaps
are visible rather than implied.
