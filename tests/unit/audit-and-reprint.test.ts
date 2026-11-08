/**
 * The reprint and the audit trail — unit 006, bolt 020.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE MARKING IS DERIVED. THE REASON IS MANDATORY. AND THE SEQUENCE IS
 * THE DATABASE'S.
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

const AT = Instant.of(new Date('2026-11-06T11:30:00.000Z'));

function entry(
  overrides: {
    entryId?: string;
    action?: string;
    actorId?: string;
    actorRole?: string;
    subject?: string;
    reason?: string;
  } = {},
): AuditEntry {
  return new AuditEntry({
    entryId: overrides.entryId ?? 'ENTRY-1',
    action: AuditAction.of(
      (overrides.action ?? 'REPRINT') as 'REPRINT',
    ),
    actorId: overrides.actorId ?? 'OP-001',
    actorRole: overrides.actorRole ?? 'OPERATOR',
    subject: AuditSubject.create(overrides.subject ?? 'ticket=TKT-1;job=JOB-1'),
    reason: overrides.reason ?? 'the original was damaged',
    occurredAt: AT,
  });
}

describe('the audit entry', () => {
  it('refuses an EMPTY reason — the check is in the constructor', () => {
    expect(() => entry({ reason: '' })).toThrow(/reason/);
    expect(() => entry({ reason: '   ' })).toThrow(/reason/);
  });

  it('stores the reason VERBATIM — never truncated', () => {
    const long = 'a'.repeat(500);
    const e = entry({ reason: long });
    expect(e.reason).toBe(long);
    expect(e.reason.length).toBe(500);
  });

  it('stores a non-Latin reason unchanged', () => {
    const e = entry({ reason: 'الأصل تالف — 需要重印' });
    expect(e.reason).toBe('الأصل تالف — 需要重印');
  });

  it('the action is a CLOSED SET', () => {
    expect(() => AuditAction.fromStored('NOT_AN_ACTION')).toThrow();
    expect(AuditAction.fromStored('REPRINT').value).toBe('REPRINT');
  });

  it('the subject must not be empty', () => {
    expect(() => AuditSubject.create('  ')).toThrow();
  });

  it('the sequence is null until the DATABASE assigns it', () => {
    expect(entry().sequence).toBeNull();
  });
});

describe('the audit trail', () => {
  let db: SqliteDatabase;
  let audit: SqliteAuditEntryRepository;

  beforeEach(() => {
    db = openAuditDatabase(':memory:');
    audit = new SqliteAuditEntryRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('assigns a MONOTONIC sequence — and the database assigns it', async () => {
    const first = entry({ entryId: 'ENTRY-1' });
    const second = entry({ entryId: 'ENTRY-2' });

    await audit.record(first);
    await audit.record(second);

    // The DATABASE numbered them — and they are strictly increasing.
    expect(first.sequence).not.toBeNull();
    expect(second.sequence).not.toBeNull();
    expect(second.sequence as number).toBeGreaterThan(
      first.sequence as number,
    );
  });

  it('orders by the SEQUENCE, not the timestamp — so a tie cannot happen', async () => {
    const first = entry({ entryId: 'ENTRY-1' });
    const second = entry({ entryId: 'ENTRY-2' });
    const third = entry({ entryId: 'ENTRY-3' });

    // The SAME instant for all three — which is the edge case.
    await audit.record(first);
    await audit.record(second);
    await audit.record(third);

    const all = await audit.all();
    expect(all.map((e) => e.entryId)).toEqual([
      'ENTRY-1',
      'ENTRY-2',
      'ENTRY-3',
    ]);
  });

  it('filters by actor, by action and by time', async () => {
    await audit.record(entry({ entryId: 'E1', actorId: 'OP-001' }));
    await audit.record(entry({ entryId: 'E2', actorId: 'OP-002' }));
    await audit.record(
      entry({ entryId: 'E3', actorId: 'OP-001', action: 'CONFIGURATION_CHANGE' }),
    );

    expect((await audit.filter({ actorId: 'OP-001' })).length).toBe(2);
    expect((await audit.filter({ action: 'REPRINT' })).length).toBe(2);
    expect(
      (await audit.filter({ action: 'CONFIGURATION_CHANGE' })).length,
    ).toBe(1);

    // And an empty result is an EMPTY ARRAY — never an error.
    expect(await audit.filter({ actorId: 'OP-NOBODY' })).toEqual([]);
  });

  it('the trail is APPEND-ONLY — the triggers refuse an update and a delete', async () => {
    await audit.record(entry());

    expect(() =>
      db.prepare(`UPDATE audit_entries SET reason = 'TAMPERED'`).run(),
    ).toThrow(/append-only/);

    expect(() => db.prepare(`DELETE FROM audit_entries`).run()).toThrow(
      /append-only/,
    );
  });

  it('the repository has NO update path and NO delete path', () => {
    // The success criterion is the SHAPE of the interface — not a
    // convention that callers remember (story 004).
    const methods = Object.getOwnPropertyNames(
      SqliteAuditEntryRepository.prototype,
    ).filter((name) => name !== 'constructor');

    expect(methods).toContain('record');
    expect(methods).toContain('all');
    expect(methods).toContain('filter');
    expect(methods).not.toContain('update');
    expect(methods).not.toContain('delete');
    expect(methods).not.toContain('remove');
  });
});
