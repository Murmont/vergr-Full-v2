import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import Icon from '../../components/Icon';

const POST_TYPES = [
  {
    id: 'short', title: 'Short', desc: 'Quick vertical video',
    icon: 'slow_motion_video', route: '/create/short',
    gradient: 'from-brand-violet/20 to-brand-violet/20',
    border: 'border-brand-violet/20 hover:border-brand-violet/40',
    iconBg: 'bg-brand-violet/15', iconColor: 'text-brand-violet-light',
    badge: 'NEW',
  },
  {
    id: 'text', title: 'Text', desc: 'Quick thoughts & updates',
    icon: 'edit_note', route: '/create/text',
    gradient: 'from-brand-violet/10 to-transparent',
    border: 'border-white/[0.06] hover:border-brand-violet/30',
    iconBg: 'bg-brand-violet/10', iconColor: 'text-brand-violet-light',
  },
  {
    id: 'photo', title: 'Photo', desc: 'Screenshots & carousel',
    icon: 'photo_library', route: '/create/photo',
    gradient: 'from-brand-violet/10 to-transparent',
    border: 'border-white/[0.06] hover:border-brand-violet/30',
    iconBg: 'bg-brand-violet/10', iconColor: 'text-brand-violet',
  },
  {
    id: 'clip', title: 'Clip', desc: 'Longer video moments',
    icon: 'play_circle', route: '/create/clip',
    gradient: 'from-brand-ember/10 to-transparent',
    border: 'border-white/[0.06] hover:border-brand-ember/30',
    iconBg: 'bg-brand-ember/10', iconColor: 'text-brand-ember',
  },
  {
    id: 'article', title: 'Article', desc: 'Guides & deep dives',
    icon: 'article', route: '/create/article',
    gradient: 'from-brand-pink/10 to-transparent',
    border: 'border-white/[0.06] hover:border-brand-pink/30',
    iconBg: 'bg-brand-pink/10', iconColor: 'text-brand-pink',
  },
  {
    id: 'lfg', title: 'LFG', desc: 'Find players & teams',
    icon: 'group_add', route: '/create/lfg',
    gradient: 'from-brand-gold/10 to-transparent',
    border: 'border-white/[0.06] hover:border-brand-gold/30',
    iconBg: 'bg-brand-gold/10', iconColor: 'text-brand-gold',
  },
  {
    id: 'tierlist', title: 'Tier List', desc: 'Rank & compare',
    icon: 'format_list_numbered', route: '/create/tierlist',
    gradient: 'from-brand-violet/10 to-transparent',
    border: 'border-white/[0.06] hover:border-brand-violet/30',
    iconBg: 'bg-brand-violet/10', iconColor: 'text-brand-violet',
  },
  {
    id: 'achievement', title: 'Achievement', desc: 'Showcase your wins',
    icon: 'emoji_events', route: '/create/achievement',
    gradient: 'from-brand-gold/10 to-transparent',
    border: 'border-white/[0.06] hover:border-brand-gold/30',
    iconBg: 'bg-brand-gold/10', iconColor: 'text-brand-gold',
  },
  {
    id: 'poll', title: 'Poll', desc: 'Ask the community',
    icon: 'bar_chart', route: '/create-poll',
    gradient: 'from-brand-pink/10 to-transparent',
    border: 'border-white/[0.06] hover:border-brand-pink/30',
    iconBg: 'bg-brand-pink/10', iconColor: 'text-brand-pink',
  },
];

export default function CreatePostSelectorScreen() {
  const navigate = useNavigate();
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(null);
    setContentAlign(isDesktop ? 'left' : 'center');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  return (
    <div className="min-h-screen pb-24 lg:pb-8">
      {/* Header */}
      <div className="px-5 pt-6 pb-1">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-xl bg-surface-2 border border-white/[0.06] flex items-center justify-center text-text-secondary hover:text-white transition-colors"
          >
            <Icon name="arrow_back" size={20} />
          </button>
          <div>
            <h1 className="font-syne text-xl font-bold tracking-tight text-text-primary">Create</h1>
            <p className="text-text-muted text-xs mt-0.5">What are you sharing?</p>
          </div>
        </div>
      </div>

      {/* Hero Short CTA */}
      <div className="px-4 pt-4">
        <motion.button
          onClick={() => navigate('/create/short')}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
          whileTap={{ scale: 0.98 }}
          className="w-full relative overflow-hidden rounded-2xl border border-brand-violet/20 bg-gradient-to-r from-brand-violet/[0.08] via-brand-violet/[0.06] to-brand-violet/[0.04] p-5 text-left group hover:border-brand-violet/40 transition-all"
        >
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-violet/20 to-brand-violet/20 border border-white/[0.08] flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Icon name="slow_motion_video" size={28} className="text-brand-violet-light" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <h3 className="font-syne font-bold text-white text-base">Create a Short</h3>
                <span className="px-1.5 py-0.5 rounded-md bg-brand-violet/15 text-brand-violet-light text-[9px] font-black uppercase tracking-wider">New</span>
              </div>
              <p className="text-text-muted text-xs">Record or upload a vertical video clip · Auto-compressed for mobile</p>
            </div>
            <Icon name="arrow_forward" size={20} className="text-text-muted group-hover:text-brand-violet-light transition-colors shrink-0" />
          </div>
          {/* Decorative glow */}
          <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full bg-brand-violet/[0.06] blur-2xl pointer-events-none" />
        </motion.button>
      </div>

      {/* Post type grid */}
      <div className={`px-4 pt-4 grid gap-2.5 ${isDesktop ? 'grid-cols-4' : 'grid-cols-2'}`}>
        {POST_TYPES.filter(t => t.id !== 'short').map((type, i) => (
          <motion.button
            key={type.id}
            onClick={() => navigate(type.route)}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 + i * 0.04, duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            whileTap={{ scale: 0.96 }}
            className={`group relative overflow-hidden rounded-xl border ${type.border} bg-gradient-to-br ${type.gradient} p-4 text-left transition-all hover:shadow-lg hover:shadow-black/20`}
          >
            <div className={`w-10 h-10 rounded-xl ${type.iconBg} flex items-center justify-center mb-3 group-hover:scale-105 transition-transform ${type.iconColor}`}>
              <Icon name={type.icon} size={22} />
            </div>
            <h3 className="font-semibold text-text-primary text-sm tracking-tight mb-0.5">{type.title}</h3>
            <p className="text-text-muted text-[11px] leading-relaxed">{type.desc}</p>
            {type.badge && (
              <span className="absolute top-3 right-3 px-1.5 py-0.5 rounded-md bg-brand-violet/15 text-brand-violet-light text-[8px] font-black uppercase">{type.badge}</span>
            )}
          </motion.button>
        ))}
      </div>

      {/* Desktop quick-post */}
      {isDesktop && (
        <div className="px-4 mt-5">
          <button
            onClick={() => navigate('/create/text')}
            className="w-full flex items-center gap-4 p-4 rounded-xl border border-white/[0.06] bg-surface-1/50 hover:bg-surface-2/50 transition-colors group"
          >
            <div className="w-9 h-9 rounded-full bg-surface-2/60 flex items-center justify-center text-text-muted group-hover:text-text-secondary transition-colors">
              <Icon name="edit" size={18} />
            </div>
            <span className="text-text-muted text-sm group-hover:text-text-secondary transition-colors">Start typing a quick post...</span>
          </button>
        </div>
      )}
    </div>
  );
}
