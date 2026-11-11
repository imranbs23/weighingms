---
unit: 003-weighing-station
bolt: 030-003-weighing-station
stage: test
status: complete
updated: 2026-11-11T09:05:00Z
---

# Test Report - Weighing Station (bolt 030, the overshoot rule)

## Test Summary

| Category | Passed | Failed | Skipped | Coverage |
|----------|--------|--------|---------|----------|
| Unit + UI (Vitest, whole suite) | 1938 | 0 | 0 | not measured |
| Integration (new: `overshoot-override-api.test.ts`) | 10 | 0 | 0 | - |
| E2E Step 24 (`npm run test:e2e:step24`) | 1 | 0 | 0 | - |
| E2E Step 29 regression (`npm run test:e2e`) | 1 | 0 | 0 | - |
| E2E Step 30 regression (`npm run test:e2e:failures`) | 8 | 0 | 0 | - |

Before this bolt the suite had 1917 tests; it now has 1938. `tsc` passes for
the server and the client.

## Acceptance Criteria Validation

| Story | Criteria | Status |
|-------|----------|--------|
| 004-gate-confirmation-on-zone | OVER cannot be confirmed without an authorised supervisor override | ✅ unit + integration + E2E (F1 and the API both refused) |
| 004-gate-confirmation-on-zone | With one, the weighing is recorded as poured, zone OVER | ✅ integration (quantity = settled reading) + E2E (confirm response, report row) |
| 004-gate-confirmation-on-zone | The override never opens UNDER or NEAR | ✅ unit |
| 004-gate-confirmation-on-zone | A pour heavier than the authorised weight is refused | ✅ integration (mutation-checked: removing the bound makes it fail) |
| 007-escalate-non-compensable-overdose | The override is offered for EVERY over-dose, including a compensable one | ✅ integration (first component, four remain) |
| 007-escalate-non-compensable-overdose | The supervisor's own credentials are required; wrong PIN and the operator's badge get one uniform refusal | ✅ integration + UI + E2E |
| 007-escalate-non-compensable-overdose | Scoped and single-use: another component's authorisation and a reused id are refused | ✅ integration |
| 007-escalate-non-compensable-overdose | Recorded with supervisor, operator and reason | ✅ integration (override record) |
| — (Step 24 decision) | The surplus is shown for information; no proposal, no recalculation | ✅ UI (no `POST /api/surplus`) + E2E (rest of the batch weighed to MES targets) |
| — (Step 24 decision) | Re-tare and re-weigh remains available | ✅ integration (re-tare back into tolerance → ordinary OK path, override cleared) + Step 30 E2E |
| — (Step 24 decision) | The record and the ticket are marked "OVER · overridden" | ✅ UI + E2E (`STEP-24-overshoot-completion.png`) |

## Unit Tests

- `tests/unit/confirmation-gate.test.ts`: 4 new cases. OVER with an
  authorised override → `ALLOWED`, zone `OVER`; the predicate is asked about
  this component at this weight; OVER without it → `ZONE_OVER`; UNDER and
  NEAR stay refused even when the predicate says yes.
- `tests/ui/action-row-rules.test.ts`: 4 new cases. The confirm rule for an
  authorised override; it opens nothing but OVER; an unreachable API still
  wins; **every confirm reason is in the weigh screen's key list** (the
  regression for the bug the E2E run found, below).
- `tests/ui/panels.test.tsx`: rewritten for the new panels. The surplus panel
  is information only (no buttons, factor or revised targets); the override
  panel has no authorisation-id field, needs badge + PIN + reason, clears the
  PIN on refusal, and shows who authorised it.
- `tests/ui/terminal-workflow.test.tsx`: the surplus is read once at rest and
  never proposed; the full override sequence in the weigh screen (the
  authorisation is requested for the escalation's `subject` and its id
  passed straight on); a refused supervisor leaves confirm disabled and
  consumes nothing. Mutation-checked: ignoring `overrideAuthorised` fails it.
- `tests/ui/completion-screen.test.tsx`: an OVER line reads
  `completion.zone.overridden`.

## Integration Tests

`tests/integration/overshoot-override-api.test.ts`, against the real station,
unit 008 and the Dummy scale, with SUP-001 seeded:

1. OVER is refused without an override
2. A compensable over-dose can be escalated, and the escalation carries its `subject`
3. Raising an override when not OVER → `409 NOT_ESCALATABLE / NOT_OVER`
4. Override → confirm `201`, zone `OVER`, the poured quantity, advance to the next component, an override record with supervisor/operator/reason, escalation cleared
5. Wrong PIN → uniform `403`, OVER still refused
6. Operator as supervisor → uniform `403`
7. Authorisation for another component → refused by the escalation
8. A used authorisation id cannot open the gate again
9. A heavier pour after authorisation → `ZONE_OVER`
10. Re-tare back into tolerance → ordinary `OK` confirmation; the unused override is cleared

The existing escalation, surplus-proposal and escalation-security tests pass
unchanged: none of them depended on the compensable refusal.

## Security Tests

Covered in the integration tests above: fresh supervisor credentials, the
`SUPERVISOR` role, one uniform refusal (ADR-004), subject binding, and
single use (ADR-006). `tests/security/escalation-security.test.ts` passes.

## Performance Tests

Not applicable: no new endpoint; one extra in-memory comparison in the gate.

## End-to-end evidence (workbook Step 24)

| File | What it shows |
|---|---|
| `evidence/STEP-24-overshoot-ui.png` | OVER at rest: the surplus for information, the override authorised by SUP-001, **OK · Confirm** enabled with its reason |
| `evidence/STEP-24-overshoot-completion.png` | The batch completed: DYE-4471-B "OVER · overridden" on the detail and the ticket; ticket outcome `OUT_OF_TOLERANCE`; the other four components at their MES targets |
| `evidence/STEP-24-overshoot-test.png` | The Playwright report: every step passed |
| `evidence/STEP-24-playwright-report/` | The full report, with the video |

## Issues Found

| Issue | Severity | Status |
|-------|----------|--------|
| The new confirm reason was not in the weigh screen's locale key list, so the terminal showed the raw key `weigh.confirm.overridden`. Found by the E2E run; no unit test covered it. | Medium | **Fixed**, and a regression test added (fails without the fix) |
| The supervisor's tolerance report shows `overrideCount: 0` after an override. The override record is written (integration test 4), but the report (bolt 023, ADR-046) reads overrides from the **audit trail**, and the escalation path does not write an audit entry. The OVER weighing does appear in the report's failure rows. | Medium | **Open**: outside this bolt's stories; needs a decision (audit the escalation authorisation, or have the report read the override records) |
| The status line still reads "OVER TOLERANCE — Settling" after the override is authorised | Low | Open (cosmetic) |
| Re-running the Step 29 and Step 30 suites rewrote their reports and screenshots; Step 30's `over-tolerance.png` now shows the information-only surplus panel | Info | Expected |

## Ready for Operations

- [x] All acceptance criteria met
- [ ] Code coverage > 80% (not measured in this project)
- [x] No critical/high severity issues open
