// NativeMyMembershipsScreen — dedicated phone build of /memberships.
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import TopBar from '../../../components/TopBar';
import Icon from '../../../components/Icon';
import BadgeGem from '../../../components/membership/BadgeGem';
import { getMyMemberships, cancelMembershipSub } from '../../../firebase/firestore';
import { useUI } from '../../../context/UIContext';
import UserName from '../../../components/UserName';

export default function NativeMyMembershipsScreen() {
  const navigate = useNavigate();
  const { showToast } = useUI();
  const [subs, setSubs] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => { try { setSubs(await getMyMemberships()); } catch { setSubs([]); } };
  useEffect(() => { load(); }, []);

  const doCancel = async (sub) => {
    setBusy(true);
    try {
      await cancelMembershipSub(sub.id);
      setSubs((prev) => prev.map((s) => (s.id === sub.id ? { ...s, autoRenew: false, cancelAtPeriodEnd: true } : s)));
      showToast('Membership will not renew', 'success');
      setConfirming(null);
    } catch (err) { showToast('Could not cancel', 'error'); }
    setBusy(false);
  };

  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-dark)', paddingBottom: 'calc(88px + env(safe-area-inset-bottom, 0px))' }}>
      <TopBar title="My Memberships" showBack />
      <div className="px-4 py-5">
        {subs === null ? (
          <div className="py-20 text-center text-text-muted"><Icon name="progress_activity" className="animate-spin" /></div>
        ) : subs.length === 0 ? (
          <div className="bg-surface-1 border border-white/[0.06] rounded-3xl p-10 text-center mt-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-violet to-brand-pink flex items-center justify-center mx-auto mb-4">
              <Icon name="workspace_premium" filled size={28} className="text-white" />
            </div>
            <div className="font-syne font-bold text-lg text-white">You're not supporting any creators yet</div>
            <p className="text-text-secondary text-sm mt-1.5 max-w-sm mx-auto">Join a creator's membership to get badges, custom emotes, members-only streams and more.</p>
            <button onClick={() => navigate('/explore')} className="mt-5 px-5 py-3 rounded-xl bg-gradient-to-r from-brand-violet to-brand-pink text-white font-semibold text-sm active:scale-95 transition-transform">Discover creators</button>
          </div>
        ) : (
          <div className="space-y-3">
            {subs.map((s) => (
              <div key={s.id} className="bg-surface-1 border border-white/[0.06] rounded-2xl p-4">
                <div className="flex items-center gap-3.5">
                  <button onClick={() => navigate(`/user/${s.creatorId}`)} className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-violet to-brand-pink shrink-0 overflow-hidden">
                    {s.creator?.avatar && <img src={s.creator.avatar} alt="" className="w-full h-full object-cover" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-white truncate"><UserName user={s.creator} masked fallback={'Creator'} /></span>
                      {s.creator?.isVerified && <Icon name="verified" filled size={15} style={{ color: '#B44FFF' }} />}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="inline-flex items-center gap-1.5"><BadgeGem color={s.badge?.color} icon={s.badge?.icon} size={18} /><span className="text-xs text-text-secondary">{s.tierName}</span></span>
                      <span className="text-text-muted">·</span>
                      <span className="text-xs font-dmmono text-brand-gold">● {(s.priceCoins || 0).toLocaleString()}/mo</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-xs ${s.cancelAtPeriodEnd ? 'text-brand-ember' : 'text-text-secondary'}`}>{s.cancelAtPeriodEnd ? 'Ends' : 'Renews'} {fmtDate(s.renewsAt)}</div>
                    {!s.cancelAtPeriodEnd && <button onClick={() => setConfirming(s.id)} className="text-xs text-text-muted active:text-brand-ember mt-1.5 py-1">Cancel</button>}
                  </div>
                </div>

                {confirming === s.id && (
                  <div className="mt-3 pt-3 border-t border-white/[0.06] flex items-center gap-3 flex-wrap">
                    <div className="text-xs text-text-secondary flex-1 min-w-[200px]">You'll keep {s.tierName} access until <span className="text-white font-dmmono">{fmtDate(s.renewsAt)}</span>, then it won't renew.</div>
                    <button onClick={() => setConfirming(null)} className="px-3.5 py-2 rounded-lg bg-white/5 text-text-secondary text-xs">Keep it</button>
                    <button onClick={() => doCancel(s)} disabled={busy} className="px-3.5 py-2 rounded-lg bg-brand-ember/15 text-brand-ember text-xs font-semibold disabled:opacity-50">{busy ? '…' : 'Cancel membership'}</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
