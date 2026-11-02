/**
 * LinkState — whether the device is being heard from.
 *
 * ADR-011: this is a SEPARATE AXIS from the published `ScaleStatus`.
 *
 *   UNKNOWN — registered, but has never delivered a reading
 *   UP      — a reading was accepted within the 2 s window
 *   DOWN    — the watchdog tripped
 *
 * The distinction that matters is `UNKNOWN` vs `DOWN`. Both publish as
 * `DISCONNECTED` — to the operator a scale that has never spoken and a
 * scale that has gone quiet are the same fact: it is not there. But they
 * are different facts in the evidence, so the gate names them differently
 * (`SCALE_NOT_RESPONDING` vs `SCALE_DISCONNECTED`) and only `UP → DOWN`
 * records a disconnection gap, because a device that never spoke has no
 * start time.
 */
export type LinkState = 'UNKNOWN' | 'UP' | 'DOWN';
