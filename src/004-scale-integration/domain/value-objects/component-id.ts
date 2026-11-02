/**
 * ComponentId — the identity of the component being weighed.
 *
 * Opaque to this unit. This unit does not know what a component IS — that
 * is unit `002-recipe-material-management`'s. The id is carried so that a
 * selection can be ATTRIBUTED to the component it was made for, which
 * the story requires ("the selection records the scale id, the component
 * id, the time of selection and the reason").
 *
 * It is bounded in length for the same reason `ScaleId` is: it arrives
 * from a request body, and an unbounded string is an unbounded thing to
 * carry in a log line, a database key and an event payload.
 */
export class ComponentId {
  private constructor(readonly value: string) {}

  static create(raw: string): ComponentId {
    const value = raw.trim();
    if (value.length === 0) {
      throw new Error('ComponentId must not be empty');
    }
    if (value.length > 64) {
      throw new Error('ComponentId must not exceed 64 characters');
    }
    return new ComponentId(value);
  }

  equals(other: ComponentId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
