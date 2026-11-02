---
bolt: 004-004-scale-integration
created: 2026-10-31T03:30:00Z
status: accepted
superseded_by: null
---

# ADR-018: "No device can weigh this" is a successful outcome, not an error

## Context

The selection rule can end in one of two ways: a device is selected, or
**no device can weigh the target**. The story is explicit about the
second:

> **Given** a component whose target exceeds the 32 kg floor scale's
> capacity, **When** the scale is selected, **Then** the selection returns
> an explicit "no device can weigh this" outcome with the target and the
> maximum available capacity — no device is selected and no value is
> guessed (FR-7).

and the edge case:

> | The target is 32.1 kg | **No device can weigh this** is returned, with
> the target and the 32 kg maximum. No device is selected and nothing is
> guessed. |

The story also says the rule "does not select the floor scale and let it
report an overload, and it does not split the quantity across devices."

What the story does not say is **how the outcome is reported** — the HTTP
status code, the response shape, and whether the outcome is an error.

This is not a cosmetic question. The outcome's classification decides
three things:

1. Whether a caller treats the answer as a result or as a failure.
2. Whether the refusal is logged as an error, and therefore whether it
   pages anyone.
3. Whether the caller retries, and what it does on a retry.

## Decision

**"No device can weigh this" is a successful outcome. The selection
endpoint returns `200` with an explicit `selected: false` body carrying
the target and the maximum available capacity.**

Concretely:

- The status code is **200**, not 4xx.
- The response is `{ selected: false, target, maximumCapacity, unit,
  demandedClass }` — the two facts the story requires, plus the unit and
  the demanded class.
- The domain represents it as a **discriminated union** —
  `ScaleSelectionOutcome` with a `SELECTED` branch and a
  `NO_DEVICE_CAN_WEIGH` branch — so a caller cannot read a `scaleId`
  without first proving one was selected.
- The domain emits a **`ScaleSelectionRefused`** event, because the
  outcome is worth knowing about.

## Rationale

**1. The request succeeded. The question was answered.**

The caller asked "which scale should this component be weighed on?" and
the answer is "none of them, and here is exactly why". That is a
complete, correct, useful answer to a well-formed question. There is no
malformed input, no authentication failure, no server fault and no
conflict. The HTTP layer's error codes describe *the request's* fate, and
this request's fate was entirely successful.

**2. A 4xx would make the caller treat a business outcome as a failure,
and the consequences are all bad.**

A caller that receives a 4xx typically:

- logs an error and alerts on it;
- shows an error message to the operator ("something went wrong");
- may retry, hoping for a different outcome — but the outcome is
  deterministic, so the retry is guaranteed to fail identically.

The operator would be told the station is broken when the truth is that
this particular component is too heavy for the available equipment. Those
are different problems with different responses, and conflating them
sends the operator down the wrong path.

**3. "Nothing guessed" is an explicit answer, not an absence.**

The story's requirement is that "no device is selected and no value is
guessed". An implementation that returned `404 Not Found` — the nearest
naive choice — would satisfy "no device is selected" while telling the
caller *nothing*. A 404 says "there is no such resource"; it does not
say "the resource you asked about does not exist, and here is what
exists instead".

The `200` with `selected: false` carries the **target** and the
**maximum available capacity** — the two facts that let the caller (or
the operator) understand *why* the component could not be weighed and
*what* would have to change. That is the difference between an absence
and an answer.

**4. The discriminated union makes the branch unskippable in code.**

This is the structural half of the decision, and it matters more than the
status code.

`ScaleSelectionOutcome` is a union with two branches. In TypeScript, a
caller that holds an outcome must narrow it before it can read
`scaleId` — and narrowing is the point at which the caller decides what
to do with the "no device" case. A caller **cannot** accidentally treat
the no-device outcome as a successful selection, because the successful
branch's fields do not exist on the other branch. The type makes the
mistake a compile error rather than a runtime surprise.

An API returning `{ selected: boolean, scaleId?: string }` would give
the caller a `scaleId` that is `undefined` on the failure branch — and
`undefined` flows straight into a URL, a database write or a UI without
being noticed.

**5. The event is worth emitting even though it is not an error.**

`ScaleSelectionRefused` carries the component, the target, the maximum
capacity, the class and the time. That is exactly the information an
operator or a process engineer needs when a component **cannot be
weighed** — which is a business event worth seeing, not a fault.

Emitting it as an event (rather than only as an error log) also keeps
the distinction visible in the event stream: a station that regularly
refuses a 40 kg component is telling you something about the recipe data
or the equipment list, and that signal is easier to act on when it is a
first-class event than when it is a log line.

**6. The refusal changes nothing, which is why it is not a "conflict".**

A `409 Conflict` would be wrong for the same reason it is right for a
refused tare (the technical design's "409 for a refused tare, 200 for a
refused selection"). A refused tare leaves the device's state **in
question** — did the zero reference move? — so the caller needs a status
that says "this did not happen, and here is what is still true". A
refused selection touches **no state at all**: no device was selected, no
device was modified, no session was bound. Nothing is in question.

### Alternatives Considered

| Alternative | Pros | Cons | Why Rejected |
|-------------|------|------|--------------|
| **200 with `selected: false` and the target and maximum capacity** (adopted) | The caller gets a usable answer; the operator is not told the station is broken; the union makes the branch unskippable; the outcome is a first-class event | The status code does not distinguish the outcome from a successful selection — the body does | A body that distinguishes it is better than a status code that distinguishes it, because the status code alone forces every consumer to parse the body anyway |
| **4xx (400/409/422)** | The status code alone carries the outcome; error monitoring tools see it | The caller treats a normal business outcome as a failure; it alerts, shows an error to the operator and may retry a deterministic answer | The request did not fail. The 4xx vocabulary describes a malformed or unsatisfiable request, and this request was neither |
| **404 Not Found** | The nearest naive mapping to "no device" | Says nothing about why; indistinguishable from a typo'd scale id or a missing route; invites the caller to think the rule is broken | An absence of an answer where an answer exists |
| **200 with a `scaleId: null`** | Simple shape | The caller reads a `scaleId` that is `null` and does not notice the difference between "no device" and "a device whose id is missing" | A nullable field is exactly the shape the discriminated union exists to replace |
| **Return the smallest device and let it report `OVER_CAPACITY`** | The caller always gets a device | Routes a load to an instrument that will refuse it; produces a runtime failure where a rule could have produced a clean answer | The story explicitly forbids it ("does not select the floor scale and let it report an overload") |
| **Split the quantity across devices** | Every part is within capacity | Forbidden by the story; invents a dispensing behaviour | Forbidden by the source material |
| **Refuse the component and raise a supervisor authorisation request** | The operator is told and can act | Requires supervisor authorisation for a routine weighing, which the story forbids (FR-7, BRD BR-05); the manual reselection belongs to unit `003`/`006` | The story's rule-based, no-input requirement is explicit |

## Consequences

### Positive

- **The operator is told the truth.** "This component is too heavy for the
  available scales" rather than "something went wrong".
- **No false alarms.** A station refusing an over-capacity component
  does not page anyone.
- **The caller receives the two facts the story requires**, in one place:
  the target and the maximum capacity.
- **The type system prevents the mistake.** A caller cannot read a
  `scaleId` from the no-device branch without narrowing.
- **The outcome is observable** as a first-class domain event, so a
  pattern of refusals is visible.

### Negative

- **A caller that checks only the status code will treat the refusal as a
  success.** The status code is not sufficient on its own; the body
  must be inspected. This is a real cost, and it is accepted because
  the alternative misleads in a worse direction.
- **Monitoring must be configured to look at the body**, or at the
  `ScaleSelectionRefused` event, to see refusals.
- **The 200 status code is "wrong" by REST convention** for an outcome
  that refuses something, and a reviewer may flag it. The technical
  design records the reasoning so the deviation is not mistaken for an
  oversight.

### Risks

- **A new consumer ignores the `selected` flag** and proceeds as though
  a device was chosen. *Mitigation*: the domain's discriminated union
  makes this a compile-time error in TypeScript; and the API's body
  carries `selected` as the first field, so it is visible on sight.
- **The caller retries a deterministic refusal.** *Mitigation*: the
  response carries the target and the maximum capacity, so the caller can
  see that the answer will not change; and no retry path exists in this
  unit.
- **A refusal is never noticed because 200 is not an error.** *Mitigation*:
  the `ScaleSelectionRefused` event carries the full context, and the
  technical design lists it among the events an operator would need to
  diagnose a stalled station.

## Related

- **Stories**: 004-select-scale-by-capacity
- **Requirements**: FR-7, BRD BR-05, BRD AC-02
- **Standards**: `units/004-scale-integration/unit-brief.md` § Constraints —
  "the system never guesses a value it does not have"; `units/004-scale-integration/stories/004-select-scale-by-capacity.md`
  § Technical Notes — "The over-capacity case has no defined behaviour in
  the BRD or the prototype, so it is recorded as an open edge rather than
  resolved by invention."
- **Previous ADRs**: ADR-004 (one uniform response for every
  *authorisation* refusal — the reason this rule does **not** apply here
  is that a scale's state is visible at the station and the story requires
  the reason to be named); ADR-011 (the link state and the device status
  are separate axes — the same "two different facts, kept apart" reasoning)
