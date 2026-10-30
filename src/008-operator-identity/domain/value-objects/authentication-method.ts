/**
 * AuthenticationMethod — which identity source authenticated the operator.
 *
 * This records PROVENANCE, not policy. `LOCAL` is the shipped
 * implementation. `DIRECTORY` exists because Q-08 (does FCI supply its own
 * operator directory?) is undecided — and the model should not have to
 * change when it is answered.
 *
 * A DIRECTORY provider is deliberately NOT implemented. Implementing it
 * would invent a contract for a system that does not exist, which the
 * workbook forbids. The seam exists so the future replacement is possible,
 * not so it can be pre-built.
 */
export const AUTHENTICATION_METHOD_LOCAL = 'LOCAL';
export const AUTHENTICATION_METHOD_DIRECTORY = 'DIRECTORY';

export type AuthenticationMethodValue =
  | typeof AUTHENTICATION_METHOD_LOCAL
  | typeof AUTHENTICATION_METHOD_DIRECTORY;

export class AuthenticationMethod {
  private constructor(readonly value: AuthenticationMethodValue) {}

  static local(): AuthenticationMethod {
    return new AuthenticationMethod(AUTHENTICATION_METHOD_LOCAL);
  }

  static directory(): AuthenticationMethod {
    return new AuthenticationMethod(AUTHENTICATION_METHOD_DIRECTORY);
  }

  static fromStored(raw: string): AuthenticationMethod {
    if (raw === AUTHENTICATION_METHOD_LOCAL) {
      return new AuthenticationMethod(AUTHENTICATION_METHOD_LOCAL);
    }
    if (raw === AUTHENTICATION_METHOD_DIRECTORY) {
      return new AuthenticationMethod(AUTHENTICATION_METHOD_DIRECTORY);
    }
    throw new Error(`Unknown authentication method: ${raw}`);
  }

  isLocal(): boolean {
    return this.value === AUTHENTICATION_METHOD_LOCAL;
  }

  toString(): string {
    return this.value;
  }
}
