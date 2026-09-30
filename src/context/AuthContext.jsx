import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { auth, googleProvider, db, rtdb } from '../firebase/config';
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPopup, signInWithRedirect, signOut, sendPasswordResetEmail, updateProfile,
  signInAnonymously, EmailAuthProvider, linkWithCredential, getAdditionalUserInfo,
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp as firestoreTimestamp } from 'firebase/firestore';
import { ref, onValue, set, serverTimestamp as rtdbTimestamp } from 'firebase/database';
import { isDesktopApp, isMobileApp } from '../utils/platform';
import { desktopGoogleAuth } from '../utils/desktopAuth';
import { unregisterPushTokens } from '../utils/pushNotifications';
import { currentAppGate } from '../hooks/useAppGate';

// ── "Allow new registrations" (Admin → App Config) ─────────────────────────
// Enforced HERE, in the auth layer, so every way of creating an account is
// covered by one check: email sign-up, converting a guest, and Google (which
// creates an account the first time it is used). Guests are not registrations
// and are not blocked; "Allow guest browsing" was never a real switch.
//
// ⚠ The decision uses the live app_config listener (useAppGate), so it costs no
// read. Before UNDOING a Google account we re-read the doc once, because
// deleting someone's brand-new account on a stale cached value would be worse
// than letting one through.
//
// ⚠ This is the client half. A script calling the Firebase Auth REST API
// directly is not stopped by it; the server half would cost one read per new
// account (founder decision, not taken).
function signupsPausedError() {
  const e = new Error('New sign-ups are paused right now.');
  e.code = 'vergr/signups-paused';
  return e;
}
function assertRegistrationsOpen() {
  if (!currentAppGate().registrationsOpen) throw signupsPausedError();
}
async function registrationsClosedConfirmed() {
  if (currentAppGate().registrationsOpen) return false;
  try {
    const snap = await getDoc(doc(db, 'app_config', 'general'));
    return snap.exists() && snap.data()?.allowNewRegistrations === false;
  } catch { return false; }
}
// A Google sign-in that just CREATED an account while sign-ups are paused is
// undone: the Auth user is deleted (onUserDeleted cleans the seeded docs).
async function undoIfNewAccountWhilePaused(cred) {
  if (!cred?.user || cred.user.isAnonymous) return;
  if (!getAdditionalUserInfo(cred)?.isNewUser) return;
  if (!(await registrationsClosedConfirmed())) return;
  try { await cred.user.delete(); } catch { await signOut(auth).catch(() => {}); }
  throw signupsPausedError();
}


const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setLoading(false);
      // The phone's Google sign-in is a REDIRECT, so no credential comes back
      // to loginWithGoogle to check. An account created seconds ago, while
      // sign-ups are paused, is undone here instead. The login screen reads the
      // session flag and says why.
      if (user && !user.isAnonymous && !currentAppGate().registrationsOpen) {
        const created = Date.parse(user.metadata?.creationTime || '') || 0;
        const fresh = created > 0 && Date.now() - created < 2 * 60 * 1000
          && user.metadata?.creationTime === user.metadata?.lastSignInTime;
        if (fresh) {
          registrationsClosedConfirmed().then((closed) => {
            if (!closed) return;
            try { sessionStorage.setItem('vergr.signupsPaused', '1'); } catch { /* ignore */ }
            user.delete().catch(() => signOut(auth).catch(() => {}));
          });
        }
      }
      // DO NOT signal the native splash here. Auth resolving only unblocks the
      // ROUTER; the screen itself is a lazy chunk behind <Suspense>, so at this
      // instant there is still nothing painted. Signalling here dismissed the
      // splash onto an empty WebView — measured as 200ms of black then 150ms of
      // the bare body colour on a cold start. The signal now fires from
      // <SplashHandoff> in AppRouter, which mounts only once the real screen is
      // on screen. See utils/nativeSplash.js.
      // I4: let clientTelemetry attribute captured errors to the signed-in user.
      try { window.__VERGR_UID__ = user?.uid || null; } catch {}

      if (user) {
        const userStatusDatabaseRef = ref(rtdb, '/status/' + user.uid);
        const userFirestoreRef = doc(db, 'users', user.uid);
        const connectedRef = ref(rtdb, '.info/connected');

        // Presence = heartbeat + freshness window (usePresence + utils/presence
        // isStatusOnline, 3-min window). On every (re)connect we write `online`;
        // the usePresence heartbeat keeps `last_changed` fresh while the app is
        // open. We DELIBERATELY do NOT arm an `onDisconnect → offline` write:
        // on mobile the RTDB socket drops on every background/Doze/network blip,
        // and onDisconnect then wrote a FRESH `offline` that the freshness
        // window could not override, leaving native users stuck "offline" while
        // actually present. When the app closes/backgrounds the heartbeat stops,
        // `last_changed` goes stale, and readers show offline on their own — no
        // server-side offline write needed. (The old `.info/connected===false →
        // status:offline` Firestore write was also dropped: the client JS is
        // frozen while backgrounded so it never ran anyway, and on a transient
        // foreground blip it falsely flipped the user offline.)
        onValue(connectedRef, (snapshot) => {
          if (snapshot.val() === false) return; // can't write while disconnected
          set(userStatusDatabaseRef, {
            state: 'online',
            last_changed: rtdbTimestamp(),
          });
          updateDoc(userFirestoreRef, {
            status: 'online',
            lastSeen: firestoreTimestamp(),
          }).catch(() => {});
        });
      }
    });

    return () => unsub();
  }, []);

  const login = useCallback(async (email, password) => {
    return signInWithEmailAndPassword(auth, email, password);
  }, []);

  const signUp = useCallback(async (email, password, displayName) => {
    assertRegistrationsOpen();
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName) {
      await updateProfile(cred.user, { displayName });
    }
    return cred;
  }, []);

  const loginWithGoogle = useCallback(async () => {
    // Desktop shell: signInWithPopup can't open a browser popup — use the
    // localhost OAuth bridge (tiny_http + signInWithCredential).
    if (isDesktopApp()) {
      const cred = await desktopGoogleAuth();
      await undoIfNewAccountWhilePaused(cred);
      return cred;
    }
    // Mobile shell (Android/iOS WebView): popups are blocked, so use the
    // redirect flow; onAuthStateChanged picks up the result on return (and
    // applies the paused-sign-ups check there, see below).
    // TODO(native-auth): replace with a native Custom Tabs / ASWebAuth bridge
    // (mirror desktopAuth.js) for a cleaner in-app experience.
    if (isMobileApp()) {
      return signInWithRedirect(auth, googleProvider);
    }
    const cred = await signInWithPopup(auth, googleProvider);
    await undoIfNewAccountWhilePaused(cred);
    return cred;
  }, []);

  const logout = useCallback(async () => {
    // Intentional sign-out: write offline NOW so observers don't see a ghost
    // "online" for the ~3-min freshness grace. Best-effort (don't block logout).
    const uid = auth.currentUser?.uid;
    if (uid) {
      // NEVER await these unbounded. The RTDB socket does not connect inside
      // the native Android WebView, and an RTDB set() with no connection
      // returns a promise that stays PENDING forever — it never rejects, so a
      // try/catch does not save you. Awaiting it meant signOut() below was
      // never reached and sign-out was silently dead on native, on every
      // button, because all four call sites go through here.
      // Signing out must always win, so the writes get a hard deadline.
      //
      // Unregistering this device's push tokens rides the SAME deadline, and it
      // matters more than the presence write. Tokens were only ever added
      // (arrayUnion) and never removed, so every device an account had ever
      // signed in on stayed subscribed forever: an old phone or a shared
      // computer kept receiving that account's DMs after sign-out, with no way
      // for the user to stop it. Only THIS device's tokens are removed, so
      // other devices the user is still signed in on keep working.
      const deadline = new Promise((resolve) => setTimeout(resolve, 1200));
      await Promise.race([
        Promise.allSettled([
          set(ref(rtdb, '/status/' + uid), { state: 'offline', last_changed: rtdbTimestamp() }),
          updateDoc(doc(db, 'users', uid), { status: 'offline' }),
          unregisterPushTokens(uid),
        ]),
        deadline,
      ]);
    }
    return signOut(auth);
  }, []);

  const resetPassword = useCallback(async (email) => {
    return sendPasswordResetEmail(auth, email);
  }, []);

  // ─── Guest mode ───────────────────────────────────────────────────────
  // Anonymous Firebase Auth → temporary uid → read-only browsing. Lets
  // reviewers (Cryptomus, processors, app-store) and curious visitors
  // experience the app without the DOB+ToS+KYC funnel. They can convert
  // to a permanent account at any time via `convertGuestToAccount()`
  // which preserves their uid through Firebase's `linkWithCredential`.
  const signInAsGuest = useCallback(async () => {
    const cred = await signInAnonymously(auth);
    // Create a minimal user doc so the rest of the app's
    // profile-dependent UI doesn't break. UserContext fills in the
    // sensible defaults; we just mark this account as a guest.
    try {
      await setDoc(doc(db, 'users', cred.user.uid), {
        isGuest: true,
        guestCreatedAt: firestoreTimestamp(),
        displayName: 'Guest',
        username: `guest_${cred.user.uid.slice(0, 6)}`,
        // No DOB, no ToS acceptance, no KYC — guests cannot reach any
        // gated feature.
      }, { merge: true });
    } catch (e) {
      console.warn('[guest] failed to seed user doc, continuing anyway', e);
    }
    return cred;
  }, []);

  // Upgrade an anonymous user to a permanent email/password account
  // while preserving their uid (and any data they may have generated
  // before conversion, e.g. follows). Throws if the current user is
  // not anonymous.
  const convertGuestToAccount = useCallback(async (email, password, displayName) => {
    const u = auth.currentUser;
    if (!u || !u.isAnonymous) {
      throw new Error('No anonymous user to convert.');
    }
    // Turning a guest into a real account IS a registration.
    assertRegistrationsOpen();
    const credential = EmailAuthProvider.credential(email, password);
    const linkedCred = await linkWithCredential(u, credential);
    if (displayName) {
      try { await updateProfile(linkedCred.user, { displayName }); } catch {}
    }
    // Flip the guest flag on the user doc — the same uid stays valid.
    try {
      await updateDoc(doc(db, 'users', linkedCred.user.uid), {
        isGuest: false,
        // No email: users/{uid} is publicly listable. The address is on the Auth account.
        displayName: displayName || null,
        convertedFromGuestAt: firestoreTimestamp(),
      });
    } catch (e) {
      console.warn('[guest] failed to flip isGuest flag, will retry on next write', e);
    }
    return linkedCred;
  }, []);

  const value = {
    currentUser, loading,
    login, signUp, loginWithGoogle, logout, resetPassword,
    signInAsGuest, convertGuestToAccount,
    isAnonymous: !!currentUser?.isAnonymous,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
