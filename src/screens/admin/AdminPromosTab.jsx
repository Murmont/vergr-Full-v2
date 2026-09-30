// Coin sale promos: "buy a pack, get extra coins or extra VP".
//
// The rule the whole feature rests on, stated on the screen because whoever
// uses it needs to know it: a promo changes the QUANTITY DELIVERED, never the
// PRICE CHARGED. Nothing in checkout, tax or settlement moves.
//
// The cost of a promo is shown BEFORE it is switched on, and the cap is a
// required field for a coin promo. Since 2026-09-27 promo bonus coins are BOOST
// coins (boosts and VP packs only, never tips), so they cost Vergr no revenue
// share; the cap still bounds how many are handed out.

import { useState, useEffect, useCallback } from 'react';
import { useUI } from '../../context/UIContext';
import { ADMIN_COLORS as C } from './AdminShell';
import { call, fmtNumber, fmtRelative, useGuardedCall } from './_adminGuarded';
import { Toggle, PillToggle } from './channelControls';
import { COIN_PACKS } from '../../utils/vpSystem';

const KINDS = [
  {
    id: 'coins_pct', label: 'Extra boost coins, as a percentage', unit: '%',
    desc: 'Buy any pack, get this much on top as boost coins. 20% on a 815-coin pack is 163 boost coins.',
  },
  {
    id: 'coins_flat', label: 'Extra boost coins, a fixed number', unit: 'boost coins',
    desc: 'The same number of boost coins on every qualifying purchase.',
  },
  {
    id: 'vp_pct', label: 'Extra VP, as a percentage', unit: '%',
    desc: 'VP costs nothing and cannot leave the platform, so this is the risk-free option.',
  },
  {
    id: 'vp_flat', label: 'Extra VP, a fixed number', unit: 'VP',
    desc: 'The same VP bonus on every qualifying purchase.',
  },
];

export default function AdminPromosTab() {
  const { showToast } = useUI();
  const { guarded, overlay } = useGuardedCall();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call('adminListCoinPromos', {});
      setRows(r.rows || []);
    } catch (e) { showToast(e?.message || 'Could not load promos', 'error'); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = async (r) => {
    try {
      await guarded(() => call('adminSetCoinPromoActive', { promoId: r.promoId, active: !r.active }));
      load();
    } catch { /* guarded surfaces it */ }
  };

  if (editing) {
    return (
      <>
        <PromoEditor draft={editing} guarded={guarded}
          onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
        {overlay}
      </>
    );
  }

  return (
    <>
      <div style={{
        padding: 12, marginBottom: 14, borderRadius: 8, fontSize: 11.5, lineHeight: 1.6,
        background: 'rgba(61,127,255,0.08)', border: '1px solid rgba(61,127,255,0.25)', color: '#9dc0ff',
      }}>
        A promo gives people <b>more coins or VP for the same money</b>. The price never
        changes, so nothing about checkout, cards, Google Play or tax is affected. Only
        the amount delivered moves.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14, gap: 10 }}>
        <div style={{ flex: 1 }} />
        <button onClick={() => setEditing({ isNew: true })}
          style={{ ...btn(C.accent), padding: '9px 16px', fontSize: 13 }}>New promo</button>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        {loading && <div style={{ padding: 20, fontSize: 12, color: C.textDim }}>Loading…</div>}
        {!loading && rows.length === 0 && (
          <div style={{ padding: 26, fontSize: 12.5, color: C.textDim, textAlign: 'center', lineHeight: 1.7 }}>
            No promos yet.
            <div style={{ marginTop: 4 }}>Create one to run a coin sale without touching prices.</div>
          </div>
        )}
        {rows.map((r) => {
          const kind = KINDS.find((k) => k.id === r.bonus?.kind);
          const isCoins = String(r.bonus?.kind || '').startsWith('coins_');
          return (
            <div key={r.promoId} style={{ padding: '14px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>{r.name}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em',
                    padding: '2px 7px', borderRadius: 999,
                    background: r.live ? '#22C55E22' : (r.active ? '#F0A50022' : `${C.border}`),
                    color: r.live ? '#22C55E' : (r.active ? '#F5C842' : C.textDim),
                  }}>
                    {r.live ? 'Live' : (r.active ? 'On, outside its dates' : 'Off')}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: C.textDim, marginBottom: 6 }}>
                  +{r.bonus?.value}{kind?.unit === '%' ? '%' : ` ${kind?.unit || ''}`}
                  {' · '}
                  {r.appliesTo === 'all' ? 'every pack' : `${r.appliesTo.length} pack(s)`}
                  {r.bonus?.minSpendUSD ? ` · $${r.bonus.minSpendUSD}+` : ''}
                  {r.endsAt ? ` · ends ${fmtRelative(r.endsAt)}` : ''}
                </div>
                <div style={{ display: 'flex', gap: 16, fontSize: 11, color: C.textDim }}>
                  <span><b style={{ color: C.text }}>{fmtNumber(r.redemptions)}</b> used</span>
                  {isCoins && <span><b style={{ color: C.text }}>{fmtNumber(r.bonusCoinsIssued)}</b> bonus coins given</span>}
                  {!isCoins && <span><b style={{ color: C.text }}>{fmtNumber(r.bonusVpIssued)}</b> bonus VP given</span>}
                </div>
                {r.capUsedPct != null && (
                  <div style={{ marginTop: 7, maxWidth: 320 }}>
                    <div style={{ height: 5, borderRadius: 3, background: '#0a0a14', overflow: 'hidden' }}>
                      <div style={{
                        width: `${r.capUsedPct}%`, height: '100%',
                        background: r.capUsedPct >= 90 ? '#F04060' : (r.capUsedPct >= 70 ? '#F0A500' : '#22C55E'),
                      }} />
                    </div>
                    <div style={{ fontSize: 10.5, color: C.textDim, marginTop: 4 }}>
                      {r.capUsedPct}% of the {fmtNumber(r.totalBonusCoinsCap)} coin cap used
                      {r.capUsedPct >= 100 ? ' · the promo has stopped giving bonuses' : ''}
                    </div>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button onClick={() => setEditing({ ...r, isNew: false })} style={btn(C.border)}>Edit</button>
                <button onClick={() => toggle(r)} style={btn(r.active ? '#f04060' : '#22C55E')}>
                  {r.active ? 'Switch off' : 'Switch on'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {overlay}
    </>
  );
}

function PromoEditor({ draft, onCancel, onSaved, guarded }) {
  const { showToast } = useUI();
  const [d, setD] = useState(() => ({
    promoId: draft.promoId || null,
    name: draft.name || '',
    bonusKind: draft.bonus?.kind || 'coins_pct',
    bonusValue: draft.bonus?.value || 20,
    minSpendUSD: draft.bonus?.minSpendUSD || '',
    allPacks: draft.appliesTo === 'all' || draft.isNew,
    packIds: Array.isArray(draft.appliesTo) ? draft.appliesTo : [],
    includeCustomAmounts: false,
    totalBonusCoinsCap: draft.totalBonusCoinsCap || 100000,
    perUserLimit: draft.perUserLimit || '',
    endsAt: '',
    active: draft.active === true,
    isNew: draft.isNew,
  }));
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setD((p) => ({ ...p, [k]: v }));
  const kind = KINDS.find((k) => k.id === d.bonusKind);
  const isCoins = d.bonusKind.startsWith('coins_');

  // What this costs, computed from the real ladder rather than a guess, so the
  // giveaway is a number seen before it is switched on.
  const projection = (() => {
    const packs = COIN_PACKS.filter((p) => d.allPacks || d.packIds.includes(p.id));
    if (!packs.length) return null;
    const per = packs.map((p) => {
      if (d.bonusKind === 'coins_pct') return Math.floor(p.coins * d.bonusValue / 100);
      if (d.bonusKind === 'coins_flat') return Math.floor(d.bonusValue);
      if (d.bonusKind === 'vp_pct') return Math.floor(p.coins * d.bonusValue / 100);
      return Math.floor(d.bonusValue);
    });
    const avg = Math.round(per.reduce((a, b) => a + b, 0) / per.length);
    return { avg, min: Math.min(...per), max: Math.max(...per) };
  })();

  const save = async () => {
    setBusy(true);
    try {
      await guarded(() => call('adminUpsertCoinPromo', {
        promoId: d.promoId,
        name: d.name,
        bonusKind: d.bonusKind,
        bonusValue: Number(d.bonusValue),
        minSpendUSD: d.minSpendUSD ? Number(d.minSpendUSD) : null,
        appliesTo: d.allPacks ? 'all' : 'packs',
        packIds: d.packIds,
        includeCustomAmounts: d.includeCustomAmounts,
        endsAt: d.endsAt ? new Date(d.endsAt).getTime() : null,
        perUserLimit: d.perUserLimit ? Number(d.perUserLimit) : null,
        totalBonusCoinsCap: isCoins ? Number(d.totalBonusCoinsCap) : null,
        active: d.active,
      }));
      showToast('Saved', 'success');
      onSaved();
    } catch { /* guarded surfaces it */ }
    setBusy(false);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,320px)', gap: 16, alignItems: 'start' }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
        <h3 style={{ margin: 0, marginBottom: 14, fontSize: 14, fontWeight: 700, color: C.text }}>
          {d.isNew ? 'New promo' : `Edit ${d.name}`}
        </h3>

        <L>Name</L>
        <input value={d.name} onChange={(e) => set('name', e.target.value)}
          placeholder="Weekend coin sale" style={{ ...input, marginBottom: 0 }} />
        <H>Only you see this.</H>

        <L>What they get</L>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {KINDS.map((k) => {
            const on = d.bonusKind === k.id;
            return (
              <button key={k.id} onClick={() => set('bonusKind', k.id)}
                style={{
                  textAlign: 'left', padding: 11, borderRadius: 8, cursor: 'pointer',
                  background: on ? `${C.accent}15` : '#0a0a14',
                  border: `1px solid ${on ? C.accent : C.border}`, color: C.text,
                }}>
                <div style={{ fontSize: 12.5, fontWeight: 700 }}>{k.label}</div>
                <div style={{ fontSize: 11, color: C.textDim, marginTop: 3, lineHeight: 1.5 }}>{k.desc}</div>
              </button>
            );
          })}
        </div>

        <L>How much</L>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 0 }}>
          <input type="number" min="1" value={d.bonusValue}
            onChange={(e) => set('bonusValue', e.target.value)}
            style={{ ...input, marginBottom: 0, width: 120 }} />
          <span style={{ fontSize: 13, color: C.textDim }}>{kind?.unit}</span>
        </div>
        <H>&nbsp;</H>

        <L>Minimum spend (optional)</L>
        <input type="number" min="0" step="0.01" value={d.minSpendUSD}
          onChange={(e) => set('minSpendUSD', e.target.value)}
          placeholder="20" style={{ ...input, marginBottom: 0 }} />
        <H>In dollars. Leave empty to apply to every pack size.</H>

        <Toggle label="Every coin pack" hint="Turn this off to pick specific packs below."
          checked={d.allPacks} onChange={(v) => set('allPacks', v)} />
        {!d.allPacks && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0 12px' }}>
            {COIN_PACKS.map((p) => (
              <PillToggle key={p.id} label={p.name || p.id} checked={d.packIds.includes(p.id)}
                onChange={(v) => set('packIds', v ? [...d.packIds, p.id] : d.packIds.filter((x) => x !== p.id))} />
            ))}
          </div>
        )}

        {isCoins && (
          <>
            <L>Total bonus coin cap</L>
            <input type="number" min="1" value={d.totalBonusCoinsCap}
              onChange={(e) => set('totalBonusCoinsCap', e.target.value)}
              style={{ ...input, marginBottom: 0 }} />
            <H>
              The promo stops giving bonuses once it has handed out this many coins,
              whatever the dates say. Required. Bonus coins arrive as boost coins: they
              buy boosts and VP packs and can never be tipped, so they create nothing
              owed to a creator.
            </H>
          </>
        )}

        <L>Limit per person (optional)</L>
        <input type="number" min="1" value={d.perUserLimit}
          onChange={(e) => set('perUserLimit', e.target.value)}
          placeholder="1" style={{ ...input, marginBottom: 0 }} />
        <H>How many times one account can get the bonus. Empty means no limit.</H>

        <L>End date (optional)</L>
        <input type="datetime-local" value={d.endsAt} onChange={(e) => set('endsAt', e.target.value)}
          style={{ ...input, marginBottom: 0 }} />
        <H>Leave empty to run until you switch it off.</H>

        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 4, marginTop: 8 }}>
          <Toggle label="Switch on now"
            hint="A promo only applies while this is on and the dates allow it. Only one promo is ever active at a time; if two overlap, the bigger one wins."
            checked={d.active} onChange={(v) => set('active', v)} />
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={onCancel} style={{ ...btn(C.border), padding: '10px 16px' }}>Cancel</button>
          <button onClick={save} disabled={busy || !d.name}
            style={{ ...btn(C.accent), padding: '10px 16px', opacity: !d.name ? 0.5 : 1 }}>
            {busy ? 'Saving…' : 'Save promo'}
          </button>
        </div>
      </div>

      <div style={{ position: 'sticky', top: 16, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          What this costs
        </div>
        <div style={{ padding: 16 }}>
          {!projection && <div style={{ fontSize: 12, color: C.textDim }}>Pick at least one pack.</div>}
          {projection && (
            <>
              <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.7, marginBottom: 12 }}>
                Per purchase, you give away between{' '}
                <b style={{ color: C.text }}>{fmtNumber(projection.min)}</b> and{' '}
                <b style={{ color: C.text }}>{fmtNumber(projection.max)}</b>{' '}
                {isCoins ? 'boost coins' : 'VP'}, averaging{' '}
                <b style={{ color: C.text }}>{fmtNumber(projection.avg)}</b>.
              </div>
              {isCoins && Number(d.totalBonusCoinsCap) > 0 && (
                <div style={{
                  padding: 11, borderRadius: 8, background: '#0a0a14',
                  border: `1px solid ${C.border}`, fontSize: 12, color: C.textDim, lineHeight: 1.7,
                }}>
                  Your cap of <b style={{ color: C.text }}>{fmtNumber(Number(d.totalBonusCoinsCap))}</b> coins
                  covers roughly{' '}
                  <b style={{ color: C.text }}>
                    {fmtNumber(Math.floor(Number(d.totalBonusCoinsCap) / Math.max(1, projection.avg)))}
                  </b>{' '}
                  purchases.
                  <div style={{ marginTop: 8, color: '#22C55E' }}>
                    Boost coins buy boosts and VP packs and can never be tipped, so this
                    creates nothing owed to creators.
                  </div>
                </div>
              )}
              {!isCoins && (
                <div style={{ fontSize: 11.5, color: '#22C55E', lineHeight: 1.6 }}>
                  VP has no way out of the platform, so a VP promo costs nothing real.
                </div>
              )}
            </>
          )}
        </div>
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
