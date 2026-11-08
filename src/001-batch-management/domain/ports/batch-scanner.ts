/**
 * BatchScanner — the seam through which a batch's card is read.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A PORT, NOT A CLIENT. THE DEVICE'S CONTRACT IS NOT OURS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The scanner is an **external device with an undocumented contract** — the
 * same position the scale and the MES are in (A-05, A-10, Q-03). The Dummy
 * Scanner's `POST /api/scan` is a **training contract** behind this
 * boundary, and this unit asserts nothing about its shape.
 *
 * WHY A PORT AND NOT A CALL TO THE DEVICE
 * ---------------------------------------
 * So that a test can present a code without a scanner, and so a real
 * scanner can replace the dummy without touching the domain.
 *
 * WHY TWO OUTCOMES AND NOT THREE
 * ------------------------------
 * The scanner either produced a code, or it did not. "The code was
 * unreadable" is the same as "no code" from the operator's point of view:
 * the operator may fall back to touching the row (B-6).
 *
 * So the port does not distinguish them, and neither does the refusal: the
 * operator is told the scanner could not be read, and the fallback is
 * available.
 */

/**
 * What the scanner produced.
 *
 * `NO_CODE` carries the **diagnostic**, for the log only. The client is
 * told the scanner was unavailable — a code, not a sentence (NFR-11).
 */
export type ScanOutcome =
  | { readonly kind: 'CODE_READ'; readonly code: string }
  | { readonly kind: 'NO_CODE'; readonly message: string };

export interface BatchScanner {
  /**
   * Read the code the operator presented.
   *
   * @returns The outcome. A failure is **returned**, not thrown — a
   *          disconnected scanner is a normal condition (BRD FR-19).
   */
  read(): Promise<ScanOutcome>;
}
