// Horizontal "journey" of all 11 ranks as connected crest nodes. The link
// between two nodes fills in the rank colour once that rank is cleared; the
// current rank pulses. Tapping a node selects it (scrolls the perk card below).
import RankCrest from './RankCrest';
import { RANK_VIEWS } from './prestigeData';

export default function RankJourneyTrack({ currentLevel = 1, selectedId, onSelect }) {
  return (
    <div className="overflow-x-auto no-scrollbar -mx-4 px-4">
      <div className="flex items-start min-w-max pb-1">
        {RANK_VIEWS.map((rank, i) => {
          const reached = currentLevel >= rank.min;
          const isCurrent = currentLevel >= rank.min && currentLevel <= rank.max;
          const isSelected = selectedId === rank.id;
          const topBadge = rank.badges[rank.badges.length - 1];
          return (
            <div key={rank.id} className="flex items-start">
              <button
                type="button"
                onClick={() => onSelect?.(rank.id)}
                className="flex flex-col items-center gap-1.5 w-[84px] pt-1 group"
              >
                <div className={isCurrent ? 'prestige-pulse rounded-full' : ''} style={{ color: rank.ringColor }}>
                  <RankCrest art={topBadge.art} ringColor={rank.ringColor} size={52} locked={!reached} glow={reached} animated={rank.animated} />
                </div>
                <span
                  className="text-[11px] font-bold font-syne text-center leading-tight"
                  style={{ color: reached ? rank.ringColor : '#6B7280' }}
                >
                  {rank.name}
                </span>
                <span className="text-[9px] text-text-muted font-dmmono">
                  L{rank.min}{rank.min !== rank.max ? `-${rank.max}` : ''}
                </span>
                <div
                  className="h-1 w-6 rounded-full transition-all"
                  style={{ background: isSelected ? rank.ringColor : 'transparent' }}
                />
              </button>
              {i < RANK_VIEWS.length - 1 && (
                <div
                  className="h-[3px] w-7 rounded-full mt-7 shrink-0"
                  style={{ background: currentLevel > rank.max ? rank.ringColor : 'rgba(255,255,255,0.10)' }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
