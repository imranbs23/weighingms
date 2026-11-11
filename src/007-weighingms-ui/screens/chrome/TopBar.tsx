/**
 * The top bar — the prototype's: the brand, the batch crumb, the operator.
 *
 * The crumb (batch · order · machine) is shown while a batch is open, and
 * every value is the API's — the queue's row for that batch.
 */
import type React from 'react';
import type { Translate } from '../../i18n/useStrings.js';

export const TOP_BAR_KEYS = [
  'chrome.brand',
  'chrome.station',
  'chrome.batch',
  'chrome.order',
  'chrome.machine',
] as const;

export function TopBar({
  crumb,
  t,
  children,
}: {
  readonly crumb: {
    readonly batchId: string;
    readonly orderRef: string | null;
    readonly machineRef: string | null;
  } | null;
  readonly t: Translate;
  /** The operator's chip — rendered at the bar's right. */
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <header className="topbar" data-testid="top-bar">
      <div className="brandmark">
        <span className="n">{t('chrome.brand')}</span>
        <span className="s">{t('chrome.station')}</span>
      </div>

      {crumb !== null && (
        <div className="crumb" data-testid="top-bar-crumb">
          {t('chrome.batch')} <b>{crumb.batchId}</b>
          {crumb.orderRef !== null && (
            <>
              {' · '}
              {t('chrome.order')} <b>{crumb.orderRef}</b>
            </>
          )}
          {crumb.machineRef !== null && (
            <>
              {' · '}
              {t('chrome.machine')} <b>{crumb.machineRef}</b>
            </>
          )}
        </div>
      )}

      <span className="spacer" />
      {children}
    </header>
  );
}
