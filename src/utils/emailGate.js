// The one place that decides an account must verify its email first
// (founder, 2026-09-29: every account, existing ones included).
//
// An unverified account may browse, like and follow, but may not post, comment,
// message or buy. The REAL boundary is server-side and costs no reads:
// firestore.rules, the chat relay and checkout all read Firebase Auth's own
// `email_verified` claim off the ID token. This file is the client courtesy that
// explains it BEFORE a write fails, and it reads the in-memory Auth user, so it
// costs nothing either.
//
// Guests (anonymous sessions) are handled by guestPrompt.js, not here.
//
// Plain functions, no React: nativeBilling.js and the chat relay are not
// components. <VerifyEmailPrompt /> (mounted once in AppRouter) listens.
import { auth } from '../firebase/config';

export const VERIFY_PROMPT_EVENT = 'vergr-verify-email-prompt';

/** True when the signed-in, non-guest account has not verified its email. */
export function needsEmailVerification() {
  const u = auth?.currentUser;
  if (!u || u.isAnonymous) return false;
  return !u.emailVerified;
}

export function dispatchVerifyPrompt(actionLabel) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(VERIFY_PROMPT_EVENT, {
    detail: { actionLabel: actionLabel || 'do that' },
  }));
}

/**
 * Call BEFORE the action. Returns true (and shows the prompt) when the account
 * must verify first, so callers read `if (blockUnverified('post')) return;`.
 */
export function blockUnverified(actionLabel) {
  if (!needsEmailVerification()) return false;
  dispatchVerifyPrompt(actionLabel);
  return true;
}

/** A server or relay refusal that means "verify your email". */
export function isUnverifiedError(errOrReason) {
  const s = typeof errOrReason === 'string'
    ? errOrReason
    : String(errOrReason?.message || errOrReason?.code || '');
  return s.includes('email_unverified') || s.includes('verify-email');
}

/**
 * After verifying: pull the new Auth state and a fresh ID token, so the
 * database rules and checkout see `email_verified` at once rather than within
 * the hour a token normally lives.
 */
export async function refreshAfterVerification() {
  const u = auth?.currentUser;
  if (!u) return false;
  try { await u.reload(); } catch { /* offline: the token refresh below still tries */ }
  try { await u.getIdToken(true); } catch { /* next scheduled refresh picks it up */ }
  return !!auth.currentUser?.emailVerified;
}
