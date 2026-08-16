import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
export default function HelpCenterScreen() {
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(null);
  const faqs = [
    {q:'What are coins and VP?',a:'Coins are bought with real money and spent on tips, memberships, paid streams, and boosts. Coins are spendable only inside VERGR: they are a licence to use features, with no cash value, and they cannot be withdrawn, converted or transferred. VP is earned through activity and unlocks levels, ranks and perks.'},
    {q:'How do creators get paid?',a:'Receive tips, sell memberships, or charge for access to a stream. Fans pay in coins, which is revenue VERGR earns, and VERGR owes you a share of it. Your share starts at 50% and rises to 80% as your lifetime earnings grow. VERGR pays automatically on a schedule once you reach $100. You never request a payout.'},
    {q:'How do free coin bonuses work?',a:'You get 5 coins + 50 VP for a 5-day login streak. Referrals give +5,000 VP to you and +3,000 VP to your friend. Lite subscribers get +1,000 VP & +50 coins / month. Pro gets +3,000 VP & +150 coins / month. The Titan and Ascendant coin packs carry bonus VP.'},
    {q:'What does VP unlock?',a:'VP spans 100 levels across 11 ranks (Rookie → Immortal). It earns rank rings and 30 collectible badges. VP is a status ladder, not a money ladder: your revenue share is set by your lifetime earnings, not by VP. After level 100 you can optionally Prestige for cosmetic badges.'},
    {q:'Does Lite/Pro change my revenue share?',a:'No. Your share is set only by your lifetime earnings, never by your subscription. Plans give you a VP multiplier (1.5× on Lite, 2× on Pro) plus feature unlocks.'},
    {q:'How do squads work?',a:'Create or join a squad. The creator starts as president. Monthly elections on the 1st — all members vote. Members can contribute coins to the squad treasury, which is split among members monthly.'},
    {q:'Is this gambling?',a:'No. VERGR does not offer betting, wagering, prediction markets, casino games, or prize competitions. Coins are in-app currency spent on tips, memberships, paid streams, and boosts.'},
    {q:'How does streaming work?',a:'VERGR doesn\'t host streams. Link your Twitch, YouTube, Kick, or other platform. When you go live, followers watch the embedded stream in the app.'},
    {q:'How do referrals work?',a:'Share your referral link from Earn → Refer Friends. When your friend creates an account, adds their phone number, and either joins a squad or subscribes to Lite/Pro, you both get rewarded — 5,000 VP for you and 3,000 VP for them.'},
    {q:'Can I make a living on VERGR?',a:'We make no income promise. Creator earnings come from tips, memberships, and paid streams, and depend entirely on your own audience and how often you stream. Many creators earn nothing.'},
    {q:'What do Lite and Pro cost?',a:'Lite is $4.99/mo — no ads, 1GB uploads, 720p60 streaming from day one, 1.5× VP, scheduled posts, voice messages. Pro is $9.99/mo — 5GB uploads, 1080p60 with co-streaming, 2× VP, custom vergr.me domain, advanced analytics, and priority support. See Settings → Subscription for the full comparison.'},
  ];
  return (
    <div className={isDesktop ? "min-h-screen flex flex-col" : "screen-container min-h-screen flex flex-col"}>
      <header className="flex items-center gap-3 px-5 pt-12 pb-4"><button onClick={()=>navigate(-1)} className="text-white/80"><Icon name="arrow_back" size={24}/></button><h1 className="text-white font-syne font-bold text-lg">Help Center</h1></header>
      <main className="flex-1 px-5 pb-8">
        <div className="flex items-center bg-surface rounded-xl px-4 py-3 border border-surface-border mb-6"><Icon name="search" size={18} className="text-text-secondary mr-2"/><input className="flex-1 bg-transparent text-white text-sm outline-none" placeholder="Search help topics..."/></div>
        <button onClick={() => navigate('/settings/how-it-works')} className="w-full flex items-center gap-3 p-4 rounded-2xl bg-brand-violet/[0.06] border border-brand-violet/20 hover:border-white/[0.12] transition-all mb-6 group">
          <div className="w-10 h-10 rounded-xl bg-brand-violet/15 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
            <Icon name="school" size={20} className="text-brand-violet-light" />
          </div>
          <div className="flex-1 text-left">
            <p className="text-brand-violet-light font-bold text-sm">How VERGR Works</p>
            <p className="text-text-secondary text-[10px]">Complete guide to coins, squads, streaming, and earning</p>
          </div>
          <Icon name="arrow_forward" size={18} className="text-brand-violet-light/50 group-hover:text-brand-violet-light transition-colors" />
        </button>
        <p className="text-text-secondary text-xs font-bold uppercase tracking-wider mb-3">Frequently Asked</p>
        {faqs.map((f,i)=>(
          <div key={i} className="border-b border-surface-border/30">
            <button onClick={()=>setExpanded(expanded===i?null:i)} className="flex items-center gap-3 w-full py-4">
              <span className="flex-1 text-white font-semibold text-sm text-left">{f.q}</span>
              <Icon name={expanded===i?'expand_less':'expand_more'} size={18} className="text-text-secondary"/>
            </button>
            {expanded===i&&<p className="text-text-secondary text-sm pb-4 leading-relaxed">{f.a}</p>}
          </div>))}
        <button className="w-full py-3 mt-6 bg-surface rounded-xl text-primary font-bold text-sm border border-surface-border">Contact Support</button>
      </main>
    </div>);
}
