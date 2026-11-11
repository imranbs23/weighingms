---
step: 30
created: 2026-11-11T08:00:00Z
---

# Step 30 — Failure scenarios

**The workbook's requirement:** *"A functional industrial application
cannot only demonstrate success."* Test scale unavailable, OrgaTEX
unavailable, printer unavailable, invalid weight, over tolerance, under
tolerance, re-tare, quit and incomplete batch.

**How:** `playwright/failures/e2e-failures.spec.ts`, run with
`npm run test:e2e:failures` against the running product: the real API and
SPA, a fresh database, the operator's UI. Each failure is injected through
the Dummy APIs' own training controls:

| Control | Injects |
|---|---|
| `POST /api/scales/SCALE-A/link` `{state: DISCONNECTED}` | the 3 kg scale stops responding |
| `POST /api/orgatex/control` `{state: UNREACHABLE}` | the Dummy MES is down |
| `POST /api/printer/control` `{available: false, reason: "Out of paper"}` | the dummy printer is out of paper (**added in this step**) |

The scenarios run **in order through one batch**: B-24187 is the only
batch with a recipe, so the scenarios that must not complete it come first.

**Result: 8/8 passed** (`STEP-30-playwright-report/`, `results.json`:
expected 8, unexpected 0, flaky 0).

## The results

| **Scenario** | **Expected** | **Actual** | **Pass** |
|---|---|---|---|
| Scale unavailable | Safe failure | The live readout shows **"No reading"**, never a stale number and never 0. **OK · Confirm is disabled**. The strip shows **"3 KG PRECISION · DISCONNECTED — NOT RESPONDING"** in red. On reconnect the scale reads READY again and Red RB is weighed and confirmed. `scale-unavailable.png` | ✅ |
| OrgaTEX unavailable | Defined behaviour | **Weighing continues**: the last three components are weighed and confirmed with OrgaTEX down. The batch completes **5/5** with **"Written to OrgaTEX: PENDING"**, never claimed as CONFIRMED. All 5 consumptions are in the **durable sync queue** ("UN-SYNCHRONISED 5"). When OrgaTEX is back, the retry worker delivers them and the write-back becomes **CONFIRMED**. `orgatex-unavailable.png`, `orgatex-recovered.png` | ✅ |
| Printer unavailable | Defined behaviour | The strip shows **PRINTER · UNAVAILABLE** before the print. Print gives **"Print job FAILED"** and **"Out of paper"**, with no "Printed". **The weighing survives**: the summary still holds 5/5 (BRD B-7). Once the printer is back, Print gives job **DONE** and "Printed". `printer-unavailable.png` | ✅ |
| Invalid weight | Cannot confirm | A confirmation the station cannot accept is refused: a component that is **not the active one** gets **409**; a malformed confirmation gets **400**. Nothing is recorded (0/5; Soda Ash still PENDING). | ✅ |
| Over tolerance | Cannot confirm | *Simulate overshoot* puts the zone **OVER**. **OK · Confirm is disabled**, with the reason "The weight is over tolerance. Use the recovery action." **F1 does nothing**. A direct API confirm is refused **409 `ZONE_OVER`**. The **surplus panel** shows the station's compensation proposal. `over-tolerance.png` | ✅ |
| Under tolerance | Cannot confirm | Empty platform: the zone is **UNDER**, **OK · Confirm is disabled**, with the reason "The weight is under tolerance. Dispense more."; **F1 does nothing**; 0/5. `under-tolerance.png` | ✅ |
| Re-tare | Weight reset | From OVER, **F2 (Re-tare)** resets **Weighed now to 0.0** and the zone to UNDER, with confirm disabled. The component is then weighed again from zero and confirmed (1/5). `re-tare.png` | ✅ |
| Quit | Safe exit | **F4 (Quit)** returns to the queue **without recording** the component. Selecting B-24187 again **resumes** at Yellow RGB with 2/5, the same component still ACTIVE. `quit.png` | ✅ |
| Incomplete batch | Cannot complete | At 2/5, `POST /api/batch/B-24187/complete` is refused **409 `BATCH_NOT_COMPLETE`**. The summary is `null`. The terminal stays on the weigh view; no completion view is shown. `incomplete-batch.png` | ✅ |

## Defects found by this step, and fixed

Step 30 found three defects in the product. Each has a test that fails
without its fix.

1. **A batch completed while OrgaTEX was down was never written back.**
   The station's write-back adapter (unit 003) received `QUEUED` from the
   posting service but never put the posting in the durable sync queue;
   only the HTTP `/consumption` route did. The write-back stayed PENDING for
   ever. *Fix:* the adapter enqueues a queued posting, as the HTTP route
   does. *Test:* `terminal-workflow-api.test.ts` › "a batch completed
   OFFLINE is queued durably — and CONFIRMED once OrgaTEX is back".
2. **The OrgaTEX retry worker never ran in the server.** The module's own
   documentation says "the server turns it on", but `server.ts` did not.
   *Fix:* `startRetryWorker: true`. *Test:* the OrgaTEX scenario above
   recovers to CONFIRMED in the running product.
3. **The surplus panel never appeared on an overshoot** (bolt 029). The
   "reading at rest" check re-ran only when the value changed, so once the
   reading settled it never ran again. *Fix:* the check runs on every poll.
   *Test:* `terminal-workflow.test.tsx` › "an OVER reading that comes to
   REST gets ONE surplus proposal".

And one addition: the dummy printer's training control
(`POST /api/printer/control`), the same kind of control the scale and the
Dummy MES already have. *Test:* `terminal-workflow-api.test.ts` › "the
printer's training control takes it out of service — and back".

## Observations, not failures

- The status strip repeats a state as its reason ("UNAVAILABLE —
  UNAVAILABLE", "DEGRADED — DEGRADED") and lists each queued write as
  "PENDING — 0". It is correct but noisy; worth tidying.
- The per-component detail shows "No reading" for a missing lot or
  container: it reuses the readout's placeholder. A dedicated "not
  captured" text would read better.
- The OrgaTEX scenario runs the sync on a short backoff
  (`playwright.failures.config.ts`) so recovery is seen within the run. In
  production the backoff grows to the configured five-minute ceiling.
