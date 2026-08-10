// useGuestGate — intercepts user actions when the current user is a
// guest (anonymous Firebase Auth user). The pattern:
//
//   const { requireSignup } = useGuestGate();
//   ...
//   const handleLike = () => {
//     if (!requireSignup('like posts')) return;
//     // ...real like logic
//   };
//
// requireSignup returns `true` when the user is a real account (proceed),
// and `false` when the user is a guest (a global Sign-Up prompt has been
// dispatched and the caller should bail).

import { useCallback } from 'react';
import { useUser } from '../context/UserContext';

// Event name used to bubble the prompt up to <GuestSignupPrompt /> at
// the app root. Using a custom-event channel avoids coupling every
// action site to a portal/modal context.
export const GUEST_PROMPT_EVENT = 'vergr-guest-prompt';

export function dispatchGuestPrompt(actionLabel) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(GUEST_PROMPT_EVENT, {
    detail: { actionLabel: actionLabel || 'do that' },
  }));
}

export default function useGuestGate() {
  const { isGuest } = useUser();

  const requireSignup = useCallback((actionLabel) => {
    if (!isGuest) return true;
    dispatchGuestPrompt(actionLabel);
    return false;
  }, [isGuest]);

  return { isGuest, requireSignup };
}
