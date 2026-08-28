import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, onSnapshot, updateDoc, arrayRemove } from 'firebase/firestore';
import { uploadToR2 } from '../../utils/r2Storage';
import { db, auth } from '../../firebase/config';
import Icon from '../../components/Icon';
import { TTL_OPTIONS } from '../../utils/disappearing';
import { StackSkeleton } from '../../components/skeletons/GlassSkeletons';
import UserAvatar from '../../components/UserAvatar';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import { IS_NATIVE_BUILD } from '../../utils/platform';
import {
  CHAT_BACKGROUNDS,
  BG_CATEGORIES,
  getBackgroundsByCategory,
  getChatBgStyle,
  resizeCustomBackground,
  getChatBackground,
} from '../../utils/chatBackgrounds';
import BackgroundPreviewModal from '../../components/BackgroundPreviewModal';
import usePresenceMap from '../../hooks/usePresenceMap';
import { peekChatUser } from '../../utils/chatIdentity';
import { useUser } from '../../context/UserContext';
import { ChatGradient } from '../../components/effects';
import {
  CHAT_THEMES, CHAT_THEME_LEVEL, canUseChatThemes, chatThemeColors, chatPatternUrl,
  CHAT_MOTIONS, chatMotionFor,
  chatThemeById, chatThemeCustomColors,
} from '../../utils/chatThemes';
import ColorField from '../../components/prestige/ColorField';

export default function ChatSettingsScreen() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const { setRightPanel, setContentAlign } = useLayout();
  const { isMobile, isDesktop } = useResponsive();
  const { profile } = useUser();
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

  // Live RTDB presence for everyone in this chat (1:1 or group members).
  const me = auth.currentUser?.uid;
  const presMap = usePresenceMap(
    (chat?.participants || []).filter((id) => id !== me),
  );

  const canEditBackground = () => {
    if (!chat || !auth.currentUser) return false;
    if (!chat.isGroup) return chat.participants?.includes(auth.currentUser.uid);
    return chat.createdBy === auth.currentUser.uid;
  };

  // Disappearing messages. Group = admins/creator only, DM = either party
  // (mirrors the Firestore rule, which is what actually enforces it).
  const chatTtl = Number(chat?.ttlSeconds) || 0;
  const canSetTtl = () => {
    if (!chat || !auth.currentUser) return false;
    if (!chat.isGroup) return chat.participants?.includes(auth.currentUser.uid);
    return chat.createdBy === auth.currentUser.uid
      || (chat.admins || []).includes(auth.currentUser.uid);
  };
  const applyTtl = async (seconds) => {
    if (seconds === chatTtl) return;
    try {
      await updateDoc(doc(db, 'conversations', chatId), { ttlSeconds: seconds });
    } catch (err) { console.error('Failed to set auto-delete:', err); }
  };

  // ⚠ `chatThemeBy` is written alongside the id and is load-bearing: the theme
  // renders only while THAT person still qualifies (level or Pro), checked at
  // read time. Without it there would be no way to tell whose unlock applies.
  const applyTheme = async (themeId) => {
    try {
      await updateDoc(doc(db, 'conversations', chatId), {
        chatTheme: themeId,
        chatThemeBy: themeId ? auth.currentUser?.uid : null,
        // Switching preset drops any custom colours: they were chosen against
        // the old palette and would usually clash with the new pattern.
        chatThemeColors: null,
      });
      setDraft(null);
      setEditing(-1);
    } catch (err) { console.error('Failed to set chat theme:', err); }
  };

  // ⚠ MOTION IS A SEPARATE CHOICE FROM THE THEME, deliberately. The founder's
  // objection was that every theme animated identically ("they all still move
  // in a circular motion"), so the fix cannot be a per-theme preset the user
  // has no say over. Switching preset does NOT reset it: it is a preference
  // about movement, not about colour.
  const applyMotion = async (motionId) => {
    try {
      await updateDoc(doc(db, 'conversations', chatId), { chatThemeMotion: motionId });
    } catch (err) { console.error('Failed to set chat motion:', err); }
  };

  // The four colours currently in force, and whether they are the user's own.
  const activeTheme = chatThemeById(chat?.chatTheme);
  const custom = chatThemeCustomColors(chat);
  const themeColors = {
    custom: !!custom,
    list: custom || chatThemeColors(activeTheme, false) || [],
  };
  // ⚠ STATE, NOT A REF. The draft has to drive the live preview, so it must
  // trigger a render; a ref would update silently and the preview would sit
  // frozen while you dragged. The WRITE is still deferred to Done, so dragging
  // costs zero Firestore writes.
  const [draft, setDraft] = useState(null);
  const [editing, setEditing] = useState(-1);
  const shownColors = draft || themeColors.list;
  const setDraftColor = (i, v) => {
    const next = [...(draft || themeColors.list)];
    next[i] = v;
    setDraft(next);
  };
  const applyThemeColors = async (colors) => {
    setDraft(null);
    try {
      await updateDoc(doc(db, 'conversations', chatId), {
        chatThemeColors: colors && colors.length ? colors : null,
        chatThemeBy: auth.currentUser?.uid,
      });
    } catch (err) { console.error('Failed to set theme colours:', err); }
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
      // Resize + compress in the browser before upload. Returns a WebP blob
      // targeted at mobile (portrait) or desktop (landscape) based on the
      // source aspect ratio.
      const resized = await resizeCustomBackground(file).catch(() => null);
      let toUpload = file;
      if (resized?.blob) {
        // Warn the user if their upload's orientation doesn't match their
        // current device — it'll stretch on the other form factor.
        if (resized.orientation === 'mobile' && isDesktop) {
          const proceed = window.confirm(
            'Your image is portrait (mobile-sized). On desktop it will be stretched to fit the wider screen. Upload anyway?',
          );
          if (!proceed) { setUploading(false); e.target.value = ''; return; }
        } else if (resized.orientation === 'desktop' && !isDesktop) {
          const proceed = window.confirm(
            'Your image is landscape (desktop-sized). On mobile it may be cropped or letterboxed. Upload anyway?',
          );
          if (!proceed) { setUploading(false); e.target.value = ''; return; }
        }
        // Wrap the blob back into a File so uploadToR2 (which keys by name)
        // gets a stable filename.
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

  if (!chat) return <div className="min-h-full"><StackSkeleton rows={4} height={64} /></div>;

  const otherUserId = chat.participants?.find(id => id !== auth.currentUser?.uid);
  // Live identity from the persisted cache first; chat.metadata is a frozen
  // creation-time snapshot and renders someone's old name/avatar.
  const otherUser = peekChatUser(otherUserId) || chat.metadata?.[otherUserId];
  const bgsByCategory = getBackgroundsByCategory();

  return (
    <div className="min-h-full">
      {/* Header */}
      {isMobile ? (
        <header className="sticky top-0 z-40 glass-header flex items-center gap-3 px-5 py-4 border-b border-white/[0.04]" style={IS_NATIVE_BUILD ? { paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' } : undefined}>
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
              (chat.groupIcon || chat.groupAvatar) ? <img src={chat.groupIcon || chat.groupAvatar} alt="" className="w-full h-full object-cover" /> : <span>👥</span>
            ) : (
              <UserAvatar src={otherUser?.avatar} size={96} />
            )}
          </div>
          <h2 className="text-xl font-bold text-white">
            {chat.isGroup ? chat.groupName : (otherUser?.displayName || otherUser?.username || otherUser?.name) || 'Direct Message'}
          </h2>
          {!chat.isGroup && otherUserId && (
            <p className={`text-xs mt-1 font-bold ${presMap[otherUserId] ? 'text-green-400' : 'text-text-muted'}`}>
              {presMap[otherUserId] ? 'Online' : 'Offline'}
            </p>
          )}
          {chat.isGroup && <p className="text-xs text-text-muted mt-1">{chat.participants?.length || 0} members</p>}
        </div>

        {/* ═══════ Group Visibility (owner only) ═══════ */}
        {chat.isGroup && chat.createdBy === auth.currentUser?.uid && (
          <div className="mb-6">
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest px-1 mb-3">Visibility</p>
            <div className="bg-surface-1 rounded-2xl border border-white/[0.06] p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-brand-violet/10 flex items-center justify-center shrink-0">
                  <Icon name={chat.visibility === 'public' ? 'public' : 'lock'} size={20} className="text-brand-violet-light" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white">
                    {chat.visibility === 'public' ? 'Public group' : 'Private group'}
                  </p>
                  <p className="text-[11px] text-text-muted leading-snug mt-0.5">
                    {chat.visibility === 'public'
                      ? 'Anyone can find this group in Browse Groups and join.'
                      : 'Only invited members can see and join this group.'}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    const next = chat.visibility === 'public' ? 'private' : 'public';
                    try {
                      await updateDoc(doc(db, 'conversations', chatId), { visibility: next });
                    } catch (err) {
                      console.error('Failed to update visibility', err);
                    }
                  }}
                  role="switch"
                  aria-checked={chat.visibility === 'public'}
                  className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                    chat.visibility === 'public' ? 'bg-brand-violet' : 'bg-white/[0.12]'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                      chat.visibility === 'public' ? 'translate-x-5' : ''
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ═══════ Auto-delete (disappearing messages) ═══════ */}
        <div className="mb-6">
          <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest px-1 mb-3">Auto-delete</p>
          <div className="bg-surface-1 rounded-2xl border border-white/[0.06] overflow-hidden">
            {TTL_OPTIONS.map((o) => (
              <button
                key={o.seconds}
                onClick={() => canSetTtl() && applyTtl(o.seconds)}
                disabled={!canSetTtl()}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 transition-colors disabled:opacity-50 border-b border-white/[0.03] last:border-b-0"
              >
                <Icon name="timer" size={18} className={chatTtl === o.seconds ? 'text-brand-violet-light' : 'text-text-muted'} />
                <span className={`text-sm flex-1 ${chatTtl === o.seconds ? 'text-brand-violet-light font-bold' : 'text-text-primary'}`}>{o.label}</span>
                {chatTtl === o.seconds && <Icon name="check" size={18} className="text-brand-violet-light" />}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-text-muted mt-2 px-1">
            {canSetTtl()
              ? 'Messages are deleted for everyone once they reach this age.'
              : 'Only group admins can change the auto-delete timer.'}
          </p>
        </div>

        {/* ═══════ Chat Background Section ═══════ */}
        {/* ── Chat themes (effect 12) ────────────────────────────────
            ⚠ ADDED BESIDE the wallpapers, never instead of them. The 7
            wallpapers and custom upload are a shipped feature and stay
            (founder, 2026-08-25). Picking a theme suppresses the wallpaper
            while it is on; clearing the theme brings it straight back. */}
        <div className="mb-6">
          <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest px-1 mb-3">Chat Theme</p>
          {canUseChatThemes(profile) ? (
            <div className="grid grid-cols-3 gap-2">
              {[null, ...CHAT_THEMES].map((t) => {
                const on = (chat?.chatTheme || null) === (t?.id || null);
                const cols = t ? chatThemeColors(t, false) : null;
                return (
                  <button
                    key={t?.id || 'none'}
                    type="button"
                    onClick={() => applyTheme(t?.id || null)}
                    className="rounded-xl overflow-hidden text-left transition-transform active:scale-[0.97]"
                    style={{ outline: on ? '2px solid var(--brand-violet,#7B1FFF)' : 'none', outlineOffset: 2 }}
                  >
                    <div className="h-16 relative" style={{ background: '#000' }}>
                      {t && (
                        <ChatGradient
                          colors={cols}
                          patternUrl={chatPatternUrl(t)}
                          sendCount={0}
                          tileSize={150}
                        />
                      )}
                      {!t && (
                        <div className="absolute inset-0 grid place-items-center text-text-muted">
                          <Icon name="block" size={18} />
                        </div>
                      )}
                    </div>
                    <div className="px-2 py-1.5 bg-surface-2/60">
                      <span className="text-[11px] font-bold text-text-primary">{t?.name || 'None'}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-2 px-1 py-3 text-text-muted">
              <Icon name="lock" size={14} />
              <span className="text-[12px]">
                Chat themes unlock at level {CHAT_THEME_LEVEL}, or with Pro.
              </span>
            </div>
          )}

          {/* ── MOVEMENT ────────────────────────────────────────────
              Five structurally DIFFERENT models, not five tunings of one.
              See the header in ChatGradient.jsx for why that distinction is
              the whole point. Each chip previews itself LIVE and with no
              pattern mask, because the only thing separating these is how
              they move and a static swatch would say nothing at all. */}
          {canUseChatThemes(profile) && chat?.chatTheme && (
            <div className="mt-4">
              <p className="text-[11px] text-text-secondary mb-2 px-1">Movement</p>
              <div className="grid grid-cols-5 gap-2">
                {CHAT_MOTIONS.map((mo) => {
                  const on = chatMotionFor(chat) === mo.id;
                  return (
                    <button
                      key={mo.id}
                      type="button"
                      onClick={() => applyMotion(mo.id)}
                      title={mo.blurb}
                      className="rounded-xl overflow-hidden text-left transition-transform active:scale-[0.97]"
                      style={{ outline: on ? '2px solid var(--brand-violet,#7B1FFF)' : 'none', outlineOffset: 2 }}
                    >
                      <div className="h-12 relative" style={{ background: '#000', isolation: 'isolate' }}>
                        <ChatGradient
                          colors={themeColors.list}
                          patternUrl={null}
                          motion={mo.id}
                          sendCount={0}
                          intensity={100}
                        />
                      </div>
                      <div className="px-1 pt-1 pb-0.5">
                        <span className="text-[10px] font-bold text-text-secondary">{mo.name}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── YOUR OWN COLOURS ────────────────────────────────────
              The preset picks the icons; the colours are yours. Four swatches,
              each opening the same picker (with the screen eyedropper) that the
              name gradient uses, so there is one colour-picking UI in the app
              rather than two. */}
          {canUseChatThemes(profile) && chat?.chatTheme && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-[11px] text-text-secondary">
                  Colours {themeColors.custom ? '(yours)' : '(preset)'}
                </span>
                {themeColors.custom && (
                  <button
                    type="button"
                    onClick={() => { setDraft(null); setEditing(-1); applyThemeColors(null); }}
                    className="text-[11px] font-bold text-brand-violet-light"
                  >
                    Reset
                  </button>
                )}
              </div>

              {/* ⚠ A LIVE PREVIEW, not four blind swatches. The first version put
                  the shared accent picker here, whose swatch draws a rainbow
                  disc over the colour so that "any colour" reads as an
                  affordance. With four of them in a row you could not see your
                  own colours at all, and nothing showed what the blend would
                  look like. This is the real gradient with the real pattern,
                  repainting as you drag. */}
              <div
                className="relative w-full h-28 rounded-2xl overflow-hidden mb-3"
                style={{ isolation: 'isolate', background: '#000' }}
              >
                <ChatGradient
                  colors={shownColors}
                  patternUrl={chatPatternUrl(activeTheme)}
                  sendCount={0}
                  tileSize={300}
                />
                <div className="absolute left-3 top-3 px-3 py-1.5 rounded-2xl rounded-bl-sm bg-surface-2/90">
                  <span className="text-[11px] text-white/70">Hey, nice game!</span>
                </div>
                <div
                  className="absolute right-3 bottom-3 px-3 py-1.5 rounded-2xl rounded-br-sm"
                  style={{ background: `linear-gradient(160deg, ${shownColors[3] || shownColors[0]}, ${shownColors[2] || shownColors[1]})` }}
                >
                  <span className="text-[11px] text-white">GG, run it back</span>
                </div>
              </div>

              <div className="flex gap-2">
                {shownColors.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setEditing(editing === i ? -1 : i)}
                    className="flex-1 h-11 rounded-xl transition-transform active:scale-95"
                    style={{
                      background: c,
                      boxShadow: editing === i
                        ? '0 0 0 2px #fff'
                        : 'inset 0 0 0 1px rgba(255,255,255,0.18)',
                    }}
                    title={c}
                  />
                ))}
              </div>

              {editing >= 0 && (
                <div className="mt-3 p-3 rounded-2xl bg-surface-1">
                  <ColorField
                    value={shownColors[editing]}
                    onChange={(v) => setDraftColor(editing, v)}
                    height={150}
                  />
                  <button
                    type="button"
                    onClick={() => { setEditing(-1); applyThemeColors(draft); }}
                    className="mt-3 w-full py-2 rounded-xl text-xs font-bold text-white"
                    style={{ background: 'var(--brand-violet,#7B1FFF)' }}
                  >
                    Done
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mb-6">
          <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest px-1 mb-3">Chat Background</p>

          {/* Preview card */}
          <button
            onClick={() => canEditBackground() && setShowBgPicker(!showBgPicker)}
            className="w-full bg-surface-1 rounded-2xl border border-white/[0.06] overflow-hidden hover:border-white/[0.12] transition-all group"
          >
            <div className="h-28 w-full relative overflow-hidden" style={getChatBgStyle(selectedBg, customImageUrl, { isDesktop })}>
              <div className="absolute inset-0 p-4 flex flex-col justify-center gap-2 relative">
                <div className="flex justify-start">
                  <div className="bg-surface-2/90 border border-white/[0.04] rounded-2xl rounded-bl-sm px-4 py-2 max-w-[55%]">
                    <p className="text-[11px] text-white/60">Hey, nice game!</p>
                  </div>
                </div>
                <div className="flex justify-end">
                  <div className="bg-brand-violet rounded-2xl rounded-br-sm px-4 py-2 max-w-[55%]">
                    <p className="text-[11px] text-bg-dark/70">GG! Let's run it back</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between p-3 bg-surface-2/50">
              <div className="flex items-center gap-2">
                <Icon name="wallpaper" size={18} className="text-brand-violet-light" />
                <span className="text-sm text-text-primary font-medium">
                  {getChatBackground(selectedBg)?.name || 'Wallpaper'}
                </span>
              </div>
              {canEditBackground() && (
                <div className="flex items-center gap-1 text-text-muted group-hover:text-brand-violet-light transition-colors">
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
                          selectedBg === bg.id ? 'border-brand-violet border-brand-violet' : 'border-white/[0.04] hover:border-white/20'
                        }`}
                      >
                        <div className="absolute inset-0" style={{ ...getChatBgStyle(bg.id, '', { isDesktop }), backgroundSize: 'cover', backgroundRepeat: 'no-repeat' }} />
                        {selectedBg === bg.id && (
                          <div className="absolute top-1 left-1 w-4 h-4 rounded-full bg-brand-violet flex items-center justify-center">
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
                      selectedBg === 'custom_image' ? 'border-brand-violet border-brand-violet' : 'border-white/[0.04] hover:border-white/20'
                    }`}
                  >
                    <div className="absolute inset-0 flex items-center justify-center bg-surface-2">
                      <Icon name="add_photo_alternate" size={24} className="text-text-muted" />
                    </div>
                    {selectedBg === 'custom_image' && (
                      <div className="absolute top-1 left-1 w-4 h-4 rounded-full bg-brand-violet flex items-center justify-center">
                        <Icon name="check" size={12} className="text-bg-dark" />
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
                    <div className={`w-2 h-2 rounded-full ${presMap[uid] ? 'bg-green-400' : 'bg-text-muted/30'}`} />
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