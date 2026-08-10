// CreateVoiceChannelModal — name + visibility picker. After creation, the
// modal closes and navigates to the new channel. Invites are managed inside
// the channel screen itself (separate modal).

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createVoiceChannel } from '../firebase/firestore';
import { useUI } from '../context/UIContext';
import Icon from './Icon';

export default function CreateVoiceChannelModal({ onClose }) {
  const navigate = useNavigate();
  const { showToast } = useUI();
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 1) {
      showToast('Pick a name', 'error');
      return;
    }
    setBusy(true);
    try {
      const channelId = await createVoiceChannel({ name: trimmed, visibility });
      showToast('Voice channel created', 'success');
      onClose?.();
      navigate(`/messages/voice/${channelId}`);
    } catch (err) {
      showToast(err.message || 'Failed to create channel', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-surface-1 border border-white/[0.08] p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-syne text-xl font-extrabold text-text-primary">New Voice Channel</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <Icon name="close" size={20} />
          </button>
        </div>

        <label className="block mb-4">
          <span className="text-[10px] font-dmmono uppercase tracking-[0.14em] text-text-muted">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 40))}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="e.g. Late Night Squad"
            className="mt-1.5 w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] focus:border-brand-violet/40 outline-none text-text-primary text-sm"
          />
          <span className="text-[10px] text-text-muted mt-1 block">{name.length}/40</span>
        </label>

        <div className="mb-5">
          <span className="text-[10px] font-dmmono uppercase tracking-[0.14em] text-text-muted block mb-2">Who can join</span>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setVisibility('private')}
              className={`p-3 rounded-xl border text-left transition-colors ${
                visibility === 'private'
                  ? 'bg-brand-violet/15 border-brand-violet/40 text-text-primary'
                  : 'bg-white/[0.03] border-white/[0.06] text-text-muted hover:text-text-primary'
              }`}
            >
              <Icon name="lock" size={16} className="mb-1" />
              <div className="text-sm font-bold">Private</div>
              <div className="text-[11px] opacity-75 mt-0.5">Only invited members</div>
            </button>
            <button
              onClick={() => setVisibility('public')}
              className={`p-3 rounded-xl border text-left transition-colors ${
                visibility === 'public'
                  ? 'bg-brand-violet/15 border-brand-violet/40 text-text-primary'
                  : 'bg-white/[0.03] border-white/[0.06] text-text-muted hover:text-text-primary'
              }`}
            >
              <Icon name="public" size={16} className="mb-1" />
              <div className="text-sm font-bold">Public</div>
              <div className="text-[11px] opacity-75 mt-0.5">Anyone with the link</div>
            </button>
          </div>
        </div>

        <p className="text-[11px] text-text-muted mb-5">
          {visibility === 'private'
            ? "You'll be able to invite members from the channel screen after it's created."
            : 'Public channels are open to anyone who has the link. You can still kick + ban users.'}
        </p>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06] text-text-secondary text-sm font-semibold hover:bg-white/[0.07]"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !name.trim()}
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-brand-violet to-brand-pink text-white text-sm font-bold disabled:opacity-50 hover:brightness-110"
          >
            {busy ? 'Creating…' : 'Create Channel'}
          </button>
        </div>
      </div>
    </div>
  );
}
