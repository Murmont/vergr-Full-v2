// TournamentSummonsBanner — real-time, in-app surfacing for "your tournament
// starts in N minutes" pushes. Sibling to LiveInviteBanner.
//
// Mobile: full-width banner from the top, drops over fullscreen content.
// Desktop: bottom-right toast card.
//
// Surfaces ONE notification at a time (the most urgent unread tournament_
// summons). Tap → opens the pre-flight modal with the checklist.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useNotifications } from '../context/NotificationContext';
import { useUI } from '../context/UIContext';
import useResponsive from '../hooks/useResponsive';
import { markNotificationRead } from '../firebase/firestore';
import Icon from './Icon';
import TournamentPreflightModal from './TournamentPreflightModal';
import { spring } from './primitives/springs';
import { haptic } from '../utils/haptics';

const ACTIONABLE_TYPE = 'tournament_summons';

const C = {
  bg: '#12121e',
  border: 'rgba(255,255,255,0.12)',
  text: '#fff',
  textDim: 'rgba(255,255,255,0.65)',
  gold: '#F0A500',
  goldLight: '#F5C842',
  red: '#ef4444',
};

export default function TournamentSummonsBanner() {
  const { notifications } = useNotifications();
  const navigate = useNavigate();
  const { showToast } = useUI();
  const { isDesktop } = useResponsive();
  const [dismissed, setDismissed] = useState(new Set());
  const [modalOpen, setModalOpen] = useState(null);

  // Newest unread summons notification, not yet dismissed.
  const live = useMemo(() => {
    if (!notifications?.length) return null;
    return notifications.find(
      (n) => !n.read && n.type === ACTIONABLE_TYPE && !dismissed.has(n.id),
    ) || null;
  }, [notifications, dismissed]);

  // Live countdown to scheduledStart.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [live]);

  useEffect(() => {
    if (live) haptic.alert();
  }, [live?.id]);

  if (!live && !modalOpen) return null;

  const tournamentId = live?.data?.tournamentId;
  const scheduledStartMs = live?.data?.scheduledStartMs || 0;
  const remainingMs = Math.max(0, scheduledStartMs - Date.now());
  const remainingLabel = remainingMs < 1000
    ? 'starting now'
    : remainingMs < 60_000
      ? `${Math.ceil(remainingMs / 1000)}s`
      : `${Math.ceil(remainingMs / 60_000)}m`;

  const openPreflight = () => {
    setModalOpen({ tournamentId, notificationId: live?.id });
  };

  const dismiss = () => {
    if (live) setDismissed((s) => new Set([...s, live.id]));
  };

  const inner = !live ? null : (
    <>
      {isDesktop ? (
        // Desktop: bottom-right toast card.
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10 }}
          transition={spring.bouncy}
          style={{
            position: 'fixed', right: 20, bottom: 20, zIndex: 9997,
            width: 340, padding: 14, borderRadius: 14,
            background: C.bg, border: `1px solid ${C.gold}55`,
            boxShadow: `0 10px 30px rgba(0,0,0,0.5), 0 0 0 1px ${C.gold}22`,
            color: C.text, fontFamily: '"Inter", system-ui, sans-serif',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, flexShrink: 0,
              background: `linear-gradient(135deg, ${C.gold}, ${C.goldLight})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="emoji_events" size={18} className="" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 2 }}>
                {live.title}
              </div>
              <div style={{
                fontSize: 11, color: C.textDim, fontFamily: 'DM Mono, ui-monospace, monospace',
              }}>
                ⏱ {remainingLabel}
              </div>
            </div>
            <button onClick={dismiss} style={{
              background: 'transparent', border: 'none', color: C.textDim,
              cursor: 'pointer', padding: 2,
            }} aria-label="Dismiss">
              <Icon name="close" size={14} className="" />
            </button>
          </div>
          <button onClick={openPreflight} style={ctaPrimary}>
            Check in + run pre-flight
          </button>
        </motion.div>
      ) : (
        // Mobile: top banner.
        <motion.div
          initial={{ y: -80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -80, opacity: 0 }}
          transition={spring.bouncy}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9997,
            padding: '10px 12px',
            background: `linear-gradient(180deg, ${C.gold}, ${C.goldLight})`,
            color: '#000',
            boxShadow: '0 6px 22px rgba(0,0,0,0.45)',
            fontFamily: '"Inter", system-ui, sans-serif',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="emoji_events" size={20} className="" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 900, whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis' }}>{live.title}</div>
              <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.85,
                fontFamily: 'DM Mono, ui-monospace, monospace' }}>
                ⏱ {remainingLabel}
              </div>
            </div>
            <button onClick={dismiss} style={mobileBtnGhost} aria-label="Dismiss">
              <Icon name="close" size={14} className="" />
            </button>
            <button onClick={openPreflight} style={mobileBtnPrimary}>
              I'm here
            </button>
          </div>
        </motion.div>
      )}
    </>
  );

  return (
    <>
      <AnimatePresence>{inner}</AnimatePresence>
      {modalOpen && (
        <TournamentPreflightModal
          tournamentId={modalOpen.tournamentId}
          onClose={async () => {
            // Mark the notification read on dismiss so it doesn't re-trigger.
            if (modalOpen.notificationId) {
              await markNotificationRead(modalOpen.notificationId).catch(() => {});
              setDismissed((s) => new Set([...s, modalOpen.notificationId]));
            }
            setModalOpen(null);
          }}
          onLaunchMatch={(matchPath) => {
            setModalOpen(null);
            navigate(matchPath);
          }}
        />
      )}
    </>
  );
}

const ctaPrimary = {
  width: '100%', padding: '10px 14px', borderRadius: 8, border: 'none',
  background: `linear-gradient(135deg, ${C.gold}, ${C.goldLight})`,
  color: '#000', fontSize: 13, fontWeight: 800, cursor: 'pointer',
};
const mobileBtnGhost = {
  width: 26, height: 26, borderRadius: '50%', border: 'none',
  background: 'rgba(0,0,0,0.2)', color: '#000',
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
};
const mobileBtnPrimary = {
  padding: '6px 12px', borderRadius: 6, border: 'none',
  background: '#000', color: C.gold, fontSize: 11, fontWeight: 900, cursor: 'pointer',
};
