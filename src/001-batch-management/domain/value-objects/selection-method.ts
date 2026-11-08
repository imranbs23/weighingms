/**
 * SelectionMethod — how the operator chose the batch.
 *
 * ══════════════════════════════════════════════════════════════════════
 * TWO VALUES, AND THE CLOSURE IS THE POINT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `SCAN` means the operator presented the batch's card to the scanner.
 * `TOUCH` means the operator selected the row in the displayed queue.
 *
 * The two are **not cosmetic**. A scan is a physical act at a device; a
 * touch is a physical act at the screen. They have different traceability
 * meaning, and BRD FR-02 asks for the method to be *recorded* for exactly
 * that reason.
 *
 * WHY THE METHOD IS NEVER SUPPLIED BY THE CLIENT
 * ----------------------------------------------
 * The method is **derived** from the shape of the request — a `code` came
 * from the scanner, a `batchId` came from a touched row — and there is no
 * `selectionMethod` field anywhere in the boundary schema (ADR-030).
 *
 * A client that could choose the method could record a scan that never
 * happened, and the record is **immutable** (ADR-029) — a false claim in a
 * traceability record can only ever be contradicted, never corrected.
 */
export type SelectionMethod = 'SCAN' | 'TOUCH';

export const SELECTION_METHODS: readonly SelectionMethod[] = [
  'SCAN',
  'TOUCH',
];

/**
 * Is this a selection method this product records?
 *
 * Used by the storage layer's own guard, and by a test that asserts the set
 * is closed.
 */
export function isSelectionMethod(value: unknown): value is SelectionMethod {
  return (
    typeof value === 'string' &&
    (SELECTION_METHODS as readonly string[]).includes(value)
  );
}
