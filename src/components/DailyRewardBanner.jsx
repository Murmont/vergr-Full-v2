// Automated daily check-in banner. The user does NOT click anything — on the
// first app open of the day it auto-claims the daily login reward, slides a
// glass banner DOWN from the top of the screen with an animated streak progress
// bar, then slides back up and disappears after a few seconds.
//
// Daily login is VP-ONLY (no coins) and the VP is plan-multiplied server-side
// (Free 1× / Lite 1.5× / Pro 2×) — the banner surfaces the multiplier badge.
import { useState, useEffect, useRef } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { VPIcon } from './CoinIcon';
import Icon from './Icon';

const VISIBLE_MS = 4800; // how long the banner stays on screen after sliding in

export default function DailyRewardBanner() {
  const { currentUser } = useAuth();
  const [result, setResult] = useState(null);
  const [mounted, setMounted] = useState(false); // in DOM
  const [shown, setShown] = useState(false);      // slid down (transform)
  const timers = useRef([]);

  useEffect(() => {
    if (!currentUser || !functions) return;
    const today = new Date().toISOString().slice(0, 10);
    const claimKey = `vergr_daily_${currentUser.uid}`;
    if (localStorage.getItem(claimKey) === today) return; // already done today

    let cancelled = false;
    (async () => {
      try {
        const res = await httpsCallable(functions, 'claimDailyReward')();
        localStorage.setItem(claimKey, today);
        if (cancelled) return;
        reveal(res.data);
      } catch (err) {
        // Already claimed (e.g. claimed on another device) — just mark done.
        if (err?.code === 'functions/already-exists') {
          localStorage.setItem(claimKey, today);
        } else {
          console.error('Daily check-in error:', err);
        }
      }
    })();

    function reveal(data) {
      setResult(data);
      setMounted(true);
      // next frame → slide down
      timers.current.push(requestAnimationFrame(() => requestAnimationFrame(() => setShown(true))));
      // auto-hide
      timers.current.push(setTimeout(() => setShown(false), VISIBLE_MS));
      timers.current.push(setTimeout(() => setMounted(false), VISIBLE_MS + 600));
    }

    return () => {
      cancelled = true;
      timers.current.forEach(t => { clearTimeout(t); cancelAnimationFrame(t); });
      timers.current = [];
    };
  }, [currentUser]);

  if (!mounted || !result) return null;

  const { dayOfStreak = 1, vpReward = 0, milestone = false, multiplier = 1 } = result;
  const prevPct = ((Math.max(0, dayOfStreak - 1)) / 5) * 100;
  const curPct = (dayOfStreak / 5) * 100;
  // Literal hex, not var(--brand-*): those CSS variables are not defined
  // anywhere in the project, so this accent silently resolved to nothing.
  const accent = milestone ? '#F0A500' : '#B44FFF';

  return (
    <div
      className="fixed top-0 left-1/2 z-[95] w-[360px] max-w-[calc(100vw-1.5rem)] px-1"
      style={{
        transform: `translateX(-50%) translateY(${shown ? 'calc(env(safe-area-inset-top, 0px) + 12px)' : '-140%'})`,
        transition: 'transform 520ms cubic-bezier(.22,1,.36,1)',
        pointerEvents: 'none',
      }}
    >
      <div
        className="relative rounded-2xl px-4 py-3.5 overflow-hidden"
        style={{
          background: 'rgba(20,20,31,0.55)',
          backdropFilter: 'blur(22px) saturate(160%)',
          WebkitBackdropFilter: 'blur(22px) saturate(160%)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 16px 40px -12px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.08)',
        }}
      >
        {/* accent glow wash */}
        <div
          className="absolute inset-0 opacity-60 pointer-events-none"
          style={{ background: `radial-gradient(120% 90% at 50% -20%, ${milestone ? 'rgba(240,165,0,0.22)' : 'rgba(180,79,255,0.18)'}, transparent 70%)` }}
        />

        <div className="relative flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: milestone ? 'rgba(240,165,0,0.18)' : 'rgba(180,79,255,0.14)', border: `1px solid ${milestone ? 'rgba(240,165,0,0.35)' : 'rgba(180,79,255,0.3)'}` }}
          >
            <Icon name={milestone ? 'local_fire_department' : 'bolt'} size={22} style={{ color: accent }} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-extrabold text-[13px] text-text-primary truncate">
                {milestone ? '5-day streak complete!' : `Daily check-in · Day ${dayOfStreak}/5`}
              </p>
              {multiplier > 1 && (
                <span
                  className="shrink-0 text-[9.5px] font-dmmono font-bold px-1.5 py-0.5 rounded-full"
                  style={{ color: '#B44FFF', background: 'rgba(123,31,255,0.18)', border: '1px solid rgba(180,79,255,0.35)' }}
                >
                  {multiplier}× VP
                </span>
              )}
            </div>

            <p className="mt-0.5 text-[11px] flex items-center gap-1 font-dmmono font-bold" style={{ color: accent }}>
              <VPIcon size={12} /> +{vpReward} VP
              {milestone && <span className="text-text-secondary font-normal ml-1">streak reset — keep going!</span>}
            </p>

            {/* streak progress bar with the new day animating in */}
            <div className="mt-2 relative h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: shown ? `${curPct}%` : `${prevPct}%`,
                  background: `linear-gradient(90deg, ${accent}, ${milestone ? '#F5C842' : '#C87FFF'})`,
                  boxShadow: `0 0 10px ${milestone ? 'rgba(240,165,0,0.6)' : 'rgba(180,79,255,0.55)'}`,
                  transition: 'width 900ms cubic-bezier(.22,1,.36,1) 220ms',
                }}
              />
              {/* day ticks */}
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="absolute top-1/2 -translate-y-1/2 w-px h-1.5" style={{ left: `${(i / 5) * 100}%`, background: 'rgba(11,11,20,0.7)' }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
