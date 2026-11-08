/**
 * The batch queue screen — the component tests.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THREE STATES, AND THEY ARE DISTINGUISHABLE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The story's edge cases are the design's real content:
 *
 * - the API unreachable → a **degraded** state with a stated reason, and
 *   **not** an empty-looking success (BRD FR-20);
 * - the queue empty → an explicit **empty** state, with the receipt time
 *   still displayed;
 * - a filtered queue with no rows → the empty state, and the filter is
 *   **visibly still applied**;
 * - a batch no longer released → the row is **not selectable**.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';import { BatchQueueScreen } from '../../src/007-weighingms-ui/screens/batch-queue/BatchQueueScreen.js';
import { useQueueStore } from '../../src/007-weighingms-ui/state/queue-store.js';
import { TOUCH_TARGET_PX } from '../../src/007-weighingms-ui/screens/batch-queue/tokens.js';

/** A queue as the API sends it. */
function queue(
  overrides: Partial<{
    batches: {
      batchId: string;
      orderRef: string;
      machineRef: string;
      fabricDescription: string | null;
      shadeCode: string;
      componentCount: number;
      weighingStatus: string;
    }[];
    receivedAt: string;
    source: string;
    statuses: string[];
  }> = {},
) {
  return {
    batches: overrides.batches ?? [
      {
        batchId: 'B-24187',
        orderRef: 'SO-9931',
        machineRef: 'JET-04',
        fabricDescription: '100% CTN knit',
        shadeCode: 'Teal 4C',
        componentCount: 5,
        weighingStatus: 'RELEASED',
      },
    ],
    receivedAt: overrides.receivedAt ?? '2026-11-06T09:00:00.000Z',
    source: overrides.source ?? 'ORGATEX',
    freshness: { kind: 'CURRENT' },
    filter: null,
    statuses: overrides.statuses ?? ['RELEASED', 'WEIGHING'],
  };
}

/** Stub `fetch` — and the client's ONE wrapper is the only caller. */
function stubFetch(
  handler: (url: string, init?: RequestInit) => {
    status: number;
    body: unknown;
  },
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const { status, body } = handler(input, init);
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
      });
    }),
  );
}

describe('the batch queue screen', () => {
  beforeEach(() => {
    useQueueStore.setState({
      state: { kind: 'LOADING' },
      filter: null,
      refusal: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows EVERY ROW with its seven columns', async () => {
    stubFetch((url) => {
      if (url.includes('/api/batch-queue')) {
        return { status: 200, body: queue() };
      }
      // The locale endpoint — every key resolves to itself until the
      // bundle answers, which is the documented fallback.
      return { status: 200, body: { value: 'x' } };
    });

    render(<BatchQueueScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('queue-rows')).toBeTruthy();
    });

    // The seven columns' values, from the server's row.
    expect(screen.getByText('B-24187')).toBeTruthy();
    expect(screen.getByText('SO-9931')).toBeTruthy();
    expect(screen.getByText('JET-04')).toBeTruthy();
    expect(screen.getByText('100% CTN knit')).toBeTruthy();
    expect(screen.getByText('Teal 4C')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('RELEASED')).toBeTruthy();
  });

  it('shows the queue’s LAST RECEIVED time', async () => {
    stubFetch((url) =>
      url.includes('/api/batch-queue')
        ? { status: 200, body: queue() }
        : { status: 200, body: { value: 'x' } },
    );

    render(<BatchQueueScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('queue-last-received')).toBeTruthy();
    });
    expect(
      screen.getByTestId('queue-last-received').textContent,
    ).toContain('2026-11-06T09:00:00.000Z');
  });

  it('shows an EXPLICIT EMPTY state when the queue has no rows', async () => {
    stubFetch((url) =>
      url.includes('/api/batch-queue')
        ? { status: 200, body: queue({ batches: [] }) }
        : { status: 200, body: { value: 'x' } },
    );

    render(<BatchQueueScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('queue-empty')).toBeTruthy();
    });
    // And NOT the degraded state — the two are distinguishable.
    expect(screen.queryByTestId('queue-degraded')).toBeNull();
  });

  it('shows a DEGRADED state when the API is unreachable — NOT an empty success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('the network is down'))),
    );

    render(<BatchQueueScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('queue-degraded')).toBeTruthy();
    });
    // AND NOT the empty state — the two are distinguishable, and the
    // operator is not shown a stale-looking success (BRD FR-20).
    expect(screen.queryByTestId('queue-empty')).toBeNull();
    expect(screen.queryByTestId('queue-rows')).toBeNull();
    // And the reason is STATED.
    expect(screen.getByTestId('queue-degraded-reason')).toBeTruthy();
  });

  it('a row that is NO LONGER RELEASED is not selectable', async () => {
    stubFetch((url) =>
      url.includes('/api/batch-queue')
        ? {
            status: 200,
            body: queue({
              batches: [
                {
                  batchId: 'B-24187',
                  orderRef: 'SO-9931',
                  machineRef: 'JET-04',
                  fabricDescription: null,
                  shadeCode: 'Teal 4C',
                  componentCount: 5,
                  weighingStatus: 'WEIGHING',
                },
              ],
            }),
          }
        : { status: 200, body: { value: 'x' } },
    );

    render(<BatchQueueScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('queue-rows')).toBeTruthy();
    });

    const row = screen.getByTestId('queue-row-B-24187');
    expect(row.getAttribute('data-selectable')).toBe('false');
    expect(row.getAttribute('aria-disabled')).toBe('true');
  });

  it('touching a row SELECTS it — through the same action as a scan', async () => {
    const posts: string[] = [];
    stubFetch((url, init) => {
      if (url.includes('/api/batch-queue')) {
        return { status: 200, body: queue() };
      }
      if (url.includes('/api/selection')) {
        posts.push(String(init?.body ?? ''));
        return {
          status: 201,
          body: {
            selection: {
              batchId: 'B-24187',
              method: 'TOUCH',
              operatorId: 'OP-001',
              selectedAt: '2026-11-06T09:41:00.000Z',
            },
          },
        };
      }
      return { status: 200, body: { value: 'x' } };
    });

    render(<BatchQueueScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('queue-rows')).toBeTruthy();
    });

    await userEvent.click(screen.getByTestId('queue-row-B-24187'));

    await waitFor(() => {
      expect(posts.length).toBe(1);
    });
    // The body carries the batch id — and the METHOD is derived by the
    // server from the request's shape (ADR-030).
    expect(posts[0]).toContain('batchId');
    expect(posts[0]).not.toContain('method');
  });

  it('scanning SELECTS it — through the same endpoint', async () => {
    const posts: string[] = [];
    stubFetch((url, init) => {
      if (url.includes('/api/batch-queue')) {
        return { status: 200, body: queue() };
      }
      if (url.includes('/api/selection')) {
        posts.push(String(init?.body ?? ''));
        return {
          status: 201,
          body: {
            selection: {
              batchId: 'B-24187',
              method: 'SCAN',
              operatorId: 'OP-001',
              selectedAt: '2026-11-06T09:41:00.000Z',
            },
          },
        };
      }
      return { status: 200, body: { value: 'x' } };
    });

    render(<BatchQueueScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('queue-scan-input')).toBeTruthy();
    });

    await userEvent.type(screen.getByTestId('queue-scan-input'), 'B-24187');
    await userEvent.click(screen.getByTestId('queue-scan-submit'));

    await waitFor(() => {
      expect(posts.length).toBe(1);
    });
    expect(posts[0]).toContain('code');
  });

  it('a REFUSED selection shows a VISIBLE reason', async () => {
    stubFetch((url) => {
      if (url.includes('/api/batch-queue')) {
        return { status: 200, body: queue() };
      }
      if (url.includes('/api/selection')) {
        return {
          status: 409,
          body: { error: 'SELECTION_REFUSED', reason: 'UNKNOWN_BATCH' },
        };
      }
      return { status: 200, body: { value: 'x' } };
    });

    render(<BatchQueueScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('queue-rows')).toBeTruthy();
    });

    await userEvent.click(screen.getByTestId('queue-row-B-24187'));

    await waitFor(() => {
      expect(screen.getByTestId('queue-refusal')).toBeTruthy();
    });
  });

  it('every touch target is AT LEAST 15 mm', async () => {
    stubFetch((url) =>
      url.includes('/api/batch-queue')
        ? { status: 200, body: queue() }
        : { status: 200, body: { value: 'x' } },
    );

    render(<BatchQueueScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('queue-rows')).toBeTruthy();
    });

    // The token IS 15 mm — and the rendered target meets it.
    expect(TOUCH_TARGET_PX).toBeGreaterThanOrEqual(56);

    const row = screen.getByTestId('queue-row-B-24187');
    const styles = window.getComputedStyle(row);
    const height = Number.parseFloat(styles.minHeight || '0');
    expect(height).toBeGreaterThanOrEqual(56);

    // And the buttons too.
    for (const button of screen.getAllByRole('button')) {
      const buttonStyles = window.getComputedStyle(button);
      const buttonHeight = Number.parseFloat(buttonStyles.minHeight || '0');
      expect(buttonHeight).toBeGreaterThanOrEqual(56);
    }
  });

  it('every label is LEGIBLE at 1.5 m', async () => {
    stubFetch((url) =>
      url.includes('/api/batch-queue')
        ? { status: 200, body: queue() }
        : { status: 200, body: { value: 'x' } },
    );

    render(<BatchQueueScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('queue-rows')).toBeTruthy();
    });

    // BRD NFR-08's floor — the design's minimum label size.
    const row = screen.getByTestId('queue-row-B-24187');
    const styles = window.getComputedStyle(row);
    expect(Number.parseFloat(styles.fontSize || '0')).toBeGreaterThanOrEqual(24);
  });
});
