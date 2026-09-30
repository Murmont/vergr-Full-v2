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

// The event channel lives in utils/guestPrompt.js so non-React code (the
// cart, native billing, web checkout) can raise the same prompt.
import { GUEST_PROMPT_EVENT, dispatchGuestPrompt } from '../utils/guestPrompt';
export { GUEST_PROMPT_EVENT, dispatchGuestPrompt };

export default function useGuestGate() {
  const { isGuest } = useUser();

  const requireSignup = useCallback((actionLabel) => {
    if (!isGuest) return true;
    dispatchGuestPrompt(actionLabel);
    return false;
  }, [isGuest]);

  return { isGuest, requireSignup };
}
