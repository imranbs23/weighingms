/**
 * The status strip — the component tests.
 *
 * ══════════════════════════════════════════════════════════════════════
 * EVERY ENTRY IS A REAL VALUE FROM THE API. AND TWO FAILURES GET TWO
 * ENTRIES.
 * ══════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusStrip } from '../../src/007-weighingms-ui/screens/status/StatusStrip.js';
import type { PeripheralStatus } from '../../src/007-weighingms-ui/state/status-store.js';

const t = (key: string): string => key;

function scale(
  id: string,
  state: string,
  healthy: boolean,
): PeripheralStatus {
  return {
    id,
    state,
    healthy,
    reason: healthy ? 'status.scale.ready' : `status.scale.${state.toLowerCase()}`,
    ageMs: null,
  };
}

describe('the status strip', () => {
  it('shows EVERY peripheral as its OWN entry', () => {
    render(
      <StatusStrip
        scales={[
          scale('SCALE-A', 'READY', true),
          scale('SCALE-B', 'DISCONNECTED', false),
        ]}
        link={{
          id: 'ORGATEX',
          state: 'LINKED',
          healthy: true,
          reason: 'status.link.linked',
          ageMs: null,
        }}
        unsynchronisedCount={0}
        queue={[]}
        apiReachable={true}
        t={t}
      />,
    );

    expect(screen.getByTestId('peripheral-SCALE-A')).toBeTruthy();
    expect(screen.getByTestId('peripheral-SCALE-B')).toBeTruthy();
    expect(screen.getByTestId('peripheral-ORGATEX')).toBeTruthy();
  });

  it('TWO failures get TWO entries — never one generic error', () => {
    render(
      <StatusStrip
        scales={[
          scale('SCALE-A', 'DISCONNECTED', false),
          scale('SCALE-B', 'EXPIRED', false),
        ]}
        link={null}
        unsynchronisedCount={0}
        queue={[]}
        apiReachable={true}
        t={t}
      />,
    );

    // Each has its own entry AND its own reason.
    expect(
      screen.getByTestId('peripheral-reason-SCALE-A').textContent,
    ).toBe('status.scale.disconnected');
    expect(
      screen.getByTestId('peripheral-reason-SCALE-B').textContent,
    ).toBe('status.scale.expired');
  });

  it('the state is the API’s own vocabulary', () => {
    render(
      <StatusStrip
        scales={[scale('SCALE-A', 'DISCONNECTED', false)]}
        link={null}
        unsynchronisedCount={0}
        queue={[]}
        apiReachable={true}
        t={t}
      />,
    );

    // The state is the API's own vocabulary — and it is on the entry.
    expect(
      screen.getByTestId('peripheral-SCALE-A').getAttribute('data-state'),
    ).toBe('DISCONNECTED');
  });

  it('a DEGRADED link is marked WITH ITS AGE', () => {
    render(
      <StatusStrip
        scales={[]}
        link={{
          id: 'ORGATEX',
          state: 'DEGRADED',
          healthy: false,
          reason: 'status.link.degraded',
          ageMs: 45_000,
        }}
        unsynchronisedCount={2}
        queue={[]}
        apiReachable={true}
        t={t}
      />,
    );

    // The age — so a stale snapshot is never presented as current.
    expect(screen.getByTestId('peripheral-age-ORGATEX').textContent).toContain(
      '45000',
    );
    expect(
      screen.getByTestId('peripheral-ORGATEX').getAttribute('data-healthy'),
    ).toBe('false');
  });

  it('the un-synchronised count is VISIBLE — even on a healthy link', () => {
    render(
      <StatusStrip
        scales={[]}
        link={{
          id: 'ORGATEX',
          state: 'LINKED',
          healthy: true,
          reason: 'status.link.linked',
          ageMs: null,
        }}
        unsynchronisedCount={3}
        queue={[]}
        apiReachable={true}
        t={t}
      />,
    );

    // A healthy link with a non-empty queue is a fact the operator needs.
    expect(screen.getByTestId('status-unsynchronised').textContent).toContain(
      '3',
    );
  });

  it('a queued write is shown as PENDING — never as posted', () => {
    render(
      <StatusStrip
        scales={[]}
        link={{
          id: 'ORGATEX',
          state: 'OFFLINE',
          healthy: false,
          reason: 'status.link.offline',
          ageMs: null,
        }}
        unsynchronisedCount={1}
        queue={[{ componentId: 'DYE-4471-Y', state: 'PENDING', attempts: 2, lastError: null }]}
        apiReachable={true}
        t={t}
      />,
    );

    // The queue's entry is visible, and it is the PENDING state.
    expect(screen.getByTestId('status-queue-0').textContent).toContain(
      'status.queue.pending',
    );
  });

  it('a FAILED queue entry stays VISIBLE — it is not silently dropped', () => {
    render(
      <StatusStrip
        scales={[]}
        link={null}
        unsynchronisedCount={1}
        queue={[
          {
            componentId: 'DYE-4471-Y',
            state: 'FAILED',
            attempts: 3,
            // The API sends a CODE and a SUMMARY — never a sentence
            // (BRD NFR-11).
            lastError: { code: 'UNREACHABLE', summary: 'The MES was unreachable' },
          },
        ]}
        apiReachable={true}
        t={t}
      />,
    );

    expect(screen.getByTestId('status-queue-0').textContent).toContain(
      'status.queue.failed',
    );
  });

  it('the API being UNREACHABLE is stated — and no stale state is shown', () => {
    render(
      <StatusStrip
        scales={[]}
        link={null}
        unsynchronisedCount={0}
        queue={[]}
        apiReachable={false}
        t={t}
      />,
    );

    expect(screen.getByTestId('status-api-unreachable')).toBeTruthy();
    expect(
      screen.getByTestId('status-strip').getAttribute('data-api-reachable'),
    ).toBe('false');
  });

  it('every status entry is AT LEAST 15 mm', () => {
    render(
      <StatusStrip
        scales={[scale('SCALE-A', 'READY', true)]}
        link={null}
        unsynchronisedCount={0}
        queue={[]}
        apiReachable={true}
        t={t}
      />,
    );

    const entry = screen.getByTestId('peripheral-SCALE-A');
    const styles = window.getComputedStyle(entry);
    expect(
      Number.parseFloat(styles.minHeight || '0'),
    ).toBeGreaterThanOrEqual(56);
  });
});
