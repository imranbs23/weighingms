/**
 * The locale bundles — the training artefact.
 *
 * ══════════════════════════════════════════════════════════════════════
 * FILES, READ AT RUNTIME. AND THE DEFAULT BUNDLE IS COMPLETE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The bundles are **JSON resources** — *"loaded at runtime and cached, not
 * embedded at build time"* (BRD NFR-11, NFR-14). So they live on disk,
 * and a bundle added or edited later is picked up **without a rebuild**.
 *
 * **AND THE DEFAULT BUNDLE IS COMPLETE** — because it is the fallback for
 * every key the configured bundle lacks. It is what makes *"a defined
 * fallback is used and no request fails"* true (NFR-7).
 *
 * **AND NO PHYSICAL LAYOUT IS ASSERTED HERE.** These are *operator-facing
 * strings*, and the ticket's physical format is configuration's business
 * and is not settled (BRD IR-16, Q-11, Q-12). The strings below are
 * ordinary UI text, and they say nothing about what a label looks like.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The default bundle — **complete**. */
export const DEFAULT_STRINGS: Readonly<Record<string, string>> = {
  'weigh.title': 'Weighing station',
  'weigh.component': 'Component',
  'weigh.target': 'Target',
  'weigh.actual': 'Actual',
  'weigh.unit': 'Unit',
  'weigh.zone.ok': 'Within tolerance',
  'weigh.zone.near': 'Close to tolerance',
  'weigh.zone.over': 'Over tolerance',
  'weigh.zone.under': 'Under tolerance',
  'weigh.confirm': 'Confirm weighing',
  'weigh.cancel': 'Cancel',
  'weigh.next': 'Next component',
  'weigh.escalated': 'Escalated to a supervisor',
  'weigh.override': 'Supervisor override',
  'ticket.title': 'Weighing ticket',
  'ticket.reprint': 'Reprint',
  'ticket.reprintReason': 'Reason for reprinting',
  'ticket.printing': 'Printing…',
  'ticket.printed': 'Printed',
  'ticket.printFailed': 'The print failed',
  'batch.complete': 'Batch complete',
  'batch.withinTolerance': 'All components within tolerance',
  'batch.outOfTolerance': 'Not all components within tolerance',
  'batch.released': 'Container released for transport',
  'audit.title': 'Audit trail',
  'audit.export': 'Export',
  'audit.actor': 'Actor',
  'audit.action': 'Action',
  'audit.reason': 'Reason',
  'audit.when': 'When',
  'config.title': 'Settings',
  'config.language': 'Language',
  'config.template': 'Label template',
  'config.tolerance': 'Tolerance',
  'config.threshold': 'Scale threshold',
  'config.save': 'Save',
  'config.saved': 'Saved',
  'error.generic': 'Something went wrong',
  'error.notFound': 'Not found',
};

/**
 * A second bundle — **deliberately incomplete**, to exercise the fallback.
 *
 * It has `weigh.title` and `weigh.cancel`, and it does **NOT** have
 * `weigh.target` — so the per-key fallback is exercised by a key that is
 * genuinely missing from it, while the rest of the bundle is served
 * normally.
 */
export const SECOND_LOCALE_STRINGS: Readonly<Record<string, string>> = {
  'weigh.title': 'محطة الوزن',
  'weigh.component': 'المكوّن',
  'weigh.confirm': 'تأكيد الوزن',
  'weigh.cancel': 'إلغاء',
};

/**
 * Write the bundles into a directory, and return it.
 *
 * **So the tests exercise the REAL file reading** — the harness's rule is
 * that the real adapters are exercised rather than mocked.
 */
export function writeLocaleBundles(directory: string): string {
  mkdirSync(directory, { recursive: true });

  writeFileSync(
    join(directory, 'en.json'),
    JSON.stringify(DEFAULT_STRINGS, null, 2),
    'utf8',
  );
  writeFileSync(
    join(directory, 'ar.json'),
    JSON.stringify(SECOND_LOCALE_STRINGS, null, 2),
    'utf8',
  );

  return directory;
}
