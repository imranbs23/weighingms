---
bolt: 006-005-orgatex-integration
created: 2026-11-02T21:44:00Z
status: accepted
superseded_by: null
---

# ADR-025: The local ledger is the guarantee, because the MES's contract is unknown

## Context

This bolt posts consumption to OrgaTEX. Two of the Product Brief's
assumptions are about exactly that:

- **A-02** assumes OrgaTEX accepts external consumption postings at all.
- **Q-02** asks exactly that — *"Will OrgaTEX accept external consumption
  postings?"* — and asks nothing about how.

And **Q-01** asks whether the MES exposes an interface at all, and of what
kind. The BRD's own endpoint list is marked *"assumed endpoint shape —
illustrative, for FCI/SETEX to correct"*.

So the shape of the write is unknown. And one specific property of it
matters more than the rest:

**Does the MES deduplicate?**

If it does, the idempotency key on the request is enough — the MES
recognises a repeated key and applies the consumption once. If it does
**not**, then a retry after a lost response double-counts the consumption,
and the local system is the only thing that can prevent it.

BRD IR-08 requires idempotency. The unit brief says the mechanism is
"an idempotency key carried on every posting — derived from the weighing
record's identity — plus a **client-side guard** that refuses to enqueue
a posting whose key is already present in the sync queue", and that if
the real contract does not support a key, "the fallback is a local
deduplication table, and the behaviour is unchanged from the caller's
point of view".

So the brief has already answered the shape of the question: **the local
table is the fallback**. What it does not say is whether the local table
is also the **primary** guarantee or merely a **secondary** one.

That is the decision, and it has to be made now rather than when FCI
answers, because the implementation differs.

## Decision

**The local ledger is the guarantee. The MES's own deduplication is, if
it exists, a second line of defence.**

The design assumes the **worst case**: the MES accepts the posting, does
**not** deduplicate, and does not read the key at all.

**No claim is made that OrgaTEX understands the idempotency key.** The
key is carried on the request — because it costs nothing and the MES may
use it — but the product's safety does not depend on it.

The local ledger (ADR-023) is what makes a retry safe. The posting is
**not sent** if its key is already in the ledger, so the MES never sees a
second copy in the first place.

### The fallback is not a degraded mode

The unit brief calls the local table a "fallback". It is better described
as the **implementation** of the guarantee, and the MES's key support as
an **optimisation**.

The distinction matters because "fallback" implies a second path, and a
second path is a second thing to get wrong. There is only one path: the
ledger. Whether the MES also dedupes changes the number of copies that
reach the MES, not the number of paths that decide what is safe.

## Rationale

### Why assume the worst case

Because the assumption is **free**, and the alternative is not.

If the design assumed the MES dedupes and it did not, the product would
double-count a dye batch — a quantities error on a real order, and one
that is **invisible**: the MES would show two consumptions and the
station would show two successful postings, both of which look right.

If the design assumes the MES does not dedupe and it does, the product
loses **one** redundant request. The MES would have received the key and
ignored it.

The asymmetry is the whole argument: **the cost of being wrong about
safety is a wrong number; the cost of being wrong about redundancy is one
extra request.** And the BRD's governing rule is explicit — *"no failure
at any boundary may produce a silently wrong number."*

### Why "the posting is not sent" rather than "the MES is asked to dedupe"

This is the part that makes the local ledger a guarantee rather than an
optimisation, and it is worth being precise about.

If the product sent the posting and then relied on the MES to recognise
the duplicate, the guarantee would live **outside** the product. The
station would have no way to know whether a consumption had been
double-counted, and it could not tell an operator.

By refusing to send a posting whose key is already in the ledger, the
station **knows** that at most one copy of a consumption has ever left
the building. That knowledge is what the station's own record of the
consumption rests on, and it is what makes the ticket's consumption
reference trustworthy (FR-17).

### Why the key is still carried on the request

Three reasons, and none of them is "in case the MES needs it":

1. **It costs nothing**, and if the MES does dedupe, the key is what
   makes *its* deduplication work — protecting against a duplicate that
   arrived by a path the local ledger did not see (a second station, a
   manual entry).
2. **It is the natural shape of the contract**, and Q-01 says the contract
   is unconfirmed. A key in the request is a shape many real MES APIs
   already use.
3. **It makes the seam honest.** When FCI answers, the adapter's write
   method either uses the key or it does not — and that is a **change in
   one method**, not a change in the domain.

### Why the key is derived from the weighing record, not the component

The story's edge case is explicit:

> "The operator confirms the same component twice | The second
> confirmation is a distinct weighing record with a distinct key; the key
> is derived from the weighing record's identity, not from the component."

Deriving from the component alone would make the second confirmation a
duplicate of the first. The second weighing would be **refused** — and
the consumption would never be sent.

That is a **lost consumption**, which is the mirror-image failure of the
double-post this bolt exists to prevent, and it is just as wrong. The
key's derivation is therefore part of the guarantee, not a detail of its
format.

### Why the key is hashed rather than being the identity in plain text

The identity contains the operator id and the weighing time. The key is
**carried on the request**, **written to the MES** and **logged** — so
putting the identity in plain text would spread the operator id and the
weighing time across every system the posting touches, duplicating them
in places that do not need them.

The hash is one-way, so the key leaks nothing about the weighing it
identifies. The posting itself still carries the operator id and the
weighed-at, which is where they belong.

It is also **not guessable**, which matters because the key is not a
secret — it is carried on the request — but a guessable key would let a
third party replay a posting and double-count a consumption.

## Consequences

### Positive

- **The product is safe regardless of what FCI answers.** The ledger
  guarantees at most one copy leaves the station, whatever the MES does.
- **The station knows what it has sent**, rather than inferring it from
  the MES. The consumption reference on the ticket is trustworthy.
- **The seam stays honest.** When the real contract is confirmed, the
  change is confined to the adapter's write methods.
- **The key's derivation is a business rule in the domain**, testable
  without a database or a MES.

### Negative

- **The key is not human-readable.** A log line showing `IDK-7f3a9c21`
  does not tell an operator which weighing it refers to. The posting's
  own fields do — but the log line must carry them too, or the log is
  less useful for diagnosis (IR-09).
- **The local ledger must be consulted on every send**, which is one
  primary-key lookup. Negligible, but it is a step the send path does not
  have if the MES is trusted.
- **A duplicate posting returns `200` with `duplicate: true`** rather
  than doing the work again. A caller that wanted the side effect
  re-performed would not get it — which is the point, but it is a
  behavioural difference to document.

### Risks

- **A future agent, after the real MES is connected and found to
  deduplicate, removes the local ledger** as redundant. The product then
  depends on an external system's behaviour for a correctness guarantee
  it can no longer verify — and if the MES's dedupe is scoped to a window
  (a day, a batch), the guarantee quietly expires. *Mitigation*: this ADR,
  and the decision index's "Read when" points at exactly this.
- **A future agent assumes the MES understands the key and drops it from
  the request**, because the local ledger makes it redundant. That is
  survivable — but it removes the second line of defence for a duplicate
  that arrived by a path the local ledger did not see. *Mitigation*: the
  same index entry.
- **A future agent derives the key from the component** rather than from
  the weighing record, because the component is the obvious thing to
  key on. The second weighing of a component is then refused, and the
  consumption is lost. *Mitigation*: this ADR names the edge case and the
  failure it produces.

## Related

- **Stories**: 003-post-consumption-idempotently
- **Requirements**: FR-16, FR-18, BRD IR-08, BRD IR-05, BRD IR-06,
  BRD IR-09, BRD NFR-12
- **Previous ADRs**: ADR-023 (the ledger's primary key is the idempotency
  guarantee — the mechanism this ADR relies on); ADR-007 (record the
  operator an authorisation was issued for — the same concern about
  traceability); ADR-022 (the adapter's transport is not exercised by the
  tests — the same "the far side's contract is unconfirmed" reasoning)
- **Standards**: `standards/tech-stack.md` § "API shape" — the Dummy
  OrgaTEX's `POST /api/batches/:batchId/consumption`, a **training**
  contract rather than a claim about the real interface
