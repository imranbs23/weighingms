---
id: ddd-03-test-report
bolt: 004-004-scale-integration
unit: 004-scale-integration
intent: 001-assisted-dyestuff-weighing-station
type: test-report
status: complete
created: 2026-11-02T10:35:00Z
completed: 2026-11-02T10:35:00Z
---

# Test Report — 004-004-scale-integration

## Verdict

**PASS.** 598 tests green, 27 files, typecheck clean, coverage above the
80% gate, all six framework verifiers pass, and the Aikido secret scan is
clean across the new code.

One thing did not pass on the first attempt, and it is recorded below
rather than smoothed over: **the bolt's implementation stage shipped code
with no tests, and it dropped the project's branch coverage below its own
80% gate** (81.02% → 78.53%). The gap was closed during this stage with
75 new tests. The bolt is complete; the coverage regression was real, it
was caught by the project's own threshold, and it is fixed.

## What this bolt proves

| Requirement | Obligation | Where proved |
| --- | --- | --- |
| FR-6 | the tare is applied and the reading reflects it | `scale-tare.test.ts`, `scale-tare-api.test.ts` |
| FR-7 | the scale is selected automatically, with no operator input | `scale-selection.test.ts` |
| FR-6 | the tare value, unit and source are available for display | `scale-tare-api.test.ts` |
| BRD FR-19 / IR-12 | a device with no tare command takes a SOFTWARE tare | `scale-tare.test.ts` |
| BRD IR-14 | both scales may be connected concurrently | `scale-selection.test.ts` |
| NFR-16 | no floating point for quantities | `weight-unit-converter.test.ts` |
| ADR-014 | the tare is applied at the device; the reading carries it | `scale-tare.test.ts` |
| ADR-015 | the tare is never persisted | `scale-tare.test.ts` |
| ADR-016 | the net reading floors at zero | `scale-tare.test.ts` |
| ADR-017 | capacity wins over the class demand, and the conflict is recorded | `scale-selection.test.ts` |
| ADR-018 | "no device can weigh this" is a successful outcome | `scale-selection.test.ts` |
| ADR-019 | the threshold is configuration, and is unset | `scale-config.test.ts` |

## The suite

| File | Tests | What it covers |
| --- | --- | --- |
| `tests/unit/scale-tare.test.ts` | 24 | the tare at the device: applied, carried, replaced, floored |
| `tests/unit/scale-selection.test.ts` | 22 | the selection rule: capacity, class, boundary, no-device |
| `tests/integration/scale-tare-api.test.ts` | 23 | the HTTP boundary for the tare and the selection |
| `tests/unit/scale-config.test.ts` | 29 | the configuration, and the unset selection threshold |
| `tests/unit/weight-unit-converter.test.ts` | 22 | the exact conversion, in every supported direction |
| `tests/unit/scale-identifiers.test.ts` | 24 | `ComponentId`, `ScaleId` and `Instant` |
| **New total** | **144** | |
| Pre-existing | 454 | unchanged — still green |
| **Project total** | **598** | 27 files |

## The boundaries that matter

These are tested AT the boundary, because the boundary is where the
requirement bites.

| Boundary | Rule | Result |
| --- | --- | --- |
| A target of exactly 3 kg | within the precision scale's capacity | PASS |
| A target of exactly 32 kg | within the floor scale's capacity | PASS |
| A target of 32.001 kg | no device can weigh this | PASS |
| A 4 kg target demanding precision | the floor scale, and the conflict is recorded | PASS |
| A gross reading of 0 against a 214 g tare | the net reading floors at 0, never −214 | PASS |
| A tare of exactly 0 | recorded with its source, distinct from no tare | PASS |
| A kilogram tare on a gram device | arrives as `214 g`, exactly | PASS |
| `1.850 kg` → grams | `1850 g`, never `1849.9999999 g` | PASS |
| A threshold of `"3000"` with no unit | refused — a bare number is a guess | PASS |
| A threshold of `"three kilos"` | refused, not silently ignored | PASS |
| A tare request without a session | 401 | PASS |
| A tare value sent as a JSON number | 400 | PASS |
| "No device can weigh this" | 200 with `selected: false` | PASS |

## The defect the coverage gate caught

The implementation stage (commit `86880ce`) shipped the bolt's new code
without a test. The project's own threshold caught it — which is exactly
what a threshold is for.

**Branch coverage fell from 81.02% to 78.53%**, below the 80% gate in
`vitest.config.ts`. The new code was the cause:

| Module | Branches before this stage |
| --- | --- |
| `infrastructure/config/scale-config.ts` | 0/17 — entirely untested |
| `domain/value-objects/component-id.ts` | 2/4 |
| `domain/value-objects/instant.ts` | 0/2 |
| `domain/services/weight-unit-converter.ts` | 3/4 |
| `domain/services/scale-selection-rule.ts` | 24/36 |

`scale-config.ts` is the one that matters most. It holds the selection
threshold — the configuration slot ADR-019 created — and it was the module
whose behaviour is hardest to get right by inspection: a threshold that is
`null` rather than `0`, a malformed threshold that must be REFUSED rather
than silently ignored, and a value that must not default to 3000 g merely
because that number coincides with today's precision scale capacity.

Three new test files closed the gap:

- `tests/unit/scale-config.test.ts` — the defaults, the environment
  overrides, the malformed-value refusals, and the unset threshold.
- `tests/unit/weight-unit-converter.test.ts` — the exact conversion in
  every direction, and the trailing-dot case the build already fixed once.
- `tests/unit/scale-identifiers.test.ts` — `ComponentId`, `ScaleId` and
  `Instant`, which bolt 004 created and bolt 003 left unpinned.

**After: 81.96% branches** (550/671), 90.26% statements, 92.53%
functions, 91.37% lines. The gate passes.

## The defects the suite caught during the build

Four were found and fixed during implementation; they are recorded in the
construction log. One more was found in this stage:

### 5. The bolt's own new code was untested

Not a runtime defect but a delivery defect, and the most consequential one
in the bolt. The story's acceptance criteria were all *implemented*, and
the verification that claimed to cover them proved only that the code ran
— not that it was right. `scale-config.ts` could have defaulted the
threshold to 3000 g, or swallowed a malformed value, and every test in the
project would still have passed.

Fixed by 75 new tests across three files, and by the coverage gate that
made the gap visible in the first place.

## What the tests could NOT prove

Stated plainly, because a test report that only lists passes is not honest
about its own limits.

- **The real indicator's protocol.** Q-03 is unanswered. The tests prove
  the *seam* — that a software tare, an exact conversion and a net reading
  are the contract the product depends on — and not that a physical scale
  behaves this way. The training device has no tare command, so the
  `INDICATOR` mechanism is never exercised end to end.
- **The selection threshold's behaviour.** ADR-019 made it configuration
  and left it unset. The rule is proved to work fully without it, and the
  configuration slot is proved to accept a value — but the rule's
  *behaviour when a threshold IS set* is not exercised, because no
  threshold is set. Answering Q-04 is a configuration change plus the
  test that goes with it.
- **A tare applied at the indicator.** `appliedBy: 'INDICATOR'` is a
  shape the domain supports and the training device never produces, so
  the branch that would use it is unproven.
- **The persistence of the selection.** A selection is a decision consumed
  by unit 003. This bolt proves the decision is made correctly; it does
  not prove it survives a restart, because nothing persists it.

## Deviations recorded

The technical design recorded four deviations. The tests confirm each was
implemented as documented, and no fifth deviation was introduced during
implementation.

| Deviation | Confirmed by |
| --- | --- |
| Decimal string on the wire | `scale-tare-api.test.ts` |
| Tare held in memory, never persisted | `scale-tare.test.ts` |
| `decimal.js` added as a dependency | `weight-unit-converter.test.ts` |
| Tare read is unauthenticated, tare write is not | `scale-tare-api.test.ts` |

## How to run it

```
npx tsc --noEmit         # clean
npm test                 # 598 passed (27 files)
npm run test:coverage    # 81.96% branches (gate 80%)
npm run verify:adrs        # 19 ADRs, index agrees
npm run verify:frontmatter # 28 bolts
npm run verify:inception   # 14 artefacts, 38 stories
npm run verify:fr-refs     # 53 files, 38 stories
npm run verify:requirements
npm run verify:implementation
```

## The one thing to read

`tests/unit/scale-selection.test.ts` contains the test `RECORDS the
conflict in the reason`, and beside it `does NOT record a conflict when
the class IS satisfiable`.

Those two are a pair, and the pair is ADR-017. A 4 kg component demands
precision and gets the floor scale — and the reason says so. A component
that gets the precision scale it asked for records no conflict. If the
reason were a constant, or if the conflict were recorded on every
selection, the loss of precision would either be invisible or be
falsely reported — and unit 003 snapshots that reason into the durable
weighing record.
