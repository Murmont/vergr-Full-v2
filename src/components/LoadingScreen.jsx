import { useEffect, useMemo, useState } from 'react';

import './LoadingScreen.css';

const COPY = [
  'respawning your feed',
  're-racking the lobby',
  'counting your coins',
  'defragging your DMs',
  'tuning the squad frequency',
  'polishing the profile banners',
  'oiling the leaderboard',
  'rehydrating your wallet',
  'pulling fresh clips off the shelf',
  'warming up the stream keys',
  'aligning the crosshair',
];

const TIPS = [
  { label: 'TIP', body: 'Posting, streaming and gifting all earn VP toward your next rank.' },
  { label: 'DID YOU KNOW', body: 'Creators keep 50% to 80% of what they earn, rising as you earn.' },
  { label: 'NEW', body: 'Sell tickets to your own live events, straight from a chat.' },
  { label: 'PRO TIP', body: 'Pin your vergr.me link in chat to convert viewers into followers.' },
  { label: 'REMINDER', body: 'Squad voice rooms stay private — no transcripts, ever.' },
];

/**
 * Renders on EVERY platform, including native. It briefly returned null on the
 * Android shell so it could not double up with a custom native splash view; that
 * view no longer exists (the system splash is the only boot screen now), and the
 * null turned two genuine in-app loading gates — ProtectedRoute and RootRoute —
 * into a blank screen for 1.25s. Do not reintroduce a platform check here.
 */
export default function LoadingScreen() {
  const [microIdx, setMicroIdx] = useState(0);
  const [tipIdx, setTipIdx] = useState(() => Math.floor(Math.random() * TIPS.length));

  useEffect(() => {
    const i = setInterval(() => setMicroIdx((n) => (n + 1) % COPY.length), 1800);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    const i = setInterval(() => setTipIdx((n) => (n + 1) % TIPS.length), 6000);
    return () => clearInterval(i);
  }, []);

  const particles = useMemo(() => {
    const colors = ['cy', 'vi', 'pi', 'wh', 'cy', 'vi', 'pi'];
    const n = 18;
    return Array.from({ length: n }, (_, i) => {
      const seed = i * 7919;
      return {
        left: `${(seed * 13) % 100}%`,
        top: `${(seed * 29 + 30) % 100}%`,
        size: 3 + ((seed * 5) % 8),
        color: colors[i % colors.length],
        animationDuration: `${8 + ((seed * 3) % 12)}s`,
        animationDelay: `${(seed % 12) - 4}s`,
      };
    });
  }, []);

  return (
    <div className="vl-root">
      <div className="vl-plate" />
      <div className="vl-breath" />
      <div className="vl-sweep" />
      <div className="vl-particles">
        {particles.map((p, i) => (
          <span
            key={i}
            className={`vl-particle ${p.color}`}
            style={{
              left: p.left,
              top: p.top,
              width: p.size,
              height: p.size,
              animationDuration: p.animationDuration,
              animationDelay: p.animationDelay,
            }}
          />
        ))}
      </div>
      <div className="vl-vignette" />

      <div className="vl-top-chip">
        <img src="/icons/icon-512-v2.png" alt="" />
        <span>VERGR</span>
      </div>

      <div className="vl-foreground">
        <div className="vl-center">
          {/* No ring. A dashed CIRCLE around a rounded-square mark reads cheap,
              and it painted before the icon bitmap did, so the first thing on
              screen was an empty dashed ring. Glow only — must stay identical to
              #boot-splash in index.html or the handoff shows a seam. */}
          <div className="vl-icon-stage">
            <div className="vl-icon-glow" />
            <div className="vl-icon-glow-core" />
            {/* lowercase: React 18 does not map a camelCase fetchPriority prop */}
            <img className="vl-icon-img" src="/icons/icon-512-v2.png" alt="VERGR" fetchpriority="high" />
          </div>

          <div className="vl-progress">
            <div className="vl-progress-bar" />
          </div>

          <div className="vl-microcopy">
            <span className="vl-dot" />
            <span key={microIdx} className="vl-microcopy-text">{COPY[microIdx]}</span>
          </div>
        </div>
      </div>

      {/* ONE bottom stack. The tip and the tagline used to be pinned separately
          (bottom:70px and bottom:24px); when the tip wrapped to a second line the
          two collided and the tip text spilled outside its own card. A flex
          column cannot overlap itself. */}
      <div className="vl-bottom">
        <div className="vl-tip" key={tipIdx}>
          <span className="vl-tip-label">{TIPS[tipIdx].label}</span>
          <span className="vl-tip-body">{TIPS[tipIdx].body}</span>
        </div>
        <div className="vl-tagline">Create. Watch. Earn.</div>
      </div>
    </div>
  );
}
