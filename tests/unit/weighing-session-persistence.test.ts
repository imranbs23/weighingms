/**
 * The weighing session's persistence — unit 003, bolt 013.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE SESSION IS MUTABLE, AND THE STALE-LOOKING-FRESH RISK IS CLOSED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The session is persisted so the work can be **resumed** (NFR-06), and it
 * is **mutable** — it is the live state, not a record of a completed act
 * (ADR-036).
 *
 * And the **sequence floor is persisted with it**, so a reading replayed
 * after a restart is still rejected. That is the one number that could
 * otherwise be stale-looking-fresh, and it is closed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import { ScaleId } from '../../src/004-scale-integration/domain/value-objects/scale-id.js';
import { ReadingSequence } from '../../src/004-scale-integration/domain/value-objects/reading-sequence.js';
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
import {
  SqliteWeighingSessionRepository,
} from '../../src/003-weighing-station/infrastructure/persistence/sqlite-weighing-session-repository.js';

const AT = Instant.of(new Date('2026-11-06T09:00:00.000Z'));
const OPERATOR = OperatorId.create('OP-001');

function session(): WeighingSession {
  return new WeighingSession({
    sessionId: 'WS-1',
    batchId: BatchId.create('B-24187'),
    operatorId: OPERATOR,
    startedAt: AT,
    components: [
      {
        componentId: ComponentId.create('DYE-4471-Y'),
        state: 'PENDING',
      } as ComponentProgress,
    ],
  });
}

describe('the weighing session persistence', () => {
  let db: SqliteDatabase;
  let sessions: SqliteWeighingSessionRepository;

  beforeEach(() => {
    db = openSessionDatabase(':memory:');
    sessions = new SqliteWeighingSessionRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('is null when no session has been started', async () => {
    expect(await sessions.current()).toBeNull();
  });

  it('round-trips the live state', async () => {
    const s = session();
    s.selectComponent(ComponentId.create('DYE-4471-Y'), ScaleId.create('SCALE-A'));
    s.componentUnit = 'g';
    s.offerReading(
      ScaleId.create('SCALE-A'),
      WeightValue.of('40.0000', 'g'),
      true,
      ReadingSequence.of(7),
    );

    await sessions.save(s);

    const read = await sessions.current();
    expect(read).not.toBeNull();
    if (read === null) return;
    expect(read.state).toBe('WEIGHING');
    expect(read.activeComponentId?.value).toBe('DYE-4471-Y');
    expect(read.selectedScaleId?.value).toBe('SCALE-A');
    expect(read.currentWeight?.text).toBe('40.0000');
    expect(read.currentWeight?.unit).toBe('g');
    expect(read.lastAcceptedSequence).toBe(7);
    expect(read.components[0]?.state).toBe('ACTIVE');
  });

  it('is an UPSERT — the session is MUTABLE, and the row is updated in place', async () => {
    const s = session();
    s.selectComponent(ComponentId.create('DYE-4471-Y'), ScaleId.create('SCALE-A'));
    await sessions.save(s);

    // The same session, a later state.
    s.scaleLost();
    await sessions.save(s);

    const count = db
      .prepare(`SELECT COUNT(*) AS n FROM weighing_sessions`)
      .get() as { n: number };
    expect(count.n).toBe(1);

    const read = await sessions.current();
    expect(read?.state).toBe('AWAITING_COMPONENT');
  });

  it('the SEQUENCE FLOOR survives a restart — a replayed reading is rejected', async () => {
    const s = session();
    s.selectComponent(ComponentId.create('DYE-4471-Y'), ScaleId.create('SCALE-A'));
    s.componentUnit = 'g';
    s.offerReading(
      ScaleId.create('SCALE-A'),
      WeightValue.of('40.0000', 'g'),
      true,
      ReadingSequence.of(7),
    );
    await sessions.save(s);

    // A restart: the session comes back from the row.
    const restored = await sessions.current();
    expect(restored).not.toBeNull();
    if (restored === null) return;
    restored.componentUnit = 'g';

    const outcome = restored.offerReading(
      ScaleId.create('SCALE-A'),
      WeightValue.of('30.0000', 'g'),
      true,
      ReadingSequence.of(5),
    );

    expect(outcome.kind).toBe('DISCARDED');
    if (outcome.kind !== 'DISCARDED') return;
    expect(outcome.reason).toBe('OUT_OF_ORDER');
  });

  it('the weight is stored as TEXT — never a float', async () => {
    const s = session();
    s.selectComponent(ComponentId.create('DYE-4471-Y'), ScaleId.create('SCALE-A'));
    s.componentUnit = 'g';
    s.offerReading(
      ScaleId.create('SCALE-A'),
      WeightValue.of('40.0000', 'g'),
      true,
      ReadingSequence.of(1),
    );
    await sessions.save(s);

    const row = db
      .prepare(`SELECT current_weight FROM weighing_sessions`)
      .get() as { current_weight: unknown };

    expect(typeof row.current_weight).toBe('string');
    expect(row.current_weight).toBe('40.0000');
  });

  it('the STALE flag round-trips', async () => {
    const s = session();
    s.selectComponent(ComponentId.create('DYE-4471-Y'), ScaleId.create('SCALE-A'));
    s.componentUnit = 'g';
    s.offerReading(
      ScaleId.create('SCALE-A'),
      WeightValue.of('40.0000', 'g'),
      true,
      ReadingSequence.of(1),
    );
    s.scaleLost();
    await sessions.save(s);

    const read = await sessions.current();
    expect(read?.weightIsStale).toBe(true);
    expect(read?.currentWeight?.text).toBe('40.0000');
  });

  it('refuses a state outside the closed set', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO weighing_sessions
             (session_id, batch_id, operator_id, state, active_component_id,
              selected_scale_id, current_weight, weight_unit, weight_stable,
              weight_stale, weight_sequence, components_json, started_at,
              updated_at)
           VALUES ('WS-9', 'B-1', 'OP-1', 'GHOST', NULL, NULL, NULL, NULL,
                   NULL, 0, NULL, '[]', ?, ?)`,
        )
        .run(AT.toString(), AT.toString()),
    ).toThrow();
  });
});
