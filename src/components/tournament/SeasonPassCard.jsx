// SeasonPassCard — sells a host's season pass (access to all their ticketed
// events for a window). Reads host config from creators/{hostUid}.seasonPass
// and the viewer's active pass from event_season_passes. Renders nothing if
// the host doesn't offer a pass or the viewer is the host.
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import Icon from '../Icon';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { purchaseSeasonPass } from '../../firebase/firestore';

const expMs = (v) => v?.toMillis?.() ?? (v?.seconds ? v.seconds * 1000 : (typeof v === 'number' ? v : 0));

export default function SeasonPassCard({ hostUid, hostName }) {
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const [cfg, setCfg] = useState(undefined); // undefined = loading
  const [pass, setPass] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!hostUid) return;
    let alive = true;
    getDoc(doc(db, 'creators', hostUid))
      .then((s) => { if (alive) setCfg(s.exists() ? (s.data().seasonPass || null) : null); })
      .catch(() => { if (alive) setCfg(null); });
    if (currentUser?.uid) {
      getDoc(doc(db, 'event_season_passes', `${hostUid}_${currentUser.uid}`))
        .then((s) => { if (alive && s.exists()) setPass(s.data()); }).catch(() => {});
    }
    return () => { alive = false; };
  }, [hostUid, currentUser?.uid]);

  if (cfg === undefined || !cfg || !cfg.enabled) return null;
  if (currentUser?.uid === hostUid) return null;

  const active = pass && expMs(pass.expiresAt) > Date.now();
  const price = cfg.priceCoins || 0;
  const until = active ? new Date(expMs(pass.expiresAt)).toLocaleDateString(undefined, { dateStyle: 'medium' }) : null;

  const buy = async () => {
    if (!currentUser) { navigate('/login'); return; }
    setBusy(true);
    try {
      const r = await purchaseSeasonPass(hostUid);
      showToast('Season pass active — enjoy!', 'success');
      setPass({ expiresAt: r.expiresAt });
    } catch (e) {
      showToast(e?.message || 'Could not buy pass', 'error');
    }
    setBusy(false);
  };

  return (
    <div className="rounded-2xl bg-gradient-to-br from-brand-gold/15 to-brand-violet/5 border border-brand-gold/30 p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon name="card_membership" size={18} className="text-brand-gold" />
        <span className="text-text-primary text-sm font-bold">{cfg.name || 'Season Pass'}</span>
        {price > 0 && <span className="ml-auto text-brand-gold font-dmmono font-bold tabular-nums">{price.toLocaleString()}c</span>}
      </div>
      <p className="text-text-muted text-[12px] mb-3">
        Access every ticketed event from {hostName || 'this host'} for {cfg.durationDays || 30} days.
      </p>
      {active ? (
        <div className="py-2.5 rounded-xl bg-brand-gold/10 border border-brand-gold/30 text-brand-gold text-center text-sm font-bold flex items-center justify-center gap-2">
          <Icon name="check_circle" size={18} /> Active until {until}
        </div>
      ) : (
        <button onClick={buy} disabled={busy}
          className="w-full py-3 rounded-xl bg-brand-gold text-bg-dark font-bold text-sm hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50">
          {busy ? 'Processing…' : currentUser ? (price > 0 ? `Buy pass — ${price.toLocaleString()}c` : 'Get pass') : 'Sign in to buy'}
        </button>
      )}
    </div>
  );
}
