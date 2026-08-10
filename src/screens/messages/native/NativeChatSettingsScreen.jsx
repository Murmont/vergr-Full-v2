// NativeChatSettingsScreen — dedicated phone build of /messages/:chatId/settings.
// Reuses chatBackgrounds utils + the same Firestore handlers; single column,
// safe-area TopBar, brand violet.
import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, onSnapshot, updateDoc, arrayRemove } from 'firebase/firestore';
import { uploadToR2 } from '../../../utils/r2Storage';
import { db, auth } from '../../../firebase/config';
import Icon from '../../../components/Icon';
import TopBar from '../../../components/TopBar';
import { StackSkeleton } from '../../../components/skeletons/GlassSkeletons';
import UserAvatar from '../../../components/UserAvatar';
import {
  BG_CATEGORIES, getBackgroundsByCategory, getChatBgStyle,
  resizeCustomBackground, getChatBackground,
} from '../../../utils/chatBackgrounds';
import BackgroundPreviewModal from '../../../components/BackgroundPreviewModal';
import usePresenceMap from '../../../hooks/usePresenceMap';
import { peekChatUser } from '../../../utils/chatIdentity';

export default function NativeChatSettingsScreen() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const [chat, setChat] = useState(null);
  const [showBgPicker, setShowBgPicker] = useState(false);
  const [selectedBg, setSelectedBg] = useState('bg_1');
  const [customImageUrl, setCustomImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [previewBgId, setPreviewBgId] = useState(null);
  const [previewCustomUrl, setPreviewCustomUrl] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!chatId) return;
    return onSnapshot(doc(db, 'conversations', chatId), (s) => {
      if (s.exists()) {
        const data = { id: s.id, ...s.data() };
        setChat(data);
        setSelectedBg(data.chatBackground || 'bg_1');
        setCustomImageUrl(data.chatBackgroundImage || '');
      }
    });
  }, [chatId]);

  const me = auth.currentUser?.uid;
  const presMap = usePresenceMap((chat?.participants || []).filter((id) => id !== me));

  const canEditBackground = () => {
    if (!chat || !auth.currentUser) return false;
    if (!chat.isGroup) return chat.participants?.includes(auth.currentUser.uid);
    return chat.createdBy === auth.currentUser.uid;
  };

  const applyBackground = async (bgId) => {
    setSelectedBg(bgId);
    try {
      await updateDoc(doc(db, 'conversations', chatId), {
        chatBackground: bgId,
        ...(bgId !== 'custom_image' ? { chatBackgroundImage: '' } : {}),
      });
    } catch (err) { console.error('Failed to update background:', err); }
  };

  const handleCustomImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('Please select an image file.'); return; }
    if (file.size > 10 * 1024 * 1024) { alert('Image must be under 10MB.'); return; }
    setUploading(true);
    try {
      const resized = await resizeCustomBackground(file).catch(() => null);
      let toUpload = file;
      if (resized?.blob) {
        if (resized.orientation === 'desktop') {
          const proceed = window.confirm('Your image is landscape (desktop-sized). On mobile it may be cropped or letterboxed. Upload anyway?');
          if (!proceed) { setUploading(false); e.target.value = ''; return; }
        }
        toUpload = new File([resized.blob], `chatbg_${Date.now()}.webp`, { type: resized.type });
      }
      const { url } = await uploadToR2(toUpload, 'post');
      setCustomImageUrl(url);
      setSelectedBg('custom_image');
      await updateDoc(doc(db, 'conversations', chatId), { chatBackground: 'custom_image', chatBackgroundImage: url });
    } catch (err) { console.error('Upload failed:', err); alert('Failed to upload. Please try again.'); }
    finally { setUploading(false); e.target.value = ''; }
  };

  const handleBgClick = (bg) => {
    if (bg.id === 'custom_image') fileInputRef.current?.click();
    else { setPreviewBgId(bg.id); setPreviewCustomUrl(''); }
  };

  const leaveGroup = async () => {
    if (!chat?.isGroup) return;
    if (!window.confirm('Leave this group?')) return;
    await updateDoc(doc(db, 'conversations', chatId), { participants: arrayRemove(auth.currentUser.uid) });
    navigate('/messages');
  };

  if (!chat) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-dark)' }}>
      <TopBar title="Chat Details" showBack />
      <StackSkeleton rows={4} height={64} />
    </div>
  );

  const otherUserId = chat.participants?.find(id => id !== auth.currentUser?.uid);
  // Live identity from the persisted cache first; chat.metadata is a frozen
  // creation-time snapshot and renders someone's old name/avatar.
  const otherUser = peekChatUser(otherUserId) || chat.metadata?.[otherUserId];
  const bgsByCategory = getBackgroundsByCategory();

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-dark)', paddingBottom: 'calc(88px + env(safe-area-inset-bottom, 0px))' }}>
      <TopBar title={chat.isGroup ? 'Group Info' : 'Chat Details'} showBack />

      <main className="px-4 py-6">
        <div className="text-center mb-8">
          <div className="w-24 h-24 rounded-3xl bg-surface-3 mx-auto flex items-center justify-center text-4xl mb-4 overflow-hidden border-2 border-white/[0.06]">
            {chat.isGroup ? (
              chat.groupIcon ? <img src={chat.groupIcon} alt="" className="w-full h-full object-cover" /> : <span>👥</span>
            ) : (
              <UserAvatar src={otherUser?.avatar} size={96} />
            )}
          </div>
          <h2 className="text-xl font-bold text-white">{chat.isGroup ? chat.groupName : (otherUser?.displayName || otherUser?.username || otherUser?.name) || 'Direct Message'}</h2>
          {!chat.isGroup && otherUserId && (
            <p className={`text-xs mt-1 font-bold ${presMap[otherUserId] ? 'text-green-400' : 'text-text-muted'}`}>
              {presMap[otherUserId] ? 'Online' : 'Offline'}
            </p>
          )}
          {chat.isGroup && <p className="text-xs text-text-muted mt-1">{chat.participants?.length || 0} members</p>}
        </div>

        {chat.isGroup && chat.createdBy === auth.currentUser?.uid && (
          <div className="mb-6">
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest px-1 mb-3">Visibility</p>
            <div className="bg-surface-1 rounded-2xl border border-white/[0.06] p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-brand-violet/10 flex items-center justify-center shrink-0">
                  <Icon name={chat.visibility === 'public' ? 'public' : 'lock'} size={20} className="text-brand-violet-light" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white">{chat.visibility === 'public' ? 'Public group' : 'Private group'}</p>
                  <p className="text-[11px] text-text-muted leading-snug mt-0.5">
                    {chat.visibility === 'public'
                      ? 'Anyone can find this group in Browse Groups and join.'
                      : 'Only invited members can see and join this group.'}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    const next = chat.visibility === 'public' ? 'private' : 'public';
                    try { await updateDoc(doc(db, 'conversations', chatId), { visibility: next }); }
                    catch (err) { console.error('Failed to update visibility', err); }
                  }}
                  role="switch" aria-checked={chat.visibility === 'public'}
                  className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${chat.visibility === 'public' ? 'bg-brand-violet' : 'bg-white/[0.12]'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white transition-transform ${chat.visibility === 'public' ? 'translate-x-5' : ''}`} />
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="mb-6">
          <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest px-1 mb-3">Chat Background</p>
          <button onClick={() => canEditBackground() && setShowBgPicker(!showBgPicker)}
            className="w-full bg-surface-1 rounded-2xl border border-white/[0.06] overflow-hidden active:border-white/[0.12] transition-all">
            <div className="h-28 w-full relative overflow-hidden" style={getChatBgStyle(selectedBg, customImageUrl, { isDesktop: false })}>
              <div className="absolute inset-0 p-4 flex flex-col justify-center gap-2">
                <div className="flex justify-start">
                  <div className="bg-surface-2/90 border border-white/[0.04] rounded-2xl rounded-bl-sm px-4 py-2 max-w-[55%]">
                    <p className="text-[11px] text-white/60">Hey, nice game!</p>
                  </div>
                </div>
                <div className="flex justify-end">
                  <div className="bg-brand-violet rounded-2xl rounded-br-sm px-4 py-2 max-w-[55%]">
                    <p className="text-[11px] text-white/80">GG! Let's run it back</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between p-3 bg-surface-2/50">
              <div className="flex items-center gap-2">
                <Icon name="wallpaper" size={18} className="text-brand-violet-light" />
                <span className="text-sm text-text-primary font-medium">{getChatBackground(selectedBg)?.name || 'Wallpaper'}</span>
              </div>
              {canEditBackground() && (
                <div className="flex items-center gap-1 text-text-muted">
                  <span className="text-[10px] font-bold uppercase tracking-wider">Change</span>
                  <Icon name={showBgPicker ? 'expand_less' : 'expand_more'} size={18} />
                </div>
              )}
            </div>
          </button>
          {!canEditBackground() && chat.isGroup && (
            <p className="text-[10px] text-text-muted mt-2 px-1">Only the group creator can change the background.</p>
          )}
        </div>

        {showBgPicker && canEditBackground() && (
          <div className="mb-6 animate-slide-up">
            <div className="bg-surface-1 rounded-2xl border border-white/[0.06] overflow-hidden">
              {Object.entries(bgsByCategory).map(([catKey, backgrounds]) => (
                <div key={catKey} className="border-b border-white/[0.03] last:border-b-0">
                  <p className="text-[9px] font-bold text-text-muted uppercase tracking-widest px-4 pt-3 pb-2">{BG_CATEGORIES[catKey] || catKey}</p>
                  <div className="grid grid-cols-5 gap-2 px-3 pb-3">
                    {backgrounds.map(bg => (
                      <button key={bg.id} onClick={() => handleBgClick(bg)}
                        className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all active:scale-95 ${selectedBg === bg.id ? 'border-brand-violet' : 'border-white/[0.04]'}`}>
                        <div className="absolute inset-0" style={{ ...getChatBgStyle(bg.id, '', { isDesktop: false }), backgroundSize: 'cover', backgroundRepeat: 'no-repeat' }} />
                        {selectedBg === bg.id && (
                          <div className="absolute top-1 left-1 w-4 h-4 rounded-full bg-brand-violet flex items-center justify-center">
                            <Icon name="check" size={12} className="text-white" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div>
                <p className="text-[9px] font-bold text-text-muted uppercase tracking-widest px-4 pt-3 pb-2">{BG_CATEGORIES.custom}</p>
                <div className="grid grid-cols-5 gap-2 px-3 pb-3">
                  <button onClick={() => fileInputRef.current?.click()}
                    className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all active:scale-95 ${selectedBg === 'custom_image' ? 'border-brand-violet' : 'border-white/[0.04]'}`}>
                    <div className="absolute inset-0 flex items-center justify-center bg-surface-2">
                      <Icon name="add_photo_alternate" size={24} className="text-text-muted" />
                    </div>
                    {selectedBg === 'custom_image' && (
                      <div className="absolute top-1 left-1 w-4 h-4 rounded-full bg-brand-violet flex items-center justify-center">
                        <Icon name="check" size={12} className="text-white" />
                      </div>
                    )}
                  </button>
                </div>
                {uploading && (
                  <div className="flex items-center gap-3 px-4 py-3 bg-brand-violet/5 border-t border-brand-violet/20">
                    <div className="w-5 h-5 border-2 border-brand-violet border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs text-brand-violet-light font-bold">Uploading image...</span>
                  </div>
                )}
              </div>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleCustomImageUpload} />
          </div>
        )}

        {chat.isGroup && (
          <div className="mb-6">
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest px-1 mb-3">Members ({chat.participants?.length || 0})</p>
            <div className="bg-surface-1 rounded-2xl border border-white/[0.06] divide-y divide-white/[0.04] overflow-hidden">
              {chat.participants?.map(uid => {
                const member = chat.metadata?.[uid];
                const isCreator = uid === chat.createdBy;
                const isMe = uid === auth.currentUser.uid;
                return (
                  <button key={uid} onClick={() => !isMe && navigate(`/user/${uid}`)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 active:bg-surface-2/30 transition-colors text-left">
                    <UserAvatar src={member?.avatar} size={38} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-text-primary font-medium truncate">{member?.name || `User ${uid.slice(0, 6)}`}</p>
                        {isCreator && <span className="text-[8px] font-black text-brand-gold uppercase tracking-wider bg-brand-gold/10 px-1.5 py-0.5 rounded-full">Creator</span>}
                        {isMe && <span className="text-[8px] font-bold text-text-muted uppercase">(you)</span>}
                      </div>
                    </div>
                    <div className={`w-2 h-2 rounded-full ${presMap[uid] ? 'bg-green-400' : 'bg-text-muted/30'}`} />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-3 pt-4">
          {chat.isGroup && (
            <button onClick={leaveGroup}
              className="w-full py-4 rounded-2xl bg-brand-ember/10 text-brand-ember font-bold text-sm active:bg-brand-ember/20 transition-colors">
              Leave Group
            </button>
          )}
          <button className="w-full py-4 rounded-2xl bg-surface-2 border border-white/[0.06] text-text-secondary font-bold text-sm active:bg-surface-3 transition-colors">
            Block User
          </button>
        </div>
      </main>

      <BackgroundPreviewModal
        isOpen={previewBgId !== null}
        onClose={() => setPreviewBgId(null)}
        onApply={() => { if (previewBgId) applyBackground(previewBgId); }}
        bgId={previewBgId}
        customImageUrl={previewCustomUrl}
      />
    </div>
  );
}
