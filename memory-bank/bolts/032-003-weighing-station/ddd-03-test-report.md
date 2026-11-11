---
unit: 003-weighing-station
bolt: 032-003-weighing-station
stage: test
status: complete
updated: 2026-11-11T13:25:00Z
---

# Test Report - Weighing Station (bolt 032, the tare on the record)

## Test Summary

| Category | Passed | Failed | Skipped | Coverage |
|----------|--------|--------|---------|----------|
| Vitest, whole suite | 1964 | 0 | 0 | not measured |
| Unit (new: `recorded-tare.test.ts`) | 5 | 0 | 0 | - |
| Integration (extended: `lot-and-container-api.test.ts`) | 6 | 0 | 0 | - |
| E2E Step 25 capture | 1 | 0 | 0 | - |
| E2E Steps 29 / 30 / 24 (regression) | 1 / 8 / 1 | 0 | 0 | - |

## Acceptance Criteria Validation

| Criterion | Status |
|---|---|
| A confirmed weighing with a container carries its tare (value, unit, source) | ✅ integration (C-09 → 214 g, CONTAINER_MASTER) + Step 25 E2E |
| Without a container, the tare is null — never invented | ✅ integration (AUX-0101, no container) + unit round-trip |
| An earlier session's container gives no container and no tare | ✅ integration |
| Existing records stay valid; nothing is back-filled | ✅ unit: a real pre-037 database, reopened, migrates and reads `tare: null`; and the dev database's 6 existing records read `tare: null` after the live migration |
| The database refuses an unknown tare source | ✅ unit (CHECK constraint) |
| Steps 24, 29 and 30 still pass | ✅ |

## Unit Tests

`tests/unit/recorded-tare.test.ts` (5): the source guard; a tare
round-trips as strings; no tare round-trips as `null`, never zero; the
database refuses `GUESSED` as a source; a record written **before**
migration 037 (the table taken back to its old shape, an old row written,
then reopened so 037 runs for real) reads back with `tare: null`.

## Integration Tests

`tests/integration/lot-and-container-api.test.ts`, extended: the confirmed
record carries `tare {weight, unit: g, source: CONTAINER_MASTER}` with
`C-09`; `tare: null` with no container; `tare: null` when the only
container was assigned in an earlier session.

## Evidence (workbook Step 25)

| File | What it shows |
|---|---|
| `evidence/STEP-25-confirmation.png` | Confirm disabled on the empty platform, enabled within tolerance, and the eight workbook fields as recorded |
| `evidence/STEP-25-transaction.json` | The station's response to `POST /api/session/confirm` (201), as given, with the eight fields mapped to the record |

## Issues Found

None in this bolt.

## Ready for Operations

- [x] All acceptance criteria met
- [ ] Code coverage > 80% (not measured in this project)
- [x] No critical/high severity issues open
