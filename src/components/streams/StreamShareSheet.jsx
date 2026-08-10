// Share sheet for a live stream. Produces a /share/stream/:id link (server-
// rendered OG preview = broadcaster thumbnail + title + LIVE status via the
// shareLink function) and offers Vergr-internal + external-platform targets,
// on par with mainstream streaming apps. Used by ViewerStreamScreen +
// BroadcasterScreen.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUI } from '../../context/UIContext';
import { useAuth } from '../../context/AuthContext';
import { createPost } from '../../firebase/firestore';
import { withRef } from '../../utils/shareRef';
import { renderShareCard } from '../../utils/shareCard';
import Icon from '../Icon';

const SHARE_BASE = 'https://vergr.app/share/stream';

export default function StreamShareSheet({ streamId, streamTitle, hostName, live = true, onClose }) {
  const { showToast } = useUI();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [posting, setPosting] = useState(false);

  if (!streamId) return null;
  // Ride the referral loop: a shared stream link credits the sharer.
  const url = withRef(`${SHARE_BASE}/${streamId}`);
  const text = `${live ? '🔴 LIVE on VERGR' : 'Watch on VERGR'}${hostName ? ` — ${hostName}` : ''}${streamTitle ? `: ${streamTitle}` : ''}`;

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); showToast('Link copied', 'success'); }
    catch { showToast('Could not copy', 'error'); }
  };

  const ext = (href) => { window.open(href, '_blank', 'noopener,noreferrer'); onClose?.(); };

  const targets = [
    { id: 'whatsapp', label: 'WhatsApp', icon: 'chat', color: '#25D366', go: () => ext(`https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`) },
    { id: 'x', label: 'X', icon: 'tag', color: '#1d9bf0', go: () => ext(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`) },
    { id: 'facebook', label: 'Facebook', icon: 'thumb_up', color: '#1877F2', go: () => ext(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`) },
    { id: 'telegram', label: 'Telegram', icon: 'send', color: '#229ED9', go: () => ext(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`) },
    { id: 'reddit', label: 'Reddit', icon: 'forum', color: '#FF4500', go: () => ext(`https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(text)}`) },
    // Discord has no public web share-intent; copy the link to paste into a channel.
    { id: 'discord', label: 'Discord', icon: 'sports_esports', color: '#5865F2', go: async () => { await copy(); showToast('Link copied — paste it in Discord', 'success'); onClose?.(); } },
  ];

  // Vergr-internal: post the stream link to the user's feed (renders as a card
  // for followers). Reliable + genuinely "share on VERGR".
  const shareToFeed = async () => {
    if (posting || !currentUser?.uid) { if (!currentUser) showToast('Sign in to share', 'info'); return; }
    setPosting(true);
    try {
      await createPost(currentUser.uid, { type: 'text', content: `${text}\n${url}`, visibility: 'public' });
      showToast('Shared to your feed', 'success');
      onClose?.();
    } catch (e) { showToast(e?.message || 'Could not share', 'error'); }
    finally { setPosting(false); }
  };

  const nativeShare = async () => {
    if (!navigator.share) { copy(); return; }
    try { await navigator.share({ title: 'VERGR', text, url }); onClose?.(); }
    catch { /* user cancelled */ }
  };

  // Branded image share: render a VERGR-framed card client-side and share it as
  // a file (with the ref link in the caption). Falls back to a plain link share.
  const [imgBusy, setImgBusy] = useState(false);
  const shareImage = async () => {
    if (imgBusy) return;
    setImgBusy(true);
    try {
      const blob = await renderShareCard({
        layout: 'wide',
        headline: hostName || 'Live on VERGR',
        subline: streamTitle || 'Tap to watch',
        live,
      });
      const file = blob && new File([blob], 'vergr-stream.png', { type: 'image/png' });
      if (file && navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: 'VERGR', text: `${text}\n${url}`, files: [file] });
        onClose?.();
      } else {
        nativeShare();
      }
    } catch { /* cancelled */ }
    finally { setImgBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative z-10 w-full sm:max-w-md bg-surface-1 border border-surface-3 rounded-t-3xl sm:rounded-3xl p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: 'calc(20px + env(safe-area-inset-bottom))' }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-syne font-bold text-text-primary text-lg">Share stream</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center">
            <Icon name="close" size={18} className="text-text-secondary" />
          </button>
        </div>

        {/* Vergr-internal + native */}
        <div className="flex gap-2 mb-4">
          <button onClick={shareToFeed} disabled={posting}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-brand-violet/20 border border-brand-violet/40 text-brand-violet-light font-bold text-sm">
            <Icon name="dynamic_feed" size={18} /> {posting ? 'Sharing…' : 'Share on VERGR'}
          </button>
          {typeof navigator !== 'undefined' && navigator.share && (
            <button onClick={nativeShare}
              className="px-4 py-3 rounded-xl bg-surface-2 border border-surface-3 text-text-primary font-bold text-sm flex items-center gap-2">
              <Icon name="ios_share" size={18} /> More
            </button>
          )}
        </div>

        {/* Branded image share — a VERGR-framed card, unmistakably content. */}
        <button onClick={shareImage} disabled={imgBusy}
          className="w-full flex items-center justify-center gap-2 py-3 mb-4 rounded-xl bg-brand-violet/15 border border-brand-violet/40 text-brand-violet-light font-bold text-sm disabled:opacity-70">
          <Icon name="image" size={18} /> {imgBusy ? 'Preparing…' : 'Share as image'}
        </button>

        {/* External platforms */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-4">
          {targets.map((t) => (
            <button key={t.id} onClick={t.go} className="flex flex-col items-center gap-1.5">
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: `${t.color}22`, border: `1px solid ${t.color}44` }}>
                <Icon name={t.icon} size={22} style={{ color: t.color }} />
              </div>
              <span className="text-[11px] text-text-secondary">{t.label}</span>
            </button>
          ))}
        </div>

        {/* Copy link */}
        <button onClick={copy}
          className="w-full flex items-center gap-3 p-3 rounded-xl bg-surface-2 border border-surface-3 text-left">
          <Icon name="link" size={18} className="text-brand-violet-light shrink-0" />
          <span className="flex-1 text-xs text-text-secondary font-dmmono truncate">{url}</span>
          <span className="text-xs font-bold text-brand-violet-light shrink-0">Copy</span>
        </button>
      </div>
    </div>
  );
}
