// WHAT OCCUPIES THE RING AROUND AN AVATAR. Exactly one thing, ever.
//
// ── THE PROBLEM THIS SOLVES ─────────────────────────────────────────
//
// Four treatments had grown into the same 3-5px band around an 88px avatar:
// a rank-colour border, a champion frame, a live ring, and the accent orbit.
// They did not arbitrate, they STACKED, so the orbit — the one the user
// actually earned and equipped — was painted over by the rank border and
// invisible. Adding a fifth would not have helped; the band needed an owner.
//
// ── THE RULE (founder, 2026-08-24) ──────────────────────────────────
//
// The ring is SINGLE OCCUPANCY, resolved by priority:
//
//   1. LIVE          they are broadcasting right now
//   2. STATUS        they have a status this viewer has not seen
//   3. ORBIT         their equipped accent — the default decoration
//   4. nothing
//
// "If a user is live then it should replace the orbit ring obviously... if Vergr
// adds a status or goes live then the orbit ring gets replaced until they end
// their live or their status time ends, or the other user has already viewed
// their status, at which point the orbit ring shows again."
//
// So live and status are TRANSIENT STATES that borrow the band and give it back.
// The orbit is the resting state, not a loser in a fight.
//
// ⚠ THE RANK-COLOUR BORDER IS GONE, and that is not a style preference. It
// contradicted a LOCKED rule in CLAUDE.md: "rank shows in live chat and the
// stream entrance ribbon only, never on an avatar ring — that ring means live or
// status." Rank still reads loudly in chat and on the entry ribbon.
//
// ⚠ THE CHAMPION FRAME IS GONE because nothing can write it any more: its only
// writer was `functions/tournaments.js:2471`, deleted with the 70 tournament
// callables on 2026-08-17. It was a ring reserved for a state that can no longer
// occur. (`UserAvatar`'s `championFrame` prop is left in place — CoachingScreen
// still passes it — so removing the profile ring breaks nothing.)
//
// ── COST ────────────────────────────────────────────────────────────
//
// ZERO, and that is a hard constraint, not a nice-to-have. Every input must be
// something the screen ALREADY has:
//   * live   — `useLiveUsers()`, a context already mounted app-wide
//   * orbit  — `vpLevel` on the user doc the screen already loaded
//   * status — see the warning below
//
// ⚠ STATUS IS NOT WIRED YET, AND DELIBERATELY SO. There is no status context and
// no marker on the user doc, so answering "does this person have a status I have
// not seen" from a profile would cost a Firestore READ PER PROFILE VIEW. The
// founder ruled that out explicitly. The slot exists here so that the day a FREE
// signal appears the wiring is one argument, not a redesign.
//
// The free signal, when someone builds it: a `statusUntil` (ms) field on the
// user doc, written by the same write that already happens when a status is
// posted, compared against `isGroupSeen()` from `utils/statusSeen`, which is
// localStorage and costs nothing. NOT a query.

export const RING = {
  LIVE: 'live',
  STATUS: 'status',
  ORBIT: 'orbit',
  NONE: null,
};

/**
 * Which single treatment owns the ring.
 *
 * @param {object}  s
 * @param {boolean} [s.live]          broadcasting now
 * @param {boolean} [s.unseenStatus]  has a status this viewer has not opened
 * @param {boolean} [s.orbit]         the accent orbit is unlocked and enabled
 * @param {boolean} [s.masked]        a Vanguard persona shows nothing personal
 * @returns {'live'|'status'|'orbit'|null}
 */
export function avatarRing({ live = false, unseenStatus = false, orbit = false, masked = false } = {}) {
  // A masked persona reveals no identity, so it gets no accent — but it can
  // still be live, which is a fact about the broadcast and not about who they
  // are. Live therefore survives the mask; the orbit does not.
  if (live) return RING.LIVE;
  if (masked) return RING.NONE;
  if (unseenStatus) return RING.STATUS;
  if (orbit) return RING.ORBIT;
  return RING.NONE;
}
