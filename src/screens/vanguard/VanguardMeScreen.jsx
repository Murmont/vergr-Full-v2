// Moderator dashboard — `/vanguard/me`. Tabs: Queue / Stats / Roster /
// Handbook. Pinned in the Vanguard squad chat as the moderator workspace.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import {
  getTournamentsNeedingDecision,
  getAllVanguardMembers,
  getMyVanguardActions,
  getPendingReports,
  getVanguardTreasurySnapshot,
  getMyVanguardPayoutHistory,
} from '../../firebase/firestore';
import { rankMeta, isVanguard, RANK_BY_ID } from '../../utils/vanguard';
import Icon from '../../components/Icon';

const C = { bg: '#0B0B14', card: '#12121e', border: '#1e1e30', text: '#fff', textDim: '#9CA3AF', purple: '#B44FFF', gold: '#F5C842', success: '#22D17E', ember: '#F04060' };
const monthKey = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const tsMs = (t) => (t?.toDate ? t.toDate().getTime() : t?.seconds ? t.seconds * 1000 : t ? new Date(t).getTime() : 0);
const ago = (t) => {
  const ms = Date.now() - tsMs(t); if (!tsMs(t)) return '—';
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
};

export default function VanguardMeScreen() {
  const { profile } = useUser();
  const navigate = useNavigate();
  const [tab, setTab] = useState('queue');

  // Founder (role==='admin') gets a read-only view of this dashboard so
  // they can audit how moderators see their workspace. Founder can read
  // every tab but the action buttons (winner-call, resolve report) are
  // disabled — actions would attribute to a non-Vanguard uid which the
  // server callables reject anyway.
  const isFounderView = profile?.role === 'admin' && !isVanguard(profile);
  if (profile && !isVanguard(profile) && !isFounderView) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: C.textDim, background: C.bg, minHeight: '100vh' }}>
        <Icon name="shield" size={48} className="opacity-40 mx-auto" />
        <p style={{ marginTop: 12 }}>This dashboard is for Vanguard members only.</p>
        <p style={{ marginTop: 4, fontSize: 12 }}>If you were invited, check your notifications for the acceptance link.</p>
      </div>
    );
  }
  if (!profile) return <div style={{ padding: 60, textAlign: 'center', color: C.textDim, background: C.bg, minHeight: '100vh' }}>Loading…</div>;

  // Founder doesn't have a Vanguard rank — fall back to "founder" view
  // so the rank-display logic doesn't render as Recruit.
  const meta = isFounderView
    ? { id: 'founder', label: 'Founder', avatar: '/brand/logo.png', badge: '/brand/logo.png', actionVp: 0, treasuryWeight: 0, blurb: 'Founder oversight view — read-only.' }
    : rankMeta(profile.vanguard?.rank);
  const v = profile.vanguard || {};

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 24px' }}>
        {/* Founder-view banner */}
        {isFounderView && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 14px', marginBottom: 14, borderRadius: 10,
            background: 'rgba(240,165,0,.08)', border: '1px solid rgba(240,165,0,.30)',
            color: C.gold, fontSize: 12.5,
          }}>
            <Icon name="visibility" size={16} />
            <span><strong style={{ color: C.text }}>Founder oversight view.</strong> You're seeing this dashboard exactly as a moderator would. Action buttons (winner-call, resolve report, etc.) are disabled because actions are attributed to your real uid which isn't Vanguard.</span>
          </div>
        )}

        {/* Header strip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 18, background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, marginBottom: 18 }}>
          <img src={meta.avatar} alt="" style={{ width: 56, height: 56, borderRadius: 12, objectFit: 'cover' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'Syne', fontSize: 20, fontWeight: 800 }}>{meta.label}</span>
              <img src={meta.badge} alt="" style={{ height: 20, width: 'auto' }} />
              {v.status && v.status !== 'active' && (
                <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'rgba(240,64,96,.15)', color: C.ember, textTransform: 'uppercase', letterSpacing: '.1em' }}>{v.status}</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 14, fontSize: 11, color: C.textDim, marginTop: 6 }}>
              <span>{(v.monthlyActions && v.monthlyActions[monthKey()]) || 0} actions this month</span>
              <span>{v.totalActions || 0} all-time</span>
              <span style={{ color: C.success }}>0% conversion fee</span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textDim, textTransform: 'uppercase', letterSpacing: '.1em' }}>Treasury weight</div>
            <div style={{ fontFamily: 'DM Mono', fontSize: 22, fontWeight: 800, color: C.gold }}>{meta.treasuryWeight}×</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 18, borderBottom: `1px solid ${C.border}` }}>
          {[
            { id: 'queue',    label: 'Queue',     icon: 'inventory_2' },
            { id: 'stats',    label: 'My Stats',  icon: 'monitoring' },
            { id: 'roster',   label: 'Roster',    icon: 'groups' },
            { id: 'handbook', label: 'Handbook',  icon: 'menu_book' },
          ].map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '10px 14px', border: 0,
                background: tab === t.id ? C.card : 'transparent',
                color: tab === t.id ? C.text : C.textDim,
                borderBottom: tab === t.id ? `2px solid ${C.purple}` : '2px solid transparent',
                borderRadius: '8px 8px 0 0', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >
              <Icon name={t.icon} size={16} /> {t.label}
            </button>
          ))}
        </div>

        {tab === 'queue'    && <QueueTab meta={meta} isFounderView={isFounderView} />}
        {tab === 'stats'    && <StatsTab v={v} meta={meta} isFounderView={isFounderView} />}
        {tab === 'roster'   && <RosterTab myUid={profile.uid} />}
        {tab === 'handbook' && <HandbookTab />}
      </div>
    </div>
  );
}

// ─── QUEUE ─────────────────────────────────────────────────────────
function QueueTab({ meta, isFounderView }) {
  const { showToast } = useUI();
  const [sub, setSub] = useState('tournaments'); // 'tournaments' | 'reports'
  const [rows, setRows] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  // Recruit OR founder = read-only (founder isn't Vanguard so server
  // callables would reject anyway).
  const isRecruit = meta.id === 'recruit';
  const readOnly = isRecruit || isFounderView;

  const load = async () => {
    setLoading(true);
    try {
      const [t, r] = await Promise.all([
        getTournamentsNeedingDecision(30),
        getPendingReports(30),
      ]);
      setRows(t); setReports(r);
    } catch (e) { console.warn(e); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const resolveReport = async (report, decision) => {
    if (readOnly) { showToast(isFounderView ? 'Founder view is read-only.' : 'Recruits are read-only.', 'info'); return; }
    const reason = window.prompt(
      `${decision === 'approve' ? 'Approve' : decision === 'reject' ? 'Reject' : 'Escalate'} report?\n\nApprove = take the content/user down. Reject = dismiss. Escalate = bump to Commander+.\n\nReason for the audit log:`,
      ''
    );
    if (reason === null) return;
    setBusy(`report:${report.id}`);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'vanguardResolveReport');
      const r = await fn({ reportId: report.id, decision, reason });
      showToast(`Report ${decision}d. +${r.data.vpGranted} VP.`, 'success');
      setReports((prev) => prev.filter((x) => x.id !== report.id));
    } catch (e) {
      showToast(e?.message || 'Failed', 'error');
    }
    setBusy(null);
  };

  const callWinner = async (row, winnerId) => {
    if (readOnly) {
      showToast(isFounderView
        ? 'Founder view is read-only. Use /admin/vanguard to manage roster.'
        : 'Recruits are read-only. Shadow your seniors until promoted.', 'info');
      return;
    }
    const reason = window.prompt('Brief reason for this call (logged to the audit trail). Optional.', '');
    if (reason === null) return; // user hit Cancel
    setBusy(`${row.tournamentId}:${row.matchId}`);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'vanguardCallTournamentWinner');
      const r = await fn({ tournamentId: row.tournamentId, matchId: row.matchId, winnerId, reason });
      showToast(`Winner recorded. +${r.data.vpGranted} VP credited.`, 'success');
      // Optimistically remove the row from the queue.
      setRows((prev) => prev.filter((x) => x.matchId !== row.matchId));
    } catch (e) {
      showToast(e?.message || 'Call failed', 'error');
    }
    setBusy(null);
  };

  if (loading) return <Box>Loading queue…</Box>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {isRecruit && !isFounderView && (
        <div style={{ padding: 12, background: 'rgba(240,165,0,.08)', border: '1px solid rgba(240,165,0,.25)', borderRadius: 10, color: C.gold, fontSize: 12.5 }}>
          You're a Recruit — read-only. Watch how seniors handle these and ask questions in the Vanguard squad chat.
        </div>
      )}

      {/* Sub-tab toggle for Tournaments vs Reports */}
      <div style={{ display: 'flex', gap: 6 }}>
        {[
          { id: 'tournaments', label: `Tournaments (${rows.length})`,    icon: 'emoji_events' },
          { id: 'reports',     label: `User Reports (${reports.length})`, icon: 'flag' },
        ].map((s) => (
          <button key={s.id} onClick={() => setSub(s.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '7px 12px', border: `1px solid ${sub === s.id ? C.purple : C.border}`,
              background: sub === s.id ? 'rgba(180,79,255,.10)' : 'transparent',
              color: sub === s.id ? C.purple : C.textDim,
              borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >
            <Icon name={s.icon} size={13} /> {s.label}
          </button>
        ))}
      </div>

      {sub === 'reports' && (
        reports.length === 0
          ? <Empty icon="check_circle" text="No pending reports" sub="Users haven't flagged anything that's not been resolved." />
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {reports.map((r) => (
                <div key={r.id} style={{ padding: 14, background: C.card, border: `1px solid ${r.priority === 'critical' ? 'rgba(240,64,96,.4)' : C.border}`, borderRadius: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: r.priority === 'critical' ? 'rgba(240,64,96,.18)' : 'rgba(180,79,255,.14)', color: r.priority === 'critical' ? C.ember : C.purple, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>
                      {r.priority || 'normal'} · {r.targetType}
                    </span>
                    <span style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: C.textDim }}>
                      Reason: <strong style={{ color: C.text }}>{r.reason}</strong> · {ago(r.createdAt)}
                    </span>
                  </div>
                  {r.details && (
                    <div style={{ fontSize: 12.5, color: C.textDim, lineHeight: 1.5, marginBottom: 10, padding: '8px 10px', background: 'rgba(255,255,255,.02)', borderRadius: 6 }}>
                      "{r.details}"
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: C.textDim, marginBottom: 10 }}>
                    Target id: <code>{r.targetId}</code>
                    {r.targetType === 'post' && (
                      <> · <a href={`/post/${r.targetId}`} target="_blank" rel="noopener noreferrer" style={{ color: C.purple, textDecoration: 'underline' }}>Open post</a></>
                    )}
                    {r.targetType === 'user' && (
                      <> · <a href={`/user/${r.targetId}`} target="_blank" rel="noopener noreferrer" style={{ color: C.purple, textDecoration: 'underline' }}>Open user</a></>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button disabled={readOnly || busy === `report:${r.id}`} onClick={() => resolveReport(r, 'approve')}
                      style={callBtn(C.ember, readOnly)}>
                      <Icon name="block" size={13} /> Approve (take down)
                    </button>
                    <button disabled={readOnly || busy === `report:${r.id}`} onClick={() => resolveReport(r, 'reject')}
                      style={callBtn('#444', readOnly)}>
                      <Icon name="close" size={13} /> Reject
                    </button>
                    <button disabled={readOnly || busy === `report:${r.id}`} onClick={() => resolveReport(r, 'escalate')}
                      style={callBtn(C.gold, readOnly)}>
                      <Icon name="arrow_upward" size={13} /> Escalate
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
      )}

      {sub === 'tournaments' && rows.length === 0 && (
        <Empty icon="check_circle" text="No tournaments needing a decision" sub="Treasury hits when you mod a tournament that finalises." />
      )}

      {sub === 'tournaments' && rows.map((row) => {
        const m = row.match;
        const t = row.tournament || {};
        const p1 = m.player1;
        const p2 = m.player2;
        const status = m.status; // 'disputed' or 'awaiting_confirmation'
        const reported = m.firstReportedWinner || null;
        const reporter = m.firstReporter || null;
        return (
          <div key={`${row.tournamentId}-${row.matchId}`} style={{ padding: 16, background: C.card, border: `1px solid ${status === 'disputed' ? 'rgba(240,64,96,.35)' : C.border}`, borderRadius: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 14 }}>{t.name || 'Tournament'}</span>
                  <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: status === 'disputed' ? 'rgba(240,64,96,.15)' : 'rgba(240,165,0,.15)', color: status === 'disputed' ? C.ember : C.gold, textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>
                    {status === 'disputed' ? 'Disputed' : 'Awaiting confirm'}
                  </span>
                </div>
                <div style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: C.textDim, marginTop: 4 }}>
                  {t.game || 'Game'} · Match {m.matchNumber ?? row.matchId} · Round {m.round ?? '?'}
                  {reporter && reported && <> · {reporter.slice(0, 6)} reported {reported.slice(0, 6)} won</>}
                </div>
              </div>
              <button onClick={() => window.open(`/match/${row.tournamentId}`, '_blank')}
                style={{ padding: '6px 10px', background: 'transparent', border: `1px solid ${C.border}`, color: C.textDim, borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>
                <Icon name="open_in_new" size={12} /> Open tournament
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button disabled={readOnly || busy === `${row.tournamentId}:${row.matchId}`}
                onClick={() => callWinner(row, p1)}
                style={callBtn(C.purple, readOnly || !p1)}>
                <Icon name="check" size={14} /> Player 1 ({p1?.slice(0, 6) || '—'}) wins
              </button>
              <button disabled={readOnly || busy === `${row.tournamentId}:${row.matchId}`}
                onClick={() => callWinner(row, p2)}
                style={callBtn(C.purple, readOnly || !p2)}>
                <Icon name="check" size={14} /> Player 2 ({p2?.slice(0, 6) || '—'}) wins
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── STATS ─────────────────────────────────────────────────────────
function StatsTab({ v, meta, isFounderView }) {
  const { profile } = useUser();
  const [actions, setActions] = useState([]);
  const [actionsLoading, setActionsLoading] = useState(true);
  const [treasury, setTreasury] = useState(null);
  const [treasuryLoading, setTreasuryLoading] = useState(true);
  const [payouts, setPayouts] = useState([]);

  useEffect(() => {
    if (!profile?.uid) return;
    getMyVanguardActions(profile.uid, 50)
      .then(setActions).catch(() => {}).finally(() => setActionsLoading(false));
    getVanguardTreasurySnapshot(profile.uid)
      .then(setTreasury).catch(() => {}).finally(() => setTreasuryLoading(false));
    getMyVanguardPayoutHistory(profile.uid, 12)
      .then(setPayouts).catch(() => {});
  }, [profile?.uid]);

  const tournamentCalls = actions.filter((a) => a.action === 'tournament_winner_call').length;
  const monthCounts = v.monthlyActions || {};
  const myActionsThisMonth = monthCounts[monthKey()] || 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Treasury — live balance + projected share */}
      <div style={{ padding: 18, background: 'linear-gradient(135deg, rgba(245,200,66,.08), rgba(180,79,255,.06))', border: '1px solid rgba(245,200,66,.30)', borderRadius: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Icon name="account_balance" size={18} style={{ color: C.gold }} />
          <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 15 }}>Vanguard Treasury</div>
          <span style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textDim, marginLeft: 'auto' }}>
            Settles 1st of {nextMonthLabel()} at 00:05 UTC
          </span>
        </div>
        {treasuryLoading ? (
          <div style={{ color: C.textDim, fontSize: 12 }}>Loading…</div>
        ) : !treasury?.configured ? (
          <div style={{ color: C.textDim, fontSize: 12 }}>Vanguard squad not configured. Founder needs to bootstrap from <code>/admin</code>.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <Tile label="Treasury balance"
              value={<><img src="/brand/vc-coin.webp" alt="" style={{ width: 16, height: 16, verticalAlign: '-3px', marginRight: 4 }} />{(treasury.balance || 0).toLocaleString()}</>}
              accent={C.gold} />
            <Tile label={isFounderView ? 'Active mods this month' : 'Your projected share'}
              value={isFounderView
                ? `${treasury.eligibleCount}`
                : <><img src="/brand/vc-coin.webp" alt="" style={{ width: 16, height: 16, verticalAlign: '-3px', marginRight: 4 }} />{(treasury.projectedShare || 0).toLocaleString()}</>}
              accent={C.success}
              sub={isFounderView ? null : `Weight ${treasury.myWeight.toFixed(2)} of ${treasury.totalWeight.toFixed(2)} total`} />
            <Tile label="Your weight"
              value={`${(meta.treasuryWeight || 0)}× × ${myActionsThisMonth} = ${(meta.treasuryWeight * myActionsThisMonth).toFixed(2)}`}
              accent={C.purple}
              sub="rank × actions this month" />
          </div>
        )}
        {!isFounderView && treasury?.configured && myActionsThisMonth === 0 && (
          <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(240,165,0,.06)', border: '1px solid rgba(240,165,0,.20)', borderRadius: 8, fontSize: 11.5, color: C.gold }}>
            ⚠ No actions taken this month — you'll receive <strong>0 coins</strong> in the next distribution. Show up and work.
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <Tile label="Total actions"        value={v.totalActions || 0} />
        <Tile label="This month"           value={myActionsThisMonth} />
        <Tile label="Tournament winners"   value={tournamentCalls} accent={C.purple} />
        <Tile label="VP per next action"   value={`+${meta.actionVp}`} accent={C.success} />
      </div>

      {/* Payout history */}
      <div style={{ padding: 16, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12 }}>
        <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Payout history</div>
        {payouts.length === 0 ? (
          <div style={{ color: C.textDim, fontSize: 12 }}>No past payouts yet. Distributions hit the 1st of each month at 00:05 UTC for the just-closed month.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {payouts.map((p) => (
              <div key={p.monthKey} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 100px 120px', gap: 10, padding: '8px 10px', background: 'rgba(255,255,255,.025)', borderRadius: 8, fontSize: 12, alignItems: 'center' }}>
                <span style={{ fontFamily: 'DM Mono', fontWeight: 700 }}>{p.monthKey}</span>
                <span style={{ color: C.textDim }}>{p.actions} action{p.actions === 1 ? '' : 's'} · {p.rank}</span>
                <span style={{ color: C.textDim, fontFamily: 'DM Mono', fontSize: 11 }}>pool {p.totalPool?.toLocaleString() || '—'}</span>
                <span style={{ fontFamily: 'DM Mono', fontWeight: 800, color: C.gold, textAlign: 'right' }}>
                  +{p.coins.toLocaleString()}
                  <img src="/brand/vc-coin.webp" alt="" style={{ width: 12, height: 12, verticalAlign: '-2px', marginLeft: 4 }} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: 16, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12 }}>
        <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Recent actions</div>
        {actionsLoading ? <div style={{ color: C.textDim }}>Loading…</div>
          : actions.length === 0 ? <div style={{ color: C.textDim, fontSize: 12 }}>No actions yet. The Queue tab is where you take your first one.</div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {actions.map((a) => (
                <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', background: 'rgba(255,255,255,.025)', borderRadius: 8, fontSize: 12 }}>
                  <span><strong style={{ color: C.purple }}>{a.action.replace(/_/g, ' ')}</strong> {a.tournamentName || a.targetId}</span>
                  <span style={{ color: C.textDim, fontFamily: 'DM Mono' }}>{ago(a.takenAt)}</span>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}

const nextMonthLabel = () => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toLocaleString([], { month: 'long', timeZone: 'UTC' });
};

// ─── ROSTER ────────────────────────────────────────────────────────
function RosterTab({ myUid }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { getAllVanguardMembers().then(setMembers).catch(() => {}).finally(() => setLoading(false)); }, []);
  const sorted = useMemo(() => [...members].sort((a, b) => (RANK_BY_ID[b.vanguard?.rank]?.order || 0) - (RANK_BY_ID[a.vanguard?.rank]?.order || 0)), [members]);
  if (loading) return <Box>Loading…</Box>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11.5, color: C.textDim, marginBottom: 4 }}>
        Real identities of every Vanguard. Confidential — never share outside the squad.
      </div>
      {sorted.map((m) => {
        const meta = rankMeta(m.vanguard?.rank);
        const v = m.vanguard || {};
        const isMe = m.id === myUid;
        return (
          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: isMe ? 'rgba(180,79,255,.06)' : C.card, border: `1px solid ${isMe ? 'rgba(180,79,255,.35)' : C.border}`, borderRadius: 10 }}>
            <img src={meta.avatar} alt="" style={{ width: 38, height: 38, borderRadius: 9, objectFit: 'cover' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{m.displayName || m.username || m.id.slice(0, 8)}</span>
                <img src={meta.badge} alt="" style={{ height: 14, width: 'auto' }} />
                {isMe && <span style={{ fontSize: 9.5, padding: '1px 6px', borderRadius: 3, background: 'rgba(180,79,255,.18)', color: C.purple, textTransform: 'uppercase', letterSpacing: '.1em' }}>You</span>}
              </div>
              <div style={{ fontSize: 10.5, color: C.textDim, marginTop: 2 }}>
                @{m.username || m.id.slice(0, 6)} · {v.totalActions || 0} actions · last {ago(v.lastActionAt)}
              </div>
            </div>
            <span style={{ fontSize: 10, padding: '3px 7px', borderRadius: 4, background: v.status === 'active' || !v.status ? 'rgba(34,209,126,.14)' : 'rgba(240,64,96,.14)', color: v.status === 'active' || !v.status ? C.success : C.ember, textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 700 }}>
              {v.status || 'active'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── HANDBOOK ─────────────────────────────────────────────────────
function HandbookTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720 }}>
      <Section title="Code of Conduct (the rules you signed)">
        <ol style={{ paddingLeft: 20, fontSize: 13, lineHeight: 1.7, color: C.textDim }}>
          <li><strong style={{ color: C.text }}>Anonymity is absolute.</strong> Never reveal your real identity to any user. First offence = demotion to Recruit. Second = removal + permaban.</li>
          <li><strong style={{ color: C.text }}>No personal moderation.</strong> Recuse if you know the person off-platform.</li>
          <li><strong style={{ color: C.text }}>No retaliation.</strong> Never use mod powers against users who criticised you / the platform.</li>
          <li><strong style={{ color: C.text }}>Tournament decisions are final</strong> once posted unless appealed to Senior+.</li>
          <li><strong style={{ color: C.text }}>Confidentiality.</strong> Audit logs, evidence, user reports, Vanguard chat content never leave the squad.</li>
          <li><strong style={{ color: C.text }}>Consistency.</strong> Same rule to similar cases. Ask in chat when unsure.</li>
          <li><strong style={{ color: C.text }}>Inactivity = forfeit.</strong> No login in 30d → treasury share suspended. 90d → rank degrades.</li>
          <li><strong style={{ color: C.text }}>Conflict of interest.</strong> Declare any stake + recuse.</li>
        </ol>
      </Section>

      <Section title="How payouts work">
        <ul style={{ paddingLeft: 20, fontSize: 13, lineHeight: 1.7, color: C.textDim }}>
          <li>The 5% mod fee from every tournament you officially decide goes into the <strong style={{ color: C.text }}>Vanguard squad treasury</strong>.</li>
          <li>On the 1st of every month at 00:05 UTC, the treasury auto-splits.</li>
          <li>Your share = <code>(your rank weight × your action count this month) / Σ (everyone's weight × actions)</code> × treasury pool.</li>
          <li>Recruits earn 0× (no share until promoted to Vanguard).</li>
          <li>Vanguard 1×, Senior 1.25×, Commander 1.5×, Overseer 2×.</li>
          <li>You also earn <strong style={{ color: C.success }}>per-action VP</strong> at your rank's rate (Vanguard +50, Senior +100, Commander +200, Overseer +500). Climbing to VP L100 puts you at the 5% withdrawal-commission floor.</li>
          <li><strong style={{ color: C.success }}>Coin → Gem conversion is 0% commission</strong> for you. Normal users pay 5–30%.</li>
        </ul>
      </Section>

      <Section title="When you take a tournament winner call">
        <ul style={{ paddingLeft: 20, fontSize: 13, lineHeight: 1.7, color: C.textDim }}>
          <li>Open the tournament page (top-right button on each Queue card).</li>
          <li>Watch the VOD or both players' submitted evidence. If neither is conclusive, ask in Vanguard squad chat before deciding.</li>
          <li>Click the winner button. Add a brief reason — it's logged forever to the audit trail.</li>
          <li>Your action immediately advances the bracket. No two-player agreement needed.</li>
          <li>The tournament is flagged <code>vanguardModerated: true</code>. When it finalises, the 5% mod cut routes to the treasury and you get monthly-action credit toward your share.</li>
        </ul>
      </Section>

      <Section title="Platform rules you should know (FAQ for users)">
        <ul style={{ paddingLeft: 20, fontSize: 13, lineHeight: 1.7, color: C.textDim }}>
          <li><strong style={{ color: C.text }}>Tips:</strong> 10% flat platform fee at send time. Recipient gets 90%.</li>
          <li><strong style={{ color: C.text }}>Coin → Gem conversion:</strong> tier-based commission (Rookie 30% → Diamond 5%). You're 0%.</li>
          <li><strong style={{ color: C.text }}>Tournaments:</strong> 5% mod cut. Max entry fee 10,000 coins. Max prize pool 500,000 coins (Riot caps).</li>
          <li><strong style={{ color: C.text }}>Payouts:</strong> 7-day hold, 2% spread, crypto-only at launch, min 1,000 gems.</li>
          <li><strong style={{ color: C.text }}>Squads:</strong> 100-member cap (Vanguard is unlimited). /vote in chat triggers role elections.</li>
          <li><strong style={{ color: C.text }}>KYC:</strong> required for tournament entry + payouts. Not required for tipping / buying coins.</li>
          <li><strong style={{ color: C.text }}>Free streaming:</strong> requires 100 followers + 50-coin Stream Boost (refunded by first 50 in tips).</li>
        </ul>
      </Section>
    </div>
  );
}

// ─── UI helpers ───────────────────────────────────────────────────
function Tile({ label, value, accent, sub }) {
  return (
    <div style={{ padding: 14, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10 }}>
      <div style={{ fontSize: 10.5, color: C.textDim, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 5 }}>{label}</div>
      <div style={{ fontFamily: 'DM Mono', fontWeight: 800, fontSize: 22, color: accent || C.text }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
function Box({ children }) {
  return <div style={{ padding: 40, textAlign: 'center', color: C.textDim, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12 }}>{children}</div>;
}
function Empty({ icon, text, sub }) {
  return (
    <div style={{ padding: '48px 24px', textAlign: 'center', color: C.textDim, background: C.card, border: `1px solid ${C.border}`, borderRadius: 14 }}>
      <Icon name={icon} size={44} className="opacity-50 mx-auto mb-3" />
      <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 15, color: C.text, marginTop: 8 }}>{text}</div>
      {sub && <div style={{ fontSize: 12, marginTop: 6, maxWidth: 420, margin: '6px auto 0' }}>{sub}</div>}
    </div>
  );
}
function Section({ title, children }) {
  return (
    <section style={{ padding: 18, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12 }}>
      <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 16, marginBottom: 10 }}>{title}</div>
      {children}
    </section>
  );
}
const callBtn = (color, disabled) => ({
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 14px', background: disabled ? '#3a3a55' : color, color: '#fff', border: 0,
  borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? .6 : 1,
});
