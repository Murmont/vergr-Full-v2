// src/screens/creator/CreatorQuestsScreen.jsx
// Creator quests — VP rewards only (never coins) to protect the coin economy.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { IS_NATIVE_BUILD } from '../../utils/platform';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { claimCreatorQuest, getCreatorQuests } from '../../firebase/firestore';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';

// Confetti micro-burst on claim. Raw DOM + WAAPI so it survives re-renders;
// skipped under prefers-reduced-motion.
const BURST_COLORS = ['#7B1FFF', '#B44FFF', '#C87FFF', '#F5C842', '#FFFFFF'];
function burstConfetti(el) {
  if (!el || typeof window === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  for (let i = 0; i < 12; i++) {
    const p = document.createElement('span');
    const size = 4 + Math.random() * 4;
    p.style.cssText = `position:fixed;left:${cx}px;top:${cy}px;width:${size}px;height:${size}px;border-radius:${Math.random() > 0.5 ? '9999px' : '1px'};background:${BURST_COLORS[i % BURST_COLORS.length]};pointer-events:none;z-index:9999;`;
    document.body.appendChild(p);
    const ang = (Math.PI * 2 * i) / 12 + Math.random() * 0.6;
    const dist = 34 + Math.random() * 30;
    p.animate([
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist - 14}px)) scale(0.4) rotate(${Math.random() * 240 - 120}deg)`, opacity: 0 },
    ], { duration: 480 + Math.random() * 180, easing: 'cubic-bezier(0.2,0.8,0.3,1)' }).onfinish = () => p.remove();
  }
  // pop the claimed row/card itself
  const card = el.closest('[data-quest-card]');
  if (card) card.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }],
    { duration: 320, easing: 'ease-out' }
  );
}

// Daily quests — deliberately monochrome. VP is the only accent (violet); coins
// never appear here. No per-quest rainbow tones (looked toy-like).
const CREATOR_QUESTS = [
  { id: 'creator_post',     title: 'Post content',       desc: 'Create a post today',             vp: 30,  icon: 'edit' },
  { id: 'creator_stream',   title: 'Go Live',            desc: 'Stream for at least 30 minutes',  vp: 100, icon: 'podcasts' },
  { id: 'creator_engage',   title: 'Engage with fans',   desc: 'Reply to 5 comments',             vp: 25,  icon: 'forum' },
  { id: 'creator_collab',   title: 'Collaborate',        desc: 'Co-stream with another creator',  vp: 200, icon: 'diversity_3' },
  { id: 'creator_short',    title: 'Drop a Short',       desc: 'Publish a Short this week',       vp: 50,  icon: 'movie' },
  { id: 'creator_tierlist', title: 'Share a tier list',  desc: 'Create and publish a tier list',  vp: 40,  icon: 'format_list_numbered' },
  { id: 'creator_host_event', title: 'Host an event', desc: 'Run a ticketed event for your community', vp: 150, icon: 'confirmation_number' },
];

// The tournament-earnings ladder that used to sit here was removed on
// 2026-08-16. Tournaments are retired, so it read a ledger scan that could
// only ever return zero, and it advertised prize competitions the public
// compliance pages state Vergr does not run.

// ── Daily quest row (monochrome) ────────────────────────────────────────
function QuestRow({ quest, isClaimed, ready, hint, claiming, onClaim }) {
  return (
    <div data-quest-card className="flex items-center gap-3.5 p-4 rounded-2xl bg-white/[0.025] border border-white/[0.05] hover:border-white/[0.1] transition-colors">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${isClaimed ? 'bg-emerald-500/10' : 'bg-white/[0.05]'}`}>
        <Icon name={isClaimed ? 'check_circle' : quest.icon} filled={isClaimed} size={21}
          className={isClaimed ? 'text-emerald-400' : 'text-text-secondary'} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-white">{quest.title}</p>
        <p className="text-xs text-text-muted">{quest.desc}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="font-dmmono font-bold text-brand-violet tabular-nums text-sm">+{quest.vp} VP</p>
        {isClaimed ? (
          <span className="text-emerald-400 text-[11px] font-bold">Done</span>
        ) : ready ? (
          <button onClick={(e) => onClaim(quest, e.currentTarget)} disabled={claiming === quest.id}
            className="mt-1.5 px-3.5 py-1 rounded-full bg-brand-violet text-white text-[11px] font-bold hover:brightness-110 transition disabled:opacity-60">
            {claiming === quest.id ? '...' : 'Claim'}
          </button>
        ) : (
          // Not done yet. The server would refuse the claim, so the button is
          // not offered: say what is still outstanding instead.
          <span className="text-[10px] text-text-muted block max-w-[140px] mt-1 leading-snug">{hint || 'Not yet'}</span>
        )}
      </div>
    </div>
  );
}

export default function CreatorQuestsScreen({ embedded = false }) {
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    if (embedded) return;
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop, embedded]);

  const { currentUser } = useAuth();
  const { showToast } = useUI();
  // Server owns the quest list, the amounts, and whether each one is actually
  // completed. The client copy of CREATOR_QUESTS supplies title/description/icon
  // only, and is never trusted for a number.
  const [server, setServer] = useState(null);
  const [claiming, setClaiming] = useState(null);

  const loadQuests = useCallback(async () => {
    try { setServer(await getCreatorQuests()); }
    catch (e) { console.error('getCreatorQuests', e); }
  }, []);

  useEffect(() => { if (currentUser) loadQuests(); }, [currentUser, loadQuests]);

  const byId = useMemo(() => {
    const m = {};
    for (const q of server?.quests || []) m[q.id] = q;
    return m;
  }, [server]);

  // Only quests the server actually offers are shown. A card for a quest the
  // backend does not know about is a button that can only fail.
  const visibleQuests = useMemo(
    () => CREATOR_QUESTS.filter(q => byId[q.id]),
    [byId]
  );
  const totalVpToday = useMemo(
    () => visibleQuests.reduce((s, q) => s + (byId[q.id]?.vp ?? q.vp), 0),
    [visibleQuests, byId]
  );
  const claimedVpToday = useMemo(
    () => visibleQuests.filter(q => byId[q.id]?.claimed).reduce((s, q) => s + (byId[q.id]?.vp ?? q.vp), 0),
    [visibleQuests, byId]
  );

  const handleClaim = async (quest, btnEl) => {
    setClaiming(quest.id);
    try {
      const res = await claimCreatorQuest({ questId: quest.id });
      await loadQuests();
      burstConfetti(btnEl);
      showToast(`+${res?.vp ?? quest.vp} VP`, 'success');
    } catch (err) {
      // The server explains WHY (not done yet / already claimed today), so show
      // that rather than a generic failure.
      showToast(err?.message || 'Could not claim', 'error');
    }
    setClaiming(null);
  };

  const content = (
    <>
      {/* Header */}
      <div className="flex items-start gap-4 rounded-2xl border border-brand-violet/20 bg-gradient-to-br from-brand-violet/[0.12] to-transparent p-4 md:p-5 mb-5">
        <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
          <Icon name="military_tech" filled size={22} className="text-brand-violet" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-syne font-extrabold text-white text-base">Creator quests</h3>
          <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">
            Quests pay <span className="text-brand-violet font-bold">Vergr Points</span> — they raise your creator rank and unlock perks. They never pay coins.
          </p>
        </div>
        <div className="hidden sm:block text-right shrink-0">
          <p className="font-dmmono font-bold text-brand-violet text-lg leading-none">{claimedVpToday}<span className="text-text-muted text-sm">/{totalVpToday}</span></p>
          <p className="text-[10px] uppercase tracking-widest text-text-muted mt-1">VP today</p>
        </div>
      </div>

      {/* Daily quests */}
      <div className="mt-6">
        <div className="flex items-end justify-between mb-3">
          <div>
            <h3 className="font-syne font-extrabold text-white text-base">Daily quests</h3>
            <p className="text-[11px] text-text-muted">Refreshes every 24 hours</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {visibleQuests.map(quest => (
            <QuestRow key={quest.id} quest={{ ...quest, vp: byId[quest.id]?.vp ?? quest.vp }}
              isClaimed={!!byId[quest.id]?.claimed}
              ready={!!byId[quest.id]?.met}
              hint={byId[quest.id]?.unmet}
              claiming={claiming}
              onClaim={handleClaim} />
          ))}
        </div>
      </div>
    </>
  );

  if (embedded) return content;

  return (
    <div className={isDesktop ? "min-h-screen pb-8" : "screen-container min-h-screen pb-8"}>
      <TopBar title="Creator Quests" showBack />
      <div className="px-4 py-4">{content}</div>
    </div>
  );
}
