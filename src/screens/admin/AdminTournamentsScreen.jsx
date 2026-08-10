// AdminTournamentsScreen — /admin/tournaments
//
// Pass 1 tabs wired: Overview / All / Dispute Resolution / Cancel & Refund.
// Pass 2 tabs (Vergr Grand / Announcements / Participant Overrides / Settings / Logs)
// land in the next session — placeholder cards in this build.

import { useState, useEffect, useCallback } from 'react';
import { useUI } from '../../context/UIContext';
import AdminShell, { ADMIN_COLORS as C } from './AdminShell';
import {
  call, fmtNumber, fmtDate, fmtRelative,
  useGuardedCall, ReasonPrompt, KpiCard, Tabs,
} from './_adminGuarded';
import { subscribeGameRequests, setGameRequestStatus, deleteGameRequest } from '../../firebase/firestore';

const TABS = [
  { id: 'overview',    label: 'Overview' },
  { id: 'all',         label: 'All Tournaments' },
  { id: 'requests',    label: 'Game Requests' },
  { id: 'vgt',         label: 'Vergr Grand' },
  { id: 'announce',    label: 'Announcements' },
  { id: 'cancel',      label: 'Cancel & Refund' },
  { id: 'disputes',    label: 'Dispute Resolution' },
  { id: 'overrides',   label: 'Participant Overrides' },
  { id: 'settings',    label: 'Settings' },
  { id: 'evidence',    label: 'Evidence Storage' },
  { id: 'logs',        label: 'Logs' },
];

export default function AdminTournamentsScreen() {
  const [tab, setTab] = useState('overview');
  const { guarded, overlay } = useGuardedCall();

  return (
    <AdminShell
      screen="tournaments"
      title="Tournaments"
      subtitle="Manage tournaments, participants, prizes, disputes and communications."
    >
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'overview'  && <OverviewTab />}
      {tab === 'all'       && <AllTab />}
      {tab === 'requests'  && <GameRequestsTab />}
      {tab === 'disputes'  && <DisputesTab guarded={guarded} />}
      {tab === 'cancel'    && <CancelTab    guarded={guarded} />}
      {tab === 'vgt'       && <VgtTab       guarded={guarded} />}
      {tab === 'announce'  && <AnnouncementsTab guarded={guarded} />}
      {tab === 'overrides' && <OverridesTab guarded={guarded} />}
      {tab === 'settings'  && <SettingsTab  guarded={guarded} />}
      {tab === 'evidence'  && <EvidenceTab  guarded={guarded} />}
      {tab === 'logs'      && <LogsTab />}
      {overlay}
    </AdminShell>
  );
}

// ───────────────────────────────────────────────────────────
// GAME REQUESTS — hosts asking for an unlisted game to be added
// ───────────────────────────────────────────────────────────

function GameRequestsTab() {
  const { showToast } = useUI();
  const [rows, setRows] = useState(null);

  useEffect(() => subscribeGameRequests(setRows), []);

  const resolve = async (id, status) => {
    try { await setGameRequestStatus(id, status); }
    catch (e) { showToast(e.message || 'Failed', 'error'); }
  };
  const remove = async (id) => {
    try { await deleteGameRequest(id); showToast('Request deleted', 'success'); }
    catch (e) { showToast(e.message || 'Failed', 'error'); }
  };

  const newCount = (rows || []).filter(r => (r.status || 'new') === 'new').length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <h3 style={{ color: C.text, fontSize: 16, fontWeight: 700, margin: 0 }}>Game Requests</h3>
        {newCount > 0 && (
          <span style={{ background: `${C.accent}30`, color: C.accent2, fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 999 }}>
            {newCount} new
          </span>
        )}
      </div>
      <p style={{ color: C.textDim, fontSize: 13, marginTop: 0, marginBottom: 16 }}>
        Hosts request games we don't list yet from the Create Tournament screen. Add the game to the registry, then mark the request done.
      </p>

      {rows === null && <div style={{ color: C.textMuted, fontSize: 13 }}>Loading…</div>}
      {rows && rows.length === 0 && (
        <div style={{ color: C.textMuted, fontSize: 13, padding: '28px 0', textAlign: 'center', border: `1px dashed ${C.border}`, borderRadius: 12 }}>
          No game requests yet.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(rows || []).map(r => {
          const done = (r.status || 'new') !== 'new';
          return (
            <div key={r.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, opacity: done ? 0.55 : 1 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>{r.game || '—'}</div>
                {r.note && <div style={{ color: C.textDim, fontSize: 12, marginTop: 2 }}>{r.note}</div>}
                <div style={{ color: C.textMuted, fontSize: 11, marginTop: 3 }}>
                  {r.username ? `${r.username} · ` : ''}{r.createdAt ? fmtRelative(r.createdAt) : ''}
                </div>
              </div>
              {!done ? (
                <button onClick={() => resolve(r.id, 'done')}
                  style={{ background: `${C.accent}25`, color: C.accent2, border: `1px solid ${C.accent}55`, borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  Mark done
                </button>
              ) : (
                <button onClick={() => resolve(r.id, 'new')}
                  style={{ background: 'transparent', color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  Reopen
                </button>
              )}
              <button onClick={() => remove(r.id)} title="Delete"
                style={{ background: 'transparent', color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// OVERVIEW
// ───────────────────────────────────────────────────────────

function OverviewTab() {
  const { showToast } = useUI();
  const [stats, setStats] = useState(null);
  const [rows, setRows]   = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, l] = await Promise.all([
        call('adminGetTournamentStats'),
        call('adminListTournaments', { pageSize: 8 }),
      ]);
      setStats(s); setRows(l.rows || []);
    } catch (e) {
      showToast(e?.message || 'Failed to load tournaments', 'error');
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KpiCard icon="emoji_events" color="#7c3aed" label="Total Tournaments"
          value={loading ? '—' : fmtNumber(stats?.total)} />
        <KpiCard icon="event_upcoming" color="#3b82f6" label="Upcoming (Open)"
          value={loading ? '—' : fmtNumber(stats?.open)} />
        <KpiCard icon="live_tv" color="#f04060" label="Live Now"
          value={loading ? '—' : fmtNumber(stats?.live)} />
        <KpiCard icon="check_circle" color="#22c55e" label="Completed"
          value={loading ? '—' : fmtNumber(stats?.completed)} />
        <KpiCard icon="paid" color="#f0a500" label="Total Prize Pool"
          value={loading ? '—' : `${fmtNumber(stats?.totalPrizePool)}c`} />
        <KpiCard icon="gavel" color="#f04060" label="Disputed Matches"
          value={loading ? '—' : fmtNumber(stats?.disputedMatchCount)} />
      </div>

      <Card title="Recent & Upcoming Tournaments">
        <TournamentTable rows={rows} loading={loading} />
      </Card>
    </>
  );
}

// ───────────────────────────────────────────────────────────
// ALL
// ───────────────────────────────────────────────────────────

function AllTab() {
  const { showToast } = useUI();
  const [rows, setRows] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '', game: '' });

  const load = useCallback(async ({ reset = true } = {}) => {
    setLoading(true);
    try {
      const r = await call('adminListTournaments', {
        filters: { status: filters.status || undefined, game: filters.game || undefined },
        cursor: reset ? null : cursor,
        pageSize: 25,
      });
      setRows(reset ? r.rows : [...rows, ...r.rows]);
      setCursor(r.nextCursor);
      setHasMore(!!r.nextCursor);
    } catch (e) {
      showToast(e?.message || 'Failed to load', 'error');
    }
    setLoading(false);
  }, [filters, cursor, rows, showToast]);

  useEffect(() => { load({ reset: true }); /* eslint-disable-next-line */ }, [filters]);

  return (
    <>
      <div style={{
        display: 'flex', gap: 8, flexWrap: 'wrap',
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
        padding: 12, marginBottom: 12,
      }}>
        <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
          style={selectStyle()}>
          <option value="">All Statuses</option>
          <option value="open">Open</option>
          <option value="live">Live</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input value={filters.game} onChange={e => setFilters(f => ({ ...f, game: e.target.value }))}
          placeholder="Game name (exact)"
          style={{ ...selectStyle(), minWidth: 200 }} />
      </div>

      <Card>
        <TournamentTable rows={rows} loading={loading} full />
        {hasMore && (
          <div style={{ padding: 12, textAlign: 'center' }}>
            <button onClick={() => load({ reset: false })} disabled={loading} style={loadMoreBtn()}>
              {loading ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </Card>
    </>
  );
}

// ───────────────────────────────────────────────────────────
// DISPUTES
// ───────────────────────────────────────────────────────────

function DisputesTab({ guarded }) {
  const { showToast } = useUI();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState(null); // { row, winnerId }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call('adminListDisputedMatches', { limit: 100 });
      setRows(r.rows || []);
    } catch (e) {
      showToast(e?.message || 'Failed to load disputes', 'error');
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const resolve = async ({ reason }) => {
    if (!prompt) return;
    const { row, winnerId } = prompt;
    await guarded(async () => {
      await call('adminResolveTournamentDispute', {
        tournamentId: row.tournament?.id,
        matchId: row.id,
        winnerId,
        note: reason,
      });
      showToast('Dispute resolved', 'success');
      setPrompt(null);
      await load();
    });
  };

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KpiCard icon="gavel" color="#f04060" label="Open Disputes" value={fmtNumber(rows.length)} />
      </div>

      <Card title="Disputed Matches">
        {loading && rows.length === 0 && <Empty label="Loading…" />}
        {!loading && rows.length === 0 && <Empty label="No open disputes." />}
        {rows.map(r => (
          <div key={r.id} style={{
            display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 220px',
            padding: '14px 0', borderBottom: `1px dashed ${C.border}`,
            alignItems: 'center', gap: 12,
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                {r.tournament?.name || 'Unknown tournament'}
              </div>
              <div style={{ fontSize: 11, color: C.textMuted }}>
                {r.tournament?.game || '—'} · Round {r.round ?? '?'} · Match {r.matchNumber ?? '?'}
              </div>
            </div>
            <div style={{ fontSize: 11, color: C.textDim }}>
              <div>Player 1 reported: <span style={{ color: C.text }}>{(r.player1ReportedWinner || '—').slice(0, 8)}</span></div>
              <div>Player 2 reported: <span style={{ color: C.text }}>{(r.player2ReportedWinner || '—').slice(0, 8)}</span></div>
            </div>
            <div style={{ fontSize: 11, color: C.textDim }}>
              {r.disputedAt ? fmtRelative(r.disputedAt) : '—'}
            </div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button onClick={() => setPrompt({ row: r, winnerId: r.player1 })} style={btn('#22c55e')}>
                P1 wins
              </button>
              <button onClick={() => setPrompt({ row: r, winnerId: r.player2 })} style={btn('#22c55e')}>
                P2 wins
              </button>
            </div>
          </div>
        ))}
      </Card>

      {prompt && (
        <ReasonPrompt
          title="Resolve dispute"
          message={`Set winner to ${(prompt.winnerId || '').slice(0, 12)}? Bracket will advance immediately.`}
          danger={false}
          onConfirm={resolve}
          onCancel={() => setPrompt(null)}
        />
      )}
    </>
  );
}

// ───────────────────────────────────────────────────────────
// CANCEL & REFUND
// ───────────────────────────────────────────────────────────

function CancelTab({ guarded }) {
  const { showToast } = useUI();
  const [active, setActive] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, h] = await Promise.all([
        call('adminListTournaments', { filters: { status: 'open' }, pageSize: 50 }),
        call('adminListCancelledTournaments', { limit: 30 }),
      ]);
      setActive(a.rows || []); setHistory(h.rows || []);
    } catch (e) {
      showToast(e?.message || 'Failed to load', 'error');
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const cancel = async ({ reason }) => {
    if (!prompt) return;
    await guarded(async () => {
      const r = await call('adminCancelTournament', { tournamentId: prompt.id, reason });
      showToast(`Refunded ${r.refundedCoins}c to ${r.participantsRefunded} players`, 'success');
      setPrompt(null);
      await load();
    });
  };

  const totalRefunded = history.reduce((s, h) => s + (h.refundedCoins || 0), 0);

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KpiCard icon="event_busy" color="#f04060" label="Cancelled (recent)"
          value={fmtNumber(history.length)} />
        <KpiCard icon="payments" color="#f0a500" label="Refunded (coins)"
          value={fmtNumber(totalRefunded)} />
        <KpiCard icon="emoji_events" color="#7c3aed" label="Open (cancellable)"
          value={fmtNumber(active.length)} />
      </div>

      <Card title="Open tournaments — eligible for cancel">
        {loading && active.length === 0 && <Empty label="Loading…" />}
        {!loading && active.length === 0 && <Empty label="No open tournaments." />}
        {active.map(t => (
          <div key={t.id} style={{
            display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 110px',
            padding: '12px 0', borderBottom: `1px dashed ${C.border}`,
            fontSize: 12, alignItems: 'center', gap: 12,
          }}>
            <div>
              <div style={{ fontWeight: 600, color: C.text }}>{t.name}</div>
              <div style={{ fontSize: 11, color: C.textMuted }}>{t.game} · {t.type}</div>
            </div>
            <div className="font-dmmono tabular-nums" style={{ color: C.textDim }}>
              {fmtNumber(t.participantCount)} / {fmtNumber(t.maxParticipants)}
            </div>
            <div className="font-dmmono tabular-nums">{fmtNumber(t.entryFee)}c entry</div>
            <div className="font-dmmono tabular-nums" style={{ color: '#f0a500' }}>
              {fmtNumber(t.prizePool)}c pool
            </div>
            <button onClick={() => setPrompt(t)} style={btn('#f04060')}>
              Cancel
            </button>
          </div>
        ))}
      </Card>

      <div style={{ height: 14 }} />

      <Card title="Recent cancellations">
        {history.length === 0 && <Empty label="No cancellations on record." />}
        {history.map(h => (
          <div key={h.id} style={{
            display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1.5fr',
            padding: '10px 0', borderBottom: `1px dashed ${C.border}`,
            fontSize: 12, alignItems: 'center',
          }}>
            <div>
              <div style={{ fontWeight: 600, color: C.text }}>{h.name}</div>
              <div style={{ fontSize: 11, color: C.textMuted }}>{h.game}</div>
            </div>
            <div className="font-dmmono tabular-nums" style={{ color: '#22c55e' }}>
              {fmtNumber(h.refundedCoins)}c refunded
            </div>
            <div style={{ color: C.textDim }}>{h.cancelledAt ? fmtRelative(h.cancelledAt) : '—'}</div>
            <div style={{ color: C.textDim, fontStyle: 'italic', fontSize: 11 }}>
              {h.cancelReason ? `"${h.cancelReason}"` : '—'}
            </div>
          </div>
        ))}
      </Card>

      {prompt && (
        <ReasonPrompt
          title={`Cancel ${prompt.name}?`}
          message={`This will refund ${fmtNumber(prompt.entryFee || 0)}c × ${fmtNumber(prompt.participantCount)} participants (${fmtNumber((prompt.entryFee || 0) * (prompt.participantCount || 0))}c total). Action is final.`}
          placeholder="Reason (required — sent to participants)"
          onConfirm={cancel}
          onCancel={() => setPrompt(null)}
        />
      )}
    </>
  );
}

// ───────────────────────────────────────────────────────────
// Shared bits
// ───────────────────────────────────────────────────────────

function TournamentTable({ rows, loading, full }) {
  if (loading && rows.length === 0) return <Empty label="Loading…" />;
  if (!loading && rows.length === 0) return <Empty label="No tournaments found." />;
  return (
    <>
      <div style={{
        display: 'grid', gridTemplateColumns: full ? '2fr 1fr 100px 1fr 1fr 100px' : '2fr 1fr 100px 1fr 100px',
        padding: '10px 0', borderBottom: `1px solid ${C.border}`,
        fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase',
      }}>
        <div>Tournament</div>
        <div>Game</div>
        <div>Status</div>
        <div>Prize Pool</div>
        {full && <div>Participants</div>}
        <div style={{ textAlign: 'right' }}>Starts</div>
      </div>
      {rows.map(t => (
        <div key={t.id} style={{
          display: 'grid', gridTemplateColumns: full ? '2fr 1fr 100px 1fr 1fr 100px' : '2fr 1fr 100px 1fr 100px',
          padding: '12px 0', borderBottom: `1px dashed ${C.border}`,
          fontSize: 12, color: C.text, alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            {t.bannerUrl ? (
              <img src={t.bannerUrl} alt="" style={{
                width: 32, height: 32, borderRadius: 6, objectFit: 'cover', flexShrink: 0,
              }} />
            ) : (
              <div style={{
                width: 32, height: 32, borderRadius: 6, flexShrink: 0,
                background: `linear-gradient(135deg, ${C.accent2}, ${C.accent})`,
              }} />
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {t.name}
              </div>
              <div style={{ fontSize: 10, color: C.textMuted }}>
                {t.type} · {t.visibility}
              </div>
            </div>
          </div>
          <div style={{ color: C.textDim }}>{t.game || '—'}</div>
          <StatusPill status={t.status} />
          <div className="font-dmmono tabular-nums" style={{ color: '#f0a500' }}>
            {fmtNumber(t.prizePool)}c
          </div>
          {full && (
            <div className="font-dmmono tabular-nums" style={{ color: C.textDim }}>
              {fmtNumber(t.participantCount)} / {fmtNumber(t.maxParticipants)}
            </div>
          )}
          <div style={{ fontSize: 11, color: C.textDim, textAlign: 'right' }}>
            {t.startDate ? fmtDate(t.startDate) : '—'}
          </div>
        </div>
      ))}
    </>
  );
}

function StatusPill({ status }) {
  const map = {
    open:      { bg: '#3b82f620', fg: '#3b82f6' },
    live:      { bg: '#f0406020', fg: '#f04060' },
    completed: { bg: '#22c55e20', fg: '#22c55e' },
    cancelled: { bg: '#5a5a8520', fg: C.textDim },
  };
  const m = map[status] || map.open;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
      background: m.bg, color: m.fg, textTransform: 'uppercase',
      display: 'inline-block', width: 'max-content',
    }}>{status}</span>
  );
}

// ───────────────────────────────────────────────────────────
// EVIDENCE STORAGE — early-purge proof/VOD/highlights to reclaim R2 space.
// ───────────────────────────────────────────────────────────

function EvidenceTab({ guarded }) {
  const { showToast } = useUI();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call('adminListMatchesWithEvidence', { limit: 100 });
      setRows(r.rows || []);
    } catch (e) {
      showToast(e?.message || 'Failed to load', 'error');
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const purge = async (row) => {
    // Surface server-side blocker checks client-side for the confirm dialog.
    const blockers = [];
    if (row.commanderReviewRequired) blockers.push('Pending Commander review');
    if (row.cheatFlagPass === 'pending') blockers.push('AI cheat-flag pass running');
    if (row.cheatFlagState === 'unresolved') blockers.push('Cheat flag unresolved');
    if (blockers.length) {
      showToast('Blocked: ' + blockers.join(', '), 'error');
      return;
    }
    const ok = window.confirm(
      `Purge evidence for ${row.tournamentName || 'this tournament'} · R${row.round}/M${row.matchNumber}?\n\n` +
      `Frees ~${fmtBytes(row.approxBytes)} from R2. Irreversible.`
    );
    if (!ok) return;
    setBusyId(row.matchId);
    try {
      await guarded(async () => {
        await call('adminPurgeMatchEvidence', {
          tournamentId: row.tournamentId, matchId: row.matchId,
        });
      });
      showToast('Purged', 'success');
      setRows((rs) => rs.filter((r) => r.matchId !== row.matchId));
    } catch (e) {
      showToast(e?.message || 'Purge failed', 'error');
    }
    setBusyId(null);
  };

  const totalBytes = rows.reduce((a, r) => a + (r.approxBytes || 0), 0);

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KpiCard icon="inventory_2" color={C.accent} label="Settled matches with evidence" value={fmtNumber(rows.length)} />
        <KpiCard icon="storage" color="#f0a500" label="Approx. reclaimable R2" value={fmtBytes(totalBytes)} />
      </div>

      <Card title={`Eligible matches (${rows.length})`}>
        {loading && rows.length === 0 && <Empty label="Loading…" />}
        {!loading && rows.length === 0 && <Empty label="No matches with retained evidence. Crons keep things tidy automatically." />}
        {rows.map((r) => {
          const eligible = !r.commanderReviewRequired
                       && r.cheatFlagPass !== 'pending'
                       && r.cheatFlagState !== 'unresolved';
          return (
            <div key={r.matchId} style={{
              display: 'grid', gridTemplateColumns: '2fr 1.4fr 1fr 160px',
              padding: '14px 0', borderBottom: `1px dashed ${C.border}`,
              alignItems: 'center', gap: 12,
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                  {r.tournamentName || 'Untitled'}
                </div>
                <div style={{ fontSize: 11, color: C.textMuted }}>
                  Round {r.round ?? '?'} · Match {r.matchNumber ?? '?'} · Entry {fmtNumber(r.entryFee)}c
                </div>
              </div>
              <div style={{ fontSize: 11, color: C.textDim, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {r.hasProof && <Pill color="#f0a500">Proof</Pill>}
                {r.hasVod   && <Pill color="#B44FFF">VOD</Pill>}
                {r.hasHl    && <Pill color="#7B6FFF">Highlights</Pill>}
                {r.commanderReviewRequired && <Pill color="#f04060">Commander review</Pill>}
                {r.cheatFlagPass === 'pending' && <Pill color="#f04060">AI pass pending</Pill>}
                {r.cheatFlagState === 'unresolved' && <Pill color="#f04060">Cheat flag unresolved</Pill>}
                {r.cheatFlagState === 'confirmed' && <Pill color="#22c55e">Cheat confirmed</Pill>}
                {r.cheatFlagState === 'cleared'   && <Pill color="#22c55e">Cheat cleared</Pill>}
              </div>
              <div style={{ fontSize: 11, color: C.textDim }}>
                {r.completedAt ? fmtRelative(r.completedAt) : '—'}<br />
                ~{fmtBytes(r.approxBytes)}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => purge(r)}
                  disabled={!eligible || busyId === r.matchId}
                  style={{
                    ...btn('#f04060'),
                    opacity: eligible ? 1 : 0.4,
                    cursor: eligible && busyId !== r.matchId ? 'pointer' : 'not-allowed',
                  }}
                  title={!eligible ? 'Resolve preconditions first' : 'Delete from R2 now'}
                >
                  {busyId === r.matchId ? 'Purging…' : 'Purge'}
                </button>
              </div>
            </div>
          );
        })}
      </Card>

      <div style={{ marginTop: 14, fontSize: 11, color: C.textMuted, lineHeight: 1.6 }}>
        Automatic cleanup runs daily — proof chunks delete after 30 days, tournament VODs after 7. Use this tab to reclaim space sooner once a match is settled.
      </div>
    </>
  );
}

function Pill({ color, children }) {
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 800,
      background: color + '22', color, border: '1px solid ' + color + '55',
      letterSpacing: '0.04em',
    }}>{children}</span>
  );
}

function fmtBytes(b) {
  if (!b) return '0 B';
  const k = 1024;
  if (b < k) return `${b} B`;
  if (b < k * k) return `${(b / k).toFixed(0)} KB`;
  if (b < k * k * k) return `${(b / k / k).toFixed(1)} MB`;
  return `${(b / k / k / k).toFixed(2)} GB`;
}

function Card({ title, children }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16,
    }}>
      {title && (
        <h3 style={{ margin: 0, marginBottom: 12, fontSize: 13, fontWeight: 700, color: C.text }}>
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}

function Empty({ label }) {
  return (
    <div style={{ padding: 24, textAlign: 'center', color: C.textDim, fontSize: 12 }}>{label}</div>
  );
}

function selectStyle() {
  return {
    padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.border}`,
    background: '#0a0a14', color: C.text, fontSize: 12,
  };
}

function loadMoreBtn() {
  return {
    padding: '8px 18px', borderRadius: 8, background: C.accent, color: '#fff',
    border: 0, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  };
}

function btn(color) {
  return {
    padding: '6px 12px', borderRadius: 6, border: `1px solid ${color}50`,
    background: `${color}20`, color, fontSize: 11, fontWeight: 600, cursor: 'pointer',
  };
}

function inputStyle() {
  return {
    width: '100%', padding: '10px 12px', background: '#0a0a14',
    border: `1px solid ${C.border}`, borderRadius: 8,
    color: C.text, fontSize: 12,
  };
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.textDim, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// VERGR GRAND TOURNAMENTS
// ───────────────────────────────────────────────────────────

function VgtTab({ guarded }) {
  const { showToast } = useUI();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creator, setCreator] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call('adminListVgtTournaments', { limit: 50 });
      setRows(r.rows || []);
    } catch (e) { showToast(e?.message || 'Failed to load VGT list', 'error'); }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const create = async (form) => {
    try {
      await guarded(() => call('adminCreateVgtTournament', form));
      showToast('Vergr Grand Tournament created', 'success');
      setCreator(false); load();
    } catch { /* toast shown */ }
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: C.textDim }}>
          Platform-hosted high-stakes tournaments with sponsor info + prize-pool guarantee.
        </div>
        <button onClick={() => setCreator(true)} style={{
          padding: '8px 14px', borderRadius: 8, background: C.accent, color: '#fff',
          border: 0, fontSize: 12, fontWeight: 600, cursor: 'pointer',
        }}>+ Create VGT</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        {loading && rows.length === 0 && <Empty label="Loading…" />}
        {!loading && rows.length === 0 && <Empty label="No VGT tournaments yet." />}
        {rows.map(t => (
          <div key={t.id} style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden',
          }}>
            <div style={{
              height: 90, background: t.bannerUrl
                ? `url(${t.bannerUrl}) center/cover`
                : `linear-gradient(135deg, #7c3aed, #f0a500)`,
            }} />
            <div style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '3px 6px', borderRadius: 4,
                  background: '#f0a50020', color: '#f0a500', textTransform: 'uppercase',
                }}>VGT</span>
                <StatusPill status={t.status} />
              </div>
              <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>{t.name}</h4>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{t.game}</div>
              <div style={{ display: 'flex', gap: 12, marginTop: 10, fontSize: 11, color: C.textDim }}>
                <div className="font-dmmono tabular-nums">
                  <span style={{ color: '#f0a500' }}>{fmtNumber(t.prizePool)}c</span> pool
                  {t.prizePoolGuarantee > 0 && (
                    <span style={{ color: C.textMuted, fontSize: 10 }}> · {fmtNumber(t.prizePoolGuarantee)}c guaranteed</span>
                  )}
                </div>
                <div className="font-dmmono tabular-nums">
                  {fmtNumber(t.participantCount)} / {fmtNumber(t.maxParticipants)}
                </div>
              </div>
              {t.sponsorName && (
                <div style={{ marginTop: 10, padding: 8, background: '#0a0a14', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {t.sponsorLogoUrl && <img src={t.sponsorLogoUrl} alt="" style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'cover' }} />}
                  <div style={{ fontSize: 11 }}>
                    <div style={{ color: C.textMuted, fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}>Sponsor</div>
                    <div style={{ color: C.text }}>{t.sponsorName}</div>
                  </div>
                </div>
              )}
              <div style={{ fontSize: 11, color: C.textDim, marginTop: 10 }}>
                Starts {t.scheduledStart ? fmtDate(t.scheduledStart) : '—'}
              </div>
            </div>
          </div>
        ))}
      </div>

      {creator && <VgtCreator onSave={create} onCancel={() => setCreator(false)} />}
    </>
  );
}

function VgtCreator({ onSave, onCancel }) {
  const [form, setForm] = useState({
    name: '', game: 'Counter-Strike 2', type: 'single_elim',
    maxParticipants: 32, entryFee: 0, prizePoolGuarantee: 5000,
    scheduledStart: '', bannerUrl: '',
    sponsorName: '', sponsorUrl: '', sponsorLogoUrl: '',
    note: '', description: '',
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const valid = form.name.trim().length >= 3 && form.game;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 250, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22, width: 560, maxWidth: '95vw', maxHeight: '92vh', overflow: 'auto' }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>Create Vergr Grand Tournament</h3>
        <p style={{ margin: '6px 0 14px', fontSize: 12, color: C.textDim }}>
          Platform-hosted high-stakes event. Prize pool is pre-seeded with the guaranteed amount.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="Tournament name"><input value={form.name} onChange={e => set('name', e.target.value)} style={inputStyle()} placeholder="VERGR Grand Championship — Season 1" /></Field>
          </div>
          <Field label="Game"><input value={form.game} onChange={e => set('game', e.target.value)} style={inputStyle()} /></Field>
          <Field label="Bracket type">
            <select value={form.type} onChange={e => set('type', e.target.value)} style={inputStyle()}>
              <option value="single_elim">Single elimination</option>
              <option value="double_elim">Double elimination</option>
              <option value="round_robin">Round robin</option>
              <option value="swiss">Swiss</option>
              <option value="battle_royale">Battle royale</option>
            </select>
          </Field>
          <Field label="Max participants (≤256)"><input type="number" value={form.maxParticipants} onChange={e => set('maxParticipants', e.target.value)} style={inputStyle()} /></Field>
          <Field label="Entry fee (coins, ≤10,000)"><input type="number" value={form.entryFee} onChange={e => set('entryFee', e.target.value)} style={inputStyle()} /></Field>
          <Field label="Prize pool guarantee (coins, ≤500,000)"><input type="number" value={form.prizePoolGuarantee} onChange={e => set('prizePoolGuarantee', e.target.value)} style={inputStyle()} /></Field>
          <Field label="Scheduled start"><input type="datetime-local" value={form.scheduledStart} onChange={e => set('scheduledStart', e.target.value)} style={inputStyle()} /></Field>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="Banner URL (R2 path)"><input value={form.bannerUrl} onChange={e => set('bannerUrl', e.target.value)} style={inputStyle()} placeholder="https://cdn.vergr.app/..." /></Field>
          </div>
          <Field label="Sponsor name (optional)"><input value={form.sponsorName} onChange={e => set('sponsorName', e.target.value)} style={inputStyle()} /></Field>
          <Field label="Sponsor URL"><input value={form.sponsorUrl} onChange={e => set('sponsorUrl', e.target.value)} style={inputStyle()} placeholder="https://" /></Field>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="Sponsor logo URL"><input value={form.sponsorLogoUrl} onChange={e => set('sponsorLogoUrl', e.target.value)} style={inputStyle()} /></Field>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="Description / rules">
              <textarea rows={4} value={form.description} onChange={e => set('description', e.target.value)} style={{ ...inputStyle(), resize: 'vertical', fontFamily: 'inherit' }} />
            </Field>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="Admin note (internal)">
              <input value={form.note} onChange={e => set('note', e.target.value)} style={inputStyle()} placeholder="Visible only on the VGT card here" />
            </Field>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: '10px', borderRadius: 8, background: 'transparent', border: `1px solid ${C.border}`, color: C.textDim, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => onSave({
            ...form,
            maxParticipants: Number(form.maxParticipants),
            entryFee: Number(form.entryFee),
            prizePoolGuarantee: Number(form.prizePoolGuarantee),
          })} disabled={!valid}
            style={{ flex: 1, padding: '10px', borderRadius: 8, background: C.accent, color: '#fff', border: 0, fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: !valid ? 0.5 : 1 }}>
            Create VGT
          </button>
        </div>
        <p style={{ margin: '10px 0 0', fontSize: 10, color: C.textMuted }}>Step-up TOTP required. Action is audited.</p>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// ANNOUNCEMENTS
// ───────────────────────────────────────────────────────────

function AnnouncementsTab({ guarded }) {
  const { showToast } = useUI();
  const [tournaments, setTournaments] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    tournamentId: '', audience: 'participants', title: '', body: '', bannerUrl: '',
  });
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, a] = await Promise.all([
        call('adminListTournaments', { filters: { status: 'open' }, pageSize: 50 }),
        call('adminListTournamentAnnouncements', { limit: 50 }),
      ]);
      setTournaments(t.rows || []);
      setRows(a.rows || []);
    } catch (e) { showToast(e?.message || 'Failed to load', 'error'); }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    if (!form.tournamentId || !form.title.trim() || !form.body.trim()) {
      showToast('Pick a tournament + fill title and body', 'error'); return;
    }
    setSending(true);
    try {
      const r = await guarded(() => call('adminSendTournamentAnnouncement', form));
      showToast(`Sent to ${r.recipientCount} recipient${r.recipientCount === 1 ? '' : 's'}`, 'success');
      setForm({ tournamentId: '', audience: 'participants', title: '', body: '', bannerUrl: '' });
      load();
    } catch { /* toast */ }
    setSending(false);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <Card title="Compose announcement">
        <div style={{ display: 'grid', gap: 10 }}>
          <Field label="Tournament">
            <select value={form.tournamentId} onChange={e => setForm(f => ({ ...f, tournamentId: e.target.value }))} style={inputStyle()}>
              <option value="">Select a tournament…</option>
              {tournaments.map(t => (
                <option key={t.id} value={t.id}>{t.name} · {t.game}</option>
              ))}
            </select>
          </Field>
          <Field label="Audience">
            <select value={form.audience} onChange={e => setForm(f => ({ ...f, audience: e.target.value }))} style={inputStyle()}>
              <option value="participants">Participants only</option>
              <option value="hosts">Hosts only</option>
              <option value="spectators">Spectators (participants + host)</option>
              <option value="all">Everyone (participants + host)</option>
            </select>
          </Field>
          <Field label="Title (≤160 chars)">
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} style={inputStyle()} placeholder="Match schedule update" />
          </Field>
          <Field label="Body (≤1500 chars)">
            <textarea rows={5} value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              style={{ ...inputStyle(), resize: 'vertical', fontFamily: 'inherit' }} placeholder="Round 2 will start at 19:00 UTC…" />
          </Field>
          <Field label="Banner URL (optional)">
            <input value={form.bannerUrl} onChange={e => setForm(f => ({ ...f, bannerUrl: e.target.value }))} style={inputStyle()} />
          </Field>
          <button onClick={send} disabled={sending} style={{
            padding: '12px', borderRadius: 8, background: C.accent, color: '#fff',
            border: 0, fontSize: 13, fontWeight: 700, cursor: 'pointer',
            opacity: sending ? 0.6 : 1,
          }}>
            {sending ? 'Sending…' : 'Send announcement'}
          </button>
          <p style={{ margin: 0, fontSize: 10, color: C.textMuted }}>Step-up TOTP required. Action is audited.</p>
        </div>
      </Card>

      <Card title="Recent announcements">
        {loading && rows.length === 0 && <Empty label="Loading…" />}
        {!loading && rows.length === 0 && <Empty label="No announcements sent yet." />}
        {rows.map(a => (
          <div key={a.id} style={{ padding: '12px 0', borderBottom: `1px dashed ${C.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3, background: '#7c3aed20', color: '#b44fff', textTransform: 'uppercase' }}>{a.audience}</span>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.text, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title}</div>
              <div style={{ fontSize: 11, color: C.textDim }}>{fmtRelative(a.sentAt)}</div>
            </div>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>
              {a.tournamentName || a.tournamentId} · {fmtNumber(a.recipientCount)} recipients
            </div>
            <div style={{ fontSize: 12, color: C.text, opacity: 0.85 }}>{a.body}</div>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// PARTICIPANT OVERRIDES
// ───────────────────────────────────────────────────────────

function OverridesTab({ guarded }) {
  const { showToast } = useUI();
  const [tournaments, setTournaments] = useState([]);
  const [selected, setSelected] = useState(null); // tournament obj
  const [actionPrompt, setActionPrompt] = useState(null); // { kind, userId? }

  useEffect(() => {
    (async () => {
      try {
        const r = await call('adminListTournaments', { pageSize: 100 });
        setTournaments(r.rows || []);
      } catch (e) { showToast(e?.message || 'Failed to load', 'error'); }
    })();
  }, [showToast]);

  const reseed = async ({ reason }) => {
    if (!selected) return;
    try {
      const r = await guarded(() => call('adminReseedBracket', { tournamentId: selected.id, reason }));
      showToast(`Bracket reseeded · ${r.wipedMatches} matches wiped`, 'success');
      setActionPrompt(null);
    } catch { /* toast */ }
  };
  const addParticipant = async ({ reason, extra }) => {
    if (!selected || !extra) return;
    try {
      await guarded(() => call('adminAddParticipant', { tournamentId: selected.id, userId: extra, reason }));
      showToast('User added', 'success');
      setActionPrompt(null);
    } catch { /* toast */ }
  };
  const removeParticipant = async ({ reason, extra }) => {
    if (!selected || !actionPrompt.userId) return;
    try {
      const r = await guarded(() => call('adminRemoveParticipant', { tournamentId: selected.id, userId: actionPrompt.userId, reason, refund: true }));
      showToast(r.refundedCoins > 0 ? `Removed · ${r.refundedCoins}c refunded` : 'Removed', 'success');
      setActionPrompt(null);
    } catch { /* toast */ }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
      <Card title="Pick a tournament">
        {tournaments.length === 0 && <Empty label="No tournaments." />}
        <div style={{ maxHeight: 500, overflow: 'auto' }}>
          {tournaments.map(t => (
            <button key={t.id} onClick={() => setSelected(t)} style={{
              width: '100%', textAlign: 'left', padding: '10px 12px',
              background: selected?.id === t.id ? '#7c3aed20' : 'transparent',
              border: 0, borderBottom: `1px dashed ${C.border}`,
              color: C.text, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{t.name}</div>
              <div style={{ fontSize: 10, color: C.textMuted }}>
                {t.game} · {t.status} · {t.participantCount}/{t.maxParticipants}
              </div>
            </button>
          ))}
        </div>
      </Card>

      <Card title={selected ? `Manage: ${selected.name}` : 'Select a tournament'}>
        {!selected && <Empty label="Pick a tournament from the left to manage participants." />}
        {selected && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <button onClick={() => setActionPrompt({ kind: 'add' })}
                style={btn('#22c55e')}>+ Force-add user</button>
              <button onClick={() => setActionPrompt({ kind: 'reseed' })}
                style={btn('#f0a500')}>↻ Reseed bracket</button>
            </div>

            <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 600, color: C.text }}>
              Current participants ({selected.participantCount})
            </div>
            <ParticipantList
              tournamentId={selected.id}
              onRemove={(userId) => setActionPrompt({ kind: 'remove', userId })}
            />

            <div style={{ marginTop: 14, padding: 10, background: '#0a0a14', borderRadius: 8, fontSize: 11, color: C.textDim }}>
              <strong style={{ color: C.text }}>Reseed safety:</strong> only safe before round 1 plays.
              The callable will refuse if status is <code>completed</code> or <code>cancelled</code>,
              but does NOT verify that match results haven't already been recorded — be careful.
            </div>
          </>
        )}
      </Card>

      {actionPrompt?.kind === 'add' && (
        <ReasonPrompt
          title="Force-add user"
          message="The user will be added to the participants list with NO entry-fee debit. Useful for invited pros / make-goods. Tournament must be in 'open' status."
          extraField={{ label: 'User UID', placeholder: 'user id', required: true }}
          onCancel={() => setActionPrompt(null)}
          onConfirm={addParticipant}
        />
      )}
      {actionPrompt?.kind === 'remove' && (
        <ReasonPrompt
          title="Remove participant"
          message={`Remove user ${(actionPrompt.userId || '').slice(0, 12)}? If status is 'open', their entry fee is refunded automatically.`}
          onCancel={() => setActionPrompt(null)}
          onConfirm={removeParticipant}
        />
      )}
      {actionPrompt?.kind === 'reseed' && (
        <ReasonPrompt
          title="Reseed bracket"
          message="This wipes the existing bracket and any match docs (up to 256). Status is reset to 'open'. Only safe BEFORE round 1 — match results already played will be lost."
          onCancel={() => setActionPrompt(null)}
          onConfirm={reseed}
        />
      )}
    </div>
  );
}

function ParticipantList({ tournamentId, onRemove }) {
  // Load the tournament fresh so we have current participants.
  const [participants, setParticipants] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // Reuse adminListTournaments with a filter so we don't need a separate
        // get-by-id callable. Cap at 100 to be sure.
        const r = await call('adminListTournaments', { pageSize: 100 });
        const t = (r.rows || []).find(x => x.id === tournamentId);
        // adminListTournaments only returns participantCount, not the array.
        // Fall back to empty list and tell the admin to refresh after change.
        // (A get-by-id callable could be added later.)
        if (!t) setParticipants([]);
        else setParticipants(t.participantUids || []); // Will be empty until backend adds field
      } catch { setParticipants([]); }
      setLoading(false);
    })();
  }, [tournamentId]);

  if (loading) return <Empty label="Loading…" />;
  if (participants.length === 0) {
    return (
      <div style={{ padding: 14, background: '#0a0a14', borderRadius: 8, fontSize: 11, color: C.textDim }}>
        Participant list not exposed by <code>adminListTournaments</code> yet.
        Use the <strong>Force-remove</strong> action by typing the UID directly via
        the user-management screen if needed. Removal still works via the callable.
      </div>
    );
  }
  return (
    <div>
      {participants.map(uid => (
        <div key={uid} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px dashed ${C.border}`, fontSize: 12 }}>
          <span style={{ fontFamily: 'ui-monospace, monospace', color: C.text }}>{uid.slice(0, 14)}…</span>
          <button onClick={() => onRemove(uid)} style={btn('#f04060')}>Remove</button>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// SETTINGS
// ───────────────────────────────────────────────────────────

function SettingsTab({ guarded }) {
  const { showToast } = useUI();
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await call('adminGetTournamentSettings');
      setSettings(r.settings); setDraft({});
    } catch (e) { showToast(e?.message || 'Failed to load', 'error'); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const get = (k) => draft[k] !== undefined ? draft[k] : settings?.[k];
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const dirty = Object.keys(draft).length > 0;

  const save = async () => {
    setSaving(true);
    try {
      await guarded(() => call('adminSetTournamentSettings', { settings: draft }));
      showToast('Settings saved', 'success');
      load();
    } catch { /* toast */ }
    setSaving(false);
  };

  if (!settings) return <Empty label="Loading…" />;

  return (
    <Card title="Tournament system settings">
      <p style={{ margin: '0 0 16px', fontSize: 12, color: C.textDim }}>
        Editable defaults are saved on <code>app_config/general.tournaments</code>.
        Riot-disclosed caps below are display-only — changing them in code is a compliance breach until Riot is renotified.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <Field label="Match-confirm timeout (hours, 1–168)">
          <input type="number" value={get('matchConfirmTimeoutHours') ?? 24}
            onChange={e => set('matchConfirmTimeoutHours', Math.max(1, Math.min(168, parseInt(e.target.value) || 24)))}
            style={inputStyle()} />
        </Field>
        <Field label="Check-in window (hours, 0–24)">
          <input type="number" value={get('checkInWindowHours') ?? 1}
            onChange={e => set('checkInWindowHours', Math.max(0, Math.min(24, parseInt(e.target.value) || 0)))}
            style={inputStyle()} />
        </Field>
        <Field label="Auto-finalize cron interval (min, 1–60)">
          <input type="number" value={get('autoFinalizeIntervalMin') ?? 5}
            onChange={e => set('autoFinalizeIntervalMin', Math.max(1, Math.min(60, parseInt(e.target.value) || 5)))}
            style={inputStyle()} />
        </Field>
        <Field label="Default entry fee (coins, ≤10,000)">
          <input type="number" value={get('defaultEntryFee') ?? 100}
            onChange={e => set('defaultEntryFee', Math.max(0, Math.min(10_000, parseInt(e.target.value) || 0)))}
            style={inputStyle()} />
        </Field>
        <Field label="Default max participants (2–256)">
          <input type="number" value={get('defaultMaxParticipants') ?? 8}
            onChange={e => set('defaultMaxParticipants', Math.max(2, Math.min(256, parseInt(e.target.value) || 8)))}
            style={inputStyle()} />
        </Field>
      </div>

      <div style={{ marginTop: 18, padding: 14, background: '#0a0a14', borderRadius: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#f0a500', textTransform: 'uppercase', marginBottom: 8 }}>Riot-disclosed caps (READ-ONLY)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, fontSize: 12, color: C.text }}>
          <div>
            <div style={{ fontSize: 10, color: C.textDim }}>Max entry fee</div>
            <div className="font-dmmono tabular-nums" style={{ fontSize: 18, fontWeight: 700 }}>{fmtNumber(settings.riotMaxEntryFee)}c</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: C.textDim }}>Max prize pool</div>
            <div className="font-dmmono tabular-nums" style={{ fontSize: 18, fontWeight: 700 }}>{fmtNumber(settings.riotMaxPrizePool)}c</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: C.textDim }}>Mod cut</div>
            <div className="font-dmmono tabular-nums" style={{ fontSize: 18, fontWeight: 700 }}>{(settings.modCutPct * 100).toFixed(1)}%</div>
          </div>
        </div>
        <p style={{ margin: '10px 0 0', fontSize: 10, color: C.textMuted }}>
          Source of truth: <code>src/utils/tournamentTypes.js</code>. Raising any of these requires re-notifying Riot Games' Production API review.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        <button onClick={() => setDraft({})} disabled={!dirty}
          style={{ padding: '10px 16px', borderRadius: 8, background: 'transparent', border: `1px solid ${C.border}`, color: C.textDim, fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: dirty ? 1 : 0.5 }}>Reset</button>
        <button onClick={save} disabled={!dirty || saving}
          style={{ padding: '10px 18px', borderRadius: 8, background: C.accent, color: '#fff', border: 0, fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: !dirty ? 0.5 : 1 }}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {dirty && <span style={{ alignSelf: 'center', fontSize: 11, color: '#f0a500', fontWeight: 600 }}>{Object.keys(draft).length} unsaved change{Object.keys(draft).length === 1 ? '' : 's'}</span>}
      </div>
    </Card>
  );
}

// ───────────────────────────────────────────────────────────
// LOGS
// ───────────────────────────────────────────────────────────

function LogsTab() {
  const { showToast } = useUI();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call('adminListTournamentLogs', { limit: 100 });
      setRows(r.rows || []);
    } catch (e) { showToast(e?.message || 'Failed to load logs', 'error'); }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  return (
    <Card title="Tournament admin actions (latest 100)">
      <div style={{ display: 'grid', gridTemplateColumns: '140px 220px 1fr 140px', padding: '10px 0', borderBottom: `1px solid ${C.border}`, fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>
        <div>When</div>
        <div>Action</div>
        <div>Detail</div>
        <div>Target</div>
      </div>
      {loading && rows.length === 0 && <Empty label="Loading…" />}
      {!loading && rows.length === 0 && <Empty label="No tournament admin actions logged yet." />}
      {rows.map(r => (
        <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '140px 220px 1fr 140px', padding: '10px 0', borderBottom: `1px dashed ${C.border}`, fontSize: 12, color: C.text, alignItems: 'center' }}>
          <div style={{ fontSize: 11, color: C.textDim }}>{fmtRelative(r.createdAt)}</div>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{r.action}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {r.actor && (
              <>
                {r.actor.avatar && <img src={r.actor.avatar} alt="" style={{ width: 18, height: 18, borderRadius: '50%' }} />}
                <span style={{ fontSize: 11, color: C.textDim }}>{r.actor.displayName || r.actor.username || ''}</span>
              </>
            )}
            {r.reason && <span style={{ fontSize: 11, color: C.textMuted, fontStyle: 'italic', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>— {r.reason}</span>}
          </div>
          <div style={{ fontSize: 10, color: C.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {r.target ? `${r.target.type}/${(r.target.id || '').slice(0, 14)}` : '—'}
          </div>
        </div>
      ))}
    </Card>
  );
}
