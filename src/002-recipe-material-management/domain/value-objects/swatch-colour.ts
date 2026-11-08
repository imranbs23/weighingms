/**
 * SwatchColour — the colour chip beside a component's name.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THIS IS A COLOUR TOKEN, NOT A STRING. THE DIFFERENCE IS THE POINT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The prototype builds the swatch by string concatenation:
 *
 * > '<span class="swatch" style="background:' + c.color + '"></span>'
 *
 * (docs/customize-weighing-station.html, `renderComps()`)
 *
 * So the colour the MES supplies ends up **inside a CSS declaration**. A
 * free-form string from an external system is therefore a style-injection
 * vector — `red; background-image: url(...)` is a value this prototype would
 * happily concatenate into a `style` attribute.
 *
 * So the only thing that can become a `SwatchColour` is a token matching
 * `#rgb` or `#rrggbb`, and **nothing else can**. The type is the
 * enforcement, in the same way `WeightValue`'s constructor is the
 * enforcement of BRD NFR-16 (ADR-008, ADR-032).
 *
 * THE COLOUR IS DATA, NEVER INVENTED
 * ----------------------------------
 * The story is explicit: *"no component, target quantity or swatch colour is
 * hard-coded in the UI. The swatch colour is data supplied with the
 * component."* So there is **no default colour** here — a component with no
 * colour has `null`, and the UI renders its own placeholder.
 *
 * And the value is **not interpreted**: this type does not know whether
 * `#1f4fa8` is a sensible dye colour. It only knows that it is a colour
 * token and cannot be anything else.
 */

/** The two shapes a colour token may take. */
const HEX_SHORT = /^#[0-9a-fA-F]{3}$/;
const HEX_LONG = /^#[0-9a-fA-F]{6}$/;

export class SwatchColour {
  private constructor(readonly value: string) {}

  /**
   * Build a colour from a token.
   *
   * @param raw A `#rgb` or `#rrggbb` token. Anything else is refused.
   * @throws When the token is not a colour token.
   */
  static of(raw: string): SwatchColour {
    const trimmed = raw.trim();
    if (!isColourToken(trimmed)) {
      throw new Error(
        `A swatch colour must be a #rgb or #rrggbb token, got "${raw}"`,
      );
    }
    // The token is normalised to lower case so that two spellings of the
    // same colour are the same colour — a value that is compared or
    // de-duplicated must not differ by case alone.
    return new SwatchColour(trimmed.toLowerCase());
  }

  equals(other: SwatchColour): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

/**
 * Is this a colour token?
 *
 * Exactly `#rgb` or `#rrggbb`. No named colours, no `rgb()`, no `hsl()`,
 * no `var()`, and **no trailing characters** — so a token cannot smuggle a
 * second declaration past the shape check.
 */
export function isColourToken(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return HEX_SHORT.test(value) || HEX_LONG.test(value);
}
