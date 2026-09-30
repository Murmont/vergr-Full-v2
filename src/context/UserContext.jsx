import { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { subscribeToUser, subscribeToWallet, updateUser as updateUserDoc, getConversations } from '../firebase/firestore';
import { installResyncTriggers } from '../firebase/resync';
import { initLocalCurrency, subscribeCurrency } from '../utils/currency';
import { warmMedia } from '../utils/deviceMediaCache';
import { peekSelfProfile, saveSelfProfile, clearSelfProfile } from '../utils/selfProfileCache';
import { prefetchCloseFriends } from '../utils/closeFriendsPrefetch';
import { isGallerySaveSupported, isMediaSaved, saveMediaToGallery, ALBUM_MANUAL } from '../utils/saveToGallery';
import { purgeClearedHistoryOnce } from '../utils/chatOps';
import { restorePurchases, restoreSubscriptions } from '../utils/nativeBilling';
import { ensureAccountCountry } from '../utils/geoBlocks';

// Exported so Vergr Vanguard can hand its screens a stand-in profile for the
// operator, who has no users document (src/vanguard/VanguardApp.jsx).
export const UserContext = createContext(null);
const DEFAULT_WALLET = { balance: 0, vp: 0, totalEarned: 0, totalSpent: 0, totalReceived: 0, totalTipped: 0, owedMicroUsd: 0, totalOwedMicroUsd: 0, totalPaidMicroUsd: 0, tier: 'free', dailyStreak: 0 };

export function UserProvider({ children }) {
  const { currentUser, loading: authLoading } = useAuth();
  // Seed from the SYNCHRONOUS localStorage snapshot so the very first render
  // already has your name and your face. Without this, `profile` is null until
  // the Firestore doc lands and every surface that shows you — top bar, bottom
  // nav, profile tab — paints an empty placeholder first and pops in after.
  // The real doc replaces this the moment it arrives; the snapshot is only ever
  // a head start, never the source of truth. See utils/selfProfileCache.js.
  const [profile, setProfile] = useState(() => peekSelfProfile());
  const [wallet, setWallet] = useState(DEFAULT_WALLET);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) {
      // THE BUG THAT MADE YOUR OWN AVATAR FLASH A PLACEHOLDER ON EVERY LAUNCH.
      //
      // Firebase restores the session asynchronously: AuthContext starts with
      // `currentUser = null` and `loading = true`, and only onAuthStateChanged
      // fills them in. So on EVERY cold start this effect ran once with no user
      // — not because you were signed out, but because auth had not answered
      // yet. It then did two destructive things:
      //
      //   setProfile(null)     wiped the seeded profile a frame after it painted,
      //                        so your face appeared and was immediately replaced
      //                        by the placeholder.
      //   clearSelfProfile()   DELETED the localStorage snapshot, so the next
      //                        launch had nothing to seed from either. The head
      //                        start could never survive a single restart.
      //
      // The avatar then only came back when the Firestore document arrived,
      // which is exactly the delay that kept being reported.
      //
      // Only a RESOLVED auth state with no user is a sign-out. While authLoading
      // is true we know nothing yet, so we must not touch either.
      if (authLoading) return;
      setProfile(null);
      clearSelfProfile();
      setWallet(DEFAULT_WALLET);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubUser = subscribeToUser(currentUser.uid, (userData) => {
      setProfile(userData);
      setLoading(false);
      // Warm the on-device media cache with the viewer's own avatar/banner so
      // the top-bar + bottom-nav + profile paint instantly on a cold restart
      // (a sync memory hit, no per-render IndexedDB read). Silent, best-effort.
      if (userData) {
        // Order matters: saveSelfProfile reads the avatar's BYTES out of the
        // media cache to build its data URI, and warmMedia is what puts them
        // there. Firing both at once meant that on a fresh install the blob was
        // not stored yet, the read missed, and the snapshot was saved without a
        // usable avatar. Chain them so the snapshot is complete from the first
        // launch instead of the second.
        warmMedia([userData.avatar, userData.banner])
          .catch(() => {})
          .finally(() => saveSelfProfile(currentUser.uid, userData));
        // Your own avatar and banner into the "VERGR" gallery album, alongside
        // the things you saved by hand — deliberately NOT the auto-save albums,
        // which are for media other people sent you. `isMediaSaved` dedupes on
        // the url, and an avatar url carries its upload timestamp, so this runs
        // once per picture rather than on every launch.
        if (isGallerySaveSupported()) {
          for (const u of [userData.avatar, userData.banner]) {
            if (u && !isMediaSaved(u)) {
              saveMediaToGallery(u, { album: ALBUM_MANUAL }).catch(() => {});
            }
          }
        }
      }
    });

    // Wallet is created by onUserCreated Cloud Function on signup.
    // subscribeToWallet returns defaults (balance: 0) if doc doesn't exist yet.
    const unsubWallet = subscribeToWallet(currentUser.uid, (walletData) => {
      setWallet(walletData);
    });

    return () => { unsubUser(); unsubWallet(); };
    // authLoading is a dependency because the early return above hinges on it:
    // when auth resolves to "no user" this effect must re-run to do the real
    // sign-out cleanup it deliberately skipped.
  }, [currentUser, authLoading]);

  // Boot preload (Telegram-style "everything ready behind the splash"): while
  // the loading screen is up, warm every chat partner's avatar into memory so
  // the messages list paints with all avatars already present — a synchronous
  // cache hit, no per-row lookup, no blink/skeleton. Runs ONCE per login; the
  // conversation reads are served from the on-device Firestore cache after the
  // first fetch, so this is cheap on every subsequent open (and works offline).
  useEffect(() => {
    if (!currentUser?.uid) return;
    let cancelled = false;
    (async () => {
      // One-time cleanup for devices that cleared/deleted a chat BEFORE those
      // paths started purging: physically drop the bodies still sitting behind
      // an old watermark. Fire-and-forget so it can never delay app start.
      purgeClearedHistoryOnce().catch(() => {});
      // Play Billing crash recovery: if the app died between Google taking
      // payment and us crediting coins, the purchase is still owned and
      // unconsumed. Re-redeem it here rather than making the user notice the
      // money is missing. No-op off the Play build; server is idempotent on
      // the purchase token, so a redundant call cannot double-credit.
      restorePurchases().catch(() => {});
      // Same idea for the platform subscription: on a reinstall or a new
      // device Google still holds the entitlement but our user doc does not.
      restoreSubscriptions().catch(() => {});
      try {
        const convos = await getConversations(currentUser.uid);
        if (cancelled) return;
        const urls = [];
        for (const c of convos) {
          for (const u of c.otherUsers || []) {
            if (u?.avatar) urls.push(u.avatar);
            if (u?.photoURL) urls.push(u.photoURL);
          }
          if (c.groupAvatar) urls.push(c.groupAvatar);
        }
        warmMedia(urls);
      } catch {
        /* best-effort */
      }
      if (cancelled) return;
      // Pull down close friends' avatars, banners, chat backgrounds and squad
      // art so the FIRST open of a room is instant, not just the second.
      //
      // DEFERRED ON PURPOSE. Running this as part of boot made startup SLOWER:
      // it issues a string of Firestore reads and downloads that compete with
      // your own profile document, which is the one thing standing between a
      // cold start and your avatar being on screen. Nothing here is needed until
      // you actually open a chat, so it waits for the app to go idle and falls
      // back to a plain delay where requestIdleCallback does not exist.
      const startPrefetch = () => {
        if (cancelled) return;
        prefetchCloseFriends(currentUser.uid).catch(() => {});
      };
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(startPrefetch, { timeout: 8000 });
      } else {
        setTimeout(startPrefetch, 4000);
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser?.uid]);

  // Local-currency display. Resolve the target currency + prefetch FX rates from
  // the user's profile country (locale fallback when unknown). fxVersion bumps
  // when rates/target become available so all money displays re-render and
  // switch from EUR to local currency without a manual refresh.
  const [fxVersion, setFxVersion] = useState(0);
  useEffect(() => subscribeCurrency(() => setFxVersion((v) => v + 1)), []);
  useEffect(() => {
    initLocalCurrency({ country: profile?.country || profile?.location || '' });
  }, [profile?.country, profile?.location]);

  const updateProfile = async (data) => {
    if (!currentUser) return;
    await updateUserDoc(currentUser.uid, data);
  };

  // Guest = anonymous Firebase Auth user, OR explicit `isGuest: true` on
  // the user doc. Either signal counts. `isAnonymous` from AuthContext
  // is fast (sync), the user doc flag is the durable record.
  const { isAnonymous } = useAuth();
  const isGuest = isAnonymous || profile?.isGuest === true;

  // A cache-only wallet is a balance we cannot vouch for. Exposed so the money
  // surfaces can say so instead of presenting a stale number as fact, and so
  // the resync watcher has something to react to.
  const walletUnverified = wallet?._fromCache === true;

  // Mounted once for the whole app. Cycles the Firestore connection when the
  // app regains focus while a listener is stuck on cache, which recovers every
  // listener at once because the stall is at the transport, not the query.
  useEffect(() => installResyncTriggers(), []);

  // Every account has a country (founder, 2026-09-25): checkout depends on it.
  // Fires only while the loaded profile has none, so it is once per account.
  // A cache-seeded profile waits for the server copy, which may already have it.
  const needsCountry = !!currentUser && !isGuest && !!profile && !profile._fromCache && !profile.geoCountry;
  useEffect(() => {
    if (needsCountry) ensureAccountCountry(currentUser, profile);
  }, [needsCountry, currentUser, profile]);

  const value = { profile, wallet, loading, updateProfile, isGuest, fxVersion, walletUnverified };
  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export const useUser = () => {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useUser must be used within UserProvider');
  return ctx;
};
