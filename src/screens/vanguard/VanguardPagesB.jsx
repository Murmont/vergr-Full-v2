// /vanguard/* — second batch of dashboard pages.
//
// Real data only. Every screen here is backed by a real Firestore collection:
// Peer Activity, Live Now, Payout History, My Cases, plus the collaboration
// tools (Notes, Escalations, Announcements, Decision Library) which read/write
// vanguard_notes / vanguard_escalations / vanguard_announcements /
// vanguard_precedents. Empty states show when a collection has no rows yet.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import VanguardLayout, { VG_COLORS as C, VanguardPageHeader, VgCard } from '../../components/vanguard/VanguardLayout';
import Icon from '../../components/Icon';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import {
  getRecentVanguardActions,
  getMyVanguardActions,
  getLiveStreams,
  getTournaments,
  getTournament,
  getTournamentMatches,
  getMyVanguardPayoutHistory,
  getMyTournamentAssignments,
  searchTournamentsForMod,
  searchUsers,
  getUserById,
  getVanguardNotes, addVanguardNote, deleteVanguardNote,
  getVanguardEscalations, addVanguardEscalation, resolveVanguardEscalation, deleteVanguardEscalation,
  getVanguardAnnouncements, addVanguardAnnouncement, deleteVanguardAnnouncement,
  getVanguardPrecedents, addVanguardPrecedent, deleteVanguardPrecedent,
} from '../../firebase/firestore';
import { rankMeta } from '../../utils/vanguardRanks';
import { resolveTier } from '../../utils/tierSystem';

// Shared form primitives ──────────────────────────────────────────────────────
const inputStyle = { width: '100%', padding: '10px 12px', background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontFamily: 'DM Sans', fontSize: 13, outline: 'none', boxSizing: 'border-box' };
const labelStyle = { fontFamily: 'DM Mono', fontSize: 9.5, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.12em', marginBottom: 5, display: 'block' };

function VgField({ label, children }) {
  return <div style={{ marginBottom: 10 }}><label style={labelStyle}>{label}</label>{children}</div>;
}
function VgButton({ children, onClick, disabled, kind = 'solid', small }) {
  const base = { padding: small ? '6px 12px' : '9px 16px', borderRadius: 8, fontFamily: 'DM Sans', fontWeight: 700, fontSize: small ? 11.5 : 13, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, border: 0 };
  const styles = kind === 'ghost'
    ? { ...base, background: 'transparent', border: `1px solid ${C.border}`, color: C.textDim }
    : kind === 'danger'
    ? { ...base, background: 'transparent', border: `1px solid ${C.ember}55`, color: C.ember }
    : { ...base, background: C.violet, color: C.text };
  return <button onClick={onClick} disabled={disabled} style={styles}>{children}</button>;
}
const rankTag = (rankId) => rankMeta(rankId).label;

const fmt = (n) => Number(n || 0).toLocaleString();
const tsMs = (d) => (d?.toDate ? d.toDate().getTime() : d?.seconds ? d.seconds * 1000 : (d instanceof Date ? d.getTime() : Number(d) || 0));
const fmtAgo = (d) => {
  const ms = tsMs(d);
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
};

function EmptyState({ icon, title, body }) {
  return (
    <VgCard style={{ textAlign: 'center', padding: 36 }}>
      <Icon name={icon} size={30} style={{ color: C.textMuted, opacity: 0.6 }} />
      <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: 15, color: C.text, marginTop: 10 }}>{title}</div>
      <div style={{ fontFamily: 'DM Sans', fontSize: 12.5, color: C.textDim, marginTop: 6, maxWidth: 460, marginInline: 'auto', lineHeight: 1.5 }}>{body}</div>
    </VgCard>
  );
}

// ─── Peer Activity ───────────────────────────────────────────────────────────
export function VanguardPeerScreen() {
  const [filter, setFilter] = useState('all');
  const [acts, setActs] = useState(null);

  useEffect(() => {
    let alive = true;
    getRecentVanguardActions(60).then((rows) => {
      if (!alive) return;
      setActs((rows || []).map((r) => ({
        id: r.id,
        moderatorRank: r.rank || 'recruit',
        moderatorId: r.moderatorId,
        action: r.action || 'action',
        target: r.targetId || r.targetType || '',
        takenAt: r.takenAt,
      })));
    }).catch(() => { if (alive) setActs([]); });
    return () => { alive = false; };
  }, []);

  const filters = [
    { key: 'all', label: 'All activity' },
    { key: 'tournament', label: 'Tournament calls' },
    { key: 'report', label: 'Report decisions' },
    { key: 'ban', label: 'Bans + mutes' },
    { key: 'overturn', label: 'Overturns' },
  ];
  const list = acts || [];
  const filtered = list.filter((a) => {
    if (filter === 'all') return true;
    if (filter === 'tournament') return a.action.includes('tournament');
    if (filter === 'report') return a.action.includes('report');
    if (filter === 'ban') return a.action.includes('ban') || a.action.includes('mute');
    if (filter === 'overturn') return a.action.includes('overturn') || a.action.includes('review');
    return true;
  });
  const now = Date.now();
  const within = (ms) => list.filter((a) => now - tsMs(a.takenAt) <= ms).length;
  const distinctMods = new Set(list.map((a) => a.moderatorId).filter(Boolean)).size;

  return (
    <VanguardLayout page="peer">
      <VanguardPageHeader title="Peer Activity" subtitle="Recent moderation activity from across the Vanguard." />

      <VgCard style={{ padding: 10, marginBottom: 12, display: 'flex', gap: 8, overflowX: 'auto', flexWrap: 'wrap' }}>
        {filters.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            style={{ padding: '8px 14px', background: filter === f.key ? 'rgba(180,79,255,.12)' : 'transparent', border: `1px solid ${filter === f.key ? 'rgba(180,79,255,.4)' : C.border}`, borderRadius: 999, color: filter === f.key ? C.violetLt : C.textDim, fontFamily: 'DM Sans', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>{f.label}</button>
        ))}
      </VgCard>

      {acts === null ? (
        <VgCard style={{ textAlign: 'center', color: C.textMuted, padding: 36 }}>Loading…</VgCard>
      ) : filtered.length === 0 ? (
        <EmptyState icon="forum" title="No peer activity yet" body="As Vanguard members resolve disputes, reports and tournament results, their actions appear here in real time." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((a) => {
            const m = rankMeta(a.moderatorRank);
            return (
              <VgCard key={a.id} style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(180,79,255,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <img src={m.badge} alt="" style={{ height: 18 }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'DM Sans', fontSize: 13.5, color: C.text }}>
                    <span style={{ color: C.violetLt, fontWeight: 700 }}>{m.label}</span>{' '}
                    <span style={{ color: C.textDim }}>{a.action.replace(/_/g, ' ')}</span>
                    {a.target && <> <span style={{ color: C.text, fontWeight: 600 }}>· {a.target}</span></>}
                  </div>
                  <div style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: C.textMuted, marginTop: 2 }}>{fmtAgo(a.takenAt)}</div>
                </div>
              </VgCard>
            );
          })}
        </div>
      )}

      {list.length > 0 && (
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          {[
            { label: 'Actions today', value: fmt(within(86400_000)) },
            { label: 'This week', value: fmt(within(7 * 86400_000)) },
            { label: 'Active mods', value: fmt(distinctMods) },
            { label: 'Loaded', value: fmt(list.length) },
          ].map((s, i) => (
            <VgCard key={i} style={{ padding: 10, textAlign: 'center' }}>
              <div style={{ fontFamily: 'DM Mono', fontSize: 9.5, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.12em' }}>{s.label}</div>
              <div style={{ fontFamily: 'DM Mono', fontSize: 20, fontWeight: 800, color: C.text, marginTop: 4 }}>{s.value}</div>
            </VgCard>
          ))}
        </div>
      )}
    </VanguardLayout>
  );
}

// ─── Live Now ────────────────────────────────────────────────────────────────
export function VanguardLiveScreen() {
  const navigate = useNavigate();
  const [streams, setStreams] = useState(null);
  const [tournaments, setTournaments] = useState(null);

  useEffect(() => {
    let alive = true;
    getLiveStreams(24).then((s) => { if (alive) setStreams(s || []); }).catch(() => { if (alive) setStreams([]); });
    getTournaments('in_progress', 24).then((t) => { if (alive) setTournaments(t || []); }).catch(() => { if (alive) setTournaments([]); });
    return () => { alive = false; };
  }, []);

  const sList = streams || [];
  const tList = tournaments || [];

  return (
    <VanguardLayout page="live">
      <VanguardPageHeader title="Live Now" subtitle="Active streams and tournaments that need Vanguard eyes." />

      <div style={{ marginBottom: 10, fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em' }}>Live streams · {streams === null ? '…' : sList.length}</div>
      {streams === null ? (
        <VgCard style={{ textAlign: 'center', color: C.textMuted, padding: 24, marginBottom: 18 }}>Loading…</VgCard>
      ) : sList.length === 0 ? (
        <div style={{ marginBottom: 18 }}><EmptyState icon="live_tv" title="No live streams right now" body="When members go live, their streams show up here for you to watch and moderate." /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 18 }}>
          {sList.map((s) => (
            <VgCard key={s.id} style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ aspectRatio: '16/9', background: `linear-gradient(135deg, ${C.violet}33, ${C.ember}33)`, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {s.thumbnailUrl ? <img src={s.thumbnailUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name="live_tv" size={32} style={{ color: C.text, opacity: 0.6 }} />}
                <span style={{ position: 'absolute', top: 8, left: 8, padding: '2px 8px', background: C.ember, borderRadius: 4, fontFamily: 'DM Mono', fontSize: 9.5, fontWeight: 700, color: C.text, letterSpacing: '.08em' }}>● LIVE</span>
                <span style={{ position: 'absolute', bottom: 8, right: 8, padding: '2px 8px', background: 'rgba(0,0,0,.7)', borderRadius: 4, fontFamily: 'DM Mono', fontSize: 10, color: C.text }}>{fmt(s.viewerCount)} viewers</span>
              </div>
              <div style={{ padding: 10 }}>
                <div style={{ fontFamily: 'DM Sans', fontSize: 13, fontWeight: 700, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title || 'Untitled stream'}</div>
                <div style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: C.textDim, marginTop: 2 }}>@{s.streamer?.username || 'streamer'}{s.game ? ` · ${s.game}` : ''}</div>
                <button onClick={() => navigate(`/watch/${s.id}`)} style={{ marginTop: 8, width: '100%', padding: '6px 8px', background: C.violet, border: 0, borderRadius: 6, color: C.text, fontFamily: 'DM Sans', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Watch + Moderate</button>
              </div>
            </VgCard>
          ))}
        </div>
      )}

      <div style={{ marginBottom: 10, fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em' }}>Live tournaments · {tournaments === null ? '…' : tList.length}</div>
      {tournaments === null ? (
        <VgCard style={{ textAlign: 'center', color: C.textMuted, padding: 24 }}>Loading…</VgCard>
      ) : tList.length === 0 ? (
        <EmptyState icon="emoji_events" title="No tournaments in progress" body="In-progress tournaments appear here so you can observe and step in if a match needs a referee." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {tList.map((t) => (
            <VgCard key={t.id}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ padding: '2px 8px', background: C.ember, borderRadius: 4, fontFamily: 'DM Mono', fontSize: 9.5, fontWeight: 700, color: C.text }}>● LIVE</span>
                <span style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.gold, fontWeight: 700 }}>{fmt(t.prizePool || t.declaredPurse || 0)}c</span>
              </div>
              <div style={{ fontFamily: 'DM Sans', fontSize: 14, fontWeight: 700, color: C.text }}>{t.name}</div>
              <div style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: C.textDim, marginTop: 4 }}>{t.game}{t.maxParticipants ? ` · ${t.maxParticipants} players` : ''}</div>
              <button onClick={() => navigate(`/match/${t.id}`)} style={{ marginTop: 10, width: '100%', padding: '7px 10px', background: C.violet, border: 0, borderRadius: 6, color: C.text, fontFamily: 'DM Sans', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>Observe + Moderate</button>
            </VgCard>
          ))}
        </div>
      )}
    </VanguardLayout>
  );
}

// ─── Payout History ──────────────────────────────────────────────────────────
export function VanguardPayoutsScreen() {
  const { profile } = useUser();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let alive = true;
    if (profile?.uid) {
      getMyVanguardPayoutHistory(profile.uid, 24).then((r) => { if (alive) setRows(r || []); }).catch(() => { if (alive) setRows([]); });
    } else setRows([]);
    return () => { alive = false; };
  }, [profile?.uid]);

  return (
    <VanguardLayout page="payouts">
      <VanguardPageHeader title="Payout History" subtitle="Every monthly distribution you've received." />
      {rows === null ? (
        <VgCard style={{ textAlign: 'center', color: C.textMuted, padding: 36 }}>Loading…</VgCard>
      ) : rows.length === 0 ? (
        <EmptyState icon="receipt_long" title="No payouts yet" body="The treasury distributes on the 1st of each month to mods who took actions. Your first distribution will appear here after your first active month." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map((p) => {
            const m = rankMeta(p.rank);
            const dist = tsMs(p.distributedAt);
            return (
              <VgCard key={p.monthKey}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 16, color: C.text }}>{p.monthKey}</div>
                    <div style={{ fontFamily: 'DM Mono', fontSize: 11, color: C.textDim }}>Distributed {dist ? new Date(dist).toLocaleDateString() : '—'}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: 'DM Mono', fontSize: 22, fontWeight: 800, color: C.gold }}>+{fmt(p.coins)}c</div>
                    <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted }}>your share</div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
                  <div style={{ padding: 8, background: C.card2, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                    <div style={{ fontFamily: 'DM Mono', fontSize: 9.5, color: C.textMuted }}>RANK</div>
                    <div style={{ fontFamily: 'DM Sans', fontSize: 12, fontWeight: 700, color: C.violetLt }}>{m.label}</div>
                  </div>
                  <div style={{ padding: 8, background: C.card2, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                    <div style={{ fontFamily: 'DM Mono', fontSize: 9.5, color: C.textMuted }}>YOUR ACTIONS</div>
                    <div style={{ fontFamily: 'DM Mono', fontSize: 12, color: C.text, fontWeight: 700 }}>{fmt(p.actions)}</div>
                  </div>
                  <div style={{ padding: 8, background: C.card2, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                    <div style={{ fontFamily: 'DM Mono', fontSize: 9.5, color: C.textMuted }}>POOL SIZE</div>
                    <div style={{ fontFamily: 'DM Mono', fontSize: 12, color: C.text, fontWeight: 700 }}>{fmt(p.totalPool)}c</div>
                  </div>
                </div>
              </VgCard>
            );
          })}
        </div>
      )}
    </VanguardLayout>
  );
}

// ─── My Cases ────────────────────────────────────────────────────────────────
export function VanguardMyCasesScreen() {
  const navigate = useNavigate();
  const { profile } = useUser();
  const [cases, setCases] = useState(null);

  useEffect(() => {
    let alive = true;
    if (profile?.uid) {
      getMyTournamentAssignments(profile.uid, 50).then((rows) => {
        if (!alive) return;
        const active = (rows || []).filter((a) => ['assigned', 'checked_in', 'in_progress'].includes(a.status));
        setCases(active.map((a) => {
          const startMs = tsMs(a.scheduledStart);
          const hoursLeft = startMs ? Math.round((startMs - Date.now()) / 3600_000) : null;
          return { id: a.id, code: (a.id || '').slice(0, 8).toUpperCase(), title: a.tournamentName || 'Tournament', game: a.game, status: a.status, claimedAt: a.claimedAt, hoursLeft };
        }));
      }).catch(() => { if (alive) setCases([]); });
    } else setCases([]);
    return () => { alive = false; };
  }, [profile?.uid]);

  const list = cases || [];

  return (
    <VanguardLayout page="my-cases">
      <VanguardPageHeader title="My Cases" subtitle="Tournament slots you've claimed and are working through." />
      <div style={{ marginBottom: 12, padding: 10, background: 'rgba(245,200,66,.05)', border: `1px solid rgba(245,200,66,.2)`, borderRadius: 8, fontFamily: 'DM Sans', fontSize: 12, color: C.gold }}>
        <Icon name="info" size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
        Check in 15 minutes before start. Slots released within an hour of start count as a no-show.
      </div>
      {cases === null ? (
        <VgCard style={{ textAlign: 'center', color: C.textMuted, padding: 36 }}>Loading…</VgCard>
      ) : list.length === 0 ? (
        <EmptyState icon="folder_managed" title="No active cases" body="Claim an open tournament slot from the Schedule tab and it'll show up here to work through." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.map((c) => (
            <VgCard key={c.id} style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
              <div style={{ width: 38, height: 38, borderRadius: 8, background: `${C.violetLt}22`, color: C.violetLt, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="emoji_events" size={18} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted }}>{c.code}{c.game ? ` · ${c.game}` : ''}</div>
                <div style={{ fontFamily: 'DM Sans', fontSize: 13.5, color: C.text, fontWeight: 700 }}>{c.title}</div>
                <div style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: C.textDim, marginTop: 2 }}>Status: {c.status.replace(/_/g, ' ')}{c.claimedAt ? ` · Claimed ${fmtAgo(c.claimedAt)}` : ''}</div>
              </div>
              {c.hoursLeft != null && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'DM Mono', fontSize: 12, fontWeight: 700, color: c.hoursLeft < 1 ? C.ember : c.hoursLeft < 6 ? C.gold : C.success }}>{c.hoursLeft <= 0 ? 'now' : `${c.hoursLeft}h`}</div>
                  <div style={{ fontFamily: 'DM Mono', fontSize: 9.5, color: C.textMuted }}>to start</div>
                </div>
              )}
              <button onClick={() => navigate(`/vanguard/moderation-room/${c.id}`)} style={{ padding: '8px 14px', background: C.violet, border: 0, borderRadius: 8, color: C.text, fontFamily: 'DM Sans', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Open</button>
            </VgCard>
          ))}
        </div>
      )}
    </VanguardLayout>
  );
}

// ─── Notes (vanguard_notes) ──────────────────────────────────────────────────
const NOTE_SUBJECTS = [
  { key: 'user', label: 'User', icon: 'person' },
  { key: 'tournament', label: 'Tournament', icon: 'emoji_events' },
  { key: 'stream', label: 'Stream', icon: 'live_tv' },
  { key: 'general', label: 'General', icon: 'sticky_note_2' },
];

export function VanguardNotesScreen() {
  const { profile } = useUser();
  const { showToast } = useUI();
  const [notes, setNotes] = useState(null);
  const [subjectType, setSubjectType] = useState('user');
  const [subjectLabel, setSubjectLabel] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('all');

  const myRank = profile?.vanguard?.rank || 'recruit';
  const canManageAll = profile?.role === 'admin' || rankMeta(myRank).order >= 4;

  const load = () => getVanguardNotes(150).then((r) => setNotes(r || [])).catch(() => setNotes([]));
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!body.trim()) { showToast('Write a note first', 'error'); return; }
    setSaving(true);
    try {
      await addVanguardNote({ authorId: profile.uid, authorRank: myRank, subjectType, subjectLabel: subjectLabel.trim(), body: body.trim() });
      setBody(''); setSubjectLabel('');
      showToast('Note added');
      await load();
    } catch (e) { showToast(e?.message || 'Could not save note', 'error'); }
    setSaving(false);
  };
  const remove = async (n) => {
    if (!window.confirm('Delete this note?')) return;
    try { await deleteVanguardNote(n.id); showToast('Note deleted'); await load(); }
    catch (e) { showToast(e?.message || 'Could not delete', 'error'); }
  };

  const list = (notes || []).filter((n) => filter === 'all' || n.subjectType === filter);

  return (
    <VanguardLayout page="notes">
      <VanguardPageHeader title="Notes" subtitle="Shared watchlist notes on users, tournaments and recurring patterns. Visible to every Vanguard member." />

      <VgCard style={{ marginBottom: 14 }}>
        <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: 13.5, color: C.text, marginBottom: 10 }}>Add a note</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          {NOTE_SUBJECTS.map((s) => (
            <button key={s.key} onClick={() => setSubjectType(s.key)}
              style={{ padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 6, background: subjectType === s.key ? 'rgba(180,79,255,.14)' : 'transparent', border: `1px solid ${subjectType === s.key ? 'rgba(180,79,255,.45)' : C.border}`, borderRadius: 8, color: subjectType === s.key ? C.violetLt : C.textDim, fontFamily: 'DM Sans', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              <Icon name={s.icon} size={14} />{s.label}
            </button>
          ))}
        </div>
        {subjectType !== 'general' && (
          <VgField label={`${NOTE_SUBJECTS.find((s) => s.key === subjectType)?.label} reference (username, name or ID)`}>
            <input value={subjectLabel} onChange={(e) => setSubjectLabel(e.target.value)} placeholder="e.g. @someplayer or tournament name" style={inputStyle} />
          </VgField>
        )}
        <VgField label="Note">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="What did you observe? Keep it factual." style={{ ...inputStyle, resize: 'vertical', minHeight: 64 }} />
        </VgField>
        <VgButton onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Add note'}</VgButton>
      </VgCard>

      <VgCard style={{ padding: 10, marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[{ key: 'all', label: 'All notes' }, ...NOTE_SUBJECTS.map((s) => ({ key: s.key, label: s.label }))].map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            style={{ padding: '7px 13px', background: filter === f.key ? 'rgba(180,79,255,.12)' : 'transparent', border: `1px solid ${filter === f.key ? 'rgba(180,79,255,.4)' : C.border}`, borderRadius: 999, color: filter === f.key ? C.violetLt : C.textDim, fontFamily: 'DM Sans', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{f.label}</button>
        ))}
      </VgCard>

      {notes === null ? (
        <VgCard style={{ textAlign: 'center', color: C.textMuted, padding: 36 }}>Loading…</VgCard>
      ) : list.length === 0 ? (
        <EmptyState icon="sticky_note_2" title="No notes yet" body="Add the first watchlist note above. Notes are shared across the whole Vanguard so everyone sees the same context on a user or tournament." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.map((n) => {
            const subj = NOTE_SUBJECTS.find((s) => s.key === n.subjectType) || NOTE_SUBJECTS[3];
            const mine = n.authorId === profile?.uid;
            return (
              <VgCard key={n.id} style={{ padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', background: 'rgba(180,79,255,.1)', borderRadius: 5, fontFamily: 'DM Sans', fontSize: 11, fontWeight: 700, color: C.violetLt }}><Icon name={subj.icon} size={12} />{subj.label}</span>
                  {n.subjectLabel && <span style={{ fontFamily: 'DM Sans', fontSize: 12.5, fontWeight: 700, color: C.text }}>{n.subjectLabel}</span>}
                  <span style={{ marginLeft: 'auto', fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted }}>{rankTag(n.authorRank)} · {fmtAgo(n.createdAt)}</span>
                </div>
                <div style={{ fontFamily: 'DM Sans', fontSize: 13, color: C.textDim, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{n.body}</div>
                {(mine || canManageAll) && (
                  <div style={{ marginTop: 8, textAlign: 'right' }}><VgButton small kind="danger" onClick={() => remove(n)}>Delete</VgButton></div>
                )}
              </VgCard>
            );
          })}
        </div>
      )}
    </VanguardLayout>
  );
}

// ─── Escalations (vanguard_escalations) ──────────────────────────────────────
const ESC_CASE_TYPES = [
  { key: 'report', label: 'User report' },
  { key: 'tournament', label: 'Tournament dispute' },
  { key: 'stream', label: 'Stream incident' },
  { key: 'appeal', label: 'Appeal / overturn' },
  { key: 'other', label: 'Other' },
];
const ESC_TARGET_RANKS = [
  { key: 'senior', label: 'Senior Vanguard' },
  { key: 'commander', label: 'Commander' },
  { key: 'overseer', label: 'Overseer' },
];

export function VanguardEscalationsScreen() {
  const { profile } = useUser();
  const { showToast } = useUI();
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(false);
  const [caseType, setCaseType] = useState('report');
  const [caseRef, setCaseRef] = useState('');
  const [toRank, setToRank] = useState('commander');
  const [summary, setSummary] = useState('');
  const [saving, setSaving] = useState(false);

  const myRank = profile?.vanguard?.rank || 'recruit';
  const myOrder = rankMeta(myRank).order;
  const isAdmin = profile?.role === 'admin';
  const canResolveAny = isAdmin || myOrder >= 3; // Senior+

  const load = () => getVanguardEscalations(120).then((r) => setRows(r || [])).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!summary.trim()) { showToast('Describe the case first', 'error'); return; }
    setSaving(true);
    try {
      await addVanguardEscalation({ authorId: profile.uid, authorRank: myRank, caseType, caseRef: caseRef.trim(), summary: summary.trim(), toRank });
      setSummary(''); setCaseRef(''); setOpen(false);
      showToast('Escalation opened');
      await load();
    } catch (e) { showToast(e?.message || 'Could not escalate', 'error'); }
    setSaving(false);
  };
  const resolve = async (esc) => {
    const resolution = window.prompt('Resolution / outcome:');
    if (resolution == null) return;
    try { await resolveVanguardEscalation(esc.id, { resolvedBy: profile.uid, resolution }); showToast('Marked resolved'); await load(); }
    catch (e) { showToast(e?.message || 'Could not resolve', 'error'); }
  };
  const remove = async (esc) => {
    if (!window.confirm('Delete this escalation?')) return;
    try { await deleteVanguardEscalation(esc.id); showToast('Deleted'); await load(); }
    catch (e) { showToast(e?.message || 'Could not delete', 'error'); }
  };

  const list = rows || [];
  const openCount = list.filter((r) => r.status === 'open').length;
  const mineCount = list.filter((r) => r.authorId === profile?.uid).length;
  const toMeCount = list.filter((r) => r.status === 'open' && rankMeta(r.toRank).order <= myOrder).length;

  return (
    <VanguardLayout page="escalations">
      <VanguardPageHeader title="Escalations" subtitle="Kick a case up the chain when it's above your authority, and track it to resolution." />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 14 }}>
        {[
          { label: 'Open escalations', value: openCount, color: C.gold },
          { label: 'Opened by me', value: mineCount, color: C.violetLt },
          { label: 'At my level', value: toMeCount, color: C.ember },
        ].map((kpi, i) => (
          <VgCard key={i} style={{ padding: 14 }}>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em' }}>{kpi.label}</div>
            <div style={{ fontFamily: 'DM Mono', fontSize: 26, fontWeight: 800, color: kpi.color, marginTop: 4 }}>{rows === null ? '…' : kpi.value}</div>
          </VgCard>
        ))}
      </div>

      {!open ? (
        <div style={{ marginBottom: 14 }}><VgButton onClick={() => setOpen(true)}>+ Escalate a case</VgButton></div>
      ) : (
        <VgCard style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: 13.5, color: C.text, marginBottom: 10 }}>New escalation</div>
          <VgField label="Case type">
            <select value={caseType} onChange={(e) => setCaseType(e.target.value)} style={inputStyle}>
              {ESC_CASE_TYPES.map((t) => <option key={t.key} value={t.key} style={{ background: C.card2 }}>{t.label}</option>)}
            </select>
          </VgField>
          <VgField label="Reference (case code, tournament ID, username — optional)">
            <input value={caseRef} onChange={(e) => setCaseRef(e.target.value)} placeholder="e.g. tournament ID or @user" style={inputStyle} />
          </VgField>
          <VgField label="Escalate to">
            <select value={toRank} onChange={(e) => setToRank(e.target.value)} style={inputStyle}>
              {ESC_TARGET_RANKS.map((t) => <option key={t.key} value={t.key} style={{ background: C.card2 }}>{t.label}</option>)}
            </select>
          </VgField>
          <VgField label="What's the situation?">
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} placeholder="Why does this need a higher rank? Include the facts." style={{ ...inputStyle, resize: 'vertical', minHeight: 64 }} />
          </VgField>
          <div style={{ display: 'flex', gap: 8 }}>
            <VgButton onClick={submit} disabled={saving}>{saving ? 'Opening…' : 'Open escalation'}</VgButton>
            <VgButton kind="ghost" onClick={() => setOpen(false)}>Cancel</VgButton>
          </div>
        </VgCard>
      )}

      {rows === null ? (
        <VgCard style={{ textAlign: 'center', color: C.textMuted, padding: 36 }}>Loading…</VgCard>
      ) : list.length === 0 ? (
        <EmptyState icon="priority_high" title="No escalations yet" body="When a case is above your authority, escalate it here so a higher rank can act. Open and resolved escalations both stay logged." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.map((esc) => {
            const resolved = esc.status === 'resolved';
            const mine = esc.authorId === profile?.uid;
            const ct = ESC_CASE_TYPES.find((t) => t.key === esc.caseType)?.label || 'Case';
            return (
              <VgCard key={esc.id} style={{ padding: '12px 14px', opacity: resolved ? 0.72 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <span style={{ padding: '2px 8px', background: resolved ? 'rgba(110,231,183,.12)' : 'rgba(245,200,66,.14)', borderRadius: 5, fontFamily: 'DM Mono', fontSize: 10, fontWeight: 700, color: resolved ? C.success : C.gold, textTransform: 'uppercase', letterSpacing: '.08em' }}>{resolved ? 'Resolved' : 'Open'}</span>
                  <span style={{ fontFamily: 'DM Sans', fontSize: 12.5, fontWeight: 700, color: C.text }}>{ct}</span>
                  {esc.caseRef && <span style={{ fontFamily: 'DM Mono', fontSize: 11, color: C.textDim }}>· {esc.caseRef}</span>}
                  <span style={{ marginLeft: 'auto', fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted }}>→ {rankTag(esc.toRank)} · {fmtAgo(esc.createdAt)}</span>
                </div>
                <div style={{ fontFamily: 'DM Sans', fontSize: 13, color: C.textDim, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{esc.summary}</div>
                <div style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: C.textMuted, marginTop: 6 }}>From {rankTag(esc.authorRank)}</div>
                {resolved && esc.resolution && (
                  <div style={{ marginTop: 8, padding: 10, background: C.card2, borderRadius: 8, border: `1px solid ${C.border}` }}>
                    <div style={{ fontFamily: 'DM Mono', fontSize: 9.5, color: C.success, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 3 }}>Outcome</div>
                    <div style={{ fontFamily: 'DM Sans', fontSize: 12.5, color: C.textDim, whiteSpace: 'pre-wrap' }}>{esc.resolution}</div>
                  </div>
                )}
                {(canResolveAny || mine) && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    {!resolved && (canResolveAny || mine) && <VgButton small onClick={() => resolve(esc)}>Mark resolved</VgButton>}
                    {(isAdmin || myOrder >= 4 || mine) && <VgButton small kind="danger" onClick={() => remove(esc)}>Delete</VgButton>}
                  </div>
                )}
              </VgCard>
            );
          })}
        </div>
      )}
    </VanguardLayout>
  );
}

// ─── Announcements (vanguard_announcements) ──────────────────────────────────
export function VanguardAnnouncementsScreen() {
  const { profile } = useUser();
  const { showToast } = useUI();
  const [rows, setRows] = useState(null);
  const [compose, setCompose] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);

  const myRank = profile?.vanguard?.rank || 'recruit';
  const isAdmin = profile?.role === 'admin';
  const canPost = isAdmin || rankMeta(myRank).order >= 5; // Overseer + founder

  const load = () => getVanguardAnnouncements(60).then((r) => setRows(r || [])).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!title.trim() || !body.trim()) { showToast('Add a title and message', 'error'); return; }
    setSaving(true);
    try {
      await addVanguardAnnouncement({ authorId: profile.uid, authorName: profile.displayName || profile.username || 'Overseer', authorRank: isAdmin ? 'overseer' : myRank, title: title.trim(), body: body.trim(), pinned });
      setTitle(''); setBody(''); setPinned(false); setCompose(false);
      showToast('Announcement posted');
      await load();
    } catch (e) { showToast(e?.message || 'Could not post', 'error'); }
    setSaving(false);
  };
  const remove = async (a) => {
    if (!window.confirm('Delete this announcement?')) return;
    try { await deleteVanguardAnnouncement(a.id); showToast('Deleted'); await load(); }
    catch (e) { showToast(e?.message || 'Could not delete', 'error'); }
  };

  const list = [...(rows || [])].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  return (
    <VanguardLayout page="announcements">
      <VanguardPageHeader title="Announcements" subtitle="Policy updates and program news from the founder and Overseers." />

      {canPost && (!compose ? (
        <div style={{ marginBottom: 14 }}><VgButton onClick={() => setCompose(true)}>+ Post announcement</VgButton></div>
      ) : (
        <VgCard style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: 13.5, color: C.text, marginBottom: 10 }}>New announcement</div>
          <VgField label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short headline" style={inputStyle} /></VgField>
          <VgField label="Message"><textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="Write the update…" style={{ ...inputStyle, resize: 'vertical', minHeight: 90 }} /></VgField>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, cursor: 'pointer', fontFamily: 'DM Sans', fontSize: 12.5, color: C.textDim }}>
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pin to top
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <VgButton onClick={submit} disabled={saving}>{saving ? 'Posting…' : 'Post'}</VgButton>
            <VgButton kind="ghost" onClick={() => setCompose(false)}>Cancel</VgButton>
          </div>
        </VgCard>
      ))}

      {rows === null ? (
        <VgCard style={{ textAlign: 'center', color: C.textMuted, padding: 36 }}>Loading…</VgCard>
      ) : list.length === 0 ? (
        <EmptyState icon="campaign" title="No announcements yet" body={canPost ? 'Post the first program update above. Every Vanguard member will see it here.' : 'Policy updates and program news from the founder and Overseers will appear here.'} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {list.map((a) => (
            <VgCard key={a.id} style={{ borderColor: a.pinned ? 'rgba(180,79,255,.4)' : C.border }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                {a.pinned && <Icon name="push_pin" size={15} style={{ color: C.violetLt }} />}
                <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 16, color: C.text, flex: 1 }}>{a.title}</div>
                <span style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted }}>{fmtAgo(a.createdAt)}</span>
              </div>
              <div style={{ fontFamily: 'DM Sans', fontSize: 13.5, color: C.textDim, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{a.body}</div>
              <div style={{ display: 'flex', alignItems: 'center', marginTop: 10 }}>
                <span style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: C.violetLt }}>{a.authorName || rankTag(a.authorRank)}</span>
                {canPost && <span style={{ marginLeft: 'auto' }}><VgButton small kind="danger" onClick={() => remove(a)}>Delete</VgButton></span>}
              </div>
            </VgCard>
          ))}
        </div>
      )}
    </VanguardLayout>
  );
}

// ─── Decision Library (vanguard_precedents) ──────────────────────────────────
export function VanguardLibraryScreen() {
  const { profile } = useUser();
  const { showToast } = useUI();
  const [rows, setRows] = useState(null);
  const [compose, setCompose] = useState(false);
  const [title, setTitle] = useState('');
  const [situation, setSituation] = useState('');
  const [ruling, setRuling] = useState('');
  const [tagsRaw, setTagsRaw] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const myRank = profile?.vanguard?.rank || 'recruit';
  const isAdmin = profile?.role === 'admin';
  const canManageAll = isAdmin || rankMeta(myRank).order >= 4;

  const load = () => getVanguardPrecedents(150).then((r) => setRows(r || [])).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!title.trim() || !ruling.trim()) { showToast('Add a title and the ruling', 'error'); return; }
    setSaving(true);
    try {
      const tags = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean);
      await addVanguardPrecedent({ authorId: profile.uid, authorRank: myRank, title: title.trim(), situation: situation.trim(), ruling: ruling.trim(), tags });
      setTitle(''); setSituation(''); setRuling(''); setTagsRaw(''); setCompose(false);
      showToast('Precedent recorded');
      await load();
    } catch (e) { showToast(e?.message || 'Could not save', 'error'); }
    setSaving(false);
  };
  const remove = async (p) => {
    if (!window.confirm('Delete this precedent?')) return;
    try { await deleteVanguardPrecedent(p.id); showToast('Deleted'); await load(); }
    catch (e) { showToast(e?.message || 'Could not delete', 'error'); }
  };

  const q = search.trim().toLowerCase();
  const list = (rows || []).filter((p) => {
    if (!q) return true;
    return [p.title, p.situation, p.ruling, ...(p.tags || [])].join(' ').toLowerCase().includes(q);
  });

  return (
    <VanguardLayout page="library">
      <VanguardPageHeader title="Decision Library" subtitle="Documented rulings and precedents the Vanguard can learn from and cite." />

      {!compose ? (
        <div style={{ marginBottom: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <VgButton onClick={() => setCompose(true)}>+ Add a precedent</VgButton>
          {rows && rows.length > 0 && (
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search precedents…" style={{ ...inputStyle, flex: 1, minWidth: 180, maxWidth: 320 }} />
          )}
        </div>
      ) : (
        <VgCard style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: 13.5, color: C.text, marginBottom: 10 }}>New precedent</div>
          <VgField label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Stream sniping in a Bo3 final" style={inputStyle} /></VgField>
          <VgField label="Situation"><textarea value={situation} onChange={(e) => setSituation(e.target.value)} rows={3} placeholder="What happened?" style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }} /></VgField>
          <VgField label="Ruling + reasoning"><textarea value={ruling} onChange={(e) => setRuling(e.target.value)} rows={3} placeholder="What was decided and why?" style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }} /></VgField>
          <VgField label="Tags (comma separated)"><input value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} placeholder="cheating, valorant, no-show" style={inputStyle} /></VgField>
          <div style={{ display: 'flex', gap: 8 }}>
            <VgButton onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Record precedent'}</VgButton>
            <VgButton kind="ghost" onClick={() => setCompose(false)}>Cancel</VgButton>
          </div>
        </VgCard>
      )}

      {rows === null ? (
        <VgCard style={{ textAlign: 'center', color: C.textMuted, padding: 36 }}>Loading…</VgCard>
      ) : list.length === 0 ? (
        <EmptyState icon="gavel" title={q ? 'No matching precedents' : 'No precedents recorded yet'} body={q ? 'Try a different search term.' : 'Record the first ruling above. Documented precedents help the whole Vanguard stay consistent.'} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {list.map((p) => {
            const mine = p.authorId === profile?.uid;
            return (
              <VgCard key={p.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Icon name="gavel" size={16} style={{ color: C.violetLt }} />
                  <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 15.5, color: C.text, flex: 1 }}>{p.title}</div>
                  <span style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted }}>{rankTag(p.authorRank)} · {fmtAgo(p.createdAt)}</span>
                </div>
                {p.situation && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontFamily: 'DM Mono', fontSize: 9.5, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 2 }}>Situation</div>
                    <div style={{ fontFamily: 'DM Sans', fontSize: 13, color: C.textDim, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{p.situation}</div>
                  </div>
                )}
                <div>
                  <div style={{ fontFamily: 'DM Mono', fontSize: 9.5, color: C.gold, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 2 }}>Ruling</div>
                  <div style={{ fontFamily: 'DM Sans', fontSize: 13, color: C.text, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{p.ruling}</div>
                </div>
                {p.tags && p.tags.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                    {p.tags.map((t, i) => <span key={i} style={{ padding: '2px 8px', background: 'rgba(180,79,255,.1)', borderRadius: 5, fontFamily: 'DM Mono', fontSize: 10, color: C.violetLt }}>{t}</span>)}
                  </div>
                )}
                {(mine || canManageAll) && (
                  <div style={{ marginTop: 10, textAlign: 'right' }}><VgButton small kind="danger" onClick={() => remove(p)}>Delete</VgButton></div>
                )}
              </VgCard>
            );
          })}
        </div>
      )}
    </VanguardLayout>
  );
}

// ─── Vanguard Chat ───────────────────────────────────────────────────────────
export function VanguardChatScreen() {
  const navigate = useNavigate();
  const [pins, setPins] = useState(null);

  useEffect(() => {
    let alive = true;
    getVanguardAnnouncements(40)
      .then((r) => { if (alive) setPins((r || []).filter((a) => a.pinned)); })
      .catch(() => { if (alive) setPins([]); });
    return () => { alive = false; };
  }, []);

  return (
    <VanguardLayout page="chat">
      <VanguardPageHeader title="Vanguard Chat" subtitle="Secure squad communication for active Vanguard members." />

      <VgCard style={{ marginBottom: 14, background: `linear-gradient(135deg, ${C.card}, rgba(180,79,255,.06))` }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(180,79,255,.15)', color: C.violetLt, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name="security" size={26} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: 14, color: C.text }}>Confidential — Code of Conduct §5</div>
            <div style={{ fontFamily: 'DM Sans', fontSize: 12.5, color: C.textDim, marginTop: 3 }}>Everything shared in Vanguard Chat is strictly confidential. Do not screenshot, share, or discuss outside the channel. Violations may result in immediate removal from the Vanguard program.</div>
          </div>
        </div>
      </VgCard>

      <div style={{ marginBottom: 10, fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em' }}>Pinned policy notes</div>
      {pins === null ? (
        <VgCard style={{ textAlign: 'center', color: C.textMuted, padding: 24 }}>Loading…</VgCard>
      ) : pins.length === 0 ? (
        <EmptyState icon="push_pin" title="No pinned notes yet" body="Pinned announcements from the Announcements tab show here as quick-reference policy notes. Open the secure squad thread to chat live." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {pins.map((a) => (
            <VgCard key={a.id} style={{ borderColor: 'rgba(180,79,255,.4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Icon name="push_pin" size={15} style={{ color: C.violetLt }} />
                <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 15, color: C.text, flex: 1 }}>{a.title}</div>
                <span style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted }}>{fmtAgo(a.createdAt)}</span>
              </div>
              <div style={{ fontFamily: 'DM Sans', fontSize: 13, color: C.textDim, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{a.body}</div>
            </VgCard>
          ))}
        </div>
      )}

      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <button onClick={() => navigate('/messages')} style={{ padding: '10px 22px', background: C.violet, border: 0, borderRadius: 8, color: C.text, fontFamily: 'DM Sans', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Open Messages →</button>
      </div>
    </VanguardLayout>
  );
}

// ─── Lookups (real search) ───────────────────────────────────────────────────
function SearchBar({ value, onChange, onRun, placeholder, busy }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onRun(); }}
        placeholder={placeholder}
        style={{ ...inputStyle, flex: 1 }}
      />
      <VgButton onClick={onRun} disabled={busy}>{busy ? 'Searching…' : 'Search'}</VgButton>
    </div>
  );
}
function KV({ k, v }) {
  return (
    <div style={{ padding: 8, background: C.card2, border: `1px solid ${C.border}`, borderRadius: 6 }}>
      <div style={{ fontFamily: 'DM Mono', fontSize: 9.5, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.1em' }}>{k}</div>
      <div style={{ fontFamily: 'DM Sans', fontSize: 12.5, color: C.text, fontWeight: 600, marginTop: 2, wordBreak: 'break-word' }}>{v ?? '—'}</div>
    </div>
  );
}
const fmtDate = (d) => { const ms = tsMs(d); return ms ? new Date(ms).toLocaleDateString() : '—'; };

// User Lookup ──────────────────────────────────────────────────────────────────
export function VanguardLookupUserScreen() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const [term, setTerm] = useState(sp.get('q') || '');
  const [results, setResults] = useState(null);
  const [selected, setSelected] = useState(null);
  const [notes, setNotes] = useState([]);
  const [busy, setBusy] = useState(false);

  const run = async (override) => {
    const qy = String(override ?? term).trim();
    if (!qy) return;
    setBusy(true); setSelected(null); setResults(null);
    try {
      let users = await searchUsers(qy, 20).catch(() => []);
      if ((!users || users.length === 0) && qy.length >= 16 && !qy.includes(' ')) {
        const u = await getUserById(qy.replace(/^@+/, '')).catch(() => null);
        if (u) users = [{ id: u.id || u.uid || qy, ...u }];
      }
      setResults(users || []);
    } catch { setResults([]); }
    setBusy(false);
  };
  useEffect(() => { if (sp.get('q')) run(sp.get('q')); /* eslint-disable-next-line */ }, []);

  const pick = async (u) => {
    setSelected(u);
    const uname = (u.username || '').toLowerCase();
    const uid = (u.id || u.uid || '').toLowerCase();
    const all = await getVanguardNotes(150).catch(() => []);
    setNotes(all.filter((n) => n.subjectType === 'user' && (
      (uname && (n.subjectLabel || '').toLowerCase().includes(uname)) ||
      (uid && (n.subjectLabel || '').toLowerCase().includes(uid))
    )));
  };

  return (
    <VanguardLayout page="lookup-user">
      <VanguardPageHeader title="User Lookup" subtitle="Find any user by handle or ID and pull their moderation context." />
      <SearchBar value={term} onChange={setTerm} onRun={() => run()} busy={busy} placeholder="Username, @handle, or user ID…" />

      {selected ? (
        <div>
          <VgCard style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <img src={selected.avatar || '/brand/logo.png'} alt="" style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', background: C.card2 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 18, color: C.text }}>{selected.displayName || selected.username || 'User'}</div>
                <div style={{ fontFamily: 'DM Mono', fontSize: 12, color: C.violetLt }}>@{selected.username || '—'}</div>
              </div>
              <VgButton small kind="ghost" onClick={() => setSelected(null)}>Back to results</VgButton>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
              <KV k="User ID" v={selected.id || selected.uid} />
              <KV k="Joined" v={fmtDate(selected.createdAt || selected.joinedAt)} />
              <KV k="Role" v={selected.role || 'user'} />
              <KV k="Plan" v={resolveTier(selected)} />
              <KV k="Followers" v={fmt(selected.followerCount || 0)} />
              <KV k="Status" v={selected.banned ? 'Banned' : selected.suspended ? 'Suspended' : selected.muted ? 'Muted' : 'Active'} />
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <VgButton small onClick={() => navigate(`/user/${selected.id || selected.uid || selected.username}`)}>View profile</VgButton>
              <VgButton small kind="ghost" onClick={() => navigate('/vanguard/notes')}>Add a note</VgButton>
            </div>
          </VgCard>

          <div style={{ marginBottom: 8, fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em' }}>Vanguard notes on this user · {notes.length}</div>
          {notes.length === 0 ? (
            <EmptyState icon="sticky_note_2" title="No notes on this user" body="There are no shared Vanguard notes referencing this user yet. Add one from the Notes tab." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {notes.map((n) => (
                <VgCard key={n.id} style={{ padding: '10px 12px' }}>
                  <div style={{ fontFamily: 'DM Sans', fontSize: 13, color: C.textDim, whiteSpace: 'pre-wrap' }}>{n.body}</div>
                  <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, marginTop: 4 }}>{rankTag(n.authorRank)} · {fmtAgo(n.createdAt)}</div>
                </VgCard>
              ))}
            </div>
          )}
        </div>
      ) : results === null ? (
        busy ? <VgCard style={{ textAlign: 'center', color: C.textMuted, padding: 36 }}>Searching…</VgCard>
        : <EmptyState icon="person_search" title="Search for a user" body="Type a username, @handle or user ID and press Search. Hidden accounts are reachable by exact user ID." />
      ) : results.length === 0 ? (
        <EmptyState icon="search_off" title="No users found" body="No match for that handle. Try the exact username, or paste the full user ID." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {results.map((u) => (
            <VgCard key={u.id || u.uid} style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => pick(u)}>
              <img src={u.avatar || '/brand/logo.png'} alt="" style={{ width: 38, height: 38, borderRadius: '50%', objectFit: 'cover', background: C.card2 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'DM Sans', fontSize: 13.5, fontWeight: 700, color: C.text }}>{u.displayName || u.username}</div>
                <div style={{ fontFamily: 'DM Mono', fontSize: 11, color: C.textDim }}>@{u.username || '—'}</div>
              </div>
              <Icon name="chevron_right" size={18} style={{ color: C.textMuted }} />
            </VgCard>
          ))}
        </div>
      )}
    </VanguardLayout>
  );
}

// Tournament Lookup ─────────────────────────────────────────────────────────────
export function VanguardLookupTournamentScreen() {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState(null);
  const [selected, setSelected] = useState(null);
  const [matches, setMatches] = useState(null);
  const [busy, setBusy] = useState(false);

  const open = async (id) => {
    setBusy(true); setResults(null);
    try {
      const t = await getTournament(id).catch(() => null);
      if (!t) { setBusy(false); setSelected(null); setResults([]); return; }
      setSelected(t);
      setMatches(null);
      getTournamentMatches(id).then((m) => setMatches(m || [])).catch(() => setMatches([]));
    } catch { setSelected(null); }
    setBusy(false);
  };
  const run = async () => {
    const qy = term.trim();
    if (!qy) return;
    setBusy(true); setSelected(null); setMatches(null); setResults(null);
    // ID-shaped input → open directly.
    if (qy.length >= 16 && !qy.includes(' ')) {
      const direct = await getTournament(qy).catch(() => null);
      if (direct) { setBusy(false); return open(qy); }
    }
    // Otherwise name/game search across ALL tournaments (public + private).
    try {
      const hits = await searchTournamentsForMod(qy, 30).catch(() => []);
      if (hits.length === 1) { setBusy(false); return open(hits[0].id); }
      setResults(hits);
    } catch { setResults([]); }
    setBusy(false);
  };

  return (
    <VanguardLayout page="lookup-tour">
      <VanguardPageHeader title="Tournament Lookup" subtitle="Search any tournament by name or game (public and private). A tournament ID also works." />
      <SearchBar value={term} onChange={setTerm} onRun={run} busy={busy} placeholder="Event name, game, or tournament ID…" />

      {selected ? (
        <div>
          <VgCard style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 18, color: C.text, flex: 1 }}>{selected.name}</div>
              <VgButton small kind="ghost" onClick={() => { setSelected(null); setMatches(null); }}>Back</VgButton>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
              <KV k="Tournament ID" v={selected.id} />
              <KV k="Game" v={selected.game} />
              <KV k="Status" v={selected.status} />
              <KV k="Format" v={selected.bracketType || selected.format} />
              <KV k="Players" v={`${(selected.participants || []).length}/${selected.maxParticipants || '—'}`} />
              <KV k="Prize / purse" v={`${fmt(selected.prizePool || selected.declaredPurse || 0)}c`} />
              <KV k="Visibility" v={selected.visibility} />
              <KV k="Starts" v={fmtDate(selected.scheduledStart || selected.startDate)} />
            </div>
            <div style={{ marginTop: 12 }}>
              <VgButton small onClick={() => navigate(`/match/${selected.id}`)}>Open tournament page</VgButton>
            </div>
          </VgCard>

          <div style={{ marginBottom: 8, fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em' }}>Matches · {matches === null ? '…' : matches.length}</div>
          {matches === null ? (
            <VgCard style={{ textAlign: 'center', color: C.textMuted, padding: 24 }}>Loading…</VgCard>
          ) : matches.length === 0 ? (
            <EmptyState icon="account_tree" title="No matches yet" body="The bracket hasn't generated matches, or none are recorded for this tournament." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {matches.map((m) => (
                <VgCard key={m.id} style={{ padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, minWidth: 60 }}>R{m.round || '?'}·M{m.matchNumber || '?'}</span>
                  <span style={{ flex: 1, fontFamily: 'DM Sans', fontSize: 12.5, color: C.text }}>{m.player1Data?.username || '—'} vs {m.player2Data?.username || '—'}</span>
                  <span style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: m.winner ? C.success : C.textDim }}>{m.winner ? 'decided' : (m.status || 'pending')}</span>
                </VgCard>
              ))}
            </div>
          )}
        </div>
      ) : results === null ? (
        busy ? <VgCard style={{ textAlign: 'center', color: C.textMuted, padding: 36 }}>Searching…</VgCard>
        : <EmptyState icon="emoji_events" title="Find a tournament" body="Type an event name or game to search every tournament (public and private). You normally reach a case from the Queue, Schedule or My Cases tabs, where it's already linked." />
      ) : results.length === 0 ? (
        <EmptyState icon="search_off" title="No tournaments found" body="No event matched that name or game. Check the spelling, or open it from the Queue / My Cases tab where it's linked directly." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {results.map((t) => (
            <VgCard key={t.id} style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => open(t.id)}>
              <Icon name="emoji_events" size={20} style={{ color: C.violetLt }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'DM Sans', fontSize: 13.5, fontWeight: 700, color: C.text }}>{t.name}</div>
                <div style={{ fontFamily: 'DM Mono', fontSize: 11, color: C.textDim }}>{t.game} · {t.status}</div>
              </div>
              <Icon name="chevron_right" size={18} style={{ color: C.textMuted }} />
            </VgCard>
          ))}
        </div>
      )}
    </VanguardLayout>
  );
}

// Action Lookup ─────────────────────────────────────────────────────────────────
export function VanguardLookupActionScreen() {
  const { profile } = useUser();
  const [term, setTerm] = useState('');
  const [all, setAll] = useState(null);
  const [scope, setScope] = useState('mine');

  const myRank = profile?.vanguard?.rank || 'recruit';
  const isAdmin = profile?.role === 'admin';
  const canReadAll = isAdmin || rankMeta(myRank).order >= 4; // Commander+ audit log

  useEffect(() => {
    let alive = true;
    if (!profile?.uid) { setAll([]); return; }
    const want = scope === 'all' && canReadAll;
    const loader = want ? getRecentVanguardActions(300) : getMyVanguardActions(profile.uid, 300);
    loader.then((r) => { if (alive) setAll(r || []); }).catch(() => { if (alive) setAll([]); });
    return () => { alive = false; };
  }, [profile?.uid, scope, canReadAll]);

  const q = term.trim().toLowerCase();
  const list = (all || []).filter((a) => {
    if (!q) return true;
    return [a.id, a.moderatorId, a.action, a.targetId, a.targetType, a.rank].join(' ').toLowerCase().includes(q);
  });

  return (
    <VanguardLayout page="lookup-action">
      <VanguardPageHeader title="Action Lookup" subtitle="Search the moderation audit log by action, moderator, target or ID." />

      {canReadAll && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {[{ k: 'mine', l: 'My actions' }, { k: 'all', l: 'All Vanguard' }].map((s) => (
            <button key={s.k} onClick={() => setScope(s.k)}
              style={{ padding: '7px 14px', background: scope === s.k ? 'rgba(180,79,255,.12)' : 'transparent', border: `1px solid ${scope === s.k ? 'rgba(180,79,255,.4)' : C.border}`, borderRadius: 999, color: scope === s.k ? C.violetLt : C.textDim, fontFamily: 'DM Sans', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>{s.l}</button>
          ))}
        </div>
      )}
      {!canReadAll && (
        <div style={{ marginBottom: 12, padding: 10, background: 'rgba(245,200,66,.05)', border: `1px solid rgba(245,200,66,.2)`, borderRadius: 8, fontFamily: 'DM Sans', fontSize: 12, color: C.gold }}>
          <Icon name="info" size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          You can search your own audit trail. The full cross-Vanguard log unlocks at Commander.
        </div>
      )}

      <SearchBar value={term} onChange={setTerm} onRun={() => {}} busy={false} placeholder="Filter by action, moderator ID, target, or entry ID…" />

      {all === null ? (
        <VgCard style={{ textAlign: 'center', color: C.textMuted, padding: 36 }}>Loading…</VgCard>
      ) : list.length === 0 ? (
        <EmptyState icon="search_off" title={q ? 'No matching entries' : 'No audit entries yet'} body={q ? 'Try a different action name, moderator ID or target.' : 'Moderation actions are written to the audit log as they happen. Yours will appear here.'} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {list.map((a) => (
            <VgCard key={a.id} style={{ padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ padding: '2px 8px', background: 'rgba(180,79,255,.1)', borderRadius: 5, fontFamily: 'DM Mono', fontSize: 10.5, fontWeight: 700, color: C.violetLt }}>{(a.action || 'action').replace(/_/g, ' ')}</span>
                {a.targetType && <span style={{ fontFamily: 'DM Sans', fontSize: 12, color: C.textDim }}>{a.targetType}{a.targetId ? ` · ${a.targetId}` : ''}</span>}
                <span style={{ marginLeft: 'auto', fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted }}>{rankTag(a.rank)} · {fmtAgo(a.takenAt)}</span>
              </div>
              <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, marginTop: 4 }}>id {a.id} · mod {a.moderatorId}</div>
            </VgCard>
          ))}
        </div>
      )}
    </VanguardLayout>
  );
}
