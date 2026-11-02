/**
 * RejectionReason — why the MES refused a posting or a status write.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A CODE AND A DETAIL. THE CODE IS THE CONTRACT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * BRD NFR-11 requires externalised text: the API emits **codes**, and the
 * UI owns the text. So `code` is a closed set — a consumer branches on
 * it — and `detail` is the MES's own diagnostic text, for the log and
 * for the operator who has to act on it.
 *
 * THE DETAIL IS BOUNDED
 * ---------------------
 * The MES is an external system whose behaviour is unconfirmed (A-01,
 * A-02). An unbounded diagnostic string is an unbounded row, an
 * unbounded log line and an unbounded response. 500 characters is enough
 * to diagnose a rejection and short enough to keep all three readable.
 */

/** The longest detail that will be stored or returned. */
export const MAX_REJECTION_DETAIL_LENGTH = 500;

/**
 * The reasons a rejection may carry.
 *
 * These are **our** codes, not the MES's. The MES's reason is mapped
 * into one of these, so that a consumer has a closed set to branch on
 * even though the MES's vocabulary is unknown.
 *
 * `UNMAPPED` is the important one: it is what a rejection the seam does
 * not recognise becomes. It is a first-class member rather than a
 * fallback, so that an unrecognised MES reason is **visible** as
 * "unrecognised" rather than silently mapped onto something that reads
 * as understood.
 */
export type RejectionCode =
  | 'BATCH_NOT_POSTABLE'
  | 'BATCH_ALREADY_WEIGHED'
  | 'QUANTITY_OUT_OF_RANGE'
  | 'UNKNOWN_COMPONENT'
  | 'INVALID_LOT'
  | 'UNMAPPED';

export const REJECTION_CODES: readonly RejectionCode[] = [
  'BATCH_NOT_POSTABLE',
  'BATCH_ALREADY_WEIGHED',
  'QUANTITY_OUT_OF_RANGE',
  'UNKNOWN_COMPONENT',
  'INVALID_LOT',
  'UNMAPPED',
];

export class RejectionReason {
  private constructor(
    readonly code: RejectionCode,
    readonly detail: string,
  ) {}

  /**
   * Build a rejection reason.
   *
   * The detail is truncated rather than rejected. A rejection with an
   * over-long detail is still a rejection, and refusing it would lose
   * the rejection itself — which is worse than losing the tail of its
   * message.
   */
  static of(code: RejectionCode, detail: string): RejectionReason {
    return new RejectionReason(code, truncate(detail));
  }

  /**
   * Build a reason for a rejection the seam does not recognise.
   *
   * The detail is kept — it is the only evidence of what the MES said —
   * but the code says plainly that the seam did not understand it.
   */
  static unmapped(detail: string): RejectionReason {
    return new RejectionReason('UNMAPPED', truncate(detail));
  }

  equals(other: RejectionReason): boolean {
    return this.code === other.code && this.detail === other.detail;
  }
}

/**
 * Truncate a detail to the bound.
 *
 * The truncation is marked, so a reader can tell that text was cut — a
 * silently shortened message reads as a complete one.
 */
function truncate(detail: string): string {
  if (detail.length <= MAX_REJECTION_DETAIL_LENGTH) {
    return detail;
  }
  return `${detail.slice(0, MAX_REJECTION_DETAIL_LENGTH)}… [truncated]`;
}
