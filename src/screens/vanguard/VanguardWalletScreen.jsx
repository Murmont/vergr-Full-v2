// /vanguard/wallet — VP & Wallet. Design ref: Vanguard VP & Wallet.png
// Real data only: live wallet (vp/coins/gems), VP level from vpSystem, and the
// member's own moderation actions from vanguard_actions. No dummy fallback.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import VanguardLayout, { VG_COLORS as C, VanguardPageHeader, VgCard } from '../../components/vanguard/VanguardLayout';
import Icon from '../../components/Icon';
import { useUser } from '../../context/UserContext';
import { getMyVanguardActions } from '../../firebase/firestore';
import { rankMeta } from '../../utils/vanguardRanks';
import { getVPLevel, getNextVPLevel, getVPProgress, getCommission } from '../../utils/vpSystem';

const fmt = (n) => Number(n || 0).toLocaleString();
const tsMs = (t) => (t?.toDate ? t.toDate().getTime() : t?.seconds ? t.seconds * 1000 : (t instanceof Date ? t.getTime() : Number(t) || 0));
const fmtAgo = (date) => {
  const ms = tsMs(date);
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
};

export default function VanguardWalletScreen() {
  const navigate = useNavigate();
  const { profile, wallet: realWallet } = useUser();
  const [actions, setActions] = useState(null); // null = loading

  useEffect(() => {
    let alive = true;
    if (profile?.uid) {
      getMyVanguardActions(profile.uid, 50).then((r) => { if (alive) setActions(r || []); }).catch(() => { if (alive) setActions([]); });
    } else {
      setActions([]);
    }
    return () => { alive = false; };
  }, [profile?.uid]);

  const vp = realWallet?.vp || 0;
  const coinBalance = realWallet?.balance || 0;
  const myRank = profile?.vanguard?.rank || 'recruit';
  const meta = rankMeta(myRank);

  const levelInfo = getVPLevel(vp);
  const currentLevel = levelInfo.level;
  const next = getNextVPLevel(vp);
  const vpToNext = next ? Math.max(0, next.vpRequired - vp) : 0;
  const pct = getVPProgress(vp);
  const maxVp = getVPLevel(Number.MAX_SAFE_INTEGER).vpRequired;
  const vpToL100 = Math.max(0, maxVp - vp);
  const withdrawalCommission = Math.round(getCommission(vp) * 100);

  const list = actions || [];
  const now = Date.now();
  const within = (ms) => list.filter((a) => now - tsMs(a.takenAt) <= ms).length;
  const todayActions = within(86400_000);
  const weekActions = within(7 * 86400_000);
  const monthKey = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
  const monthActions = profile?.vanguard?.monthlyActions?.[monthKey] ?? within(30 * 86400_000);

  return (
    <VanguardLayout page="wallet">
      <VanguardPageHeader title="VP & Wallet" subtitle="Your Vanguard Points, coins and wallet actions." />

      {/* Top: balance hero + level progress + distance to L100 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, marginBottom: 14 }}>
        <VgCard>
          <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 8 }}>Your VP balance</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <img src="/brand/vp-gem.webp" alt="" style={{ height: 36 }} />
            <div style={{ fontFamily: 'DM Mono', fontSize: 32, fontWeight: 800, color: C.text, lineHeight: 1 }}>{fmt(vp)}</div>
            <div style={{ fontFamily: 'DM Sans', fontSize: 14, color: C.violetLt, fontWeight: 700 }}>VP</div>
          </div>
          <div style={{ fontFamily: 'DM Sans', fontSize: 12, color: C.textDim, marginTop: 8 }}>+{meta.actionVp} VP per moderation action</div>
        </VgCard>

        <VgCard>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em' }}>Current level</div>
            <span style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: C.violetLt }}>{meta.label}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <div style={{ fontFamily: 'DM Mono', fontSize: 32, fontWeight: 800, color: C.text, lineHeight: 1 }}>{currentLevel}</div>
            <div style={{ fontFamily: 'DM Sans', fontSize: 13, color: C.textDim }}>of 100</div>
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={{ height: 8, background: C.card2, borderRadius: 999, overflow: 'hidden', border: `1px solid ${C.border}` }}>
              <div style={{ width: `${pct}%`, height: '100%', background: `linear-gradient(90deg, ${C.violet}, ${C.violetLt})` }} />
            </div>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: C.textDim, marginTop: 6 }}>{next ? `${fmt(vpToNext)} VP to Lvl ${currentLevel + 1}` : 'Max level reached'}</div>
          </div>
        </VgCard>

        <VgCard style={{ background: `linear-gradient(135deg, ${C.card}, rgba(180,79,255,.05))` }}>
          <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 8 }}>Distance to Lvl 100</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 60, height: 60, borderRadius: '50%',
              background: `conic-gradient(${C.violetLt} ${pct}%, ${C.card2} 0)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: C.card, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'DM Mono', fontWeight: 800, color: C.violetLt, fontSize: 13 }}>100</div>
            </div>
            <div>
              <div style={{ fontFamily: 'DM Mono', fontSize: 22, fontWeight: 800, color: C.text, lineHeight: 1 }}>{fmt(vpToL100)}</div>
              <div style={{ fontFamily: 'DM Sans', fontSize: 11, color: C.textDim, marginTop: 4 }}>VP to Immortal (L100) — unlock 5% withdraw rate</div>
            </div>
          </div>
        </VgCard>
      </div>

      {/* VP per action by rank */}
      <VgCard style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 12 }}>VP per action by rank</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
          {['recruit', 'vanguard', 'senior', 'commander', 'overseer'].map((r) => {
            const m = rankMeta(r);
            const isMine = r === myRank;
            return (
              <div key={r} style={{
                padding: 12,
                background: isMine ? 'rgba(180,79,255,.1)' : C.card2,
                border: `1px solid ${isMine ? 'rgba(180,79,255,.3)' : C.border}`,
                borderRadius: 10,
                textAlign: 'center',
              }}>
                <img src={m.badge} alt="" style={{ height: 26, marginBottom: 6 }} />
                <div style={{ fontFamily: 'DM Sans', fontSize: 11.5, color: isMine ? C.violetLt : C.textDim, fontWeight: 700 }}>{m.label}</div>
                <div style={{ fontFamily: 'DM Mono', fontSize: 18, fontWeight: 800, color: isMine ? C.text : C.textDim, marginTop: 4 }}>+{m.actionVp}</div>
                <div style={{ fontFamily: 'DM Mono', fontSize: 9.5, color: C.textMuted, marginTop: 2 }}>VP each</div>
              </div>
            );
          })}
        </div>
      </VgCard>

      {/* Wallet actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginBottom: 14 }}>
        <VgCard>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/brand/vc-coin.webp" alt="" style={{ height: 32 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'DM Sans', fontSize: 13, fontWeight: 700, color: C.text }}>Convert Coins → Gems</div>
              <div style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: C.success, marginTop: 2 }}>Balance {fmt(coinBalance)} VC</div>
            </div>
          </div>
          <button
            onClick={() => navigate('/wallet/convert')}
            style={{ marginTop: 12, width: '100%', padding: '10px 14px', background: C.violet, border: 0, borderRadius: 8, color: C.text, fontFamily: 'DM Sans', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
          >Convert</button>
        </VgCard>

        <VgCard>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/brand/vp-gem.webp" alt="" style={{ height: 32 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'DM Sans', fontSize: 13, fontWeight: 700, color: C.text }}>Request Payout</div>
              <div style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: C.textDim, marginTop: 2 }}>Conversion commission: {withdrawalCommission}%</div>
            </div>
          </div>
          <button
            onClick={() => navigate('/wallet/payout')}
            style={{ marginTop: 12, width: '100%', padding: '10px 14px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontFamily: 'DM Sans', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
          >Withdraw</button>
        </VgCard>

        <VgCard>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="storefront" size={26} style={{ color: C.gold }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'DM Sans', fontSize: 13, fontWeight: 700, color: C.text }}>Buy Coins</div>
              <div style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: C.textDim, marginTop: 2 }}>Pack store · sometimes you need more</div>
            </div>
          </div>
          <button
            onClick={() => navigate('/wallet/buy')}
            style={{ marginTop: 12, width: '100%', padding: '10px 14px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontFamily: 'DM Sans', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
          >Browse packs</button>
        </VgCard>
      </div>

      {/* Recent VP actions */}
      <VgCard>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em' }}>Recent VP activity</div>
          <span style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textDim }}>{todayActions} today · {weekActions} this week · {monthActions} this month</span>
        </div>
        {actions === null ? (
          <div style={{ padding: 18, textAlign: 'center', fontFamily: 'DM Mono', fontSize: 11, color: C.textMuted }}>Loading…</div>
        ) : list.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Icon name="bolt" size={26} style={{ color: C.textMuted, opacity: 0.6 }} />
            <div style={{ fontFamily: 'DM Sans', fontSize: 13, color: C.textDim, marginTop: 8 }}>No moderation actions yet.</div>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: C.textMuted, marginTop: 4 }}>Claim a tournament slot or work the queue to start earning VP.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {list.slice(0, 20).map((a, i) => (
              <div key={a.id || i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(180,79,255,.12)', color: C.violetLt, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="bolt" size={14} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'DM Sans', fontSize: 12.5, fontWeight: 600, color: C.text }}>{String(a.action || 'action').replace(/_/g, ' ')}</div>
                  <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textDim }}>{a.targetId || a.targetType || '—'} · {fmtAgo(a.takenAt)}</div>
                </div>
                <div style={{ fontFamily: 'DM Mono', fontSize: 12, fontWeight: 800, color: C.success }}>+{a.vpAwarded || meta.actionVp} VP</div>
              </div>
            ))}
          </div>
        )}
      </VgCard>
    </VanguardLayout>
  );
}
