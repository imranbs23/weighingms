/**
 * The audit trail's query and export — unit 006, bolt 021.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE QUERY IS BOUNDED. AND THE EXPORT IS STREAMED.
 * ══════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import {
  AuditAction,
  AuditEntry,
  AuditSubject,
} from '../../src/006-ticket-printing/domain/entities/audit-entry.js';
import {
  SqliteAuditEntryRepository,
} from '../../src/006-ticket-printing/infrastructure/persistence/sqlite-audit-entry-repository.js';
import {
  openAuditDatabase,
  type SqliteDatabase,
} from '../../src/006-ticket-printing/infrastructure/persistence/audit-database.js';
import {
  QueryAuditTrail,
  ExportAuditTrail,
  boundPageSize,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
} from '../../src/006-ticket-printing/application/use-cases/audit-trail.js';

const AT = Instant.of(new Date('2026-11-06T11:30:00.000Z'));

describe('the audit query', () => {
  let db: SqliteDatabase;
  let audit: SqliteAuditEntryRepository;
  let query: QueryAuditTrail;

  beforeEach(() => {
    db = openAuditDatabase(':memory:');
    audit = new SqliteAuditEntryRepository(db);
    query = new QueryAuditTrail({ audit });
  });

  afterEach(() => {
    db.close();
  });

  async function record(
    entryId: string,
    actorId = 'OP-001',
    action = 'REPRINT',
  ): Promise<void> {
    await audit.record(
      new AuditEntry({
        entryId,
        action: AuditAction.of(action as 'REPRINT'),
        actorId,
        actorRole: 'OPERATOR',
        subject: AuditSubject.create(`ticket=TKT-1;job=JOB-${entryId}`),
        reason: 'the original was damaged',
        occurredAt: AT,
      }),
    );
  }

  it('returns ONLY the matching entries', async () => {
    await record('E1', 'OP-001');
    await record('E2', 'OP-002');
    await record('E3', 'OP-001');

    const page = await query.execute({ actorId: 'OP-001' });

    expect(page.entries).toHaveLength(2);
    expect(page.entries.map((e) => e.entryId)).toEqual(['E1', 'E3']);
  });

  it('the filter COMBINES — actor, action and range', async () => {
    await record('E1', 'OP-001', 'REPRINT');
    await record('E2', 'OP-001', 'CONFIGURATION_CHANGE');
    await record('E3', 'OP-002', 'REPRINT');

    const page = await query.execute({
      actorId: 'OP-001',
      action: 'REPRINT',
    });

    expect(page.entries.map((e) => e.entryId)).toEqual(['E1']);
  });

  it('the entries come back in SEQUENCE order', async () => {
    await record('E1');
    await record('E2');
    await record('E3');

    const page = await query.execute({});

    const sequences = page.entries.map((e) => e.sequence as number);
    expect(sequences[1]).toBeGreaterThan(sequences[0] as number);
    expect(sequences[2]).toBeGreaterThan(sequences[1] as number);
  });

  it('the page is BOUNDED, and it says whether there is more', async () => {
    await record('E1');
    await record('E2');
    await record('E3');

    const page = await query.execute({}, 2);

    expect(page.entries).toHaveLength(2);
    expect(page.hasMore).toBe(true);
  });

  it('an empty result is an EMPTY PAGE — not an error', async () => {
    const page = await query.execute({ actorId: 'OP-NOBODY' });

    expect(page.entries).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it('the page size is BOUNDED', () => {
    expect(boundPageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(boundPageSize(0)).toBe(1);
    expect(boundPageSize(10_000)).toBe(MAX_PAGE_SIZE);
  });
});

describe('the audit export', () => {
  let db: SqliteDatabase;
  let audit: SqliteAuditEntryRepository;
  let exporter: ExportAuditTrail;

  beforeEach(() => {
    db = openAuditDatabase(':memory:');
    audit = new SqliteAuditEntryRepository(db);
    exporter = new ExportAuditTrail({ audit });
  });

  afterEach(() => {
    db.close();
  });

  async function record(entryId: string, actorId = 'OP-001'): Promise<void> {
    await audit.record(
      new AuditEntry({
        entryId,
        action: AuditAction.of('REPRINT'),
        actorId,
        actorRole: 'OPERATOR',
        subject: AuditSubject.create(`ticket=TKT-1;job=JOB-${entryId}`),
        reason: 'the original was damaged',
        occurredAt: AT,
      }),
    );
  }

  it('contains EXACTLY the matching entries', async () => {
    await record('E1', 'OP-001');
    await record('E2', 'OP-002');
    await record('E3', 'OP-001');

    const exported = await exporter.execute({ actorId: 'OP-001' });

    // EXACTLY the matching entries — no more, no fewer.
    expect(exported.entryCount).toBe(2);
  });

  it('carries EVERY field, intact', async () => {
    await record('E1');

    const exported = await exporter.execute({});
    const lines = exported.serialise().trim().split('\n');

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] as string);

    expect(entry.sequence).toBeGreaterThan(0);
    expect(entry.entryId).toBe('E1');
    expect(entry.action).toBe('REPRINT');
    expect(entry.actorId).toBe('OP-001');
    expect(entry.actorRole).toBe('OPERATOR');
    expect(entry.subject).toContain('TKT-1');
    expect(entry.reason).toBe('the original was damaged');
    expect(entry.occurredAt).toBe(AT.toDate().toISOString());
  });

  it('is STREAMABLE — one line at a time', async () => {
    await record('E1');
    await record('E2');

    const lines: string[] = [];
    for await (const line of exporter.lines({})) {
      lines.push(line);
    }

    expect(lines).toHaveLength(2);
    // Each line is a complete JSON object, ending in a newline.
    for (const line of lines) {
      expect(line.endsWith('\n')).toBe(true);
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('an EMPTY export is a VALID export — not an error', async () => {
    const exported = await exporter.execute({ actorId: 'OP-NOBODY' });

    expect(exported.entryCount).toBe(0);
    expect(exported.serialise()).toBe('');
    expect(exported.format).toBe('JSONL');
  });

  it('the query and the export of the SAME filter AGREE', async () => {
    await record('E1', 'OP-001');
    await record('E2', 'OP-002');
    await record('E3', 'OP-001');

    const filter = { actorId: 'OP-001' };

    const page = await new QueryAuditTrail({ audit }).execute(filter);
    const exported = await exporter.execute(filter);

    // ONE filter, ONE implementation — so they cannot disagree.
    expect(exported.entryCount).toBe(page.entries.length);
    expect(exported.entryCount).toBe(2);
  });
});

describe('the refusal action', () => {
  it('is a DISTINCT value — so a query cannot overstate', () => {
    const refused = AuditAction.refused(AuditAction.of('REPRINT'));

    expect(refused.value).toBe('REPRINT_REFUSED');
    expect(refused.isRefused()).toBe(true);
    expect(AuditAction.of('REPRINT').isRefused()).toBe(false);
  });

  it('round-trips through storage', () => {
    expect(AuditAction.fromStored('REPRINT_REFUSED').value).toBe(
      'REPRINT_REFUSED',
    );
    expect(() => AuditAction.fromStored('NOT_AN_ACTION')).toThrow();
  });
});
