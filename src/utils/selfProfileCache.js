// A SYNCHRONOUS snapshot of the signed-in user's own identity, so the very first
// render already knows who they are.
//
// THE PROBLEM THIS SOLVES: your own avatar rendered blank and then popped in,
// which the founder correctly called a clear sign of a badly built app. Every
// cache we had was asynchronous, and they were serial:
//
//   JS parses -> auth resolves (IndexedDB) -> profile doc loads (Firestore)
//   -> only NOW is the avatar URL known -> blob read (IndexedDB) -> paint
//
// React's first paint happens before any of that finishes, so the first frame
// cannot contain your face no matter how fast the individual steps are. Making
// the steps faster was never going to fix it.
//
// localStorage is the one store that can be read DURING a render with no await,
// so the snapshot lives there — including the avatar itself as a data URI, which
// is why the URL being unknown at first render stops mattering.
//
// SCOPE: the signed-in user only. Other people's avatars still come from the
// async blob cache; carrying every author's bytes here would blow the ~5MB
// localStorage budget. That case is Track B (docs/TRACK_B_NATIVE_HOME.md).

import { getCachedBlob, seedCachedMedia } from './deviceMediaCache';
import { isFileCacheAvailable, localSrcFor, storeMedia } from './fileMediaCache';

const KEY = 'vergr.selfprofile';
// A data URI is ~33% larger than the bytes. localStorage is ~5MB total and is
// shared with the feed cache, chat watermarks and nav badges, so this stays
// small deliberately: an avatar over this size is skipped and simply behaves as
// it does today rather than evicting something else.
const MAX_AVATAR_BYTES = 200 * 1024;

/**
 * Read the snapshot. Safe to call inside a `useState` initialiser — it does not
 * touch the network, IndexedDB, or Firestore.
 */
export function peekSelfProfile(uid) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw);
    if (!snap) return null;
    // uid is OPTIONAL, and that is the whole point of this function.
    //
    // The first version required it, and the seed therefore never ran: React
    // calls a useState initialiser exactly once, at mount, and at mount
    // `currentUser` is still null because Firebase restores the session
    // asynchronously. So `peekSelfProfile(currentUser?.uid)` was always
    // `peekSelfProfile(undefined)` -> null, and the avatar went on rendering
    // the placeholder first. The fix has to work with no uid available.
    //
    // Reading it unconditionally is safe: the snapshot is cleared on sign-out,
    // and there is only ever one signed-in account on a device at a time. When
    // auth does resolve, a mismatched uid is rejected below and the real doc
    // replaces the seed anyway.
    if (uid && snap.uid !== uid) return null;
    // Expose the data URI AS `avatar`, because that is the field every consumer
    // reads (UserAvatar, the top bar, the nav). Handing back the remote URL here
    // would put us straight back into an async image load on the first frame,
    // which is the whole thing this exists to avoid. `_fromCache` lets anything
    // that cares tell a head start from the real doc.
    // Preference order matters. A local FILE is best: it costs nothing to
    // address, has no size ceiling, and renders like any other image. The base64
    // data URI is the fallback for platforms with no file store (web, desktop
    // for now) and is capped at 200KB because localStorage is ~5MB in total and
    // shared with the feed cache. The bare remote URL is the last resort and is
    // the one case that still loads asynchronously.
    const local = localSrcFor(snap.avatarUrl);
    return {
      ...snap,
      avatar: local || snap.avatarData || snap.avatarUrl || null,
      _fromCache: true,
    };
  } catch {
    return null;
  }
}

/** The persisted avatar as a data URI, or null. */
export function peekSelfAvatar(uid) {
  return peekSelfProfile(uid)?.avatarData || null;
}

/**
 * Point the media cache at the snapshot's bytes under the avatar's REMOTE url,
 * before React renders anything.
 *
 * Without this the head start is thrown away a few hundred ms later: the seeded
 * profile hands `UserAvatar` a data URI (paints immediately), then the real user
 * doc arrives and hands it the cdn.vergr.app url instead, which `useCachedImage`
 * cannot resolve synchronously — so it blanks to the placeholder and pops the
 * face back in once IndexedDB answers. Seeding makes both spellings of "your
 * avatar" resolve to the same already-decoded source, so the swap paints nothing.
 *
 * MUST run at module scope before `createRoot`, not in an effect: a `useState`
 * initialiser reads the cache during the first render, which is earlier than any
 * effect can possibly fire.
 */
export function seedSelfAvatar() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const snap = JSON.parse(raw);
    if (snap?.avatarUrl && snap?.avatarData) seedCachedMedia(snap.avatarUrl, snap.avatarData);
  } catch {
    /* no snapshot yet, or storage unavailable — just means no head start */
  }
}

/**
 * Persist the identity fields the first frame needs. Called after the real
 * profile doc lands, so it is always one launch behind — which is the point: it
 * describes who you were last time, and that is correct until proven otherwise.
 */
export async function saveSelfProfile(uid, profile) {
  if (!uid || !profile) return;
  try {
    const prev = peekSelfProfile(uid);
    const avatarUrl = profile.avatar || profile.photoURL || null;
    // Re-encoding the avatar on every launch would burn a fetch and a main-thread
    // encode for a byte-identical result. Avatar URLs carry an upload timestamp,
    // so an unchanged URL means unchanged bytes.
    let avatarData = prev && prev.avatarUrl === avatarUrl ? prev.avatarData : null;
    if (isFileCacheAvailable()) {
      // With a file store there is no reason to carry base64 in localStorage at
      // all: the URL alone is enough, because the filename is derived from it.
      // This is what removes the 200KB ceiling on native.
      avatarData = null;
      if (avatarUrl) storeMedia(avatarUrl, { permanent: true }).catch(() => {});
      // Your own banner too. It is the largest thing on your profile, so its
      // absence offline is the most obvious, and nothing else fetches it ahead
      // of time — the close-friends pass covers other people, not you.
      const bannerUrl = profile.banner || null;
      if (bannerUrl) storeMedia(bannerUrl, { permanent: true }).catch(() => {});
    } else if (avatarUrl && !avatarData) {
      avatarData = await toDataUri(avatarUrl);
    }
    const snap = {
      uid,
      displayName: profile.displayName || profile.name || '',
      username: profile.username || '',
      avatarUrl,
      avatarData: avatarData || null,
    };
    localStorage.setItem(KEY, JSON.stringify(snap));
  } catch {
    // Quota, private mode, a blocked fetch — all mean "no head start", never an
    // error the user should see.
  }
}

/** Drop the snapshot on sign-out so the next account never inherits a face. */
export function clearSelfProfile() {
  try { localStorage.removeItem(KEY); } catch { /* no-op */ }
}

async function toDataUri(url) {
  try {
    // The bytes are ALREADY on the device: warmMedia() stores every avatar in
    // the Dexie blob cache, fetched through tauri-plugin-http. Read them from
    // there rather than going back to the network.
    //
    // This is not an optimisation, it is the difference between working and not
    // working on the app. `window.fetch('https://cdn.vergr.app/...')` inside the
    // Tauri WebView is CORS-blocked — the shell's origin is tauri.localhost and
    // the CDN does not allow it. The first version of this used window.fetch,
    // so on native it always failed, avatarData was always null, and the whole
    // snapshot degraded to a bare URL that still had to load asynchronously.
    // See [[reference-webview-cors-native-fetch]].
    let blob = await getCachedBlob(url);
    if (!blob) {
      // Web/PWA, or a first sighting the media cache has not stored yet.
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) return null;
      blob = await res.blob();
    }
    if (!blob || blob.size > MAX_AVATAR_BYTES) return null;
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
