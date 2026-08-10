// Hook + helpers that apply the Vanguard identity mask using the viewing
// user as the context. ⚠️ READ ME BEFORE TOUCHING AUTHOR CHIPS.
//
// THE GROUND RULE: any user-rendering surface that is PUBLIC (visible to
// general users) must pass the user object through this hook before reading
// `.displayName` / `.username` / `.avatar`. If the rendered user is an
// active Vanguard member and the VIEWER is not Vanguard / not founder, the
// hook returns the Vanguard persona — rank's `usernameTag` ("Vanguard",
// "Commander", etc.), rank's avatar, rank's badge.
//
// Allies (other Vanguard) and the founder see the real identity, plus a
// rank badge so they can identify each other in the roster + audit log.
//
// ──────────────────────────────────────────────────────────────────
// What this DOES NOT do automatically:
//  - Hide the masked user's posts/comments/likes from public listings.
//    A Vanguard member's posts are still visible — they just appear
//    authored by "@Vanguard" with the rank avatar. (If you don't want
//    them posting publicly at all, that's a separate enforcement layer.)
//  - Redirect /user/{realUid} → a generic Vanguard persona screen. That
//    redirect lives in PublicProfileScreen so non-Vanguard viewers can't
//    deep-link to a moderator's real profile. See `PublicProfileScreen`
//    for the gate.
// ──────────────────────────────────────────────────────────────────
//
// Usage:
//   const masked = useMaskedUser(post.author);
//   <UserAvatar src={masked.avatar} />
//   <span>{masked.displayName}</span>
//   {masked.vanguardBadge && <img src={masked.vanguardBadge} />}
//
// Where to NOT use it:
//   - Inside the founder /admin/vanguard dashboard (you want real names there)
//   - Inside the moderator /vanguard/me Roster tab (Vanguard see each other)
//   - When the user is the viewer themselves (they see their own real
//     identity in Settings, on their wallet etc.)
import { useMemo } from 'react';
import { useUser } from '../context/UserContext';
import { applyVanguardMask, isVanguard } from '../utils/vanguard';

export default function useMaskedUser(user) {
  const { profile: viewer } = useUser();
  return useMemo(() => applyVanguardMask(user, viewer), [user, viewer]);
}

// Mask a list of users in one call (useful for follower lists etc.).
export function useMaskedUsers(users) {
  const { profile: viewer } = useUser();
  return useMemo(() => (users || []).map((u) => applyVanguardMask(u, viewer)), [users, viewer]);
}

// Re-export so screens only need one import path.
export { isVanguard };
