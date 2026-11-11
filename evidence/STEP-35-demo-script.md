---
step: 35
prepared: 2026-11-11T15:20:00Z
---

# Step 35 — Final Demonstration: the script

The workbook: *"Open the running application. Do not use slides as the
primary demonstration."* This is the order to follow, with what to click
and what to point at.

## Before you start

- The app: **http://localhost:5173** (the API is on http://localhost:3000).
- Logins: operator **OP-001 / 4821**; supervisor **SUP-001 / 9164**.
- **Start from a fresh database** so B-24187 is in the queue and nothing
  is half-weighed (ask Claude to restart the API on a fresh demo database,
  or run `npm run dev:api` with `DATABASE_PATH` pointing at a new file and
  seed with `npx tsx scripts/seed-identity.ts`).
- Release the batch once (the MES does this, not the station):
  `POST /api/orgatex/control/release {"batchId":"B-24187","status":"RELEASED"}`.

| Containers you can type | Tare |
|---|---|
| C-09 (Blue), C-11 (Red), C-12 (Yellow) | 214 g, from the container master |
| D-03 (Sodium Sulphate), D-05 (Soda Ash) | weighed empty (0 on the training scale) |

## Part 1 — Batch

1. Sign in as **OP-001 / 4821**.
2. Show the **queue**: B-24187, B-24188, B-24190, B-24191 — from the API.
3. Click **B-24187**.

## Part 2 — Recipe

4. Point at the **rail**: the five components, with targets and units
   (g for the dyes, kg for the chemicals), Blue RSPL active.

## Part 3 — Scale

5. Point at **Scale selected: 3 kg precision** and the header: lot
   2026-0341 arrived from the MES by itself. Type **C-09** in Container,
   press Enter: the header reads *Container C-09 · Tare 214.0 g*.
6. **Simulate dispense** → **OK · Confirm** (F1). Do the same for Red RB.
7. **Yellow RGB**: still the 3 kg scale. Weigh and confirm it.
8. **Sodium Sulphate**: the station switches to **32 kg floor**, in kg.

## Part 4 — Tolerance

9. On Sodium Sulphate, before pouring: the platform is empty, **OK ·
   Confirm is disabled**, and the reason says why.
10. **Simulate overshoot**: OVER TOLERANCE, confirm still disabled, the
    surplus is shown for information.
11. **Re-tare (F2)**, then **Simulate dispense**: WITHIN TOLERANCE,
    **confirm enabled**. Confirm.
    *(Optional: instead of re-tare, show the supervisor override — badge
    SUP-001, PIN 9164, a reason — and the record marked "OVER ·
    overridden".)*

## Part 5 — Complete

12. Weigh and confirm **Soda Ash**. The completion view: **5/5**, all
    within tolerance, the lot and container on the detail table.

## Part 6 — Integration

13. Point at **Written to OrgaTEX · CONFIRMED**.
14. The request, the response and the stored transaction:
    - open **http://localhost:3000/api/batches/B-24187/consumption** in a
      browser tab — the five postings the Dummy OrgaTEX stored, each with
      lot, operator, weighing time and idempotency key;
    - and `evidence/STEP-26-request.png` / `STEP-26-response.png` for the
      request and the 200 OK response.

## Part 7 — Ticket

15. Point at the **ticket preview**: batch, order, machine, shade, date,
    operator, the five lines (target and actual), the barcode.
16. **Print ticket (F1)**: *Print job DONE · Printed* (the Dummy printer).

## Part 8 — Automated test

17. Run `npm run test:e2e` (about a minute) and show **1 passed**, or open
    the saved report: `npx playwright show-report evidence/STEP-29-playwright-report`.
18. Optionally `npm test`: **1969 passed**.
