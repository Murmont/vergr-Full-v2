// VoiceChannelScreen — user-created voice room (Discord-style).
//
// Routes: /messages/voice/:channelId
// Auth model:
//   - Owner can always join.
//   - Public channels: anyone authenticated can join.
//   - Private channels: only allowedUserIds can join. SFU enforces this
//     server-side, we also gate the UI before connecting.
//
// Owner-only controls: invite members, leave + delete the channel.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { onSnapshot, doc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { StackSkeleton } from '../../components/skeletons/GlassSkeletons';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import {
  joinVoiceChannel, leaveVoiceChannel, toggleVoiceMic,
  subscribeVoiceSession, getVoiceSessionState, setPeerVolume, getPeerVolume,
} from '../../utils/voiceSession';
import { getUser, deleteVoiceChannel, updateVoiceChannelMembers, kickFromVoiceChannel } from '../../firebase/firestore';
import TopBar from '../../components/TopBar';
import { IS_NATIVE_BUILD } from '../../utils/platform';
import UserAvatar from '../../components/UserAvatar';
import Icon from '../../components/Icon';
import InviteVoiceChannelModal from '../../components/InviteVoiceChannelModal';

export default function VoiceChannelScreen() {
  const { slug: channelId } = useParams(); // route param historically named slug
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();

  const [channel, setChannel] = useState(null);
  const [channelLoaded, setChannelLoaded] = useState(false);
  const [profiles, setProfiles] = useState({});
  const [showInvite, setShowInvite] = useState(false);
  // Session state lives in the voiceSession SINGLETON (survives navigation —
  // Discord semantics). This screen is just a view over it; the floating
  // VoiceSessionPill is the other view.
  const [vs, setVs] = useState(getVoiceSessionState());
  useEffect(() => subscribeVoiceSession(setVs), []);

  const sessionIsHere = vs.channelId === channelId;
  const phase = sessionIsHere ? vs.phase : 'connecting';
  const errorMsg = sessionIsHere ? vs.errorMsg : null;
  const micOn = vs.micOn;
  const peers = sessionIsHere ? vs.peers : {};
  const speaking = sessionIsHere ? (vs.speaking || {}) : {};

  const isOwner = !!(channel && currentUser && channel.ownerId === currentUser.uid);

  // ---------- Subscribe to channel doc ----------
  useEffect(() => {
    if (!channelId) return;
    const unsub = onSnapshot(doc(db, 'voice_channels', channelId), (snap) => {
      if (snap.exists()) setChannel({ id: snap.id, ...snap.data() });
      else setChannel(null);
      setChannelLoaded(true);
    });
    return () => unsub();
  }, [channelId]);

  // ---------- Authorization gate (client-side; SFU also enforces) ----------
  const authorized = useMemo(() => {
    if (!channelLoaded) return null;       // pending
    if (!channel) return false;             // doesn't exist
    if (!currentUser) return false;
    if ((channel.bannedUserIds || []).includes(currentUser.uid)) return false; // kicked
    if (channel.visibility === 'public') return true;
    if (channel.ownerId === currentUser.uid) return true;
    return (channel.allowedUserIds || []).includes(currentUser.uid);
  }, [channel, channelLoaded, currentUser]);

  // Kicked/removed WHILE connected: the channel-doc subscription notices and
  // the client leaves (the SFU has no server-side kick; rules stop rejoin).
  useEffect(() => {
    if (!channel || !currentUser || !sessionIsHere) return;
    const uid = currentUser.uid;
    const banned = (channel.bannedUserIds || []).includes(uid);
    const droppedFromPrivate = channel.visibility === 'private'
      && channel.ownerId !== uid
      && !(channel.allowedUserIds || []).includes(uid);
    if (banned || droppedFromPrivate) {
      leaveVoiceChannel();
      showToast('You were removed from this channel', 'error');
      navigate('/messages');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel?.bannedUserIds, channel?.allowedUserIds, sessionIsHere]);

  // "X joined" toast: fires when a NEW peer appears while we're live.
  const prevPeerIdsRef = useRef(new Set());
  useEffect(() => {
    if (!sessionIsHere || phase !== 'live') { prevPeerIdsRef.current = new Set(Object.keys(peers)); return; }
    const cur = new Set(Object.keys(peers));
    for (const pid of cur) {
      if (!prevPeerIdsRef.current.has(pid) && prevPeerIdsRef.current.size > 0) {
        const u = peers[pid]?.uid ? profiles[peers[pid].uid] : null;
        showToast(`${u?.displayName || u?.username || 'Someone'} joined`, 'success');
      }
    }
    prevPeerIdsRef.current = cur;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peers, phase, sessionIsHere]);

  // ---------- Fetch profile names for peers ----------
  useEffect(() => {
    const missing = Object.values(peers).map((p) => p.uid).filter((uid) => uid && !profiles[uid]);
    if (!missing.length) return;
    let cancelled = false;
    (async () => {
      const updates = {};
      for (const uid of [...new Set(missing)]) {
        try {
          const u = await getUser(uid);
          if (u) updates[uid] = u;
        } catch (e) { /* ignore */ }
      }
      if (!cancelled && Object.keys(updates).length) {
        setProfiles((p) => ({ ...p, ...updates }));
      }
    })();
    return () => { cancelled = true; };
  }, [peers, profiles]);

  // ---------- Join via the singleton (NO disconnect on unmount — the
  // session persists across navigation; the floating pill owns it) ----------
  useEffect(() => {
    if (authorized !== true || !channel || !currentUser) return;
    joinVoiceChannel(channel, currentUser);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized, channel?.id, currentUser]);

  const handleToggleMic = () => toggleVoiceMic();

  const handleLeave = async () => {
    await leaveVoiceChannel();
    navigate('/messages');
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this voice channel? This can\'t be undone.')) return;
    try {
      await leaveVoiceChannel();
      await deleteVoiceChannel(channelId);
      showToast('Channel deleted', 'success');
      navigate('/messages');
    } catch (err) {
      showToast(err.message || 'Failed to delete', 'error');
    }
  };

  const handleSaveInvites = async (uids) => {
    try {
      await updateVoiceChannelMembers(channelId, uids);
      showToast('Members updated', 'success');
      setShowInvite(false);
    } catch (err) {
      showToast(err.message || 'Failed to update', 'error');
    }
  };

  const peerArr = useMemo(() => Object.values(peers), [peers]);

  // ---------- Render states ----------
  if (!channelLoaded) {
    return (
      <div className="flex flex-col h-full bg-bg-dark">
        <TopBar title="Voice Channel" showBack />
        <div className="flex-1"><StackSkeleton rows={4} height={56} /></div>
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="flex flex-col h-full bg-bg-dark">
        <TopBar title="Voice Channel" showBack />
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <Icon name="error_outline" size={42} className="text-text-muted/40 mb-3" />
          <p className="text-text-primary font-bold">Channel not found</p>
          <p className="text-text-muted text-sm mt-1">It may have been deleted.</p>
        </div>
      </div>
    );
  }

  if (authorized === false) {
    return (
      <div className="flex flex-col h-full bg-bg-dark">
        <TopBar title={channel.name} showBack />
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <Icon name="lock" size={42} className="text-text-muted/40 mb-3" />
          <p className="text-text-primary font-bold">This is a private channel</p>
          <p className="text-text-muted text-sm mt-1">Only invited members can join.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-bg-dark">
      <TopBar
        title={channel.name}
        showBack
        actions={
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                navigator.clipboard?.writeText(`https://vergr.app/messages/voice/${channelId}`);
                showToast('Invite link copied', 'success');
              }}
              className="p-2 rounded-lg hover:bg-white/[0.06] text-text-secondary"
              title="Copy invite link"
            >
              <Icon name="link" size={18} />
            </button>
            {isOwner && (
              <>
                <button
                  onClick={() => setShowInvite(true)}
                  className="p-2 rounded-lg hover:bg-white/[0.06] text-text-secondary"
                  title="Invite members"
                >
                  <Icon name="person_add" size={18} />
                </button>
                <button
                  onClick={handleDelete}
                  className="p-2 rounded-lg hover:bg-brand-ember/15 text-text-secondary hover:text-brand-ember"
                  title="Delete channel"
                >
                  <Icon name="delete" size={18} />
                </button>
              </>
            )}
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-14 h-14 rounded-2xl bg-brand-violet/15 border border-brand-violet/30 flex items-center justify-center">
              <Icon name={channel.visibility === 'private' ? 'lock' : 'volume_up'} size={28} className="text-brand-violet" />
            </div>
            <div>
              <h1 className="font-syne text-2xl font-extrabold text-text-primary">{channel.name}</h1>
              <p className="text-text-muted text-sm">
                {phase === 'connecting' && 'Connecting…'}
                {phase === 'live' && `${peerArr.length + 1} in channel · ${channel.visibility === 'private' ? 'Private' : 'Public'}`}
                {phase === 'error' && (errorMsg || 'Connection error')}
              </p>
            </div>
          </div>

          <div className="rounded-2xl bg-surface-1 border border-white/[0.06] p-4">
            <div className="text-[10px] font-dmmono uppercase tracking-[0.14em] text-text-muted mb-3">
              Connected ({peerArr.length + 1})
            </div>
            <div className={`grid gap-3 ${IS_NATIVE_BUILD ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-3'}`}>
              <div className={`flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border transition-colors ${speaking.me ? 'border-green-400/70 shadow-[0_0_10px_rgba(74,222,128,0.25)]' : 'border-brand-violet/30'}`}>
                <div className={`rounded-full transition-shadow ${speaking.me ? 'ring-2 ring-green-400' : ''}`}>
                  <UserAvatar src={profile?.avatar} size={36} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-text-primary truncate">
                    {profile?.displayName || profile?.username || 'You'} (you)
                  </div>
                  <div className={`text-[11px] ${speaking.me ? 'text-green-400' : 'text-brand-violet-light'}`}>{speaking.me ? 'Speaking…' : micOn ? 'Mic on' : 'Muted'}</div>
                </div>
                <Icon name={micOn ? 'mic' : 'mic_off'} size={18} className={micOn ? 'text-brand-violet-light' : 'text-text-muted'} />
              </div>

              {peerArr.map((p) => {
                const u = p.uid ? profiles[p.uid] : null;
                const isSpeaking = !!speaking[p.peerId];
                return (
                  <div key={p.peerId} className={`flex flex-col gap-2 p-3 rounded-xl bg-white/[0.02] border transition-colors ${isSpeaking ? 'border-green-400/70 shadow-[0_0_10px_rgba(74,222,128,0.25)]' : 'border-white/[0.05]'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`rounded-full transition-shadow ${isSpeaking ? 'ring-2 ring-green-400' : ''}`}>
                        <UserAvatar src={u?.avatar} size={36} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-text-primary truncate">
                          {u?.displayName || u?.username || 'Member'}
                        </div>
                        <div className={`text-[11px] ${isSpeaking ? 'text-green-400' : 'text-text-muted'}`}>{isSpeaking ? 'Speaking…' : p.audio ? 'Connected' : 'Joining…'}</div>
                      </div>
                      <Icon name={p.audio ? 'mic' : 'mic_off'} size={18} className={p.audio ? 'text-brand-violet-light' : 'text-text-muted/50'} />
                      {isOwner && p.uid && (
                        <button
                          onClick={async () => {
                            if (!window.confirm(`Remove ${u?.displayName || u?.username || 'this member'} from the channel?`)) return;
                            try { await kickFromVoiceChannel(channelId, p.uid); showToast('Member removed', 'success'); }
                            catch (err) { showToast(err.message || 'Failed', 'error'); }
                          }}
                          className="w-7 h-7 rounded-full flex items-center justify-center text-text-muted hover:text-brand-ember hover:bg-brand-ember/10"
                          title="Remove from channel"
                        >
                          <Icon name="person_remove" size={15} />
                        </button>
                      )}
                    </div>
                    {/* Local playback volume — only affects what YOU hear */}
                    <div className="flex items-center gap-2">
                      <Icon name="volume_down" size={14} className="text-text-muted shrink-0" />
                      <input
                        type="range" min="0" max="100" defaultValue={Math.round(getPeerVolume(p.peerId) * 100)}
                        onChange={(e) => setPeerVolume(p.peerId, Number(e.target.value) / 100)}
                        className="flex-1 h-1 accent-[#B44FFF]"
                        aria-label="Member volume"
                      />
                      <Icon name="volume_up" size={14} className="text-text-muted shrink-0" />
                    </div>
                  </div>
                );
              })}
            </div>

            {phase === 'live' && peerArr.length === 0 && (
              <p className="text-text-muted text-xs text-center mt-4">
                You're the only one here. {isOwner && channel.visibility === 'private' && 'Invite someone via the people icon up top.'}
              </p>
            )}
          </div>

          {phase === 'error' && (
            <div className="mt-4 p-4 rounded-xl bg-brand-ember/10 border border-brand-ember/30">
              <p className="text-brand-ember text-sm">{errorMsg}</p>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-white/[0.06] bg-surface-1/95 backdrop-blur p-4">
        <div className="max-w-3xl mx-auto flex items-center justify-center gap-3">
          <button
            onClick={handleToggleMic}
            disabled={phase !== 'live'}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors disabled:opacity-40 ${
              micOn
                ? 'bg-white/[0.06] hover:bg-white/[0.1] text-text-primary'
                : 'bg-brand-ember/20 border border-brand-ember/40 text-brand-ember'
            }`}
            title={micOn ? 'Mute' : 'Unmute'}
          >
            <Icon name={micOn ? 'mic' : 'mic_off'} size={20} />
          </button>
          <button
            onClick={handleLeave}
            className="px-6 h-12 rounded-full bg-brand-ember text-white text-sm font-bold flex items-center gap-2 hover:brightness-110"
          >
            <Icon name="call_end" size={18} />
            Leave
          </button>
        </div>
      </div>

      {showInvite && (
        <InviteVoiceChannelModal
          channel={channel}
          onSave={handleSaveInvites}
          onClose={() => setShowInvite(false)}
        />
      )}
    </div>
  );
}
