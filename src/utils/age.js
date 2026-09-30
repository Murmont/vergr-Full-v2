// Age from a self-declared date of birth ("YYYY-MM-DD"). ONE definition for
// email sign-up (SignUpStep1) and the AgeTermsGate every other sign-up passes.
// Vergr is 18+.

export const MIN_AGE = 18;

export function computeAge(dobStr) {
  if (!dobStr) return null;
  const dob = new Date(dobStr);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

/** The latest date of birth that is old enough, for a date input's `max`. */
export const latestAdultDob = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - MIN_AGE);
  return d.toISOString().slice(0, 10);
};
