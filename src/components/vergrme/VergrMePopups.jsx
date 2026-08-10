import { useEffect, useState } from 'react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase/config';

// Public-page pop-ups (promote-product + email-collect). Shown once per session,
// a few seconds after load, so they don't fight the first paint. Email leads are
// written to users/{uid}/vergrMeLeads (guarded create rule).
export default function VergrMePopups({ uid, popups, accent = '#B44FFF', onTrack }) {
  const product = popups?.product?.enabled ? popups.product : null;
  const email = popups?.email?.enabled ? popups.email : null;
  const [active, setActive] = useState(null);
  const [done, setDone] = useState(false);
  const [val, setVal] = useState('');

  useEffect(() => {
    if (!product && !email) return;
    const key = `vmpopup_${uid}`;
    if (sessionStorage.getItem(key)) return;
    const which = product ? 'product' : 'email';
    const t = setTimeout(() => { setActive(which); sessionStorage.setItem(key, '1'); }, 3500);
    return () => clearTimeout(t);
  }, [product, email, uid]);

  if (!active) return null;
  const close = () => setActive(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!/.+@.+\..+/.test(val)) return;
    try { await addDoc(collection(db, 'users', uid, 'vergrMeLeads'), { email: val.slice(0, 180), ts: serverTimestamp() }); } catch { /* best-effort */ }
    onTrack?.('email');
    setDone(true);
    setTimeout(close, 1400);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-5" onClick={close}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm bg-[#14141f] rounded-2xl border border-white/10 shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <button onClick={close} className="absolute top-2.5 right-2.5 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/40 text-white text-lg">×</button>

        {active === 'product' && product && (
          <>
            {product.imageUrl && <img src={product.imageUrl} alt="" className="w-full h-44 object-cover" />}
            <div className="p-5">
              <h3 className="text-lg font-bold text-white">{product.name || 'Check this out'}</h3>
              <a href={product.url || '#'} target="_blank" rel="noopener noreferrer" onClick={() => onTrack?.('block_click', 'popup_product')}
                className="mt-4 block w-full text-center py-3 rounded-xl font-bold" style={{ background: accent, color: '#111' }}>
                View now
              </a>
            </div>
          </>
        )}

        {active === 'email' && email && (
          <div className="p-6">
            {done ? (
              <p className="text-center text-white py-6">Thanks! You're on the list 🎉</p>
            ) : (
              <>
                <h3 className="text-lg font-bold text-white">{email.heading || 'Join my list'}</h3>
                {email.description && <p className="text-sm text-white/55 mt-1">{email.description}</p>}
                <form onSubmit={submit} className="mt-4 flex flex-col gap-2">
                  <input type="email" required value={val} onChange={(e) => setVal(e.target.value)} placeholder="you@email.com" className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white outline-none" />
                  <button type="submit" className="w-full py-3 rounded-xl font-bold" style={{ background: accent, color: '#111' }}>Subscribe</button>
                </form>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
