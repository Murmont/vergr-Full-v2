// Create Event.
//
// Founder ruling 2026-08-16: *"tickets should still exist but they are not about
// tournaments anymore, they are live events or anything a user would want to
// have an event"*. So this screen deliberately has NO game picker, NO entry fee,
// NO prize pool, NO bracket format and NO player cap. A host names the thing,
// says when it is, and sets a ticket price. That is the whole product.
//
// Writes through `createEventSecure` (functions/events.js), which is separate
// from the retired tournament path on purpose: `createTournamentSecure` throws.

import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon';
import TopBar from '../../components/TopBar';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import useResponsive from '../../hooks/useResponsive';
import { createEventSecure, uploadTournamentBanner } from '../../firebase/firestore';

const KINDS = [
  { id: 'live',      icon: 'sensors',          label: 'Live show',   blurb: 'You go live and people watch' },
  { id: 'watch',     icon: 'groups',           label: 'Watch party', blurb: 'Watch something together' },
  { id: 'talk',      icon: 'forum',            label: 'Q&A / talk',  blurb: 'AMA, interview, panel' },
  { id: 'music',     icon: 'music_note',       label: 'Music',       blurb: 'Set, performance, listening' },
  { id: 'class',     icon: 'school',           label: 'Class',       blurb: 'Workshop, tutorial, coaching' },
  { id: 'community', icon: 'celebration',      label: 'Community',   blurb: 'Meetup, hangout, game night' },
];

const AUDIENCES = [
  { id: 'public',      label: 'Anyone',      blurb: 'Any Vergr user can buy a ticket' },
  { id: 'followers',   label: 'Followers',   blurb: 'They have to follow you first' },
  { id: 'subscribers', label: 'Members',     blurb: 'Only your paying members' },
  { id: 'invite',      label: 'Invite only', blurb: 'Only people you invite' },
];

// Local datetime -> ms. `datetime-local` has no timezone, which is what we want:
// the host means their own wall clock.
const toMs = (v) => (v ? new Date(v).getTime() : 0);

// Default to the next round hour, tomorrow. An empty date field is the single
// biggest reason a create form gets abandoned.
function defaultStart() {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CreateEventScreen() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const { isDesktop } = useResponsive();

  const [kind, setKind] = useState('live');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startsAt, setStartsAt] = useState(defaultStart);
  const [priceCoins, setPriceCoins] = useState(0);
  const [capacity, setCapacity] = useState(0);
  const [audience, setAudience] = useState('public');
  const [bannerUrl, setBannerUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  const nameOk = name.trim().length >= 3;
  const startOk = toMs(startsAt) > Date.now() - 60 * 60 * 1000;
  const canSave = nameOk && startOk && !saving && !uploading;

  const pickBanner = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !currentUser) return;
    setUploading(true);
    try {
      const url = await uploadTournamentBanner(currentUser.uid, file);
      setBannerUrl(url);
    } catch (err) {
      showToast?.(err?.message || 'Could not upload that image.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await createEventSecure({
        name: name.trim(),
        description: description.trim(),
        kind,
        audience,
        startsAt: toMs(startsAt),
        priceCoins: Math.max(0, Math.floor(Number(priceCoins) || 0)),
        capacity: Math.max(0, Math.floor(Number(capacity) || 0)),
        bannerUrl,
      });
      showToast?.('Event created.', 'success');
      navigate(`/e/${res.eventId}`);
    } catch (err) {
      showToast?.(err?.message || 'Could not create the event.', 'error');
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen pb-32 lg:pb-10">
      <TopBar showBack title="Create event" />

      <div className={`px-4 py-4 space-y-6 ${isDesktop ? 'max-w-2xl mx-auto' : ''}`}>

        {/* Kind */}
        <Section title="What is it?">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {KINDS.map((k) => {
              const on = kind === k.id;
              return (
                <button key={k.id} type="button" onClick={() => setKind(k.id)}
                  className={`p-3 rounded-2xl text-left transition-colors border ${
                    on ? 'border-brand-violet bg-brand-violet/10' : 'border-white/[0.06] bg-surface-1 hover:border-white/20'
                  }`}>
                  <Icon name={k.icon} size={20} className={on ? 'text-brand-violet-light' : 'text-text-muted'} />
                  <p className="text-sm font-bold text-white mt-1.5">{k.label}</p>
                  <p className="text-[11px] text-text-muted leading-snug">{k.blurb}</p>
                </button>
              );
            })}
          </div>
        </Section>

        {/* Name + description */}
        <Section title="Details">
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 80))}
            placeholder="Event name"
            className="w-full px-4 py-3 rounded-xl bg-surface-1 border border-white/[0.06] text-white placeholder:text-text-muted text-sm outline-none focus:border-brand-violet/50"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 2000))}
            placeholder="What should people expect? (optional)"
            rows={4}
            className="w-full mt-2 px-4 py-3 rounded-xl bg-surface-1 border border-white/[0.06] text-white placeholder:text-text-muted text-sm outline-none focus:border-brand-violet/50 resize-none"
          />
        </Section>

        {/* When */}
        <Section title="When">
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-surface-1 border border-white/[0.06] text-white text-sm outline-none focus:border-brand-violet/50"
          />
          {!startOk && (
            <p className="text-brand-ember text-xs mt-2">That start time is in the past.</p>
          )}
        </Section>

        {/* Ticket */}
        <Section title="Ticket" sub="Leave the price at 0 for a free event.">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Price (coins)">
              <input
                type="number" min={0} inputMode="numeric"
                value={priceCoins}
                onChange={(e) => setPriceCoins(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-surface-1 border border-white/[0.06] text-white font-dmmono tabular-nums text-sm outline-none focus:border-brand-violet/50"
              />
            </Field>
            <Field label="Capacity">
              <input
                type="number" min={0} inputMode="numeric"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                placeholder="0 = unlimited"
                className="w-full px-4 py-3 rounded-xl bg-surface-1 border border-white/[0.06] text-white font-dmmono tabular-nums text-sm outline-none focus:border-brand-violet/50"
              />
            </Field>
          </div>
          <p className="text-text-muted text-[11px] mt-2 leading-relaxed">
            Ticket sales are revenue Vergr earns, and Vergr pays you your share of it on your payout
            schedule. Your share starts at 50% and rises to 80% as your lifetime earnings grow. There is
            no separate ticket fee.
          </p>
        </Section>

        {/* Audience */}
        <Section title="Who can buy a ticket?">
          <div className="grid grid-cols-2 gap-2">
            {AUDIENCES.map((a) => {
              const on = audience === a.id;
              return (
                <button key={a.id} type="button" onClick={() => setAudience(a.id)}
                  className={`p-3 rounded-xl text-left transition-colors border ${
                    on ? 'border-brand-violet bg-brand-violet/10' : 'border-white/[0.06] bg-surface-1 hover:border-white/20'
                  }`}>
                  <p className="text-sm font-bold text-white">{a.label}</p>
                  <p className="text-[11px] text-text-muted leading-snug">{a.blurb}</p>
                </button>
              );
            })}
          </div>
        </Section>

        {/* Banner */}
        <Section title="Cover image" sub="Optional, but events with one get opened more.">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickBanner} />
          {bannerUrl ? (
            <div className="relative rounded-2xl overflow-hidden border border-white/[0.06]">
              <img src={bannerUrl} alt="" className="w-full h-40 object-cover" />
              <button type="button" onClick={() => setBannerUrl(null)}
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/70 grid place-items-center text-white">
                <Icon name="close" size={16} />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
              className="w-full h-28 rounded-2xl border border-dashed border-white/15 bg-surface-1 grid place-items-center text-text-muted hover:border-brand-violet/40 transition-colors">
              {uploading
                ? <span className="text-sm">Uploading…</span>
                : <span className="flex items-center gap-2 text-sm"><Icon name="add_photo_alternate" size={20} /> Add a cover image</span>}
            </button>
          )}
        </Section>
      </div>

      {/* Save */}
      <div className="fixed bottom-0 left-0 right-0 lg:static p-4 bg-bg-dark/95 backdrop-blur border-t border-white/[0.06] lg:bg-transparent lg:border-0">
        <div className={isDesktop ? 'max-w-2xl mx-auto' : ''}>
          <button onClick={save} disabled={!canSave}
            className={`w-full py-3.5 rounded-xl font-extrabold text-sm transition-all ${
              canSave ? 'bg-brand-violet text-white hover:bg-brand-violet-light' : 'bg-white/[0.06] text-text-muted cursor-not-allowed'
            }`}>
            {saving ? 'Creating…' : 'Create event'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, sub, children }) {
  return (
    <section>
      <h2 className="font-syne text-sm font-bold text-white mb-1">{title}</h2>
      {sub && <p className="text-text-muted text-[11px] mb-2">{sub}</p>}
      {!sub && <div className="mb-2" />}
      {children}
    </section>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] text-text-muted mb-1">{label}</span>
      {children}
    </label>
  );
}
