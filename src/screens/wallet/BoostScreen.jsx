import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import Icon from '../../components/Icon';
import { CoinIcon } from '../../components/CoinIcon';
import TopBar from '../../components/TopBar';
import InfoTooltip from '../../components/InfoTooltip';
import { BOOST_COSTS, COIN_PACKS } from '../../utils/vpSystem';
import { getUserPosts, getUserSquads } from '../../firebase/firestore';
import UserAvatar from '../../components/UserAvatar';

// Coins are natively USD. Derive the per-coin rate from the Starter pack rather
// than hardcoding one, so this can never drift from what checkout charges.
const STARTER_PACK = COIN_PACKS[0];
const USD_PER_COIN = STARTER_PACK ? STARTER_PACK.priceUSD / STARTER_PACK.coins : 0.0127;
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';

export default function BoostScreen() {
  const [purchasing, setPurchasing] = useState(null);
  const [picker, setPicker] = useState(null);        // { type, kind, items, loading }
  const { currentUser } = useAuth();
  const { wallet } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  const preselectedType = params.get('type');
  const targetId = params.get('id');

  useEffect(() => {
    setRightPanel(null);
    setContentAlign(isDesktop ? 'left' : 'center');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  const balance = wallet?.balance || 0;

  // ⚠ WHICH BOOSTS NEED A TARGET. `profile` boosts the buyer, so it needs none.
  // The rest promote ONE post or squad, and the server now refuses a null id —
  // it used to accept it and charge for a boost that promoted nothing.
  const NEEDS_PICK = { post: 'post', lfg: 'post', squad: 'squad' };

  const handleBoost = async (type, explicitId) => {
    const boost = BOOST_COSTS[type];
    if (!boost || !currentUser) return;

    // No target yet and this boost needs one: choose it here rather than
    // sending the user away or spending their coins on nothing.
    const chosen = explicitId || targetId;
    if (NEEDS_PICK[type] && !chosen) { openPicker(type); return; }
    if (balance < boost.coins) {
      showToast('Not enough coins — buy more first', 'error');
      return;
    }

    setPurchasing(type);
    try {
      // Every purchase on this screen used to FAIL (audit A31). It debited the
      // wallet from the browser, but `balance` and `totalSpent` went server-only
      // in the 2026-08-16 pass, so the write was refused and the user got a
      // generic "Boost failed" with no path that could ever succeed.
      //
      // `purchaseBoost` does the debit, the boosts doc and the ledger row in ONE
      // transaction (the old code did three sequential unbatched writes, so a
      // failure after the first left a charge with no boost) and prices it
      // server-side from its own BOOST_COSTS.
      const res = await httpsCallable(getFunctions(undefined, 'europe-west1'), 'purchaseBoost')({
        type, targetId: chosen || null,
      });
      // The VP figure comes back from the server. The old toast hardcoded
      // "+10 VP" while calling an awardVP shim that ignored its arguments.
      const vp = res?.data?.vp || 0;
      showToast(`${boost.label} activated!${vp ? ` +${vp} VP` : ''}`, 'success');
      navigate(-1);
    } catch (err) {
      console.error(err);
      // Surface the server's reason (e.g. the exact shortfall) instead of a
      // blanket failure the user cannot act on.
      showToast(err?.message || 'Boost failed', 'error');
    }
    setPurchasing(null);
  };

  // Load the things this boost could apply to. Posts and squads the CALLER owns
  // — the server checks ownership again, so this list is convenience, not the
  // security boundary.
  const openPicker = async (type) => {
    const kind = NEEDS_PICK[type];
    setPicker({ type, kind, items: [], loading: true });
    try {
      if (kind === 'squad') {
        const squads = await getUserSquads(currentUser.uid);
        setPicker({
          type, kind, loading: false,
          // Only an owner can boost a squad, so do not offer ones you merely
          // belong to — the server would reject them.
          items: (squads || []).filter((sq) => sq.ownerId === currentUser.uid),
        });
      } else {
        const posts = await getUserPosts(currentUser.uid, 20);
        // An LFG boost is for a looking-for-teammates post; a post boost is for
        // anything else. Offering the wrong ones is how someone pays 25 coins to
        // boost a photo.
        const wantLfg = type === 'lfg';
        setPicker({
          type, kind, loading: false,
          items: (posts || []).filter((po) => (po.type === 'lfg') === wantLfg),
        });
      }
    } catch {
      setPicker(null);
      showToast('Could not load what you can boost', 'error');
    }
  };

  const BOOST_ICONS = { post: 'trending_up', profile: 'person_search', lfg: 'group_add', squad: 'shield', stream: 'sensors' };
  const BOOST_COLORS = { post: '#FF4D6A', profile: '#7B6FFF', lfg: '#B44FFF', squad: '#C87FFF', stream: '#4DA3FF' };

  return (
    <div className="min-h-screen pb-20 lg:pb-8">
      <TopBar title="Boost" showBack />

      <div className={`px-4 py-4 ${isDesktop ? 'max-w-lg' : ''}`}>
        <InfoTooltip id="boost_intro" icon="rocket_launch" color="#7B6FFF" title="Boost your visibility">
          Pay coins to promote your content. Your post, profile, or listing gets shown to more people for the duration. Boosts also earn you 10 VP each.
        </InfoTooltip>

        {/* Balance */}
        <div className="flex items-center gap-2 mb-4 px-1">
          <CoinIcon size={16} />
          <span className="text-brand-gold font-bold font-dmmono text-sm">{balance.toLocaleString()}</span>
          <span className="text-text-muted text-xs">coins available</span>
        </div>

        {/* Boost options */}
        <div className="space-y-2">
          {Object.entries(BOOST_COSTS).map(([type, boost]) => {
            const canAfford = balance >= boost.coins;
            const isHighlighted = preselectedType === type;
            const color = BOOST_COLORS[type];
            return (
              <div key={type} className={`p-4 rounded-2xl border transition-all ${isHighlighted ? 'border-brand-violet/40 bg-brand-violet/5' : 'border-white/[0.04] bg-surface-1'}`}>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${color}15` }}>
                    <Icon name={BOOST_ICONS[type]} size={20} style={{ color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-text-primary text-sm font-bold">{boost.label}</p>
                    <p className="text-text-secondary text-xs mt-0.5">{boost.desc}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-brand-gold text-xs font-bold font-dmmono">{boost.coins} coins</span>
                      {/* Was `€{coins * 0.01}` — a euro symbol on a natively-USD
                          ladder, at a hardcoded rate that matched neither the
                          old EUR anchor nor the current USD one (audit A28).
                          Derived from the Starter pack, like everywhere else. */}
                      <span className="text-text-muted text-[10px]">${(boost.coins * USD_PER_COIN).toFixed(2)}</span>
                    </div>
                  </div>
                  <button onClick={() => handleBoost(type)} disabled={!canAfford || purchasing === type}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
                      canAfford ? 'bg-brand-violet text-white' : 'bg-surface-3 text-text-muted'
                    } disabled:opacity-50`}>
                    {purchasing === type ? '...' : canAfford ? 'Boost' : 'Need coins'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {balance < 25 && (
          <button onClick={() => navigate('/buy-coins')} className="w-full mt-4 py-3 rounded-xl bg-brand-gold/10 border border-brand-gold/20 text-brand-gold text-sm font-bold">
            Buy Coins to Boost
          </button>
        )}
      </div>

      {/* Choose what to boost. Opens only when a boost needs a target and none
          came in on the URL — arriving from the wallet's Boosts tab, that is
          always. Before this existed the tab sent people to a screen that could
          not complete the purchase. */}
      {picker && (
        <div
          onClick={() => setPicker(null)}
          className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.7)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md bg-surface-1 rounded-t-2xl sm:rounded-2xl p-5"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 20px)' }}
          >
            <p className="text-text-primary font-bold text-sm">
              {picker.kind === 'squad' ? 'Which squad?' : 'Which post?'}
            </p>
            <p className="text-text-secondary text-xs mt-0.5 mb-3">
              {BOOST_COSTS[picker.type]?.desc}
            </p>

            {picker.loading && (
              <p className="text-text-muted text-xs py-6 text-center">Loading…</p>
            )}

            {!picker.loading && picker.items.length === 0 && (
              <div className="py-6 text-center">
                <p className="text-text-secondary text-xs">
                  {picker.kind === 'squad'
                    ? 'You do not own a squad yet.'
                    : picker.type === 'lfg'
                      ? 'You have no looking-for-teammates posts.'
                      : 'You have no posts to boost yet.'}
                </p>
                <button
                  onClick={() => { setPicker(null); navigate(picker.kind === 'squad' ? '/squads' : '/create'); }}
                  className="mt-3 px-4 py-2 rounded-lg text-xs font-bold"
                  style={{ background: 'linear-gradient(135deg,#7B1FFF,#B44FFF)', color: '#fff' }}
                >
                  {picker.kind === 'squad' ? 'Create a squad' : 'Create a post'}
                </button>
              </div>
            )}

            <div className="space-y-2 max-h-[46vh] overflow-y-auto">
              {picker.items.map((it) => (
                <button
                  key={it.id}
                  onClick={() => { const t = picker.type; setPicker(null); handleBoost(t, it.id); }}
                  className="w-full text-left p-3 rounded-xl bg-surface-2 hover:bg-white/[0.06] transition-colors"
                >
                  {picker.kind === 'squad' ? (
                    <div className="flex items-center gap-3">
                      <UserAvatar src={it.avatar} size={32} />
                      <div className="min-w-0">
                        <p className="text-text-primary text-sm font-bold truncate">{it.name}</p>
                        <p className="text-text-muted text-[11px]">{it.memberCount || 0} members</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-text-primary text-sm line-clamp-2">
                      {it.content?.trim() || `Your ${it.type || 'post'}`}
                    </p>
                  )}
                </button>
              ))}
            </div>

            <button
              onClick={() => setPicker(null)}
              className="w-full mt-3 py-3 rounded-xl text-xs font-bold text-text-secondary"
              style={{ background: 'rgba(255,255,255,0.05)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
