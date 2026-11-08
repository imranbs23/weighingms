/**
 * The locale loader — the client's ONLY source of operator-facing text.
 *
 * ══════════════════════════════════════════════════════════════════════
 * NO OPERATOR-FACING LITERAL IS WRITTEN IN A COMPONENT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Every string a component renders is a **key**, resolved here. And the
 * bundle is **fetched at runtime** — so a language is changeable without a
 * redeployment (BRD FR-22, BRD NFR-11).
 *
 * **And the fallback is the KEY itself.** The story: *"a defined fallback
 * is used and no request fails"* (NFR-7) — and the key is a defined,
 * diagnosable answer.
 */
import { useEffect, useState } from 'react';
import { fetchString } from '../api/endpoints.js';

/** The locale the client asks for — **a configuration value**, not a literal in a component. */
export const DEFAULT_LOCALE = 'en';

/** The strings a screen resolves. A key resolves to a key until it arrives. */
export type Strings = Readonly<Record<string, string>>;

/** The resolver a component uses. */
export type Translate = (key: string) => string;

/**
 * Resolve a set of keys, and return a translator.
 *
 * **The translator NEVER returns undefined.** A component that rendered
 * `undefined` would show the word "undefined" to an operator, so the
 * fallback is the **key** — visible and diagnosable, and never a blank.
 *
 * The keys are joined for the effect's dependency, because a new array
 * identity on every render would refetch forever.
 */
export function useStrings(keys: readonly string[]): Translate {
  const [strings, setStrings] = useState<Strings>({});

  const joined = keys.join('|');

  useEffect(() => {
    let cancelled = false;

    const resolve = async (): Promise<void> => {
      const entries = await Promise.all(
        joined
          .split('|')
          .filter((key) => key.length > 0)
          .map(async (key) => {
            const value = await fetchString(DEFAULT_LOCALE, key);
            return [key, value] as const;
          }),
      );

      if (!cancelled) {
        setStrings(Object.fromEntries(entries));
      }
    };

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [joined]);

  // The translator reads the latest strings, and never returns undefined.
  return (key: string) => strings[key] ?? key;
}
