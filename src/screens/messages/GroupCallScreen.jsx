// GroupCallScreen — ad-hoc voice/video call inside a group chat (02_MESSAGING 2.1).
//
// 1:1 DM calls stay raw WebRTC P2P (CallScreen). A GROUP call routes through the
// Pion SFU instead — a mesh would make every phone encode a stream per peer.
// Never call the SFU "Jitsi".
//
// The call doc (`calls/{chatId}`) is the RING + presence record; the media all
// rides the SFU room `call_<callId>`. Ending is status-based (`status:'ended'`),
// matching CallScreen — the rules deny delete on calls docs, so a call must
// never be ended by deleting it.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, onSnapshot, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import {
  joinGroupCall, leaveGroupCall, toggleCallMic, toggleCallCamera,
  subscribeGroupCall, getGroupCallState, MAX_CALL_VIDEO,
} from '../../utils/groupCall';
import { getUser } from '../../firebase/firestore';
import UserAvatar from '../../components/UserAvatar';
import Icon from '../../components/Icon';
import { useKeepAwake } from '../../utils/keepAwake';
import UserName from '../../components/UserName';

// A <video> element can't take a MediaStream through a src attribute — it has to
// be assigned to .srcObject in an effect.
function VideoTile({ stream, muted = false, mirror = false }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && stream) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className={`w-full h-full object-cover ${mirror ? 'scale-x-[-1]' : ''}`}
    />
  );
}

function Tile({ name, avatar, stream, speaking, muted, isMe, camOn }) {
  return (
    <div className={`relative rounded-2xl overflow-hidden bg-surface-2 aspect-[3/4] sm:aspect-video transition-shadow ${
      speaking ? 'ring-2 ring-brand-violet shadow-[0_0_20px_rgba(123,31,255,0.35)]' : 'ring-1 ring-white/[0.06]'
    }`}>
      {stream && camOn ? (
        <VideoTile stream={stream} muted={isMe} mirror={isMe} />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <UserAvatar src={avatar} size={64} />
        </div>
      )}
      <div className="absolute bottom-0 inset-x-0 px-2 py-1.5 bg-gradient-to-t from-black/70 to-transparent flex items-center gap-1">
        <span className="text-[11px] font-semibold text-white truncate flex-1">{isMe ? 'You' : name}</span>
        {muted && <Icon name="mic_off" size={13} className="text-white/70" />}
      </div>
    </div>
  );
}

export default function GroupCallScreen() {
  const { callId } = useParams();
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const navigate = useNavigate();

  const [call, setCall] = useState(null);
  const [cs, setCs] = useState(getGroupCallState());
  const [profiles, setProfiles] = useState({});
  const joinedRef = useRef(false);

  useEffect(() => subscribeGroupCall(setCs), []);
  useKeepAwake(cs.phase === 'live');

  // The call doc: who's invited, who's here, and whether it's over.
  useEffect(() => {
    if (!callId) return undefined;
    return onSnapshot(doc(db, 'calls', callId), (snap) => {
      if (!snap.exists()) { setCall(null); return; }
      setCall({ id: snap.id, ...snap.data() });
    });
  }, [callId]);

  // Join once, on mount. `video` comes from how the call was started.
  useEffect(() => {
    if (!callId || !currentUser || joinedRef.current || !call) return;
    joinedRef.current = true;
    joinGroupCall(callId, currentUser, {
      chatId: call.chatId || callId,
      title: call.groupName || 'Group call',
      video: call.type === 'video',
    });
    // Mark myself present. Deliberately does NOT set status:'active' — a group
    // call stays 'ringing' for the whole time it's live, because members who
    // haven't answered yet must keep being rung. (The ring is suppressed for
    // anyone already in `activeUids`, so joining stops YOUR ring, not theirs.)
    updateDoc(doc(db, 'calls', callId), {
      activeUids: arrayUnion(currentUser.uid),
    }).catch(() => {/* best effort */});
  }, [callId, currentUser, call]);

  // Leaving the screen leaves the call. (Unlike voice channels, which
  // deliberately survive navigation — a call is not a place you browse from.)
  // The LAST person out ends the call, so an empty room stops ringing everyone.
  const activeRef = useRef([]);
  activeRef.current = call?.activeUids || [];
  useEffect(() => () => {
    leaveGroupCall();
    const uid = auth.currentUser?.uid;
    if (!uid || !callId) return;
    const remaining = activeRef.current.filter(u => u !== uid);
    updateDoc(doc(db, 'calls', callId), {
      activeUids: arrayRemove(uid),
      ...(remaining.length === 0 ? { status: 'ended' } : {}),
    }).catch(() => {});
  }, [callId]);

  // Somebody ended it for everyone.
  useEffect(() => {
    if (call?.status === 'ended') {
      showToast?.('Call ended', 'info');
      navigate(call.chatId ? `/messages/${call.chatId}` : '/messages', { replace: true });
    }
  }, [call?.status, call?.chatId, navigate, showToast]);

  // Resolve display names/avatars for everyone with a track in the room.
  const peerUids = useMemo(
    () => [...new Set(Object.values(cs.peers).map(p => p.uid).filter(Boolean))],
    [cs.peers],
  );
  useEffect(() => {
    const missing = peerUids.filter(u => !profiles[u]);
    if (!missing.length) return;
    Promise.all(missing.map(u => getUser(u).catch(() => null))).then((rows) => {
      const next = {};
      rows.forEach((r, i) => { if (r) next[missing[i]] = r; });
      if (Object.keys(next).length) setProfiles(p => ({ ...p, ...next }));
    });
  }, [peerUids, profiles]);

  const hangUp = async () => {
    await leaveGroupCall();
    navigate(call?.chatId ? `/messages/${call.chatId}` : '/messages', { replace: true });
  };

  // Ending FOR EVERYONE is the group-chat admin/starter's call; anyone else just
  // leaves. Status-based, never delete (rules deny it).
  const endForAll = async () => {
    try { await updateDoc(doc(db, 'calls', callId), { status: 'ended', activeUids: [] }); } catch {/* ignore */}
    await hangUp();
  };

  const peerList = Object.values(cs.peers);
  const videoCount = (cs.camOn ? 1 : 0) + peerList.filter(p => p.video).length;

  return (
    <div className="fixed inset-0 z-[100] bg-bg-dark flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top,0px)' }}>
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={hangUp} className="w-9 h-9 rounded-full bg-white/[0.06] flex items-center justify-center text-white">
          <Icon name="expand_more" size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-white truncate">{call?.groupName || 'Group call'}</p>
          <p className="text-[11px] text-text-muted">
            {cs.phase === 'connecting' && 'Connecting…'}
            {cs.phase === 'live' && `${peerList.length + 1} in call`}
            {cs.phase === 'error' && (cs.errorMsg || 'Connection error')}
            {cs.phase === 'idle' && 'Not connected'}
          </p>
        </div>
        {videoCount >= MAX_CALL_VIDEO && (
          <span className="text-[10px] text-text-muted px-2 py-1 rounded-full bg-white/[0.06]">
            {MAX_CALL_VIDEO} cameras max
          </span>
        )}
      </header>

      {cs.errorMsg && cs.phase === 'live' && (
        <p className="mx-4 mb-2 text-[11px] text-brand-gold bg-brand-gold/10 border border-brand-gold/20 rounded-lg px-3 py-2">
          {cs.errorMsg}
        </p>
      )}

      <main className="flex-1 overflow-y-auto px-3 pb-4">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
          <Tile
            isMe
            name="You"
            avatar={currentUser?.photoURL}
            stream={cs.localStream}
            camOn={cs.camOn}
            speaking={!!cs.speaking.me}
            muted={!cs.micOn}
          />
          {peerList.map((p) => {
            const prof = profiles[p.uid];
            return (
              <Tile
                key={p.peerId}
                name={prof?.displayName || prof?.username || 'Member'}
                avatar={prof?.avatar || prof?.photoURL}
                stream={p.stream}
                camOn={!!p.video}
                speaking={!!cs.speaking[p.peerId]}
                muted={p.audio === false}
              />
            );
          })}
        </div>
        {cs.phase === 'live' && peerList.length === 0 && (
          <p className="text-center text-xs text-text-muted mt-8">Waiting for others to join…</p>
        )}
      </main>

      <footer
        className="flex items-center justify-center gap-4 py-5"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 1.25rem)' }}
      >
        <button
          onClick={toggleCallMic}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
            cs.micOn ? 'bg-white/[0.1] text-white' : 'bg-white text-bg-dark'
          }`}
        >
          <Icon name={cs.micOn ? 'mic' : 'mic_off'} size={24} />
        </button>
        <button
          onClick={toggleCallCamera}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
            cs.camOn ? 'bg-white text-bg-dark' : 'bg-white/[0.1] text-white'
          }`}
        >
          <Icon name={cs.camOn ? 'videocam' : 'videocam_off'} size={24} />
        </button>
        <button
          onClick={hangUp}
          className="w-14 h-14 rounded-full bg-brand-ember text-white flex items-center justify-center active:scale-90 transition-transform"
        >
          <Icon name="call_end" size={26} />
        </button>
        {call?.callerId === currentUser?.uid && (
          <button
            onClick={endForAll}
            className="px-3 h-14 rounded-full bg-white/[0.06] text-[11px] font-bold text-text-secondary hover:text-white"
          >
            End for all
          </button>
        )}
      </footer>
    </div>
  );
}
