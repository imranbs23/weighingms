---
bolt: 003-004-scale-integration
created: 2026-10-30T23:40:00Z
status: accepted
superseded_by: null
---

# ADR-008: The weight value crosses the wire as a decimal string, not a JSON number

## Context

BRD NFR-16 states: *"Weight arithmetic uses fixed-point decimal; floating
point is not permitted for quantities."* The BRD's data model stores every
quantity as `decimal(12,4)`.

The domain honours this strictly. `WeightValue`'s constructor accepts a
**string and nothing else** — a JavaScript `number` cannot enter the weight
path at all, because the type system will not let it.

The risk is that the guarantee is lost **after** the domain, at the wire.

The approved tech stack's "Live weight transport" section gives the SSE
frame as:

```text
GET /api/scales/:scaleId/weight      (text/event-stream)
data: {"weight":93.42,"stable":false,"timestamp":"..."}
```

`93.42` is a **JSON number**. Every JSON parser in every language — the
browser's `JSON.parse`, Express's, any future consumer — decodes that into an
IEEE-754 double. `93.42` as a double is `93.4199999999999982946974341757595539093017578125`.

So the example in the approved tech stack, followed literally, would take a
value the domain was careful to keep exact and turn it into a float for the
entire remainder of the journey — through the transport, through the
browser's parser, into the readout, and into the tolerance comparison that
decides whether a weighing is confirmed.

The example is also **out of date** in a second way. It predates the story,
and it omits three of the five fields the story pins: `unit`, `sequence` and
`receivedAt`.

This matters more than a normal API contract detail because of *where* it
sits. BRD NFR-16's guarantee has to survive all the way to the operator's
screen, and the wire format is the one place where a domain guarantee can be
silently undone by a change nobody thinks of as arithmetic.

The BRD's assumed streaming shape is explicitly illustrative — "for FCI/SETEX
to correct" — so the example was never a contract. But it is the example in
the approved document, and a future agent reading the tech stack would
reasonably follow it.

## Decision

**The SSE payload carries the weight as a JSON string, and uses the
story's field names.**

```text
event: reading
data: {"scaleId":"SCALE-A","value":"93.42","unit":"g","stable":false,"sequence":42,"receivedAt":"2026-10-30T23:20:34.123Z"}
```

`"value":"93.42"` — a string, not `93.42`.

The same rule applies to every other quantity that crosses a boundary in this
product: the capacity and resolution in the status view, the `target` and
`tolerance` in the dispense request, and every quantity in the weighing
records that unit `003` writes.

**The rule, stated once so it can be applied without re-deriving it:**

> A quantity on the wire is a **decimal string**. A JSON number is a float
> and is never a quantity.

### What this does NOT change

- The `WeightValue` constructor still takes a string. This ADR does not
  relax that — it extends the same rule one layer out.
- The database still stores quantities as `TEXT`. SQLite's `REAL` is an
  IEEE-754 double, the same thing this ADR is avoiding.
- `decimal.js` is still used for arithmetic. The rule is about
  **representation**, not about computation.

### The one place this is allowed to bend, and why

A JSON string is not universally convenient — arithmetic on a string requires
parsing. The rule is that a consumer parses a decimal string into
`decimal.js` (never into a `number`) at the boundary, and works in
`decimal.js` from there.

What is forbidden is the round trip `string → number → string`, because that
is where the precision is actually lost. A consumer that parses
`"93.42"` into `decimal.js` and holds it there has lost nothing.

## Rationale

The alternative — a JSON number — fails silently. Nothing breaks. The value
arrives, it renders, and at 93.42 g the difference between the double and the
decimal is around 2 × 10⁻¹⁴ g. The error is far below the scale's 1 g
resolution, so it is invisible in the readout and harmless in the
comparison.

That is exactly what makes it dangerous. The error is invisible **until the
tolerance boundary is hit**, and the tolerance boundary is the one place in
this product where a precision error has a consequence. The BRD's own
acceptance criteria for tolerance (AC-04) require exact inclusive/exclusive
comparison at the band edges, and the workbook requires explicit
boundary-value tests at 93.4 / 93.5 / 94.0 / 94.5 / 94.6 g. A float in the
path makes those tests depend on the representation of the number rather
than on the rule being tested.

The third option — a JSON number plus a separate string field — was rejected
as strictly worse than either. It doubles the contract, it creates two
sources of truth for one quantity, and it invites a consumer to read the
wrong one.

### Alternatives Considered

| Alternative | Pros | Cons | Why Rejected |
|-------------|------|------|--------------|
| **JSON number** (the tech stack's example) | Matches the approved document; convenient for consumers | Decodes to an IEEE-754 double in every parser; violates NFR-16 in transit; the error is invisible until a tolerance boundary is hit | The domain guarantee does not survive the wire. A document example is not a contract — the BRD's streaming shape is explicitly "illustrative, for FCI/SETEX to correct" |
| **Decimal string** (adopted) | Exact in every parser; the domain guarantee survives to the browser; a consumer cannot accidentally decode it into a float | Consumers must parse; parsing into a `number` instead of `decimal.js` would reintroduce the problem | The parse is a one-line boundary concern; the alternative's failure mode is silent and consequential |
| **JSON number + a parallel string field** | Both forms available | Two sources of truth for one quantity; doubles the contract; a consumer can read the wrong one | Strictly worse than either single choice |
| **Base64 or a custom binary encoding** | Compact | Not human-readable; no JSON parser accepts it; no debuggability | The quantity volume (10 readings/s × 2 devices) does not justify obscurity |

### Why this is an ADR rather than a code comment

Because the approved tech stack says the opposite, and the tech stack is a
document later agents are told to read. A code comment saying "use a string"
loses to a document saying `{"weight":93.42}` — the document is what gets
read when the SSE frame is being written. This ADR **corrects the
tech stack's example**, and it needs to live in the decision index, where a
later agent will find it, rather than in a file nobody opens.

## Consequences

### Positive

- BRD NFR-16's guarantee survives the entire journey, including the browser.
- The tolerance boundary tests depend on the rule, not on float representation.
- The rule is uniform: every quantity on the wire is a decimal string, so
  there is one convention rather than one per endpoint.
- A reviewer can read a captured SSE frame and see the exact value the scale
  reported.

### Negative

- Consumers must parse quantities. This is a real cost, paid by every future
  unit that reads a quantity — unit `003` (the weighing station), unit `007`
  (the UI), and unit `005` (OrgaTEX write-back).
- The `decimal.js` dependency is now needed on the **client** side too, not
  only server-side. The tech stack already names it for the SPA, so this is
  within the approved stack, but it is a consequence worth stating.
- A consumer written by someone who does not read this ADR may parse the
  string into a JavaScript `number` and reintroduce the problem **inside**
  the client. The rule has to be carried by the type system there too.

### Risks

- **A future agent follows the tech stack's example.** *Mitigation*: this ADR
  corrects the example explicitly, and the tech stack's "Live weight
  transport" section is the natural place to add a cross-reference. That
  update is not made here — the tech stack is a shared standard, and editing
  it is the master agent's call, not the construction agent's.
- **A consumer parses the string into a `number`.** *Mitigation*: the
  consumer-side type is the same `WeightValue`, so the same string-only
  constructor applies. The rule does not depend on the consumer being
  careful.
- **The tech stack and this ADR disagree, and a reader picks the wrong one.**
  *Mitigation*: the "Read when" field in the decision index points squarely
  at "writing or changing an API that returns a quantity".

## Related

- **Stories**: 001-receive-live-weight-stream, 002-detect-disconnection-and-block-weighing
- **Requirements**: FR-8, BRD FR-19, BRD IR-10, BRD IR-19, BRD NFR-16, BRD NFR-01
- **Standards**: `standards/tech-stack.md` § "Live weight transport" — this
  ADR **corrects** the example in that section
- **Previous ADRs**: none. This is the first decision about the wire format
  for quantities.
