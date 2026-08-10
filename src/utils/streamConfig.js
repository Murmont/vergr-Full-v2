// src/utils/streamConfig.js
// Live-stream client config.
//
// Pipeline (LOCKED, see CLAUDE.md "Live streaming"):
//   ingest:    Hetzner box (nginx-rtmp for OBS, vergr-ingest for browser fMP4,
//              Pion vergr-sfu for co-host publishers). Ingest URLs come from
//              the createStreamSession callable, NOT this file.
//   composite: vergr-cohost@<streamId>.service (ffmpeg xstack) for co-host.
//   delivery:  HLS segments synced to R2, served from cdn.vergr.app.
//
// This module only owns: stream-type metadata + playback URL derivation.

export const STREAM_TYPES = {
  just_chatting: {
    id: 'just_chatting',
    label: 'Just Chatting',
    icon: 'forum',
    description: 'Talk with your audience, no gameplay.',
    minPlan: 'free',
  },
  gameplay: {
    id: 'gameplay',
    label: 'Gameplay',
    icon: 'sports_esports',
    description: 'Stream your game with overlay + chat.',
    minPlan: 'free',
  },
  co_stream: {
    id: 'co_stream',
    label: 'Co-Stream',
    icon: 'groups',
    description: 'Multi-host stream with up to 4 broadcasters.',
    minPlan: 'lite',
  },
  watch_party: {
    id: 'watch_party',
    label: 'Watch Party',
    icon: 'theaters',
    description: 'Watch a video together with synced playback + chat.',
    minPlan: 'lite',
  },
  squad_hangout: {
    id: 'squad_hangout',
    label: 'Squad Hangout',
    icon: 'diversity_3',
    description: 'Private squad-only stream. Starts from the squad dashboard.',
    minPlan: 'free',
  },
};

export const STREAM_TYPE_LIST = Object.values(STREAM_TYPES);

// Public CDN base. The viewer reads HLS from cdn.vergr.app/streams/<streamKey>/index.m3u8.
// R2 lifecycle: segments live here until the ended-stream cleanup cron removes them.
const HLS_BASE =
  (import.meta.env.VITE_HLS_BASE_URL || 'https://cdn.vergr.app/streams').replace(/\/$/, '');

/**
 * Returns the HLS playback URL for a stream key.
 * @param {string} streamKey  Issued server-side by createStreamSession.
 */
export function getPlaybackUrl(streamKey) {
  if (!streamKey) return null;
  return `${HLS_BASE}/${streamKey}/index.m3u8`;
}

/**
 * Live chat WebSocket relay base (Hetzner). Wired in Phase 7.
 *   wss://chat.vergr.app/stream/<streamId>
 */
export const CHAT_WS_BASE =
  (import.meta.env.VITE_CHAT_WS_BASE || 'wss://chat.vergr.app').replace(/\/$/, '');

export function getChatSocketUrl(streamId) {
  if (!streamId) return null;
  return `${CHAT_WS_BASE}/stream/${streamId}`;
}

export function streamTypesForPlan(plan = 'free') {
  const order = { free: 0, lite: 1, pro: 2 };
  const userLevel = order[plan] ?? 0;
  return STREAM_TYPE_LIST.filter(t => userLevel >= (order[t.minPlan] ?? 0));
}

export function isStreamTypeAllowed(typeId, plan = 'free') {
  const t = STREAM_TYPES[typeId];
  if (!t) return false;
  const order = { free: 0, lite: 1, pro: 2 };
  return (order[plan] ?? 0) >= (order[t.minPlan] ?? 0);
}
