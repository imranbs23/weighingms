/**
 * AuthenticationOutcome — the result of a sign-in attempt.
 *
 * INVARIANT I-3: a failed sign-in is indistinguishable from a successful
 * one in its observable result.
 *
 * The type makes the *response* indistinguishable BY CONSTRUCTION: there is
 * exactly one failure shape, `AuthenticationFailure`, and it carries no
 * discriminating field. A caller cannot branch on WHY authentication failed,
 * because "why" is not available to branch on. There is no `unknownOperator`
 * versus `wrongPassword` distinction to leak through a careless return
 * value.
 *
 * The TIMING half of I-3 cannot be enforced here — it is a property of the
 * provider's implementation, which must do the same work on both paths. See
 * `LocalIdentityProvider`.
 */
import type { IdentitySession } from '../entities/identity-session.js';

/**
 * The single failure shape.
 *
 * Note the absence of fields. There is deliberately no `reason` that
 * distinguishes "no such operator" from "wrong secret", because such a
 * field would be exactly the identity oracle the type is designed to
 * prevent.
 */
export class AuthenticationFailure {
  private constructor() {}

  /**
   * Build the one and only failure value.
   *
   * The reason parameter is accepted but MUST be the constant
   * AUTHENTICATION_FAILURE_REASON. It exists so that call sites are forced
   * to acknowledge a reason while being structurally unable to pass a
   * distinguishing one.
   */
  static create(reason: string = AUTHENTICATION_FAILURE_REASON): AuthenticationFailure {
    if (reason !== AUTHENTICATION_FAILURE_REASON) {
      throw new Error(
        'AuthenticationFailure must not carry a distinguishing reason — ' +
          'that would make the sign-in endpoint an identity oracle',
      );
    }
    return new AuthenticationFailure();
  }
}

export const AUTHENTICATION_FAILURE_REASON = 'AUTHENTICATION_FAILED';

export class AuthenticationOutcome {
  private constructor(
    private readonly session: IdentitySession | null,
    private readonly failure: AuthenticationFailure | null,
  ) {}

  static success(session: IdentitySession): AuthenticationOutcome {
    return new AuthenticationOutcome(session, null);
  }

  static failure(): AuthenticationOutcome {
    return new AuthenticationOutcome(null, AuthenticationFailure.create());
  }

  isSuccess(): boolean {
    return this.session !== null;
  }

  /**
   * The session, or null on failure.
   *
   * There is deliberately no way to ask "was it a wrong password or an
   * unknown operator?" — the information does not exist in this type.
   */
  getSession(): IdentitySession | null {
    return this.session;
  }

  getFailure(): AuthenticationFailure | null {
    return this.failure;
  }
}
