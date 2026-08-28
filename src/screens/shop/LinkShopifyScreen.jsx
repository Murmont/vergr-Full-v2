// Landing page for the Shopify app's "Connect Vergr account" button.
//
// The merchant is sent here from inside their Shopify admin carrying a
// one-time code. Signing in here and confirming is what ties the store to a
// Vergr account — until that happens the app is installed but has no user to
// publish products to.

import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import UserName from '../../components/UserName';

export default function LinkShopifyScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { currentUser, loading: authLoading } = useAuth();
  const code = params.get('code') || '';

  const [state, setState] = useState('idle'); // idle | working | done | error
  const [error, setError] = useState('');
  const [shop, setShop] = useState('');

  // Preserve the code across sign-in: a merchant who is not logged in gets
  // bounced to /login, and the code must survive that round trip or they land
  // back here with nothing to claim.
  useEffect(() => {
    if (code) sessionStorage.setItem('vergr_shopify_link_code', code);
  }, [code]);

  useEffect(() => {
    if (authLoading) return;
    if (!currentUser) {
      navigate(`/login?next=${encodeURIComponent(`/shop/link-shopify?code=${code}`)}`, { replace: true });
    }
  }, [authLoading, currentUser, code, navigate]);

  const link = async () => {
    const c = code || sessionStorage.getItem('vergr_shopify_link_code') || '';
    if (!c) { setError('Missing link code. Open the app in Shopify and try again.'); setState('error'); return; }
    setState('working'); setError('');
    try {
      const res = await httpsCallable(functions, 'linkShopifyStore')({ code: c });
      setShop(res.data?.shop || '');
      sessionStorage.removeItem('vergr_shopify_link_code');
      setState('done');
    } catch (e) {
      setError(e?.message || 'Could not link this store.');
      setState('error');
    }
  };

  if (authLoading || !currentUser) return null;

  return (
    <div className="min-h-screen bg-bg-dark text-white flex items-center justify-center px-5">
      <div className="w-full max-w-md bg-surface-1 border border-white/10 rounded-2xl p-6">
        {state === 'done' ? (
          <>
            <div className="text-3xl mb-3">✅</div>
            <h1 className="text-lg font-bold mb-2">Store connected</h1>
            <p className="text-sm text-text-secondary mb-5">
              {shop ? <><span className="text-white">{shop}</span> is now linked to your Vergr account. </> : null}
              Your products will appear on your Vergr page shortly.
            </p>
            <button
              onClick={() => navigate('/shop/products')}
              className="w-full py-3 rounded-xl text-sm font-bold text-white"
              style={{ background: 'linear-gradient(135deg,#7B1FFF,#B44FFF)' }}
            >
              Open Vergr Shop
            </button>
          </>
        ) : (
          <>
            <h1 className="text-lg font-bold mb-2">Connect your Shopify store</h1>
            <p className="text-sm text-text-secondary mb-5">
              This links your Shopify store to <b className="text-white">@<UserName user={currentUser} masked fallback={'your account'} /></b> so
              your products can appear on your Vergr page. Buyers check out in your own
              Shopify checkout, and Vergr takes no cut of those sales.
            </p>
            {error && <p className="text-xs text-brand-ember mb-3">{error}</p>}
            <button
              onClick={link}
              disabled={state === 'working'}
              className="w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#7B1FFF,#B44FFF)' }}
            >
              {state === 'working' ? 'Connecting…' : 'Connect this store'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
