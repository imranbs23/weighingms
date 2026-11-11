---
stage: test
bolt: 031-007-weighingms-ui
created: 2026-11-11T13:05:00Z
---

# Test Walkthrough: Lot, Container and Tare (Bolt 031)

## Results

| Suite | Result |
|---|---|
| Vitest, whole suite | **1954 / 1954** (1938 before this bolt) |
| `tsc`, server and client | passes |
| E2E Step 29 (`npm run test:e2e`), now with a container scan and the lot on the completion detail | 1 / 1 |
| E2E Step 30 (`npm run test:e2e:failures`) | 8 / 8 |
| E2E Step 24 (`npm run test:e2e:step24`) | 1 / 1 |
| Step 20 capture (`node scripts/evidence-backfill.cjs 20`) | all 16 workbook elements present |

## New tests

**Integration** — `tests/integration/lot-and-container-api.test.ts` (6):

1. The MES's lot is retrieved when the component is prepared, method `SOURCE` (`2026-0341` for Remazol Blue)
2. A master-tare container (`C-09`) shows with its tare (214 g), and the confirmed record carries the lot and the container
3. A keyed lot for a component the MES holds none for (`AUX-0101`) is captured, shown and recorded
4. An empty lot → 400, nothing captured
5. An unknown container (`X-99`) → 404 `CONTAINER_NOT_FOUND`, nothing assigned
6. A capture from an **earlier session** is neither shown nor recorded — **mutation-checked**: with the session filter removed, this test fails

**UI** — 10:

- `tests/ui/prepare-panel.test.tsx` (7): both fields while neither is captured; only the missing one; hidden when both are; **Enter sends a SCAN, the button a KEYED value**; it validates nothing itself; inert while busy.
- `tests/ui/weigh-head.test.tsx` (2): the header reads "code · Lot · Container · Tare"; only captured parts are shown.
- `tests/ui/terminal-workflow.test.tsx` (1): the weigh screen shows the session's `activeCaptures`, a scanned container is sent with the bound scale (`{componentId, scaleId, code}`), and unit 002's unscoped reads are no longer called.

**E2E** — `playwright/e2e-weighing.spec.ts`: the first component's MES lot appears by itself, `C-09` is scanned, the header shows "C-09" and "214.0 g", and the completion detail for `DYE-4471-B` shows `2026-0341` and `C-09`.

## Acceptance criteria

| Criterion (plan) | Status |
|---|---|
| Lot and container show in the header with the tare | ✅ UI + E2E (`STEP-20-weigh-screen.png`) |
| The confirmed record carries them; completion shows them | ✅ integration 2–3, E2E |
| Empty lot refused, nothing recorded | ✅ integration 4 |
| Unknown container refused, nothing recorded | ✅ integration 5 |
| An earlier session's capture not shown or recorded | ✅ integration 6 (mutation-checked) |
| Re-tare keeps the container and its recorded tare | ✅ unchanged by this bolt: the assignment is a separate record; the Step 30 re-tare scenario passes |
| Option B gate | not applicable (option A chosen) |

## Notes

- The Step 24 and Step 30 runs regenerate their screenshots; the weigh view in
  them now shows the Prepare panel above the readout.
- Not covered by an automated test: a container weighed empty (`D-03`,
  `D-05`) on the floor scale. The assignment path is bolt 012's and is
  covered by its own tests; this bolt only displays its result.
