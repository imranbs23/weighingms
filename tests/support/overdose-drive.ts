/**
 * The over-dose's setup — shared by the escalation's tests.
 *
 * ══════════════════════════════════════════════════════════════════════
 * DRIVING A REAL OVER-DOSE, WITHOUT GUESSING.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The escalation only exists for a **non-compensable** over-dose, so a test
 * has to produce one: the **last** component of the recipe (which has no
 * remaining components to absorb the surplus), with the scale's ramp driven
 * past the tolerance band.
 *
 * And the drive needs care, because the device reports in **grams** while
 * the component's target is in **kilograms** — the station converts the
 * reading into the component's unit before it compares. So the ramp is
 * driven with the target **expressed in the device's own unit**, which is
 * what the device will actually be asked to reach.
 *
 * And the ramp advances **per sample**, so the helper **waits** for the
 * zone to become `OVER` rather than assuming a number of samples — and
 * reports what it saw when it does not arrive.
 */
import request from 'supertest';
import type { Harness } from '../harness.js';

/** The component the over-dose is driven on — the recipe's LAST. */
export const OVERDOSE_COMPONENT = 'AUX-0107';

/** The device that component demands. */
export const OVERDOSE_SCALE = 'SCALE-B';

/**
 * Convert a quantity into the **device's** unit — grams.
 *
 * The device reports in grams, and the component's target carries the unit
 * the MES supplied: grams for the dyestuffs, kilograms for the auxiliaries.
 * So the conversion depends on the component's own unit — a blanket factor
 * would be wrong for half the recipe.
 */
function toGrams(text: string, unit: string): number {
  return unit === 'kg' ? Number(text) * 1000 : Number(text);
}

/**
 * Drive the Dummy scale's ramp to a component's target, and wait for the
 * session to see it.
 *
 * The device reports in **grams** while the component's target may be in
 * **kilograms** — the station converts the reading into the component's
 * unit before it compares. So the ramp is driven with the target
 * **expressed in the device's own unit**, which is what the device will
 * actually be asked to reach.
 *
 * And the tolerance is the **band's width** — not its upper edge — because
 * the ramp's landing is `target + tolerance × rate`, and the band is
 * `target ± half its width`.
 *
 * @param landing `IN_TOLERANCE` for the target, `OVER_TOLERANCE` for the
 *   over-dose.
 */
export async function dispenseToTarget(
  harness: Harness,
  token: string,
  componentIdValue: string,
  landing: 'IN_TOLERANCE' | 'OVER_TOLERANCE',
  scaleId: string = OVERDOSE_SCALE,
): Promise<void> {
  const component = harness.recipeWorkingCopy
    .current()
    ?.componentById(componentIdValue);
  if (component === undefined || component === null) {
    throw new Error(`the recipe holds no component ${componentIdValue}`);
  }

  const unit = component.target.unit;
  const target = toGrams(component.target.text, unit);
  const bandWidth =
    component.tolerance === null || component.tolerance === undefined
      ? 0
      : toGrams(
          (
            Number(component.tolerance.max.text) -
            Number(component.tolerance.min.text)
          ).toFixed(4),
          unit,
        );

  await request(harness.app)
    .post(`/api/scales/${scaleId}/dispense`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      target: target.toFixed(4),
      tolerance: bandWidth.toFixed(4),
      landing,
    });

  // The ramp advances PER SAMPLE, and its step shrinks as it converges
  // (`max(target × 0.004, remaining × 0.055)`), so the last grams take
  // the longest. The wait is generous for that reason — and it WAITS for
  // the band rather than assuming a sample count.
  //
  // AND IT WAITS FOR THE BAND THE CALLER ASKED FOR: `IN_TOLERANCE` needs
  // `OK`, and `OVER_TOLERANCE` needs `OVER`. A `NEAR` is not enough —
  // the gate refuses it, and a helper that returned on `NEAR` would hand
  // the caller a confirmation that is refused.
  const wanted = landing === 'OVER_TOLERANCE' ? 'OVER' : 'OK';

  for (let attempt = 0; attempt < 400; attempt += 1) {
    const zone = await request(harness.app)
      .get('/api/session/zone')
      .set('Authorization', `Bearer ${token}`);
    if (zone.body.zone === wanted) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const zone = await request(harness.app)
    .get('/api/session/zone')
    .set('Authorization', `Bearer ${token}`);
  const weight = await request(harness.app)
    .get('/api/session/weight')
    .set('Authorization', `Bearer ${token}`);
  throw new Error(
    `the zone never reached a band: zone=${JSON.stringify(zone.body)} weight=${JSON.stringify(weight.body)}`,
  );
}

/**
 * Drive the Dummy scale's ramp to an over-dose landing, and wait for the
 * session to see it.
 *
 * @throws When the zone never reaches `OVER` — and the message carries
 *         what it saw, so the failure is a diagnosis and not a guess.
 */
export async function dispenseOverTolerance(
  harness: Harness,
  token: string,
): Promise<void> {
  await dispenseToTarget(harness, token, OVERDOSE_COMPONENT, 'OVER_TOLERANCE');
}
