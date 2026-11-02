/**
 * Unit tests for the value objects bolt 004 introduced — and for the two
 * that bolt 003 left untested.
 *
 * WHY THESE EXIST
 * ---------------
 * `ComponentId`, `ScaleId` and `Instant` are the types that carry identity
 * and time through the tare and the selection. They are boring, which is
 * exactly why they need pins: a boring type is the one that gets widened
 * by accident.
 *
 * `ComponentId` arrived in bolt 004 with NO test at all — it was created,
 * used in the selection rule and never examined. A type that nobody has
 * asserted against is a type whose contract is a guess.
 *
 * THE INVARIANTS
 * --------------
 *   - an id is trimmed, non-empty and bounded in length
 *   - two ids are the same id iff their text matches EXACTLY
 *   - an instant is a WHOLE number of milliseconds — a float would make
 *     the watchdog's boundary decision fuzzy at exactly the point where
 *     the requirement says it must be exact
 */
import { describe, it, expect } from 'vitest';
import { ComponentId } from '../../src/004-scale-integration/domain/value-objects/component-id.js';
import { ScaleId } from '../../src/004-scale-integration/domain/value-objects/scale-id.js';
import { Instant } from '../../src/004-scale-integration/domain/value-objects/instant.js';

describe('ComponentId', () => {
  it('trims surrounding whitespace', () => {
    expect(ComponentId.create('  COMP-1  ').value).toBe('COMP-1');
  });

  it('rejects an EMPTY id', () => {
    expect(() => ComponentId.create('')).toThrow(/must not be empty/);
  });

  it('rejects a WHITESPACE-ONLY id', () => {
    expect(() => ComponentId.create('   ')).toThrow(/must not be empty/);
  });

  it('rejects an id longer than 64 characters', () => {
    // The id arrives from a request body and is carried in a log line, a
    // database key and an event payload — an unbounded string is an
    // unbounded thing to carry in all three.
    expect(() => ComponentId.create('c'.repeat(65))).toThrow(
      /must not exceed 64 characters/,
    );
  });

  it('accepts an id of exactly 64 characters', () => {
    expect(ComponentId.create('c'.repeat(64)).value).toHaveLength(64);
  });

  it('compares EXACTLY — case differences are different components', () => {
    expect(ComponentId.create('COMP-1').equals(ComponentId.create('comp-1'))).toBe(
      false,
    );
  });

  it('is equal to an id with the same text', () => {
    expect(ComponentId.create('COMP-1').equals(ComponentId.create('COMP-1'))).toBe(
      true,
    );
  });

  it('renders as its own text', () => {
    expect(ComponentId.create('COMP-1').toString()).toBe('COMP-1');
  });
});

describe('ScaleId', () => {
  it('trims surrounding whitespace', () => {
    expect(ScaleId.create('  SCALE-A  ').value).toBe('SCALE-A');
  });

  it('rejects an EMPTY id', () => {
    expect(() => ScaleId.create('')).toThrow(/must not be empty/);
  });

  it('rejects a WHITESPACE-ONLY id', () => {
    expect(() => ScaleId.create('   ')).toThrow(/must not be empty/);
  });

  it('rejects an id longer than 64 characters', () => {
    expect(() => ScaleId.create('s'.repeat(65))).toThrow(
      /must not exceed 64 characters/,
    );
  });

  it('accepts an id of exactly 64 characters', () => {
    expect(ScaleId.create('s'.repeat(64)).value).toHaveLength(64);
  });

  it('compares EXACTLY — the id carries no meaning, so case is part of it', () => {
    expect(ScaleId.create('SCALE-A').equals(ScaleId.create('scale-a'))).toBe(
      false,
    );
  });

  it('is equal to an id with the same text', () => {
    expect(ScaleId.create('SCALE-A').equals(ScaleId.create('SCALE-A'))).toBe(
      true,
    );
  });

  it('renders as its own text', () => {
    expect(ScaleId.create('SCALE-A').toString()).toBe('SCALE-A');
  });
});

describe('Instant', () => {
  it('is built from a Date', () => {
    const instant = Instant.of(new Date('2026-10-31T08:00:00.000Z'));
    expect(instant.epochMillis).toBe(Date.parse('2026-10-31T08:00:00.000Z'));
  });

  it('is built from a whole number of milliseconds', () => {
    expect(Instant.fromMillis(1000).epochMillis).toBe(1000);
  });

  it('REJECTS a fractional millisecond', () => {
    // A float timestamp would make the watchdog's boundary decision fuzzy
    // at exactly the point where the requirement says it must be exact.
    expect(() => Instant.fromMillis(1000.5)).toThrow(
      /whole number of milliseconds/,
    );
  });

  it('measures the interval to another instant', () => {
    const from = Instant.fromMillis(1000);
    const to = Instant.fromMillis(3000);

    expect(from.millisecondsUntil(to)).toBe(2000);
  });

  it('measures a NEGATIVE interval when the other instant is earlier', () => {
    expect(Instant.fromMillis(3000).millisecondsUntil(Instant.fromMillis(1000))).toBe(
      -2000,
    );
  });

  it('adds milliseconds', () => {
    expect(Instant.fromMillis(1000).plus(500).epochMillis).toBe(1500);
  });

  it('converts back to a Date', () => {
    const date = new Date('2026-10-31T08:00:00.000Z');
    expect(Instant.of(date).toDate().getTime()).toBe(date.getTime());
  });

  it('renders as an ISO 8601 instant', () => {
    const instant = Instant.of(new Date('2026-10-31T08:00:00.000Z'));
    expect(instant.toString()).toBe('2026-10-31T08:00:00.000Z');
  });
});
