import type React from 'react';
/**
 * QueueRow — one released batch.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE ROW IS A RENDERER. IT HOLDS NO DATA AND NO RULES.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Every value comes from the **server's** row, and every label comes from
 * the **locale bundle**. The only thing this component decides is whether
 * the row is selectable — and that is the server's answer too: a batch
 * that is no longer released is not selectable (BRD BR-03).
 *
 * **And the touch target is ≥ 15 mm** (NFR-4, BRD NFR-07) — the row's
 * height is the token, and the test measures the **rendered** target.
 */
import type { QueueBatch } from '../../api/endpoints.js';
import type { Translate } from '../../i18n/useStrings.js';
import {
  COLOURS,
  MIN_LABEL_PX,
  QUEUE_COLUMNS,
  SPACING,
  TOUCH_TARGET_PX,
} from './tokens.js';

export interface QueueRowProps {
  readonly batch: QueueBatch;
  /** The translator — the locale bundle's resolved strings. */
  readonly t: Translate;
  /** Whether the row can be selected. */
  readonly selectable: boolean;
  /** Select the row. */
  readonly onSelect: (batchId: string) => void;
}

export function QueueRow({
  batch,
  t,
  selectable,
  onSelect,
}: QueueRowProps): React.JSX.Element {
  const handle = (): void => {
    if (!selectable) return;
    onSelect(batch.batchId);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={!selectable}
      data-testid={`queue-row-${batch.batchId}`}
      data-selectable={selectable ? 'true' : 'false'}
      onClick={handle}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') handle();
      }}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: SPACING.md,
        alignItems: 'center',
        minHeight: `${TOUCH_TARGET_PX}px`,
        padding: `${SPACING.sm}px ${SPACING.md}px`,
        borderBottom: `1px solid ${COLOURS.border}`,
        color: selectable ? COLOURS.text : COLOURS.textMuted,
        fontSize: `${MIN_LABEL_PX}px`,
        cursor: selectable ? 'pointer' : 'not-allowed',
      }}
    >
      <span>{batch.batchId}</span>
      <span>{batch.orderRef}</span>
      <span>{batch.machineRef}</span>
      {/* The MES gave none — and the client renders its OWN placeholder,
          which is a locale key and not a literal. */}
      <span>
        {batch.fabricDescription ?? t('queue.empty.body')}
      </span>
      <span>{batch.shadeCode}</span>
      <span>{batch.componentCount}</span>
      <span>{batch.weighingStatus}</span>
    </div>
  );
}

/** The column headers — and they are the DESIGN's specification. */
export function QueueHeader({
  t,
}: {
  readonly t: Translate;
}): React.JSX.Element {
  return (
    <div
      role="row"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: SPACING.md,
        padding: `${SPACING.sm}px ${SPACING.md}px`,
        color: COLOURS.textMuted,
        fontSize: `${MIN_LABEL_PX}px`,
      }}
    >
      {QUEUE_COLUMNS.map((column) => (
        <span key={column.key}>{t(column.labelKey)}</span>
      ))}
    </div>
  );
}
