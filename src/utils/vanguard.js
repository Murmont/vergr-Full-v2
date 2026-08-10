// Vanguard client-side helpers + identity mask.
//
// USAGE:
//   - Anywhere you render a user's display name + avatar publicly, run the
//     viewed user through `applyVanguardMask(user, viewer)` first. If the
//     viewed user is a Vanguard member AND the viewer is a normal user,
//     this returns the unified Vanguard persona instead. Other Vanguard
//     members + the founder see the real identity.
//   - To check if someone IS Vanguard: `isVanguard(user)` returns true if
//     the user doc has `vanguard.rank` set + `vanguard.status === 'active'`.
//
// The Vanguard rank lives on the user doc itself under `vanguard.*`. We
// considered a separate `vanguard_members/{uid}` collection — but every
// render of a user's name/avatar already loads the user doc, so co-locating
// the rank saves an extra round trip. The audit log + actions live in their
// own collections (see CLAUDE.md schema).
import { RANK_BY_ID, rankMeta as rankMetaImpl } from './vanguardRanks';

export const isVanguard = (user) => !!(user && user.vanguard && user.vanguard.rank && user.vanguard.status !== 'retired' && user.vanguard.status !== 'suspended');

export const vanguardRank = (user) => (isVanguard(user) ? user.vanguard.rank : null);

export const rankMeta = rankMetaImpl;

// True if `viewer` should see real identities of other Vanguard members
// (or themselves). Founder + active Vanguard members can see real identities.
export const canSeeRealVanguardIdentities = (viewer) => {
  if (!viewer) return false;
  if (viewer.role === 'admin') return true;
  return isVanguard(viewer);
};

// Replace a viewed user's display-name + avatar + profile link with the
// Vanguard persona, IF they are an active Vanguard AND the viewer is a
// normal user. Returns the original user otherwise.
//
// Returns: { displayName, username, avatar, badge, isVanguardPersona, hideProfileLink }
export const applyVanguardMask = (user, viewer) => {
  if (!isVanguard(user)) {
    return { ...user, isVanguardPersona: false };
  }
  if (canSeeRealVanguardIdentities(viewer)) {
    // Allies and founder see the real identity. Still add the badge so they
    // can visually identify rank in the roster.
    const meta = rankMetaImpl(user.vanguard.rank);
    return { ...user, vanguardBadge: meta.badge, vanguardRankLabel: meta.label, isVanguardPersona: false };
  }
  // Mask it.
  const meta = rankMetaImpl(user.vanguard.rank);
  return {
    uid: user.uid,
    displayName: meta.usernameTag,
    username:    meta.usernameTag.toLowerCase().replace(/\s+/g, ''),
    avatar:      meta.avatar,
    vanguardBadge: meta.badge,
    vanguardRankLabel: meta.label,
    vanguardJoinIcon: meta.join,
    isVanguardPersona: true,
    hideProfileLink: true,
    // intentionally NOT including: bio, posts, real createdAt, banner,
    // followers, following, wallet, email, etc.
  };
};

// Re-exports so screens only need one import.
export { VANGUARD_RANKS, RANK_BY_ID, RANK_IDS, RESERVED_USERNAMES, DEFAULT_RESERVED_SQUAD_NAMES, isHigherRank } from './vanguardRanks';
