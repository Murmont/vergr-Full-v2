// Who is allowed to do what on a live stream — the ONE resolver for the
// simulator, mirroring the server.
//
// ⚠⚠ THE PREVIEW HAD THIS EXACTLY INVERTED, AND THE FOUNDER FOUND IT.
// Every desktop VIEWER was given the full moderation panel — slow mode,
// followers-only, subscribers-only, timeout/ban, clear chat — while the
// BROADCASTER, who owns the stream, had no moderation control anywhere on
// either device. A capture of that screen advertises to the Play store that
// anyone watching can ban anyone.
//
// ⚠ AND THE PANEL DOCUMENTED ITS OWN GATE WITHOUT IMPLEMENTING IT: its footer
// literally read "Broadcaster / moderator only" while rendering unconditionally.
// Same class as the three inert kill switches in CLAUDE.md — a control that is
// trusted and does nothing, or in this case a caption that is trusted and gates
// nothing.
//
// ── The rule is NOT invented here. It is read off the deployed server. ──
//
// functions/streamChatMod.js has two loaders and every callable uses one:
//
//   loadStream(streamId, uid)        → hostUid === uid            (HOST ONLY)
//       setStreamModerator, setStreamBannedWords, setStreamSlowMode,
//       setStreamFollowersOnly, setStreamTts
//
//   loadStreamForMod(streamId, uid)  → hostUid === uid            (HOST OR MOD)
//                                      || moderatorUids.includes(uid)
//       muteViewer, unmuteViewer, banViewer, unbanViewer, pinStreamMessage
//
// So "moderation" is two tiers, not one, and the preview must not offer a
// moderator a control the server will refuse.
//
// ⚠⚠ TWO DIFFERENT KINDS OF MODERATOR, AND I CONFLATED THEM (founder, 2026-09-02).
//
//   STREAM MODERATOR — someone the BROADCASTER picked to help run THEIR room.
//     Lives in `streams/{id}.moderatorUids`. This is who the mod tier is for.
//
//   VANGUARD — Vergr's own platform-wide moderator collective
//     (src/utils/vanguardRanks.js). They moderate the APP, not one creator's room.
//
// ⚠ I GAVE VANGUARD THE STREAM-MOD TIER AND THE SERVER DOES NOT.
// `loadStreamForMod` (streamChatMod.js:47) is exactly:
//     hostUid === uid || moderatorUids.includes(uid)
// There is no Vanguard branch anywhere in that file. So showing a Vanguard the
// mute/ban/pin controls put a control on screen that the server answers with
// `permission-denied` — the precise defect the header above warns about, committed
// while writing the warning.
//
// A Vanguard still MODERATES, through the Vanguard callables (`vanguard.js`), which
// are a separate authority with their own audit trail. They are simply not the
// broadcaster's moderators, and this file is about the broadcaster's stream.

/** Roles the simulator can render. `host` is the broadcaster's own view. */
export const PREVIEW_ROLES = [
  { id: 'viewer', label: 'Viewer' },
  { id: 'moderator', label: 'Moderator' },
  { id: 'vanguard', label: 'Vanguard' },
];

/**
 * Mute, ban, timeout, pin, clear — mirrors `loadStreamForMod` EXACTLY:
 *   hostUid === uid || moderatorUids.includes(uid)
 *
 * ⚠ VANGUARD IS DELIBERATELY ABSENT. They are the platform's moderators, not this
 * broadcaster's, and these callables refuse them. Adding them back here puts
 * controls on screen that return `permission-denied`.
 */
export function canModerate(role) {
  return role === 'host' || role === 'moderator';
}

/**
 * The broadcaster's private mod channel.
 *
 * ⚠⚠ WHOSE TOOL IT IS AND WHO CAN SEE IT ARE TWO DIFFERENT QUESTIONS, and answering
 * the second with the first is the mistake that was made here twice, in opposite
 * directions. It is the BROADCASTER'S OWN TEAM's tool — founder, 2026-09-02:
 * *"do you think tiktok moderators (who work for tiktok) have a fucking chat on each
 * live stream? its for the broadcasters fucking mods"*. The channel exists so the
 * people running THIS room can coordinate a ban without the person being banned
 * reading it, and every design choice serves them.
 *
 * ⚠ BUT VANGUARD READ IT, SILENTLY, AND THAT IS THE SHIPPED SERVER MODEL — not an
 * oversight in this list. `canJoinModRoom` (infra/chat/src/main.go, covered by
 * modroom_test.go) grants host / moderatorUids / any Vanguard rank. Founder,
 * 2026-09-02: *"why the fuck would you prevent a platform moderator from seeing
 * private rooms?"* A private room the platform cannot see is a moderation blind
 * spot, and this is the room where it matters most: small, private, and occupied by
 * people with power over other users.
 *
 * ⚠ SILENT TO THE ROOM, NEVER SILENT IN THE LOG. The relay keeps them out of the
 * peer list and out of presence (`Peer.silent`) so a named platform moderator is not
 * identified by elimination in a three-person room — which is also what protects the
 * identity mask CLAUDE.md requires — and every join writes a `vanguard_actions` row.
 *
 * ⚠⚠ SO THIS IS **NOT** THE SAME SET AS `canModerate`, and a comment here claimed it
 * was for a whole wave after the sets diverged. `canModerate` mirrors
 * `loadStreamForMod`, which has no Vanguard branch, so a Vanguard gets read access to
 * the room and NOT the mute/ban tier. Two functions, two answers, deliberately.
 */
export function canUseModChannel(role) {
  return role === 'host' || role === 'moderator' || role === 'vanguard';
}

/**
 * Slow mode, followers-only, banned words, appointing moderators — mirrors
 * `loadStream`. ⚠ A MODERATOR MUST NOT SEE THESE. Showing them would put a
 * control on screen that the server answers with `permission-denied`, which is
 * worse than not showing it at all.
 */
export function canConfigureChat(role) {
  return role === 'host';
}

/** The badge a chat identity shows for this role, or null for a plain viewer. */
export function roleBadge(role) {
  if (role === 'host') return { label: 'HOST', color: '#7c3aed' };
  if (role === 'moderator') return { label: 'MOD', color: '#22c55e' };
  if (role === 'vanguard') return { label: 'VANGUARD', color: '#F5C842' };
  return null;
}
