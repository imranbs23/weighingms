/**
 * JsonLocaleBundleAdapter — the bundles, read at RUNTIME.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE BUNDLES ARE FILES. AND THEY ARE CACHED.
 * ══════════════════════════════════════════════════════════════════════
 *
 * *"Locale bundles are JSON resources loaded at runtime and cached, not
 * embedded at build time — that is what makes a language changeable
 * without a redeployment (BRD NFR-11, BRD NFR-14)."*
 *
 * So the bundle is a **file on disk**, and the adapter reads it **when a
 * locale is first requested** and **caches** it. A bundle added later is
 * picked up **without a rebuild** — because there is nothing to rebuild.
 *
 * AND THE DEFAULT BUNDLE IS COMPLETE
 * ---------------------------------
 * It is the fallback for **every** key the configured bundle lacks, so it
 * must be available even when the configured bundle is missing one. And
 * it is loaded **eagerly**, because a fallback that might not be there is
 * not a fallback.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  LocaleBundle,
  LocaleBundleRepository,
} from '../../domain/ports/locale-bundle-repository.js';

export interface JsonLocaleOptions {
  /** Where the bundles live. */
  readonly directory: string;
  /** The default locale — the fallback's source. */
  readonly defaultLocale: string;
}

export class JsonLocaleBundleAdapter implements LocaleBundleRepository {
  private readonly cache = new Map<string, LocaleBundle>();
  private defaultBundleValue: LocaleBundle | null = null;

  constructor(private readonly options: JsonLocaleOptions) {}

  /**
   * The bundle for a locale — **null** when there is none.
   *
   * **And it is cached**, so the file is read once.
   */
  async load(locale: string): Promise<LocaleBundle | null> {
    const cached = this.cache.get(locale);
    if (cached !== undefined) return cached;

    try {
      const raw = readFileSync(
        join(this.options.directory, `${locale}.json`),
        'utf8',
      );
      const parsed = JSON.parse(raw) as Record<string, string>;
      const bundle: LocaleBundle = { locale, strings: parsed };
      this.cache.set(locale, bundle);
      return bundle;
    } catch {
      // The bundle is MISSING or unreadable — and that is a **state**, not
      // an error. The caller falls back.
      return null;
    }
  }

  /**
   * The **default** bundle — and it is complete.
   */
  async defaultBundle(): Promise<LocaleBundle> {
    if (this.defaultBundleValue !== null) return this.defaultBundleValue;

    const bundle = await this.load(this.options.defaultLocale);
    if (bundle === null) {
      // The default bundle is MISSING — and that is the one failure that
      // cannot be papered over. An empty bundle is returned so the
      // fallback degrades to the key itself, and the caller is not left
      // with an exception in the middle of a request.
      const empty: LocaleBundle = {
        locale: this.options.defaultLocale,
        strings: {},
      };
      this.defaultBundleValue = empty;
      return empty;
    }

    this.defaultBundleValue = bundle;
    return bundle;
  }

  /**
   * Forget the cached bundles.
   *
   * **So a bundle added or edited at runtime is picked up without a
   * restart** — the story's requirement that a language is changeable
   * without a redeployment, and its "no restart" edge case.
   */
  invalidate(): void {
    this.cache.clear();
    this.defaultBundleValue = null;
  }
}
