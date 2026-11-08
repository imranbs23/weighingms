/**
 * The locale bundle's port.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE BUNDLES ARE FILES, READ AT RUNTIME — AND THE FALLBACK IS PER KEY.
 * ══════════════════════════════════════════════════════════════════════
 *
 * *"Locale bundles are JSON resources loaded at runtime and cached, not
 * embedded at build time — that is what makes a language changeable
 * without a redeployment (BRD NFR-11, BRD NFR-14)."*
 *
 * **And the fallback is per key** — the story's edge case: *"A locale
 * bundle is missing a key present in another bundle → the defined fallback
 * is used for that key; **the rest of the bundle is served normally**."*
 */
export interface LocaleBundle {
  /** Which language. */
  readonly locale: string;
  /** The strings. */
  readonly strings: Readonly<Record<string, string>>;
}

export interface LocaleBundleRepository {
  /**
   * The bundle for a locale — **null** when there is none.
   *
   * The adapter **caches** it, so the file is read once.
   */
  load(locale: string): Promise<LocaleBundle | null>;

  /**
   * The **default** bundle — and it is **complete**.
   *
   * It is the fallback for every key the configured bundle lacks, so it
   * must be available even when the configured bundle is missing one.
   */
  defaultBundle(): Promise<LocaleBundle>;
}
