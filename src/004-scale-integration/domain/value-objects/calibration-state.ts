/**
 * CalibrationState — a device property, reported by the device.
 *
 * FR-7, AC-14: weighing is prevented on a scale whose calibration has
 * expired, and a valid calibration is reported as `IN_CALIBRATION`
 * together with the expiry date it was read from.
 *
 * A device whose calibration CANNOT be read is treated as `EXPIRED`. This
 * is the same principle as S-1 applied to calibration: the absence of
 * evidence is not evidence of health. A scale that cannot tell us whether
 * it is calibrated must not be weighed on — the failure is silent, and it
 * would produce a weight that nobody can defend.
 */
export type CalibrationState =
  | { readonly kind: 'IN_CALIBRATION'; readonly expiresAt: Date }
  | { readonly kind: 'EXPIRED' };
