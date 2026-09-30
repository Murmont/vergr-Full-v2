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
import { IS_NATIVE_BUILD } from '../../utils/platform';
import { uploadAvatar, uploadBanner } from '../../firebase/firestore';
import { getVPLevel } from '../../utils/vpSystem';
import { uploadToR2 } from '../../utils/r2Storage';
import { SCHEDULE_DAYS, SCHEDULE_BLOCKS } from '../../components/profile/StreamScheduleCard';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import CountrySelect from '../../components/CountrySelect';
import { CONTENT_TOPICS } from '../../utils/constants';
import UserName from '../../components/UserName';
import MediaFramer from '../../components/media/MediaFramer';

const TABS = [
  { id: 'profile-info',   label: 'Profile Info',   icon: 'person'         },
  { id: 'profile-images', label: 'Profile Images', icon: 'image'          },
  { id: 'cover-banner',   label: 'Cover Banner',   icon: 'wallpaper'      },
  { id: 'social-links',   label: 'Social Links',   icon: 'share'          },
  // id kept as 'gaming-info' so existing links still land here; the tab is
  // Interests now (2026-09-21): Vergr is not only for gamers.
  { id: 'gaming-info',    label: 'Interests',      icon: 'interests'      },
  { id: 'schedule',       label: 'Schedule',       icon: 'calendar_month' },
  { id: 'preferences',    label: 'Preferences',    icon: 'tune'           },
];

// Profile accent colour — brand swatch set only (no free picker, no cyan).
// Mirrors the composer's TEXT_COLORS minus white; '' = default violet.
export const ACCENT_COLORS = ['#7B1FFF', '#B44FFF', '#C87FFF', '#F0A500', '#F5C842', '#F04060', '#3D7FFF'];

// Stream schedule model: { tz, days: { '0': [blockIdx…], … } } — days keyed
// 0(Mon)–6(Sun), block indices into SCHEDULE_BLOCKS (3h each). A map of
// number-arrays, NOT nested arrays (Firestore rejects array-in-array).
// Constants live in the shared read-only card so editor + renderer can't drift.

const SOCIAL_PLATFORMS = [
  { id: 'twitter',   name: 'X (Twitter)', icon: 'public',         hint: 'https://x.com/username' },
  { id: 'instagram', name: 'Instagram',   icon: 'photo_camera',   hint: 'https://instagram.com/username' },
  { id: 'youtube',   name: 'YouTube',     icon: 'play_circle',    hint: 'https://youtube.com/@username' },
  { id: 'tiktok',    name: 'TikTok',      icon: 'music_note',     hint: 'https://tiktok.com/@username' },
  { id: 'discord',   name: 'Discord',     icon: 'chat',           hint: 'https://discord.gg/...' },
  { id: 'facebook',  name: 'Facebook',    icon: 'facebook',       hint: 'https://facebook.com/username' },
  { id: 'website',   name: 'Website',     icon: 'language',       hint: 'https://your-site.com' },
  // A contact address the person CHOOSES to show. Never the sign-up email,
  // which is private (it lives in Firebase Auth only).
  { id: 'email',     name: 'Email',       icon: 'mail',           hint: 'contact@you.com', type: 'email' },
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
// ⚠⚠ `crop` IS THE USER'S RECT, IN SOURCE PIXELS. Without it this cover-fits and
// "crops overflow" — the app deciding which part of somebody's photo survives,
// which is the thing the founder ruled out on 2026-09-06 for any media. It is
// still optional so the function keeps working for any caller that has not been
// given a framing step yet, but every caller in this file now passes one.
async function resizeImageToBanner(file, targetW = 1500, targetH = 500, crop = null) {
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
  if (crop) {
    // The user's rect, clamped so a rounding error in the scaled preview cannot
    // read outside the image and leave a transparent edge on their banner.
    const sw = Math.max(1, Math.min(img.width, crop.w));
    const sh = Math.max(1, Math.min(img.height, crop.h));
    const sx = Math.min(img.width - sw, Math.max(0, crop.sx));
    const sy = Math.min(img.height - sh, Math.max(0, crop.sy));
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
  } else {
    // Fallback only: cover fit, filling the canvas and cropping the overflow.
    const scale = Math.max(targetW / img.width, targetH / img.height);
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    ctx.drawImage(img, (targetW - drawW) / 2, (targetH - drawH) / 2, drawW, drawH);
  }
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.88));
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}

const POPULAR_GAMES = [
  'Call of Duty', 'Apex Legends', 'Fortnite', 'Valorant',
  'Rainbow Six Siege', 'Overwatch 2', 'Counter-Strike 2', 'Rocket League',
  'League of Legends', 'Dota 2', 'PUBG', 'Warzone',
];

// Your OWN level comes from your own wallet, which is already loaded and is the
// authoritative source. `profile.vpLevel` is a denormalised copy written by the
// syncVpLevel trigger for OTHER people's docs (squad lists, browse), and it had
// no writer at all until 2026-08-23, which is why every frame below was
// permanently locked for everyone (audit A110).
// ⚠ This MUST stay module-scope. ProfileImagesTab is a sibling function, not a
// child, so a const declared inside EditProfileScreen is invisible to it: the
// Profile Images tab threw "myVpLevel is not defined" on render, on web and on
// native, until eslint no-undef was switched on (2026-08-27).
const ownVpLevel = (wallet, profile) => Math.max(
  getVPLevel(wallet?.vp || 0)?.level || 1,
  Number(profile?.vpLevel) || 1,
);

export default function EditProfileScreen() {
  const { profile, wallet, updateProfile } = useUser();
  const myVpLevel = ownVpLevel(wallet, profile);
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
    country: '',        // ISO-2 — drives locale grouping + local-currency prices
    dob: '',            // ISO yyyy-mm-dd — drives the 18+ wallet/tournament gate
    avatarFrame: 'rookie',
    socials: {},        // { twitter: 'url', ... }
    socialEnabled: {},  // { twitter: true, ... }
    streamKeys: {},     // { twitch: 'key', ... }
    games: [],
    gameTags: [],       // genre interests (FPS/MOBA/…) — drives For You ranking
    platforms: {},      // { playstation: 'NightHawk_99', ... }
    customStatus: '',
    visibility: 'public',
    accentColor: '',    // one of ACCENT_COLORS or '' = default
    streamSchedule: null, // { tz, days: { '0': [blockIdx…] } }
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
      country:     profile.country || '',
      dob:         profile.dob || '',
      status:      profile.status || 'online',
      avatarFrame: profile.avatarFrame || 'rookie',
      socials:        profile.socials || {},
      socialEnabled:  profile.socialEnabled || {},
      streamKeys:     profile.streamKeys || {},
      games:          profile.games || [],
      gameTags:       profile.gameTags || [],
      platforms:      profile.platforms || {},
      customStatus:   profile.customStatus || '',
      visibility:     profile.visibility || 'public',
      accentColor:    ACCENT_COLORS.includes(profile.accentColor) ? profile.accentColor : '',
      streamSchedule: profile.streamSchedule || null,
    }));
  }, [profile]);

  const update = (patch) => setForm(f => ({ ...f, ...patch }));
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (saving) return;
    // Username: required, valid, and unique. Skip the uniqueness check when it
    // hasn't changed (case-insensitively) so re-saving your own handle is fine.
    const uname = (form.username || '').trim();
    if (!uname) { showToast('Username is required.', 'error'); return; }
    if (uname.toLowerCase() !== String(profile?.username || '').toLowerCase()) {
      const { checkUsername } = await import('../../utils/usernameValidation');
      const err = await checkUsername(uname, { isAdmin: profile?.role === 'admin' });
      if (err) { showToast(err, 'error'); return; }
    }
    // 18+ gate — if a DOB is provided it must be at least 18 years ago.
    // (Leaving it blank is allowed; the wallet/tournament screens enforce
    // "must set DOB" separately.)
    if (form.dob) {
      const dob = new Date(form.dob);
      const eighteen = new Date();
      eighteen.setFullYear(eighteen.getFullYear() - 18);
      if (Number.isNaN(dob.getTime())) {
        showToast('Enter a valid date of birth', 'error');
        return;
      }
      if (dob > eighteen) {
        showToast('You must be at least 18 to use VERGR.', 'error');
        return;
      }
    }
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
          {activeTab === 'schedule'       && <ScheduleTab      form={form} setField={setField} />}
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

// Shared so the native EditProfile screen can reuse these exact panels.
export const EDIT_PROFILE_TABS = TABS;

// 1. Profile Info ───────────────────────────────────────────────
export function ProfileInfoTab({ form, setField }) {
  return (
    <>
      <PanelHeader title="Profile Information" sub="Update your display name, username, bio and status." />
      <FormSection>
        <Field label="Display Name" counter={`${form.displayName.length}/20`}>
          <input className={inputClass} type="text" value={form.displayName} maxLength={20}
                 onChange={(e) => setField('displayName', e.target.value)} />
        </Field>
        <Field label="Username">
          <input className={inputClass} type="text" value={form.username}
                 onChange={(e) => setField('username', e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} />
        </Field>
        <Field label="Bio" counter={`${form.bio.length}/150`}>
          <textarea className={inputClass} rows={3} maxLength={150} value={form.bio}
                    onChange={(e) => setField('bio', e.target.value)} />
        </Field>
        <Field
          label="Date of Birth"
          hint="Required to buy coins and to be paid your creator revenue share. VERGR is 18+."
        >
          <input
            className={inputClass}
            type="date"
            value={form.dob}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setField('dob', e.target.value)}
          />
        </Field>
      </FormSection>
      <FormSection>
        <div className={`grid gap-4 ${IS_NATIVE_BUILD ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'}`}>
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
            <CountrySelect
              className={inputClass}
              value={form.country}
              onChange={(code, name) => { setField('country', code); setField('location', name); }}
            />
          </Field>
        </div>
      </FormSection>
    </>
  );
}

// 2. Profile Images ─────────────────────────────────────────────
export function ProfileImagesTab({ profile, form, setField, showToast }) {
  const { updateProfile, wallet } = useUser();
  const myVpLevel = ownVpLevel(wallet, profile);
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  // ⚠⚠ THE UPLOAD NO LONGER STARTS ON PICK. `PRESETS.avatar` is `square: true`,
  // so this path used to hand the file straight to a centre crop and a portrait
  // photo lost the top of somebody's head with no say from them. The file waits
  // here until they have drawn the square. Founder, 2026-09-06: do not crop for
  // the user on any media. [[feedback-never-crop-for-the-user]]
  const [pending, setPending] = useState(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) setPending(file);
  };

  // ⚠ AN ANIMATED AVATAR IGNORES THE CROP, by design — cropping means decoding
  // to a canvas, which keeps frame one and kills the animation. That only
  // affects someone entitled to animated avatars uploading an animated WebP;
  // every other upload is compressed and takes the square they drew.
  const doUpload = async (file, crop) => {
    setUploading(true);
    try {
      const url = await uploadAvatar(profile.uid, file, crop);
      // Persist URL on the user doc — without this the new avatar never shows.
      await updateProfile({ avatar: url });
      showToast('Avatar updated', 'success');
    } catch (err) {
      console.error('Avatar upload failed:', err);
      showToast(err?.message || 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveAvatar = async () => {
    if (!profile?.avatar || uploading) return;
    setUploading(true);
    try {
      await updateProfile({ avatar: null });
      showToast('Avatar removed', 'success');
    } catch (err) {
      showToast(err?.message || 'Could not remove', 'error');
    } finally {
      setUploading(false);
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
              <button onClick={handleRemoveAvatar} disabled={uploading || !profile?.avatar}
                className="px-4 py-2 rounded-lg text-[12px] font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'rgba(240,60,96,0.10)', border: '1px solid rgba(240,60,96,0.40)', color: '#F04060' }}>
                Remove
              </button>
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFile} />
            {pending && (
              <MediaFramer
                file={pending}
                aspect={1}
                round
                title="Position your avatar"
                hint="Drag the square to choose what your avatar shows. Anything outside it is cut."
                onCancel={() => setPending(null)}
                onConfirm={(r) => { const f = pending; setPending(null); doUpload(f, { sx: r.sx, sy: r.sy, size: Math.round(r.w) }); }}
              />
            )}
          </div>
        </div>
      </FormSection>

      <FormSection
        title="Avatar Frame"
        sub={`Frames are rank rewards, earned by ranking up. You're currently Level ${myVpLevel}.`}
      >
        <div className="grid grid-cols-5 gap-3">
          {FRAMES.map(f => {
            const userLevel = myVpLevel;
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

      <FormSection
        title="Accent Colour"
        sub="Tints your public profile — rank pill, follow button and highlights."
      >
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={() => setField('accentColor', '')}
            className="w-9 h-9 rounded-full flex items-center justify-center transition-transform hover:-translate-y-0.5"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: `2px solid ${!form.accentColor ? '#B44FFF' : 'rgba(255,255,255,0.12)'}`,
            }}
            title="Default"
          >
            <Icon name="close" size={14} className="text-text-muted" />
          </button>
          {ACCENT_COLORS.map(c => (
            <button
              key={c}
              onClick={() => setField('accentColor', c)}
              className="w-9 h-9 rounded-full transition-transform hover:-translate-y-0.5"
              style={{
                background: c,
                border: `2px solid ${form.accentColor === c ? '#fff' : 'transparent'}`,
                boxShadow: form.accentColor === c ? `0 0 14px ${c}88` : 'none',
              }}
              title={c}
            />
          ))}
        </div>
      </FormSection>

      <NameAudioSection profile={profile} showToast={showToast} />
    </>
  );
}

// Name pronunciation clip — record up to 10s, plays from a small button next
// to the display name on the profile screens. Saved immediately (like the
// avatar), not via the form Save button.
function NameAudioSection({ profile, showToast }) {
  const { updateProfile } = useUser();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recRef = useRef(null);
  const timerRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => () => {
    // Unmount: stop any live recorder/preview.
    try { recRef.current?.state === 'recording' && recRef.current.stop(); } catch { /* noop */ }
    clearInterval(timerRef.current);
    audioRef.current?.pause();
  }, []);

  const startRecording = async () => {
    if (recording || busy) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        clearInterval(timerRef.current);
        setRecording(false);
        setElapsed(0);
        const blob = new Blob(chunks, { type: 'audio/webm' });
        if (!blob.size) return;
        setBusy(true);
        try {
          const file = new File([blob], 'name-clip.webm', { type: 'audio/webm' });
          const { url } = await uploadToR2(file, 'post');
          await updateProfile({ nameAudioUrl: url });
          showToast('Name clip saved', 'success');
        } catch (err) {
          showToast(err?.message || 'Could not save clip', 'error');
        } finally {
          setBusy(false);
        }
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
      setElapsed(0);
      const startedAt = Date.now();
      timerRef.current = setInterval(() => {
        const s = (Date.now() - startedAt) / 1000;
        setElapsed(s);
        if (s >= 10) { try { rec.stop(); } catch { /* noop */ } } // 10s hard cap
      }, 200);
    } catch {
      showToast('Microphone access denied', 'error');
    }
  };

  const stopRecording = () => { try { recRef.current?.stop(); } catch { /* noop */ } };

  const playClip = () => {
    if (!profile?.nameAudioUrl) return;
    audioRef.current?.pause();
    const a = new Audio(profile.nameAudioUrl);
    audioRef.current = a;
    setPlaying(true);
    a.onended = () => setPlaying(false);
    a.onerror = () => setPlaying(false);
    a.play().catch(() => setPlaying(false));
  };

  const removeClip = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await updateProfile({ nameAudioUrl: null });
      showToast('Name clip removed', 'success');
    } catch (err) {
      showToast(err?.message || 'Could not remove', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormSection
      title="Name Pronunciation"
      sub="Record a short clip (max 10s) of how to say your name. It plays from a small button next to your name on your profile."
    >
      <div className="flex items-center gap-2 flex-wrap">
        {!recording ? (
          <button onClick={startRecording} disabled={busy}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-bold disabled:opacity-50"
            style={{ background: 'rgba(180,79,255,0.15)', border: '1px solid rgba(180,79,255,0.45)', color: '#B44FFF' }}>
            <Icon name="mic" size={14} /> {busy ? 'Saving…' : (profile?.nameAudioUrl ? 'Re-record' : 'Record')}
          </button>
        ) : (
          <button onClick={stopRecording}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-bold"
            style={{ background: 'rgba(240,60,96,0.15)', border: '1px solid rgba(240,60,96,0.45)', color: '#F04060' }}>
            <Icon name="stop" size={14} /> Stop · {Math.min(10, elapsed).toFixed(0)}s / 10s
          </button>
        )}
        {profile?.nameAudioUrl && !recording && (
          <>
            <button onClick={playClip} disabled={playing}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-bold disabled:opacity-50"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', color: '#fff' }}>
              <Icon name={playing ? 'graphic_eq' : 'play_arrow'} size={14} /> {playing ? 'Playing…' : 'Play'}
            </button>
            <button onClick={removeClip} disabled={busy}
              className="px-4 py-2 rounded-lg text-[12px] font-bold disabled:opacity-50"
              style={{ background: 'rgba(240,60,96,0.10)', border: '1px solid rgba(240,60,96,0.40)', color: '#F04060' }}>
              Remove
            </button>
          </>
        )}
      </div>
    </FormSection>
  );
}

// 3. Cover Banner ───────────────────────────────────────────────
export function CoverBannerTab({ profile, showToast }) {
  const { updateProfile } = useUser();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  // The picked file waits for the user to draw the crop. See MediaFramer.
  const [pending, setPending] = useState(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showToast('Banner must be under 10MB', 'error');
      return;
    }
    setPending(file);
  };

  const doUpload = async (file, crop) => {
    setUploading(true);
    try {
      // 1500x500 (3:1) to fit the profile banner area — from the user's rect.
      const resized = await resizeImageToBanner(file, 1500, 500, crop);
      const url = await uploadBanner(profile.uid, resized);
      // Persist URL on the user doc — without this the new banner never shows.
      await updateProfile({ banner: url });
      showToast('Banner updated', 'success');
    } catch (err) {
      console.error('Banner upload failed:', err);
      showToast(err?.message || 'Upload failed', 'error');
    } finally {
      setUploading(false);
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
        {pending && (
          <MediaFramer
            file={pending}
            aspect={3}
            title="Position your banner"
            hint="Drag to choose the strip shown across your profile. Anything outside it is cut."
            onCancel={() => setPending(null)}
            onConfirm={(r) => { const f = pending; setPending(null); doUpload(f, r); }}
          />
        )}
      </FormSection>
      <CardBackgroundSection profile={profile} showToast={showToast} />
    </>
  );
}

// 3b. Discovery card background — the full-bleed image behind your card on
// Explore (Recommended Creators / search). Portrait 3:4 crop (600×800) so it
// fills the card at any grid size. Falls back to the profile banner, then the
// brand gradient, when unset.
function CardBackgroundSection({ profile, showToast }) {
  const { updateProfile } = useUser();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  // The picked file waits for the user to draw the crop. See MediaFramer.
  const [pending, setPending] = useState(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showToast('Image must be under 10MB', 'error');
      return;
    }
    setPending(file);
  };

  const doUpload = async (file, crop) => {
    setUploading(true);
    try {
      const resized = await resizeImageToBanner(file, 600, 800, crop); // 3:4 portrait
      const url = await uploadBanner(profile.uid, resized);
      await updateProfile({ cardBackground: url });
      showToast('Card background updated', 'success');
    } catch (err) {
      console.error('Card background upload failed:', err);
      showToast(err?.message || 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    if (!profile?.cardBackground || uploading) return;
    setUploading(true);
    try {
      await updateProfile({ cardBackground: null });
      showToast('Card background removed', 'success');
    } catch (err) {
      showToast(err?.message || 'Could not remove', 'error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <FormSection title="Discovery Card Background" sub="Shown behind your card in Explore's creator grids. Uses your cover banner when not set.">
      <div className="flex items-start gap-4">
        {/* Live preview at the card's real shape */}
        <div className="relative rounded-xl overflow-hidden shrink-0 cursor-pointer"
             onClick={() => !uploading && fileRef.current?.click()}
             style={{ width: 132, aspectRatio: '3 / 4',
               background: 'linear-gradient(135deg,#1a0a3a,#2d0a5a)',
               border: '1px solid #1E1E2E' }}>
          {(profile?.cardBackground || profile?.banner) && (
            <img src={profile.cardBackground || profile.banner} alt=""
              className="absolute inset-0 w-full h-full object-cover" />
          )}
          <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,rgba(11,11,20,0.15),rgba(11,11,20,0.85))' }} />
          <div className="absolute inset-x-0 bottom-0 p-2 text-center">
            <div className="w-8 h-8 rounded-full mx-auto mb-1 bg-white/10 border border-white/20" />
            <div className="text-[9px] font-bold text-white truncate">{profile?.username || 'you'}</div>
          </div>
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 hover:opacity-100 transition-opacity">
            <Icon name={uploading ? 'progress_activity' : 'edit'} size={24} className="text-white" />
          </div>
        </div>
        <div className="flex-1">
          <p className="text-[10.5px] text-text-muted mb-3">
            Auto-cropped to 600×800 (3:4 portrait). Max 10MB. Dark scrim is applied automatically so your name stays readable.
          </p>
          <div className="flex gap-2">
            <button onClick={() => !uploading && fileRef.current?.click()} disabled={uploading}
              className="px-4 py-2 rounded-lg text-[12px] font-bold"
              style={{ background: 'rgba(180,79,255,0.15)', border: '1px solid rgba(180,79,255,0.45)', color: '#B44FFF', opacity: uploading ? 0.6 : 1 }}>
              {uploading ? 'Uploading…' : 'Upload Card Background'}
            </button>
            {profile?.cardBackground && (
              <button onClick={handleRemove} disabled={uploading}
                className="px-4 py-2 rounded-lg text-[12px] font-bold"
                style={{ background: 'rgba(240,60,96,0.10)', border: '1px solid rgba(240,60,96,0.40)', color: '#F04060', opacity: uploading ? 0.6 : 1 }}>
                Remove
              </button>
            )}
          </div>
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFile} />
      {pending && (
        <MediaFramer
          file={pending}
          aspect={0.75}
          title="Position your card image"
          hint="Drag to choose what shows behind your card on Explore. Anything outside it is cut."
          onCancel={() => setPending(null)}
          onConfirm={(r) => { const f = pending; setPending(null); doUpload(f, r); }}
        />
      )}
    </FormSection>
  );
}

// 4. Social Links ───────────────────────────────────────────────
export function SocialLinksTab({ form, setField }) {
  const updateSocial   = (id, val) => setField('socials',       { ...form.socials,       [id]: val });
  const toggleEnabled  = (id, val) => setField('socialEnabled', { ...form.socialEnabled, [id]: val });
  const updateStream   = (id, val) => setField('streamKeys',    { ...form.streamKeys,    [id]: val });

  return (
    <>
      <PanelHeader title="Social Links" sub="Add your social media and external links to connect with your community." />
      <FormSection title="Social Media Links" sub="These will be displayed on your profile.">
        {SOCIAL_PLATFORMS.map(p => (
          <div key={p.id} className="flex items-center gap-2.5 py-2">
            <div className="w-9 h-9 rounded-md flex items-center justify-center text-text-muted" style={{ background: '#1A1A26' }}>
              <Icon name={p.icon} size={15} />
            </div>
            <span className="w-[110px] text-[12px] font-semibold text-text-primary">{p.name}</span>
            <input className={`${inputClass} flex-1`} type={p.type || 'text'} placeholder={p.hint}
                   inputMode={p.type === 'email' ? 'email' : undefined} autoCapitalize="none"
                   value={form.socials[p.id] || ''}
                   onChange={(e) => updateSocial(p.id, e.target.value)} />
            {/* A filled-in link shows on the profile unless it is switched OFF
                (profileSocials.socialsToList), so the switch reads the same way.
                It used to read !!value and showed off for links that were live. */}
            <Toggle on={form.socialEnabled[p.id] !== false} onChange={(v) => toggleEnabled(p.id, v)} />
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

// 5. Interests ────────────────────────────────────────────────
// Was "Gaming Info" (Main Games first, then a Gaming Platforms ID form). Now
// interests lead, games are optional, and the platform IDs moved to
// Settings, Connected accounts: IDs typed here were never shown anywhere, while
// the ones there are shown on the profile (components/profile/LinkedHandles.jsx,
// which also still displays any IDs saved here before this change).
export function GamingInfoTab({ form, setField }) {
  const navigate = useNavigate();
  const toggleGame = (g) => {
    const set = new Set(form.games);
    set.has(g) ? set.delete(g) : (set.size < 6 && set.add(g));
    setField('games', Array.from(set));
  };
  const toggleInterest = (g) => {
    const set = new Set(form.gameTags || []);
    set.has(g) ? set.delete(g) : set.add(g);
    setField('gameTags', Array.from(set));
  };
  const chip = (on) => (on
    ? { background: '#7B1FFF', color: '#fff' }
    : { background: '#1D1D2C', color: '#9CA3AF' });

  return (
    <>
      <PanelHeader title="Interests" sub="What you're into. It shapes your For You feed, and you can change it any time." />

      <FormSection title="Your interests" sub="Pick as many as you like.">
        <div className="flex flex-wrap gap-2">
          {CONTENT_TOPICS.map(g => {
            const on = (form.gameTags || []).includes(g);
            return (
              <button key={g} type="button" onClick={() => toggleInterest(g)} aria-pressed={on}
                className="px-3 py-1.5 rounded-full text-[12px] font-bold transition-colors"
                style={chip(on)}>
                {g}
              </button>
            );
          })}
        </div>
      </FormSection>

      <FormSection title="Games you play" sub={`Optional. Up to 6, and only if you game. Selected: ${form.games.length}/6`}>
        <div className="flex flex-wrap gap-2">
          {POPULAR_GAMES.map(g => {
            const on = form.games.includes(g);
            return (
              <button key={g} type="button" onClick={() => toggleGame(g)} aria-pressed={on}
                className="px-3 py-1.5 rounded-full text-[12px] font-bold transition-colors"
                style={chip(on)}>
                {g}
              </button>
            );
          })}
        </div>
      </FormSection>

      <FormSection title="Game and platform IDs" sub="Your Steam, PlayStation, Xbox, Riot, Epic and other IDs live in Connected accounts, and show on your profile from there.">
        <button type="button" onClick={() => navigate('/settings/linked-accounts')}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-[12px] font-bold"
          style={{ background: '#1D1D2C', color: '#fff' }}>
          <Icon name="link" size={15} /> Open Connected accounts
        </button>
      </FormSection>

      <FormSection title="Custom status" sub="A short line about what you're up to right now.">
        <input className={inputClass} type="text" maxLength={60} placeholder="e.g. Editing a new video"
               value={form.customStatus}
               onChange={(e) => setField('customStatus', e.target.value)} />
        <p className="text-[10px] text-text-muted text-right mt-1">{form.customStatus.length}/60</p>
      </FormSection>
    </>
  );
}

// 6. Schedule ───────────────────────────────────────────────────
// Dumb 7-day × 3h-block toggle grid → profile.streamSchedule. Timezone is
// stamped from the browser on every toggle so the rendered card can note it.
export function ScheduleTab({ form, setField }) {
  const sched = form.streamSchedule || { tz: '', days: {} };
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } })();

  const isOn = (d, b) => (sched.days?.[String(d)] || []).includes(b);
  const toggle = (d, b) => {
    const key = String(d);
    const cur = new Set(sched.days?.[key] || []);
    cur.has(b) ? cur.delete(b) : cur.add(b);
    const days = { ...(sched.days || {}) };
    if (cur.size) days[key] = Array.from(cur).sort((a, z) => a - z);
    else delete days[key];
    setField('streamSchedule', Object.keys(days).length ? { tz, days } : null);
  };

  const hasAny = Object.keys(sched.days || {}).length > 0;

  return (
    <>
      <PanelHeader title="Stream Schedule" sub="Tap the hours you usually go live. Shown as a card on your public profile." />
      <FormSection sub={`Times are in your timezone${tz ? ` (${tz})` : ''} — viewers see it labelled with that.`}>
        <div className="overflow-x-auto">
          <div className="inline-grid gap-1" style={{ gridTemplateColumns: `44px repeat(${SCHEDULE_BLOCKS.length}, minmax(34px, 1fr))` }}>
            <span />
            {SCHEDULE_BLOCKS.map(b => (
              <span key={b} className="text-[9.5px] text-text-muted font-bold text-center pb-1">{b}:00</span>
            ))}
            {SCHEDULE_DAYS.map((day, d) => (
              <FragmentRow key={day} day={day} d={d} isOn={isOn} toggle={toggle} />
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between mt-3">
          <p className="text-[10.5px] text-text-muted">Each cell = a 3-hour block starting at that time.</p>
          {hasAny && (
            <button onClick={() => setField('streamSchedule', null)}
              className="text-[11px] font-bold" style={{ color: '#F04060' }}>
              Clear all
            </button>
          )}
        </div>
      </FormSection>
    </>
  );
}

function FragmentRow({ day, d, isOn, toggle }) {
  return (
    <>
      <span className="text-[10.5px] text-text-secondary font-bold flex items-center">{day}</span>
      {SCHEDULE_BLOCKS.map((_, b) => {
        const on = isOn(d, b);
        return (
          <button key={b} onClick={() => toggle(d, b)}
            className="h-8 rounded-md transition-colors"
            style={on
              ? { background: 'rgba(180,79,255,0.45)', border: '1px solid rgba(180,79,255,0.8)' }
              : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
            title={`${day} ${SCHEDULE_BLOCKS[b]}:00`} />
        );
      })}
    </>
  );
}

// 7. Preferences ────────────────────────────────────────────────
export function PreferencesTab({ form, setField }) {
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
        <a href="/settings" className="inline-flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: '#B44FFF' }}>
          Open full settings <Icon name="arrow_forward" size={12} />
        </a>
      </FormSection>
    </>
  );
}
