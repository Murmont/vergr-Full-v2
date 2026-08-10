// Organizer-side inbox of player applications across tournaments the user
// is admin of. Reads from `tournament_applications` (created when a private
// tournament receives an apply-to-join request). Approve/decline call the
// `approveTournamentApplication` / `declineTournamentApplication` callables.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon';
import AppHeader from '../../components/brand/AppHeader';
import { useUser } from '../../context/UserContext';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import TopBar from '../../components/TopBar';
import { StackSkeleton } from '../../components/skeletons/GlassSkeletons';
import {
  getTournamentApplications,
  getUserTournaments,
  approveTournamentApplication,
  declineTournamentApplication,
} from '../../firebase/firestore';
import { useUI } from '../../context/UIContext';
import { Pill } from '../../components/tournament/TournamentBits';
import TournamentRightRail from '../../components/tournament/TournamentRightRail';

const STATUS_TABS = [
  { key: 'pending',  label: 'Pending',   icon: 'pending' },
  { key: 'approved', label: 'Approved',  icon: 'check_circle' },
  { key: 'waitlist', label: 'Waitlist',  icon: 'hourglass_top' },
  { key: 'declined', label: 'Declined',  icon: 'cancel' },
];

const STATUS_META = {
  pending:  { label: 'Pending',    color: 'gold',   icon: 'pending' },
  approved: { label: 'Approved',   color: 'cyan',   icon: 'check_circle' },
  declined: { label: 'Declined',   color: 'ember',  icon: 'cancel' },
  waitlist: { label: 'Waitlisted', color: 'violet', icon: 'hourglass_top' },
};

export default function TournamentApplicationsScreen() {
  const navigate = useNavigate();
  const { profile } = useUser();
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();
  const { showToast } = useUI();
  const [status, setStatus] = useState('pending');
  const [tournId, setTournId] = useState('all');
  const [apps, setApps] = useState([]);
  const [hostedTournaments, setHostedTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setRightPanel(null); setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign]);

  // Load applications for the current status
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [a, h] = await Promise.all([
          getTournamentApplications(profile?.uid, status, 100),
          getUserTournaments(profile?.uid, 50),
        ]);
        if (cancelled) return;
        setApps(a);
        setHostedTournaments(h.filter(t => t._hosting));
      } catch (err) {
        console.error('Applications load', err);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [profile?.uid, status, reloadKey]);

  const handleResolve = async (applicationId, decision) => {
    try {
      if (decision === 'approved') await approveTournamentApplication(applicationId);
      else await declineTournamentApplication(applicationId);
      showToast(decision === 'approved' ? 'Application approved' : 'Application declined', 'success');
      // Drop the resolved app from the current (pending) list immediately.
      setApps(prev => prev.filter(a => a.id !== applicationId));
    } catch (err) {
      showToast(err?.message || 'Action failed', 'error');
    }
  };

  const filtered = useMemo(
    () => apps.filter(a => tournId === 'all' || a.tournamentId === tournId),
    [apps, tournId],
  );

  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, declined: 0, waitlist: 0 };
    apps.forEach(a => { if (c[a.status] != null) c[a.status]++; });
    return c;
  }, [apps]);

  const header = { title: 'Applications', subtitle: 'Review who wants to join your tournaments.' };

  // Mobile
  if (!isDesktop) {
    return (
      <div className="screen-container min-h-screen pb-8">
        <TopBar title={header.title} showBack />
        <div className="px-4 pt-3 space-y-3">
          <div className="flex gap-1 border-b border-white/[0.06] overflow-x-auto no-scrollbar">
            {STATUS_TABS.map(t => (
              <button key={t.key} onClick={() => setStatus(t.key)}
                className={`relative px-3 py-2 text-[12px] font-semibold whitespace-nowrap ${status === t.key ? 'text-text-primary' : 'text-text-muted'}`}>
                {t.label}
                {status === t.key && <span className="absolute left-2 right-2 -bottom-px h-[2px] bg-gradient-to-r from-brand-violet to-brand-pink" />}
              </button>
            ))}
          </div>
          {loading ? <Spinner /> : filtered.length === 0 ? <EmptyApps status={status} /> : (
            <div className="space-y-2">{filtered.map(a => <ApplicationCard key={a.id} app={a} hosted={hostedTournaments} onResolve={handleResolve} />)}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <div className="flex-1 min-w-0 flex flex-col">
        <AppHeader title={header.title} subtitle={header.subtitle} />

        <div className="flex-1 px-6 py-5 space-y-5">
          {/* Tournament filter strip */}
          {hostedTournaments.length > 0 && (
            <div className="rounded-2xl bg-[#12132099] border border-white/[0.06] p-3">
              <div className="text-[10px] font-dmmono uppercase tracking-[0.14em] text-text-muted px-1 pb-2">Tournament</div>
              <div className="flex gap-2 overflow-x-auto no-scrollbar">
                <FilterChip on={tournId === 'all'} onClick={() => setTournId('all')} label="All Tournaments" />
                {hostedTournaments.map(t => (
                  <FilterChip key={t.id} on={tournId === t.id} onClick={() => setTournId(t.id)} label={t.name} />
                ))}
              </div>
            </div>
          )}

          {/* Status tabs */}
          <div className="flex gap-1 border-b border-white/[0.06] items-end">
            {STATUS_TABS.map(tab => {
              const active = status === tab.key;
              return (
                <button key={tab.key} onClick={() => setStatus(tab.key)}
                  className={`relative px-4 py-3 text-[13px] font-semibold flex items-center gap-2 transition-colors ${active ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}>
                  <Icon name={tab.icon} size={16} className={active ? 'text-brand-violet-light' : 'text-text-muted'} />
                  {tab.label}
                  <span className={`font-dmmono text-[10px] tabular-nums px-1.5 py-0.5 rounded ${active ? 'bg-brand-violet/25 text-brand-pink' : 'bg-white/[0.05] text-text-muted'}`}>{counts[tab.key]}</span>
                  {active && <span className="absolute left-3 right-3 -bottom-px h-[2px] bg-gradient-to-r from-brand-violet to-brand-pink" />}
                </button>
              );
            })}
          </div>

          {/* Body */}
          {loading ? <Spinner /> : filtered.length === 0 ? <EmptyApps status={status} /> : (
            <div className="space-y-3">{filtered.map(a => <ApplicationCard key={a.id} app={a} hosted={hostedTournaments} onResolve={handleResolve} />)}</div>
          )}
        </div>
      </div>

      <TournamentRightRail />
    </div>
  );
}

function FilterChip({ on, onClick, label }) {
  return (
    <button onClick={onClick} className={`shrink-0 px-3 py-1.5 rounded-xl border text-[12px] font-semibold transition-colors ${
      on ? 'bg-brand-violet/20 border-brand-violet/40 text-text-primary'
         : 'bg-white/[0.03] border-white/[0.06] text-text-secondary hover:text-text-primary hover:bg-white/[0.06]'
    }`}>{label}</button>
  );
}

function Spinner() {
  return <StackSkeleton rows={4} height={72} />;
}

function EmptyApps({ status }) {
  return (
    <div className="rounded-2xl bg-white/[0.02] border border-dashed border-white/[0.08] p-16 text-center">
      <Icon name="inbox" size={48} className="text-text-muted/30 mx-auto mb-3" />
      <p className="font-syne text-base font-bold text-text-secondary">No {status} applications</p>
      <p className="text-[12px] text-text-muted mt-1">
        {status === 'pending' ? 'When players apply to a private tournament you host, they show up here.' : 'Nothing in this bucket yet.'}
      </p>
    </div>
  );
}

function ApplicationCard({ app, hosted, onResolve }) {
  const meta = STATUS_META[app.status] || STATUS_META.pending;
  const tournament = hosted.find(t => t.id === app.tournamentId);
  const [busy, setBusy] = useState(false);
  const resolve = async (decision) => {
    if (busy) return;
    setBusy(true);
    await onResolve?.(app.id, decision);
    setBusy(false);
  };
  return (
    <div className="rounded-2xl bg-[#12132099] border border-white/[0.06] hover:border-white/[0.14] transition-colors p-4 md:p-5">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-11 h-11 rounded-full bg-gradient-to-br from-brand-violet to-brand-pink flex items-center justify-center font-syne font-extrabold text-white text-lg shrink-0">
          {(app.applicantName || app.applicantId || '?').charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-syne text-[15px] font-extrabold text-text-primary">{app.applicantName || 'Applicant'}</span>
            <Pill color="neutral" size="xs">{app.kind === 'team' ? `Team · ${app.roster?.length || 0}` : 'Solo'}</Pill>
            <span className="ml-auto" />
            <Pill color={meta.color} size="sm"><Icon name={meta.icon} size={11} /> {meta.label}</Pill>
          </div>
          <div className="text-[11.5px] text-text-muted mt-1">
            {tournament ? <>Applying to <span className="text-text-secondary font-semibold">{tournament.name}</span></> : 'Tournament unknown'}
          </div>
        </div>
      </div>

      {app.message && (
        <div className="rounded-lg bg-black/30 border-l-2 border-brand-violet/50 px-3 py-2 mb-3">
          <p className="text-[12.5px] text-text-secondary italic leading-relaxed">"{app.message}"</p>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-white/[0.05]">
        {app.status === 'pending' && (
          <>
            <button
              onClick={() => resolve('approved')}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-brand-violet to-[#1F8A6B] text-black text-[12px] font-extrabold flex items-center gap-1.5 disabled:opacity-50 hover:brightness-110"
            >
              <Icon name="check" size={14} /> {busy ? 'Working…' : 'Approve'}
            </button>
            <button
              onClick={() => resolve('declined')}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] text-text-secondary text-[12px] font-semibold flex items-center gap-1.5 disabled:opacity-50 hover:bg-brand-ember/15 hover:text-brand-ember"
            >
              <Icon name="close" size={14} /> Decline
            </button>
          </>
        )}
        {app.status === 'approved' && (
          <span className="text-[11px] text-brand-violet-light font-dmmono flex items-center gap-1.5">
            <Icon name="check_circle" size={13} /> Approved
          </span>
        )}
      </div>
    </div>
  );
}
