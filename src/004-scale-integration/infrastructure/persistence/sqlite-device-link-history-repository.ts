/**
 * SqliteDeviceLinkHistoryRepository — the disconnection gaps.
 *
 * APPEND-ONLY (S-9). There is deliberately no `update` and no `delete`:
 * a recorded gap is a fact about what happened, and its content must not
 * depend on whether anyone has looked at it since.
 *
 * The gap is stored as TWO ROWS — a `STARTED` and an `ENDED` — and the
 * gap itself is the PROJECTION of the pair. There is no mutable "gap"
 * row whose state changes when the device reconnects.
 *
 * NO WEIGHT IS STORED (ADR-009).
 */
import type {
  DeviceLinkHistoryRepository,
} from '../../domain/ports/device-link-history-repository.js';
import { DisconnectionStarted } from '../../domain/entities/disconnection-started.js';
import { DisconnectionEnded } from '../../domain/entities/disconnection-ended.js';
import { ScaleId } from '../../domain/value-objects/scale-id.js';
import { ReadingSequence } from '../../domain/value-objects/reading-sequence.js';
import type { SqliteDatabase } from './scale-database.js';

interface LinkEventRow {
  id: string;
  scale_id: string;
  kind: string;
  occurred_at: string;
  detected_at: string;
  last_sequence: number | null;
  resumed_at_sequence: number | null;
}

export class SqliteDeviceLinkHistoryRepository
  implements DeviceLinkHistoryRepository
{
  constructor(private readonly db: SqliteDatabase) {}

  async appendStarted(record: DisconnectionStarted): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO scale_link_events
           (id, scale_id, kind, occurred_at, detected_at, last_sequence, resumed_at_sequence)
         VALUES (?, ?, 'STARTED', ?, ?, ?, NULL)`,
      )
      .run(
        `${record.scaleId.value}:STARTED:${record.startedAt.toISOString()}`,
        record.scaleId.value,
        record.startedAt.toISOString(),
        record.detectedAt.toISOString(),
        record.lastSequence?.value ?? null,
      );
  }

  async appendEnded(record: DisconnectionEnded): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO scale_link_events
           (id, scale_id, kind, occurred_at, detected_at, last_sequence, resumed_at_sequence)
         VALUES (?, ?, 'ENDED', ?, ?, ?, ?)`,
      )
      .run(
        `${record.scaleId.value}:ENDED:${record.endedAt.toISOString()}`,
        record.scaleId.value,
        record.endedAt.toISOString(),
        record.detectedAt.toISOString(),
        null,
        record.resumedAtSequence.value,
      );
  }

  async listGaps(scaleId: ScaleId): Promise<
    {
      readonly started: DisconnectionStarted;
      readonly ended: DisconnectionEnded | null;
    }[]
  > {
    const rows = this.db
      .prepare(
        `SELECT * FROM scale_link_events
           WHERE scale_id = ?
           ORDER BY occurred_at`,
      )
      .all(scaleId.value) as unknown as LinkEventRow[];

    const gaps: {
      started: DisconnectionStarted;
      ended: DisconnectionEnded | null;
    }[] = [];

    for (const row of rows) {
      if (row.kind === 'STARTED') {
        gaps.push({
          started: new DisconnectionStarted(
            ScaleId.create(row.scale_id),
            new Date(row.occurred_at),
            new Date(row.detected_at),
            row.last_sequence === null
              ? null
              : ReadingSequence.of(row.last_sequence),
            'SILENCE',
          ),
          ended: null,
        });
        continue;
      }

      // An ENDED row closes the most recent open gap for this device.
      const open = gaps[gaps.length - 1];
      if (open === undefined || open.ended !== null) continue;
      gaps[gaps.length - 1] = {
        started: open.started,
        ended: new DisconnectionEnded(
          ScaleId.create(row.scale_id),
          open.started.startedAt,
          new Date(row.occurred_at),
          open.started.detectedAt,
          ReadingSequence.of(row.resumed_at_sequence ?? 0),
        ),
      };
    }

    return gaps;
  }
}
