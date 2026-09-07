// LiveInviteBanner — real-time, in-app surfacing for time-sensitive invites
// that need an inline Accept / Decline (currently: co_stream_invite).
//
// Pattern (matches TikTok / Twitch Guest Star):
//   - Mobile: full-width banner from the top, drops over whatever the user is
//     looking at (including a fullscreen broadcast they're currently running).
//   - Desktop: bottom-right toast card.
//   - z-index above broadcaster fullscreen (which uses z-index 95).
//
// Wired into the existing notifications stream from NotificationProvider —
// no extra Firestore reads.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useNotifications } from '../context/NotificationContext';
import { useUI } from '../context/UIContext';
import useResponsive from '../hooks/useResponsive';
import { markNotificationRead } from '../firebase/firestore';
import UserAvatar from './UserAvatar';
import Icon from './Icon';

// Notification types we want to surface as an inline banner (not just bell badge).
const ACTIONABLE_TYPES = new Set(['co_stream_invite']);

const C = {
  card: '#12121e',
  border: 'rgba(255,255,255,0.12)',
  text: '#e8e8f0',
  textDim: '#a0a0b8',
  purple: '#7c3aed',
  purpleLight: '#b44fff',
  green: '#22c55e',
  red: '#ef4444',
};

export default function LiveInviteBanner() {
  const { notifications } = useNotifications();
  const navigate = useNavigate();
  const { showToast } = useUI();
  const { isDesktop } = useResponsive();
  const [dismissed, setDismissed] = useState(new Set());
  const [working, setWorking] = useState(null);

  // Pick the newest unread actionable notification.
  const live = useMemo(() => {
    if (!notifications?.length) return null;
    return notifications.find(
      (n) => !n.read && ACTIONABLE_TYPES.has(n.type) && !dismissed.has(n.id),
    ) || null;
  }, [notifications, dismissed]);

  // Auto-clean dismissed set when underlying notif gets read elsewhere.
  useEffect(() => {
    if (!notifications?.length) return;
    setDismissed((prev) => {
      const next = new Set();
      const ids = new Set(notifications.map((n) => n.id));
      for (const id of prev) if (ids.has(id)) next.add(id);
      return next;
    });
  }, [notifications]);

  if (!live) return null;

  const inviteId = live.data?.inviteId;
  const isCoStreamInvite = live.type === 'co_stream_invite';

  // TikTok Multi-Guest model: invitee must be live with their own stream.
  // Accept just records the link on both stream docs. Both streamers keep
  // their own ingest, HLS, and viewerCount. Nothing about the invitee's
  // own broadcast changes — they stay on their own /broadcast page.
  const accept = async () => {
    if (working) return;
    setWorking('accept');
    try {
      if (isCoStreamInvite) {
        const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'acceptCoHostInvite');
        await fn({ inviteId });
        await markNotificationRead(live.id).catch(() => {});
        showToast('Linked — viewers on both sides now see both streams.', 'success');
      }
    } catch (err) {
      showToast(err?.message || 'Could not accept', 'error');
    } finally {
      setWorking(null);
    }
  };

  const decline = async () => {
    if (working) return;
    setWorking('decline');
    try {
      if (isCoStreamInvite) {
        const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'declineCoHostInvite');
        await fn({ inviteId });
      }
      await markNotificationRead(live.id).catch(() => {});
    } catch (err) {
      showToast(err?.message || 'Could not decline', 'error');
    } finally {
      setWorking(null);
    }
  };

  const dismiss = () => {
    setDismissed((prev) => new Set([...prev, live.id]));
  };

  const open = () => {
    if (live.actionUrl) navigate(live.actionUrl);
    setDismissed((prev) => new Set([...prev, live.id]));
  };

  // ── Mobile: top banner (TikTok-style) ──
  if (!isDesktop) {
    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9998,
        padding: '10px 12px',
        background: `linear-gradient(180deg, rgba(124,58,237,0.95), rgba(180,79,255,0.9))`,
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        fontFamily: '"DM Sans", system-ui, sans-serif', color: '#fff',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="group_add" size={18} className="" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {live.title}
            </div>
            {live.body && (
              <div style={{ fontSize: 11, opacity: 0.9, whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {live.body}
              </div>
            )}
          </div>
          <button onClick={decline} disabled={!!working} style={mobileBtnGhost}>
            {working === 'decline' ? '…' : 'Decline'}
          </button>
          <button onClick={accept} disabled={!!working} style={mobileBtnAccept}>
            {working === 'accept' ? 'Joining…' : 'Accept'}
          </button>
          <button onClick={dismiss} style={mobileBtnClose} aria-label="Dismiss">
            <Icon name="close" size={14} className="" />
          </button>
        </div>
      </div>
    );
  }

  // ── Desktop: bottom-right toast card ──
  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 20, zIndex: 9998,
      width: 340, background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 14, padding: 14, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      fontFamily: '"DM Sans", system-ui, sans-serif', color: C.text,
      animation: 'vergr-banner-in 0.25s ease-out',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Icon name="group_add" size={18} className="" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 2 }}>{live.title}</div>
          {live.body && <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.4 }}>{live.body}</div>}
        </div>
        <button onClick={dismiss} style={{
          background: 'transparent', border: 'none', color: C.textDim,
          cursor: 'pointer', padding: 2,
        }} aria-label="Dismiss">
          <Icon name="close" size={14} className="" />
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={decline} disabled={!!working} style={btnGhost}>
          {working === 'decline' ? 'Declining…' : 'Decline'}
        </button>
        <button onClick={() => accept()} disabled={!!working} style={btnPrimary}>
          {working === 'accept' ? 'Joining…' : 'Accept'}
        </button>
      </div>
    </div>
  );
}

const btnGhost = {
  flex: 1, padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.border}`,
  background: 'transparent', color: C.textDim, fontSize: 12, fontWeight: 700,
  cursor: 'pointer',
};
const btnPrimary = {
  flex: 1, padding: '8px 12px', borderRadius: 8, border: 'none',
  background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`,
  color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer',
};
const mobileBtnGhost = {
  padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.4)',
  background: 'transparent', color: '#fff', fontSize: 11, fontWeight: 700,
  cursor: 'pointer',
};
const mobileBtnAccept = {
  padding: '6px 12px', borderRadius: 6, border: 'none',
  background: '#fff', color: C.purple, fontSize: 11, fontWeight: 800, cursor: 'pointer',
};
const mobileBtnClose = {
  width: 24, height: 24, borderRadius: 12, border: 'none',
  background: 'rgba(0,0,0,0.25)', color: '#fff',
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
};
