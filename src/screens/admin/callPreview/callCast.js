// Dummy population for the admin Call Preview simulator (/admin/call-preview).
//
// ⚠ NOTHING HERE IS REAL AND NOTHING HERE TOUCHES PRODUCTION. No getUserMedia,
// no RTCPeerConnection, no SFU socket, no Firestore, no callable, no wallet.
// The simulator exists so every call surface can be seen and screenshot without
// two real accounts on two real devices, and so those screenshots match what
// ships.
//
// ⚠ THE CAST IS THE STREAM PREVIEW'S CAST, DELIBERATELY. Not a copy, an import.
// A face the founder uploads is stored per UID in one IndexedDB store
// (streamPreview/previewAssets.js), so re-declaring people here with new uids
// would mean uploading every face twice and the two tools disagreeing about who
// nova_kill is. One population, two tools.
//
// ⚠ THE COPY IS SHIPPED. Captures from this screen are published material, so no
// value may read as a placeholder ("User 1", "Test", "[name]").

import { CAST, PREVIEW_VIEWER, castByUid, nextId } from '../streamPreview/previewCast';

export { CAST, PREVIEW_VIEWER, castByUid, nextId };

// The person on the other end of a 1:1. A call needs ONE named other party, and
// picking the first cast member at random per render would make two screenshots
// of the same call disagree.
export const CALL_PEER = castByUid('c4');

// ── Who is in a call ──────────────────────────────────────────────────────
//
// ⚠ A SEAT IS NOT A PERSON, IT IS A PERSON PLUS THEIR DEVICE STATE. The three
// things a call surface actually draws per participant are: are they speaking,
// is their mic on, is their camera on. A cast entry carries none of those, so a
// seat wraps one.
//
// ⚠ THE DEFAULTS ARE MIXED ON PURPOSE. A grid where every camera is on is the
// one arrangement that never happens and the one that teaches nothing: the
// interesting cases are the avatar fallback tile, the muted badge and the
// speaking ring, and a capture has to be able to show all three at once.
export const makeSeat = (uid, over = {}) => {
  const c = castByUid(uid);
  return {
    uid: c.uid,
    peerId: `peer_${c.uid}`,
    name: c.displayName,
    username: c.username,
    avatar: c.avatar,
    micOn: true,
    camOn: false,
    speaking: false,
    ...over,
  };
};

// Group call seats, in join order. Two cameras on, one muted, so the three
// states below are all present at the default of 3 guests.
export const GROUP_SEATS = [
  makeSeat('c4', { camOn: true }),
  makeSeat('c2', { camOn: true }),
  makeSeat('c5', { micOn: false }),
  makeSeat('c7'),
  makeSeat('c3', { camOn: true }),
  makeSeat('c6', { micOn: false }),
  makeSeat('c1'),
  makeSeat('c8'),
];

// Squad hangout seats. Voice-first by construction: SquadStreamScreen caps
// video publishers at 2 (MAX_VIDEO_PUBLISHERS), so no more than two of these
// may carry camOn or the preview would advertise a state the screen refuses.
export const SQUAD_SEATS = [
  makeSeat('c1', { camOn: true }),
  makeSeat('c7', { camOn: true }),
  makeSeat('c3'),
  makeSeat('c6', { micOn: false }),
  makeSeat('c2'),
  makeSeat('c8'),
];

// Voice channel seats. Audio only, always: voiceSession.js drops every
// non-audio remote track, so a camera here is not a thing that can happen.
export const CHANNEL_SEATS = [
  makeSeat('c5'),
  makeSeat('c3'),
  makeSeat('c2', { micOn: false }),
  makeSeat('c8'),
];

// ⚠ THE CHANNEL IS OWNED BY THE PERSON PREVIEWING IT so the owner-only controls
// (invite, delete, kick, per-member volume) are reachable at all. Flip `owner`
// in the rail to capture the member's view, which is the one most people see.
export const PREVIEW_CHANNEL = {
  id: 'vc_lategame',
  name: 'Late game',
  visibility: 'private',
  ownerId: PREVIEW_VIEWER.uid,
};

export const PREVIEW_GROUP = {
  id: 'g_thursdayfive',
  groupName: 'Thursday Five',
  memberCount: 9,
};

export const PREVIEW_SQUAD = {
  id: 'sq_nightshift',
  name: 'Night Shift',
  tag: 'NSFT',
};

// ── Call history, for the Calls hub ───────────────────────────────────────
//
// ⚠ FOUR OUTCOMES, NOT ONE. CallsScreen colours and labels missed / incoming /
// outgoing / no-answer differently, and a log where every row is a completed
// call cannot show the one row anybody scans for. `ago` is minutes back from
// now so the relative timestamps stay plausible however long the tool is open.
export const CALL_LOG = [
  { uid: 'c4', type: 'video', answered: true, outgoing: false, durationSec: 1847, ago: 12 },
  { uid: 'c2', type: 'audio', answered: false, outgoing: false, durationSec: 0, ago: 95 },
  { uid: 'c5', type: 'audio', answered: true, outgoing: true, durationSec: 412, ago: 260 },
  { uid: 'c7', type: 'video', answered: false, outgoing: true, durationSec: 0, ago: 1_180 },
  { uid: 'c1', type: 'audio', answered: true, outgoing: false, durationSec: 96, ago: 1_600 },
  { uid: 'c3', type: 'video', answered: true, outgoing: true, durationSec: 3_290, ago: 2_900 },
];

export const FAVOURITES = ['c4', 'c5', 'c1', 'c7'];

/** mm:ss, the format every call surface in the product uses. */
export const clock = (s) => {
  const n = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};
