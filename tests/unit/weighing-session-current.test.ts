/**
 * The current session — the MOST RECENTLY STARTED one (bolt 029).
 *
 * A completed batch's session stays in the table. The next batch's session
 * must become current, or "Next batch" can never start a second batch: the
 * repository read the first row ever written.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import {
  BatchId,
  ComponentId,
} from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import { OperatorId } from '../../src/008-operator-identity/domain/value-objects/operator-id.js';
import { WeighingSession } from '../../src/003-weighing-station/domain/entities/weighing-session.js';
import type { ComponentProgress } from '../../src/003-weighing-station/domain/entities/weighing-session.js';
import {
  openSessionDatabase,
  type SqliteDatabase,
} from '../../src/003-weighing-station/infrastructure/persistence/session-database.js';
import { SqliteWeighingSessionRepository } from '../../src/003-weighing-station/infrastructure/persistence/sqlite-weighing-session-repository.js';

function session(sessionId: string, batchId: string): WeighingSession {
  return new WeighingSession({
    sessionId,
    batchId: BatchId.create(batchId),
    operatorId: OperatorId.create('OP-001'),
    startedAt: Instant.of(new Date('2026-11-10T09:00:00.000Z')),
    components: [
      {
        componentId: ComponentId.create('DYE-4471-Y'),
        state: 'PENDING',
      } as ComponentProgress,
    ],
  });
}

describe('the current weighing session', () => {
  let db: SqliteDatabase;
  let sessions: SqliteWeighingSessionRepository;

  beforeEach(() => {
    db = openSessionDatabase(':memory:');
    sessions = new SqliteWeighingSessionRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('is the most recently STARTED session — not the first ever written', async () => {
    await sessions.save(session('WS-1', 'B-24187'));
    await sessions.save(session('WS-2', 'B-24188'));

    expect(sessions.current()?.sessionId).toBe('WS-2');
    expect(sessions.current()?.batchId.value).toBe('B-24188');
  });

  it('updating an OLDER session does not make it current again', async () => {
    const first = session('WS-1', 'B-24187');
    await sessions.save(first);
    await sessions.save(session('WS-2', 'B-24188'));

    // An upsert of the first — its row keeps its place.
    await sessions.save(first);

    expect(sessions.current()?.sessionId).toBe('WS-2');
  });
});
