// /vanguard/schedule — Tournament moderation schedule.
//
// Two zones:
//   1. "Your schedule" — assignments you've claimed. Cards with countdown,
//      check-in button (active 15 min before start), release button.
//   2. "Open slots" — unclaimed tournaments. Filter by game, tier, time
//      window. Claim button calls vanguardClaimTournament.
//
// Conflict detection runs client-side too (server is source of truth).

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import VanguardLayout, { VG_COLORS as C, VanguardPageHeader, VgCard } from '../../components/vanguard/VanguardLayout';
import Icon from '../../components/Icon';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import {
  getOpenTournamentAssignments,
  getMyTournamentAssignments,
} from '../../firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  TIER_BRACKETS,
  CHECK_IN_OPEN_MIN_BEFORE,
  MIN_SCHEDULING_BUFFER_MIN,
  MAX_CONCURRENT_ASSIGNMENTS,
} from '../../utils/tournamentModeration';

const callCallable = (name, payload) =>
  httpsCallable(getFunctions(undefined, 'europe-west1'), name)(payload).then(r => r.data);

const tsMs = (t) => {
  if (!t) return 0;
  if (t instanceof Date) return t.getTime();
  if (t?.toDate) return t.toDate().getTime();
  if (t?.seconds) return t.seconds * 1000;
  if (typeof t === 'number') return t;
  return 0;
};

const fmtClock = (date) => {
  const d = tsMs(date);
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const fmtCountdown = (ms) => {
  if (ms <= 0) return 'STARTED';
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 48) return `${h}h ${m.toString().padStart(2, '0')}m`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return `${d}d ${rh}h`;
};

// Detect schedule conflict with my existing assignments.
function conflictsWith(target, mine) {
  const ts = tsMs(target.scheduledStart);
  const te = tsMs(target.scheduledEnd);
  for (const m of mine) {
    if (m.status === 'completed' || m.status === 'no_show' || m.status === 'open') continue;
    const ms = tsMs(m.scheduledStart);
    const me = tsMs(m.scheduledEnd);
    if (ms < te && me > ts) return m;
  }
  return null;
}

const TIER_COLOR = {
  small:  C.violetLt,
  medium: C.gold,
  large:  C.ember,
};

function Pill({ text, color = C.violetLt, bg }) {
  return (
    <span style={{
      padding: '3px 9px',
      background: bg || `${color}22`,
      border: `1px solid ${color}44`,
      color,
      borderRadius: 999,
      fontFamily: 'DM Mono',
      fontSize: 10,
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '.08em',
    }}>{text}</span>
  );
}

function AssignmentCard({ a, kind, myAssignments, onClaim, onRelease, onCheckIn, onOpenRoom, busy }) {
  const startMs = tsMs(a.scheduledStart);
  const now = Date.now();
  const msToStart = startMs - now;
  const tierColor = TIER_COLOR[a.tier] || C.violetLt;

  const checkInOpen = msToStart > 0 && msToStart <= CHECK_IN_OPEN_MIN_BEFORE * 60_000;
  const tooLateToCancel = msToStart <= MIN_SCHEDULING_BUFFER_MIN * 60_000;
  const conflict = kind === 'open' ? conflictsWith(a, myAssignments) : null;
  const tooSoon = kind === 'open' && msToStart < MIN_SCHEDULING_BUFFER_MIN * 60_000;
  const atCap = kind === 'open' && myAssignments.filter(m => ['assigned', 'checked_in', 'in_progress'].includes(m.status)).length >= MAX_CONCURRENT_ASSIGNMENTS;

  return (
    <VgCard style={{ padding: 14, borderLeft: `3px solid ${tierColor}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          width: 60, minHeight: 60,
          borderRadius: 10,
          background: a.bannerUrl ? `url(${a.bannerUrl}) center/cover` : `linear-gradient(135deg, ${tierColor}33, ${tierColor}11)`,
          color: tierColor,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          padding: 6,
        }}>
          <Icon name="emoji_events" size={22} />
          <div style={{ fontFamily: 'DM Mono', fontSize: 9, fontWeight: 700, marginTop: 2 }}>{a.tierLabel}</div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
            <Pill text={`${a.vpMultiplier}× VP`} color={tierColor} />
            <Pill text={a.game} color={C.violetLt} />
            <span style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: C.textMuted }}>{fmtClock(a.scheduledStart)}</span>
          </div>
          <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 16, color: C.text, marginBottom: 4 }}>{a.tournamentName}</div>
          <div style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: C.textDim, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <span>{a.participantCount} players</span>
            <span>{a.prizePool.toLocaleString()}c pool</span>
            <span>~{a.estimatedDurationMin} min</span>
          </div>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{
            fontFamily: 'DM Mono',
            fontSize: msToStart < 30 * 60_000 ? 22 : 18,
            fontWeight: 800,
            color: msToStart < 0 ? C.ember : msToStart < 30 * 60_000 ? C.gold : C.text,
            lineHeight: 1,
          }}>{fmtCountdown(msToStart)}</div>
          <div style={{ fontFamily: 'DM Mono', fontSize: 9.5, color: C.textMuted, marginTop: 2 }}>{msToStart < 0 ? 'overdue' : 'to start'}</div>
        </div>
      </div>

      {/* Action row */}
      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {kind === 'open' && (
          conflict ? (
            <button disabled style={{ flex: 1, padding: '10px 14px', background: 'transparent', border: `1px solid ${C.ember}44`, borderRadius: 8, color: C.ember, fontFamily: 'DM Sans', fontSize: 12, fontWeight: 600, cursor: 'not-allowed' }}>
              ⊘ Conflicts with: {conflict.tournamentName}
            </button>
          ) : atCap ? (
            <button disabled style={{ flex: 1, padding: '10px 14px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: C.textMuted, fontFamily: 'DM Sans', fontSize: 12, fontWeight: 600, cursor: 'not-allowed' }}>
              ⊘ Concurrent cap reached ({MAX_CONCURRENT_ASSIGNMENTS} max)
            </button>
          ) : tooSoon ? (
            <button disabled style={{ flex: 1, padding: '10px 14px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: C.textMuted, fontFamily: 'DM Sans', fontSize: 12, fontWeight: 600, cursor: 'not-allowed' }}>
              ⊘ Starts in &lt;{MIN_SCHEDULING_BUFFER_MIN}m — too late
            </button>
          ) : (
            <button
              disabled={busy}
              onClick={() => onClaim(a.id)}
              style={{ flex: 1, padding: '10px 14px', background: C.violet, border: 0, borderRadius: 8, color: C.text, fontFamily: 'DM Sans', fontSize: 13, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}
            >Claim this slot</button>
          )
        )}

        {kind === 'mine' && a.status === 'assigned' && (
          <>
            {checkInOpen ? (
              <button
                disabled={busy}
                onClick={() => onCheckIn(a.id)}
                style={{ flex: 1, padding: '10px 14px', background: C.success, border: 0, borderRadius: 8, color: C.text, fontFamily: 'DM Sans', fontSize: 13, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}
              >✓ Check in now</button>
            ) : (
              <button disabled style={{ flex: 1, padding: '10px 14px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: C.textMuted, fontFamily: 'DM Sans', fontSize: 12, fontWeight: 600, cursor: 'not-allowed' }}>
                Check-in opens 15 min before start
              </button>
            )}
            <button
              disabled={busy}
              onClick={() => onRelease(a.id, tooLateToCancel)}
              title={tooLateToCancel ? '⚠️ Releasing within 1h will count as a no-show strike' : undefined}
              style={{ padding: '10px 14px', background: 'transparent', border: `1px solid ${tooLateToCancel ? C.ember : C.border}`, borderRadius: 8, color: tooLateToCancel ? C.ember : C.textDim, fontFamily: 'DM Sans', fontSize: 12, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}
            >{tooLateToCancel ? '⚠️ Release (no-show)' : 'Release'}</button>
          </>
        )}

        {kind === 'mine' && a.status === 'checked_in' && (
          <button
            onClick={() => onOpenRoom(a.id)}
            style={{ flex: 1, padding: '10px 14px', background: C.violet, border: 0, borderRadius: 8, color: C.text, fontFamily: 'DM Sans', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >Open Moderation Room →</button>
        )}

        {kind === 'mine' && a.status === 'completed' && (
          <div style={{ flex: 1, padding: '10px 14px', background: `${C.success}11`, border: `1px solid ${C.success}33`, borderRadius: 8, color: C.success, fontFamily: 'DM Sans', fontSize: 12, fontWeight: 600, textAlign: 'center' }}>
            ✓ Completed
          </div>
        )}
      </div>
    </VgCard>
  );
}

export default function VanguardScheduleScreen() {
  const navigate = useNavigate();
  const { profile } = useUser();
  const { showToast } = useUI();

  const [mine, setMine] = useState([]);
  const [open, setOpen] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [filterGame, setFilterGame] = useState('all');
  const [filterTier, setFilterTier] = useState('all');

  // Live countdown ticker — refresh every 30s so countdowns stay accurate.
  useEffect(() => {
    const t = setInterval(() => setRefreshKey(k => k + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [o, m] = await Promise.all([
          getOpenTournamentAssignments(50).catch(() => []),
          profile?.uid ? getMyTournamentAssignments(profile.uid, 50).catch(() => []) : Promise.resolve([]),
        ]);
        if (!alive) return;
        setOpen(o || []);
        setMine(m || []);
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [profile?.uid, refreshKey]);

  const onClaim = useCallback(async (assignmentId) => {
    setBusy(true);
    try {
      await callCallable('vanguardClaimTournament', { assignmentId });
      showToast?.('Slot claimed. Reminder will fire 15 min before start.', 'success');
      setRefreshKey(k => k + 1);
    } catch (e) {
      showToast?.(e?.message || 'Claim failed', 'error');
    } finally { setBusy(false); }
  }, [showToast]);

  const onRelease = useCallback(async (assignmentId, tooLate) => {
    if (tooLate && !window.confirm("Releasing within 1 hour of start counts as a no-show strike. Continue?")) return;
    const reason = window.prompt('Optional reason for release:') || '';
    setBusy(true);
    try {
      await callCallable('vanguardReleaseTournamentAssignment', { assignmentId, reason });
      showToast?.('Slot released back to the queue.', 'success');
      setRefreshKey(k => k + 1);
    } catch (e) {
      showToast?.(e?.message || 'Release failed', 'error');
    } finally { setBusy(false); }
  }, [showToast]);

  const onCheckIn = useCallback(async (assignmentId) => {
    setBusy(true);
    try {
      const result = await callCallable('vanguardCheckIn', { assignmentId });
      showToast?.(`Checked in! +${result.vpGranted} VP awarded.`, 'success');
      // Navigate to the Moderation Room — the post-check-in destination.
      navigate(`/vanguard/moderation-room/${assignmentId}`);
    } catch (e) {
      showToast?.(e?.message || 'Check-in failed', 'error');
    } finally { setBusy(false); }
  }, [showToast, navigate]);

  // Apply filters to the open list.
  const filteredOpen = useMemo(() => open.filter((a) => {
    if (filterGame !== 'all' && a.game !== filterGame) return false;
    if (filterTier !== 'all' && a.tier !== filterTier) return false;
    return true;
  }), [open, filterGame, filterTier]);

  const games = useMemo(() => Array.from(new Set(open.map(o => o.game))).sort(), [open]);
  const activeMine = mine.filter(m => ['assigned', 'checked_in', 'in_progress'].includes(m.status));

  return (
    <VanguardLayout page="schedule">
      <VanguardPageHeader
        title="Schedule"
        subtitle="Claim tournament slots, check in on time, get paid for your effort."
        right={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontFamily: 'DM Mono', fontSize: 11, color: C.textDim }}>
              Active: {activeMine.length}/{MAX_CONCURRENT_ASSIGNMENTS}
            </span>
            <button
              onClick={() => setRefreshKey(k => k + 1)}
              style={{ padding: '8px 14px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: C.textDim, fontFamily: 'DM Sans', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Icon name="refresh" size={14} /> Refresh
            </button>
          </div>
        }
      />

      {/* Strike warning if you have any */}
      {(profile?.vanguard?.noShowStrikes || 0) > 0 && (
        <VgCard style={{ marginBottom: 14, borderLeft: `3px solid ${C.ember}`, background: 'rgba(240,64,96,.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Icon name="warning" size={22} style={{ color: C.ember }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: 13, color: C.ember }}>
                {profile.vanguard.noShowStrikes} no-show strike{profile.vanguard.noShowStrikes > 1 ? 's' : ''} on record
              </div>
              <div style={{ fontFamily: 'DM Sans', fontSize: 12, color: C.textDim, marginTop: 3 }}>
                3 strikes in 30 days triggers a suspension review. Check in within 10 min of every tournament start.
              </div>
            </div>
          </div>
        </VgCard>
      )}

      {/* MY SCHEDULE */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <h2 style={{ fontFamily: 'DM Mono', fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em', margin: 0 }}>Your schedule · {activeMine.length}</h2>
      </div>
      {loading ? (
        <VgCard style={{ textAlign: 'center', color: C.textMuted, padding: 30 }}>Loading…</VgCard>
      ) : activeMine.length === 0 ? (
        <VgCard style={{ textAlign: 'center', padding: 30 }}>
          <Icon name="event_available" size={32} style={{ color: C.textMuted, marginBottom: 6 }} />
          <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: 14, color: C.text }}>No assignments claimed.</div>
          <div style={{ fontFamily: 'DM Sans', fontSize: 12, color: C.textMuted, marginTop: 4 }}>Claim a slot from the open list below.</div>
        </VgCard>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 22 }}>
          {activeMine.map((a) => (
            <AssignmentCard key={a.id} a={a} kind="mine" myAssignments={mine} busy={busy} onCheckIn={onCheckIn} onRelease={onRelease} onOpenRoom={(id) => navigate(`/vanguard/moderation-room/${id}`)} />
          ))}
        </div>
      )}

      {/* OPEN SLOTS */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <h2 style={{ fontFamily: 'DM Mono', fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em', margin: 0 }}>Open slots · {filteredOpen.length}</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={filterTier} onChange={e => setFilterTier(e.target.value)} style={{ padding: '6px 10px', background: C.card2, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontFamily: 'DM Sans', fontSize: 11.5, outline: 'none', cursor: 'pointer' }}>
            <option value="all">All tiers</option>
            {Object.entries(TIER_BRACKETS).map(([k, v]) => <option key={k} value={k}>{v.label} ({v.vpMult}×)</option>)}
          </select>
          <select value={filterGame} onChange={e => setFilterGame(e.target.value)} style={{ padding: '6px 10px', background: C.card2, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontFamily: 'DM Sans', fontSize: 11.5, outline: 'none', cursor: 'pointer' }}>
            <option value="all">All games</option>
            {games.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
      </div>
      {filteredOpen.length === 0 ? (
        <VgCard style={{ textAlign: 'center', padding: 30, color: C.textMuted, fontSize: 13 }}>
          No open slots match your filters.
        </VgCard>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filteredOpen.map((a) => (
            <AssignmentCard key={a.id} a={a} kind="open" myAssignments={mine} busy={busy} onClaim={onClaim} />
          ))}
        </div>
      )}

      <div style={{ marginTop: 22, fontFamily: 'DM Mono', fontSize: 10.5, color: C.textMuted, textAlign: 'center', lineHeight: 1.5 }}>
        VP at check-in scales with tier · Standard 1× · Weekly Cup 1.5× · Championship 3×.<br/>
        Tournament prize-pool 5% mod cut routes to the Vanguard treasury when you moderate.
      </div>
    </VanguardLayout>
  );
}
