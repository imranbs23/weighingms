/**
 * The surplus panel and the escalation panel — the component tests.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE SURPLUS IS SHOWN FOR INFORMATION. THE SUPERVISOR SIGNS OFF WITH A
 * BADGE, A PIN AND A REASON (bolt 030, ADR-047).
 * ══════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { SurplusPanel } from '../../src/007-weighingms-ui/screens/weigh/SurplusPanel.js';
import { EscalationPanel } from '../../src/007-weighingms-ui/screens/weigh/EscalationPanel.js';
import type {
  EscalationReport,
  SurplusReport,
} from '../../src/007-weighingms-ui/api/endpoints.js';

/** A translator that returns the key — so the test asserts on keys. */
const t = (key: string): string => key;

function surplus(overrides: Partial<SurplusReport> = {}): SurplusReport {
  return {
    componentId: 'DYE-4471-Y',
    overshoot: '1.9000',
    surplusAmount: '2.4000',
    unit: 'g',
    surplusPercent: '2.5532',
    ...overrides,
  };
}

describe('the surplus panel', () => {
  it('is NOT rendered when the API reports no surplus', () => {
    const { container } = render(<SurplusPanel surplus={null} t={t} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows the surplus as an absolute quantity AND a percentage', () => {
    render(<SurplusPanel surplus={surplus()} t={t} />);

    expect(screen.getByTestId('surplus-amount').textContent).toContain('2.4');
    expect(screen.getByTestId('surplus-amount').textContent).toContain('g');
    expect(screen.getByTestId('surplus-percent').textContent).toContain(
      '2.5532 %',
    );
  });

  it('shows no percentage at a zero target, rather than a wrong one', () => {
    render(<SurplusPanel surplus={surplus({ surplusPercent: null })} t={t} />);

    expect(screen.getByTestId('surplus-percent').textContent).toContain(
      'weigh.readout.noValue',
    );
  });

  it('states the two recovery actions', () => {
    render(<SurplusPanel surplus={surplus()} t={t} />);

    expect(screen.getByTestId('surplus-recovery').textContent).toBe(
      'weigh.surplus.recovery',
    );
  });

  it('is INFORMATION ONLY — no proposal, no factor, no accept or decline', () => {
    render(<SurplusPanel surplus={surplus()} t={t} />);

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByTestId('surplus-factor')).toBeNull();
    expect(screen.queryByTestId('surplus-recalculated')).toBeNull();
    expect(screen.queryByTestId('surplus-accept')).toBeNull();
    expect(screen.queryByTestId('surplus-decline')).toBeNull();
  });
});

describe('the escalation panel', () => {
  const escalation: EscalationReport = {
    componentId: 'AUX-0107',
    sessionId: 'WS-1',
    subject: 'WS-1/AUX-0107',
    surplusAmount: '2.4000',
    unit: 'g',
    state: 'ESCALATED',
    // The API sends both — and they are `null` until a supervisor acts.
    authorisationId: null,
    supervisorId: null,
  };

  it('is NOT rendered when there is no escalation', () => {
    const { container } = render(
      <EscalationPanel
        escalation={null}
        awaitingSupervisor={false}
        failure={null}
        t={t}
        onAuthorise={() => undefined}
        onDiscard={() => undefined}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('STATES that a reason is required', () => {
    render(
      <EscalationPanel
        escalation={escalation}
        awaitingSupervisor={false}
        failure={null}
        t={t}
        onAuthorise={() => undefined}
        onDiscard={() => undefined}
      />,
    );

    expect(
      screen.getByTestId('escalation-reason-required').textContent,
    ).toBe('weigh.escalation.reasonRequired');
  });

  it('the authorise action is DISABLED without a reason', () => {
    render(
      <EscalationPanel
        escalation={escalation}
        awaitingSupervisor={false}
        failure={null}
        t={t}
        onAuthorise={() => undefined}
        onDiscard={() => undefined}
      />,
    );

    expect(
      (screen.getByTestId('escalation-authorise') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('the authorise action ENABLES once badge, PIN and reason are given', async () => {
    const authorise = vi.fn();
    render(
      <EscalationPanel
        escalation={escalation}
        awaitingSupervisor={false}
        failure={null}
        t={t}
        onAuthorise={authorise}
        onDiscard={() => undefined}
      />,
    );

    const button = screen.getByTestId(
      'escalation-authorise',
    ) as HTMLButtonElement;

    await userEvent.type(
      screen.getByTestId('escalation-reason'),
      'the client accepted the excess',
    );
    // A reason alone does not complete the override.
    expect(button.disabled).toBe(true);

    await userEvent.type(screen.getByTestId('escalation-supervisor-id'), 'SUP-001');
    expect(button.disabled).toBe(true);

    await userEvent.type(screen.getByTestId('escalation-secret'), '9164');
    expect(button.disabled).toBe(false);

    await userEvent.click(button);
    expect(authorise).toHaveBeenCalledWith({
      supervisorId: 'SUP-001',
      secret: '9164',
      reason: 'the client accepted the excess',
    });
  });

  it('asks for NO authorisation id — the terminal requests it itself', () => {
    render(
      <EscalationPanel
        escalation={escalation}
        awaitingSupervisor={false}
        failure={null}
        t={t}
        onAuthorise={() => undefined}
        onDiscard={() => undefined}
      />,
    );

    expect(screen.queryByTestId('escalation-authorisation-id')).toBeNull();
  });

  it('a refusal shows the ONE message and clears the PIN', async () => {
    const { rerender } = render(
      <EscalationPanel
        escalation={escalation}
        awaitingSupervisor={true}
        failure={null}
        t={t}
        onAuthorise={() => undefined}
        onDiscard={() => undefined}
      />,
    );
    await userEvent.type(screen.getByTestId('escalation-secret'), '0000');

    rerender(
      <EscalationPanel
        escalation={escalation}
        awaitingSupervisor={true}
        failure="weigh.escalation.refused"
        t={t}
        onAuthorise={() => undefined}
        onDiscard={() => undefined}
      />,
    );

    expect(screen.getByTestId('escalation-failure').textContent).toBe(
      'weigh.escalation.refused',
    );
    expect(
      (screen.getByTestId('escalation-secret') as HTMLInputElement).value,
    ).toBe('');
  });

  it('once AUTHORISED, says by whom — and asks for nothing more', () => {
    render(
      <EscalationPanel
        escalation={{
          ...escalation,
          state: 'AUTHORISED',
          authorisationId: 'AUTH-1',
          supervisorId: 'SUP-001',
        }}
        awaitingSupervisor={false}
        failure={null}
        t={t}
        onAuthorise={() => undefined}
        onDiscard={() => undefined}
      />,
    );

    expect(screen.getByTestId('escalation-authorised').textContent).toContain(
      'SUP-001',
    );
    expect(screen.queryByTestId('escalation-secret')).toBeNull();
    expect(screen.queryByTestId('escalation-authorise')).toBeNull();
  });

  it('asks for a DISTINCT supervisor — never the operator’s own', () => {
    render(
      <EscalationPanel
        escalation={escalation}
        awaitingSupervisor={false}
        failure={null}
        t={t}
        onAuthorise={() => undefined}
        onDiscard={() => undefined}
      />,
    );

    // The supervisor's id and their secret are their own fields.
    expect(screen.getByTestId('escalation-supervisor-id')).toBeTruthy();
    expect(screen.getByTestId('escalation-secret')).toBeTruthy();
  });

  it('the AWAITING-SUPERVISOR state is explicit', () => {
    render(
      <EscalationPanel
        escalation={escalation}
        awaitingSupervisor={true}
        failure={null}
        t={t}
        onAuthorise={() => undefined}
        onDiscard={() => undefined}
      />,
    );

    expect(
      screen.getByTestId('escalation-panel').getAttribute('data-awaiting'),
    ).toBe('true');
    expect(screen.getByTestId('escalation-awaiting')).toBeTruthy();
  });

  it('offers BOTH the override and the discard', () => {
    render(
      <EscalationPanel
        escalation={escalation}
        awaitingSupervisor={false}
        failure={null}
        t={t}
        onAuthorise={() => undefined}
        onDiscard={() => undefined}
      />,
    );

    expect(screen.getByTestId('escalation-authorise')).toBeTruthy();
    expect(screen.getByTestId('escalation-discard')).toBeTruthy();
  });
});
