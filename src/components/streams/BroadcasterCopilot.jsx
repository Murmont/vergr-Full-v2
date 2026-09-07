// BroadcasterCopilot — small AI-coach card that surfaces contextual nudges to
// the host. Reads existing stream signals (viewer count, time since last tip,
// time since last chat message, recent followers) and applies cheap heuristics
// to suggest actions. NO calls to Gemini for v1 — the heuristics are free.
//
// Example nudges:
//   - "5 viewers and counting — say hi to @newFollower"
//   - "No chat for 4 minutes — try a poll"
//   - "@Nova just tipped 500 — call them out"
//   - "Connection dropped, wave at the audience while it recovers"

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Icon from '../Icon';
import { spring } from '../primitives/springs';

const C = {
  bg: 'rgba(18,18,30,0.92)',
  border: 'rgba(124,58,237,0.45)',
  text: '#fff',
  textDim: 'rgba(255,255,255,0.65)',
  purple: '#7c3aed',
  purpleLight: '#b44fff',
  amber: '#F0A500',
};

export default function BroadcasterCopilot({
  isLive,
  viewerCount = 0,
  lastTipAt = null,           // ms timestamp
  lastChatAt = null,          // ms timestamp
  recentTipper = null,        // { name, coins }
  recentFollower = null,      // { name }
  durationSeconds = 0,
}) {
  const [visible, setVisible] = useState(true);
  const [dismissedIds, setDismissedIds] = useState(new Set());

  // Pick the highest-priority nudge that hasn't been dismissed.
  const nudge = useMemo(() => {
    if (!isLive) return null;
    const now = Date.now();
    const candidates = [];

    if (recentTipper && lastTipAt && (now - lastTipAt) < 12_000) {
      candidates.push({
        id: `tip-${lastTipAt}`,
        priority: 10,
        icon: 'paid',
        accent: C.amber,
        title: `${recentTipper.name} tipped ${recentTipper.coins}c`,
        body: 'Call them out by name — viewers love the acknowledgement.',
      });
    }

    if (recentFollower && (now - (recentFollower.ts || now)) < 8_000) {
      candidates.push({
        id: `follow-${recentFollower.ts || recentFollower.name}`,
        priority: 7,
        icon: 'person_add',
        accent: C.purpleLight,
        title: `${recentFollower.name} just followed`,
        body: 'A quick "thanks for the follow" goes a long way.',
      });
    }

    // Quiet chat ≥ 4 minutes and we've been live ≥ 2 minutes.
    if (lastChatAt && durationSeconds > 120 && (now - lastChatAt) > 240_000) {
      candidates.push({
        id: 'quiet-chat',
        priority: 5,
        icon: 'forum',
        accent: C.purple,
        title: 'Chat\'s gone quiet',
        body: 'Try a poll or ask a question to get them talking.',
      });
    }

    // First 60s of stream and viewers > 0 — welcome them.
    if (durationSeconds < 60 && viewerCount > 0) {
      candidates.push({
        id: 'welcome',
        priority: 4,
        icon: 'waving_hand',
        accent: C.purpleLight,
        title: `${viewerCount} watching already`,
        body: 'Welcome them — say what tonight\'s stream is about.',
      });
    }

    candidates.sort((a, b) => b.priority - a.priority);
    return candidates.find((c) => !dismissedIds.has(c.id)) || null;
  }, [isLive, viewerCount, lastTipAt, lastChatAt, recentTipper, recentFollower, durationSeconds, dismissedIds]);

  // Auto-clear stale dismissed entries when the nudge identity rotates.
  useEffect(() => {
    if (!nudge) return;
    const t = setTimeout(() => {
      setDismissedIds((s) => new Set([...s, nudge.id]));
    }, 18_000);
    return () => clearTimeout(t);
  }, [nudge?.id]);

  if (!visible) return null;

  return (
    <AnimatePresence>
      {nudge && (
        <motion.div
          key={nudge.id}
          initial={{ opacity: 0, y: 18, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8 }}
          transition={spring.bouncy}
          style={{
            position: 'fixed',
            left: 20, bottom: 24,
            width: 'min(340px, 88vw)',
            padding: 14,
            background: C.bg,
            border: `1px solid ${nudge.accent || C.border}`,
            borderRadius: 14,
            boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
            color: C.text,
            fontFamily: '"DM Sans", system-ui, sans-serif',
            zIndex: 80,
            backdropFilter: 'blur(8px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 10, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: (nudge.accent || C.purple) + '22',
              color: nudge.accent || C.purpleLight,
            }}>
              <Icon name={nudge.icon} size={18} className="" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 2 }}>{nudge.title}</div>
              <div style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.4 }}>{nudge.body}</div>
            </div>
            <button
              onClick={() => setDismissedIds((s) => new Set([...s, nudge.id]))}
              aria-label="Dismiss"
              style={{
                background: 'transparent', border: 'none', color: C.textDim,
                cursor: 'pointer', padding: 2,
              }}
            >
              <Icon name="close" size={14} className="" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
