// NativeGroupInfoScreen — dedicated phone build of /messages/:chatId/group.
// Reuses the same Firestore handlers + the exported AddMembersSheet; single
// column, safe-area TopBar, brand violet.
import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, collection, onSnapshot, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db, auth } from '../../../firebase/config';
import { useUser } from '../../../context/UserContext';
import { useUI } from '../../../context/UIContext';
import { approveGroupJoinRequest, denyGroupJoinRequest } from '../../../firebase/firestore';
import { resolveChatUsers, chatDisplayName, chatUsername, peekChatUser } from '../../../utils/chatIdentity';
import { isChatMutedFor, setChatMuted } from '../../../utils/chatOps';
import { sendRelayMessageTo } from '../../../utils/relaySend';
import { compressMedia } from '../../../utils/mediaCompression';
import { uploadToR2 } from '../../../utils/r2Storage';
import UserAvatar from '../../../components/UserAvatar';
import TopBar from '../../../components/TopBar';
import Icon from '../../../components/Icon';
import { AddMembersSheet } from '../GroupInfoScreen';

export default function NativeGroupInfoScreen() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const { profile } = useUser();
  const { showToast } = useUI();

  const me = auth.currentUser?.uid;
  const [chatInfo, setChatInfo] = useState(null);
  const [members, setMembers] = useState({});
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    if (!chatId) return;
    return onSnapshot(doc(db, 'conversations', chatId), (snap) => {
      if (snap.exists()) setChatInfo({ id: snap.id, ...snap.data() });
    });
  }, [chatId]);

  const participants = chatInfo?.participants || [];
  const participantsKey = participants.join(',');
  useEffect(() => {
    if (!participants.length) return;
    let alive = true;
    resolveChatUsers(participants).then((map) => { if (alive) setMembers(map); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participantsKey]);

  const isAdmin = useMemo(() => {
    if (!chatInfo || !me) return false;
    if (chatInfo.createdBy === me) return true;
    return (chatInfo.admins || []).includes(me);
  }, [chatInfo, me]);

  const adminSet = useMemo(() => {
    const s = new Set(chatInfo?.admins || []);
    if (chatInfo?.createdBy) s.add(chatInfo.createdBy);
    return s;
  }, [chatInfo]);

  const [joinReqs, setJoinReqs] = useState([]);
  useEffect(() => {
    if (!chatId || !isAdmin) { setJoinReqs([]); return; }
    return onSnapshot(collection(db, 'conversations', chatId, 'joinRequests'), (snap) => {
      setJoinReqs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [chatId, isAdmin]);

  const muted = isChatMutedFor(chatInfo, me);
  const myName = () => chatDisplayName(me, { displayName: auth.currentUser?.displayName }, null, 'Someone');

  const copyInvite = async () => {
    const url = `${window.location.origin}/messages/g/${chatId}`;
    try { await navigator.clipboard.writeText(url); showToast('Invite link copied', 'success'); }
    catch { showToast(url, 'info'); }
  };

  const announce = async (text) => {
    try { await sendRelayMessageTo(chatId, { type: 'system', text }); } catch {/* best effort */}
  };

  const approveReq = async (req) => {
    try { await approveGroupJoinRequest(chatId, req); announce(`{actor} added ${req.name || 'a member'}`); }
    catch { showToast('Approve failed', 'error'); }
  };
  const denyReq = async (uid) => {
    try { await denyGroupJoinRequest(chatId, uid); } catch { showToast('Failed', 'error'); }
  };

  // peekChatUser between the async member fetch and the frozen snapshot, so a
  // renamed member never flashes their old name while members[] resolves.
  const nameOf = (uid) => chatDisplayName(uid, members[uid] || peekChatUser(uid), profile, chatInfo?.metadata?.[uid]?.name || 'Member');

  const handleRename = async () => {
    const next = nameDraft.trim().slice(0, 60);
    if (!next || next === chatInfo?.groupName) { setEditingName(false); return; }
    try {
      await updateDoc(doc(db, 'conversations', chatId), { groupName: next });
      // Awaited: announce() swallows relay failures, so a dropped frame here
      // used to leave the rename with no in-thread pill and no warning at all.
      await announce(`{actor} renamed the group to "${next}"`);
      setEditingName(false);
    } catch { showToast('Rename failed', 'error'); }
  };

  const handleIconFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingIcon(true);
    try {
      const compressed = await compressMedia(file, 'free', 'avatar');
      const { url } = await uploadToR2(compressed, 'avatar');
      await updateDoc(doc(db, 'conversations', chatId), { groupIcon: url });
      announce(`{actor} changed the group photo`);
    } catch { showToast('Upload failed', 'error'); }
    setUploadingIcon(false);
  };

  const handleRemove = async (uid) => {
    if (!window.confirm(`Remove ${nameOf(uid)} from the group?`)) return;
    try {
      await updateDoc(doc(db, 'conversations', chatId), {
        participants: arrayRemove(uid), admins: arrayRemove(uid), [`unreadCount.${uid}`]: 0,
      });
      announce(`{actor} removed ${nameOf(uid)}`);
    } catch { showToast('Remove failed', 'error'); }
  };

  const handleToggleAdmin = async (uid) => {
    const promoting = !adminSet.has(uid);
    try {
      await updateDoc(doc(db, 'conversations', chatId), { admins: promoting ? arrayUnion(uid) : arrayRemove(uid) });
      showToast(promoting ? `${nameOf(uid)} is now an admin` : `${nameOf(uid)} is no longer an admin`);
    } catch { showToast('Failed', 'error'); }
  };

  const handleLeave = async () => {
    if (!window.confirm('Leave this group?')) return;
    try {
      await announce(`{actor} left the group`);
      await updateDoc(doc(db, 'conversations', chatId), { participants: arrayRemove(me), admins: arrayRemove(me) });
      navigate('/messages');
    } catch { showToast('Failed to leave', 'error'); }
  };

  const handleAdded = async (user) => {
    const uid = user.uid;
    if (!uid || participants.includes(uid)) return;
    try {
      await updateDoc(doc(db, 'conversations', chatId), {
        participants: arrayUnion(uid),
        [`metadata.${uid}`]: { name: user.displayName || user.username || 'Member', avatar: user.avatar || null },
        [`unreadCount.${uid}`]: 0,
      });
      announce(`{actor} added ${user.displayName || user.username || 'a member'}`);
    } catch { showToast('Add failed', 'error'); }
  };

  if (!chatInfo) return <div style={{ minHeight: '100vh', background: 'var(--bg-dark)' }}><TopBar title="Group Info" showBack /></div>;
  if (!chatInfo.isGroup) { navigate(`/messages/${chatId}/details`, { replace: true }); return null; }

  const toggle = (on) => `w-11 h-6 rounded-full flex items-center px-0.5 transition-colors ${on ? 'bg-brand-violet justify-end' : 'bg-surface-3 justify-start'}`;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-dark)', paddingBottom: 'calc(88px + env(safe-area-inset-bottom, 0px))' }}>
      <TopBar title="Group Info" showBack />

      <div className="pb-6">
        <div className="flex flex-col items-center pt-8 pb-6 px-4">
          <div className="relative mb-4">
            <UserAvatar src={chatInfo.groupIcon} size={88} isGroup />
            {isAdmin && (
              <label className="absolute -bottom-1 -right-1 w-9 h-9 rounded-full bg-brand-violet text-white flex items-center justify-center cursor-pointer shadow-lg active:scale-95 transition-transform">
                <Icon name={uploadingIcon ? 'hourglass_top' : 'photo_camera'} size={16} />
                <input type="file" hidden accept="image/*" onChange={handleIconFile} disabled={uploadingIcon} />
              </label>
            )}
          </div>
          {editingName ? (
            <div className="flex items-center gap-2 w-full max-w-xs">
              <input autoFocus value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value.slice(0, 60))}
                onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                className="flex-1 bg-surface-2 border border-white/[0.08] rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-brand-violet" />
              <button onClick={handleRename} className="w-10 h-10 rounded-full bg-brand-violet text-white flex items-center justify-center"><Icon name="check" size={18} /></button>
              <button onClick={() => setEditingName(false)} className="w-10 h-10 rounded-full bg-surface-2 text-text-muted flex items-center justify-center"><Icon name="close" size={18} /></button>
            </div>
          ) : (
            <button onClick={() => { if (isAdmin) { setNameDraft(chatInfo.groupName || ''); setEditingName(true); } }}
              className="flex items-center gap-2">
              <h2 className="text-white font-bold text-xl">{chatInfo.groupName || 'Group'}</h2>
              {isAdmin && <Icon name="edit" size={16} className="text-text-muted" />}
            </button>
          )}
          <p className="text-text-muted text-xs mt-1">{participants.length} members</p>
        </div>

        <div className="mx-4 mb-4">
          <div className="rounded-2xl border border-white/[0.06] bg-surface-1 overflow-hidden">
            <button onClick={async () => { try { await setChatMuted(chatId, !muted); } catch {} }} className="w-full flex items-center gap-3 px-4 py-3.5 active:bg-surface-2 transition-colors text-left">
              <Icon name={muted ? 'notifications_off' : 'notifications'} size={20} className="text-text-secondary" />
              <span className="flex-1 text-sm text-text-primary">{muted ? 'Unmute Notifications' : 'Mute Notifications'}</span>
              <div className={toggle(muted)}><div className="w-5 h-5 bg-white rounded-full shadow" /></div>
            </button>
            <button onClick={() => navigate(`/messages/${chatId}/settings`)} className="w-full flex items-center gap-3 px-4 py-3.5 active:bg-surface-2 transition-colors text-left border-t border-white/[0.03]">
              <Icon name="wallpaper" size={20} className="text-text-secondary" />
              <span className="flex-1 text-sm text-text-primary">Change Wallpaper</span>
              <Icon name="chevron_right" size={18} className="text-text-muted" />
            </button>
            {isAdmin && (
              <button
                onClick={async () => {
                  const next = !chatInfo.onlyAdminsPost;
                  try {
                    await updateDoc(doc(db, 'conversations', chatId), { onlyAdminsPost: next });
                    announce(next ? `${myName()} restricted messaging to admins` : `${myName()} allowed everyone to send messages`);
                  } catch { showToast('Failed', 'error'); }
                }}
                className="w-full flex items-center gap-3 px-4 py-3.5 active:bg-surface-2 transition-colors text-left border-t border-white/[0.03]">
                <Icon name="admin_panel_settings" size={20} className="text-text-secondary" />
                <div className="flex-1">
                  <span className="block text-sm text-text-primary">Only admins can send messages</span>
                  <span className="block text-[11px] text-text-muted">Members can still read everything</span>
                </div>
                <div className={toggle(chatInfo.onlyAdminsPost)}><div className="w-5 h-5 bg-white rounded-full shadow" /></div>
              </button>
            )}
          </div>
        </div>

        {isAdmin && joinReqs.length > 0 && (
          <div className="mx-4 mb-4">
            <h3 className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-2 px-1">Join requests ({joinReqs.length})</h3>
            <div className="rounded-2xl border border-brand-violet/20 bg-brand-violet/[0.06] overflow-hidden">
              {joinReqs.map((req, i) => (
                <div key={req.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-white/[0.04]' : ''}`}>
                  <UserAvatar src={req.avatar} size={40} />
                  <p className="flex-1 min-w-0 text-sm text-text-primary font-medium truncate">{req.name || 'Member'}</p>
                  <button onClick={() => approveReq(req)}
                    className="px-3.5 py-2 rounded-lg bg-gradient-to-r from-brand-violet to-brand-pink text-white text-xs font-bold active:scale-95 transition-transform">Approve</button>
                  <button onClick={() => denyReq(req.id)} className="px-2 py-2 rounded-lg text-text-muted text-xs font-bold active:text-brand-ember">Deny</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mx-4 mb-4">
          <div className="flex items-center justify-between mb-2 px-1">
            <h3 className="text-text-muted text-xs font-semibold uppercase tracking-wider">Members</h3>
            <div className="flex items-center gap-4">
              <button onClick={copyInvite} className="text-brand-violet-light text-xs font-bold flex items-center gap-1 py-1"><Icon name="link" size={14} /> Invite link</button>
              {isAdmin && <button onClick={() => setShowAdd(true)} className="text-brand-violet-light text-xs font-bold flex items-center gap-1 py-1"><Icon name="person_add" size={14} /> Add</button>}
            </div>
          </div>
          <div className="rounded-2xl border border-white/[0.06] bg-surface-1 overflow-hidden">
            {participants.map((uid, i) => {
              const u = members[uid];
              const isCreator = chatInfo.createdBy === uid;
              const memberIsAdmin = adminSet.has(uid);
              return (
                <div key={uid} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-white/[0.03]' : ''}`}>
                  <button onClick={() => uid !== me && navigate(`/user/${uid}`)} className="shrink-0">
                    <UserAvatar src={u?.avatar || peekChatUser(uid)?.avatar || chatInfo.metadata?.[uid]?.avatar} size={40} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-primary font-medium truncate">
                      {uid === me ? 'You' : nameOf(uid)}
                      {memberIsAdmin && (
                        <span className="ml-2 text-[9px] font-bold uppercase tracking-wider text-brand-violet-light bg-brand-violet/10 px-1.5 py-0.5 rounded">
                          {isCreator ? 'Owner' : 'Admin'}
                        </span>
                      )}
                    </p>
                    {chatUsername(u) && <p className="text-[11px] text-text-muted truncate">{chatUsername(u)}</p>}
                  </div>
                  {isAdmin && uid !== me && !isCreator && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => handleToggleAdmin(uid)} title={memberIsAdmin ? 'Remove admin' : 'Make admin'}
                        className={`w-10 h-10 rounded-full flex items-center justify-center ${memberIsAdmin ? 'text-brand-violet-light' : 'text-text-muted'}`}>
                        <Icon name="shield_person" size={18} />
                      </button>
                      <button onClick={() => handleRemove(uid)} title="Remove from group"
                        className="w-10 h-10 rounded-full flex items-center justify-center text-text-muted active:text-brand-ember">
                        <Icon name="person_remove" size={18} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mx-4">
          <div className="rounded-2xl border border-white/[0.06] bg-surface-1 overflow-hidden">
            <button onClick={handleLeave} className="w-full flex items-center gap-3 px-4 py-3.5 active:bg-red-500/5 transition-colors text-left">
              <Icon name="logout" size={20} className="text-brand-ember" />
              <span className="flex-1 text-sm text-brand-ember">Leave Group</span>
            </button>
          </div>
        </div>
      </div>

      {showAdd && <AddMembersSheet existing={participants} onAdd={handleAdded} onClose={() => setShowAdd(false)} />}
    </div>
  );
}
