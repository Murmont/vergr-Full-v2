// Fetch the things you are about to look at, before you look at them.
//
// The file cache makes a picture instant the SECOND time you see it. This makes
// it instant the FIRST time, which is the difference between "fast app" and
// "app that was already loaded when I opened it".
//
// WHO COUNTS (founder rule, 2026-08-02): you follow them AND you actually
// interact — you have a DM with them, or you share a squad, or you share a
// group. Following alone is not enough, and a message from someone you do not
// follow is explicitly not enough. Those land in requests, are text only, and
// have no media to store.
//
// The point of the rule is that it bounds the work. Caching every face that
// crosses the feed would be unbounded and would buy nothing: feed authors scroll
// past once, close friends are who you actually open.

import { collection, doc, getDoc, getDocs, query, where, limit } from 'firebase/firestore';
import { db } from '../firebase/config';
import { isFileCacheAvailable, hasLocal, storeMedia } from './fileMediaCache';

// Recomputed at most this often. A social graph does not change minute to
// minute, and the queries below are Firestore reads, which are the one part of
// this that costs real money.
const RECOMPUTE_MS = 12 * 60 * 60 * 1000;
const STAMP_KEY = 'vergr.prefetch.lastRun';

// Sequential, never parallel. The whole job runs while the user is looking at a
// real screen, and firing twenty downloads at once would compete with the images
// that screen is trying to load — making the visible thing slower to speed up an
// invisible one.
async function fetchSequentially(urls) {
  for (const url of urls) {
    if (!url || hasLocal(url)) continue;
    try { await storeMedia(url, { permanent: true }); } catch { /* keep going */ }
  }
}

/**
 * Work out who matters and pull down their avatars, plus the chat backgrounds
 * and squad/group art that make a room paint instantly when it opens.
 *
 * Every failure is swallowed on purpose: this is an optimisation, and an
 * optimisation that can break app startup is not one.
 */
export async function prefetchCloseFriends(uid) {
  if (!uid || !isFileCacheAvailable()) return;
  try {
    const last = Number(localStorage.getItem(STAMP_KEY) || 0);
    if (Date.now() - last < RECOMPUTE_MS) return;
  } catch { /* storage unavailable, just run */ }

  try {
    // Who you follow. This is the outer bound — nobody outside it can qualify,
    // so it is read first and everything else intersects with it.
    const followingSnap = await getDocs(
      query(collection(db, 'users', uid, 'following'), limit(500)),
    );
    const following = new Set(followingSnap.docs.map((d) => d.id));
    if (!following.size) return;

    const urls = [];
    const seen = new Set();
    const push = (u) => {
      if (u && typeof u === 'string' && !seen.has(u)) { seen.add(u); urls.push(u); }
    };
    // Everyone you have actually interacted with, collected as we go, so the
    // banner pass below knows whose user documents are worth reading.
    const interacted = new Set();

    // Interaction signal 1 and 2: DMs and groups both live in `conversations`.
    // A group also contributes its own icon, since that is what the inbox row
    // and the chat header render.
    const convos = await getDocs(
      query(
        collection(db, 'conversations'),
        where('participants', 'array-contains', uid),
        limit(200),
      ),
    );
    convos.forEach((docSnap) => {
      const c = docSnap.data() || {};
      push(c.groupAvatar);
      push(c.background);
      const others = (c.participants || []).filter((p) => p !== uid);
      others.forEach((other) => {
        if (!following.has(other)) return;  // strangers and one-way DMs excluded
        interacted.add(other);
        const meta = c.metadata?.[other] || {};
        push(meta.avatar || meta.photoURL);
      });
    });

    // Interaction signal 3: shared squads. The squad's own art matters as much
    // as its members here — it is the biggest thing on the screen when you open
    // one, so having it already on disk is what makes the room feel instant.
    const squads = await getDocs(
      query(
        collection(db, 'squads'),
        where('memberIds', 'array-contains', uid),
        limit(50),
      ),
    );
    squads.forEach((docSnap) => {
      const s = docSnap.data() || {};
      push(s.avatar);
      push(s.banner);
      push(s.background);
      (s.memberIds || []).forEach((m) => { if (m !== uid && following.has(m)) interacted.add(m); });
    });

    // BANNERS. These have to come from the user documents, and that is the whole
    // reason they were missing: a conversation only stores a name and an avatar
    // for each participant, never a banner. So caching whatever the inbox knew
    // about got avatars right and left every banner to be fetched the first time
    // you opened someone's profile — which is exactly what "avatars worked
    // offline but banners did not" looked like on the device.
    //
    // Reading these documents costs Firestore reads, so it is bounded to the
    // people who already qualified as close friends and runs at most twice a day.
    // Capped at 20, not 60. Each of these is a separate Firestore read issued
    // one after another, and they were competing at startup with the ONE read
    // that actually matters — your own user document, which is what puts your
    // avatar on screen. Making the prefetch greedy made your own face slower to
    // appear, which is the opposite of the point.
    const closeUids = [...interacted].filter((id) => following.has(id)).slice(0, 20);
    for (const other of closeUids) {
      try {
        const u = await getDoc(doc(db, 'users', other));
        if (!u.exists()) continue;
        const d = u.data() || {};
        push(d.banner);
        push(d.avatar || d.photoURL);   // covers anyone the inbox had no avatar for
      } catch { /* skip this one */ }
    }

    await fetchSequentially(urls);
    try { localStorage.setItem(STAMP_KEY, String(Date.now())); } catch { /* fine */ }
  } catch {
    // A failed prefetch costs nothing but a slower first open. Never surface it.
  }
}
