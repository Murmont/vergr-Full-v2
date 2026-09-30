import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { updateUserSettings } from '../../firebase/firestore';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';

export default function DisplaySettingsScreen() {
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const { showToast, theme, setTheme } = useUI();
  const [fontSize, setFontSize] = useState('medium');
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (profile?.settings) {
      if (profile.settings.fontSize) setFontSize(profile.settings.fontSize);
      if (profile.settings.reducedMotion !== undefined) setReducedMotion(profile.settings.reducedMotion);
    }
  }, [profile]);

  const save = async (updates) => {
    try {
      await updateUserSettings(currentUser.uid, updates);
    } catch (err) {
      console.error(err);
      showToast('Failed to save', 'error');
    }
  };

  const handleThemeChange = (t) => {
    setTheme(t);
    save({ theme: t });
  };

  const THEME_OPTIONS = [
    { id: 'dark', label: 'Dark', icon: 'dark_mode', desc: 'Easy on the eyes, day or night' },
    { id: 'light', label: 'Light', icon: 'light_mode', desc: 'Clean and bright' },
    { id: 'system', label: 'System', icon: 'settings_suggest', desc: 'Follows your OS setting' },
  ];

  return (
    <div className={isDesktop ? "min-h-screen pb-8" : "screen-container min-h-screen pb-8"}>
      <TopBar title="Display" showBack />
      <div className="px-4 py-4 space-y-6">
        {/* Theme */}
        <div>
          <p className="text-text-muted text-[11px] font-semibold uppercase tracking-wider mb-3">Theme</p>
          <div className="space-y-2">
            {THEME_OPTIONS.map(t => (
              <button key={t.id} onClick={() => handleThemeChange(t.id)}
                className={`w-full flex items-center gap-3 p-3.5 rounded-xl border transition-colors text-left ${
                  theme === t.id ? 'border-brand-violet bg-brand-violet/[0.06]' : 'border-white/[0.06] bg-surface-1 hover:bg-surface-2/50'
                }`}>
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${theme === t.id ? 'bg-brand-violet/15 text-brand-violet-light' : 'bg-surface-2 text-text-muted'}`}>
                  <Icon name={t.icon} size={20} />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-text-primary">{t.label}</p>
                  <p className="text-[11px] text-text-muted">{t.desc}</p>
                </div>
                {theme === t.id && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                  >
                    <Icon name="check_circle" filled size={20} className="text-brand-violet-light" />
                  </motion.div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Font Size */}
        <div>
          <p className="text-text-muted text-[11px] font-semibold uppercase tracking-wider mb-3">Font Size</p>
          <div className="flex gap-2 bg-surface-2/40 rounded-xl p-1">
            {['small', 'medium', 'large'].map(s => (
              <button key={s} onClick={() => { setFontSize(s); save({ fontSize: s }); }}
                className={`relative flex-1 py-2.5 rounded-lg font-semibold transition-colors ${
                  fontSize === s ? 'text-bg-dark' : 'text-text-muted'
                } ${s === 'small' ? 'text-xs' : s === 'large' ? 'text-base' : 'text-sm'}`}>
                {fontSize === s && (
                  <motion.div
                    layoutId="fontSizePill"
                    className="absolute inset-0 bg-brand-violet rounded-lg"
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  />
                )}
                <span className="relative z-10">{s.charAt(0).toUpperCase() + s.slice(1)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Reduced Motion */}
        <div className="flex items-center justify-between p-4 rounded-xl bg-surface-1 border border-white/[0.06]">
          <div>
            <p className="text-sm font-semibold text-text-primary">Reduced Motion</p>
            <p className="text-text-muted text-[11px]">Minimize animations throughout the app</p>
          </div>
          <button onClick={() => { setReducedMotion(!reducedMotion); save({ reducedMotion: !reducedMotion }); }}
            className={`w-11 h-6 rounded-full transition-colors shrink-0 ml-3 ${reducedMotion ? 'bg-brand-violet' : 'bg-surface-3'}`}>
            <div className={`w-[18px] h-[18px] rounded-full bg-white shadow-sm transition-transform ${reducedMotion ? 'translate-x-[22px]' : 'translate-x-[3px]'}`} />
          </button>
        </div>
      </div>
    </div>
  );
}
