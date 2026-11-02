/**
 * The scale class a component **demands**.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THIS IS NOT THE SCALE UNIT'S `ScaleClass`, AND THE DIFFERENCE IS THE POINT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The scale unit's `ScaleClass` is a property of a **device** — "this
 * indicator is a precision scale". This one is a property of a
 * **requirement** — "this component needs precision".
 *
 * They are allowed to DISAGREE, and that disagreement is the whole subject
 * of unit `004`'s selection rule (ADR-017): a 4 kg component that demands
 * precision cannot be weighed on a 3 kg precision scale, so the floor scale
 * is selected and the conflict is recorded in the reason.
 *
 * If one type served both roles, a consumer could read a demand as a
 * device fact. Two types, mapped at one chokepoint, keep the two meanings
 * apart.
 */
export type DemandedScaleClass = 'PRECISION' | 'FLOOR';

export const DEMANDED_SCALE_CLASSES: readonly DemandedScaleClass[] = [
  'PRECISION',
  'FLOOR',
];

/**
 * Is this a scale class the seam understands?
 *
 * The MES is an external system whose vocabulary is not ours. When it
 * introduces a class we do not know, the answer is **no** — and the reader
 * refuses the record rather than dropping the class silently.
 *
 * A component whose class was silently dropped would be weighed on a device
 * chosen without the constraint that was supposed to apply. Refusing the
 * whole read is loud; dropping the constraint is quiet.
 */
export function isDemandedScaleClass(value: unknown): value is DemandedScaleClass {
  return (
    typeof value === 'string' &&
    (DEMANDED_SCALE_CLASSES as readonly string[]).includes(value)
  );
}
