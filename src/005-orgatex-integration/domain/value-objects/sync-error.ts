/**
 * SyncError — a bounded diagnostic for a failed contact or a failed
 * delivery.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A CODE AND A SUMMARY FOR THE CLIENT. A DETAIL FOR THE LOG.
 * ══════════════════════════════════════════════════════════════════════
 *
 * BRD NFR-11 requires externalised text: the API emits **codes**, and the
 * UI owns the text. IR-09 says the failure is diagnosable **without** MES
 * access — and that means the LOG carries the detail, not the response.
 *
 * So this type carries **two** strings:
 *
 * - `summary` — bounded, safe to return to a client.
 * - `detail`  — bounded, for the log and for the operator who has to act.
 *
 * The client never sees `detail`. `toClient()` is the only projection the
 * presentation layer uses, and it does not carry one.
 *
 * WHY TWO STRINGS AND NOT ONE
 * ---------------------------
 * Because the existing `RejectionReason` has one string, and that string
 * is the MES's own diagnostic text — which the write path already returns
 * to the client under `detail` with a 500-character bound. That is a
 * different question: the rejection is a **definitive** answer about a
 * consumption, and the operator is told its code.
 *
 * A link error is different in kind. It says *"we could not reach the
 * MES"*, and the useful operator-facing fact is which kind of failure it
 * was — unreachable, timed out, rejected, malformed — not the adapter's
 * prose. So the code carries the contract, the summary carries a short
 * human-readable gloss, and the detail stays in the log.
 *
 * THE BOUND IS MARKED WHEN IT BITES
 * ---------------------------------
 * A truncated message is **marked**, so a reader can tell the text was
 * cut. A silently shortened message reads as a complete one, and the
 * operator acts on a diagnosis that is missing its tail.
 */

/** The longest detail that will be stored or returned. */
export const MAX_SYNC_ERROR_DETAIL_LENGTH = 500;

/** The longest summary that will be stored or returned. */
export const MAX_SYNC_ERROR_SUMMARY_LENGTH = 120;

/**
 * The kinds of failure a contact or a delivery can have.
 *
 * A **closed set**, so a consumer branches on it rather than on a
 * string. `UNREACHABLE`, `TIMEOUT` and `MALFORMED` mirror the adapter's
 * own `AdapterFailureReason`; `REJECTED` is the MES's definitive refusal.
 */
export type SyncErrorCode =
  | 'UNREACHABLE'
  | 'TIMEOUT'
  | 'REJECTED'
  | 'MALFORMED';

export const SYNC_ERROR_CODES: readonly SyncErrorCode[] = [
  'UNREACHABLE',
  'TIMEOUT',
  'REJECTED',
  'MALFORMED',
];

export function isSyncErrorCode(value: unknown): value is SyncErrorCode {
  return (
    typeof value === 'string' &&
    (SYNC_ERROR_CODES as readonly string[]).includes(value)
  );
}

export class SyncError {
  private constructor(
    readonly code: SyncErrorCode,
    readonly summary: string,
    readonly detail: string,
  ) {}

  /**
   * Build a sync error.
   *
   * Both strings are truncated rather than rejected. A failure with an
   * over-long diagnostic is still a failure, and refusing it would lose
   * the failure itself — which is worse than losing the tail of its
   * message.
   */
  static of(
    code: SyncErrorCode,
    summary: string,
    detail: string,
  ): SyncError {
    return new SyncError(
      code,
      truncate(summary, MAX_SYNC_ERROR_SUMMARY_LENGTH),
      truncate(detail, MAX_SYNC_ERROR_DETAIL_LENGTH),
    );
  }

  /**
   * Build an error from an adapter failure.
   *
   * The adapter's reason is already a closed set, so it maps directly.
   * `NOT_FOUND` is not among them — a `NOT_FOUND` is a **successful**
   * contact that produced no record, so it never becomes a link error.
   */
  static fromAdapterReason(
    reason: 'UNREACHABLE' | 'TIMEOUT' | 'MALFORMED',
    detail: string,
  ): SyncError {
    return SyncError.of(reason, defaultSummary(reason), detail);
  }

  /**
   * The client-safe projection.
   *
   * The code and the summary only — **never** the detail (NFR-11).
   */
  toClient(): { readonly code: SyncErrorCode; readonly summary: string } {
    return { code: this.code, summary: this.summary };
  }

  /**
   * Did this failure mean the MES could not be **reached**?
   *
   * ══════════════════════════════════════════════════════════════════════
   * WHY THE CODE, AND NOT THE LINK STATUS, DECIDES REACHABILITY
   * ══════════════════════════════════════════════════════════════════════
   *
   * A `REJECTED` contact is a **reachable** MES: it answered, and the
   * answer was a refusal. So is a `MALFORMED` one — it answered, and the
   * answer was unusable.
   *
   * An `UNREACHABLE` or `TIMEOUT` contact is the opposite: there was no
   * answer, so there is nothing to talk to.
   *
   * This distinction is what makes the re-drive usable. A posting that
   * the MES **refused** is exactly the one an operator most needs to
   * re-drive — they have fixed the lot number, the quantity, whatever the
   * MES objected to. Refusing that re-drive because "the last contact
   * failed" would refuse the one case a re-drive exists for.
   */
  meansUnreachable(): boolean {
    return this.code === 'UNREACHABLE' || this.code === 'TIMEOUT';
  }

  equals(other: SyncError): boolean {
    return (
      this.code === other.code &&
      this.summary === other.summary &&
      this.detail === other.detail
    );
  }
}

/**
 * The default summary for a failure kind.
 *
 * Short, stable, and free of the adapter's internals — it is what the
 * operator sees, so it says what happened rather than what failed.
 */
function defaultSummary(
  code: 'UNREACHABLE' | 'TIMEOUT' | 'MALFORMED',
): string {
  switch (code) {
    case 'UNREACHABLE':
      return 'OrgaTEX could not be reached';
    case 'TIMEOUT':
      return 'OrgaTEX did not answer in time';
    case 'MALFORMED':
      return 'OrgaTEX returned an unusable response';
  }
}

/**
 * Truncate to the bound, and MARK the truncation.
 *
 * The marker is what distinguishes a cut message from a complete one.
 */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… [truncated]`;
}
