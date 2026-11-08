/**
 * AuditEntry — the append-only record of a privileged action.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE TRAIL'S ORDER IS THE SEQUENCE, AND THE SEQUENCE IS THE DATABASE'S.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The entries carry a `sequence` alongside `occurredAt` — *"so ordering
 * survives clock skew — the sequence is authoritative for order, the
 * timestamp for human reading."*
 *
 * **And the sequence is assigned by the DATABASE**, because a counter the
 * application increments is racy: two concurrent privileged actions would
 * read the same value, and the trail would record a **tie** (ADR-043).
 *
 * THE REASON IS NEVER EMPTY
 * -------------------------
 * An audit entry with no reason cannot demonstrate justification, and
 * justification is what FR-21 exists to require. So the constructor
 * refuses one — the check is in the constructor, so a call site cannot
 * forget it.
 *
 * AND THE REASON IS IN CLEAR TEXT
 * -------------------------------
 * It is a record, not a credential: it authorises nothing, and it must be
 * readable by an auditor five years later (ADR-005).
 */
import { Instant } from '../../../004-scale-integration/domain/value-objects/instant.js';

/**
 * The privileged actions.
 *
 * **DERIVED FROM THE BRD's OWN CONSTRAINTS**, not from an invented
 * taxonomy: supervisor tolerance override, manual scale reselection,
 * calibration bypass (BRD FR-35), configuration changes (BRD FR-22), and
 * reprints (BRD FR-28).
 *
 * And it is a **closed set** — the database carries a matching `CHECK`
 * constraint, so the bound is enforced by the type system AND by the
 * storage layer.
 */
export const AUDIT_ACTION_TOLERANCE_OVERRIDE = 'TOLERANCE_OVERRIDE';
export const AUDIT_ACTION_MANUAL_SCALE_RESELECTION = 'MANUAL_SCALE_RESELECTION';
export const AUDIT_ACTION_CALIBRATION_BYPASS = 'CALIBRATION_BYPASS';
export const AUDIT_ACTION_CONFIGURATION_CHANGE = 'CONFIGURATION_CHANGE';
export const AUDIT_ACTION_REPRINT = 'REPRINT';

/**
 * THE REFUSAL VARIANTS.
 *
 * **A refusal is the SAME action, refused** — and it is a **distinct
 * value**, because a query must not overstate what happened.
 *
 * If a refusal were recorded as a successful `REPRINT` with a reason
 * reading "no reason was given", then a query for `action=REPRINT` would
 * return the refusals too — and the trail would appear to record a
 * reprint that never happened (ADR-044).
 *
 * **And the set is DERIVED**, not invented per case: the privileged
 * actions come from the BRD's own constraints, and a refusal is one of
 * them, refused.
 */
export const AUDIT_REFUSED_SUFFIX = '_REFUSED';

export const AUDIT_ACTION_NAMES = [
  AUDIT_ACTION_TOLERANCE_OVERRIDE,
  AUDIT_ACTION_MANUAL_SCALE_RESELECTION,
  AUDIT_ACTION_CALIBRATION_BYPASS,
  AUDIT_ACTION_CONFIGURATION_CHANGE,
  AUDIT_ACTION_REPRINT,
] as const;

export type AuditActionValue = (typeof AUDIT_ACTION_NAMES)[number];

/** The action, refused. */
export type AuditRefusedActionValue = `${AuditActionValue}${typeof AUDIT_REFUSED_SUFFIX}`;

/** Every action the trail can hold — performed, or refused. */
export const AUDIT_ALL_ACTION_NAMES: readonly string[] = [
  ...AUDIT_ACTION_NAMES,
  ...AUDIT_ACTION_NAMES.map((name) => `${name}${AUDIT_REFUSED_SUFFIX}`),
];

export class AuditAction {
  private constructor(readonly value: AuditActionValue | AuditRefusedActionValue) {}

  static of(value: AuditActionValue): AuditAction {
    return new AuditAction(value);
  }

  /**
   * Reconstruct an action from persisted data.
   *
   * **This THROWS on an unknown value** rather than defaulting — defaulting
   * would silently widen the set of privileged actions.
   */
  static fromStored(raw: string): AuditAction {
    if ((AUDIT_ALL_ACTION_NAMES as readonly string[]).includes(raw)) {
      return new AuditAction(raw as AuditActionValue);
    }
    throw new Error(`Unknown audit action: ${raw}`);
  }

  /**
   * The action, **refused**.
   *
   * **Derived** — the action plus the suffix — so a refusal is always
   * distinguishable from the action performed.
   */
  static refused(action: AuditAction): AuditAction {
    return new AuditAction(
      `${action.value}${AUDIT_REFUSED_SUFFIX}` as AuditRefusedActionValue,
    );
  }

  /**
   * Is this action a REFUSED one?
   */
  isRefused(): boolean {
    return this.value.endsWith(AUDIT_REFUSED_SUFFIX);
  }

  equals(other: AuditAction): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

/**
 * The subject an audit entry acts upon.
 *
 * **Opaque to the mechanism** — it is compared and stored, and nothing
 * parses it. For a reprint it names the ticket and the original print job.
 */
export class AuditSubject {
  private constructor(readonly value: string) {}

  static create(raw: string): AuditSubject {
    const value = raw.trim();
    if (value.length === 0) {
      throw new Error('An audit subject must not be empty');
    }
    if (value.length > 512) {
      throw new Error('An audit subject must not exceed 512 characters');
    }
    return new AuditSubject(value);
  }

  equals(other: AuditSubject): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

export interface AuditEntryInit {
  /** The entry's own id — a uuid. */
  readonly entryId: string;
  /** Which privileged action. */
  readonly action: AuditAction;
  /** Who did it. */
  readonly actorId: string;
  /**
   * The actor's role.
   *
   * **It records whoever pressed the button, which may be the operator** —
   * a reprint is privileged but does not require supervisor
   * authentication in this build (BRD FR-35).
   */
  readonly actorRole: string;
  /** What was acted upon. */
  readonly subject: AuditSubject;
  /** The reason — **never empty**, and stored verbatim. */
  readonly reason: string;
  /** When it happened. */
  readonly occurredAt: Instant;
}

export class AuditEntry {
  /**
   * The trail's authoritative order.
   *
   * **`null` until the row is written** — the sequence is the DATABASE's
   * to assign, because an application-side counter is racy (ADR-043).
   */
  sequence: number | null = null;

  constructor(private readonly init: AuditEntryInit) {
    // THE REASON IS NEVER EMPTY. The check is in the constructor, so a
    // call site cannot forget it.
    if (init.reason.trim().length === 0) {
      throw new Error('An audit entry must carry a reason');
    }
  }

  get entryId(): string {
    return this.init.entryId;
  }

  get action(): AuditAction {
    return this.init.action;
  }

  get actorId(): string {
    return this.init.actorId;
  }

  get actorRole(): string {
    return this.init.actorRole;
  }

  get subject(): AuditSubject {
    return this.init.subject;
  }

  /** The reason — **verbatim**. Never truncated. */
  get reason(): string {
    return this.init.reason;
  }

  get occurredAt(): Instant {
    return this.init.occurredAt;
  }
}
