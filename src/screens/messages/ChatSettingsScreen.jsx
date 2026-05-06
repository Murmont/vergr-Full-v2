import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, onSnapshot, updateDoc, arrayRemove } from 'firebase/firestore';
import { uploadToR2 } from '../../utils/r2Storage';
import { db, auth } from '../../firebase/config';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import {
  CHAT_BACKGROUNDS,
  BG_CATEGORIES,
  getBackgroundsByCategory,
  getChatBgStyle,
  getChatBackground,
} from '../../utils/chatBackgrounds';
import BackgroundPreviewModal from '../../components/BackgroundPreviewModal';

export default function ChatSettingsScreen() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const { setRightPanel, setContentAlign } = useLayout();
  const { isMobile } = useResponsive();
  const [chat, setChat] = useState(null);
  const [showBgPicker, setShowBgPicker] = useState(false);
  const [selectedBg, setSelectedBg] = useState('bg_1');
  const [customImageUrl, setCustomImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [previewBgId, setPreviewBgId] = useState(null);
  const [previewCustomUrl, setPreviewCustomUrl] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    setRightPanel(null);
    setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign]);

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
      const { url } = await uploadToR2(file, 'post');
      setCustomImageUrl(url);
      setSelectedBg('custom_image');
      await updateDoc(doc(db, 'conversations', chatId), { chatBackground: 'custom_image', chatBackgroundImage: url });
    } catch (err) { console.error('Upload failed:', err); alert('Failed to upload. Please try again.'); }
    finally { setUploading(false); e.target.value = ''; }
  };

  const handleBgClick = (bg) => {
    if (bg.id === 'custom_image') {
      fileInputRef.current?.click();
    } else {
      setPreviewBgId(bg.id);
      setPreviewCustomUrl('');
    }
  };

  const leaveGroup = async () => {
    if (!chat?.isGroup) return;
    if (!window.confirm('Leave this group?')) return;
    await updateDoc(doc(db, 'conversations', chatId), { participants: arrayRemove(auth.currentUser.uid) });
    navigate('/messages');
  };

  if (!chat) return (
    <div className="min-h-full flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-brand-cyan border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const otherUserId = chat.participants?.find(id => id !== auth.currentUser?.uid);
  const otherUser = chat.metadata?.[otherUserId];
  const bgsByCategory = getBackgroundsByCategory();

  return (
    <div className="min-h-full">
      {/* Header */}
      {isMobile ? (
        <header className="sticky top-0 z-40 glass-header flex items-center gap-3 px-5 py-4 border-b border-white/[0.04]">
          <button onClick={() => navigate(-1)} className="text-white/80"><Icon name="arrow_back" size={24} /></button>
          <h1 className="text-white font-syne font-bold text-lg">{chat.isGroup ? 'Group Info' : 'Chat Details'}</h1>
        </header>
      ) : (
        <div className="flex items-center justify-between px-4 lg:px-6 pt-4 pr-12 lg:pr-16">
          <button onClick={() => navigate(-1)} className="text-white/80 hover:text-white transition-colors"><Icon name="arrow_back" size={24} /></button>
          <h1 className="text-white font-syne font-bold text-lg">{chat.isGroup ? 'Group Info' : 'Chat Details'}</h1>
          <div className="w-6" />
        </div>
      )}

      <main className="px-4 lg:px-6 py-6 max-w-2xl mx-auto pb-24">
        {/* Profile section */}
        <div className="text-center mb-8">
          <div className="w-24 h-24 rounded-3xl bg-surface-3 mx-auto flex items-center justify-center text-4xl mb-4 overflow-hidden border-2 border-white/[0.06]">
            {chat.isGroup ? (
              chat.groupIcon ? <img src={chat.groupIcon} alt="" className="w-full h-full object-cover" /> : <span>👥</span>
            ) : (
              <UserAvatar src={otherUser?.avatar} size={96} />
            )}
          </div>
          <h2 className="text-xl font-bold text-white">
            {chat.isGroup ? chat.groupName : otherUser?.name || 'Direct Message'}
          </h2>
          {!chat.isGroup && otherUser?.status && (
            <p className={`text-xs mt-1 font-bold ${otherUser.status === 'online' ? 'text-green-400' : 'text-text-muted'}`}>
              {otherUser.status === 'online' ? 'Online' : 'Offline'}
            </p>
          )}
          {chat.isGroup && <p className="text-xs text-text-muted mt-1">{chat.participants?.length || 0} members</p>}
        </div>

        {/* ═══════ Chat Background Section ═══════ */}
        <div className="mb-6">
          <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest px-1 mb-3">Chat Background</p>

          {/* Preview card */}
          <button
            onClick={() => canEditBackground() && setShowBgPicker(!showBgPicker)}
            className="w-full bg-surface-1 rounded-2xl border border-white/[0.06] overflow-hidden hover:border-white/[0.12] transition-all group"
          >
            <div className="h-28 w-full relative overflow-hidden" style={getChatBgStyle(selectedBg, customImageUrl)}>
              <div className="absolute inset-0 p-4 flex flex-col justify-center gap-2 relative">
                <div className="flex justify-start">
                  <div className="bg-surface-2/90 border border-white/[0.04] rounded-2xl rounded-bl-sm px-4 py-2 max-w-[55%]">
                    <p className="text-[11px] text-white/60">Hey, nice game!</p>
                  </div>
                </div>
                <div className="flex justify-end">
                  <div className="bg-brand-cyan rounded-2xl rounded-br-sm px-4 py-2 max-w-[55%]">
                    <p className="text-[11px] text-bg-dark/70">GG! Let's run it back</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between p-3 bg-surface-2/50">
              <div className="flex items-center gap-2">
                <Icon name="wallpaper" size={18} className="text-brand-cyan" />
                <span className="text-sm text-text-primary font-medium">
                  {getChatBackground(selectedBg)?.name || 'Wallpaper'}
                </span>
              </div>
              {canEditBackground() && (
                <div className="flex items-center gap-1 text-text-muted group-hover:text-brand-cyan transition-colors">
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

        {/* ═══════ Background Picker (expanded) ═══════ */}
        {showBgPicker && canEditBackground() && (
          <div className="mb-6 animate-slide-up">
            <div className="bg-surface-1 rounded-2xl border border-white/[0.06] overflow-hidden">
              {Object.entries(bgsByCategory).map(([catKey, backgrounds]) => (
                <div key={catKey} className="border-b border-white/[0.03] last:border-b-0">
                  <p className="text-[9px] font-bold text-text-muted uppercase tracking-widest px-4 pt-3 pb-2">
                    {BG_CATEGORIES[catKey] || catKey}
                  </p>
                  <div className="grid grid-cols-5 gap-2 px-3 pb-3">
                    {backgrounds.map(bg => (
                      <button key={bg.id}
                        onClick={() => handleBgClick(bg)}
                        className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all active:scale-95 ${
                          selectedBg === bg.id ? 'border-brand-cyan border-brand-cyan' : 'border-white/[0.04] hover:border-white/20'
                        }`}
                      >
                        <div className="absolute inset-0" style={{ ...getChatBgStyle(bg.id, ''), backgroundSize: 'cover', backgroundRepeat: 'no-repeat' }} />
                        {selectedBg === bg.id && (
                          <div className="absolute top-1 left-1 w-4 h-4 rounded-full bg-brand-cyan flex items-center justify-center">
                            <Icon name="check" size={12} className="text-bg-dark" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {/* Custom upload section */}
              <div className="border-b border-white/[0.03] last:border-b-0">
                <p className="text-[9px] font-bold text-text-muted uppercase tracking-widest px-4 pt-3 pb-2">
                  {BG_CATEGORIES.custom}
                </p>
                <div className="grid grid-cols-5 gap-2 px-3 pb-3">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all active:scale-95 ${
                      selectedBg === 'custom_image' ? 'border-brand-cyan border-brand-cyan' : 'border-white/[0.04] hover:border-white/20'
                    }`}
                  >
                    <div className="absolute inset-0 flex items-center justify-center bg-surface-2">
                      <Icon name="add_photo_alternate" size={24} className="text-text-muted" />
                    </div>
                    {selectedBg === 'custom_image' && (
                      <div className="absolute top-1 left-1 w-4 h-4 rounded-full bg-brand-cyan flex items-center justify-center">
                        <Icon name="check" size={12} className="text-bg-dark" />
                      </div>
                    )}
                  </button>
                </div>
                {uploading && (
                  <div className="flex items-center gap-3 px-4 py-3 bg-brand-cyan/5 border-t border-brand-cyan/20">
                    <div className="w-5 h-5 border-2 border-brand-cyan border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs text-brand-cyan font-bold">Uploading image...</span>
                  </div>
                )}
              </div>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleCustomImageUpload} />
          </div>
        )}

        {/* Members (group) */}
        {chat.isGroup && (
          <div className="mb-6">
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest px-1 mb-3">
              Members ({chat.participants?.length || 0})
            </p>
            <div className="bg-surface-1 rounded-2xl border border-white/[0.06] divide-y divide-white/[0.04]/30 overflow-hidden">
              {chat.participants?.map(uid => {
                const member = chat.metadata?.[uid];
                const isCreator = uid === chat.createdBy;
                const isMe = uid === auth.currentUser.uid;
                return (
                  <button key={uid} onClick={() => !isMe && navigate(`/user/${uid}`)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-2/30 transition-colors text-left">
                    <UserAvatar src={member?.avatar} size={36} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-text-primary font-medium truncate">
                          {member?.name || `User ${uid.slice(0, 6)}`}
                        </p>
                        {isCreator && (
                          <span className="text-[8px] font-black text-brand-gold uppercase tracking-wider bg-brand-gold/10 px-1.5 py-0.5 rounded-full">Creator</span>
                        )}
                        {isMe && <span className="text-[8px] font-bold text-text-muted uppercase">(you)</span>}
                      </div>
                    </div>
                    <div className={`w-2 h-2 rounded-full ${member?.status === 'online' ? 'bg-green-400' : 'bg-text-muted/30'}`} />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-3 pt-4">
          {chat.isGroup && (
            <button onClick={leaveGroup}
              className="w-full py-4 rounded-2xl bg-brand-ember/10 text-brand-ember font-bold text-sm hover:bg-brand-ember/20 transition-colors">
              Leave Group
            </button>
          )}
          <button className="w-full py-4 rounded-2xl bg-surface-2 border border-white/[0.06] text-text-secondary font-bold text-sm hover:bg-surface-3 transition-colors">
            Block User
          </button>
        </div>
      </main>

      {/* Background Preview Modal */}
      <BackgroundPreviewModal
        isOpen={previewBgId !== null}
        onClose={() => setPreviewBgId(null)}
        onApply={() => {
          if (previewBgId) applyBackground(previewBgId);
        }}
        bgId={previewBgId}
        customImageUrl={previewCustomUrl}
      />
    </div>
  );
}