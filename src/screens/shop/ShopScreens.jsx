import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import Icon from '../../components/Icon';
import StoreGlyph from '../../components/StoreIcons';
import UserAvatar from '../../components/UserAvatar';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { createConversation } from '../../firebase/firestore';
import ProductsPanel, { OrderRow } from '../../components/vergrme/ProductsPanel';
import {
  getVergrMeProducts, getMyVergrMeSales, getMySellerOrders,
  getVergrMeCustomers, getMyShopIntegration, connectShopIntegration,
  syncShopInventory, disconnectShopIntegration,
} from '../../utils/vergrMeShop';

const useUid = () => useAuth().currentUser?.uid;

// Resolve a set of buyer uids → light profile map (bounded by customer count).
async function resolveProfiles(uids) {
  const out = {};
  await Promise.all([...new Set(uids)].map(async (uid) => {
    try {
      const s = await getDoc(doc(db, 'users', uid));
      if (s.exists()) { const d = s.data(); out[uid] = { id: uid, username: d.username, displayName: d.displayName, avatar: d.avatar, photoURL: d.photoURL }; }
    } catch { /* skip */ }
  }));
  return out;
}

const fmt = (n) => Number(n || 0).toLocaleString();
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

// ─────────────────────────────────────────────────────────────────────
// Overview
// ─────────────────────────────────────────────────────────────────────
export function ShopOverviewScreen() {
  const uid = useUid();
  const navigate = useNavigate();
  const { wallet } = useUser();
  const [data, setData] = useState(null);
  const [integration, setIntegration] = useState(undefined);

  useEffect(() => {
    if (!uid) return;
    Promise.all([
      getVergrMeProducts(uid).catch(() => []),
      getMyVergrMeSales(uid).catch(() => []),
      getMySellerOrders(uid).catch(() => []),
    ]).then(([products, sales, orders]) => setData({ products, sales, orders }));
    getMyShopIntegration().then(setIntegration).catch(() => setIntegration(null));
  }, [uid]);

  const gems = wallet?.vergrMeSalesGems || 0;
  const liveProducts = (data?.products || []).filter((p) => p.published !== false).length;
  const openOrders = (data?.orders || []).filter((o) => o.status === 'placed');
  const activeOrders = (data?.orders || []).filter((o) => o.status !== 'cancelled');
  const saleCount = (data?.sales?.length || 0) + activeOrders.length;

  const Stat = ({ icon, label, value, tint }) => (
    <div className="bg-surface-1 border border-white/[0.06] rounded-2xl p-4">
      <div className="flex items-center gap-2 text-text-muted text-[11px] uppercase tracking-wide font-semibold">
        <Icon name={icon} size={15} className={tint} /> {label}
      </div>
      <div className="font-dmmono font-bold tabular-nums text-2xl mt-1.5">{value}</div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-syne font-extrabold text-2xl">Overview</h1>
        <p className="text-text-secondary text-sm mt-0.5">Your shop at a glance. You keep 92% of each sale, credited to your earnings.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon="diamond" label="Gems earned" value={fmt(gems)} tint="text-gem-blue" />
        <Stat icon="receipt_long" label="Sales" value={fmt(saleCount)} tint="text-brand-violet-light" />
        <Stat icon="local_shipping" label="To ship" value={fmt(openOrders.length)} tint="text-brand-gold" />
        <Stat icon="inventory_2" label="Live products" value={fmt(liveProducts)} tint="text-brand-pink" />
      </div>

      {/* Connected store status */}
      <button onClick={() => navigate('/shop/integrations')} className="text-left bg-surface-1 border border-white/[0.06] rounded-2xl p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand-violet/15 flex items-center justify-center shrink-0"><Icon name="bolt" size={20} className="text-brand-violet-light" /></div>
        <div className="flex-1 min-w-0">
          {integration === undefined ? <div className="text-sm text-text-muted">Checking store connection…</div>
            : integration ? (
              <>
                <div className="text-sm font-semibold truncate">{integration.shopName || integration.shopDomain} connected</div>
                <div className="text-xs text-text-muted">{integration.provider === 'shopify' ? 'Shopify' : 'WooCommerce'} · {fmt(integration.productCount)} products synced</div>
              </>
            ) : (
              <>
                <div className="text-sm font-semibold">Connect Shopify or WooCommerce</div>
                <div className="text-xs text-text-muted">Sell your store's products on Vergr with synced inventory</div>
              </>
            )}
        </div>
        <Icon name="chevron_right" size={18} className="text-text-muted" />
      </button>

      {/* Quick actions */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <QuickAction icon="add_box" label="New product" onClick={() => navigate('/shop/products')} />
        <QuickAction icon="local_shipping" label={openOrders.length ? `Ship ${openOrders.length} order${openOrders.length === 1 ? '' : 's'}` : 'Orders'} onClick={() => navigate('/shop/orders')} />
        <QuickAction icon="link" label="Add to my vergr.me" onClick={() => navigate('/vergrme/edit')} />
      </div>

      {/* Recent activity */}
      {activeOrders.length > 0 && (
        <div className="bg-surface-1 border border-white/[0.06] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/5 text-sm font-syne font-bold">Recent orders</div>
          {activeOrders.slice(0, 5).map((o) => (
            <div key={o.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5 last:border-b-0">
              <div className="flex-1 min-w-0 text-sm truncate">{o.productName}</div>
              <span className="font-dmmono font-bold tabular-nums text-brand-gold text-xs">{fmt(o.totalCoins)}c</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${o.status === 'shipped' ? 'bg-brand-violet/20 text-brand-violet-light' : 'bg-brand-gold/20 text-brand-gold'}`}>{o.status === 'shipped' ? 'Shipped' : 'To ship'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QuickAction({ icon, label, onClick }) {
  return (
    <button onClick={onClick} className="bg-surface-1 border border-white/[0.06] rounded-2xl p-4 flex items-center gap-2.5 hover:border-brand-violet/30 text-left">
      <Icon name={icon} size={20} className="text-brand-violet-light shrink-0" />
      <span className="text-sm font-semibold truncate">{label}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Products — reuse the full catalog manager (orders live on their own screen)
// ─────────────────────────────────────────────────────────────────────
export function ShopProductsScreen() {
  const uid = useUid();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-syne font-extrabold text-2xl">Products</h1>
        <p className="text-text-secondary text-sm mt-0.5">Digital downloads, physical items, and products synced from your store.</p>
      </div>
      {uid && <ProductsPanel uid={uid} showOrders={false} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Orders — physical fulfilment with status filters
// ─────────────────────────────────────────────────────────────────────
const ORDER_FILTERS = [
  { id: 'placed', label: 'To ship' },
  { id: 'shipped', label: 'Shipped' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'all', label: 'All' },
];

export function ShopOrdersScreen() {
  const uid = useUid();
  const [orders, setOrders] = useState(null);
  const [filter, setFilter] = useState('placed');
  const [q, setQ] = useState('');

  const load = () => { if (uid) getMySellerOrders(uid).then(setOrders).catch(() => setOrders([])); };
  useEffect(load, [uid]);

  const counts = useMemo(() => {
    const c = { placed: 0, shipped: 0, cancelled: 0, all: (orders || []).length };
    (orders || []).forEach((o) => { c[o.status] = (c[o.status] || 0) + 1; });
    return c;
  }, [orders]);

  const view = (orders || [])
    .filter((o) => filter === 'all' || o.status === filter)
    .filter((o) => !q || (o.productName || '').toLowerCase().includes(q.toLowerCase()) || (o.shipping?.name || '').toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-syne font-extrabold text-2xl">Orders</h1>
        <p className="text-text-secondary text-sm mt-0.5">Physical orders to fulfil. Mark shipped when sent; cancel an unshipped order to refund the buyer in full.</p>
      </div>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {ORDER_FILTERS.map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs whitespace-nowrap ${filter === f.id ? 'bg-brand-violet text-white font-semibold' : 'bg-surface-2 text-text-secondary'}`}>
            {f.label}{counts[f.id] ? <span className="opacity-70">· {counts[f.id]}</span> : null}
          </button>
        ))}
      </div>

      <div className="relative">
        <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product or buyer"
          className="w-full bg-surface-2 border border-white/10 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white outline-none focus:border-brand-violet" />
      </div>

      <div className="bg-surface-1 border border-white/[0.06] rounded-2xl overflow-hidden">
        {orders === null ? <div className="p-6 text-center text-xs text-text-muted">Loading…</div>
          : view.length === 0 ? (
            <div className="p-10 text-center">
              <Icon name="local_shipping" size={34} className="text-text-muted mb-2" />
              <p className="text-sm text-text-secondary">No {filter === 'all' ? '' : ORDER_FILTERS.find((f) => f.id === filter)?.label.toLowerCase()} orders.</p>
            </div>
          ) : view.map((o) => <OrderRow key={o.id} order={o} onChanged={load} />)}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Customers — buyers + DM (reuses createConversation → existing DM stack)
// ─────────────────────────────────────────────────────────────────────
export function ShopCustomersScreen() {
  const uid = useUid();
  const navigate = useNavigate();
  const { showToast } = useUI();
  const [customers, setCustomers] = useState(null);
  const [profiles, setProfiles] = useState({});
  const [msgBusy, setMsgBusy] = useState(null);

  useEffect(() => {
    if (!uid) return;
    getVergrMeCustomers(uid).then(async (rows) => {
      setCustomers(rows);
      setProfiles(await resolveProfiles(rows.map((r) => r.buyerUid)));
    }).catch(() => setCustomers([]));
  }, [uid]);

  const message = async (buyerUid) => {
    setMsgBusy(buyerUid);
    try {
      const target = profiles[buyerUid] || { id: buyerUid };
      const convoId = await createConversation(uid, { ...target, id: buyerUid });
      navigate(`/messages/${convoId}`);
    } catch (e) {
      showToast(e?.message || "Couldn't open a chat with this customer", 'error');
    }
    setMsgBusy(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-syne font-extrabold text-2xl">Customers</h1>
        <p className="text-text-secondary text-sm mt-0.5">Everyone who's bought from you. Message them directly about an order or a new drop.</p>
      </div>

      {customers === null ? (
        <div className="py-16 text-center text-text-muted"><Icon name="progress_activity" className="animate-spin" /></div>
      ) : customers.length === 0 ? (
        <div className="bg-surface-1 border border-white/[0.06] rounded-3xl p-10 text-center">
          <Icon name="group" size={34} className="text-text-muted mb-2" />
          <div className="font-syne font-bold text-lg">No customers yet</div>
          <p className="text-text-secondary text-sm mt-1.5">When someone buys a product, they'll appear here.</p>
        </div>
      ) : (
        <div className="bg-surface-1 border border-white/[0.06] rounded-2xl overflow-hidden">
          {customers.map((c) => {
            const p = profiles[c.buyerUid];
            return (
              <div key={c.buyerUid} className="flex items-center gap-3 px-4 py-3 border-b border-white/5 last:border-b-0">
                <UserAvatar user={p || { id: c.buyerUid }} size={40} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{p?.displayName || p?.username || 'Customer'}</div>
                  <div className="text-[11px] text-text-muted truncate">
                    <span className="font-dmmono font-bold tabular-nums text-brand-gold">{fmt(c.totalCoins)}c</span> spent · {c.count} order{c.count === 1 ? '' : 's'}
                    {c.lastMs ? ` · last ${fmtDate(c.lastMs)}` : ''}
                  </div>
                </div>
                <button onClick={() => message(c.buyerUid)} disabled={msgBusy === c.buyerUid}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white shrink-0 disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#7B1FFF,#B44FFF)' }}>
                  <Icon name="chat" size={15} /> {msgBusy === c.buyerUid ? '…' : 'Message'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Integrations — connect Shopify / WooCommerce
// ─────────────────────────────────────────────────────────────────────
const PROVIDER_META = {
  shopify: {
    label: 'Shopify', color: '#7AB55C',
    steps: [
      'In your Shopify admin: Settings → Apps and sales channels → Develop apps',
      'Create an app → Configure Admin API scopes: read_products, read_inventory, write_inventory',
      'Install the app, then reveal the Admin API access token (starts with shpat_)',
    ],
    fields: [
      { key: 'shopDomain', label: 'Store domain', placeholder: 'your-store.myshopify.com' },
      { key: 'accessToken', label: 'Admin API access token', placeholder: 'shpat_…', secret: true },
    ],
  },
  woocommerce: {
    label: 'WooCommerce', color: '#96588A',
    steps: [
      'In WordPress admin: WooCommerce → Settings → Advanced → REST API → Add key',
      'Set Permissions to Read/Write, then Generate API key',
      'Copy the Consumer key and Consumer secret',
    ],
    fields: [
      { key: 'shopDomain', label: 'Store URL', placeholder: 'yourstore.com' },
      { key: 'consumerKey', label: 'Consumer key', placeholder: 'ck_…' },
      { key: 'consumerSecret', label: 'Consumer secret', placeholder: 'cs_…', secret: true },
    ],
  },
};

export function ShopIntegrationsScreen() {
  const { showToast } = useUI();
  const navigate = useNavigate();
  const [integration, setIntegration] = useState(undefined);
  const [openProvider, setOpenProvider] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  const refresh = () => getMyShopIntegration().then(setIntegration).catch(() => setIntegration(null));
  useEffect(() => { refresh(); }, []);

  const connect = async (provider) => {
    const meta = PROVIDER_META[provider];
    for (const f of meta.fields) if (!String(form[f.key] || '').trim()) { showToast(`Enter your ${f.label.toLowerCase()}`, 'error'); return; }
    setBusy(true);
    try {
      const res = await connectShopIntegration({ provider, ...form });
      setIntegration(res.integration);
      setOpenProvider(null); setForm({});
      showToast(res.sync?.ok ? `Connected — ${res.sync.productCount} products imported` : 'Store connected', 'success');
      refresh();
    } catch (e) { showToast(e?.message || 'Could not connect the store', 'error'); }
    setBusy(false);
  };

  const sync = async () => {
    setBusy(true);
    try { const r = await syncShopInventory(integration.provider); setIntegration(r.integration); showToast(`Synced — ${r.productCount} products`, 'success'); }
    catch (e) { showToast(e?.message || 'Sync failed', 'error'); }
    setBusy(false);
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect this store? Synced products will be hidden (not deleted). You can reconnect anytime.')) return;
    setBusy(true);
    try { await disconnectShopIntegration(integration.provider); setIntegration(null); showToast('Store disconnected', 'success'); }
    catch (e) { showToast(e?.message || 'Disconnect failed', 'error'); }
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-syne font-extrabold text-2xl">Integrations</h1>
        <p className="text-text-secondary text-sm mt-0.5">Connect your store to sell its products on Vergr with synced inventory. Vergr is another selling outlet — your store stays your source of truth.</p>
      </div>

      {integration === undefined ? (
        <div className="py-14 text-center text-text-muted"><Icon name="progress_activity" className="animate-spin" /></div>
      ) : integration ? (
        <div className="bg-surface-1 border border-white/[0.06] rounded-2xl p-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${(PROVIDER_META[integration.provider]?.color || '#7B1FFF')}22` }}>
              <StoreGlyph provider={integration.provider} size={22} color={PROVIDER_META[integration.provider]?.color || '#B44FFF'} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-syne font-bold truncate">{integration.shopName || integration.shopDomain}</div>
              <div className="text-xs text-text-muted">{PROVIDER_META[integration.provider]?.label} · {fmt(integration.productCount)} products · {integration.currency}</div>
            </div>
            <span
              className="px-2 py-1 rounded-md text-[10px] font-bold uppercase"
              style={{
                background: `${PROVIDER_META[integration.provider]?.color || '#7B1FFF'}22`,
                color: PROVIDER_META[integration.provider]?.color || '#B44FFF',
              }}
            >
              Connected
            </span>
          </div>
          {integration.lastSyncError && (
            <div className="mt-3 text-xs text-brand-ember bg-brand-ember/10 rounded-lg px-3 py-2">{integration.lastSyncError}</div>
          )}
          <div className="mt-3 text-[11px] text-text-muted">
            Imported products sit in <button onClick={() => navigate('/shop/products')} className="text-brand-violet-light">Products</button> as physical items — set each one's coin price and publish it. Prices auto-convert from your store currency; your edits stick. A sale here decrements your store's stock, and a daily sync reconciles both ways.
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={sync} disabled={busy} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#7B1FFF,#B44FFF)' }}>
              {busy ? 'Syncing…' : 'Sync now'}
            </button>
            <button onClick={disconnect} disabled={busy} className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-brand-ember/15 text-brand-ember disabled:opacity-50">Disconnect</button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          {Object.entries(PROVIDER_META).map(([provider, meta]) => (
            <div key={provider} className="bg-surface-1 border border-white/[0.06] rounded-2xl overflow-hidden">
              <button onClick={() => { setOpenProvider(openProvider === provider ? null : provider); setForm({}); }}
                className="w-full flex items-center gap-3 px-4 py-4 text-left">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${meta.color}22` }}>
                  <StoreGlyph provider={provider} size={20} color={meta.color} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold">{meta.label}</div>
                  <div className="text-xs text-text-muted">Import products + inventory with an API key</div>
                </div>
                <Icon name={openProvider === provider ? 'expand_less' : 'expand_more'} size={18} className="text-text-muted" />
              </button>
              {openProvider === provider && (
                <div className="px-4 pb-4 border-t border-white/5 pt-3">
                  <ol className="text-[11px] text-text-muted space-y-1 mb-3 list-decimal list-inside">
                    {meta.steps.map((s, i) => <li key={i}>{s}</li>)}
                  </ol>
                  {meta.fields.map((f) => (
                    <input key={f.key} value={form[f.key] || ''} onChange={(e) => setForm((o) => ({ ...o, [f.key]: e.target.value }))}
                      type={f.secret ? 'password' : 'text'} placeholder={f.placeholder} autoComplete="off"
                      className="w-full bg-surface-2 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-brand-violet mb-2" />
                  ))}
                  <button onClick={() => connect(provider)} disabled={busy}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#7B1FFF,#B44FFF)' }}>
                    {busy ? 'Connecting…' : `Connect ${meta.label}`}
                  </button>
                  <p className="text-[10px] text-text-muted mt-2">Your token is stored securely on our servers and never shown again. It's only used to read your products and keep stock in sync.</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Settings — how it works + quick links (economics are founder-locked)
// ─────────────────────────────────────────────────────────────────────
export function ShopSettingsScreen() {
  const navigate = useNavigate();
  const Row = ({ icon, title, body }) => (
    <div className="flex gap-3 px-4 py-3.5 border-b border-white/5 last:border-b-0">
      <Icon name={icon} size={20} className="text-brand-violet-light shrink-0 mt-0.5" />
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-text-secondary mt-0.5 leading-relaxed">{body}</div>
      </div>
    </div>
  );
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-syne font-extrabold text-2xl">Settings</h1>
        <p className="text-text-secondary text-sm mt-0.5">How your shop works.</p>
      </div>
      <div className="bg-surface-1 border border-white/[0.06] rounded-2xl overflow-hidden">
        <Row icon="diamond" title="You keep 92%" body="A flat 8% fee per sale. Your share is credited to your earnings instantly and is paid to you on your payout schedule. Shipping you charge passes through to you in full." />
        <Row icon="download_for_offline" title="Digital products" body="Files are stored privately. Buyers get a short-lived, expiring download link — never a public URL." />
        <Row icon="local_shipping" title="Physical products" body="Buyers pay in coins and enter a shipping address. Fulfil from Orders. Cancelling an unshipped order refunds the buyer in full." />
        <Row icon="bolt" title="Connected stores" body="Sell your Shopify or WooCommerce catalog on Vergr. Inventory stays in sync so you never oversell." />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <QuickAction icon="link" label="Edit my vergr.me" onClick={() => navigate('/vergrme/edit')} />
        <QuickAction icon="account_balance_wallet" label="Wallet & payouts" onClick={() => navigate('/wallet')} />
      </div>
    </div>
  );
}
