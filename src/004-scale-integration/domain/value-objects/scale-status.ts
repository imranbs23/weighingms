/**
 * ScaleStatus — the operator-facing device state.
 *
 * EXACTLY ONE at a time — not a bag of flags. The prototype's status
 * strip shows one state per scale ("SCALE 3 kg · READY"), and a strip
 * that could show a scale as simultaneously READY and DISCONNECTED would
 * be showing the operator two contradictory facts.
 *
 * WHO PRODUCES EACH VALUE
 * ------------------------
 *   CONNECTED     — the link is up and the device is healthy
 *   DISCONNECTED  — the link is DOWN or UNKNOWN (we conclude this; the
 *                   device cannot report it, it is not there)
 *   ZEROED        — the device reports it; it is READINESS, not a fault
 *   BUSY          — the device reports it
 *   OVER_CAPACITY — the device reports it
 *
 * ADR-010: `ZEROED` does NOT block weighing. A tared scale is zeroed, and
 * tare exists to enable the weighing — read literally, "only CONNECTED
 * may proceed" would make a correctly prepared station refuse its
 * weighing.
 */
export type ScaleStatus = 'CONNECTED' | 'DISCONNECTED' | 'ZEROED' | 'BUSY' | 'OVER_CAPACITY';
