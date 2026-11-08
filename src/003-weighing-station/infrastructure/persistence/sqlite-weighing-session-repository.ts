/**
 * SqliteWeighingSessionRepository — the session's durable state.
 *
 * ══════════════════════════════════════════════════════════════════════
 * AN UPSERT, BECAUSE THE SESSION'S VALUE IS NOW.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The session is the **live state** of work in progress, so it is updated
 * in place. It is not a record of a completed act — the `WeighingRecord` is
 * that, it is immutable, and it is a different table (ADR-036).
 *
 * **And the last accepted sequence is persisted**, so the out-of-order
 * guard survives a restart: a reading replayed after a restart is still
 * rejected, rather than being accepted because the in-memory floor was
 * lost with the process.
 */
import { WeighingSession } from '../../domain/entities/weighing-session.js';
import type { ComponentProgress } from '../../domain/entities/weighing-session.js';
import type { WeighingSessionRepository } from '../../domain/ports/weighing-station-ports.js';
import { isSessionState } from '../../domain/value-objects/session-state.js';
import {
  BatchId,
  ComponentId,
} from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';
import { OperatorId } from '../../../008-operator-identity/domain/value-objects/operator-id.js';
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../../004-scale-integration/domain/value-objects/weight-value.js';
import { ScaleId } from '../../../004-scale-integration/domain/value-objects/scale-id.js';
import type { SqliteDatabase } from './session-database.js';

interface SessionRow {
  session_id: string;
  batch_id: string;
  operator_id: string;
  state: string;
  active_component_id: string | null;
  selected_scale_id: string | null;
  current_weight: string | null;
  weight_unit: string | null;
  weight_stable: number | null;
  weight_stale: number;
  weight_sequence: number | null;
  components_json: string;
  component_unit: string | null;
  started_at: string;
  updated_at: string;
}

export class SqliteWeighingSessionRepository
  implements WeighingSessionRepository
{
  constructor(
    private readonly db: SqliteDatabase,
    /** The clock, so the recording time is the repository's business. */
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Save the session's current state.
   *
   * An **upsert**: the row is updated in place, because the session's
   * value is *now*.
   */
  async save(session: WeighingSession): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO weighing_sessions
           (session_id, batch_id, operator_id, state, active_component_id,
            selected_scale_id, current_weight, weight_unit, weight_stable,
            weight_stale, weight_sequence, components_json, component_unit,
            started_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
            state = excluded.state,
            active_component_id = excluded.active_component_id,
            selected_scale_id = excluded.selected_scale_id,
            current_weight = excluded.current_weight,
            weight_unit = excluded.weight_unit,
            weight_stable = excluded.weight_stable,
            weight_stale = excluded.weight_stale,
            weight_sequence = excluded.weight_sequence,
            components_json = excluded.components_json,
            component_unit = excluded.component_unit,
            updated_at = excluded.updated_at`,
      )
      .run(
        session.sessionId,
        session.batchId.value,
        session.operatorId.value,
        session.state,
        session.activeComponentId?.value ?? null,
        session.selectedScaleId?.value ?? null,
        session.currentWeight?.toJSON() ?? null,
        session.currentWeight?.unit ?? null,
        session.weightIsStable ? 1 : 0,
        session.weightIsStale ? 1 : 0,
        session.lastAcceptedSequence,
        JSON.stringify(
          session.components.map((entry) => ({
            componentId: entry.componentId.value,
            state: entry.state,
          })),
        ),
        // The component's unit — persisted, because a resumed session must
        // still be able to convert a reading (NFR-06).
        session.componentUnit,
        session.startedAt.toString(),
        this.clock().toISOString(),
      );
  }

  /**
   * The current session, or `null` when none has been started.
   *
   * `null` is a **state**, not an error — it is the UI's first render.
   */
  current(): WeighingSession | null {
    const row = this.db
      .prepare(`SELECT * FROM weighing_sessions LIMIT 1`)
      .get() as unknown as SessionRow | undefined;

    if (row === undefined) return null;
    return toSession(row);
  }
}

/**
 * Rebuild a session from its row.
 *
 * The state is read back through the domain's own guard, so a row that
 * somehow held a value outside the closed set would be **refused** rather
 * than silently carried into the model.
 */
function toSession(row: SessionRow): WeighingSession {
  if (!isSessionState(row.state)) {
    throw new Error(
      `The stored session state "${row.state}" is not one this product records`,
    );
  }

  const components = (
    JSON.parse(row.components_json) as {
      componentId: string;
      state: string;
    }[]
  ).map(
    (entry): ComponentProgress => ({
      componentId: ComponentId.create(entry.componentId),
      state:
        entry.state === 'DONE'
          ? 'DONE'
          : entry.state === 'ACTIVE'
            ? 'ACTIVE'
            : 'PENDING',
    }),
  );

  const session = new WeighingSession({
    sessionId: row.session_id,
    batchId: BatchId.create(row.batch_id),
    operatorId: OperatorId.create(row.operator_id),
    startedAt: Instant.of(new Date(row.started_at)),
    components,
  });

  session.restore({
    state: row.state,
    activeComponentId:
      row.active_component_id === null
        ? null
        : ComponentId.create(row.active_component_id),
    selectedScaleId:
      row.selected_scale_id === null
        ? null
        : ScaleId.create(row.selected_scale_id),
    currentWeight:
      row.current_weight === null || row.weight_unit === null
        ? null
        : WeightValue.of(row.current_weight, row.weight_unit),
    stable: row.weight_stable === 1,
    stale: row.weight_stale === 1,
    sequence: row.weight_sequence,
    componentUnit: row.component_unit,
  });

  return session;
}
