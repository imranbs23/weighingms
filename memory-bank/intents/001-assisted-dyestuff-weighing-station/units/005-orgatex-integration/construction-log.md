---
unit: 005-orgatex-integration
intent: 001-assisted-dyestuff-weighing-station
created: 2026-11-02T18:05:00Z
last_updated: 2026-11-02T22:40:00Z
---

# Construction Log: 005-orgatex-integration

## Original Plan

**From Inception**: 3 bolts planned
**Planned Date**: 2026-10-30

| Bolt ID | Stories | Type |
|---------|---------|------|
| `005-005-orgatex-integration` | 001-read-released-batch-queue, 002-read-batch-recipe | ddd |
| `006-005-orgatex-integration` | 003-post-consumption-idempotently | ddd |
| `007-005-orgatex-integration` | 004-report-link-state, 005-queue-writes-offline-and-sync-on-recovery | ddd |

## Replanning History

| Date | Action | Change | Reason | Approved |
|------|--------|--------|--------|----------|

## Current Bolt Structure

| Bolt ID | Stories | Type | Status |
|---------|---------|------|--------|
| `005-005-orgatex-integration` | 001-read-released-batch-queue, 002-read-batch-recipe | ddd | complete |
| `006-005-orgatex-integration` | 003-post-consumption-idempotently | ddd | complete |
| `007-005-orgatex-integration` | 004-report-link-state, 005-queue-writes-offline-and-sync-on-recovery | ddd | complete |

## Progress

- **2026-11-02T18:05:00Z**: `005-005-orgatex-integration` started - Stage 1: model
- **2026-11-02T18:20:00Z**: `005-005-orgatex-integration` stage-complete - model → design
- **2026-11-02T18:45:00Z**: `005-005-orgatex-integration` stage-complete - design → adr
- **2026-11-02T19:00:00Z**: `005-005-orgatex-integration` stage-complete - adr → implement (ADR-020, ADR-021, ADR-022)
- **2026-11-02T19:30:00Z**: `005-005-orgatex-integration` stage-complete - implement → test
- **2026-11-02T19:45:00Z**: `005-005-orgatex-integration` stage-complete - test → complete (712 tests, 114 new)
- **2026-11-02T20:05:00Z**: `006-005-orgatex-integration` started - Stage 1: model
- **2026-11-02T20:35:00Z**: `006-005-orgatex-integration` stage-complete - model → design
- **2026-11-02T21:10:00Z**: `006-005-orgatex-integration` stage-complete - design → adr
- **2026-11-02T21:50:00Z**: `006-005-orgatex-integration` stage-complete - adr → implement (ADR-023, ADR-024, ADR-025, ADR-026)
- **2026-11-02T22:20:00Z**: `006-005-orgatex-integration` stage-complete - implement → test
- **2026-11-02T22:40:00Z**: `006-005-orgatex-integration` stage-complete - test → complete (860 tests, 146 new)

## Verification

- Typecheck: clean.
- Tests: **1094 pass** across 53 files — 860 before bolt 007, plus 234 new
  (the link state, the durable sync queue and the read path's contact
  reporting).
- `verify:adrs` — all 27 ADRs well-formed, the index agrees.
- `verify:frontmatter`, `verify:fr-refs`, `verify:inception`,
  `verify:requirements`, `verify:implementation` — all pass.
- Coverage: **93.18% lines / 86.80% branches** across the project (gate 80%).
  Every line and branch **bolt 007 added** is covered — the check was made
  against the staged diff, so bolt 006's uncovered lines are not counted
  against this bolt.
- **Aikido security scan**: not run. The Aikido MCP scanner is **disabled for
  this repository** by project decision (`puku.md`), which overrides the
  global instruction to scan generated or modified code. The security review
  is manual, against the requirements and the ADRs, and the executable record
  is `tests/security/orgatex-sync-queue-security.test.ts` (14 tests).

### The four defects bolt 007's tests found

1. **The read path swallowed its failed contacts.** `BatchQueueReader` and
   `RecipeReader` reported their successes but never their failures, so a
   read-only station whose MES had died reported `LINKED` — exactly the
   "hard-coded label rather than a derived fact" failure the bolt exists to
   prevent. ADR-027's OQ-5 and the design's item 18 both required the read
   path to report; the implementation did neither.
2. **A rejected freshness deadline could kill the station.** The deadline's
   callback was invoked as `void this.onFreshnessDeadline()`, so a rejection
   became an unhandled rejection — and Node terminates the process on those.
3. **The test harness closed its database before disposing the unit's
   timers**, so a deadline fired against a closed database.
4. **The queue's delivery path (`redeliver`) had no test at all.** The
   queue's own tests stub the posting service, so they proved the queue
   *calls* `redeliver` and nothing about what it *does* — and it is the one
   place where the queue's "no double-count" guarantee is cashed in.

Each fix carries a test that fails without it; the read-path test was
verified to fail 5/5 against the unfixed readers, and the redelivery
tests drive the real SQLite ledger so the atomic duplicate refusal is
proved by the database rather than by a stub.

## Notes

This unit is the **IR-07 seam** — the single adapter through which WeighingMS
talks to the MES. It carries the project's largest unanswered questions
(`A-01`, `A-02`, `Q-01`, `Q-02`), and the whole unit is structured so that a
wrong assumption about the MES contract costs exactly one unit.
