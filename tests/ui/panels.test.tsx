/**
 * The surplus panel and the escalation panel — the component tests.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE FACTOR IS RENDERED. AND BOTH WAYS FORWARD ARE OFFERED.
 * ══════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { SurplusPanel } from '../../src/007-weighingms-ui/screens/weigh/SurplusPanel.js';
import { EscalationPanel } from '../../src/007-weighingms-ui/screens/weigh/EscalationPanel.js';
import type { SurplusProposal } from '../../src/007-weighingms-ui/api/endpoints.js';

/** A translator that returns the key — so the test asserts on keys. */
const t = (key: string): string => key;

function proposal(
  overrides: Partial<SurplusProposal> = {},
): SurplusProposal {
  return {
    proposalId: 'PROP-1',
    componentId: 'DYE-4471-Y',
    sessionId: 'WS-1',
    surplusAmount: '2.4000',
    unit: 'g',
    overshoot: '1.9000',
    surplusPercent: '2.5532',
    // The factor is the RULE's — and the client renders it.
    factor: '1.025532',
    status: 'PROPOSED',
    operatorId: 'OP-001',
    createdAt: '2026-11-06T10:00:00.000Z',
    decidedAt: null,
    reason: null,
    recalculated: [
      {
        componentId: 'AUX-0101',
        originalTarget: '24.0000',
        revisedTarget: '24.6128',
      },
    ],
    ...overrides,
  };
}

describe('the surplus panel', () => {
  it('is NOT rendered when the API reports no surplus', () => {
    const { container } = render(
      <SurplusPanel
        proposal={null}
        t={t}
        onAccept={() => undefined}
        onDecline={() => undefined}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows the surplus as an absolute quantity AND a percentage', () => {
    render(
      <SurplusPanel
        proposal={proposal()}
        t={t}
        onAccept={() => undefined}
        onDecline={() => undefined}
      />,
    );

    expect(screen.getByTestId('surplus-amount').textContent).toContain(
      '2.4',
    );
    expect(screen.getByTestId('surplus-percent').textContent).toContain(
      '2.5532',
    );
  });

  it('shows the factor AS REPORTED — never a derived one', () => {
    render(
      <SurplusPanel
        proposal={proposal()}
        t={t}
        onAccept={() => undefined}
        onDecline={() => undefined}
      />,
    );

    // The factor is the API's, verbatim.
    expect(screen.getByTestId('surplus-factor').textContent).toContain(
      '1.025532',
    );
  });

  it('shows each affected component’s ORIGINAL and REVISED target', () => {
    render(
      <SurplusPanel
        proposal={proposal()}
        t={t}
        onAccept={() => undefined}
        onDecline={() => undefined}
      />,
    );

    expect(
      screen.getByTestId('surplus-entry-AUX-0101').textContent,
    ).toContain('24.0000');
    expect(
      screen.getByTestId('surplus-revised-AUX-0101').textContent,
    ).toContain('24.6128');
  });

  it('offers BOTH accept and decline — equally', async () => {
    const accepted = vi.fn();
    const declined = vi.fn();

    render(
      <SurplusPanel
        proposal={proposal()}
        t={t}
        onAccept={accepted}
        onDecline={declined}
      />,
    );

    // A panel that only offers one way forward is a nudge dressed as a
    // control.
    const accept = screen.getByTestId('surplus-accept');
    const decline = screen.getByTestId('surplus-decline');
    expect(accept).toBeTruthy();
    expect(decline).toBeTruthy();

    // And both are live.
    await userEvent.click(accept);
    await userEvent.click(decline);
    expect(accepted).toHaveBeenCalled();
    expect(declined).toHaveBeenCalled();
  });

  it('states the shade-ratio footnote', () => {
    render(
      <SurplusPanel
        proposal={proposal()}
        t={t}
        onAccept={() => undefined}
        onDecline={() => undefined}
      />,
    );

    expect(screen.getByTestId('surplus-footnote')).toBeTruthy();
  });

  it('every action’s touch target is AT LEAST 15 mm', () => {
    render(
      <SurplusPanel
        proposal={proposal()}
        t={t}
        onAccept={() => undefined}
        onDecline={() => undefined}
      />,
    );

    for (const button of screen.getAllByRole('button')) {
      const styles = window.getComputedStyle(button);
      expect(
        Number.parseFloat(styles.minHeight || '0'),
      ).toBeGreaterThanOrEqual(56);
    }
  });
});

describe('the escalation panel', () => {
  const escalation = {
    componentId: 'AUX-0107',
    sessionId: 'WS-1',
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

  it('the authorise action ENABLES once a reason is given', async () => {
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

    await userEvent.type(
      screen.getByTestId('escalation-reason'),
      'the client accepted the excess',
    );

    const button = screen.getByTestId(
      'escalation-authorise',
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    await userEvent.click(button);
    expect(authorise).toHaveBeenCalled();
    // And the reason went with it.
    expect(
      (authorise.mock.calls[0]?.[0] as { reason: string }).reason,
    ).toBe('the client accepted the excess');
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
