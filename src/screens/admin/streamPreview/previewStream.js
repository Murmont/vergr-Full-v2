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

export const PREVIEW_HOST = {
  id: 'preview-host',
  displayName: 'Riven',
  username: 'rivenplays',
  avatar: null,
  isVerified: true,
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
    previewGifters: [
      { uid: 'g1', displayName: 'ZERO_taeyeon', avatar: null, coins: 22200 },
      { uid: 'g2', displayName: 'Emma_Quinn', avatar: null, coins: 22100 },
      { uid: 'g3', displayName: 'Yves_SB', avatar: null, coins: 22000 },
      { uid: 'g4', displayName: 'Nova', avatar: null, coins: 8400 },
    ],
    ...extra,
  };
}
