/**
 * TareMechanism — where the tare was APPLIED.
 *
 * A CLOSED SET, so the mechanism is DATA rather than prose.
 *
 * BRD IR-12 and BRD FR-19 require this to be recorded: where the
 * indicator does not support a tare command, the tare is applied in
 * software and the recorded source must state so.
 *
 * WHY IT IS RECORDED BUT NOTHING ACTS ON IT
 * ------------------------------------------
 * ADR-014 decided that the tare is applied at the DEVICE, so that every
 * consumer sees the same net reading and none of them has to know which
 * path was taken. That is precisely why this field is informational: it
 * exists because the story requires it, and no consumer above the adapter
 * branches on it. A future adapter that supports a real tare command
 * returns `INDICATOR` and changes NOTHING above the adapter.
 *
 * The training device has no tare command at all (Q-03 — the indicator's
 * protocol is unconfirmed), so the Dummy adapter always applies the tare
 * in software and reports `SOFTWARE`.
 */
export type TareMechanism = 'INDICATOR' | 'SOFTWARE';
