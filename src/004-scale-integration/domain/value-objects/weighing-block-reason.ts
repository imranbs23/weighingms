/**
 * WeighingBlockReason — a named reason a weighing may not proceed.
 *
 * A CLOSED SET. The story requires the refusal to name the reason ("a
 * stated reason identifies the scale as disconnected"), so the reason is
 * DATA rather than prose assembled at the call site.
 *
 * WHY THIS UNIT HAS NO UNIFORM REFUSAL, unlike ADR-004
 * ------------------------------------------------------
 * ADR-004 made every authorisation refusal return one identical body,
 * because a distinguishable response is an enumeration oracle over
 * supervisor identities. A supervisor's credential is SECRET.
 *
 * A scale's state is not secret. The operator can see the scale in front
 * of them. Distinguishing "disconnected" from "calibration expired" is
 * not an information leak — it is the entire point, because the story
 * REQUIRES the named reason. A single opaque body would defeat a stated
 * acceptance criterion.
 *
 * The distinction: ADR-004 protects an identity; this unit reports a
 * device's state, which the operator already knows.
 */
export type WeighingBlockReason =
  | 'SCALE_DISCONNECTED'
  | 'SCALE_NOT_RESPONDING'
  | 'CALIBRATION_EXPIRED'
  | 'OVER_CAPACITY'
  | 'SCALE_BUSY';
