// AdminChannelsTab — the Channels tab on /admin/announce.
//
// Everything about official channels is controlled from here (founder decision
// D1: the founder must never have to open the app itself to run this). Create a
// channel, edit it, post to it, review what has been posted, and delete a post.
//
// Two things the UI must be honest about and does not soften:
//   - A channel message reaches every user and CANNOT be recalled from a push
//     tray once sent. The send confirmation says so.
//   - Users cannot unsubscribe. They can mute, clear or delete their own view.
//     That is stated next to the composer so the person writing knows the reach.

import { useState, useEffect, useCallback } from 'react';
import { openInVergr } from '../../admin/openExternal';
import { useUI } from '../../context/UIContext';
import { auth } from '../../firebase/config';
import AdminSupportQueue from './AdminSupportQueue';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';
import { ADMIN_COLORS as C } from './AdminShell';
import { call, fmtNumber, fmtRelative, useGuardedCall } from './_adminGuarded';
import { uploadToR2 } from '../../utils/r2Storage';
import { compressMedia } from '../../utils/mediaCompression';
import { ColorField, Toggle, PillToggle, ChannelRowPreview } from './channelControls';

const BODY_MAX = 2000;

// The three shapes a channel can take. This used to be a single `oneWay`
// boolean, which was wrong: turning it off implied replies existed and nothing
// carried them. The kind decides where the messages actually live.
const CHANNEL_KINDS = [
  {
    id: 'broadcast', title: 'Announcements', icon: 'campaign',
    desc: 'You post, everyone in the channel reads it, nobody can reply. '
      + 'One thread that all of them see. Use it for offers, news and updates.',
  },
  {
    id: 'support', title: 'Support', icon: 'support_agent',
    desc: 'Every user gets their own private thread with you, like a normal chat. '
      + 'They write to you, you answer them one by one from an inbox. Nobody sees '
      + 'anyone else’s messages.',
  },
  {
    id: 'community', title: 'Community room', icon: 'forum',
    desc: 'Everyone in the channel can post, and everyone in it sees the lot. '
      + 'A group chat that fills itself from the rules below. Use it for something '
      + 'like a creators room.',
  },
];

export default function AdminChannelsTab() {
  const { showToast } = useUI();
  const { guarded, overlay } = useGuardedCall();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call('adminListChannels');
      setRows(r.rows || []);
      setSelected((s) => (s ? (r.rows || []).find((x) => x.channelId === s.channelId) || null : null));
    } catch (err) {
      showToast(err?.message || 'Failed to load channels', 'error');
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 340px) minmax(0, 1fr)', gap: 16 }}>
        {/* Channel list */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', alignSelf: 'flex-start' }}>
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>Channels</h3>
            <button onClick={() => setEditing({ isNew: true, oneWay: true, active: true, order: 100, accentColor: '#7B1FFF' })}
              style={miniBtn(C.accent)}>+ New</button>
          </div>
          {loading && <div style={{ padding: 24, color: C.textDim, fontSize: 12 }}>Loading…</div>}
          {!loading && rows.length === 0 && (
            <div style={{ padding: 20, color: C.textDim, fontSize: 12, lineHeight: 1.6 }}>
              No channels yet. Create the four launch channels here: Vergr, Vergr Offers,
              Vergr Creators and Vergr Support.
            </div>
          )}
          {rows.map((ch) => (
            <button
              key={ch.channelId}
              onClick={() => setSelected(ch)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 14px',
                background: selected?.channelId === ch.channelId ? C.card2 : 'transparent',
                border: 0, borderTop: `1px solid ${C.border}`, cursor: 'pointer', textAlign: 'left',
                opacity: ch.active ? 1 : 0.5,
              }}
            >
              <UserAvatar src={ch.avatarUrl} size={34} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                  {ch.name} {!ch.active && <span style={{ fontSize: 10, color: C.textMuted }}>(inactive)</span>}
                </div>
                <div style={{ fontSize: 10.5, color: C.textDim }}>
                  @{ch.handle} · {fmtNumber(ch.messageCount)} sent{ch.oneWay ? '' : ' · two-way'}
                </div>
              </div>
              <div style={{ width: 4, height: 30, borderRadius: 2, background: ch.accentColor }} />
            </button>
          ))}
        </div>

        {/* Detail */}
        <div style={{ minWidth: 0 }}>
          {!selected && !editing && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 40, textAlign: 'center', color: C.textDim, fontSize: 13 }}>
              Pick a channel to post to it, or create one.
            </div>
          )}
          {editing && (
            <ChannelEditor
              draft={editing}
              onCancel={() => setEditing(null)}
              onSaved={() => { setEditing(null); reload(); }}
              guarded={guarded}
            />
          )}
          {selected && !editing && (
            <ChannelDetail
              channel={selected}
              guarded={guarded}
              onEdit={() => setEditing({ ...selected })}
              onChanged={reload}
            />
          )}
        </div>
      </div>
      {overlay}
    </>
  );
}

// ───────────────────────────────────────────────────────────
// EDITOR
// ───────────────────────────────────────────────────────────

function ChannelEditor({ draft, onCancel, onSaved, guarded }) {
  const { showToast } = useUI();
  const [d, setD] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const set = (k, v) => setD((prev) => ({ ...prev, [k]: v }));

  // uploadToR2 resolves to { url, key }, NOT a bare string. Assigning the whole
  // object put a map in avatarUrl, so <UserAvatar> rendered src="[object Object]"
  // and the image broke. Destructure, and reject anything that is not a URL
  // string before it reaches state, because the failure is silent otherwise.
  const pickAvatar = async (file) => {
    if (!file) return;
    if (!file.type?.startsWith('image/')) {
      return showToast('Pick an image file', 'error');
    }
    setAvatarBusy(true);
    try {
      const compressed = await compressMedia(file, 'pro', 'avatar');
      const { url } = await uploadToR2(compressed, 'announcement');
      if (typeof url !== 'string' || !url) throw new Error('Upload returned no URL');
      set('avatarUrl', url);
    } catch (e) { showToast(e?.message || 'Upload failed', 'error'); }
    setAvatarBusy(false);
  };

  const save = async () => {
    setBusy(true);
    try {
      await guarded(() => call('adminUpsertChannel', {
        channelId: d.channelId,
        name: d.name,
        handle: d.handle,
        avatarUrl: d.avatarUrl || null,
        accentColor: d.accentColor || '#7B1FFF',
        kind: d.kind || 'broadcast',
        order: Number(d.order) || 100,
        access: d.access || { mode: 'everyone' },
        active: d.active !== false,
        description: d.description || null,
      }));
      showToast(d.isNew ? 'Channel created' : 'Channel updated', 'success');
      onSaved();
    } catch { /* guarded surfaces the error */ }
    setBusy(false);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 360px)', gap: 16, alignItems: 'start' }}>
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
      <h3 style={{ margin: 0, marginBottom: 14, fontSize: 14, fontWeight: 700, color: C.text }}>
        {d.isNew ? 'New channel' : `Edit ${d.name}`}
      </h3>

      <Label>What kind of channel</Label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        {CHANNEL_KINDS.map((k) => {
          const on = (d.kind || 'broadcast') === k.id;
          return (
            <button key={k.id} onClick={() => set('kind', k.id)}
              style={{
                textAlign: 'left', padding: 12, borderRadius: 8, cursor: 'pointer',
                background: on ? `${C.accent}15` : '#0a0a14',
                border: `1px solid ${on ? C.accent : C.border}`, color: C.text,
              }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
                <Icon name={k.icon} size={15} style={{ color: on ? C.accent : C.textDim }} />
                {k.title}
              </div>
              <div style={{ fontSize: 11, color: C.textDim, marginTop: 3, lineHeight: 1.5 }}>{k.desc}</div>
            </button>
          );
        })}
      </div>
      {!d.isNew && (d.kind || 'broadcast') !== (draft.kind || 'broadcast') && (
        <div style={{
          padding: 10, marginBottom: 12, borderRadius: 8, fontSize: 11.5, lineHeight: 1.55,
          background: 'rgba(240,64,96,0.10)', border: '1px solid rgba(240,64,96,0.3)', color: '#ff8fa3',
        }}>
          Changing the kind changes where this channel&apos;s messages live. Anything
          already posted to it stays where it is and will not move across.
        </div>
      )}

      <Label>Channel ID</Label>
      <input value={d.channelId || ''} disabled={!d.isNew}
        onChange={(e) => set('channelId', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
        placeholder="vergr_offers" style={{ ...input, marginBottom: 0, opacity: d.isNew ? 1 : 0.5 }} />
      <Hint>
        {d.isNew
          ? 'Goes in the link to this channel. Users never type it or see it anywhere in the app. You cannot change it once the channel is saved.'
          : 'Locked. The ID is part of every link to this channel, so changing it would break them.'}
      </Hint>

      <Label>Name</Label>
      <input value={d.name || ''} onChange={(e) => set('name', e.target.value)}
        placeholder="Vergr Offers" style={{ ...input, marginBottom: 0 }} />
      <Hint>What users see in their message list and at the top of the chat.</Hint>

      <Label>Handle</Label>
      <input value={d.handle || ''} onChange={(e) => set('handle', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
        placeholder="vergroffers" style={{ ...input, marginBottom: 0 }} />
      <Hint>The @name under the title. It only has to be free, so vergr names are fine here.</Hint>

      <Label>Picture</Label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
          <UserAvatar src={d.avatarUrl} size={48} />
          {avatarBusy && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 20, borderRadius: '50%',
              background: 'rgba(11,11,20,0.72)', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="progress_activity" size={20} style={{ color: '#fff' }} className="animate-spin" />
            </div>
          )}
        </div>
        <label style={{ ...miniBtn(C.accent), display: 'inline-block', opacity: avatarBusy ? 0.6 : 1 }}>
          {avatarBusy ? 'Uploading…' : (d.avatarUrl ? 'Replace' : 'Upload')}
          <input type="file" accept="image/*" style={{ display: 'none' }} disabled={avatarBusy}
            onChange={(e) => { pickAvatar(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {d.avatarUrl && !avatarBusy && (
          <button onClick={() => set('avatarUrl', null)} style={miniBtn('#f04060')}>Remove</button>
        )}
      </div>

      <Label>Colour</Label>
      <ColorField value={d.accentColor} onChange={(v) => set('accentColor', v)} />

      <Label>Position in the list</Label>
      <input type="number" value={d.order ?? 100} onChange={(e) => set('order', e.target.value)}
        style={{ ...input, marginBottom: 0 }} />
      <Hint>
        Only matters when someone has more than one channel: the smaller number
        sits higher up. Leave it at 100 unless you want this one pinned above the
        others, in which case use something like 10.
      </Hint>

      <Label>Who gets this channel</Label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        {[
          {
            id: 'everyone', title: 'Everyone',
            desc: 'Every user on Vergr gets it.',
          },
          {
            id: 'auto', title: 'Only people who match a rule',
            desc: 'You set the rules below, say creators only. Anyone who matches is '
              + 'added on their own, including people who qualify months from now, and '
              + 'anyone who stops matching loses it. Everyone else cannot read it, cannot '
              + 'see the preview, and has no way to tell the channel is there at all.',
          },
          {
            id: 'invite', title: 'Only people you add',
            desc: 'Nobody is added on their own. You pick every member by hand, which you '
              + 'can do once the channel is saved. Just as private as the option above.',
          },
        ].map((opt) => {
          const activeOpt = (d.access?.mode || 'everyone') === opt.id;
          return (
            <button key={opt.id}
              onClick={() => set('access', { ...(d.access || {}), mode: opt.id })}
              style={{
                textAlign: 'left', padding: 12, borderRadius: 8, cursor: 'pointer',
                background: activeOpt ? `${C.accent}15` : '#0a0a14',
                border: `1px solid ${activeOpt ? C.accent : C.border}`, color: C.text,
              }}>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>{opt.title}</div>
              <div style={{ fontSize: 11, color: C.textDim, marginTop: 3, lineHeight: 1.5 }}>{opt.desc}</div>
            </button>
          );
        })}
      </div>

      {d.access?.mode === 'auto' && (
        <div style={{ padding: 12, marginBottom: 12, borderRadius: 8, background: '#0a0a14', border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 10, lineHeight: 1.55 }}>
            Someone has to match <b style={{ color: C.text }}>every</b> rule you switch on,
            not just one of them. Guests, bots and banned accounts never get in
            whatever you pick here.
          </div>
          <Crit d={d} set={set} k="creator" label="Creators" hint="Anyone earning revenue share, or signed up for payouts." />
          <Crit d={d} set={set} k="vanguard" label="Vanguard moderators" hint="Any rank counts." />
          <div style={{ marginTop: 10 }}>
            <Label>Plan</Label>
            <div style={{ display: 'flex', gap: 8 }}>
              {['free', 'lite', 'pro'].map((t) => {
                const list = d.access?.criteria?.tiers || [];
                return (
                  <PillToggle key={t} label={t} checked={list.includes(t)}
                    onChange={(v) => {
                      const next = v ? [...list, t] : list.filter((x) => x !== t);
                      set('access', { ...d.access, criteria: { ...(d.access.criteria || {}), tiers: next } });
                    }} />
                );
              })}
            </div>
            <div style={{ fontSize: 11, color: C.textDim, marginTop: 6, lineHeight: 1.55 }}>
              Pick the plans that should get in. Leave all three off and the plan
              does not matter.
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <Label>Account age</Label>
            <input type="number" min="0" value={d.access?.criteria?.minAccountAgeDays ?? 0}
              onChange={(e) => set('access', { ...d.access, criteria: { ...(d.access.criteria || {}), minAccountAgeDays: Number(e.target.value) || 0 } })}
              style={{ ...input, marginBottom: 0 }} />
            <Hint>
              How many days old an account has to be. Useful for keeping brand-new
              signups out of something. Leave it at 0 for no limit.
            </Hint>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 14, paddingTop: 4, borderTop: `1px solid ${C.border}` }}>
        <Toggle
          label="Switched on"
          hint="Turn this off to take the channel away from everyone for now. Nothing is deleted, and switching it back on brings it and every message with it."
          checked={d.active !== false}
          onChange={(v) => set('active', v)}
        />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onCancel} style={{ ...miniBtn(C.border), color: C.textDim, padding: '10px 16px' }}>Cancel</button>
        <button onClick={save} disabled={busy || !d.channelId || !d.name || !d.handle}
          style={{ ...miniBtn(C.accent), padding: '10px 16px', opacity: (!d.channelId || !d.name || !d.handle) ? 0.5 : 1 }}>
          {busy ? 'Saving…' : 'Save channel'}
        </button>
      </div>
    </div>

      {/* The row is the thing being designed, so it is shown at real size against
          the real app background rather than left to imagination. */}
      <div style={{ position: 'sticky', top: 16 }}>
        <ChannelRowPreview
          name={d.name}
          handle={d.handle}
          avatarUrl={d.avatarUrl}
          accentColor={d.accentColor}
          lastMessage={d.isNew ? 'Your first message will show here' : d.lastMessage}
        />
        <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: C.card, border: `1px solid ${C.border}`, fontSize: 11.5, color: C.textDim, lineHeight: 1.6 }}>
          Avatars render at 52px here, 38px in the thread header. Use one bold mark
          and no text: a word is unreadable at this size. See
          <code style={{ color: C.text }}> docs/CHANNEL_SEED.md</code> for the full spec.
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// DETAIL: composer + sent messages
// ───────────────────────────────────────────────────────────

function ChannelDetail({ channel, guarded, onEdit, onChanged }) {
  const { showToast } = useUI();
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [ctaLabel, setCtaLabel] = useState('');
  const [ctaUrl, setCtaUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(null); // 'image' | 'video' | null
  const [uploadPct, setUploadPct] = useState(0);
  const [messages, setMessages] = useState([]);
  const [loadingMsgs, setLoadingMsgs] = useState(true);

  const loadMessages = useCallback(async () => {
    setLoadingMsgs(true);
    try {
      const r = await call('adminListChannelMessages', { channelId: channel.channelId, pageSize: 30 });
      setMessages(r.rows || []);
    } catch { /* ignore */ }
    setLoadingMsgs(false);
  }, [channel.channelId]);

  useEffect(() => { loadMessages(); }, [loadMessages]);

  // Same destructure bug as the avatar picker had: uploadToR2 resolves to
  // { url, key }. compressMedia passes video through untouched, so one preset
  // covers both branches.
  const upload = async (file, kind) => {
    if (!file) return;
    setUploading(kind);
    setUploadPct(0);
    try {
      const compressed = await compressMedia(file, 'pro', 'post');
      const { url } = await uploadToR2(compressed, 'announcement', setUploadPct);
      if (typeof url !== 'string' || !url) throw new Error('Upload returned no URL');
      if (kind === 'video') setVideoUrl(url); else setImageUrl(url);
    } catch (e) { showToast(e?.message || 'Upload failed', 'error'); }
    setUploading(null);
  };

  const send = async () => {
    if (!body.trim() && !imageUrl && !videoUrl) {
      return showToast('Add text, an image or a video first', 'error');
    }
    // Be explicit about reach and irreversibility. A push cannot be recalled.
    if (!window.confirm(
      `Post to ${channel.name}?\n\nThis reaches every user and sends a push. `
      + 'You can delete the message afterwards, but a push that has already been '
      + 'delivered cannot be recalled.',
    )) return;

    setBusy(true);
    try {
      await guarded(() => call('adminSendChannelMessage', {
        channelId: channel.channelId,
        body: body.trim(),
        imageUrl, videoUrl,
        ctaLabel: ctaLabel.trim() || null,
        ctaUrl: ctaUrl.trim() || null,
      }));
      showToast('Posted', 'success');
      setBody(''); setImageUrl(null); setVideoUrl(null); setCtaLabel(''); setCtaUrl('');
      loadMessages(); onChanged();
    } catch { /* guarded surfaces the error */ }
    setBusy(false);
  };

  const remove = async (m) => {
    if (!window.confirm('Delete this message? It disappears from every user\'s thread.')) return;
    try {
      await guarded(() => call('adminDeleteChannelMessage', { channelId: channel.channelId, messageId: m.id }));
      showToast('Message deleted', 'success');
      loadMessages(); onChanged();
    } catch { /* ignore */ }
  };

  const kind = channel.kind || (channel.oneWay === false ? 'support' : 'broadcast');

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <UserAvatar src={channel.avatarUrl} size={38} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{channel.name}</div>
        <div style={{ fontSize: 11, color: C.textDim }}>
          @{channel.handle} · {CHANNEL_KINDS.find((k) => k.id === kind)?.title || 'Announcements'}
        </div>
      </div>
      <button onClick={onEdit} style={miniBtn(C.border)}>Edit</button>
    </div>
  );

  // Each kind gets the surface that matches what it actually is. A support
  // channel has no shared thread to post into, so showing it a broadcast
  // composer was the thing that made this screen useless.
  if (kind === 'support') {
    return (
      <>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, marginBottom: 16 }}>
          {header}
          <div style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.6 }}>
            Every user gets their own private thread here. They appear below as they
            write in. Answer them one at a time; nobody sees anyone else&apos;s messages.
          </div>
        </div>
        <AdminSupportQueue channelId={channel.channelId} myUid={auth.currentUser?.uid || null} />
      </>
    );
  }

  if (kind === 'community') {
    return (
      <>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, marginBottom: 16 }}>
          {header}
          <CommunityRoomPanel channel={channel} guarded={guarded} onChanged={onChanged} />
        </div>
        {channel.restricted && <MembersPanel channel={channel} guarded={guarded} onChanged={onChanged} />}
      </>
    );
  }

  return (
    <>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, marginBottom: 16 }}>
        {header}

        <div style={{
          padding: 10, marginBottom: 12, borderRadius: 8, fontSize: 11.5, lineHeight: 1.55,
          background: 'rgba(245,197,66,0.08)', border: '1px solid rgba(245,197,66,0.25)', color: '#f5c542',
        }}>
          {/* "Everyone sees this" was hardcoded, which is a lie on a restricted
              channel. The banner has to name the real audience or it is worse
              than no banner. */}
          {channel.restricted
            ? 'Everyone in this channel sees this, and only them.'
            : 'Every user on Vergr sees this.'}
          {' '}
          They can mute it, clear it or delete it from their own list, but they cannot
          stop you sending, so keep it to things worth interrupting someone for. Never
          write about one person here: every member reads the same thread.
        </div>

        <Label>Message</Label>
        <textarea rows={4} value={body} maxLength={BODY_MAX}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Double coins this weekend only."
          style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }} />
        <div style={{ fontSize: 10.5, color: C.textDim, marginTop: -6, marginBottom: 12 }}>
          {body.length}/{BODY_MAX}
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ ...miniBtn(C.border), display: 'inline-block', opacity: uploading ? 0.6 : 1 }}>
            {uploading === 'image' ? `Uploading ${uploadPct}%` : (imageUrl ? 'Replace image' : '+ Image')}
            <input type="file" accept="image/*" style={{ display: 'none' }} disabled={!!uploading}
              onChange={(e) => { upload(e.target.files?.[0], 'image'); e.target.value = ''; }} />
          </label>
          <label style={{ ...miniBtn(C.border), display: 'inline-block', opacity: uploading ? 0.6 : 1 }}>
            {uploading === 'video' ? `Uploading ${uploadPct}%` : (videoUrl ? 'Replace video' : '+ Video')}
            <input type="file" accept="video/*" style={{ display: 'none' }} disabled={!!uploading}
              onChange={(e) => { upload(e.target.files?.[0], 'video'); e.target.value = ''; }} />
          </label>
          {(imageUrl || videoUrl) && !uploading && (
            <button onClick={() => { setImageUrl(null); setVideoUrl(null); }} style={miniBtn('#f04060')}>Clear media</button>
          )}
        </div>

        {/* Show what is actually attached. A bare "✓" tells you nothing about
            whether the right file went up, and a broken thumbnail here is the
            cheapest possible place to notice a bad upload. */}
        {(imageUrl || videoUrl) && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, padding: 8,
            background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 8,
          }}>
            {imageUrl && (
              <img src={imageUrl} alt="" style={{ width: 56, height: 56, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
            )}
            {videoUrl && (
              <video src={videoUrl} muted playsInline preload="metadata"
                style={{ width: 56, height: 56, borderRadius: 6, objectFit: 'cover', background: '#000', flexShrink: 0 }} />
            )}
            <div style={{ minWidth: 0, fontSize: 11, color: C.textDim, wordBreak: 'break-all', lineHeight: 1.5 }}>
              {imageUrl || videoUrl}
            </div>
          </div>
        )}

        <Label>Button (optional)</Label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
          <input value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)}
            placeholder="Get coins" style={{ ...input, marginBottom: 0 }} />
          <input value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)}
            placeholder="/store" style={{ ...input, marginBottom: 0 }} />
        </div>
        <Hint>
          Adds a tappable button under the message. The left box is what it says, the
          right box is where it goes. Use a path like /store to send them somewhere in
          the app, or a full https:// link for anywhere else. Leave both empty for no button.
        </Hint>

        <button onClick={send} disabled={busy}
          style={{ ...miniBtn(C.accent), padding: '11px 18px', fontSize: 13 }}>
          {busy ? 'Posting…' : `Post to ${channel.name}`}
        </button>
      </div>

      {channel.restricted && <MembersPanel channel={channel} guarded={guarded} onChanged={onChanged} />}

      {/* The channel AS THE USER SEES IT. A table of rows told you a message
          existed; it did not show you the channel. This is the same bubble the
          user gets, newest at the bottom, against the app's own background. */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, flex: 1 }}>
            The channel
          </div>
          <span style={{ fontSize: 11, color: C.textDim }}>as users see it</span>
        </div>
        <div style={{ background: '#0B0B14', padding: 16, maxHeight: 520, overflowY: 'auto' }}>
          {loadingMsgs && <div style={{ color: C.textDim, fontSize: 12 }}>Loading…</div>}
          {!loadingMsgs && messages.length === 0 && (
            <div style={{ color: '#6B7280', fontSize: 12.5, textAlign: 'center', padding: '30px 20px', lineHeight: 1.7 }}>
              Nothing posted yet.
              <div style={{ marginTop: 4 }}>Your first message appears here and in every member&apos;s messages.</div>
            </div>
          )}
          {/* Oldest first, so it reads like a conversation rather than a log. */}
          {[...messages].reverse().map((m) => (
            <ChannelBubble key={m.id} m={m} accent={channel.accentColor} onDelete={() => remove(m)} />
          ))}
        </div>
      </div>
    </>
  );
}

/** One message, rendered the way ChannelThreadScreen renders it for the user. */
function ChannelBubble({ m, accent, onDelete }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ position: 'relative', marginBottom: 14, maxWidth: 420 }}
    >
      <div style={{
        borderRadius: 16, borderTopLeftRadius: 6, overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.07)',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.02))',
      }}>
        {m.imageUrl && <img src={m.imageUrl} alt="" style={{ width: '100%', maxHeight: 240, objectFit: 'cover', display: 'block' }} />}
        {m.videoUrl && (
          <video src={m.videoUrl} controls playsInline preload="metadata"
            style={{ width: '100%', maxHeight: 240, background: '#000', display: 'block' }} />
        )}
        {m.body && (
          <div style={{ padding: '11px 14px 4px', fontSize: 13.5, lineHeight: 1.6, color: '#fff', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {m.body}
          </div>
        )}
        {m.ctaLabel && m.ctaUrl && (
          <div style={{ padding: '8px 14px 12px' }}>
            <span style={{
              display: 'inline-block', padding: '7px 14px', borderRadius: 8,
              fontSize: 12.5, fontWeight: 700, color: '#fff',
              background: accent || '#7B1FFF',
            }}>{m.ctaLabel}</span>
          </div>
        )}
        <div style={{ padding: '2px 14px 9px', fontSize: 10.5, color: '#6B7280' }}>
          {fmtRelative(m.createdAt)}
        </div>
      </div>
      {hover && (
        <button onClick={onDelete}
          title="Delete for everyone"
          style={{
            position: 'absolute', top: 6, right: -34, width: 26, height: 26,
            borderRadius: 6, cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            background: 'rgba(240,64,96,0.16)', border: '1px solid rgba(240,64,96,0.5)', color: '#f04060',
          }}>
          <Icon name="delete" size={14} />
        </button>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// COMMUNITY ROOM
// ───────────────────────────────────────────────────────────

/**
 * A community channel is a real group chat, so this panel does not try to be
 * one. It creates the room if it does not exist and hands you into the app's own
 * chat screen, which is where you read and post like any other member.
 */
function CommunityRoomPanel({ channel, guarded, onChanged }) {
  const { showToast } = useUI();
  const [busy, setBusy] = useState(false);

  const ensure = async () => {
    setBusy(true);
    try {
      const r = await guarded(() => call('adminEnsureCommunityRoom', { channelId: channel.channelId }));
      showToast('Room ready', 'success');
      onChanged();
      if (r?.convoId) openInVergr(`/messages/${r.convoId}`);
    } catch { /* guarded surfaces it */ }
    setBusy(false);
  };

  return (
    <>
      <div style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.6, marginBottom: 12 }}>
        Everyone in this channel can post here and sees everything posted. It is a
        group chat, so you read and write in it the same way members do rather than
        broadcasting into it. It opens on vergr.app in your browser.
      </div>
      {channel.roomConvoId ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => openInVergr(`/messages/${channel.roomConvoId}`)}
            style={{ ...miniBtn(C.accent), padding: '10px 16px', fontSize: 13 }}>
            Open the room
          </button>
          <button onClick={() => openInVergr(`/messages/${channel.roomConvoId}/group`)} style={miniBtn(C.border)}>
            Room settings
          </button>
        </div>
      ) : (
        <>
          <button onClick={ensure} disabled={busy}
            style={{ ...miniBtn(C.accent), padding: '10px 16px', fontSize: 13 }}>
            {busy ? 'Creating…' : 'Create the room'}
          </button>
          <div style={{ fontSize: 11, color: C.textDim, marginTop: 8, lineHeight: 1.55 }}>
            Starts with just you. Everyone who matches the rules joins the next time
            they open the app.
          </div>
        </>
      )}
    </>
  );
}

// ───────────────────────────────────────────────────────────
// MEMBERS (closed channels only)
// ───────────────────────────────────────────────────────────

function MembersPanel({ channel, guarded, onChanged }) {
  const { showToast } = useUI();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call('adminListChannelMembers', { channelId: channel.channelId, pageSize: 100 });
      setMembers(r.rows || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [channel.channelId]);

  useEffect(() => { load(); }, [load]);

  // Reuse the admin user search rather than building a second one.
  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) { setResults([]); return undefined; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await call('adminListUsers', { search: term, pageSize: 8 });
        if (!cancelled) setResults(r.rows || []);
      } catch { if (!cancelled) setResults([]); }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search]);

  const add = async (uids, label) => {
    setBusy(true);
    try {
      const r = await guarded(() => call('adminAddChannelMembers', { channelId: channel.channelId, uids }));
      showToast(`Added ${r?.added ?? uids.length} to ${channel.name}`, 'success');
      setSearch(''); setResults([]); load(); onChanged();
    } catch { /* guarded surfaces it */ }
    setBusy(false);
  };

  const remove = async (m) => {
    if (!window.confirm(`Remove ${m.displayName} from ${channel.name}?`)) return;
    try {
      await guarded(() => call('adminRemoveChannelMember', { channelId: channel.channelId, targetUid: m.uid }));
      load(); onChanged();
    } catch { /* ignore */ }
  };

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>Members</h3>
        <span style={{ fontSize: 11, color: C.textDim }}>{fmtNumber(channel.memberCount)} in this channel</span>
      </div>
      <p style={{ margin: '4px 0 14px', fontSize: 11.5, color: C.textDim, lineHeight: 1.55 }}>
        This channel is private. Only the people listed here can read it, and that is
        locked down on the server, so nobody else can reach the messages even if they
        go looking for them.
      </p>

      {channel.access?.mode === 'auto' && (
        <div style={{
          padding: 10, marginBottom: 14, borderRadius: 8, fontSize: 11.5, lineHeight: 1.55,
          background: `${C.accent}12`, border: `1px solid ${C.accent}40`, color: C.text,
        }}>
          Membership here is <strong>automatic</strong>. Anyone matching the channel rules is
          added on their next app open, including people who qualify later, and anyone who
          stops matching is removed. The list below fills in as users appear, so it is a
          view of who currently qualifies rather than something you have to maintain.
          <div style={{ marginTop: 6, color: C.textDim }}>
            You can still add someone by hand below. A manual add is never removed
            automatically, so it always beats the rules.
          </div>
        </div>
      )}

      <Label>{channel.access?.mode === 'auto' ? 'Add someone who does not match the rules' : 'Add one person'}</Label>
      <input value={search} onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name, handle or email" style={input} />
      {results.length > 0 && (
        <div style={{ background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 8, marginTop: -6, marginBottom: 12 }}>
          {results.map((u) => (
            <button key={u.uid} onClick={() => add([u.uid])}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: 10, background: 'transparent', border: 0, color: C.text, cursor: 'pointer', textAlign: 'left' }}>
              <UserAvatar src={u.avatar} size={26} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{u.displayName}</div>
                {u.username && <div style={{ fontSize: 10, color: C.textDim }}>@{u.username}</div>}
              </div>
              <span style={{ fontSize: 11, color: C.accent, fontWeight: 700 }}>Add</span>
            </button>
          ))}
        </div>
      )}

      {loading && <div style={{ fontSize: 12, color: C.textDim }}>Loading members…</div>}
      {!loading && members.length === 0 && (
        <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.55 }}>
          {channel.access?.mode === 'auto'
            ? 'Nobody has qualified yet. Matching users are added the next time they open '
              + 'the app, so this fills in on its own.'
            : 'Nobody yet. Until you add someone, this channel is invisible to every user.'}
        </div>
      )}
      {members.length > 0 && (
        <div style={{ maxHeight: 260, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 8 }}>
          {members.map((m) => (
            <div key={m.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: `1px solid ${C.border}` }}>
              <UserAvatar src={m.avatar} size={26} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: C.text }}>{m.displayName}</div>
                <div style={{ fontSize: 10, color: C.textDim }}>
                  {/* `source` is a raw enum. Printing it produced "added by auto",
                      which is not a sentence anyone would write. */}
                  {m.username ? `@${m.username} · ` : ''}
                  {m.source === 'manual' ? 'you added them' : 'matched the rules'}
                </div>
              </div>
              <button onClick={() => remove(m)} style={miniBtn('#f04060')}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Styles + small components
// ───────────────────────────────────────────────────────────

const input = {
  width: '100%', padding: '10px 12px', background: '#0a0a14',
  border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 13, marginBottom: 12,
};

const miniBtn = (color) => ({
  padding: '6px 12px', borderRadius: 6, border: `1px solid ${color}`,
  background: `${color}22`, color: color === C.border ? C.textDim : color,
  fontSize: 11.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
});

function Label({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{children}</div>;
}

// A short uppercase label with the explanation UNDER it in sentence case.
// Explanations belong here, not stuffed in a parenthetical inside an
// all-caps label, which is where they were and is why they read like a
// spec sheet instead of something a person wrote.
function Hint({ children }) {
  return (
    <div style={{ fontSize: 11, color: C.textDim, marginTop: -6, marginBottom: 12, lineHeight: 1.55 }}>
      {children}
    </div>
  );
}


/** One boolean criterion on an automatic channel. */
function Crit({ d, set, k, label, hint }) {
  return (
    <Toggle
      label={label}
      hint={hint}
      checked={!!d.access?.criteria?.[k]}
      onChange={(v) => set('access', { ...d.access, criteria: { ...(d.access.criteria || {}), [k]: v } })}
    />
  );
}
