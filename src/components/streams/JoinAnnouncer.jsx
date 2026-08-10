// JoinAnnouncer — right-sized entry animations for stream viewers.
//
// UX RULES (founder explicit, do not deviate):
//   - Follower joins  → small avatar card slides in next to chat with "X joined".
//   - Subscriber joins → same card with tier-colored glow + soft particle.
//   - Non-follower    → plain "X joined" line at bottom of chat. NO card.
//   - NEVER full-screen. TikTok-sized, not awards-show.
//
// This component renders the avatar-card variants (follower / subscriber).
// Plain-user "joined" lines are emitted as system chat messages by the
// chat relay (Phase 7) — they show up in the chat scroll, not here.
//
// Input: an event queue of { id, kind: 'follower'|'subscriber', user: {uid, displayName, avatar}, tier?, ts }.
// Up to 3 cards stack vertically at any time; older ones fade out as new ones arrive.

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import UserAvatar from '../UserAvatar';
import Icon from '../Icon';
import { spring, prefersReducedMotion } from '../primitives/springs';
import ParticleEmitter from '../primitives/ParticleEmitter';
import { haptic } from '../../utils/haptics';
import * as sfx from '../../utils/sfx';

const C = {
  bg: 'rgba(18, 18, 30, 0.92)',
  border: 'rgba(255,255,255,0.10)',
  text: '#fff',
  textDim: 'rgba(255,255,255,0.65)',
  follower: '#3D7FFF',
  liteSub: '#7c3aed',
  proSub:  '#F0A500',
};

const TIER_ACCENT = {
  lite: C.liteSub,
  pro:  C.proSub,
};

const DISPLAY_MS = 4200;

/**
 * @param {Object} props
 * @param {Array}  props.events          — queue of join events; this component renders the active ones
 * @param {('left'|'right')} [props.side='right']  — which edge to slide in from
 * @param {number} [props.maxVisible=3]
 * @param {boolean}[props.sound=true]    — play subtle SFX on follower/subscriber arrival
 */
export default function JoinAnnouncer({ events = [], side = 'right', maxVisible = 3, sound = true, bottom = 96 }) {
  const [active, setActive] = useState([]); // [{ id, ...event, expiresAt }]

  // Push new events onto the visible stack with an expiry.
  useEffect(() => {
    if (!events.length) return;
    setActive((prev) => {
      const ids = new Set(prev.map((a) => a.id));
      const fresh = events.filter((e) => !ids.has(e.id)).map((e) => ({
        ...e, expiresAt: Date.now() + DISPLAY_MS,
      }));
      if (!fresh.length) return prev;
      // Play SFX + haptic per fresh card (subscriber gets stronger).
      if (sound) {
        for (const f of fresh) {
          if (f.kind === 'subscriber') { sfx.play('follow', { volume: 0.6 }); haptic.medium(); }
          else                          { sfx.play('follow', { volume: 0.35 }); haptic.light(); }
        }
      }
      const combined = [...prev, ...fresh];
      // Cap visible count: drop oldest.
      return combined.slice(-maxVisible);
    });
  }, [events, sound, maxVisible]);

  // Sweep expired entries.
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
      bottom, // sits above the bottom chat input dock (caller-tunable)
      display: 'flex', flexDirection: 'column', gap: 6,
      pointerEvents: 'none', zIndex: 7,
      width: 'min(280px, 70vw)',
    }}>
      <AnimatePresence>
        {active.map((ev) => (
          <JoinCard key={ev.id} ev={ev} fromX={fromX} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function JoinCard({ ev, fromX }) {
  const isSub = ev.kind === 'subscriber';
  const accent = isSub ? (TIER_ACCENT[ev.tier] || C.proSub) : C.follower;
  const reduced = prefersReducedMotion();
  return (
    <motion.div
      layout
      initial={reduced ? { opacity: 0 } : { opacity: 0, x: fromX, scale: 0.96 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, x: 0, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, x: fromX * 0.6, scale: 0.96 }}
      transition={reduced ? { duration: 0.12 } : spring.bouncy}
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 12px 7px 7px',
        background: C.bg,
        border: `1px solid ${isSub ? accent : C.border}`,
        borderRadius: 99,
        boxShadow: isSub
          ? `0 0 0 1px ${accent}33, 0 6px 24px ${accent}33`
          : '0 4px 16px rgba(0,0,0,0.35)',
        color: C.text,
        backdropFilter: 'blur(8px)',
      }}
    >
      <div style={{ position: 'relative' }}>
        <UserAvatar src={ev.user?.avatar} size="sm" />
        {isSub && (
          <span style={{
            position: 'absolute', bottom: -3, right: -3,
            width: 14, height: 14, borderRadius: '50%',
            background: accent, border: '2px solid ' + C.bg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name={ev.tier === 'pro' ? 'workspace_premium' : 'star'} size={9}
              className="" />
          </span>
        )}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontSize: 12, fontWeight: 800,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {ev.user?.displayName || ev.user?.username || 'Someone'}
        </div>
        <div style={{ fontSize: 10, color: C.textDim, fontWeight: 600 }}>
          {isSub
            ? `${(ev.tier || 'sub').toUpperCase()} subscriber · joined`
            : 'follower · joined'}
        </div>
      </div>
      {isSub && (
        <ParticleEmitter
          trigger={ev.id}
          color={accent}
          shape="star"
          count={6}
        />
      )}
    </motion.div>
  );
}
