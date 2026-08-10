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
    {q:'What are coins, gems, and VP?',a:'Coins are bought with real money and spent on tips, tournaments, and boosts. Gems are earned when someone spends coins ON YOU (tips, tournament prizes) — gems can be cashed out. VP is earned through activity and unlocks levels, perks, and commission discounts.'},
    {q:'How do I earn real money?',a:'Win tournaments or receive tips. People pay with coins, you receive gems. Cash out gems when you reach 1000 (€10). Your VP determines your conversion commission, which steps down from 30% to a 15% floor as your lifetime VP grows.'},
    {q:'How do free coin bonuses work?',a:'You get 5 coins + 50 VP for a 5-day login streak. Referrals give 25 coins + 500 VP each (both need paid sub, friend must have bought coins). Lite subscribers get +1,000 VP & +50 coins / month. Pro gets +3,000 VP & +150 coins / month. Coin pack purchases include 10% bonus coins.'},
    {q:'What does VP unlock?',a:'VP spans 100 levels across 11 ranks (Rookie → Immortal). Higher VP lowers your coin-to-gem commission (30% down to a 15% floor) and earns rank rings and 30 collectible badges. After level 100 you can optionally Prestige for cosmetic badges.'},
    {q:'Does Lite/Pro lower my commission?',a:'No. Commission is determined ONLY by your VP level, not by your subscription. Plans give you a VP multiplier (1.5× on Lite, 2× on Pro) so you level up — and earn down commission — faster.'},
    {q:'How do squads work?',a:'Create or join a squad. The creator starts as president. Monthly elections on the 1st — all members vote. When members win tournaments, 10% of their gems go to the squad treasury. The treasury funds future tournament entries.'},
    {q:'How do tournaments work?',a:'Players pay coin entry fees forming the prize pool. Coins convert to gems: 1st (60%), 2nd (25%), 3rd/4th (7.5% each). The moderator running the tournament gets 5%. Winners also get VP. Brackets auto-advance.'},
    {q:'How does streaming work?',a:'VERGR doesn\'t host streams. Link your Twitch, YouTube, Kick, or other platform. When you go live, followers watch the embedded stream in the app.'},
    {q:'How do referrals work?',a:'Share your referral link from Earn → Refer Friends. When your friend creates an account, adds their phone number, and either joins a squad or subscribes to Lite/Pro, you both get rewarded — 3000 VP for you and 5000 VP for them.'},
    {q:'Can I make a living on VERGR?',a:'Most income comes from tournaments and tips. A creator winning tournaments and receiving regular tips can earn €100-400+/month depending on activity, audience, and VP level (which determines commission rate).'},
    {q:'What do Lite and Pro cost?',a:'Lite is $9.99/mo — no ads, 100MB uploads, 1080p, 1.5× VP, create squads & tournaments, stream at 1080p. Pro is $24.99/mo — 500MB uploads, 4K, 2× VP, stream at 1440p60 with co-streaming, custom vergr.me domain, advanced analytics, and priority support. See Settings → Subscription for the full comparison.'},
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
            <p className="text-text-secondary text-[10px]">Complete guide to coins, squads, tournaments, and earning</p>
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
