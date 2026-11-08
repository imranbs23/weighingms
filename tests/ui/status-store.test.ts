/**
 * The status store — the unit tests.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE API BEING UNREACHABLE IS A STATE, NOT A CRASH. AND NO STALE STATE
 * IS SHOWN.
 * ══════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useStatusStore } from '../../src/007-weighingms-ui/state/status-store.js';

/** The clock the age is measured against — and it does not move. */
const NOW = new Date('2026-11-08T09:01:30.000Z');

describe('the status store', () => {
  beforeEach(() => {
    useStatusStore.setState({
      scales: [],
      link: null,
      unsynchronisedCount: 0,
      queue: [],
      scanner: null,
      printer: null,
      apiReachable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Stub the three reads the strip makes. */
  function stubApi(
    handler: (url: string) => { status: number; body: unknown },
  ): void {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        const { status, body } = handler(String(input));
        return Promise.resolve({
          ok: status >= 200 && status < 300,
          status,
          json: () => Promise.resolve(body),
        });
      }),
    );
  }

  it('loads the scales and the link', async () => {
    stubApi((url) => {
      if (url.includes('/api/scales')) {
        return {
          status: 200,
          body: {
            scales: [
              {
                scaleId: 'SCALE-A',
                label: '3 kg precision',
                class: 'PRECISION',
                capacity: '3000',
                unit: 'g',
                status: 'READY',
                link: 'CONNECTED',
              },
            ],
          },
        };
      }
      if (url.includes('/link-state')) {
        return {
          status: 200,
          body: {
            status: 'LINKED',
            // THE API SENDS A TIMESTAMP — not an age. The client derives
            // the age from it and its own clock.
            lastContactAt: '2026-11-08T09:00:00.000Z',
            unsynchronisedCount: 0,
            lastError: null,
            consecutiveFailures: 0,
          },
        };
      }
      return { status: 200, body: { count: 0, entries: [] } };
    });

    await useStatusStore.getState().load();

    const state = useStatusStore.getState();
    expect(state.apiReachable).toBe(true);
    expect(state.scales).toHaveLength(1);
    expect(state.scales[0]?.id).toBe('SCALE-A');
    expect(state.scales[0]?.healthy).toBe(true);
    expect(state.link?.state).toBe('LINKED');
  });

  it('an UNREACHABLE API is a STATE — and no stale state is shown', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('the network is down'))),
    );

    await useStatusStore.getState().load();

    const state = useStatusStore.getState();
    expect(state.apiReachable).toBe(false);
    // And NO stale state — the strip must not show yesterday's.
    expect(state.scales).toHaveLength(0);
    expect(state.link).toBeNull();
  });

  it('a FAILED read is also a degraded state', async () => {
    stubApi(() => ({ status: 503, body: { error: 'ORGATEX_UNAVAILABLE' } }));

    await useStatusStore.getState().load();

    expect(useStatusStore.getState().apiReachable).toBe(false);
  });

  it('an unhealthy scale gets a reason — and it is never empty', async () => {
    stubApi((url) => {
      if (url.includes('/api/scales')) {
        return {
          status: 200,
          body: {
            scales: [
              {
                scaleId: 'SCALE-B',
                label: '32 kg floor',
                class: 'FLOOR',
                capacity: '32000',
                unit: 'g',
                status: 'DISCONNECTED',
                link: 'DISCONNECTED',
              },
            ],
          },
        };
      }
      if (url.includes('/link-state')) {
        return {
          status: 200,
          body: {
            status: 'LINKED',
            lastContactAt: '2026-11-08T09:00:00.000Z',
            unsynchronisedCount: 0,
            lastError: null,
            consecutiveFailures: 0,
          },
        };
      }
      return { status: 200, body: { count: 0, entries: [] } };
    });

    await useStatusStore.getState().load();

    const scale = useStatusStore.getState().scales[0];
    expect(scale?.healthy).toBe(false);
    expect(scale?.reason.length).toBeGreaterThan(0);
  });

  it('a DEGRADED link carries its age', async () => {
    // THE CLOCK IS FIXED — because the age is derived from the API's
    // TIMESTAMP and the client's own clock, and a test that read a moving
    // clock could only ever assert an approximation.
    //
    // **And only `Date` is faked** — the timers are left alone, so the
    // awaited reads still settle.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    try {
      stubApi((url) => {
        if (url.includes('/api/scales')) {
          return { status: 200, body: { scales: [] } };
        }
        if (url.includes('/link-state')) {
          return {
            status: 200,
            body: {
              status: 'DEGRADED',
              // THE LAST CONTACT — 90 seconds before the fixed now.
              lastContactAt: new Date(NOW.getTime() - 90_000).toISOString(),
              unsynchronisedCount: 4,
              lastError: { code: 'TIMEOUT', summary: 'no answer' },
              consecutiveFailures: 1,
            },
          };
        }
        return { status: 200, body: { count: 0, entries: [] } };
      });

      await useStatusStore.getState().load();

      const link = useStatusStore.getState().link;
      expect(link?.healthy).toBe(false);
      expect(link?.ageMs).toBe(90_000);
      // And the un-synchronised count is the queue's depth — reported in
      // EVERY state.
      expect(useStatusStore.getState().unsynchronisedCount).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the queue’s entries are kept — a failed one is not dropped', async () => {
    stubApi((url) => {
      if (url.includes('/api/scales')) {
        return { status: 200, body: { scales: [] } };
      }
      if (url.includes('/link-state')) {
        return {
          status: 200,
          body: {
            status: 'OFFLINE',
            // NO CONTACT EVER — and so no age.
            lastContactAt: null,
            unsynchronisedCount: 1,
            lastError: null,
            consecutiveFailures: 2,
          },
        };
      }
      return {
        status: 200,
        body: {
          count: 1,
          entries: [
            {
              componentId: 'DYE-4471-Y',
              state: 'FAILED',
              attempts: 3,
              // THE LAST ERROR — a code and a summary, never a sentence
              // (BRD NFR-11).
              lastError: {
                code: 'UNREACHABLE',
                summary: 'the MES was unreachable',
              },
            },
          ],
        },
      };
    });

    await useStatusStore.getState().load();

    const queue = useStatusStore.getState().queue;
    expect(queue).toHaveLength(1);
    expect(queue[0]?.state).toBe('FAILED');
    expect(queue[0]?.attempts).toBe(3);
  });
});
