import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { doc, getDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { purchaseVergrMeProduct, openVergrMeDownload } from '../utils/vergrMeShop';
import { isPermalinkProduct, openCartCheckout } from '../utils/shopifyCart';
import { StackSkeleton } from '../components/skeletons/GlassSkeletons';
import VergrMeView from '../components/VergrMeView';
import VergrMePopups from '../components/vergrme/VergrMePopups';
import { getBlocks } from '../hooks/useVergrMe';
import { supportUrl } from '../utils/vergrMeThemes';
import { enrichBlocks } from '../utils/vergrMeEnrich';
import { vergrMeUrl, VERGRME_DISPLAY_PREFIX } from '../utils/vergrMeUrl';
import {
  trackPageView,
  trackBlockClick,
  trackMessageTap,
  trackEmailTap,
  trackTipTap,
} from '../utils/vergrMeTracking';

export default function VergrMePage() {
  const { username } = useParams();
  const [data, setData] = useState(null);
  const [uid, setUid] = useState(null);
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [checkout, setCheckout] = useState(null); // physical-product block being bought

  useEffect(() => {
    async function load() {
      try {
        const unSnap = await getDoc(doc(db, 'usernames', username?.toLowerCase()));
        if (!unSnap.exists()) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        const resolvedUid = unSnap.data().uid;
        setUid(resolvedUid);

        // Page + profile in parallel (profile covers avatar + verified badge).
        const [pageSnap, profileSnap] = await Promise.all([
          getDoc(doc(db, 'users', resolvedUid, 'vergrMe', 'page')),
          getDoc(doc(db, 'users', resolvedUid)),
        ]);
        if (!pageSnap.exists() || !pageSnap.data().isPublic) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        const pageData = pageSnap.data();
        setData(pageData);

        // Enrich vergr_* cross-promo blocks with live data (stream/tournament/
        // event/squad), then patch them back in. Non-blocking for first paint.
        const blocks = getBlocks(pageData);
        if (blocks.some((b) => b.type?.startsWith('vergr_') || b.type === 'membership' || b.type === 'digital_product')) {
          enrichBlocks(resolvedUid, blocks).then((enriched) =>
            setData((d) => (d ? { ...d, blocks: enriched } : d))
          );
        }

        const prof = profileSnap.data() || {};
        if (pageData.useProfileAvatar) {
          setAvatarUrl(prof.avatar || prof.photoURL || null);
        } else {
          setAvatarUrl(pageData.customAvatarUrl);
        }
        if (prof.isVerified) setData((d) => (d ? { ...d, verified: true } : d));

        setLoading(false);
        trackPageView(resolvedUid);
        document.title = pageData.seoTitle || `${pageData.displayName} · vergr.me`;
        document
          .querySelector('meta[name="description"]')
          ?.setAttribute('content', pageData.seoDescription || pageData.bio || '');
        injectPixels(pageData.pixels);
      } catch (err) {
        console.error('vergr.me load failed', err);
        setNotFound(true);
        setLoading(false);
      }
    }
    load();
  }, [username]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0b0b0d]">
        <StackSkeleton rows={5} height={68} />
      </div>
    );
  }

  if (notFound) {
    // Growth surface: a dead handle is an unclaimed handle. Pitch it.
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3 bg-[#0b0b0d] text-white text-center px-6">
        <p className="text-2xl font-syne font-bold">
          {VERGRME_DISPLAY_PREFIX}<span className="text-brand-violet-light">{username}</span>
        </p>
        <p className="text-sm text-white/50">This page doesn't exist yet. The handle could be yours.</p>
        <a
          href={`https://vergr.app/linkinbio?handle=${encodeURIComponent(username || '')}`}
          className="mt-3 px-5 py-2.5 rounded-full text-sm font-semibold text-white"
          style={{ background: 'linear-gradient(135deg, #7B1FFF, #B44FFF)' }}
        >
          Claim it free
        </a>
        <a href="https://vergr.app" className="text-white/40 text-xs mt-1 hover:text-white/70">
          What's Vergr?
        </a>
      </div>
    );
  }

  // Whole-page link forwarding (Cat 5). Honours an optional countdown.
  const fwd = data?.redirect;
  if (fwd?.enabled && fwd.url) {
    return <ForwardScreen url={fwd.url} seconds={fwd.countdown || 0} name={data.displayName} />;
  }

  const deepLink = (deep, fallback) => {
    window.location = deep;
    setTimeout(() => (window.location = fallback), 1500);
  };

  // Append the creator's UTM tags to an outbound URL (Cat 7).
  const withUtm = (raw) => {
    const u = data?.utm;
    if (!u?.enabled || !raw) return raw;
    try {
      const url = new URL(raw);
      if (u.source) url.searchParams.set('utm_source', u.source);
      if (u.medium) url.searchParams.set('utm_medium', u.medium);
      if (u.campaign) url.searchParams.set('utm_campaign', u.campaign);
      return url.toString();
    } catch { return raw; }
  };

  const handlers = {
    onBlock: (block) => {
      switch (block.type) {
        case 'link':
        case 'product':
          trackBlockClick(uid, block.id);
          if (block.url) window.open(withUtm(block.url), '_blank', 'noopener');
          break;
        case 'image':
          if (block.link) {
            trackBlockClick(uid, block.id);
            window.open(withUtm(block.link), '_blank', 'noopener');
          }
          break;
        case 'message':
          trackMessageTap(uid);
          deepLink(`vergr://chat/new?uid=${uid}`, `https://vergr.app/install?ref=${uid}&from=vergrme`);
          break;
        case 'email':
          trackEmailTap(uid);
          if (block.email) window.location = `mailto:${block.email}`;
          break;
        case 'tip':
          trackTipTap(uid);
          deepLink(`vergr://tip?uid=${uid}`, `https://vergr.app/install?ref=${uid}&from=vergrme`);
          break;
        case 'vergr_stream':
          trackBlockClick(uid, block.id);
          deepLink(`vergr://stream/${block.streamId || uid}`, block.webUrl || `https://vergr.app/@${data.username}`);
          break;
        case 'vergr_tournament':
          trackBlockClick(uid, block.id);
          deepLink(`vergr://tournament/${block.tournamentId}`, `https://vergr.app/tournaments/${block.tournamentId}`);
          break;
        case 'vergr_event':
          trackBlockClick(uid, block.id);
          window.open(`https://vergr.app/e/${block.eventId}`, '_blank', 'noopener');
          break;
        case 'vergr_squad':
          trackBlockClick(uid, block.id);
          deepLink(`vergr://squads/${block.squadId}`, `https://vergr.app/squads/${block.squadId}`);
          break;
        case 'vergr_group':
          trackBlockClick(uid, block.id);
          deepLink(`vergr://chat/${block.groupId}`, `https://vergr.app/messages/${block.groupId}`);
          break;
        case 'invite':
          trackBlockClick(uid, block.id);
          window.open(`https://vergr.app/reflink?ref=${uid}`, '_blank', 'noopener');
          break;
        case 'support': {
          trackBlockClick(uid, block.id);
          const su = supportUrl(block.provider, block.handle);
          if (su) window.open(withUtm(su), '_blank', 'noopener');
          break;
        }
        case 'membership':
          trackBlockClick(uid, block.id);
          deepLink(
            `vergr://profile/${data.username}?subscribe=1${block._tierId ? `&tier=${block._tierId}` : ''}`,
            `https://vergr.app/install?ref=${uid}&from=vergrme`,
          );
          break;
        case 'digital_product': {
          trackBlockClick(uid, block.id);
          const viewer = auth.currentUser?.uid;
          const p = block._product || {};
          // Permalink products are checked BEFORE the sign-in gate on purpose:
          // checkout happens in Shopify with Shopify's own payment, so no
          // Vergr wallet is involved. Funnelling a signed-out visitor into an
          // app install here would kill the merchant's conversion for no
          // reason — this is the one product type an anonymous visitor can buy.
          if (isPermalinkProduct(p)) {
            if ((p.variants || []).length > 1) { setCheckout(block); break; }
            if (!openCartCheckout(p, (p.variants || [])[0])) {
              window.alert('This product is temporarily unavailable.');
            }
            break;
          }
          if (!viewer) {
            // Coin checkout needs a Vergr wallet — funnel signed-out visitors in.
            deepLink(`vergr://u/${data.username}`, `https://vergr.app/install?ref=${uid}&from=vergrme`);
            break;
          }
          if (p.kind === 'physical') {
            // Physical needs a shipping address — open the checkout sheet.
            setCheckout(block);
            break;
          }
          const doDownload = () => openVergrMeDownload(uid, block.productId).catch((e) => {
            window.alert(e?.message || 'Download failed — try again.');
          });
          if (block._owned || viewer === uid) { doDownload(); break; }
          const price = Number(p.priceCoins || 0);
          if (!window.confirm(`Buy "${p.name || 'this product'}" for ${price.toLocaleString()} coins?`)) break;
          purchaseVergrMeProduct(uid, block.productId)
            .then(() => {
              // Flip this block to owned so the button reads Download, then
              // hand the file over immediately.
              setData((d) => (d ? {
                ...d,
                blocks: (d.blocks || []).map((b) => (b.id === block.id ? { ...b, _owned: true } : b)),
              } : d));
              doDownload();
            })
            .catch((e) => {
              const msg = e?.message || '';
              if (/Need \d/.test(msg)) {
                if (window.confirm(`${msg}\n\nTop up your wallet?`)) window.open('https://vergr.app/wallet/buy', '_blank', 'noopener');
              } else {
                window.alert(msg || 'Purchase failed — you were not charged.');
              }
            });
          break;
        }
        default:
          break;
      }
    },
    onShare: async () => {
      const url = vergrMeUrl(data.username);
      try {
        if (navigator.share) await navigator.share({ title: data.displayName, url });
        else await navigator.clipboard.writeText(url);
      } catch { /* user cancelled */ }
    },
    onSubscribe: () => {
      deepLink(`vergr://profile/${data.username}?follow=1`, `https://vergr.app/install?ref=${uid}&from=vergrme`);
    },
    onLead: async (lead) => {
      // Native contact-form submission → owner's vergrMeLeads (guarded create rule).
      await addDoc(collection(db, 'users', uid, 'vergrMeLeads'), { ...lead, ts: serverTimestamp() });
      trackEmailTap(uid);
    },
  };

  const onPopupTrack = (event, blockId) => {
    if (event === 'email') trackEmailTap(uid);
    else if (event === 'block_click') trackBlockClick(uid, blockId || 'popup');
  };

  return (
    <div style={{ minHeight: '100vh' }}>
      <VergrMeView data={data} avatarUrl={avatarUrl} interactive handlers={handlers} />
      <VergrMePopups uid={uid} popups={data.popups} accent={data.accentColor || '#B44FFF'} onTrack={onPopupTrack} />
      {checkout && (
        <ShippingCheckoutSheet
          block={checkout}
          sellerUid={uid}
          onClose={() => setCheckout(null)}
        />
      )}
    </div>
  );
}

// Physical-product checkout: shipping address form → purchase CF (coins
// debited, order placed with the seller). Kept dark/self-styled — this
// renders over the creator's themed page, not inside the app shell.
function ShippingCheckoutSheet({ block, sellerUid, onClose }) {
  const p = block._product || {};
  // Synced Shopify products carry variants (size, colour…). Auto-select when
  // there is exactly one, so a single-variant product keeps a one-tap buy.
  const variants = Array.isArray(p.variants) ? p.variants : [];
  const [variantId, setVariantId] = useState(() => (variants.length === 1 ? variants[0].id : ''));
  const variant = variants.find((v) => v.id === variantId) || null;
  const soldOut = (v) => v.available === false || (typeof v.stock === 'number' && v.stock <= 0);

  // A seller override prices the whole product; otherwise each variant prices
  // itself. Mirrors the server, which re-reads both and never trusts this.
  const price = Number(
    (variant && p.priceOverridden !== true && Number(variant.priceCoins) > 0)
      ? variant.priceCoins
      : p.priceCoins || 0
  );
  const ship = Math.max(0, Number(p.shippingCoins) || 0);
  const total = price + ship;
  const [form, setForm] = useState({ name: '', address1: '', address2: '', city: '', postal: '', country: '', phone: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  // Permalink products collect nothing here: Shopify's own checkout takes the
  // address, payment and tax. This sheet is only the variant picker for them.
  const permalink = isPermalinkProduct(p);
  const idemKey = useState(() => `${block.productId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)[0];

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const inp = 'w-full bg-[#1A1A2A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-[#B44FFF]';

  const submit = async () => {
    if (variants.length > 1 && !variantId) { setError('Choose an option first.'); return; }
    if (permalink) {
      if (!openCartCheckout(p, variant || variants[0])) {
        setError('This product is temporarily unavailable.');
        return;
      }
      onClose();
      return;
    }
    for (const k of ['name', 'address1', 'city', 'postal', 'country']) {
      if (!form[k].trim()) { setError('Fill in your name and full address.'); return; }
    }
    setBusy(true); setError('');
    try {
      await purchaseVergrMeProduct(sellerUid, block.productId, {
        shipping: form,
        idempotencyKey: idemKey,
        ...(variantId ? { variantId } : {}),
      });
      setDone(true);
    } catch (e) {
      const msg = e?.message || 'Purchase failed — you were not charged.';
      setError(msg);
      if (/Need \d/.test(msg) && window.confirm(`${msg}\n\nTop up your wallet?`)) {
        window.open('https://vergr.app/wallet/buy', '_blank', 'noopener');
      }
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-[10003] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
      <div className="relative w-full sm:max-w-md bg-[#14141F] border border-white/10 rounded-t-2xl sm:rounded-2xl p-5 max-h-[90vh] overflow-y-auto text-white">
        {done ? (
          <div className="text-center py-6">
            <div className="text-4xl mb-3">📦</div>
            <h3 className="font-bold text-lg">Order placed!</h3>
            <p className="text-sm text-white/60 mt-2">{total.toLocaleString()} coins paid. The seller will ship "{p.name}" to your address. Track it under My Downloads → Orders on Vergr.</p>
            <button onClick={onClose} className="mt-5 px-6 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, #7B1FFF, #B44FFF)' }}>Done</button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-bold text-base">{permalink ? 'Choose an option' : 'Shipping address'}</h3>
              <button onClick={onClose} disabled={busy} className="w-8 h-8 rounded-lg hover:bg-white/5 text-white/60">✕</button>
            </div>
            <p className="text-xs text-white/50 mb-4">
              {p.name}
              {permalink ? (
                // Store currency, not coins — this order is paid in Shopify.
                <> · <span className="font-semibold text-white">
                  {(variant?.storePrice || p.storePrice || '').toString()} {p.storeCurrency || ''}
                </span></>
              ) : (
                <> · {variants.length > 1 && !variant && <span className="text-white/40">from </span>}
                  <span className="font-semibold text-[#F0A500]">{price.toLocaleString()} coins</span>
                  {ship > 0 && <> + {ship.toLocaleString()} shipping</>} = <span className="font-semibold text-white">{total.toLocaleString()} coins</span>
                </>
              )}
            </p>
            {variants.length > 1 && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-white/70 mb-2">Options</p>
                <div className="flex flex-wrap gap-2">
                  {variants.map((v) => {
                    const out = soldOut(v);
                    const on = v.id === variantId;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        disabled={out || busy}
                        onClick={() => setVariantId(v.id)}
                        className={`px-3 py-2 rounded-lg text-xs font-semibold border transition ${
                          on ? 'border-[#B44FFF] text-white bg-[#B44FFF]/15'
                            : out ? 'border-white/5 text-white/25 line-through cursor-not-allowed'
                              : 'border-white/10 text-white/70 hover:border-white/25'
                        }`}
                      >
                        {v.title || v.sku || 'Option'}
                        {typeof v.stock === 'number' && v.stock > 0 && v.stock <= 5 && (
                          <span className="ml-1.5 text-[10px] text-[#F0A500]">{v.stock} left</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {!permalink && (
            <div className="flex flex-col gap-2.5">
              <input className={inp} placeholder="Full name" value={form.name} onChange={set('name')} autoComplete="name" />
              <input className={inp} placeholder="Address" value={form.address1} onChange={set('address1')} autoComplete="address-line1" />
              <input className={inp} placeholder="Apartment, suite… (optional)" value={form.address2} onChange={set('address2')} autoComplete="address-line2" />
              <div className="flex gap-2.5">
                <input className={inp} placeholder="Postal code" value={form.postal} onChange={set('postal')} autoComplete="postal-code" />
                <input className={inp} placeholder="City" value={form.city} onChange={set('city')} autoComplete="address-level2" />
              </div>
              <div className="flex gap-2.5">
                <input className={inp} placeholder="Country" value={form.country} onChange={set('country')} autoComplete="country-name" />
                <input className={inp} placeholder="Phone (optional)" value={form.phone} onChange={set('phone')} autoComplete="tel" />
              </div>
              <input className={inp} placeholder="Note to seller (optional)" value={form.note} onChange={set('note')} />
            </div>
            )}
            {error && <p className="text-xs text-[#F04060] mt-3">{error}</p>}
            <button onClick={submit} disabled={busy}
              className="mt-4 w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #7B1FFF, #B44FFF)' }}>
              {permalink ? 'Continue to checkout' : (busy ? 'Placing order…' : `Pay ${total.toLocaleString()} coins`)}
            </button>
            <p className="text-[10px] text-white/40 mt-2 text-center">
              {permalink
                ? `Secure checkout on ${p.shopDomain || 'the seller\'s store'}.`
                : 'Your address is shared only with this seller.'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// Whole-page forwarding screen with optional countdown.
function ForwardScreen({ url, seconds, name }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (!seconds || seconds <= 0) { window.location.replace(url); return; }
    const id = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) { clearInterval(id); window.location.replace(url); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [url, seconds]);
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-3 bg-[#0b0b0d] text-white text-center px-6">
      <div className="w-12 h-12 rounded-full border-2 border-brand-violet/30 border-t-brand-violet animate-spin" />
      <p className="text-sm text-white/70">Taking you to {name || 'the destination'}…</p>
      {seconds > 0 && <p className="text-xs text-white/40">Redirecting in {left}s</p>}
      <a href={url} className="text-brand-violet-light text-sm mt-1">Go now</a>
    </div>
  );
}

// Inject the creator's retargeting pixels on the public page (Cat 7). Each runs
// at most once; IDs are creator-supplied and only fire on their own /u/ page.
let pixelsInjected = false;
function injectPixels(pixels) {
  if (!pixels || pixelsInjected || typeof document === 'undefined') return;
  pixelsInjected = true;
  const addScript = (text) => { const s = document.createElement('script'); s.text = text; document.head.appendChild(s); };
  if (pixels.meta) {
    addScript(`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixels.meta}');fbq('track','PageView');`);
  }
  if (pixels.tiktok) {
    addScript(`!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=i;ttq._t=ttq._t||{};ttq._t[e]=+new Date;ttq._o=ttq._o||{};ttq._o[e]=n||{};var o=d.createElement("script");o.type="text/javascript";o.async=!0;o.src=i+"?sdkid="+e+"&lib="+t;var a=d.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('${pixels.tiktok}');ttq.page()}(window,document,'ttq');`);
  }
  if (pixels.snap) {
    addScript(`(function(e,t,n){if(e.snaptr)return;var a=e.snaptr=function(){a.handleRequest?a.handleRequest.apply(a,arguments):a.queue.push(arguments)};a.queue=[];var s='script',r=t.createElement(s);r.async=!0;r.src=n;var u=t.getElementsByTagName(s)[0];u.parentNode.insertBefore(r,u)})(window,document,'https://sc-static.net/scevent.min.js');snaptr('init','${pixels.snap}');snaptr('track','PAGE_VIEW');`);
  }
  if (pixels.ga) {
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${pixels.ga}`;
    document.head.appendChild(s);
    addScript(`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${pixels.ga}');`);
  }
}
