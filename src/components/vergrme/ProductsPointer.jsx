import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../Icon';
import { getVergrMeProducts } from '../../utils/vergrMeShop';

// vergr.me editor → Products section.
// Selling is MANAGED in Vergr Shop (/shop), not here: vergr.me is the display
// tool. This panel only does what the page builder needs — confirm what's in
// the catalog and get you to the block that shows it — and hands everything
// else (catalog CRUD, orders, customers, store sync) to the Shop.
export default function ProductsPointer({ uid, onGoToBlocks }) {
  const navigate = useNavigate();
  const [products, setProducts] = useState(null);

  useEffect(() => {
    if (!uid) return;
    getVergrMeProducts(uid).then(setProducts).catch(() => setProducts([]));
  }, [uid]);

  const live = (products || []).filter((p) => p.published !== false);

  return (
    <div className="flex flex-col gap-4">
      {/* Economics strip — the wedge, stated plainly. */}
      <div className="rounded-2xl p-4 border border-brand-violet/25" style={{ background: 'linear-gradient(135deg, rgba(123,31,255,0.12), rgba(200,127,255,0.06))' }}>
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(123,31,255,0.25)' }}>
            <Icon name="storefront" size={20} className="text-brand-violet-light" />
          </div>
          <div className="min-w-0">
            <div className="font-syne font-bold text-sm">Sell on your page, keep 92%</div>
            <p className="text-xs text-text-secondary mt-1 leading-relaxed">
              One flat 8% fee. Earnings land as <span className="text-gem-blue font-semibold">gems</span> instantly,
              with <span className="text-white font-semibold">nothing else deducted</span>. Linktree charges 12%, Beacons 9%.
            </p>
          </div>
        </div>
      </div>

      {/* Catalog snapshot */}
      <div className="rounded-2xl bg-surface-1 border border-white/5 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
          <div className="text-sm font-syne font-bold">Your catalog</div>
          {products && <div className="text-[11px] text-text-muted">{live.length} live · {products.length} total</div>}
        </div>

        {products === null && <div className="p-6 text-center text-xs text-text-muted">Loading…</div>}
        {products?.length === 0 && (
          <div className="p-7 text-center">
            <Icon name="inventory_2" size={32} className="text-text-muted mb-2" />
            <p className="text-sm text-text-secondary">No products yet.</p>
            <p className="text-xs text-text-muted mt-1">Create them in Vergr Shop, then add them to this page as a block.</p>
          </div>
        )}

        {products?.slice(0, 5).map((p) => (
          <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5 last:border-b-0">
            {p.coverUrl
              ? <img src={p.coverUrl} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0" loading="lazy" />
              : <div className="w-9 h-9 rounded-lg bg-surface-2 flex items-center justify-center shrink-0"><Icon name="inventory_2" size={17} className="text-text-muted" /></div>}
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{p.name || 'Untitled'}</div>
              <div className="text-[11px] text-text-muted">
                <span className="font-dmmono font-bold tabular-nums text-brand-gold">{Number(p.priceCoins || 0).toLocaleString()}c</span>
                {p.published === false ? ' · hidden' : ''}
              </div>
            </div>
          </div>
        ))}
        {products?.length > 5 && (
          <div className="px-4 py-2 text-[11px] text-text-muted">+{products.length - 5} more in Vergr Shop</div>
        )}
      </div>

      <button
        onClick={() => navigate('/shop/products')}
        className="w-full py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2"
        style={{ background: 'linear-gradient(135deg, #7B1FFF, #B44FFF)' }}
      >
        <Icon name="storefront" size={17} /> Manage in Vergr Shop
      </button>

      <p className="text-[11px] text-text-muted px-1">
        Vergr Shop is where you create products, fulfil orders, message customers and connect
        Shopify or WooCommerce. To show a product on this page, go to{' '}
        <button onClick={onGoToBlocks} className="text-brand-violet-light">Links → Add block → Sell a product</button>.
      </p>
    </div>
  );
}
