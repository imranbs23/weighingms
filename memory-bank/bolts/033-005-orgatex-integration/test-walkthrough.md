---
stage: test
bolt: 033-005-orgatex-integration
created: 2026-11-11T14:40:00Z
---

# Test Walkthrough: Read Back the Dummy's Stored Consumption (Bolt 033)

## Results

| Suite | Result |
|---|---|
| Vitest, whole suite | **1969 / 1969** |
| `tests/integration/dummy-consumption-readback.test.ts` (new) | 5 / 5 |
| Step 26 capture (`node scripts/evidence-backfill.cjs 26`) | 1 / 1 |

## Acceptance criteria

| Criterion | Status |
|---|---|
| After a batch completes, one posting per component, each with lot, operator, time and idempotency key | ✅ integration + Step 26 (`STEP-26-data.png`: 5 postings) |
| No postings → 200, empty list | ✅ integration |
| Unknown batch → 404 | ✅ integration |
| A duplicate posted over HTTP is listed twice | ✅ integration |
| Dummy unreachable → 503 | ✅ integration |

## Evidence (workbook Step 26)

| File | Shows |
|---|---|
| `evidence/STEP-26-ui.png` | Completion: 5/5, "Written to OrgaTEX · CONFIRMED" (highlighted) |
| `evidence/STEP-26-request.png` | The terminal's `POST /api/batch/B-24187/complete`, the five postings the station sent in process (as received), and the Dummy's HTTP form on B-24188 |
| `evidence/STEP-26-response.png` | `200 OK` with writeBack CONFIRMED; the Dummy's HTTP endpoint `201 Created` |
| `evidence/STEP-26-data.png` | `GET /api/batches/B-24187/consumption → 200`, five postings |

## Notes

- The station posts in process through the adapter (ADR-041), not over the
  Dummy's HTTP endpoint; the evidence says so.
- Components with no captured lot are posted with lot `UNKNOWN`: the
  station's existing convention in `complete-batch.ts` (bolt 018), unchanged here.
- Test stage approved under the project owner's instruction to finish
  Step 26 (2026-11-11).
