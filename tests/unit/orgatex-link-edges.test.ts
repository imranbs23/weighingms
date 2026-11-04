/**
 * The seams bolt 007 left uncovered (bolt 007, Stage 5).
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE PLACES WHERE A QUIET MISTAKE WOULD BE INVISIBLE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Four things live here, and each is a place where the wrong answer is
 * still a plausible-looking answer:
 *
 * 1. **The transition log's read path.** `LinkStateService.transitionLog()`
 *    is how a diagnosis reads the history — and it was never exercised.
 *
 * 2. **The absent observations row.** The migration seeds it, so the
 *    repository's "no row" branch is unreachable in normal operation. It is
 *    still a branch, and a branch that has never run is a branch nobody
 *    knows what it does.
 *
 * 3. **The queue's default randomness.** The backoff's jitter falls back to
 *    `Math.random` when no source is injected — the production path. A
 *    jitter that is never taken cannot be trusted.
 *
 * 4. **The controller's refusals.** A malformed path parameter, a missing
 *    body and a malformed batch id — each one a decision the controller
 *    makes on the operator's behalf.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import { BackoffSchedule } from '../../src/005-orgatex-integration/domain/value-objects/backoff-schedule.js';
import { IdempotencyKey } from '../../src/005-orgatex-integration/domain/value-objects/idempotency-key.js';
import { SyncError } from '../../src/005-orgatex-integration/domain/value-objects/sync-error.js';
import {
  BatchId,
  ComponentId,
  LotNumber,
  OperatorReference,
} from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import {
  ConsumptionPosting,
} from '../../src/005-orgatex-integration/domain/entities/postings.js';
import {
  SyncQueueEntry,
} from '../../src/005-orgatex-integration/domain/entities/sync-queue-entry.js';
import { PureSyncBackoffPolicy } from '../../src/005-orgatex-integration/domain/services/sync-backoff-policy.js';
import { LinkStateService } from '../../src/005-orgatex-integration/domain/services/link-state-service.js';
import { PureLinkStatePolicy } from '../../src/005-orgatex-integration/domain/services/link-state-policy.js';
import { FreshnessWindow } from '../../src/005-orgatex-integration/domain/value-objects/freshness-window.js';
import { SyncQueueService } from '../../src/005-orgatex-integration/domain/services/sync-queue-service.js';
import type {
  ConsumptionPostingService,
  PostingOutcome,
} from '../../src/005-orgatex-integration/domain/services/consumption-posting-service.js';
import { openOrgatexDatabase } from '../../src/005-orgatex-integration/infrastructure/persistence/orgatex-database.js';
import { SqliteSyncQueueRepository } from '../../src/005-orgatex-integration/infrastructure/persistence/sqlite-sync-queue-repository.js';
import { SqliteLinkContactRepository } from '../../src/005-orgatex-integration/infrastructure/persistence/sqlite-link-contact-repository.js';
import { SqliteLinkTransitionRepository } from '../../src/005-orgatex-integration/infrastructure/persistence/sqlite-link-transition-repository.js';
import { SqliteIdempotencyLedger } from '../../src/005-orgatex-integration/infrastructure/persistence/sqlite-idempotency-ledger.js';
import { SqlitePostingRepository } from '../../src/005-orgatex-integration/infrastructure/persistence/sqlite-posting-repository.js';
import { ManualLinkScheduler } from '../support/orgatex-harness.js';
import {
  createHarness,
  seedOperator,
  type Harness,
} from '../harness.js';

const T0 = Instant.of(new Date('2026-10-30T08:00:00.000Z'));

const OPERATOR_ID = 'OP-001';
const OPERATOR_SECRET = '4821';

const WEIGHED_AT = '2026-11-02T08:14:22.000Z';

function body(overrides: Record<string, unknown> = {}) {
  return {
    componentId: 'C-01',
    actualQuantity: '94.01',
    unit: 'g',
    lotNumber: 'L-77120',
    weighedAt: WEIGHED_AT,
    ...overrides,
  };
}

function keyFor(label: string): string {
  let hash = 0;
  for (const char of label) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `IDK-${hash.toString(16).padStart(16, '0').slice(0, 16)}`;
}

function posting(label: string): ConsumptionPosting {
  return new ConsumptionPosting(
    IdempotencyKey.of(keyFor(label)),
    BatchId.create('B-24187'),
    ComponentId.create('C-01'),
    WeightValue.of('94.01', 'g'),
    LotNumber.create('L-77120'),
    OperatorReference.create('OP-001'),
    T0,
    T0,
  );
}

function entryFor(label: string): SyncQueueEntry {
  const p = posting(label);
  return SyncQueueEntry.queue({
    postingId: p.id,
    batchId: p.batchId,
    componentId: p.componentId,
    actualQuantity: p.actualQuantity,
    lotNumber: p.lotNumber,
    operatorId: p.operatorId,
    weighedAt: p.weighedAt,
    queuedAt: p.createdAt,
  });
}

// ── The transition log's read path ──

describe('LinkStateService — the transition log is readable', () => {
  it('reads the transitions back, oldest first (R-05)', async () => {
    const db = openOrgatexDatabase(':memory:');
    const service = new LinkStateService({
      policy: new PureLinkStatePolicy(),
      contacts: new SqliteLinkContactRepository(db),
      transitions: new SqliteLinkTransitionRepository(db),
      scheduler: new ManualLinkScheduler(),
      freshnessWindow: FreshnessWindow.of(300_000),
      clock: () => T0.toDate(),
    });

    // An empty log reads as an empty log — not as a fabricated transition.
    expect(await service.transitionLog()).toEqual([]);

    await service.recordSuccess(T0);
    await service.recordFailure(
      SyncError.of('UNREACHABLE', 'unreachable', 'detail'),
      T0.plus(1000),
    );

    const log = await service.transitionLog();

    expect(log).toHaveLength(2);
    expect(log[0]?.from).toBe('OFFLINE');
    expect(log[0]?.to).toBe('LINKED');
    expect(log[1]?.from).toBe('LINKED');
    expect(log[1]?.to).toBe('DEGRADED');
  });
});

// ── The absent observations row ──

describe('SqliteLinkContactRepository — an absent row means "never contacted"', () => {
  it('reads as the EMPTY observations when the seeded row is gone', async () => {
    const db = openOrgatexDatabase(':memory:');
    const repository = new SqliteLinkContactRepository(db);

    // The migration seeds the row, so this cannot happen in normal
    // operation — and a branch that has never run is a branch nobody
    // knows what it does. So it is run here.
    db.prepare('DELETE FROM link_contact_observations').run();

    const observations = await repository.read();

    // "Never contacted" — not "broken", and not a crash.
    expect(observations.lastSuccessAt).toBeNull();
    expect(observations.lastFailureAt).toBeNull();
    expect(observations.lastError).toBeNull();
    expect(observations.consecutiveFailures).toBe(0);
  });

  it('a row with an error code but NO summary still reads as an error', async () => {
    const db = openOrgatexDatabase(':memory:');
    const repository = new SqliteLinkContactRepository(db);

    // A half-written row — the code is there, the prose is not. The
    // repository must not lose the code, and must not throw.
    db.prepare(
      `UPDATE link_contact_observations
          SET last_error_code = 'UNREACHABLE',
              last_error_summary = NULL,
              last_error_detail = NULL
        WHERE id = 1`,
    ).run();

    const observations = await repository.read();

    expect(observations.lastError?.code).toBe('UNREACHABLE');
    expect(observations.lastError?.summary).toBe('');
    expect(observations.lastError?.detail).toBe('');
  });
});

// ── The queue's default randomness ──

describe('SyncQueueService — the default jitter source', () => {
  it('falls back to Math.random when no source is injected', async () => {
    const db = openOrgatexDatabase(':memory:');
    const queue = new SqliteSyncQueueRepository(db);
    const postings = new SqlitePostingRepository(db);

    const postingService = {
      async post(): Promise<PostingOutcome> {
        throw new Error('The queue must not use the enqueue path');
      },
      async redeliver(p: ConsumptionPosting): Promise<PostingOutcome> {
        return { kind: 'QUEUED', posting: p, message: 'unreachable' };
      },
    };

    const service = new SyncQueueService({
      postingService: postingService as unknown as ConsumptionPostingService,
      queue,
      postings,
      ledger: new SqliteIdempotencyLedger(db),
      linkState: new LinkStateService({
        policy: new PureLinkStatePolicy(),
        contacts: new SqliteLinkContactRepository(db),
        transitions: new SqliteLinkTransitionRepository(db),
        scheduler: new ManualLinkScheduler(),
        freshnessWindow: FreshnessWindow.of(300_000),
        clock: () => T0.toDate(),
      }),
      disposition: { disposition: () => 'RETRYABLE' },
      backoffPolicy: new PureSyncBackoffPolicy(),
      backoff: BackoffSchedule.of(1000, 60_000, 2, 250),
      clock: () => T0.toDate(),
      // NO `random` — so the production fallback is the one under test.
    });

    const p = posting('DEFAULT_RANDOM');
    await postings.save(p);
    await queue.enqueue(entryFor('DEFAULT_RANDOM'));

    await service.retryDue(T0);

    const entry = await queue.findByPostingId(p.id);

    // The entry is still on the automatic path, with a backoff INSIDE the
    // schedule's bound. The exact millisecond is random — the bound is
    // what is guaranteed.
    expect(entry?.state).toBe('PENDING');
    expect(entry?.attempts).toBe(1);
    const next = entry?.nextAttemptAt?.epochMillis ?? 0;
    expect(next).toBeGreaterThan(T0.epochMillis);
    expect(next).toBeLessThanOrEqual(T0.plus(60_000).epochMillis);
  });
});

// ── The controller's refusals ──

describe('the controller — the refusals it makes on the operator\'s behalf', () => {
  let harness: Harness;
  let token: string;

  beforeEach(async () => {
    harness = createHarness();
    await seedOperator(
      harness,
      OPERATOR_ID,
      'R. Karim',
      'OPERATOR',
      OPERATOR_SECRET,
    );
    const signIn = await request(harness.app)
      .post('/api/identity/sign-in')
      .send({ operatorId: OPERATOR_ID, secret: OPERATOR_SECRET });
    expect(signIn.status).toBe(200);
    token = signIn.body.token as string;
  });

  afterEach(() => {
    harness.close();
  });

  it('a MALFORMED batch id on the consumption path is a 400, not a 500', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/batches/%20/consumption')
      .set('Authorization', `Bearer ${token}`)
      .send(body());

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
  });

  it('a MALFORMED batch id on the status path is a 400', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/batches/%20/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'WEIGHED' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
  });

  it('a MISSING body on the status path is a 400', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/batches/B-24187/status')
      .set('Authorization', `Bearer ${token}`);

    // No body at all — the schema refuses it, and the refusal is a plain
    // validation error rather than a 500.
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
  });

  it('a MALFORMED batch id on the recipe path is a 400', async () => {
    const response = await request(harness.app)
      .get('/api/orgatex/batches/%20/recipe')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
  });

  it('a MALFORMED posting id on the re-drive path is a 400', async () => {
    const response = await request(harness.app)
      .post('/api/orgatex/sync-queue/%20/redrive')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
  });

  it('an OVER-LONG batch id is a 400 on every path that takes one', async () => {
    // The id is not empty — so it passes the empty check — and it is
    // longer than the identifier's own bound of 64 characters. So it is
    // the VALUE OBJECT that refuses it, and the controller turns that
    // refusal into a plain 400 rather than letting it become a 500.
    const tooLong = 'B'.repeat(65);

    const recipe = await request(harness.app)
      .get(`/api/orgatex/batches/${tooLong}/recipe`)
      .set('Authorization', `Bearer ${token}`);
    expect(recipe.status).toBe(400);
    expect(recipe.body.error).toBe('VALIDATION_ERROR');

    const consumption = await request(harness.app)
      .post(`/api/orgatex/batches/${tooLong}/consumption`)
      .set('Authorization', `Bearer ${token}`)
      .send(body());
    expect(consumption.status).toBe(400);
    expect(consumption.body.error).toBe('VALIDATION_ERROR');

    const status = await request(harness.app)
      .post(`/api/orgatex/batches/${tooLong}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'WEIGHED' });
    expect(status.status).toBe(400);
    expect(status.body.error).toBe('VALIDATION_ERROR');
  });
});
