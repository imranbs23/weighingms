/**
 * The action row's rules — unit 007, bolt 026.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE CONFIRM BUTTON IS ENABLED BY THE API'S ZONE — AND IT ALWAYS
 * STATES ITS REASON.
 * ══════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  confirmActionFor,
  CONFIRM_REASON_OK,
  CONFIRM_REASON_SHORT,
  CONFIRM_REASON_NEAR,
  CONFIRM_REASON_OVER,
  CONFIRM_REASON_UNDER,
  CONFIRM_REASON_OVERRIDE_REQUIRED,
  CONFIRM_REASON_UNREACHABLE,
  CONFIRM_REASON_NO_COMPONENT,
} from '../../src/007-weighingms-ui/state/action-store.js';

describe('the confirm action', () => {
  it('is ENABLED only when the reported zone is OK', () => {
    expect(confirmActionFor('OK').enabled).toBe(true);
  });

  it('is DISABLED in every other zone', () => {
    for (const zone of ['NEAR', 'OVER', 'UNDER', null, 'SOMETHING_ELSE']) {
      expect(confirmActionFor(zone).enabled).toBe(false);
    }
  });

  it('the reason is NEVER empty — in any state', () => {
    const states = [
      confirmActionFor('OK'),
      confirmActionFor('NEAR'),
      confirmActionFor('OVER'),
      confirmActionFor('UNDER'),
      confirmActionFor(null),
      confirmActionFor(null, { unreachable: true }),
      confirmActionFor(null, { noComponent: true }),
      confirmActionFor('OK', { awaitingSupervisor: true }),
    ];

    for (const state of states) {
      expect(state.reason.length).toBeGreaterThan(0);
    }
  });

  it('the reason DISTINGUISHES the cases the operator can act on', () => {
    expect(confirmActionFor('OK').reason).toBe(CONFIRM_REASON_OK);
    expect(confirmActionFor('NEAR').reason).toBe(CONFIRM_REASON_NEAR);
    expect(confirmActionFor('OVER').reason).toBe(CONFIRM_REASON_OVER);
    expect(confirmActionFor('UNDER').reason).toBe(CONFIRM_REASON_UNDER);
    // No zone at all — and the reason says the weight is short.
    expect(confirmActionFor(null).reason).toBe(CONFIRM_REASON_SHORT);
  });

  it('an UNREACHABLE API disables it — and the client does not confirm optimistically', () => {
    const action = confirmActionFor('OK', { unreachable: true });

    expect(action.enabled).toBe(false);
    expect(action.reason).toBe(CONFIRM_REASON_UNREACHABLE);
  });

  it('an AWAITING-SUPERVISOR state disables it — the weighing is not confirmed', () => {
    const action = confirmActionFor('OK', { awaitingSupervisor: true });

    expect(action.enabled).toBe(false);
    expect(action.reason).toBe(CONFIRM_REASON_OVERRIDE_REQUIRED);
  });

  it('no component at all disables it', () => {
    const action = confirmActionFor(null, { noComponent: true });

    expect(action.enabled).toBe(false);
    expect(action.reason).toBe(CONFIRM_REASON_NO_COMPONENT);
  });
});
