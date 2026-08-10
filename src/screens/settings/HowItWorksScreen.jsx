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
    content: 'VERGR runs on three currencies. Coins are bought with real money and used to spend. Gems are earned when people spend coins ON YOU — these can be cashed out. VP (VERGR Points) are earned through activity and unlock levels, perks, and discounts.',
    items: [
      { label: 'Coins (●)', value: 'Bought with real money. 1 coin = €0.01. Spend on tips, memberships, paid streams, and boosts. Spendable only inside VERGR.' },
      { label: 'Gems (◆)', value: 'Earned when someone spends coins on you. Cashable. 1 gem = €0.01. You keep 70% at L1 up to 90% at L100 (Immortal) depending on your VP level.' },
      { label: 'VP (★)', value: 'Earned through activity. Levels up your profile, unlocks perks, lowers your commission rate.' },
    ],
    extra: 'Every gem that exists was funded by coins someone bought with real money. The platform takes a commission (15-30% depending on your level) when coins convert to gems. This keeps the economy sustainable.',
  },
  {
    id: 'earning',
    icon: 'diamond',
    color: '#B44FFF',
    title: 'How to Earn Real Money',
    content: 'There are two main ways to earn gems (cashable money) on VERGR:',
    items: [
      { label: 'Memberships and paid streams', value: 'Members pay in coins for access; you receive gems.' },
      { label: 'Receive tips', value: 'When someone tips you with coins, you get gems.' },
      { label: 'Cash out', value: 'Minimum 1000 gems (€10). Paid via Wise/PayPal. ~3% processor fee.' },
    ],
    extra: 'VP (earned from quests, phone-add, referrals, and streaming) lowers your commission rate — at L100 Immortal you keep 90% of every coin converted to gems, versus 70% at L1.',
  },
  {
    id: 'coins',
    icon: 'paid',
    color: '#F5C542',
    title: 'Free Coin Bonuses',
    content: 'You earn small coin bonuses for high-value actions. These are marketing bonuses — the platform covers them.',
    items: [
      { label: '5-day login streak', value: '5 coins + 50 VP' },
      { label: 'Refer a friend', value: '25 coins + 500 VP each (both need paid sub + friend bought coins)' },
      { label: 'Lite sub ($9.99/mo)', value: '+1,000 VP + 50 coins / month, 1.5× VP multiplier' },
      { label: 'Pro sub ($24.99/mo)', value: '+3,000 VP + 150 coins / month, 2× VP multiplier' },
      { label: 'Buy coin packs', value: '10% bonus coins included' },
    ],
  },
  {
    id: 'vp',
    icon: 'star',
    color: '#7B6FFF',
    title: 'VP Levels & Perks',
    content: '100 VP levels across 11 ranks. Your coin-to-gem commission steps down with lifetime VP, from 30% to a 15% floor (reached around 100,000 VP). After L100 you can optionally Prestige: reset your visible level with a badge (never forced).',
    items: [
      { label: 'Rookie (L1–10)', value: 'No ring, 30% → 20% commission' },
      { label: 'Contender (L11–20)', value: 'Bronze ring, 20% → 18% commission' },
      { label: 'Rival (L21–30)', value: 'Silver ring, 18% commission' },
      { label: 'Challenger (L31–40)', value: 'Gold ring, 18% → 15% commission' },
      { label: 'Elite (L41–50)', value: 'Platinum ring, 15% commission' },
      { label: 'Champion (L51–60)', value: 'Diamond ring, 15% commission' },
      { label: 'Veteran (L61–70)', value: 'Onyx ring, 15% commission' },
      { label: 'Legend (L71–80)', value: 'Ruby ring, 15% commission' },
      { label: 'Mythic (L81–90)', value: 'Mythic ring, 15% commission' },
      { label: 'Ascendant (L91–99)', value: 'Ascendant ring, 15% commission' },
      { label: 'Immortal (L100)', value: '15% commission floor, prestige unlocked' },
    ],
  },
  {
    id: 'tiers',
    icon: 'workspace_premium',
    color: '#C87FFF',
    title: 'Subscription Tiers',
    content: 'VERGR has three tiers. Plans do NOT reduce commission — commission is determined by VP level only. Plans give you VP multipliers, monthly bonuses, and feature unlocks so you level up faster and use more of the app.',
    items: [
      { label: 'Free', value: 'Ads, 25MB, 720p, 50 media/day, no public streaming' },
      { label: 'Lite ($9.99/mo)', value: 'No ads, 100MB, 1080p, 1.5× VP, +1,000 VP + 50 coins/mo, stream 1080p, create squads' },
      { label: 'Pro ($24.99/mo)', value: 'No ads, 500MB, 4K, 2× VP, +3,000 VP + 150 coins/mo, stream 1440p60, co-streaming, custom vergr.me domain, advanced analytics, priority support' },
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
    id: 'cashout',
    icon: 'account_balance',
    color: '#B44FFF',
    title: 'Cashing Out',
    content: 'When your wallet has at least 1000 coins (€10), you can request a payout. VERGR takes a 10% platform fee, and the payment processor takes ~3%. You receive the rest via Wise (bank transfer), PayPal, or direct bank deposit. For example: 1000 coins = €10, minus €1 platform fee, minus ~€0.27 processor fee = you receive ~€8.73.',
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
            You earn real money for doing what you already do — gaming, posting, competing, and being part of a community.
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
