// Audius client. Effect 09 (profile audio). Doc: docs/effects/09-profile-ambiance.md
//
// WHY AUDIUS AND NOT AN EMBED, all verified against the live API on 2026-08-25:
//
//   YouTube   DEAD. Ads are unavoidable on monetised videos and YouTube
//             INCREASED their frequency on embedded players in Aug 2024;
//             `rel=0`/`modestbranding` no longer help. A visitor opening a
//             profile could get a pre-roll advert. It also reports playback
//             data to Google on page load, which is a consent problem.
//   Spotify   DEAD. Embeds play a 30-SECOND PREVIEW unless the visitor is on
//             desktop, logged in AND Premium. Mobile always gets the preview.
//   Licensing DEAD at this stage. TikTok's route is direct deals with UMG,
//             Warner, Sony and publishers; the cited floor for a small app is
//             $100,000+.
//   Audius    WORKS. Free, no key required, no ads, artists opt in to
//             third-party API use under the Open Music License.
//
// ⚠ MEASURED, NOT ASSUMED. `GET /v1/tracks/{id}/stream` answers 302 -> 307 ->
// 200 with `access-control-allow-origin: *`, `content-type: audio/mpeg` and
// `accept-ranges: bytes`. So a plain <audio> element plays it DIRECTLY: no
// iframe, no third-party player, no tracking pixel, and seeking works. That is
// the whole reason this beats every embed.
//
// ⚠ THIS IS NOT ROYALTY-FREE STOCK MUSIC and it is not the major-label
// catalogue either. It is ~1M tracks by real independent artists. There is no
// Top 40 here, and no platform gets that without the licensing spend above.

/** Sent on every request. Audius asks for it; no API key is needed. */
const APP = 'vergr';

/** One discovery host. `api.audius.co` load-balances across the network. */
const API = 'https://api.audius.co/v1';

export const AUDIUS_URL = 'https://audius.co';

/**
 * ⚠ EVERY ONE OF THESE FLAGS IS LOAD-BEARING, and a search WILL return tracks
 * that fail them — measured: 1 of 10 results for "lofi" had
 * `is_streamable: false`, and its stream endpoint 404s.
 *
 * `is_stream_gated` matters most: those are token- or follow-gated tracks whose
 * artist has deliberately restricted access. Playing one would be taking
 * something the artist chose to withhold.
 *
 * `allowed_api_keys` is an artist-level allowlist. Non-null means only those
 * apps may use the track, and Audius' own terms say the artist's settings
 * "carry over to the API" — so an unrecognised value is a NO, not a maybe.
 */
export const isPlayable = (t) => !!t
  && t.is_streamable === true
  && t.is_stream_gated !== true
  && t.is_available !== false
  && t.is_unlisted !== true
  && t.is_delete !== true
  && (t.allowed_api_keys == null || (Array.isArray(t.allowed_api_keys) && t.allowed_api_keys.length === 0));

/** True when Audius flags the track as explicit. */
export const isExplicit = (t) => !!t?.parental_warning_type;

/** Smallest artwork that still looks right on a 48px tile, with fallbacks. */
const artworkOf = (t) => t?.artwork?.['150x150'] || t?.artwork?.['480x480'] || t?.artwork?.['1000x1000'] || null;

/**
 * The stored shape. Deliberately DENORMALISED: title, artist and artwork are
 * copied onto the profile so rendering the player costs ZERO network calls.
 * A visitor's browser hits Audius only when audio actually plays.
 *
 * ⚠ Attribution is the reason `artist`, `permalink` and `license` are stored
 * rather than just the id. The popup that shows them IS the attribution, so
 * losing them would leave the track uncredited.
 */
export const toStored = (t) => ({
  source: 'audius',
  trackId: String(t.id),
  title: String(t.title || 'Untitled').slice(0, 200),
  artist: String(t.user?.name || t.user?.handle || 'Unknown artist').slice(0, 120),
  handle: String(t.user?.handle || '').slice(0, 120),
  artwork: artworkOf(t),
  permalink: String(t.permalink || '').slice(0, 300),
  license: String(t.license || '').slice(0, 120),
  duration: Number(t.duration) || 0,
  explicit: isExplicit(t),
});

/** Direct, CORS-open MP3 for an <audio> element. */
export const streamUrl = (trackId) =>
  `${API}/tracks/${encodeURIComponent(trackId)}/stream?app_name=${APP}`;

/** The artist's page, for the credit link in the player popup. */
export const trackUrl = (stored) =>
  (stored?.permalink ? `${AUDIUS_URL}${stored.permalink}` : AUDIUS_URL);

/**
 * Search, already filtered to what can legitimately be played.
 * Throws on network failure so the caller can show a real message rather than
 * an empty list that looks like "no results".
 */
export async function searchTracks(query, { limit = 20, signal } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const url = `${API}/tracks/search?query=${encodeURIComponent(q)}&limit=${limit}&app_name=${APP}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Audius search failed (${res.status})`);
  const json = await res.json();
  return (json?.data || []).filter(isPlayable).map(toStored);
}

/** mm:ss for the player. */
export const fmtDuration = (secs) => {
  const s = Math.max(0, Math.floor(Number(secs) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Genres offered as browse chips. All 20 were tested live and every one
 * returned 8/8 playable tracks, so none of them is a dead end.
 *
 * ⚠ ORDER IS DELIBERATE. Audius' catalogue is strongest in electronic and
 * hip-hop, so those lead. Putting Country or Classical first would show a
 * newcomer the thinnest part of the library.
 */
export const GENRES = [
  'Electronic', 'Hip-Hop/Rap', 'Lo-Fi', 'House', 'Techno', 'Dubstep',
  'Drum & Bass', 'Ambient', 'Pop', 'R&B/Soul', 'Rock', 'Metal', 'Punk',
  'Jazz', 'Classical', 'Country', 'Folk', 'Latin', 'Reggae', 'World',
];

/**
 * What is popular right now, optionally within one genre.
 *
 * ⚠ THIS IS THE DEFAULT VIEW, NOT SEARCH. Founder, 2026-08-25: a bare search
 * box "is going to be difficult for users, especially those like me who know
 * nothing about Audius... most of whom will search for songs by musicians like
 * Taylor Swift and get annoyed after the 3rd search that doesn't show results."
 * Exactly right: nobody should have to already know the catalogue to use it.
 * Tracks are on screen before anyone types.
 */
export async function trendingTracks({ genre, time = 'allTime', limit = 20, signal } = {}) {
  const g = genre ? `&genre=${encodeURIComponent(genre)}` : '';
  const res = await fetch(`${API}/tracks/trending?time=${time}&limit=${limit}${g}&app_name=${APP}`, { signal });
  if (!res.ok) throw new Error(`Audius trending failed (${res.status})`);
  const json = await res.json();
  return (json?.data || []).filter(isPlayable).map(toStored);
}

/**
 * ⚠ DEFAULTING TO 'allTime' IS THE WHOLE POINT, and the default before this was
 * WRONG. Founder: "i dont know or recognise any of this music, who even are
 * these artists are these just b grade music or what?"
 *
 * Fair, and the fault was the query, not the catalogue. Audius' trending window
 * ranks by RECENT activity, so it was serving tracks with 101-1,071 plays from
 * artists with 23-5,800 followers. Measured against time=allTime instead:
 *
 *   Skrillex      1,160,460 plays   392,737 followers
 *   Alina Baraz     863,168 plays    87,647 followers
 *   Miquela         641,884 plays    44,176 followers
 *   Zedd            376,610 plays   513,683 followers
 *
 * Verified artists genuinely on the platform: Skrillex, Disclosure (41 tracks),
 * Odesza (81), deadmau5 (9), RAC (19), Weezer, Diplo. They were always there;
 * the default query buried them under this week's uploads.
 *
 * So 'Popular' (allTime) leads, and 'New this week' is the secondary option for
 * anyone who wants fresh material.
 */
export const TIME_WINDOWS = [
  { id: 'allTime', label: 'Popular' },
  { id: 'month', label: 'This month' },
  { id: 'week', label: 'New' },
];
