/**
 * AuthorisationScope — the (action, subject) pair an authorisation binds.
 *
 * INVARIANT A-4: an authorisation is scoped to EXACTLY ONE action and
 * EXACTLY ONE subject.
 *
 * Grouping the two into a single value object is what makes A-4 ONE
 * equality check rather than two independent checks that could be applied
 * inconsistently. There is no way to hold a scope with an action but no
 * subject, or a subject but no action — so there is no "half-scoped"
 * authorisation to reason about.
 *
 * The subject remains OPAQUE: this value object compares subjects, it does
 * not parse them.
 */
import { PrivilegedAction } from './privileged-action.js';
import { AuthorisationSubject } from './authorisation-subject.js';

export class AuthorisationScope {
  private constructor(
    readonly action: PrivilegedAction,
    readonly subject: AuthorisationSubject,
  ) {}

  static of(action: PrivilegedAction, subject: AuthorisationSubject): AuthorisationScope {
    return new AuthorisationScope(action, subject);
  }

  /**
   * True when this scope matches the requested one.
   *
   * BOTH parts must match. A scope that matched on the action alone would
   * authorise every subject of that action; one that matched on the subject
   * alone would authorise every action of that subject. The pair is the
   * unit.
   */
  matches(action: PrivilegedAction, subject: AuthorisationSubject): boolean {
    return this.action.equals(action) && this.subject.equals(subject);
  }

  equals(other: AuthorisationScope): boolean {
    return this.matches(other.action, other.subject);
  }
}
