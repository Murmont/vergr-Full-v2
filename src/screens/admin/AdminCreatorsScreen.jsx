// src/screens/admin/AdminCreatorsScreen.jsx
//
// Creator application review. Manual review is a founder decision, so this is
// the surface that makes it possible rather than theoretical.
//
// The reviewer sees the SNAPSHOT stored at application time, not a live
// recompute, so a decision can be audited later against what was actually true
// when the person applied.

import { useEffect, useState, useCallback } from 'react';
import AdminShell from './AdminShell';
import Icon from '../../components/Icon';
import { callCreator } from '../creator/BecomeCreatorScreen';
import '../../styles/surface.css';

const TABS = [
  { key: 'pending',  label: 'Pending' },
  { key: 'active',   label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

// Hard reasons block reapplication entirely; everything else starts the 30-day
// cooldown. Keep this list in sync with HARD_REJECT_REASONS in creatorProgram.js.
const REASONS = [
  { code: 'not_ready',     label: 'Not ready yet',        hard: false },
  { code: 'low_quality',   label: 'Content quality',      hard: false },
  { code: 'incomplete',    label: 'Incomplete profile',   hard: false },
  { code: 'fraud',         label: 'Fraud / farming',      hard: true },
  { code: 'strikes',       label: 'Policy strikes',       hard: true },
  { code: 'impersonation', label: 'Impersonation',        hard: true },
  { code: 'underage',      label: 'Underage',             hard: true },
];

const fmt = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export default function AdminCreatorsScreen() {
  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState([]);
  const [sel, setSel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('not_ready');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async (status) => {
    setLoading(true); setError('');
    try {
      const d = await callCreator('adminListCreatorApplications', { status });
      setRows(d.applications || []);
      setSel(null);
    } catch (e) { setError(e.message || 'Could not load applications.'); }
    setLoading(false);
  }, []);

  useEffect(() => { load(tab); }, [tab, load]);

  const decide = async (decision) => {
    if (!sel) return;
    setBusy(true); setError('');
    try {
      const res = await callCreator('adminDecideCreatorApplication', {
        targetUid: sel.uid, decision, reasonCode: reason, notes,
      });
      if (decision === 'approve' && res?.converted) {
        // Worth surfacing: approving moves real money.
        setError(`Approved. ${res.converted.coins} pending coins credited as ${res.converted.gems} gems.`);
      }
      setNotes('');
      await load(tab);
    } catch (e) { setError(e.message || 'Could not save the decision.'); }
    setBusy(false);
  };

  const snap = sel?.snapshot || {};

  return (
    <AdminShell screen="creators" title="Creators" subtitle="Applications and status">
      <div className="flex gap-2 mb-4">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="rounded-lg px-3.5 py-2 text-sm font-bold transition-colors"
            style={tab === t.key
              ? { background: 'rgba(240,180,50,0.14)', color: '#F5C842', boxShadow: 'inset 0 0 0 1px rgba(240,180,50,0.45)' }
              : { color: '#9CA3AF', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.10)' }}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="text-xs mb-3" style={{ color: '#F5C842' }}>{error}</div>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* List */}
        <div className="vg-material vg-grain rounded-2xl overflow-hidden">
          <div className="relative z-[1] p-3">
            {loading ? (
              <div className="p-8 text-center text-sm text-text-muted">Loading…</div>
            ) : !rows.length ? (
              <div className="p-8 text-center text-sm text-text-muted">
                No {tab} applications.
              </div>
            ) : rows.map((r) => (
              <button key={r.uid} onClick={() => setSel(r)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors"
                style={sel?.uid === r.uid
                  ? { background: 'linear-gradient(90deg, rgba(240,180,50,0.13) 0%, transparent 85%)', boxShadow: 'inset 2px 0 0 #F5C842' }
                  : {}}>
                <img src={r.avatar || '/brand/avatar-default.webp'} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-text-primary truncate">
                    {r.displayName || r.username || r.uid.slice(0, 8)}
                  </div>
                  <div className="text-[11px] text-text-muted truncate">
                    {(r.qualifiedVia || []).join(', ') || 'no path'} · {fmt(r.appliedAtMs)}
                  </div>
                </div>
                <Icon name="chevron_right" className="text-text-muted text-base shrink-0" />
              </button>
            ))}
          </div>
        </div>

        {/* Detail */}
        <div className="vg-material vg-grain vg-beam rounded-2xl overflow-hidden">
          <div className="relative z-[1] p-5">
            {!sel ? (
              <div className="p-8 text-center text-sm text-text-muted">
                Select an application to review it.
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <img src={sel.avatar || '/brand/avatar-default.webp'} alt="" className="w-12 h-12 rounded-full object-cover" />
                  <div className="min-w-0">
                    <div className="font-bold text-text-primary truncate">{sel.displayName || sel.username}</div>
                    <div className="text-[11px] text-text-muted font-dmmono">{sel.uid}</div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 mt-4 text-center">
                  {[['Followers', sel.followerCount], ['KYC level', sel.kycLevel], ['Held coins', sel.pendingCoins]].map(([l, v]) => (
                    <div key={l} className="rounded-xl py-2.5" style={{ background: 'rgba(255,255,255,0.03)' }}>
                      <div className="text-[10px] uppercase tracking-wider text-text-muted">{l}</div>
                      <div className="font-dmmono font-bold tabular-nums text-text-primary">{v ?? 0}</div>
                    </div>
                  ))}
                </div>

                <div className="vg-rule-h my-4" />
                <div className="text-xs font-bold uppercase tracking-wider text-text-muted mb-1">
                  At time of application
                </div>
                {Object.entries(snap.required || {}).map(([k, r]) => (
                  <div key={k} className="flex items-center gap-2 py-1 text-sm">
                    <Icon name={r.met ? 'check_circle' : 'cancel'} filled className="text-base"
                      style={{ color: r.met ? '#34D399' : '#F04060' }} />
                    <span className="text-text-secondary">{r.label}</span>
                    <span className="text-text-muted text-xs ml-auto">{r.detail}</span>
                  </div>
                ))}
                {Object.entries(snap.paths || {}).map(([k, p]) => (
                  <div key={k} className="flex items-center gap-2 py-1 text-sm">
                    <Icon name={p.met ? 'check_circle' : 'radio_button_unchecked'} filled={p.met}
                      className="text-base" style={{ color: p.met ? '#34D399' : '#4B5563' }} />
                    <span className="text-text-secondary">{p.label}</span>
                    <span className="text-text-muted text-xs ml-auto font-dmmono tabular-nums">
                      {p.progress}/{p.target}
                    </span>
                  </div>
                ))}

                {tab === 'pending' && (
                  <>
                    <div className="vg-rule-h my-4" />
                    <div className="text-xs font-bold uppercase tracking-wider text-text-muted mb-2">
                      Rejection reason
                    </div>
                    <select value={reason} onChange={(e) => setReason(e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm bg-transparent text-text-primary mb-2"
                      style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)' }}>
                      {REASONS.map((r) => (
                        <option key={r.code} value={r.code} style={{ background: '#14151C' }}>
                          {r.label}{r.hard ? ' (blocks reapplying)' : ''}
                        </option>
                      ))}
                    </select>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                      placeholder="Internal notes (not shown to the applicant)" rows={2}
                      className="w-full rounded-lg px-3 py-2 text-sm bg-transparent text-text-primary placeholder:text-text-muted"
                      style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)' }} />

                    {sel.pendingCoins > 0 && (
                      <div className="text-[11px] text-text-muted mt-2">
                        Approving credits {sel.pendingCoins} held coins at their current share.
                      </div>
                    )}

                    <div className="flex gap-2 mt-3">
                      <button disabled={busy} onClick={() => decide('approve')}
                        className="flex-1 rounded-xl py-2.5 font-bold text-sm text-[#0B1A10] disabled:opacity-40"
                        style={{ background: 'linear-gradient(180deg,#4ADE80,#22A45D)' }}>
                        Approve
                      </button>
                      <button disabled={busy} onClick={() => decide('reject')}
                        className="flex-1 rounded-xl py-2.5 font-bold text-sm text-text-primary disabled:opacity-40"
                        style={{ boxShadow: 'inset 0 0 0 1px rgba(240,64,96,0.5)', color: '#FCA5A5' }}>
                        Reject
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
