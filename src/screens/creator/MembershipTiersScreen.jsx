import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import BadgeGem, { BADGE_GLYPHS, BADGE_COLORS } from '../../components/membership/BadgeGem';
import VergrPicker from '../../components/vergrme/VergrPicker';
import { getMembershipTiers, saveMembershipTiers, getMembershipStats, getFans, getOwnedGroupChats } from '../../firebase/firestore';
import { COIN_PACKS } from '../../utils/vpSystem';
import UserName from '../../components/UserName';

const MAX_TIERS = 5;
const SUGGESTED_PERKS = [
  'Subscriber badge in chat & profile', 'Exclusive posts & behind-the-scenes', 'Priority chat',
  'Members-only stream', 'Custom emotes', 'Monthly shoutout on stream', 'Discord access', 'Merch discount',
];
const COMMUNITY_TYPES = [
  { type: 'vergr_group', label: 'Private VERGR group', icon: 'groups', hint: 'Native space, no external app', accent: '#B44FFF' },
  { type: 'discord', label: 'Discord server', icon: 'forum', hint: 'discord.gg/...', accent: '#8b95f6' },
  { type: 'telegram', label: 'Telegram channel', icon: 'send', hint: 't.me/...', accent: '#5aa9e6' },
  { type: 'custom', label: 'Custom link', icon: 'link', hint: 'https://...', accent: '#9CA3AF' },
];

const mkId = () => `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const DEFAULT_TIERS = [
  { id: mkId(), name: 'Supporter', priceCoins: 100, perks: ['Subscriber badge in chat & profile', 'Exclusive posts & behind-the-scenes', 'Priority chat'], badge: { color: '#7B1FFF', icon: 'favorite' }, seatLimit: null, communities: [], published: true, popular: false, order: 0 },
  { id: mkId(), name: 'VIP', priceCoins: 500, perks: ['Everything in Supporter', 'Custom emotes (5 slots)', 'Monthly shoutout on stream', 'Discord members channel'], badge: { color: '#C87FFF', icon: 'star' }, seatLimit: null, communities: [], published: true, popular: true, order: 1 },
  { id: mkId(), name: 'Legend', priceCoins: 1000, perks: ['Everything in VIP', 'Co-stream invites', 'Private Discord channel', 'Merch discounts'], badge: { color: '#F0A500', icon: 'workspace_premium' }, seatLimit: null, communities: [], published: false, popular: false, order: 2 },
];

// Coins are natively USD (re-denominated 2026-08-11). This used a hardcoded
// EUR_PER_COIN = 0.0099, which was the PRE-redenomination anchor, so a 100-coin
// tier displayed "≈ €0.99" when it is worth about $1.27: wrong currency symbol
// AND ~28% low (audit A28). The rate now comes from the Starter pack in
// COIN_PACKS, the single source the checkout itself prices from, so the two
// cannot drift apart again.
const STARTER = COIN_PACKS[0];
const USD_PER_COIN = STARTER ? STARTER.priceUSD / STARTER.coins : 0.0127;
const fmtEur = (coins) => {
  const usd = (coins || 0) * USD_PER_COIN;
  if (usd >= 100) return `$${Math.round(usd).toLocaleString()}`;
  return `$${usd.toFixed(2)}`;
};
const compact = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`);

export default function MembershipTiersScreen({ embedded = false }) {
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();
  const { currentUser } = useAuth();
  const { showToast } = useUI();

  const [tiers, setTiers] = useState(null); // null = loading
  const [seasonPass, setSeasonPass] = useState({ enabled: false, name: 'Season Pass', priceCoins: 1500, durationDays: 90 });
  const [stats, setStats] = useState({ activeMembers: 0, monthlyGross: 0 });
  const [fans, setFans] = useState([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (embedded) return;
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop, embedded]);

  useEffect(() => {
    if (!currentUser?.uid) return;
    let alive = true;
    (async () => {
      const [{ tiers: t, seasonPass: sp }, st, fn] = await Promise.all([
        getMembershipTiers(currentUser.uid, { forOwner: true }),
        getMembershipStats(currentUser.uid),
        getFans(currentUser.uid, 6),
      ]);
      if (!alive) return;
      setTiers(t.length ? t : DEFAULT_TIERS.map((x) => ({ ...x, id: mkId() })));
      if (sp) setSeasonPass({ enabled: !!sp.enabled, name: sp.name || 'Season Pass', priceCoins: sp.priceCoins || 1500, durationDays: sp.durationDays || 90 });
      setStats(st); setFans(fn);
    })();
    return () => { alive = false; };
  }, [currentUser]);

  const mutate = useCallback((fn) => { setTiers((prev) => { const next = fn(prev.map((t) => ({ ...t }))); return next; }); setDirty(true); }, []);
  const updateTier = (i, patch) => mutate((t) => { t[i] = { ...t[i], ...patch }; return t; });
  const removeTier = (i) => mutate((t) => t.filter((_, j) => j !== i).map((x, k) => ({ ...x, order: k })));
  const moveTier = (i, dir) => mutate((t) => {
    const j = i + dir; if (j < 0 || j >= t.length) return t;
    [t[i], t[j]] = [t[j], t[i]]; return t.map((x, k) => ({ ...x, order: k }));
  });
  const addTier = () => mutate((t) => t.length >= MAX_TIERS ? t : [...t, { id: mkId(), name: 'New tier', priceCoins: 250, perks: ['Subscriber badge in chat & profile'], badge: { color: BADGE_COLORS[t.length % BADGE_COLORS.length], icon: 'star' }, seatLimit: null, communities: [], published: false, popular: false, order: t.length }]);
  const setPopular = (i) => mutate((t) => t.map((x, k) => ({ ...x, popular: k === i ? !x.popular : false })));

  const handleSave = async () => {
    if (!tiers) return;
    setSaving(true);
    try {
      const clean = tiers.map((t, k) => ({
        id: t.id || mkId(), name: (t.name || 'Tier').slice(0, 40),
        priceCoins: Math.max(0, Math.min(10000, parseInt(t.priceCoins) || 0)),
        perks: (t.perks || []).map((p) => String(p).slice(0, 120)).filter(Boolean).slice(0, 12),
        badge: { color: t.badge?.color || '#7B1FFF', icon: t.badge?.icon || 'star' },
        seatLimit: t.seatLimit ? Math.max(1, parseInt(t.seatLimit) || 0) : null,
        communities: (t.communities || []).filter((c) => c.url || c.groupId).slice(0, 6),
        published: t.published !== false, popular: !!t.popular, order: k,
      }));
      const sp = {
        enabled: !!seasonPass.enabled, name: (seasonPass.name || 'Season Pass').slice(0, 40),
        priceCoins: Math.max(0, parseInt(seasonPass.priceCoins) || 0),
        durationDays: Math.max(1, Math.min(365, parseInt(seasonPass.durationDays) || 30)),
      };
      await saveMembershipTiers(currentUser.uid, clean, sp);
      setTiers(clean); setDirty(false);
      showToast('Membership tiers saved', 'success');
    } catch (err) { console.error(err); showToast('Failed to save', 'error'); }
    setSaving(false);
  };

  if (!tiers) {
    return <div className="flex items-center justify-center py-24 text-text-muted"><Icon name="progress_activity" className="animate-spin" /></div>;
  }

  const StatTile = ({ label, value, sub, gold }) => (
    <div className="bg-surface-1 border border-white/[0.06] rounded-2xl p-5">
      <div className="text-[12px] text-text-secondary uppercase tracking-wider mb-2.5">{label}</div>
      <div className="flex items-baseline gap-2">
        {gold && <span className="text-brand-gold text-xl">●</span>}
        <span className={`font-dmmono font-medium text-[30px] tabular-nums ${gold ? 'text-brand-gold' : 'text-white'}`}>{value}</span>
      </div>
      {sub && <div className="text-xs text-text-muted mt-1 font-dmmono">{sub}</div>}
    </div>
  );

  const body = (
    <div className="max-w-[1100px] mx-auto">
      {/* intro */}
      <div className="flex items-end justify-between gap-4 mb-6 flex-wrap">
        <p className="text-sm text-text-secondary max-w-lg">Fans pay monthly in coins for perks you choose. <span className="text-white font-semibold">You keep 50% to 80%, rising with your lifetime earnings.</span></p>
        <div className="flex gap-2.5">
          <button onClick={handleSave} disabled={saving || !dirty}
            className="h-10 px-4 rounded-xl bg-gradient-to-r from-brand-violet to-brand-pink text-white font-bold text-sm flex items-center gap-2 disabled:opacity-50 hover:brightness-110 transition">
            <Icon name={saving ? 'progress_activity' : 'check'} size={16} className={saving ? 'animate-spin' : ''} />{saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
          </button>
        </div>
      </div>

      {/* stat strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-9">
        <StatTile label="Active members" value={stats.activeMembers.toLocaleString()} />
        <StatTile label="Monthly recurring" value={compact(stats.monthlyGross)} sub={`≈ ${fmtEur(stats.monthlyGross)} / mo gross`} gold />
        <StatTile label="Monthly gross" value={compact(stats.monthlyGross)} sub={`≈ ${fmtEur(stats.monthlyGross)} / mo before your share`} gold />
      </div>

      {/* tiers header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-syne font-bold text-[17px] text-white">Monthly tiers</h3>
        <span className="text-xs text-text-muted font-dmmono">{tiers.length} / {MAX_TIERS} tiers</span>
      </div>

      <div className="space-y-4">
        {tiers.map((tier, i) => (
          <TierCard key={tier.id} tier={tier} index={i} count={tiers.length} isDesktop={isDesktop} uid={currentUser?.uid}
            onChange={(patch) => updateTier(i, patch)} onRemove={() => removeTier(i)}
            onMove={(d) => moveTier(i, d)} onPopular={() => setPopular(i)} />
        ))}
      </div>

      {tiers.length < MAX_TIERS && (
        <button onClick={addTier}
          className="w-full mt-4 py-4 rounded-2xl border border-dashed border-white/15 text-text-secondary hover:text-white hover:border-brand-violet/50 transition flex items-center justify-center gap-2 font-semibold text-sm">
          <Icon name="add" size={18} />Add tier
        </button>
      )}

      {/* season pass */}
      <div className="mt-7 p-5 rounded-2xl bg-gradient-to-br from-brand-gold/10 to-brand-violet/5 border border-brand-gold/25">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2"><Icon name="confirmation_number" size={18} className="text-brand-gold" /><h3 className="font-bold text-base text-white">Season Pass</h3></div>
          <Toggle on={seasonPass.enabled} gold onClick={() => { setSeasonPass((s) => ({ ...s, enabled: !s.enabled })); setDirty(true); }} />
        </div>
        <p className="text-text-muted text-xs mb-3">Sell one pass that lets fans watch all your ticketed events for a set period.</p>
        {seasonPass.enabled && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Pass name"><input value={seasonPass.name} onChange={(e) => { setSeasonPass((s) => ({ ...s, name: e.target.value })); setDirty(true); }} className="vm-inp" /></Field>
            <Field label="Price (coins)"><input type="number" min="0" value={seasonPass.priceCoins} onChange={(e) => { setSeasonPass((s) => ({ ...s, priceCoins: e.target.value })); setDirty(true); }} className="vm-inp font-dmmono text-brand-gold" /></Field>
            <Field label="Valid for (days)"><input type="number" min="1" max="365" value={seasonPass.durationDays} onChange={(e) => { setSeasonPass((s) => ({ ...s, durationDays: e.target.value })); setDirty(true); }} className="vm-inp font-dmmono" /></Field>
          </div>
        )}
      </div>

      {/* recent members */}
      <div className="mt-7">
        <div className="flex items-center justify-between mb-3"><h3 className="font-syne font-bold text-[15px] text-white">Recent members</h3></div>
        {fans.length === 0 ? (
          <div className="bg-surface-1 border border-white/[0.06] rounded-2xl p-8 text-center">
            <Icon name="diversity_3" size={28} className="text-text-muted" />
            <p className="text-text-secondary text-sm mt-2">No members yet. Publish a tier and share your profile to get your first supporter.</p>
          </div>
        ) : (
          <div className="bg-surface-1 border border-white/[0.06] rounded-2xl divide-y divide-white/[0.04]">
            {fans.map((f) => (
              <div key={f.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-violet to-brand-pink shrink-0 overflow-hidden">{f.avatar && <img src={f.avatar} alt="" className="w-full h-full object-cover" />}</div>
                <div className="flex-1 min-w-0"><div className="text-sm text-white font-semibold truncate"><UserName user={f} masked /></div><div className="text-xs text-text-muted"><UserName user={f} masked handle /></div></div>
                {f._fanTier && <span className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-brand-violet/15 text-brand-pink">{f._fanTier}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-center text-xs text-text-muted mt-8">Your <span className="text-text-secondary">revenue share</span> starts at 50% and rises to 80% as your lifetime earnings grow. Vergr pays it on a schedule.</p>

      <style>{`.vm-inp{width:100%;padding:8px 12px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:#fff;font-size:13px;outline:none}.vm-inp:focus{border-color:rgba(180,79,255,0.5)}`}</style>
    </div>
  );

  if (embedded) return body;
  return (
    <div className={isDesktop ? 'min-h-screen pb-8' : 'screen-container min-h-screen pb-8'}>
      <TopBar title="Membership Tiers" showBack actions={<button onClick={handleSave} disabled={saving || !dirty} className="text-brand-pink font-semibold text-sm disabled:opacity-50">{saving ? '...' : 'Save'}</button>} />
      <div className="px-4 py-4">{body}</div>
    </div>
  );
}

// ── Tier card ────────────────────────────────────────────────────────────────
function TierCard({ tier, index, count, isDesktop, uid, onChange, onRemove, onMove, onPopular }) {
  const [pickBadge, setPickBadge] = useState(false);
  const [addComm, setAddComm] = useState(false);
  const [groupPicker, setGroupPicker] = useState(false);
  const published = tier.published !== false;
  const setPerk = (j, v) => onChange({ perks: tier.perks.map((p, k) => (k === j ? v : p)) });
  const addPerk = (v = '') => onChange({ perks: [...(tier.perks || []), v] });
  const rmPerk = (j) => onChange({ perks: tier.perks.filter((_, k) => k !== j) });
  const usedPerks = new Set(tier.perks || []);

  const left = (
    <div className={isDesktop ? 'flex-none w-[300px]' : ''}>
      <div className="flex items-center gap-2.5 mb-3.5">
        <div className="flex flex-col -my-1">
          <button onClick={() => onMove(-1)} disabled={index === 0} className="text-text-muted disabled:opacity-25 hover:text-white leading-none"><Icon name="keyboard_arrow_up" size={18} /></button>
          <button onClick={() => onMove(1)} disabled={index === count - 1} className="text-text-muted disabled:opacity-25 hover:text-white leading-none"><Icon name="keyboard_arrow_down" size={18} /></button>
        </div>
        <span className={`text-[10px] font-bold tracking-wide px-2 py-0.5 rounded ${published ? 'bg-emerald-400/12 text-emerald-400' : 'bg-white/8 text-text-secondary'}`}>{published ? 'PUBLISHED' : 'DRAFT'}</span>
        <button onClick={onPopular} className={`text-[10px] font-bold tracking-wide px-2 py-0.5 rounded ${tier.popular ? 'bg-gradient-to-r from-brand-violet to-brand-pink text-white' : 'bg-white/5 text-text-muted hover:text-white'}`}>★ POPULAR</button>
      </div>
      <input value={tier.name} onChange={(e) => onChange({ name: e.target.value })}
        className="font-syne font-extrabold text-2xl bg-transparent outline-none border-b border-dashed border-white/12 focus:border-brand-pink/50 w-full pb-1.5 text-white" />
      <div className="flex items-baseline gap-1.5 mt-3.5">
        <span className="text-brand-gold text-xl">●</span>
        <input type="number" min="0" max="10000" value={tier.priceCoins} onChange={(e) => onChange({ priceCoins: parseInt(e.target.value) || 0 })}
          className="w-20 font-dmmono font-medium text-[28px] text-brand-gold bg-transparent outline-none border-b border-dashed border-brand-gold/25" />
        <span className="text-text-secondary text-[15px] font-dmmono">/mo</span>
      </div>
      <div className="text-xs text-text-muted mt-1 font-dmmono">≈ {fmtEur(tier.priceCoins)} / month</div>

      {/* badge */}
      <div className="mt-4">
        <div className="text-[11px] text-text-muted uppercase tracking-wide mb-2.5">Badge fans wear</div>
        <div className="flex items-center gap-3">
          <button onClick={() => setPickBadge((v) => !v)} className="relative"><BadgeGem color={tier.badge?.color} icon={tier.badge?.icon} size={44} /></button>
          <div className="flex gap-1.5 flex-wrap">
            {BADGE_COLORS.map((c) => (
              <button key={c} onClick={() => onChange({ badge: { ...tier.badge, color: c } })}
                className="w-5 h-5 rounded-full transition" style={{ background: c, boxShadow: tier.badge?.color === c ? `0 0 0 2px #14141F,0 0 0 4px ${c}` : 'none' }} />
            ))}
          </div>
        </div>
        {pickBadge && (
          <div className="mt-3 flex gap-2 flex-wrap p-2 rounded-xl bg-surface-2 border border-white/8">
            {BADGE_GLYPHS.map((g) => (
              <button key={g} onClick={() => { onChange({ badge: { ...tier.badge, icon: g } }); }}
                className={`w-9 h-9 rounded-lg flex items-center justify-center ${tier.badge?.icon === g ? 'bg-brand-violet/25 text-white' : 'text-text-secondary hover:text-white'}`}><Icon name={g} filled size={20} /></button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const right = (
    <div className={isDesktop ? 'flex-1 min-w-0 border-l border-white/[0.06] pl-7' : 'mt-5'}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] text-text-muted uppercase tracking-wide">Perks</div>
        <button onClick={onRemove} className="text-text-muted hover:text-brand-ember"><Icon name="delete" size={17} /></button>
      </div>
      {/* suggested chips */}
      <div className="flex flex-wrap gap-2 mb-3.5">
        {SUGGESTED_PERKS.filter((p) => !usedPerks.has(p)).slice(0, 5).map((p) => (
          <button key={p} onClick={() => addPerk(p)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-white/10 bg-white/[0.03] text-text-secondary text-xs hover:text-white hover:border-brand-violet/40">
            <Icon name="add" size={11} />{p}
          </button>
        ))}
      </div>
      <div className="border-t border-white/[0.05]">
        {(tier.perks || []).map((perk, j) => (
          <div key={j} className="flex items-center gap-2.5 py-2 border-b border-white/[0.04]">
            <Icon name="check_circle" filled size={18} className="shrink-0" style={{ color: '#B44FFF' }} />
            <input value={perk} onChange={(e) => setPerk(j, e.target.value)} className="flex-1 bg-transparent outline-none text-sm text-text-primary" />
            <button onClick={() => rmPerk(j)} className="text-text-muted hover:text-brand-ember"><Icon name="close" size={15} /></button>
          </div>
        ))}
        <button onClick={() => addPerk('')} className="flex items-center gap-2.5 py-2.5 text-text-muted hover:text-white"><Icon name="add_circle" size={18} /><span className="text-sm">Add perk</span></button>
      </div>

      {/* footer: published toggle + seats + communities */}
      <div className="flex items-center gap-5 mt-3.5 pt-4 border-t border-white/[0.06] flex-wrap">
        <div className="flex items-center gap-2.5"><Toggle on={published} onClick={() => onChange({ published: !published })} /><span className="text-[13px] text-white font-semibold">{published ? 'Published' : 'Draft'}</span></div>
        <div className="flex items-center gap-2.5"><span className="text-xs text-text-secondary">Limit seats</span><input value={tier.seatLimit || ''} onChange={(e) => onChange({ seatLimit: e.target.value })} placeholder="∞" className="w-[70px] px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/10 text-white font-dmmono text-[13px] outline-none" /></div>
      </div>

      {/* communities */}
      <div className="mt-3.5">
        <div className="text-[11px] text-text-muted uppercase tracking-wide mb-2">Community access <span className="normal-case text-text-muted/70">(members auto-join)</span></div>
        <div className="flex flex-wrap gap-2 items-center">
          {(tier.communities || []).map((c, j) => {
            const meta = COMMUNITY_TYPES.find((m) => m.type === c.type) || COMMUNITY_TYPES[3];
            const rm = () => onChange({ communities: tier.communities.filter((_, k) => k !== j) });
            // VERGR group = picked, auto-invite (static chip). Others = paste a URL.
            if (c.type === 'vergr_group') {
              return (
                <span key={j} className="inline-flex items-center gap-2 pl-2.5 pr-1.5 py-1.5 rounded-lg border bg-white/[0.03]" style={{ borderColor: `${meta.accent}55` }}>
                  <Icon name={meta.icon} size={13} style={{ color: meta.accent }} />
                  <span className="text-xs text-text-secondary max-w-[160px] truncate">{c.label || 'Group'}</span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${meta.accent}22`, color: meta.accent }}>AUTO</span>
                  <button onClick={rm} className="text-text-muted hover:text-brand-ember"><Icon name="close" size={12} /></button>
                </span>
              );
            }
            return (
              <span key={j} className="inline-flex items-center gap-2 pl-2.5 pr-1.5 py-1.5 rounded-lg border bg-white/[0.03]" style={{ borderColor: `${meta.accent}55` }}>
                <Icon name={meta.icon} size={13} style={{ color: meta.accent }} />
                <input value={c.url} onChange={(e) => onChange({ communities: tier.communities.map((x, k) => (k === j ? { ...x, url: e.target.value } : x)) })} placeholder={meta.hint} className="bg-transparent outline-none text-xs text-text-secondary w-36" />
                <button onClick={rm} className="text-text-muted hover:text-brand-ember"><Icon name="close" size={12} /></button>
              </span>
            );
          })}
          <div className="relative">
            <button onClick={() => setAddComm((v) => !v)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dashed border-white/18 text-text-secondary text-xs hover:text-white"><Icon name="add" size={12} />Add</button>
            {addComm && (
              <div className="absolute z-10 mt-2 w-56 bg-surface-2 border border-white/10 rounded-xl p-1.5 shadow-xl">
                {COMMUNITY_TYPES.map((m) => (
                  <button key={m.type} onClick={() => { setAddComm(false); if (m.type === 'vergr_group') setGroupPicker(true); else onChange({ communities: [...(tier.communities || []), { type: m.type, label: m.label, url: '' }] }); }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-white/5 text-left">
                    <Icon name={m.icon} size={16} style={{ color: m.accent }} /><span className="flex-1 text-[13px] text-text-primary">{m.label}</span>
                    {m.type === 'vergr_group' && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-brand-violet/20 text-brand-violet-light">AUTO</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <VergrPicker open={groupPicker} title="Choose a group to auto-invite members"
        emptyText="You don't own any group chats yet. Create one in Messages first."
        load={() => getOwnedGroupChats(uid)}
        onSelect={(g) => { onChange({ communities: [...(tier.communities || []), { type: 'vergr_group', label: g.name, groupId: g.id }] }); setGroupPicker(false); }}
        onClose={() => setGroupPicker(false)} />
    </div>
  );

  return (
    <div className={`rounded-2xl p-5 sm:p-6 ${tier.popular ? 'bg-surface-2 border border-brand-violet/25' : 'bg-surface-1 border border-white/[0.06]'} ${published ? '' : 'opacity-70'} ${isDesktop ? 'flex gap-7' : ''}`}>
      {left}{right}
    </div>
  );
}

// ── small UI ─────────────────────────────────────────────────────────────────
function Toggle({ on, gold, onClick }) {
  return (
    <button onClick={onClick} className={`w-10 h-[22px] rounded-full relative transition ${on ? (gold ? 'bg-brand-gold' : 'bg-gradient-to-r from-brand-violet to-brand-pink') : 'bg-white/10'}`}>
      <span className={`absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white transition-all ${on ? 'right-0.5' : 'left-0.5'}`} />
    </button>
  );
}
function Field({ label, children }) {
  return <label className="block"><span className="text-text-muted text-[10px] uppercase tracking-wider">{label}</span><div className="mt-1">{children}</div></label>;
}
