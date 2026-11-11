---
step: 16
captured: 2026-11-11
backfill: true
source: live probe of http://localhost:3000; route definitions in src/
---

# Step 16 — Build the Dummy Integration Layer

> **Backfilled evidence.** The workbook names no file for this step; it
> names the endpoints. Each read below was called on the running API on
> 2026-11-11; each write is located in the code and NOT called, so this
> check changes no data.

> These are **training contracts**, not claims about the real OrgaTEX
> interface. The brief's open integration questions stay open.

## Reads — probed live

| Service | Workbook endpoint | Probed | Status | First bytes of the answer |
|---|---|---|---|---|
| Dummy OrgaTEX | GET /api/batches | `GET /api/batches` | 200 | `{"batches":[{"batchId":"B-24187","orderRef":"SO-9931","machineRef":"JET-04","fabricDescription":"100% CTN knit` |
| Dummy OrgaTEX | GET /api/batches/:batchId | `GET /api/batches/B-24187` | 200 | `{"batchId":"B-24187","orderRef":"SO-9931","machineRef":"JET-04","fabricDescription":"100% CTN knit · 480 kg","` |
| Dummy OrgaTEX | GET /api/batches/:batchId/recipe | `GET /api/batches/B-24187/recipe` | 200 | `{"batchId":"B-24187","shadeCode":"Teal 4C","components":[{"sequence":1,"componentId":"DYE-4471-B","dyestuffCod` |
| Dummy Scale | GET /api/scales | `GET /api/scales` | 200 | `{"scales":[{"scaleId":"SCALE-A","label":"3 kg precision","class":"PRECISION","capacity":"3000","resolution":"1` |
| Dummy Scale | GET /api/scales/:scaleId/status | `GET /api/scales/SCALE-A/status` | 200 | `{"scaleId":"SCALE-A","label":"3 kg precision","class":"PRECISION","capacity":"3000","resolution":"1","unit":"g` |
| Dummy Scale | GET /api/scales/:scaleId/weight | `GET /api/scales/SCALE-A/weight` | 200 | `event: reading data: {"scaleId":"SCALE-A","value":"0","unit":"g","stable":true,"sequence":420282,"receivedAt":` |
| Dummy Scanner | (not named) | `GET /api/scanner/status` | 200 | `{"state":"READY","source":"DUMMY"}` |
| Dummy Printer | (not named) | `GET /api/printer/status` | 200 | `{"state":"READY","reason":null,"source":"DUMMY"}` |

## Writes — located in the code, not called

| Service | Workbook endpoint | Defined at |
|---|---|---|
| Dummy OrgaTEX | POST /api/batches/:batchId/consumption | `src/005-orgatex-integration/presentation/controllers/dummy-orgatex-controller.ts:106` |
| Dummy Scale | POST /api/scales/:scaleId/tare | `src/004-scale-integration/presentation/controllers/scale-controller.ts:266` |
| Dummy Printer | POST /api/tickets | `src/006-ticket-printing/presentation/controllers/ticket-controller.ts:58` |
| Dummy Scanner | (not named) a scan: POST /api/selection { code } | `src/001-batch-management/presentation/controllers/batch-selection-controller.ts:102` |

Their behaviour is exercised by the integration suite and by the Step 29
and Step 30 end-to-end runs.
