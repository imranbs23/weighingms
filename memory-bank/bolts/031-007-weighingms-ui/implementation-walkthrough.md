---
stage: implement
bolt: 031-007-weighingms-ui
created: 2026-11-11T12:30:00Z
---

# Implementation Walkthrough: Lot, Container and Tare (Bolt 031)

Option **A** (prompted, optional), confirmed by the project owner at the
plan checkpoint: confirm does not wait for the lot or the container.

## Server — unit 003 composition (units 002 and 008 unchanged)

| File | Change |
|---|---|
| `src/003-weighing-station/infrastructure/composition-root.ts` | New options `lots` and `assignments` (unit 002's repositories, read only, `Pick<…, 'latestFor'>`) and `sourceLot`. One helper, `capturesFor(componentId)`, returns the lot and container **captured at or after the session's `startedAt`**; an earlier capture is ignored. `ConfirmComponent` now reads `lotNumber` and `containerId` through it (they were hard-wired to `null`). `startSession` asks the MES for the component's lot (`sourceLot`) when this session has none yet. The module exposes `capturesFor`. |
| `src/003-weighing-station/application/use-cases/confirm-component.ts` | `lotNumber` and `containerId` may be async, and are awaited. |
| `src/003-weighing-station/presentation/controllers/session-controller.ts` | `GET /api/session` adds `activeCaptures: { lot, container }` for the active component, from `capturesFor`. |
| `src/api/server.ts`, `tests/harness.ts` | Pass `recipes.lots`, `recipes.assignments`, and `sourceLot` → `recipes.captureMaterialLot.captureFromSource`. |

## Terminal — unit 007

| File | Change |
|---|---|
| `screens/weigh/PreparePanel.tsx` (new) | Lot and Container fields for the active component. Enter sends a SCAN (`code`), the button a KEYED value; the server derives the method (ADR-030). Hidden once both are captured. |
| `screens/weigh/components.tsx` | `WeighHead` shows "code · Lot … · Container … · Tare … g" with only the captured parts. |
| `screens/weigh/WeighScreen.tsx` | Reads lot, container and tare from `session.activeCaptures`, not unit 002's unscoped reads (removed). Capture handlers map the server's codes to locale messages. |
| `api/endpoints.ts` | `captureLot`, `assignContainer`, and the `activeCaptures` type. |
| `006-ticket-printing/locales/en.json` | 14 strings (`weigh.head.*`, `weigh.prepare.*`), all registered in the screen's key list. |

## Deviations from the approved plan

1. **Added: the MES lot is retrieved automatically.** Story 002-003's first
   criterion (*"a component whose lot is held by OrgaTEX … is retrieved …
   with the capture method `SOURCE`"*) was built in bolt 011 but never
   called outside tests. The Dummy OrgaTEX holds lots for the three dyes, so
   the station now retrieves them as each component is prepared. Unit 002 is
   not changed; it is only wired.
2. **Dropped: the "Fill sample lot and container" training button.** The
   client may not hold fixture data (the client-source test refuses a lot
   such as `2026-0387`), so the button would need a new server training
   endpoint. With the MES lots retrieved automatically, the operator types
   only a container (and a lot for the two auxiliaries), so the button was
   not worth an endpoint.

## Verified so far

- `tsc` (server and client) passes.
- Vitest: **1944 / 1944** (6 new in `tests/integration/lot-and-container-api.test.ts`; the earlier-session filter mutation-checked).
- The Step 20 capture, re-run against a fresh product: all 16 workbook elements present.
