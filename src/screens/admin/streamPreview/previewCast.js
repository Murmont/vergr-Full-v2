// Dummy population for the admin Stream Preview simulator.
//
// ⚠ NOTHING HERE IS REAL AND NOTHING HERE TOUCHES PRODUCTION. No Firestore, no
// relay socket, no camera, no callable. The simulator exists so the founder can
// screenshot every stream surface without going live and without a second real
// account, and so those screenshots are guaranteed to match what ships.
//
// ⚠ THE COPY IS SHIPPED. Play store screenshots are captured off this screen, so
// no value may read as a placeholder ("User 1", "Test", "[name]"). Handles are
// invented on purpose: a real streamer's handle would be impersonation and a
// real game title would be a trademark we have no licence to put on a listing.
//
// ⚠ RANKS DRIVE REAL ART. `rank` maps to RANK_BANNERS in src/utils/rankBanners.js
// and therefore to the founder's own entry-ribbon art in public/brand/entry/.
// Keep these ids valid or JoinAnnouncer falls back and the ribbon preview lies.

import { faceFor } from './previewFaces';

const withFace = (c) => ({ ...c, avatar: faceFor(c.uid, c.displayName) });

export const CAST = [
  { uid: 'c1', displayName: 'ZER0_kade', username: 'zer0kade', vpLevel: 94, rank: 'ascendant', sub: true , followers: 412000, following: 318, likes: 5200000, bio: 'ranked grinder. 3am scrims, zero excuses.' , accountDays: 412, priorTimeouts: 0 },
  { uid: 'c2', displayName: 'Priya_S', username: 'priya_s', vpLevel: 12, rank: 'contender' , followers: 8400, following: 291, likes: 96000, bio: 'chaos support main. i heal, i die, i heal again.' , accountDays: 16, priorTimeouts: 0 },
  { uid: 'c3', displayName: 'tomruns', username: 'tomruns', vpLevel: 38, rank: 'challenger' , followers: 61000, following: 140, likes: 740000, bio: 'speedruns and bad decisions.' , accountDays: 903, priorTimeouts: 1 },
  { uid: 'c4', displayName: 'nova_kill', username: 'novakill', vpLevel: 77, rank: 'legend', sub: true , followers: 1200000, following: 84, likes: 19000000, bio: 'aim is a personality trait.' , accountDays: 1470, priorTimeouts: 0 },
  // ⚠ ONE CAST MEMBER IS A MODERATOR so the Moderators tab and the
  // "Remove as moderator" state are capturable at all. Without it that tab is
  // permanently empty and looks broken rather than filtered.
  { uid: 'c5', displayName: 'Sable', username: 'sable', vpLevel: 55, rank: 'veteran', isMod: true , followers: 37000, following: 402, likes: 410000, bio: 'mod by day, silver by night.' , accountDays: 612, priorTimeouts: 0 },
  { uid: 'c6', displayName: 'Kai', username: 'kaiplays', vpLevel: 23, rank: 'contender' , followers: 2100, following: 512, likes: 24000, bio: 'here for the vibes and the loot.' , accountDays: 3, priorTimeouts: 2 },
  { uid: 'c7', displayName: 'Emma_Quinn', username: 'emmaq', vpLevel: 66, rank: 'mythic' , followers: 188000, following: 233, likes: 2600000, bio: 'cozy games, unhinged commentary.' , accountDays: 258, priorTimeouts: 0 },
  { uid: 'c8', displayName: 'Yves_SB', username: 'yvessb', vpLevel: 8, rank: 'rookie' , followers: 340, following: 611, likes: 2900, bio: 'new here. be nice.' , accountDays: 1, priorTimeouts: 0 },
].map(withFace);

// ⚠ THE VIEWER IS A PERSON TOO. Tapping the coin used to send { name: 'You' }
// with no uid and no avatar, so the one row the founder produces by CLICKING
// was the only row with an empty disc — and no upload could ever fill it.
// Listed in the rail beside everyone else.
export const PREVIEW_VIEWER = withFace({
  uid: 'you', displayName: 'You', username: 'you', vpLevel: 30, rank: 'challenger',
  followers: 128, following: 96, likes: 1400, bio: 'watching more than i play.',
  accountDays: 210, priorTimeouts: 0,
});

// ⚠ PREVIEW_VIEWER IS A PERSON AND MUST RESOLVE HERE TOO. It is exported
// separately from CAST (it is the person USING the preview, not someone in the
// room), so `castByUid('you')` silently fell through to `CAST[0]` — a message
// you sent yourself would have appeared under ZER0_kade's name and avatar. The
// fallback hid it: every lookup "worked", it was just the wrong person.
export const castByUid = (uid) =>
  CAST.find((c) => c.uid === uid) || (uid === PREVIEW_VIEWER.uid ? PREVIEW_VIEWER : CAST[0]);

// Chat that reads like a room reacting to a game, not like lorem ipsum. Mixed
// lengths on purpose: a feed of same-length lines never looks real, and the
// wrap behaviour of a long message is exactly the thing worth screenshotting.
export const CHAT_SCRIPT = [
  ['c2', 'first time here, this is sick'],
  ['c1', 'ok that was actually clean, I have been trying to land that all week and it never works for me'],
  ['c3', 'streaming again tomorrow?'],
  ['c6', 'the aim on this man'],
  ['c5', 'gg'],
  ['c4', 'chat he is so locked in right now'],
  ['c8', 'what sens are you on'],
  ['c2', 'LETS GOOO'],
  ['c7', 'been here since the start, worth it'],
  ['c3', 'how is he still alive'],
  ['c6', 'that flick was insane'],
  ['c1', 'run it back'],
  ['c5', 'the new mic sounds so much better'],
  ['c4', 'W stream'],
  ['c8', 'first'],
  ['c7', 'someone clip that'],
];

// Tip senders rotate so the feed shows BOTH behaviours: a repeat sender combos
// one row's counter up, while a different sender stacks as a new row.
// ⚠ EACH TIP NAMES A GIFT AND A QUANTITY, because the designed feed renders
// "Sent {gift}" and a big xN combo counter. Without a gift name every row read
// "Sent Rose"; without a qty every row read x1 and the counter — the thing the
// component exists for — could never be demonstrated in a capture.
//
// c1 appears TWICE with the SAME gift on purpose: firing the script through
// stacks that row to x36 instead of adding a second one, which is exactly the
// combo behaviour, and it is the only way to see it happen.
export const TIP_SCRIPT = [
  { uid: 'c1', coins: 12 },
  { uid: 'c4', coins: 100 },
  { uid: 'c6', coins: 8 },
  { uid: 'c1', coins: 24 },
  { uid: 'c7', coins: 250 },
];

export const SUB_SCRIPT = [
  { uid: 'c2', tierName: 'Member', badge: { color: '#7B6FFF', icon: 'star' } },
  { uid: 'c5', tierName: 'Gold', badge: { color: '#F0A500', icon: 'workspace_premium' } },
  { uid: 'c8', tierName: 'Member', badge: { color: '#7B6FFF', icon: 'star' } },
];

// Entry ribbons. `rank` decides which of the 11 founder banners is drawn, so
// firing these previews the REAL art at the REAL 280x70.
export const JOIN_SCRIPT = ['c4', 'c1', 'c7', 'c5', 'c3'];

// Held-message samples. Each one is held for a DIFFERENT reason, because a
// queue where every row says the same thing teaches the host nothing about what
// their dial is doing. `why` is the level that catches it.
// ⚠ `by` IS NOT DECORATION, IT IS THE DIFFERENCE BETWEEN AN ACCUSATION AND A
// PRECAUTION. 'scanner' means the moderation verdict said this text is hostile
// or sexual. 'rule' means the text is fine as far as anyone knows and the host
// simply asked to see first messages, or links, before they go out. Rendering
// both in the same red taught the host that a newcomer asking about sensitivity
// settings is the same kind of problem as a scam link, which is how benign
// people get denied and never come back.
export const HELD_SEED = [
  { id: 'h1', uid: 'c1', text: 'go back to whatever hole you crawled out of, you are actual garbage at this', why: 'hostility', level: 'light', by: 'scanner' },
  { id: 'h2', uid: 'c3', text: 'free coins here >> vergr-drops.link/claim', why: 'link', level: 'strict', by: 'rule' },
  { id: 'h3', uid: 'c8', text: 'first time watching, whats your sens', why: 'first message here', level: 'standard', by: 'rule' },
  { id: 'h4', uid: 'c6', text: 'lmao this guy is dogwater and probably smells too', why: 'hostility', level: 'light', by: 'scanner' },
];


let seq = 0;
export const nextId = () => `sim_${Date.now()}_${seq++}`;

/** A chat message in the shape ChatPanel rows expect. */
export function makeMessage(uid, text, extra = {}) {
  const c = castByUid(uid);
  return {
    id: nextId(),
    uid: c.uid,
    name: c.displayName,
    displayName: c.displayName,
    username: c.username,
    vpLevel: c.vpLevel,
    // ⚠ THE MOD FLAG HAS TO RIDE THE MESSAGE. A chat row cannot look a person
    // up, so a badge that is only on the cast entry can never be drawn.
    isMod: !!c.isMod,
    avatar: c.avatar,
    text,
    ts: Date.now(),
    ...extra,
  };
}

/**
 * A join event in the shape JoinRibbon actually reads.
 *
 * ⚠ IT READS `ev.user`, `ev.kind`, `ev.level` AND `ev.rankId` — NOT a flat
 * `{ name, avatar }`. Getting this wrong does not throw, it just renders an
 * empty ribbon with a fallback banner, which would have made the preview lie
 * about the one thing it exists to show. Checked against JoinAnnouncer.jsx:112.
 *
 * `rankId` wins over `level` (JoinRibbon prefers the rank the server stamped),
 * so passing it explicitly is what pins each cast member to a known banner
 * instead of leaving it to a level-to-band lookup.
 *
 * `kind` matters twice: a 'subscriber' gets the louder arrival sound, and
 * ENTRY_TIERS gives strangers a card only at L31+.
 */
export function makeJoinEvent(uid, kind = null) {
  const c = castByUid(uid);
  return {
    id: nextId(),
    kind: kind || (c.sub ? 'subscriber' : 'follower'),
    user: {
      uid: c.uid,
      displayName: c.displayName,
      username: c.username,
      avatar: c.avatar,
    },
    level: c.vpLevel,
    rankId: c.rank,
    ts: Date.now(),
  };
}
