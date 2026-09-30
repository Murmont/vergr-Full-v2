// GroupInfoScreen — Telegram/WhatsApp-style group management at
// /messages/:chatId/group. The thread header opens this for group chats
// (which previously had NO info surface at all: no member list, no add/
// remove, no leave, no rename).
//
// Admin model (v1): `admins: [uids]` on the conversation doc, creator seeded
// implicitly (createdBy is always treated as admin). Admins can rename,
// change the icon, add/remove members and promote/demote admins. Enforced
// client-side; participants-only writes are enforced by rules.
//
// Membership/rename events are announced in-thread as relay `system`
// messages (centered pills), like every mainstream messenger.

import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, collection, onSnapshot, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import useResponsive from '../../hooks/useResponsive';
import {
  getFollowing, getFollowers, searchUsers, approveGroupJoinRequest, denyGroupJoinRequest,
  getGroupInviteCode, rotateGroupInvite, groupPermissions, setGroupPermissions,
  banFromGroup, unbanFromGroup, claimWhatsAppMessages,
} from '../../firebase/firestore';
import { resolveChatUsers, chatDisplayName, chatUsername, peekChatUser } from '../../utils/chatIdentity';
import { isChatMutedFor, setChatMuted } from '../../utils/chatOps';
import { sendRelayMessageTo } from '../../utils/relaySend';
import { compressMedia } from '../../utils/mediaCompression';
import { uploadToR2 } from '../../utils/r2Storage';
import UserAvatar from '../../components/UserAvatar';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import UserName from '../../components/UserName';
import { publicUrl } from '../../utils/publicUrl';

export default function GroupInfoScreen() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const { profile } = useUser();
  const { showToast } = useUI();
  const { isMobile } = useResponsive();

  const me = auth.currentUser?.uid;
  const [chatInfo, setChatInfo] = useState(null);
  const [members, setMembers] = useState({});
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    if (!chatId) return;
    const unsub = onSnapshot(doc(db, 'conversations', chatId), (snap) => {
      if (!snap.exists()) return;
      const data = { id: snap.id, ...snap.data() };
      // A support ticket is a group conversation under the hood, so this
      // screen would happily render support staffing with OWNER/ADMIN roles,
      // plus Invite Members and rename, to the person who raised the ticket
      // (audit A4). The header no longer links here, but the route is still
      // typeable, so the guard belongs on the screen, not only the entry point.
      if (data.supportThread === true) { navigate(`/messages/${chatId}`, { replace: true }); return; }
      setChatInfo(data);
    });
    return () => unsub();
  }, [chatId, navigate]);

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

  // Pending join requests (private groups) — admins only.
  const [joinReqs, setJoinReqs] = useState([]);
  useEffect(() => {
    if (!chatId || !isAdmin) { setJoinReqs([]); return; }
    const unsub = onSnapshot(collection(db, 'conversations', chatId, 'joinRequests'), (snap) => {
      setJoinReqs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [chatId, isAdmin]);

  const muted = isChatMutedFor(chatInfo, me);
  const myName = () => chatDisplayName(me, { displayName: auth.currentUser?.displayName }, null, 'Someone');

  // The invite link carries a revocable CODE, not the chatId. Until an admin
  // issues one, we still hand out the legacy chatId link (which is all that
  // exists for groups created before invite codes) — resetting the link is what
  // switches the group over and kills every old link at once.
  const [inviteCode, setInviteCode] = useState(null);
  useEffect(() => {
    if (!chatId || !isAdmin) { setInviteCode(null); return; }
    getGroupInviteCode(chatId).then(setInviteCode).catch(() => setInviteCode(null));
  }, [chatId, isAdmin]);

  const inviteUrl = publicUrl(`/messages/g/${inviteCode || chatId}`);

  const copyInvite = async () => {
    try { await navigator.clipboard.writeText(inviteUrl); showToast('Invite link copied', 'success'); }
    catch { showToast(inviteUrl, 'info'); }
  };

  const resetInvite = async () => {
    if (!window.confirm('Reset the invite link? Everyone holding the old link will no longer be able to join.')) return;
    try {
      const code = await rotateGroupInvite(chatId);
      setInviteCode(code);
      showToast('New invite link created — the old one no longer works', 'success');
    } catch { showToast('Could not reset the link', 'error'); }
  };

  const perms = groupPermissions(chatInfo);
  const setPerm = async (key, value) => {
    try {
      await setGroupPermissions(chatId, { ...perms, [key]: value });
    } catch { showToast('Could not update permissions', 'error'); }
  };

  const handleBan = async (uid) => {
    if (!window.confirm(`Ban ${nameOf(uid)}? They'll be removed and can't rejoin.`)) return;
    try {
      await banFromGroup(chatId, uid);
      announce(`{actor} banned ${nameOf(uid)}`);
    } catch { showToast('Ban failed', 'error'); }
  };

  const handleUnban = async (uid) => {
    try { await unbanFromGroup(chatId, uid); }
    catch { showToast('Could not unban', 'error'); }
  };

  const approveReq = async (req) => {
    try { await approveGroupJoinRequest(chatId, req); announce(`{actor} added ${req.name || 'a member'}`); }
    catch { showToast('Approve failed', 'error'); }
  };
  const denyReq = async (uid) => {
    try { await denyGroupJoinRequest(chatId, uid); } catch { showToast('Failed', 'error'); }
  };

  // System pill in the thread (relay 'system' frame) + inbox preview.
  const announce = async (text) => {
    try { await sendRelayMessageTo(chatId, { type: 'system', text }); } catch {/* best effort */}
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
        participants: arrayRemove(uid),
        admins: arrayRemove(uid),
        [`unreadCount.${uid}`]: 0,
      });
      announce(`{actor} removed ${nameOf(uid)}`);
    } catch { showToast('Remove failed', 'error'); }
  };

  const handleToggleAdmin = async (uid) => {
    const promoting = !adminSet.has(uid);
    try {
      await updateDoc(doc(db, 'conversations', chatId), {
        admins: promoting ? arrayUnion(uid) : arrayRemove(uid),
      });
      showToast(promoting ? `${nameOf(uid)} is now an admin` : `${nameOf(uid)} is no longer an admin`);
    } catch { showToast('Failed', 'error'); }
  };

  const handleLeave = async () => {
    if (!window.confirm('Leave this group?')) return;
    try {
      // Announce BEFORE leaving (the relay refuses non-members).
      await announce(`{actor} left the group`);
      await updateDoc(doc(db, 'conversations', chatId), {
        participants: arrayRemove(me),
        admins: arrayRemove(me),
      });
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

  if (!chatInfo) return null;
  if (!chatInfo.isGroup) { navigate(`/messages/${chatId}/details`, { replace: true }); return null; }

  return (
    <div className="flex flex-col h-full min-h-screen bg-bg-dark">
      {isMobile ? <TopBar title="Group Info" showBack /> : (
        <div className="flex items-center gap-3 px-4 pt-4 pb-2 border-b border-white/[0.04]">
          <button onClick={() => navigate(-1)} className="text-white/80 hover:text-white"><Icon name="arrow_back" size={24} /></button>
          <h1 className="text-lg font-bold text-white">Group Info</h1>
        </div>
      )}

      <div className="flex-1 overflow-y-auto no-scrollbar pb-10">
        {/* Header: icon + name */}
        <div className="flex flex-col items-center pt-8 pb-6 px-4">
          <div className="relative mb-4">
            <UserAvatar src={chatInfo.groupIcon || chatInfo.groupAvatar} size={88} isGroup />
            {isAdmin && (
              <label className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-brand-violet text-white flex items-center justify-center cursor-pointer shadow-lg">
                <Icon name={uploadingIcon ? 'hourglass_top' : 'photo_camera'} size={16} />
                <input type="file" hidden accept="image/*" onChange={handleIconFile} disabled={uploadingIcon} />
              </label>
            )}
          </div>
          {editingName ? (
            <div className="flex items-center gap-2 w-full max-w-xs">
              <input
                autoFocus value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value.slice(0, 60))}
                onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                className="flex-1 bg-surface-2 border border-white/[0.08] rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-brand-violet"
              />
              <button onClick={handleRename} className="w-9 h-9 rounded-full bg-brand-violet text-white flex items-center justify-center"><Icon name="check" size={18} /></button>
              <button onClick={() => setEditingName(false)} className="w-9 h-9 rounded-full bg-surface-2 text-text-muted flex items-center justify-center"><Icon name="close" size={18} /></button>
            </div>
          ) : (
            <button
              onClick={() => { if (isAdmin) { setNameDraft(chatInfo.groupName || ''); setEditingName(true); } }}
              className="flex items-center gap-2 group">
              <h2 className="text-white font-bold text-xl">{chatInfo.groupName || 'Group'}</h2>
              {isAdmin && <Icon name="edit" size={16} className="text-text-muted group-hover:text-text-primary" />}
            </button>
          )}
          <p className="text-text-muted text-xs mt-1">{participants.length} members</p>

          {/* Description — shown to everyone (incl. the join preview via the
              same conversation doc), edited by admins. Telegram table stakes. */}
          {editingDesc ? (
            <div className="w-full max-w-xs mt-3">
              <textarea
                autoFocus value={descDraft}
                onChange={(e) => setDescDraft(e.target.value.slice(0, 300))}
                placeholder="What is this group about?"
                className="w-full bg-surface-2 border border-white/[0.08] rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-brand-violet h-20 resize-none"
              />
              <div className="flex justify-end gap-2 mt-1.5">
                <button onClick={() => setEditingDesc(false)} className="px-3 py-1.5 rounded-full bg-surface-2 text-text-muted text-xs font-bold">Cancel</button>
                <button
                  onClick={async () => {
                    try {
                      await updateDoc(doc(db, 'conversations', chatId), { description: descDraft.trim() });
                      setEditingDesc(false);
                    } catch { showToast?.('Could not save description', 'error'); }
                  }}
                  className="px-3 py-1.5 rounded-full bg-brand-violet text-white text-xs font-bold">Save</button>
              </div>
            </div>
          ) : (chatInfo.description || isAdmin) ? (
            <button
              onClick={() => { if (isAdmin) { setDescDraft(chatInfo.description || ''); setEditingDesc(true); } }}
              className={`mt-2 max-w-xs text-center text-[13px] leading-relaxed ${chatInfo.description ? 'text-text-secondary' : 'text-text-muted italic'} ${isAdmin ? 'hover:text-text-primary' : 'cursor-default'}`}
            >
              {chatInfo.description || 'Add a group description'}
            </button>
          ) : null}
        </div>

        {/* Settings */}
        <div className="mx-4 mb-4">
          <div className="rounded-2xl border border-white/[0.06] bg-surface-1 overflow-hidden">
            <button onClick={async () => { try { await setChatMuted(chatId, !muted); } catch {} }} className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-surface-2 transition-colors text-left">
              <Icon name={muted ? 'notifications_off' : 'notifications'} size={20} className="text-text-secondary" />
              <span className="flex-1 text-sm text-text-primary">{muted ? 'Unmute Notifications' : 'Mute Notifications'}</span>
              <div className={`w-10 h-6 rounded-full flex items-center px-0.5 transition-colors ${muted ? 'bg-brand-violet justify-end' : 'bg-surface-3 justify-start'}`}>
                <div className="w-5 h-5 bg-white rounded-full shadow" />
              </div>
            </button>
            <button onClick={() => navigate(`/messages/${chatId}/settings`)} className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-surface-2 transition-colors text-left border-t border-white/[0.03]">
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
                className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-surface-2 transition-colors text-left border-t border-white/[0.03]"
              >
                <Icon name="admin_panel_settings" size={20} className="text-text-secondary" />
                <div className="flex-1">
                  <span className="block text-sm text-text-primary">Only admins can send messages</span>
                  <span className="block text-[11px] text-text-muted">Members can still read everything</span>
                </div>
                <div className={`w-10 h-6 rounded-full flex items-center px-0.5 transition-colors ${chatInfo.onlyAdminsPost ? 'bg-brand-violet justify-end' : 'bg-surface-3 justify-start'}`}>
                  <div className="w-5 h-5 bg-white rounded-full shadow" />
                </div>
              </button>
            )}
          </div>
        </div>

        {/* What members are allowed to do (admins are never restricted). */}
        {isAdmin && (
          <div className="mx-4 mb-4">
            <h3 className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-2 px-1">
              Member permissions
            </h3>
            <div className="rounded-2xl border border-white/[0.06] bg-surface-1 overflow-hidden">
              {[
                { key: 'sendMedia', icon: 'image', label: 'Send photos and videos' },
                { key: 'sendLinks', icon: 'link', label: 'Send links' },
                { key: 'addMembers', icon: 'person_add', label: 'Add members' },
                { key: 'pin', icon: 'push_pin', label: 'Pin messages' },
              ].map((p, i) => (
                <button
                  key={p.key}
                  onClick={() => setPerm(p.key, !perms[p.key])}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 hover:bg-surface-2 transition-colors text-left ${i ? 'border-t border-white/[0.03]' : ''}`}
                >
                  <Icon name={p.icon} size={20} className="text-text-secondary" />
                  <span className="flex-1 text-sm text-text-primary">{p.label}</span>
                  <div className={`w-10 h-6 rounded-full flex items-center px-0.5 transition-colors ${perms[p.key] ? 'bg-brand-violet justify-end' : 'bg-surface-3 justify-start'}`}>
                    <div className="w-5 h-5 bg-white rounded-full shadow" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* WhatsApp-imported group: claim your own imported messages (2.4 —
            verified phone matches the export's phone-number author; a user
            ACTION, never automatic). */}
        {chatInfo?.clonedFrom?.source === 'whatsapp' && (
          <div className="mx-4 mb-4">
            <button
              onClick={async () => {
                try {
                  await claimWhatsAppMessages(chatId);
                  showToast('Claim queued — your imported messages will attach to your account shortly', 'success');
                } catch (err) {
                  showToast(err?.message === 'verify_phone_first'
                    ? 'Verify your phone number first (Settings) — that\'s how we match your messages'
                    : (err?.message || 'Claim failed'), 'error');
                }
              }}
              className="w-full flex items-center gap-3 rounded-2xl border border-[#25D366]/30 bg-[#25D366]/10 px-4 py-3.5 text-left hover:bg-[#25D366]/15 transition-colors">
              <Icon name="how_to_reg" size={20} className="text-[#7FE0A0] shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-white font-bold text-sm">Claim my imported messages</p>
                <p className="text-text-muted text-xs">This chat was imported from WhatsApp — if your verified phone number wrote some of these messages, attach them to your account.</p>
              </div>
            </button>
          </div>
        )}

        {/* Invite link — revocable. Resetting kills every link already shared. */}
        {isAdmin && (
          <div className="mx-4 mb-4">
            <h3 className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-2 px-1">
              Invite link
            </h3>
            <div className="rounded-2xl border border-white/[0.06] bg-surface-1 overflow-hidden">
              <button onClick={copyInvite} className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-surface-2 transition-colors text-left">
                <Icon name="link" size={20} className="text-text-secondary" />
                <div className="flex-1 min-w-0">
                  <span className="block text-sm text-text-primary">Copy invite link</span>
                  <span className="block text-[11px] text-text-muted truncate">{inviteUrl}</span>
                </div>
                <Icon name="content_copy" size={18} className="text-text-muted" />
              </button>
              <button onClick={resetInvite} className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-surface-2 transition-colors text-left border-t border-white/[0.03]">
                <Icon name="autorenew" size={20} className="text-brand-ember" />
                <div className="flex-1">
                  <span className="block text-sm text-brand-ember">Reset invite link</span>
                  <span className="block text-[11px] text-text-muted">
                    {inviteCode
                      ? 'Anyone holding the current link will stop being able to join'
                      : 'Switches this group to a private, revocable link'}
                  </span>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Banned members */}
        {isAdmin && (chatInfo.banned || []).length > 0 && (
          <div className="mx-4 mb-4">
            <h3 className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-2 px-1">
              Banned ({chatInfo.banned.length})
            </h3>
            <div className="rounded-2xl border border-white/[0.06] bg-surface-1 overflow-hidden">
              {chatInfo.banned.map((uid, i) => (
                <div key={uid} className={`flex items-center gap-3 px-4 py-3 ${i ? 'border-t border-white/[0.03]' : ''}`}>
                  <Icon name="block" size={18} className="text-brand-ember" />
                  <span className="flex-1 text-sm text-text-primary truncate">{nameOf(uid)}</span>
                  <button onClick={() => handleUnban(uid)} className="text-xs font-bold text-brand-violet-light hover:text-white">
                    Unban
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Join requests (private groups, admin only) */}
        {isAdmin && joinReqs.length > 0 && (
          <div className="mx-4 mb-4">
            <h3 className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-2 px-1">
              Join requests ({joinReqs.length})
            </h3>
            <div className="rounded-2xl border border-brand-violet/20 bg-brand-violet/[0.06] overflow-hidden">
              {joinReqs.map((req, i) => (
                <div key={req.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-white/[0.04]' : ''}`}>
                  <UserAvatar src={req.avatar} size={40} />
                  <p className="flex-1 min-w-0 text-sm text-text-primary font-medium truncate">{req.name || 'Member'}</p>
                  <button onClick={() => approveReq(req)}
                    className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-brand-violet to-brand-pink text-white text-xs font-bold hover:brightness-110">
                    Approve
                  </button>
                  <button onClick={() => denyReq(req.id)}
                    className="px-3 py-1.5 rounded-lg text-text-muted text-xs font-bold hover:text-brand-ember">
                    Deny
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Members */}
        <div className="mx-4 mb-4">
          <div className="flex items-center justify-between mb-2 px-1">
            <h3 className="text-text-muted text-xs font-semibold uppercase tracking-wider">Members</h3>
            <div className="flex items-center gap-3">
              <button onClick={copyInvite} className="text-brand-violet-light text-xs font-bold flex items-center gap-1">
                <Icon name="link" size={14} /> Invite link
              </button>
              {isAdmin && (
                <button onClick={() => setShowAdd(true)} className="text-brand-violet-light text-xs font-bold flex items-center gap-1">
                  <Icon name="person_add" size={14} /> Add
                </button>
              )}
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
                        className={`w-8 h-8 rounded-full flex items-center justify-center ${memberIsAdmin ? 'text-brand-violet-light' : 'text-text-muted hover:text-text-primary'}`}>
                        <Icon name="shield_person" size={17} />
                      </button>
                      <button onClick={() => handleRemove(uid)} title="Remove from group"
                        className="w-8 h-8 rounded-full flex items-center justify-center text-text-muted hover:text-brand-ember">
                        <Icon name="person_remove" size={17} />
                      </button>
                      {/* Remove lets them walk back in through the invite link;
                          ban is the one that actually keeps them out. */}
                      <button onClick={() => handleBan(uid)} title="Ban from group"
                        className="w-8 h-8 rounded-full flex items-center justify-center text-text-muted hover:text-brand-ember">
                        <Icon name="block" size={17} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Leave */}
        <div className="mx-4">
          <div className="rounded-2xl border border-white/[0.06] bg-surface-1 overflow-hidden">
            <button onClick={handleLeave} className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-red-500/5 transition-colors text-left">
              <Icon name="logout" size={20} className="text-brand-ember" />
              <span className="flex-1 text-sm text-brand-ember">Leave Group</span>
            </button>
          </div>
        </div>
      </div>

      {showAdd && <AddMembersSheet chatId={chatId} existing={participants} onAdd={handleAdded} onClose={() => setShowAdd(false)} />}
    </div>
  );
}

// Bottom sheet: pick from your network (follows) or search by username.
// Exported so the native GroupInfo screen reuses the same picker logic.
export function AddMembersSheet({ existing, onAdd, onClose }) {
  const [pool, setPool] = useState([]);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const me = auth.currentUser.uid;
        const [following, followers] = await Promise.all([getFollowing(me), getFollowers(me)]);
        const ids = [...following.map(f => f.followingId), ...followers.map(f => f.followerId)]
          .filter(id => id && id !== me && !existing.includes(id));
        const profiles = await resolveChatUsers(ids);
        setPool(Object.entries(profiles).map(([uid, u]) => ({ uid, ...u })));
      } catch {/* empty pool */}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { setResults(null); return; }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const res = await searchUsers(q);
        if (alive) setResults((res || [])
          .map(u => ({ uid: u.uid || u.id, ...u }))
          .filter(u => u.uid !== auth.currentUser.uid && !existing.includes(u.uid)));
      } catch { if (alive) setResults([]); }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [search, existing]);

  const list = results ?? pool;

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-surface-1 w-full max-w-md max-h-[75vh] rounded-t-2xl sm:rounded-2xl border border-white/[0.06] overflow-hidden flex flex-col sheet-safe" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-white/[0.04]">
          <h3 className="text-white font-bold text-sm">Add members</h3>
          <button onClick={onClose} className="text-text-muted"><Icon name="close" size={20} /></button>
        </div>
        <div className="p-3">
          <input
            autoFocus value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by username..."
            className="w-full bg-surface-2 border border-white/[0.06] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-brand-violet"
          />
        </div>
        <div className="overflow-y-auto flex-1">
          {list.length === 0 && (
            <p className="text-text-muted text-xs text-center py-8">{results ? 'No matches' : 'Nobody in your network yet — search by username.'}</p>
          )}
          {list.map(u => (
            <div key={u.uid} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/50">
              <UserAvatar src={u.avatar} size={38} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary font-medium truncate"><UserName user={u} masked /></p>
                {u.username && <p className="text-[11px] text-text-muted truncate"><UserName user={u} masked handle /></p>}
              </div>
              <button
                disabled={busy === u.uid}
                onClick={async () => { setBusy(u.uid); await onAdd(u); setBusy(null); }}
                className="px-3 py-1.5 rounded-full bg-brand-violet text-white text-xs font-bold disabled:opacity-50">
                Add
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
