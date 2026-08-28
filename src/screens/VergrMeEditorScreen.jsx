import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase/config';
import { StackSkeleton } from '../components/skeletons/GlassSkeletons';
import { doc, getDoc } from 'firebase/firestore';
import { useMyVergrMe, initVergrMePage, saveVergrMeDraft, publishVergrMePage, newBlock } from '../hooks/useVergrMe';
import { useUser } from '../context/UserContext';
import { useUI } from '../context/UIContext';
import useTier from '../hooks/useTier';
import UpgradeModal from '../components/UpgradeModal';
import Icon from '../components/Icon';
import { vergrMeUrl, vergrMeDisplayUrl } from '../utils/vergrMeUrl';
import EditorSidebar, { SECTIONS } from '../components/vergrme/EditorSidebar';
import PhonePreview from '../components/vergrme/PhonePreview';
import ContentTab from '../components/vergrme/ContentTab';
import DesignTab from '../components/vergrme/DesignTab';
import DashboardPanel from '../components/vergrme/DashboardPanel';
import MediaPanel from '../components/vergrme/MediaPanel';
import IntegrationsPanel from '../components/vergrme/IntegrationsPanel';
import ProductsPointer from '../components/vergrme/ProductsPointer';
import SettingsPanel from '../components/vergrme/SettingsPanel';
import { ProfileCard, PopupsCard } from '../components/vergrme/AppearanceExtras';
import { StatTile } from '../components/vergrme/EditorUI';

const META = {
  dashboard:    { title: 'Dashboard', sub: 'Your page at a glance' },
  appearance:   { title: 'Appearance', sub: 'Customize your page design and style' },
  links:        { title: 'Links & Blocks', sub: 'Add, edit and reorder your content' },
  media:        { title: 'Media', sub: 'Images, galleries and video' },
  products:     { title: 'Products', sub: 'Sell digital downloads, keep 92% of every sale' },
  analytics:    { title: 'Analytics', sub: 'See how your page performs' },
  integrations: { title: 'Integrations', sub: 'Socials and connected accounts' },
  settings:     { title: 'Settings', sub: 'Visibility, branding and domain' },
};

export default function VergrMeEditorScreen() {
  const navigate = useNavigate();
  const { profile } = useUser();
  const { page, loading } = useMyVergrMe();
  const { tier } = useTier();
  const { showToast } = useUI();
  const isPro = tier === 'pro';

  const [form, setForm] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [draftStatus, setDraftStatus] = useState('saved'); // 'saved' | 'saving'
  const [hasUnpublished, setHasUnpublished] = useState(false);
  const [section, setSection] = useState('dashboard');
  const [navOpen, setNavOpen] = useState(false);
  const [upgradeModal, setUpgradeModal] = useState({ open: false, message: '' });
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const skipAutosave = useRef(true); // don't autosave the load-set form
  const autosaveTimer = useRef(null);

  useEffect(() => {
    if (loading || form) return; // init once; never clobber an edited form
    if (profile) initVergrMePage(auth.currentUser.uid, profile).then((d) => {
      setForm({ ...d });
      setHasUnpublished(!!d.hasUnpublishedChanges);
      skipAutosave.current = true;
    });
  }, [page, loading, profile, form]);

  // Debounced draft autosave on every edit (live page stays as last-published).
  useEffect(() => {
    if (!form) return;
    if (skipAutosave.current) { skipAutosave.current = false; return; }
    setHasUnpublished(true);
    setDraftStatus('saving');
    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      try { await saveVergrMeDraft(form); setDraftStatus('saved'); }
      catch (err) { console.error('vergr.me autosave failed', err); }
    }, 1200);
    return () => clearTimeout(autosaveTimer.current);
  }, [form]);

  const patch = (obj) => setForm((f) => ({ ...f, ...obj }));
  const up = (key, val) => setForm((f) => ({ ...f, [key]: val }));
  const username = profile?.username;

  const handlePublish = async () => {
    clearTimeout(autosaveTimer.current);
    setPublishing(true);
    try {
      await publishVergrMePage(form);
      setHasUnpublished(false);
      setDraftStatus('saved');
      showToast('Published — your page is live', 'success');
    } catch (err) {
      console.error('vergr.me publish failed', err);
      showToast(err?.message || 'Publish failed — please try again', 'error');
    } finally {
      setPublishing(false);
    }
  };

  const copyUrl = () => {
    navigator.clipboard.writeText(vergrMeDisplayUrl(username));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const openPage = () => window.open(`/u/${username}`, '_blank');
  const sharePage = async () => {
    const url = vergrMeUrl(username);
    try { if (navigator.share) await navigator.share({ title: form.displayName, url }); else { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } }
    catch { /* cancelled */ }
  };
  const proGate = (msg) => setUpgradeModal({ open: true, message: msg });

  // Apply a starter template: swap in its blocks + design, keep identity
  // (name/bio/avatar/socials handles) untouched.
  const applyTemplate = (tpl) => {
    const blocks = (tpl.blocks || []).map((b, i) => newBlock(b.type, { ...b, order: i }));
    patch({ ...(tpl.patch || {}), blocks });
    setSection('links');
    showToast(`${tpl.label} template applied — make it yours`, 'success');
  };

  if (loading || !form) {
    return <div className="h-screen bg-bg-dark"><StackSkeleton rows={5} height={72} /></div>;
  }

  const blocks = form.blocks || [];
  const setBlocks = (b) => up('blocks', b);

  const previewAvatar = form.useProfileAvatar ? (profile?.avatar || profile?.photoURL || null) : form.customAvatarUrl;
  const previewData = { ...form, username: form.username || username, followerCount: profile?.followerCount || 0 };

  const meta = META[section];

  return (
    <div className="flex h-screen bg-bg-dark text-text-primary overflow-hidden">
      <EditorSidebar active={section} onSelect={setSection} isPro={isPro} open={navOpen} onClose={() => setNavOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Header bar */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3.5 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setNavOpen(true)} className="lg:hidden w-9 h-9 flex items-center justify-center rounded-lg hover:bg-surface-1 shrink-0"><Icon name="menu" size={20} /></button>
            <div className="min-w-0">
              <h1 className="font-syne font-bold text-base sm:text-lg leading-tight truncate">{meta.title}</h1>
              <p className="text-xs text-text-muted truncate">{meta.sub}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="hidden md:flex items-center gap-1.5 text-[11px] text-text-muted">
              {draftStatus === 'saving'
                ? (<><Icon name="cloud_sync" size={13} className="animate-pulse" /> Saving draft…</>)
                : hasUnpublished
                  ? (<><span className="w-1.5 h-1.5 rounded-full bg-brand-gold" /> Unpublished changes</>)
                  : (<><Icon name="check_circle" size={13} className="text-brand-violet-light" /> Draft saved</>)}
            </span>
            <button onClick={() => setShowPreview(true)} className="lg:hidden flex items-center gap-1.5 px-3 py-2 text-xs border border-white/10 rounded-lg text-text-secondary"><Icon name="visibility" size={14} /> Preview</button>
            <button onClick={openPage} className="hidden sm:flex items-center gap-1.5 px-3 py-2 text-xs border border-white/10 rounded-lg text-text-secondary hover:text-text-primary"><Icon name="open_in_new" size={14} /> View live</button>
            {/* A never-published page has no unpublished CHANGES either, so the
                old condition disabled Publish on exactly the page that needs it
                most and left the user stuck with a private page and a dead
                button (audit A19). Publish stays enabled while isPublic is
                false. */}
            <button onClick={handlePublish} disabled={publishing || (form?.isPublic !== false && !hasUnpublished && draftStatus === 'saved')} className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg text-white disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #7B1FFF, #B44FFF)' }}>
              <Icon name="publish" size={14} /> {publishing ? 'Publishing…' : 'Publish'}
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
            <div className="max-w-2xl mx-auto w-full flex flex-col gap-4">
              {section === 'dashboard' && (
                <DashboardPanel form={form} username={username} uid={auth.currentUser?.uid} isPro={isPro} onSelect={setSection} onCopy={copyUrl} copied={copied} onOpen={openPage} onShare={sharePage} onApplyTemplate={applyTemplate} />
              )}
              {section === 'appearance' && (
                <>
                  <ProfileCard form={form} patch={patch} profile={profile} username={username} />
                  <DesignTab form={form} patch={patch} isPro={isPro} onProGate={proGate} />
                  <PopupsCard form={form} patch={patch} />
                </>
              )}
              {section === 'links' && (
                <ContentTab blocks={blocks} setBlocks={setBlocks} isPro={isPro} onProGate={proGate} />
              )}
              {section === 'media' && (
                <MediaPanel form={form} patch={patch} blocks={blocks} setBlocks={setBlocks} onSelect={setSection} />
              )}
              {section === 'products' && (
                <ProductsPointer uid={auth.currentUser?.uid} onGoToBlocks={() => setSection('links')} />
              )}
              {section === 'integrations' && (
                <IntegrationsPanel blocks={blocks} setBlocks={setBlocks} />
              )}
              {section === 'settings' && (
                <SettingsPanel form={form} up={up} patch={patch} isPro={isPro} canHideBranding={tier !== 'free'} onProGate={proGate} copyUrl={copyUrl} copied={copied} onOpen={openPage} username={username} uid={auth.currentUser?.uid} />
              )}
              {section === 'analytics' && (
                <VergrMeAnalytics uid={auth.currentUser?.uid} blocks={blocks} isPro={isPro} onProGate={proGate} />
              )}
            </div>
          </div>

          {/* Desktop sticky preview */}
          <aside className="hidden xl:flex flex-col items-center justify-center gap-3 w-[400px] border-l border-white/5 bg-black/20 p-6 shrink-0">
            <PhonePreview data={previewData} avatarUrl={previewAvatar} />
            <button onClick={openPage} className="text-[11px] text-brand-violet-light hover:underline mt-2">Open public page ↗</button>
          </aside>
        </div>
      </div>

      {/* Mobile full-screen preview */}
      {showPreview && (
        <div className="xl:hidden fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col items-center">
          <div className="w-full max-w-md flex items-center justify-between px-4 py-3">
            <span className="text-sm font-medium text-white">Live preview</span>
            <button onClick={() => setShowPreview(false)} className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 text-white"><Icon name="close" size={18} /></button>
          </div>
          <div className="flex-1 flex items-start justify-center pt-2 overflow-y-auto">
            <PhonePreview data={previewData} avatarUrl={previewAvatar} floating={false} />
          </div>
        </div>
      )}

      <UpgradeModal isOpen={upgradeModal.open} onClose={() => setUpgradeModal({ open: false, message: '' })} requiredTier="pro" message={upgradeModal.message} />
      <FirstRunTour onGo={(s) => setSection(s)} />
    </div>
  );
}

// One-time 3-step coach for new editors (the builder is deep; three pointers
// beat a manual). Dismissal persists per device.
const TOUR_KEY = 'vergr_me_tour_done';
const TOUR_STEPS = [
  { icon: 'palette', title: 'Make it yours', body: 'Pick a design system, colors, fonts and background in Appearance.', section: 'appearance', cta: 'Open Appearance' },
  { icon: 'add_link', title: 'Add your blocks', body: 'Links, media, music, products, tips and live Vergr content: 18+ block types.', section: 'links', cta: 'Open Links & Blocks' },
  { icon: 'publish', title: 'Publish when ready', body: 'Edits autosave as a draft. Hit Publish (top right) to push them live on your public page.', section: null, cta: 'Got it' },
];

function FirstRunTour({ onGo }) {
  const [step, setStep] = useState(() => {
    try { return localStorage.getItem(TOUR_KEY) ? -1 : 0; } catch { return -1; }
  });
  if (step < 0) return null;
  const s = TOUR_STEPS[step];
  const done = () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch {} setStep(-1); };
  const next = () => {
    if (s.section) onGo(s.section);
    if (step >= TOUR_STEPS.length - 1) done();
    else setStep(step + 1);
  };
  return (
    <div className="fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-white/10 bg-surface-1/95 backdrop-blur-xl p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-white" style={{ background: 'linear-gradient(135deg, #7B1FFF, #B44FFF)' }}>
            <Icon name={s.icon} size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{s.title}</p>
            <p className="text-xs text-text-secondary mt-0.5">{s.body}</p>
          </div>
        </div>
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-1.5">
            {TOUR_STEPS.map((_, i) => (
              <span key={i} className={`w-1.5 h-1.5 rounded-full ${i === step ? 'bg-brand-violet-light' : 'bg-white/15'}`} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={done} className="px-3 py-1.5 text-xs text-text-muted hover:text-text-secondary">Skip</button>
            <button onClick={next} className="px-3.5 py-1.5 text-xs font-semibold rounded-lg text-white" style={{ background: 'linear-gradient(135deg, #7B1FFF, #B44FFF)' }}>{s.cta}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function VergrMeAnalytics({ uid, blocks, isPro, onProGate }) {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    if (!uid) return;
    const days = Array.from({ length: 30 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - i); return d.toISOString().slice(0, 10); });
    Promise.all(days.map(async (day) => { const s = await getDoc(doc(db, 'users', uid, 'vergrMeViews', day)); return s.exists() ? s.data() : null; }))
      .then((results) => {
        const valid = results.filter(Boolean);
        const clickMap = {}; const devices = {}; const referrers = {};
        valid.forEach((d) => {
          Object.entries(d.blockClicks || d.linkClicks || {}).forEach(([k, v]) => { clickMap[k] = (clickMap[k] || 0) + v; });
          Object.entries(d.devices || {}).forEach(([k, v]) => { devices[k] = (devices[k] || 0) + v; });
          Object.entries(d.referrers || {}).forEach(([k, v]) => { referrers[k] = (referrers[k] || 0) + v; });
        });
        setStats({
          views: valid.reduce((s, d) => s + (d.views || 0), 0),
          clicks: Object.values(clickMap).reduce((a, b) => a + b, 0),
          messageTaps: valid.reduce((s, d) => s + (d.messageTaps || 0), 0),
          emailTaps: valid.reduce((s, d) => s + (d.emailTaps || 0), 0),
          tipTaps: valid.reduce((s, d) => s + (d.tipTaps || 0), 0),
          clickMap, devices, referrers,
          // Oldest -> newest daily view counts for the sparkline.
          series: [...days].reverse().map((day, i) => results[days.length - 1 - i]?.views || 0),
        });
      });
  }, [uid]);

  if (!stats) return <StackSkeleton rows={3} height={56} />;

  // Basic analytics (views + block clicks + top blocks) are FREE; the deeper
  // engagement breakdown (message/email/tip taps) stays Pro. (§5 decision 1.)
  const ctr = stats.views > 0 ? `${Math.round((stats.clicks / stats.views) * 100)}%` : '—';
  const basicCards = [
    { label: 'Page views', value: stats.views.toLocaleString() },
    { label: 'Block clicks', value: stats.clicks.toLocaleString() },
    { label: 'Click-through rate', value: ctr },
  ];
  const proCards = [
    { label: 'Message taps', value: stats.messageTaps },
    { label: 'Email taps', value: stats.emailTaps },
    { label: 'Tip taps', value: stats.tipTaps },
  ];
  const topBlocks = (blocks || []).map((b) => ({ b, n: stats.clickMap[b.id] || 0 })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 8);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-text-muted">Last 30 days</p>
      <Sparkline series={stats.series} />
      <div className="grid grid-cols-3 gap-3">
        {basicCards.map((c) => <StatTile key={c.label} value={c.value} label={c.label} />)}
      </div>

      <div className="flex items-center gap-2 mt-1">
        <p className="text-[11px] text-text-muted font-semibold uppercase tracking-wider">Engagement</p>
        {!isPro && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-brand-gold-light/15 text-brand-gold-light font-semibold">Pro</span>}
      </div>
      {isPro ? (
        <>
          <div className="grid grid-cols-3 gap-3">
            {proCards.map((c) => <StatTile key={c.label} value={c.value.toLocaleString()} label={c.label} />)}
          </div>
          <AudienceCard devices={stats.devices} referrers={stats.referrers} />
        </>
      ) : (
        <button onClick={() => onProGate('Upgrade to Pro for engagement analytics (message, email and tip taps) plus device and traffic-source breakdowns.')}
          className="grid grid-cols-3 gap-3 text-left">
          {proCards.map((c) => (
            <div key={c.label} className="relative px-3 py-4 bg-surface-1/70 rounded-xl border border-white/5 overflow-hidden">
              <div className="blur-[5px] select-none"><StatTile value="•••" label={c.label} /></div>
              <Icon name="lock" size={14} className="absolute top-2 right-2 text-brand-gold-light" />
            </div>
          ))}
        </button>
      )}

      {topBlocks.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-text-muted font-semibold uppercase tracking-wider">Top blocks</p>
          {topBlocks.map(({ b, n }) => (
            <div key={b.id} className="flex items-center justify-between px-4 py-2.5 bg-surface-1/70 rounded-xl border border-white/5">
              <span className="text-sm truncate">{b.title || b.label || b.text || b.type}</span>
              <span className="text-xs font-dmmono tabular-nums text-brand-violet-light">{n.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 30-day views sparkline (pure SVG, no chart lib on this screen).
function Sparkline({ series = [] }) {
  const max = Math.max(1, ...series);
  const W = 600, H = 64;
  const pts = series.map((v, i) => `${(i / Math.max(1, series.length - 1)) * W},${H - (v / max) * (H - 6) - 3}`).join(' ');
  return (
    <div className="px-4 py-3 bg-surface-1/70 rounded-xl border border-white/5">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16" preserveAspectRatio="none">
        <polyline points={`0,${H} ${pts} ${W},${H}`} fill="rgba(123,31,255,0.14)" stroke="none" />
        <polyline points={pts} fill="none" stroke="#B44FFF" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <p className="text-[10px] text-text-muted mt-1">Daily views · last 30 days</p>
    </div>
  );
}

// Pro audience breakdown: device split + top traffic sources.
function AudienceCard({ devices = {}, referrers = {} }) {
  const mob = devices.mobile || 0, desk = devices.desktop || 0, tot = mob + desk;
  const topRefs = Object.entries(referrers)
    .sort((a, b) => b[1] - a[1]).slice(0, 6);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-text-muted font-semibold uppercase tracking-wider">Audience</p>
      {tot > 0 && (
        <div className="px-4 py-3 bg-surface-1/70 rounded-xl border border-white/5">
          <div className="flex justify-between text-[11px] text-text-secondary mb-1.5">
            <span>Mobile {Math.round((mob / tot) * 100)}%</span>
            <span>Desktop {Math.round((desk / tot) * 100)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(mob / tot) * 100}%`, background: 'linear-gradient(90deg, #7B1FFF, #B44FFF)' }} />
          </div>
        </div>
      )}
      {topRefs.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {topRefs.map(([host, n]) => (
            <div key={host} className="flex items-center justify-between px-4 py-2 bg-surface-1/70 rounded-xl border border-white/5">
              <span className="text-xs truncate text-text-secondary">{host === 'direct' ? 'Direct / unknown' : host.replace(/_/g, '.')}</span>
              <span className="text-xs font-dmmono tabular-nums text-brand-violet-light">{n.toLocaleString()}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-text-muted px-1">Traffic sources appear here as visitors arrive.</p>
      )}
    </div>
  );
}
