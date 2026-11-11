/**
 * The completion view — the component tests.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE CLIENT RENDERS THE API's SUMMARY AND THE API's TICKET. AND A
 * FAILED PRINT IS SHOWN AS NOT PRINTED.
 * ══════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { CompletionScreen } from '../../src/007-weighingms-ui/screens/completion/CompletionScreen.js';
import type {
  BatchSummary,
  PrintJobReport,
  TicketReport,
} from '../../src/007-weighingms-ui/api/endpoints.js';

const t = (key: string): string => key;

function summary(overrides: Partial<BatchSummary> = {}): BatchSummary {
  return {
    batchId: 'B-24187',
    sessionId: 'WS-1',
    componentsWeighed: 5,
    componentCount: 5,
    elapsedSeconds: 1840,
    operatorId: 'OP-001',
    totalDispensed: '35.3200',
    unit: 'kg',
    allWithinTolerance: 'YES',
    writeBack: 'CONFIRMED',
    writeBackConfirmedAt: '2026-11-06T10:00:00.000Z',
    releasedForTransport: true,
    targetMachine: 'JET-04',
    ...overrides,
  };
}

function ticket(overrides: Partial<TicketReport> = {}): TicketReport {
  return {
    ticketId: 'TKT-1',
    sessionId: 'WS-1',
    batch: {
      batchId: 'B-24187',
      orderRef: 'SO-9931',
      machineRef: 'JET-04',
      shadeCode: 'Teal 4C',
    },
    operatorId: 'OP-001',
    generatedAt: '2026-11-06T10:00:00.000Z',
    language: 'en',
    templateId: 'DEFAULT',
    toleranceOutcome: 'WITHIN_TOLERANCE',
    lines: [
      {
        componentId: 'DYE-4471-Y',
        materialCode: 'DYE-4471',
        targetQuantity: '94.0000',
        targetUnit: 'g',
        actualQuantity: '94.2400',
        actualUnit: 'g',
        lotNumber: '2026-0387',
        containerId: 'C-12',
        scaleId: 'SCALE-A',
        zoneAtConfirm: 'OK',
        operatorId: 'OP-001',
        weighedAt: '2026-11-06T09:41:07.000Z',
      },
    ],
    ...overrides,
  };
}

function job(
  overrides: Partial<PrintJobReport> = {},
): PrintJobReport {
  return {
    jobId: 'JOB-1',
    ticketId: 'TKT-1',
    state: 'DONE',
    isReprint: false,
    reprintOf: null,
    reason: null,
    attemptedAt: '2026-11-06T10:05:00.000Z',
    completedAt: '2026-11-06T10:05:01.000Z',
    error: null,
    ...overrides,
  };
}

/**
 * Stub the API.
 *
 * @param printState The state the print job reports — `DONE` or `FAILED`.
 */
function stubApi(
  printState: string = 'DONE',
  overrides: {
    readonly summary?: BatchSummary | null;
    readonly ticket?: TicketReport;
  } = {},
): void {
  const reported = overrides.summary ?? summary();
  const reportedTicket = overrides.ticket ?? ticket();

  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const url = String(input);

      if (url.includes('/api/tickets') && url.endsWith('/print')) {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () =>
            Promise.resolve({
              job: job({
                state: printState,
                error:
                  printState === 'FAILED'
                    ? 'The printer is out of paper'
                    : null,
              }),
            }),
        });
      }

      if (url.includes('/api/tickets')) {
        // The GET, or the idempotent POST that generated it.
        return Promise.resolve({
          ok: true,
          status: url.endsWith('/api/tickets') ? 201 : 200,
          json: () => Promise.resolve({ ticket: reportedTicket }),
        });
      }

      if (url.includes('/api/batch')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ summary: reported }),
        });
      }

      // The locale endpoint — and it returns the KEY it was asked for, so
      // the test asserts on the key rather than on a translated string.
      const key = url.split('/').pop() ?? '';
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ value: key }),
      });
    }),
  );
}

describe('the completion view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the batch summary — the DOMAIN’s, rendered as received', async () => {
    stubApi();
    render(<CompletionScreen batchId="B-24187" />);

    await waitFor(() => {
      expect(screen.getByTestId('batch-summary')).toBeTruthy();
    });

    expect(screen.getByTestId('summary-batch-id').textContent).toContain(
      'B-24187',
    );
    expect(screen.getByTestId('summary-counts').textContent).toContain(
      '5/5',
    );
    // The total — the API's fixed-point string, formatted to 3 dp for kg.
    expect(screen.getByTestId('summary-total').textContent).toContain(
      '35.320',
    );
    // The elapsed time in the prototype's form — 1840 s is "30 min 40 s".
    expect(screen.getByTestId('summary-elapsed').textContent).toContain(
      '30 min 40 s',
    );
    expect(screen.getByTestId('summary-operator').textContent).toContain(
      'OP-001',
    );
    expect(
      screen.getByTestId('summary-verdict').textContent,
    ).toContain('completion.summary.withinTolerance');
  });

  it('shows the OUT-OF-TOLERANCE verdict when the API says NO', async () => {
    // The API's verdict is `YES` / `NO` — unit 003's own two-valued
    // vocabulary (ADR-041), not the ticket's `WITHIN_TOLERANCE` /
    // `OUT_OF_TOLERANCE`. The client must read the summary's vocabulary.
    stubApi('DONE', {
      summary: summary({ allWithinTolerance: 'NO' }),
    });
    render(<CompletionScreen batchId="B-24187" />);

    await waitFor(() => {
      expect(screen.getByTestId('batch-summary')).toBeTruthy();
    });

    expect(
      screen.getByTestId('summary-verdict').textContent,
    ).toContain('completion.summary.outOfTolerance');
  });

  it('shows the per-component detail — with the ZONE AT CONFIRMATION', async () => {
    stubApi('DONE', {
      ticket: ticket({
        lines: [
          {
            ...ticket().lines[0]!,
            zoneAtConfirm: 'OVER',
          },
        ],
      }),
    });
    render(<CompletionScreen batchId="B-24187" />);

    await waitFor(() => {
      expect(screen.getByTestId('component-detail')).toBeTruthy();
    });

    // The target, the actual, the lot, the container, the scale.
    const row = screen.getByTestId('detail-DYE-4471-Y');
    expect(row.textContent).toContain('94.0');
    expect(row.textContent).toContain('94.2');
    expect(row.textContent).toContain('2026-0387');
    expect(row.textContent).toContain('C-12');
    expect(row.textContent).toContain('SCALE-A');
    // And the zone AT CONFIRMATION — `OVER` for an overridden component.
    expect(
      screen.getByTestId('detail-zone-DYE-4471-Y').textContent,
    ).toBe('OVER');
  });

  it('shows the ticket preview — the API’s ticket, with its template', async () => {
    stubApi();
    render(<CompletionScreen batchId="B-24187" />);

    await waitFor(() => {
      expect(screen.getByTestId('ticket-preview')).toBeTruthy();
    });

    // The template and the identity — the API's.
    expect(screen.getByTestId('ticket-template').textContent).toContain(
      'DEFAULT',
    );
    expect(screen.getByTestId('ticket-batch').textContent).toContain(
      'B-24187',
    );
    // And the OPERATOR's identity is on the ticket.
    expect(screen.getByTestId('ticket-operator').textContent).toContain(
      'OP-001',
    );
  });

  it('a FAILED print is shown as NOT PRINTED — with its error', async () => {
    stubApi('FAILED');
    render(<CompletionScreen batchId="B-24187" />);

    await waitFor(() => {
      expect(screen.getByTestId('print-panel')).toBeTruthy();
    });

    await userEvent.click(screen.getByTestId('print-action'));

    await waitFor(() => {
      expect(screen.getByTestId('print-job-state')).toBeTruthy();
    });

    // The state is the JOB's.
    expect(
      screen.getByTestId('print-job-state').getAttribute('data-state'),
    ).toBe('FAILED');
    // The error is shown.
    expect(screen.getByTestId('print-job-error').textContent).toContain(
      'The printer is out of paper',
    );
    // AND the ticket is shown as NOT PRINTED — never as printed.
    expect(
      screen.getByTestId('print-panel').getAttribute('data-printed'),
    ).toBe('false');
    expect(screen.queryByTestId('print-printed')).toBeNull();
  });

  it('a SUCCESSFUL print is shown as printed', async () => {
    stubApi('DONE');
    render(<CompletionScreen batchId="B-24187" />);

    await waitFor(() => {
      expect(screen.getByTestId('print-panel')).toBeTruthy();
    });

    await userEvent.click(screen.getByTestId('print-action'));

    await waitFor(() => {
      expect(screen.getByTestId('print-printed')).toBeTruthy();
    });

    expect(
      screen.getByTestId('print-panel').getAttribute('data-printed'),
    ).toBe('true');
  });

  it('the REPRINT is disabled without a reason — and enabled with one', async () => {
    stubApi();
    render(<CompletionScreen batchId="B-24187" />);

    await waitFor(() => {
      expect(screen.getByTestId('print-panel')).toBeTruthy();
    });

    // The reason is REQUIRED — and the requirement is visible before the
    // press.
    expect(
      (screen.getByTestId('reprint-action') as HTMLButtonElement).disabled,
    ).toBe(true);

    await userEvent.type(
      screen.getByTestId('reprint-reason'),
      'the original was damaged',
    );

    expect(
      (screen.getByTestId('reprint-action') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('the API being UNREACHABLE shows a degraded state — not a stale preview', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('the network is down'))),
    );

    render(<CompletionScreen batchId="B-24187" />);

    await waitFor(() => {
      expect(screen.getByTestId('completion-degraded')).toBeTruthy();
    });

    // And NO summary and NO preview are rendered as though they were
    // current (BRD FR-20).
    expect(screen.queryByTestId('batch-summary')).toBeNull();
    expect(screen.queryByTestId('ticket-preview')).toBeNull();
  });

  it('every action’s touch target is AT LEAST 15 mm', async () => {
    stubApi();
    render(<CompletionScreen batchId="B-24187" />);

    await waitFor(() => {
      expect(screen.getByTestId('print-panel')).toBeTruthy();
    });

    for (const button of screen.getAllByRole('button')) {
      const styles = window.getComputedStyle(button);
      expect(
        Number.parseFloat(styles.minHeight || '0'),
      ).toBeGreaterThanOrEqual(56);
    }
  });
});
