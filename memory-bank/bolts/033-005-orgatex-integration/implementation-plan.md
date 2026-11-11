---
stage: plan
bolt: 033-005-orgatex-integration
created: 2026-11-11T14:05:00Z
---

# Implementation Plan: Read Back the Dummy's Stored Consumption (Bolt 033)

## Objective

The workbook's Step 26 asks to *"show the resulting consumption record"*.
The Dummy OrgaTEX stores what the station posts, but nothing reads it back
over HTTP. This bolt adds one read-only training endpoint.

## Baseline

| | Today |
|---|---|
| Posting | The station posts each component's consumption through the adapter, in process (ADR-041), into the Dummy's world. The Dummy also accepts `POST /api/batches/:batchId/consumption` over HTTP (201). |
| Storage | The world turns a posting into a **recipe-component shape**: the actual quantity goes into a field called `target`, and the lot, operator, weighing time and idempotency key are dropped. |
| Read-back | `readConsumption(batchId)` exists in code; no endpoint calls it. |

## Deliverables

1. **The world keeps each posting as received.** Alongside today's store, a
   per-batch list of `RawConsumption` postings (batch, component, actual
   quantity, unit, lot, operator, weighed at, idempotency key). The world
   still does **not** deduplicate: a duplicate posting must stay visible,
   because hiding it would hide the failure idempotency exists to prevent
   (the world's own rule).
2. **`GET /api/batches/:batchId/consumption`** on the Dummy's router:
   `200 { batchId, postings: [...], receivedCount }`. A batch with no
   postings is `200` with an empty list. An unknown batch is `404
   BATCH_NOT_FOUND`, like the Dummy's other batch reads. When the Dummy is
   set unreachable it is `503 ORGATEX_UNAVAILABLE`, like its other routes.
3. **Nothing else changes:** the station, the adapter, the posting rules and
   the existing `POST` (201) stay as they are.

## Technical Approach

- The response carries quantities as strings, as everywhere (NFR-16).
- The endpoint sits with the Dummy's other routes, so it is a training
  contract only. It is not a claim about the real OrgaTEX interface (A-01,
  Q-01).

## Acceptance Criteria

- [ ] After a batch completes, the endpoint lists one posting per component,
      each with lot, operator, weighing time and idempotency key
- [ ] A batch with no postings → 200, empty list
- [ ] An unknown batch → 404
- [ ] Posting the same record twice over HTTP → two entries (not deduplicated)
- [ ] The Dummy unreachable → 503

## Tests (Stage 3)

- Integration: the five postings after completing B-24187 through the
  station; the empty, unknown and unreachable cases; a duplicate posted over
  HTTP is listed twice.
- Evidence: the Step 26 capture (UI, request, response, stored data).
