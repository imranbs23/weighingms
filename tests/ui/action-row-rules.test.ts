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
  CONFIRM_REASON_OVERRIDDEN,
  CONFIRM_REASON_DISCONNECTED,
  CONFIRM_REASON_CALIBRATION,
} from '../../src/007-weighingms-ui/state/action-store.js';
import { WEIGH_KEYS } from '../../src/007-weighingms-ui/screens/weigh/WeighScreen.js';

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

  describe('the supervisor override (bolt 030, ADR-047)', () => {
    it('OVER with an AUTHORISED override enables confirm, and says why', () => {
      const action = confirmActionFor('OVER', { overrideAuthorised: true });
      expect(action.enabled).toBe(true);
      expect(action.reason).toBe(CONFIRM_REASON_OVERRIDDEN);
    });

    it('an authorised override opens NOTHING but OVER', () => {
      for (const zone of ['UNDER', 'NEAR', null]) {
        expect(confirmActionFor(zone, { overrideAuthorised: true }).enabled).toBe(false);
      }
    });

    it('an unreachable API still wins over an authorised override', () => {
      const action = confirmActionFor('OVER', {
        overrideAuthorised: true,
        unreachable: true,
      });
      expect(action.enabled).toBe(false);
      expect(action.reason).toBe(CONFIRM_REASON_UNREACHABLE);
    });
  });
});

describe('the weigh screen loads every confirm reason', () => {
  // A reason the screen did not ask the locale bundle for renders as its
  // raw key. The Step 24 end-to-end run found exactly that.
  it('every CONFIRM_REASON_* key is in WEIGH_KEYS', () => {
    const reasons = [
      CONFIRM_REASON_OK,
      CONFIRM_REASON_SHORT,
      CONFIRM_REASON_NEAR,
      CONFIRM_REASON_OVER,
      CONFIRM_REASON_UNDER,
      CONFIRM_REASON_DISCONNECTED,
      CONFIRM_REASON_CALIBRATION,
      CONFIRM_REASON_OVERRIDE_REQUIRED,
      CONFIRM_REASON_OVERRIDDEN,
      CONFIRM_REASON_UNREACHABLE,
      CONFIRM_REASON_NO_COMPONENT,
    ];
    for (const reason of reasons) {
      expect(WEIGH_KEYS as readonly string[], reason).toContain(reason);
    }
  });
});
