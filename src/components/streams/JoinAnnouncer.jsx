// JoinAnnouncer — rank-themed entry ribbons for stream viewers.
//
// UX RULES (founder explicit, do not deviate):
//   - Follower joins  → ribbon with "X joined" next to chat.
//   - Subscriber joins → same ribbon with tier-colored glow + soft particle.
//   - Non-follower    → plain "X joined" line at bottom of chat, NO ribbon,
//     UNLESS they have ranked up to Challenger (L31+), which is the reward for
//     ranking up. That gate is enforced SERVER-SIDE in functions/streamJoins.js.
//   - NEVER full-screen. TikTok-sized, not awards-show.
//
// The ribbon is a 4:1 card, measured off the founder's reference sheet. The
// governing rule from that measurement: THE AVATAR RING AND THE USERNAME ARE THE
// SAME HUE, the username slightly brighter with a vertical gradient, the ring at
// the darker stop, "LIVE" in the rank colour, everything else white.
// Analysis: docs/ENTRY_BANNER_ART_SPEC.md. Behaviour: docs/ENTRY_ANNOUNCEMENTS_SPEC.md.
//
// Backgrounds live at /brand/entry/{rankId}.webp (+@2x) and are generated per
// rank (prompts: docs/ENTRY_BANNER_PROMPTS.md). Until they exist, every ribbon
// falls back to a CSS gradient built from the same palette, so no art is
// load-bearing and nothing looks broken while the set is being produced.
//
// Input events: { id, kind: 'follower'|'subscriber'|'stranger', user:{uid,displayName,avatar},
//                 tier?, level?, rankId? }

import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import UserAvatar from '../UserAvatar';
import Icon from '../Icon';
import { spring, prefersReducedMotion } from '../primitives/springs';
import ParticleEmitter from '../primitives/ParticleEmitter';
import { haptic } from '../../utils/haptics';
import * as sfx from '../../utils/sfx';
import {
  getRankBanner, rankBannerById, rankArt, fallbackBackground, nameSizeFor,
  BORDER_SWEEP_LEVEL, SHIMMER_LEVEL,
} from '../../utils/rankBanners';
import UserName from '../UserName';

const DISPLAY_MS = 4200;
// ⚠ NARROWED 2026-08-31 (founder): the ribbon was taking up half the screen and
// reading as unprofessional next to TikTok's. It was min(280, 70vw), which on a
// 375px phone is 262px — 70% of the width. TikTok's entry banner sits closer to
// half, so this is now min(224, 54vw) = 202px on that same phone.
//
// ⚠ THE ART AND THE NAME BOTH FOLLOW THIS AUTOMATICALLY, so nothing else needs
// touching: the banner is object-fit cover at a fixed 4:1, and nameSizeFor()
// MEASURES the string against the width it is given (rankBanners.js) rather than
// scaling by a constant. Shrinking the ribbon therefore cannot truncate a name,
// which is the failure that took three attempts to fix originally.
const MAX_W = 224;          // the founder rule: TikTok-sized, never full-screen
const ASPECT = 4;           // measured 3.97 to 4.34 across all 10 reference samples

/** Ribbon width, matching the historical `min(280px, 70vw)`. */
const ribbonWidth = () => {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 375;
  return Math.min(MAX_W, Math.round(vw * 0.54));
};

export default function JoinAnnouncer({ events = [], side = 'right', maxVisible = 3, sound = true, bottom = 96 }) {
  const [active, setActive] = useState([]);
  const [w, setW] = useState(ribbonWidth);

  useEffect(() => {
    const onResize = () => setW(ribbonWidth());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!events.length) return;
    setActive((prev) => {
      const ids = new Set(prev.map((a) => a.id));
      const fresh = events.filter((e) => !ids.has(e.id)).map((e) => ({
        ...e, expiresAt: Date.now() + DISPLAY_MS,
      }));
      if (!fresh.length) return prev;
      if (sound) {
        for (const f of fresh) {
          const lvl = Number(f.level) || 1;
          if (f.kind === 'subscriber' || lvl >= SHIMMER_LEVEL) { sfx.play('follow', { volume: 0.6 }); haptic.medium(); }
          else { sfx.play('follow', { volume: 0.35 }); haptic.light(); }
        }
      }
      return [...prev, ...fresh].slice(-maxVisible);
    });
  }, [events, sound, maxVisible]);

  useEffect(() => {
    if (active.length === 0) return;
    const t = setInterval(() => {
      setActive((prev) => prev.filter((a) => a.expiresAt > Date.now()));
    }, 250);
    return () => clearInterval(t);
  }, [active.length]);

  if (active.length === 0) return null;
  const fromX = side === 'right' ? 30 : -30;

  return (
    <div style={{
      position: 'absolute',
      [side]: 12,
      bottom,
      display: 'flex', flexDirection: 'column', gap: 8,
      pointerEvents: 'none', zIndex: 7,
      width: w,
    }}>
      <style>{`
        @keyframes vg-join-shine { 0%{transform:translateX(-120%)} 100%{transform:translateX(220%)} }
        @keyframes vg-join-edge  { 0%{background-position:0% 50%} 100%{background-position:200% 50%} }
        @media (prefers-reduced-motion: reduce){
          .vg-join-shine,.vg-join-edge{animation:none!important}
        }
      `}</style>
      <AnimatePresence>
        {active.map((ev) => <JoinRibbon key={ev.id} ev={ev} fromX={fromX} w={w} />)}
      </AnimatePresence>
    </div>
  );
}

function JoinRibbon({ ev, fromX, w }) {
  const [artOk, setArtOk] = useState(true);
  const reduced = prefersReducedMotion();
  const level = Number(ev.level) || 1;
  // Prefer the rank the SERVER stamped; fall back to deriving it from the level.
  const rank = ev.rankId ? rankBannerById(ev.rankId) : getRankBanner(level);

  // The reference sheet is 751px wide per banner; this ribbon is 280. Holding
  // the reference's type proportions at 37% of its canvas truncated every name
  // to two characters and ran the text into the avatar, so the type scale is
  // tuned for the real render size and the text column starts from the avatar's
  // actual right edge rather than a fixed 25%.
  const h = Math.round(w / ASPECT);
  const radius = Math.round(h * 0.20);
  const avatarD = Math.round(h * 0.74);
  const avatarCx = Math.round(w * 0.145);
  const textLeft = Math.round(avatarCx + avatarD / 2 + w * 0.03);
  // Name size scales with length. The step ladder that used to live here was
  // eyeballed and still truncated 9-character handles with space to spare;
  // nameScaleFor() derives the size from the measured width of Syne 800 italic
  // uppercase instead. See the note above it in utils/rankBanners.js.
  const displayName = ev.user?.displayName || ev.user?.username || 'Someone';
  const nameSize = nameSizeFor(displayName, w, h);
  const joinedSize = Math.round(h * 0.18);
  const line2Size = Math.round(h * 0.15);

  const isSub = ev.kind === 'subscriber';
  const sweep = level >= BORDER_SWEEP_LEVEL;
  const shimmer = level >= SHIMMER_LEVEL;
  const art = rankArt(rank.id);

  // The username gradient. Ascendant carries a third stop so it does not read as
  // a second gold next to Challenger (conflict C4 in the art spec).
  const nameGradient = rank.nameMid
    ? `linear-gradient(180deg, ${rank.nameTop} 0%, ${rank.nameMid} 52%, ${rank.nameBottom} 100%)`
    : `linear-gradient(180deg, ${rank.nameTop} 0%, ${rank.nameBottom} 100%)`;

  return (
    <motion.div
      layout
      initial={reduced ? { opacity: 0 } : { opacity: 0, x: fromX, scale: 0.96 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, x: 0, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, x: fromX * 0.6, scale: 0.96 }}
      transition={reduced ? { duration: 0.12 } : spring.bouncy}
      style={{ position: 'relative', width: w, height: h }}
    >
      {/* Halo. Deliberately OUTSIDE the clipped box so it bleeds past the top and
          bottom edges, which is what makes the reference read as lit not printed. */}
      <div aria-hidden style={{
        position: 'absolute', inset: -Math.round(h * 0.16),
        borderRadius: radius + Math.round(h * 0.16),
        background: `radial-gradient(60% 120% at ${Math.round((avatarCx / w) * 100)}% 50%, ${rank.ring}55, transparent 70%)`,
        filter: `blur(${Math.round(h * 0.10)}px)`,
        pointerEvents: 'none',
      }} />

      {/* Clipped art plate */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: radius, overflow: 'hidden',
        background: fallbackBackground(rank),
        boxShadow: `0 6px 22px rgba(0,0,0,0.45), inset 0 0 0 1px ${rank.ring}${sweep ? '00' : '40'}`,
      }}>
        {artOk && (
          <img
            src={art.src} srcSet={art.srcSet} alt="" draggable={false}
            onError={() => setArtOk(false)}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
        {/* Keeps the avatar zone and the text zone readable over any artwork. */}
        <div aria-hidden style={{
          position: 'absolute', inset: 0,
          background: `linear-gradient(90deg, rgba(6,6,10,0.92) 0%, rgba(6,6,10,0.80) 30%, rgba(6,6,10,0.55) 62%, rgba(6,6,10,0.10) 100%)`,
        }} />

        {sweep && (
          <div aria-hidden className="vg-join-edge" style={{
            position: 'absolute', inset: 0, borderRadius: radius,
            padding: 1.5,
            background: `linear-gradient(90deg, ${rank.ring}00, ${rank.nameTop}, ${rank.ring}00, ${rank.nameTop}, ${rank.ring}00)`,
            backgroundSize: '200% 100%',
            WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
            WebkitMaskComposite: 'xor', maskComposite: 'exclude',
            animation: 'vg-join-edge 2.5s linear infinite',
          }} />
        )}
        {shimmer && !reduced && (
          <div aria-hidden className="vg-join-shine" style={{
            position: 'absolute', top: 0, bottom: 0, width: '38%',
            background: 'linear-gradient(100deg, transparent, rgba(255,255,255,0.35), transparent)',
            animation: 'vg-join-shine 0.9s ease-out 0.25s 1 both',
          }} />
        )}
      </div>

      {/* Avatar, ring in the rank colour. Same hue as the username, by rule. */}
      <div style={{
        position: 'absolute', left: avatarCx - avatarD / 2, top: (h - avatarD) / 2,
        width: avatarD, height: avatarD, borderRadius: '50%',
        boxShadow: `0 0 0 2px ${rank.ring}, 0 0 ${Math.round(h * 0.22)}px ${rank.ring}AA`,
      }}>
        <div style={{ width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden' }}>
          <UserAvatar src={ev.user?.avatar} alt="" size={avatarD} />
        </div>
        {isSub && (
          <span style={{
            position: 'absolute', bottom: -1, right: -1,
            width: Math.round(avatarD * 0.32), height: Math.round(avatarD * 0.32),
            borderRadius: '50%', background: rank.ring, border: '2px solid rgba(8,8,14,0.9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0B0B14',
          }}>
            <Icon name={ev.tier === 'pro' ? 'workspace_premium' : 'star'} size={Math.round(avatarD * 0.19)} />
          </span>
        )}
      </div>

      {/* Text block */}
      <div style={{
        position: 'absolute', left: textLeft, right: Math.round(w * 0.04),
        top: '50%', transform: 'translateY(-50%)',
        display: 'flex', flexDirection: 'column', gap: Math.round(h * 0.07),
        minWidth: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: Math.round(w * 0.02), minWidth: 0 }}>
          <span style={{
            fontFamily: 'Syne, sans-serif', fontWeight: 800, fontStyle: 'italic',
            fontSize: nameSize, lineHeight: 1, letterSpacing: '-0.01em',
            textTransform: 'uppercase',
            backgroundImage: nameGradient,
            WebkitBackgroundClip: 'text', backgroundClip: 'text',
            WebkitTextFillColor: 'transparent', color: 'transparent',
            filter: `drop-shadow(0 1px 2px rgba(0,0,0,0.85)) drop-shadow(0 0 ${Math.round(h * 0.10)}px ${rank.ring}66)`,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            // Shrink to fit rather than reserving a fixed slice: a hard maxWidth
            // truncated even short names to two characters.
            flex: '0 1 auto', minWidth: 0,
          }}>
            <UserName user={ev.user} masked fallback={displayName} />
          </span>
          <span style={{
            fontFamily: 'Syne, sans-serif', fontWeight: 700, fontStyle: 'italic',
            fontSize: joinedSize, lineHeight: 1, color: '#fff',
            textShadow: '0 1px 3px rgba(0,0,0,0.9)', whiteSpace: 'nowrap',
            flex: '0 0 auto',
          }}>joined</span>
        </div>
        <div style={{
          fontFamily: 'Syne, sans-serif', fontWeight: 700, fontStyle: 'italic',
          fontSize: line2Size, lineHeight: 1, color: '#fff', whiteSpace: 'nowrap',
          textShadow: '0 1px 3px rgba(0,0,0,0.9)',
        }}>
          to watch the <span style={{ color: rank.ring }}>LIVE</span>
        </div>
      </div>

      {isSub && <ParticleEmitter trigger={ev.id} color={rank.ring} shape="star" count={6} />}
    </motion.div>
  );
}
