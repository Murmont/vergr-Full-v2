// /vanguard/roster — full directory of every Vanguard. Real members only.
// Design ref: Vanguard Roster.png

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import VanguardLayout, { VG_COLORS as C, VanguardPageHeader, VgCard } from '../../components/vanguard/VanguardLayout';
import Icon from '../../components/Icon';
import { getAllVanguardMembers } from '../../firebase/firestore';
import { rankMeta, VANGUARD_RANKS } from '../../utils/vanguardRanks';

const tsMs = (t) => (t?.toDate ? t.toDate().getTime() : t?.seconds ? t.seconds * 1000 : (t instanceof Date ? t.getTime() : Number(t) || 0));
const agoLabel = (ms) => {
  if (!ms) return null;
  const d = Date.now() - ms;
  if (d < 3600_000) return `${Math.max(1, Math.floor(d / 60_000))}m`;
  if (d < 86400_000) return `${Math.floor(d / 3600_000)}h`;
  return `${Math.floor(d / 86400_000)}d`;
};
const monthKeyNow = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

export default function VanguardRosterScreen() {
  const navigate = useNavigate();
  const [roster, setRoster] = useState(null);
  const [selected, setSelected] = useState(null);
  const [rankFilter, setRankFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    getAllVanguardMembers().then((members) => {
      if (!alive) return;
      const mk = monthKeyNow();
      const rows = (members || []).map((m) => {
        const v = m.vanguard || {};
        const lastMs = tsMs(v.lastActionAt || m.lastActiveAt || m.updatedAt);
        return {
          uid: m.id,
          name: `@${m.username || 'mod'}`,
          realName: m.displayName || '—',
          rank: v.rank || 'recruit',
          status: v.status || 'active',
          lastSeenLabel: agoLabel(lastMs),
          actions: v.totalActions || 0,
          thisMonth: v.monthlyActions?.[mk] || 0,
        };
      }).sort((a, b) => b.actions - a.actions);
      setRoster(rows);
      setSelected(rows[0] || null);
    }).catch(() => { if (alive) { setRoster([]); setSelected(null); } });
    return () => { alive = false; };
  }, []);

  const list = roster || [];
  const filtered = useMemo(() => list.filter((r) => {
    if (rankFilter !== 'all' && r.rank !== rankFilter) return false;
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      if (!(r.name + r.realName).toLowerCase().includes(q)) return false;
    }
    return true;
  }), [list, rankFilter, statusFilter, query]);

  return (
    <VanguardLayout page="roster">
      <VanguardPageHeader title="Roster" subtitle="Every Vanguard member. Trusted peers." />

      <VgCard style={{ marginBottom: 12, padding: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={rankFilter} onChange={e => setRankFilter(e.target.value)} style={{ padding: '8px 10px', background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontFamily: 'DM Sans', fontSize: 12.5, outline: 'none', cursor: 'pointer' }}>
          <option value="all">All ranks</option>
          {VANGUARD_RANKS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '8px 10px', background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontFamily: 'DM Sans', fontSize: 12.5, outline: 'none', cursor: 'pointer' }}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="retired">Retired</option>
        </select>
        <div style={{ flex: 1, minWidth: 200, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8 }}>
          <Icon name="search" size={14} style={{ color: C.textMuted }} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name or handle..." style={{ background: 'transparent', border: 0, color: C.text, fontFamily: 'DM Sans', fontSize: 12.5, outline: 'none', width: '100%' }} />
        </div>
        <div style={{ fontFamily: 'DM Mono', fontSize: 11, color: C.textDim }}>{filtered.length} of {list.length}</div>
      </VgCard>

      {roster === null ? (
        <VgCard style={{ textAlign: 'center', color: C.textMuted, padding: 40 }}>Loading…</VgCard>
      ) : list.length === 0 ? (
        <VgCard style={{ textAlign: 'center', padding: 40 }}>
          <Icon name="groups" size={28} style={{ color: C.textMuted, opacity: 0.6 }} />
          <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: 14, color: C.text, marginTop: 8 }}>No Vanguard members yet</div>
          <div style={{ fontFamily: 'DM Sans', fontSize: 12.5, color: C.textDim, marginTop: 4 }}>Members appear here as they're invited and accept.</div>
        </VgCard>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', gap: 14 }}>
          <VgCard style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', background: C.card2, borderBottom: `1px solid ${C.border}`, display: 'grid', gridTemplateColumns: '40px 1fr 1fr 100px 100px 80px', gap: 10, fontFamily: 'DM Mono', fontSize: 9.5, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.12em' }}>
              <span></span>
              <span>Handle</span>
              <span>Name</span>
              <span>Rank</span>
              <span>Status</span>
              <span style={{ textAlign: 'right' }}>Actions</span>
            </div>
            {filtered.map((r) => {
              const m = rankMeta(r.rank);
              const isSel = selected?.uid === r.uid;
              return (
                <button
                  key={r.uid}
                  onClick={() => setSelected(r)}
                  style={{
                    width: '100%', display: 'grid', gridTemplateColumns: '40px 1fr 1fr 100px 100px 80px',
                    gap: 10, alignItems: 'center', padding: '10px 14px',
                    background: isSel ? 'rgba(180,79,255,.08)' : 'transparent', border: 0,
                    borderBottom: `1px solid ${C.border}`, borderLeft: isSel ? `2px solid ${C.violetLt}` : '2px solid transparent',
                    color: C.text, cursor: 'pointer', textAlign: 'left', fontFamily: 'DM Sans',
                  }}
                >
                  <img src={m.badge} alt="" style={{ height: 22, width: 'auto' }} />
                  <span style={{ fontWeight: 700, fontSize: 12.5, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                  <span style={{ fontSize: 12, color: C.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.realName}</span>
                  <span style={{ fontSize: 11.5, color: C.violetLt }}>{m.label}</span>
                  <span style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: r.status === 'active' ? C.success : r.status === 'suspended' ? C.ember : C.textMuted, textTransform: 'uppercase' }}>● {r.status}</span>
                  <span style={{ fontFamily: 'DM Mono', fontSize: 12, color: C.text, textAlign: 'right', fontWeight: 700 }}>{r.actions.toLocaleString()}</span>
                </button>
              );
            })}
          </VgCard>

          {selected && (
            <VgCard>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <img src={rankMeta(selected.rank).avatar} alt="" style={{ height: 56, width: 56, borderRadius: 12 }} />
                <div>
                  <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 18, color: C.text }}>{selected.name}</div>
                  <div style={{ fontFamily: 'DM Mono', fontSize: 11, color: C.violetLt }}>{rankMeta(selected.rank).label}</div>
                  <div style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: C.textDim, marginTop: 2 }}>{selected.lastSeenLabel ? `Last seen ${selected.lastSeenLabel} ago` : 'Last seen unknown'}</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                <div style={{ padding: 10, background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                  <div style={{ fontFamily: 'DM Mono', fontSize: 9.5, color: C.textMuted }}>TOTAL</div>
                  <div style={{ fontFamily: 'DM Mono', fontSize: 18, fontWeight: 800, color: C.text }}>{selected.actions.toLocaleString()}</div>
                </div>
                <div style={{ padding: 10, background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                  <div style={{ fontFamily: 'DM Mono', fontSize: 9.5, color: C.textMuted }}>THIS MONTH</div>
                  <div style={{ fontFamily: 'DM Mono', fontSize: 18, fontWeight: 800, color: C.violetLt }}>{selected.thisMonth}</div>
                </div>
              </div>

              <button onClick={() => navigate(`/messages?to=${selected.uid}`)} style={{ width: '100%', padding: '10px 14px', background: C.violet, border: 0, borderRadius: 8, color: C.text, fontFamily: 'DM Sans', fontWeight: 700, fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>
                Send DM
              </button>
            </VgCard>
          )}
        </div>
      )}
    </VanguardLayout>
  );
}
