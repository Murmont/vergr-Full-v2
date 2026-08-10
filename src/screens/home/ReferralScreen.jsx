// Refer-a-Friend — server payouts: referrer +5,000 VP, referee +3,000 VP,
// PLUS a coin revenue-share (1%..5% of referrals' coin purchases for 2y).
// Eligibility gated server-side (signup via link + phone verified).
//
// This screen is a TABBED HUB (ReferralHub) rendered in two variants:
//   • standalone (/earn/refer) — its own vertical side-nav on desktop, a
//     hamburger drawer on mobile. Reached from the Earn/Quests "Refer a Friend".
//   • wallet (/wallet/referral) — embedded under WalletLayout's chrome, so it
//     uses a horizontal tab bar (the wallet sidebar is already the outer nav).
// The VP claim flow + quest wiring are UNCHANGED — this is a re-layout only.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListSkeleton } from '../../components/skeletons/GlassSkeletons';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import { IS_NATIVE_BUILD } from '../../utils/platform';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import { QRCodeSVG } from 'qrcode.react';
import { VPIcon } from '../../components/CoinIcon';
import { REFERRAL_VP_REFERRER, REFERRAL_VP_REFEREE } from '../../utils/vpSystem';
import { resolveTier } from '../../utils/tierSystem';

const BASE_URL = 'https://vergr.app';

const BONUS_MILESTONES = [
  { icon: 'group',              label: 'Invite 3 friends',  reward: '+2,000 VP',  gold: false },
  { icon: 'groups',             label: 'Invite 10 friends', reward: '+10,000 VP', gold: false },
  { icon: 'workspace_premium',  label: 'Invite 25 friends', reward: 'VIP Status', gold: true  },
];

const TIPS = [
  { icon: 'group',         color: 'violet', title: 'Invite your squad members', body: "You'll earn more when you invite people who play!" },
  { icon: 'emoji_events',  color: 'gold',   title: 'Share after a win',         body: 'People are more likely to join after seeing you win.' },
  { icon: 'forum',         color: 'blue',   title: 'Use Discord',               body: 'Sharing in Discord servers gets the best results!' },
];

// 3 steps to match the 3 icon nodes baked into the how-it-works banner art.
const HOW_IT_WORKS = [
  { icon: 'person_add', color: '#B44FFF', top: '22.5%', title: 'Share your link',
    body: 'Your friend taps your link and signs up for VERGR.' },
  { icon: 'groups',     color: '#5588FF', top: '48%',   title: 'Friend verifies a phone',
    body: 'They sign up and add a phone number. That is all it takes.' },
  { icon: 'diamond',    color: '#F5C842', top: '72.7%', title: 'You claim, they auto-earn',
    body: 'Claim on the Your Invites tab. Your friend instantly gets 3,000 VP too.' },
];

export const FAQS = [
  { q: "Why can't I claim the VP right after my friend signs up?",
    a: "Because they haven't verified a phone number yet. Once your friend signs up via your link and adds a phone number, your Claim button appears. That's how we know they're a real member." },
  { q: 'Does my friend have to claim their VP?',
    a: "Nope. It's automatic. As soon as you claim your 5,000 VP, they get their 3,000 VP. Nothing to click on their side." },
  { q: 'Can I earn VP for more than one friend?',
    a: 'Yes, every friend who verifies a phone gets you 5,000 VP. Free accounts can do 5 per week, Lite/Pro accounts 20 per week. Vanguard members have no limit.' },
  { q: 'Do I keep earning after they sign up?',
    a: "Yes. On top of the one-time VP reward, you earn 1% in coins on every coin purchase your referrals make, for their first 2 years. If a referral is on an active Lite or Pro plan, your rate goes up by 0.5% (up to a 5% cap), and it drops back down if their plan lapses. Earnings land in your coin balance automatically and show up on the Earnings tab." },
  { q: 'My friend signed up but I don\'t see a Claim button. What now?',
    a: 'They just need to add and verify a phone number. Once they do, your Claim button shows up on the Your Invites tab.' },
  { q: 'We did everything, but I still don\'t see a Claim button. Help?',
    a: "Wait a couple minutes and refresh this screen. If it's still missing, double-check that your friend signed up with your link and verified a phone number. Still stuck? Hit up support." },
];

const SHARE_TARGETS = [
  { id: 'whatsapp', label: 'WhatsApp', emoji: '📱', accent: 'rgba(34,209,126,0.30)',
    url: (link) => `https://wa.me/?text=${encodeURIComponent('Join me on VERGR! ' + link)}` },
  { id: 'discord', label: 'Discord', emoji: '💬', accent: 'rgba(88,101,242,0.40)',
    url: () => 'https://discord.com/channels/@me' },
  { id: 'twitter', label: 'X / Twitter', emoji: '𝕏', accent: 'rgba(255,255,255,0.20)',
    url: (link) => `https://twitter.com/intent/tweet?text=${encodeURIComponent('Join me on VERGR! ' + link)}` },
  { id: 'telegram', label: 'Telegram', emoji: '✈', accent: 'rgba(56,189,248,0.40)',
    url: (link) => `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Join me on VERGR!')}` },
];

const TABS = [
  { id: 'overview', label: 'Overview',       icon: 'dashboard' },
  { id: 'invite',   label: 'Invite & Share', icon: 'ios_share' },
  { id: 'invites',  label: 'Your Invites',   icon: 'group' },
  { id: 'earnings', label: 'Earnings',       icon: 'paid' },
  { id: 'help',     label: 'Help',           icon: 'help' },
];

// Standalone screen (/earn/refer) — its own side-nav / hamburger drawer.
export default function ReferralScreen() {
  return <ReferralHub variant="standalone" />;
}

// Wallet-embedded screen (/wallet/referral) — horizontal tabs under WalletLayout.
export function WalletReferralScreen() {
  return <ReferralHub variant="wallet" />;
}

function ReferralHub({ variant }) {
  const embedded = variant === 'wallet';
  const { currentUser } = useAuth();
  const { profile, wallet } = useUser();
  const { showToast } = useUI();
  const { setRightPanel, setContentAlign } = useLayout();
  const { isMobile } = useResponsive();
  const navigate = useNavigate();

  const referralLink = currentUser ? `${BASE_URL}/reflink?ref=${currentUser.uid}` : `${BASE_URL}/reflink`;

  const [tab, setTab] = useState('overview');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [stats, setStats] = useState({ totalInvites: 0, successfulReferrals: 0, vpEarned: 0 });
  const [invites, setInvites] = useState([]);
  const [claimedFriendIds, setClaimedFriendIds] = useState([]);
  const [claimingId, setClaimingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openFaq, setOpenFaq] = useState(null);

  // Standalone owns its own chrome (no left-padded layout). The wallet variant
  // lives under WalletLayout, which manages its own right panel / alignment.
  useEffect(() => {
    if (embedded) return undefined;
    setRightPanel(null);
    setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [embedded, setRightPanel, setContentAlign]);

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    (async () => {
      try {
        const userSnap = await getDoc(doc(db, 'users', currentUser.uid));
        const data = userSnap.exists() ? userSnap.data() : {};
        const totalInvites = data.referralCount ?? 0;
        const successfulReferrals = data.successfulReferrals ?? 0;
        const vpEarned = data.referralVpEarned ?? 0;

        const q = query(collection(db, 'users'), where('referredBy', '==', currentUser.uid));
        const snap = await getDocs(q);
        const list = snap.docs.map(d => {
          const u = d.data();
          return {
            uid: d.id,
            displayName: u.displayName || u.username || 'Unknown',
            avatar: u.photoURL || u.avatar || null,
            verified: u.phoneVerified ?? false,
            subscribed: resolveTier(u) !== 'free',
          };
        });

        let claimedIds = [];
        try {
          const cq = query(
            collection(db, 'quest_claims'),
            where('userId', '==', currentUser.uid),
            where('questId', '==', 'refer_friend'),
          );
          const cs = await getDocs(cq);
          claimedIds = cs.docs.map(d => d.data().friendId).filter(Boolean);
        } catch (e) { /* eligibility still validated server-side on claim */ }

        if (!cancelled) {
          setStats({ totalInvites, successfulReferrals, vpEarned });
          setInvites(list);
          setClaimedFriendIds(claimedIds);
        }
      } catch (err) {
        console.warn('Referral load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser]);

  const handleCopy = useCallback(() => {
    navigator.clipboard?.writeText(referralLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [referralLink]);

  const handleShare = (target) => {
    const url = target.url(referralLink);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleNativeShare = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Join me on VERGR!', text: 'Sign up via my link and we both earn VP.', url: referralLink });
      } catch {}
    } else {
      handleCopy();
    }
  }, [referralLink, handleCopy]);

  const handleClaimFriend = useCallback(async (friendId) => {
    if (claimingId) return;
    setClaimingId(friendId);
    try {
      const res = await httpsCallable(functions, 'claimQuestReward')({
        questId: 'refer_friend', reward: 5000, title: 'Refer a Friend', friendId,
      });
      setClaimedFriendIds(prev => [...prev, friendId]);
      setStats(prev => ({
        ...prev,
        successfulReferrals: prev.successfulReferrals + 1,
        vpEarned: prev.vpEarned + (res?.data?.reward || REFERRAL_VP_REFERRER),
      }));
      showToast?.(`+${REFERRAL_VP_REFERRER.toLocaleString()} VP claimed! Your friend got ${REFERRAL_VP_REFEREE.toLocaleString()} VP too.`, 'success');
    } catch (err) {
      const msg = err?.message || 'Could not claim yet.';
      if (err?.code === 'already-exists' || /already/i.test(msg)) {
        setClaimedFriendIds(prev => [...prev, friendId]);
        showToast?.('Already claimed for this friend.', 'info');
      } else {
        showToast?.(msg, 'error');
      }
    } finally {
      setClaimingId(null);
    }
  }, [claimingId, showToast]);

  // Coin revenue-share: 1% + 0.5% per active-subbed referral (pool-wide), cap 5%.
  const activeSubbed = useMemo(() => invites.filter(i => i.subscribed).length, [invites]);
  const revenueRate = Math.min(5, 1 + 0.5 * activeSubbed);
  const revenueCoins = wallet?.referralRevenueCoins || 0;

  const pendingClaims = invites.filter(i => i.verified && !claimedFriendIds.includes(i.uid)).length;
  const tabBadges = { invites: pendingClaims };

  // ── Tab content ────────────────────────────────────────────────────
  const renderOverview = () => (
    <div className="space-y-5">
      <div className="relative rounded-2xl overflow-hidden min-h-[200px] bg-surface-1 border border-surface-3">
        <div className="absolute inset-0 bg-cover bg-center"
             style={{ backgroundImage: "url('/brand/refer-hero-bg.webp')" }} />
        <div className="absolute inset-0 pointer-events-none"
             style={{ background: 'linear-gradient(100deg, rgba(11,11,20,0.82) 0%, rgba(13,5,32,0.55) 45%, rgba(13,5,32,0.10) 100%)' }} />
        <div className="relative z-10 p-7">
          <div className="flex items-center gap-2 mb-2">
            <h2 className="font-syne text-3xl font-black text-text-primary">Invite a friend, you both get VP</h2>
            <InfoTip text="VP is your Vergr progression score. The higher your VP, the lower the commission you pay when cashing out coins to gems, and the faster your profile levels up." />
          </div>
          <p className="text-text-secondary text-sm max-w-[34rem]">The more VP you have, the less commission you pay when you cash out.</p>
        </div>
      </div>

      <div className={`grid gap-4 ${IS_NATIVE_BUILD ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
        <RewardCard
          label="You Earn"
          amount={REFERRAL_VP_REFERRER}
          color="#B44FFF"
          tip="Your reward for bringing in a real member. It unlocks once your friend verifies a phone number, then you claim it on the Your Invites tab."
          description="Your friend signs up via your link and verifies a phone number. Then claim 5,000 VP on the Your Invites tab."
        />
        <RewardCard
          label="Friend Earns"
          amount={REFERRAL_VP_REFEREE}
          color="#3D7FFF"
          description="After your friend verifies a phone number, they automatically get 3,000 VP, no need to claim anything."
        />
      </div>

      <RevenueShareCard rate={revenueRate} coins={revenueCoins} activeSubbed={activeSubbed}
                        onSeeEarnings={() => setTab('earnings')} />

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
        <SidebarCard title="Referral Stats">
          <Stat icon="group"      color="#B44FFF" label="Total Invites"        value={loading ? '—' : stats.totalInvites} />
          <Stat icon="how_to_reg" color="#22D17E" label="Successful Referrals" value={loading ? '—' : stats.successfulReferrals} />
          <Stat icon="diamond"    color="#B44FFF" label="VP Earned"            value={loading ? '—' : `${stats.vpEarned.toLocaleString()} VP`} accent />
        </SidebarCard>
        <SidebarCard title="Bonus Rewards">
          {BONUS_MILESTONES.map((m, i) => (
            <div key={i} className="flex items-center gap-3 py-1.5">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${m.gold ? 'bg-brand-gold-light/15' : 'bg-brand-violet/15'}`}>
                <Icon name={m.icon} size={14} className={m.gold ? 'text-brand-gold-light' : 'text-brand-violet-light'} />
              </div>
              <span className="flex-1 text-text-secondary text-[12.5px]">{m.label}</span>
              <span className={`text-[12.5px] font-bold tabular-nums shrink-0 ${m.gold ? 'text-brand-gold-light' : 'text-brand-violet-light'}`}>{m.reward}</span>
            </div>
          ))}
        </SidebarCard>
      </div>
    </div>
  );

  const renderInvite = () => (
    <div className="space-y-5">
      <div className="rounded-2xl bg-surface-1 border border-surface-3 p-5">
        <p className="text-sm font-semibold text-text-primary mb-3">Your Invite Link</p>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="flex-1 bg-bg-dark border border-white/10 rounded-xl px-4 py-3 min-w-0">
            <span className="text-text-muted text-sm truncate block select-all font-dmsans">{referralLink}</span>
          </div>
          <button onClick={handleCopy}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm shrink-0 transition-all"
            style={{
              background: copied ? 'rgba(123,31,255,0.20)' : 'rgba(180,79,255,0.12)',
              color: '#B44FFF', border: '1px solid rgba(180,79,255,0.40)',
            }}>
            <Icon name={copied ? 'check' : 'content_copy'} size={16} />
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button onClick={handleNativeShare}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm shrink-0 transition-all bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-text-secondary">
            <Icon name="ios_share" size={16} /> Share
          </button>
          <button onClick={() => setShowQR(v => !v)}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm shrink-0 transition-all bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-text-secondary">
            <Icon name="qr_code_2" size={16} /> QR
          </button>
        </div>
        {showQR && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <div className="rounded-2xl bg-white p-4">
              <QRCodeSVG value={referralLink} size={196} bgColor="#ffffff" fgColor="#0B0B14" level="M" />
            </div>
            <p className="text-text-muted text-xs">Friends scan this to join with your link</p>
          </div>
        )}
      </div>

      <div className="rounded-2xl bg-surface-1 border border-surface-3 p-5">
        <p className="text-sm font-semibold text-text-primary mb-4">Quick Share</p>
        <div className="flex flex-wrap gap-3">
          {SHARE_TARGETS.map(t => (
            <button key={t.id} onClick={() => handleShare(t)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border bg-bg-dark text-sm font-medium text-text-secondary transition-all hover:bg-white/[0.04]"
              style={{ borderColor: t.accent }}>
              <BrandGlyph id={t.id} />
              {t.label}
            </button>
          ))}
          <button onClick={handleCopy}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border bg-bg-dark text-sm font-medium text-text-secondary hover:border-brand-violet-light/60 hover:bg-brand-violet/[0.08] transition-all"
            style={{ borderColor: 'rgba(255,255,255,0.10)' }}>
            <Icon name="link" size={16} className="text-brand-violet-light" /> Copy Link
          </button>
        </div>
      </div>

      <SidebarCard title="Tips to Earn More">
        {TIPS.map((tip, i) => {
          const colorMap = {
            violet: { bg: 'bg-brand-violet/20', text: 'text-brand-violet-light' },
            gold:   { bg: 'bg-brand-gold-light/20', text: 'text-brand-gold-light' },
            blue:   { bg: 'bg-indigo-500/20', text: 'text-indigo-400' },
          };
          const c = colorMap[tip.color];
          return (
            <div key={i} className="flex gap-3 py-2">
              <div className={`w-8 h-8 rounded-full ${c.bg} flex items-center justify-center shrink-0`}>
                <Icon name={tip.icon} size={14} className={c.text} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-primary leading-snug">{tip.title}</p>
                <p className="text-text-muted text-xs mt-0.5 leading-relaxed">{tip.body}</p>
              </div>
            </div>
          );
        })}
      </SidebarCard>
    </div>
  );

  const renderInvites = () => (
    <div className="rounded-2xl bg-surface-1 border border-surface-3 p-5">
      <p className="text-sm font-semibold text-text-primary mb-4">Your Invites</p>
      {loading ? (
        <ListSkeleton rows={4} />
      ) : invites.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
          <div className="w-16 h-16 rounded-full bg-brand-violet/10 flex items-center justify-center">
            <Icon name="group_add" size={28} className="text-brand-violet-light/70" />
          </div>
          <p className="font-semibold text-text-secondary">No one has signed up via your link yet.</p>
          <p className="text-text-muted text-sm">Share it with a friend to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {invites.map(inv => (
            <div key={inv.uid} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.05] transition-colors">
              {inv.avatar
                ? <img src={inv.avatar} alt={inv.displayName} className="w-9 h-9 rounded-full object-cover" />
                : (
                  <div className="w-9 h-9 rounded-full bg-brand-violet/30 flex items-center justify-center">
                    <Icon name="person" size={16} className="text-brand-violet-light" />
                  </div>
                )
              }
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-text-primary truncate">{inv.displayName}</p>
                <p className="text-text-muted text-xs">{inv.verified ? 'Phone verified ✓' : 'Setup not finished'}{inv.subscribed ? ' · Paid plan' : ''}</p>
              </div>
              {claimedFriendIds.includes(inv.uid) ? (
                <span className="text-xs font-semibold text-brand-violet-light shrink-0">Claimed ✓</span>
              ) : inv.verified ? (
                <button
                  onClick={() => handleClaimFriend(inv.uid)}
                  disabled={claimingId === inv.uid}
                  className="shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-all active:scale-95 disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, #7B1FFF, #C87FFF)', color: '#fff' }}>
                  {claimingId === inv.uid ? '...' : `Claim ${REFERRAL_VP_REFERRER.toLocaleString()} VP`}
                </button>
              ) : (
                <span className="text-xs font-bold tabular-nums text-text-muted shrink-0">Pending</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderEarnings = () => (
    <div className="space-y-5">
      <RevenueShareCard rate={revenueRate} coins={revenueCoins} activeSubbed={activeSubbed} detailed />
      <div className="rounded-2xl bg-surface-1 border border-surface-3 p-5">
        <p className="text-sm font-semibold text-text-primary mb-3">How your rate works</p>
        <ul className="space-y-2.5 text-sm text-text-secondary">
          <li className="flex gap-2.5"><Icon name="check_circle" size={18} style={{ color: '#F5C842' }} className="shrink-0 mt-0.5" /><span>You earn <span className="text-brand-gold-light font-semibold">1%</span> in coins on every coin purchase your referrals make.</span></li>
          <li className="flex gap-2.5"><Icon name="trending_up" size={18} style={{ color: '#F5C842' }} className="shrink-0 mt-0.5" /><span>Each referral on an active Lite or Pro plan adds <span className="text-brand-gold-light font-semibold">+0.5%</span> to your rate, across all your referrals' purchases.</span></li>
          <li className="flex gap-2.5"><Icon name="verified" size={18} style={{ color: '#F5C842' }} className="shrink-0 mt-0.5" /><span>Your rate is capped at <span className="text-brand-gold-light font-semibold">5%</span>, and drops back down if a referral's plan lapses.</span></li>
          <li className="flex gap-2.5"><Icon name="schedule" size={18} style={{ color: '#F5C842' }} className="shrink-0 mt-0.5" /><span>Revenue-share runs for each referral's first <span className="text-brand-gold-light font-semibold">2 years</span>. Earnings land in your coin balance automatically.</span></li>
        </ul>
        <button onClick={() => navigate('/wallet/history')}
          className="mt-4 flex items-center gap-2 text-sm font-semibold text-brand-violet-light hover:underline">
          <Icon name="history" size={16} /> View in wallet history
        </button>
      </div>
    </div>
  );

  const renderHelp = () => (
    <div className="space-y-5">
      <HowItWorksBanner />
      <div className="rounded-2xl bg-surface-1 border border-surface-3 p-5">
        <p className="font-syne text-lg font-bold text-text-primary mb-3">Some questions you might have</p>
        <div className="divide-y divide-white/[0.06]">
          {FAQS.map((f, i) => {
            const open = openFaq === i;
            return (
              <div key={i}>
                <button onClick={() => setOpenFaq(open ? null : i)}
                  className="w-full flex items-center gap-3 text-left py-3">
                  <span className="flex-1 text-sm font-semibold text-text-primary">{f.q}</span>
                  <Icon name={open ? 'expand_less' : 'expand_more'} size={20} className="text-text-muted shrink-0" />
                </button>
                {open && <p className="text-text-muted text-[13px] leading-relaxed pb-3 -mt-1 pr-6">{f.a}</p>}
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-center text-text-muted/60 text-xs pb-2">
        Questions? Check our{' '}
        <a href="/platform/help" className="text-brand-violet-light hover:underline">Help Center</a>{' '}
        or{' '}
        <a href="/platform/help" className="text-brand-violet-light hover:underline">contact support</a>.
      </p>
    </div>
  );

  const RENDER = {
    overview: renderOverview, invite: renderInvite, invites: renderInvites,
    earnings: renderEarnings, help: renderHelp,
  };
  const content = (RENDER[tab] || renderOverview)();
  const activeTab = TABS.find(t => t.id === tab) || TABS[0];

  const selectTab = (id) => { setTab(id); setDrawerOpen(false); };

  // ── Wallet-embedded: horizontal tabs, no side-nav (WalletLayout is the nav) ──
  if (embedded) {
    return (
      <div className="max-w-[860px]">
        <HorizontalTabs tabs={TABS} active={tab} onSelect={setTab} badges={tabBadges} />
        <div className="mt-5">{content}</div>
      </div>
    );
  }

  // ── Standalone: side-nav rail (desktop) / hamburger drawer (mobile) ──
  return (
    <div className="pb-10">
      {isMobile && (
        <header className="sticky top-0 z-40 flex items-center gap-2 px-3 bg-bg-dark/90 backdrop-blur-md border-b border-white/[0.06]"
          style={{ minHeight: 'calc(52px + env(safe-area-inset-top))', paddingTop: 'calc(env(safe-area-inset-top) + 4px)' }}>
          <button onClick={() => navigate(-1)} aria-label="Back"
            className="w-9 h-9 rounded-full hover:bg-white/[0.06] flex items-center justify-center text-text-muted hover:text-text-primary transition-colors">
            <Icon name="arrow_back" size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-syne text-base font-bold text-text-primary truncate">{activeTab.label}</p>
          </div>
          <button onClick={() => setDrawerOpen(true)} aria-label="Menu"
            className="w-9 h-9 rounded-full hover:bg-white/[0.06] flex items-center justify-center text-text-muted hover:text-text-primary transition-colors">
            <Icon name="menu" size={22} />
          </button>
        </header>
      )}

      <div className="px-4 md:px-7 py-5 md:py-7 max-w-[1200px] mx-auto">
        {!isMobile && (
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => navigate(-1)}
              className="w-9 h-9 rounded-full hover:bg-white/[0.06] flex items-center justify-center text-text-muted hover:text-text-primary transition-colors">
              <Icon name="arrow_back" size={18} />
            </button>
            <h1 className="font-syne text-2xl font-black text-text-primary">Refer &amp; Earn</h1>
          </div>
        )}

        <div className="flex gap-6">
          {!isMobile && (
            <SideTabRail tabs={TABS} active={tab} onSelect={setTab} badges={tabBadges} />
          )}
          <div className="flex-1 min-w-0">{content}</div>
        </div>
      </div>

      {isMobile && drawerOpen && (
        <TabDrawer tabs={TABS} active={tab} onSelect={selectTab} onClose={() => setDrawerOpen(false)} badges={tabBadges} />
      )}
    </div>
  );
}

// ─── Tab navigation ────────────────────────────────────────────────

function SideTabRail({ tabs, active, onSelect, badges }) {
  return (
    <aside className="w-56 shrink-0 sticky top-6 self-start">
      <div className="rounded-2xl bg-surface-1 border border-surface-3 p-2 space-y-1">
        {tabs.map(t => {
          const on = t.id === active;
          const badge = badges?.[t.id] || 0;
          return (
            <button key={t.id} onClick={() => onSelect(t.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors relative"
              style={{
                color: on ? '#fff' : 'var(--text-secondary, #9CA3AF)',
                background: on ? 'rgba(180,79,255,0.12)' : 'transparent',
              }}
              onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
              onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent'; }}>
              {on && <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full" style={{ background: '#B44FFF' }} />}
              <Icon name={t.icon} size={18} className={on ? 'text-brand-violet-light' : ''} />
              <span className="flex-1 text-left">{t.label}</span>
              {badge > 0 && (
                <span className="min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, #7B1FFF, #C87FFF)', color: '#fff' }}>{badge}</span>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function HorizontalTabs({ tabs, active, onSelect, badges }) {
  return (
    <div className="flex gap-1 overflow-x-auto no-scrollbar border-b border-white/[0.06] -mx-1 px-1">
      {tabs.map(t => {
        const on = t.id === active;
        const badge = badges?.[t.id] || 0;
        return (
          <button key={t.id} onClick={() => onSelect(t.id)}
            className="relative flex items-center gap-2 px-3.5 py-3 text-sm font-semibold whitespace-nowrap transition-colors"
            style={{ color: on ? '#fff' : 'var(--text-secondary, #9CA3AF)' }}>
            <Icon name={t.icon} size={17} className={on ? 'text-brand-violet-light' : ''} />
            {t.label}
            {badge > 0 && (
              <span className="min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #7B1FFF, #C87FFF)', color: '#fff' }}>{badge}</span>
            )}
            {on && <span className="absolute left-2 right-2 -bottom-px h-[2px] rounded-full" style={{ background: '#B44FFF' }} />}
          </button>
        );
      })}
    </div>
  );
}

function TabDrawer({ tabs, active, onSelect, onClose, badges }) {
  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <div className="absolute left-0 top-0 bottom-0 w-72 max-w-[82vw] bg-surface-1 border-r border-white/[0.08] flex flex-col"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
        <div className="flex items-center justify-between px-4 pb-3 mb-1 border-b border-white/[0.06]">
          <p className="font-syne text-base font-bold text-text-primary">Refer &amp; Earn</p>
          <button onClick={onClose} aria-label="Close"
            className="w-8 h-8 rounded-full flex items-center justify-center text-text-secondary hover:bg-white/[0.06]">
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="p-2 space-y-1">
          {tabs.map(t => {
            const on = t.id === active;
            const badge = badges?.[t.id] || 0;
            return (
              <button key={t.id} onClick={() => onSelect(t.id)}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold transition-colors"
                style={{ color: on ? '#fff' : 'var(--text-secondary, #9CA3AF)', background: on ? 'rgba(180,79,255,0.12)' : 'transparent' }}>
                <Icon name={t.icon} size={19} className={on ? 'text-brand-violet-light' : ''} />
                <span className="flex-1 text-left">{t.label}</span>
                {badge > 0 && (
                  <span className="min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
                    style={{ background: 'linear-gradient(135deg, #7B1FFF, #C87FFF)', color: '#fff' }}>{badge}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

function RevenueShareCard({ rate, coins, activeSubbed, onSeeEarnings, detailed }) {
  return (
    <div className="rounded-2xl bg-surface-1 border border-surface-3 p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Icon name="paid" size={18} style={{ color: '#F5C842' }} />
            <p className="text-sm font-bold text-text-primary">Earn coins when friends buy coins</p>
          </div>
          <p className="text-text-secondary text-sm max-w-[36rem]">
            On top of the VP reward, you earn <span className="text-brand-gold-light font-semibold">1%</span> in
            coins on every coin purchase your referrals make, for their first 2 years. Each referral on an active
            Lite or Pro plan adds <span className="text-brand-gold-light font-semibold">+0.5%</span> to your rate,
            up to <span className="text-brand-gold-light font-semibold">5%</span>.
          </p>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            <p className="text-text-muted text-[11px] uppercase tracking-wide">Your rate</p>
            <p className="font-dmsans font-bold tabular-nums text-brand-gold-light text-2xl leading-none">
              {rate % 1 === 0 ? rate : rate.toFixed(1)}%
            </p>
          </div>
          <div className="w-px h-9 bg-white/10" />
          <div className="text-right">
            <p className="text-text-muted text-[11px] uppercase tracking-wide">Earned</p>
            <p className="font-dmsans font-bold tabular-nums text-text-primary text-2xl leading-none">
              {coins.toLocaleString()}<span className="text-text-muted text-sm font-normal ml-0.5">c</span>
            </p>
          </div>
        </div>
      </div>
      {activeSubbed > 0 && (
        <p className="text-text-muted text-xs mt-3">
          {activeSubbed} of your referrals {activeSubbed === 1 ? 'is' : 'are'} on a paid plan, boosting your rate. It drops back if a plan lapses.
        </p>
      )}
      {onSeeEarnings && !detailed && (
        <button onClick={onSeeEarnings}
          className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-brand-gold-light hover:underline">
          See earnings <Icon name="arrow_forward" size={15} />
        </button>
      )}
    </div>
  );
}

function RewardCard({ label, amount, color, description, tip }) {
  return (
    <div className="rounded-2xl bg-surface-1 border border-surface-3 p-5">
      <div className="flex items-center gap-1.5 mb-3">
        <p className="text-[10.5px] font-bold text-text-muted uppercase tracking-widest">{label}</p>
        {tip && <InfoTip text={tip} size={13} />}
      </div>
      <div className="flex items-center gap-3 mb-3">
        <VPIcon size={44} />
        <span className="text-4xl font-black tabular-nums" style={{ color }}>
          {amount.toLocaleString()} <span className="text-2xl">VP</span>
        </span>
      </div>
      <p className="text-text-muted text-sm leading-relaxed">{description}</p>
    </div>
  );
}

// Hover/focus info tooltip — pure CSS group, works on touch via focus too.
function InfoTip({ text, size = 16 }) {
  return (
    <span className="relative inline-flex group align-middle" tabIndex={0}>
      <Icon name="info" size={size} className="text-text-muted hover:text-text-secondary cursor-help transition-colors" />
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 w-60 -translate-x-1/2 rounded-xl border border-white/10 bg-surface-2 p-3 text-[12px] leading-relaxed text-text-secondary opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100 group-focus:opacity-100">
        {text}
      </span>
    </span>
  );
}

// Official brand glyphs (simple-icons paths) for the share row.
const BRAND_GLYPHS = {
  whatsapp: { color: '#25D366', d: 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z' },
  discord:  { color: '#5865F2', d: 'M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z' },
  twitter:  { color: '#FFFFFF', d: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z' },
  telegram: { color: '#26A5E4', d: 'M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.139-5.061 3.345-.479.329-.913.489-1.302.481-.428-.009-1.252-.242-1.865-.44-.752-.244-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z' },
};

export function BrandGlyph({ id, size = 18 }) {
  const g = BRAND_GLYPHS[id];
  if (!g) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={g.color} aria-hidden="true" style={{ minWidth: size }}>
      <path d={g.d} />
    </svg>
  );
}

export function HowItWorksBanner() {
  return (
    <div className="w-full">
      {/* Mobile: heading sits above the banner art */}
      <p className="md:hidden font-syne text-lg font-bold text-text-primary mb-3">Here's how it actually works</p>
      <div className="relative w-full rounded-2xl overflow-hidden border border-surface-3 bg-surface-1"
           style={{
             backgroundImage: "url('/brand/refer-howitworks-bg.webp')",
             backgroundSize: 'cover', backgroundPosition: 'center',
             aspectRatio: '1774 / 887', containerType: 'inline-size',
           }}>
        {/* Desktop: heading overlaid on the banner */}
        <p className="hidden md:block absolute font-syne font-bold text-text-primary"
           style={{ left: '5.5%', top: '7%', fontSize: 'clamp(13px, 3cqw, 18px)' }}>
          Here's how it actually works
        </p>
        {HOW_IT_WORKS.map((s, i) => (
          <div key={i} className="absolute"
               style={{ left: '14.5%', top: s.top, width: '46%', transform: 'translateY(-50%)' }}>
            <p className="font-bold text-text-primary leading-snug"
               style={{ fontSize: 'clamp(11px, 2.5cqw, 15px)' }}>{i + 1}. {s.title}</p>
            <p className="text-text-secondary leading-snug"
               style={{ fontSize: 'clamp(9px, 2.1cqw, 12.5px)', marginTop: '0.4cqw' }}>{s.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SidebarCard({ title, children }) {
  return (
    <div className="rounded-2xl bg-surface-1 border border-surface-3 p-5">
      <p className="font-semibold text-sm text-text-primary mb-3">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Stat({ icon, color, label, value, accent }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="flex items-center gap-2 text-text-secondary text-[12.5px]">
        <Icon name={icon} size={14} style={{ color }} />
        {label}
      </span>
      <span className="font-bold tabular-nums text-[12.5px]" style={accent ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}
