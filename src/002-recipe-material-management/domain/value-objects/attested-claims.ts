/**
 * AttestedClaims — the set of facts an operator attested to.
 *
 * ══════════════════════════════════════════════════════════════════════
 * A SET, BECAUSE AN ATTESTATION ASSERTS A SET OF FACTS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The story is explicit about why this is not a single string:
 *
 * > *"Whether an attestation covers only the dyestuff code or also the lot
 * > is tied to CQ-08; the attestation record is therefore structured to carry
 * > an attested-claims set, so that adding a lot claim later does not
 * > require a schema change."*
 *
 * So the claim is a **set of names**, not a value. Today the only claim is
 * `dyestuffCode`; tomorrow it may be `lotNumber` too — and **the schema
 * does not change**, because a set already holds any number of claims.
 *
 * **A SET, NOT A LIST.** A set has no order and no duplicates: an
 * attestation asserts *"these facts are true"*, and asserting the same fact
 * twice is not a second claim — it is the same claim written twice. A list
 * would make two spellings of the same attestation look different, and the
 * record is read back to answer *"what did the operator say?"*.
 *
 * **THE CLAIM'S VALUE IS NOT THE RECORD.** The record carries the material
 * code the component *requires* — that is the MES's fact. The claim set
 * carries *which* facts the operator attested to. The operator's own words
 * are the UI's business (BRD NFR-11).
 */

/** The claims this product knows about today. */
export const ATTESTABLE_CLAIMS = ['dyestuffCode'] as const;

export type AttestableClaim = (typeof ATTESTABLE_CLAIMS)[number];

export class AttestedClaims {
  private constructor(readonly values: readonly AttestableClaim[]) {}

  /**
   * Build a claim set from names.
   *
   * @throws When a name is not a claim this product knows about. A claim
   *   nobody defined would be a claim nobody could check.
   */
  static of(names: readonly string[]): AttestedClaims {
    const known = new Set<string>(ATTESTABLE_CLAIMS);
    const unique = new Set<AttestableClaim>();

    for (const name of names) {
      if (!known.has(name)) {
        throw new Error(`"${name}" is not a claim this product knows about`);
      }
      unique.add(name as AttestableClaim);
    }

    // Sorted, so the stored form is canonical: two attestations of the same
    // set are the same string.
    return new AttestedClaims([...unique].sort());
  }

  /** The set of claims for the standard case: the dyestuff code. */
  static dyestuffCode(): AttestedClaims {
    return AttestedClaims.of(['dyestuffCode']);
  }

  /** The empty set. */
  static none(): AttestedClaims {
    return new AttestedClaims([]);
  }

  /**
   * The claims as a **canonical string**, for storage.
   *
   * Comma-separated and sorted, so the stored form is a function of the
   * set and not of the order it was written in.
   */
  toStorage(): string {
    return this.values.join(',');
  }

  /**
   * Read a claim set back from its stored form.
   *
   * An empty string is the **empty set** — never `null`, and never a set
   * containing an empty claim.
   */
  static fromStorage(stored: string): AttestedClaims {
    if (stored.trim().length === 0) return AttestedClaims.none();
    return AttestedClaims.of(stored.split(','));
  }

  /** Does the set carry this claim? */
  includes(claim: AttestableClaim): boolean {
    return this.values.includes(claim);
  }

  /** How many claims are in the set? */
  get size(): number {
    return this.values.length;
  }
}
