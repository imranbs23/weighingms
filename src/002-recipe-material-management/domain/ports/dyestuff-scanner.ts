/**
 * DyestuffScanner — the seam through which a material or lot code is read.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A PORT, NOT A CLIENT. THE DEVICE'S CONTRACT IS NOT OURS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The scanner is an **external device with an undocumented contract** — the
 * same position the scale and the MES are in (A-05, A-10, Q-03). The
 * Dummy Scanner's `POST /api/scan` is a **training contract** behind this
 * boundary, and this unit asserts nothing about its shape.
 *
 * ONE DEVICE, TWO PORTS, ONE INSTANCE
 * -----------------------------------
 * Unit `001` already owns a `BatchScanner` port over the same physical
 * device. This unit declares its **own** port — because a port belongs to
 * its consumer (ADR-028) — and the composition root binds **both** ports to
 * the **same** device instance (ADR-033).
 *
 * Two adapters would mean two device states that are really one, two
 * sources of truth for "what was just scanned", and two backends behind the
 * workbook's single `POST /api/scan`.
 *
 * THE OUTCOME CARRIES ONLY A CODE
 * -------------------------------
 * The device cannot know whether a code is a batch, a material or a lot.
 * **The classification is the consumer's job** — and a code that matches
 * none of them is a **refusal naming what was expected**, not a device
 * error. The device read a code perfectly well; it did not read *our* code
 * (ADR-033).
 *
 * WHY TWO OUTCOMES AND NOT THREE
 * ------------------------------
 * The scanner either produced a code, or it did not. "The code was
 * unreadable" and "no code was presented" are the same thing from the
 * operator's point of view: the affected step is reported, and the
 * attestation path is offered (BRD FR-19, BRD IR-15, BRD IR-18).
 */

/**
 * What the scanner produced.
 *
 * `NO_CODE` carries the **diagnostic**, for the log only. The client is
 * told the scanner was unavailable — a code, not a sentence (NFR-11).
 */
export type DyestuffScanOutcome =
  | { readonly kind: 'CODE_READ'; readonly code: string }
  | { readonly kind: 'NO_CODE'; readonly message: string };

export interface DyestuffScanner {
  /**
   * Read the code the operator presented.
   *
   * @returns The outcome. A failure is **returned**, not thrown — a
   *          disconnected scanner is a normal condition (BRD FR-19).
   */
  read(): Promise<DyestuffScanOutcome>;
}
