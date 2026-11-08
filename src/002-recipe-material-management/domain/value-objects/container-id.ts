/**
 * ContainerId — the vessel's identifier.
 *
 * ══════════════════════════════════════════════════════════════════════
 * OPAQUE. THE CONVENTION IS FCI'S, NOT OURS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `C-12`, `D-03`, and whatever FCI's convention turns out to be. The
 * identifier is **bounded and trimmed**, and that is the whole of what this
 * unit knows about it.
 *
 * **Q-10 and CQ-08 are both unanswered** — whether one container holds one
 * component or a whole recipe, and whether containers carry a barcode. So
 * the identifier arrives by **scan** or by **keyed entry**, and the
 * assignment records **which** (ADR-035). Either way it is the same
 * identifier.
 *
 * The bound is 64 characters — the same bound every identifier in this
 * product uses, and the same bound unit `005`'s identifiers use, so an
 * over-long container id is refused rather than truncated.
 */

/** The longest container identifier that may cross the boundary. */
export const MAX_CONTAINER_ID_LENGTH = 64;

export class ContainerId {
  private constructor(readonly value: string) {}

  static create(raw: string): ContainerId {
    const value = raw.trim();
    if (value.length === 0) {
      throw new Error('ContainerId must not be empty');
    }
    if (value.length > MAX_CONTAINER_ID_LENGTH) {
      throw new Error(
        `ContainerId must not exceed ${MAX_CONTAINER_ID_LENGTH} characters`,
      );
    }
    return new ContainerId(value);
  }

  equals(other: ContainerId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
