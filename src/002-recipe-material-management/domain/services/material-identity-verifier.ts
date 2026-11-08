/**
 * MaterialIdentityVerifier — the comparison rule.
 *
 * ══════════════════════════════════════════════════════════════════════
 * THREE OUTCOMES, AND ONE OF THEM IS A HARD STOP.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The rule is small; the consequences are not.
 *
 * | The operator did | The outcome |
 * |---|---|
 * | scanned the **matching** code | **VERIFIED** — by scan |
 * | scanned a **different** code | **MISMATCHED** — a hard stop, naming both codes |
 * | confirmed the identity on screen | **VERIFIED** — by attestation |
 *
 * AND A MISMATCH IS NEVER DOWNGRADABLE
 * -----------------------------------
 * The story is explicit: *"the verification is rejected as a hard stop, the
 * reason names the scanned code and the expected code, the component cannot
 * proceed to dispensing, and **no attestation may be used to override the
 * mismatch**"* (BRD FR-10).
 *
 * That last clause is the one worth stating as a design fact rather than a
 * convention. There is **no parameter** that says "ignore the mismatch", and
 * no path from a mismatch to a verification. The mismatch outcome is a
 * **terminal** result for that request.
 *
 * AND A SCAN NEVER DOWNGRADES AN ATTESTATION
 * -------------------------------------------
 * The story's edge case: *"the operator scans a matching code and then
 * attests → the recorded method remains `SCAN`; the attestation is not
 * permitted to downgrade a scan."*
 *
 * A scan is the **stronger** claim — the machine read a label. So the rule
 * is: **a `SCAN` always wins over an `ATTESTATION`**, and the attestation
 * is not recorded at all. The reverse — an attestation after an attestation
 * — is simply a later attestation, and the newest row is the effective one.
 *
 * AND THE COMPARISON IS EXACT
 * ---------------------------
 * A dyestuff code is an identifier, not a natural-language name. Two codes
 * that differ only in case are two different codes, and folding them would
 * make a mismatch look like a match — which is the one thing this rule must
 * never do. No case folding, no normalisation beyond the trim the
 * identifier's own factory already applies.
 */
import type { DyestuffCode } from '../../../005-orgatex-integration/domain/value-objects/identifiers.js';

export type IdentityVerificationOutcome =
  | {
      readonly kind: 'MATCHES';
      /** The code that was presented. */
      readonly code: string;
    }
  | {
      /**
       * The code names a **different** material.
       *
       * A hard stop. It carries **both** codes, because the operator must be
       * told what was expected and what was presented.
       */
      readonly kind: 'MISMATCHED';
      readonly scannedCode: string;
      readonly expectedCode: string;
    };

export class MaterialIdentityVerifier {
  /**
   * Compare a presented code against the component's required code.
   *
   * The comparison is exact: trimmed by the identifier's own factory, and
   * then compared as strings. **No case folding** — a case-folded match
   * would be a wrong material accepted as a right one.
   */
  verify(presented: string, expected: DyestuffCode): IdentityVerificationOutcome {
    const code = presented.trim();

    if (code === expected.value) {
      return { kind: 'MATCHES', code };
    }

    return {
      kind: 'MISMATCHED',
      scannedCode: code,
      expectedCode: expected.value,
    };
  }
}
