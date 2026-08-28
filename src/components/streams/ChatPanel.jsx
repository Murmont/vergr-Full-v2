// ChatPanel — live-stream chat UI driven by the vergr-chat WS relay.
//
// Server moderates every message before fan-out (per founder mandate). On
// 'block' we show an inline error to the sender; on 'flag' the message is
// fanned out with a flagged tag so viewers can see it but Vanguards can
// review. Ephemeral by default — Firestore is NEVER used for the firehose.
//
// Spatial rendering: tier-colored bubbles, vanguard rank badge, tip messages
// styled by amount tier, fade-in entry, soft auto-scroll lock.

import { useEffect, useMemo, useRef, useState } from 'react';
import UserName from '../UserName';
import { motion, AnimatePresence } from 'framer-motion';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { connectChat } from '../../utils/chatRelay';
import { createTtsQueue, armStreamTts, canUseStreamTts, TTS_MAX_CHARS } from '../../utils/streamTts';
import { UID_ATTR } from '../../utils/goldenThread';
import { isUnlocked } from '../../utils/rankUnlocks';
import UserAvatar from '../UserAvatar';
import Icon from '../Icon';
import BadgeGem from '../membership/BadgeGem';
import RankBadge from '../RankBadge';
import RankCrestPopover from '../RankCrestPopover';
import { chatNameColor } from '../../utils/rankUnlocks';
import TranslationSheet from '../TranslationSheet';
import { isTauri } from '../../utils/platform';
import { spring } from '../primitives/springs';
import UserQuickSheet from './UserQuickSheet';
import { haptic } from '../../utils/haptics';
import modBadgeIcon from '../../assets/stream/mod-badge.webp';
import watchingIcon from '../../assets/stream/watching.webp';

const C = {
  bg: '#0f0f1a',
  bgRow: 'rgba(255,255,255,0.02)',
  border: 'rgba(255,255,255,0.08)',
  text: '#fff',
  textDim: 'rgba(255,255,255,0.65)',
  textMuted: 'rgba(255,255,255,0.4)',
  purple: '#7c3aed',
  purpleLight: '#b44fff',
  amber: '#F0A500',
  red: '#ef4444',
};

const RANK_COLORS = {
  recruit:   '#8c8ca0',
  vanguard:  '#3D7FFF',
  senior:    '#7c3aed',
  commander: '#b44fff',
  overseer:  '#F0A500',
};

const MAX_VISIBLE = 80;

// Readable per-user name colours (Twitch-style), picked deterministically from
// the uid so a given chatter always renders the same colour. Only used for
// non-self, non-ranked names on the desktop side panel.
const NAME_COLORS = ['#FF7AA2', '#7CE3FF', '#9D7CFF', '#7CFF9D', '#FFC857', '#FF9D7C', '#7C9DFF', '#FF7CE3', '#5FE0C0', '#E0A0FF'];
function nameColor(key) {
  if (!key) return '#fff';
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length];
}
function fmtClock(ts) {
  const d = new Date(typeof ts === 'number' ? ts : Date.now());
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Module-level history cache: the relay has no replay for stream chat, so if
// a layout toggle (fullscreen chat, sheet, mobile↔desktop) unmounts ChatPanel
// the messages would be gone forever. Survive remounts by mirroring the
// visible window per stream. Cleared when a different stream is opened.
const chatHistoryCache = new Map(); // streamId → messages[]
function cacheHistory(streamId, msgs) {
  if (!streamId) return;
  if (chatHistoryCache.size > 4) {
    for (const k of chatHistoryCache.keys()) { if (k !== streamId) chatHistoryCache.delete(k); }
  }
  chatHistoryCache.set(streamId, msgs);
}

const EMOTES = [
  '😂', '😅', '🔥', '💀', '😭', '👏', '🙌', '💪',
  '❤️', '🎉', '😮', '😡', '👀', '🤝', '🧠', '🚀',
  '⚡', '💎', '🏆', '🎯', '👑', '😈', '🤯', '🫡',
  '✨', '💯', '🥶', '🤞', '🙏', '😎', '🤣', '👋',
];

export default function ChatPanel({
  streamId, layout = 'side', hostUid = null,
  slowModeSec = 0, followersOnly = false, ttsEnabled = false, pinnedMessage = null,
  composerExtras = null,
}) {
  // 'overlay' = TikTok-style transparent feed over the video: no header,
  // scrim-chip message rows, top fade mask, slim composer. Used by the
  // mobile immersive viewer + native broadcaster.
  const overlay = layout === 'overlay';
  const { currentUser } = useAuth();
  // ⚠ `wallet` is here for ONE reason: the crest card's own progress bar.
  // It is never used for another user — their VP is not readable.
  const { profile, wallet } = useUser();
  const { showToast } = useUI();
  const [messages, _setMessages] = useState(() => chatHistoryCache.get(streamId) || []);
  const setMessages = (updater) => _setMessages((prev) => {
    const next = typeof updater === 'function' ? updater(prev) : updater;
    cacheHistory(streamId, next);
    return next;
  });
  const [connState, setConnState] = useState('connecting');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [quick, setQuick] = useState(null);
  // Host-only: which non-self message did we long-press for moderation menu.
  const [modTarget, setModTarget] = useState(null);
  const [translateText, setTranslateText] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Effect 21. Which crest was tapped, and where it sits on screen. The card
  // is a PORTAL, so it needs viewport coords rather than a DOM parent — the
  // chat column is an overflow scroller and would clip it.
  const [crestCard, setCrestCard] = useState(null);
  const [savingMod, setSavingMod] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  // Whether the current viewer can moderate (host or a host-designated chat
  // moderator). The relay reports it in the hello frame.
  const [iAmMod, setIAmMod] = useState(false);
  // Effect 07. Which viewer the HOST is following. Ephemeral and host-side:
  // it is a lens on the host's own screen, not shared state, so it needs no
  // Firestore write and no relay message.
  const [threadUid, setThreadUid] = useState(null);
  const isHost = currentUser?.uid === hostUid;
  const canModerate = isHost || iAmMod;

  // @mention autocomplete from recent chatters.
  const mentionQuery = (() => {
    const m = /(^|\s)@(\w{0,20})$/.exec(draft);
    return m ? m[2].toLowerCase() : null;
  })();
  const recentChatters = useMemo(() => {
    const seen = new Map();
    for (let i = messages.length - 1; i >= 0 && seen.size < 40; i--) {
      const m = messages[i];
      if (m.uid && m.name && m.uid !== currentUser?.uid && !seen.has(m.uid)) seen.set(m.uid, m.name);
    }
    return [...seen.values()];
  }, [messages, currentUser?.uid]);
  const mentionMatches = mentionQuery != null
    ? recentChatters.filter((n) => n.toLowerCase().includes(mentionQuery)).slice(0, 5)
    : [];


  const insertMention = (name) => {
    setDraft((d) => d.replace(/(^|\s)@(\w{0,20})$/, (full, pre) => `${pre}@${name} `));
  };
  const insertEmote = (em) => setDraft((d) => (d + em).slice(0, 240));
  // Effect 13. The queue speaks ONE utterance at a time and drops the oldest
  // under flood — speech runs in real time and an unbounded queue would fall
  // minutes behind on a busy stream.
  const ttsRef = useRef(null);
  const [ttsMuted, setTtsMuted] = useState(false);
  const [ttsSeen, setTtsSeen] = useState(false);
  const [ttsNeedsGesture, setTtsNeedsGesture] = useState(false);
  const clientRef = useRef(null);
  const listRef = useRef(null);
  const autoScrollRef = useRef(true);

  useEffect(() => {
    if (!streamId || !currentUser) return;
    let cancelled = false;
    // ⚠ Created HERE, not at module scope: one queue per mounted stream, torn
    // down with it. A shared queue would keep speaking after you left.
    ttsRef.current = createTtsQueue({ onState: (st) => { setTtsMuted(st.muted); setTtsNeedsGesture(!!st.needsGesture); } });
    ttsRef.current.init(navigator.language);
    // ⚠ ARM ON THE FIRST GESTURE ANYWHERE, not just on sending a chat message.
    // Most viewers never type. They do click — to unmute the player, to open
    // a panel — and any one of those unlocks speech for the session. Passive
    // + once, so it costs nothing and removes itself.
    const arm = () => armStreamTts();
    document.addEventListener('pointerdown', arm, { once: true, passive: true });
    document.addEventListener('keydown', arm, { once: true });
    (async () => {
      const c = await connectChat({
        streamId,
        getIdToken: () => currentUser.getIdToken(),
        onHello:   (m) => { setConnState('open'); setIAmMod(!!m?.mod); },
        onMessage: (m) => {
          if (cancelled) return;
          setMessages((prev) => [...prev, m].slice(-MAX_VISIBLE));
        },
        onSystem:  (m) => {
          if (cancelled) return;
          setMessages((prev) => [...prev, { ...m, type: 'system' }].slice(-MAX_VISIBLE));
        },
        onReject:  (m) => {
          if (cancelled) return;
          const r = m.reason || 'policy';
          const friendly =
            r === 'slow-mode'      ? 'Slow mode is on — wait a moment before sending again.' :
            r === 'followers-only' ? 'Followers-only chat — follow to join the conversation.' :
            r === 'muted'          ? 'You are muted in this chat.' :
            r === 'banned'         ? 'You are banned from this chat.' :
            r === 'rate-limit'     ? 'Slow down a little.' :
            `Message blocked: ${r}`;
          showToast(friendly, 'error');
        },
        // Effect 13: every viewer speaks it locally. The relay already ran a
        // full Gemini pass, so anything arriving here is cleared to be heard.
        onTts:     (m) => {
          if (cancelled || !m?.text) return;
          setMessages((prev) => [...prev, { ...m, type: 'tts' }].slice(-MAX_VISIBLE));
          setTtsSeen(true);
          ttsRef.current?.push(m.text);
        },
        onHide:    (m) => {
          // Retroactive hide after user-report + Gemini BLOCK verdict.
          if (cancelled) return;
          setMessages((prev) => prev.map((x) => x.id === m.id
            ? { ...x, text: '[hidden by moderation]', hidden: true, flagged: true }
            : x));
        },
        onState:   (s) => { if (!cancelled) setConnState(s); },
      });
      if (cancelled) c.close();
      else clientRef.current = c;
    })();
    return () => {
      cancelled = true;
      try { clientRef.current?.close(); } catch {}
      clientRef.current = null;
      // ⚠ STOP THE SPEECH TOO. speechSynthesis is a GLOBAL queue: without
      // this it keeps reading messages aloud after the viewer navigates away.
      document.removeEventListener('pointerdown', arm);
      document.removeEventListener('keydown', arm);
      try { ttsRef.current?.stop(); } catch {}
      ttsRef.current = null;
    };
  }, [streamId, currentUser, showToast]);

  // Auto-scroll to bottom unless user scrolled up.
  useEffect(() => {
    if (!autoScrollRef.current) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScrollRef.current = nearBottom;
  };

  // Effect 13. BOTH must be true: the host opened the room to spoken messages,
  // AND this viewer has earned it (L92) or holds Pro. The client gate is UX
  // only — handleTts in the relay re-checks both and is the real boundary.
  const canSpeak = ttsEnabled && canUseStreamTts(profile);
  const onSpeak = () => {
    const text = draft.trim();
    if (!text || sending || !canSpeak) return;
    const c = clientRef.current;
    if (!c) { showToast('Chat not connected', 'error'); return; }
    armStreamTts();
    c.speak(text.slice(0, TTS_MAX_CHARS));
    setDraft('');
    haptic.light();
  };

  const onSend = (e) => {
    e?.preventDefault?.();
    // ⚠ ARM WEB SPEECH ON THIS GESTURE. Measured on the live site: speak()
    // with no prior user gesture fires  and is SILENT,
    // with nothing shown to the user. One gesture unlocks the whole session,
    // and sending a chat message is the most reliable one a viewer makes.
    armStreamTts();
    const text = draft.trim();
    if (!text || sending) return;
    const c = clientRef.current;
    if (!c) {
      showToast('Chat not connected', 'error');
      return;
    }
    setSending(true);
    c.send({ type: 'msg', text });
    setDraft('');
    haptic.light();
    setTimeout(() => setSending(false), 200);
  };

  const onMessageTap = (m) => {
    if (!m.uid || m.uid === currentUser?.uid) return;
    // Host/moderator → moderation menu first. Everyone else → profile inspector.
    if (canModerate) setModTarget(m);
    else setQuick({ uid: m.uid });
  };

  const runHostAction = async (action) => {
    if (!modTarget) return;
    const fns = getFunctions(undefined, 'europe-west1');
    try {
      if (action === 'makeMod' || action === 'removeMod') {
        await httpsCallable(fns, 'setStreamModerator')({ streamId, viewerUid: modTarget.uid, on: action === 'makeMod' });
        showToast(action === 'makeMod' ? `@${modTarget.name} is now a moderator` : `@${modTarget.name} is no longer a moderator`, 'success');
      } else if (action === 'mute') {
        await httpsCallable(fns, 'muteViewer')({ streamId, viewerUid: modTarget.uid, durationMinutes: 10 });
        showToast(`Muted @${modTarget.name} for 10 minutes`, 'success');
      } else if (action === 'ban') {
        await httpsCallable(fns, 'banViewer')({ streamId, viewerUid: modTarget.uid });
        showToast(`Banned @${modTarget.name}`, 'success');
      } else if (action === 'profile') {
        setQuick({ uid: modTarget.uid });
      } else if (action === 'report') {
        onReport(modTarget);
      } else if (action === 'pin') {
        await httpsCallable(fns, 'pinStreamMessage')({
          streamId,
          message: { id: modTarget.id, text: modTarget.text, name: modTarget.name },
        });
        showToast('Message pinned', 'success');
      }
    } catch (err) {
      showToast(err?.message || 'Action failed', 'error');
    }
    setModTarget(null);
  };

  // Host chat settings (slow mode / followers-only) + unpin.
  const applyMod = async (fnName, payload, okMsg) => {
    if (savingMod) return;
    setSavingMod(true);
    try {
      await httpsCallable(getFunctions(undefined, 'europe-west1'), fnName)({ streamId, ...payload });
      if (okMsg) showToast(okMsg, 'success');
    } catch (err) {
      showToast(err?.message || 'Update failed', 'error');
    } finally { setSavingMod(false); }
  };
  const unpin = () => applyMod('pinStreamMessage', { message: null }, 'Unpinned');

  const onReport = (m) => {
    const c = clientRef.current;
    if (!c) return;
    c.report({ id: m.id, uid: m.uid, text: m.text });
    showToast('Reported. Vanguard will review.', 'info');
    haptic.medium();
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', minHeight: 0,
      height: '100%', background: layout === 'side' ? C.bg : 'transparent',
      borderLeft: layout === 'side' ? `1px solid ${C.border}` : 'none',
      fontFamily: '"Inter", system-ui, sans-serif',
    }}>
      {translateText && <TranslationSheet text={translateText} kind="streamchat" refId={streamId} onClose={() => setTranslateText(null)} />}
      {/* Effect 21. Tapping a rank crest opens the ladder card.
          ⚠ `wallet` is passed ONLY so the card can draw YOUR OWN progress bar.
          Another user's VP is unreadable (firestore.rules: wallets are
          owner-read), so their card shows level + unlocks and no bar. */}
      {crestCard && (
        <RankCrestPopover
          level={crestCard.level}
          anchorRect={crestCard.rect}
          isSelf={crestCard.isSelf}
          wallet={wallet}
          onClose={() => setCrestCard(null)}
        />
      )}
      {/* Header (hidden in overlay mode — the feed floats over the video) */}
      {!overlay && (
      <div style={{
        padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: C.text,
        position: 'relative',
      }}>
        <span>LIVE CHAT</span>
        {followersOnly && (
          <span style={modChip(C.purpleLight)} title="Followers-only chat">
            <Icon name="favorite" size={10} className=""/> FOLLOWERS
          </span>
        )}
        {slowModeSec > 0 && (
          <span style={modChip(C.amber)} title={`Slow mode: ${slowModeSec}s`}>
            <Icon name="schedule" size={10} className=""/> {slowModeSec}s
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <ConnDot state={connState}/>
          {isHost && (
            <button onClick={() => setSettingsOpen((v) => !v)} aria-label="Chat settings"
              style={{ background: 'transparent', border: 'none', color: settingsOpen ? C.purpleLight : C.textDim, cursor: 'pointer', padding: 0, display: 'flex' }}>
              <Icon name="tune" size={16} className=""/>
            </button>
          )}
        </div>
        {isHost && settingsOpen && (
          <ChatSettingsPopover
            slowModeSec={slowModeSec} followersOnly={followersOnly} ttsEnabled={ttsEnabled} saving={savingMod}
            onSlowMode={(s) => applyMod('setStreamSlowMode', { seconds: s }, s ? `Slow mode: ${s}s` : 'Slow mode off')}
            onFollowersOnly={(en) => applyMod('setStreamFollowersOnly', { enabled: en }, en ? 'Followers-only on' : 'Followers-only off')}
            onTtsEnabled={(en) => applyMod('setStreamTts', { enabled: en }, en ? 'Spoken messages on' : 'Spoken messages off')}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </div>
      )}

      {/* Pinned message banner */}
      {pinnedMessage?.text && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px',
          background: overlay ? 'rgba(20,12,40,0.72)' : 'rgba(124,58,237,0.12)',
          borderBottom: overlay ? 'none' : `1px solid ${C.border}`,
          borderRadius: overlay ? 10 : 0, margin: overlay ? '0 0 4px' : 0,
        }}>
          <Icon name="push_pin" size={13} className="" />
          <div style={{ flex: 1, minWidth: 0, fontSize: 11.5, lineHeight: 1.35 }}>
            <span style={{ fontWeight: 800, color: C.purpleLight, marginRight: 6 }}>{pinnedMessage.name || 'Pinned'}</span>
            <span style={{ color: C.text, wordBreak: 'break-word' }}>{pinnedMessage.text}</span>
          </div>
          {isHost && (
            <button onClick={unpin} aria-label="Unpin" style={{ background: 'transparent', border: 'none', color: C.textMuted, cursor: 'pointer', padding: 0 }}>
              <Icon name="close" size={13} className="" />
            </button>
          )}
        </div>
      )}

      {/* Message list */}
      <div
        ref={listRef}
        onScroll={onScroll}
        style={{
          // ⚠ position+isolation are LOAD-BEARING for the Golden Thread: its svg
          // is z-index:-1, and without a stacking context here it escapes to the
          // nearest one and paints BEHIND this panel entirely. Squad environments
          // cost two rebuilds to learn exactly this.
          position: 'relative', isolation: 'isolate',
          flex: 1, minHeight: 0, overflowY: 'auto',
          padding: overlay ? '20px 0 4px' : '8px 10px',
          display: 'flex', flexDirection: 'column', gap: 4,
          ...(overlay ? {
            WebkitMaskImage: 'linear-gradient(180deg, transparent 0, #000 28px)',
            maskImage: 'linear-gradient(180deg, transparent 0, #000 28px)',
            scrollbarWidth: 'none',
          } : {}),
        }}
      >
        {/* Bottom-anchor spacer: keeps a sparse feed hugging the composer
            (flex-end via margin so scrolling still works). */}
        {/* ⚠ THE DRAWN PATH WAS REMOVED 2026-08-27. It rendered as a jagged
            gold squiggle in a narrow gutter and read as a rendering artefact,
            not a designed element. The highlight on the row below replaces it.
            Full reasoning in docs/effects/07-golden-thread.md §11. */}
        {overlay && <div style={{ marginTop: 'auto' }} />}
        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <ChatRow key={m.id || (m.ts + ':' + m.uid)} m={m}
              isSelf={m.uid === currentUser?.uid}
              vpLevel={m.vpLevel}
              isHost={isHost}
              threaded={threadUid === m.uid}
              onThread={() => setThreadUid((cur) => (cur === m.uid ? null : m.uid))}
              streamId={streamId}
              overlay={overlay}
              onTap={() => onMessageTap(m)}
              onReport={() => onReport(m)}
              onTranslate={(text) => setTranslateText(text)}
              onCrest={setCrestCard}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Composer */}
      {currentUser ? (
        <div style={{
          position: 'relative',
          borderTop: overlay ? 'none' : `1px solid ${C.border}`,
          background: overlay ? 'transparent' : C.bg,
        }}>
          {/* @mention autocomplete */}
          {mentionMatches.length > 0 && (
            <div style={{
              position: 'absolute', bottom: '100%', left: 8, right: 8, marginBottom: 6,
              background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10,
              overflow: 'hidden', boxShadow: '0 -6px 20px rgba(0,0,0,0.45)', zIndex: 5,
            }}>
              {mentionMatches.map((n) => (
                <button key={n} onClick={() => insertMention(n)} style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
                  background: 'transparent', border: 'none', color: C.text, fontSize: 12, cursor: 'pointer',
                }}>
                  <span style={{ color: C.purpleLight, fontWeight: 700 }}>@{n}</span>
                </button>
              ))}
            </div>
          )}
          {/* Emote picker */}
          {emojiOpen && (
            <div style={{
              position: 'absolute', bottom: '100%', right: 8, marginBottom: 6, width: 248,
              background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 8,
              display: 'grid', gridTemplateColumns: 'repeat(8,1fr)', gap: 2,
              boxShadow: '0 -6px 20px rgba(0,0,0,0.45)', zIndex: 5,
            }}>
              {EMOTES.map((e) => (
                <button key={e} type="button" onClick={() => insertEmote(e)} style={{
                  background: 'transparent', border: 'none', fontSize: 18, cursor: 'pointer', padding: 3,
                }}>{e}</button>
              ))}
            </div>
          )}
          {/* ⚠ MUTE IS MANDATORY, NOT POLISH. This is a stranger's words read
              aloud in the viewer's ears; they must be able to stop it in one
              tap. Only shown once something has actually been spoken, so it
              does not clutter a stream with the feature switched off. */}
          {(ttsSeen || ttsNeedsGesture) && (
            <button type="button"
              onClick={() => {
                // ⚠ If speech was refused for want of a gesture, THIS tap is the
                // gesture — arm and drain, do not toggle mute as well.
                if (ttsNeedsGesture) { ttsRef.current?.armAndResume(); return; }
                armStreamTts(); setTtsMuted(ttsRef.current?.setMuted(!ttsMuted));
              }}
              aria-pressed={ttsMuted}
              title={ttsMuted ? "Spoken messages are muted" : "Mute spoken messages"}
              style={{ display: "flex", alignItems: "center", gap: 6, margin: "0 10px 6px",
                       padding: "5px 9px", borderRadius: 9, fontSize: 11, fontWeight: 700,
                       background: ttsMuted ? "rgba(240,64,96,0.16)" : "rgba(255,255,255,0.06)",
                       color: ttsMuted ? "var(--brand-ember,#F04060)" : "var(--text-secondary,#9CA3AF)" }}>
              <Icon name={ttsNeedsGesture ? "touch_app" : (ttsMuted ? "volume_off" : "volume_up")} size={14} />
              {ttsNeedsGesture ? "Tap to hear spoken messages" : (ttsMuted ? "Spoken messages muted" : "Mute spoken messages")}
            </button>
          )}
          <form onSubmit={onSend} style={{
            padding: overlay ? '6px 0 0' : '8px 8px calc(8px + env(safe-area-inset-bottom))',
            display: 'flex', gap: overlay ? 8 : 6, alignItems: 'center',
          }}>
            {canSpeak && (
              <button type="button" onClick={onSpeak} disabled={!draft.trim() || sending}
                aria-label="Speak this message to the stream"
                title="Everyone watching hears this read aloud"
                style={{ background: 'transparent', border: 'none', padding: 0, flexShrink: 0,
                         color: draft.trim() ? C.purpleLight : C.textDim,
                         cursor: draft.trim() ? 'pointer' : 'default', display: 'flex' }}>
                <Icon name="record_voice_over" size={20} className="" />
              </button>
            )}
            {!overlay && (
              <button type="button" onClick={() => setEmojiOpen((v) => !v)} aria-label="Emotes"
                style={{ background: 'transparent', border: 'none', color: emojiOpen ? C.amber : C.textDim, cursor: 'pointer', padding: 0, display: 'flex', flexShrink: 0 }}>
                <Icon name="mood" size={20} className="" />
              </button>
            )}
            <input
              value={draft}
              maxLength={240}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={() => setEmojiOpen(false)}
              placeholder={connState === 'open' ? 'Say something…' : 'Connecting…'}
              disabled={connState !== 'open'}
              style={{
                flex: 1, minWidth: 0,
                padding: overlay ? '10px 14px' : '8px 12px', borderRadius: 99,
                background: overlay ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${overlay ? 'rgba(255,255,255,0.16)' : C.border}`,
                color: C.text, fontSize: 13, outline: 'none',
              }}
            />
            {/* Overlay: dock action buttons (invite / tips / gift) sit between the
                input and the gradient send arrow, matching the live-viewer design. */}
            {overlay && composerExtras}
            {overlay ? (
              <button
                type="submit" disabled={!draft.trim() || connState !== 'open'} aria-label="Send"
                style={{
                  width: 44, height: 44, borderRadius: '50%', border: 'none', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`,
                  color: '#fff', cursor: 'pointer',
                  opacity: !draft.trim() || connState !== 'open' ? 0.5 : 1,
                }}
              ><Icon name="arrow_outward" size={20} className="" /></button>
            ) : (
              draft.trim() && (
                <button
                  type="submit" disabled={!draft.trim() || connState !== 'open'}
                  style={{
                    padding: '8px 14px', borderRadius: 99, border: 'none',
                    background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`,
                    color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer',
                    opacity: !draft.trim() || connState !== 'open' ? 0.5 : 1, flexShrink: 0,
                  }}
                >Send</button>
              )
            )}
            {!overlay && composerExtras}
          </form>
        </div>
      ) : (
        <div style={{
          padding: overlay ? '8px 0 0' : 14, borderTop: overlay ? 'none' : `1px solid ${C.border}`,
          textAlign: 'center', fontSize: 12, color: C.textDim,
          display: overlay ? 'flex' : 'block', alignItems: 'center', gap: 8,
        }}>
          <span style={{ flex: overlay ? 1 : undefined }}>Sign in to chat</span>
          {overlay && composerExtras}
        </div>
      )}

      <UserQuickSheet
        open={!!quick}
        uid={quick?.uid}
        onClose={() => setQuick(null)}
      />

      {/* Host / moderator moderation popover */}
      {canModerate && modTarget && (
        <div onClick={() => setModTarget(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 260,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={spring.bouncy}
            style={{
              width: 'min(320px, 88vw)', background: C.bg, color: C.text,
              border: `1px solid ${C.border}`, borderRadius: 14, padding: 16,
              fontFamily: '"Inter", system-ui, sans-serif',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <UserAvatar src={modTarget.avatar} size="sm"/>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis' }}>{modTarget.name}</div>
                <div style={{ fontSize: 11, color: C.textDim, whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis' }}>"{modTarget.text}"</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <ModBtn icon="push_pin"   label="Pin message"    onClick={() => runHostAction('pin')} accent={C.purpleLight}/>
              <ModBtn icon="visibility" label="View profile" onClick={() => runHostAction('profile')}/>
              {isHost && (modTarget.mod
                ? <ModBtn icon="remove_moderator" label="Remove as moderator" onClick={() => runHostAction('removeMod')} accent={C.amber}/>
                : <ModBtn icon="add_moderator"    label="Make moderator"      onClick={() => runHostAction('makeMod')}    accent={C.purpleLight}/>)}
              <ModBtn icon="timer_off"  label="Mute 10 minutes" onClick={() => runHostAction('mute')} accent={C.amber}/>
              <ModBtn icon="block"      label="Ban from stream" onClick={() => runHostAction('ban')}  accent={C.red}/>
              <ModBtn icon="flag"       label="Report message"  onClick={() => runHostAction('report')}/>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

function modChip(color) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 3,
    fontSize: 9, fontWeight: 800, letterSpacing: '0.04em',
    padding: '2px 6px', borderRadius: 99,
    background: color + '22', color, border: `1px solid ${color}55`,
  };
}

function ChatSettingsPopover({ slowModeSec, followersOnly, ttsEnabled, saving, onSlowMode, onFollowersOnly, onTtsEnabled, onClose }) {
  const SLOW = [0, 5, 15, 30, 60];
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 255 }} />
      <div style={{
        position: 'absolute', top: '100%', right: 8, marginTop: 6, zIndex: 256,
        width: 244, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12,
        padding: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
        fontFamily: '"Inter", system-ui, sans-serif',
      }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: C.textDim, marginBottom: 10 }}>CHAT SETTINGS</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Icon name="favorite" size={14} className="" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>Followers-only</div>
            <div style={{ fontSize: 10, color: C.textMuted }}>Only followers can chat</div>
          </div>
          <button
            onClick={() => onFollowersOnly(!followersOnly)} disabled={saving}
            style={{
              width: 38, height: 22, borderRadius: 11, border: 'none', position: 'relative',
              background: followersOnly ? C.purpleLight : 'rgba(255,255,255,0.14)',
              cursor: saving ? 'wait' : 'pointer', flexShrink: 0,
            }}
          >
            <span style={{
              position: 'absolute', top: 2, left: followersOnly ? 18 : 2,
              width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.15s',
            }} />
          </button>
        </div>
        {/* Effect 13. ⚠ OFF BY DEFAULT: this lets a viewer put words into the
            ears of everyone watching, so it is the host's switch alone. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Icon name="record_voice_over" size={14} className="" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>Spoken messages</div>
            <div style={{ fontSize: 10, color: C.textMuted }}>Viewers can have messages read aloud</div>
          </div>
          <button
            onClick={() => onTtsEnabled(!ttsEnabled)} disabled={saving}
            style={{
              width: 38, height: 22, borderRadius: 11, border: 'none', position: 'relative',
              background: ttsEnabled ? C.purpleLight : 'rgba(255,255,255,0.14)',
              cursor: saving ? 'wait' : 'pointer', flexShrink: 0,
            }}
          >
            <span style={{
              position: 'absolute', top: 2, left: ttsEnabled ? 18 : 2,
              width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.15s',
            }} />
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Icon name="schedule" size={14} className="" />
          <span style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>Slow mode</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {SLOW.map((s) => (
            <button key={s} disabled={saving} onClick={() => onSlowMode(s)} style={{
              padding: '5px 11px', borderRadius: 7, cursor: saving ? 'wait' : 'pointer',
              background: slowModeSec === s ? 'rgba(124,58,237,0.28)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${slowModeSec === s ? C.purpleLight : C.border}`,
              color: slowModeSec === s ? '#fff' : C.textDim, fontSize: 11, fontWeight: 700,
            }}>{s === 0 ? 'Off' : s + 's'}</button>
          ))}
        </div>
      </div>
    </>
  );
}

function ModBtn({ icon, label, onClick, accent }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 12px', borderRadius: 10,
      background: accent ? `${accent}14` : 'rgba(255,255,255,0.04)',
      border: `1px solid ${accent ? accent + '55' : 'rgba(255,255,255,0.08)'}`,
      color: accent || '#fff', fontSize: 13, fontWeight: 700,
      cursor: 'pointer', textAlign: 'left',
    }}>
      <Icon name={icon} size={16} className=""/>
      <span style={{ flex: 1 }}>{label}</span>
      <Icon name="chevron_right" size={14} className=""/>
    </button>
  );
}

function ConnDot({ state }) {
  const color = state === 'open' ? C.purpleLight : state === 'reconnecting' ? C.amber : C.red;
  const label = state === 'open' ? 'live' : state === 'reconnecting' ? 'reconnecting' : 'offline';
  return (
    <span style={{
      display: 'flex', alignItems: 'center', gap: 5,
      fontSize: 10, color, fontWeight: 700, letterSpacing: '0.04em',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }}/>
      {label}
    </span>
  );
}

function ChatRow({ m, isSelf, vpLevel, onTap, onReport, streamId, onTranslate, overlay = false, onCrest,
  isHost = false, threaded = false, onThread }) {
  // Both derived from a number that arrived WITH the message. No lookup.
  const vpColor = chatNameColor(vpLevel);
  // The sweep itself moved into <UserName>; only the flat colour is decided here.
  // System messages (joined / left / pinned / report-received). "joined" gets
  // the eye glyph + "started watching" treatment; the rest stay subtle.
  if (m.type === 'system') {
    const joined = m.system === 'joined';
    const label = joined ? `${m.name || 'Someone'} started watching`
                : m.system === 'left'   ? `${m.name || 'Someone'} left`
                : m.system === 'report-received' ? 'Report received'
                : m.system === 'pinned' ? `${m.name || 'Someone'} pinned a message`
                : '';
    if (!label) return null;
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={spring.gentle}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 10.5, padding: joined ? '3px 9px 3px 5px' : '2px 8px',
          fontStyle: joined ? 'normal' : 'italic',
          color: overlay ? 'rgba(255,255,255,0.82)' : C.textMuted,
          ...(overlay ? {
            background: 'rgba(0,0,0,0.35)', borderRadius: 10,
            width: 'fit-content', maxWidth: '82%',
            textShadow: '0 1px 2px rgba(0,0,0,0.6)',
          } : {}),
        }}
      >
        {joined
          ? <img src={watchingIcon} alt="" aria-hidden style={{ height: 16, width: 'auto', objectFit: 'contain', opacity: 0.9, flexShrink: 0 }} />
          : <span aria-hidden>·</span>}
        <span>{label}</span>
      </motion.div>
    );
  }

  const rankColor = m.rank ? RANK_COLORS[m.rank] || C.purpleLight : null;
  const isTip = m.type === 'tip';

  return (
    <motion.div
      layout
      // ⚠ The engine finds a viewer's rows by THIS attribute. Removing it does
      // not break the build, it just makes the thread silently find nothing.
      {...{ [UID_ATTR]: m.uid || undefined }}
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4 }}
      transition={spring.gentle}
      onClick={onTap}
      style={{
        position: 'relative',
        display: 'flex', gap: 8, padding: overlay ? '6px 10px' : '5px 8px',
        borderRadius: overlay ? 12 : 8, cursor: onTap && !isSelf ? 'pointer' : 'default',
        background: isTip
          ? (overlay ? 'rgba(120,80,0,0.55)' : 'rgba(240,165,0,0.10)')
          : (m.flagged
            ? (overlay ? 'rgba(120,30,30,0.55)' : 'rgba(239,68,68,0.08)')
            // Effect 07 — the followed viewer's messages. Built exactly like the
            // tip highlight three lines up, because that is the pattern this file
            // ALREADY uses and the one Twitch uses for a highlighted message: a
            // tint plus an accent bar. NOT a drawn path. See §11 of the doc.
            // ⚠ Ranked BELOW `flagged` on purpose: a moderation signal must never
            // be hidden by a cosmetic one.
            : threaded
              ? (overlay ? 'rgba(120,95,0,0.50)' : 'rgba(245,200,66,0.10)')
              : (overlay ? 'rgba(0,0,0,0.38)' : 'transparent')),
        borderLeft: isTip ? `3px solid ${C.amber}`
          : m.flagged ? `2px solid ${C.red}`
          : threaded ? '3px solid #F5C842'
          : 'none',
        ...(overlay ? { width: 'fit-content', maxWidth: '82%' } : {}),
      }}
    >
      {/* Effect 07 — the holder's OWN confirmation, on their OWN screen only.
          They can never see the thread itself (it renders in the host's chat),
          so without this the unlock would be completely invisible to the person
          who earned it — the avatar-orbit mistake. A gold stub in the same
          gutter the thread uses, so it reads as "the thread starts with you". */}
      {isSelf && isUnlocked('golden_thread', vpLevel) && <span className="vg-thread-own" />}

      {/* The HOST's control. Only offered for people who actually hold the
          unlock, so it never clutters a normal chat row. One at a time: picking
          someone replaces whoever was threaded. */}
      {isHost && !isSelf && isUnlocked('golden_thread', vpLevel) && (
        <button type="button"
          onClick={(e) => { e.stopPropagation(); onThread?.(); }}
          aria-pressed={threaded}
          title={threaded ? 'Stop following this thread' : 'Follow this thread'}
          style={{ position: 'absolute', right: 4, top: 4, background: 'transparent',
                   border: 'none', padding: 2, cursor: 'pointer', lineHeight: 0,
                   color: threaded ? '#F5C842' : 'rgba(255,255,255,0.28)' }}>
          {/* ⚠ `link` is used 23 times elsewhere, so it is PROVEN in the bundled
              Material Symbols font. The first pass used `linked_services`, which
              appears nowhere else — an unproven glyph renders as its literal
              ligature TEXT, which is exactly the failure CLAUDE.md warns about. */}
          <Icon name="link" size={13} className="" />
        </button>
      )}
      <UserAvatar src={m.avatar} size="xs" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11.5, lineHeight: 1.35 }}>
          {m.mod && (
            <img src={modBadgeIcon} alt="moderator" title="Stream moderator"
              style={{ height: 14, width: 'auto', objectFit: 'contain', verticalAlign: '-3px', marginRight: 4 }} />
          )}
          {m.badge && !rankColor && (
            overlay ? (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 2, verticalAlign: '-2px', marginRight: 5,
                padding: '1px 5px 1px 3px', borderRadius: 6, fontSize: 8.5, fontWeight: 900, letterSpacing: '0.04em',
                color: '#fff', background: 'linear-gradient(135deg, #7c3aed, #b44fff)',
              }}>
                <Icon name="star" size={9} filled className="" style={{ color: '#F5C842' }} />SUB
              </span>
            ) : (
              <span style={{ display: 'inline-flex', verticalAlign: '-3px', marginRight: 5 }}>
                <BadgeGem color={m.badge.color} icon={m.badge.icon} size={15} />
              </span>
            )
          )}
          {!overlay && m.ts && (
            <span style={{ fontSize: 10, color: C.textMuted, marginRight: 6, fontVariantNumeric: 'tabular-nums' }}>
              {fmtClock(m.ts)}
            </span>
          )}
          {/* Name colour precedence, highest authority first:
              1. Vanguard rank  — moderator identity, must never be overridden
              2. VP rank colour — unlocked at L3, derived from the `vpLevel` the
                 relay already stamps on the message, so it costs nothing
              3. deterministic per-uid hash — the Twitch-style fallback
              The L63 unlock swaps the flat colour for a slow gradient sweep. */}
          {/* ⚠ The gradient sweep USED TO BE INLINE HERE. It now lives in
              <UserName> (.vg-name-sweep in surface.css) so there is exactly one
              implementation and every surface gets it, not just chat. Passing
              vpLevel is what switches it on, and it costs nothing: the relay
              already stamps the level on every message.

              A Vanguard moderator's rankColor still wins here, on the wrapper,
              because that is moderator IDENTITY and must never be overridden by
              a cosmetic the user chose. */}
          <span style={{
            fontWeight: 800, marginRight: 6,
            color: rankColor || vpColor || (isSelf ? C.purpleLight : nameColor(m.uid || m.name)),
          }}>
            {/* ⚠ A Vanguard moderator gets NO level, so no tint and no sweep.
                rankColor is moderator identity and must never be overridden by
                a cosmetic; withholding the level is how that is enforced, since
                <UserName> derives every cosmetic from it. */}
            <UserName user={{ displayName: m.name, vpLevel: rankColor ? 0 : vpLevel }}
                      masked context="chat" fallback="guest" />
            {/* ⚠ VP rank crest, to the RIGHT of the name (founder, 2026-08-27).
                It sat on the LEFT until then, which put a rank mark ahead of the
                person's own identity and pushed every name in the room out of
                alignment by a variable amount. Silent below L11 by design: if
                every account carries one, it stops being a signal.
                Tapping it opens the ladder card — the crest is the only place
                most users ever see the level system. */}
            <RankBadge
              level={vpLevel}
              uid={m.uid}
              role={m.role}
              size={13}
              animated
              style={{ marginLeft: 4, verticalAlign: '-2px' }}
              onOpen={(rect) => onCrest?.({ level: vpLevel, rect, isSelf })}
            />
            {rankColor && (
              <span style={{
                marginLeft: 4, fontSize: 9, padding: '1px 5px', borderRadius: 99,
                background: rankColor + '22', color: rankColor, border: `1px solid ${rankColor}55`,
                fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase',
              }}>{m.rank}</span>
            )}
            {isTip && (
              <span style={{
                marginLeft: 4, fontSize: 9, padding: '1px 5px', borderRadius: 99,
                background: 'rgba(240,165,0,0.25)', color: C.amber,
                fontWeight: 800, letterSpacing: '0.04em',
              }}>TIP</span>
            )}
          </span>
          <span
            style={{ color: C.text, wordBreak: 'break-word', cursor: isTauri() && !isSelf && m.text ? 'pointer' : undefined }}
            onClick={() => { if (isTauri() && !isSelf && m.text && m.type !== 'tip' && onTranslate) onTranslate(m.text); }}
          >{m.text}</span>
        </div>
        {m.flagged && (
          <div style={{ fontSize: 9, color: C.red, marginTop: 1 }}>flagged · queued for review</div>
        )}
      </div>
      {!isSelf && (
        <button
          onClick={(e) => { e.stopPropagation(); onReport(); }}
          aria-label="Report"
          style={{
            opacity: 0, background: 'transparent', border: 'none', color: C.textMuted,
            cursor: 'pointer', padding: 0, alignSelf: 'flex-start',
          }}
          className="vergr-chat-report-btn"
        >
          <Icon name="flag" size={12} className=""/>
        </button>
      )}
    </motion.div>
  );
}
