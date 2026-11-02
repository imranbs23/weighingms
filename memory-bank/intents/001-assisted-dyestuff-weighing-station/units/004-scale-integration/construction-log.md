---
unit: 004-scale-integration
intent: 001-assisted-dyestuff-weighing-station
created: 2026-10-30T20:50:00Z
last_updated: 2026-10-30T23:50:00Z
---

# Construction Log: 004-scale-integration

## Original Plan

**From Inception**: 2 bolts planned
**Planned Date**: 2026-10-30

| Bolt ID | Stories | Type |
|---------|---------|------|
| `003-004-scale-integration` | 001-receive-live-weight-stream, 002-detect-disconnection-and-block-weighing | ddd |
| `004-004-scale-integration` | 003-tare-scale-against-container, 004-select-scale-by-capacity | ddd |

## Replanning History

| Date | Action | Change | Reason | Approved |
|------|--------|--------|--------|----------|

## Current Bolt Structure

| Bolt ID | Stories | Type | Status |
|---------|---------|------|--------|
| `003-004-scale-integration` | 001-receive-live-weight-stream, 002-detect-disconnection-and-block-weighing | ddd | in-progress (stage: implement) |
| `004-004-scale-integration` | 003-tare-scale-against-container, 004-select-scale-by-capacity | ddd | planned |

## Progress

- **2026-10-30T20:50:00Z**: `003-004-scale-integration` started - Stage 1: model
- **2026-10-30T23:20:00Z**: `003-004-scale-integration` stage-complete - model → design
- **2026-10-30T23:45:00Z**: `003-004-scale-integration` stage-complete - design → adr
- **2026-10-30T23:50:00Z**: `003-004-scale-integration` stage-complete - adr → implement
- **2026-10-31T00:05:00Z**: `003-004-scale-integration` stage-complete - implement → test
- **2026-10-31T00:20:00Z**: `003-004-scale-integration` **COMPLETE** - 114 new tests (454 project total), typecheck clean, all verifiers pass

## Four defects the suite caught

The implementation was NOT clean on the first pass. The tests found four
real defects, all now fixed and covered by regression tests.

1. **`WeightValue` compared at inconsistent scales.** `"93.4"` and
   `"93.40"` are the same quantity but were compared as `934` against
   `9340`. Every comparison involving a trailing zero was wrong,
   including the ramp's own landing check.
2. **Accepting a reading did not bring the link up.** A device that had
   spoken was still reported `DISCONNECTED`, so the weighing gate refused
   every scale that was actually working. This would have blocked all
   weighings.
3. **The watchdog could never trip in the running product.** The Dummy
   adapter produced a reading every 100 ms forever, so the deadline was
   always rescheduled before it could fire. The disconnection path was
   unreachable outside a test with a fake clock — invisible to every test
   that injected its own clock.
4. **The adapter pump leaked.** Readings kept being produced for a
   device with no subscribers, forever.

## The next bolt's starting position

`004-004-scale-integration` (tare, and selection by capacity) builds on
what this bolt established:

- The **selection rule** uses `ScaleCapability` — the class, capacity and
  resolution this bolt provides. The rule itself belongs to bolt 004.
- The **tare operation** changes what the scale reports. It does NOT
  change the link state, the sequence, or the reading's shape — so it
  belongs in the adapter, not in the domain.
- The **Q-03 seam** is the `ScaleAdapter` port. Bolt 004 adds no
  protocol.
- The **`SCALE_DISCONNECTED` gate** already blocks a weighing, so the
  tare flow must consult `ScaleRegistry.canWeigh` rather than the
  device's raw status.

## Notes

This unit carries the build's worst single risk (B-5): the whole product
assumes a continuous ≥ 10 Hz weight stream, and if the real indicators
report only a settled value then guided weighing as drawn is not
buildable. The unit is therefore built so the assumption is **testable
rather than merely stated** — the adapter produces exactly the contract
the product depends on, and the seam is the single place that changes if
FCI's answer to Q-03 is "settled value only".
