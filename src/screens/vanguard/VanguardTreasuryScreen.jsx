// /vanguard/treasury — full transparency on the mod treasury pool.
// Design ref: Vanguard Treasury.png
// Real data only: live treasury snapshot + the real Vanguard roster (for the
// rank breakdown + leaderboard, computed with the same rank_weight × actions
// formula the monthly distribute cron uses). No dummy fallback.

import { useEffect, useMemo, useState } from 'react';
import VanguardLayout, { VG_COLORS as C, VanguardPageHeader, VgCard } from '../../components/vanguard/VanguardLayout';
import Icon from '../../components/Icon';
import { useUser } from '../../context/UserContext';
import { getVanguardTreasurySnapshot, getAllVanguardMembers } from '../../firebase/firestore';
import { rankMeta } from '../../utils/vanguardRanks';

const fmt = (n) => Number(n || 0).toLocaleString();
const monthKeyNow = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

export default function VanguardTreasuryScreen() {
  const { profile } = useUser();
  const [snap, setSnap] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [s, m] = await Promise.all([
          profile?.uid ? getVanguardTreasurySnapshot(profile.uid).catch(() => null) : Promise.resolve(null),
          getAllVanguardMembers().catch(() => []),
        ]);
        if (!alive) return;
        setSnap(s && s.configured ? s : (s || null));
        setMembers(m || []);
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [profile?.uid]);

  // Countdown to the next distribution (1st of next month, 00:05 UTC).
  useEffect(() => { const t = setInterval(() => setTick((k) => k + 1), 30_000); return () => clearInterval(t); }, []);
  const countdown = useMemo(() => {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 5, 0));
    let diff = Math.max(0, next.getTime() - now.getTime());
    const days = Math.floor(diff / 86400_000); diff -= days * 86400_000;
    const hours = Math.floor(diff / 3600_000); diff -= hours * 3600_000;
    const mins = Math.floor(diff / 60_000);
    return { days, hours, mins };
  }, [Math.floor(Date.now() / 60_000)]);

  const mk = snap?.currentMonthKey || monthKeyNow();
  const balance = snap?.balance || 0;

  // Real rank breakdown + leaderboard from the live roster, using the same
  // weight = rank_weight × this-month actions formula as the distribute cron.
  const { rankBreakdown, leaderboard, totalWeight, contributors } = useMemo(() => {
    const breakdown = { recruit: 0, vanguard: 0, senior: 0, commander: 0, overseer: 0 };
    let total = 0; let contrib = 0;
    const rows = members.map((m) => {
      const rank = m.vanguard?.rank || 'recruit';
      if (breakdown[rank] != null) breakdown[rank] += 1;
      const actions = m.vanguard?.monthlyActions?.[mk] || 0;
      const weight = (rankMeta(rank).treasuryWeight || 0) * actions;
      total += weight;
      if (actions > 0) contrib += 1;
      return { uid: m.id, name: `@${m.username || 'mod'}`, rank, actions, weight };
    }).filter((r) => r.weight > 0).sort((a, b) => b.weight - a.weight).slice(0, 8);
    const withShare = rows.map((r) => ({ ...r, share: total > 0 ? Math.floor((r.weight / total) * balance) : 0 }));
    return { rankBreakdown: breakdown, leaderboard: withShare, totalWeight: total || (snap?.totalWeight || 0), contributors: contrib };
  }, [members, mk, balance, snap?.totalWeight]);

  const myRank = profile?.vanguard?.rank || 'recruit';
  const myActions = profile?.vanguard?.monthlyActions?.[mk] || 0;
  const myWeight = snap?.myWeight ?? ((rankMeta(myRank).treasuryWeight || 0) * myActions);

  if (loading) return (
    <VanguardLayout page="treasury">
      <VanguardPageHeader title="Treasury" subtitle="Transparency leads to trust. Your earnings, plain math." />
      <VgCard style={{ textAlign: 'center', color: C.textMuted, padding: 40 }}>Loading…</VgCard>
    </VanguardLayout>
  );

  if (!snap) return (
    <VanguardLayout page="treasury">
      <VanguardPageHeader title="Treasury" subtitle="Transparency leads to trust. Your earnings, plain math." />
      <VgCard style={{ textAlign: 'center', padding: 40 }}>
        <Icon name="savings" size={30} style={{ color: C.textMuted, opacity: 0.6 }} />
        <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: 15, color: C.text, marginTop: 10 }}>The treasury hasn't started yet</div>
        <div style={{ fontFamily: 'DM Sans', fontSize: 12.5, color: C.textDim, marginTop: 6, maxWidth: 420, marginInline: 'auto', lineHeight: 1.5 }}>
          The treasury is a self-funded pool fed by the 5% tournament mod cut. Once tournaments with that cut finalize, the balance and your projected share appear here. Inactive mods get no share — show up and work.
        </div>
      </VgCard>
    </VanguardLayout>
  );

  return (
    <VanguardLayout page="treasury">
      <VanguardPageHeader title="Treasury" subtitle="Transparency leads to trust. Your earnings, plain math." />

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginBottom: 14 }}>
        <VgCard>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <img src="/brand/vc-coin.webp" alt="" style={{ height: 32, width: 32 }} />
            <div>
              <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em' }}>Treasury balance</div>
              <div style={{ fontFamily: 'DM Mono', fontSize: 30, fontWeight: 800, color: C.text, lineHeight: 1 }}>{fmt(balance)}</div>
              <div style={{ fontFamily: 'DM Sans', fontSize: 12, color: C.textDim, marginTop: 3 }}>VC · €{(balance * 0.01).toFixed(2)} equiv.</div>
            </div>
          </div>
        </VgCard>

        <VgCard>
          <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 8 }}>Eligible mods this month</div>
          <div style={{ fontFamily: 'DM Mono', fontSize: 30, fontWeight: 800, color: C.text, lineHeight: 1 }}>{fmt(snap.eligibleCount || contributors)}</div>
          <div style={{ fontFamily: 'DM Sans', fontSize: 12, color: C.textDim, marginTop: 6 }}>mods who took at least one action this month</div>
        </VgCard>

        <VgCard style={{ background: `linear-gradient(135deg, ${C.card}, rgba(245,200,66,.06))` }}>
          <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 8 }}>Your projected share</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <div style={{ fontFamily: 'DM Mono', fontSize: 30, fontWeight: 800, color: C.gold, lineHeight: 1 }}>{fmt(snap.projectedShare)}</div>
            <div style={{ fontFamily: 'DM Sans', fontSize: 14, color: C.gold }}>VC</div>
          </div>
          <div style={{ fontFamily: 'DM Sans', fontSize: 12, color: C.textDim, marginTop: 8 }}>
            For {rankMeta(myRank).label} at {myActions} actions this month
          </div>
          <div style={{ marginTop: 12, padding: 8, background: 'rgba(245,200,66,.08)', border: `1px solid rgba(245,200,66,.2)`, borderRadius: 8, fontFamily: 'DM Mono', fontSize: 10, color: C.gold }}>
            Weight: {fmt(myWeight)} of {fmt(totalWeight)} total
          </div>
        </VgCard>
      </div>

      {/* Weight expression + countdown */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 14, marginBottom: 14 }}>
        <VgCard>
          <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 12 }}>Your weight expression</div>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', justifyContent: 'space-around', flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'DM Mono', fontSize: 24, fontWeight: 800, color: C.text }}>{rankMeta(myRank).treasuryWeight}×</div>
              <div style={{ fontFamily: 'DM Mono', fontSize: 9.5, color: C.textMuted, marginTop: 4, textTransform: 'uppercase', letterSpacing: '.12em' }}>Rank weight</div>
            </div>
            <div style={{ color: C.textMuted, fontFamily: 'DM Mono', fontSize: 22 }}>×</div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'DM Mono', fontSize: 24, fontWeight: 800, color: C.text }}>{myActions}</div>
              <div style={{ fontFamily: 'DM Mono', fontSize: 9.5, color: C.textMuted, marginTop: 4, textTransform: 'uppercase', letterSpacing: '.12em' }}>This-month actions</div>
            </div>
            <div style={{ color: C.textMuted, fontFamily: 'DM Mono', fontSize: 22 }}>=</div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'DM Mono', fontSize: 24, fontWeight: 800, color: C.violetLt }}>{fmt(myWeight)}</div>
              <div style={{ fontFamily: 'DM Mono', fontSize: 9.5, color: C.textMuted, marginTop: 4, textTransform: 'uppercase', letterSpacing: '.12em' }}>Your weight</div>
            </div>
          </div>
        </VgCard>

        <VgCard style={{ background: `linear-gradient(135deg, ${C.card}, rgba(180,79,255,.05))` }}>
          <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 12 }}>Distribution countdown</div>
          <div style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
            {[
              { v: countdown.days, l: 'days' },
              { v: countdown.hours, l: 'hrs' },
              { v: countdown.mins, l: 'min' },
            ].map((b) => (
              <div key={b.l}>
                <div style={{ fontFamily: 'DM Mono', fontSize: 24, fontWeight: 800, color: C.text }}>{String(b.v).padStart(2, '0')}</div>
                <div style={{ fontFamily: 'DM Mono', fontSize: 9.5, color: C.textMuted, marginTop: 4, textTransform: 'uppercase', letterSpacing: '.12em' }}>{b.l}</div>
              </div>
            ))}
          </div>
          <div style={{ fontFamily: 'DM Sans', fontSize: 11.5, color: C.textDim, marginTop: 12, textAlign: 'center' }}>Next distribution: 1st of next month at 00:05 UTC</div>
        </VgCard>
      </div>

      {/* Contributors + Leaderboard */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)', gap: 14 }}>
        <VgCard>
          <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 8 }}>Active contributors this month</div>
          <div style={{ fontFamily: 'DM Mono', fontSize: 36, fontWeight: 800, color: C.text, lineHeight: 1 }}>{fmt(contributors)}</div>
          <div style={{ fontFamily: 'DM Sans', fontSize: 12, color: C.textDim, marginTop: 6 }}>mods with at least one action this month</div>
          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {Object.entries(rankBreakdown).map(([r, c]) => (
              <div key={r} style={{ padding: 8, background: C.card2, border: `1px solid ${C.border}`, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: 'DM Mono', fontSize: 11, color: C.textDim }}>{rankMeta(r).label}</span>
                <span style={{ fontFamily: 'DM Mono', fontSize: 12, color: C.text, fontWeight: 700 }}>{c}</span>
              </div>
            ))}
          </div>
        </VgCard>

        <VgCard>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em' }}>Leaderboard preview</div>
            <span style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted }}>by share</span>
          </div>
          {leaderboard.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', fontFamily: 'DM Sans', fontSize: 12.5, color: C.textDim }}>No mod actions logged this month yet. The leaderboard fills as the Vanguard works.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {leaderboard.map((row, i) => {
                const m = rankMeta(row.rank);
                return (
                  <div key={row.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                    <div style={{ width: 24, fontFamily: 'DM Mono', fontSize: 12, color: C.textMuted, textAlign: 'center' }}>{i + 1}</div>
                    <img src={m.badge} alt="" style={{ height: 18, width: 'auto' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'DM Sans', fontSize: 13, fontWeight: 700, color: C.text }}>{row.name}</div>
                      <div style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: C.textDim }}>{m.label} · {row.actions} actions · weight {fmt(row.weight)}</div>
                    </div>
                    <div style={{ fontFamily: 'DM Mono', fontSize: 13, fontWeight: 800, color: C.gold }}>{fmt(row.share)}c</div>
                  </div>
                );
              })}
            </div>
          )}
        </VgCard>
      </div>

      <div style={{ marginTop: 14, fontFamily: 'DM Mono', fontSize: 10.5, color: C.textMuted, textAlign: 'center' }}>
        Treasury is a self-funded pool fed by the 5% tournament mod cut. Inactive mods get no share — show up + work.
      </div>
    </VanguardLayout>
  );
}
