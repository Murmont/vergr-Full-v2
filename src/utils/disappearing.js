// Disappearing messages / auto-delete (02_MESSAGING 2.3).
//
// Durations match Telegram's auto-delete set (founder: "same time as Telegram
// does"): Off / 1 day / 1 week / 1 month.
//
// `ttlSeconds` lives on the conversation doc. The relay sweeps and HARD-deletes
// expired bodies server-side (infra/chat/disappearing.go); this module is the
// CLIENT half, which hides expired messages immediately by timestamp so a
// message disappears on its timer rather than whenever the 60s sweep next runs.

export const TTL_OPTIONS = [
  { seconds: 0, label: 'Off', short: '' },
  { seconds: 86400, label: '1 day', short: '1d' },
  { seconds: 604800, label: '1 week', short: '1w' },
  { seconds: 2592000, label: '1 month', short: '1m' },
];

export function ttlLabel(seconds) {
  const s = Number(seconds) || 0;
  const hit = TTL_OPTIONS.find((o) => o.seconds === s);
  if (hit) return hit.label;
  // Custom values (set elsewhere / future) still render sensibly.
  if (s >= 2592000) return `${Math.round(s / 2592000)} months`;
  if (s >= 604800) return `${Math.round(s / 604800)} weeks`;
  if (s >= 86400) return `${Math.round(s / 86400)} days`;
  if (s >= 3600) return `${Math.round(s / 3600)} hours`;
  if (s > 0) return `${Math.round(s / 60)} minutes`;
  return 'Off';
}

export function ttlShort(seconds) {
  const s = Number(seconds) || 0;
  const hit = TTL_OPTIONS.find((o) => o.seconds === s);
  return hit ? hit.short : (s > 0 ? ttlLabel(s) : '');
}

/**
 * Drop messages older than the conversation's TTL.
 *
 * Applied at render time (not by mutating state) so a message vanishes exactly
 * when it expires, without waiting for the relay's sweep. Messages with no
 * usable timestamp are KEPT: a message must never disappear because we failed
 * to read its clock.
 */
export function filterExpired(messages, ttlSeconds, nowMs = Date.now()) {
  const ttl = Number(ttlSeconds) || 0;
  if (!ttl || !Array.isArray(messages)) return messages;
  const cutoff = nowMs - ttl * 1000;
  return messages.filter((m) => {
    if (m?._type || m?.type === 'system') return true; // day separators, system rows
    const ms = m?.createdAt?.toDate ? m.createdAt.toDate().getTime() : 0;
    if (!ms) return true;
    return ms > cutoff;
  });
}
