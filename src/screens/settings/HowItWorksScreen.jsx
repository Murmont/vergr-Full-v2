import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon';
import TopBar from '../../components/TopBar';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';

const SECTIONS = [
  {
    id: 'overview',
    icon: 'stadia_controller',
    color: '#B44FFF',
    title: 'What is VERGR?',
    content: 'VERGR is a live streaming and social platform for gamers and creators. You watch and broadcast live streams, post clips, message friends, and build a squad. Creators are supported directly by their audience through tips, memberships, and paid streams.',
  },
  {
    id: 'economy',
    icon: 'account_balance',
    color: '#F5C542',
    title: 'The VERGR Economy',
    content: 'VERGR runs on two things you can hold: Coins and VP. Coins are bought with real money and spent inside VERGR. VP (VERGR Points) are earned through activity and unlock levels and perks. There is nothing else to hold, and nothing that can be withdrawn, converted or transferred.',
    items: [
      { label: 'Coins (\u25CF)', value: 'Bought with real money. 1 coin = $0.01. Spend on tips, memberships, paid streams, and boosts. A licence to use VERGR features: no cash value, non-transferable, and not redeemable for money.' },
      { label: 'VP (\u2605)', value: 'Earned through activity. Levels up your profile and unlocks perks. VP is not money and cannot be spent or cashed.' },
    ],
    extra: 'When a fan spends coins on a creator, that is revenue VERGR earns. VERGR then owes that creator a share of it and pays it on VERGR\u2019s own schedule. Creators never request a payout, and no balance is ever moved by a user.',
  },
  {
    id: 'earning',
    icon: 'diamond',
    color: '#B44FFF',
    title: 'How Creators Get Paid',
    content: 'Creators are paid a share of the revenue their content generates:',
    items: [
      { label: 'Memberships and paid streams', value: 'Members pay in coins for access. That is revenue VERGR earns, and you are paid a share of it.' },
      { label: 'Receive tips', value: 'When someone tips you with coins, you accrue your share of that revenue straight away.' },
      { label: 'Get paid', value: 'VERGR pays automatically once you reach $100, monthly to begin with, then twice monthly and weekly as your account matures. You never request a payout.' },
    ],
    extra: 'Your share starts at 50% and rises to 80% as your lifetime earnings grow, and it never goes down. It is the only deduction: no separate tip fee, conversion fee or payout fee on top. Identity verification and an account at least 30 days old are required before the first payment.',
  },
  {
    id: 'coins',
    icon: 'paid',
    color: '#F5C542',
    title: 'Free Coin Bonuses',
    content: 'You earn small coin bonuses for high-value actions. These are marketing bonuses — the platform covers them.',
    items: [
      { label: '5-day login streak', value: '5 coins + 50 VP' },
      { label: 'Refer a friend', value: '+5,000 VP for you, +3,000 VP for your friend' },
      { label: 'Lite sub ($4.99/mo)', value: '+1,000 VP + 50 coins / month, 1.5× VP multiplier' },
      { label: 'Pro sub ($9.99/mo)', value: '+3,000 VP + 150 coins / month, 2× VP multiplier' },
      { label: 'Buy coin packs', value: 'Bonus VP on the Titan and Ascendant packs' },
    ],
  },
  {
    id: 'vp',
    icon: 'star',
    color: '#7B6FFF',
    title: 'VP Levels & Perks',
    content: '100 VP levels across 11 ranks, each with its own profile ring. VP is a status and perks ladder, not a money ladder: your revenue share is set by your lifetime earnings, not by VP. After L100 you can optionally Prestige: reset your visible level with a badge (never forced).',
    items: [
      { label: 'Rookie (L1\u201310)', value: 'No ring' },
      { label: 'Contender (L11\u201320)', value: 'Bronze ring' },
      { label: 'Rival (L21\u201330)', value: 'Silver ring' },
      { label: 'Challenger (L31\u201340)', value: 'Gold ring' },
      { label: 'Elite (L41\u201350)', value: 'Platinum ring' },
      { label: 'Champion (L51\u201360)', value: 'Diamond ring' },
      { label: 'Veteran (L61\u201370)', value: 'Onyx ring' },
      { label: 'Legend (L71\u201380)', value: 'Ruby ring' },
      { label: 'Mythic (L81\u201390)', value: 'Mythic ring' },
      { label: 'Ascendant (L91\u201399)', value: 'Ascendant ring' },
      { label: 'Immortal (L100)', value: 'Immortal ring, prestige unlocked' },
    ],
  },
  {
    id: 'tiers',
    icon: 'workspace_premium',
    color: '#C87FFF',
    title: 'Subscription Tiers',
    content: 'VERGR has three tiers. Plans do NOT change your revenue share: the share is set by your lifetime earnings only. Plans give you VP multipliers, monthly bonuses, and feature unlocks.',
    items: [
      { label: 'Free', value: 'Ads, 200MB uploads, 480p streaming, no day-one public streaming' },
      { label: 'Lite ($4.99/mo)', value: 'No ads, 1GB uploads, 720p60 streaming from day one, 1.5\u00d7 VP, scheduled posts, voice messages' },
      { label: 'Pro ($9.99/mo)', value: 'No ads, 5GB uploads, 1080p60 streaming, co-streaming, 2\u00d7 VP, custom vergr.me domain, advanced analytics, priority support' },
    ],
  },
  {
    id: 'squads',
    icon: 'shield',
    color: '#B44FFF',
    title: 'Squads',
    content: 'Squads are your gaming crew. Create or join a squad to chat, run voice hangouts, share media, and climb the squad leaderboard. Every squad has a leadership structure elected by members.',
    items: [
      { label: 'President', value: 'Runs the squad. Set by creator, then monthly elections.' },
      { label: 'Vice President', value: 'Steps in if president is inactive 4+ days.' },
      { label: 'Treasury', value: 'Manages the squad wallet and member contributions.' },
      { label: 'Security', value: 'Moderates chat. Can mute members and start kick votes.' },
      { label: 'Members', value: 'Vote, contribute coins, and participate in everything.' },
    ],
    extra: 'Elections happen on the 1st of every month. Every member gets one vote. The person with the most votes becomes president.',
  },
  {
    id: 'streams',
    icon: 'live_tv',
    color: '#C87FFF',
    title: 'Streaming',
    content: 'You can broadcast straight from the browser or stream in with OBS, and viewers watch and chat inside VERGR. You can also link a Twitch, YouTube, or Kick stream instead, and your VERGR followers will see it and watch the embedded stream in the app. Pro creators can co-stream with a guest, with gameplay in picture-in-picture.',
  },
  {
    id: 'posts',
    icon: 'edit_note',
    color: '#7B6FFF',
    title: 'Creating Content',
    content: 'Post text updates, photos, video clips, articles, LFG requests (looking for group), tier lists, achievements, and polls. Every like you receive earns you 1 coin. Repost and quote other users\' content. Bookmark posts to save them for later.',
    items: [
      { label: 'Text', value: 'Quick thoughts, updates' },
      { label: 'Photo', value: 'Screenshots, up to 10 images' },
      { label: 'Clip', value: 'Short video moments' },
      { label: 'Article', value: 'Long-form guides and blogs' },
      { label: 'LFG', value: 'Find players — game, platform, region, rank' },
      { label: 'Tier List', value: 'Rank anything in S/A/B/C/D tiers' },
      { label: 'Achievement', value: 'Show off your gaming wins' },
      { label: 'Poll', value: 'Ask the community anything' },
    ],
  },
  {
    id: 'moderation',
    icon: 'admin_panel_settings',
    color: '#F5C542',
    title: 'Moderation & Safety',
    content: 'Report any post, comment, or user through the three-dot menu. Reports are reviewed by moderators. Content that hits a report threshold is automatically hidden. Squad Security officers moderate squad chat and can mute or kick members via vote.',
  },
  {
    id: 'payouts',
    icon: 'account_balance',
    color: '#B44FFF',
    title: 'How Creators Are Paid',
    content: 'Nothing on VERGR can be withdrawn, converted or transferred by a user. Coins are a licence to use VERGR features and have no cash value. What does happen is this: when fans spend coins on a creator, VERGR earns that revenue and owes the creator a share of it. VERGR works out what it owes and pays it automatically on a schedule, monthly to begin with, once the balance reaches $100. Anything under the minimum rolls over and is never lost.',
  },
];

export default function HowItWorksScreen() {
  const navigate = useNavigate();
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();
  const [expandedId, setExpandedId] = useState('overview');

  useEffect(() => {
    setRightPanel(null);
    setContentAlign(isDesktop ? 'left' : 'center');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  return (
    <div className="min-h-screen pb-24 lg:pb-8">
      <TopBar showBack title="How VERGR Works" />

      <div className={`px-4 py-4 ${isDesktop ? 'max-w-2xl' : ''}`}>
        {/* Hero */}
        <div className="p-5 rounded-2xl bg-surface-1 border border-white/[0.06] mb-5">
          <h2 className="font-syne text-xl font-bold mb-2">Play. Stream. Earn.</h2>
          <p className="text-text-secondary text-sm leading-relaxed">
            VERGR is built for gamers who want more than just another social feed. 
            Play, post, stream, and build a squad. Creators are paid a share of the revenue their audience generates.
          </p>
        </div>

        {/* Sections */}
        <div className="space-y-2">
          {SECTIONS.map(section => {
            const isExpanded = expandedId === section.id;
            return (
              <div key={section.id} className="rounded-2xl border border-white/[0.06] bg-surface-1 overflow-hidden">
                <button onClick={() => setExpandedId(isExpanded ? null : section.id)}
                  className="w-full flex items-center gap-3 p-4 text-left hover:bg-surface-2/30 transition-colors">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${section.color}15` }}>
                    <Icon name={section.icon} size={20} style={{ color: section.color }} />
                  </div>
                  <span className="flex-1 font-bold text-sm text-text-primary">{section.title}</span>
                  <Icon name={isExpanded ? 'expand_less' : 'expand_more'} size={20} className="text-text-muted" />
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 pt-0">
                    <p className="text-text-secondary text-sm leading-relaxed mb-3">{section.content}</p>

                    {section.items && (
                      <div className="space-y-1.5">
                        {section.items.map((item, i) => (
                          <div key={i} className="flex items-start gap-2 py-1.5 px-3 rounded-lg bg-surface-2/50">
                            <span className="text-text-primary text-xs font-bold shrink-0 w-28">{item.label}</span>
                            <span className="text-text-secondary text-xs">{item.value}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {section.extra && (
                      <p className="text-text-muted text-xs leading-relaxed mt-3 pl-3 border-l-2 border-brand-violet/30">{section.extra}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* CTA */}
        <div className="mt-6 p-5 rounded-2xl bg-surface-1 border border-white/[0.06] text-center">
          <h3 className="font-syne font-bold text-base mb-2">Ready to start?</h3>
          <p className="text-text-secondary text-sm mb-4">Create your first post, join a squad, or go live.</p>
          <div className="flex gap-2 justify-center">
            <button onClick={() => navigate('/create')} className="px-5 py-2.5 rounded-xl bg-brand-violet text-white text-sm font-bold">Create Post</button>
            <button onClick={() => navigate('/squads')} className="px-5 py-2.5 rounded-xl bg-surface-2 border border-white/[0.06] text-text-secondary text-sm font-bold">Find a Squad</button>
          </div>
        </div>
      </div>
    </div>
  );
}
