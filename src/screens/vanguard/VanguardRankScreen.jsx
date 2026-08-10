// /vanguard/rank — Rank Progress. Design ref: Vanguard Rank Progress.png
// Real data only: the member's rank + lifetime VP drive every number. Skill
// gates and unlocks are derived from the real rank registry (vanguardRanks),
// not invented criteria.

import VanguardLayout, { VG_COLORS as C, VanguardPageHeader, VgCard } from '../../components/vanguard/VanguardLayout';
import Icon from '../../components/Icon';
import { useUser } from '../../context/UserContext';
import { rankMeta, VANGUARD_RANKS } from '../../utils/vanguardRanks';

const fmt = (n) => Number(n || 0).toLocaleString();
const tsMs = (t) => (t?.toDate ? t.toDate().getTime() : t?.seconds ? t.seconds * 1000 : (t instanceof Date ? t.getTime() : Number(t) || 0));

export default function VanguardRankScreen() {
  const { profile, wallet } = useUser();
  const v = profile?.vanguard || {};
  const myRank = v.rank || 'recruit';
  const curMeta = rankMeta(myRank);
  const nextRank = VANGUARD_RANKS.find((x) => x.order === curMeta.order + 1);
  const nextMeta = nextRank ? rankMeta(nextRank.id) : null;

  const vp = wallet?.vp || 0;
  const threshold = nextRank?.vpThreshold || 0;
  const pct = nextRank ? Math.min(100, Math.max(0, (vp / threshold) * 100)) : 100;
  const vpToNext = nextRank ? Math.max(0, threshold - vp) : 0;

  const joinedMs = tsMs(v.joinedAt || v.invitedAt);
  const joinedLabel = joinedMs ? new Date(joinedMs).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  const tenureDays = joinedMs ? Math.max(0, Math.floor((Date.now() - joinedMs) / 86400_000)) : null;
  const totalActions = v.totalActions || 0;

  // Real gates toward the next rank: the VP threshold (verifiable now) plus
  // founder approval (every promotion above Vanguard needs it).
  const skillGates = nextRank ? [
    { label: `Reach ${fmt(threshold)} lifetime VP`, done: vp >= threshold, metric: `${fmt(vp)}/${fmt(threshold)}` },
    { label: 'Founder approval', done: false, metric: 'Pending' },
  ] : [];

  // Real unlocks pulled straight from the rank registry.
  const unlocks = nextMeta ? [
    `+${nextMeta.actionVp} VP per moderation action (currently +${curMeta.actionVp})`,
    `${nextMeta.treasuryWeight}× treasury weight (currently ${curMeta.treasuryWeight}×)`,
  ] : [];

  return (
    <VanguardLayout page="rank">
      <VanguardPageHeader title="Rank Progress" subtitle="Track your journey, see what's next, and grow your impact." />

      {/* Top hero: current rank + next rank cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginBottom: 14 }}>
        <VgCard style={{ background: `linear-gradient(135deg, ${C.card}, rgba(180,79,255,.08))` }}>
          <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 8 }}>Your current rank</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <img src={curMeta.avatar} alt={curMeta.label} style={{ height: 64, borderRadius: 12 }} />
            <div>
              <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 22, color: C.text }}>{curMeta.label}</div>
              <div style={{ fontFamily: 'DM Mono', fontSize: 11, color: C.textDim, marginTop: 4 }}>Rank {curMeta.order} · Joined {joinedLabel}</div>
              <div style={{ fontFamily: 'DM Mono', fontSize: 11, color: C.textDim }}>{tenureDays != null ? `Tenure ${fmt(tenureDays)} days · ` : ''}{fmt(totalActions)} actions</div>
            </div>
          </div>
        </VgCard>

        {nextRank ? (
          <VgCard style={{ background: `linear-gradient(135deg, ${C.card}, rgba(245,200,66,.04))` }}>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 8 }}>Next rank</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <img src={nextMeta.avatar} alt="" style={{ height: 64, borderRadius: 12, opacity: 0.7 }} />
              <div>
                <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 22, color: C.gold }}>{nextRank.label}</div>
                <div style={{ fontFamily: 'DM Mono', fontSize: 11, color: C.textDim, marginTop: 4 }}>Rank {nextRank.order} · {fmt(threshold)} VP threshold</div>
                <div style={{ fontFamily: 'DM Mono', fontSize: 11, color: C.gold }}>Founder approval required</div>
              </div>
            </div>
          </VgCard>
        ) : (
          <VgCard>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, marginBottom: 6 }}>YOU'RE AT THE TOP</div>
            <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 22, color: C.gold }}>Overseer</div>
            <div style={{ fontFamily: 'DM Sans', fontSize: 12, color: C.textDim, marginTop: 6 }}>You audit the auditors. No further rank exists.</div>
          </VgCard>
        )}
      </div>

      {/* Progress to next */}
      {nextRank && (
        <VgCard style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em' }}>Progress toward {nextRank.label}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
            <div style={{ fontFamily: 'DM Mono', fontSize: 28, fontWeight: 800, color: C.text }}>{fmt(vp)}</div>
            <div style={{ fontFamily: 'DM Sans', fontSize: 13, color: C.textDim }}>of {fmt(threshold)} VP</div>
            <div style={{ flex: 1 }} />
            <div style={{ fontFamily: 'DM Mono', fontSize: 12, color: C.gold }}>{fmt(vpToNext)} VP remaining</div>
          </div>
          <div style={{ height: 14, background: C.card2, borderRadius: 999, overflow: 'hidden', border: `1px solid ${C.border}` }}>
            <div style={{ width: `${pct}%`, height: '100%', background: `linear-gradient(90deg, ${C.violet}, ${C.violetLt}, ${C.gold})` }} />
          </div>
          <div style={{ marginTop: 10, padding: 10, background: 'rgba(245,200,66,.06)', border: `1px solid rgba(245,200,66,.2)`, borderRadius: 8, fontFamily: 'DM Sans', fontSize: 12, color: C.gold, lineHeight: 1.5 }}>
            <Icon name="info" size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {nextRank.label} requires founder approval and {fmt(threshold)} lifetime VP.
          </div>
        </VgCard>
      )}

      {/* Skill gates + Unlocks side by side */}
      {nextRank && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14 }}>
          <VgCard>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 12 }}>Gates for {nextRank.label}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {skillGates.map((g, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%',
                    background: g.done ? `${C.success}22` : 'transparent',
                    border: g.done ? `1px solid ${C.success}` : `1px solid ${C.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: g.done ? C.success : C.textMuted,
                    flexShrink: 0,
                  }}>
                    {g.done ? <Icon name="check" size={14} /> : null}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'DM Sans', fontSize: 12.5, color: C.text, fontWeight: g.done ? 600 : 500 }}>{g.label}</div>
                  </div>
                  <div style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: g.done ? C.success : C.textDim }}>{g.metric}</div>
                </div>
              ))}
            </div>
          </VgCard>

          <VgCard style={{ background: `linear-gradient(135deg, ${C.card}, rgba(180,79,255,.04))` }}>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 12 }}>What {nextRank.label} unlocks</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {unlocks.map((u, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px' }}>
                  <Icon name="auto_awesome" size={16} style={{ color: C.violetLt, flexShrink: 0 }} />
                  <div style={{ fontFamily: 'DM Sans', fontSize: 12.5, color: C.text }}>{u}</div>
                </div>
              ))}
            </div>
          </VgCard>
        </div>
      )}

      <div style={{ marginTop: 14, fontFamily: 'DM Mono', fontSize: 10.5, color: C.textMuted, textAlign: 'center' }}>
        Promotions reflect sustained effort, not single bursts. Recruit a peer, build trust, ship good rulings. The platform notices.
      </div>
    </VanguardLayout>
  );
}
