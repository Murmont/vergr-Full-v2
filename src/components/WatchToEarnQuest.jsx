import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { ADS_CONFIG, isAdZoneReady } from '../config/ads';
import { getAdQuestState, recordAdWatch } from '../firebase/firestore';
import { isAdMobReady, showRewardedForCoins } from '../utils/admob';
import useTier from '../hooks/useTier';
import Icon from './Icon';

// ────────────────────────────────────────────────────────────
// WatchToEarnQuest — daily Monetag Direct Link quest
// ────────────────────────────────────────────────────────────
// Fraud-resistant flow:
//   1. User taps button → we open ADS_CONFIG.directLinkUrl in a new tab.
//   2. The new tab should steal focus, so document.hidden becomes true.
//      We require this to happen at least once during the watch window —
//      if our tab never hides, the ad was either blocked or opened in
//      background and the user never engaged with it, so we refuse credit.
//   3. A 30-second timer runs. If the user returns to our tab BEFORE the
//      timer expires (i.e. they closed the ad immediately), we cancel the
//      pending credit entirely. No VP, no streak advance.
//   4. If the timer completes while our tab is still hidden, we mark the
//      watch as "ready to credit" and wait for the user to return. When
//      they come back, we call recordAdWatch() and show the VP toast.
//
// Resilience:
//   - Timer state is persisted to localStorage so a crash/reload mid-watch
//     doesn't double-credit (key is cleared whenever credit resolves or
//     aborts). On mount we resume any in-flight timer.

const TIMER_KEY = (uid) => `vergr_ad_timer_${uid}`;

// Dispatcher: ads are FREE-tier-only. On the native app (AdMob wired) we run a
// rewarded ad that credits COINS via server-side verification; on web we keep
// the Monetag Direct Link path that credits VP (no verified completion signal
// on the web, so it can't safely pay cashable coins).
export default function WatchToEarnQuest() {
  const { isFree } = useTier();
  if (!isFree) return null; // Lite/Pro never see ads anywhere.
  if (isAdMobReady()) return <RewardedCoinQuest />;
  return <WebVpWatchQuest />;
}

// ── Native: AdMob rewarded → coins (credited server-side via SSV) ──────────
function RewardedCoinQuest() {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid;
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);

  const handleClick = async () => {
    if (!uid || busy) return;
    setBusy(true);
    setFlash(null);
    try {
      const { rewarded } = await showRewardedForCoins(uid);
      if (rewarded) {
        setFlash({ ok: true });
      } else {
        setFlash({ skipped: true });
      }
    } catch (err) {
      const msg = (err && err.message) || 'admob_failed';
      setFlash({ error: msg === 'admob_timeout' ? 'timeout' : 'failed' });
    } finally {
      setBusy(false);
      setTimeout(() => setFlash(null), 4500);
    }
  };

  if (!uid) return null;

  const flashTone = flash && flash.ok
    ? 'bg-brand-gold/10 text-brand-gold border border-brand-gold/25'
    : 'bg-surface-2/60 text-text-muted border border-white/[0.06]';

  return (
    <div className="mx-4 mt-3 mb-1">
      <button
        onClick={handleClick}
        disabled={busy}
        className="w-full flex items-center gap-3 p-3.5 rounded-xl bg-surface-1 border border-white/[0.06] hover:bg-surface-2/50 transition-colors group disabled:opacity-70"
      >
        <div className="w-9 h-9 rounded-lg bg-brand-gold/15 flex items-center justify-center shrink-0">
          <Icon name={busy ? 'hourglass_top' : 'play_circle'} size={20} className="text-brand-gold" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-text-primary font-semibold text-sm">
            {busy ? 'Loading ad…' : 'Watch an ad, earn coins'}
          </p>
          <p className="text-text-muted text-[10px]">
            Finish the ad to get coins added to your wallet
          </p>
        </div>
        {!busy && (
          <Icon name="arrow_forward" size={16} className="text-text-muted group-hover:text-text-secondary transition-colors" />
        )}
      </button>
      {flash && (
        <div className={`mt-1.5 px-3 py-2 rounded-lg text-xs flex items-center gap-2 ${flashTone}`}>
          {flash.ok && (<><Icon name="paid" size={14} /><span className="font-bold">Coins added to your wallet shortly!</span></>)}
          {flash.skipped && (<><Icon name="timer_off" size={14} />Watch the full ad to earn coins.</>)}
          {flash.error === 'timeout' && (<><Icon name="error_outline" size={14} />Ad took too long — try again.</>)}
          {flash.error === 'failed' && (<><Icon name="error_outline" size={14} />No ad available right now — try again soon.</>)}
        </div>
      )}
    </div>
  );
}

function WebVpWatchQuest() {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid;

  const [questState, setQuestState] = useState(null);
  const [pendingUntil, setPendingUntil] = useState(null); // ms timestamp
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [flash, setFlash] = useState(null);

  // Refs so the visibility listener can mutate without re-subscribing
  const tickRef = useRef(null);
  const hasHiddenRef = useRef(false);
  const finalizedRef = useRef(false);

  // Clear everything (timer, storage, state) without crediting
  const resetWatch = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    hasHiddenRef.current = false;
    finalizedRef.current = false;
    if (uid) localStorage.removeItem(TIMER_KEY(uid));
    setPendingUntil(null);
    setSecondsLeft(0);
  }, [uid]);

  // Finalize a valid watch — credit VP + advance streak
  const finalizeWatch = useCallback(async () => {
    if (!uid || finalizedRef.current) return;
    finalizedRef.current = true;
    resetWatch();
    try {
      const result = await recordAdWatch(uid);
      setQuestState((s) => ({
        ...(s || {}),
        todayCount: result.todayCount,
        weekStreak: result.weekStreak,
        monthStreak: result.monthStreak,
      }));
      setFlash({
        vp: result.creditedVp,
        dailyBonus: result.dailyBonusJustHit,
        week: result.weekBonusHit,
        month: result.monthBonusHit,
      });
      setTimeout(() => setFlash(null), 4500);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Watch-to-earn credit failed:', err);
    }
  }, [uid, resetWatch]);

  // Abort a watch with a specific reason — shows user feedback but no VP
  const abortWatch = useCallback((reason) => {
    resetWatch();
    setFlash({ vp: 0, [reason]: true });
    setTimeout(() => setFlash(null), 4000);
  }, [resetWatch]);

  // Load quest state on mount / login
  useEffect(() => {
    if (!uid) return;
    getAdQuestState(uid).then(setQuestState).catch(() => {});
    // Resume an in-flight timer that survived a page reload. We do NOT
    // resume the "must have been hidden" check across reloads — a reload
    // means the user came back to our tab, so if they're still within the
    // watch window, treat it as "closed early".
    const stored = localStorage.getItem(TIMER_KEY(uid));
    if (stored) {
      const expiresAt = Number(stored);
      if (!Number.isNaN(expiresAt)) {
        if (expiresAt > Date.now()) {
          abortWatch('closedEarly');
        } else {
          // Timer had already elapsed before reload — credit it.
          // (Best-effort: we trust the pre-reload visibility enforcement.)
          finalizeWatch();
        }
      }
    }
  }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drive the countdown + visibility guard
  useEffect(() => {
    if (!pendingUntil) return;

    hasHiddenRef.current = document.hidden;
    finalizedRef.current = false;

    const onVisibilityChange = () => {
      if (document.hidden) {
        hasHiddenRef.current = true;
      } else if (hasHiddenRef.current) {
        // Tab returned to foreground — decide outcome
        if (Date.now() >= pendingUntil) {
          finalizeWatch();
        } else {
          abortWatch('closedEarly');
        }
      }
    };

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((pendingUntil - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining > 0) return;

      // Timer complete
      if (!hasHiddenRef.current) {
        // Tab never hid during the entire window → ad was never viewed
        abortWatch('neverViewed');
        return;
      }
      // Valid — but defer finalizing until the user actually returns,
      // otherwise they'd never see the "+VP" toast. The visibility
      // handler will call finalizeWatch() when they come back.
      clearInterval(tickRef.current);
      tickRef.current = null;
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    tick();
    tickRef.current = setInterval(tick, 500);

    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [pendingUntil, finalizeWatch, abortWatch]);

  const handleClick = () => {
    if (!uid || pendingUntil) return;
    if (!isAdZoneReady('directlink')) {
      setFlash({ vp: 0, placeholder: true });
      setTimeout(() => setFlash(null), 3500);
      return;
    }
    const newWin = window.open(ADS_CONFIG.directLinkUrl, '_blank', 'noopener,noreferrer');
    if (!newWin) {
      // Popup blocker killed the window — let the user know.
      setFlash({ vp: 0, blocked: true });
      setTimeout(() => setFlash(null), 4000);
      return;
    }
    const expiresAt = Date.now() + ADS_CONFIG.watchToEarnSeconds * 1000;
    localStorage.setItem(TIMER_KEY(uid), String(expiresAt));
    setPendingUntil(expiresAt);
  };

  if (!uid) return null;

  const todayCount = questState?.todayCount || 0;
  const weekStreak = questState?.weekStreak || 0;
  const threshold = ADS_CONFIG.dailyAdBonusThreshold;
  const progress = Math.min(1, todayCount / threshold);

  // Pick the right flash copy based on why the watch ended
  const renderFlash = () => {
    if (!flash) return null;
    if (flash.placeholder) {
      return (
        <>
          <Icon name="info" size={14} />
          Watch-to-Earn launches once the ad network is approved.
        </>
      );
    }
    if (flash.blocked) {
      return (
        <>
          <Icon name="block" size={14} />
          Popup blocked — please allow popups on this site to earn.
        </>
      );
    }
    if (flash.closedEarly) {
      return (
        <>
          <Icon name="timer_off" size={14} />
          You came back too early — stay on the ad for {ADS_CONFIG.watchToEarnSeconds}s to earn VP.
        </>
      );
    }
    if (flash.neverViewed) {
      return (
        <>
          <Icon name="visibility_off" size={14} />
          Ad opened in background — click the ad tab to view it and earn VP.
        </>
      );
    }
    return (
      <>
        <Icon name="bolt" size={14} />
        <span className="font-bold">+{flash.vp} VP</span>
        {flash.dailyBonus && <span>· daily bonus!</span>}
        {flash.week && <span>· week streak bonus!</span>}
        {flash.month && <span>· month streak bonus!</span>}
      </>
    );
  };

  const flashTone = flash && (flash.placeholder || flash.blocked || flash.closedEarly || flash.neverViewed)
    ? 'bg-surface-2/60 text-text-muted border border-white/[0.06]'
    : 'bg-brand-gold/10 text-brand-gold border border-brand-gold/25';

  return (
    <div className="mx-4 mt-3 mb-1">
      <button
        onClick={handleClick}
        disabled={!!pendingUntil}
        className="w-full flex items-center gap-3 p-3.5 rounded-xl bg-surface-1 border border-white/[0.06] hover:bg-surface-2/50 transition-colors group disabled:opacity-70"
      >
        <div className="w-9 h-9 rounded-lg bg-brand-gold/15 flex items-center justify-center shrink-0">
          <Icon name="play_circle" size={20} className="text-brand-gold" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-text-primary font-semibold text-sm">
            {pendingUntil ? `Crediting in ${secondsLeft}s…` : `Watch to Earn — +${ADS_CONFIG.watchToEarnVp} VP`}
          </p>
          <p className="text-text-muted text-[10px]">
            {todayCount}/{threshold} today
            {weekStreak > 0 && ` · ${weekStreak}-day streak`}
          </p>
          <div className="mt-1.5 h-1 rounded-full bg-surface-3 overflow-hidden">
            <div
              className="h-full bg-brand-gold transition-all"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
        {!pendingUntil && (
          <Icon name="arrow_forward" size={16} className="text-text-muted group-hover:text-text-secondary transition-colors" />
        )}
      </button>

      {flash && (
        <div className={`mt-1.5 px-3 py-2 rounded-lg text-xs flex items-center gap-2 ${flashTone}`}>
          {renderFlash()}
        </div>
      )}
    </div>
  );
}
