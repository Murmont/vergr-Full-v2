// Maps raw Firebase Auth error codes to human copy so users never see
// "Firebase: Error (auth/wrong-password)". Used by Login / Signup / password
// reset. Falls back to a generic line for unmapped codes (never the raw code).
const MAP = {
  'auth/invalid-email': 'That email address looks invalid.',
  'auth/user-disabled': 'This account has been disabled. Contact support if this is a mistake.',
  'auth/user-not-found': 'No account found for that email — try signing up.',
  'auth/wrong-password': 'Wrong email or password. Try again or reset your password.',
  'auth/invalid-credential': 'Wrong email or password. Try again or reset your password.',
  'auth/invalid-login-credentials': 'Wrong email or password. Try again or reset your password.',
  'auth/too-many-requests': 'Too many attempts. Wait a minute, then try again (or reset your password).',
  'auth/email-already-in-use': 'That email is already registered — sign in instead.',
  'auth/weak-password': 'Choose a stronger password (at least 6 characters).',
  'auth/network-request-failed': 'Network error — check your connection and try again.',
  'auth/popup-closed-by-user': 'Sign-in was cancelled.',
  'auth/cancelled-popup-request': 'Sign-in was cancelled.',
  'auth/popup-blocked': 'Your browser blocked the sign-in popup — allow popups and retry.',
  'auth/account-exists-with-different-credential': 'An account already exists with this email using a different sign-in method.',
  'auth/requires-recent-login': 'Please sign in again to complete this action.',
  // Ours, not Firebase's: Admin → App Config → "Allow new registrations" is off.
  'vergr/signups-paused': 'New sign-ups are paused right now. Existing accounts can still sign in. Please try again later.',
};

export function authErrorMessage(err, fallback = 'Something went wrong. Please try again.') {
  const code = err?.code || '';
  if (code && MAP[code]) return MAP[code];
  // Some errors carry the code inside the message string, e.g. "Firebase: Error (auth/wrong-password)."
  const m = String(err?.message || '');
  const match = m.match(/\(auth\/[a-z-]+\)/i);
  if (match) {
    const inner = match[0].slice(1, -1);
    if (MAP[inner]) return MAP[inner];
  }
  return fallback;
}
