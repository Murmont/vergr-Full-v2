// src/utils/streamVisibility.js
//
// One question, asked the same way everywhere: may this live stream appear in a
// list the viewer did not specifically ask for?
//
// ## Why this file exists
//
// `createStreamSession` has always written `unlisted` and `discoverable` onto
// the stream document for followers-only, friends-only and 1:1 sessions. NOTHING
// READ THEM. Eight separate places queried `streams where status == 'live'` and
// rendered whatever came back: Explore (web and native), Shorts (web and
// native), the home rail, and the live-ring that lights up an avatar.
//
// So a private session showed the host as LIVE to everyone, which is the worst
// class of bug this app can have — the user believed they were in a closed room
// and were not.
//
// The check lives here, in one place, because eight copies of a privacy rule is
// seven chances to forget one.
//
// ## Why it filters in JS rather than in the query
//
// A `where('discoverable','==',true)` clause would need a composite index per
// call site AND would silently drop every stream created before the field
// existed, since Firestore cannot match a missing field. Filtering the returned
// page is a few microseconds and is correct for legacy documents.

/**
 * True when a stream belongs in discovery: Explore, Shorts, rails, live rings,
 * recommendations, anything the viewer did not navigate to directly.
 *
 * Deliberately fails CLOSED on the flags: `discoverable === false` and
 * `unlisted === true` both hide it. A document with neither field is a legacy
 * public stream and stays visible, which is why the test is `!== false` rather
 * than `=== true`.
 */
export function isDiscoverableStream(s) {
  if (!s) return false;
  if (s.unlisted === true) return false;
  if (s.discoverable === false) return false;
  // A 1:1 is never discoverable regardless of how the other flags were written.
  // Belt and braces: this is the field the server stamps, and it is the one that
  // cannot be true by accident.
  if (s.sessionType === 'one_to_one') return false;
  // 'ticketed' and the relationship-gated audiences are joinable only from the
  // surface that knows about them.
  if (s.audience === 'followers' || s.audience === 'friends' || s.audience === 'unlisted') return false;
  return true;
}

/** Convenience for the common `snap.docs` / array case. */
export const filterDiscoverableStreams = (list) => (list || []).filter(isDiscoverableStream);
