import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import TopBar from '../components/TopBar';
import Icon from '../components/Icon';
import { useUI } from '../context/UIContext';
import { useAuth } from '../context/AuthContext';
import useResponsive from '../hooks/useResponsive';
import { getMyVergrMePurchases, getMyVergrMeOrders, openVergrMeDownload } from '../utils/vergrMeShop';

// Buyer-side "My Downloads": every digital product bought through a vergr.me
// page, with a fresh (expiring) download link per click. Access survives the
// seller removing the block from their page — the purchase doc is the grant.
export default function VergrMePurchasesScreen() {
  const { isDesktop } = useResponsive();
  const navigate = useNavigate();
  const { showToast } = useUI();
  const { currentUser } = useAuth();
  const [rows, setRows] = useState(null);
  const [orders, setOrders] = useState([]);
  const [downloading, setDownloading] = useState(null); // purchase id in flight

  useEffect(() => {
    if (!currentUser?.uid) return;
    getMyVergrMePurchases(currentUser.uid).then(setRows).catch(() => setRows([]));
    getMyVergrMeOrders(currentUser.uid).then(setOrders).catch(() => {});
  }, [currentUser?.uid]);

  const download = async (r) => {
    setDownloading(r.id);
    try { await openVergrMeDownload(r.sellerUid, r.productId); }
    catch (e) { showToast(e?.message || 'Download failed — try again', 'error'); }
    setDownloading(null);
  };

  const fmtDate = (ts) => {
    const ms = ts?.toMillis?.() || 0;
    return ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  };

  const body = (
    <div className="max-w-[760px] mx-auto px-4 py-5">
      {isDesktop && <h1 className="font-syne font-extrabold text-2xl text-white mb-1">My Downloads</h1>}
      {isDesktop && <p className="text-text-secondary text-sm mb-6">Digital products you've bought. Download again anytime.</p>}

      {orders.length > 0 && (
        <div className="mb-6">
          <h2 className="font-syne font-bold text-sm text-white mb-2.5">Orders</h2>
          <div className="space-y-3">
            {orders.map((o) => {
              const st = o.status === 'shipped'
                ? { label: 'Shipped', cls: 'bg-brand-violet/20 text-brand-violet-light' }
                : o.status === 'cancelled'
                  ? { label: 'Refunded', cls: 'bg-white/5 text-text-muted' }
                  : { label: 'Preparing', cls: 'bg-brand-gold/20 text-brand-gold' };
              return (
                <div key={o.id} className="bg-surface-1 border border-white/[0.06] rounded-2xl p-4 flex items-center gap-3.5">
                  {o.coverUrl
                    ? <img src={o.coverUrl} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0" loading="lazy" />
                    : <div className="w-12 h-12 rounded-xl bg-surface-2 flex items-center justify-center shrink-0"><Icon name="package_2" size={22} className="text-text-muted" /></div>}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-white truncate">{o.productName || 'Product'}</div>
                    <div className="text-xs text-text-muted truncate mt-0.5">
                      <span className="font-dmmono font-bold tabular-nums text-brand-gold">{(o.totalCoins || 0).toLocaleString()}c</span>
                      {o.trackingNote ? ` · ${o.trackingNote}` : ''}
                    </div>
                  </div>
                  <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide shrink-0 ${st.cls}`}>{st.label}</span>
                </div>
              );
            })}
          </div>
          {rows?.length > 0 && <h2 className="font-syne font-bold text-sm text-white mt-6 mb-2.5">Downloads</h2>}
        </div>
      )}

      {rows === null ? (
        <div className="py-20 text-center text-text-muted"><Icon name="progress_activity" className="animate-spin" /></div>
      ) : rows.length === 0 && orders.length === 0 ? (
        <div className="bg-surface-1 border border-white/[0.06] rounded-3xl p-10 text-center mt-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-violet to-brand-pink flex items-center justify-center mx-auto mb-4"><Icon name="download_for_offline" filled size={28} className="text-white" /></div>
          <div className="font-syne font-bold text-lg text-white">No downloads yet</div>
          <p className="text-text-secondary text-sm mt-1.5 max-w-sm mx-auto">Products you buy on creators' vergr.me pages land here — re-download them whenever you want.</p>
          <button onClick={() => navigate('/explore')} className="mt-5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-brand-violet to-brand-pink text-white font-semibold text-sm">Discover creators</button>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="bg-surface-1 border border-white/[0.06] rounded-2xl p-4 flex items-center gap-3.5">
              {r.coverUrl
                ? <img src={r.coverUrl} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0" loading="lazy" />
                : <div className="w-12 h-12 rounded-xl bg-surface-2 flex items-center justify-center shrink-0"><Icon name="folder_zip" size={22} className="text-text-muted" /></div>}
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-white truncate">{r.productName || 'Digital product'}</div>
                <div className="text-xs text-text-muted truncate mt-0.5">
                  <span className="font-dmmono font-bold tabular-nums text-brand-gold">{(r.priceCoins || 0).toLocaleString()}c</span>
                  {r.fileName ? ` · ${r.fileName}` : ''}{fmtDate(r.createdAt) ? ` · ${fmtDate(r.createdAt)}` : ''}
                </div>
              </div>
              <button
                onClick={() => download(r)}
                disabled={downloading === r.id}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-white shrink-0 disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #7B1FFF, #B44FFF)' }}
              >
                <Icon name="download" size={15} /> {downloading === r.id ? 'Preparing…' : 'Download'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className={isDesktop ? 'min-h-screen' : 'screen-container min-h-screen'}>
      {!isDesktop && <TopBar title="My Downloads" showBack />}
      {body}
    </div>
  );
}
