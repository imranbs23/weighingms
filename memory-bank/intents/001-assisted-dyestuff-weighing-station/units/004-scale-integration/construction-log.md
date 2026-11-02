---
unit: 004-scale-integration
intent: 001-assisted-dyestuff-weighing-station
created: 2026-10-30T20:50:00Z
last_updated: 2026-10-31T03:55:00Z
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
| `003-004-scale-integration` | 001-receive-live-weight-stream, 002-detect-disconnection-and-block-weighing | ddd | complete |
| `004-004-scale-integration` | 003-tare-scale-against-container, 004-select-scale-by-capacity | ddd | in-progress (stage: adr) |

## Progress

- **2026-10-30T20:50:00Z**: `003-004-scale-integration` started - Stage 1: model
- **2026-10-30T23:20:00Z**: `003-004-scale-integration` stage-complete - model → design
- **2026-10-30T23:45:00Z**: `003-004-scale-integration` stage-complete - design → adr
- **2026-10-30T23:50:00Z**: `003-004-scale-integration` stage-complete - adr → implement
- **2026-10-31T00:05:00Z**: `003-004-scale-integration` stage-complete - implement → test
- **2026-10-31T00:20:00Z**: `003-004-scale-integration` **COMPLETE** - 114 new tests (454 project total), typecheck clean, all verifiers pass
- **2026-10-31T01:05:00Z**: `004-004-scale-integration` started - Stage 1: model
- **2026-10-31T02:15:00Z**: `004-004-scale-integration` stage-complete - model → design
- **2026-10-31T03:50:00Z**: `004-004-scale-integration` stage-complete - adr (ADR-014 … ADR-019, six decisions)

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

## Bolt 004 — the six ADRs

Three decide the **tare**, three decide the **selection**. The decision
index now carries 19 entries.

### The tare

- **ADR-014 — The tare is applied at the device, and the reading carries
  it.** The tare is applied once but persists into every subsequent
  reading, so a consumer subtracting it from its own copy would have to
  know whether the device already did — and would double-subtract when a
  second consumer attached mid-session. The reading the device emits is
  **net** and carries the tare that produced it.
- **ADR-015 — The tare is never persisted.** A stale tare read back
  after a restart is a **wrong number**: the scale reports net weight
  against a container that is no longer on it. No `TareRepository`, no
  `scale_devices` column, no migration.
- **ADR-016 — The net reading floors at zero.** A gross reading below the
  tare (empty container removed from a scale zeroed against it) would
  produce a negative dispensed quantity, which is not a thing. The clamp
  is at the adapter, so the negative number is never produced.

### The selection

- **ADR-017 — The capacity constraint wins over the scale-class
  demand.** A 4 kg component demanding precision cannot be weighed on a
  3 kg scale; honouring the class would mean it could never be weighed
  at all. The floor scale is selected and the conflict is recorded in the
  reason.
- **ADR-018 — "No device can weigh this" is a successful outcome, not an
  error.** `200` with `selected: false`, and a discriminated union in the
  domain so a caller cannot read a `scaleId` without proving one was
  selected.
- **ADR-019 — The selection threshold is configuration, and is unset
  until FCI answers.** `Q-04` is open; the capacity constraint already
  produces every outcome the story names, so the threshold slot exists
  and is `null`. Answering `Q-04` is a configuration change.

## Bolt 004 — the implementation

The six ADRs are implemented. The tare is applied at the device, the net
reading floors at zero, and the selection rule is a pure function over
the registered devices.

### What was built

**Domain — the tare.** `TareState` is a member of the `ScaleDevice`
aggregate, because a tare means nothing without the device it belongs to.
`TareSource` (`CONTAINER_MASTER` / `WEIGHED_EMPTY_CONTAINER`) records where
the VALUE came from; `TareMechanism` (`INDICATOR` / `SOFTWARE`) records
where it was APPLIED. They are different facts: a master tare applied in
software is the same source and a different mechanism. `TareApplication`
is a discriminated union, so a refusal carries no new state and a caller
cannot lose the previous tare by mishandling a refusal.

**Domain — the selection.** `ScaleSelectionRule` is pure and reads a SET
of devices plus a configuration — never two hard-coded scales. The
capacity boundary is inclusive (3 kg fits the 3 kg scale), and
`ScaleSelectionOutcome` is a union so a caller cannot read a `scaleId`
without proving one was selected.

**Domain — the conversion.** `WeightUnitConverter` converts exactly, via
`decimal.js`, and refuses an unknown unit rather than assuming grams. A
kilogram tare reaches a gram-reporting device as `1850 g`, never as
`1849.9999999`.

**Ports and adapter.** `ScaleAdapter` gains `applyTare` and `readOnce`.
The training device has no tare command (Q-03), so the tare is applied in
software and the adapter reports `appliedBy: 'SOFTWARE'` (BRD IR-12).

**Registry.** `applyTare` asks the adapter for a reading first — a tare
is a command sent TO a device, and a device that has never spoken cannot
be commanded — then consults the same weighing gate the weighing does,
then converts, then applies. **A refusal changes nothing** (S-14): the
previous tare remains in force and the response says so.

**Presentation.** `GET /api/scales/:scaleId/tare` is open (ADR-013 — a
tare is physically visible at the station). `POST .../tare` and
`POST /api/scales/select` require an operator session: they change what
the station means, so they are writes. The "no device can weigh this"
outcome is `200` with `selected: false`.

### Two decisions the implementation made that the model did not

- **The selection reason set lost `CAPACITY_ONLY`.** With the two
  prototype scales, a 4 kg component demanding precision has exactly ONE
  candidate — the floor scale — because the precision scale cannot hold
  it. The conflict ADR-017 describes therefore arises in the
  single-candidate path, not only in the multi-candidate one. A reason
  that said merely "capacity only" would lose the fact that the demanded
  precision was NOT available, and the loss of precision would be
  invisible in the durable record. The reason set is now
  `CAPACITY_AND_CLASS` / `CLASS_CONFLICT_RESOLVED_BY_CAPACITY` /
  `TARGET_ZERO` — it answers one question: **was the demanded class met?**
- **`readOnce` returns `null` for a silenced device.** A synchronous read
  must make the same distinction the stream makes (S-1): a device that
  has gone away is ABSENT, never present with a reading of zero. A
  silenced device therefore cannot be tare'd, and the refusal names
  `SCALE_DISCONNECTED`.

### A defect found and fixed during the build

`stripTrailingZeros` was returning `"1850.0"` for `"1850.000000"` — the
trailing dot survived the zero-stripping. Three copies of the helper
existed (the converter, the selection rule, the adapter), so the fix went
into all three. The symptom was a kilogram tare arriving at the device
as `1850.0 g` rather than `1850 g`: a wrong number, not a formatting
detail, and exactly the kind of thing the no-floating-point rule exists
to prevent.

### Verification

- Typecheck: clean.
- Tests: **523 pass** across 24 files — 454 before this bolt, plus 69
  new (the tare's domain behaviour, the selection rule, and the API
  boundary).
- `verify:adrs` — all 19 ADRs well-formed, the index agrees.
- `verify:implementation`, `verify:requirements`, `verify:fr-refs`,
  `verify:frontmatter`, `verify:inception` — all pass.
- **Aikido security scan**: 21 changed source files and 4 changed test
  files scanned, **zero issues**, nothing skipped. The scanner was
  validated against a deliberately vulnerable control file first — it
  correctly flagged an `eval()` RCE and a hardcoded secret — so the
  clean result is a real result rather than a silently failing scanner.

## Notes

This unit carries the build's worst single risk (B-5): the whole product
assumes a continuous ≥ 10 Hz weight stream, and if the real indicators
report only a settled value then guided weighing as drawn is not
buildable. The unit is therefore built so the assumption is **testable
rather than merely stated** — the adapter produces exactly the contract
the product depends on, and the seam is the single place that changes if
FCI's answer to Q-03 is "settled value only".
