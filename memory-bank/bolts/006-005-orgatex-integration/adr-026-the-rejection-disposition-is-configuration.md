---
bolt: 006-005-orgatex-integration
created: 2026-11-02T21:46:00Z
status: accepted
superseded_by: null
---

# ADR-026: The rejection disposition is configuration, and defaults to RETRYABLE

## Context

**CQ-06** is an open question in the Product Brief:

> "Is a rejected posting permanent or retryable?"

It is not an academic question. The two answers lead to genuinely
different product behaviour, and the difference is whether a dyehouse
consumption is ever silently dropped.

The story names it explicitly:

> "**CQ-06** (is a rejected posting permanent or retryable?) is answered
> by making the disposition a **configuration value** rather than a code
> change, so that the unit supports both answers."

So the mechanism is settled — configuration, not code. What is *not*
settled is **which value is the default**, and that is the decision this
ADR makes, because a default is a behaviour, and a behaviour with no
stated reasoning is one a future agent will not question.

The two answers mean different things:

- **PERMANENT** — the MES refused this consumption and will refuse it
  again. It is a defect: the batch is not postable, the quantity is
  wrong, the lot is unknown. It will not fix itself.
- **RETRYABLE** — the MES refused this consumption, but the refusal might
  be transient: a lock held by another process, a temporarily
  unpostable batch, a bad moment in the MES's own state.

And there is a third fact underneath both: the MES's behaviour is
**unconfirmed** (A-02, Q-02). The product does not know what the MES's
rejections mean yet, because it does not know what the MES is.

## Decision

**The disposition is a configuration value, and it defaults to
`RETRYABLE`.**

```text
WEIGHINGMS_ORGATEX_REJECTION_DISPOSITION = RETRYABLE | PERMANENT
```

**The default is `RETRYABLE`, and the default is not an answer to
CQ-06.** It is the safer of the two behaviours, chosen because the
consequence of being wrong is asymmetric.

### The disposition does not change the posting's state

A rejected posting is `REJECTED` **either way**. The disposition decides
whether bolt `007`'s retry machinery re-drives it — and that is bolt
`007`'s concern.

This bolt records the rejection faithfully and exposes the disposition. It
does not decide, on its own, that a rejection is the end of it.

### The rejection is retained, never discarded

Under either disposition, a rejected posting is **kept**, with its reason
code and its bounded detail. The unit brief is explicit: *"A posting that
fails permanently is **not silently discarded** — it remains visible as a
failed entry that can be re-driven."*

## Rationale

### Why `RETRYABLE` is the safer default

Between the two behaviours, one produces a **silently wrong number** and
the other produces a **visible problem**.

Under `PERMANENT`, a posting the MES rejected once is never sent again.
If the rejection was in fact transient — a lock, a momentary state — the
consumption is **never sent at all**. The station's record says the
consumption was weighed; the MES's record does not have it. Nothing
alerts anybody. The order's actual consumption is short by one weighing,
and the discrepancy surfaces days later, if at all, as an unexplained
difference between the order and the dye usage.

Under `RETRYABLE`, a posting the MES rejected stays visible and keeps
failing loudly. The operator sees a failed entry with its reason. The
disposition can be changed to `PERMANENT` when the rejection is
understood — and by then it will be, because the reason code says what
the MES objected to.

**The BRD's governing rule decides it:** *"no failure at any boundary may
produce a silently wrong number."* A permanently-dropped consumption is
exactly that. A noisy retry is not.

So the default is the choice that makes the failure **visible** rather
than the choice that makes it **quiet**.

### Why the default is not a resolution of CQ-06

CQ-06 is **unanswered**. FCI has not said whether OrgaTEX's rejections are
permanent or transient, and the product does not know what the MES is.

If the default were presented as the answer, the question would be closed
by a **default value** — which is the easiest way for an unanswered
question to stop being asked. And CQ-06 is exactly the kind of question
whose answer would change the product's behaviour in a way nobody would
notice had changed.

So the default is stated as a **default**: the value the product uses
until FCI says otherwise, chosen for safety, and changed by
configuration when the answer arrives.

This is **ADR-019's shape**, and the precedent is worth extending. There,
the selection threshold was a configuration parameter that was **left
unset** because Q-04 was unanswered, and the rule was written so that
answering the question was a configuration change rather than a code
change. Here, the parameter has a value — because a value is needed for
the product to behave — but it is a value that is explicitly *provisional*.

### Why the disposition does not change the posting's state

Because the posting's state answers "what did the MES say?", and the MES
said `REJECTED` either way.

Letting the disposition rewrite the state would mean a posting could be
`RETRYABLE` and `REJECTED` simultaneously — or that a `PERMANENT`
disposition would rewrite `REJECTED` into some other state, and the
MES's actual answer would be lost. The MES's answer is a **fact about
the MES**, and it is recorded as such.

The disposition is a **policy about what to do next**, and policies live
outside the record of what happened.

### Why the reason code and the detail are both kept

The **code** is a closed set — the contract, and what a consumer branches
on. The **detail** is the MES's own diagnostic text, bounded to 500
characters.

The code is what makes the disposition actionable later: when FCI answers
CQ-06, the answer will be in terms of *which* rejections are permanent —
"the MES refuses a batch that is already `WEIGHED`, permanently; a lock
conflict is transient". A disposition cannot be written without the codes
being specific, and the codes have to be recorded **at the time of the
rejection**, because the MES is not asked again.

The detail is what makes the failure diagnosable **without OrgaTEX-side
access** (IR-09) — which is the story's own requirement, and the reason
the detail is bounded rather than dropped.

## Consequences

### Positive

- **Answering CQ-06 is a configuration change**, not a code change and not
  a release.
- **The default never silently drops a consumption.** The failure mode is
  a visible failed entry, not a missing consumption.
- **Both answers work today.** The unit supports `PERMANENT` and
  `RETRYABLE` without a code change, which is what the story asked for.
- **The rejection's code is recorded**, so the eventual answer to CQ-06
  can be written in terms of the codes that actually occur.
- **The posting's state is the MES's answer**, and the disposition is
  policy — two different things, kept apart.

### Negative

- **`RETRYABLE` is noisier.** A genuinely permanent rejection keeps
  appearing in the queue until somebody changes the disposition. The
  operator sees a repeated failure for a failure that will never succeed.
- **The default is wrong about half the time, if the MES's rejections are
  permanent.** And it is wrong in the **safe** direction, but it is still
  wrong, and it will generate support questions.
- **The disposition is a setting that can be set wrongly.** A deployment
  that sets `PERMANENT` on a transient rejection reintroduces the silent
  drop — and the configuration is the only thing standing between the
  product and that failure.

### Risks

- **A future agent treats the default as CQ-06's answer** and closes the
  question, so FCI is never asked. *Mitigation*: this ADR states that the
  default is not an answer, and the decision index's "Read when" points at
  CQ-06.
- **A future agent makes the disposition a code change** — an enum in the
  domain rather than a config value — because a config value "lets the
  deployment get it wrong". *Mitigation*: the same index entry; the story
  asked for configuration explicitly.
- **A future agent makes `PERMANENT` discard the posting**, reading
  "permanent" as "not worth keeping". *Mitigation*: this ADR states that
  the rejection is retained under **both** dispositions, and the unit
  brief says the same.

## Related

- **Stories**: 003-post-consumption-idempotently
- **Requirements**: FR-16, FR-19, BRD IR-09, BRD DR-01, BRD NFR-14,
  BRD NFR-19, BRD C-13
- **Previous ADRs**: ADR-019 (the selection threshold is configuration, and
  is unset until FCI answers — the same question, the same treatment, and
  the precedent for a provisional parameter); ADR-025 (the local ledger is
  the guarantee — the same "assume the worst case" reasoning about an
  unconfirmed external contract)
- **Standards**: `standards/tech-stack.md` § "Database" — DR-01's ≥ 5-year
  retention, and the append-only discipline that keeps a rejected posting
  visible
