// Gift a membership to another viewer.
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
import { useEffect, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import Icon from '../Icon';
import { CoinIcon } from '../CoinIcon';
import { getMembershipTiers } from '../../firebase/firestore';

const C = {
  card: '#14141F',
  row: '#1A1A2A',
  text: '#e8e8f0',
  textDim: '#a0a0b8',
  textMuted: '#6b7280',
  purple: '#7c3aed',
  purpleLight: '#b44fff',
};

export default function GiftSubSheet({ creatorId, recipient, onClose, showToast }) {
  const [tiers, setTiers] = useState([]);
  const [tierId, setTierId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

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

  const tier = tiers.find((t) => t.id === tierId) || null;
  const total = tier ? Math.max(0, Math.floor(tier.priceCoins || 0)) : 0;

  const send = async () => {
    if (busy || !tier || !recipient?.uid) return;
    setBusy(true);
    try {
      await httpsCallable(getFunctions(undefined, 'europe-west1'), 'giftMembership')({
        creatorId, tierId: tier.id, recipients: [recipient.uid],
      });
      showToast?.(`Gifted ${tier.name || 'a membership'} to ${recipient.displayName || 'them'}.`, 'success');
      onClose?.();
    } catch (err) {
      const code = String(err?.code || '');
      showToast?.(
        code.includes('already-exists') ? 'They are already a member of this channel.'
          : code.includes('failed-precondition') ? (err?.message || 'Not enough coins.')
            : 'Could not send that gift.',
        'error',
      );
    } finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 130, display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', background: C.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, paddingBottom: 'calc(18px + env(safe-area-inset-bottom))', maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4, color: C.text }}>
          Gift a sub to {recipient?.displayName || 'this viewer'}
        </div>
        <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.5, marginBottom: 14 }}>
          You pay, they get the perks. One month, and it does not renew.
        </div>

        {loading && <div style={{ fontSize: 12.5, color: C.textDim, padding: '10px 2px' }}>Loading tiers...</div>}

        {!loading && tiers.length === 0 && (
          <div style={{ fontSize: 12.5, color: C.textDim, padding: '10px 2px' }}>
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
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: 800 }}>{t.name || 'Member'}</span>
                  <CoinIcon size={13} />
                  <span style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                    {(t.priceCoins || 0).toLocaleString()}
                  </span>
                  <span style={{ fontSize: 11, color: on ? 'rgba(255,255,255,0.75)' : C.textMuted }}>/mo</span>
                </div>
                {Array.isArray(t.perks) && t.perks.length > 0 && (
                  <div style={{ fontSize: 11.5, color: on ? 'rgba(255,255,255,0.85)' : C.textDim, marginTop: 4, lineHeight: 1.45 }}>
                    {t.perks.slice(0, 3).join(' · ')}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onClose} disabled={busy} style={{ flex: 1, padding: 13, borderRadius: 12, border: 'none', background: C.row, color: C.textDim, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>Cancel</button>
          <button onClick={send} disabled={busy || !tier} style={{
            flex: 2, padding: 13, borderRadius: 12, border: 'none',
            background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`,
            color: '#fff', fontSize: 13, fontWeight: 800,
            cursor: (busy || !tier) ? 'default' : 'pointer', opacity: (busy || !tier) ? 0.5 : 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <Icon name="redeem" size={15} />
            {busy ? 'Sending...' : tier ? `Gift for ${total.toLocaleString()} coins` : 'Pick a tier'}
          </button>
        </div>
      </div>
    </div>
  );
}
