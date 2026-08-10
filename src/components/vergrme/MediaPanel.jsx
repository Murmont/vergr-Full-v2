import { useState } from 'react';
import Icon from '../Icon';
import { uploadToR2 } from '../../utils/r2Storage';
import { newBlock } from '../../hooks/useVergrMe';
import { Card } from './EditorUI';

// Media library: upload images straight into image/gallery blocks, and manage
// existing media blocks at a glance.
export default function MediaPanel({ form, patch, blocks, setBlocks, onSelect }) {
  const [busy, setBusy] = useState(false);
  const mediaBlocks = blocks.filter((b) => ['image', 'gallery', 'video'].includes(b.type));

  const addImage = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const { url } = await uploadToR2(file, 'post');
      setBlocks([...blocks, { ...newBlock('image', { url }), order: blocks.length }]);
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card title="Add media" subtitle="Drop images and videos right onto your page">
        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col items-center gap-1.5 py-5 rounded-xl border border-dashed border-white/10 cursor-pointer hover:border-brand-violet/40">
            <Icon name={busy ? 'hourglass_empty' : 'add_photo_alternate'} size={22} className="text-brand-violet-light" />
            <span className="text-[11px]">{busy ? 'Uploading…' : 'Upload image'}</span>
            <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={(e) => e.target.files[0] && addImage(e.target.files[0])} />
          </label>
          <button onClick={() => { setBlocks([...blocks, { ...newBlock('gallery'), order: blocks.length }]); onSelect('links'); }} className="flex flex-col items-center gap-1.5 py-5 rounded-xl border border-white/10 bg-surface-2/60 hover:border-brand-violet/40">
            <Icon name="photo_library" size={22} className="text-brand-violet-light" />
            <span className="text-[11px]">New gallery</span>
          </button>
          <button onClick={() => { setBlocks([...blocks, { ...newBlock('video'), order: blocks.length }]); onSelect('links'); }} className="flex flex-col items-center gap-1.5 py-5 rounded-xl border border-white/10 bg-surface-2/60 hover:border-brand-violet/40">
            <Icon name="smart_display" size={22} className="text-brand-violet-light" />
            <span className="text-[11px]">Add video</span>
          </button>
        </div>
      </Card>

      <Card title="Page background" subtitle="Set a background image, GIF or video in Appearance">
        <button onClick={() => onSelect('appearance')} className="w-full flex items-center justify-between p-3 bg-surface-2/60 rounded-xl border border-white/5 hover:border-brand-violet/30">
          <span className="text-sm flex items-center gap-2"><Icon name="wallpaper" size={18} className="text-brand-violet-light" /> {form.background?.url ? 'Background set' : `Background: ${form.background?.type || 'gradient'}`}</span>
          <Icon name="chevron_right" size={18} className="text-text-muted" />
        </button>
      </Card>

      <Card title={`Media on your page (${mediaBlocks.length})`}>
        {mediaBlocks.length === 0 ? (
          <p className="text-xs text-text-muted text-center py-4">No media blocks yet</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {mediaBlocks.map((b) => (
              <button key={b.id} onClick={() => onSelect('links')} className="relative aspect-square rounded-lg overflow-hidden bg-surface-2 border border-white/5">
                {b.url || (b.images && b.images[0]) ? (
                  <img src={b.url || b.images[0]} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center"><Icon name={b.type === 'video' ? 'smart_display' : 'image'} size={20} className="text-text-muted" /></div>
                )}
                <span className="absolute bottom-0 inset-x-0 text-[9px] bg-black/50 text-white py-0.5 text-center capitalize">{b.type}</span>
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
