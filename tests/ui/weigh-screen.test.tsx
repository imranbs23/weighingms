/**
 * The weigh view — the component tests.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE ZONE IS RECEIVED. THE CLIENT COMPUTES NO ZONE.
 * ══════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { WeighScreen } from '../../src/007-weighingms-ui/screens/weigh/WeighScreen.js';
import { useWeighStore } from '../../src/007-weighingms-ui/state/weigh-store.js';

/** The zone the API reports — and the client's only classification. */
function stubApi(
  zone: {
    zone: string;
    value: string;
    unit: string;
    target: string;
    bounds: {
      nearThreshold: string;
      okLower: string;
      okUpper: string;
    } | null;
    stillToWeigh: string;
  } | null,
  session: {
    sessionId: string;
    batchId: string;
    state: string;
    activeComponentId: string | null;
    selectedScaleId: string | null;
    currentWeight: string | null;
    weightUnit: string | null;
    weightStable: boolean;
    weightStale: boolean;
    components: { componentId: string; state: string }[];
    counter: { weighed: number; total: number };
  } | null,
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const url = String(input);
      // THE WEIGH-HEAD's endpoints — the recipe, the lot, the container
      // and the scales. The client's stub answers them, and the screen
      // renders what it is given.
      //
      // **And the shapes are the API's.** The zone is **flat** on the
      // wire, the recipe is **nested** under `recipe`, and the capture is
      // `capture` — so a stub with a different shape would make the test
      // prove something the product does not do.
      const body = url.includes('/api/session/zone')
        ? // THE ZONE — flat, and `{ zone: null }` when there is none.
          (zone === null ? { zone: null } : { ...zone })
        : url.includes('/api/session')
          ? { session }
          : url.includes('/api/recipe/')
            ? {
                recipe: {
                  batchId: 'B-24187',
                  shadeCode: 'Teal 4C',
                  components: [],
                },
              }
            : url.includes('/api/material-lot/')
              ? { capture: null }
              : url.includes('/api/container/')
                ? { assignment: null }
                : url.includes('/api/scales')
                  ? { scales: [] }
                  : { value: 'x' };
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(body),
      });
    }),
  );
}

describe('the weigh view', () => {
  beforeEach(() => {
    useWeighStore.setState({
      reading: null,
      receivedAt: null,
      zone: null,
      linkState: null,
      detail: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('the recipe rail shows each component with its STATE', async () => {
    stubApi(
      null,
      {
        sessionId: 'WS-1',
        batchId: 'B-24187',
        state: 'WEIGHING',
        activeComponentId: 'DYE-4471-Y',
        selectedScaleId: 'SCALE-A',
        currentWeight: null,
        weightUnit: null,
        weightStable: true,
        weightStale: false,
        components: [
          { componentId: 'DYE-4471-Y', state: 'ACTIVE' },
          { componentId: 'AUX-0101', state: 'PENDING' },
          { componentId: 'AUX-0107', state: 'DONE' },
        ],
        counter: { weighed: 1, total: 3 },
      },
    );

    render(<WeighScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('recipe-rail')).toBeTruthy();
    });

    expect(
      screen.getByTestId('rail-component-DYE-4471-Y').getAttribute('data-state'),
    ).toBe('ACTIVE');
    expect(
      screen.getByTestId('rail-component-AUX-0101').getAttribute('data-state'),
    ).toBe('PENDING');
    expect(
      screen.getByTestId('rail-component-AUX-0107').getAttribute('data-state'),
    ).toBe('DONE');
  });

  it('a DONE component is TERMINAL — it cannot be selected', async () => {
    stubApi(
      null,
      {
        sessionId: 'WS-1',
        batchId: 'B-24187',
        state: 'WEIGHING',
        activeComponentId: 'DYE-4471-Y',
        selectedScaleId: 'SCALE-A',
        currentWeight: null,
        weightUnit: null,
        weightStable: true,
        weightStale: false,
        components: [{ componentId: 'AUX-0107', state: 'DONE' }],
        counter: { weighed: 1, total: 1 },
      },
    );

    render(<WeighScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('recipe-rail')).toBeTruthy();
    });

    const done = screen.getByTestId('rail-component-AUX-0107');
    expect((done as HTMLButtonElement).disabled).toBe(true);
  });

  it('the readout shows the weight, the still-to-weigh and the target', async () => {
    stubApi(
      {
        zone: 'OK',
        value: '94.2400',
        unit: 'g',
        target: '94.0000',
        bounds: {
          nearThreshold: '84.6000',
          okLower: '93.5000',
          okUpper: '94.5000',
        },
        stillToWeigh: '0.0000',
      },
      null,
    );

    render(<WeighScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('live-readout')).toBeTruthy();
    });

    // The target and the still-to-weigh, formatted to 1 dp for grams.
    expect(screen.getByTestId('live-target').textContent).toContain('94.0');
    expect(screen.getByTestId('live-still-to-weigh').textContent).toContain(
      '0.0',
    );
  });

  it('the readout shows NO VALUE when there is no reading — never `0.0`', async () => {
    stubApi(
      {
        zone: 'OK',
        value: '94.2400',
        unit: 'g',
        target: '94.0000',
        bounds: null,
        stillToWeigh: '0.0000',
      },
      null,
    );

    render(<WeighScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('live-readout')).toBeTruthy();
    });

    // The weight cell — and it must NOT read `0.0`.
    const cell = screen.getByTestId('live-weight-value');
    expect(cell.textContent).not.toContain('0.0');
    expect(cell.textContent).not.toContain('0');
  });

  it('the three elements share ONE data-zone — so they cannot disagree', async () => {
    stubApi(
      {
        zone: 'NEAR',
        value: '90.0000',
        unit: 'g',
        target: '94.0000',
        bounds: {
          nearThreshold: '84.6000',
          okLower: '93.5000',
          okUpper: '94.5000',
        },
        stillToWeigh: '4.0000',
      },
      null,
    );

    render(<WeighScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('live-readout')).toBeTruthy();
    });

    // THE READOUT, THE INDICATOR AND THE STATUS LINE.
    expect(
      screen.getByTestId('live-readout').getAttribute('data-zone'),
    ).toBe('NEAR');
    expect(
      screen.getByTestId('tolerance-band').getAttribute('data-zone'),
    ).toBe('NEAR');
    expect(
      screen.getByTestId('status-line').getAttribute('data-zone'),
    ).toBe('NEAR');
  });

  it('the band is ACCESSIBLE — a progressbar with its value', async () => {
    stubApi(
      {
        zone: 'OK',
        value: '94.0000',
        unit: 'g',
        target: '94.0000',
        bounds: {
          nearThreshold: '84.6000',
          okLower: '93.5000',
          okUpper: '94.5000',
        },
        stillToWeigh: '0.0000',
      },
      null,
    );

    render(<WeighScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('tolerance-band')).toBeTruthy();
    });

    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
  });

  it('the band is ALWAYS visible — whether or not the zone is OK', async () => {
    stubApi(
      {
        zone: 'OVER',
        value: '120.0000',
        unit: 'g',
        target: '94.0000',
        bounds: {
          nearThreshold: '84.6000',
          okLower: '93.5000',
          okUpper: '94.5000',
        },
        stillToWeigh: '0.0000',
      },
      null,
    );

    render(<WeighScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('tolerance-band')).toBeTruthy();
    });

    expect(screen.getByTestId('tolerance-band-bar')).toBeTruthy();
  });
});
