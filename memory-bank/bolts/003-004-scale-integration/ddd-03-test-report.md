---
id: ddd-03-test-report
bolt: 003-004-scale-integration
unit: 004-scale-integration
intent: 001-assisted-dyestuff-weighing-station
type: test-report
status: complete
created: 2026-10-31T00:20:00Z
completed: 2026-10-31T00:20:00Z
---

# Test Report — 003-004-scale-integration

## Verdict

**PASS.** 454 tests green, 21 files, typecheck clean, all six framework
verifiers pass, and the Aikido secret scan is clean across the new code.

## What this bolt proves

| Requirement | Obligation | Where proved |
| --- | --- | --- |
| IR-10 | continuous live-weight stream at ≥ 10 Hz | `scale-stream.test.ts` |
| IR-11 | a reading carries a stability flag | `scale-domain.test.ts` |
| IR-13 | disconnection detected within 2 s | `scale-registry.test.ts` |
| FR-6 | the stream is live, not polled | `scale-stream.test.ts` |
| FR-7 | weighing prevented on a disconnected scale | `scale-health-policy` tests |
| FR-11 | a confirmed weight is not written by this unit | `scale-persistence.test.ts` |
| NFR-01 | transport within 200 ms | `scale-stream.test.ts` |
| NFR-16 | no floating point for quantities | `scale-domain.test.ts` |

## The suite

| File | Tests | What it covers |
| --- | --- | --- |
| `tests/unit/scale-domain.test.ts` | 50 | the pure domain: every invariant, every boundary |
| `tests/integration/scale-registry.test.ts` | 17 | the single path into the domain, the watchdog, the gap facts |
| `tests/integration/scale-api.test.ts` | 12 | the HTTP boundary and the training controls |
| `tests/integration/scale-stream.test.ts` | 7 | the SSE contract, read from the raw frames |
| `tests/integration/scale-persistence.test.ts` | 12 | the schema, the append-only gaps, the absent weight table |
| `tests/security/scale-security.test.ts` | 16 | the guarded controls, the validated bodies, the named reasons |
| **New total** | **114** | |
| Pre-existing (identity unit) | 340 | unchanged — still green |
| **Project total** | **454** | 21 files |

## The boundaries that matter

These are tested AT the boundary, because the boundary is where the
requirement bites.

| Boundary | Rule | Result |
| --- | --- | --- |
| Exactly 2000 ms of silence | the link is still UP | PASS |
| 2001 ms of silence | the link is DOWN | PASS |
| A repeated sequence | rejected | PASS |
| A lower sequence (device restarted) | rejected, stays DISCONNECTED | PASS |
| `"93.4"` vs `"93.40"` | equal — the same quantity | PASS |
| `"-1.5"` vs `"-2"` | `-1.5` is the greater | PASS |
| `"1e3"` | rejected — a float's notation | PASS |
| A JSON number where a string is required | rejected at the boundary | PASS |
| A body over 16 kB | rejected without disclosing why | PASS |

## What the tests caught

Four defects were found by the suite during this stage. All were fixed
and all are now covered by a regression test.

### 1. `WeightValue` compared values at inconsistent scales

`"93.4"` and `"93.40"` are the same quantity, but each was scaled by its
own fraction length — so `934` was compared against `9340` and the
values came out different. Every comparison between a value with a
trailing zero and one without was wrong, including the ramp's own
landing check.

Fixed by scaling both values to a **common** number of decimal places
before comparing. The test that caught it is
`compares values with different fractions correctly`.

### 2. Accepting a reading did not bring the link up

`ScaleDevice.acceptReading` stored the reading but left the link at
`UNKNOWN`. A device that had spoken was still reported as
`DISCONNECTED`, so the weighing gate refused every scale that was
actually working.

This was a genuine product defect, not a test artefact: the gate would
have blocked all weighings.

Fixed by having `acceptReading` bring the link up. There is deliberately
no other path that can do so — a reading is the only evidence that a
device is present (S-1).

### 3. The watchdog could never trip in the running product

The Dummy adapter produced a reading every 100 ms forever. The watchdog
deadline was therefore always rescheduled before it could fire, so the
disconnection path was **unreachable outside a test with a fake clock**.
The training control that silences a scale would have appeared not to
work at all.

This is the defect that mattered most, because it was invisible to every
test that used an injected clock.

Fixed by giving the adapter a real silence state: a silenced device
yields **nothing** — not a reading of zero — and the registry's training
control silences the adapter as well as setting the link state. The
sequence number is not consumed while silenced, so the readings that
follow are still strictly greater (S-3).

### 4. The adapter pump leaked

The adapter's stream kept producing readings for a device with no
subscribers, forever. A long-running station would accumulate that.

Fixed by stopping the pump when the last subscriber leaves.

## What the tests could NOT prove

Stated plainly, because a test report that only lists passes is not
honest about its own limits.

- **The real indicator's protocol.** Q-03 is unanswered. The tests
  prove the *seam* — that a continuous stream at ≥ 10 Hz is what the
  product depends on — and not that a physical scale behaves this way.
  If the indicators report only a settled value, the reading rate drops
  to one per settle and the guided-weighing assumption fails. That is
  B-5, and it remains open.
- **The 2 s detection latency under real load.** The boundary is proved
  exactly, with an injected clock. The latency on a loaded machine is
  not proved, because the test controls the clock.
- **The persistence of a gap across a restart.** The gap facts are
  proved append-only within a process; the repository reads them back
  correctly, but no test restarts the process against a populated file.

## Deviations recorded

Four deviations were recorded in the technical design. The tests
confirm each was implemented as documented, and no fifth deviation was
introduced during implementation.

| Deviation | Confirmed by |
| --- | --- |
| Decimal string on the wire | `scale-stream.test.ts`, `scale-api.test.ts` |
| Registry persisted, not in-memory | `scale-persistence.test.ts` |
| `decimal.js` added as a dependency | `DispenseRamp` tests |
| Telemetry endpoints unauthenticated | `scale-security.test.ts` |

## How to run it

```
npm run typecheck          # clean
npm test                   # 454 passed (21 files)
npm run verify:adrs        # 13 ADRs, index agrees
npm run verify:frontmatter # 28 bolts
npm run verify:inception   # 14 artefacts, 38 stories
npm run verify:fr-refs     # 53 files, 38 stories
```

## The one thing to read

`tests/integration/scale-stream.test.ts` contains the test
`NEVER emits a reading event for a SILENCED device`, and beside it
`DOES emit a reading of zero for a device that is PRESENT and reading
zero`.

Those two are a pair, and the pair is the requirement. A scale that is
absent must produce **no reading**; a scale that is present and
happens to read 0 g must produce a reading. Collapsing the two would
tell the operator to keep pouring into a scale that is not there.
