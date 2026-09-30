// Gift a membership to one viewer, or to several at once.
//
// Founder decisions, 2026-09-02, and each one is visible in this file:
//   NO GIFTER GATE   anyone may gift; there is no follower or tier requirement here
//   NO RENEWAL       the copy says "one month, it does not renew", because the
//                    recipient never entered payment details and must not be billed
//   NO DISCOUNT      the total is price x count and there is no quantity table
//
// THE PRICES ARE THE CREATOR'S, READ FROM THEIR TIERS. Nothing here invents a
// number: `getMembershipTiers` returns what the creator set on
// `creators/{uid}.membershipTiers`, and the server re-reads the same tier and
// recomputes the total before charging. The client never sends an amount.
//
// The callable is `giftMembership` (functions/memberships.js). It filters out
// anyone who already has an active membership and charges only for the gifts it
// can actually grant, so nobody pays for a no-op.
//
// ⚠⚠ BULK WAS HALF BUILT FOR FIVE DAYS. The callable has always accepted up to
// 25 recipients and this sheet sent exactly one, so the multi-gift the founder
// approved existed on the server and nowhere a person could reach it. Same shape
// as the co-host modal that was mounted in zero files.
//
// ⚠⚠ THE CANDIDATE LIST COSTS ZERO READS, AND THAT IS WHY IT IS A PROP. Both
// viewers already hold `topGifters` and the recent join events in memory, so the
// caller passes what it has. A user search here would be a Firestore query on
// every keystroke, which is spending money to find people who are already on
// screen.
//
// ⚠ NO "RANDOM" ANYWHERE. Twitch gifts to random viewers; the quick picks here
// take the TOP N of a list ordered by support, which is deterministic, reads as
// generosity rather than a draw, and keeps this feature well away from anything
// that could be read as a chance mechanic.
import { useEffect, useMemo, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import Icon from '../Icon';
import UserAvatar from '../UserAvatar';
import { CoinIcon } from '../CoinIcon';
import { getMembershipTiers } from '../../firebase/firestore';

const C = {
  card: '#14141F',
  row: '#1A1A2A',
  rowOn: '#241943',
  text: '#e8e8f0',
  textDim: '#a0a0b8',
  textMuted: '#6b7280',
  purple: '#7c3aed',
  purpleLight: '#b44fff',
};

// Mirrors the server's own ceiling (functions/memberships.js). If they ever
// disagree the sheet offers a basket the callable refuses, which is the failing
// button this codebase keeps producing.
const MAX_GIFTS = 25;

export default function GiftSubSheet({ creatorId, recipient, candidates = [], onClose, showToast }) {
  const [tiers, setTiers] = useState([]);
  const [tierId, setTierId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState(() => (recipient?.uid ? [recipient.uid] : []));

  useEffect(() => {
    if (!creatorId) return undefined;
    let alive = true;
    getMembershipTiers(creatorId)
      .then(({ tiers: t }) => {
        if (!alive) return;
        const published = (t || []).filter((x) => x.published !== false);
        setTiers(published);
        setTierId(published[0]?.id || null);
      })
      .catch(() => { if (alive) setTiers([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [creatorId]);

  // The named recipient is pinned first so the one-gift case is unchanged, then
  // everyone the caller had in memory, deduped.
  //
  // ⚠ THE CREATOR IS FILTERED OUT HERE, not just refused by the server. They
  // appear in their own top-gifters list on some channels, and the callable
  // rejects the WHOLE batch if they are in it, so leaving them selectable would
  // fail an otherwise good basket with a confusing message.
  const people = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const u of [recipient, ...candidates]) {
      const uid = u?.uid;
      if (!uid || uid === creatorId || seen.has(uid)) continue;
      seen.add(uid);
      out.push(u);
    }
    return out;
  }, [recipient, candidates, creatorId]);

  const tier = tiers.find((t) => t.id === tierId) || null;
  const price = tier ? Math.max(0, Math.floor(tier.priceCoins || 0)) : 0;
  const total = price * picked.length;

  const toggle = (uid) => setPicked((prev) => {
    if (prev.includes(uid)) return prev.filter((x) => x !== uid);
    if (prev.length >= MAX_GIFTS) return prev;
    return [...prev, uid];
  });
  const pickTop = (n) => setPicked(people.slice(0, Math.min(n, MAX_GIFTS)).map((u) => u.uid));

  const send = async () => {
    if (busy || !tier || !picked.length) return;
    setBusy(true);
    try {
      const res = await httpsCallable(getFunctions(undefined, 'europe-west1'), 'giftMembership')({
        creatorId, tierId: tier.id, recipients: picked,
      });
      // ⚠ REPORT WHAT THE SERVER GRANTED, NEVER WHAT WAS PICKED. It drops anyone
      // who is already a member and charges only for the rest, so echoing the
      // basket back would tell someone they gifted subs they were not charged
      // for and nobody received.
      const n = res?.data?.granted ?? picked.length;
      showToast?.(
        n === 1
          ? `Gifted ${tier.name || 'a membership'} to ${(people.find((u) => u.uid === picked[0])?.displayName) || 'them'}.`
          : `Gifted ${n} ${tier.name || 'memberships'}.`,
        'success',
      );
      onClose?.();
    } catch (err) {
      const code = String(err?.code || '');
      showToast?.(
        code.includes('already-exists') ? 'Everyone you picked is already a member.'
          : code.includes('failed-precondition') ? (err?.message || 'Not enough coins.')
            : 'Could not send that gift.',
        'error',
      );
    } finally { setBusy(false); }
  };

  // ⚠ WITH NO NAMED RECIPIENT THE PICKER IS THE WHOLE SHEET. The support tray
  // opens this for the room rather than for one person, and gating the picker on
  // "more than one candidate" left that case with a button reading "Pick who it
  // is for" and nothing to pick from.
  const multi = !recipient || people.length > 1;
  const pickedName = people.find((u) => u.uid === picked[0])?.displayName;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 130, display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', background: C.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, paddingBottom: 'calc(18px + var(--vg-safe-b, 0px))', maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4, color: C.text }}>
          {picked.length > 1
            ? `Gift ${picked.length} subs`
            : recipient
              ? `Gift a sub to ${recipient.displayName || 'this viewer'}`
              : picked.length === 1
                ? `Gift a sub to ${pickedName || 'this viewer'}`
                : 'Gift subs to viewers'}
        </div>
        <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.5, marginBottom: 14 }}>
          You pay, they get the perks. One month, and it does not renew.
        </div>

        {loading && <div style={{ fontSize: 13, color: C.textDim, padding: '10px 2px' }}>Loading tiers...</div>}

        {!loading && tiers.length === 0 && (
          <div style={{ fontSize: 13, color: C.textDim, padding: '10px 2px' }}>
            This creator has not set up memberships yet.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tiers.map((t) => {
            const on = t.id === tierId;
            return (
              <button key={t.id} type="button" onClick={() => setTierId(t.id)} style={{
                textAlign: 'left', padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                // a solid selected fill and a real value step, never a hairline ring
                background: on ? C.purple : C.row, border: 'none', color: '#fff',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 800 }}>{t.name || 'Member'}</span>
                  <CoinIcon size={13} />
                  <span style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                    {(t.priceCoins || 0).toLocaleString()}
                  </span>
                  <span style={{ fontSize: 11, color: on ? 'rgba(255,255,255,0.75)' : C.textMuted }}>/mo</span>
                </div>
                {Array.isArray(t.perks) && t.perks.length > 0 && (
                  <div style={{ fontSize: 12, color: on ? 'rgba(255,255,255,0.85)' : C.textDim, marginTop: 4, lineHeight: 1.45 }}>
                    {t.perks.slice(0, 3).join(' · ')}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {multi && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '18px 0 8px' }}>
              <span style={{ flex: 1, fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: C.textMuted }}>
                WHO GETS ONE
              </span>
              {[5, 10].filter((n) => people.length >= n).map((n) => (
                <button key={n} type="button" onClick={() => pickTop(n)} style={{
                  padding: '4px 10px', borderRadius: 999, border: 'none', cursor: 'pointer',
                  background: C.row, color: C.textDim, fontSize: 11, fontWeight: 800,
                }}>Top {n}</button>
              ))}
              {picked.length > 0 && (
                <button type="button" onClick={() => setPicked([])} style={{
                  padding: '4px 10px', borderRadius: 999, border: 'none', cursor: 'pointer',
                  background: C.row, color: C.textDim, fontSize: 11, fontWeight: 800,
                }}>Clear</button>
              )}
            </div>

            {people.length === 0 && (
              <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.5, padding: '6px 2px 10px' }}>
                Nobody to pick yet. Supporters and people who join this stream show up here as it goes on.
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 210, overflowY: 'auto' }}>
              {people.map((u) => {
                const on = picked.includes(u.uid);
                const full = !on && picked.length >= MAX_GIFTS;
                return (
                  <button key={u.uid} type="button" onClick={() => toggle(u.uid)} disabled={full} style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                    padding: '8px 10px', borderRadius: 10, border: 'none',
                    cursor: full ? 'default' : 'pointer', opacity: full ? 0.4 : 1,
                    background: on ? C.rowOn : C.row, textAlign: 'left',
                  }}>
                    <UserAvatar src={u.avatar} size="xs" />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {u.displayName || u.username || 'Viewer'}
                    </span>
                    {/* A tick, not a checkbox: the row is the target, and a real
                        input here would give two hit areas that can disagree. */}
                    <span style={{
                      flexShrink: 0, width: 20, height: 20, borderRadius: 999,
                      background: on ? C.purple : '#2A2A38',
                      display: 'grid', placeItems: 'center', color: '#fff',
                    }}>
                      {on && <Icon name="check" size={13} />}
                    </span>
                  </button>
                );
              })}
            </div>

            {picked.length >= MAX_GIFTS && (
              <div style={{ fontSize: 11, color: C.textDim, marginTop: 8 }}>
                {MAX_GIFTS} is the most that can go out at once.
              </div>
            )}
          </>
        )}

        {/* ⚠ THE ARITHMETIC IS STATED, BECAUSE THERE IS NO BULK DISCOUNT AND
            hiding that would be the kind of surprise a receipt should never
            carry. The server recomputes the same figure before charging. */}
        {picked.length > 1 && tier && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 14, fontSize: 12, color: C.textDim }}>
            <span>{picked.length} x {price.toLocaleString()}</span>
            <span style={{ opacity: 0.5 }}>·</span>
            <span>no bulk discount</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 11 }}>already a member? not charged</span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button onClick={onClose} disabled={busy} style={{ flex: 1, padding: 13, borderRadius: 12, border: 'none', background: C.row, color: C.textDim, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>Cancel</button>
          <button onClick={send} disabled={busy || !tier || !picked.length} style={{
            flex: 2, padding: 13, borderRadius: 12, border: 'none',
            background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`,
            color: '#fff', fontSize: 13, fontWeight: 800,
            cursor: (busy || !tier || !picked.length) ? 'default' : 'pointer',
            opacity: (busy || !tier || !picked.length) ? 0.5 : 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <Icon name="redeem" size={15} />
            {busy ? 'Sending...'
              : !tier ? 'Pick a tier'
                : !picked.length ? 'Pick who it is for'
                  : `Gift for ${total.toLocaleString()} coins`}
          </button>
        </div>
      </div>
    </div>
  );
}
