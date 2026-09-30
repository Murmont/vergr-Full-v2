import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GAMING_INTERESTS } from '../../utils/constants';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';

const INTEREST_ICONS = {
  FPS: '🎯', RPG: '⚔️', 'Battle Royale': '🪂', MOBA: '🏰', MMO: '🌍',
  Sports: '⚽', Racing: '🏎️', Fighting: '🥊', Strategy: '♟️', Simulation: '🎮',
  Horror: '👻', Indie: '🎨', Puzzle: '🧩', Platformer: '🍄', Survival: '🏕️',
  'Open World': '🗺️', Esports: '🏆', Speedrunning: '⏱️', 'Retro Gaming': '👾',
  'Mobile Gaming': '📱', 'VR Gaming': '🥽', Streaming: '📺', 'Game Dev': '💻',
};

export default function InterestSelectionScreen() {
  const [selected, setSelected] = useState([]);
  const navigate = useNavigate();

  const toggle = (interest) => {
    setSelected(prev => prev.includes(interest) ? prev.filter(i => i !== interest) : [...prev, interest]);
  };

  return (
    <div className="screen-container min-h-screen">
      <TopBar title="Your Interests" showBack />
      <div className="flex-1 px-4 pb-32">
        <p className="text-text-secondary mb-1">Pick at least 3 to personalize your feed</p>
        <p className="text-brand-violet-light text-sm font-dmmono mb-6">{selected.length} selected</p>

        <div className="grid grid-cols-2 gap-3">
          {GAMING_INTERESTS.map(interest => {
            const isSelected = selected.includes(interest);
            return (
              <button
                key={interest}
                onClick={() => toggle(interest)}
                className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl border transition-all duration-200 ${
                  isSelected
                    ? 'border-brand-violet bg-brand-violet/10 '
                    : 'border-white/[0.06] bg-surface-2 hover:border-text-muted'
                }`}
              >
                <span className="text-xl">{INTEREST_ICONS[interest] || '🎮'}</span>
                <span className={`text-sm font-medium ${isSelected ? 'text-brand-violet-light' : 'text-text-primary'}`}>{interest}</span>
                {isSelected && <Icon name="check_circle" filled size={16} className="text-brand-violet-light ml-auto" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] p-4 glass-header border-t border-white/[0.04]" style={{ paddingBottom: 'calc(16px + var(--vg-safe-b, 0px))' }}>
        <button
          onClick={() => navigate('/setup/profile', { state: { interests: selected } })}
          disabled={selected.length < 3}
          className={`btn-primary ${selected.length < 3 ? 'opacity-40 cursor-not-allowed' : ''}`}
        >
          Continue ({selected.length}/3 min)
        </button>
      </div>
    </div>
  );
}
