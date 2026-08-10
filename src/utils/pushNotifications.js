import { getToken, onMessage } from 'firebase/messaging';
import { doc, setDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, messaging, functions } from '../firebase/config';
import { isMobileApp } from './platform';

// Subscribe this device's FCM token to the platform "announcements" topic so
// @Vergr broadcasts reach it (server-side subscribe; works for web + native
// tokens). Fire-and-forget — a failure just means no announcement pushes.
async function subscribeAnnouncementsTopic(token) {
  if (!token || !functions) return;
  try { await httpsCallable(functions, 'subscribeAnnouncements')({ token }); } catch {}
}

async function unsubscribeAnnouncementsTopic(token) {
  if (!token || !functions) return;
  try { await httpsCallable(functions, 'unsubscribeAnnouncements')({ token }); } catch {}
}

// ⚠️ REPLACE THIS with your VAPID key from Firebase Console:
// Project Settings → Cloud Messaging → Web Push certificates → Generate key pair
const VAPID_KEY = 'BMOTYWH_CfCg034xbbMHyc1vNMien5LeoZSB_3RwWeTGTkpFQXLxq1SaE80-aaY0u_nm4ROa-rHf8mKj0Ri-Vlo';

// In the native Android shell, web-push (service worker + VAPID) is unreliable,
// so the native layer (MainActivity.kt) fetches a real FCM token and injects it
// as window.__VERGR_NATIVE_FCM_TOKEN__ + a 'vergr:native-fcm-token' event. This
// resolves that token (waiting briefly if it hasn't arrived yet). Native FCM
// tokens are stored in the same users/{uid}/private/fcm doc the backend reads —
// Firebase Admin messaging treats web + native tokens identically.
function getNativeFcmToken(timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(null);
    if (window.__VERGR_NATIVE_FCM_TOKEN__) return resolve(window.__VERGR_NATIVE_FCM_TOKEN__);
    let done = false;
    const finish = (v) => { if (!done) { done = true; cleanup(); resolve(v); } };
    const onEvt = (e) => finish(e?.detail || window.__VERGR_NATIVE_FCM_TOKEN__ || null);
    const poll = setInterval(() => {
      if (window.__VERGR_NATIVE_FCM_TOKEN__) finish(window.__VERGR_NATIVE_FCM_TOKEN__);
    }, 500);
    const timer = setTimeout(() => finish(window.__VERGR_NATIVE_FCM_TOKEN__ || null), timeoutMs);
    function cleanup() {
      clearInterval(poll); clearTimeout(timer);
      window.removeEventListener('vergr:native-fcm-token', onEvt);
    }
    window.addEventListener('vergr:native-fcm-token', onEvt);
  });
}

async function saveFcmToken(userId, token) {
  await setDoc(doc(db, 'users', userId, 'private', 'fcm'), {
    tokens: arrayUnion(token),
    updatedAt: new Date(),
  }, { merge: true });
  subscribeAnnouncementsTopic(token);
}

// Huawei (HMS) push token. Huawei devices (2019+) have no Google Play Services,
// so getToken()/FCM never registers there; the native Huawei build fetches an
// HMS token in Kotlin and injects it as window.__VERGR_NATIVE_HMS_TOKEN__ +
// a 'vergr:native-hms-token' event (parallel to the FCM bridge). Stored in the
// SAME users/{uid}/private/fcm doc under a separate `hmsTokens` array so the
// backend routes those tokens through Huawei Push Kit instead of FCM.
function getNativeHmsToken(timeoutMs = 6000) {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(null);
    if (window.__VERGR_NATIVE_HMS_TOKEN__) return resolve(window.__VERGR_NATIVE_HMS_TOKEN__);
    let done = false;
    const finish = (v) => { if (!done) { done = true; cleanup(); resolve(v); } };
    const onEvt = (e) => finish(e?.detail || window.__VERGR_NATIVE_HMS_TOKEN__ || null);
    const poll = setInterval(() => {
      if (window.__VERGR_NATIVE_HMS_TOKEN__) finish(window.__VERGR_NATIVE_HMS_TOKEN__);
    }, 500);
    const timer = setTimeout(() => finish(window.__VERGR_NATIVE_HMS_TOKEN__ || null), timeoutMs);
    function cleanup() {
      clearInterval(poll); clearTimeout(timer);
      window.removeEventListener('vergr:native-hms-token', onEvt);
    }
    window.addEventListener('vergr:native-hms-token', onEvt);
  });
}

async function saveHmsToken(userId, token) {
  await setDoc(doc(db, 'users', userId, 'private', 'fcm'), {
    hmsTokens: arrayUnion(token),
    updatedAt: new Date(),
  }, { merge: true });
}

/**
 * Request push notification permission and save FCM token to Firestore.
 * Call this after user logs in or taps "Enable notifications".
 */
export const setupPushNotifications = async (userId) => {
  if (!userId) return null;

  // Native Android shell: use the token bridged from MainActivity.kt.
  if (isMobileApp()) {
    let got = null;
    try {
      const nativeToken = await getNativeFcmToken();
      if (nativeToken) {
        await saveFcmToken(userId, nativeToken);
        console.log('Native push enabled (FCM)');
        got = nativeToken;
      } else {
        console.warn('Native FCM token not available (expected on Huawei/HMS devices)');
      }
    } catch (err) {
      console.error('Failed to setup native FCM push:', err);
    }
    // Huawei push runs INDEPENDENTLY (only Huawei/HMS devices ever produce a
    // token) so it never blocks or delays the FCM path above. Fire-and-forget:
    // the token is saved whenever the bridge delivers it.
    getNativeHmsToken().then((hms) => {
      if (hms) {
        saveHmsToken(userId, hms)
          .then(() => console.log('Native push enabled (HMS)'))
          .catch((e) => console.error('Failed to save HMS token:', e));
      }
    }).catch(() => {});
    return got;
  }

  if (!messaging) return null;
  if (VAPID_KEY === 'YOUR_VAPID_KEY_HERE') {
    console.warn('Push notifications: VAPID key not set. See src/utils/pushNotifications.js');
    return null;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.log('Push notification permission denied');
      return null;
    }

    // Register the FCM service worker.
    //
    // SCOPE IS EXPLICIT AND MUST STAY THAT WAY. With no options this defaulted
    // to scope '/', which is the SAME scope index.html registers /sw.js at —
    // and a scope holds exactly ONE registration, so the two evicted each other
    // turn by turn. Observed live in a real profile: the root scope reported
    // /sw.js one moment and /firebase-messaging-sw.js thirty seconds later.
    //
    // That is why the /vlink guard inside sw.js was only *sometimes* in the
    // worker actually in control, and why the Vergr shell appearing inside the
    // Shopify admin looked random instead of reproducible. It also forced a
    // fresh install of sw.js on every swap, each one re-precaching /index.html.
    //
    // FCM only needs a scope it can receive push events on; it has never needed
    // the root. Pinning it to its own path leaves /sw.js undisputed at '/'.
    const registration = await navigator.serviceWorker.register(
      '/firebase-messaging-sw.js',
      { scope: '/firebase-cloud-messaging-push-scope' },
    );

    // Get FCM token
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (token) {
      // Save token to user's private FCM doc (same path the TypeScript functions read from)
      await setDoc(doc(db, 'users', userId, 'private', 'fcm'), {
        tokens: arrayUnion(token),
        updatedAt: new Date(),
      }, { merge: true });
      subscribeAnnouncementsTopic(token);

      console.log('Push notifications enabled');
      return token;
    }
  } catch (err) {
    console.error('Failed to setup push notifications:', err);
  }
  return null;
};

/**
 * Remove THIS device's push tokens from a user, on sign-out.
 *
 * Tokens were only ever added (`arrayUnion`), never removed, so every device a
 * user had ever signed in on stayed registered forever. Signing out did not
 * stop the pushes: an old phone, a borrowed laptop or a shared machine kept
 * receiving that account's DMs and notifications indefinitely, with no way for
 * the user to stop it. That is a privacy bug, not a tidiness one, and it
 * affected web, desktop and the Android app equally.
 *
 * Best-effort and deliberately bounded. Sign-out must ALWAYS win: the same
 * lesson as the presence write in AuthContext, where an unresolvable promise
 * silently killed sign-out on native. Never let this block the actual signOut.
 *
 * Both token families are cleared. A Huawei device has HMS tokens and no FCM
 * token; clearing only one would leave Huawei users still receiving pushes
 * after sign-out, which is exactly the bug on a platform that is harder to
 * notice it on.
 */
export const unregisterPushTokens = async (userId) => {
  if (!userId || typeof window === 'undefined') return;

  const fcmToken = window.__VERGR_NATIVE_FCM_TOKEN__ || null;
  const hmsToken = window.__VERGR_NATIVE_HMS_TOKEN__ || null;

  // Web: ask FCM for this browser's current token so we remove the right one.
  // We must NOT remove every token on the doc: the user may be signed in on
  // other devices that should keep working.
  let webToken = null;
  try {
    if (messaging && 'serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration(
        '/firebase-cloud-messaging-push-scope',
      );
      if (registration) {
        webToken = await getToken(messaging, {
          vapidKey: VAPID_KEY,
          serviceWorkerRegistration: registration,
        }).catch(() => null);
      }
    }
  } catch { /* no messaging support here; nothing to remove */ }

  const fcmToRemove = [fcmToken, webToken].filter(Boolean);
  const hmsToRemove = [hmsToken].filter(Boolean);
  if (!fcmToRemove.length && !hmsToRemove.length) return;

  const patch = { updatedAt: new Date() };
  if (fcmToRemove.length) patch.tokens = arrayRemove(...fcmToRemove);
  if (hmsToRemove.length) patch.hmsTokens = arrayRemove(...hmsToRemove);

  try {
    await setDoc(doc(db, 'users', userId, 'private', 'fcm'), patch, { merge: true });
  } catch (e) {
    console.warn('[push] could not unregister token on sign-out:', e?.message);
  }

  // Also drop the announcements topic, or broadcast pushes keep arriving even
  // once the per-user tokens are gone.
  for (const t of fcmToRemove) unsubscribeAnnouncementsTopic(t);
};

/**
 * Listen for foreground push messages (when app is open).
 * Shows a toast or in-app notification instead of a system notification.
 */
export const onForegroundMessage = (callback) => {
  if (!messaging) return () => {};
  return onMessage(messaging, (payload) => {
    const { title, body } = payload.notification || {};
    callback({ title, body, data: payload.data });
  });
};
