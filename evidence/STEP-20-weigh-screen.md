---
step: 20
captured: 2026-11-11
backfill: true
source: playwright/evidence/step20-weigh-screen.spec.ts (fresh product)
---

# Step 20 — Implement the Weighing Screen

> **Backfilled evidence.** The weigh view was built by bolts 025–029;
> this capture is from a fresh product. Each element the workbook lists
> was checked on the live page.

| Workbook element | On the weigh view | Shows |
|---|---|---|
| Component | yes | Remazol Brill. Blue RSPL |
| Code | yes | DYE-1180 · Lot 2026-0341 · Container C-09 · Tare 214.0 g |
| Lot | yes | Lot 2026-0341 |
| Container | yes | Container C-09 |
| Tare | yes | Tare 214.0 g |
| Scale Selected | yes | SCALE SELECTED 3 kg precision |
| Weighed Now | yes | 1242.4g |
| Still To Weigh | yes | 0.0g |
| Target | yes | 1240.0g |
| Progress | yes | the fill bar, 0 → scale capacity |
| Tolerance | yes | TOLERANCE ±6.0 g (1234.0 – 1246.0) |
| Status | yes | WITHIN TOLERANCE — Settling |
| OK | yes | OK · Confirm (F1), enabled in tolerance |
| Re-tare | yes | Re-tare (F2) |
| Quit | yes | Quit (F4) |
| Supervisor Override | yes | shown; enabled only while OVER (ADR-047) |

Every listed element is present.

The first capture of this step (before bolt 031) found Lot, Container and
Tare missing; bolt 031 added the Prepare panel, the MES lot retrieval and
the header line, and this capture was re-taken after it.
