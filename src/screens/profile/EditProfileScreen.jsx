// Edit Profile — tabbed editor matching the Claude Design mock.
// Sections (left sub-nav): Profile Info / Profile Images / Cover Banner /
// Social Links / Gaming Info / Preferences. Each panel writes to the user
// doc via updateProfile(); avatars/banners go through uploadAvatar /
// uploadBanner which return Firebase Storage URLs.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import { uploadAvatar, uploadBanner } from '../../firebase/firestore';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';

const TABS = [
  { id: 'profile-info',   label: 'Profile Info',   icon: 'person'         },
  { id: 'profile-images', label: 'Profile Images', icon: 'image'          },
  { id: 'cover-banner',   label: 'Cover Banner',   icon: 'wallpaper'      },
  { id: 'social-links',   label: 'Social Links',   icon: 'share'          },
  { id: 'gaming-info',    label: 'Gaming Info',    icon: 'sports_esports' },
  { id: 'preferences',    label: 'Preferences',    icon: 'tune'           },
];

const SOCIAL_PLATFORMS = [
  { id: 'twitter',   name: 'X (Twitter)', icon: 'public',         hint: 'https://x.com/username' },
  { id: 'instagram', name: 'Instagram',   icon: 'photo_camera',   hint: 'https://instagram.com/username' },
  { id: 'youtube',   name: 'YouTube',     icon: 'play_circle',    hint: 'https://youtube.com/@username' },
  { id: 'tiktok',    name: 'TikTok',      icon: 'music_note',     hint: 'https://tiktok.com/@username' },
  { id: 'discord',   name: 'Discord',     icon: 'chat',           hint: 'https://discord.gg/...' },
  { id: 'facebook',  name: 'Facebook',    icon: 'facebook',       hint: 'https://facebook.com/username' },
  { id: 'website',   name: 'Website',     icon: 'language',       hint: 'https://your-site.com' },
];

const STREAM_PLATFORMS = [
  { id: 'twitch',     name: 'Twitch',        icon: 'live_tv' },
  { id: 'youtube',    name: 'YouTube',       icon: 'play_circle' },
  { id: 'facebook',   name: 'Facebook Live', icon: 'facebook' },
];

// Frames are rank rewards — gated by VP level. Users below the required level
// can preview but not select. `requiredLevel` aligns with RANK_TIERS in vpSystem.js.
const FRAMES = [
  { id: 'none',    label: 'None',    color: '#6B7280', glow: 'none',                       requiredLevel: 1  },
  { id: 'rookie',  label: 'Rookie',  color: '#B44FFF', glow: 'rgba(180,79,255,0.5)',       requiredLevel: 1  },
  { id: 'elite',   label: 'Elite',   color: '#F0A500', glow: 'rgba(240,165,0,0.5)',        requiredLevel: 41 },
  { id: 'veteran', label: 'Veteran', color: '#3D7FFF', glow: 'rgba(61,127,255,0.5)',       requiredLevel: 61 },
  { id: 'legend',  label: 'Legend',  color: '#F04060', glow: 'rgba(240,60,96,0.5)',        requiredLevel: 71 },
];

// Resize an image to a target canvas (cover fit) before upload.
// Banners crop to 1500×500 (3:1) which matches the profile page banner area.
async function resizeImageToBanner(file, targetW = 1500, targetH = 500) {
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  // Cover fit — fill the canvas and crop overflow.
  const scale = Math.max(targetW / img.width, targetH / img.height);
  const drawW = img.width * scale;
  const drawH = img.height * scale;
  const dx = (targetW - drawW) / 2;
  const dy = (targetH - drawH) / 2;
  ctx.drawImage(img, dx, dy, drawW, drawH);
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.88));
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}

const POPULAR_GAMES = [
  'Call of Duty', 'Apex Legends', 'Fortnite', 'Valorant',
  'Rainbow Six Siege', 'Overwatch 2', 'Counter-Strike 2', 'Rocket League',
  'League of Legends', 'Dota 2', 'PUBG', 'Warzone',
];

export default function EditProfileScreen() {
  const { profile, updateProfile } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const { isMobile } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  const [activeTab, setActiveTab] = useState('profile-info');
  const [saving, setSaving] = useState(false);

  // Form state — initialised from current profile, written back via updateProfile
  const [form, setForm] = useState({
    displayName: '',
    username: '',
    bio: '',
    status: 'online',
    location: '',
    avatarFrame: 'rookie',
    socials: {},        // { twitter: 'url', ... }
    socialEnabled: {},  // { twitter: true, ... }
    streamKeys: {},     // { twitch: 'key', ... }
    games: [],
    platforms: {},      // { playstation: 'NightHawk_99', ... }
    customStatus: '',
    visibility: 'public',
  });

  useEffect(() => {
    setRightPanel(null);
    setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign]);

  useEffect(() => {
    if (!profile) return;
    setForm(f => ({
      ...f,
      displayName: profile.displayName || '',
      username:    profile.username || '',
      bio:         profile.bio || '',
      location:    profile.location || '',
      status:      profile.status || 'online',
      avatarFrame: profile.avatarFrame || 'rookie',
      socials:        profile.socials || {},
      socialEnabled:  profile.socialEnabled || {},
      streamKeys:     profile.streamKeys || {},
      games:          profile.games || [],
      platforms:      profile.platforms || {},
      customStatus:   profile.customStatus || '',
      visibility:     profile.visibility || 'public',
    }));
  }, [profile]);

  const update = (patch) => setForm(f => ({ ...f, ...patch }));
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await updateProfile?.(form);
      showToast('Profile updated', 'success');
    } catch (err) {
      showToast(err?.message || 'Could not save', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pb-10" style={{ background: '#0B0B14', minHeight: '100vh' }}>
      {isMobile && <TopBar title="Edit Profile" showBack />}

      <div className="flex" style={{ minHeight: 'calc(100vh - 52px)' }}>
        {/* SUB-NAV */}
        <aside className="hidden md:block w-[220px] shrink-0 border-r" style={{ borderColor: '#1E1E2E' }}>
          <div className="p-5 border-b" style={{ borderColor: '#1E1E2E' }}>
            <h1 className="text-[18px] font-extrabold text-text-primary">Edit Profile</h1>
            <p className="text-[11px] text-text-muted mt-1 leading-relaxed">Update your information and customise your profile.</p>
          </div>
          <nav className="py-2">
            {TABS.map(t => (
              <button key={t.id}
                onClick={() => setActiveTab(t.id)}
                className="w-full flex items-center gap-2.5 px-5 py-2.5 text-[13px] font-medium transition-colors text-left"
                style={activeTab === t.id
                  ? { background: '#1E1035', color: '#fff', borderRight: '2px solid #B44FFF' }
                  : { color: '#9CA3AF' }}
              >
                <Icon name={t.icon} size={14} /> {t.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* CONTENT */}
        <main className="flex-1 px-5 md:px-8 py-6">
          {/* Mobile tab switcher */}
          {isMobile && (
            <div className="flex gap-2 overflow-x-auto pb-3 mb-3 -mx-5 px-5 no-scrollbar">
              {TABS.map(t => (
                <button key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className="px-3 py-1.5 rounded-full text-[12px] font-bold whitespace-nowrap"
                  style={activeTab === t.id
                    ? { background: 'rgba(180,79,255,0.20)', color: '#B44FFF', border: '1px solid rgba(180,79,255,0.45)' }
                    : { background: 'rgba(255,255,255,0.04)', color: '#9CA3AF', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {activeTab === 'profile-info'   && <ProfileInfoTab   form={form} update={update} setField={setField} />}
          {activeTab === 'profile-images' && <ProfileImagesTab profile={profile} update={update} setField={setField} form={form} showToast={showToast} />}
          {activeTab === 'cover-banner'   && <CoverBannerTab   profile={profile} showToast={showToast} />}
          {activeTab === 'social-links'   && <SocialLinksTab   form={form} setField={setField} />}
          {activeTab === 'gaming-info'    && <GamingInfoTab    form={form} update={update} setField={setField} />}
          {activeTab === 'preferences'    && <PreferencesTab   form={form} setField={setField} />}

          {/* Sticky save bar */}
          <div className="sticky bottom-3 mt-8 flex justify-end gap-2">
            <button onClick={() => navigate(-1)}
              className="px-5 py-2.5 rounded-lg text-[13px] font-semibold"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #1E1E2E', color: '#9CA3AF' }}>
              Cancel
            </button>
            <button onClick={save} disabled={saving}
              className="px-6 py-2.5 rounded-lg text-[13px] font-extrabold transition-all"
              style={saving
                ? { background: 'rgba(255,255,255,0.04)', color: '#6B7280', border: '1px solid rgba(255,255,255,0.06)' }
                : { background: 'linear-gradient(135deg, #6D28D9, #7C3AED)', color: '#fff', boxShadow: '0 4px 16px rgba(124,58,237,0.30)' }}
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}

// ─── Tabs ──────────────────────────────────────────────────────────

function PanelHeader({ title, sub }) {
  return (
    <div className="mb-5">
      <h2 className="text-[18px] font-extrabold text-text-primary">{title}</h2>
      <p className="text-[12px] text-text-muted mt-0.5">{sub}</p>
    </div>
  );
}

function FormSection({ title, sub, children }) {
  return (
    <div className="rounded-2xl p-5 mb-4" style={{ background: '#14141F', border: '1px solid #1E1E2E' }}>
      {title && <p className="text-[13px] font-bold text-text-primary mb-1">{title}</p>}
      {sub   && <p className="text-[11.5px] text-text-muted mb-3 leading-relaxed">{sub}</p>}
      {children}
    </div>
  );
}

function Field({ label, hint, counter, error, children }) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{label}</span>
        {counter && <span className="text-[10px] text-text-muted font-dmmono">{counter}</span>}
      </div>
      {children}
      {hint  && <p className="text-[10.5px] text-text-muted mt-1.5">{hint}</p>}
      {error && <p className="text-[10.5px] mt-1.5" style={{ color: '#F04060' }}>{error}</p>}
    </div>
  );
}

const inputClass = "w-full bg-surface-2 border border-white/[0.08] rounded-lg px-3.5 py-2.5 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-violet";

// 1. Profile Info ───────────────────────────────────────────────
function ProfileInfoTab({ form, setField }) {
  return (
    <>
      <PanelHeader title="Profile Information" sub="Update your display name, username, bio and status." />
      <FormSection>
        <Field label="Display Name" counter={`${form.displayName.length}/20`}>
          <input className={inputClass} type="text" value={form.displayName} maxLength={20}
                 onChange={(e) => setField('displayName', e.target.value)} />
        </Field>
        <Field label="Username" counter={form.username ? '✓ Available' : ''}>
          <input className={inputClass} type="text" value={form.username}
                 onChange={(e) => setField('username', e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} />
        </Field>
        <Field label="Bio" counter={`${form.bio.length}/150`}>
          <textarea className={inputClass} rows={3} maxLength={150} value={form.bio}
                    onChange={(e) => setField('bio', e.target.value)} />
        </Field>
      </FormSection>
      <FormSection>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Status" hint="This will be visible to everyone">
            <select className={inputClass} value={form.status}
                    onChange={(e) => setField('status', e.target.value)}>
              <option value="online">Online</option>
              <option value="busy">Busy</option>
              <option value="away">Away</option>
              <option value="offline">Invisible</option>
            </select>
          </Field>
          <Field label="Location">
            <input className={inputClass} type="text" placeholder="City, Country"
                   value={form.location}
                   onChange={(e) => setField('location', e.target.value)} />
          </Field>
        </div>
      </FormSection>
    </>
  );
}

// 2. Profile Images ─────────────────────────────────────────────
function ProfileImagesTab({ profile, form, setField, showToast }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await uploadAvatar(profile.uid, file);
      showToast('Avatar updated', 'success');
    } catch (err) {
      showToast(err?.message || 'Upload failed', 'error');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <>
      <PanelHeader title="Profile Images" sub="Upload your profile picture and choose an avatar frame." />
      <FormSection title="Profile Picture">
        <div className="flex items-center gap-4">
          <div className="relative w-[88px] h-[88px] rounded-full overflow-hidden flex items-center justify-center text-2xl font-extrabold"
               style={{ background: 'linear-gradient(135deg,#7b1fff,#3b82f6)', border: `3px solid ${FRAMES.find(f => f.id === form.avatarFrame)?.color || '#B44FFF'}` }}>
            {profile?.avatar
              ? <img src={profile.avatar} alt="" className="w-full h-full object-cover" />
              : (form.displayName?.[0] || 'V').toUpperCase()}
          </div>
          <div className="flex-1">
            <p className="text-[11px] text-text-muted leading-relaxed">JPG, PNG or WEBP.<br/>Max size 5MB.</p>
            <div className="flex gap-2 mt-2">
              <button onClick={() => fileRef.current?.click()} disabled={uploading}
                className="px-4 py-2 rounded-lg text-[12px] font-bold"
                style={{ background: 'rgba(180,79,255,0.15)', border: '1px solid rgba(180,79,255,0.45)', color: '#B44FFF' }}>
                {uploading ? 'Uploading…' : 'Change Picture'}
              </button>
              <button className="px-4 py-2 rounded-lg text-[12px] font-bold"
                style={{ background: 'rgba(240,60,96,0.10)', border: '1px solid rgba(240,60,96,0.40)', color: '#F04060' }}>
                Remove
              </button>
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFile} />
          </div>
        </div>
      </FormSection>

      <FormSection
        title="Avatar Frame"
        sub={`Frames are rank rewards — earn them by ranking up. You're currently Level ${profile?.vpLevel || 1}.`}
      >
        <div className="grid grid-cols-5 gap-3">
          {FRAMES.map(f => {
            const userLevel = profile?.vpLevel || 1;
            const locked = userLevel < f.requiredLevel;
            const selected = form.avatarFrame === f.id;
            return (
              <button
                key={f.id}
                onClick={() => {
                  if (locked) {
                    showToast(`Reach Level ${f.requiredLevel} to unlock the ${f.label} frame`, 'info');
                    return;
                  }
                  setField('avatarFrame', f.id);
                }}
                className="flex flex-col items-center gap-1.5 transition-transform hover:-translate-y-0.5"
                style={{ cursor: locked ? 'not-allowed' : 'pointer' }}
                title={locked ? `Unlocks at Level ${f.requiredLevel}` : f.label}
              >
                <div className="relative w-[60px] h-[60px] rounded-full flex items-center justify-center text-lg font-extrabold"
                     style={{
                       background: 'linear-gradient(135deg,#7b1fff,#3b82f6)',
                       border: `3px solid ${selected ? f.color : 'rgba(255,255,255,0.10)'}`,
                       boxShadow: selected ? `0 0 16px ${f.glow}` : 'none',
                       opacity: locked ? 0.35 : 1,
                       filter: locked ? 'grayscale(0.6)' : 'none',
                     }}>
                  {f.id === 'none'
                    ? <Icon name="close" size={18} />
                    : (form.displayName?.[0] || 'V').toUpperCase()}
                  {locked && (
                    <div className="absolute inset-0 rounded-full flex items-center justify-center"
                         style={{ background: 'rgba(0,0,0,0.55)' }}>
                      <Icon name="lock" size={20} className="text-white" />
                    </div>
                  )}
                </div>
                <span className="text-[10px] font-bold"
                      style={{ color: locked ? '#6B7280' : (selected ? f.color : '#9CA3AF') }}>
                  {f.label}
                </span>
                {locked && (
                  <span className="text-[9px] text-text-muted leading-none">Lvl {f.requiredLevel}</span>
                )}
              </button>
            );
          })}
        </div>
      </FormSection>
    </>
  );
}

// 3. Cover Banner ───────────────────────────────────────────────
function CoverBannerTab({ profile, showToast }) {
  const { updateProfile } = useUser();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showToast('Banner must be under 10MB', 'error');
      e.target.value = '';
      return;
    }
    setUploading(true);
    try {
      // Auto-resize to 1500×500 (3:1) so it fits the profile page banner area.
      const resized = await resizeImageToBanner(file);
      const url = await uploadBanner(profile.uid, resized);
      // Persist URL on the user doc — without this the new banner never shows.
      await updateProfile({ banner: url });
      showToast('Banner updated', 'success');
    } catch (err) {
      console.error('Banner upload failed:', err);
      showToast(err?.message || 'Upload failed', 'error');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleRemove = async () => {
    if (!profile?.banner || uploading) return;
    setUploading(true);
    try {
      await updateProfile({ banner: null });
      showToast('Banner removed', 'success');
    } catch (err) {
      showToast(err?.message || 'Could not remove', 'error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <PanelHeader title="Cover Banner" sub="Upload a custom banner to personalise your profile." />
      <FormSection>
        <div className="relative rounded-xl overflow-hidden mb-3 cursor-pointer"
             onClick={() => !uploading && fileRef.current?.click()}
             style={{
               aspectRatio: '3 / 1',
               background: 'linear-gradient(135deg,#0d0820 0%,#1a0a3a 30%,#2d0a5a 60%,#1a0a30 100%)',
               border: '1px solid #1E1E2E',
             }}>
          {profile?.banner && <img src={profile.banner} alt="" className="absolute inset-0 w-full h-full object-cover" />}
          <span className="absolute right-5 bottom-3 font-syne font-black tracking-widest text-[44px] uppercase"
                style={{ color: 'rgba(255,255,255,0.05)' }}>
            {(profile?.username || 'VERGR').toUpperCase()}
          </span>
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 hover:opacity-100 transition-opacity">
            <Icon name={uploading ? 'progress_activity' : 'edit'} size={32} className="text-white" />
          </div>
        </div>
        <p className="text-[10.5px] text-text-muted mb-3">
          Auto-cropped to 1500×500 (3:1) for the profile page. Max 10MB.
        </p>
        <div className="flex gap-2">
          <button onClick={() => !uploading && fileRef.current?.click()} disabled={uploading}
            className="px-4 py-2 rounded-lg text-[12px] font-bold"
            style={{ background: 'rgba(180,79,255,0.15)', border: '1px solid rgba(180,79,255,0.45)', color: '#B44FFF', opacity: uploading ? 0.6 : 1 }}>
            {uploading ? 'Uploading…' : 'Change Banner'}
          </button>
          {profile?.banner && (
            <button onClick={handleRemove} disabled={uploading}
              className="px-4 py-2 rounded-lg text-[12px] font-bold"
              style={{ background: 'rgba(240,60,96,0.10)', border: '1px solid rgba(240,60,96,0.40)', color: '#F04060', opacity: uploading ? 0.6 : 1 }}>
              Remove
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFile} />
      </FormSection>
    </>
  );
}

// 4. Social Links ───────────────────────────────────────────────
function SocialLinksTab({ form, setField }) {
  const updateSocial   = (id, val) => setField('socials',       { ...form.socials,       [id]: val });
  const toggleEnabled  = (id, val) => setField('socialEnabled', { ...form.socialEnabled, [id]: val });
  const updateStream   = (id, val) => setField('streamKeys',    { ...form.streamKeys,    [id]: val });

  return (
    <>
      <PanelHeader title="Social Links" sub="Add your social media and external links to connect with your community." />
      <FormSection title="Social Media Links" sub="These will be displayed on your profile.">
        {SOCIAL_PLATFORMS.map(p => (
          <div key={p.id} className="flex items-center gap-2.5 py-2">
            <div className="w-9 h-9 rounded-md flex items-center justify-center text-text-muted" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <Icon name={p.icon} size={15} />
            </div>
            <span className="w-[110px] text-[12px] font-semibold text-text-primary">{p.name}</span>
            <input className={`${inputClass} flex-1`} type="text" placeholder={p.hint}
                   value={form.socials[p.id] || ''}
                   onChange={(e) => updateSocial(p.id, e.target.value)} />
            <Toggle on={!!form.socialEnabled[p.id]} onChange={(v) => toggleEnabled(p.id, v)} />
          </div>
        ))}
      </FormSection>

      <FormSection title="Stream Mirror / External Streaming" sub="Add your stream keys to mirror streams from other platforms to VERGR. We never share your stream keys.">
        {STREAM_PLATFORMS.map(p => (
          <div key={p.id} className="flex items-center gap-2.5 py-2">
            <div className="w-9 h-9 rounded-md flex items-center justify-center text-text-muted" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <Icon name={p.icon} size={15} />
            </div>
            <span className="w-[110px] text-[12px] font-semibold text-text-primary">{p.name}</span>
            <input className={`${inputClass} flex-1`} type="password" placeholder={`Enter your ${p.name} stream key`}
                   value={form.streamKeys[p.id] || ''}
                   onChange={(e) => updateStream(p.id, e.target.value)} />
            <button className="px-3 py-1.5 rounded text-[10.5px] font-bold"
              style={{ background: 'rgba(61,127,255,0.10)', border: '1px solid rgba(61,127,255,0.40)', color: '#3D7FFF' }}>
              Verify
            </button>
          </div>
        ))}
      </FormSection>
    </>
  );
}

function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)}
      className="relative w-[34px] h-[18px] rounded-full transition-colors"
      style={{ background: on ? '#7B1FFF' : 'rgba(255,255,255,0.10)' }}>
      <span className="absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all"
            style={{ left: on ? 'calc(100% - 16px)' : '2px' }} />
    </button>
  );
}

// 5. Gaming Info ────────────────────────────────────────────────
function GamingInfoTab({ form, update, setField }) {
  const toggleGame = (g) => {
    const set = new Set(form.games);
    set.has(g) ? set.delete(g) : (set.size < 6 && set.add(g));
    setField('games', Array.from(set));
  };

  const PLATFORMS = [
    { id: 'playstation', name: 'PlayStation', icon: 'sports_esports' },
    { id: 'xbox',        name: 'Xbox',        icon: 'sports_esports' },
    { id: 'steam',       name: 'Steam',       icon: 'desktop_windows' },
    { id: 'epic',        name: 'Epic Games',  icon: 'videogame_asset' },
    { id: 'riot',        name: 'Riot ID',     icon: 'sports_kabaddi' },
  ];
  const updatePlatform = (id, val) => setField('platforms', { ...form.platforms, [id]: val });

  return (
    <>
      <PanelHeader title="Gaming Info" sub="Share your games, platforms, and IDs with the community." />

      <FormSection title="Main Games" sub={`Selected: ${form.games.length}/6`}>
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
          {POPULAR_GAMES.map(g => {
            const selected = form.games.includes(g);
            return (
              <button key={g} onClick={() => toggleGame(g)}
                className="flex flex-col items-center gap-1.5 p-3 rounded-lg transition-all"
                style={selected
                  ? { background: 'rgba(180,79,255,0.15)', border: '1px solid rgba(180,79,255,0.50)', color: '#fff' }
                  : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#9CA3AF' }}>
                <div className="w-9 h-9 rounded-md flex items-center justify-center" style={{ background: selected ? 'rgba(180,79,255,0.20)' : 'rgba(255,255,255,0.04)' }}>
                  <Icon name="sports_esports" size={18} />
                </div>
                <span className="text-[11px] font-bold text-center leading-tight">{g}</span>
                {selected && <Icon name="check_circle" size={14} style={{ color: '#B44FFF' }} />}
              </button>
            );
          })}
        </div>
      </FormSection>

      <FormSection title="Gaming Platforms" sub="Add your platform accounts and IDs.">
        {PLATFORMS.map(p => (
          <div key={p.id} className="flex items-center gap-2.5 py-2">
            <div className="w-9 h-9 rounded-md flex items-center justify-center text-text-muted"
                 style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <Icon name={p.icon} size={15} />
            </div>
            <span className="w-[110px] text-[12px] font-semibold text-text-primary">{p.name}</span>
            <input className={`${inputClass} flex-1`} type="text" placeholder={`Your ${p.name} ID`}
                   value={form.platforms[p.id] || ''}
                   onChange={(e) => updatePlatform(p.id, e.target.value)} />
          </div>
        ))}
      </FormSection>

      <FormSection title="Custom Status" sub="Add a short status to let others know what you're up to.">
        <input className={inputClass} type="text" maxLength={60} placeholder="e.g. Grinding ranked"
               value={form.customStatus}
               onChange={(e) => setField('customStatus', e.target.value)} />
        <p className="text-[10px] text-text-muted text-right mt-1">{form.customStatus.length}/60</p>
      </FormSection>
    </>
  );
}

// 6. Preferences ────────────────────────────────────────────────
function PreferencesTab({ form, setField }) {
  const VIS = [
    { id: 'public',   icon: 'public',     title: 'Public',          sub: 'Anyone on VERGR' },
    { id: 'followers', icon: 'group',     title: 'Followers Only',  sub: 'Only people who follow you' },
    { id: 'private',  icon: 'lock',       title: 'Private',         sub: 'Approved followers only' },
  ];
  return (
    <>
      <PanelHeader title="Preferences" sub="Manage your privacy, notifications, visibility, and streaming preferences." />
      <FormSection title="Profile Visibility" sub="Choose who can view your profile and activity.">
        <div className="grid grid-cols-3 gap-3">
          {VIS.map(v => (
            <button key={v.id} onClick={() => setField('visibility', v.id)}
              className="flex flex-col items-start gap-2 p-4 rounded-xl transition-all text-left"
              style={form.visibility === v.id
                ? { background: 'rgba(180,79,255,0.15)', border: '1px solid rgba(180,79,255,0.50)' }
                : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="flex items-center justify-between w-full">
                <Icon name={v.icon} size={18} style={{ color: form.visibility === v.id ? '#B44FFF' : '#9CA3AF' }} />
                {form.visibility === v.id && <Icon name="check_circle" size={16} style={{ color: '#B44FFF' }} />}
              </div>
              <p className="text-[13px] font-bold text-text-primary">{v.title}</p>
              <p className="text-[10.5px] text-text-muted">{v.sub}</p>
            </button>
          ))}
        </div>
      </FormSection>

      <FormSection title="More settings" sub="Detailed notification, security, and account preferences live in the Settings screen.">
        <a href="#/settings" className="inline-flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: '#B44FFF' }}>
          Open full settings <Icon name="arrow_forward" size={12} />
        </a>
      </FormSection>
    </>
  );
}
