// Campaigns: write it once, choose where it appears, send it.
//
// This replaces the old "Create Announcement" flow, which wrote one notification
// document per user (about 4N Firestore operations per send) and kept no record
// afterwards, so it could not be edited, recalled or measured.
//
// The mental model the UI is built around, and states plainly: ONE message, and
// you tick the places it shows up. Not four separate tools that happen to send
// similar things.

import { useState, useEffect, useCallback } from 'react';
import { useUI } from '../../context/UIContext';
import Icon from '../../components/Icon';
import { ADMIN_COLORS as C } from './AdminShell';
import { call, fmtRelative, fmtNumber, useGuardedCall } from './_adminGuarded';
import { uploadToR2 } from '../../utils/r2Storage';
import { compressMedia } from '../../utils/mediaCompression';
import { Toggle, PillToggle } from './channelControls';

const SURFACES = [
  {
    id: 'thread', icon: 'forum', title: 'In a channel',
    desc: 'Posts it to one of your channels, so it lands in their messages and stays there.',
  },
  {
    id: 'drawer', icon: 'notifications', title: 'Notification bell',
    desc: 'Shows in the notification drawer alongside likes and follows.',
  },
  {
    id: 'popup', icon: 'web_asset', title: 'Popup on opening the app',
    desc: 'Full-screen card the next time they open the app. Shows once, then never again.',
  },
  {
    id: 'push', icon: 'phone_iphone', title: 'Push notification',
    desc: 'Buzzes their phone. Cannot be taken back once it has been delivered.',
  },
  {
    id: 'whatsNew', icon: 'public', title: "Public What's New page",
    desc: 'Posts it to vergr.app/whats-new, where anyone can read it and Google can '
      + 'find it. Everything else on this list is for people already in the app.',
  },
];

const WHATS_NEW_CATEGORIES = ['update', 'feature', 'fix', 'notice'];

const STATUS_COLOR = {
  draft: C.textDim, scheduled: '#3D7FFF', sending: '#F0A500',
  sent: '#22C55E', recalled: '#F04060', failed: '#F04060',
};

export default function AdminCampaignsTab() {
  const { showToast } = useUI();
  const { guarded, overlay } = useGuardedCall();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call('adminListCampaigns', { pageSize: 50 });
      setRows(r.rows || []);
    } catch (e) { showToast(e?.message || 'Could not load campaigns', 'error'); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (editing) {
    return (
      <>
        <CampaignEditor
          draft={editing}
          guarded={guarded}
          onCancel={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
        {overlay}
      </>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14, gap: 10 }}>
        <div style={{ flex: 1, fontSize: 12, color: C.textDim, lineHeight: 1.55 }}>
          Write the message once, then tick where it should appear. The same message
          can be a channel post, a notification, a popup and a push at the same time.
        </div>
        <button onClick={() => setEditing({ isNew: true, surfaces: {}, segment: {} })}
          style={{ ...btn(C.accent), padding: '9px 16px', fontSize: 13 }}>
          New announcement
        </button>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        {loading && <div style={{ padding: 20, fontSize: 12, color: C.textDim }}>Loading…</div>}
        {!loading && rows.length === 0 && (
          <div style={{ padding: 26, fontSize: 12.5, color: C.textDim, lineHeight: 1.7, textAlign: 'center' }}>
            Nothing sent yet.
            <div style={{ marginTop: 4 }}>Your announcements and how they performed will be listed here.</div>
          </div>
        )}
        {rows.map((r) => (
          <CampaignRow key={r.campaignId} r={r} onEdit={() => setEditing({ ...r, isNew: false })}
            guarded={guarded} onChanged={load} />
        ))}
      </div>
      {overlay}
    </>
  );
}

function CampaignRow({ r, onEdit, guarded, onChanged }) {
  const { showToast } = useUI();
  const editable = !['sending', 'sent', 'recalled'].includes(r.status);

  const send = async () => {
    if (!window.confirm(
      `Send "${r.title}"?\n\n`
      + (r.surfaces.includes('push')
        ? 'This includes a push notification, which cannot be recalled once delivered.\n\n'
        : '')
      + 'Everything else can be taken down afterwards.',
    )) return;
    try {
      const res = await guarded(() => call('adminSendCampaign', { campaignId: r.campaignId }));
      showToast(res?.scheduled ? 'Scheduled' : 'Sending', 'success');
      onChanged();
    } catch { /* guarded surfaces it */ }
  };

  const recall = async () => {
    if (!window.confirm(
      'Take this down?\n\nIt disappears from the app straight away. A push that has '
      + 'already reached someone\'s phone cannot be taken back.',
    )) return;
    try {
      await guarded(() => call('adminRecallCampaign', { campaignId: r.campaignId }));
      showToast('Taken down', 'success');
      onChanged();
    } catch { /* ignore */ }
  };

  const s = r.stats || {};
  return (
    <div style={{ padding: '14px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>{r.title}</span>
          <span style={{
            fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em',
            padding: '2px 7px', borderRadius: 999,
            background: `${STATUS_COLOR[r.status] || C.textDim}22`,
            color: STATUS_COLOR[r.status] || C.textDim,
          }}>{r.status}</span>
        </div>
        <div style={{ fontSize: 12, color: C.textDim, marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {r.heading || r.body || 'No content'}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {r.surfaces.map((sf) => {
            const def = SURFACES.find((x) => x.id === sf);
            return (
              <span key={sf} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5,
                padding: '2px 8px', borderRadius: 999, color: C.textDim,
                border: `1px solid ${C.border}`,
              }}>
                <Icon name={def?.icon || 'circle'} size={11} />
                {def?.title || sf}
              </span>
            );
          })}
        </div>
        {r.status === 'sent' && (
          <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 11, color: C.textDim }}>
            <span><b style={{ color: C.text }}>{fmtNumber(s.impressions || 0)}</b> seen</span>
            <span><b style={{ color: C.text }}>{fmtNumber(s.clicks || 0)}</b> tapped</span>
            <span><b style={{ color: C.text }}>{fmtNumber(s.dismissals || 0)}</b> dismissed</span>
          </div>
        )}
        {r.delivery?.errors?.length > 0 && (
          <div style={{ marginTop: 6, fontSize: 11, color: '#f04060' }}>
            {r.delivery.errors.join(' · ')}
          </div>
        )}
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 10.5, color: C.textDim, marginBottom: 8 }}>
          {r.scheduleAt && r.status === 'scheduled' ? `for ${fmtRelative(r.scheduleAt)}` : fmtRelative(r.createdAt)}
        </div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          {editable && <button onClick={onEdit} style={btn(C.border)}>Edit</button>}
          {editable && <button onClick={send} style={btn(C.accent)}>Send</button>}
          {r.status === 'sent' && <button onClick={recall} style={btn('#f04060')}>Take down</button>}
        </div>
      </div>
    </div>
  );
}

function CampaignEditor({ draft, onCancel, onSaved, guarded }) {
  const { showToast } = useUI();
  const [d, setD] = useState(() => ({
    title: draft.title || '',
    heading: draft.heading || '',
    body: draft.body || '',
    imageUrl: draft.imageUrl || null,
    ctaLabel: draft.ctaLabel || '',
    ctaUrl: draft.ctaUrl || '',
    surfaces: Object.fromEntries((draft.surfaces || []).map((s) => [s, true])),
    threadChannelId: draft.threadChannelId || '',
    slug: draft.slug || '',
    category: draft.category || 'update',
    noindex: draft.noindex === true,
    tiers: [],
    scheduleAt: '',
    isNew: draft.isNew,
    campaignId: draft.campaignId || null,
  }));
  const [channels, setChannels] = useState([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = (k, v) => setD((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    call('adminListChannels', {}).then((r) => setChannels(r.rows || [])).catch(() => {});
  }, []);

  const pickImage = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const compressed = await compressMedia(file, 'pro', 'post');
      const { url } = await uploadToR2(compressed, 'announcement');
      if (typeof url !== 'string' || !url) throw new Error('Upload returned no URL');
      set('imageUrl', url);
    } catch (e) { showToast(e?.message || 'Upload failed', 'error'); }
    setUploading(false);
  };

  const save = async (thenSend) => {
    setBusy(true);
    try {
      const surfaces = {};
      if (d.surfaces.thread && d.threadChannelId) surfaces.thread = { channelId: d.threadChannelId };
      if (d.surfaces.drawer) surfaces.drawer = true;
      if (d.surfaces.popup) surfaces.popup = true;
      if (d.surfaces.push) surfaces.push = { quietHours: true };
      if (d.surfaces.whatsNew && d.slug) {
        surfaces.whatsNew = { slug: d.slug, category: d.category, noindex: d.noindex };
      }

      const res = await guarded(() => call('adminUpsertCampaign', {
        campaignId: d.campaignId,
        title: d.title,
        content: {
          heading: d.heading, body: d.body, imageUrl: d.imageUrl,
          ctaLabel: d.ctaLabel, ctaUrl: d.ctaUrl,
        },
        surfaces,
        segment: { include: { tiers: d.tiers } },
        scheduleAt: d.scheduleAt ? new Date(d.scheduleAt).getTime() : null,
      }));
      if (thenSend && res?.campaignId) {
        await guarded(() => call('adminSendCampaign', { campaignId: res.campaignId }));
        showToast('Sending', 'success');
      } else {
        showToast('Saved', 'success');
      }
      onSaved();
    } catch { /* guarded surfaces it */ }
    setBusy(false);
  };

  const nowhere = !Object.values(d.surfaces).some(Boolean);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,320px)', gap: 16, alignItems: 'start' }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
        <h3 style={{ margin: 0, marginBottom: 14, fontSize: 14, fontWeight: 700, color: C.text }}>
          {d.isNew ? 'New announcement' : `Edit ${d.title}`}
        </h3>

        <L>Internal name</L>
        <input value={d.title} onChange={(e) => set('title', e.target.value)}
          placeholder="October coin sale" style={{ ...input, marginBottom: 0 }} />
        <H>Only you see this. It is how you find the announcement in the list later.</H>

        <L>Heading</L>
        <input value={d.heading} onChange={(e) => set('heading', e.target.value)}
          maxLength={90} placeholder="Double coins this weekend" style={{ ...input, marginBottom: 0 }} />
        <H>The first line users read. Keep it short enough to survive a notification tray.</H>

        <L>Message</L>
        <textarea rows={4} value={d.body} onChange={(e) => set('body', e.target.value)}
          maxLength={2000} placeholder="Every coin pack comes with 20% extra until Sunday night."
          style={{ ...input, marginBottom: 0, resize: 'vertical', fontFamily: 'inherit' }} />
        <H>{d.body.length}/2000</H>

        <L>Picture (optional)</L>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          {d.imageUrl && <img src={d.imageUrl} alt="" style={{ width: 54, height: 54, borderRadius: 8, objectFit: 'cover' }} />}
          <label style={{ ...btn(C.border), display: 'inline-block', opacity: uploading ? 0.6 : 1 }}>
            {uploading ? 'Uploading…' : (d.imageUrl ? 'Replace' : 'Upload')}
            <input type="file" accept="image/*" style={{ display: 'none' }} disabled={uploading}
              onChange={(e) => { pickImage(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {d.imageUrl && !uploading && (
            <button onClick={() => set('imageUrl', null)} style={btn('#f04060')}>Remove</button>
          )}
        </div>

        <L>Button (optional)</L>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
          <input value={d.ctaLabel} onChange={(e) => set('ctaLabel', e.target.value)}
            placeholder="Get coins" style={{ ...input, marginBottom: 0 }} />
          <input value={d.ctaUrl} onChange={(e) => set('ctaUrl', e.target.value)}
            placeholder="/store" style={{ ...input, marginBottom: 0 }} />
        </div>
        <H>A path like /store keeps them in the app. A full https:// link opens a browser.</H>

        <div style={{ height: 1, background: C.border, margin: '16px 0' }} />

        <L>Where it appears</L>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 6 }}>
          {SURFACES.map((s) => (
            <div key={s.id}>
              <Toggle
                label={s.title}
                hint={s.desc}
                checked={!!d.surfaces[s.id]}
                onChange={(v) => set('surfaces', { ...d.surfaces, [s.id]: v })}
              />
              {s.id === 'thread' && d.surfaces.thread && (
                <select value={d.threadChannelId} onChange={(e) => set('threadChannelId', e.target.value)}
                  style={{ ...input, marginTop: 4, marginBottom: 4, marginLeft: 49, width: 'calc(100% - 49px)' }}>
                  <option value="">Pick a channel…</option>
                  {channels.filter((c) => (c.kind || 'broadcast') === 'broadcast')
                    .map((c) => <option key={c.channelId} value={c.channelId}>{c.name}</option>)}
                </select>
              )}
              {s.id === 'whatsNew' && d.surfaces.whatsNew && (
                <div style={{ marginLeft: 49, marginTop: 4, marginBottom: 6 }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <input value={d.slug}
                      onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                      placeholder="double-coins-weekend"
                      style={{ ...input, marginBottom: 0, flex: 1 }} />
                    <select value={d.category} onChange={(e) => set('category', e.target.value)}
                      style={{ ...input, marginBottom: 0, width: 130 }}>
                      {WHATS_NEW_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.55, marginBottom: 6 }}>
                    The address will be <span style={{ color: C.text }}>vergr.app/whats-new/{d.slug || '…'}</span>.
                    Pick it once: changing it later breaks any link anyone has shared.
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: C.textDim, cursor: 'pointer' }}>
                    <input type="checkbox" checked={d.noindex}
                      onChange={(e) => set('noindex', e.target.checked)} />
                    Keep this one out of Google
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
        {nowhere && (
          <div style={{ fontSize: 11.5, color: '#f5c542', marginBottom: 10, lineHeight: 1.55 }}>
            Pick at least one, or this will go nowhere when you send it.
          </div>
        )}

        <L>Who gets it</L>
        <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          {['free', 'lite', 'pro'].map((t) => (
            <PillToggle key={t} label={t} checked={d.tiers.includes(t)}
              onChange={(v) => set('tiers', v ? [...d.tiers, t] : d.tiers.filter((x) => x !== t))} />
          ))}
        </div>
        <H>
          Leave all off to reach everyone. Guests, bots and banned accounts are never
          included. Note that limiting by plan turns the push OFF: a push reaches whole
          devices, so it cannot honour a filter, and buzzing people about something they
          cannot see is worse than not buzzing them.
        </H>

        <L>Send later (optional)</L>
        <input type="datetime-local" value={d.scheduleAt}
          onChange={(e) => set('scheduleAt', e.target.value)} style={{ ...input, marginBottom: 0 }} />
        <H>Leave empty to send as soon as you press Send.</H>

        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button onClick={onCancel} style={{ ...btn(C.border), padding: '10px 16px' }}>Cancel</button>
          <button onClick={() => save(false)} disabled={busy || !d.title}
            style={{ ...btn(C.border), padding: '10px 16px', opacity: !d.title ? 0.5 : 1 }}>
            {busy ? 'Saving…' : 'Save draft'}
          </button>
          <button onClick={() => save(true)} disabled={busy || !d.title || nowhere}
            style={{ ...btn(C.accent), padding: '10px 16px', opacity: (!d.title || nowhere) ? 0.5 : 1 }}>
            Save and send
          </button>
        </div>
      </div>

      <div style={{ position: 'sticky', top: 16 }}>
        <PopupPreview d={d} />
      </div>
    </div>
  );
}

/** The popup exactly as a user sees it, against the app's own background. */
function PopupPreview({ d }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        What they see
      </div>
      <div style={{ background: '#0B0B14', padding: 18 }}>
        <div style={{
          borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)',
          background: 'linear-gradient(180deg,#171725,#101019)',
        }}>
          {d.imageUrl && <img src={d.imageUrl} alt="" style={{ width: '100%', maxHeight: 130, objectFit: 'cover', display: 'block' }} />}
          <div style={{ padding: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', lineHeight: 1.35, marginBottom: 6 }}>
              {d.heading || 'Your heading'}
            </div>
            <div style={{ fontSize: 12.5, color: '#9CA3AF', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {d.body || 'Your message appears here.'}
            </div>
            <div style={{
              marginTop: 16, padding: '10px 0', borderRadius: 10, textAlign: 'center',
              background: d.ctaLabel ? '#7B1FFF' : 'transparent',
              color: d.ctaLabel ? '#fff' : '#6B7280',
              fontSize: 12.5, fontWeight: 700,
              border: d.ctaLabel ? 'none' : '1px dashed rgba(255,255,255,0.12)',
            }}>
              {d.ctaLabel || 'No button'}
            </div>
          </div>
        </div>
      </div>
      <div style={{ padding: '9px 14px', fontSize: 11, color: C.textDim, borderTop: `1px solid ${C.border}`, lineHeight: 1.55 }}>
        The popup shows once per person and never comes back, on any device.
      </div>
    </div>
  );
}

const input = {
  width: '100%', padding: '10px 12px', background: '#0a0a14',
  border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 13, marginBottom: 12,
};
const btn = (color) => ({
  padding: '6px 12px', borderRadius: 6, border: `1px solid ${color}`,
  background: `${color}22`, color: color === C.border ? C.textDim : color,
  fontSize: 11.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
});
function L({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{children}</div>;
}
function H({ children }) {
  return <div style={{ fontSize: 11, color: C.textDim, marginTop: -6, marginBottom: 12, lineHeight: 1.55 }}>{children}</div>;
}
