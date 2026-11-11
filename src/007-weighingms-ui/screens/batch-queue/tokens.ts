/**
 * The design tokens — the ONLY hard-coded values in the client.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE TOKENS ARE THE SPECIFICATION, NOT THE DATA.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The story: *"No hard-coded data in the client (workbook Rule 5, BRD
 * IR-07). **The only things hard-coded are the design token set and the
 * prototype's interaction rules, which are the specification rather than
 * the data.**"*
 *
 * **And the touch target is one of them** — NFR-4 and BRD NFR-07/08
 * require **at least 15 mm**, and a component test measures the **rendered**
 * target.
 *
 * **15 mm in CSS pixels.** The operator terminal is a 15" panel at a
 * known density, and the design token set is expressed in millimetres so
 * the requirement is legible in the source rather than implied by a
 * number.
 */

/**
 * The minimum touch target — **15 mm** (NFR-4, BRD NFR-07).
 *
 * **And it is in millimetres**, so the requirement is legible in the
 * source — and the CSS turns it into pixels.
 */
export const TOUCH_TARGET_MM = 15;

/** The millimetres-to-pixels factor the design uses — 96 dpi. */
export const MM_TO_PX = 96 / 25.4;

/** The minimum touch target, in pixels. */
export const TOUCH_TARGET_PX = Math.round(TOUCH_TARGET_MM * MM_TO_PX);

/**
 * The minimum label size for legibility at 1.5 m (BRD NFR-08).
 *
 * A 15" panel at 1.5 m needs a large label — and the requirement is a
 * **minimum**, so the token is the floor.
 */
export const MIN_LABEL_PX = 24;

/** The spacing scale — the design's rhythm, in pixels. */
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 40,
} as const;

/** The colour tokens — the design's palette. */
export const COLOURS = {
  surface: '#12161c',
  surfaceRaised: '#1b212a',
  border: '#2c3543',
  text: '#eef2f7',
  textMuted: '#9fb0c4',
  accent: '#4ea3ff',
  danger: '#ff6b6b',
  warning: '#ffc857',
  success: '#5fd08a',
} as const;

/**
 * The seven queue columns — **the specification**, not the data.
 *
 * The story: *"the seven queue column headers ... are locale keys"*. So
 * this list holds the **keys**, and the labels come from the bundle.
 */
export const QUEUE_COLUMNS = [
  { key: 'queue.column.batchId', labelKey: 'queue.column.batchId' },
  { key: 'queue.column.orderRef', labelKey: 'queue.column.orderRef' },
  { key: 'queue.column.machineRef', labelKey: 'queue.column.machineRef' },
  {
    key: 'queue.column.fabricDescription',
    labelKey: 'queue.column.fabricDescription',
  },
  { key: 'queue.column.shadeCode', labelKey: 'queue.column.shadeCode' },
  { key: 'queue.column.componentCount', labelKey: 'queue.column.componentCount' },
  { key: 'queue.column.weighingStatus', labelKey: 'queue.column.weighingStatus' },
] as const;

/**
 * Every locale key the queue screen uses.
 *
 * **And they are all KEYS** — the bundle supplies the text, and a source
 * test proves that no component carries a literal.
 */
export const QUEUE_KEYS = [
  'queue.title',
  'queue.lastReceived',
  'queue.filter.all',
  'queue.empty.title',
  'queue.empty.body',
  'queue.degraded.title',
  'queue.degraded.body',
  'queue.row.select',
  'queue.row.notReleased',
  'queue.refusal.unknownBatch',
  'queue.refusal.notReleased',
  'queue.refusal.ambiguousPrefix',
  'queue.refusal.generic',
  'queue.refusal.dismiss',
  'queue.scan.prompt',
  'queue.scan.orTouch',
  'workflow.refusal.otherBatch',
  'workflow.refusal.noScale',
  'workflow.refusal.unreachable',
  'workflow.refusal.notComplete',
  ...QUEUE_COLUMNS.map((column) => column.labelKey),
] as const;
