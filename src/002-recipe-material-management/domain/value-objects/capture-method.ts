/**
 * CaptureMethod — where the lot came from.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A CLOSED SET OF THREE. THAT IS HOW CQ-08 IS ACCOMMODATED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * **CQ-08 is unanswered.** Whether containers already carry a lot barcode,
 * or the lot is keyed in, is FCI's question — and the two answers turn
 * FR-5 into different products: a scan with different error characteristics,
 * or a form.
 *
 * The story's answer is the one this type expresses: *"the lot is therefore
 * modelled as a captured value with an explicit `captureMethod` (`SOURCE` |
 * `SCAN` | `KEYED_IN`), so that all three routes are the same operation with
 * different evidence — the question can be settled by FCI without a
 * rewrite."*
 *
 * - `SOURCE` — **OrgaTEX held the lot.** The station read it through the
 *   adapter. This method has **no client request shape at all**: a client
 *   cannot claim the MES held a lot.
 * - `SCAN` — the operator scanned the container's or material's lot code.
 * - `KEYED_IN` — the operator typed the lot in.
 *
 * **AND THE METHOD IS NEVER SUPPLIED BY A CLIENT.** It is derived from the
 * request's shape (ADR-030, ADR-034): a `code` in the body means the
 * scanner read it, a `lotNumber` means the operator typed it.
 */
export type CaptureMethod = 'SOURCE' | 'SCAN' | 'KEYED_IN';

export const CAPTURE_METHODS: readonly CaptureMethod[] = [
  'SOURCE',
  'SCAN',
  'KEYED_IN',
];

/**
 * Is this a capture method?
 *
 * The storage layer carries the same closed set as a `CHECK` constraint, so
 * a value outside it cannot be written even by a path that bypasses the
 * domain. This guard is how a row is read **back** through the domain.
 */
export function isCaptureMethod(value: unknown): value is CaptureMethod {
  return (
    typeof value === 'string' &&
    (CAPTURE_METHODS as readonly string[]).includes(value)
  );
}
