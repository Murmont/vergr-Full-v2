// Refer-a-Friend — server payouts: referrer +5,000 VP, referee +3,000 VP.
// Eligibility gated server-side (signup via link + phone verified + squad/sub).
// This screen surfaces the link, copy/share UI, invite list, milestones, tips.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import { VPIcon } from '../../components/CoinIcon';
import { REFERRAL_VP_REFERRER, REFERRAL_VP_REFEREE } from '../../utils/vpSystem';

const BASE_URL = 'https://vergr-44494.web.app';

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

export default function ReferralScreen() {
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const { showToast } = useUI();
  const { setRightPanel, setContentAlign } = useLayout();
  const { isMobile, isDesktop } = useResponsive();
  const navigate = useNavigate();

  const referralLink = currentUser ? `${BASE_URL}/?ref=${currentUser.uid}` : `${BASE_URL}/?ref=...`;

  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState({ totalInvites: 0, successfulReferrals: 0, vpEarned: 0 });
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);

  // Owns its own chrome — no left-padded layout
  useEffect(() => {
    setRightPanel(null);
    setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign]);

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
          };
        });

        if (!cancelled) {
          setStats({ totalInvites, successfulReferrals, vpEarned });
          setInvites(list);
        }
      } catch (err) {
        // Empty state is acceptable — fail silently
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

  return (
    <div className="pb-10">
      {isMobile && <TopBar title="Refer a Friend" showBack />}

      <div className="px-4 md:px-7 py-5 md:py-7 max-w-[1200px] mx-auto">
        {!isMobile && (
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => navigate(-1)}
              className="w-9 h-9 rounded-full hover:bg-white/[0.06] flex items-center justify-center text-text-muted hover:text-text-primary transition-colors">
              <Icon name="arrow_back" size={18} />
            </button>
            <h1 className="font-syne text-2xl font-black text-text-primary">Refer a Friend</h1>
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-6">
          {/* ── LEFT / Main ──────────────────────────────────────────── */}
          <div className="flex-1 min-w-0 space-y-5">

            {/* Hero banner */}
            <div className="relative rounded-2xl overflow-hidden min-h-[200px] bg-surface-1 border border-surface-3">
              <div className="absolute inset-0"
                   style={{ background: 'linear-gradient(135deg, #1a0533 0%, #0d0520 40%, #0B0B14 100%)' }} />
              <div className="absolute top-0 right-0 w-72 h-72 rounded-full opacity-25 pointer-events-none"
                   style={{ background: 'radial-gradient(circle, #7B1FFF 0%, transparent 70%)', transform: 'translate(30%, -30%)' }} />
              <div className="absolute bottom-0 left-1/3 w-48 h-48 rounded-full opacity-15 pointer-events-none"
                   style={{ background: 'radial-gradient(circle, #C87FFF 0%, transparent 70%)', transform: 'translateY(30%)' }} />
              <div className="relative z-10 p-7">
                <h2 className="font-syne text-3xl font-black text-text-primary mb-2">Invite friends, both earn VP</h2>
                <p className="text-text-muted text-sm">Higher VP cuts the commission you pay when converting coins → gems.</p>
              </div>
            </div>

            {/* Reward cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <RewardCard
                label="You Earn"
                amount={REFERRAL_VP_REFERRER}
                color="#B44FFF"
                gradient="linear-gradient(135deg, #7B1FFF, #C87FFF)"
                description="When your friend signs up via your link, adds their phone number, and joins a squad or subscribes to Lite/Pro."
              />
              <RewardCard
                label="Friend Earns"
                amount={REFERRAL_VP_REFEREE}
                color="#3D7FFF"
                gradient="linear-gradient(135deg, #5588FF, #7B1FFF)"
                description="Your friend gets 3,000 VP when they sign up, verify their phone number, and join a squad or subscribe."
              />
            </div>

            {/* Invite link */}
            <div className="rounded-2xl bg-surface-1 border border-surface-3 p-5">
              <p className="text-sm font-semibold text-text-primary mb-3">Your Invite Link</p>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="flex-1 bg-bg-dark border border-white/10 rounded-xl px-4 py-3 min-w-0">
                  <span className="text-text-muted text-sm truncate block select-all font-dmmono">{referralLink}</span>
                </div>
                <button onClick={handleCopy}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm shrink-0 transition-all"
                  style={{
                    background: copied ? 'rgba(123,31,255,0.20)' : 'rgba(180,79,255,0.12)',
                    color: '#B44FFF',
                    border: '1px solid rgba(180,79,255,0.40)',
                  }}>
                  <Icon name={copied ? 'check' : 'content_copy'} size={16} />
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                <button onClick={handleNativeShare}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm shrink-0 transition-all bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-text-secondary">
                  <Icon name="ios_share" size={16} /> Share
                </button>
              </div>
            </div>

            {/* Quick share */}
            <div className="rounded-2xl bg-surface-1 border border-surface-3 p-5">
              <p className="text-sm font-semibold text-text-primary mb-4">Quick Share</p>
              <div className="flex flex-wrap gap-3">
                {SHARE_TARGETS.map(t => (
                  <button key={t.id}
                    onClick={() => handleShare(t)}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl border bg-bg-dark text-sm font-medium text-text-secondary transition-all hover:bg-white/[0.04]"
                    style={{ borderColor: t.accent }}>
                    <span className="text-base" style={{ minWidth: 18 }}>{t.emoji}</span>
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

            {/* Your invites */}
            <div className="rounded-2xl bg-surface-1 border border-surface-3 p-5">
              <p className="text-sm font-semibold text-text-primary mb-4">Your Invites</p>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-6 h-6 rounded-full border-2 border-brand-violet-light border-t-transparent animate-spin" />
                </div>
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
                        <p className="text-text-muted text-xs">{inv.verified ? 'Verified ✓' : 'Not yet verified'}</p>
                      </div>
                      <span className={`text-xs font-bold font-dmmono tabular-nums ${inv.verified ? 'text-brand-violet-light' : 'text-text-muted'}`}>
                        {inv.verified ? `+${REFERRAL_VP_REFERRER.toLocaleString()} VP` : 'Pending'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <p className="text-center text-text-muted/60 text-xs pb-2">
              Questions? Check our{' '}
              <a href="#/help" className="text-brand-violet-light hover:underline">Help Center</a>{' '}
              or{' '}
              <a href="#/help" className="text-brand-violet-light hover:underline">contact support</a>.
            </p>
          </div>

          {/* ── RIGHT sidebar ─────────────────────────────────────────── */}
          <aside className="w-full lg:w-[280px] shrink-0 space-y-4 lg:sticky lg:top-6 self-start">
            <SidebarCard title="Referral Stats">
              <Stat icon="group"           color="#B44FFF" label="Total Invites"      value={loading ? '—' : stats.totalInvites} />
              <Stat icon="how_to_reg"      color="#22D17E" label="Successful Referrals" value={loading ? '—' : stats.successfulReferrals} />
              <Stat icon="diamond"         color="#B44FFF" label="VP Earned"          value={loading ? '—' : `${stats.vpEarned.toLocaleString()} VP`} accent />
            </SidebarCard>

            <SidebarCard title="Bonus Rewards">
              {BONUS_MILESTONES.map((m, i) => (
                <div key={i} className="flex items-center gap-3 py-1.5">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${m.gold ? 'bg-brand-gold-light/15' : 'bg-brand-violet/15'}`}>
                    <Icon name={m.icon} size={14} className={m.gold ? 'text-brand-gold-light' : 'text-brand-violet-light'} />
                  </div>
                  <span className="flex-1 text-text-secondary text-[12.5px]">{m.label}</span>
                  <span className={`text-[12.5px] font-bold font-dmmono tabular-nums shrink-0 ${m.gold ? 'text-brand-gold-light' : 'text-brand-violet-light'}`}>
                    {m.reward}
                  </span>
                </div>
              ))}
            </SidebarCard>

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
          </aside>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

function RewardCard({ label, amount, color, gradient, description }) {
  return (
    <div className="rounded-2xl bg-surface-1 border border-surface-3 p-5">
      <p className="text-[10.5px] font-bold text-text-muted uppercase tracking-widest mb-3">{label}</p>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0" style={{ background: gradient }}>
          <VPIcon size={22} />
        </div>
        <span className="text-4xl font-black font-dmmono tabular-nums" style={{ color }}>
          {amount.toLocaleString()} <span className="text-2xl">VP</span>
        </span>
      </div>
      <p className="text-text-muted text-sm leading-relaxed">{description}</p>
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
    <>
      <div className="flex items-center justify-between py-1.5">
        <span className="flex items-center gap-2 text-text-secondary text-[12.5px]">
          <Icon name={icon} size={14} style={{ color }} />
          {label}
        </span>
        <span className="font-bold font-dmmono tabular-nums text-[12.5px]" style={accent ? { color } : undefined}>
          {value}
        </span>
      </div>
    </>
  );
}
