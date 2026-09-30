// The one place that decides a guest may not do something, and asks them to
// log in or create an account instead.
//
// A guest is an anonymous Firebase session ("Continue as guest" on the login
// screen). Guests may browse, but they may never BUY: Vergr does not sell to
// anonymous customers (AML policy, and our answer to payment partners). So
// every purchase entry point calls blockGuestPurchase() BEFORE any payment
// sheet opens, which is far better than refusing after someone has paid.
//
// Plain functions, no React: nativeBilling.js and the cart are not components.
// <GuestSignupPrompt /> (mounted once in AppRouter) listens for the event.
import { auth } from '../firebase/config';
import { blockUnverified } from './emailGate';

export const GUEST_PROMPT_EVENT = 'vergr-guest-prompt';

export function dispatchGuestPrompt(actionLabel, kind = null) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(GUEST_PROMPT_EVENT, {
    detail: { actionLabel: actionLabel || 'do that', kind },
  }));
}

export function isGuestSession() {
  return !!auth.currentUser?.isAnonymous;
}

/**
 * True (and the right prompt is shown) when the current session may not buy:
 * a guest, or (since 2026-09-29) an account whose email is not verified.
 * Every purchase entry point already calls this, so both rules sit in one place.
 */
export function blockGuestPurchase() {
  if (isGuestSession()) {
    dispatchGuestPrompt('buy', 'purchase');
    return true;
  }
  return blockUnverified('buy');
}
