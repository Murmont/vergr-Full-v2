// Shared mock data for the admin Stream Preview tab (/admin/stream-preview).
// These power the SEPARATE preview copies of the broadcaster/viewer screens so
// the founder can see the live UI (and, later, gift overlays) WITHOUT going
// live. Nothing here touches Firestore, the camera, or the ingest servers.
//
// The copy here IS SHIPPED: Play store screenshots are captured from this
// screen, so no value may read as a placeholder ("Preview Streamer", "Stream
// preview", "[username]"). The streamer and game names are invented on purpose
// — a real streamer's handle would be impersonation, and a real game title
// would be a trademark on our listing that we have no licence to use.

import { faceFor } from './previewFaces';
import { CAST } from './previewCast';

export const PREVIEW_HOST = {
  id: 'preview-host',
  // ⚠ BOTH KEYS. The rail keys the host's avatar upload on `id` while every
  // stream surface reads `uid`, so with only one of them the host was the ONE
  // person whose uploaded face never appeared.
  uid: 'preview-host',
  displayName: 'Riven',
  username: 'rivenplays',
  avatar: faceFor('preview-host', 'Riven'),
  isVerified: true,
  // The profile sheet renders a LEVEL pill off vpLevel. Without it the host's
  // sheet read 'LEVEL' with no number while every guest showed one.
  vpLevel: 78,
  tipCatalog: [],
};

export function makePreviewStreamDoc(extra = {}) {
  return {
    id: 'admin-preview',
    status: 'live',
    hostUid: 'preview-host',
    hostUsername: 'rivenplays',
    title: 'Ranked grind, road to Diamond',
    game: 'Nightfall Protocol',
    ingestType: 'browser',
    hostPlan: 'pro',
    viewerCount: 1284,
    peakViewers: 1402,
    hearts: 342,
    boosted: false,
    unlisted: false,
    audience: 'public',
    slowModeSec: 0,
    followersOnly: false,
    startedAt: Date.now() - 1000 * 60 * 42,
    goal: { active: true, targetCoins: 5000, currentCoins: 3120, reason: 'New mic!' },
    tags: ['Ranked', 'FPS'],
    lastTip: null,
    lastSub: null,
    lastGift: null,
    // Mock top-gifters leaderboard for the cluster + sheet (real viewer reads
    // streams/{id}/gifters; preview is static).
    // ⚠⚠ THE SUPPORTERS WERE A SECOND SET OF PEOPLE. This list used to define
    // its own uids (g1-g4) for ZER0_kade, Emma_Quinn and Yves_SB — the SAME
    // names that are in CAST, with DIFFERENT ids. The rail uploads faces keyed
    // on cast uids, so `avatars['g1']` was never set and all six supporter
    // surfaces (both viewer clusters, both solo clusters, the desktop strip and
    // the supporters sheet) drew identicons forever, no matter what was
    // uploaded. It looked like the upload feature was broken; the truth was
    // that the preview had two people called ZER0_kade.
    //
    // Derived from CAST now, so there is ONE identity table and a face uploaded
    // for a person is that person's face on every surface, by construction.
    // Anything added here later must take a cast member, never invent a uid.
    previewGifters: [
      { ...CAST[0], coins: 22200 },   // ZER0_kade
      { ...CAST[6], coins: 22100 },   // Emma_Quinn
      { ...CAST[7], coins: 22000 },   // Yves_SB
      { ...CAST[3], coins: 8400 },    // nova_kill
    ],
    ...extra,
  };
}
