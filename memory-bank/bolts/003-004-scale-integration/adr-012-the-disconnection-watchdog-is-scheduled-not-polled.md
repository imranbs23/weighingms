---
bolt: 003-004-scale-integration
created: 2026-10-30T23:40:00Z
status: accepted
superseded_by: null
---

# ADR-012: The disconnection watchdog is scheduled, not polled

## Context

BRD IR-13 requires disconnection to be detected within **2 seconds**:

> **Given** a device has delivered a reading with sequence `n`, **When** no
> reading with a strictly greater sequence number arrives within 2 seconds
> of that reading, **Then** the device is reported as `DISCONNECTED`.

The unit brief makes the rule precise:

> The watchdog runs on the receipt time of the last reading, not on
> wall-clock time polled independently, so that a clock adjustment cannot
> spuriously trip or mask it.

And it requires the boundary to be tested at **three** points: just under
2 s, exactly 2 s, and just over 2 s.

The requirement is on **detection latency**, and that is where the
implementation choice bites. There are two ways to notice that a deadline
has passed.

**Polled** — a timer that wakes periodically and asks "is this device late?".

**Scheduled** — the deadline is computed when the last reading arrives, and a
timer is set to fire at that deadline.

The difference is not academic. With a poll interval of `P`, a device that
goes silent immediately after a reading is detected somewhere between
`2.0 s` and `2.0 s + P` after that reading. To detect "within 2 seconds",
the poll interval has to be small — and the smaller it is, the more the
system is doing work that produces no information.

With a scheduled timer, the callback fires *at* the deadline (within the
timer's accuracy, a few milliseconds), and the detection latency is the
scheduler's accuracy rather than a poll quantum.

The stream runs at **10 Hz** per device, so the natural poll interval is
100 ms — and with polling, the real detection latency would be between
2.000 s and 2.100 s. **That is a requirement violation**, and it is one
that a test written loosely ("wait 2.5 s, assert disconnected") would never
catch.

### The second requirement: the boundary must be testable *exactly*

The story requires tests at just-under, exactly-at and just-over 2 s. A
sleep-based test cannot distinguish 1999 ms from 2000 ms — a `sleep(2000)`
is 2000 ms plus scheduler jitter, plus the time to run the assertion.

The identity unit solved this same problem for authorisation expiry: the
clock is a **port**, and the current time is an **argument** to the policy
rather than something read from an ambient source. `AuthorisationWindow`
was written so its boundary could be tested exactly, with no sleeps and no
fixtures.

The same discipline applies here, and it points at a second decision: **what
is scheduled?**

## Decision

**The watchdog is scheduled. The deadline is computed from the last reading's
receipt time and handed to a scheduler.**

When a reading is accepted at `receivedAt`, the registry:

1. computes the deadline `receivedAt + 2000 ms`,
2. cancels any timer previously scheduled for that device,
3. asks the `WatchdogScheduler` to fire at the deadline.

When the timer fires, the registry evaluates the **pure** `LinkWatchdog`
against the current time. The policy — not the callback — decides whether
the link is `UP` or `DOWN`.

### The split, stated once

> The **scheduler** decides *when to ask*.
> The **policy** decides *the answer*.

This split is what makes the boundary testable exactly. The policy is a pure
function of `(lastActivityAt, now)`:

```text
DOWN  when now − lastActivityAt >  2000
UP    when now − lastActivityAt <= 2000
```

At exactly 2000 ms the link is still `UP` — "within 2 seconds" has not been
exceeded. The boundary is **inclusive**, and it is decided by the policy, so
it does not depend on when the callback happened to run.

### The scheduler is a port

```ts
interface WatchdogScheduler {
  schedule(scaleId: ScaleId, at: Date, callback: () => void): void;
  cancel(scaleId: ScaleId): void;
}
```

Production binds `NodeWatchdogScheduler` (a `setTimeout` per device).
Tests bind `ManualWatchdogScheduler`, which records the scheduled deadline
and fires it only when the test says so, against a `TestClock`.

This is the same pattern as `AuthorisationClock` in the identity unit, and
it is what lets the three boundary tests be **exact** rather than
approximate.

### The reference point

The deadline is computed from the **last reading's receipt time**, not from
a separately polled wall clock, and not from the time the scheduler happened
to be asked. A clock adjustment therefore cannot spuriously trip or mask
the watchdog: the comparison is always between the reading's own timestamp
and the current time.

### Timer hygiene

Only **one** timer is outstanding per device, and a new reading **cancels**
the previous one. A device streaming at 10 Hz would otherwise accumulate
10,000 timers a second.

## Rationale

### Why scheduled, not polled

**1. The requirement is on latency, and polling quantises it.** With a
100 ms poll interval — the interval the stream already runs at — polling
gives a worst-case detection latency of 2.1 s against a 2.0 s requirement.
Polling would require either a much tighter interval (more wake-ups
producing no information) or an acceptance that the requirement is
approximately met.

**2. The boundary test becomes exact rather than approximate.** The
requirement to test at just-under, exactly-at and just-over 2 s is only
meaningful if the implementation can be *at* those points. A polled
implementation cannot be placed at exactly 2000 ms — the poll lands
wherever it lands.

**3. The work is proportional to the events, not to the clock.** A polled
watchdog wakes `2 × 10 Hz × N devices` times a second to answer "has
anything changed?" — almost always no. A scheduled watchdog wakes **once
per disconnection**, which is the event that matters.

### Why the policy decides, not the callback

If the callback decided — "the timer fired, therefore the device is
disconnected" — then the 2 s boundary would be decided by **timer
accuracy**, not by the rule. A timer that fires 5 ms late would trip the
watchdog at 2005 ms, and a test asserting "still `UP` at exactly 2000 ms"
would pass only because the timer happened not to have fired yet.

Putting the decision in the pure policy means:

- the rule has exactly one implementation, and it is a function of its
  arguments;
- the boundary is testable with **no timer at all** — a unit test calls the
  policy with `(lastActivity, now)` and reads the answer;
- the scheduler's accuracy is a **latency** concern, and the rule is a
  **correctness** concern, and the two are no longer entangled.

### Why the reference point is the reading's receipt time

The story requires the gap to be recorded "with its start and end times".
The start of the gap is when the device **stopped being heard from** — which
is the receipt time of its last reading. If the watchdog instead measured
from "when the scheduler was asked", the gap's start would drift by up to
one poll interval on every device, and the recorded gap would be wrong by a
systematic offset.

### Alternatives Considered

| Alternative | Pros | Cons | Why Rejected |
|-------------|------|------|--------------|
| **Scheduled, policy decides** (adopted) | Detection latency is the scheduler's accuracy, not a poll quantum; the boundary is testable exactly; work is proportional to disconnections | Needs a scheduler port and a cancel-on-new-reading discipline | — |
| **Polled at 100 ms** | Simple; no scheduler port | Worst-case detection is 2.1 s against a 2.0 s requirement; the boundary cannot be tested exactly; wakes 20×/s/device to learn nothing | Fails the requirement it exists to satisfy |
| **Polled at 10 ms** | Worst case 2.01 s | Still technically over; 200 wake-ups/second/device; the boundary is still not exactly placeable | Tighter, but still fails, and still burns CPU |
| **Scheduled, and the callback decides** | Simpler — one less layer | The 2 s boundary is decided by timer accuracy, so the rule has two implementations (the policy and the callback) and they can disagree | The rule must have exactly one implementation |
| **Timeout per reading, never cancelled** | Trivial to write | Accumulates 10,000 timers/second/device at 10 Hz; the earliest un-fired timer would fire for a device that is perfectly healthy | A resource leak and a correctness bug |
| **One timer for all devices** | Fewer timers | A single timer must track per-device deadlines and wake for whichever is nearest; more complex, and the cancellation semantics are worse | One timer per device is simpler and scales fine at two devices |

## Consequences

### Positive

- **Detection latency is milliseconds, not a poll interval.** The 2 s
  requirement is met as stated, not approximately.
- **The boundary is exactly testable** — just-under, exactly-at, just-over —
  with no sleeps, using a `TestClock` and a `ManualWatchdogScheduler`.
- The 2 s is a **parameter of the rule**, not a constant buried in a
  callback, so it is stated in one place and can be configured if the
  requirement changes.
- Work is proportional to real events. A healthy device costs **no** timer
  wake-ups.
- The gap's start time is exactly the last reading's receipt time — no
  systematic offset.

### Negative

- **A scheduler port exists** that the identity unit did not need. This is
  the first unit in the product with a deadline, so it is the first to need
  one.
- **Cancellation discipline is required.** Every accepted reading must
  cancel the previous timer for that device. Forgetting it is a resource
  leak and a source of spurious disconnections — a stale timer firing for a
  healthy device would report it `DISCONNECTED` while it is streaming
  perfectly.
- The scheduler is a **source of timing behaviour outside the domain**, so
  the domain's correctness depends on the scheduler firing at all. The
  policy's independence from the scheduler is what keeps this a *latency*
  concern rather than a *correctness* one.

### Risks

- **A stale timer fires for a healthy device** because a cancellation was
  missed. *Mitigation*: the scheduler API makes cancellation explicit and
  per-device, and the acceptance test asserts that a device streaming
  continuously never trips the watchdog.
- **The scheduler drifts under load**, so the callback fires late. *Mitigation*:
  the policy re-evaluates against the **current** time, so a late callback
  still produces the correct answer — it just produces it later. The
  requirement's 2 s is a latency target, and this bounds the latency, not
  the answer.
- **A future unit needs its own deadline** and copies the polling approach
  because it is simpler. *Mitigation*: this ADR is in the decision index with
  a "Read when" field naming the watchdog, deadlines and timeouts.

## Related

- **Stories**: 002-detect-disconnection-and-block-weighing (this bolt);
  001-receive-live-weight-stream (the sequence the watchdog observes)
- **Requirements**: FR-19, BRD IR-13, BRD IR-10, BRD NFR-01
- **Standards**: `units/004-scale-integration/unit-brief.md` § Disconnection
  detection — the 2 s rule and the three boundary test points
- **Previous ADRs**: none directly; the "clock as a port, time as an
  argument" pattern is the identity unit's `AuthorisationClock`, established
  in bolt `002`
