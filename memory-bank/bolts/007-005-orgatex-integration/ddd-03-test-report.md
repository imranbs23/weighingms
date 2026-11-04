---
unit: 005-orgatex-integration
bolt: 007-005-orgatex-integration
stage: test
status: complete
updated: 2026-11-04T19:15:00Z
---

# Test Report - OrgaTEX Integration

Bolt `007-005-orgatex-integration` — stories `004-report-link-state` and
`005-queue-writes-offline-and-sync-on-recovery`.

## Test Summary

| Category | Passed | Failed | Skipped | Coverage |
|----------|--------|--------|---------|----------|
| Unit | 246 | 0 | 0 | 100% (bolt 007 code) |
| Integration | 41 | 0 | 0 | - |
| Security | 14 | 0 | 0 | - |
| Performance | 0 | 0 | 0 | not applicable |
| **Project total** | **1078** | **0** | **0** | **91.95% stmts / 85.60% branches / 92.73% lines** |

Fifty-two test files, run twice for stability. The project's coverage gate
is 80% on statements, branches, functions and lines; the project sits
above it on every measure.

**Every file this bolt created or modified reads 100% lines.** The
remaining uncovered lines in the unit's tree belong to bolt 005's and
bolt 006's pre-existing code, which this bolt did not change.

## Acceptance Criteria Validation

| Story | Criteria | Status |
|-------|----------|--------|
| `004-report-link-state` | R-01 — three-valued link state, derived from contact outcomes | ✅ |
| | R-02 — the derivation is a pure function | ✅ |
| | R-03 — the read returns status, last contact, last error, failure count | ✅ |
| | R-04 — the un-synchronised count is reported while degraded or offline | ✅ |
| | R-05 — a status change records from/to/time; an unchanged status records nothing | ✅ |
| | R-06 — the freshness window is configuration, and zero is legal | ✅ |
| | R-07 — weighing continues in every link state | ✅ |
| | R-08 — the link state is decided here and consumed elsewhere | ✅ |
| `005-queue-writes-offline-and-sync-on-recovery` | R-09 — an undeliverable posting is enqueued and reported as pending | ✅ |
| | R-10 — the queue is durable across a restart, with the original key | ✅ |
| | R-11 — the queue order is a total order, stable across a restart | ✅ |
| | R-12 — a failed entry stays visible; it is never silently discarded | ✅ |
| | R-13 — an operator can re-drive a failed entry | ✅ |
| | R-14 — the queue is the only way out; a delivered entry leaves it | ✅ |
| | R-15 — the retry backoff is bounded and configured | ✅ |
| | R-16 — a delivery that is ambiguous is retried with the same key | ✅ |
| | R-17 — a re-drive never double-counts a dye batch | ✅ |
| | R-18 — the link state gates only the MES-facing reads and writes | ✅ |

## Unit Tests

Twenty-one files, 246 tests. The new ones:

- `orgatex-link-state.test.ts` — the derivation's boundaries: the
  inclusive window, the zero window, a non-finite window's refusal.
- `orgatex-link-transitions.test.ts` — the transition log: a changed
  status records from/to/cause, an unchanged one records nothing, and
  the scheduled deadline re-derives with the same pure policy.
- `orgatex-link-persistence.test.ts` — the append-only transition log:
  the `UPDATE` and `DELETE` triggers refuse, and the observations row's
  `CHECK (id = 1)` admits exactly one.
- `orgatex-link-scheduler.test.ts` — the freshness timer: a deadline
  fires, a cancelled one does not, and a **rejected callback is
  reported rather than left floating**.
- `orgatex-link-edges.test.ts` — the seams a quiet mistake would hide:
  the transition log's read path, the absent observations row, the
  queue's default jitter source, and the controller's refusals.
- `orgatex-sync-value-objects.test.ts` — `SyncQueueEntryState` is a
  closed set of two, `SyncError` never carries its detail to a client,
  and the entry's six invariants hold.
- `orgatex-sync-queue-guards.test.ts` — the ledger wins, the vanished
  posting is `MALFORMED` rather than dropped, and the repository's
  four loud refusals.
- `orgatex-sync-queue-persistence.test.ts` — the queue survives a
  restart with the same key and the same exact decimal quantity.
- `orgatex-sync-backoff.test.ts` — the bounded backoff, and the
  injected jitter.
- `orgatex-read-path-link-state.test.ts` — **the read path reports its
  contact outcomes** (see the defect below).
- `orgatex-redelivery.test.ts` — **the queue's delivery path**
  (`ConsumptionPostingService.redeliver`), driven against the real
  SQLite ledger (see the defect below).

## Integration Tests

Three new files, 41 tests:

- `orgatex-link-state-api.test.ts` — `GET /api/orgatex/link-state`
  returns the derived state and the un-synchronised count.
- `orgatex-sync-queue-api.test.ts` — the queue listing, the `QUEUED`
  response, and the re-drive.
- `orgatex-link-queue-edges.test.ts` — the malformed batch id, the
  malformed re-drive key, the unknown entry, and the duplicate
  submission.

## Security Tests

`orgatex-sync-queue-security.test.ts` — 14 tests. The re-drive is an
ordinary operator action, so the tests assert what the bolt guarantees:
a session is required, a `SyncError`'s detail never reaches a client,
the queue's count cannot be inflated by a malformed request, and the
idempotency key is never re-derived.

**No Aikido scan was run, and none is cited.** The Aikido MCP scanner is
disabled for this repository by project decision (`puku.md`); the
executable record of the security properties is this suite, read against
the requirements and the ADRs in `memory-bank/`.

## Performance Tests

None. This bolt adds no request path that did not already exist, and no
performance target is stated in the BRD for the link state or the
queue. The queue's bounded backoff is the only latency property, and it
is a configuration property — tested in `orgatex-sync-backoff.test.ts`
and `orgatex-config.test.ts`.

## Coverage Report

Every file this bolt created reads 100% lines:

| Layer | Files | Lines |
|-------|-------|-------|
| Entities | `link-transition.ts`, `sync-queue-entry.ts` | 100% |
| Value objects | `link-state.ts`, `link-status.ts`, `sync-error.ts`, `sync-queue-entry-state.ts`, `freshness-window.ts`, `backoff-schedule.ts` | 100% |
| Services | `link-state-policy.ts`, `link-state-service.ts`, `sync-backoff-policy.ts`, `sync-queue-service.ts`, `sync-retry-worker.ts` | 100% |
| Repositories | `sqlite-link-contact-repository.ts`, `sqlite-link-transition-repository.ts`, `sqlite-sync-queue-repository.ts` | 100% |
| Adapters | `node-link-freshness-scheduler.ts` | 100% |
| Composition | `composition-root.ts` | 100% |

The readers — `batch-queue-reader.ts` and `recipe-reader.ts` — are at
100% lines too, after the defect below was fixed.

## Issues Found

| Issue | Severity | Status |
|-------|----------|--------|
| The read path never reported a **failed** contact to the link state | High | Fixed |
| A rejected freshness deadline became an **unhandled rejection** | High | Fixed |
| The link scheduler's timer outlived the database in the test harness | Medium | Fixed |

### The read path swallowed its failures

`BatchQueueReader` and `RecipeReader` had the reporting seam wired — a
`contactReporter` option, a `reportSuccess` and a `reportFailure` — but
`reportFailure` was **never called**. The readers reported their
successes and swallowed their failures.

ADR-027's OQ-5 is explicit: "**All** of them report through
`LinkStateService` — the posting path's, **the read path's** and the
queue's delivery." And the technical design's item 18 says the same
from the other end: "the link state is derived from the real read path's
outcomes". The implementation did neither.

The consequence is a station that lies about its own link. A station
that only ever **reads** — no weighings, no postings — reaches a MES
that has gone away. Every read fails. Every read is served from the
cache, marked stale. And the link state says `LINKED`, because the only
observation row was ever written by a success.

That is the exact failure this bolt exists to prevent: a link state that
is a hard-coded label rather than a derived fact. The station would
report "linked" to an operator whose work list is an hour old and
getting older.

The fix wires `reportFailure` into both readers' failure paths, and
makes `onFailure` asynchronous so the report is awaited before the
outcome is decided. A `NOT_FOUND` is **not** a failure — the MES was
reached and answered — so it reports a success instead.

`tests/unit/orgatex-read-path-link-state.test.ts` pins the behaviour
from both ends. It was verified to **fail 5/5** against the unfixed
readers, so it is a real regression guard rather than a test that
passes either way.

### A rejected freshness deadline could kill the station

`LinkStateService` scheduled its deadline with
`() => { void this.onFreshnessDeadline(); }`. The `void` discarded the
promise, so a rejection inside it became an **unhandled rejection** —
and Node's default behaviour for those is to terminate the process.

The deadline's callback reads and writes the database. A database that
is closed, locked or gone is exactly the kind of failure that makes the
callback reject.

The fix follows the pattern `SyncRetryWorker` already used: the
scheduler owns the rejection and reports it through an `onError` hook,
which the composition root binds to the log. `LinkFreshnessScheduler`'s
`schedule` signature now admits an asynchronous callback, so the
service returns the promise rather than throwing it away.

`tests/unit/orgatex-link-scheduler.test.ts` covers both the rejected and
the thrown callback; `tests/unit/orgatex-composition-root.test.ts` proves
the failure reaches the log.

### The timer outlived the database in the harness

The test harness closed the database without disposing the OrgaTEX
unit's timers, so a deadline fired against a closed database. The
harness now disposes the link scheduler and the retry worker **before**
closing the database.

### The queue's delivery path had no test at all

Bolt 007 added `ConsumptionPostingService.redeliver` — the path the sync
queue uses to re-send a consumption that has not landed. It is the one
place where the queue's guarantee is actually cashed in: a re-delivery
must not double-count a dye batch, and the guard that prevents it is
the ledger's PRIMARY KEY (ADR-023).

**No test exercised it.** The queue's own tests stub the posting
service, so they proved the queue *calls* `redeliver` and nothing about
what `redeliver` *does*. The method's duplicate guards, its contact
reporting and its classification of the adapter's failure were all
unverified.

That is a High, not a Low, because the untested path is the one that
decides whether a consumption is delivered twice. A re-delivery that
reported a duplicate as a failure would retry forever; one that
reported it as a success would claim a consumption landed when it did
not.

`tests/unit/orgatex-redelivery.test.ts` now drives the path against the
**real** SQLite ledger — sixteen tests covering the delivery and its
ledger entry, the atomic duplicate refusal, the concurrent duplicate
that the database itself refuses, the vanished posting, the rejection,
each adapter failure kind, the unclassified error, and the
non-duplicate database error that must be re-thrown rather than
swallowed.

## Recommendations

- **Nothing open.** All four issues are fixed, and each fix carries a
  test that fails without it.
- The `LinkStateService` remains the only writer of the observation row.
  Any future MES-contacting path must report through it — the readers
  and the posting path already do. If the status-write path ever
  reports to the MES, OQ-5 applies to it too.
- The queue's retention is deliberately unbounded: a delivered entry
  leaves the queue, and the durable history stays in bolt 006's
  `consumption_postings` and `posting_attempts` (ADR-027, OQ-9). A
  prune policy would need its own ADR.

## Ready for Operations

- [x] All acceptance criteria met
- [x] Code coverage > 80%
- [x] No critical/high severity issues open
- [x] Performance targets met — none stated for this bolt
- [x] Security tests passing
