import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, onSnapshot, updateDoc, doc, deleteField } from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { getUser, purchaseContentAccess } from '../firebase/firestore';
import { useAuth } from '../context/AuthContext';
import Icon from './Icon';
import UserAvatar from './UserAvatar';
import { SHARE_IN_KEY, setSharedMedia, setSharedFile } from '../utils/shareIn';

export default function IncomingCallOverlay() {
  const [incomingCall, setIncomingCall] = useState(null);
  const [caller, setCaller] = useState(null);
  const [joining, setJoining] = useState(false);
  const [declining, setDeclining] = useState(false);
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const shownIdRef = useRef(null);
  // Group calls dismissed on THIS device. A group call's doc keeps ringing for
  // the others, so without this, declining would immediately re-ring me.
  const dismissedRef = useRef(new Set());

  // Listen for incoming calls. Two fixes vs the old version:
  //  (1) Auth timing — Firebase auth is async, so reading auth.currentUser at
  //      mount with [] deps meant the listener almost never attached. We depend
  //      on the context uid so it attaches once auth resolves.
  //  (2) Repeat calls — call docs reuse the conversation id (calls/{chatId}),
  //      so a second call to the same person is a MODIFIED doc, not an ADDED
  //      one. The old `change.type === 'added'` handler only caught the very
  //      first call ever. We now scan ALL ringing docs each snapshot.
  useEffect(() => {
    const uid = currentUser?.uid;
    if (!uid) return undefined;

    // Filter by participant (no worldwide scan).
    const q = query(
      collection(db, 'calls'),
      where('participants', 'array-contains', uid),
      where('status', '==', 'ringing')
    );

    const unsub = onSnapshot(q, async (snap) => {
      const now = Date.now();
      const candidate = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .find((c) => {
          if (c.callerId === uid) return false;
          if (!c.participants?.includes(uid)) return false;
          // A GROUP call stays 'ringing' for its whole life (so members who
          // haven't answered still get rung). Two suppressions keep that from
          // ringing the wrong people: anyone already IN the call, and anyone
          // who dismissed this one on this device.
          if ((c.activeUids || []).includes(uid)) return false;
          if (dismissedRef.current.has(c.id)) return false;
          const created = c.createdAt?.toDate ? c.createdAt.toDate().getTime() : new Date(c.createdAt).getTime();
          return Number.isFinite(created) ? (now - created <= 30000) : true;
        });

      if (candidate) {
        if (shownIdRef.current !== candidate.id) {
          shownIdRef.current = candidate.id;
          setIncomingCall(candidate);
          const callerData = await getUser(candidate.callerId).catch(() => null);
          setCaller(callerData);
        }
      } else {
        shownIdRef.current = null;
        setIncomingCall(null);
        setCaller(null);
      }
    });

    return () => unsub();
  }, [currentUser?.uid]);

  // Ringtone while an incoming call is showing. Loops an existing chime
  // (drop a dedicated /sounds/ringtone.mp3 in to replace it). Browsers may
  // block autoplay until the user has interacted with the page once — after
  // any tap in the session it rings fine.
  useEffect(() => {
    if (!incomingCall) return undefined;
    const audio = new Audio('/sounds/ringtone.mp3');
    audio.loop = true;
    audio.volume = 0.85;
    // Fall back to an existing sound if no dedicated ringtone file is present.
    audio.addEventListener('error', () => {
      audio.src = '/sounds/social.mp3';
      audio.play().catch(() => {});
    }, { once: true });
    audio.play().catch(() => {});
    return () => { try { audio.pause(); audio.currentTime = 0; } catch { /* ignore */ } };
  }, [incomingCall]);

  // Auto-timeout after 30s
  useEffect(() => {
    if (!incomingCall) return;
    const timer = setTimeout(() => {
      handleDecline();
    }, 30000);
    return () => clearTimeout(timer);
  }, [incomingCall]);

  // Listen for caller hangup
  useEffect(() => {
    if (!incomingCall) return;
    const unsub = onSnapshot(doc(db, 'calls', incomingCall.id), (snap) => {
      if (!snap.exists() || snap.data()?.status === 'ended') {
        setIncomingCall(null);
        setCaller(null);
      }
    });
    return () => unsub();
  }, [incomingCall]);

  // Native bridge (P5). The Android shell shows the system call UI for a
  // backgrounded/closed app and dispatches the user's choice here, where
  // Firebase Auth + the WebRTC session live. Also handles generic
  // notification-tap routing from the native FCM service.
  useEffect(() => {
    const onCallAction = (e) => {
      const d = e?.detail || {};
      const callId = d.callId;
      if (!callId) return;
      if (d.action === 'answer') {
        // The native shell only knows callId/callType, not whether it's a group
        // call — so resolve that from the doc we're already showing (or the
        // push's own flag) before choosing the SFU vs P2P route.
        const isGroup = d.isGroup === true || d.isGroup === 'true' || incomingCall?.isGroup === true;
        navigate(isGroup
          ? `/group-call/${callId}`
          : `/call/${callId}/${d.callType || 'audio'}?role=callee`);
        setIncomingCall(null);
        setCaller(null);
      } else if (d.action === 'decline') {
        const isGroup = d.isGroup === true || d.isGroup === 'true' || incomingCall?.isGroup === true;
        if (isGroup) {
          // Declining a group call is me stepping out, not ending it for the
          // group — never write status:'ended' here.
          dismissedRef.current.add(callId);
        } else {
          updateDoc(doc(db, 'calls', callId), {
            status: 'ended',
            declinedBy: auth.currentUser?.uid || null,
          }).catch(() => {});
        }
        shownIdRef.current = null;
        setIncomingCall(null);
        setCaller(null);
      }
    };
    const onNavigate = (e) => {
      const route = e?.detail;
      if (route && typeof route === 'string') navigate(route);
    };
    // Share target: another app shared text/a link into Vergr. There's no
    // composer ROUTE that takes a prefill (CreateComposer is a modal), but the
    // chat thread already honours ?prefill= — so stash the text, send the user
    // to the inbox to pick a chat, and the thread picks it up on open.
    const onShareIn = (e) => {
      const text = e?.detail;
      if (!text || typeof text !== 'string') return;
      try { sessionStorage.setItem(SHARE_IN_KEY, text); } catch { /* private mode */ }
      navigate('/messages?share=1');
    };
    // A photo/video shared in from another app. Kotlin already copied the bytes
    // into our cache; we just carry the descriptor until a chat is picked.
    const onShareMedia = (e) => {
      const m = e?.detail;
      if (!m?.path) return;
      setSharedMedia(m);
      navigate('/messages?share=1');
    };
    // A non-media FILE shared in (WhatsApp chat export .txt/.zip) → the
    // chat-import flow, not the chat picker.
    const onShareFile = (e) => {
      const m = e?.detail;
      if (!m?.path) return;
      setSharedFile(m);
      navigate('/messages/import');
    };
    // "Mark as read" tapped on a notification. The native shell has no Firebase
    // Auth, so it hands the conversation id here and WE do the write. Does not
    // navigate — the app is about to drop back to the background.
    const onMarkRead = (e) => {
      const convoId = e?.detail;
      const uid = auth.currentUser?.uid;
      if (!convoId || typeof convoId !== 'string' || !uid) return;
      updateDoc(doc(db, 'conversations', convoId), {
        [`unreadCount.${uid}`]: 0,
        [`mentions.${uid}`]: deleteField(),
      }).catch((err) => console.error('Mark-as-read failed:', err));
    };
    window.addEventListener('vergr:native-call-action', onCallAction);
    window.addEventListener('vergr:native-navigate', onNavigate);
    window.addEventListener('vergr:native-share-in', onShareIn);
    window.addEventListener('vergr:native-share-media', onShareMedia);
    window.addEventListener('vergr:native-share-file', onShareFile);
    window.addEventListener('vergr:native-mark-read', onMarkRead);
    return () => {
      window.removeEventListener('vergr:native-call-action', onCallAction);
      window.removeEventListener('vergr:native-navigate', onNavigate);
      window.removeEventListener('vergr:native-share-in', onShareIn);
      window.removeEventListener('vergr:native-share-media', onShareMedia);
      window.removeEventListener('vergr:native-share-file', onShareFile);
      window.removeEventListener('vergr:native-mark-read', onMarkRead);
    };
    // incomingCall is read inside the handler (to tell a group call from a 1:1),
    // so it must be a dep — otherwise the listener closes over a stale null.
  }, [navigate, incomingCall]);

  // Group calls run on the SFU (/group-call); 1:1 stays raw WebRTC P2P (/call).
  //
  // A PAID session is bought HERE, before connecting. The price is written on
  // the call doc but is not trusted: purchaseAccess re-reads it server-side, and
  // the deterministic entitlement id means answering twice cannot charge twice.
  const handleAccept = async () => {
    if (!incomingCall || joining) return;
    const price = Math.floor(incomingCall.priceCoins || 0);

    if (price > 0 && incomingCall.callerId !== auth.currentUser?.uid) {
      setJoining(true);
      try {
        await purchaseContentAccess('call', incomingCall.id);
      } catch (err) {
        setJoining(false);
        // Do NOT connect on a failed payment. The caller set a price; joining
        // anyway hands the session away for nothing.
        alert(err?.message || 'Could not pay to join this session.');
        return;
      }
      setJoining(false);
    }

    navigate(incomingCall.isGroup
      ? `/group-call/${incomingCall.id}`
      : `/call/${incomingCall.id}/${incomingCall.type || 'audio'}?role=callee`);
    setIncomingCall(null);
    setCaller(null);
  };

  const handleDecline = async () => {
    if (!incomingCall || declining) return;
    // Declining a GROUP call must not end it for everyone else — it's just me
    // stepping out, so dismiss locally and leave the call ringing/running.
    if (incomingCall.isGroup) {
      dismissedRef.current.add(incomingCall.id);
      shownIdRef.current = null;
      setIncomingCall(null);
      setCaller(null);
      return;
    }
    setDeclining(true);
    try {
      await updateDoc(doc(db, 'calls', incomingCall.id), { status: 'ended', declinedBy: auth.currentUser?.uid });
    } catch (err) { console.error(err); }
    setIncomingCall(null);
    setCaller(null);
    setDeclining(false);
  };

  if (!incomingCall) return null;

  const isVideo = incomingCall.type === 'video';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-xl" />

      {/* Call card */}
      <div className="relative z-10 flex flex-col items-center px-8 py-12 max-w-sm w-full mx-4">
        {/* Animated rings */}
        <div className="relative mb-8">
          <div className="absolute inset-0 w-32 h-32 -m-4 rounded-full border-2 border-brand-violet/20 animate-ping" style={{ animationDuration: '2s' }} />
          <div className="absolute inset-0 w-28 h-28 -m-2 rounded-full border border-brand-violet/30 animate-ping" style={{ animationDuration: '2.5s', animationDelay: '0.5s' }} />
          <div className="absolute inset-0 w-36 h-36 -m-6 rounded-full border border-brand-violet/10 animate-ping" style={{ animationDuration: '3s', animationDelay: '1s' }} />
          <UserAvatar src={caller?.avatar || incomingCall.callerAvatar} size={96} />
        </div>

        {/* Caller info. For a group call the GROUP is the thing being joined,
            so lead with its name and put the starter underneath. */}
        <h2 className="font-syne text-2xl font-bold text-text-primary mb-1">
          {incomingCall.isGroup
            ? (incomingCall.groupName || 'Group call')
            : (caller?.displayName || incomingCall.callerName || 'Unknown')}
        </h2>
        <p className="text-brand-violet-light text-sm font-dmmono mb-1">
          {incomingCall.isGroup
            ? `${caller?.displayName || incomingCall.callerName || 'Someone'} started it`
            : `@${caller?.username || 'user'}`}
        </p>
        <div className="flex items-center gap-2 mb-10">
          <Icon name={incomingCall.isGroup ? 'groups' : (isVideo ? 'videocam' : 'call')} size={16} className="text-text-muted" />
          <p className="text-text-muted text-sm animate-pulse">
            {incomingCall.isGroup
              ? `Group ${isVideo ? 'video' : 'voice'} call...`
              : `Incoming ${isVideo ? 'video' : 'audio'} call...`}
          </p>
        </div>

        {/* Accept / Decline buttons */}
        <div className="flex items-center gap-10">
          {/* Decline */}
          <div className="flex flex-col items-center gap-2">
            <button onClick={handleDecline} disabled={declining}
              className="w-16 h-16 rounded-full bg-brand-ember flex items-center justify-center  hover:scale-105 active:scale-95 transition-all">
              <Icon name="call_end" size={28} className="text-white" />
            </button>
            <span className="text-text-muted text-xs font-semibold">Decline</span>
          </div>

          {/* Accept */}
          <div className="flex flex-col items-center gap-2">
            <button onClick={handleAccept}
              className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center  hover:scale-105 active:scale-95 transition-all">
              <Icon name={isVideo ? 'videocam' : 'call'} size={28} className="text-white" />
            </button>
            <span className="text-text-muted text-xs font-semibold">
              {joining ? 'Joining…' : (incomingCall?.priceCoins > 0 && incomingCall?.callerId !== auth.currentUser?.uid
                ? `Join · ${Number(incomingCall.priceCoins).toLocaleString()}c`
                : 'Accept')}
            </span>
          </div>
        </div>

        {/* VERGR branding.
            ⚠⚠ THE P2P CLAIM IS ONLY TRUE OF A 1:1, AND IT USED TO PRINT UNDER
            EVERY RING INCLUDING A GROUP ONE. A 1:1 really is raw WebRTC
            peer-to-peer (Google STUN, self-hosted coturn only as a fallback), so
            the line is accurate there. A GROUP call is routed through our own
            Pion SFU, which terminates and re-encrypts each hop — so we can see
            it, and "Encrypted P2P" was a specific security claim the call did
            not meet. That is a bug, not copy, and it is exactly the kind of
            sentence a user would reasonably rely on. */}
        <p className="text-text-muted/30 text-[9px] font-dmmono uppercase tracking-[0.3em] mt-12">
          {incomingCall.isGroup ? 'VERGR · Group Call' : 'VERGR · Encrypted P2P Call'}
        </p>
      </div>
    </div>
  );
}
