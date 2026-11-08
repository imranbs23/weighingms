/**
 * AuthorisationScope — the derived subject an authorisation is bound to.
 *
 * ══════════════════════════════════════════════════════════════════════
 * DERIVED FROM THE SESSION'S OWN IDS. NEVER SUPPLIED BY A CLIENT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Unit `008`'s `AuthorisationSubject` is deliberately opaque to the weighing
 * domain, and its own comment says the composition is the **caller's**
 * business: *"unit 003 uses 'the specific componentId in the specific
 * sessionId'"*.
 *
 * So this is that composition — and it is derived from what the session is
 * **actually working on**, not from a request body.
 *
 * And that is not an optimisation. It makes the scope check **structural**:
 * if the subject is built from the session's own ids, then an authorisation
 * issued for a different component or a different session cannot match —
 * there is nothing for a check to catch (ADR-039).
 */
export class AuthorisationScope {
  private constructor(
    readonly sessionId: string,
    readonly componentId: string,
  ) {}

  /**
   * Build the scope for a component in a session.
   *
   * @throws When either id is empty — a scope that matches nothing would
   *         be a scope that authorises nothing, silently.
   */
  static of(sessionId: string, componentId: string): AuthorisationScope {
    const session = sessionId.trim();
    const component = componentId.trim();
    if (session.length === 0) {
      throw new Error('An authorisation scope must name a session');
    }
    if (component.length === 0) {
      throw new Error('An authorisation scope must name a component');
    }
    return new AuthorisationScope(session, component);
  }

  /**
   * The subject, as unit `008` compares it.
   *
   * **The composition is opaque on purpose** — unit `008` does not parse
   * it, and neither does anything else.
   */
  toSubject(): string {
    return `${this.sessionId}/${this.componentId}`;
  }

  /** The session the scope is bound to. */
  get session(): string {
    return this.sessionId;
  }

  /** The component the scope is bound to. */
  get component(): string {
    return this.componentId;
  }
}
