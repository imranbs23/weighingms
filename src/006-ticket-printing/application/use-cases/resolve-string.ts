/**
 * ResolveString — one operator-facing string, in the configured language.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE FALLBACK IS PER KEY. AND NO REQUEST FAILS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The story's edge case: *"A locale bundle is missing a key present in
 * another bundle → the defined fallback is used **for that key**; the rest
 * of the bundle is served normally."*
 *
 * **So the fallback is PER KEY, not per bundle** — a bundle missing one
 * string does not fall back wholesale, and the rest of the configured
 * bundle is served normally.
 *
 * **And the fallback chain is DEFINED:**
 *
 * 1. the configured bundle's string;
 * 2. the **default** bundle's string for that key — the default bundle is
 *    complete, because it is the fallback for everything;
 * 3. **the key itself** — a defined, diagnosable answer, and **not** an
 *    error.
 *
 * The story: *"a defined fallback is used and **no request fails**"* (NFR-7).
 */
import type { LocaleBundleRepository } from '../../domain/ports/locale-bundle-repository.js';

export interface ResolveStringOptions {
  /** The bundles. */
  readonly bundles: LocaleBundleRepository;
}

export class ResolveString {
  constructor(private readonly options: ResolveStringOptions) {}

  /**
   * The string for a key — in the given language, or the fallback.
   *
   * @param locale The language to serve it in.
   * @param key The string's key.
   *
   * **And it NEVER throws.** A missing bundle, a missing key, a malformed
   * bundle — all of them resolve to *something*, because a missing
   * translation must not take down a screen.
   */
  async execute(locale: string, key: string): Promise<string> {
    const configured = await this.options.bundles.load(locale);

    // THE CONFIGURED BUNDLE'S STRING.
    if (configured !== null) {
      const value = configured.strings[key];
      if (value !== undefined) return value;
    }

    // THE DEFAULT BUNDLE'S STRING FOR THAT KEY — and the rest of the
    // configured bundle is served normally.
    const fallback = await this.options.bundles.defaultBundle();
    const value = fallback.strings[key];
    if (value !== undefined) return value;

    // THE KEY ITSELF. A defined, diagnosable answer — and no request
    // fails.
    return key;
  }
}
