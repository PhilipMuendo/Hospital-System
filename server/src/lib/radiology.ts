/**
 * Radiation safety.
 *
 * Before an ionising exposure (X-ray, CT, mammography, fluoroscopy) on anyone
 * who could be pregnant, the pregnancy question must be asked and the answer
 * recorded. Ultrasound and MRI use no ionising radiation and need no check.
 *
 * The childbearing-potential window is deliberately generous at both ends.
 * A narrow window would skip the check on someone who falls just outside it,
 * and the cost of an unnecessary question is a few seconds, while the cost of
 * a missed one is a fetal dose that cannot be taken back.
 */

export const CHILDBEARING_MIN_AGE = 10
export const CHILDBEARING_MAX_AGE = 60

export function ageFrom(dob: Date, now = new Date()): number {
  let age = now.getFullYear() - dob.getFullYear()
  const monthDiff = now.getMonth() - dob.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age--
  return age
}

export function needsPregnancyCheck(
  procedure: { ionising: boolean },
  patient: { sex: string; dob: Date | string },
  now = new Date(),
): boolean {
  if (!procedure.ionising) return false
  // Males are excluded; intersex patients are included, because the anatomy
  // cannot be assumed from the field and the question is cheap.
  if (patient.sex === 'MALE') return false

  const dob = patient.dob instanceof Date ? patient.dob : new Date(patient.dob)
  if (Number.isNaN(dob.getTime())) return true // unknown age: ask anyway

  const age = ageFrom(dob, now)
  return age >= CHILDBEARING_MIN_AGE && age <= CHILDBEARING_MAX_AGE
}
