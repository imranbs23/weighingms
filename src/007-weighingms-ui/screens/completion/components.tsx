/**
 * The completion view's parts — the prototype's "3 · Confirm & print".
 *
 * The summary and the ticket are the API's (story 004, ADR-042): the client
 * renders the ticket the station generated and composes no part of it. The
 * barcode is DRAWN from the ticket's batch id, as a training label — the
 * physical symbology is unconfirmed (Q-18).
 */
import { useState } from 'react';
import { formatQuantity } from '../../format/quantity.js';
import { code128 } from '../../format/code128.js';
import type {
  BatchSummary,
  PrintJobReport,
  TicketReport,
} from '../../api/endpoints.js';
import type { Translate } from '../../i18n/useStrings.js';
import { MIN_LABEL_PX, TOUCH_TARGET_PX } from '../batch-queue/tokens.js';

export function BatchSummaryView({
  summary,
  t,
}: {
  readonly summary: BatchSummary;
  readonly t: Translate;
}): React.JSX.Element {
  const within = summary.allWithinTolerance === 'YES';
  const written = summary.writeBack === 'CONFIRMED';

  return (
    <section className="done-msg" data-testid="batch-summary" data-zone={summary.allWithinTolerance}>
      <h1 className="h">
        {t('completion.summary.batch')}{' '}
        <span data-testid="summary-batch-id">{summary.batchId}</span>{' '}
        {t('completion.summary.weighed')}
      </h1>

      <div className="summary">
        <div className="r" data-testid="summary-counts">
          <span className="k">{t('completion.summary.components')}</span>
          <span className="v">
            {summary.componentsWeighed}/{summary.componentCount}
          </span>
        </div>

        {/* THE VERDICT — the API's, and it is a two-valued one (ADR-041). */}
        <div className="r" data-testid="summary-verdict">
          <span className="k">
            {t(
              within
                ? 'completion.summary.withinTolerance'
                : 'completion.summary.outOfTolerance',
            )}
          </span>
          <span className={within ? 'v good' : 'v bad'}>
            {summary.allWithinTolerance}
          </span>
        </div>

        {/* THE TOTAL — the API's fixed-point string, formatted. */}
        <div className="r" data-testid="summary-total">
          <span className="k">{t('completion.summary.totalDispensed')}</span>
          <span className="v">
            {formatQuantity(summary.totalDispensed, summary.unit)} {summary.unit}
          </span>
        </div>

        <div className="r" data-testid="summary-elapsed">
          <span className="k">{t('completion.summary.elapsed')}</span>
          <span className="v">{formatElapsed(summary.elapsedSeconds)}</span>
        </div>

        <div className="r">
          <span className="k">{t('completion.summary.operator')}</span>
          <span className="v" data-testid="summary-operator">
            {summary.operatorId}
          </span>
        </div>

        <div className="r" data-testid="summary-write-back">
          <span className="k">{t('completion.summary.writeBack')}</span>
          <span className={written ? 'v good' : 'v bad'}>
            {summary.writeBack}
            {summary.writeBackConfirmedAt !== null &&
              ` ${summary.writeBackConfirmedAt.slice(11, 19)}`}
          </span>
        </div>
      </div>

      <p className="release" data-testid="summary-release">
        {summary.releasedForTransport
          ? t('completion.summary.released')
          : t('completion.summary.notReleased')}
        {` — ${summary.targetMachine}`}
      </p>
    </section>
  );
}

export function ComponentDetail({
  ticket,
  t,
}: {
  readonly ticket: TicketReport;
  readonly t: Translate;
}): React.JSX.Element {
  return (
    <table className="detail" data-testid="component-detail">
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
              {formatQuantity(line.targetQuantity, line.targetUnit)} {line.targetUnit}
            </td>
            <td>
              {formatQuantity(line.actualQuantity, line.actualUnit)} {line.actualUnit}
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

/** The ticket as paper — the prototype's, from the API's ticket. */
export function TicketPreview({
  ticket,
  t,
}: {
  readonly ticket: TicketReport;
  readonly t: Translate;
}): React.JSX.Element {
  return (
    <div>
      <section className="ticket" data-testid="ticket-preview">
        <div className="c bold">{t('completion.ticket.heading')}</div>
        <hr />
        <div data-testid="ticket-batch">
          <div className="row">
            <span>{t('completion.ticket.batch')}</span>
            <span>{ticket.batch.batchId}</span>
          </div>
          <div className="row">
            <span>{t('completion.ticket.order')}</span>
            <span>{ticket.batch.orderRef}</span>
          </div>
          <div className="row">
            <span>{t('completion.ticket.machine')}</span>
            <span>{ticket.batch.machineRef}</span>
          </div>
          <div className="row">
            <span>{t('completion.ticket.shade')}</span>
            <span>{ticket.batch.shadeCode}</span>
          </div>
        </div>
        <div className="row">
          <span>{t('completion.ticket.date')}</span>
          <span data-testid="ticket-date">
            {ticket.generatedAt.slice(0, 16).replace('T', ' ')}
          </span>
        </div>
        {/* THE OPERATOR'S IDENTITY — the ticket carries it. */}
        <div className="row">
          <span>{t('completion.ticket.operator')}</span>
          <span data-testid="ticket-operator">{ticket.operatorId}</span>
        </div>
        <hr />
        <table>
          <thead>
            <tr>
              <th>{t('completion.detail.component')}</th>
              <th>{t('completion.ticket.target')}</th>
              <th>{t('completion.ticket.actual')}</th>
            </tr>
          </thead>
          <tbody>
            {ticket.lines.map((line) => (
              <tr key={line.componentId} data-testid={`ticket-line-${line.componentId}`}>
                <td>{line.materialCode}</td>
                <td>{formatQuantity(line.targetQuantity, line.targetUnit)}</td>
                <td>
                  {formatQuantity(line.actualQuantity, line.actualUnit)} {line.actualUnit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <hr />
        <div className="c" data-testid="ticket-outcome">
          {ticket.toleranceOutcome}
        </div>
        <Barcode value={ticket.batch.batchId} />
        <div className="c">{ticket.batch.batchId}</div>
      </section>
      <p className="ticket-note">
        <span data-testid="ticket-template">
          {t('completion.ticket.template')} {ticket.templateId}
        </span>
        {' · '}
        {t('completion.ticket.trainingLabel')}
      </p>
    </div>
  );
}

/** The batch id as a Code 128 barcode — drawn, never an image file. */
export function Barcode({ value }: { readonly value: string }): React.JSX.Element {
  const { bars, modules } = code128(value);
  // The quiet zone — ten modules either side, as the standard asks.
  const quiet = 10;
  return (
    <svg
      className="barcode"
      data-testid="ticket-barcode"
      data-value={value}
      viewBox={`0 0 ${modules + quiet * 2} 40`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {bars.map((bar) => (
        <rect
          key={bar.x}
          x={bar.x + quiet}
          y={0}
          width={bar.width}
          height={40}
          fill="#14171a"
        />
      ))}
    </svg>
  );
}

export function PrintPanel({
  job,
  t,
  onPrint,
  onReprint,
  onNextBatch,
}: {
  readonly job: PrintJobReport | null;
  readonly t: Translate;
  readonly onPrint: () => void;
  readonly onReprint: (reason: string) => void;
  /** Back to the queue — the prototype's "Next batch" (F3). */
  readonly onNextBatch?: () => void;
}): React.JSX.Element {
  const printed = job?.state === 'DONE';

  const [reason, setReason] = useState('');

  const keyStyle = {
    minHeight: `${Math.max(TOUCH_TARGET_PX, 64)}px`,
    fontSize: `${MIN_LABEL_PX}px`,
  };

  return (
    <section
      className="done-msg"
      data-testid="print-panel"
      data-printed={printed ? 'true' : 'false'}
    >
      <div className="actions">
        <button
          type="button"
          className="key ok"
          data-testid="print-action"
          onClick={onPrint}
          style={keyStyle}
        >
          {t('completion.print.caption')}
          <span className="fn">F1</span>
        </button>

        {onNextBatch !== undefined && (
          <button
            type="button"
            className="key"
            data-testid="next-batch-action"
            onClick={onNextBatch}
            style={keyStyle}
          >
            {t('completion.nextBatch.caption')}
            <span className="fn">F3</span>
          </button>
        )}
      </div>

      {/* THE JOB'S STATE — visible while it is in flight. */}
      {job !== null && (
        <div
          data-testid="print-job-state"
          data-state={job.state}
          className={job.state === 'FAILED' ? 'alert' : 'k-label'}
        >
          {t('completion.print.state')} {job.state}
        </div>
      )}

      {/* THE ERROR — and the ticket is shown as NOT PRINTED. */}
      {job !== null && job.state === 'FAILED' && (
        <div className="alert" data-testid="print-job-error">
          {job.error ?? t('completion.print.failed')}
        </div>
      )}

      {printed && (
        <div data-testid="print-printed" style={{ color: 'var(--ok)' }}>
          {t('completion.print.printed')}
        </div>
      )}

      {/* THE REPRINT — marked, and it needs a REASON. */}
      <div className="actions">
        <input
          data-testid="reprint-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t('completion.reprint.reasonPlaceholder')}
          style={{ minHeight: `${TOUCH_TARGET_PX}px`, fontSize: `${MIN_LABEL_PX}px` }}
        />
        <button
          type="button"
          className="key ghost"
          data-testid="reprint-action"
          disabled={reason.trim().length === 0}
          onClick={() => onReprint(reason)}
          style={keyStyle}
        >
          {t('completion.reprint.caption')}
        </button>
      </div>
    </section>
  );
}

/** "6 min 41 s" — the prototype's elapsed form. */
function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes === 0 ? `${rest} s` : `${minutes} min ${rest} s`;
}
