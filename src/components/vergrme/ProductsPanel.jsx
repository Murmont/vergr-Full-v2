import { useState, useEffect, useRef } from 'react';
import Icon from '../Icon';
import StoreGlyph, { STORE_BRANDS } from '../StoreIcons';
import { useUI } from '../../context/UIContext';
import useTier from '../../hooks/useTier';
import { compressMedia } from '../../utils/mediaCompression';
import { uploadToR2 } from '../../utils/r2Storage';
import {
  getVergrMeProducts, saveVergrMeProduct, deleteVergrMeProduct,
  uploadVergrMeProductFile, getMyVergrMeSales,
  getMySellerOrders, markOrderShipped, cancelVergrMeOrder,
} from '../../utils/vergrMeShop';

// vergr.me digital-product catalog manager (editor "Products" section).
// Sellers keep 92%: 8% flat platform fee, proceeds paid as GEMS directly
// (withdrawable — no coin→gem conversion commission). Founder-locked.

const fmtBytes = (n) => {
  if (!n) return '';
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)}GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.ceil(n / 1024)}KB`;
};

const EMPTY = { name: '', desc: '', priceCoins: '', coverUrl: '', published: true, kind: 'digital', stock: '', shippingCoins: '' };

// Source → badge. Synced products carry `source:'shopify'|'woocommerce'`.
// Colours + glyphs come from STORE_BRANDS so the provider's real logo shows
// here, in Vergr Shop and in the vergr.me editor from one definition.

// Order docs record the seller's cut in micro-USD under `owedToSeller` since
// 2026-08-16; older rows used integer cents under `gemsToSeller`.
//
// MODULE scope on purpose. It used to live inside ProductsPanel, so the order
// row's cancel-confirm dialog — a different component — threw
// `ReferenceError: microOf is not defined` and the confirm never opened, making
// an order impossible to cancel (audit A41 #4). It is a pure function of its
// argument, so there is no reason for it to be in a component at all.
const microOf = (r) => Number(r.owedToSeller ?? ((r.gemsToSeller || 0) * 10_000)) || 0;

export default function ProductsPanel({ uid, showOrders = true }) {
  const { showToast } = useUI();
  const { tier } = useTier();
  const [products, setProducts] = useState(null);
  const [sales, setSales] = useState([]);
  const [orders, setOrders] = useState([]);
  const [editing, setEditing] = useState(null); // product object being edited, or 'new'
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [rows, saleRows, orderRows] = await Promise.all([
        getVergrMeProducts(uid),
        getMyVergrMeSales(uid).catch(() => []),
        getMySellerOrders(uid).catch(() => []),
      ]);
      setProducts(rows);
      setSales(saleRows);
      setOrders(orderRows);
    } catch (e) {
      console.error('products load failed', e);
      setProducts([]);
    }
  };
  useEffect(() => { if (uid) load(); }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const earnedMicroUsd = sales.reduce((s, r) => s + microOf(r), 0)
    + orders.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + microOf(o), 0);
  const saleCount = sales.length + orders.filter((o) => o.status !== 'cancelled').length;
  const openOrders = orders.filter((o) => o.status === 'placed');

  const togglePublished = async (p) => {
    const next = p.published === false;
    setProducts((rows) => rows.map((r) => (r.id === p.id ? { ...r, published: next } : r)));
    try { await saveVergrMeProduct(uid, { id: p.id, published: next }); }
    catch { showToast('Could not update product', 'error'); load(); }
  };

  const remove = async (p) => {
    if (!window.confirm(`Delete "${p.name}"? Buyers keep access to their download.`)) return;
    setBusy(true);
    try {
      await deleteVergrMeProduct(uid, p.id);
      showToast('Product deleted', 'success');
      await load();
    } catch { showToast('Delete failed', 'error'); }
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Economics strip — the wedge, stated plainly. */}
      <div className="rounded-2xl p-4 border border-brand-violet/25" style={{ background: 'linear-gradient(135deg, rgba(123,31,255,0.12), rgba(200,127,255,0.06))' }}>
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(123,31,255,0.25)' }}>
            <Icon name="storefront" size={20} className="text-brand-violet-light" />
          </div>
          <div className="min-w-0">
            <div className="font-syne font-bold text-sm">Sell downloads, keep 92%</div>
            <p className="text-xs text-text-secondary mt-1 leading-relaxed">
              One flat 8% fee. Your 92% is credited to your earnings
              instantly, with <span className="text-white font-semibold">nothing else deducted</span> on
              top. Linktree charges 12%, Beacons 9% — plus payout processing.
            </p>
            {earnedMicroUsd > 0 && (
              <div className="mt-2 text-xs font-dmmono font-bold tabular-nums text-gem-blue">
                ${(earnedMicroUsd / 1e6).toFixed(2)} earned · {saleCount} sale{saleCount === 1 ? '' : 's'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Catalog list */}
      <div className="rounded-2xl bg-surface-1 border border-white/5 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <div className="text-sm font-syne font-bold">Your products</div>
          <button
            onClick={() => setEditing('new')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-white"
            style={{ background: 'linear-gradient(135deg, #7B1FFF, #B44FFF)' }}
          >
            <Icon name="add" size={14} /> New product
          </button>
        </div>

        {products === null && <div className="p-6 text-center text-xs text-text-muted">Loading…</div>}
        {products?.length === 0 && (
          <div className="p-8 text-center">
            <Icon name="download_for_offline" size={34} className="text-text-muted mb-2" />
            <p className="text-sm text-text-secondary">No products yet.</p>
            <p className="text-xs text-text-muted mt-1">Presets, guides, packs, wallpapers, project files — upload once, sell forever.</p>
          </div>
        )}

        {products?.map((p) => (
          <div key={p.id} className="flex items-center gap-3 px-4 py-3 border-b border-white/5 last:border-b-0">
            {p.coverUrl
              ? <img src={p.coverUrl} alt="" className="w-11 h-11 rounded-lg object-cover shrink-0" loading="lazy" />
              : <div className="w-11 h-11 rounded-lg bg-surface-2 flex items-center justify-center shrink-0"><Icon name="folder_zip" size={20} className="text-text-muted" /></div>}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate flex items-center gap-1.5">
                <span className="truncate">{p.name || 'Untitled'}</span>
                {STORE_BRANDS[p.source] && (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded shrink-0"
                    style={{ background: `${STORE_BRANDS[p.source].color}22` }}
                    title={`Synced from ${STORE_BRANDS[p.source].label}`}
                  >
                    <StoreGlyph provider={p.source} size={10} color={STORE_BRANDS[p.source].color} />
                    <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: STORE_BRANDS[p.source].color }}>
                      {STORE_BRANDS[p.source].label}
                    </span>
                  </span>
                )}
              </div>
              <div className="text-[11px] text-text-muted truncate">
                <span className="font-dmmono font-bold tabular-nums text-brand-gold">{Number(p.priceCoins || 0).toLocaleString()}c</span>
                {p.kind === 'physical' ? (
                  <>
                    {Number(p.shippingCoins) > 0 ? <> +{Number(p.shippingCoins).toLocaleString()}c ship</> : null}
                    {typeof p.stock === 'number'
                      ? <> · {p.stock <= 0 ? <span className="text-brand-ember">sold out</span> : `${p.stock} in stock`}</>
                      : <> · unlimited stock</>}
                  </>
                ) : (
                  p.fileName ? <> · {p.fileName}{p.fileSizeBytes ? ` (${fmtBytes(p.fileSizeBytes)})` : ''}</> : <> · <span className="text-brand-ember">no file uploaded</span></>
                )}
                {p.salesCount ? <> · {p.salesCount} sold</> : null}
              </div>
            </div>
            <button
              onClick={() => togglePublished(p)}
              className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide shrink-0 ${p.published !== false ? 'bg-brand-violet/20 text-brand-violet-light' : 'bg-white/5 text-text-muted'}`}
            >
              {p.published !== false ? 'Live' : 'Hidden'}
            </button>
            <button onClick={() => setEditing(p)} className="w-8 h-8 rounded-lg hover:bg-surface-2 flex items-center justify-center shrink-0"><Icon name="edit" size={16} className="text-text-secondary" /></button>
            <button onClick={() => remove(p)} disabled={busy} className="w-8 h-8 rounded-lg hover:bg-surface-2 flex items-center justify-center shrink-0"><Icon name="delete" size={16} className="text-brand-ember" /></button>
          </div>
        ))}
      </div>

      {/* Physical orders to fulfil */}
      {showOrders && orders.length > 0 && (
        <div className="rounded-2xl bg-surface-1 border border-white/5 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
            <div className="text-sm font-syne font-bold">Orders</div>
            {openOrders.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-gold/20 text-brand-gold">{openOrders.length} to ship</span>
            )}
          </div>
          {orders.map((o) => (
            <OrderRow key={o.id} order={o} onChanged={load} />
          ))}
        </div>
      )}

      <p className="text-[11px] text-text-muted px-1">
        Add a product to your page from <span className="text-text-secondary">Links → Add block → Sell a product</span>.
        Buyers pay with Vergr coins; digital files download via a private, expiring link, physical orders land above with the buyer's address.
      </p>

      {editing && (
        <ProductEditor
          uid={uid}
          tier={tier}
          product={editing === 'new' ? { ...EMPTY } : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

// ── Seller order row (physical fulfilment) ───────────────────────────
const ORDER_STATUS = {
  placed: { label: 'To ship', cls: 'bg-brand-gold/20 text-brand-gold' },
  shipped: { label: 'Shipped', cls: 'bg-brand-violet/20 text-brand-violet-light' },
  cancelled: { label: 'Cancelled', cls: 'bg-white/5 text-text-muted' },
};

export function OrderRow({ order: o, onChanged }) {
  const { showToast } = useUI();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const st = ORDER_STATUS[o.status] || ORDER_STATUS.placed;
  const s = o.shipping || {};

  const ship = async () => {
    const note = window.prompt('Tracking number / note for the buyer (optional):', o.trackingNote || '') ?? null;
    if (note === null) return;
    setBusy(true);
    try { await markOrderShipped(o.id, note); showToast('Marked shipped', 'success'); onChanged(); }
    catch { showToast('Could not update order', 'error'); }
    setBusy(false);
  };

  const cancel = async () => {
    if (!window.confirm(`Cancel this order? The buyer is refunded ${(o.totalCoins || 0).toLocaleString()} coins in full and $${(microOf(o) / 1e6).toFixed(2)} is taken back off what you are owed.`)) return;
    setBusy(true);
    try { await cancelVergrMeOrder(o.id); showToast('Order cancelled — buyer refunded', 'success'); onChanged(); }
    catch (e) { showToast(e?.message || 'Cancel failed', 'error'); }
    setBusy(false);
  };

  return (
    <div className="border-b border-white/5 last:border-b-0">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{o.productName || 'Product'}</div>
          <div className="text-[11px] text-text-muted truncate">
            <span className="font-dmmono font-bold tabular-nums text-brand-gold">{(o.totalCoins || 0).toLocaleString()}c</span>
            {' · '}{s.name || 'buyer'}{s.country ? `, ${s.country}` : ''}
          </div>
        </div>
        <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide shrink-0 ${st.cls}`}>{st.label}</span>
        <Icon name={open ? 'expand_less' : 'expand_more'} size={16} className="text-text-muted shrink-0" />
      </button>
      {open && (
        <div className="px-4 pb-3 -mt-1">
          <div className="text-xs text-text-secondary bg-surface-2 rounded-lg px-3 py-2 leading-relaxed">
            <div className="font-semibold text-white">{s.name}</div>
            <div>{s.address1}{s.address2 ? `, ${s.address2}` : ''}</div>
            <div>{[s.postal, s.city, s.country].filter(Boolean).join(', ')}</div>
            {s.phone && <div>☎ {s.phone}</div>}
            {s.note && <div className="text-text-muted mt-1">"{s.note}"</div>}
            {o.trackingNote && <div className="text-brand-violet-light mt-1">Tracking: {o.trackingNote}</div>}
          </div>
          {o.status === 'placed' && (
            <div className="flex gap-2 mt-2.5">
              <button onClick={ship} disabled={busy} className="flex-1 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #7B1FFF, #B44FFF)' }}>
                Mark shipped
              </button>
              <button onClick={cancel} disabled={busy} className="px-3 py-2 rounded-lg text-xs font-semibold bg-brand-ember/15 text-brand-ember disabled:opacity-50">
                Cancel & refund
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Create / edit sheet ──────────────────────────────────────────────
export function ProductEditor({ uid, tier, product, onClose, onSaved }) {
  const { showToast } = useUI();
  const [form, setForm] = useState({ ...product });
  const [saving, setSaving] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [filePct, setFilePct] = useState(null); // null | 0-100
  const [stagedFile, setStagedFile] = useState(null);
  const coverInput = useRef(null);
  const fileInput = useRef(null);
  const isNew = !product.id;
  // Synced products (Shopify/Woo): name + stock + image come from the store,
  // so those are read-only here. The seller can still set the coin price —
  // editing it stamps priceOverridden so a re-sync won't reset it.
  const synced = !!product.source && product.source !== 'native';

  const set = (obj) => setForm((f) => ({ ...f, ...obj }));

  const pickCover = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setCoverBusy(true);
    try {
      const compressed = await compressMedia(file, tier, 'post');
      const { url } = await uploadToR2(compressed, 'post');
      set({ coverUrl: url });
    } catch (err) { showToast(err?.message || 'Cover upload failed', 'error'); }
    setCoverBusy(false);
  };

  const price = Math.max(0, Math.floor(Number(form.priceCoins) || 0));
  const isPhysical = form.kind === 'physical';
  const shipCoins = Math.max(0, Math.floor(Number(form.shippingCoins) || 0));
  // 8% fee on the product price only; shipping passes through in full.

  const save = async () => {
    if (!form.name?.trim()) { showToast('Give your product a name', 'error'); return; }
    if (price <= 0) { showToast('Set a price in coins', 'error'); return; }
    if (!isPhysical && isNew && !stagedFile) { showToast('Upload the file buyers will receive', 'error'); return; }
    const stockNum = String(form.stock).trim() === '' ? null : Math.max(0, Math.floor(Number(form.stock) || 0));
    setSaving(true);
    try {
      const id = await saveVergrMeProduct(uid, {
        id: product.id,
        name: form.name.trim(),
        desc: (form.desc || '').trim(),
        priceCoins: price,
        coverUrl: form.coverUrl || '',
        published: form.published !== false,
        kind: isPhysical ? 'physical' : 'digital',
        stock: isPhysical ? stockNum : null,
        shippingCoins: isPhysical ? shipCoins : 0,
        // Editing a synced product's price is an override the re-sync respects.
        ...(synced ? { priceOverridden: true } : {}),
      });
      if (!isPhysical && stagedFile) {
        setFilePct(0);
        const meta = await uploadVergrMeProductFile(uid, id, stagedFile, setFilePct);
        await saveVergrMeProduct(uid, { id, fileName: meta.fileName, fileSizeBytes: meta.sizeBytes });
      }
      showToast(isNew ? 'Product created' : 'Product updated', 'success');
      onSaved();
    } catch (err) {
      showToast(err?.message || 'Save failed', 'error');
    }
    setSaving(false);
    setFilePct(null);
  };

  return (
    <div className="fixed inset-0 z-[10002] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={saving ? undefined : onClose} />
      <div className="relative w-full sm:max-w-md bg-surface-1 border border-white/10 rounded-t-2xl sm:rounded-2xl p-5 max-h-[88vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-syne font-bold text-base">{isNew ? 'New digital product' : 'Edit product'}</h3>
          <button onClick={onClose} disabled={saving} className="w-8 h-8 rounded-lg hover:bg-surface-2 flex items-center justify-center"><Icon name="close" size={18} /></button>
        </div>

        <div className="flex flex-col gap-3">
          {synced && (
            <div className="text-[11px] text-text-secondary bg-surface-2 rounded-lg px-3 py-2 flex items-center gap-2">
              <Icon name="sync" size={14} className="text-brand-violet-light shrink-0" />
              Synced from {form.source === 'shopify' ? 'Shopify' : 'WooCommerce'}. Name, stock and image update automatically. Set your Vergr coin price below.
            </div>
          )}
          {!synced && (
          <div>
            <div className="text-xs text-text-secondary mb-1">Type</div>
            <div className="flex gap-1 p-1 bg-surface-2 rounded-lg">
              {[['digital', 'Digital file'], ['physical', 'Physical item']].map(([v, label]) => (
                <button key={v} onClick={() => set({ kind: v })}
                  className={`flex-1 py-1.5 text-[11px] rounded-md font-medium ${(form.kind || 'digital') === v ? 'bg-brand-violet text-white' : 'text-text-muted'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          )}

          <label className="text-xs text-text-secondary">
            Name
            <input value={form.name || ''} onChange={(e) => set({ name: e.target.value })} disabled={synced} maxLength={80} placeholder="e.g. Aim training pack"
              className="mt-1 w-full bg-surface-2 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-brand-violet disabled:opacity-60" />
          </label>
          <label className="text-xs text-text-secondary">
            Description
            <textarea value={form.desc || ''} onChange={(e) => set({ desc: e.target.value })} maxLength={400} rows={3} placeholder="What buyers get"
              className="mt-1 w-full bg-surface-2 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-brand-violet resize-none" />
          </label>

          <label className="text-xs text-text-secondary">
            Price (coins)
            <input type="number" min="1" value={form.priceCoins} onChange={(e) => set({ priceCoins: e.target.value })} placeholder="500"
              className="mt-1 w-full bg-surface-2 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-brand-violet font-dmmono tabular-nums" />
          </label>
          {isPhysical && (
            <div className="flex gap-3">
              <label className="text-xs text-text-secondary flex-1">
                Shipping (coins)
                <input type="number" min="0" value={form.shippingCoins} onChange={(e) => set({ shippingCoins: e.target.value })} placeholder="0"
                  className="mt-1 w-full bg-surface-2 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-brand-violet font-dmmono tabular-nums" />
              </label>
              <label className="text-xs text-text-secondary flex-1">
                {synced ? 'Stock (from store)' : 'Stock (blank = unlimited)'}
                <input type="number" min="0" value={form.stock ?? ''} onChange={(e) => set({ stock: e.target.value })} disabled={synced} placeholder="∞"
                  className="mt-1 w-full bg-surface-2 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-brand-violet font-dmmono tabular-nums disabled:opacity-60" />
              </label>
            </div>
          )}
          {price > 0 && (
            <div className="text-[11px] text-text-muted -mt-1">
              You keep <span className="font-dmmono font-bold tabular-nums text-gem-blue">92%</span> of every sale
              {isPhysical && shipCoins > 0 ? ' (8% fee on the price, shipping passed through in full)' : ' (8% fee, nothing else deducted)'}.
            </div>
          )}

          {/* Cover */}
          <div>
            <div className="text-xs text-text-secondary mb-1">Cover image</div>
            <div className="flex items-center gap-3">
              {form.coverUrl
                ? <img src={form.coverUrl} alt="" className="w-14 h-14 rounded-lg object-cover" />
                : <div className="w-14 h-14 rounded-lg bg-surface-2 flex items-center justify-center"><Icon name="image" size={20} className="text-text-muted" /></div>}
              <button onClick={() => coverInput.current?.click()} disabled={coverBusy}
                className="px-3 py-1.5 text-xs rounded-lg border border-white/10 text-text-secondary hover:text-white">
                {coverBusy ? 'Uploading…' : form.coverUrl ? 'Replace' : 'Upload cover'}
              </button>
              {form.coverUrl && <button onClick={() => set({ coverUrl: '' })} className="text-xs text-text-muted hover:text-brand-ember">Remove</button>}
            </div>
            <input ref={coverInput} type="file" accept="image/*" className="hidden" onChange={pickCover} />
          </div>

          {/* The paid file (digital only) */}
          {!isPhysical && (
          <div>
            <div className="text-xs text-text-secondary mb-1">The file buyers receive</div>
            {(form.fileName || stagedFile) && (
              <div className="flex items-center gap-2 text-xs text-text-secondary bg-surface-2 rounded-lg px-3 py-2 mb-2">
                <Icon name="folder_zip" size={16} className="text-brand-violet-light shrink-0" />
                <span className="truncate">{stagedFile ? stagedFile.name : form.fileName}</span>
                <span className="text-text-muted shrink-0">{fmtBytes(stagedFile ? stagedFile.size : form.fileSizeBytes)}</span>
              </div>
            )}
            {filePct !== null && (
              <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden mb-2">
                <div className="h-full rounded-full transition-all" style={{ width: `${filePct}%`, background: 'linear-gradient(90deg, #7B1FFF, #B44FFF)' }} />
              </div>
            )}
            <button onClick={() => fileInput.current?.click()} disabled={saving}
              className="px-3 py-1.5 text-xs rounded-lg border border-white/10 text-text-secondary hover:text-white">
              {form.fileName || stagedFile ? 'Replace file' : 'Choose file'}
            </button>
            <input ref={fileInput} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setStagedFile(f); }} />
            <p className="text-[10px] text-text-muted mt-1.5">
              Zip, PDF, images, audio, video, presets… Stored privately — buyers get an expiring download link, never a public URL.
            </p>
          </div>
          )}
          {isPhysical && (
            <p className="text-[10px] text-text-muted">
              Orders arrive in the Orders list above with the buyer's shipping address. Mark them shipped when sent; cancelling an unshipped order refunds the buyer in full.
            </p>
          )}
        </div>

        <button onClick={save} disabled={saving}
          className="mt-5 w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #7B1FFF, #B44FFF)' }}>
          {saving ? (filePct !== null ? `Uploading ${filePct}%…` : 'Saving…') : isNew ? 'Create product' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
