import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
// ⚠ THE SAME CALLABLE PATTERN THE REST OF THIS FOLDER USES (GoLiveSetupScreen:379).
// A second way of reaching functions is a second place to get the region wrong.
import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { RaidPicker } from '../../components/streams/RaidControls';
import Icon from '../../components/Icon';
import { CoinIcon } from '../../components/CoinIcon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';

export default function StreamEndingScreen() {
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);
  const navigate = useNavigate();
  const location = useLocation();
  const stats = location.state || {};

  // ── Raid ──────────────────────────────────────────────────────────────
  // ⚠⚠ THIS IS THE ONLY MOMENT A RAID CAN HAPPEN. The audience exists right now
  // and is about to disperse; a raid offered anywhere else has nobody to move.
  // Founder decisions: the raider earns VP, there is NO minimum viewer count,
  // and a raid may not land on an audio-only or gated stream — all enforced in
  // `functions/raids.js`, because a client check is a suggestion.
  const [targets, setTargets] = useState([]);
  const [raidBusy, setRaidBusy] = useState(false);
  const [raided, setRaided] = useState(null);
  const [skipped, setSkipped] = useState(false);
  const streamId = stats.streamId || null;

  useEffect(() => {
    if (!streamId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        // ⚠ ONLY OFFER TARGETS THE SERVER WILL ACCEPT. Listing an audio-only or
        // gated stream here would produce a button that fails — the "control that
        // leads nowhere" this codebase keeps producing. The filter mirrors
        // `badRaidTarget` in functions/raids.js; if that changes, change this.
        const qs = await getDocs(query(collection(db, 'streams'), where('status', '==', 'live'), limit(20)));
        const rows = [];
        qs.forEach((d) => {
          const v = d.data() || {};
          if (d.id === streamId) return;
          if (v.audioOnly === true) return;
          if (v.unlisted || v.audience === 'ticketed' || v.access?.mode === 'paid') return;
          rows.push({ id: d.id, hostName: v.hostName || 'A creator', viewers: v.viewerCount || 0 });
        });
        if (!cancelled) setTargets(rows.slice(0, 5));
      } catch {
        // ⚠ A FAILED LOOKUP SHOWS THE EMPTY STATE, NEVER AN ERROR. The stream has
        // already ended; nothing here is worth interrupting the host over.
        if (!cancelled) setTargets([]);
      }
    })();
    return () => { cancelled = true; };
  }, [streamId]);

  const doRaid = async (toStreamId) => {
    if (!streamId || raidBusy) return;
    setRaidBusy(true);
    try {
      await httpsCallable(getFunctions(undefined, 'europe-west1'), 'raidStream')({ fromStreamId: streamId, toStreamId });
      setRaided(targets.find((t) => t.id === toStreamId)?.hostName || 'them');
    } catch (e) {
      // The server owns every rule, so its message is the honest one to show.
      setRaided(null);
      setSkipped(true);
      console.error('raidStream', e);
    } finally { setRaidBusy(false); }
  };

  return (
    <div className={isDesktop ? "min-h-screen flex flex-col items-center justify-center px-6 pb-8" : "screen-container min-h-screen flex flex-col items-center justify-center px-6 pb-8"}>
      <div className="w-20 h-20 rounded-full bg-brand-violet/10 flex items-center justify-center mb-6">
        <Icon name="live_tv" size={40} className="text-brand-violet-light" />
      </div>
      <h1 className="font-syne text-2xl font-bold mb-2">Stream Ended</h1>
      <p className="text-text-muted text-sm mb-6">Great stream! Here is your summary.</p>

      <div className="w-full grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {[
          { label: 'Duration', value: stats.duration || '0m', icon: 'schedule' },
          { label: 'Peak Viewers', value: stats.peakViewers || '0', icon: 'visibility' },
          { label: 'New Followers', value: stats.newFollowers || '0', icon: 'person_add' },
          // ⚠ THE BRAND COIN, NOT A BULLET. This read “● 0” — a literal U+25CF
          // standing in for the coin — on the host’s own earnings summary. CLAUDE.md
          // records this exact substitution being fixed in the PREVIEW; the REAL
          // screen still had it, which is how a defect survives being “fixed”.
          { label: 'Tips Earned', value: String(stats.tips || 0), coin: true, icon: 'savings' },
        ].map(s => (
          <div key={s.label} className="p-4 rounded-2xl bg-surface-1 border border-white/[0.06] text-center">
            <Icon name={s.icon} size={20} className="text-text-muted mx-auto mb-1" />
            <p className="font-dmmono font-bold text-base flex items-center justify-center gap-1.5">
              {s.coin && <CoinIcon size={15} />}{s.value}
            </p>
            <p className="text-[10px] text-text-muted uppercase">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ⚠ THE RAID SITS ABOVE "Back Home" because it is the decision with a
          deadline — the audience is dispersing while the host reads this. */}
      {streamId && !raided && !skipped && (
        <div style={{ width: '100%', marginBottom: 12 }}>
          <RaidPicker candidates={targets} busy={raidBusy}
            onRaid={doRaid} onSkip={() => setSkipped(true)} />
        </div>
      )}
      {raided && (
        <div style={{ width: '100%', marginBottom: 12, padding: '12px 14px', borderRadius: 12, background: '#1a1a2a', color: '#e8e8f0', fontSize: 13, fontWeight: 700 }}>
          Your viewers are on their way to {raided}.
        </div>
      )}
      <button onClick={() => navigate('/')} className="w-full py-4 rounded-2xl bg-brand-violet text-white font-bold">Back Home</button>
    </div>
  );
}
