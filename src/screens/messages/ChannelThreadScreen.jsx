// ChannelThreadScreen — /messages/c/:channelId
//
// The thread behind an official Vergr channel row in the message list.
//
// Unlike a real chat, the messages come from Firestore rather than the relay:
// one shared subcollection serves every user (see docs/ANNOUNCEMENTS_PLAN.md
// section 2.1). Nothing here is per-user except the read/mute/clear state, which
// lives in channel_state/{uid}.
//
// Founder decision D1 governs the menu: a user may Mute, Clear chat or Delete
// chat. There is deliberately NO unsubscribe, and Delete is not one: the row
// comes back on the next message.

import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth } from '../../firebase/config';
import { useUI } from '../../context/UIContext';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';
import { timeAgo } from '../../utils/helpers';
import { MUTE_OPTIONS } from '../../utils/chatOps';
import { ListSkeleton } from '../../components/skeletons/GlassSkeletons';
import {
  getChannel, subscribeChannelMessages, subscribeChannelState,
  setChannelMuted, clearChannel, deleteChannelChat, markChannelRead,
} from '../../firebase/officialChannels';

export default function ChannelThreadScreen() {
  const { channelId } = useParams();
  const navigate = useNavigate();
  const { showToast } = useUI();
  const me = auth.currentUser?.uid;

  const [channel, setChannel] = useState(null);
  const [messages, setMessages] = useState(null);
  const [state, setState] = useState({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [muteOpen, setMuteOpen] = useState(false);
  const bottomRef = useRef(null);

  const myState = state[channelId] || {};
  const clearedAt = Number(myState.clearedAt) || 0;
  const muted = myState.mutedUntil === true
    || (typeof myState.mutedUntil === 'number' && myState.mutedUntil > Date.now());

  useEffect(() => { getChannel(channelId).then(setChannel); }, [channelId]);
  useEffect(() => (me ? subscribeChannelState(me, setState) : undefined), [me]);

  // clearedAt is passed INTO the subscription so cleared history can never be
  // resurrected by a cache read. Same rule as reference-cleared-chat-watermark.
  useEffect(
    () => subscribeChannelMessages(channelId, clearedAt, setMessages),
    [channelId, clearedAt],
  );

  // Mark read once the thread is open and we know what the newest message is.
  useEffect(() => {
    if (!me || !messages?.length) return;
    const newest = messages[messages.length - 1];
    markChannelRead(me, channelId, newest.createdAtMs || Date.now(), newest.id).catch(() => {});
  }, [me, channelId, messages?.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages?.length]);

  const oneWay = channel?.oneWay !== false;
  const accent = channel?.accentColor || '#7B1FFF';

  const doMute = async (value) => {
    setMuteOpen(false); setMenuOpen(false);
    try {
      await setChannelMuted(me, channelId, value);
      showToast(value ? 'Channel muted' : 'Channel unmuted', 'success');
    } catch { showToast('Could not update mute', 'error'); }
  };

  const doClear = async () => {
    setMenuOpen(false);
    if (!window.confirm('Clear this chat? The messages are hidden for you only.')) return;
    try {
      await clearChannel(me, channelId);
      showToast('Chat cleared', 'success');
    } catch { showToast('Could not clear chat', 'error'); }
  };

  const doDelete = async () => {
    setMenuOpen(false);
    // Say plainly what delete does. It is not an unsubscribe and pretending
    // otherwise would be the one genuinely misleading thing in this screen.
    if (!window.confirm(
      'Delete this chat?\n\nIt disappears from your messages, and comes back when '
      + 'Vergr next posts here. Official channels cannot be unsubscribed from.',
    )) return;
    try {
      await deleteChannelChat(me, channelId);
      showToast('Chat deleted', 'success');
      navigate('/messages');
    } catch { showToast('Could not delete chat', 'error'); }
  };

  const grouped = useMemo(() => messages || [], [messages]);

  return (
    <div className="flex flex-col h-full bg-bg-dark">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] shrink-0"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)' }}
      >
        <button onClick={() => navigate('/messages')} className="text-text-secondary hover:text-text-primary" aria-label="Back">
          <Icon name="arrow_back" size={22} />
        </button>
        {/* `flex` on the wrapper and `z-20` on the pip are both required:
            UserAvatar's root is inline-flex (a block wrapper adds a descender gap
            that drops the pip below the circle) and its img is `relative z-10`,
            which paints over any overlay left at z-auto. Both symptoms look
            identical, so fixing one leaves the bug apparently unchanged.
            See reference-avatar-overlay-zindex. */}
        <div className="relative shrink-0 flex">
          <UserAvatar src={channel?.avatarUrl} size={38} />
          <div
            className="absolute bottom-0 right-0 z-20 w-4 h-4 rounded-full flex items-center justify-center border-2 border-bg-dark"
            style={{ background: accent }}
          >
            <Icon name="verified" size={9} className="text-white" />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-text-primary text-[15px] truncate">
            {channel?.name || 'Vergr'}
          </div>
          <div className="text-[11px] text-text-muted truncate">
            {muted ? 'Muted' : (channel?.handle ? `@${channel.handle}` : 'Official channel')}
          </div>
        </div>
        <button onClick={() => setMenuOpen(o => !o)} className="text-text-secondary hover:text-text-primary" aria-label="Channel options">
          <Icon name="more_vert" size={20} />
        </button>
      </div>

      {/* Options menu */}
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setMenuOpen(false); setMuteOpen(false); }} />
          <div className="absolute right-3 top-16 z-50 w-56 rounded-xl bg-surface-1 border border-white/10 shadow-xl overflow-hidden">
            {!muted ? (
              <>
                <MenuItem icon="notifications_off" label="Mute" onClick={() => setMuteOpen(o => !o)} />
                {muteOpen && MUTE_OPTIONS.map(o => (
                  <MenuItem key={o.label} icon="schedule" label={o.label} indent onClick={() => doMute(o.value())} />
                ))}
              </>
            ) : (
              <MenuItem icon="notifications_active" label="Unmute" onClick={() => doMute(null)} />
            )}
            <MenuItem icon="cleaning_services" label="Clear chat" onClick={doClear} />
            <MenuItem icon="delete_outline" label="Delete chat" danger onClick={doDelete} />
          </div>
        </>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages === null && <ListSkeleton rows={4} />}
        {messages !== null && grouped.length === 0 && (
          <div className="text-center text-text-muted text-sm py-12">
            Nothing here yet. Vergr posts updates to this channel.
          </div>
        )}
        {grouped.map(m => (
          <ChannelMessage key={m.id} m={m} accent={accent} navigate={navigate} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Composer, or the one-way notice */}
      {oneWay ? (
        <div
          className="shrink-0 px-4 py-3 border-t border-white/[0.06] text-center text-[12px] text-text-muted"
          style={{ paddingBottom: 'max(var(--vg-safe-b, 0px), 12px)' }}
        >
          <Icon name="lock" size={13} className="align-[-2px] mr-1" />
          You cannot reply to this channel
        </div>
      ) : (
        <div
          className="shrink-0 px-4 py-3 border-t border-white/[0.06] text-center text-[12px] text-text-muted"
          style={{ paddingBottom: 'max(var(--vg-safe-b, 0px), 12px)' }}
        >
          Support replies are coming in the next update.
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger, indent }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left text-sm hover:bg-white/5 ${
        danger ? 'text-brand-ember' : 'text-text-primary'
      } ${indent ? 'pl-10 text-text-secondary' : ''}`}
    >
      <Icon name={icon} size={17} />
      {label}
    </button>
  );
}

function ChannelMessage({ m, accent, navigate }) {
  const go = (url) => {
    if (!url) return;
    if (url.startsWith('/')) navigate(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="mb-4 max-w-[92%]">
      <div
        className="rounded-2xl rounded-tl-md overflow-hidden border border-white/[0.07]"
        style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.02))' }}
      >
        {m.imageUrl && (
          <img src={m.imageUrl} alt="" className="w-full max-h-80 object-cover" loading="lazy" />
        )}
        {m.videoUrl && (
          <video
            src={m.videoUrl}
            poster={m.videoPosterUrl || undefined}
            controls
            playsInline
            preload="metadata"
            className="w-full max-h-80 bg-black"
          />
        )}
        {m.body && (
          <div className="px-4 pt-3 pb-1 text-[14.5px] leading-relaxed text-text-primary whitespace-pre-wrap break-words">
            {m.body}
          </div>
        )}
        {m.ctaLabel && m.ctaUrl && (
          <div className="px-4 pb-3 pt-2">
            <button
              onClick={() => go(m.ctaUrl)}
              className="px-4 py-2 rounded-lg text-[13px] font-bold text-white"
              style={{ background: accent }}
            >
              {m.ctaLabel}
            </button>
          </div>
        )}
        <div className="px-4 pb-2.5 pt-1 text-[11px] text-text-muted">
          {m.createdAtMs ? timeAgo(m.createdAtMs) : ''}
        </div>
      </div>
    </div>
  );
}
