/**
 * The ticket unit's configuration.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE LOCALE DIRECTORY AND THE DEFAULT LOCALE ARE CONFIGURATION VALUES.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The bundles are **FILES**, read at runtime — so a language is changeable
 * without a redeployment (BRD FR-22, NFR-11, NFR-14). **And the directory
 * they live in is therefore a setting**, not a constant baked into the
 * code: a second site would put them somewhere else.
 *
 * **And the default locale is the fallback's source** — the bundle that
 * supplies every string the configured bundle lacks — so it is named
 * explicitly and it must be complete.
 *
 * WHERE THE BUNDLES LIVE
 * ----------------------
 * The bundles are **committed to the repository**, under
 * `src/006-ticket-printing/locales/` — and **not** under `data/`.
 *
 * **And the reason is the gitignore.** `data/` is ignored, so a bundle
 * written there would exist on a developer's machine and be **absent from
 * the repository** — and the running product would then show the operator
 * **the locale keys themselves** instead of the text they are supposed to
 * see. That is not a cosmetic defect: the fallback chain ends at the key,
 * so a missing bundle is a screen of `weigh.title` and `queue.title`.
 *
 * So the bundles live where the **repository** keeps them, and the
 * directory is still a setting — `WEIGHINGMS_LOCALE_DIR` moves it for a
 * deployment that keeps its translations elsewhere.
 */
export interface TicketConfig {
  /** Where the locale bundles live — they are **files**. */
  readonly localeDirectory: string;

  /**
   * The default locale — the **fallback's** source.
   *
   * Its bundle must be **complete**, because it is the fallback for every
   * key the configured bundle lacks. A key missing from both returns the
   * key itself — a defined, diagnosable answer, and **no request fails**
   * (NFR-7).
   */
  readonly defaultLocale: string;
}

export const DEFAULT_LOCALE_DIRECTORY = './src/006-ticket-printing/locales';
export const DEFAULT_LOCALE = 'en';

export function loadTicketConfig(
  env: NodeJS.ProcessEnv = process.env,
): TicketConfig {
  return {
    localeDirectory:
      env['WEIGHINGMS_LOCALE_DIR'] ?? DEFAULT_LOCALE_DIRECTORY,
    defaultLocale: env['WEIGHINGMS_DEFAULT_LOCALE'] ?? DEFAULT_LOCALE,
  };
}
