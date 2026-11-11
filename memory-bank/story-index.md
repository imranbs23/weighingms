# Global Story Index

## Overview

- **Total stories**: 38
- **Generated**: 38
- **Completed**: 38
- **Last updated**: 2026-11-08T13:39:30Z

> This file is **generated** by `scripts/build-story-index.cjs` from the
> story files on disk. Edit the story files, not this one.

---

## Stories by Intent

### 001-assisted-dyestuff-weighing-station

#### `001-batch-management` — Batch Management

- [x] **001-retrieve-released-batch-queue** (001): Retrieve released batch queue - Must - ✅ COMPLETED
- [x] **002-filter-batch-queue-by-status** (001): Filter batch queue by status - Must - ✅ COMPLETED
- [x] **003-select-batch-and-record-identity** (001): Select batch and record identity - Must - ✅ COMPLETED

#### `002-recipe-material-management` — Recipe & Material Management

- [x] **001-retrieve-recipe-and-component-list** (002): Retrieve recipe and component list - Must - ✅ COMPLETED
- [x] **002-verify-dyestuff-identity-by-scan-or-attestation** (002): Verify dyestuff identity by scan or attestation - Must - ✅ COMPLETED
- [x] **003-capture-and-validate-dyestuff-lot** (002): Capture and validate dyestuff lot - Must - ✅ COMPLETED
- [x] **004-assign-container-and-apply-tare** (002): Assign container and apply tare - Must - ✅ COMPLETED

#### `003-weighing-station` — Weighing Station

- [x] **001-select-scale-automatically** (003): Select scale automatically - Must - ✅ COMPLETED
- [x] **002-consume-live-weight-stream** (003): Consume live weight stream - Must - ✅ COMPLETED
- [x] **003-evaluate-tolerance-zone** (003): Evaluate tolerance zone - Must - ✅ COMPLETED
- [x] **004-gate-confirmation-on-zone** (003): Gate confirmation on zone - Must - ✅ COMPLETED
- [x] **005-detect-overdose-and-calculate-surplus** (003): Detect overdose and calculate surplus - Must - ✅ COMPLETED
- [x] **006-apply-surplus-compensation** (003): Apply surplus compensation - Must - ✅ COMPLETED
- [x] **007-escalate-non-compensable-overdose** (003): Escalate non compensable overdose - Must - ✅ COMPLETED
- [x] **008-advance-to-next-component** (003): Advance to next component - Must - ✅ COMPLETED
- [x] **009-complete-batch-and-summarise** (003): Complete batch and summarise - Must - ✅ COMPLETED

#### `004-scale-integration` — Scale Integration

- [x] **001-receive-live-weight-stream** (004): Receive live weight stream - Must - ✅ COMPLETED
- [x] **002-detect-disconnection-and-block-weighing** (004): Detect disconnection and block weighing - Must - ✅ COMPLETED
- [x] **003-tare-scale-against-container** (004): Tare scale against container - Must - ✅ COMPLETED
- [x] **004-select-scale-by-capacity** (004): Select scale by capacity - Must - ✅ COMPLETED

#### `005-orgatex-integration` — OrgaTEX Integration

- [x] **001-read-released-batch-queue** (005): Read released batch queue - Must - ✅ COMPLETED
- [x] **002-read-batch-recipe** (005): Read batch recipe - Must - ✅ COMPLETED
- [x] **003-post-consumption-idempotently** (005): Post consumption idempotently - Must - ✅ COMPLETED
- [x] **004-report-link-state** (005): Report link state - Must - ✅ COMPLETED
- [x] **005-queue-writes-offline-and-sync-on-recovery** (005): Queue writes offline and sync on recovery - Must - ✅ COMPLETED

#### `006-ticket-printing` — Ticket, Printing, Audit & Configuration

- [x] **001-generate-weighing-ticket** (006): Generate weighing ticket - Must - ✅ COMPLETED
- [x] **002-print-ticket-and-track-job** (006): Print ticket and track job - Must - ✅ COMPLETED
- [x] **003-reprint-ticket-with-reason** (006): Reprint ticket with reason - Must - ✅ COMPLETED
- [x] **004-record-and-export-audit-trail** (006): Record and export audit trail - Must - ✅ COMPLETED
- [x] **005-change-configuration-and-language** (006): Change configuration and language - Must - ✅ COMPLETED
- [x] **006-report-on-tolerance-failures-and-overrides** (006): Report on tolerance failures and overrides - Should - ✅ COMPLETED

#### `007-weighingms-ui` — WeighingMS UI

- [x] **001-select-batch-from-queue** (007): Select batch from queue - Must - ✅ COMPLETED
- [x] **002-watch-live-weight-and-tolerance-zone** (007): Watch live weight and tolerance zone - Must - ✅ COMPLETED
- [x] **003-confirm-weighing-and-advance** (007): Confirm weighing and advance - Must - ✅ COMPLETED
- [x] **004-review-and-print-ticket** (007): Review and print ticket - Must - ✅ COMPLETED
- [x] **005-show-peripheral-degraded-states** (007): Show peripheral degraded states - Must - ✅ COMPLETED

#### `008-operator-identity` — Operator Identity

- [x] **001-sign-in-at-terminal** (008): Sign in at terminal - Must - ✅ COMPLETED
- [x] **002-authorise-privileged-action-as-supervisor** (008): Authorise privileged action as supervisor - Must - ✅ COMPLETED

---

## Stories by Unit

| Unit | Stories | Must | Should | Could |
|------|---------|------|--------|-------|
| `001-batch-management` | 3 | 3 | 0 | 0 |
| `002-recipe-material-management` | 4 | 4 | 0 | 0 |
| `003-weighing-station` | 9 | 9 | 0 | 0 |
| `004-scale-integration` | 4 | 4 | 0 | 0 |
| `005-orgatex-integration` | 5 | 5 | 0 | 0 |
| `006-ticket-printing` | 6 | 5 | 1 | 0 |
| `007-weighingms-ui` | 5 | 5 | 0 | 0 |
| `008-operator-identity` | 2 | 2 | 0 | 0 |
| **Total** | **38** | **37** | **1** | **0** |

---

## Stories by Status

- **Planned**: 0
- **Generated**: 0
- **In Progress**: 0
- **Completed**: 38
