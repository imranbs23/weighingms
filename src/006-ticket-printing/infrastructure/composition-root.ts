/**
 * The ticket-printing unit's composition root.
 *
 * ══════════════════════════════════════════════════════════════════════
 * EVERY PORT IS BOUND IN ONE PLACE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * **And the print path has NO weighing-record repository.** It reads the
 * ticket, writes the print job, and calls the printer — so a printer
 * failure **cannot** cost a weighing (B-7, ADR-042).
 */
import { randomUUID } from 'node:crypto';
import { GenerateTicket } from '../application/use-cases/generate-ticket.js';
import { PrintTicket } from '../application/use-cases/print-ticket.js';
import { ReprintTicket } from '../application/use-cases/reprint-ticket.js';
import {
  QueryAuditTrail,
  ExportAuditTrail,
} from '../application/use-cases/audit-trail.js';
import { SetConfiguration } from '../application/use-cases/set-configuration.js';
import { ResolveString } from '../application/use-cases/resolve-string.js';
import {
  BuildToleranceReport,
} from '../application/use-cases/build-tolerance-report.js';
import {
  ConfiguredShiftPattern,
} from './adapters/configured-shift-pattern.js';
import { SqliteTicketRepository } from './persistence/sqlite-ticket-repository.js';
import { SqlitePrintJobRepository } from './persistence/sqlite-print-job-repository.js';
import {
  SqliteAuditEntryRepository,
} from './persistence/sqlite-audit-entry-repository.js';
import {
  SqliteConfigurationRepository,
} from './persistence/sqlite-configuration-repository.js';
import {
  openConfigurationDatabase,
} from './persistence/configuration-database.js';
import {
  JsonLocaleBundleAdapter,
} from './adapters/json-locale-bundle-adapter.js';
import {
  openAuditDatabase,
} from './persistence/audit-database.js';
import { openTicketDatabase, type SqliteDatabase } from './persistence/ticket-database.js';
import { DummyPrinterAdapter } from './adapters/dummy-printer-adapter.js';
import type {
  BatchIdentityPort,
  PrinterPort,
  TicketConfigurationPort,
  TicketRepository,
  PrintJobRepository,
} from '../domain/ports/ticket-ports.js';
import type {
  AuditEntryRepository,
  AuditStreamRepository,
} from '../domain/ports/audit-entry-repository.js';
import type { ConfigurationRepository } from '../domain/ports/configuration-repository.js';
import type { LocaleBundleRepository } from '../domain/ports/locale-bundle-repository.js';
import type {
  BatchProgressPort,
  ReportAuditPort,
  ReportRecordsPort,
  ShiftPatternPort,
} from '../application/use-cases/build-tolerance-report.js';
import type { ConfirmedRecordsPort } from '../application/use-cases/generate-ticket.js';

export interface TicketModule {
  readonly db: SqliteDatabase;
  readonly tickets: TicketRepository;
  readonly jobs: PrintJobRepository;
  /**
   * The audit trail.
   *
   * **Append-only** — the repository has no update path and no delete
   * path, and the database's triggers abort both (ADR-043).
   */
  readonly audit: AuditEntryRepository;
  /** The trail as a CURSOR — for the export. */
  readonly auditStream: AuditStreamRepository;
  /** The configuration store — the history and its projection. */
  readonly configuration: ConfigurationRepository;
  /** The locale bundles — read at runtime. */
  readonly bundles: LocaleBundleRepository;
  /** Applying a configuration change. */
  readonly setConfiguration: SetConfiguration;
  /** Resolving one operator-facing string. */
  readonly resolveString: ResolveString;
  /** The operational report — a READ MODEL that mutates nothing. */
  readonly buildToleranceReport: BuildToleranceReport;
  /** The station's own batch progress — the report's third read. */
  readonly reportProgress: BatchProgressPort;
  /** The shift pattern — a named shift resolves to a range. */
  readonly shifts: ShiftPatternPort;
  /** The trail's query. */
  readonly queryAuditTrail: QueryAuditTrail;
  /** The trail's export — STREAMED. */
  readonly exportAuditTrail: ExportAuditTrail;
  readonly printer: PrinterPort;
  /**
   * The training printer — the **concrete** adapter.
   *
   * Exposed so a test can make it fail on purpose, and prove that a
   * printer failure does not cost a weighing (B-7). The `printer` port is
   * what the product talks to; this is what a test reaches for.
   */
  readonly trainingPrinter: DummyPrinterAdapter;
  readonly generateTicket: GenerateTicket;
  readonly printTicket: PrintTicket;
  readonly reprintTicket: ReprintTicket;
  close(): void;
}

export interface BuildTicketOptions {
  /** The session — unit 003's live state. */
  readonly sessions: {
    current(): Promise<{
      readonly sessionId: string;
      readonly batchId: { readonly value: string };
      readonly state: string;
      readonly operatorId: { readonly value: string };
      readonly completedCount: number;
      readonly componentCount: number;
    } | null>;
  };
  /** The confirmed records — unit 003's. */
  readonly records: ConfirmedRecordsPort;
  /** The batch's identity — unit 001's. */
  readonly batchIdentity: BatchIdentityPort;
  /** The template and the language — the configuration's. */
  readonly configuration: TicketConfigurationPort;
  /** The database path. */
  readonly databasePath: string;
  /** An existing database, so the units can share one file. */
  readonly db?: SqliteDatabase;
  /** Override the printer — used by tests to make it fail. */
  readonly printer?: PrinterPort;
  /** Where the locale bundles live — they are FILES. */
  readonly localeDirectory: string;
  /** The default locale — the fallback's source. */
  readonly defaultLocale: string;
  /**
   * Whether a scope exists.
   *
   * An override applied to a scope that does not exist is REFUSED, and no
   * version is bumped — so the station must be able to check.
   */
  readonly scopeExists: (scope: string) => boolean | Promise<boolean>;
  /** The records' period-scoped read — the report's first read. */
  readonly reportRecords: ReportRecordsPort;
  /** The trail's period-scoped read — the report's second read. */
  readonly reportAudit: ReportAuditPort;
  /** The station's own batch progress — the report's third read. */
  readonly reportProgress: BatchProgressPort;
  /** The station's shift pattern. */
  readonly shifts: readonly {
    readonly name: string;
    readonly startHour: number;
    readonly endHour: number;
  }[];
  /** The clock. */
  readonly clock?: () => Date;
  /** Where a failure's diagnostic goes. */
  readonly onError?: (detail: string) => void;
}

export function buildTicketModule(options: BuildTicketOptions): TicketModule {
  const clock = options.clock ?? (() => new Date());

  const db = openTicketDatabase(options.databasePath, options.db);
  const tickets = new SqliteTicketRepository(db, clock);
  const jobs = new SqlitePrintJobRepository(db, clock);
  const trainingPrinter = new DummyPrinterAdapter();
  const printer: PrinterPort = options.printer ?? trainingPrinter;

  // THE AUDIT TRAIL. Its own database, its own migrations — and the
  // sequence is assigned by the DATABASE (ADR-043).
  const auditDb = openAuditDatabase(options.databasePath, options.db);
  const audit = new SqliteAuditEntryRepository(auditDb, clock);

  const generateTicket = new GenerateTicket({
    sessions: options.sessions,
    records: options.records,
    tickets,
    batchIdentity: options.batchIdentity,
    configuration: options.configuration,
    clock,
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  });

  const printTicket = new PrintTicket({
    tickets,
    jobs,
    printer,
    clock,
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  });

  // THE CONFIGURATION. Its own database, its own migrations — and the
  // history is the truth, the effective value a projection (ADR-045).
  const configurationDb = openConfigurationDatabase(
    options.databasePath,
    options.db,
  );
  const configuration = new SqliteConfigurationRepository(
    configurationDb,
    clock,
  );

  // THE LOCALE BUNDLES. Files, read at runtime — so a language is
  // changeable without a redeployment (BRD NFR-11, NFR-14).
  const bundles = new JsonLocaleBundleAdapter({
    directory: options.localeDirectory,
    defaultLocale: options.defaultLocale,
  });

  const setConfiguration = new SetConfiguration({
    configuration,
    audit,
    scopeExists: options.scopeExists,
    clock,
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  });

  const resolveString = new ResolveString({ bundles });

  // THE REPORT. Its collaborators are the READ sides only — and there is
  // no `record` call anywhere in its path, so it cannot write (ADR-046).
  const shifts = new ConfiguredShiftPattern(options.shifts);
  const buildToleranceReport = new BuildToleranceReport({
    records: options.reportRecords,
    audit: options.reportAudit,
    progress: options.reportProgress,
    shifts,
  });

  const queryAuditTrail = new QueryAuditTrail({ audit });
  const exportAuditTrail = new ExportAuditTrail({ audit });

  const reprintTicket = new ReprintTicket({
    tickets,
    jobs,
    audit,
    print: printTicket,
    clock,
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  });

  return {
    db,
    tickets,
    jobs,
    audit,
    auditStream: audit,
    configuration,
    bundles,
    setConfiguration,
    resolveString,
    buildToleranceReport,
    reportProgress: options.reportProgress,
    shifts,
    queryAuditTrail,
    exportAuditTrail,
    printer,
    trainingPrinter,
    generateTicket,
    printTicket,
    reprintTicket,
    close: () => {
      // The database is shared with the other units, so it is not closed
      // here — the caller that opened it closes it.
    },
  };
}

/**
 * A fresh id — the ticket's and the job's.
 */
export function newId(): string {
  return randomUUID();
}
