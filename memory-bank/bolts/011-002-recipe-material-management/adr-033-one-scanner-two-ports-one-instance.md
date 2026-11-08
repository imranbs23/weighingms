---
bolt: 011-002-recipe-material-management
created: 2026-11-06T00:30:00Z
status: accepted
---

# ADR-033: One scanner, two ports, one instance

## Context

The station has **one** barcode scanner, and three things are read through it:

1. the **batch card** — unit `001`, already built (bolt 009);
2. the **dyestuff code** — this bolt, story 002;
3. the **lot code** — this bolt, story 003.

The workbook requires a Dummy Scanner with `POST /api/scan`, and unit `001`
already owns it: a `BatchScanner` port, a `DummyBatchScanner` adapter, and
the binding in the composition root.

So unit `002` now needs to read through the same physical device. The
question is **how**, and the naive answer creates a problem the codebase has
already learned to recognise.

**The naive shape.** Unit `002` declares its own scanner port — because a
port belongs to its consumer — and provides its own adapter, with its own
device state. That gives:

- **two device instances** that are really one;
- **two sources of truth** for *"what was just scanned"*;
- **two adapters** to keep in step, and a station where the batch card and
  the dyestuff code go to different places;
- a **training artefact** (`POST /api/scan`) with two backends behind it,
  and therefore two things that can drift from the workbook.

**The alternative shape.** Unit `002` reuses unit `001`'s `BatchScanner`
port directly. That makes unit `002` depend on unit `001`'s *port* — and
`BatchScanner` is named for batches, so reading a dyestuff code through it
is a lie in the type's name. Worse, it would make the domain rules of one
unit reachable from another unit's namespace.

**And the units.md problem.** `units.md` says unit `002` depends on unit
`001` (the recipe load) and unit `001` depends on unit `002` (the recipe
load on selection). A **narrow cycle**, which the same file resolves: *"the
recipe load is a single cross-unit call owned by unit 002 and invoked by
unit 001 — not by splitting the recipe's data."*

The scanner must not become a **second** cycle.

## Decision

**One device, two ports, one instance.**

1. **Unit `002` declares its own port, `DyestuffScanner`**, with the shape
   it needs. A port belongs to its consumer (ADR-028), and unit `002` must
   not reach into unit `001`'s namespace to read a material code.

2. **The composition root binds BOTH ports to the SAME
   `DummyBatchScanner` instance.** One device, one state, one training
   artefact behind `POST /api/scan`.

3. **The device is shared; the ports are per-consumer.** Unit `001` resolves
   its code against the released queue; unit `002` resolves its code against
   the recipe's component, and the lot path against the lot master. **No
   unit imports another's port**, and no unit's domain rules are reachable
   from another's namespace.

4. **The device's outcome carries ONLY a code.** It does not say whether
   the code was a batch, a material or a lot. **The classification is the
   consumer's job** — and a code that matches none of them is a **refusal
   naming what was expected**, not a device error. The device read a code
   perfectly well; it did not read *our* code.

5. **A read is CONSUMED.** The device forgets a code after it is read, so one
   card cannot satisfy two reads. That is the device's behaviour, and it is
   already how `DummyBatchScanner` behaves.

## Rationale

### Why not one adapter per unit

The duplication is the hazard, and it is the same hazard ADR-028 refused for
the MES seam: **two readers of one seam, two contacts, two caches, two
sources of truth.** A second scanner adapter is a second reader of one
device, and the failure is the same shape — two devices that disagree about
what was just scanned, and nothing in the system that can say which is
right.

And the workbook's rule is explicit: the Dummy APIs are **training
contracts** that must be *independently exercisable*. Two backends behind
one `POST /api/scan` is not one training artefact — it is two, and the
workbook asked for one.

### Why not reuse unit `001`'s port

Because the port's name is a promise about what it carries, and a
dyestuff code is not a batch. A port named `BatchScanner` that returns
dyestuff codes would make every call site lie, and the lie would be
permanent — the name would have to change, and the change would ripple into
the unit that owns it.

The hexagonal rule is the same one the codebase already applies everywhere
else: **a port belongs to the unit that depends on it.** Unit `005` owns
`OrgatexAdapter` because it is the *only* unit that talks to the MES. Unit
`001` owns `BatchQueueSource` for the same reason. Here, **two** units
depend on the scanner, so **two** ports are right — and the *device* behind
them is one.

### Why the outcome carries no classification

Because the device **cannot know**. A barcode is a string of characters; what
it means is the business's business. The scanner reports *"this is the code
that was presented"*, and each consumer decides what a code means:

- unit `001` looks it up in the released queue;
- unit `002`'s identity path looks it up against the recipe's component;
- unit `002`'s lot path looks it up against the lot master.

**And this is what makes an unrecognised code a good refusal rather than a
bad outcome.** The device succeeded — it read a code. The *business* could
not place it. So the refusal says *"that code names no batch in the released
queue"*, or *"that code is not the DYE-4471 this component requires"* — a
**specific** reason the operator can act on — and it is not the scanner's
fault.

### Why the classification does not create a cycle

It does not, because **no unit imports another unit's port**. Unit `001`
and unit `002` each declare their own; the composition root — which is not
a unit — binds both to one instance. The dependency edge that matters is
`001 → 002` for the recipe load, and it is unchanged.

### Why the device state is shared rather than copied

The device's state is *"what was presented to the scanner"*. If there were
two states, then a card presented once could be read by one unit and not the
other — and which one got it would depend on which adapter was asked first.
The operator would see a scan consumed for the batch card and a "no code" for
the dyestuff, with nothing to explain the difference.

One state means one physical act is one physical act.

## Consequences

### Positive

- **One device, one state, one training artefact.** `POST /api/scan` has one
  backend, and the workbook's rule holds.
- **Each unit's port says what that unit reads.** No lie in a type's name.
- **A second device is visible in one place.** The composition root is the
  single place either port is bound, so a second scanner adapter would be
  visible there — the same argument ADR-028 made for the MES seam.
- **An unrecognised code is a specific refusal**, not a device error.
- **No cycle.** Neither unit imports the other's port.

### Negative

- **The composition root knows about two units' scanners.** It binds
  `batches.scanner` and `recipes.scanner` to the same instance, so a reader
  of that file sees unit `001` and unit `002` together. That is the point of
  a composition root — it is the one place the whole station's outbound
  surface is visible.
- **The device is shared, so a read by one unit consumes it for the other.**
  That is **correct** — one card is one card — but it means a test that
  reads the scanner for a material must not expect a second read to return
  the same code.
- **The scanner's contract is still unconfirmed** (Q-03), and a real scanner
  replaces the adapter without touching the domain.

### Risks

- **A future agent gives unit `002` its own adapter and its own device
  instance** — "it is cleaner to have one adapter per unit". *Mitigation*:
  this ADR names the duplication mechanism, and the decision index's "Read
  when" points here for anyone about to add a scanner.
- **A future agent adds the code's *type* to the scanner's outcome**, so the
  device says "batch" or "material". *Mitigation*: the same index entry. The
  device cannot know, and a device that guesses is a device that will guess
  wrong for the code it has not seen.
- **A future agent binds the two ports to **different** instances**,
  believing that is "safer isolation". *Mitigation*: the same index entry,
  and this ADR's argument that two devices are two sources of truth.

## Related

- **Stories**: `002-verify-dyestuff-identity-by-scan-or-attestation`,
  `003-capture-and-validate-dyestuff-lot`
- **Requirements**: FR-4, FR-5 · BRD FR-09, FR-10, FR-19, FR-25 · BRD IR-15,
  IR-18 · B-6
- **Previous ADRs**: ADR-028 (the port belongs to the consumer — the rule
  this ADR applies to the scanner); ADR-030 (the method is derived from the
  request's shape — the rule this ADR applies to the identity's and the
  lot's methods); ADR-029 (the append-only record — the rule this bolt's
  two tables inherit); ADR-022 (the transport is not exercised by the
  tests — the same "the far side's contract is unconfirmed" reasoning)
- **Standards**: `standards/tech-stack.md` § "API shape" — the Dummy
  Scanner's `POST /api/scan`, the one training contract behind both ports
