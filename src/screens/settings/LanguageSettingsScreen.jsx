import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { updateUserSettings } from '../../firebase/firestore';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import { SUPPORTED_LANGS } from '../../utils/localePrefs';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';

// Exactly the languages VERGR actually translates into + ranks content by
// (SUPPORTED_LANGS in utils/localePrefs.js). Flags use the real country code for
// each language so the picker can't promise a language we don't support.
const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'pt', label: 'Português', flag: '🇵🇹' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'uk', label: 'Українська', flag: '🇺🇦' },
  { code: 'it', label: 'Italiano', flag: '🇮🇹' },
  { code: 'nl', label: 'Nederlands', flag: '🇳🇱' },
  { code: 'pl', label: 'Polski', flag: '🇵🇱' },
  { code: 'tr', label: 'Türkçe', flag: '🇹🇷' },
];

export default function LanguageSettingsScreen() {
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const { showToast } = useUI();
  const [lang, setLang] = useState('en');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile?.settings?.language) {
      setLang(profile.settings.language);
    }
  }, [profile]);

  const handleSelect = async (code) => {
    setLang(code);
    setSaving(true);
    try {
      await updateUserSettings(currentUser.uid, { language: code });
      const selected = LANGUAGES.find(l => l.code === code);
      showToast(`Language set to ${selected?.label}`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to save language', 'error');
    }
    setSaving(false);
  };

  return (
    <div className={isDesktop ? "min-h-screen pb-8" : "screen-container min-h-screen pb-8"}>
      <TopBar title="Language" showBack />
      <div className="px-4 py-2">
        <p className="text-text-muted text-xs mb-4">This sets the language posts and chats are translated <span className="text-text-secondary">into</span>, and helps surface content from people who speak it. Languages marked <span className="text-brand-violet-light font-semibold">Translate</span> are available for on-demand translation now.</p>
        <div className="space-y-1">
          {LANGUAGES.map(l => (
            <button
              key={l.code}
              onClick={() => handleSelect(l.code)}
              className={`flex items-center gap-3 w-full p-4 rounded-2xl transition-all ${
                lang === l.code ? 'bg-brand-violet/5 border border-brand-violet/30' : 'bg-surface-1 border border-transparent hover:bg-surface-2'
              }`}
            >
              <span className="text-xl">{l.flag}</span>
              <span className="flex-1 text-sm font-semibold text-left">{l.label}</span>
              {SUPPORTED_LANGS.includes(l.code) && (
                <span className="text-[10px] font-bold uppercase tracking-wide text-brand-violet-light bg-brand-violet/15 px-2 py-0.5 rounded-full">Translate</span>
              )}
              {lang === l.code && <Icon name="check_circle" filled size={20} className="text-brand-violet-light" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
