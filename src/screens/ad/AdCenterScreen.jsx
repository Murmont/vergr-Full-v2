// Creator Ad Center.
// - Gated behind identity verification (not subscription tier) — ads are revenue.
// - Targeting uses the same taxonomy that `src/utils/adMatcher.js` scores on:
//   targetAgeBuckets, targetGenders, targetCountries, targetGames, targetTags,
//   targetContentTypes. Behavioural scoring is automatic when the viewer has
//   consented to personalizedAds; demographic targeting is always applied.
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { useLayout } from '../../context/LayoutContext';
import Icon from '../../components/Icon';
import {
  collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, getDoc,
} from 'firebase/firestore';
import { uploadToR2 } from '../../utils/r2Storage';
import { db, auth } from '../../firebase/config';

const AGE_BUCKETS   = ['13-17','18-24','25-34','35-44','45-54','55+'];
const GENDERS       = [{v:'male',l:'Male'},{v:'female',l:'Female'},{v:'nyb',l:'Non-binary / other'}];
const CONTENT_TYPES = ['text','photo','clip','article','short','achievement','lfg','tierlist','quote','stream'];
const COUNTRIES     = ['US','CA','GB','IE','DE','FR','ES','IT','NL','SE','NO','DK','FI','PL','PT','AU','NZ','JP','KR','SG','BR','MX','AR','ZA','AE','IN'];
const POPULAR_GAMES = ['valorant','league-of-legends','cs2','fortnite','apex','warzone','rocket-league','minecraft','pubg','overwatch','dota2','r6-siege','eafc','f1','nba2k','elden-ring','gta','destiny2','wow','genshin'];

const emptyForm = {
  title: '', description: '', imageUrl: '', targetUrl: '', budget: 100, status: 'active',
  targetAgeBuckets: [], targetGenders: [], targetCountries: [],
  targetGames: [], targetTags: [], targetContentTypes: [],
  gamesInput: '', tagsInput: '',
};

export default function AdCenterScreen({ embedded = false }) {
  const navigate = useNavigate();
  const { profile } = useUser();
  const { showToast } = useUI();
  const { setRightPanel, setContentAlign } = useLayout();
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [verifStatus, setVerifStatus] = useState('loading'); // 'loading'|'none'|'pending'|'approved'|'rejected'
  const [showModal, setShowModal] = useState(false);
  const [editingAd, setEditingAd] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRightPanel(null); setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign]);

  // Verification check
  useEffect(() => {
    if (!auth.currentUser) return;
    (async () => {
      if (profile?.verified === true) { setVerifStatus('approved'); return; }
      try {
        const snap = await getDoc(doc(db, 'verification_applications', auth.currentUser.uid));
        if (!snap.exists()) setVerifStatus('none');
        else setVerifStatus(snap.data().status || 'pending');
      } catch { setVerifStatus('none'); }
    })();
  }, [profile?.verified]);

  // Fetch ads
  useEffect(() => {
    if (!auth.currentUser) return;
    (async () => {
      setLoading(true);
      try {
        const q = query(collection(db, 'ads'), where('userId', '==', auth.currentUser.uid));
        const snap = await getDocs(q);
        setAds(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, []);

  const toggleIn = (key, value) => {
    setForm(f => ({ ...f, [key]: f[key].includes(value) ? f[key].filter(v => v !== value) : [...f[key], value] }));
  };
  const splitCSV = (s) => s.split(',').map(x => x.trim().toLowerCase()).filter(Boolean);

  const onImageChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { showToast('Image too large (max 4MB)', 'error'); return; }
    setUploading(true);
    try {
      const { url } = await uploadToR2(file, 'post');
      setForm(f => ({ ...f, imageUrl: url }));
    } catch { showToast('Upload failed', 'error'); }
    setUploading(false);
  };

  const openCreate = () => { setEditingAd(null); setForm(emptyForm); setShowModal(true); };
  const openEdit = (ad) => {
    setEditingAd(ad);
    setForm({
      ...emptyForm, ...ad,
      targetAgeBuckets: ad.targetAgeBuckets || [],
      targetGenders: ad.targetGenders || [],
      targetCountries: ad.targetCountries || [],
      targetGames: ad.targetGames || [],
      targetTags: ad.targetTags || [],
      targetContentTypes: ad.targetContentTypes || [],
      gamesInput: (ad.targetGames || []).join(', '),
      tagsInput: (ad.targetTags || []).join(', '),
    });
    setShowModal(true);
  };

  const buildPayload = () => {
    const games = form.gamesInput ? Array.from(new Set([...form.targetGames, ...splitCSV(form.gamesInput)])) : form.targetGames;
    const tags  = form.tagsInput ? Array.from(new Set([...form.targetTags, ...splitCSV(form.tagsInput)])) : form.targetTags;
    return {
      title: form.title.trim(),
      description: form.description.trim(),
      imageUrl: form.imageUrl || '',
      targetUrl: form.targetUrl.trim(),
      budget: Number(form.budget) || 0,
      status: form.status,
      targetAgeBuckets: form.targetAgeBuckets,
      targetGenders: form.targetGenders,
      targetCountries: form.targetCountries,
      targetGames: games,
      targetTags: tags,
      targetContentTypes: form.targetContentTypes,
    };
  };

  const save = async () => {
    if (!form.title || !form.targetUrl) { showToast('Title and destination URL are required', 'error'); return; }
    setSaving(true);
    try {
      const payload = buildPayload();
      if (editingAd) {
        await updateDoc(doc(db, 'ads', editingAd.id), payload);
        setAds(ads.map(a => a.id === editingAd.id ? { ...a, ...payload } : a));
        showToast('Ad updated', 'success');
      } else {
        const ref = await addDoc(collection(db, 'ads'), {
          ...payload,
          userId: auth.currentUser.uid,
          createdAt: serverTimestamp(),
          impressions: 0, clicks: 0,
        });
        setAds([{ id: ref.id, ...payload, impressions: 0, clicks: 0 }, ...ads]);
        showToast('Ad created', 'success');
      }
      setShowModal(false); setEditingAd(null); setForm(emptyForm);
    } catch (e) {
      console.error(e); showToast('Save failed', 'error');
    }
    setSaving(false);
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this ad?')) return;
    try {
      await deleteDoc(doc(db, 'ads', id));
      setAds(ads.filter(a => a.id !== id));
      showToast('Ad deleted', 'success');
    } catch { showToast('Delete failed', 'error'); }
  };

  // -------- Verification gate --------
  if (verifStatus === 'loading') {
    return <div className={embedded ? '' : 'min-h-screen bg-bg-dark'}><div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-brand-cyan border-t-transparent rounded-full animate-spin"/></div></div>;
  }
  if (verifStatus !== 'approved') {
    const pending = verifStatus === 'pending';
    return (
      <div className={embedded ? '' : 'min-h-screen bg-bg-dark'}>
        <div className="max-w-xl mx-auto mt-6">
          <div className="rounded-2xl border border-white/10 bg-surface-1 p-8 text-center">
            <div className={`w-16 h-16 rounded-full mx-auto flex items-center justify-center mb-4 ${pending ? 'bg-yellow-500/10' : 'bg-brand-cyan/10'}`}>
              <Icon name={pending ? 'hourglass_top' : 'verified_user'} filled size={32} className={pending ? 'text-yellow-400' : 'text-brand-cyan'} />
            </div>
            <h2 className="font-syne font-bold text-white text-xl mb-1">{pending ? 'Verification in review' : 'Verification required'}</h2>
            <p className="text-text-secondary text-sm max-w-sm mx-auto mb-5">
              {pending
                ? 'Your identity documents are under review. You can launch campaigns as soon as we approve the application.'
                : 'To run ads on VERGR, we need to verify your identity. This protects advertisers and viewers and keeps the ecosystem trustworthy.'}
            </p>
            {!pending && (
              <button onClick={() => navigate('/creator/verify')} className="px-6 py-3 rounded-xl bg-brand-cyan text-bg-dark font-bold text-sm hover:brightness-110 transition-all inline-flex items-center gap-2">
                <Icon name="badge" size={18} /> Start verification
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // -------- Main Ad Center UI --------
  const totalSpend = ads.reduce((s, a) => s + (a.budget || 0), 0);
  const totalImps = ads.reduce((s, a) => s + (a.impressions || 0), 0);
  const totalClicks = ads.reduce((s, a) => s + (a.clicks || 0), 0);
  const ctr = totalImps ? ((totalClicks / totalImps) * 100).toFixed(2) : '0.00';

  return (
    <div className={embedded ? 'pb-10' : 'min-h-screen bg-bg-dark pb-10'}>
      {!embedded && (
        <div className="sticky top-0 z-30 glass-header px-4 py-3 flex items-center justify-between border-b border-white/[0.04]">
          <button onClick={() => navigate(-1)} className="text-text-muted hover:text-white"><Icon name="arrow_back" size={24} /></button>
          <h1 className="font-syne font-bold text-xl text-white">Ad Center</h1>
          <div className="w-6"/>
        </div>
      )}

      {/* Header actions */}
      <div className="flex items-center justify-between mb-4 px-4 sm:px-0">
        <div>
          <p className="text-text-muted text-xs uppercase tracking-wider">Campaigns</p>
          <p className="text-white font-syne font-bold text-lg">{ads.length} total</p>
        </div>
        <button onClick={openCreate} className="bg-brand-cyan text-bg-dark px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider inline-flex items-center gap-1.5 hover:brightness-110">
          <Icon name="add" size={16} filled /> New campaign
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-6 px-4 sm:px-0">
        <Kpi label="Total budget" value={`$${totalSpend.toLocaleString()}`} icon="paid" tone="cyan" />
        <Kpi label="Impressions" value={totalImps.toLocaleString()} icon="visibility" tone="violet" />
        <Kpi label="Clicks" value={totalClicks.toLocaleString()} icon="ads_click" tone="pink" />
        <Kpi label="CTR" value={`${ctr}%`} icon="trending_up" tone="gold" />
      </div>

      {/* List */}
      <div className="space-y-3 px-4 sm:px-0">
        {loading ? (
          <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-brand-cyan border-t-transparent rounded-full animate-spin" /></div>
        ) : ads.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-white/10 rounded-2xl">
            <div className="w-20 h-20 mx-auto rounded-full bg-surface-2 flex items-center justify-center mb-4">
              <Icon name="campaign" size={32} className="text-text-muted" />
            </div>
            <p className="text-white font-bold mb-1">No campaigns yet</p>
            <p className="text-text-muted text-sm">Create your first ad to start reaching the VERGR community.</p>
          </div>
        ) : (
          ads.map(ad => <AdRow key={ad.id} ad={ad} onEdit={() => openEdit(ad)} onDelete={() => remove(ad.id)} />)
        )}
      </div>

      {showModal && (
        <AdModal
          form={form} setForm={setForm}
          editingAd={editingAd}
          onClose={() => { setShowModal(false); setEditingAd(null); setForm(emptyForm); }}
          onSave={save}
          saving={saving}
          onImageChange={onImageChange}
          uploading={uploading}
          toggleIn={toggleIn}
        />
      )}
    </div>
  );
}

/* ---------- Sub-components ---------- */

function Kpi({ label, value, icon, tone }) {
  const toneCls = { cyan:'text-brand-cyan', violet:'text-brand-violet', pink:'text-brand-pink', gold:'text-brand-gold' }[tone] || 'text-brand-cyan';
  return (
    <div className="bg-surface-1 rounded-2xl border border-white/[0.06] p-4 flex items-start justify-between">
      <div>
        <p className="text-text-muted text-[10px] uppercase tracking-wider">{label}</p>
        <p className="text-white font-dmmono font-bold text-2xl mt-1 tabular-nums">{value}</p>
      </div>
      <Icon name={icon} filled size={18} className={toneCls} />
    </div>
  );
}

function AdRow({ ad, onEdit, onDelete }) {
  const imps = ad.impressions || 0;
  const clicks = ad.clicks || 0;
  const ctr = imps ? ((clicks / imps) * 100).toFixed(2) : '0.00';
  const targetingCount = (ad.targetAgeBuckets?.length || 0) + (ad.targetGenders?.length || 0) + (ad.targetCountries?.length || 0)
    + (ad.targetGames?.length || 0) + (ad.targetTags?.length || 0) + (ad.targetContentTypes?.length || 0);
  return (
    <div className="bg-surface-1 rounded-2xl border border-white/[0.06] p-4 flex flex-col sm:flex-row gap-4">
      <div className="w-full sm:w-28 h-28 rounded-xl bg-surface-2 overflow-hidden shrink-0 flex items-center justify-center">
        {ad.imageUrl
          ? <img src={ad.imageUrl} alt="" className="w-full h-full object-cover" />
          : <Icon name="image" size={28} className="text-text-muted" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-bold text-white truncate">{ad.title}</h3>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${ad.status === 'active' ? 'bg-green-500/15 text-green-400' : 'bg-white/10 text-text-muted'}`}>{ad.status}</span>
          {targetingCount > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-violet/15 text-brand-violet font-bold uppercase tracking-wider">{targetingCount} targeting</span>
          )}
        </div>
        <p className="text-text-secondary text-sm mt-1 line-clamp-2">{ad.description || '—'}</p>
        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-xs text-text-muted font-dmmono tabular-nums">
          <span><span className="text-text-muted/70">Budget</span> ${ad.budget || 0}</span>
          <span><span className="text-text-muted/70">Impr.</span> {imps.toLocaleString()}</span>
          <span><span className="text-text-muted/70">Clicks</span> {clicks.toLocaleString()}</span>
          <span><span className="text-text-muted/70">CTR</span> {ctr}%</span>
        </div>
      </div>
      <div className="flex sm:flex-col gap-2 justify-end">
        <button onClick={onEdit} className="text-brand-cyan p-2 hover:bg-brand-cyan/10 rounded-lg transition-all"><Icon name="edit" size={18} /></button>
        <button onClick={onDelete} className="text-brand-ember p-2 hover:bg-brand-ember/10 rounded-lg transition-all"><Icon name="delete" size={18} /></button>
      </div>
    </div>
  );
}

function AdModal({ form, setForm, editingAd, onClose, onSave, saving, onImageChange, uploading, toggleIn }) {
  const [tab, setTab] = useState('creative');
  const inputCls = 'w-full bg-surface-2 border border-white/[0.06] rounded-xl px-3 py-2.5 text-white text-sm focus:border-brand-cyan/60 focus:outline-none transition-colors';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="bg-bg-dark rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden border border-white/[0.08] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <div>
            <h2 className="font-syne font-bold text-white text-lg">{editingAd ? 'Edit campaign' : 'New campaign'}</h2>
            <p className="text-text-muted text-xs">Reach viewers by demographics, games, tags and content type.</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-white"><Icon name="close" size={22} /></button>
        </div>

        <div className="px-6 border-b border-white/[0.06] flex gap-1">
          {[
            { k: 'creative', l: 'Creative', i: 'image' },
            { k: 'audience', l: 'Audience', i: 'groups' },
            { k: 'budget',   l: 'Budget',   i: 'paid' },
          ].map(t => (
            <button key={t.k} onClick={() => setTab(t.k)}
              className={`px-4 py-3 text-xs font-bold uppercase tracking-wider inline-flex items-center gap-1.5 border-b-2 transition-all ${tab === t.k ? 'text-brand-cyan border-brand-cyan' : 'text-text-muted border-transparent hover:text-white'}`}>
              <Icon name={t.i} size={14} /> {t.l}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {tab === 'creative' && (
            <>
              <Field label="Headline">
                <input type="text" placeholder="Short, punchy — max 60 chars" maxLength={60} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={inputCls} />
              </Field>
              <Field label="Description">
                <textarea placeholder="What are you promoting? Keep it concise." rows={3} maxLength={180} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className={inputCls} />
              </Field>
              <Field label="Destination URL">
                <input type="url" placeholder="https://…" value={form.targetUrl} onChange={e => setForm(f => ({ ...f, targetUrl: e.target.value }))} className={inputCls} />
              </Field>
              <Field label="Image">
                <div className="flex gap-3 items-start">
                  <div className="w-24 h-24 rounded-xl bg-surface-2 border border-white/[0.06] overflow-hidden flex items-center justify-center shrink-0">
                    {form.imageUrl
                      ? <img src={form.imageUrl} alt="" className="w-full h-full object-cover" />
                      : <Icon name="image" size={22} className="text-text-muted" />}
                  </div>
                  <div className="flex-1 space-y-2">
                    <label className="block cursor-pointer">
                      <div className="px-3 py-2 rounded-xl border border-dashed border-white/10 text-xs text-text-secondary text-center hover:border-white/20 transition-all">
                        {uploading ? 'Uploading…' : 'Upload image'} <span className="text-text-muted">· max 4MB</span>
                      </div>
                      <input type="file" accept="image/*" onChange={onImageChange} className="hidden" />
                    </label>
                    <input type="url" placeholder="or paste image URL" value={form.imageUrl} onChange={e => setForm(f => ({ ...f, imageUrl: e.target.value }))} className={inputCls} />
                  </div>
                </div>
              </Field>
            </>
          )}

          {tab === 'audience' && (
            <>
              <div className="rounded-xl bg-brand-violet/10 border border-brand-violet/20 p-3 text-xs text-text-secondary">
                <Icon name="info" size={14} className="text-brand-violet inline align-middle mr-1" />
                Leave a section empty to target everyone. Filled sections act as filters — your ad scores higher for viewers who match, and behavioural ranking further boosts relevance.
              </div>

              <MultiChip label="Age" options={AGE_BUCKETS.map(v => ({ v, l: v }))} selected={form.targetAgeBuckets} onToggle={v => toggleIn('targetAgeBuckets', v)} />
              <MultiChip label="Gender" options={GENDERS} selected={form.targetGenders} onToggle={v => toggleIn('targetGenders', v)} />
              <MultiChip label="Country" options={COUNTRIES.map(v => ({ v, l: v }))} selected={form.targetCountries} onToggle={v => toggleIn('targetCountries', v)} />
              <MultiChip label="Content type" options={CONTENT_TYPES.map(v => ({ v, l: v }))} selected={form.targetContentTypes} onToggle={v => toggleIn('targetContentTypes', v)} />

              <Field label="Games">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {POPULAR_GAMES.map(g => (
                    <button key={g} onClick={() => toggleIn('targetGames', g)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${form.targetGames.includes(g) ? 'bg-brand-cyan text-bg-dark' : 'bg-surface-2 text-text-secondary hover:bg-surface-3'}`}>{g}</button>
                  ))}
                </div>
                <input type="text" placeholder="Add more (comma-separated): starfield, cod, ..." value={form.gamesInput} onChange={e => setForm(f => ({ ...f, gamesInput: e.target.value }))} className={inputCls} />
              </Field>

              <Field label="Tags / topics">
                <input type="text" placeholder="esports, fps, speedrun, cozy, competitive…" value={form.tagsInput} onChange={e => setForm(f => ({ ...f, tagsInput: e.target.value }))} className={inputCls} />
                {form.targetTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {form.targetTags.map(t => (
                      <span key={t} className="px-2 py-0.5 rounded-full bg-brand-violet/15 text-brand-violet text-[11px] font-bold">#{t}</span>
                    ))}
                  </div>
                )}
              </Field>
            </>
          )}

          {tab === 'budget' && (
            <>
              <Field label="Lifetime budget (USD)">
                <input type="number" min="5" value={form.budget} onChange={e => setForm(f => ({ ...f, budget: parseInt(e.target.value) || 0 }))} className={inputCls} />
                <p className="text-[11px] text-text-muted mt-1.5">You’ll be charged per 1k impressions. Ad stops automatically when the budget is spent.</p>
              </Field>
              <Field label="Status">
                <div className="flex gap-2">
                  {[{v:'active',l:'Active'},{v:'paused',l:'Paused'}].map(o => (
                    <button key={o.v} onClick={() => setForm(f => ({ ...f, status: o.v }))}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${form.status === o.v ? 'bg-brand-cyan text-bg-dark' : 'bg-surface-2 text-text-secondary hover:bg-surface-3'}`}>{o.l}</button>
                  ))}
                </div>
              </Field>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-white/[0.06] flex gap-3 bg-surface-1/30">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-surface-2 text-white text-sm font-bold hover:bg-surface-3 transition-all">Cancel</button>
          <button onClick={onSave} disabled={saving} className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${saving ? 'bg-surface-2 text-text-muted' : 'bg-brand-cyan text-bg-dark hover:brightness-110'}`}>
            {saving ? 'Saving…' : editingAd ? 'Update' : 'Launch campaign'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-bold uppercase tracking-wider text-text-muted mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function MultiChip({ label, options, selected, onToggle }) {
  return (
    <div>
      <span className="block text-[11px] font-bold uppercase tracking-wider text-text-muted mb-1.5">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map(o => (
          <button key={o.v} onClick={() => onToggle(o.v)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-all ${selected.includes(o.v) ? 'bg-brand-cyan text-bg-dark' : 'bg-surface-2 text-text-secondary hover:bg-surface-3'}`}>{o.l}</button>
        ))}
      </div>
    </div>
  );
}
