import { useState } from 'react';
import Icon from '../Icon';
import { uploadToR2 } from '../../utils/r2Storage';
import { VERGRME_DISPLAY_PREFIX } from '../../utils/vergrMeUrl';
import { Card, Field } from './EditorUI';

export function ProfileCard({ form, patch, profile, username }) {
  const avatar = form.useProfileAvatar ? (profile?.avatar || profile?.photoURL) : form.customAvatarUrl;
  const upload = async (file) => {
    if (!file) return;
    const { url } = await uploadToR2(file, 'avatar');
    patch({ customAvatarUrl: url, useProfileAvatar: false });
  };
  return (
    <Card title="Profile">
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          {avatar ? (
            <img src={avatar} alt="" className="w-20 h-20 rounded-full object-cover border-4 border-white/10 shadow-lg" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-surface-2 border-4 border-white/10 flex items-center justify-center text-2xl">{(form.displayName || '?').charAt(0).toUpperCase()}</div>
          )}
          <label className="absolute bottom-0 right-0 w-7 h-7 bg-gradient-to-r from-brand-violet to-brand-pink rounded-full flex items-center justify-center text-white shadow-lg cursor-pointer hover:scale-110 transition-transform">
            <Icon name="photo_camera" size={14} />
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files[0] && upload(e.target.files[0])} />
          </label>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{form.displayName || username}</p>
          <p className="text-sm text-text-muted">@{username}</p>
          <p className="text-xs text-brand-violet-light font-mono mt-0.5 truncate">{VERGRME_DISPLAY_PREFIX}{username}</p>
        </div>
      </div>
      <div className="flex flex-col gap-3 mt-4">
        {form.useProfileAvatar === false && (
          <button onClick={() => patch({ useProfileAvatar: true })} className="self-start text-[11px] text-brand-violet-light">Use my profile photo instead</button>
        )}
        <Field label="Display name">
          <input value={form.displayName || ''} onChange={(e) => patch({ displayName: e.target.value })} className="input-mini" />
        </Field>
        <Field label={`Bio (${(form.bio || '').length}/200)`}>
          <textarea value={form.bio || ''} onChange={(e) => patch({ bio: e.target.value.slice(0, 200) })} rows={3} className="input-mini resize-none" placeholder="Tell visitors who you are…" />
        </Field>
      </div>
    </Card>
  );
}

export function PopupsCard({ form, patch }) {
  const [busy, setBusy] = useState(false);
  const popups = form.popups || {};
  const product = popups.product || {};
  const email = popups.email || {};
  const up = (key, obj) => patch({ popups: { ...popups, [key]: { ...(popups[key] || {}), ...obj } } });

  const uploadImg = async (file) => {
    if (!file) return;
    setBusy(true);
    try { const { url } = await uploadToR2(file, 'post'); up('product', { imageUrl: url }); }
    finally { setBusy(false); }
  };

  return (
    <Card title="Page pop-ups" subtitle="Grab attention when visitors land on your page">
      <div className="flex flex-col gap-3">
        {/* Promote product */}
        <div className="p-4 rounded-xl border border-brand-pink/20 bg-brand-pink/5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-ember to-brand-pink flex items-center justify-center text-white"><Icon name="redeem" size={18} /></div>
              <div>
                <p className="text-sm font-medium">Promote a product</p>
                <p className="text-xs text-text-muted">Show a promo popup to visitors</p>
              </div>
            </div>
            <Switch on={!!product.enabled} onClick={() => up('product', { enabled: !product.enabled })} />
          </div>
          {product.enabled && (
            <div className="flex flex-col gap-2">
              <input value={product.name || ''} onChange={(e) => up('product', { name: e.target.value })} placeholder="Product name" className="input-mini" />
              <input value={product.url || ''} onChange={(e) => up('product', { url: e.target.value })} placeholder="Product URL" className="input-mini" type="url" />
              <label className="flex items-center justify-center gap-2 py-2 border border-dashed border-white/10 rounded-lg text-xs text-text-muted cursor-pointer">
                <Icon name={busy ? 'hourglass_empty' : 'upload'} size={14} /> {product.imageUrl ? 'Replace image' : 'Product image (optional)'}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files[0] && uploadImg(e.target.files[0])} />
              </label>
            </div>
          )}
        </div>

        {/* Collect emails */}
        <div className="p-4 rounded-xl border border-gem-blue/20 bg-gem-blue/5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-gem-blue to-brand-violet flex items-center justify-center text-white"><Icon name="mark_email_read" size={18} /></div>
              <div>
                <p className="text-sm font-medium">Collect emails</p>
                <p className="text-xs text-text-muted">Build your mailing list</p>
              </div>
            </div>
            <Switch on={!!email.enabled} onClick={() => up('email', { enabled: !email.enabled })} />
          </div>
          {email.enabled && (
            <div className="flex flex-col gap-2">
              <input value={email.heading || ''} onChange={(e) => up('email', { heading: e.target.value })} placeholder="Popup heading" className="input-mini" />
              <input value={email.description || ''} onChange={(e) => up('email', { description: e.target.value })} placeholder="Popup description" className="input-mini" />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function Switch({ on, onClick }) {
  return (
    <button onClick={onClick} className={`w-10 h-6 rounded-full transition-colors relative shrink-0 ${on ? 'bg-brand-violet' : 'bg-surface-2'}`}>
      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}
