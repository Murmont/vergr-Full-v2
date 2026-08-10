// SquadChatThreadScreen — Discord-style squad chat, rebuilt on the .sqd
// design system. Renders inside <SquadShell mode="squad"> with <SquadInfoRail>
// as the right rail. Wire-for-wire feature parity with the old bubble UI:
// realtime messages, reactions, replies, edit, pin, delete, forward, search,
// polls, voice messages, image/video/link/tournament embeds, markdown +
// ||spoiler||, typing indicator.

import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, doc,
  updateDoc, arrayUnion, arrayRemove, deleteDoc, getDocs, where, setDoc, writeBatch, deleteField,
} from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { startVoiceRecording, uploadMediaFile, getYouTubeID } from '../../utils/mediaHelpers';
import { createSquadVote } from '../../firebase/firestore';
import { getSquadMembers, getUserTournaments } from '../../firebase/firestore';
import useResponsive from '../../hooks/useResponsive';
import useTier from '../../hooks/useTier';
import useTyping from '../../hooks/useTyping';
import { useUser } from '../../context/UserContext';
import { applyVanguardMask } from '../../utils/vanguard';
import VanguardBadge from '../../components/VanguardBadge';
import TranslationSheet from '../../components/TranslationSheet';
import { isTauri } from '../../utils/platform';
import { useUI } from '../../context/UIContext';
import { isGallerySaveSupported, saveMediaToGallery } from '../../utils/saveToGallery';
import { markSquadRead, getSquadReadMap } from '../../utils/navBadges';
import ReactMarkdown from 'react-markdown';
import SquadShell from '../../components/squad/SquadShell';
import SquadInfoRail from '../../components/squad/SquadInfoRail';
import { roleMeta, avatarClass, initials } from '../../components/squad/squadHelpers';
import MediaPanel from '../../components/MediaPanel';
import EmojiPicker from '../../components/EmojiPicker';
import UpgradeModal from '../../components/UpgradeModal';
import Modal from '../../components/Modal';
import SquadPollComponent from '../../components/SquadPollComponent';
import VotePollCard from '../../components/VotePollCard';
import BackgroundPickerModal from '../../components/BackgroundPickerModal';
import { extractUrl } from '../../components/LinkPreview';
import Icon from '../../components/Icon';
import InlineVideoPlayer from '../../components/media/InlineVideoPlayer';
import usePresenceMap from '../../hooks/usePresenceMap';
import { presenceVisible } from '../../utils/presence';
import EventTicketCard from '../../components/tournament/EventTicketCard';
import { dissolveElement, preloadThanosDissolve } from '../../utils/thanosDissolve';
import { MessageContextMenu, ReactionBubbles } from '../../components/MessageContextMenu';
import ReactorsSheet from '../../components/messages/ReactorsSheet';
import MediaLightbox from '../../components/MediaLightbox';

const formatTime = (date) => {
  if (!date) return '';
  const d = date.toDate ? date.toDate() : new Date(date);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};
const dayLabel = (date) => {
  if (!date) return '';
  const d = date.toDate ? date.toDate() : new Date(date);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today · ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  if (same(d, yest)) return 'Yesterday · ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
};
const dayKey = (date) => {
  if (!date) return 'x';
  const d = date.toDate ? date.toDate() : new Date(date);
  return d.toDateString();
};

// ── Reaction model: squads are migrating to the DM shape ────────────────────
// LEGACY squad shape: { uid: emoji }  — one reaction per person, keyed by uid.
// DM shape (target):  { emoji: [uid] } — many reactions per person, keyed by
// emoji. The DM shape is what the shared ReactionBubbles / ReactorsSheet
// components speak, and it's the only one that can express "who reacted".
//
// We DUAL-READ: every message is normalised to the DM shape for rendering, so
// reactions written before this change keep working untouched, with no
// migration script and no backfill. New writes always use the DM shape.
// Telling the two apart is unambiguous: a legacy value is a string (the emoji),
// a DM value is an array of uids. A message can hold both at once mid-migration
// and still renders correctly, because we merge them.
const toDmReactions = (reactions) => {
  const out = {};
  for (const [key, val] of Object.entries(reactions || {})) {
    if (typeof val === 'string') {
      // legacy: key is a uid, val is the emoji they picked
      (out[val] ||= []).push(key);
    } else if (Array.isArray(val)) {
      out[key] = [...(out[key] || []), ...val];
    }
  }
  // Drop emojis nobody is left on, so an empty array doesn't render a 0-chip.
  for (const k of Object.keys(out)) if (out[k].length === 0) delete out[k];
  return out;
};

// Split a string on ||spoiler|| markers and return an array of React nodes.
// Plain text is rendered through ReactMarkdown; spoiler segments wrap in a
// click-to-reveal span. We do the split BEFORE ReactMarkdown because RM escapes
// raw HTML by default.
const SpoilerText = ({ text }) => {
  const parts = [];
  const re = /\|\|(.*?)\|\|/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text || '')) !== null) {
    if (m.index > last) parts.push({ type: 'md', value: text.slice(last, m.index), key: i++ });
    parts.push({ type: 'spoiler', value: m[1], key: i++ });
    last = m.index + m[0].length;
  }
  if (last < (text || '').length) parts.push({ type: 'md', value: text.slice(last), key: i++ });
  return (
    <>
      {parts.map((p) => p.type === 'spoiler'
        ? <span key={p.key} className="spoiler" onClick={(e) => e.currentTarget.classList.add('revealed')}>{p.value}</span>
        : <ReactMarkdown key={p.key} components={MarkdownComponents}>{p.value}</ReactMarkdown>
      )}
    </>
  );
};
const MarkdownComponents = {
  p: (p) => <span {...p} />,
  strong: (p) => <strong {...p} />,
  em: (p) => <em {...p} />,
  code: (p) => <code {...p} />,
  a: (p) => <a className="link" target="_blank" rel="noopener noreferrer" {...p} />,
};

// ── Tournament card embed ─────────────────────────────────────────────
// Renders a rich tournament card inside chat (banner / title / format pill /
// dates / prize pool / View button). The message stores the snapshot under
// `m.tournament` so we don't refetch on every render.
function TournamentEmbed({ data }) {
  if (!data) return null;
  const banner = data.bannerUrl;
  const start = data.startDate ? new Date(typeof data.startDate === 'number' ? data.startDate : data.startDate) : null;
  const end = data.endDate ? new Date(typeof data.endDate === 'number' ? data.endDate : data.endDate) : null;
  const fmtDate = (d) => d ? d.toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
  const dateLine = start && end
    ? `${fmtDate(start)} – ${fmtDate(end)}`
    : start ? fmtDate(start) : '';
  return (
    <a
      href={`/match/${data.tournamentId}`}
      style={{
        marginTop: 6, display: 'block', borderRadius: 14, overflow: 'hidden',
        border: '1px solid rgba(180,79,255,.22)',
        background: 'linear-gradient(135deg,rgba(123,31,255,.10),rgba(200,127,255,.06))',
        maxWidth: 480,
        textDecoration: 'none', color: 'inherit',
      }}
    >
      {banner && (
        <div style={{ width: '100%', aspectRatio: '21/9', background: `url(${banner}) center/cover, #1A1A2A` }} />
      )}
      <div style={{ padding: 14, display: 'flex', gap: 14, alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--violet-light)' }}>emoji_events</span>
            <span style={{ fontFamily: 'DM Mono', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--violet-light)' }}>
              {data.game || 'Tournament'}
            </span>
            {data.type && (
              <span style={{ fontFamily: 'DM Mono', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.08em', padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,.06)', color: 'var(--t2)' }}>
                {data.type}
              </span>
            )}
          </div>
          <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 16, color: '#fff', lineHeight: 1.2 }}>
            {data.name || 'Tournament'}
          </div>
          {dateLine && (
            <div style={{ marginTop: 4, fontFamily: 'DM Mono', fontSize: 11, color: 'var(--t2)' }}>
              {dateLine}
            </div>
          )}
          {(data.entryFee != null || data.prizePool != null) && (
            <div style={{ marginTop: 8, display: 'flex', gap: 12, fontFamily: 'DM Mono', fontSize: 11, color: 'var(--t2)' }}>
              {data.prizePool != null && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span className="coin" />
                  <strong style={{ color: 'var(--gold-light)' }}>{data.prizePool.toLocaleString()}</strong> pool
                </span>
              )}
              {data.entryFee != null && (
                <span>
                  <span className="coin" />
                  <strong style={{ color: '#fff' }}>{data.entryFee.toLocaleString()}</strong> entry
                </span>
              )}
            </div>
          )}
        </div>
        <span className="btn primary sm" style={{ flexShrink: 0 }}>
          View
        </span>
      </div>
    </a>
  );
}

// ── Waveform voice embed ──────────────────────────────────────────────
function VoiceEmbed({ url }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [pct, setPct] = useState(0);
  const [dur, setDur] = useState(0);
  const bars = useMemo(() => {
    let seed = 0;
    for (let i = 0; i < (url || '').length; i++) seed = ((seed << 5) - seed + url.charCodeAt(i)) | 0;
    const sr = (s) => { s = Math.sin(s) * 10000; return s - Math.floor(s); };
    return Array.from({ length: 40 }, (_, i) => 0.2 + sr(seed + i) * 0.8);
  }, [url]);
  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) audioRef.current.pause(); else audioRef.current.play().catch(() => {});
    setPlaying(!playing);
  };
  const fmt = (t) => isNaN(t) ? '0:00' : `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, '0')}`;
  return (
    <div className="voice-embed">
      <div className="voice-play" onClick={toggle}>
        <span className="material-symbols-outlined mi-fill">{playing ? 'pause' : 'play_arrow'}</span>
      </div>
      <div className="waveform">
        {bars.map((h, i) => (
          <div key={i} className={`bar${(i / bars.length) * 100 < pct ? ' played' : ''}`} style={{ height: `${h * 100}%` }} />
        ))}
      </div>
      <div className="voice-time">{playing ? fmt(audioRef.current?.currentTime) : fmt(dur)}</div>
      <audio
        ref={audioRef} src={url} preload="metadata"
        onTimeUpdate={() => { const a = audioRef.current; if (a?.duration) setPct((a.currentTime / a.duration) * 100); }}
        onLoadedMetadata={() => setDur(audioRef.current?.duration || 0)}
        onEnded={() => { setPlaying(false); setPct(0); }}
      />
    </div>
  );
}

// ── Save-to-gallery overlay button (native Android only) ──────────────
// Squad chat has no shared context menu / lightbox (unlike DMs), and the
// hover action toolbar is mouse-only, so touch users need a real tap target.
// This corner button on each media embed calls the same Kotlin MediaStore
// bridge the DMs use (window.VergrGallery, shipped 1.0.94).
function SquadSaveMediaBtn({ url, isVideo, onSave }) {
  const [state, setState] = useState('idle'); // idle | saving | saved
  const icon = state === 'saving' ? 'hourglass_empty' : state === 'saved' ? 'download_done' : 'download';
  return (
    <button
      title="Save to gallery"
      onClick={async (e) => {
        e.stopPropagation();
        if (state === 'saving') return;
        setState('saving');
        const ok = await onSave(url, isVideo);
        setState(ok ? 'saved' : 'idle');
      }}
      style={{
        position: 'absolute', top: 8, right: 8, zIndex: 3, width: 34, height: 34,
        borderRadius: 999, border: 'none', cursor: 'pointer', color: '#fff',
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        display: 'grid', placeItems: 'center',
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{icon}</span>
    </button>
  );
}

export default function SquadChatThreadScreen() {
  const { squadId } = useParams();
  const navigate = useNavigate();
  const scrollRef = useRef();
  const containerRef = useRef();
  const inputRef = useRef(null);
  const { isMobile } = useResponsive();
  const { tier, tierConfig, checkFileSize } = useTier();
  const { typingUsers, clearTyping } = useTyping(squadId, 'squad');
  const { profile } = useUser();
  const { showToast } = useUI();

  const myUid = auth.currentUser?.uid;

  // Native-only: save a squad chat photo/video to the phone gallery (VERGR album).
  const canSaveToGallery = isGallerySaveSupported();
  const saveSquadMedia = async (url, isVideo) => {
    if (!url) return false;
    const res = await saveMediaToGallery(url, { isVideo });
    if (res.ok) showToast?.(isVideo ? 'Video saved to gallery' : 'Photo saved to gallery', 'success');
    else if (res.error !== 'unsupported') showToast?.('Could not save to gallery', 'error');
    return res.ok;
  };

  const [messages, setMessages] = useState([]);
  const [squadInfo, setSquadInfo] = useState(null);
  const [members, setMembers] = useState([]);
  const memberPresence = usePresenceMap(members.map((m) => m.id));
  const [userRole, setUserRole] = useState(null);
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [editingMsg, setEditingMsg] = useState(null);
  const [translateMsg, setTranslateMsg] = useState(null);
  const [showMedia, setShowMedia] = useState(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [reactToMsgId, setReactToMsgId] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);   // { msgId, x, y }
  const [reactorsView, setReactorsView] = useState(null); // { reactions, emoji }
  const [lightbox, setLightbox] = useState(null);         // { index }

  // ── Unread divider + jump-to-bottom ───────────────────────────────────
  // The read cutoff must be captured ONCE, on entry: the messages snapshot
  // calls markSquadRead on every fire, so reading it later would always come
  // back as "just now" and the divider would never appear.
  const entryCutoffRef = useRef(null);
  if (entryCutoffRef.current === null) {
    entryCutoffRef.current = getSquadReadMap()[squadId] || 0;
  }
  const atBottomRef = useRef(true);
  const lastSeenIdRef = useRef(null);
  const [newBelow, setNewBelow] = useState(0);   // new messages while scrolled up
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recorder, setRecorder] = useState(null);
  const [recordingCancel, setRecordingCancel] = useState(false);
  const [showPollModal, setShowPollModal] = useState(false);
  const [pollTitle, setPollTitle] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [showBackgroundModal, setShowBackgroundModal] = useState(false);
  const [upgradeModal, setUpgradeModal] = useState({ open: false, requiredTier: 'lite', message: '' });
  const [showTournamentModal, setShowTournamentModal] = useState(false);
  const [myTournaments, setMyTournaments] = useState([]);
  const [tournamentsLoading, setTournamentsLoading] = useState(false);

  const isAdminRole = userRole === 'president' || userRole === 'vice_president';
  const roleByUid = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m.role])), [members]);
  // Look up each sender's live user doc (loaded with getSquadMembers) so we
  // render their real avatar + display name. The `senderAvatar` field stored
  // on the message doc comes from auth.currentUser.photoURL which is usually
  // empty — VERGR keeps avatars on the Firestore profile doc, not the Auth
  // record. Falling back to senderAvatar if no member match (e.g. old
  // messages from someone who has since left the squad).
  const userByUid = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m.user])), [members]);

  // Preload the Thanos-dissolve html2canvas bundle so the first delete doesn't
  // eat the 400KB load cost. Safe to call multiple times.
  useEffect(() => { preloadThanosDissolve(); }, []);

  // Squad doc (realtime — chat background, name, pinned)
  useEffect(() => {
    if (!squadId) return;
    return onSnapshot(doc(db, 'squads', squadId), (s) => {
      if (s.exists()) setSquadInfo({ id: s.id, ...s.data() });
    });
  }, [squadId]);

  // Members (role pills + right rail)
  useEffect(() => {
    if (!squadId) return;
    let alive = true;
    getSquadMembers(squadId).then((m) => { if (alive) setMembers(m); }).catch(() => {});
    return () => { alive = false; };
  }, [squadId]);

  // My role
  useEffect(() => {
    if (!squadId || !myUid) return;
    return onSnapshot(doc(db, 'squads', squadId, 'members', myUid), (s) => {
      setUserRole(s.exists() ? s.data().role : null);
    });
  }, [squadId, myUid]);

  // Messages (realtime)
  const [msgError, setMsgError] = useState(null);
  useEffect(() => {
    if (!squadId) return;
    setMsgError(null);
    const q = query(collection(db, 'squads', squadId, 'messages'), orderBy('createdAt', 'asc'));
    return onSnapshot(
      q,
      (snap) => {
        const msgs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setMessages(msgs);
        markSquadRead(squadId); // viewing this chat clears its nav badge
        msgs.forEach((m) => {
          if (myUid && !m.readBy?.includes(myUid)) {
            updateDoc(doc(db, 'squads', squadId, 'messages', m.id), { readBy: arrayUnion(myUid) }).catch(() => {});
          }
        });
        // Only follow the bottom if the reader is already there. Yanking someone
        // back down while they're reading history is the single most annoying
        // thing a chat can do — and it's what this used to do on every snapshot.
        if (atBottomRef.current) {
          setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
        } else {
          const last = msgs[msgs.length - 1];
          if (last && last.id !== lastSeenIdRef.current && last.senderId !== myUid) {
            setNewBelow((n) => n + 1);
          }
        }
        if (msgs.length) lastSeenIdRef.current = msgs[msgs.length - 1].id;
      },
      (err) => {
        console.error('[SquadChat] messages snapshot error:', err);
        setMsgError(err?.code === 'permission-denied'
          ? 'You don\'t have permission to read this chat. Are you a member of this squad?'
          : (err?.message || 'Failed to load messages.'));
      },
    );
  }, [squadId, myUid]);

  // ── Actions ──────────────────────────────────────────────────────────
  const sendMsg = async (payload) => {
    if (!myUid) return;
    if (editingMsg) {
      await updateDoc(doc(db, 'squads', squadId, 'messages', editingMsg.id), {
        text: input.trim(), editedAt: serverTimestamp(),
      });
      setEditingMsg(null); setInput('');
      return;
    }
    const data = {
      ...payload,
      senderId: myUid,
      // Use the Firestore profile (real source of truth for display name +
      // avatar). Auth's photoURL / displayName are usually empty on VERGR.
      senderName: profile?.displayName || profile?.username || auth.currentUser.displayName || 'Anonymous',
      senderAvatar: profile?.avatar || auth.currentUser.photoURL || '',
      createdAt: serverTimestamp(),
      readBy: [myUid],
      reactions: {},
    };
    if (replyTo) {
      data.replyTo = {
        id: replyTo.id, text: (replyTo.text || '').slice(0, 100),
        senderName: replyTo.senderName, senderId: replyTo.senderId,
      };
    }
    await addDoc(collection(db, 'squads', squadId, 'messages'), data);
    // Stamp the squad doc so members' side-nav badge can detect new activity
    // cheaply (no per-message scan). Best-effort — never block the send.
    updateDoc(doc(db, 'squads', squadId), {
      lastMessageAt: serverTimestamp(),
      lastMessageSenderId: myUid,
    }).catch(() => {});
    markSquadRead(squadId); // my own send is already read for me
    setReplyTo(null);
    clearTyping();
  };

  const submitText = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (trimmed === '/vote') { await handleVoteCommand(); setInput(''); return; }
    await sendMsg({ text: trimmed, type: 'text' });
    setInput('');
  };

  const handleVoteCommand = async () => {
    if (!squadInfo?.memberCount || !myUid) return;
    await setDoc(doc(db, 'squads', squadId, 'vote_intents', myUid), { timestamp: serverTimestamp() }, { merge: true });
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const snap = await getDocs(query(collection(db, 'squads', squadId, 'vote_intents'), where('timestamp', '>', since)));
    if (snap.size >= Math.ceil(squadInfo.memberCount / 2)) {
      await createSquadVote(squadId, myUid, {
        title: 'Election for President', type: 'elect_role',
        options: ['Yes', 'No'], targetUserId: null, targetRole: 'president', duration: 48,
      });
      await sendMsg({ type: 'text', text: 'A vote for President has been triggered by members.' });
    }
  };

  const applyFormat = (fmt) => {
    const ta = inputRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    const sel = input.substring(s, e);
    const wrap = { bold: '**', italic: '_', strike: '~~', code: '`', spoiler: '||' }[fmt];
    if (!wrap) return;
    const next = input.substring(0, s) + wrap + sel + wrap + input.substring(e);
    setInput(next);
    setTimeout(() => { ta.focus(); ta.setSelectionRange(s + wrap.length, s + wrap.length + sel.length); }, 0);
  };

  // Writes the DM shape ({ emoji: [uids] }) so squad chat can use the shared
  // reaction components. Removal also clears the caller's LEGACY entry when
  // that's how their reaction was stored, otherwise toggling an old reaction
  // off would appear to do nothing (the legacy key would still be there and
  // the dual-read would keep rendering it).
  const toggleReaction = (m, emoji) => {
    if (!myUid) return;
    const r = m.reactions || {};
    const ref = doc(db, 'squads', squadId, 'messages', m.id);
    const updates = {};
    const inNew = Array.isArray(r[emoji]) && r[emoji].includes(myUid);
    const inLegacy = r[myUid] === emoji;

    if (inNew || inLegacy) {
      if (inNew) updates[`reactions.${emoji}`] = arrayRemove(myUid);
      if (inLegacy) updates[`reactions.${myUid}`] = deleteField();
    } else {
      updates[`reactions.${emoji}`] = arrayUnion(myUid);
    }
    return updateDoc(ref, updates);
  };

  // Track whether the reader is pinned to the bottom (drives auto-scroll + FAB).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      atBottomRef.current = atBottom;
      if (atBottom) setNewBelow(0);
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [containerRef.current]);

  const jumpToBottom = () => {
    setNewBelow(0);
    atBottomRef.current = true;
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // First message the reader hasn't seen — anchors the "New messages" divider.
  // Only counts OTHER people's messages: your own send is read by definition.
  const firstUnreadId = useMemo(() => {
    const cutoff = entryCutoffRef.current;
    if (!cutoff) return null;
    const hit = messages.find((m) => {
      const ms = m.createdAt?.toMillis?.() ?? 0;
      return ms > cutoff && m.senderId !== myUid;
    });
    return hit?.id || null;
  }, [messages, myUid]);

  // Who-reacted sheet: uid → display identity. Goes through applyVanguardMask
  // for the same reason every other name in this thread does — a masked mod must
  // not be unmasked just because they reacted to something.
  const resolveReactor = (uid) => {
    const live = userByUid[uid];
    const masked = applyVanguardMask(live, profile);
    return {
      uid,
      displayName: masked?.displayName || masked?.username || 'Member',
      username: masked?.username,
      avatar: masked?.avatar,
    };
  };

  // ── Shared context menu (same component DMs use) ──────────────────────
  // Right-click on desktop, long-press on touch. Deliberately NOT tap-to-open
  // like DMs: a squad message can be a poll, a video or a link preview, so a
  // plain tap has to keep reaching those. The hover toolbar stays for mouse.
  const pressTimer = useRef(null);
  const pressed = useRef(false);

  const openMsgMenu = (m, e) => {
    setContextMenu({ msgId: m.id, x: e.clientX, y: e.clientY });
  };
  const startMsgPress = (m, e) => {
    if (e.pointerType === 'mouse') return; // mouse uses right-click
    pressed.current = false;
    const { clientX, clientY } = e;
    pressTimer.current = setTimeout(() => {
      pressed.current = true;
      try { navigator.vibrate?.(10); } catch { /* not supported */ }
      setContextMenu({ msgId: m.id, x: clientX, y: clientY });
    }, 420);
  };
  const endMsgPress = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  };

  const handleReply = (m) => {
    setReplyTo({
      id: m.id, senderId: m.senderId,
      senderName: m.senderId === myUid ? 'You' : m.senderName || 'User',
      text: m.text || (m.type === 'image' ? 'Photo' : 'Media'),
    });
    setEditingMsg(null);
    inputRef.current?.focus();
  };
  const handleEdit = (m) => {
    if (m.senderId !== myUid || m.type !== 'text') return;
    setEditingMsg({ id: m.id, text: m.text });
    setInput(m.text || '');
    setReplyTo(null);
    inputRef.current?.focus();
  };
  const handlePin = async (m) => {
    await updateDoc(doc(db, 'squads', squadId, 'messages', m.id), { pinned: !m.pinned });
    await updateDoc(doc(db, 'squads', squadId), { pinnedMessageId: m.pinned ? null : m.id });
  };
  // Thanos-snap delete. Same timing model as the 1-to-1 chat:
  //   1. Confirm ("Delete for everyone?" — squad chat is shared, every delete
  //      is a delete-for-everyone).
  //   2. Await dissolveElement — it resolves the moment the dust canvases are
  //      live on the screen (the original is now opacity:0).
  //   3. Remove the message from local state SYNCHRONOUSLY so the layout
  //      collapses in lockstep with the dust drifting away. If we waited for
  //      onSnapshot to fire the 'removed' event (~200-500ms network RTT),
  //      the message slot would sit invisible-but-laid-out and the fixed-
  //      position dust canvases would end up visually misaligned.
  //   4. Delete the Firestore doc in the background. onSnapshot's later
  //      'removed' event is a no-op because the message is already gone
  //      from local state.
  const deleteMsg = async (m) => {
    const canDelete = isAdminRole || m.senderId === myUid;
    if (!canDelete) return;
    const ok = window.confirm(
      m.senderId === myUid
        ? 'Delete this message for everyone in the squad? This cannot be undone.'
        : 'Remove this member\'s message for everyone in the squad? This cannot be undone.'
    );
    if (!ok) return;
    const el = document.getElementById(`msg-${m.id}`);
    if (el) {
      try { await dissolveElement(el); } catch (err) { console.warn('Dissolve failed:', err); }
    }
    // Collapse the layout immediately — matches the dust's fixed-position
    // anchor before the chat scrolls or shifts.
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
    try {
      await deleteDoc(doc(db, 'squads', squadId, 'messages', m.id));
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const handleMediaSelect = (type, url) => {
    const map = { gifs: 'gif', stickers: 'sticker', clips: 'clip', memes: 'meme' };
    if (map[type]) sendMsg({ type: map[type], contentUrl: url });
    setShowMedia(null);
  };

  const sendPoll = () => {
    if (!pollTitle.trim()) return;
    const options = pollOptions.filter((o) => o.trim());
    if (options.length < 2) return;
    sendMsg({ type: 'poll', pollData: { title: pollTitle.trim(), options, votes: {}, totalVotes: 0, voters: [], createdAt: serverTimestamp() } });
    setShowPollModal(false); setPollTitle(''); setPollOptions(['', '']);
  };
  const handlePollVote = (msgId, idx) =>
    updateDoc(doc(db, 'squads', squadId, 'messages', msgId), {
      [`pollData.votes.${idx}`]: serverTimestamp(), 'pollData.voters': arrayUnion(myUid),
    });

  // Load the user's tournaments when they open the share modal. Lazy — we
  // don't fetch on chat mount because the modal is rarely used.
  const openTournamentShare = async () => {
    setShowTournamentModal(true);
    if (myTournaments.length > 0 || !myUid) return;
    setTournamentsLoading(true);
    try {
      const list = await getUserTournaments(myUid, 30);
      setMyTournaments(list || []);
    } catch (err) {
      console.warn('Failed to load tournaments:', err);
    }
    setTournamentsLoading(false);
  };

  // Snapshot the tournament's display fields onto the message so the embed
  // renders even if the tournament doc is later edited or deleted.
  const shareTournament = (t) => {
    // Ticketed events post an interactive rally ticket card (fans buy in to
    // support the squad). Legacy/prize-pool events keep the plain embed.
    if (t.fundingModel === 'ticketed') {
      sendMsg({
        type: 'event_ticket',
        text: `🎟 ${t.name}`,
        eventTicket: {
          tournamentId: t.id, name: t.name || 'Event', game: t.game || '',
          bannerUrl: t.bannerUrl || null,
          priceCoins: t.ticket?.priceCoins || 0, capacity: t.ticket?.capacity || 0, sold: t.ticket?.sold || 0,
        },
      });
      setShowTournamentModal(false);
      return;
    }
    const tsToMs = (v) => v?.toDate ? v.toDate().getTime() : (v?.seconds ? v.seconds * 1000 : (typeof v === 'number' ? v : null));
    sendMsg({
      type: 'tournament',
      tournament: {
        tournamentId: t.id,
        name: t.name || 'Tournament',
        game: t.game || null,
        type: t.type || null,
        bannerUrl: t.bannerUrl || null,
        startDate: tsToMs(t.startDate),
        endDate: tsToMs(t.endDate),
        prizePool: typeof t.prizePool === 'number' ? t.prizePool : null,
        entryFee: typeof t.entryFee === 'number' ? t.entryFee : null,
      },
    });
    setShowTournamentModal(false);
  };

  // Voice (press-and-hold the mic)
  const startVoice = async (e) => {
    e.preventDefault();
    setIsRecording(true); setRecordingCancel(false);
    setRecorder(await startVoiceRecording());
  };
  const endVoice = async () => {
    if (!isRecording || !recorder) { setIsRecording(false); return; }
    setIsRecording(false);
    const blob = await recorder.stop().getBlob();
    if (!recordingCancel && blob.size > 0) {
      const url = await uploadMediaFile(blob, 'squad_voice');
      sendMsg({ type: 'voice', contentUrl: url });
    }
    setRecorder(null);
  };

  const uploadAndSend = async (file, folder, type) => {
    const check = checkFileSize(file.size);
    if (!check.allowed) { setUpgradeModal({ open: true, requiredTier: check.requiredTier, message: check.message }); return; }
    const url = await uploadMediaFile(file, folder, tier, tierConfig.mediaRetentionDays);
    sendMsg({ type, contentUrl: url });
  };

  // ── Derived ──────────────────────────────────────────────────────────
  const pinnedMessage = messages.find((m) => m.pinned);
  const searchResults = searchQuery
    ? messages.filter((m) => m.text?.toLowerCase().includes(searchQuery.toLowerCase()))
    : [];
  const onlineCount = members.filter((m) => presenceVisible(m.user) && memberPresence[m.id]).length;

  const bgStyle = squadInfo?.chatBackground === 'color'
    ? { backgroundColor: squadInfo.chatBackgroundValue }
    : squadInfo?.chatBackground === 'image'
      ? { backgroundImage: `url(${squadInfo.chatBackgroundValue})`, backgroundSize: 'cover', backgroundPosition: 'center' }
      : undefined;

  const jumpTo = (msgId) => {
    const el = document.getElementById(`msg-${msgId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('msg-flash');
      setTimeout(() => el.classList.remove('msg-flash'), 1600);
    }
  };

  // ── Embeds + body ────────────────────────────────────────────────────
  // Every media message in the thread, in order — so the lightbox can page
  // between them exactly like it does in a DM.
  const lightboxItems = useMemo(() => messages
    .filter((m) => !m.deleted && m.contentUrl && ['image', 'meme', 'gif', 'giphy', 'sticker', 'video', 'clip'].includes(m.type))
    .map((m) => ({
      msgId: m.id,
      url: m.contentUrl,
      type: (m.type === 'video' || m.type === 'clip') ? 'video' : 'image',
      poster: m.posterUrl || m.thumbnailUrl,
    })), [messages]);

  const openLightbox = (msgId) => {
    const idx = lightboxItems.findIndex((it) => it.msgId === msgId);
    if (idx >= 0) setLightbox({ index: idx });
  };

  const renderEmbed = (m) => {
    if (m.type === 'tournament') return <TournamentEmbed data={m.tournament} />;
    if (m.type === 'event_ticket') {
      const et = m.eventTicket || {};
      return (
        <EventTicketCard
          variant="chat" source="squad"
          tournament={{ id: et.tournamentId, fundingModel: 'ticketed', ticket: { priceCoins: et.priceCoins, capacity: et.capacity, sold: et.sold } }}
          meta={et}
          onView={() => navigate(`/e/${et.tournamentId}`)}
        />
      );
    }
    if (m.type === 'vote') return <VotePollCard squadId={squadId} voteId={m.voteId} />;
    if (m.type === 'poll') return <SquadPollComponent pollData={m.pollData} onVote={(i) => handlePollVote(m.id, i)} />;
    if (m.type === 'voice' || m.type === 'audio') return <VoiceEmbed url={m.contentUrl} />;
    if (m.type === 'gif' || m.type === 'giphy' || m.type === 'meme')
      return (
        <div className="image-embed" style={{ position: 'relative' }}>
          <img src={m.contentUrl} alt="" style={{ cursor: 'zoom-in' }} onClick={() => openLightbox(m.id)} />
          {canSaveToGallery && <SquadSaveMediaBtn url={m.contentUrl} isVideo={false} onSave={saveSquadMedia} />}
        </div>
      );
    if (m.type === 'sticker') return (
      <div style={{ position: 'relative', width: 120, marginTop: 6 }}>
        <img src={m.contentUrl} alt="sticker" style={{ width: 120, height: 120, objectFit: 'contain' }} />
        {canSaveToGallery && <SquadSaveMediaBtn url={m.contentUrl} isVideo={false} onSave={saveSquadMedia} />}
      </div>
    );
    if (m.type === 'image') return (
      <div className="image-embed" style={{ position: 'relative' }}>
        <img src={m.contentUrl} alt="" style={{ cursor: 'zoom-in' }} onClick={() => openLightbox(m.id)} />
        {canSaveToGallery && <SquadSaveMediaBtn url={m.contentUrl} isVideo={false} onSave={saveSquadMedia} />}
      </div>
    );
    if (m.type === 'clip' || m.type === 'video')
      return (
        <div className="image-embed" style={{ position: 'relative' }}>
          <InlineVideoPlayer src={m.contentUrl} maxHeightClass="max-h-72" objectFit="contain" />
          {canSaveToGallery && <SquadSaveMediaBtn url={m.contentUrl} isVideo onSave={saveSquadMedia} />}
        </div>
      );
    if (m.type === 'file')
      return (
        <a className="link-preview" href={m.contentUrl} target="_blank" rel="noopener noreferrer">
          <div className="lp-thumb"><span className="material-symbols-outlined">description</span></div>
          <div className="lp-meta">
            <div className="lp-site">Attachment</div>
            <div className="lp-title">{m.fileName || 'File'}</div>
          </div>
        </a>
      );
    return null;
  };

  const renderBody = (m) => {
    if (m.type === 'text') {
      const yt = getYouTubeID(m.text);
      const link = !yt && extractUrl(m.text);
      return (
        <>
          <div className="msg-text" onClick={() => { if (isTauri() && m.text) setTranslateMsg(m); }}>
            <SpoilerText text={m.text} />
            {m.editedAt && <span className="msg-edited">edited</span>}
          </div>
          {yt && (
            <div className="image-embed">
              <iframe
                title="yt" width="420" height="236" style={{ display: 'block', border: 0 }}
                src={`https://www.youtube.com/embed/${yt}`} allowFullScreen
              />
            </div>
          )}
          {link && (
            <a className="link-preview" href={link} target="_blank" rel="noopener noreferrer">
              <div className="lp-thumb"><span className="material-symbols-outlined">link</span></div>
              <div className="lp-meta">
                <div className="lp-site">{(() => { try { return new URL(link).hostname; } catch { return 'link'; } })()}</div>
                <div className="lp-title">{link}</div>
              </div>
            </a>
          )}
        </>
      );
    }
    return renderEmbed(m);
  };

  // ── Render ───────────────────────────────────────────────────────────
  let lastDay = null;
  let lastSender = null;

  const main = (
    // position:relative so the jump-to-bottom FAB anchors to the chat column
    // rather than escaping to the page (.sqd .main is static in squad.css).
    <main className="main" style={{ position: 'relative' }}>
      {/* Channel header */}
      <header className="channel-header">
        <div className="channel-title">
          <span className="channel-hash">#</span>
          <span className="channel-name">{squadInfo?.name || 'Squad'}</span>
          {squadInfo?.description && (
            <>
              <span className="channel-divider" />
              <span className="channel-desc">{squadInfo.description}</span>
            </>
          )}
        </div>
        <div className="header-actions">
          <div className="member-count-chip">
            <span className="dot-online" />
            <span>{onlineCount} / {squadInfo?.memberCount || members.length} online</span>
          </div>
          {showSearch ? (
            <div className="search-input">
              <span className="material-symbols-outlined">search</span>
              <input
                autoFocus value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search messages"
              />
              <button className="icon-btn" onClick={() => { setShowSearch(false); setSearchQuery(''); }}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
          ) : (
            <button className="icon-btn" title="Search" onClick={() => setShowSearch(true)}>
              <span className="material-symbols-outlined">search</span>
            </button>
          )}
          {isAdminRole && (
            <button className="icon-btn" title="Chat background" onClick={() => setShowBackgroundModal(true)}>
              <span className="material-symbols-outlined">wallpaper</span>
            </button>
          )}
        </div>
      </header>

      {/* Pinned strip */}
      {pinnedMessage && (
        <div className="pinned-bar" onClick={() => jumpTo(pinnedMessage.id)}>
          <span className="material-symbols-outlined">push_pin</span>
          <span className="pin-label">Pinned</span>
          <span className="pin-text">
            {pinnedMessage.senderName}: {pinnedMessage.text || 'Media'}
          </span>
          <span className="pin-jump">Jump →</span>
        </div>
      )}

      {/* Messages */}
      <section className="messages" ref={containerRef} style={bgStyle}>
        {msgError && (
          <div className="day-divider" style={{ marginTop: 24 }}>
            <div className="line" />
            <div className="label" style={{ color: 'var(--ember)', background: 'rgba(240,64,96,.08)', borderColor: 'rgba(240,64,96,.25)' }}>
              {msgError}
            </div>
            <div className="line" />
          </div>
        )}
        {!msgError && messages.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 200, color: 'var(--t3)', textAlign: 'center', gap: 12, padding: 24 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 48, opacity: .45 }}>forum</span>
            <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 16, color: 'var(--t2)' }}>No messages yet</div>
            <div style={{ fontSize: 13, maxWidth: 320 }}>Be the first to say hi in #{squadInfo?.name || 'squad'}. Drop a message below to get the conversation going.</div>
          </div>
        )}
        {messages.map((m) => {
          // System messages
          if (m.type === 'system') {
            lastSender = null;
            return (
              <div className="sys-msg" key={m.id}>
                <span className="sys-pill">
                  <span className="material-symbols-outlined">info</span>{m.text}
                </span>
                <span className="sys-time">{formatTime(m.createdAt)}</span>
              </div>
            );
          }

          const dk = dayKey(m.createdAt);
          const showDay = dk !== lastDay;
          if (showDay) lastDay = dk;
          // Discord-style "grouped" collapse removed — every message renders
          // its full header (avatar + name + role + time) so the founder's
          // expectation that "every message has an avatar" holds. lastSender
          // tracking kept for future grouping if we ever revisit this.
          lastSender = m.senderId;

          const meta = roleMeta(roleByUid[m.senderId]);
          const isMatch = searchQuery && m.text?.toLowerCase().includes(searchQuery.toLowerCase());
          const dmReactions = toDmReactions(m.reactions);
          const hasReactions = Object.keys(dmReactions).length > 0;
          const canEdit = m.senderId === myUid && m.type === 'text';
          const canDelete = isAdminRole || m.senderId === myUid;
          const isMine = m.senderId === myUid;

          return (
            <div key={m.id}>
              {showDay && (
                <div className="day-divider">
                  <div className="line" /><div className="label">{dayLabel(m.createdAt)}</div><div className="line" />
                </div>
              )}
              {m.id === firstUnreadId && (
                <div className="day-divider" style={{ '--line': '#F04060' }}>
                  <div className="line" style={{ background: 'rgba(240,64,96,0.5)' }} />
                  <div className="label" style={{ color: '#F04060', borderColor: 'rgba(240,64,96,0.4)' }}>New messages</div>
                  <div className="line" style={{ background: 'rgba(240,64,96,0.5)' }} />
                </div>
              )}
              <article
                id={`msg-${m.id}`}
                className="msg"
                style={isMatch ? { background: 'rgba(180,79,255,.06)' } : undefined}
                onContextMenu={(e) => { e.preventDefault(); openMsgMenu(m, e); }}
                onPointerDown={(e) => startMsgPress(m, e)}
                onPointerUp={endMsgPress}
                onPointerLeave={endMsgPress}
                onPointerCancel={endMsgPress}
              >
                <div className="msg-avatar-slot">
                  <div className={`msg-avatar ${avatarClass(m.senderId)}`}>
                    {(() => {
                      const live = userByUid[m.senderId];
                      // Apply Vanguard mask. Inside the Vanguard squad chat,
                      // members see each other's real identities (allies).
                      // In any other squad, non-Vanguard viewers see the
                      // persona — same rule as elsewhere in the app.
                      const masked = applyVanguardMask(live, profile);
                      const url = masked?.avatar || m.senderAvatar;
                      const name = masked?.displayName || masked?.username || m.senderName;
                      return url ? <img src={url} alt="" /> : initials(name);
                    })()}
                  </div>
                </div>
                <div className="msg-time-hover">{formatTime(m.createdAt)}</div>
                <div className="msg-body">
                  {m.replyTo && (
                    <div className="quoted" onClick={() => jumpTo(m.replyTo.id)}>
                      <div className="arr" />
                      <span className="who">{m.replyTo.senderName}</span>
                      <span className="body">{m.replyTo.text || 'Media'}</span>
                    </div>
                  )}
                  <div className="msg-meta">
                    {(() => {
                      const live = userByUid[m.senderId];
                      const masked = applyVanguardMask(live, profile);
                      const vanguardRank = live?.vanguard?.rank;
                      return (
                        <>
                          <span className={`msg-name ${meta.name}`}>
                            {masked?.displayName || masked?.username || m.senderName || 'User'}
                          </span>
                          {vanguardRank && <VanguardBadge rank={vanguardRank} size={14} />}
                          <span className={`role-pill ${meta.pill}`}>
                            {meta.icon && <span className="material-symbols-outlined">{meta.icon}</span>}
                            {meta.label}
                          </span>
                          <span className="msg-time">{formatTime(m.createdAt)}</span>
                        </>
                      );
                    })()}
                  </div>
                  {renderBody(m)}
                  {hasReactions && (
                    <div className="flex items-center gap-1">
                      <ReactionBubbles
                        reactions={dmReactions}
                        chatId={squadId}
                        messageId={m.id}
                        isMe={false}
                        onToggle={(emoji) => toggleReaction(m, emoji)}
                        onShowReactors={(emoji) => setReactorsView({ reactions: dmReactions, emoji })}
                      />
                      <div className="react-add" onClick={() => setReactToMsgId(m.id)}>
                        <span className="material-symbols-outlined">add_reaction</span>
                      </div>
                    </div>
                  )}
                </div>

                {contextMenu?.msgId === m.id && (
                  <MessageContextMenu
                    chatId={squadId} messageId={m.id} message={m} isMe={isMine}
                    anchorX={contextMenu.x} anchorY={contextMenu.y}
                    onClose={() => setContextMenu(null)}
                    onReact={(emoji) => toggleReaction(m, emoji)}
                    onReply={handleReply}
                    onEdit={canEdit ? handleEdit : undefined}
                    onPin={handlePin}
                    onDelete={canDelete ? deleteMsg : undefined}
                    onTranslate={m.text ? (msg) => setTranslateMsg(msg) : undefined}
                    onSaveMedia={canSaveToGallery && m.contentUrl
                      ? () => saveSquadMedia(m.contentUrl, m.type === 'clip' || m.type === 'video')
                      : undefined}
                  />
                )}

                {/* Hover actions */}
                <div className="msg-actions">
                  <button title="React" onClick={() => setReactToMsgId(m.id)}>
                    <span className="material-symbols-outlined">add_reaction</span>
                  </button>
                  <button title="Reply" onClick={() => handleReply(m)}>
                    <span className="material-symbols-outlined">reply</span>
                  </button>
                  <div className="sep" />
                  {canEdit && (
                    <button title="Edit" onClick={() => handleEdit(m)}>
                      <span className="material-symbols-outlined">edit</span>
                    </button>
                  )}
                  <button title={m.pinned ? 'Unpin' : 'Pin'} onClick={() => handlePin(m)}>
                    <span className="material-symbols-outlined">push_pin</span>
                  </button>
                  {canDelete && (
                    <button title="Delete" onClick={() => deleteMsg(m)}>
                      <span className="material-symbols-outlined">delete</span>
                    </button>
                  )}
                </div>
              </article>
            </div>
          );
        })}
        <div ref={scrollRef} />
      </section>

      {/* Jump to bottom — shows a count when messages arrived while you were
          reading back. Same affordance the DM thread has. */}
      {newBelow > 0 && (
        <button
          onClick={jumpToBottom}
          style={{
            position: 'absolute', right: 20, bottom: 104, zIndex: 20,
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 12px', borderRadius: 999, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg, #7B1FFF, #B44FFF)', color: '#fff',
            fontSize: 12, fontWeight: 800,
            boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_downward</span>
          {newBelow} new
        </button>
      )}

      {/* Typing line */}
      {typingUsers.length > 0 && (
        <div className="typing-line">
          <span className="typing-dots"><span /><span /><span /></span>
          <span>
            <strong style={{ color: 'var(--t2)', fontWeight: 600 }}>
              {typingUsers[0]?.displayName || typingUsers[0]?.username || 'Someone'}
            </strong> is typing…
          </span>
        </div>
      )}

      {/* Composer */}
      <div className="composer">
        {(replyTo || editingMsg) && (
          <div className="reply-bar">
            <span className="material-symbols-outlined">{editingMsg ? 'edit' : 'reply'}</span>
            <span className="who">{editingMsg ? 'Editing message' : `Replying to ${replyTo?.senderName}`}</span>
            <span className="what">{editingMsg?.text || replyTo?.text}</span>
            <button className="close" onClick={() => { setReplyTo(null); setEditingMsg(null); setInput(''); }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
            </button>
          </div>
        )}
        <div className="compose-wrap">
          <div className="format-bar">
            <button className="fmt-btn" title="Bold" onClick={() => applyFormat('bold')}><span className="material-symbols-outlined">format_bold</span></button>
            <button className="fmt-btn" title="Italic" onClick={() => applyFormat('italic')}><span className="material-symbols-outlined">format_italic</span></button>
            <button className="fmt-btn" title="Strike" onClick={() => applyFormat('strike')}><span className="material-symbols-outlined">format_strikethrough</span></button>
            <div className="fmt-sep" />
            <button className="fmt-btn" title="Code" onClick={() => applyFormat('code')}><span className="material-symbols-outlined">code</span></button>
            <button className="fmt-btn" title="Spoiler" onClick={() => applyFormat('spoiler')}><span className="material-symbols-outlined">visibility_off</span></button>
            <span className="fmt-hint"><kbd>Markdown</kbd> · <kbd>||spoiler||</kbd></span>
          </div>
          <div className="compose-row">
            <label className="compose-attach" title="Attach image">
              <span className="material-symbols-outlined">add</span>
              <input
                type="file" accept="image/*" hidden
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadAndSend(f, 'squad_images', 'image'); }}
              />
            </label>
            <input
              ref={inputRef}
              className="compose-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitText(); } }}
              placeholder={editingMsg ? 'Edit message…' : `Message #${squadInfo?.name || 'squad'}`}
            />
            <div className="compose-tools">
              <button className="tool-btn" title="GIF" onClick={() => setShowMedia(showMedia ? null : 'gifs')}>
                <span className="material-symbols-outlined">gif_box</span>
              </button>
              <button className="tool-btn" title="Emoji" onClick={() => setShowEmoji((v) => !v)}>
                <span className="material-symbols-outlined">sentiment_satisfied</span>
              </button>
              <button className="tool-btn" title="Poll" onClick={() => setShowPollModal(true)}>
                <span className="material-symbols-outlined">how_to_vote</span>
              </button>
              <button className="tool-btn" title="Share tournament" onClick={openTournamentShare}>
                <span className="material-symbols-outlined">emoji_events</span>
              </button>
              <button
                className="tool-btn" title="Voice message"
                onMouseDown={startVoice} onMouseUp={endVoice} onMouseLeave={() => isRecording && endVoice()}
                onTouchStart={startVoice} onTouchEnd={endVoice}
                style={isRecording ? { color: 'var(--ember)' } : undefined}
              >
                <span className="material-symbols-outlined">{isRecording ? 'fiber_manual_record' : 'mic'}</span>
              </button>
            </div>
            <button className="send-btn" title="Send" onClick={submitText}>
              <span className="material-symbols-outlined">send</span>
            </button>
          </div>
        </div>
      </div>

      {/* Overlays */}
      {showMedia && <MediaPanel defaultTab={showMedia} onSelect={handleMediaSelect} onClose={() => setShowMedia(null)} />}
      {showEmoji && !reactToMsgId && (
        <EmojiPicker onSelect={(emoji) => setInput((p) => p + emoji)} onClose={() => setShowEmoji(false)} />
      )}
      {/* React with any emoji — the SAME picker DMs use (animated Noto, skin
          tones, recents, search), replacing the old hard-coded 6-emoji row. */}
      {reactToMsgId && (
        <EmojiPicker
          onSelect={(emoji) => {
            const msg = messages.find((x) => x.id === reactToMsgId);
            if (msg) toggleReaction(msg, emoji);
            setReactToMsgId(null);
          }}
          onClose={() => setReactToMsgId(null)}
        />
      )}

      {reactorsView && (
        <ReactorsSheet
          reactions={reactorsView.reactions}
          activeEmoji={reactorsView.emoji}
          resolveUser={resolveReactor}
          onClose={() => setReactorsView(null)}
        />
      )}

      {lightbox && (
        <MediaLightbox
          items={lightboxItems}
          startIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}

      <Modal isOpen={showPollModal} onClose={() => setShowPollModal(false)} title="Create a Poll">
        <div className="space-y-4">
          <input
            type="text" value={pollTitle} onChange={(e) => setPollTitle(e.target.value)}
            placeholder="Poll question"
            className="w-full bg-surface-2 border border-white/[0.06] rounded-xl p-3 text-sm text-text-primary focus:border-brand-violet-light focus:outline-none"
          />
          <div className="space-y-2">
            {pollOptions.map((opt, idx) => (
              <input
                key={idx} type="text" value={opt}
                onChange={(e) => { const n = [...pollOptions]; n[idx] = e.target.value; setPollOptions(n); }}
                placeholder={`Option ${idx + 1}`}
                className="w-full bg-surface-2 border border-white/[0.06] rounded-xl p-3 text-sm text-text-primary focus:border-brand-violet-light focus:outline-none"
              />
            ))}
            <button onClick={() => setPollOptions([...pollOptions, ''])} className="text-brand-violet-light text-sm font-semibold flex items-center gap-1">
              <Icon name="add" size={16} /> Add option
            </button>
          </div>
          <button onClick={sendPoll} className="w-full py-3 rounded-xl bg-brand-violet-light text-bg-dark font-bold text-sm">Create Poll</button>
        </div>
      </Modal>

      <UpgradeModal
        isOpen={upgradeModal.open}
        onClose={() => setUpgradeModal({ open: false, requiredTier: 'lite', message: '' })}
        requiredTier={upgradeModal.requiredTier}
        message={upgradeModal.message}
      />
      <BackgroundPickerModal
        isOpen={showBackgroundModal}
        onClose={() => setShowBackgroundModal(false)}
        squadId={squadId}
        currentBackground={squadInfo?.chatBackground}
        currentValue={squadInfo?.chatBackgroundValue}
      />

      {/* Share Tournament picker */}
      <Modal isOpen={showTournamentModal} onClose={() => setShowTournamentModal(false)} title="Share a Tournament">
        {tournamentsLoading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--t3)' }}>Loading…</div>
        ) : myTournaments.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '32px 24px', color: 'var(--t3)', textAlign: 'center' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 44, opacity: .45 }}>emoji_events</span>
            <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 15, color: 'var(--t1)' }}>You aren't in any tournaments</div>
            <div style={{ fontSize: 12.5, maxWidth: 320 }}>Host a tournament or join one — then come back to share it with your squad.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
            {myTournaments.map((t) => (
              <button
                key={t.id}
                onClick={() => shareTournament(t)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12,
                  background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)',
                  textAlign: 'left', cursor: 'pointer', transition: 'border-color .12s, background .12s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(180,79,255,.35)'; e.currentTarget.style.background = 'rgba(180,79,255,.06)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.06)'; e.currentTarget.style.background = 'rgba(255,255,255,.03)'; }}
              >
                <div style={{ width: 52, height: 52, borderRadius: 10, flexShrink: 0, background: t.bannerUrl ? `url(${t.bannerUrl}) center/cover` : 'linear-gradient(135deg,#2d0a5a,#7B1FFF)', display: 'grid', placeItems: 'center' }}>
                  {!t.bannerUrl && <span className="material-symbols-outlined" style={{ color: '#fff', fontSize: 22 }}>emoji_events</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'Syne', fontWeight: 700, color: '#fff', fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.name || 'Tournament'}
                  </div>
                  <div style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em', marginTop: 2 }}>
                    {t.game || 'Multi-game'}
                    {t._hosting && <span style={{ color: 'var(--gold-light)', marginLeft: 6 }}>• Hosting</span>}
                    {!t._hosting && t._joined && <span style={{ color: 'var(--violet-light)', marginLeft: 6 }}>• Joined</span>}
                  </div>
                </div>
                <span className="material-symbols-outlined" style={{ color: 'var(--violet-light)', fontSize: 18 }}>arrow_forward</span>
              </button>
            ))}
          </div>
        )}
      </Modal>
    </main>
  );

  return (
    <SquadShell
      mode="squad"
      activeId="chat"
      squadId={squadId}
      rightRail={<SquadInfoRail squad={squadInfo} members={members} />}
    >
      {main}
      {translateMsg && <TranslationSheet text={translateMsg.text} kind="message" onClose={() => setTranslateMsg(null)} />}
    </SquadShell>
  );
}
