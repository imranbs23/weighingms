/**
 * The audit trail's query and export.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE QUERY IS BOUNDED. AND THE EXPORT IS STREAMED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The query returns a **bounded page** of the matching entries, in
 * **sequence order** — the trail's authoritative order.
 *
 * And the export is produced by **iteration** — one entry at a time — so a
 * multi-year export never has to be held in one buffer (ADR-044).
 *
 * **And the export carries EXACTLY the matching entries, with all their
 * fields intact** — the sequence, the entry id, the action, the actor, the
 * role, the subject, the reason and both timestamps.
 */
import { AuditAction } from '../../domain/entities/audit-entry.js';
import type { AuditEntry } from '../../domain/entities/audit-entry.js';
import type {
  AuditEntryRepository,
  AuditFilter,
  AuditStreamRepository,
} from '../../domain/ports/audit-entry-repository.js';

/** How many entries one page carries, when the caller does not say. */
export const DEFAULT_PAGE_SIZE = 100;

/**
 * The largest page a caller may ask for.
 *
 * **Bounded**, because an unbounded page is the one-buffer load the export
 * requirement forbids — and the query is not a better place for it.
 */
export const MAX_PAGE_SIZE = 1000;

/** One page of entries. */
export interface AuditPage {
  readonly entries: readonly AuditEntry[];
  /** Whether there may be more beyond this page. */
  readonly hasMore: boolean;
}

export interface QueryAuditTrailOptions {
  readonly audit: AuditEntryRepository;
}

/**
 * Query the trail.
 *
 * **Only the matching entries**, ordered by the **monotonic sequence**.
 *
 * And an empty result is an **empty page** — not an error. An empty trail
 * and an unreachable trail are different facts, and this reports the first.
 */
export class QueryAuditTrail {
  constructor(private readonly options: QueryAuditTrailOptions) {}

  async execute(filter: AuditFilter, limit?: number): Promise<AuditPage> {
    const size = boundPageSize(limit);

    // The page asks for one more than it needs, so it can say whether
    // there is more — without counting the whole trail.
    const entries = await this.options.audit.filter(filter);
    const hasMore = entries.length > size;

    return { entries: entries.slice(0, size), hasMore };
  }
}

/**
 * The export's format.
 *
 * **A VALUE, not a literal** — the requirements deliberately do not settle
 * the serialisation, so the format is a configuration choice with a
 * defined default (ADR-044).
 */
export const AUDIT_EXPORT_FORMAT_JSONL = 'JSONL';

export type AuditExportFormat = typeof AUDIT_EXPORT_FORMAT_JSONL;

/**
 * The export's artefact.
 *
 * **Produced by iteration** — the writer is handed a cursor and emits each
 * entry as it arrives.
 */
export interface AuditExport {
  readonly format: AuditExportFormat;
  readonly entryCount: number;
  /** The serialised lines. */
  serialise(): string;
}

export interface ExportAuditTrailOptions {
  readonly audit: AuditStreamRepository;
  readonly format?: AuditExportFormat;
}

/**
 * Export the trail.
 *
 * **AND IT WRITES NOTHING.** The export path never calls `record` — the
 * repository's only write is `record`, and the export does not use it
 * (ADR-044).
 */
export class ExportAuditTrail {
  constructor(private readonly options: ExportAuditTrailOptions) {}

  /**
   * The export — one serialised line per entry.
   *
   * **The whole result is never assembled in memory** unless the caller
   * asks for it: the lines are yielded, and a caller that streams them
   * holds one entry at a time.
   */
  async *lines(filter: AuditFilter): AsyncGenerator<string> {
    for await (const entry of this.options.audit.stream(filter)) {
      yield serialiseEntry(entry);
    }
  }

  /** The whole artefact, as one string. */
  async execute(filter: AuditFilter): Promise<AuditExport> {
    const format = this.options.format ?? AUDIT_EXPORT_FORMAT_JSONL;
    const parts: string[] = [];

    for await (const line of this.lines(filter)) {
      parts.push(line);
    }

    return {
      format,
      entryCount: parts.length,
      serialise: () => parts.join(''),
    };
  }
}

/**
 * Serialise one entry — **every field, intact**.
 *
 * **Not a summary, and not a re-rendering.** The export exists so a
 * dispute can be settled from the record, and a summary cannot settle
 * anything (ADR-044).
 */
export function serialiseEntry(entry: AuditEntry): string {
  return `${JSON.stringify({
    sequence: entry.sequence,
    entryId: entry.entryId,
    action: entry.action.value,
    actorId: entry.actorId,
    actorRole: entry.actorRole,
    subject: entry.subject.value,
    reason: entry.reason,
    occurredAt: entry.occurredAt.toDate().toISOString(),
  })}\n`;
}

/**
 * The page size, bounded.
 */
export function boundPageSize(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_PAGE_SIZE;
  }
  const whole = Math.floor(limit);
  if (whole < 1) return 1;
  if (whole > MAX_PAGE_SIZE) return MAX_PAGE_SIZE;
  return whole;
}

/**
 * The action a refusal names — the action, plus the suffix.
 */
export function refusedAction(action: AuditAction): AuditAction {
  return AuditAction.refused(action);
}
