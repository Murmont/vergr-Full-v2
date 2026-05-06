import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase/config';
import { uploadToR2 } from '../utils/r2Storage';
import { doc, getDoc } from 'firebase/firestore';
import {
  useMyVergrMe,
  initVergrMePage,
  saveVergrMePage,
  addVergrMeLink,
  removeVergrMeLink,
} from '../hooks/useVergrMe';
import { useUser } from '../context/UserContext';
import useTier from '../hooks/useTier';
import UpgradeModal from '../components/UpgradeModal';
import Icon from '../components/Icon';
import { THEMES, ACCENT_PRESETS, SOCIAL_META } from '../utils/vergrMeThemes';

export default function VergrMeEditorScreen() {
  const navigate = useNavigate();
  const { profile } = useUser();
  const { page, loading } = useMyVergrMe();
  const { tier } = useTier();
  const isPro = tier === 'pro';

  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('display');
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [newLink, setNewLink] = useState({
    title: '',
    url: '',
    icon: '🔗',
    subtitle: '',
    type: 'link',
  });
  const [upgradeModal, setUpgradeModal] = useState({ open: false, message: '' });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (page) {
      setForm({ ...page });
    } else if (profile) {
      initVergrMePage(auth.currentUser.uid, profile).then((defaults) =>
        setForm({ ...defaults })
      );
    }
  }, [page, loading, profile]);

  const up = (key, val) => setForm((f) => ({ ...f, [key]: val }));
  const upSocial = (key, val) =>
    setForm((f) => ({ ...f, socials: { ...f.socials, [key]: val } }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveVergrMePage(form);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (file) => {
    const { url } = await uploadToR2(file, 'avatar');
    up('customAvatarUrl', url);
    up('useProfileAvatar', false);
  };

  const handleBannerUpload = async (file) => {
    const { url } = await uploadToR2(file, 'banner');
    up('bannerUrl', url);
    up('bannerStyle', 'image');
  };

  const handleAddLink = async () => {
    if (!newLink.title || !newLink.url) return;
    await addVergrMeLink(newLink);
    setNewLink({ title: '', url: '', icon: '🔗', subtitle: '', type: 'link' });
    setShowLinkForm(false);
    const snap = await getDoc(doc(db, 'users', auth.currentUser.uid, 'vergrMe', 'page'));
    if (snap.exists()) setForm((f) => ({ ...f, links: snap.data().links }));
  };

  const copyUrl = () => {
    navigator.clipboard.writeText(`vergr.me/${profile?.username}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const proGate = (msg) => {
    if (!isPro) {
      setUpgradeModal({ open: true, message: msg });
      return false;
    }
    return true;
  };

  if (loading || !form) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg-dark">
        <div className="w-8 h-8 border-2 border-brand-cyan border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const tabs = [
    { id: 'display', label: 'Display' },
    { id: 'links', label: 'Links' },
    { id: 'appearance', label: 'Style' },
    { id: 'settings', label: 'Settings' },
    { id: 'analytics', label: 'Stats' },
  ];

  return (
    <div className="flex flex-col h-screen bg-bg-dark text-text-primary">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 shrink-0">
        <button
          onClick={() => navigate(-1)}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-1"
        >
          <Icon name="arrow_back" size={18} className="text-text-secondary" />
        </button>
        <div className="flex flex-col items-center">
          <span className="text-sm font-medium">My Vergr.me</span>
          <span className="text-[10px] text-brand-cyan font-mono">
            vergr.me/{profile?.username}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={copyUrl}
            className="px-3 py-1.5 text-[11px] border border-white/10 rounded-full text-text-secondary hover:text-text-primary"
          >
            {copied ? 'Copied!' : 'Copy link'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-[11px] font-semibold bg-brand-cyan text-bg-dark rounded-full disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/5 overflow-x-auto shrink-0 scrollbar-none">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-[11px] font-semibold whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'text-brand-cyan border-brand-cyan'
                : 'text-text-muted border-transparent hover:text-text-secondary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 max-w-lg mx-auto w-full">
        {activeTab === 'display' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] text-text-muted font-semibold uppercase tracking-wider">
                Your URL
              </label>
              <div className="flex items-center gap-2 px-3 py-2.5 bg-surface-1 rounded-xl border border-white/5">
                <span className="text-xs text-text-muted">vergr.me/</span>
                <span className="text-sm text-brand-cyan font-mono">
                  {profile?.username}
                </span>
                <Icon name="lock" size={12} className="text-text-muted ml-auto" />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[11px] text-text-muted font-semibold uppercase tracking-wider">
                Photo
              </label>
              <div className="flex gap-3">
                <button
                  onClick={() => up('useProfileAvatar', true)}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-medium border ${
                    form.useProfileAvatar
                      ? 'border-brand-cyan text-brand-cyan bg-brand-cyan/10'
                      : 'border-white/10 text-text-muted bg-surface-1'
                  }`}
                >
                  Use my profile photo
                </button>
                <label
                  className={`flex-1 py-2.5 rounded-xl text-xs font-medium border text-center cursor-pointer ${
                    !form.useProfileAvatar
                      ? 'border-brand-cyan text-brand-cyan bg-brand-cyan/10'
                      : 'border-white/10 text-text-muted bg-surface-1'
                  }`}
                >
                  Upload different photo
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) =>
                      e.target.files[0] && handleAvatarUpload(e.target.files[0])
                    }
                  />
                </label>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] text-text-muted font-semibold uppercase tracking-wider">
                Display name
              </label>
              <input
                value={form.displayName || ''}
                onChange={(e) => up('displayName', e.target.value)}
                className="input-field"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] text-text-muted font-semibold uppercase tracking-wider">
                Bio{' '}
                <span className="text-text-muted/40 normal-case">
                  ({(form.bio || '').length}/200)
                </span>
              </label>
              <textarea
                value={form.bio || ''}
                onChange={(e) => up('bio', e.target.value.slice(0, 200))}
                rows={3}
                className="input-field resize-none"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[11px] text-text-muted font-semibold uppercase tracking-wider">
                Social handles
              </label>
              {Object.keys(SOCIAL_META).map((key) => (
                <div
                  key={key}
                  className="flex items-center gap-2 px-3 py-2.5 bg-surface-1 rounded-xl border border-white/5"
                >
                  <span className="text-[11px] text-text-muted w-16 font-medium capitalize">
                    {key}
                  </span>
                  <span className="text-[11px] text-text-muted/30">@</span>
                  <input
                    value={form.socials?.[key] || ''}
                    onChange={(e) => upSocial(key, e.target.value)}
                    placeholder={`your${key}handle`}
                    className="flex-1 bg-transparent text-sm text-text-primary outline-none"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'links' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-text-muted">
                {(form.links || []).length} links
              </p>
              <button
                onClick={() => setShowLinkForm((p) => !p)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-cyan/10 text-brand-cyan text-xs font-semibold rounded-full border border-brand-cyan/20"
              >
                <Icon name="add" size={14} /> Add link
              </button>
            </div>

            {showLinkForm && (
              <div className="p-3 bg-surface-1 rounded-xl border border-white/5 flex flex-col gap-2">
                <div className="flex gap-2">
                  <input
                    value={newLink.icon}
                    onChange={(e) =>
                      setNewLink((p) => ({ ...p, icon: e.target.value }))
                    }
                    className="w-12 text-center py-2 bg-surface-2 rounded-lg border border-white/5 text-xl outline-none"
                  />
                  <input
                    value={newLink.title}
                    onChange={(e) =>
                      setNewLink((p) => ({ ...p, title: e.target.value }))
                    }
                    placeholder="Link title"
                    className="flex-1 px-3 py-2 bg-surface-2 rounded-lg border border-white/5 text-sm outline-none"
                  />
                </div>
                <input
                  value={newLink.url}
                  onChange={(e) =>
                    setNewLink((p) => ({ ...p, url: e.target.value }))
                  }
                  placeholder="https://..."
                  type="url"
                  className="px-3 py-2 bg-surface-2 rounded-lg border border-white/5 text-sm outline-none"
                />
                <input
                  value={newLink.subtitle}
                  onChange={(e) =>
                    setNewLink((p) => ({ ...p, subtitle: e.target.value }))
                  }
                  placeholder="Subtitle (optional)"
                  className="px-3 py-2 bg-surface-2 rounded-lg border border-white/5 text-sm outline-none"
                />
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => setShowLinkForm(false)}
                    className="flex-1 py-2 text-xs text-text-muted border border-white/5 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddLink}
                    className="flex-1 py-2 text-xs font-semibold bg-brand-cyan text-bg-dark rounded-lg"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}

            {(form.links || [])
              .sort((a, b) => a.order - b.order)
              .map((link) => (
                <div
                  key={link.id}
                  className="flex items-center gap-3 p-3 bg-surface-1 rounded-xl border border-white/5"
                >
                  <div className="text-xl shrink-0">{link.icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{link.title}</p>
                    <p className="text-xs text-text-muted truncate">
                      {link.subtitle || link.url}
                    </p>
                    <p className="text-[10px] text-text-muted/40 mt-0.5">
                      {link.clicks} clicks
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      up(
                        'links',
                        (form.links || []).map((l) =>
                          l.id === link.id ? { ...l, enabled: !l.enabled } : l
                        )
                      )
                    }
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      link.enabled ? 'text-brand-cyan' : 'text-text-muted'
                    }`}
                  >
                    <Icon
                      name={link.enabled ? 'visibility' : 'visibility_off'}
                      size={16}
                    />
                  </button>
                  <button
                    onClick={() => {
                      removeVergrMeLink(link.id);
                      up(
                        'links',
                        (form.links || []).filter((l) => l.id !== link.id)
                      );
                    }}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-text-muted hover:text-red-400"
                  >
                    <Icon name="delete" size={16} />
                  </button>
                </div>
              ))}
          </div>
        )}

        {activeTab === 'appearance' && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label className="text-[11px] text-text-muted font-semibold uppercase tracking-wider">
                Theme
              </label>
              <div className="grid grid-cols-3 gap-2">
                {Object.keys(THEMES).map((name) => (
                  <button
                    key={name}
                    onClick={() => {
                      if (name !== 'dark' && !proGate('Custom themes are Pro only.'))
                        return;
                      up('theme', name);
                    }}
                    className={`py-2.5 rounded-xl text-xs font-semibold capitalize border relative ${
                      form.theme === name
                        ? 'border-brand-cyan text-brand-cyan bg-brand-cyan/10'
                        : 'border-white/10 text-text-muted bg-surface-1'
                    }`}
                  >
                    {!isPro && name !== 'dark' && (
                      <span className="absolute top-1 right-1 text-[9px]">⭐</span>
                    )}
                    {name}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[11px] text-text-muted font-semibold uppercase tracking-wider">
                Accent colour
              </label>
              <div className="flex gap-3 flex-wrap items-center">
                {ACCENT_PRESETS.map((color) => (
                  <button
                    key={color}
                    onClick={() => {
                      if (
                        color !== '#00e5ff' &&
                        !proGate('Custom accent colours are Pro only.')
                      )
                        return;
                      up('accentColor', color);
                    }}
                    style={{
                      background: color,
                      transform: form.accentColor === color ? 'scale(1.2)' : 'scale(1)',
                    }}
                    className="w-6 h-6 rounded-full border-2 transition-transform relative"
                  >
                    {!isPro && color !== '#00e5ff' && (
                      <span className="absolute inset-0 flex items-center justify-center text-[8px]">
                        ⭐
                      </span>
                    )}
                  </button>
                ))}
                {isPro && (
                  <label className="w-6 h-6 rounded-full border border-dashed border-white/20 flex items-center justify-center cursor-pointer">
                    <Icon name="colorize" size={12} className="text-text-muted" />
                    <input
                      type="color"
                      value={form.accentColor || '#00e5ff'}
                      onChange={(e) => up('accentColor', e.target.value)}
                      className="sr-only"
                    />
                  </label>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[11px] text-text-muted font-semibold uppercase tracking-wider">
                Banner
              </label>
              <div className="grid grid-cols-2 gap-2">
                {['gradient', 'mesh', 'image', 'none'].map((style) => (
                  <button
                    key={style}
                    onClick={() => {
                      if (style !== 'none' && !proGate('Custom banners are Pro only.'))
                        return;
                      up('bannerStyle', style);
                    }}
                    className={`py-2.5 rounded-xl text-xs font-semibold capitalize border ${
                      form.bannerStyle === style
                        ? 'border-brand-cyan text-brand-cyan bg-brand-cyan/10'
                        : 'border-white/10 text-text-muted bg-surface-1'
                    }`}
                  >
                    {style}
                  </button>
                ))}
              </div>
              {form.bannerStyle === 'image' && (
                <label className="flex items-center justify-center gap-2 py-3 border border-dashed border-white/10 rounded-xl text-xs text-text-muted cursor-pointer hover:text-text-secondary">
                  <Icon name="upload" size={14} /> Upload banner image
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) =>
                      e.target.files[0] && handleBannerUpload(e.target.files[0])
                    }
                  />
                </label>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[11px] text-text-muted font-semibold uppercase tracking-wider">
                Button style
              </label>
              <div className="grid grid-cols-2 gap-2">
                {['card', 'pill', 'outline', 'shadow'].map((style) => (
                  <button
                    key={style}
                    onClick={() => {
                      if (style !== 'card' && !proGate('Custom button styles are Pro only.'))
                        return;
                      up('buttonStyle', style);
                    }}
                    className={`py-2.5 rounded-xl text-xs font-semibold capitalize border ${
                      form.buttonStyle === style
                        ? 'border-brand-cyan text-brand-cyan bg-brand-cyan/10'
                        : 'border-white/10 text-text-muted bg-surface-1'
                    }`}
                  >
                    {style}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="flex flex-col gap-3">
            {[
              {
                key: 'showMessageBtn',
                label: '"Message on Vergr" button',
                sub: 'Let visitors start a chat',
              },
              {
                key: 'showFollowers',
                label: 'Show follower count',
                sub: 'Display your follower count',
              },
              {
                key: 'showSocials',
                label: 'Show social icons',
                sub: 'Display social links',
              },
              {
                key: 'isPublic',
                label: 'Public page',
                sub: 'Anyone with link can view',
              },
            ].map((item) => (
              <div
                key={item.key}
                className="flex items-center justify-between py-3 px-4 bg-surface-1 rounded-xl border border-white/5"
              >
                <div>
                  <p className="text-sm">{item.label}</p>
                  <p className="text-xs text-text-muted mt-0.5">{item.sub}</p>
                </div>
                <button
                  onClick={() => up(item.key, !form[item.key])}
                  className={`w-10 h-6 rounded-full transition-colors relative ${
                    form[item.key] ? 'bg-brand-cyan' : 'bg-surface-2'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                      form[item.key] ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            ))}

            <div className="flex items-center justify-between py-3 px-4 bg-surface-1 rounded-xl border border-white/5">
              <div>
                <p className="text-sm">Email contact</p>
                <p className="text-xs text-text-muted mt-0.5">
                  Show "Connect with me" button
                </p>
              </div>
              <button
                onClick={() => up('showEmail', !form.showEmail)}
                className={`w-10 h-6 rounded-full transition-colors relative ${
                  form.showEmail ? 'bg-brand-cyan' : 'bg-surface-2'
                }`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                    form.showEmail ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
            {form.showEmail && (
              <input
                value={form.contactEmail || ''}
                onChange={(e) => up('contactEmail', e.target.value)}
                placeholder="your@email.com"
                type="email"
                className="input-field"
              />
            )}

            <div className="flex items-center justify-between py-3 px-4 bg-surface-1 rounded-xl border border-white/5">
              <div>
                <p className="text-sm">Tip jar</p>
                <p className="text-xs text-text-muted mt-0.5">Accept tips (15% fee)</p>
              </div>
              <button
                onClick={() => up('tipJarEnabled', !form.tipJarEnabled)}
                className={`w-10 h-6 rounded-full transition-colors relative ${
                  form.tipJarEnabled ? 'bg-brand-cyan' : 'bg-surface-2'
                }`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                    form.tipJarEnabled ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
            {form.tipJarEnabled && (
              <input
                value={form.tipJarLabel || ''}
                onChange={(e) => up('tipJarLabel', e.target.value)}
                placeholder="Buy me a coffee"
                className="input-field"
              />
            )}

            <div className="mt-2 p-4 bg-surface-1 rounded-xl border border-white/5 flex flex-col gap-3">
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                Your link
              </p>
              <p className="text-sm text-brand-cyan font-mono">
                vergr.me/{profile?.username}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={copyUrl}
                  className="flex-1 py-2 text-xs border border-white/10 rounded-lg text-text-secondary hover:text-text-primary"
                >
                  {copied ? 'Copied!' : 'Copy link'}
                </button>
                <button
                  onClick={() => window.open(`/u/${profile?.username}`, '_blank')}
                  className="flex-1 py-2 text-xs border border-white/10 rounded-lg text-text-secondary hover:text-text-primary"
                >
                  Preview
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'analytics' &&
          (isPro ? (
            <VergrMeAnalytics uid={auth.currentUser?.uid} />
          ) : (
            <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
              <Icon name="bar_chart" size={40} className="text-text-muted/30" />
              <p className="font-medium">Analytics is Pro only</p>
              <p className="text-sm text-text-muted max-w-xs">
                See views, link clicks, and message taps.
              </p>
              <button
                onClick={() =>
                  setUpgradeModal({
                    open: true,
                    message: 'Upgrade to Pro to unlock analytics.',
                  })
                }
                className="px-6 py-2.5 bg-brand-cyan text-bg-dark text-sm font-semibold rounded-full"
              >
                Upgrade to Pro
              </button>
            </div>
          ))}
      </div>

      <UpgradeModal
        isOpen={upgradeModal.open}
        onClose={() => setUpgradeModal({ open: false, message: '' })}
        requiredTier="pro"
        message={upgradeModal.message}
      />
    </div>
  );
}

function VergrMeAnalytics({ uid }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!uid) return;
    const days = Array.from({ length: 30 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      return d.toISOString().slice(0, 10);
    });
    Promise.all(
      days.map(async (day) => {
        const snap = await getDoc(doc(db, 'users', uid, 'vergrMeViews', day));
        return snap.exists() ? snap.data() : null;
      })
    ).then((results) => {
      const valid = results.filter(Boolean);
      setStats({
        views: valid.reduce((s, d) => s + (d.views || 0), 0),
        clicks: valid.reduce(
          (s, d) =>
            s + Object.values(d.linkClicks || {}).reduce((a, b) => a + b, 0),
          0
        ),
        messageTaps: valid.reduce((s, d) => s + (d.messageTaps || 0), 0),
        emailTaps: valid.reduce((s, d) => s + (d.emailTaps || 0), 0),
        tipTaps: valid.reduce((s, d) => s + (d.tipTaps || 0), 0),
      });
    });
  }, [uid]);

  if (!stats)
    return (
      <div className="flex justify-center p-8">
        <div className="w-6 h-6 border-2 border-brand-cyan border-t-transparent rounded-full animate-spin" />
      </div>
    );

  const cards = [
    { label: 'Page views', value: stats.views },
    { label: 'Link clicks', value: stats.clicks },
    { label: 'Message taps', value: stats.messageTaps },
    { label: 'Email taps', value: stats.emailTaps },
    { label: 'Tip taps', value: stats.tipTaps },
  ];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-text-muted text-center">Last 30 days</p>
      <div className="grid grid-cols-3 gap-3">
        {cards.map((c) => (
          <div
            key={c.label}
            className="bg-surface-1 rounded-xl p-3 border border-white/5"
          >
            <p className="text-xl font-semibold">{c.value.toLocaleString()}</p>
            <p className="text-[10px] text-text-muted mt-1">{c.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}