import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import TopBar from '../../components/TopBar';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import PrestigeShowcase from '../../components/prestige/PrestigeShowcase';
import HelpDeck from '../../components/help/HelpDeck';
import { resolveTier } from '../../utils/tierSystem';

// Context-relevant help, opened in-place (no navigating away from the page).
const VP_HELP = [
  { slug: 'what-is-vp-and-how-do-i-earn-it', icon: 'bolt', label: 'What is VP and how do I earn it?' },
  { slug: 'what-are-the-vergr-ranks', icon: 'military_tech', label: 'The 11 ranks explained' },
  { slug: 'how-does-rank-lower-my-fees', icon: 'savings', label: 'How rank lowers your fees' },
  { slug: 'what-do-i-unlock-at-each-rank', icon: 'lock_open', label: 'What you unlock at each rank' },
  { slug: 'what-are-prestige-levels-and-how-are-they-different-from-vp-ranks', icon: 'workspace_premium', label: 'Prestige levels' },
  { slug: 'how-do-i-convert-coins-into-gems', icon: 'currency_exchange', label: 'Convert coins into gems' },
];

export default function PrestigeLevelsScreen() {
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();
  const navigate = useNavigate();
  const { profile, wallet } = useUser();

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  return (
    <div className={isDesktop ? 'min-h-screen pb-10' : 'screen-container min-h-screen pb-10'}>
      <TopBar title="VP & Prestige" showBack />
      {isDesktop ? (
        <div className="px-4 py-4">
          <div className="flex gap-6 max-w-6xl">
            <div className="flex-1 min-w-0">
              <PrestigeShowcase
                totalVP={wallet?.vp || 0}
                plan={resolveTier(profile)}
                prestige={profile?.prestige || 0}
                navigate={navigate}
              />
            </div>
            <aside className="hidden lg:block w-[300px] shrink-0">
              <div className="sticky top-4">
                <HelpDeck title="Learn more about VP" items={VP_HELP} />
              </div>
            </aside>
          </div>
        </div>
      ) : (
        <div className="px-4 py-4">
          <PrestigeShowcase
            totalVP={wallet?.vp || 0}
            plan={resolveTier(profile)}
            prestige={profile?.prestige || 0}
            navigate={navigate}
          />
        </div>
      )}
    </div>
  );
}
