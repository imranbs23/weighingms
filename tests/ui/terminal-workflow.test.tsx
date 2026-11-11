/**
 * The operator terminal's workflow — the client's side (bolt 029).
 *
 * ══════════════════════════════════════════════════════════════════════
 * EVERY MOVE FOLLOWS AN API SUCCESS. THE CLIENT DECIDES NO RULE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The workflow store, the function keys, the strip's peripherals, the
 * training bar, Next batch, and the ticket's barcode.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useWorkflowStore } from '../../src/007-weighingms-ui/state/workflow-store.js';
import { useStatusStore } from '../../src/007-weighingms-ui/state/status-store.js';
import { useWeighStore } from '../../src/007-weighingms-ui/state/weigh-store.js';
import { ActionRow } from '../../src/007-weighingms-ui/screens/weigh/ActionRow.js';
import { WeighScreen } from '../../src/007-weighingms-ui/screens/weigh/WeighScreen.js';
import { StatusStrip } from '../../src/007-weighingms-ui/screens/status/StatusStrip.js';
import { PrintPanel } from '../../src/007-weighingms-ui/screens/completion/components.js';
import { code128 } from '../../src/007-weighingms-ui/format/code128.js';

const t = (key: string): string => key;

type Handler = (
  url: string,
  init?: RequestInit,
) => { status: number; body: unknown } | undefined;

/** Stub `fetch` by URL — an unmatched URL is a 404, never a silent 200. */
function stubFetch(handler: Handler): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    const answer = handler(String(input), init) ?? {
      status: 404,
      body: { error: 'NOT_FOUND' },
    };
    return Promise.resolve({
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: () => Promise.resolve(answer.body),
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const SESSION = {
  sessionId: 'WS-1',
  batchId: 'B-24187',
  operatorId: 'OP-001',
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
  ],
  counter: { weighed: 0, total: 2 },
};

const RECIPE = {
  recipe: {
    batchId: 'B-24187',
    shadeCode: 'Teal 4C',
    components: [
      {
        sequence: 1,
        componentId: 'DYE-4471-Y',
        dyestuffCode: 'DYE-4471',
        name: 'Remazol Yellow RGB',
        swatchColour: '#d9a520',
        target: '94.0000',
        unit: 'g',
        tolerance: { min: '93.5000', max: '94.5000' },
        scaleClass: 'PRECISION',
        state: 'PENDING',
      },
      {
        sequence: 2,
        componentId: 'AUX-0101',
        dyestuffCode: 'AUX-0101',
        name: 'Sodium Sulphate',
        swatchColour: null,
        target: '24.0000',
        unit: 'kg',
        tolerance: { min: '23.8800', max: '24.1200' },
        scaleClass: 'FLOOR',
        state: 'PENDING',
      },
    ],
  },
};

function scale(source: string) {
  return {
    scaleId: 'SCALE-A',
    label: '3 kg precision',
    class: 'PRECISION',
    capacity: '3000',
    unit: 'g',
    status: 'CONNECTED',
    link: 'UP',
    source,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the workflow store', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      view: 'QUEUE',
      batchId: null,
      refusal: null,
      busy: false,
    });
  });

  it('a batch is OPENED only after the recipe is read and the station started it', async () => {
    const fetchMock = stubFetch((url) =>
      url.includes('/api/recipe/B-24187')
        ? { status: 200, body: RECIPE }
        : url.includes('/api/session/start')
          ? { status: 200, body: { session: SESSION } }
          : undefined,
    );

    await useWorkflowStore.getState().openBatch('B-24187');

    expect(useWorkflowStore.getState().view).toBe('WEIGH');
    expect(useWorkflowStore.getState().batchId).toBe('B-24187');
    // The order is the station's: the recipe, then the start.
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.findIndex((url) => url.includes('/api/recipe/'))).toBeLessThan(
      urls.findIndex((url) => url.includes('/api/session/start')),
    );
  });

  it('another batch IN PROGRESS keeps the operator on the queue — with the reason', async () => {
    stubFetch((url) =>
      url.includes('/api/recipe/')
        ? { status: 200, body: RECIPE }
        : url.includes('/api/session/start')
          ? {
              status: 409,
              body: { error: 'OTHER_BATCH_IN_PROGRESS', reason: 'OTHER_BATCH_IN_PROGRESS' },
            }
          : undefined,
    );

    await useWorkflowStore.getState().openBatch('B-24188');

    expect(useWorkflowStore.getState().view).toBe('QUEUE');
    expect(useWorkflowStore.getState().refusal).toBe('workflow.refusal.otherBatch');
  });

  it('on sign-in a COMPLETE session opens the completion view', async () => {
    stubFetch((url) =>
      url.endsWith('/api/session')
        ? { status: 200, body: { session: { ...SESSION, state: 'COMPLETE' } } }
        : undefined,
    );

    await useWorkflowStore.getState().decide();

    expect(useWorkflowStore.getState().view).toBe('COMPLETE');
    expect(useWorkflowStore.getState().batchId).toBe('B-24187');
  });

  it('on sign-in an UNFINISHED session is resumed in the weigh view', async () => {
    stubFetch((url) =>
      url.endsWith('/api/session')
        ? { status: 200, body: { session: SESSION } }
        : url.includes('/api/recipe/')
          ? { status: 200, body: RECIPE }
          : url.includes('/api/session/start')
            ? { status: 200, body: { session: SESSION } }
            : undefined,
    );

    await useWorkflowStore.getState().decide();

    expect(useWorkflowStore.getState().view).toBe('WEIGH');
  });

  it('completing a batch moves to the completion view only when the STATION completed it', async () => {
    useWorkflowStore.setState({ view: 'WEIGH', batchId: 'B-24187' });
    stubFetch((url) =>
      url.includes('/api/batch/B-24187/complete')
        ? { status: 409, body: { error: 'BATCH_NOT_COMPLETE' } }
        : undefined,
    );

    await useWorkflowStore.getState().complete();

    expect(useWorkflowStore.getState().view).toBe('WEIGH');
    expect(useWorkflowStore.getState().refusal).toBe('workflow.refusal.notComplete');
  });

  it('Quit returns to the queue and KEEPS the batch in progress', () => {
    useWorkflowStore.setState({ view: 'WEIGH', batchId: 'B-24187' });
    useWorkflowStore.getState().quit();
    expect(useWorkflowStore.getState().view).toBe('QUEUE');
  });
});

describe('the function keys', () => {
  const ready = { enabled: true, reason: 'weigh.confirm.ok' };
  const blocked = { enabled: false, reason: 'weigh.confirm.over' };

  it('F1, F2 and F4 dispatch the SAME handlers as the buttons', () => {
    const onConfirm = vi.fn();
    const onReTare = vi.fn();
    const onAbandon = vi.fn();
    render(
      <ActionRow
        confirm={ready}
        busy={false}
        canReTare={true}
        t={t}
        onConfirm={onConfirm}
        onReTare={onReTare}
        onAbandon={onAbandon}
      />,
    );

    fireEvent.keyDown(window, { key: 'F1' });
    fireEvent.keyDown(window, { key: 'F2' });
    fireEvent.keyDown(window, { key: 'F4' });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onReTare).toHaveBeenCalledTimes(1);
    expect(onAbandon).toHaveBeenCalledTimes(1);
  });

  it('F1 does NOTHING while the confirm is disabled — the key is not a back door', () => {
    const onConfirm = vi.fn();
    render(
      <ActionRow
        confirm={blocked}
        busy={false}
        t={t}
        onConfirm={onConfirm}
        onAbandon={() => undefined}
      />,
    );

    fireEvent.keyDown(window, { key: 'F1' });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(
      (screen.getByTestId('confirm-action') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByTestId('confirm-reason').textContent).toBe(
      'weigh.confirm.over',
    );
  });

  it('every key shows its function key — and meets the touch target', () => {
    render(
      <ActionRow
        confirm={ready}
        busy={false}
        canReTare={true}
        t={t}
        onConfirm={() => undefined}
        onReTare={() => undefined}
        onAbandon={() => undefined}
        onOverride={() => undefined}
      />,
    );

    expect(screen.getByTestId('confirm-action').textContent).toContain('F1');
    expect(screen.getByTestId('retare-action').textContent).toContain('F2');
    expect(screen.getByTestId('abandon-action').textContent).toContain('F4');
    for (const button of screen.getAllByRole('button')) {
      expect(
        Number.parseFloat(window.getComputedStyle(button).minHeight || '0'),
      ).toBeGreaterThanOrEqual(56);
    }
  });

  it('Next batch is on F3 in the completion view', () => {
    const onNextBatch = vi.fn();
    render(
      <PrintPanel
        job={null}
        t={t}
        onPrint={() => undefined}
        onReprint={() => undefined}
        onNextBatch={onNextBatch}
      />,
    );

    expect(screen.getByTestId('next-batch-action').textContent).toContain('F3');
    fireEvent.click(screen.getByTestId('next-batch-action'));
    expect(onNextBatch).toHaveBeenCalledTimes(1);
  });
});

describe('the peripherals in the strip', () => {
  it('a CONNECTED scale is healthy and shown READY, by its label', async () => {
    stubFetch((url) =>
      url.includes('/api/scales')
        ? { status: 200, body: { scales: [scale('DUMMY')] } }
        : url.includes('/api/orgatex/link-state')
          ? {
              status: 200,
              body: {
                status: 'LINKED',
                lastContactAt: null,
                unsynchronisedCount: 0,
                lastError: null,
                consecutiveFailures: 0,
              },
            }
          : url.includes('/api/orgatex/sync-queue')
            ? { status: 200, body: { count: 0, entries: [] } }
            : url.includes('/api/scanner/status')
              ? { status: 200, body: { state: 'READY', source: 'DUMMY' } }
              : url.includes('/api/printer/status')
                ? {
                    status: 200,
                    body: { state: 'UNAVAILABLE', reason: 'Out of paper', source: 'DUMMY' },
                  }
                : undefined,
    );

    await useStatusStore.getState().load();
    const status = useStatusStore.getState();

    expect(status.scales[0]).toMatchObject({
      id: 'SCALE-A',
      state: 'READY',
      healthy: true,
      label: '3 kg precision',
    });
    expect(status.scanner).toMatchObject({ id: 'SCANNER', healthy: true });
    expect(status.printer).toMatchObject({
      id: 'PRINTER',
      state: 'UNAVAILABLE',
      healthy: false,
      reason: 'status.peripheral.unavailable',
    });
  });

  it('the strip shows the scanner, the printer, the locale and the clock', () => {
    render(
      <StatusStrip
        scales={[]}
        link={null}
        scanner={{ id: 'SCANNER', state: 'READY', healthy: true, reason: 'status.state.ready', ageMs: null }}
        printer={{
          id: 'PRINTER',
          state: 'UNAVAILABLE',
          healthy: false,
          reason: 'status.peripheral.unavailable',
          ageMs: null,
        }}
        unsynchronisedCount={0}
        queue={[]}
        apiReachable={true}
        t={t}
      />,
    );

    expect(screen.getByTestId('peripheral-SCANNER').getAttribute('data-healthy')).toBe('true');
    expect(screen.getByTestId('peripheral-PRINTER').getAttribute('data-healthy')).toBe('false');
    expect(screen.getByTestId('peripheral-reason-PRINTER').textContent).toBe(
      'status.peripheral.unavailable',
    );
    expect(screen.getByTestId('status-locale').textContent).toBe('status.locale');
    expect(screen.getByTestId('status-clock').textContent).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

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

  function stubWeigh(source: string): void {
    stubFetch((url) =>
      url.includes('/api/session/zone')
        ? { status: 200, body: { zone: null } }
        : url.endsWith('/api/session')
          ? { status: 200, body: { session: SESSION } }
          : url.includes('/api/recipe/')
            ? { status: 200, body: RECIPE }
            : url.includes('/api/scales/SCALE-A/stream')
              ? undefined
              : url.includes('/api/scales')
                ? { status: 200, body: { scales: [scale(source)] } }
                : url.includes('/api/material-lot/')
                  ? { status: 200, body: { capture: null } }
                  : url.includes('/api/container/')
                    ? { status: 200, body: { assignment: null } }
                    : { status: 200, body: { value: 'x' } },
    );
  }

  it('the rail is the RECIPE’s — names and targets — with the session’s states', async () => {
    stubWeigh('DUMMY');
    render(<WeighScreen batchId="B-24187" />);

    await waitFor(() => {
      expect(screen.getByTestId('rail-component-AUX-0101').textContent).toContain(
        'Sodium Sulphate',
      );
    });
    expect(
      screen.getByTestId('rail-component-DYE-4471-Y').getAttribute('data-state'),
    ).toBe('ACTIVE');
    expect(screen.getByTestId('rail-component-AUX-0101').textContent).toContain(
      '24.000',
    );
  });

  it('the TRAINING bar is shown for the dummy scale — and the dispense sends only the landing', async () => {
    stubWeigh('DUMMY');
    render(<WeighScreen batchId="B-24187" />);

    await waitFor(() => {
      expect(screen.getByTestId('training-bar')).toBeTruthy();
    });

    const fetchMock = vi.mocked(fetch);
    fireEvent.click(screen.getByTestId('training-dispense'));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((entry) =>
        String(entry[0]).includes('/api/session/training/dispense'),
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        landing: 'IN_TOLERANCE',
      });
    });
  });

  it('a GRAM stream on a KILOGRAM component reads in kilograms — the station’s converted value', async () => {
    // The 32 kg floor scale streams grams; Sodium Sulphate is in kg. The
    // readout must not put "23995.9" beside a "24.000" target in one unit.
    stubFetch((url) =>
      url.includes('/api/session/zone')
        ? {
            status: 200,
            body: {
              zone: 'OK',
              value: '23.9959',
              unit: 'kg',
              target: '24.0000',
              bounds: { nearThreshold: '21.6000', okLower: '23.8800', okUpper: '24.1200' },
              stillToWeigh: '0.0041',
            },
          }
        : url.endsWith('/api/session')
          ? {
              status: 200,
              body: {
                session: { ...SESSION, activeComponentId: 'AUX-0101', selectedScaleId: 'SCALE-B' },
              },
            }
          : url.includes('/api/recipe/')
            ? { status: 200, body: RECIPE }
            : url.includes('/api/scales')
              ? { status: 200, body: { scales: [] } }
              : url.includes('/api/material-lot/')
                ? { status: 200, body: { capture: null } }
                : url.includes('/api/container/')
                  ? { status: 200, body: { assignment: null } }
                  : { status: 200, body: { value: 'x' } },
    );
    render(<WeighScreen batchId="B-24187" />);

    // The stream hook clears the store when it binds — the reading arrives
    // after, as the stream's would.
    await waitFor(() => {
      expect(screen.getByTestId('live-readout').getAttribute('data-zone')).toBe('OK');
    });
    act(() => {
      useWeighStore.setState({
        reading: {
          scaleId: 'SCALE-B',
          value: '23995.9',
          unit: 'g',
          stable: true,
          sequence: 1,
          receivedAt: new Date().toISOString(),
        },
        // Held "fresh" for the test's duration.
        receivedAt: Date.now() + 60_000,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('live-weight-value').textContent).toContain('23.996');
    });
    expect(screen.getByTestId('live-weight-unit').textContent).toBe('kg');
    expect(screen.getByTestId('live-weight-value').textContent).not.toContain('23995');
  });

  it('the training bar is NEVER shown for a real device', async () => {
    stubWeigh('DEVICE');
    render(<WeighScreen batchId="B-24187" />);

    await waitFor(() => {
      expect(screen.getByTestId('weigh-scale').textContent).toContain('3 kg precision');
    });
    expect(screen.queryByTestId('training-bar')).toBeNull();
  });
});

describe('the ticket’s barcode — Code 128-B', () => {
  it('every symbol is 11 modules, the stop 13 — so the width follows from the length', () => {
    for (const text of ['B-24187', 'A', 'B-24191']) {
      const { modules } = code128(text);
      // start + data + check, 11 modules each, and the 13-module stop.
      expect(modules).toBe((text.length + 2) * 11 + 13);
    }
  });

  it('the check character is the standard’s modulo-103 sum', () => {
    // "A" in code set B is value 33: (104 + 33 × 1) mod 103 = 34, whose
    // pattern is 131123 — so its bars are 1, 1 and 2 modules wide.
    const { bars } = code128('A');
    const checkBars = bars.slice(6, 9).map((bar) => bar.width);
    expect(checkBars).toEqual([1, 1, 2]);
  });

  it('refuses a character code set B cannot carry', () => {
    expect(() => code128('Bé')).toThrow();
  });
});
