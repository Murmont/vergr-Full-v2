// useAdminAccess — resolves whether the current user can use the admin
// dashboard and which screens they're allowed to see.
//
// Founder (`profile.role === 'admin'`) always returns allowedScreens: ['*'].
// Sub-admins are looked up live in `admin_users/{uid}`; we subscribe to that
// doc so revoke / scope changes propagate without a refresh.
//
// Returns:
//   {
//     loading:        bool,
//     isAdmin:        bool,
//     isFounder:      bool,
//     allowedScreens: string[],   // ['*'] for founder
//     can(screen):    (string) => bool,
//   }

import { useEffect, useState, useMemo, useCallback } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { useUser } from '../context/UserContext';

export default function useAdminAccess() {
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const [subAdminDoc, setSubAdminDoc] = useState(undefined); // undefined = not loaded
  // The Operator (Vergr Admin) has NO users document, so it can never be
  // recognised by a profile field. Its authority is a Firebase Auth custom
  // claim, read straight off the ID token the client already holds — no
  // network call, no Firestore read. Only the Admin SDK can set it.
  const [isOperator, setIsOperator] = useState(false);
  useEffect(() => {
    let live = true;
    if (!currentUser) { setIsOperator(false); return undefined; }
    currentUser.getIdTokenResult()
      .then((r) => { if (live) setIsOperator(r?.claims?.operator === true); })
      .catch(() => { if (live) setIsOperator(false); });
    return () => { live = false; };
  }, [currentUser]);

  const isFounder = isOperator || profile?.role === 'admin';

  useEffect(() => {
    // Founders and the Operator don't need the sub-admin doc.
    if (!currentUser?.uid || isFounder) {
      setSubAdminDoc(null);
      return;
    }
    const unsub = onSnapshot(
      doc(db, 'admin_users', currentUser.uid),
      (snap) => setSubAdminDoc(snap.exists() ? snap.data() : null),
      () => setSubAdminDoc(null),
    );
    return unsub;
  }, [currentUser?.uid, isFounder]);

  const loading = !!currentUser?.uid && !isFounder && subAdminDoc === undefined;

  const allowedScreens = useMemo(() => {
    if (isFounder) return ['*'];
    if (!subAdminDoc || subAdminDoc.status !== 'active') return [];
    return subAdminDoc.allowedScreens || [];
  }, [isFounder, subAdminDoc]);

  const isAdmin = isFounder || allowedScreens.length > 0;

  const can = useCallback((screen) => {
    if (!isAdmin) return false;
    if (allowedScreens.includes('*')) return true;
    return allowedScreens.includes(screen);
  }, [isAdmin, allowedScreens]);

  return { loading, isAdmin, isFounder, isOperator, allowedScreens, can };
}
