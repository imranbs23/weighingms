---
stage: implement
bolt: 033-005-orgatex-integration
created: 2026-11-11T14:20:00Z
---

# Implementation Walkthrough: Read Back the Dummy's Stored Consumption (Bolt 033)

## Changes (the Dummy OrgaTEX only)

| File | Change |
|---|---|
| `src/005-orgatex-integration/infrastructure/adapters/dummy-orgatex-data.ts` | A per-batch list of postings **as received** (`RawConsumption`), appended by `postConsumption` alongside today's store; `readPostings(batchId)`. Not deduplicated. |
| `src/005-orgatex-integration/presentation/controllers/dummy-orgatex-controller.ts` | `GET /api/batches/:batchId/consumption` → `200 { batchId, receivedCount, postings }`; `404 BATCH_NOT_FOUND` for an unknown batch; `503 ORGATEX_UNAVAILABLE` while the Dummy is unreachable. |

The station, the adapter, the posting rules and the existing `POST` (201)
are unchanged.

## Verified so far

- `tsc` passes.
- `tests/integration/dummy-consumption-readback.test.ts`: 5 / 5 (empty, unknown, unreachable, the five postings after completing B-24187 through the station, a duplicate listed twice).
- Vitest, whole suite: Tests  1969 passed (1969)
