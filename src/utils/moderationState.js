// Is this account muted, and until when.
//
// ⚠⚠ A MUTE USED TO DO NOTHING. `adminMuteUser` and `vanguardMuteUser` wrote
// `users/{uid}.mutedUntil` and the only readers were two admin screens showing
// it back to the admin. A muted person kept posting, commenting and messaging.
//
// The real enforcement is server-side: the mute rides the ID token as a custom
// claim and `firestore.rules` refuses posts, comments and messages while it is
// live (functions/bans.js setMuteClaim). This helper is the CLIENT half — it
// reads the profile snapshot UserContext already holds, so it costs no reads
// and it lands instantly, where a token refresh can take up to an hour.
//
// It is a courtesy, not the boundary. Never rely on it alone.

export function muteUntilMs(profile) {
  const v = profile?.mutedUntil;
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function isMuted(profile) {
  return muteUntilMs(profile) > Date.now();
}

export function muteNotice(profile) {
  const until = muteUntilMs(profile);
  if (until <= Date.now()) return null;
  let when;
  try {
    when = new Date(until).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch { when = null; }
  const reason = profile?.muteReason ? ` ${profile.muteReason}` : '';
  return when
    ? `You are muted until ${when}.${reason}`
    : `You are muted.${reason}`;
}
