---
step: 29
created: 2026-11-11T07:05:00Z
---

# Step 29 — The complete end-to-end test

**The workbook's requirement:** run the project's approved test command,
then the Playwright suite, against the complete scenario; submit the
Playwright report and a video of the run.

## The commands

| Command | What it runs | Result |
|---|---|---|
| `npm test` | Vitest: unit, integration, security and UI component tests | **126 files, 1917/1917 passed** (re-run after Step 30): `STEP-29-unit-tests.txt` |
| `npm run test:e2e` | Playwright against the real product: the Express API (:3100, its own fresh database, seeded operators) and the Vite SPA (:5174), two processes | **1/1 passed** (45 s) |

The Step 28 screenshot capture has its own config (`npm run evidence:step28`)
and is not part of the e2e suite: it needs a fresh world, and B-24187 leaves
the released queue once the suite has weighed it.

## The scenario, step by step

`playwright/e2e-weighing.spec.ts`: one test, one `test.step` per
workbook step, driven **through the UI alone**. The API is touched only to
read back what the UI did.

| Workbook | `test.step` | Asserted |
|---|---|---|
| Open WeighingMS | Open WeighingMS and sign in | sign-in screen; operator chip "R. Karim" |
| (queue) | The batch queue comes from the API | B-24187, B-24188, B-24190, B-24191; B-24187 selectable |
| Select B-24187 → Load Recipe | Select B-24187 | `GET /api/recipe/B-24187` and `POST /api/session/start` answered; crumb; "0/5"; the five names in the rail |
| Blue RSPL → Confirm | Remazol Brill. Blue RSPL — weigh and confirm | the station's component and **3 kg precision** scale; confirm refused before pouring, with its reason; *Simulate dispense*; zone OK on readout and status line; unit g; confirm; DONE; "1/5" |
| Red RB → Confirm | Remazol Red RB — weigh and confirm | as above, "2/5" |
| Yellow RGB → Confirm | Remazol Yellow RGB — weigh and confirm | as above, **confirmed with the F1 key**; "3/5" |
| Sodium Sulphate → Confirm | Sodium Sulphate — weigh and confirm | **32 kg floor** scale bound by the station; unit **kg**; "4/5" |
| Soda Ash → Confirm | Soda Ash — weigh and confirm | 32 kg floor; unit kg |
| Batch Complete → OrgaTEX Write-back | Batch complete | completion view; 5/5; all within tolerance YES; **Written to OrgaTEX CONFIRMED**; released to JET-04. **Read back** `GET /api/batch/B-24187/summary`: `writeBack: CONFIRMED`, 5 of 5 |
| Ticket | The ticket | B-24187 · SO-9931 · Teal 4C · OP-001; a line per component; barcode encodes B-24187; **Print** → job `DONE`, "Printed" |
| (next) | Next batch | **F3** returns to the queue |

## The evidence

| Artefact | What it is |
|---|---|
| `STEP-29-playwright-report/index.html` | The Playwright HTML report; open it in a browser. Each `test.step` is listed with its duration; the video is attached |
| `STEP-29-playwright-report/results.json` | The machine-readable result: `expected: 1, unexpected: 0, flaky: 0` |
| `STEP-29-e2e-video.webm` | The full run, recorded at 1440×1000 |
| `STEP-29-unit-tests.txt` | The `npm test` summary |

**The video is `.webm`, not `.mp4`.** Playwright records WebM, and this
machine has no full ffmpeg to transcode it (Playwright's bundled ffmpeg
writes only WebM). It plays in any browser; an `.mp4` needs
`ffmpeg -i STEP-29-e2e-video.webm STEP-29-e2e-video.mp4` on a machine
with ffmpeg.
