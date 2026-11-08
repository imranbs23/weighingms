---
bolt: 014-003-weighing-station
created: 2026-11-06T05:00:00Z
status: accepted
---

# ADR-037: The zone's boundaries are exclusive and inclusive as written, and the near threshold is computed once in fixed-point

## Context

The tolerance zone is the pivot of the guided weighing: it decides whether
the operator may confirm, and it drives the status line, the live-weight
cell and the progress bar (FR-9, C-05).

The rule is four lines long:

```text
1. OVER   if  value >  target + tolerance
2. OK     if  value >= target − tolerance
3. NEAR   if  value >= target × 0.9
4. UNDER  otherwise
```

**And every one of those four lines has a boundary that a wrong
implementation gets wrong.**

The story pins two of them with exact numbers, and the unit brief demands
*"an exhaustive boundary test suite at every threshold: exactly `target −
tolerance`, exactly `target × 0.9`, exactly `target + tolerance`, and one ULP
either side of each."*

Three things have to be decided.

**First: is `target + tolerance` `OK` or `OVER`?** The rule says `OVER` is
`value > target + tolerance` — a **strict** comparison. So the bound itself
is not over. And `OK` is `value >= target − tolerance` — **inclusive** at
both bounds.

**Second: how is `target × 0.9` computed?** In IEEE-754,
`94.0000 × 0.9` is **not** `84.6000`. It is `84.60000000000001` or thereabouts
— and the boundary reading the story pins (`84.6000`, which must be `NEAR`)
falls on the **wrong side** of it.

**Third: is the threshold computed once, or on every reading?** Every
reading could multiply the target by `0.9` again. And a fresh
multiplication might round differently from the last one — which would mean
the same reading is `NEAR` on one call and `UNDER` on the next.

## Decision

**The bounds are exclusive and inclusive exactly as the rule writes them, the
near threshold is computed once in fixed-point decimal, and the comparison
is against those three pre-computed numbers.**

1. **`OVER` is a strict `>`.** A reading exactly at `target + tolerance` is
   `OK`.

2. **`OK` is inclusive at both bounds.** A reading exactly at
   `target − tolerance` is `OK`.

3. **`NEAR` is inclusive at its bound.** A reading exactly at `target × 0.9`
   is `NEAR`.

4. **`target × 0.9` is computed with `decimal.js`**, half-up, at the
   **storage precision** (4 decimal places) — never by multiplying a float.

5. **The three bounds are computed ONCE**, when the component is selected,
   and stored in a `ZoneBounds` value. Every reading is compared against
   **those** numbers.

6. **The rule is evaluated in order, and the first match wins.** The order
   is not cosmetic: it is what makes the exclusive bound exclusive.

## Rationale

### Why the bounds are as written

**Because a reading exactly at the tolerance bound is a reading the operator
produced on purpose, and the requirement is about what reaches production —
not about a philosophical question of inclusivity.**

Consider `94.5000 g` against a `94.0000 g` target with a `0.5000 g`
tolerance. The operator dispensed until the scale read 94.5 g. That is
**inside** the band the MES defined. Refusing it would tell the operator
that the recipe's own tolerance is not good enough — and would train them to
aim slightly under, which is a *worse* outcome than the one the band was
designed to permit.

And the asymmetry is deliberate in the rule itself: `OVER` is the only
**exclusive** bound, because the over-dose is the case that must escalate
(BRD FR-13, FR-20). One ULP over is over; one ULP under the lower bound is
inside.

**So the inclusivity is not an implementation detail — it is the requirement's
answer to "what reaches production", and it must be exactly as written.** A
rule that treated the upper bound as over would refuse a legitimate weighing;
a rule that treated the lower bound as exclusive would refuse one too.

### Why fixed-point, and why once

**Because the boundary reading the story pins is the reading that a float
implementation gets wrong.**

`94.0000 × 0.9` in IEEE-754 double precision:

```text
94.0 × 0.9  =  84.60000000000001
```

The story says a reading of exactly `84.6000` is `NEAR`. With the float
threshold, `84.6000 < 84.60000000000001`, so it would be `UNDER` — the
**wrong zone**, at the **wrong boundary**, on the **exact reading the
requirement names**.

**And the error is invisible in the ordinary case.** The next reading,
`84.6001`, would be `NEAR` with either implementation. So the defect would
show up on exactly one number, in exactly one test, and nowhere in
production — which is the worst kind of defect to have and the best kind to
catch.

So the multiplication is `decimal.js`, half-up, at 4 places:

```text
Decimal(94.0000) × Decimal(0.9) = 84.6000
```

exactly.

**And the threshold is computed ONCE.** Two reasons:

1. **Determinism.** If every reading multiplied the target again, a rounding
   difference between two calls would make the **same reading** fall in
   different zones on different calls. The zone would flicker at the
   boundary, and the operator would see a weight that is sometimes `NEAR`
   and sometimes `UNDER` while the scale is perfectly still.

2. **One number, one comparison.** The bounds are a **fact about the
   component**, not about the reading. `ZoneBounds` is computed when the
   component is selected and carried with it — so the comparison is always
   against the same three numbers, and the rule has **one** implementation
   of "where is the near threshold".

### Why the order is fixed

**Because the first match wins, and the order encodes the inclusivity.**

If `OK` were tested before `OVER`, then a reading of `target + tolerance`
would satisfy `value >= target − tolerance` and be `OK` — and the `OVER`
rule would never fire for a reading inside the band. Which is *right* for
that reading — but the same order would make a reading of
`target + tolerance + 1` also `OK`, because it is *also* `>= target −
tolerance`. **The `OVER` rule would be unreachable.**

So `OVER` is tested first, and it is the only rule with an exclusive
comparison. The order is the rule.

## Consequences

### Positive

- **The boundaries are exactly as the requirement writes them**, and the
  test suite proves it at every one.
- **The boundary reading is `NEAR`**, not `UNDER` — the float defect is
  closed by construction.
- **The zone does not flicker.** The same reading is always the same zone,
  because it is compared against the same three numbers.
- **One implementation of the rule.** The bounds live in a `ZoneBounds`
  value object, so there is one place where `× 0.9` happens.
- **The UI cannot disagree with itself.** One computed zone feeds the
  status line, the live-weight cell and the progress bar.

### Negative

- **The bounds are computed when the component is selected**, so changing a
  component's target means recomputing them. That is correct — but it means
  the bounds are **not** a pure function of the target alone; they are
  computed once and carried.
- **`decimal.js` is on the comparison path.** It was already a dependency,
  and it is already used by unit `004`'s conversion and selection rule, so
  this is not a new dependency — but it is a real cost on a path that runs
  ten times a second.
- **A tolerance of zero** and a **target of zero** are legal and must be
  handled explicitly, because `target × 0.9` is then zero and `OK` requires
  an exact equality. The story names both cases, and the tests cover them.

### Risks

- **A future agent computes the near threshold with a float**, because
  `target * 0.9` looks simpler in TypeScript. *Mitigation*: the decision
  index's "Read when" points here, and this ADR shows the exact number that
  breaks.
- **A future agent recomputes the threshold on every reading** "to pick up
  a revised target". *Mitigation*: the same index entry; the target is
  **snapshotted** onto the record anyway (BRD FR-25), and a revised target
  belongs to a new weighing, not to this one.
- **A future agent changes an inclusive bound to an exclusive one** for
  symmetry. *Mitigation*: the same index entry, and this ADR explains why the
  asymmetry is the requirement's answer and not an oversight.

## Related

- **Stories**: `003-evaluate-tolerance-zone`, `004-gate-confirmation-on-zone`
- **Requirements**: FR-9, FR-10, FR-14, FR-18, FR-25 · BRD FR-13, FR-25,
  BR-14 · BRD IR-11, IR-13 · BRD NFR-16, NFR-01 · C-05, C-07, C-11, C-12
- **Previous ADRs**: ADR-008 (the weight crosses the wire as a decimal
  string — the same fixed-point discipline on the arithmetic rather than the
  wire); ADR-019 (the selection threshold is configuration — the *other*
  threshold in this product, and the same question of who owns it); ADR-036
  (the session is the live state and it is persisted — the session is what
  the zone is computed against); ADR-028 (the station owns its own endpoint
  — the zone is exposed on the station's own path, not on the MES's)
- **Standards**: `standards/tech-stack.md` § "Testing" — *"explicit unit
  tests on tolerance boundary values (93.4 / 93.5 / 94.0 / 94.5 / 94.6 g)
  using the decimal library, to prove fixed-point behaviour at the
  boundaries"*
