// Founder-only Vanguard admin dashboard.
// Three views:
//   Roster:  every Vanguard member with rank, status, last action, total actions.
//            Promote / demote / suspend buttons.
//   Pending: outstanding invitations.
//   Invite:  send a new invitation (pick user by uid or username).
//
// Gated by AdminShell + `vanguard` screen scope.
import { useEffect, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import Icon from '../../components/Icon';
import AdminShell, { ADMIN_COLORS } from './AdminShell';
import {
  getAllVanguardMembers,
  getOutstandingVanguardInvitations,
  searchUsers,
} from '../../firebase/firestore';
import { VANGUARD_RANKS, RANK_BY_ID, rankMeta } from '../../utils/vanguard';

const C = { ...ADMIN_COLORS, purple: ADMIN_COLORS.accent };

const tsMs = (t) => (t?.toDate ? t.toDate().getTime() : t?.seconds ? t.seconds * 1000 : t ? new Date(t).getTime() : 0);
const ago = (t) => {
  const ms = Date.now() - tsMs(t);
  if (!tsMs(t)) return '—';
  if (ms < 6e4) return 'just now';
  if (ms < 36e5) return `${Math.floor(ms / 6e4)}m ago`;
  if (ms < 864e5) return `${Math.floor(ms / 36e5)}h ago`;
  return `${Math.floor(ms / 864e5)}d ago`;
};

export default function AdminVanguardScreen() {
  const { profile } = useUser();
  const { showToast } = useUI();
  const [tab, setTab] = useState('roster');
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [m, i] = await Promise.all([
        getAllVanguardMembers().catch(() => []),
        getOutstandingVanguardInvitations().catch(() => []),
      ]);
      setMembers(m); setInvites(i);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  return (
    <AdminShell
      screen="vanguard"
      title="Vanguard Admin"
      subtitle="Manage the moderator program: promotions, suspensions, invitations, and treasury distribution."
      topBarRight={<DistributionTrigger showToast={showToast} />}
    >
      <>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 18, borderBottom: `1px solid ${C.border}` }}>
          {[
            { id: 'roster',  label: `Roster (${members.length})`,  icon: 'groups' },
            { id: 'pending', label: `Pending (${invites.length})`, icon: 'mail' },
            { id: 'invite',  label: 'Invite',                       icon: 'person_add' },
            { id: 'audit',   label: 'Audit Log',                    icon: 'history' },
            { id: 'recruits',label: 'Eligible Recruits',            icon: 'military_tech' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '9px 14px', borderRadius: '8px 8px 0 0', border: 0,
                background: tab === t.id ? C.card : 'transparent',
                color: tab === t.id ? C.text : C.textDim,
                fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                borderBottom: tab === t.id ? `2px solid ${C.purple}` : '2px solid transparent',
              }}
            >
              <Icon name={t.icon} size={15} /> {t.label}
            </button>
          ))}
        </div>

        {tab === 'roster'   && <RosterTab members={members} loading={loading} onChange={load} showToast={showToast} myUid={profile?.uid} />}
        {tab === 'pending'  && <PendingTab invites={invites} loading={loading} onChange={load} showToast={showToast} />}
        {tab === 'invite'   && <InviteTab onChange={load} showToast={showToast} />}
        {tab === 'audit'    && <AuditTab members={members} showToast={showToast} />}
        {tab === 'recruits' && <RecruitsTab members={members} loading={loading} showToast={showToast} onChange={load} />}
      </>
    </AdminShell>
  );
}

function RosterTab({ members, loading, onChange, showToast, myUid }) {
  const [busy, setBusy] = useState(null);
  const sorted = [...members].sort((a, b) => (RANK_BY_ID[b.vanguard?.rank]?.order || 0) - (RANK_BY_ID[a.vanguard?.rank]?.order || 0));

  const promote = async (m, newRank) => {
    setBusy(m.id);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'changeVanguardRank');
      await fn({ targetUid: m.id, newRank, reason: 'admin dashboard' });
      showToast(`Rank updated to ${RANK_BY_ID[newRank].label}`, 'success');
      onChange();
    } catch (e) { showToast(e?.message || 'Failed', 'error'); }
    setBusy(null);
  };
  const setStatus = async (m, status) => {
    setBusy(m.id);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'setVanguardStatus');
      await fn({ targetUid: m.id, status, reason: 'admin dashboard' });
      showToast(`Status: ${status}`, 'success');
      onChange();
    } catch (e) { showToast(e?.message || 'Failed', 'error'); }
    setBusy(null);
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: C.textDim }}>Loading…</div>;
  if (sorted.length === 0) return <div style={{ padding: 40, textAlign: 'center', color: C.textDim }}>No Vanguard members yet. Send invitations from the Invite tab.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {sorted.map((m) => {
        const meta = rankMeta(m.vanguard?.rank);
        const v = m.vanguard || {};
        return (
          <div key={m.id} style={{ padding: 14, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, display: 'flex', gap: 14, alignItems: 'center' }}>
            <img src={meta.avatar} alt="" style={{ width: 48, height: 48, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{m.displayName || m.username || m.id.slice(0, 8)}</span>
                <span style={{ fontSize: 10.5, color: C.textDim }}>@{m.username || m.id.slice(0, 6)}</span>
                <img src={meta.badge} alt="" style={{ height: 18, width: 'auto' }} />
                {v.status && v.status !== 'active' && (
                  <span style={{ fontSize: 9.5, padding: '2px 6px', borderRadius: 4, background: 'rgba(240,64,96,.15)', color: '#f04060', textTransform: 'uppercase', letterSpacing: '.1em' }}>{v.status}</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: C.textDim, marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <span>Joined {ago(v.joinedAt)}</span>
                <span>{v.totalActions || 0} actions</span>
                <span>Last action {ago(v.lastActionAt)}</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
              <select
                disabled={busy === m.id || m.id === myUid}
                value={v.rank || 'recruit'}
                onChange={(e) => e.target.value !== v.rank && promote(m, e.target.value)}
                style={{ background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 8px', fontSize: 12 }}
              >
                {VANGUARD_RANKS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
              <div style={{ display: 'flex', gap: 6 }}>
                {v.status !== 'suspended' && <button disabled={busy === m.id} onClick={() => setStatus(m, 'suspended')} style={btnSm('#f0a500')}>Suspend</button>}
                {v.status !== 'active'    && <button disabled={busy === m.id} onClick={() => setStatus(m, 'active')}    style={btnSm('#22d17e')}>Restore</button>}
                {v.status !== 'retired'   && <button disabled={busy === m.id} onClick={() => setStatus(m, 'retired')}   style={btnSm('#f04060')}>Retire</button>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PendingTab({ invites, loading, onChange, showToast }) {
  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: C.textDim }}>Loading…</div>;
  if (invites.length === 0) return <div style={{ padding: 40, textAlign: 'center', color: C.textDim }}>No pending invitations.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {invites.map((inv) => {
        const meta = rankMeta(inv.startRank);
        return (
          <div key={inv.id} style={{ padding: 14, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{inv.inviteeName || inv.inviteeId.slice(0, 8)}</span>
              <span style={{ fontSize: 10.5, color: C.textDim }}>{inv.inviteeEmail || ''}</span>
              <span style={{ fontSize: 9.5, padding: '2px 6px', borderRadius: 4, background: 'rgba(123,31,255,.15)', color: '#B44FFF', textTransform: 'uppercase', letterSpacing: '.1em' }}>{meta.label} invite</span>
              <span style={{ fontSize: 10.5, color: C.textDim, marginLeft: 'auto' }}>{ago(inv.createdAt)}</span>
            </div>
            {inv.message && <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.5 }}>{inv.message}</div>}
          </div>
        );
      })}
    </div>
  );
}

function InviteTab({ onChange, showToast }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [startRank, setStartRank] = useState('recruit');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    let alive = true;
    setSearching(true);
    searchUsers(q.trim(), 12).then((u) => { if (alive) setResults(u || []); }).catch(() => {}).finally(() => { if (alive) setSearching(false); });
    return () => { alive = false; };
  }, [q]);

  const invite = async (user) => {
    setBusy(user.id || user.uid);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'inviteToVanguard');
      await fn({ inviteeId: user.id || user.uid, startRank, message });
      showToast(`Invite sent to ${user.displayName || user.username}`, 'success');
      onChange();
    } catch (e) { showToast(e?.message || 'Invite failed', 'error'); }
    setBusy(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: 10 }}>
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search user by display name or username (min 2 chars)"
          style={{ padding: '10px 12px', background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 13 }}
        />
        <select value={startRank} onChange={(e) => setStartRank(e.target.value)} style={{ padding: '10px 12px', background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 13 }}>
          {VANGUARD_RANKS.map((r) => <option key={r.id} value={r.id}>Start as {r.label}</option>)}
        </select>
      </div>
      <textarea
        value={message} onChange={(e) => setMessage(e.target.value)} maxLength={400} rows={2}
        placeholder="Optional message to the invitee (their notification preview)"
        style={{ padding: '10px 12px', background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 13, resize: 'vertical' }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {searching ? <div style={{ color: C.textDim, padding: 12 }}>Searching…</div>
          : results.length === 0 ? <div style={{ color: C.textDim, padding: 12, fontSize: 12 }}>{q.length < 2 ? 'Search for a user above to invite them.' : 'No matches.'}</div>
          : results.map((u) => (
              <div key={u.id || u.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', overflow: 'hidden', background: '#2a1659', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700 }}>
                  {u.avatar ? <img src={u.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (u.displayName || '?')[0]?.toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{u.displayName || u.username || 'Unknown'}</div>
                  <div style={{ fontSize: 10.5, color: C.textDim }}>@{u.username || (u.id || u.uid).slice(0, 6)}</div>
                </div>
                <button onClick={() => invite(u)} disabled={busy === (u.id || u.uid)}
                  style={{ padding: '7px 12px', background: C.purple, color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                  {busy === (u.id || u.uid) ? '…' : 'Invite'}
                </button>
              </div>
            ))}
      </div>
    </div>
  );
}

const btnSm = (color) => ({
  padding: '4px 8px', background: 'transparent', border: `1px solid ${color}`, color,
  borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
});

// Manual treasury-distribution trigger. The 1st-of-month UTC cron runs
// automatically; this button lets the founder fire it on-demand for
// testing or to clear a stuck pool. Pass a monthKey ("YYYY-MM") to
// settle a past month; leave blank for the current running month.
function DistributionTrigger({ showToast }) {
  const [busy, setBusy] = useState(false);
  const [monthKey, setMonthKey] = useState('');
  const run = async () => {
    if (!window.confirm(`Distribute Vanguard treasury for ${monthKey || 'the current month'} now?\n\nIdempotent: a month already settled won't re-pay.`)) return;
    setBusy(true);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'adminTriggerVanguardDistribution');
      const r = await fn(monthKey ? { monthKey } : {});
      const d = r.data;
      if (d.alreadyDistributed) {
        showToast(`Already distributed for ${d.monthKey}, no-op`, 'info');
      } else if (d.refundedToPlatform) {
        showToast(`No eligible recipients, ${d.refundedToPlatform} coins refunded to platform`, 'info');
      } else {
        showToast(`Distributed ${d.totalPool || 0} coins to ${d.recipientCount || 0} member${(d.recipientCount || 0) === 1 ? '' : 's'} for ${d.monthKey}`, 'success');
      }
    } catch (err) {
      console.error('Vanguard distribution failed:', err);
      showToast(err?.message || 'Distribution failed', 'error');
    }
    setBusy(false);
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <input
        value={monthKey}
        onChange={(e) => setMonthKey(e.target.value)}
        placeholder="YYYY-MM (blank = now)"
        style={{ padding: '7px 10px', background: '#0a0a14', color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11.5, fontFamily: 'ui-monospace,monospace', width: 160 }}
      />
      <button
        onClick={run}
        disabled={busy}
        style={{ padding: '7px 12px', background: busy ? '#555' : '#F5C842', color: '#000', border: 0, borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        <Icon name={busy ? 'hourglass_top' : 'payments'} size={14} />
        {busy ? 'Running…' : 'Run treasury distribution'}
      </button>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// AuditTab: search vanguard_actions collection with filters.
// ───────────────────────────────────────────────────────────
function AuditTab({ members, showToast }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterMod, setFilterMod] = useState('all');
  const [filterAction, setFilterAction] = useState('all');
  const [filterDays, setFilterDays] = useState(7);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const { collection, query, where, orderBy, limit, getDocs } = await import('firebase/firestore');
        const { db } = await import('../../firebase/config');
        const since = new Date(Date.now() - filterDays * 86400_000);
        let q = query(
          collection(db, 'vanguard_actions'),
          where('takenAt', '>=', since),
          orderBy('takenAt', 'desc'),
          limit(500),
        );
        const snap = await getDocs(q);
        if (!alive) return;
        let arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (filterMod !== 'all') arr = arr.filter((r) => r.moderatorId === filterMod);
        if (filterAction !== 'all') arr = arr.filter((r) => r.action === filterAction);
        setRows(arr);
      } catch (e) {
        showToast?.(e?.message || 'Failed to load audit log', 'error');
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [filterMod, filterAction, filterDays, showToast]);

  const allActions = ['all', 'tournament_winner_call', 'tournament_checkin', 'tournament_no_show',
    'report_approve', 'report_reject', 'report_escalate', 'user_mute', 'user_temp_ban', 'user_perma_ban', 'rank_change'];

  const exportCsv = () => {
    const header = 'id,moderatorId,rank,action,targetType,targetId,reason,takenAt\n';
    const csv = rows.map((r) => [
      r.id, r.moderatorId, r.rank, r.action,
      r.targetType || '', r.targetId || '',
      JSON.stringify(r.reason || ''),
      tsMs(r.takenAt) ? new Date(tsMs(r.takenAt)).toISOString() : '',
    ].join(',')).join('\n');
    const blob = new Blob([header + csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vanguard_audit_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <div>
      <div style={{ padding: 14, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={filterMod} onChange={(e) => setFilterMod(e.target.value)} style={{ padding: '8px 10px', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 12.5, cursor: 'pointer', outline: 'none' }}>
          <option value="all">All moderators</option>
          {members.map((m) => (
            <option key={m.uid} value={m.uid}>{m.displayName || m.username || m.uid.slice(0, 8)}</option>
          ))}
        </select>
        <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)} style={{ padding: '8px 10px', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 12.5, cursor: 'pointer', outline: 'none' }}>
          {allActions.map((a) => <option key={a} value={a}>{a === 'all' ? 'All actions' : a.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={filterDays} onChange={(e) => setFilterDays(Number(e.target.value))} style={{ padding: '8px 10px', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 12.5, cursor: 'pointer', outline: 'none' }}>
          <option value={1}>Last 24h</option>
          <option value={7}>Last 7d</option>
          <option value={30}>Last 30d</option>
          <option value={90}>Last 90d</option>
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ color: C.textDim, fontSize: 12 }}>{rows.length} action{rows.length !== 1 ? 's' : ''}</span>
        <button onClick={exportCsv} style={{ padding: '8px 14px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          <Icon name="download" size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />Export CSV
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 30, textAlign: 'center', color: C.textDim }}>Loading audit log…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: C.textDim, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10 }}>No actions match these filters.</div>
      ) : (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 1fr 1fr 90px', gap: 8, padding: '10px 14px', background: C.bg, borderBottom: `1px solid ${C.border}`, fontSize: 10.5, color: C.textDim, textTransform: 'uppercase', letterSpacing: '.1em' }}>
            <span>Time</span>
            <span>Moderator</span>
            <span>Action</span>
            <span>Target</span>
            <span>Rank</span>
          </div>
          {rows.map((r) => {
            const mod = members.find((m) => m.uid === r.moderatorId);
            return (
              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 1fr 1fr 90px', gap: 8, padding: '10px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.text }}>
                <span style={{ color: C.textDim, fontFamily: 'DM Mono', fontSize: 10.5 }}>{ago(r.takenAt)}</span>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{mod?.displayName || r.moderatorId?.slice(0, 8) || '—'}</span>
                <span>{r.action?.replace(/_/g, ' ') || '—'}</span>
                <span style={{ color: C.textDim, fontFamily: 'DM Mono', fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.targetType ? `${r.targetType}/${(r.targetId || '').slice(0, 12)}` : '—'}</span>
                <span style={{ color: C.purple, fontSize: 11 }}>{r.rank || '—'}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// RecruitsTab: auto-flag Recruits at/above the VP threshold for promotion.
// ───────────────────────────────────────────────────────────
function RecruitsTab({ members, loading, showToast, onChange }) {
  const [vpByUid, setVpByUid] = useState({});

  useEffect(() => {
    let alive = true;
    (async () => {
      const { doc, getDoc } = await import('firebase/firestore');
      const { db } = await import('../../firebase/config');
      const recruits = members.filter((m) => m.vanguard?.rank === 'recruit');
      const map = {};
      for (const m of recruits) {
        try {
          const w = await getDoc(doc(db, 'wallets', m.uid));
          map[m.uid] = w.exists() ? Number(w.data().vp || 0) : 0;
        } catch { map[m.uid] = 0; }
      }
      if (alive) setVpByUid(map);
    })();
    return () => { alive = false; };
  }, [members]);

  const recruits = members.filter((m) => m.vanguard?.rank === 'recruit');
  const vanguardThreshold = RANK_BY_ID.vanguard?.vpThreshold || 25_000;
  const eligible = recruits
    .map((m) => ({ ...m, vp: vpByUid[m.uid] || 0, actions: m.vanguard?.totalActions || 0 }))
    .sort((a, b) => b.vp - a.vp);

  const onPromote = async (uid) => {
    if (!window.confirm('Promote this Recruit to Vanguard?')) return;
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'changeVanguardRank');
      await fn({ targetUid: uid, newRank: 'vanguard' });
      showToast?.('Promoted to Vanguard.', 'success');
      onChange?.();
    } catch (e) {
      showToast?.(e?.message || 'Promotion failed', 'error');
    }
  };

  if (loading) return <div style={{ padding: 30, textAlign: 'center', color: C.textDim }}>Loading…</div>;
  if (recruits.length === 0) return <div style={{ padding: 30, textAlign: 'center', color: C.textDim, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10 }}>No Recruits on the roster.</div>;

  return (
    <div>
      <div style={{ padding: 12, marginBottom: 12, background: 'rgba(124,58,237,.06)', border: `1px solid rgba(124,58,237,.2)`, borderRadius: 10, color: C.text, fontSize: 12.5 }}>
        Recruits become auto-eligible for Vanguard promotion at <strong style={{ color: C.purple }}>{vanguardThreshold.toLocaleString()} VP</strong>. They still need your approval; click Promote when ready. Below-threshold Recruits keep shadowing.
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px 110px 140px', gap: 8, padding: '10px 14px', background: C.bg, borderBottom: `1px solid ${C.border}`, fontSize: 10.5, color: C.textDim, textTransform: 'uppercase', letterSpacing: '.1em' }}>
          <span>Recruit</span>
          <span style={{ textAlign: 'right' }}>VP</span>
          <span style={{ textAlign: 'right' }}>Actions</span>
          <span style={{ textAlign: 'right' }}>Status</span>
          <span></span>
        </div>
        {eligible.map((r) => {
          const isEligible = r.vp >= vanguardThreshold;
          const progress = Math.min(100, (r.vp / vanguardThreshold) * 100);
          return (
            <div key={r.uid} style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, display: 'grid', gridTemplateColumns: '1fr 100px 100px 110px 140px', gap: 8, alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{r.displayName || r.username || r.uid.slice(0, 10)}</div>
                <div style={{ height: 4, background: C.bg, borderRadius: 2, overflow: 'hidden', marginTop: 5 }}>
                  <div style={{ width: `${progress}%`, height: '100%', background: isEligible ? '#22D17E' : C.purple }} />
                </div>
              </div>
              <span style={{ textAlign: 'right', fontFamily: 'DM Mono', fontSize: 12, color: C.text, fontWeight: 700 }}>{r.vp.toLocaleString()}</span>
              <span style={{ textAlign: 'right', fontFamily: 'DM Mono', fontSize: 12, color: C.textDim }}>{r.actions}</span>
              <span style={{ textAlign: 'right', fontSize: 11, fontWeight: 700, color: isEligible ? '#22D17E' : C.textDim }}>{isEligible ? '● ELIGIBLE' : `${Math.round(100 - progress)}% to go`}</span>
              <button
                disabled={!isEligible}
                onClick={() => onPromote(r.uid)}
                style={{ padding: '7px 12px', background: isEligible ? C.purple : 'transparent', border: `1px solid ${isEligible ? C.purple : C.border}`, borderRadius: 6, color: isEligible ? C.text : C.textDim, fontSize: 12, fontWeight: 700, cursor: isEligible ? 'pointer' : 'not-allowed' }}
              >Promote</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
