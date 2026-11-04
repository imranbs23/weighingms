/**
 * The sync queue's value objects (bolt 007).
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE SMALL TYPES THAT CARRY THE BOLT'S INVARIANTS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Three of them, and each one refuses something:
 *
 * - `SyncQueueEntryState` is a **closed set of two**. There is no
 *   `DELIVERED` — a delivered entry is not in the queue at all.
 * - `SyncError` carries a **code and a summary for the client** and a
 *   **detail for the log**. The detail is truncated, and the truncation
 *   is *marked*, so a reader can tell a cut message from a complete one.
 * - `SyncQueueEntry` enforces six invariants in its constructor, so an
 *   entry that breaks one **cannot be built**.
 */
import { describe, it, expect } from 'vitest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import {
  SYNC_QUEUE_ENTRY_STATES,
  isSyncQueueEntryState,
} from '../../src/005-orgatex-integration/domain/value-objects/sync-queue-entry-state.js';
import {
  SYNC_ERROR_CODES,
  SyncError,
  isSyncErrorCode,
} from '../../src/005-orgatex-integration/domain/value-objects/sync-error.js';
import {
  SyncQueueEntry,
} from '../../src/005-orgatex-integration/domain/entities/sync-queue-entry.js';
import { IdempotencyKey } from '../../src/005-orgatex-integration/domain/value-objects/idempotency-key.js';
import {
  BatchId,
  ComponentId,
  LotNumber,
  OperatorReference,
} from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';

const T0 = Instant.of(new Date('2026-10-30T08:00:00.000Z'));

function entryFor(label = 'ENTRY'): SyncQueueEntry {
  return SyncQueueEntry.queue({
    postingId: IdempotencyKey.of('IDK-cafebabe0badf00d'),
    batchId: BatchId.create('B-24187'),
    componentId: ComponentId.create('C-01'),
    actualQuantity: WeightValue.of('94.01', 'g'),
    lotNumber: LotNumber.create('L-77120'),
    operatorId: OperatorReference.create('OP-001'),
    weighedAt: T0,
    queuedAt: T0,
  });
}

describe('SyncQueueEntryState — the closed set of two', () => {
  it('has exactly two members, and no DELIVERED', () => {
    expect([...SYNC_QUEUE_ENTRY_STATES]).toEqual(['PENDING', 'FAILED']);
    // A delivered entry LEAVES the queue — a third state would be a
    // second source of truth about whether a consumption landed.
    expect(SYNC_QUEUE_ENTRY_STATES).not.toContain('DELIVERED');
  });

  it('accepts a state in the set and refuses one outside it', () => {
    expect(isSyncQueueEntryState('PENDING')).toBe(true);
    expect(isSyncQueueEntryState('FAILED')).toBe(true);
    expect(isSyncQueueEntryState('DELIVERED')).toBe(false);
    expect(isSyncQueueEntryState('pending')).toBe(false);
    expect(isSyncQueueEntryState(undefined)).toBe(false);
    expect(isSyncQueueEntryState(42)).toBe(false);
  });
});

describe('SyncError — the code, the summary and the log-only detail', () => {
  it('is a closed set of four codes', () => {
    expect([...SYNC_ERROR_CODES]).toEqual([
      'UNREACHABLE',
      'TIMEOUT',
      'REJECTED',
      'MALFORMED',
    ]);
    expect(isSyncErrorCode('UNREACHABLE')).toBe(true);
    expect(isSyncErrorCode('REJECTED')).toBe(true);
    expect(isSyncErrorCode('NOT_FOUND')).toBe(false);
    expect(isSyncErrorCode(undefined)).toBe(false);
  });

  it('the client projection carries the code and the summary — NEVER the detail', () => {
    const error = SyncError.of(
      'UNREACHABLE',
      'OrgaTEX could not be reached',
      'the adapter\'s internal prose',
    );

    const client = error.toClient();

    expect(client.code).toBe('UNREACHABLE');
    expect(client.summary).toBe('OrgaTEX could not be reached');
    expect(client).not.toHaveProperty('detail');
  });

  it('builds from an adapter reason with a default summary', () => {
    const unreachable = SyncError.fromAdapterReason(
      'UNREACHABLE',
      'the adapter said no',
    );
    const timeout = SyncError.fromAdapterReason('TIMEOUT', 'too slow');
    const malformed = SyncError.fromAdapterReason('MALFORMED', 'rubbish');

    expect(unreachable.summary).toBe('OrgaTEX could not be reached');
    expect(timeout.summary).toBe('OrgaTEX did not answer in time');
    expect(malformed.summary).toBe('OrgaTEX returned an unusable response');
    expect(unreachable.detail).toBe('the adapter said no');
  });

  it('an over-long summary is TRUNCATED and MARKED as truncated', () => {
    const error = SyncError.of('REJECTED', 'x'.repeat(400), '');

    // The bound is 120 characters, and the marker is appended — so a cut
    // message is LONGER than the bound, and it says so.
    expect(error.summary).toContain('[truncated]');
    expect(error.summary.startsWith('x'.repeat(120))).toBe(true);
    expect(error.summary.length).toBe(120 + '… [truncated]'.length);
  });

  it('an over-long detail is TRUNCATED and MARKED as truncated', () => {
    const error = SyncError.of('REJECTED', 'short', 'y'.repeat(900));

    expect(error.detail).toContain('[truncated]');
    expect(error.detail.startsWith('y'.repeat(500))).toBe(true);
    expect(error.detail.length).toBe(500 + '… [truncated]'.length);
  });

  it('a message within the bound is NOT marked', () => {
    const error = SyncError.of('REJECTED', 'short', 'also short');

    expect(error.summary).toBe('short');
    expect(error.detail).toBe('also short');
    expect(error.detail).not.toContain('[truncated]');
  });

  it('says whether the failure meant the MES could not be REACHED', () => {
    // A refusal is a REACHABLE MES that said no — and a refused posting
    // is exactly the one an operator most needs to re-drive.
    expect(SyncError.of('REJECTED', 's', 'd').meansUnreachable()).toBe(false);
    expect(SyncError.of('MALFORMED', 's', 'd').meansUnreachable()).toBe(false);
    expect(SyncError.of('UNREACHABLE', 's', 'd').meansUnreachable()).toBe(true);
    expect(SyncError.of('TIMEOUT', 's', 'd').meansUnreachable()).toBe(true);
  });

  it('two errors with the same content are equal', () => {
    const a = SyncError.of('UNREACHABLE', 's', 'd');
    const b = SyncError.of('UNREACHABLE', 's', 'd');
    const c = SyncError.of('UNREACHABLE', 's', 'different');

    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });
});

describe('SyncQueueEntry — the six invariants', () => {
  it('a fresh entry is PENDING, with no attempts and a next attempt time', () => {
    const entry = entryFor();

    expect(entry.state).toBe('PENDING');
    expect(entry.isPending).toBe(true);
    expect(entry.isFailed).toBe(false);
    expect(entry.attempts).toBe(0);
    expect(entry.lastAttemptAt).toBeNull();
    expect(entry.lastError).toBeNull();
    expect(entry.nextAttemptAt).not.toBeNull();
  });

  it('refuses a negative attempt count', () => {
    expect(() =>
      SyncQueueEntry.restore({
        postingId: IdempotencyKey.of('IDK-cafebabe0badf00d'),
        batchId: BatchId.create('B-24187'),
        componentId: ComponentId.create('C-01'),
        actualQuantity: WeightValue.of('94.01', 'g'),
        lotNumber: LotNumber.create('L-77120'),
        operatorId: OperatorReference.create('OP-001'),
        weighedAt: T0,
        queuedAt: T0,
        attempts: -1,
        lastAttemptAt: null,
        nextAttemptAt: T0,
        lastError: null,
        state: 'PENDING',
      }),
    ).toThrow(/non-negative whole number/);
  });

  it('refuses a fractional attempt count', () => {
    expect(() =>
      SyncQueueEntry.restore({
        postingId: IdempotencyKey.of('IDK-cafebabe0badf00d'),
        batchId: BatchId.create('B-24187'),
        componentId: ComponentId.create('C-01'),
        actualQuantity: WeightValue.of('94.01', 'g'),
        lotNumber: LotNumber.create('L-77120'),
        operatorId: OperatorReference.create('OP-001'),
        weighedAt: T0,
        queuedAt: T0,
        attempts: 1.5,
        lastAttemptAt: null,
        nextAttemptAt: T0,
        lastError: null,
        state: 'PENDING',
      }),
    ).toThrow(/non-negative whole number/);
  });

  it('refuses a PENDING entry with NO next attempt time', () => {
    // A pending entry is ON the automatic path — a path with no time on
    // it is a contradiction, so it cannot be built.
    expect(() =>
      SyncQueueEntry.restore({
        postingId: IdempotencyKey.of('IDK-cafebabe0badf00d'),
        batchId: BatchId.create('B-24187'),
        componentId: ComponentId.create('C-01'),
        actualQuantity: WeightValue.of('94.01', 'g'),
        lotNumber: LotNumber.create('L-77120'),
        operatorId: OperatorReference.create('OP-001'),
        weighedAt: T0,
        queuedAt: T0,
        attempts: 0,
        lastAttemptAt: null,
        nextAttemptAt: null,
        lastError: null,
        state: 'PENDING',
      }),
    ).toThrow(/next attempt time/);
  });

  it('refuses a FAILED entry WITH a next attempt time', () => {
    // A failed entry is OFF the automatic path — a time on it would put
    // it back on.
    expect(() =>
      SyncQueueEntry.restore({
        postingId: IdempotencyKey.of('IDK-cafebabe0badf00d'),
        batchId: BatchId.create('B-24187'),
        componentId: ComponentId.create('C-01'),
        actualQuantity: WeightValue.of('94.01', 'g'),
        lotNumber: LotNumber.create('L-77120'),
        operatorId: OperatorReference.create('OP-001'),
        weighedAt: T0,
        queuedAt: T0,
        attempts: 1,
        lastAttemptAt: T0,
        nextAttemptAt: T0,
        lastError: null,
        state: 'FAILED',
      }),
    ).toThrow(/next attempt time/);
  });

  it('refuses an attempt time with NO attempt', () => {
    expect(() =>
      SyncQueueEntry.restore({
        postingId: IdempotencyKey.of('IDK-cafebabe0badf00d'),
        batchId: BatchId.create('B-24187'),
        componentId: ComponentId.create('C-01'),
        actualQuantity: WeightValue.of('94.01', 'g'),
        lotNumber: LotNumber.create('L-77120'),
        operatorId: OperatorReference.create('OP-001'),
        weighedAt: T0,
        queuedAt: T0,
        attempts: 0,
        lastAttemptAt: T0,
        nextAttemptAt: T0,
        lastError: null,
        state: 'PENDING',
      }),
    ).toThrow(/at least one attempt/);
  });

  it('a retryable failure keeps the entry PENDING and raises the count', () => {
    const entry = entryFor().afterRetryableFailure({
      error: SyncError.of('TIMEOUT', 'OrgaTEX did not answer in time', 'd'),
      attemptedAt: T0.plus(1000),
      nextAttemptAt: T0.plus(2000),
    });

    expect(entry.state).toBe('PENDING');
    expect(entry.attempts).toBe(1);
    expect(entry.lastAttemptAt?.epochMillis).toBe(T0.plus(1000).epochMillis);
    expect(entry.nextAttemptAt?.epochMillis).toBe(T0.plus(2000).epochMillis);
    expect(entry.lastError?.code).toBe('TIMEOUT');
    // The content is untouched.
    expect(entry.actualQuantity.toJSON()).toBe('94.01');
  });

  it('a permanent failure makes the entry FAILED and off the automatic path', () => {
    const entry = entryFor().afterPermanentFailure({
      error: SyncError.of('REJECTED', 'OrgaTEX refused the consumption', 'd'),
      attemptedAt: T0.plus(1000),
    });

    expect(entry.state).toBe('FAILED');
    expect(entry.isFailed).toBe(true);
    expect(entry.isPending).toBe(false);
    expect(entry.attempts).toBe(1);
    expect(entry.nextAttemptAt).toBeNull();
    expect(entry.lastError?.code).toBe('REJECTED');
  });

  it('a REFUSED attempt counts — the count rises even though nothing was sent', () => {
    const entry = entryFor().afterRefusedAttempt({
      error: SyncError.of('UNREACHABLE', 'OrgaTEX could not be reached', 'd'),
      attemptedAt: T0.plus(1000),
    });

    expect(entry.attempts).toBe(1);
    expect(entry.state).toBe('FAILED');
    expect(entry.nextAttemptAt).toBeNull();
  });

  it('the attempt count ONLY EVER INCREASES', () => {
    const failed = entryFor().afterPermanentFailure({
      error: SyncError.of('REJECTED', 'OrgaTEX refused the consumption', 'd'),
      attemptedAt: T0.plus(1000),
    });

    const refused = failed.afterRefusedAttempt({
      error: SyncError.of('UNREACHABLE', 'OrgaTEX could not be reached', 'd'),
      attemptedAt: T0.plus(2000),
    });

    expect(refused.attempts).toBe(2);
  });
});
