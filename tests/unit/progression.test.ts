/**
 * The progression — unit 003, bolt 017.
 *
 * ══════════════════════════════════════════════════════════════════════
 * ONE TRANSITION. THE CONFIRMED COMPONENT BECOMES `DONE`, AND THE NEXT
 * `PENDING` IN RECIPE ORDER BECOMES `ACTIVE`.
 * ══════════════════════════════════════════════════════════════════════
 *
 * What is under test:
 *
 *   - the confirmed component becomes `DONE`
 *   - the next `PENDING` in **recipe order** becomes `ACTIVE`
 *   - exactly one component is `ACTIVE` at a time
 *   - the last component's confirmation is `COMPLETED` — a distinct outcome
 *   - `DONE` is terminal
 *   - a component that is not the active one cannot be confirmed
 */
import { describe, it, expect } from 'vitest';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';
import { WeightValue } from '../../src/004-scale-integration/domain/value-objects/weight-value.js';
import { OperatorId } from '../../src/008-operator-identity/domain/value-objects/operator-id.js';
import { ComponentId } from '../../src/005-orgatex-integration/domain/value-objects/identifiers.js';
import { WeighingSession } from '../../src/003-weighing-station/domain/entities/weighing-session.js';
import type { ComponentProgress } from '../../src/003-weighing-station/domain/entities/weighing-session.js';

const AT = Instant.of(new Date('2026-11-06T09:41:07.000Z'));
const OPERATOR = OperatorId.create('OP-001');

/** The recipe's order — the MES's, and read-only. */
const RECIPE = ['DYE-4471-Y', 'DYE-4471-B', 'AUX-0101', 'AUX-0107'];

function componentId(value: string): ComponentId {
  return ComponentId.create(value);
}

/** A session with the recipe's components, the first one active. */
function sessionWith(active = 'DYE-4471-Y'): WeighingSession {
  const components: ComponentProgress[] = RECIPE.map((id) => ({
    componentId: componentId(id),
    state: id === active ? 'ACTIVE' : 'PENDING',
  }));

  const session = new WeighingSession({
    sessionId: 'WS-1',
    batchId: { value: 'B-24187' } as never,
    operatorId: OPERATOR,
    startedAt: AT,
    components,
  });

  // The active component is established by SELECTING it — which is how
  // it happens in the product (bolt 013).
  session.selectComponent(componentId(active), { value: 'SCALE-A' } as never);

  return session;
}

function recipeOrder(): { componentId: ComponentId }[] {
  return RECIPE.map((id) => ({ componentId: componentId(id) }));
}

function stateOf(
  session: WeighingSession,
  componentIdValue: string,
): string | undefined {
  return session.components.find(
    (entry) => entry.componentId.value === componentIdValue,
  )?.state;
}

describe('the progression', () => {
  it('the confirmed component becomes DONE', () => {
    const session = sessionWith();

    const outcome = session.confirm(componentId('DYE-4471-Y'), recipeOrder());

    expect(outcome.kind).toBe('ADVANCED');
    expect(stateOf(session, 'DYE-4471-Y')).toBe('DONE');
  });

  it('the NEXT PENDING in RECIPE ORDER becomes ACTIVE', () => {
    const session = sessionWith();

    session.confirm(componentId('DYE-4471-Y'), recipeOrder());

    expect(stateOf(session, 'DYE-4471-B')).toBe('ACTIVE');
  });

  it('the progression follows the RECIPE ORDER — not the operator’s choice', () => {
    // The session's active component is the SECOND one, out of order.
    const session = sessionWith('DYE-4471-B');

    const outcome = session.confirm(componentId('DYE-4471-B'), recipeOrder());

    // The next is the THIRD in recipe order — the first is still PENDING,
    // and the progression does not skip back to it.
    expect(outcome.kind).toBe('ADVANCED');
    if (outcome.kind !== 'ADVANCED') return;
    expect(outcome.to.value).toBe('AUX-0101');
    expect(stateOf(session, 'AUX-0101')).toBe('ACTIVE');
    expect(stateOf(session, 'DYE-4471-Y')).toBe('PENDING');
  });

  it('EXACTLY ONE component is ACTIVE at a time', () => {
    const session = sessionWith();

    session.confirm(componentId('DYE-4471-Y'), recipeOrder());

    const active = session.components.filter(
      (entry) => entry.state === 'ACTIVE',
    );
    expect(active).toHaveLength(1);
    expect(active[0]?.componentId.value).toBe('DYE-4471-B');
  });

  it('the last component’s confirmation is COMPLETED — a distinct outcome', () => {
    const session = sessionWith('AUX-0107');

    const outcome = session.confirm(componentId('AUX-0107'), recipeOrder());

    // Not "advanced to nothing" — COMPLETED, which starts bolt 018's
    // batch summary (ADR-040).
    expect(outcome.kind).toBe('COMPLETED');
    expect(stateOf(session, 'AUX-0107')).toBe('DONE');
    expect(session.state).toBe('COMPLETE');

    // And no component became ACTIVE.
    expect(
      session.components.filter((entry) => entry.state === 'ACTIVE'),
    ).toHaveLength(0);
  });

  it('`DONE` is TERMINAL — a completed component cannot be confirmed again', () => {
    const session = sessionWith();

    session.confirm(componentId('DYE-4471-Y'), recipeOrder());

    expect(() =>
      session.confirm(componentId('DYE-4471-Y'), recipeOrder()),
    ).toThrow(/DONE/);
  });

  it('a component that is NOT the active one cannot be confirmed', () => {
    const session = sessionWith();

    expect(() =>
      session.confirm(componentId('DYE-4471-B'), recipeOrder()),
    ).toThrow(/not the active component/);
  });

  it('the progression clears the weight — the next component starts at zero', () => {
    const session = sessionWith();
    session.offerReading(
      { value: 'SCALE-A' } as never,
      WeightValue.of('94.2400', 'g'),
      true,
      { value: 1 } as never,
    );

    session.confirm(componentId('DYE-4471-Y'), recipeOrder());

    expect(session.currentWeight).toBeNull();
  });

  it('the progression is repeatable — component after component', () => {
    const session = sessionWith();

    const first = session.confirm(componentId('DYE-4471-Y'), recipeOrder());
    expect(first.kind).toBe('ADVANCED');

    const second = session.confirm(componentId('DYE-4471-B'), recipeOrder());
    expect(second.kind).toBe('ADVANCED');
    if (second.kind !== 'ADVANCED') return;
    expect(second.to.value).toBe('AUX-0101');

    const third = session.confirm(componentId('AUX-0101'), recipeOrder());
    expect(third.kind).toBe('ADVANCED');
    if (third.kind !== 'ADVANCED') return;
    expect(third.to.value).toBe('AUX-0107');

    const fourth = session.confirm(componentId('AUX-0107'), recipeOrder());
    expect(fourth.kind).toBe('COMPLETED');

    // Every component is DONE, and the session is COMPLETE.
    expect(
      session.components.filter((entry) => entry.state === 'DONE'),
    ).toHaveLength(RECIPE.length);
    expect(session.state).toBe('COMPLETE');
  });
});
