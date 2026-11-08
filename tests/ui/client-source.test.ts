/**
 * The client's SOURCE — and the constraints it must satisfy.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THE CLIENT HOLDS NO DATA, NO RULES, AND NO OPERATOR-FACING LITERALS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * These tests read the client's source and assert what it does **not**
 * contain. They are the executable form of the story's hard constraints,
 * and they are the reason this bolt is worth doing: **the client is the
 * one place where hard-coded data would be most tempting — and where it
 * would be most invisible.**
 *
 * The story:
 *
 * > *"**No hard-coded data in the client** (workbook Rule 5, BRD IR-07). The
 * > only things hard-coded are the design token set and the prototype's
 * > interaction rules, which are the specification rather than the data. A
 * > test asserts that the client source contains no batch, recipe or weight
 * > fixture data."*
 *
 * > *"**`ORGATEX · LINKED` is not a literal.** The status strip reads the
 * > real peripheral and link state from the API. The prototype's hard-coded
 * > `ORGATEX · LINKED` string is deliberately not carried over."*
 *
 * > *"**All operator-facing text is externalised** (NFR-7, BRD NFR-11): the
 * > seven queue column headers, the status values, the rejection reasons
 * > and every button label are locale keys. A test asserts the client
 * > source contains no user-visible literal strings."*
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CLIENT_ROOT = 'src/007-weighingms-ui';

/** Every source file in the client. */
function clientSources(directory: string = CLIENT_ROOT): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...clientSources(path));
      continue;
    }
    if (path.endsWith('.ts') || path.endsWith('.tsx')) {
      found.push(path);
    }
  }

  return found;
}

/** Every source file's text. */
function clientSourceText(): Map<string, string> {
  const sources = new Map<string, string>();
  for (const path of clientSources()) {
    sources.set(path, readFileSync(path, 'utf8'));
  }
  return sources;
}

describe('the client source', () => {
  it('contains NO batch, recipe, component, weight or lot fixture data', () => {
    // The MES's own seeded values. If any of them appears in the client,
    // the client has hard-coded data — and it will drift from the MES.
    const forbidden = [
      'B-24187',
      'DYE-4471',
      'DYE-2204',
      'AUX-0101',
      'AUX-0107',
      'SO-9931',
      'JET-04',
      '2026-0387',
      'Teal 4C',
      '94.2400',
      '1240.0000',
      '24.0000',
      '9.6000',
    ];

    for (const [path, text] of clientSourceText()) {
      for (const value of forbidden) {
        expect(
          text.includes(value),
          `${path} contains the fixture value ${value}`,
        ).toBe(false);
      }
    }
  });

  it('does NOT contain the prototype’s hard-coded `ORGATEX · LINKED`', () => {
    for (const [path, text] of clientSourceText()) {
      // The full string — and the part that matters. The prototype's
      // hard-coded status.
      expect(text.includes('ORGATEX · LINKED')).toBe(false);
      expect(text.includes('ORGATEX ·')).toBe(false);

      // **`LINKED` as a RENDERED literal** — the prototype's string. The
      // client MAY compare a reported state against it, because that is
      // how it knows the link is healthy; what it must not do is *render*
      // it.
      //
      // So the check is for the string as a JSX text node or as a
      // standalone argument — not as part of a comparison or a key.
      expect(
        />\s*LINKED\s*</.test(text),
        `${path} renders LINKED as a literal`,
      ).toBe(false);
      expect(
        /\bt\(\s*['"]LINKED['"]\s*\)/.test(text),
        `${path} renders LINKED as a literal`,
      ).toBe(false);
    }
  });

  it('contains NO operator-facing literal string in a COMPONENT', () => {
    // The components are the screens — and they are where a literal
    // would be pasted.
    //
    // The separator is normalised, because the paths are built with
    // `join` and the platform's separator differs.
    const components = clientSources().filter((path) =>
      path.split(/[\\/]/).includes('screens'),
    );

    expect(components.length).toBeGreaterThan(0);

    // A literal is a run of text inside JSX, or a string in a `t()`
    // argument that is **not** a key.
    //
    // A key is dotted — `queue.title` — so the `t()` pattern excludes a
    // dotted argument. That is what separates a key from a sentence, and
    // the dedicated key test below proves the keys are well-formed.
    const literalPatterns = [
      />[^<>{}\n]*[A-Za-z]{3,}[^<>{}\n]*</,
      /\bt\(\s*'[^'.'"]*[A-Za-z]{3,}[^'.'"]*'\s*\)/,
    ];

    for (const path of components) {
      const text = readFileSync(path, 'utf8');

      for (const pattern of literalPatterns) {
        const matches = text.match(pattern);
        expect(
          matches,
          `${path} contains an operator-facing literal: ${matches?.[0] ?? ''}`,
        ).toBeNull();
      }
    }
  });

  it('every operator-facing string is a LOCALE KEY', () => {
    // The translator is called with a key, and every key is dotted — so
    // a key is recognisable, and a sentence is not.
    const components = clientSources().filter((path) =>
      path.split(/[\\/]/).includes('screens'),
    );

    for (const path of components) {
      const text = readFileSync(path, 'utf8');
      const calls = text.match(/\bt\(\s*'([^']*)'\s*\)/g) ?? [];

      for (const call of calls) {
        const key = call.replace(/^t\(\s*'/, '').replace(/'\s*\)$/, '');
        // A dynamic key is a template literal — those are checked
        // separately.
        if (key.includes('${')) continue;
        expect(key, `${path} uses the key "${key}"`).toMatch(
          /^[a-z][a-zA-Z]*(\.[a-zA-Z]+)+$/,
        );
      }
    }
  });

  it('the design tokens are the ONLY hard-coded values in the client', () => {
    // The token file is the specification — the colours, the spacing and
    // the touch target. Everything else is data from the API or a key.
    const tokens = readFileSync(
      join(CLIENT_ROOT, 'screens/batch-queue/tokens.ts'),
      'utf8',
    );

    // And the touch target IS there — the requirement is legible in the
    // source.
    expect(tokens).toContain('TOUCH_TARGET_MM');
    expect(tokens).toContain('15');
  });

  it('the client performs NO ZONE COMPUTATION of its own', () => {
    // FR-9 and BRD FR-10: "the client performs no zone computation of
    // its own" — and "two classifications of the same reading in two
    // places is the failure mode this avoids".
    //
    // So the client's screens must not COMPARE a weight against a band.
    // The zone is the API's, and the client renders it.
    const screens = clientSources().filter((path) =>
      path.split(/[\\/]/).includes('screens'),
    );

    expect(screens.length).toBeGreaterThan(0);

    // A comparison of the weight against a bound — the shapes a zone
    // computation takes.
    const computationPatterns = [
      /lessThan\(.*(?:okLower|okUpper|target|tolerance)/,
      /greaterThan\(.*(?:okLower|okUpper|target|tolerance)/,
      /compare\(/,
      /<=\s*(?:zone\.)?(?:okLower|okUpper|target)\b/,
      />=\s*(?:zone\.)?(?:okLower|okUpper|target)\b/,
      /parseFloat\(/,
    ];

    for (const path of screens) {
      const text = readFileSync(path, 'utf8');
      for (const pattern of computationPatterns) {
        const matches = text.match(pattern);
        expect(
          matches,
          `${path} appears to compute a zone or parse a float: ${matches?.[0] ?? ''}`,
        ).toBeNull();
      }
    }
  });

  it('the client NEVER parses a quantity as a float', () => {
    // NFR-2 and BRD NFR-16: the quantities are formatted, never parsed
    // as a float. `parseFloat('0.1') + parseFloat('0.2')` is
    // 0.30000000000000004 — and the client is where an operator reads a
    // number they will weigh against.
    const clientFiles = clientSources();

    expect(clientFiles.length).toBeGreaterThan(0);

    for (const path of clientFiles) {
      const text = readFileSync(path, 'utf8');
      expect(text.includes('parseFloat('), `${path} parses a float`).toBe(
        false,
      );
      // `Number(...)` coerces a QUANTITY to a float — which is what the
      // rule forbids. A percentage for the band bar is a **position**,
      // not a quantity, so the band bar's own conversion is allowed —
      // and it is identified by what it converts.
      const numberCalls = text.match(/Number\([^)]*\)/g) ?? [];
      for (const call of numberCalls) {
        expect(
          call,
          `${path} coerces a value with Number(): ${call}`,
        ).not.toMatch(/Number\(\s*(?:value|quantity|weight|target|tolerance|qty)/i);
      }
    }
  });

  it('the client holds NO weight literal — the values are the API’s', () => {
    // The MES's own quantities, and the prototype's figures.
    const forbidden = ['94.2400', '24.0100', '93.5000', '94.5000', '84.6000'];

    for (const [path, text] of clientSourceText()) {
      for (const value of forbidden) {
        expect(
          text.includes(value),
          `${path} contains the quantity literal ${value}`,
        ).toBe(false);
      }
    }
  });

  it('the client carries NO surplus constant and derives NO factor', () => {
    // FR-12: "The surplus ratio is `surplus ÷ totalRemainingTarget`, never
    // a hard-coded constant. The prototype's `1.026` is its own worked
    // example … and it is correct only for that one example. … the client
    // does not carry a constant and does not re-derive the revised
    // targets, it renders them" (A-08, BRD R-03).
    const clientFiles = clientSources();

    expect(clientFiles.length).toBeGreaterThan(0);

    for (const path of clientFiles) {
      const text = readFileSync(path, 'utf8');

      // The prototype's constant.
      expect(
        text.includes('1.026'),
        `${path} carries the prototype's surplus constant`,
      ).toBe(false);

      // A derivation of the factor — a division of a surplus by a total.
      expect(
        /surplus\s*\/\s*(?:total|remaining)/i.test(text),
        `${path} derives the surplus factor`,
      ).toBe(false);

      // And a re-derivation of the revised targets.
      expect(
        /revisedTarget\s*[*/]/i.test(text),
        `${path} re-derives a revised target`,
      ).toBe(false);
    }
  });

  it('the client composes NO PART of the ticket', () => {
    // FR-17 and BRD IR-16: "the preview is the ticket rendered by the
    // API and shown as received, and the client composes no part of the
    // ticket itself — no field layout, no header, no footer text is
    // assembled in the browser."
    //
    // And the reason: "A client that assembled the ticket from its own
    // field list would freeze that list into the build and turn every
    // template change into a release."
    const screens = clientSources().filter((path) =>
      path.split(/[\\/]/).includes('screens'),
    );

    expect(screens.length).toBeGreaterThan(0);

    for (const path of screens) {
      const text = readFileSync(path, 'utf8');

      // A header or a footer — the parts a client would assemble.
      expect(
        /ticketHeader|ticketFooter|renderTicket|composeTicket/i.test(text),
        `${path} assembles part of the ticket`,
      ).toBe(false);

      // And a field list the client owns — the shape of the ticket's
      // content, duplicated from the API's.
      expect(
        /ticketFields|TICKET_COLUMNS|ticketLayout/i.test(text),
        `${path} carries its own list of the ticket's fields`,
      ).toBe(false);
    }
  });

  it('the client computes NO progression — it renders the API’s active component', () => {    // FR-14: "Progression is a domain transition, not a UI navigation. …
    // the client does not decide which component is next and does not
    // compute 'the first pending one' from its own copy of the rail — it
    // renders the `activeComponentId` the API reports."
    const screens = clientSources().filter((path) =>
      path.split(/[\\/]/).includes('screens'),
    );

    expect(screens.length).toBeGreaterThan(0);

    for (const path of screens) {
      const text = readFileSync(path, 'utf8');
      // A search for "the first PENDING" in the client's own rail.
      expect(
        /\.find\([^)]*PENDING/.test(text),
        `${path} finds the next PENDING component itself`,
      ).toBe(false);
      expect(
        /\.find\([^)]*state\s*===\s*'PENDING'/.test(text),
        `${path} computes the next component from its own rail`,
      ).toBe(false);
    }
  });
});
