import { useState, useEffect } from 'react';
import { getVergrMeProducts, fetchShopCatalog } from '../../utils/vergrMeShop';
import Icon from '../Icon';
import StoreGlyph, { STORE_BRANDS } from '../StoreIcons';
import { uploadToR2 } from '../../utils/r2Storage';
import { compressVideo } from '../../utils/mediaCompression';
import { SOCIAL_META, COLLECTION_LAYOUTS, FONT_PRESETS, loadVergrMeFont, SUPPORT_PROVIDERS, hasBlockStyle } from '../../utils/vergrMeThemes';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import useTier from '../../hooks/useTier';
import { getUserSquads, getUserTournaments, getConversations } from '../../firebase/firestore';
import VergrPicker from './VergrPicker';

// Per-block edit fields, rendered inside an expanded block card in ContentTab.
// `patch(obj)` shallow-merges fields into the block.
export default function BlockForm({ block, patch }) {
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(null); // { phase:'optimizing'|'uploading', pct:0-100 }
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const { tier } = useTier();
  const [picker, setPicker] = useState(null); // 'squad' | 'tournament' | 'event' | 'group'
  const uid = currentUser?.uid;

  const upload = async (file, kind, field) => {
    if (!file) return;
    setBusy(true);
    try {
      const { url } = await uploadToR2(file, kind);
      patch({ [field]: url });
    } catch (e) {
      console.error('vergr.me upload failed', e);
      showToast(e?.message || 'Upload failed — please try again', 'error');
    } finally {
      setBusy(false);
    }
  };

  // Video gets the full pipeline: re-encode/down-scale on-device (saves R2
  // storage, matches the "compress before upload" rule) with a live percentage
  // for each phase, real upload progress, a toast on failure, and a success
  // confirmation via the inline preview the form renders once `url` is set.
  const uploadVideo = async (file, field) => {
    if (!file) return;
    setBusy(true);
    setProg({ phase: 'optimizing', pct: 0 });
    try {
      const optimized = await compressVideo(
        file, tier,
        (p) => setProg({ phase: 'optimizing', pct: Math.round((p || 0) * 100) }),
        'clip',
      );
      setProg({ phase: 'uploading', pct: 0 });
      const { url } = await uploadToR2(optimized, 'clip', (pct) => setProg({ phase: 'uploading', pct }));
      patch({ [field]: url });
      showToast('Video uploaded', 'success');
    } catch (e) {
      console.error('vergr.me video upload failed', e);
      showToast(e?.message || 'Video upload failed — please try again', 'error');
    } finally {
      setBusy(false);
      setProg(null);
    }
  };

  const typeFields = (() => {
  switch (block.type) {
    case 'link':
      return (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input value={block.icon || ''} onChange={(e) => patch({ icon: e.target.value })} className="w-12 text-center input-mini text-xl" placeholder="🔗" />
            <input value={block.title || ''} onChange={(e) => patch({ title: e.target.value })} className="flex-1 input-mini" placeholder="Link title" />
          </div>
          <input value={block.url || ''} onChange={(e) => patch({ url: e.target.value })} className="input-mini" placeholder="https://..." type="url" />
          <input value={block.subtitle || ''} onChange={(e) => patch({ subtitle: e.target.value })} className="input-mini" placeholder="Subtitle (optional)" />
          <UploadRow label={block.thumbUrl ? 'Replace thumbnail' : 'Add thumbnail image'} busy={busy} accept="image/*" onPick={(f) => upload(f, 'post', 'thumbUrl')} />

          <p className="text-[11px] text-text-muted mt-1">Width</p>
          <SegPicker value={block.size || 'full'} onChange={(v) => patch({ size: v })} options={[['full', 'Full'], ['half', 'Half (grid)']]} />
          <Toggle label="Showcase (large featured card)" on={!!block.featured} onClick={() => patch({ featured: !block.featured })} />

          <p className="text-[11px] text-text-muted mt-1">Animation</p>
          <SegPicker value={block.animation || (block.highlight ? 'pulse' : 'none')} onChange={(v) => patch({ animation: v, highlight: v === 'pulse' })} options={[['none', 'None'], ['pulse', 'Pulse'], ['wobble', 'Wobble'], ['shake', 'Shake'], ['flash', 'Flash']]} />

          <p className="text-[11px] text-text-muted mt-1">Schedule (optional)</p>
          <div className="flex gap-2">
            <label className="flex-1 text-[10px] text-text-muted">Show from
              <input type="datetime-local" value={block.startAt || ''} onChange={(e) => patch({ startAt: e.target.value })} className="input-mini mt-0.5" />
            </label>
            <label className="flex-1 text-[10px] text-text-muted">Hide after
              <input type="datetime-local" value={block.endAt || ''} onChange={(e) => patch({ endAt: e.target.value })} className="input-mini mt-0.5" />
            </label>
          </div>

          <Toggle label="Sensitive content warning" on={!!block.sensitive} onClick={() => patch({ sensitive: !block.sensitive })} />
          <Toggle label="Age gate (18+ confirm)" on={!!block.ageGate} onClick={() => patch({ ageGate: !block.ageGate })} />
          <input value={block.passcode || ''} onChange={(e) => patch({ passcode: e.target.value })} className="input-mini" placeholder="Passcode lock (optional)" />
        </div>
      );

    case 'header':
      return (
        <div className="flex flex-col gap-2">
          <input value={block.text || ''} onChange={(e) => patch({ text: e.target.value })} className="input-mini" placeholder="Section title" />
          <TextStyle block={block} patch={patch} />
        </div>
      );

    case 'text':
      return (
        <div className="flex flex-col gap-2">
          <textarea value={block.text || ''} onChange={(e) => patch({ text: e.target.value })} rows={3} className="input-mini resize-none" placeholder="Write something…" />
          <TextStyle block={block} patch={patch} withBg />
        </div>
      );

    case 'socials':
      return (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-text-muted">Icon colour (real logos always shown)</p>
          <SegPicker value={block.colorMode || 'brand'} onChange={(v) => patch({ colorMode: v })} options={[['brand', 'Brand'], ['theme', 'Theme'], ['mono', 'Custom']]} />
          {(block.colorMode || 'brand') === 'mono' && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="color" value={block.monoColor || '#ffffff'} onChange={(e) => patch({ monoColor: e.target.value })} className="w-7 h-7 rounded" />
              <span className="text-[11px] text-text-muted">Monochrome colour</span>
            </label>
          )}
          <div className="flex flex-col gap-1.5 mt-1">
            {Object.keys(SOCIAL_META).map((key) => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-[11px] text-text-muted w-16 capitalize">{key}</span>
                <span className="text-[11px] text-text-muted/40">@</span>
                <input
                  value={block.socials?.[key] || ''}
                  onChange={(e) => patch({ socials: { ...block.socials, [key]: e.target.value } })}
                  placeholder={`your${key}`}
                  className="flex-1 input-mini"
                />
              </div>
            ))}
          </div>
        </div>
      );

    case 'image':
      return (
        <div className="flex flex-col gap-2">
          <UploadRow label={block.url ? 'Replace image' : 'Upload image'} busy={busy} accept="image/*" onPick={(f) => upload(f, 'post', 'url')} />
          <input value={block.caption || ''} onChange={(e) => patch({ caption: e.target.value })} className="input-mini" placeholder="Caption (optional)" />
          <input value={block.link || ''} onChange={(e) => patch({ link: e.target.value })} className="input-mini" placeholder="Link on tap (optional)" type="url" />
        </div>
      );

    case 'gallery':
      return (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-text-muted">Layout</p>
          <SegPicker value={block.layout || 'grid'} onChange={(v) => patch({ layout: v })} options={[['grid', '3-grid'], ['grid2', '2-grid'], ['carousel', 'Carousel']]} />
          <div className="grid grid-cols-3 gap-1.5">
            {(block.images || []).map((src, i) => (
              <div key={i} className="relative">
                <img src={src} alt="" className="w-full aspect-square object-cover rounded-md" />
                <button onClick={() => patch({ images: block.images.filter((_, j) => j !== i) })} className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-black/70 rounded-full text-white text-[10px]">✕</button>
              </div>
            ))}
          </div>
          <UploadRow label="Add image" busy={busy} accept="image/*" onPick={async (f) => {
            if (!f) return;
            setBusy(true);
            try { const { url } = await uploadToR2(f, 'post'); patch({ images: [...(block.images || []), url] }); }
            finally { setBusy(false); }
          }} />
        </div>
      );

    case 'video':
      return (
        <div className="flex flex-col gap-2">
          <SegPicker value={block.provider || 'youtube'} onChange={(v) => patch({ provider: v })} options={[['youtube', 'YouTube'], ['tiktok', 'TikTok'], ['twitch', 'Twitch'], ['vimeo', 'Vimeo'], ['r2', 'Upload']]} />
          {block.provider === 'r2' ? (
            <VideoUploadRow url={block.url} busy={busy} prog={prog} onPick={(f) => uploadVideo(f, 'url')} />
          ) : (
            <input value={block.url || ''} onChange={(e) => patch({ url: e.target.value })} className="input-mini" placeholder={block.provider === 'twitch' ? 'Twitch channel or video URL' : 'Paste video URL'} type="url" />
          )}
          <input value={block.title || ''} onChange={(e) => patch({ title: e.target.value })} className="input-mini" placeholder="Title (optional)" />
        </div>
      );

    case 'music':
      return (
        <div className="flex flex-col gap-2">
          <SegPicker value={block.provider || 'spotify'} onChange={(v) => patch({ provider: v })} options={[['spotify', 'Spotify'], ['apple', 'Apple'], ['soundcloud', 'SoundCloud']]} />
          <input value={block.url || ''} onChange={(e) => patch({ url: e.target.value })} className="input-mini" placeholder={block.provider === 'soundcloud' ? 'SoundCloud track URL' : block.provider === 'apple' ? 'Apple Music URL' : 'Spotify track/album/playlist URL'} type="url" />
        </div>
      );

    case 'product':
      return (
        <div className="flex flex-col gap-2">
          <UploadRow label={block.imageUrl ? 'Replace image' : 'Product image'} busy={busy} accept="image/*" onPick={(f) => upload(f, 'post', 'imageUrl')} />
          <input value={block.title || ''} onChange={(e) => patch({ title: e.target.value })} className="input-mini" placeholder="Product name" />
          <input value={block.desc || ''} onChange={(e) => patch({ desc: e.target.value })} className="input-mini" placeholder="Short description" />
          <div className="flex gap-2">
            <input value={block.price || ''} onChange={(e) => patch({ price: e.target.value })} className="w-24 input-mini" placeholder="$9.99" />
            <input value={block.url || ''} onChange={(e) => patch({ url: e.target.value })} className="flex-1 input-mini" placeholder="Buy URL" type="url" />
          </div>
        </div>
      );

    case 'embed':
      return (
        <div className="flex flex-col gap-2">
          <input value={block.url || ''} onChange={(e) => patch({ url: e.target.value })} className="input-mini" placeholder="Embed URL (iframe src)" type="url" />
          <label className="text-[11px] text-text-muted">Height: {block.height || 320}px</label>
          <input type="range" min={120} max={720} step={20} value={block.height || 320} onChange={(e) => patch({ height: Number(e.target.value) })} className="w-full" style={{ accentColor: 'var(--brand-violet)' }} />
        </div>
      );

    case 'email':
      return (
        <div className="flex flex-col gap-2">
          <input value={block.email || ''} onChange={(e) => patch({ email: e.target.value })} className="input-mini" placeholder="you@email.com" type="email" />
          <input value={block.label || ''} onChange={(e) => patch({ label: e.target.value })} className="input-mini" placeholder="Button label" />
        </div>
      );

    case 'message':
      return <input value={block.label || ''} onChange={(e) => patch({ label: e.target.value })} className="input-mini" placeholder="Message on Vergr" />;

    case 'tip':
      return (
        <div className="flex flex-col gap-2">
          <input value={block.label || ''} onChange={(e) => patch({ label: e.target.value })} className="input-mini" placeholder="Buy me a coffee" />
          <Hint>Adds a tip button. When a fan taps it, the in-app tip sheet opens (deep-links into the Vergr app, or prompts install) where they send you coins. Vergr pays you a share of that revenue, 50% to 80% by lifetime earnings.</Hint>
        </div>
      );

    case 'invite':
      return (
        <div className="flex flex-col gap-2">
          <input value={block.label || ''} onChange={(e) => patch({ label: e.target.value })} className="input-mini" placeholder="Join me on Vergr" />
          <Hint>Adds your personal invite card. Friends who join from it earn 3,000 VP and you earn 5,000 VP — a gift for both of you, no setup needed.</Hint>
        </div>
      );

    case 'support': {
      const prov = SUPPORT_PROVIDERS[block.provider] || SUPPORT_PROVIDERS.bmac;
      return (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-text-muted">Platform</p>
          <select value={block.provider || 'bmac'} onChange={(e) => patch({ provider: e.target.value })} className="input-mini">
            {Object.entries(SUPPORT_PROVIDERS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
          </select>
          <input value={block.handle || ''} onChange={(e) => patch({ handle: e.target.value })} className="input-mini" placeholder="your username (or full link)" />
          <input value={block.label || ''} onChange={(e) => patch({ label: e.target.value })} className="input-mini" placeholder={prov.cta} />
          <Hint>Links straight to your {prov.label} page. Paste your username, or a full URL if it's different.</Hint>
        </div>
      );
    }

    case 'services':
      return (
        <div className="flex flex-col gap-2">
          <input value={block.title || ''} onChange={(e) => patch({ title: e.target.value })} className="input-mini" placeholder="Section title (e.g. Services)" />
          {(block.items || []).map((it, i) => (
            <div key={i} className="flex flex-col gap-1.5 p-2 rounded-lg bg-surface-2/40 border border-white/5">
              <div className="flex gap-2">
                <input value={it.name || ''} onChange={(e) => patch({ items: block.items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} className="flex-1 input-mini" placeholder="Service name" />
                <input value={it.price || ''} onChange={(e) => patch({ items: block.items.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)) })} className="w-24 input-mini" placeholder="$50" />
              </div>
              <input value={it.desc || ''} onChange={(e) => patch({ items: block.items.map((x, j) => (j === i ? { ...x, desc: e.target.value } : x)) })} className="input-mini" placeholder="Short description (optional)" />
              <div className="flex gap-2">
                <input value={it.url || ''} onChange={(e) => patch({ items: block.items.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} className="flex-1 input-mini" placeholder="Book/buy link (optional)" type="url" />
                <button onClick={() => patch({ items: block.items.filter((_, j) => j !== i) })} className="text-text-muted hover:text-brand-ember"><Icon name="delete" size={16} /></button>
              </div>
            </div>
          ))}
          <button onClick={() => patch({ items: [...(block.items || []), { name: '', price: '', desc: '', url: '' }] })} className="flex items-center justify-center gap-1.5 py-2 border border-dashed border-white/10 rounded-lg text-xs text-text-muted hover:text-text-secondary">
            <Icon name="add" size={14} /> Add service
          </button>
        </div>
      );

    case 'contact':
      return (
        <div className="flex flex-col gap-2">
          <input value={block.title || ''} onChange={(e) => patch({ title: e.target.value })} className="input-mini" placeholder="Heading (e.g. Get in touch)" />
          <input value={block.label || ''} onChange={(e) => patch({ label: e.target.value })} className="input-mini" placeholder="Button label (Send)" />
          <Toggle label="Include message field" on={block.message !== false} onClick={() => patch({ message: block.message === false })} />
          <Toggle label="Include phone field" on={!!block.phone} onClick={() => patch({ phone: !block.phone })} />
          <Hint>Visitors' name, email{block.message !== false ? ', message' : ''}{block.phone ? ', phone' : ''} land in your Leads (export them from Settings). An email is always required.</Hint>
        </div>
      );

    case 'booking':
      return (
        <div className="flex flex-col gap-2">
          <SegPicker value={block.provider || 'calendly'} onChange={(v) => patch({ provider: v })} options={[['calendly', 'Calendly'], ['calcom', 'Cal.com'], ['other', 'Other']]} />
          <input value={block.url || ''} onChange={(e) => patch({ url: e.target.value })} className="input-mini" placeholder="Your scheduling link (https://…)" type="url" />
          <label className="text-[11px] text-text-muted">Height: {block.height || 660}px</label>
          <input type="range" min={360} max={900} step={20} value={block.height || 660} onChange={(e) => patch({ height: Number(e.target.value) })} className="w-full" style={{ accentColor: 'var(--brand-violet)' }} />
          <Hint>Embeds your Calendly / Cal.com booking page so visitors can book a time without leaving.</Hint>
        </div>
      );

    case 'vergr_stream':
      return <Hint>Automatically shows your stream when you're live (and your last stream otherwise). Nothing to configure.</Hint>;

    // vergr_tournament's editor form is removed: tournaments are retired and the
    // block has not been addable since it became _retired_ in BLOCK_REGISTRY.
    // VergrMeView renders any surviving saved block as null.

    case 'vergr_event':
      return (
        <>
          <ChooseRow label="event" selectedName={block._title} selectedId={block.eventId} onOpen={() => setPicker('event')} onClear={() => patch({ eventId: '', _title: '' })} hint="Sell tickets to a ticketed event from your page." />
          <VergrPicker open={picker === 'event'} title="Choose a ticketed event" emptyText="No open ticketed events. Create one from Events."
            load={() => getUserTournaments(uid).then((l) => (l || []).filter((t) => t.fundingModel === 'ticketed' && ['open', 'active'].includes(t.status)).map((t) => ({ id: t.id, name: t.name, sub: `${t.ticket?.priceCoins ? `${t.ticket.priceCoins}c` : 'Free'} · ${t.ticket?.sold || 0}/${t.ticket?.capacity || 0}`, image: t.bannerUrl, icon: 'confirmation_number' })))}
            onSelect={(t) => { patch({ eventId: t.id, _title: t.name }); setPicker(null); }} onClose={() => setPicker(null)} />
        </>
      );

    case 'vergr_squad':
      return (
        <>
          <ChooseRow label="squad" selectedName={block._title} selectedId={block.squadId} onOpen={() => setPicker('squad')} onClear={() => patch({ squadId: '', _title: '' })} hint="Invite visitors to join your squad." />
          <VergrPicker open={picker === 'squad'} title="Choose a squad" emptyText="You're not in any squads yet."
            load={() => getUserSquads(uid).then((l) => (l || []).map((s) => ({ id: s.id, name: s.name, sub: `${s.memberCount || s.memberIds?.length || 0} members`, image: s.avatar, icon: 'groups' })))}
            onSelect={(s) => { patch({ squadId: s.id, _title: s.name }); setPicker(null); }} onClose={() => setPicker(null)} />
        </>
      );

    case 'vergr_group':
      return (
        <>
          <ChooseRow label="group" selectedName={block._title} selectedId={block.groupId} onOpen={() => setPicker('group')} onClear={() => patch({ groupId: '', _title: '' })} hint="Link a group chat. Make it public so visitors can join." />
          <VergrPicker open={picker === 'group'} title="Choose a group" emptyText="You're not in any group chats yet."
            load={() => getConversations(uid).then((l) => (l || []).filter((c) => c.isGroup).map((c) => ({ id: c.id, name: c.groupName || c.name || 'Group chat', sub: `${(c.participants || []).length} members${c.visibility === 'public' ? ' · public' : ' · private'}`, image: c.groupAvatar || c.avatar, icon: 'forum' })))}
            onSelect={(c) => { patch({ groupId: c.id, _title: c.name }); setPicker(null); }} onClose={() => setPicker(null)} />
        </>
      );

    case 'collection':
      return (
        <div className="flex flex-col gap-2">
          <input value={block.title || ''} onChange={(e) => patch({ title: e.target.value })} className="input-mini" placeholder="Collection title (optional)" />
          <p className="text-[11px] text-text-muted">Layout</p>
          <SegPicker value={block.layout || 'grid'} onChange={(v) => patch({ layout: v })} options={Object.entries(COLLECTION_LAYOUTS)} />
          <p className="text-[11px] text-text-muted mt-1">Items</p>
          {(block.items || []).map((it, i) => (
            <CollectionItem key={i} item={it} busy={busy}
              onChange={(o) => patch({ items: block.items.map((x, j) => (j === i ? { ...x, ...o } : x)) })}
              onUpload={async (f) => { setBusy(true); try { const { url } = await uploadToR2(f, 'post'); patch({ items: block.items.map((x, j) => (j === i ? { ...x, thumbUrl: url } : x)) }); } finally { setBusy(false); } }}
              onRemove={() => patch({ items: block.items.filter((_, j) => j !== i) })} />
          ))}
          <button onClick={() => patch({ items: [...(block.items || []), { title: '', url: '' }] })} className="flex items-center justify-center gap-1.5 py-2 border border-dashed border-white/10 rounded-lg text-xs text-text-muted hover:text-text-secondary">
            <Icon name="add" size={14} /> Add item
          </button>
        </div>
      );

    case 'countdown':
      return (
        <div className="flex flex-col gap-2">
          <input value={block.title || ''} onChange={(e) => patch({ title: e.target.value })} className="input-mini" placeholder="Label above the timer (optional)" />
          <label className="text-[11px] text-text-muted">Counts down to</label>
          <input type="datetime-local" value={block.target || ''} onChange={(e) => patch({ target: e.target.value })} className="input-mini [color-scheme:dark]" />
          <p className="text-[11px] text-text-muted mt-1">When it reaches zero</p>
          <SegPicker value={block.expired || 'hide'} onChange={(v) => patch({ expired: v })} options={[['hide', 'Hide it'], ['ended', 'Show message'], ['reveal', 'Reveal link']]} />
          {(block.expired || 'hide') === 'ended' && (
            <input value={block.endedText || ''} onChange={(e) => patch({ endedText: e.target.value })} className="input-mini" placeholder="Message to show (e.g. This has ended)" />
          )}
          {block.expired === 'reveal' && (
            <>
              <input value={block.revealLabel || ''} onChange={(e) => patch({ revealLabel: e.target.value })} className="input-mini" placeholder="Reveal button text (e.g. It’s live — open now)" />
              <input value={block.revealUrl || ''} onChange={(e) => patch({ revealUrl: e.target.value })} className="input-mini" placeholder="https://… (opens when the timer ends)" type="url" />
            </>
          )}
          <Hint>Great for launches and drops. Uses each visitor’s local time.</Hint>
        </div>
      );

    case 'faq':
      return (
        <div className="flex flex-col gap-2">
          <input value={block.title || ''} onChange={(e) => patch({ title: e.target.value })} className="input-mini" placeholder="Section title (e.g. FAQ)" />
          {(block.items || []).map((it, i) => (
            <div key={i} className="flex flex-col gap-1.5 p-2 rounded-lg bg-surface-2/40 border border-white/5">
              <div className="flex items-center gap-2">
                <input value={it.q || ''} onChange={(e) => patch({ items: block.items.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)) })} className="flex-1 input-mini" placeholder="Question" />
                <button onClick={() => patch({ items: block.items.filter((_, j) => j !== i) })} className="text-text-muted hover:text-brand-ember shrink-0"><Icon name="delete" size={16} /></button>
              </div>
              <textarea value={it.a || ''} onChange={(e) => patch({ items: block.items.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)) })} rows={2} className="input-mini resize-none" placeholder="Answer" />
            </div>
          ))}
          <button onClick={() => patch({ items: [...(block.items || []), { q: '', a: '' }] })} className="flex items-center justify-center gap-1.5 py-2 border border-dashed border-white/10 rounded-lg text-xs text-text-muted hover:text-text-secondary">
            <Icon name="add" size={14} /> Add question
          </button>
        </div>
      );

    case 'map':
      return (
        <div className="flex flex-col gap-2">
          <input value={block.address || ''} onChange={(e) => patch({ address: e.target.value })} className="input-mini" placeholder="Address or place (e.g. Central Park, New York)" />
          <label className="text-[11px] text-text-muted">Zoom: {block.zoom || 14}</label>
          <input type="range" min={2} max={20} value={block.zoom || 14} onChange={(e) => patch({ zoom: Number(e.target.value) })} className="w-full" style={{ accentColor: 'var(--brand-violet)' }} />
          <label className="text-[11px] text-text-muted">Height: {block.height || 220}px</label>
          <input type="range" min={140} max={420} step={10} value={block.height || 220} onChange={(e) => patch({ height: Number(e.target.value) })} className="w-full" style={{ accentColor: 'var(--brand-violet)' }} />
          <input value={block.caption || ''} onChange={(e) => patch({ caption: e.target.value })} className="input-mini" placeholder="Caption (optional)" />
          <Hint>No API key needed. Type a place name or full address.</Hint>
        </div>
      );

    case 'divider':
      return (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-text-muted">Style</p>
          <SegPicker value={block.variant || 'line'} onChange={(v) => patch({ variant: v })} options={[['line', 'Line'], ['dashed', 'Dashed'], ['dots', 'Dots'], ['space', 'Space']]} />
          {['line', 'dashed'].includes(block.variant || 'line') && (
            <input value={block.label || ''} onChange={(e) => patch({ label: e.target.value })} className="input-mini" placeholder="Label in the middle (optional)" />
          )}
          <p className="text-[11px] text-text-muted mt-1">Spacing</p>
          <SegPicker value={block.spacing || 'md'} onChange={(v) => patch({ spacing: v })} options={[['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']]} />
          <ColorField label="Colour" value={block.style?.accent} onChange={(v) => patch({ style: { ...(block.style || {}), accent: v } })} onClear={() => patch({ style: { ...(block.style || {}), accent: '' } })} />
        </div>
      );

    case 'membership':
      return (
        <div className="flex flex-col gap-2">
          <input value={block.title || ''} onChange={(e) => patch({ title: e.target.value })} className="input-mini" placeholder="Section title (e.g. Membership)" />
          <Hint>Shows your PUBLISHED membership tiers with a Subscribe button. Visitors tap through to the app to join. Vergr pays you a share of that revenue. Manage tiers in Creator Studio.</Hint>
          <a href="/creator/membership" target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1.5 py-2 border border-dashed border-white/10 rounded-lg text-xs text-brand-violet-light hover:text-white">
            <Icon name="open_in_new" size={13} /> Manage tiers
          </a>
        </div>
      );

    case 'digital_product':
      return (
        <div className="flex flex-col gap-2">
          <DigitalProductPicker uid={uid} value={block.productId} onChange={(p) => patch({ productId: p?.id || '' })} />
          <Hint>Sells one of your products (digital download or physical item) right on the page. Buyers pay with coins and you keep 92%, credited to your earnings straight away. Create and manage products in Vergr Shop.</Hint>
        </div>
      );

    case 'shop_catalog':
      return <ShopCatalogForm block={block} patch={patch} showToast={showToast} />;

    default:
      return null;
  }
  })();

  return (
    <>
      {typeFields}
      {DESIGNABLE.has(block.type) && <BlockDesign block={block} patch={patch} />}
    </>
  );
}

// Which blocks expose the per-block Design panel — exactly the ones whose
// renderer consumes resolveBlockStyle (so every control actually does something;
// no dead knobs). Divider has its own colour field, socials/header/text carry
// their own styling, so they're intentionally absent.
const DESIGNABLE = new Set([
  'link', 'product', 'digital_product', 'shop_catalog', 'tip', 'message', 'email', 'membership', 'faq', 'countdown', 'map',
  'vergr_stream', 'vergr_event', 'vergr_squad', 'vergr_group',
]);

// External shop importer (Shopify/WooCommerce): paste URL → server-side
// fetch → snapshot items onto the block (no per-view fetching on the
// public page; Refresh re-imports).
function ShopCatalogForm({ block, patch, showToast }) {
  const [importing, setImporting] = useState(false);

  const doImport = async () => {
    const url = (block.shopUrl || '').trim();
    if (!url) { showToast('Paste your store URL first', 'error'); return; }
    setImporting(true);
    try {
      const { source, items } = await fetchShopCatalog(url);
      patch({ items, source });
      showToast(`Imported ${items.length} products from ${source === 'shopify' ? 'Shopify' : 'WooCommerce'}`, 'success');
    } catch (e) {
      showToast(e?.message || 'Import failed', 'error');
    }
    setImporting(false);
  };

  return (
    <div className="flex flex-col gap-2">
      <input value={block.title || ''} onChange={(e) => patch({ title: e.target.value })} className="input-mini" placeholder="Section title (e.g. My shop)" />
      <div className="flex gap-2">
        <input value={block.shopUrl || ''} onChange={(e) => patch({ shopUrl: e.target.value })} className="input-mini flex-1" placeholder="yourstore.com" />
        <button onClick={doImport} disabled={importing}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg text-white shrink-0 disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #7B1FFF, #B44FFF)' }}>
          {importing ? 'Importing…' : block.items?.length ? 'Refresh' : 'Import'}
        </button>
      </div>
      {block.items?.length > 0 && (
        <div className="flex items-center gap-2">
          {block.source && STORE_BRANDS[block.source] && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md shrink-0"
              style={{ background: `${STORE_BRANDS[block.source].color}22` }}
              title={`Imported from ${STORE_BRANDS[block.source].label}`}
            >
              <StoreGlyph provider={block.source} size={12} color={STORE_BRANDS[block.source].color} />
              <span className="text-[10px] font-bold" style={{ color: STORE_BRANDS[block.source].color }}>
                {STORE_BRANDS[block.source].label}
              </span>
            </span>
          )}
          <p className="text-[11px] text-text-secondary flex-1">{block.items.length} products imported.</p>
          <input value={block.currency || ''} onChange={(e) => patch({ currency: e.target.value })} className="input-mini !w-16 text-center" placeholder="$" maxLength={4} title="Currency symbol shown before prices" />
        </div>
      )}
      <Hint>
        Link-out only: buyers tap through to YOUR store's checkout, so there's no Vergr fee and no
        inventory tracking. To SELL your store's products here — coin checkout, synced stock, one
        order list — connect the store in Vergr Shop → Integrations instead, then add them as
        product blocks.
      </Hint>
    </div>
  );
}

// Dropdown over the seller's own vergrMeProducts catalog.
function DigitalProductPicker({ uid, value, onChange }) {
  const [products, setProducts] = useState(null);
  useEffect(() => {
    if (uid) getVergrMeProducts(uid).then(setProducts).catch(() => setProducts([]));
  }, [uid]);
  if (products === null) return <p className="text-[11px] text-text-muted">Loading your products…</p>;
  if (products.length === 0) {
    return (
      <p className="text-[11px] text-text-muted">
        No products yet — create one in the <span className="text-brand-violet-light font-semibold">Products</span> tab first.
      </p>
    );
  }
  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(products.find((p) => p.id === e.target.value) || null)}
      className="input-mini appearance-none [color-scheme:dark]"
    >
      <option value="">Pick a product…</option>
      {products.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name || 'Untitled'} · {Number(p.priceCoins || 0).toLocaleString()}c{p.published === false ? ' (hidden)' : ''}
        </option>
      ))}
    </select>
  );
}

// Per-block design controls (Advanced Formatting): background (solid / gradient
// / transparent), text + accent colour, corners, border, shadow. Collapsed by
// default; writes into block.style, consumed by resolveBlockStyle in the
// renderer so each block can look distinct instead of inheriting one theme.
function BlockDesign({ block, patch }) {
  const [open, setOpen] = useState(false);
  const s = block.style || {};
  const set = (o) => patch({ style: { ...s, ...o } });
  const custom = hasBlockStyle(block);
  return (
    <div className="mt-1 pt-2 border-t border-white/5">
      <button onClick={() => setOpen(!open)} className="flex items-center justify-between w-full">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-text-secondary">
          <Icon name="palette" size={13} className="text-brand-violet-light" /> Design
          {custom && <span className="text-[9px] text-brand-violet-light font-bold">• custom</span>}
        </span>
        <Icon name={open ? 'expand_less' : 'expand_more'} size={16} className="text-text-muted" />
      </button>
      {open && (
        <div className="flex flex-col gap-2 mt-2">
          <p className="text-[11px] text-text-muted">Background</p>
          <SegPicker value={s.bgType || 'theme'} onChange={(v) => set({ bgType: v === 'theme' ? '' : v })} options={[['theme', 'Theme'], ['solid', 'Solid'], ['gradient', 'Gradient'], ['transparent', 'None']]} />
          {s.bgType === 'solid' && <ColorField label="Background colour" value={s.bg} onChange={(v) => set({ bg: v })} onClear={() => set({ bg: '' })} />}
          {s.bgType === 'gradient' && (
            <>
              <div className="flex items-center gap-2">
                <input type="color" value={s.bg || '#7B1FFF'} onChange={(e) => set({ bg: e.target.value })} className="w-7 h-7 rounded shrink-0" />
                <input type="color" value={s.bg2 || '#B44FFF'} onChange={(e) => set({ bg2: e.target.value })} className="w-7 h-7 rounded shrink-0" />
                <span className="text-[11px] text-text-muted flex-1">Gradient (start → end)</span>
              </div>
              <SegPicker value={s.gradDir || 'diagonal'} onChange={(v) => set({ gradDir: v })} options={[['bottom', '↓'], ['right', '→'], ['diagonal', '↘'], ['radial', '◉']]} />
            </>
          )}
          <ColorField label="Text colour" value={s.text} onChange={(v) => set({ text: v })} onClear={() => set({ text: '' })} />
          <ColorField label="Accent (icon / numbers)" value={s.accent} onChange={(v) => set({ accent: v })} onClear={() => set({ accent: '' })} />
          <p className="text-[11px] text-text-muted mt-1">Corners</p>
          <SegPicker value={s.shape || 'inherit'} onChange={(v) => set({ shape: v })} options={[['inherit', 'Auto'], ['rounded', 'Round'], ['pill', 'Pill'], ['square', 'Square'], ['sharp', 'Sharp']]} />
          <p className="text-[11px] text-text-muted mt-1">Border</p>
          <SegPicker value={s.border || 'inherit'} onChange={(v) => set({ border: v })} options={[['inherit', 'Auto'], ['none', 'None'], ['thin', 'Thin'], ['thick', 'Thick']]} />
          {['thin', 'thick'].includes(s.border) && <ColorField label="Border colour" value={s.borderColor} onChange={(v) => set({ borderColor: v })} onClear={() => set({ borderColor: '' })} />}
          <p className="text-[11px] text-text-muted mt-1">Shadow</p>
          <SegPicker value={s.shadow || 'inherit'} onChange={(v) => set({ shadow: v })} options={[['inherit', 'Auto'], ['none', 'None'], ['soft', 'Soft'], ['hard', 'Pop']]} />
          {['soft', 'hard'].includes(s.shadow) && <ColorField label="Shadow colour" value={s.shadowColor} onChange={(v) => set({ shadowColor: v })} onClear={() => set({ shadowColor: '' })} />}
          {custom && <button onClick={() => patch({ style: {} })} className="self-start text-[10px] text-text-muted hover:text-white mt-1">Reset design</button>}
        </div>
      )}
    </div>
  );
}

function ChooseRow({ label, selectedName, selectedId, onOpen, onClear, hint }) {
  return (
    <div className="flex flex-col gap-2">
      {selectedId ? (
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-surface-2/60 border border-white/10">
          <Icon name="check_circle" size={16} className="text-brand-violet-light shrink-0" />
          <span className="flex-1 text-sm text-text-primary truncate">{selectedName || `Selected ${label}`}</span>
          <button onClick={onOpen} className="text-[11px] text-brand-violet-light">Change</button>
          <button onClick={onClear} className="text-text-muted hover:text-white"><Icon name="close" size={15} /></button>
        </div>
      ) : (
        <button onClick={onOpen} className="flex items-center justify-center gap-1.5 py-2.5 border border-dashed border-white/10 rounded-lg text-xs text-text-secondary hover:text-text-primary">
          <Icon name="search" size={14} /> Choose {label}
        </button>
      )}
      {hint && <Hint>{hint}</Hint>}
    </div>
  );
}

function CollectionItem({ item, onChange, onUpload, onRemove, busy }) {
  return (
    <div className="flex items-start gap-2 p-2 rounded-lg bg-surface-2/40 border border-white/5">
      <label className="w-11 h-11 rounded-lg bg-surface-1 border border-white/10 overflow-hidden flex items-center justify-center shrink-0 cursor-pointer">
        {item.thumbUrl ? <img src={item.thumbUrl} alt="" className="w-full h-full object-cover" /> : <Icon name={busy ? 'hourglass_empty' : 'add_photo_alternate'} size={16} className="text-text-muted" />}
        <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={(e) => e.target.files[0] && onUpload(e.target.files[0])} />
      </label>
      <div className="flex-1 flex flex-col gap-1.5 min-w-0">
        <input value={item.title || ''} onChange={(e) => onChange({ title: e.target.value })} className="input-mini" placeholder="Title" />
        <input value={item.url || ''} onChange={(e) => onChange({ url: e.target.value })} className="input-mini" placeholder="https://..." type="url" />
      </div>
      <button onClick={onRemove} className="text-text-muted hover:text-brand-ember shrink-0 mt-1"><Icon name="delete" size={16} /></button>
    </div>
  );
}

function UploadRow({ label, accept, onPick, busy }) {
  return (
    <label className="flex items-center justify-center gap-2 py-2.5 border border-dashed border-white/10 rounded-lg text-xs text-text-muted cursor-pointer hover:text-text-secondary">
      <Icon name={busy ? 'hourglass_empty' : 'upload'} size={14} />
      {busy ? 'Uploading…' : label}
      <input type="file" accept={accept} className="hidden" disabled={busy} onChange={(e) => e.target.files[0] && onPick(e.target.files[0])} />
    </label>
  );
}

// Video uploader with distinct "Optimizing…" (on-device re-encode) and
// "Uploading 62%" phases, plus a success preview once the URL is set.
function VideoUploadRow({ url, busy, prog, onPick }) {
  return (
    <div className="flex flex-col gap-2">
      {url && !busy && (
        <div className="relative">
          <video src={url} muted playsInline preload="metadata" className="w-full max-h-40 rounded-lg bg-black object-contain" />
          <span className="absolute top-1.5 left-1.5 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/70 text-[10px] text-brand-violet-light font-medium">
            <Icon name="check_circle" size={12} /> Uploaded
          </span>
        </div>
      )}
      {busy && prog ? (
        <div className="flex flex-col gap-1.5 py-2.5 px-3 border border-white/10 rounded-lg">
          <div className="flex items-center justify-between text-[11px] text-text-secondary">
            <span className="flex items-center gap-1.5">
              <Icon name={prog.phase === 'optimizing' ? 'auto_awesome' : 'upload'} size={13} className="text-brand-violet-light" />
              {prog.phase === 'optimizing' ? 'Optimizing video…' : 'Uploading'}
            </span>
            <span className="font-dmmono tabular-nums">{prog.pct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-brand-violet transition-[width] duration-200" style={{ width: `${prog.pct}%` }} />
          </div>
        </div>
      ) : (
        <label className={`flex items-center justify-center gap-2 py-2.5 border border-dashed border-white/10 rounded-lg text-xs cursor-pointer hover:text-text-secondary ${busy ? 'text-text-muted pointer-events-none opacity-60' : 'text-text-muted'}`}>
          <Icon name={busy ? 'hourglass_empty' : 'upload'} size={14} />
          {busy ? 'Working…' : url ? 'Replace video' : 'Upload video (MP4/WebM)'}
          <input type="file" accept="video/*" className="hidden" disabled={busy} onChange={(e) => e.target.files[0] && onPick(e.target.files[0])} />
        </label>
      )}
    </div>
  );
}

function Toggle({ label, on, onClick }) {
  return (
    <button onClick={onClick} className="flex items-center justify-between py-1 w-full">
      <span className="text-xs text-text-secondary">{label}</span>
      <span className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ${on ? 'bg-brand-violet' : 'bg-white/15'}`}>
        <span className={`absolute top-1/2 -translate-y-1/2 w-5 h-5 bg-white rounded-full shadow transition-[left] duration-200 ${on ? 'left-[22px]' : 'left-[2px]'}`} />
      </span>
    </button>
  );
}

// Per-component text styling (font / size / align / weight / colour, plus an
// optional callout background). Empty values inherit the page theme + font.
function TextStyle({ block, patch, withBg }) {
  return (
    <div className="flex flex-col gap-2 mt-1 pt-2 border-t border-white/5">
      <p className="text-[11px] text-text-muted">Font</p>
      <FontSelect value={block.font} onChange={(v) => patch({ font: v })} />
      <p className="text-[11px] text-text-muted mt-1">Size</p>
      <SegPicker value={block.fontSize || 'default'} onChange={(v) => patch({ fontSize: v === 'default' ? '' : v })} options={[['default', 'Auto'], ['s', 'S'], ['m', 'M'], ['l', 'L'], ['xl', 'XL']]} />
      <p className="text-[11px] text-text-muted mt-1">Alignment</p>
      <SegPicker value={block.align || 'center'} onChange={(v) => patch({ align: v })} options={[['left', 'Left'], ['center', 'Center'], ['right', 'Right']]} />
      <p className="text-[11px] text-text-muted mt-1">Weight</p>
      <SegPicker value={block.weight || 'default'} onChange={(v) => patch({ weight: v === 'default' ? '' : v })} options={[['default', 'Auto'], ['normal', 'Regular'], ['medium', 'Medium'], ['bold', 'Bold']]} />
      <ColorField label="Custom text colour" value={block.color} onChange={(v) => patch({ color: v })} onClear={() => patch({ color: '' })} />
      {withBg && <ColorField label="Background (callout)" value={block.bgColor} onChange={(v) => patch({ bgColor: v })} onClear={() => patch({ bgColor: '' })} />}
    </div>
  );
}

function FontSelect({ value, onChange }) {
  return (
    <select
      value={value || ''}
      onChange={(e) => { const v = e.target.value; onChange(v || undefined); if (v) loadVergrMeFont(v); }}
      className="input-mini"
    >
      <option value="">Page font</option>
      {Object.entries(FONT_PRESETS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
    </select>
  );
}

function ColorField({ label, value, onChange, onClear }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input type="color" value={value || '#ffffff'} onChange={(e) => onChange(e.target.value)} className="w-7 h-7 rounded shrink-0" />
      <span className="text-[11px] text-text-muted flex-1">{label}</span>
      {value && <button onClick={(e) => { e.preventDefault(); onClear(); }} className="text-[10px] text-text-muted hover:text-white">Reset</button>}
    </label>
  );
}

function SegPicker({ value, onChange, options }) {
  return (
    <div className="flex gap-1 p-1 bg-surface-2 rounded-lg">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} className={`flex-1 py-1.5 text-[11px] rounded-md font-medium ${value === v ? 'bg-brand-violet text-white' : 'text-text-muted'}`}>{label}</button>
      ))}
    </div>
  );
}

function Hint({ children }) {
  return <p className="text-[11px] text-text-muted leading-relaxed">{children}</p>;
}
