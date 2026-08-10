// Public-enumeration filter — keeps high-value operator accounts off
// public surfaces (search results, member rosters, follow lists, browse
// players, tournament participants).
//
// Why: founder's `role === 'admin'` account is the keys-to-the-kingdom.
// Anything that lets attackers ENUMERATE the operator account is reconnaissance.
// Search results + rosters + follow lists are the obvious ones.
//
// Anti-enumeration rules:
//   - `user.role === 'admin'` → ALWAYS hidden from public enumeration
//   - `user.hideFromEnumeration === true` → opt-in flag, hidden too
//
// The filter is applied CLIENT-SIDE. Server-side rules block access to
// admin accounts via the existing isAdmin check. This client filter is
// defense-in-depth + correct UX for normal users (admins shouldn't pop
// up in their search results).

/**
 * Returns true if this user should be removed from any public enumeration
 * surface. Admins + opt-in users are filtered.
 */
export function shouldHideFromEnumeration(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.hideFromEnumeration === true) return true;
  return false;
}

/**
 * Anonymous "browse without signing up" accounts. AuthContext.signInAsGuest
 * stamps BOTH markers, so either one identifies a guest (a partially-written
 * doc still gets caught).
 *
 * Deliberately NOT folded into `shouldHideFromEnumeration`: that helper also
 * backs `canDmTarget`, where a true result applies the founder's account-age +
 * VP DM gate. Guests are not operator accounts — they just aren't people you
 * can follow, recruit or message, so they belong out of LISTS only.
 */
export function isGuestAccount(user) {
  if (!user) return false;
  if (user.isGuest === true) return true;
  return /^guest_/i.test(String(user.username || ''));
}

/**
 * Filter an array of users, dropping anyone who shouldn't be enumerated.
 * Use this on any list that's about to be shown to a non-admin viewer:
 * search results, member rosters, follow lists, etc.
 *
 * The current viewer is passed so we never hide a viewer from themselves
 * (a founder browsing the platform still wants to find their own profile).
 */
export function filterForEnumeration(users, viewer) {
  if (!Array.isArray(users)) return users;
  const viewerIsAdmin = viewer?.role === 'admin';
  return users.filter((u) => {
    if (!u) return false;
    const uid = u.id || u.uid || u.userId;
    // Always keep the viewer's own record visible to themselves.
    if (uid && viewer?.uid && uid === viewer.uid) return true;
    // Guests drop for EVERYONE including admins — an anonymous browsing
    // session is not a person to list, so showing it to the operator is
    // just noise (this is what put "Guest / LVL 1" rows all over Browse
    // Players). The admin bypass below is about operator/hidden accounts.
    if (isGuestAccount(u)) return false;
    if (viewerIsAdmin) return true;  // admin sees every real account
    return !shouldHideFromEnumeration(u);
  });
}

/**
 * DM gate — can `senderProfile` send a DM to `targetProfile`?
 * The founder account blocks DMs from accounts younger than 30 days OR
 * with VP < 1000, to reduce social-engineering vectors.
 *
 * Returns { allowed: bool, reason?: string }.
 */
export function canDmTarget(targetProfile, senderProfile, senderWallet) {
  if (!targetProfile) return { allowed: true };
  // Only gate DMs to admin / hide-flagged accounts. Normal users keep open DMs.
  if (!shouldHideFromEnumeration(targetProfile)) return { allowed: true };

  // Founder self-DM-test is allowed.
  if (senderProfile?.uid && senderProfile.uid === targetProfile.uid) return { allowed: true };
  if (senderProfile?.role === 'admin') return { allowed: true };

  // Account age check.
  const created = senderProfile?.createdAt;
  const createdMs = created?.toDate ? created.toDate().getTime() : created?.seconds ? created.seconds * 1000 : 0;
  const ageDays = createdMs ? Math.floor((Date.now() - createdMs) / 86400_000) : 9999;
  if (ageDays < 30) {
    return { allowed: false, reason: 'Accounts under 30 days old cannot DM this user.' };
  }
  const vp = senderWallet?.vp || 0;
  if (vp < 1000) {
    return { allowed: false, reason: 'Need at least 1,000 VP to DM this user.' };
  }
  return { allowed: true };
}
