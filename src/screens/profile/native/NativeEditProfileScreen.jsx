// NativeEditProfileScreen — phone-first Edit Profile for the native APK.
// Reuses the EXACT tab panels + save logic from the web EditProfileScreen
// (imported, not duplicated) inside a native-first shell: safe-area sticky
// header, horizontal tab scroller, single-column form, sticky save bar.
// Routed IS_NATIVE_BUILD only; the web screen is untouched.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../../context/UserContext';
import { useUI } from '../../../context/UIContext';
import Icon from '../../../components/Icon';
import {
  EDIT_PROFILE_TABS, ACCENT_COLORS,
  ProfileInfoTab, ProfileImagesTab, CoverBannerTab,
  SocialLinksTab, GamingInfoTab, ScheduleTab, PreferencesTab,
} from '../EditProfileScreen';

export default function NativeEditProfileScreen() {
  const { profile, updateProfile } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('profile-info');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    displayName: '', username: '', bio: '', status: 'online', location: '', country: '', dob: '',
    avatarFrame: 'rookie', socials: {}, socialEnabled: {}, streamKeys: {},
    games: [], gameTags: [], platforms: {}, customStatus: '', visibility: 'public',
    accentColor: '', streamSchedule: null,
  });

  useEffect(() => {
    if (!profile) return;
    setForm((f) => ({
      ...f,
      displayName: profile.displayName || '', username: profile.username || '',
      bio: profile.bio || '', location: profile.location || '', country: profile.country || '', dob: profile.dob || '',
      status: profile.status || 'online', avatarFrame: profile.avatarFrame || 'rookie',
      socials: profile.socials || {}, socialEnabled: profile.socialEnabled || {},
      streamKeys: profile.streamKeys || {}, games: profile.games || [],
      gameTags: profile.gameTags || [],
      platforms: profile.platforms || {}, customStatus: profile.customStatus || '',
      visibility: profile.visibility || 'public',
      accentColor: ACCENT_COLORS.includes(profile.accentColor) ? profile.accentColor : '',
      streamSchedule: profile.streamSchedule || null,
    }));
  }, [profile]);

  const update = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (saving) return;
    const uname = (form.username || '').trim();
    if (!uname) { showToast('Username is required.', 'error'); return; }
    if (uname.toLowerCase() !== String(profile?.username || '').toLowerCase()) {
      const { checkUsername } = await import('../../../utils/usernameValidation');
      const err = await checkUsername(uname, { isAdmin: profile?.role === 'admin' });
      if (err) { showToast(err, 'error'); return; }
    }
    if (form.dob) {
      const dob = new Date(form.dob);
      const eighteen = new Date();
      eighteen.setFullYear(eighteen.getFullYear() - 18);
      if (Number.isNaN(dob.getTime())) { showToast('Enter a valid date of birth', 'error'); return; }
      if (dob > eighteen) { showToast('You must be at least 18 to use VERGR.', 'error'); return; }
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
    <div style={{ background: '#0B0B14', minHeight: '100vh', paddingBottom: 'calc(96px + var(--vg-safe-b))' }}>
      {/* Native safe-area header + tab scroller */}
      <div className="sticky top-0 z-20 bg-bg-dark/95 backdrop-blur-md border-b border-surface-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}>
        <div className="px-4 pb-2 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="w-9 h-9 -ml-1 flex items-center justify-center rounded-full text-text-primary">
            <Icon name="arrow_back" size={22} />
          </button>
          <h1 className="font-syne text-lg font-black text-text-primary">Edit Profile</h1>
        </div>
        <div className="flex gap-2 px-4 pb-2 overflow-x-auto no-scrollbar">
          {EDIT_PROFILE_TABS.map((t) => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className="px-3 py-1.5 rounded-full text-[12px] font-bold whitespace-nowrap shrink-0 flex items-center gap-1.5"
              style={activeTab === t.id
                ? { background: 'rgba(180,79,255,0.20)', color: '#B44FFF', border: '1px solid rgba(180,79,255,0.45)' }
                : { background: 'rgba(255,255,255,0.04)', color: '#9CA3AF', border: '1px solid rgba(255,255,255,0.08)' }}>
              <Icon name={t.icon} size={13} /> {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-4">
        {activeTab === 'profile-info' && <ProfileInfoTab form={form} update={update} setField={setField} />}
        {activeTab === 'profile-images' && <ProfileImagesTab profile={profile} update={update} setField={setField} form={form} showToast={showToast} />}
        {activeTab === 'cover-banner' && <CoverBannerTab profile={profile} showToast={showToast} />}
        {activeTab === 'social-links' && <SocialLinksTab form={form} setField={setField} />}
        {activeTab === 'gaming-info' && <GamingInfoTab form={form} update={update} setField={setField} />}
        {activeTab === 'schedule' && <ScheduleTab form={form} setField={setField} />}
        {activeTab === 'preferences' && <PreferencesTab form={form} setField={setField} />}
      </div>

      {/* Save bar. The tab bar is hidden on this route (BottomNav HIDE_ON_PATHS),
          so the bar sits on its own solid strip above the gesture bar. */}
      <div className="fixed left-0 right-0 bottom-0 z-30 px-4 pt-3 flex gap-2"
        style={{ background: '#0B0B14', paddingBottom: 'calc(var(--vg-safe-b, 0px) + 12px)' }}>
        <button onClick={() => navigate(-1)} className="flex-1 py-3 rounded-xl text-[13px] font-semibold"
          style={{ background: '#1A1A26', color: '#9CA3AF' }}>
          Cancel
        </button>
        <button onClick={save} disabled={saving} className="flex-[2] py-3 rounded-xl text-[13px] font-extrabold"
          style={saving
            ? { background: '#2A2438', color: '#6B7280' }
            : { background: '#7B1FFF', color: '#fff' }}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
