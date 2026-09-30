// /vanguard/today — home dashboard for active mods.
// Designs reviewed 2026-05-16 (Vanguard home screen.png + option 2.png).
// Layout: KPI strip (4 tiles) · 2-col grid: Up Next (queue snapshot) + Recent Announcements + Peer Activity ·
//         Founder action / Daily reminder strip · Last action / Claim notice
//
// Pulls from existing helpers — no new Firestore reads invented.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import VanguardLayout, { VG_COLORS as C, VanguardPageHeader, VgCard } from '../../components/vanguard/VanguardLayout';
import { useUser } from '../../context/UserContext';
import { isVanguard } from '../../utils/vanguard';
import { rankMeta } from '../../utils/vanguardRanks';
import Icon from '../../components/Icon';
import {
  getPendingReports,
  getRecentVanguardActions,
  getVanguardTreasurySnapshot,
} from '../../firebase/firestore';

const tsMs = (t) => (t?.toDate ? t.toDate().getTime() : t?.seconds ? t.seconds * 1000 : (typeof t === 'number' ? t : 0));
const fmtAgo = (ms) => {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
};

function Kpi({ label, value, sub, icon, accent = C.violetLt }) {
  return (
    <VgCard style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 110 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em' }}>{label}</div>
        {icon && (
          <div style={{ width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${accent}22`, color: accent }}>
            <Icon name={icon} size={16} />
          </div>
        )}
      </div>
      <div style={{ fontFamily: 'DM Mono', fontSize: 28, fontWeight: 700, color: C.text, letterSpacing: '-.01em', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontFamily: 'DM Sans', fontSize: 11.5, color: C.textDim }}>{sub}</div>}
    </VgCard>
  );
}

function SectionTitle({ title, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 15, color: C.text, letterSpacing: '.02em' }}>{title}</div>
      {right}
    </div>
  );
}

export default function VanguardTodayScreen() {
  const navigate = useNavigate();
  const { profile } = useUser();
  const meIsVanguard = isVanguard(profile);
  const myRank = profile?.vanguard?.rank;
  const myMeta = rankMeta(myRank);

  const [reports, setReports] = useState([]);
  const [peer, setPeer] = useState([]);
  const [treasury, setTreasury] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [r, a, t] = await Promise.all([
          getPendingReports(15).catch(() => []),
          getRecentVanguardActions(8).catch(() => []),
          profile?.uid ? getVanguardTreasurySnapshot(profile.uid).catch(() => null) : null,
        ]);
        if (!alive) return;
        setReports(r || []);
        setPeer(a || []);
        setTreasury(t && t.configured ? t : null);
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [profile?.uid]);


  const openQueue = reports.length;
  const monthKey = useMemo(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }, []);
  const monthActions = profile?.vanguard?.monthlyActions?.[monthKey] || 0;
  const totalActions = profile?.vanguard?.totalActions || 0;

  // Pick a small "Up Next" preview from the report queue, max 3 rows.
  const upNext = [
    ...reports.slice(0, 3).map(r => ({
      id: r.id,
      type: 'report',
      label: r.reason || 'User report',
      sub: `Reported: ${r.targetType || 'user'} · ${r.priority === 'critical' ? 'Critical' : 'Normal'}`,
      severity: r.priority === 'critical' ? 'high' : 'low',
      route: '/vanguard/queue',
    })),
  ];

  return (
    <VanguardLayout page="today">
      <VanguardPageHeader
        title="Today"
        subtitle="Your command center for keeping VERGR safe, fast, and fair."
      />


      {/* KPI strip — 4 tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 18 }}>
        <Kpi
          label="Open queue"
          value={loading ? '—' : openQueue}
          sub={loading ? 'Loading…' : `${reports.length} reports`}
          icon="inbox"
          accent={C.violetLt}
        />
        <Kpi
          label="Actions today"
          value={loading ? '—' : monthActions}
          sub={`This month · ${totalActions} all-time`}
          icon="bolt"
          accent={C.success}
        />
        <Kpi
          label="Projected share this month"
          value={loading || !treasury ? '—' : `${(treasury.projectedShare || 0).toLocaleString()}c`}
          sub={treasury?.configured ? `Pool ${(treasury.balance || 0).toLocaleString()}c · ${treasury.eligibleCount} mods` : 'Treasury not configured'}
          icon="account_balance"
          accent={C.gold}
        />
        <Kpi
          label="Per-action VP"
          value={`+${myMeta.actionVp || 0} VP`}
          sub={`Treasury weight ${myMeta.treasuryWeight || 0}×`}
          icon="military_tech"
          accent={C.violet}
        />
      </div>

      {/* 2-col layout: Up Next + Peer Activity (right rail) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', gap: 14 }}>
        {/* Left: Up Next + Daily reminder */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <VgCard>
            <SectionTitle
              title="Up Next"
              right={
                <button
                  onClick={() => navigate('/vanguard/queue')}
                  style={{ background: 'transparent', border: 0, color: C.violetLt, cursor: 'pointer', fontFamily: 'DM Sans', fontSize: 12, fontWeight: 600 }}
                >
                  View queue →
                </button>
              }
            />
            {loading ? (
              <div style={{ color: C.textMuted, fontSize: 13 }}>Loading…</div>
            ) : upNext.length === 0 ? (
              <div style={{
                padding: 20,
                textAlign: 'center',
                color: C.textMuted,
                background: C.successFill,
                border: 0,
                borderRadius: 10,
              }}>
                <Icon name="check_circle" size={28} style={{ color: C.success, marginBottom: 6 }} />
                <div style={{ fontFamily: 'DM Sans', fontWeight: 700, color: C.success, fontSize: 13 }}>Queue is clear.</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Nothing waiting on a Vanguard decision right now.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {upNext.map((row) => (
                  <button
                    key={`${row.type}-${row.id}`}
                    onClick={() => navigate(row.route)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: 12,
                      background: C.card2,
                      border: `1px solid ${C.border}`,
                      borderRadius: 10,
                      cursor: 'pointer',
                      textAlign: 'left',
                      color: C.text,
                      transition: 'border-color .12s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.borderH; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; }}
                  >
                    <div style={{
                      width: 36, height: 36, borderRadius: 10,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: row.severity === 'high' ? `${C.ember}22` : row.severity === 'mid' ? `${C.gold}22` : `${C.violetLt}22`,
                      color: row.severity === 'high' ? C.ember : row.severity === 'mid' ? C.gold : C.violetLt,
                    }}>
                      <Icon name="report" size={18} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: 13, color: C.text }}>{row.label}</div>
                      <div style={{ fontFamily: 'DM Mono', fontSize: 11, color: C.textDim, marginTop: 2 }}>{row.sub}</div>
                    </div>
                    <span style={{
                      padding: '4px 10px',
                      background: C.activeFill,
                      border: 0,
                      borderRadius: 999,
                      color: C.violetLt,
                      fontFamily: 'DM Sans',
                      fontSize: 11.5,
                      fontWeight: 700,
                    }}>Review</span>
                  </button>
                ))}
              </div>
            )}
          </VgCard>

          <VgCard style={{ background: `linear-gradient(135deg, ${C.card}, rgba(180,79,255,.05))` }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: C.activeFill, color: C.violetLt, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="security" size={24} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: 14, color: C.text }}>Daily reminder · Rule 5: Respect Everyone</div>
                <div style={{ fontFamily: 'DM Sans', fontSize: 12.5, color: C.textDim, marginTop: 3 }}>Apply the same standard to friends and strangers. Recuse from any case with personal stake.</div>
              </div>
              <button
                onClick={() => navigate('/vanguard/handbook')}
                style={{
                  padding: '8px 14px',
                  background: C.activeFill,
                  border: 0,
                  borderRadius: 8,
                  color: C.violetLt,
                  cursor: 'pointer',
                  fontFamily: 'DM Sans',
                  fontSize: 12,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >View Code</button>
            </div>
          </VgCard>
        </div>

        {/* Right rail: Peer Activity + Announcements teaser */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <VgCard>
            <SectionTitle
              title="Peer Activity"
              right={
                <button
                  onClick={() => navigate('/vanguard/peer')}
                  style={{ background: 'transparent', border: 0, color: C.violetLt, cursor: 'pointer', fontFamily: 'DM Sans', fontSize: 12, fontWeight: 600 }}
                >All →</button>
              }
            />
            {loading ? (
              <div style={{ color: C.textMuted, fontSize: 13 }}>Loading…</div>
            ) : peer.length === 0 ? (
              <div style={{ color: C.textMuted, fontSize: 12.5, padding: '8px 4px' }}>Quiet on the floor.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {peer.slice(0, 6).map((a) => {
                  const m = rankMeta(a.moderatorRank);
                  return (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <img src={m.badge} alt="" style={{ height: 16, width: 'auto', flexShrink: 0 }} draggable={false} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: 'DM Sans', fontSize: 12, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <span style={{ color: C.violetLt, fontWeight: 700 }}>{m.label}</span>{' '}
                          <span style={{ color: C.textDim }}>{a.action ? a.action.replace(/_/g, ' ') : 'took an action'}</span>
                        </div>
                        <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted }}>{fmtAgo(tsMs(a.takenAt))}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </VgCard>

          <VgCard>
            <SectionTitle
              title="Recent Announcements"
              right={
                <button
                  onClick={() => navigate('/vanguard/announcements')}
                  style={{ background: 'transparent', border: 0, color: C.violetLt, cursor: 'pointer', fontFamily: 'DM Sans', fontSize: 12, fontWeight: 600 }}
                >All →</button>
              }
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ padding: 10, background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: 12.5, color: C.text }}>Welcome to your new HQ</div>
                <div style={{ fontFamily: 'DM Sans', fontSize: 11.5, color: C.textDim, marginTop: 3 }}>New dashboard live. Use ← Back to App anytime.</div>
              </div>
              <div style={{ padding: 10, background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: 12.5, color: C.text }}>Stipend ladder dormant</div>
                <div style={{ fontFamily: 'DM Sans', fontSize: 11.5, color: C.textDim, marginTop: 3 }}>Tier-B perks activate at €10k MRR. See Handbook → Financials.</div>
              </div>
            </div>
          </VgCard>
        </div>
      </div>
    </VanguardLayout>
  );
}
