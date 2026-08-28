// Central privacy enforcement for the Settings → Privacy controls.
//
// The Privacy screen persists these keys to users/{uid}.settings.privacy. This
// module is the single place that READS them so every surface enforces the same
// rules. readReceipts + onlineStatus are enforced separately (chat / presence).
//
// Visibility tiers: 'Everyone' | 'Friends & Followers' | 'Only me'.
//   "Friends & Followers" = there is a follow edge in either direction
//   (viewer follows target, or target follows viewer / mutual = friend).
//
// Relationship checks cost up to 2 doc reads, so use the async helpers at
// single-target action points (open profile, start DM, mention, comment…). For
// bulk lists use the synchronous absolute helpers (hiddenFromDiscovery), which
// only need the target's own settings.

import { isFollowing } from '../firebase/firestore';

export const PRIVACY_DEFAULTS = {
  profileVis: 'Everyone', searchVis: 'Everyone',
  receiveMsg: 'Friends & Followers', msgReq: true,
  tagMe: 'Friends & Followers',
  readReceipts: true, onlineStatus: true,
  // activityFeed, friendReq and allowDownloads removed 2026-08-19 (audit A18):
  // all three had zero enforcement callers, and none could be given any. There
  // is no activity feed, no friend-request feature anywhere in the codebase,
  // and no honest place to enforce a download ban (see PrivacySettingsScreen).
  // Existing stored values are simply ignored; nothing reads them.
  //
  // viewContent + shareContent removed as options (founder 2026-06-16): their
  // "Friends & Followers" default would break public browsing app-wide.
  commentContent: 'Everyone',
  suggestedUsers: true, hashtagSearch: true, showTrending: false,
};

export const getPrivacy = (user) => ({ ...PRIVACY_DEFAULTS, ...(user?.settings?.privacy || {}) });

// Resolve the viewer↔target relationship via follow edges.
export const getRelationship = async (viewerId, targetId) => {
  if (!viewerId || !targetId || viewerId === targetId) {
    return { isSelf: viewerId === targetId, viewerFollowsTarget: false, targetFollowsViewer: false, isFriend: false };
  }
  const [a, b] = await Promise.all([
    isFollowing(viewerId, targetId).catch(() => false),
    isFollowing(targetId, viewerId).catch(() => false),
  ]);
  return { isSelf: false, viewerFollowsTarget: a, targetFollowsViewer: b, isFriend: a && b };
};

// Does a relationship satisfy a visibility tier value?
export const passesVisibility = (value, rel) => {
  if (rel?.isSelf) return true;
  switch (value) {
    case 'Only me': return false;
    case 'Friends & Followers': return !!(rel?.viewerFollowsTarget || rel?.targetFollowsViewer);
    case 'Everyone':
    default: return true;
  }
};

// ── Single-target async gates (viewerId, targetUserDoc) → Promise<boolean> ──

const tierGate = (key) => async (viewerId, targetUser) => {
  if (!targetUser) return true;
  const targetId = targetUser.id || targetUser.uid;
  if (!viewerId || viewerId === targetId) return true;
  const rel = await getRelationship(viewerId, targetId);
  return passesVisibility(getPrivacy(targetUser)[key], rel);
};

export const canViewProfile = tierGate('profileVis');
export const canCommentOn = tierGate('commentContent');
export const canTagUser = tierGate('tagMe');

// Messaging respects both the visibility tier AND the message-request toggle:
// when msgReq is false, only an existing follow relationship may start a chat.
export const canMessageUser = async (viewerId, targetUser) => {
  if (!targetUser) return true;
  const targetId = targetUser.id || targetUser.uid;
  if (!viewerId || viewerId === targetId) return true;
  const p = getPrivacy(targetUser);
  const rel = await getRelationship(viewerId, targetId);
  if (!passesVisibility(p.receiveMsg, rel)) return false;
  if (!p.msgReq && !(rel.viewerFollowsTarget || rel.targetFollowsViewer)) return false;
  return true;
};

// canSendFriendRequest, canDownloadContentOf and showsActivityFeed were removed
// 2026-08-19 with the settings they read (audit A18). Each had ZERO callers, so
// each was a privacy promise the app never kept. They are deleted rather than
// left here, because a helper with no callers is what let the switches ship in
// the first place: the module looked like it enforced them.
//
// If a friend-request system or an activity feed is ever built, the helper
// comes back WITH it and with a call site, in the same change.
//
// `canCommentOn` above is now genuinely enforced, at addComment in
// firebase/firestore.js.

// ── Synchronous absolute filters for bulk lists (no relationship reads) ──
// A user is hidden from a discovery surface when their setting forbids it for
// non-followers. We treat 'Friends & Followers'/'Only me' visibility and the
// false discoverability toggles as "don't surface to strangers".
export const hiddenFromDiscovery = (user, kind) => {
  const p = getPrivacy(user);
  switch (kind) {
    case 'search': return p.searchVis !== 'Everyone';
    case 'suggested': return p.suggestedUsers === false || p.searchVis === 'Only me';
    case 'hashtag': return p.hashtagSearch === false;
    case 'trending': return p.showTrending === false;
    default: return false;
  }
};

// Filter a list of hydrated user docs for a discovery surface, always keeping self.
export const filterDiscoverable = (users, kind, selfId) =>
  (users || []).filter(u => (u && ((u.id || u.uid) === selfId)) || !hiddenFromDiscovery(u, kind));
