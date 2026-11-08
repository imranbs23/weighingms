/**
 * The completion view's components.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE CLIENT NEVER COMPOSES THE TICKET. AND A FAILED PRINT IS SHOWN AS
 * NOT PRINTED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * *"A client that assembled the ticket from its own field list would
 * freeze that list into the build and turn every template change into a
 * release"* (FR-17, BRD IR-16).
 *
 * **And a failed print is never shown as a silent success** — the ticket
 * is shown as **not printed**, with the job's error, and the ticket stays
 * available for a later attempt (B-7, BRD FR-19).
 */
import { useState } from 'react';
import { formatQuantity } from '../../format/quantity.js';
import type {
  BatchSummary,
  PrintJobReport,
  TicketReport,
} from '../../api/endpoints.js';
import type { Translate } from '../../i18n/useStrings.js';
import {
  COLOURS,
  MIN_LABEL_PX,
  SPACING,
  TOUCH_TARGET_PX,
} from '../batch-queue/tokens.js';

/**
 * The batch summary — **the domain's**, rendered as received.
 */
export function BatchSummaryView({
  summary,
  t,
}: {
  readonly summary: BatchSummary;
  readonly t: Translate;
}): React.JSX.Element {
  return (
    <section data-testid="batch-summary" data-zone={summary.allWithinTolerance}>
      <div data-testid="summary-batch-id">{summary.batchId}</div>

      <div data-testid="summary-counts">
        {t('completion.summary.components')}:{' '}
        {summary.componentsWeighed}/{summary.componentCount}
      </div>

      {/* THE TOTAL — the API's fixed-point string, formatted. */}
      <div data-testid="summary-total">
        {t('completion.summary.totalDispensed')}:{' '}
        {formatQuantity(summary.totalDispensed, summary.unit)}
      </div>

      <div data-testid="summary-elapsed">
        {t('completion.summary.elapsed')}: {summary.elapsedSeconds} s
      </div>

      <div data-testid="summary-operator">{summary.operatorId}</div>

      {/* THE VERDICT — the API's, and it is a two-valued one. */}
      <div
        data-testid="summary-verdict"
        style={{
          color:
            summary.allWithinTolerance === 'WITHIN_TOLERANCE'
              ? COLOURS.success
              : COLOURS.danger,
        }}
      >
        {t(
          summary.allWithinTolerance === 'WITHIN_TOLERANCE'
            ? 'completion.summary.withinTolerance'
            : 'completion.summary.outOfTolerance',
        )}
      </div>

      <div data-testid="summary-write-back">
        {t('completion.summary.writeBack')}: {summary.writeBack}
      </div>

      <div data-testid="summary-release">
        {summary.releasedForTransport
          ? t('completion.summary.released')
          : t('completion.summary.notReleased')}
        {` — ${summary.targetMachine}`}
      </div>
    </section>
  );
}

/**
 * The per-component detail.
 *
 * **Every component is listed with the zone at the moment it was
 * confirmed** — so an overridden component shows `OVER`, and the reader
 * can see that it was.
 */
export function ComponentDetail({
  ticket,
  t,
}: {
  readonly ticket: TicketReport;
  readonly t: Translate;
}): React.JSX.Element {
  return (
    <table data-testid="component-detail">
      <thead>
        <tr>
          <th>{t('completion.detail.component')}</th>
          <th>{t('completion.detail.target')}</th>
          <th>{t('completion.detail.actual')}</th>
          <th>{t('completion.detail.lot')}</th>
          <th>{t('completion.detail.container')}</th>
          <th>{t('completion.detail.scale')}</th>
          <th>{t('completion.detail.zone')}</th>
        </tr>
      </thead>
      <tbody>
        {ticket.lines.map((line) => (
          <tr key={line.componentId} data-testid={`detail-${line.componentId}`}>
            <td>{line.componentId}</td>
            <td>
              {formatQuantity(line.targetQuantity, line.targetUnit)}
            </td>
            <td>
              {formatQuantity(line.actualQuantity, line.actualUnit)}
            </td>
            <td>{line.lotNumber ?? t('weigh.readout.noValue')}</td>
            <td>{line.containerId ?? t('weigh.readout.noValue')}</td>
            <td>{line.scaleId}</td>
            {/* THE ZONE AT CONFIRMATION — and it is the API's. */}
            <td data-testid={`detail-zone-${line.componentId}`}>
              {line.zoneAtConfirm}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The ticket preview — **the API's ticket**, shown as received.
 *
 * **And the client composes no part of it**: no header text, no footer
 * text, and no layout. The preview shows what the API rendered.
 */
export function TicketPreview({
  ticket,
  t,
}: {
  readonly ticket: TicketReport;
  readonly t: Translate;
}): React.JSX.Element {
  return (
    <section data-testid="ticket-preview">
      {/* THE TEMPLATE AND THE LOCALE — the API's, and the ticket's own. */}
      <div data-testid="ticket-template">
        {t('completion.ticket.template')}: {ticket.templateId}
      </div>

      <div data-testid="ticket-batch">
        {ticket.batch.batchId} — {ticket.batch.orderRef} —{' '}
        {ticket.batch.machineRef} — {ticket.batch.shadeCode}
      </div>

      {/* THE OPERATOR'S IDENTITY — the ticket carries it. */}
      <div data-testid="ticket-operator">{ticket.operatorId}</div>

      <div data-testid="ticket-outcome">{ticket.toleranceOutcome}</div>

      <ComponentDetail ticket={ticket} t={t} />
    </section>
  );
}

/**
 * The print panel — and the job's state is ALWAYS the API's.
 *
 * **A failed print is shown as NOT PRINTED** — never as a silent success,
 * and never as printed.
 */
export function PrintPanel({
  job,
  t,
  onPrint,
  onReprint,
}: {
  readonly job: PrintJobReport | null;
  readonly t: Translate;
  readonly onPrint: () => void;
  readonly onReprint: (reason: string) => void;
}): React.JSX.Element {
  // THE PRINTED STATE — and it is the JOB's state, never the click's
  // optimism. A job that did not reach `DONE` means NOT PRINTED.
  const printed = job?.state === 'DONE';

  // THE REPRINT'S REASON — and it is REQUIRED.
  const [reason, setReason] = useState('');

  return (
    <section data-testid="print-panel" data-printed={printed ? 'true' : 'false'}>
      <button
        type="button"
        data-testid="print-action"
        onClick={onPrint}
        style={{ minHeight: `${TOUCH_TARGET_PX}px`, fontSize: `${MIN_LABEL_PX}px` }}
      >
        {t('completion.print.caption')}
      </button>

      {/* THE JOB'S STATE — visible while it is in flight. */}
      {job !== null && (
        <div
          data-testid="print-job-state"
          data-state={job.state}
          style={{
            color: job.state === 'FAILED' ? COLOURS.danger : COLOURS.textMuted,
          }}
        >
          {t('completion.print.state')}: {job.state}
        </div>
      )}

      {/* THE ERROR — and the ticket is shown as NOT PRINTED. */}
      {job !== null && job.state === 'FAILED' && (
        <div data-testid="print-job-error" style={{ color: COLOURS.danger }}>
          {job.error ?? t('completion.print.failed')}
        </div>
      )}

      {printed && (
        <div data-testid="print-printed" style={{ color: COLOURS.success }}>
          {t('completion.print.printed')}
        </div>
      )}

      {/* THE REPRINT — marked, and it needs a REASON. */}
      <div style={{ marginTop: SPACING.md }}>
        <input
          data-testid="reprint-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t('completion.reprint.reasonPlaceholder')}
          style={{ minHeight: `${TOUCH_TARGET_PX}px`, fontSize: `${MIN_LABEL_PX}px` }}
        />
        <button
          type="button"
          data-testid="reprint-action"
          // The reason is REQUIRED — and the action is disabled without
          // one, so the requirement is visible before the press.
          disabled={reason.trim().length === 0}
          onClick={() => onReprint(reason)}
          style={{
            minHeight: `${TOUCH_TARGET_PX}px`,
            fontSize: `${MIN_LABEL_PX}px`,
          }}
        >
          {t('completion.reprint.caption')}
        </button>
      </div>
    </section>
  );
}
