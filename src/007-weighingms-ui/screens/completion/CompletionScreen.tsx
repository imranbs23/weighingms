/**
 * CompletionScreen — the batch's review and its ticket.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE CLIENT RENDERS THE API's SUMMARY AND THE API's TICKET. IT
 * COMPOSES NEITHER.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The summary is the **domain's** (unit `003`, story 009) — the verdict,
 * the summed total and the write-back result are all received values
 * (FR-15). And the ticket is the **API's rendering** of it (FR-17,
 * BRD IR-16).
 */
import { useEffect, useState } from 'react';
import {
  createTicketEndpoint,
  fetchPrintJob,
  fetchSummary,
  fetchTicket,
  printTicket,
  reprintTicket,
  type BatchSummary,
  type PrintJobReport,
  type TicketReport,
} from '../../api/endpoints.js';
import { useStrings } from '../../i18n/useStrings.js';
import { useWorkflowStore } from '../../state/workflow-store.js';
import { useFunctionKeys } from '../weigh/ActionRow.js';
import {
  BatchSummaryView,
  ComponentDetail,
  PrintPanel,
  TicketPreview,
} from './components.js';

/** Every locale key the completion view uses. */
export const COMPLETION_KEYS = [
  'completion.title',
  'completion.summary.batch',
  'completion.summary.weighed',
  'completion.summary.operator',
  'completion.ticket.heading',
  'completion.ticket.batch',
  'completion.ticket.order',
  'completion.ticket.machine',
  'completion.ticket.shade',
  'completion.ticket.date',
  'completion.ticket.operator',
  'completion.ticket.target',
  'completion.ticket.actual',
  'completion.ticket.trainingLabel',
  'completion.nextBatch.caption',
  'completion.summary.components',
  'completion.summary.totalDispensed',
  'completion.summary.elapsed',
  'completion.summary.withinTolerance',
  'completion.summary.outOfTolerance',
  'completion.summary.writeBack',
  'completion.summary.released',
  'completion.summary.notReleased',
  'completion.detail.component',
  'completion.detail.target',
  'completion.detail.actual',
  'completion.detail.lot',
  'completion.detail.container',
  'completion.detail.scale',
  'completion.detail.zone',
  'completion.zone.overridden',
  'completion.ticket.template',
  'completion.print.caption',
  'completion.print.state',
  'completion.print.failed',
  'completion.print.printed',
  'completion.reprint.caption',
  'completion.reprint.reasonPlaceholder',
  'completion.degraded.title',
  'completion.degraded.body',
  'weigh.readout.noValue',
] as const;

export function CompletionScreen({
  batchId,
}: {
  readonly batchId: string;
}): React.JSX.Element {
  const t = useStrings(COMPLETION_KEYS);

  const [summary, setSummary] = useState<BatchSummary | null>(null);
  const [ticket, setTicket] = useState<TicketReport | null>(null);
  const [job, setJob] = useState<PrintJobReport | null>(null);
  const [degraded, setDegraded] = useState<string | null>(null);
  const nextBatch = useWorkflowStore((s) => s.nextBatch);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      const summaryResult = await fetchSummary(batchId);

      if (cancelled) return;

      if (summaryResult.kind !== 'OK' || summaryResult.body.summary === null) {
        // THE API IS UNREACHABLE, or the batch is not complete. Either way
        // the view shows a **degraded** state with a stated reason — and
        // it does NOT render a stale preview as though it were current
        // (BRD FR-20).
        setDegraded('completion.degraded.title');
        return;
      }

      setDegraded(null);
      setSummary(summaryResult.body.summary);

      // THE TICKET — generated if it is not there yet, and it is
      // **idempotent**, so the retry returns the SAME ticket.
      const ticketResult = await fetchTicketFor(summaryResult.body.summary);
      if (cancelled) return;

      if (ticketResult !== null) setTicket(ticketResult);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [batchId]);

  const onPrint = async (): Promise<void> => {
    if (ticket === null) return;

    const result = await printTicket(ticket.ticketId);
    if (result.kind !== 'OK') return;

    // THE JOB'S STATE — the API's, and never the click's optimism.
    setJob(result.body.job);
  };

  const onReprint = async (reason: string): Promise<void> => {
    if (ticket === null) return;
    if (reason.trim().length === 0) return;

    const result = await reprintTicket(ticket.ticketId, reason);
    if (result.kind !== 'OK') return;

    setJob(result.body.job);
  };

  // F1 prints, F3 goes to the next batch — the same handlers as the keys.
  useFunctionKeys({
    F1: ticket === null ? null : () => void onPrint(),
    F3: nextBatch,
  });

  return (
    <main className="done-stage" data-testid="completion-screen" aria-label={t('completion.title')}>
      <div className="done-msg">
        {degraded !== null && (
          <section className="alert" data-testid="completion-degraded" role="alert">
            <h2 style={{ margin: 0 }}>{t('completion.degraded.title')}</h2>
            <p style={{ margin: 0 }}>{t('completion.degraded.body')}</p>
          </section>
        )}

        {summary !== null && <BatchSummaryView summary={summary} t={t} />}

        <PrintPanel
          job={job}
          t={t}
          onPrint={() => {
            void onPrint();
          }}
          onReprint={(reason) => {
            void onReprint(reason);
          }}
          onNextBatch={nextBatch}
        />

        {/* THE PER-COMPONENT DETAIL — lot, container, scale and the zone at
            confirmation: the traceability the ticket summarises. */}
        {ticket !== null && <ComponentDetail ticket={ticket} t={t} />}
      </div>

      {ticket !== null && <TicketPreview ticket={ticket} t={t} />}
    </main>
  );
}

async function fetchTicketFor(
  summary: BatchSummary,
): Promise<TicketReport | null> {
  const created = await createTicket();
  if (created === null) return null;

  const result = await fetchTicket(created.ticketId);
  if (result.kind !== 'OK') return null;

  // The batch's own ticket — and the summary's session is its anchor.
  if (result.body.ticket.sessionId !== summary.sessionId) return null;

  return result.body.ticket;
}

/**
 * Generate the ticket — and the generation is **idempotent**.
 *
 * **And it goes through the ONE client.** A raw `fetch` would post to the
 * SPA's own origin — where the API does not live — and it would carry no
 * bearer token, so the API would answer `401 UNAUTHENTICATED` and the
 * ticket would never be created. The credential travels on every call, and
 * the base URL is the API's (BRD IR-07, unit 008's technical context).
 */
async function createTicket(): Promise<{ ticketId: string } | null> {
  const response = await createTicketEndpoint();
  if (response.kind !== 'OK') return null;
  return response.body.ticket;
}
