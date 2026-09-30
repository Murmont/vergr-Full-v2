// NativeSettingsScreen — dedicated phone-first Settings hub for the native APK.
// Reuses the SAME card definitions as the web hub (getSettingsCards) so entries
// never drift, but renders a lean single-column list with a safe-area TopBar and
// bottom padding that clears the native bottom nav + home indicator. No desktop
// 2-column grid, no LayoutContext right-panel plumbing. Routed IS_NATIVE_BUILD only.

import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { useUser } from '../../../context/UserContext';
import TopBar from '../../../components/TopBar';
import { C } from '../_settingsUI';
import { getSettingsCards, SettingsCard, DangerCard } from '../SettingsScreen';

export default function NativeSettingsScreen() {
  const { logout } = useAuth();
  const { profile, wallet } = useUser();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const cards = getSettingsCards({ navigate, profile, wallet });
  const heroCard = cards.find(c => c.id === 'subscription');
  const rest = cards.filter(c => c.id !== 'subscription');

  return (
    <div style={{ background: C.bg, minHeight: '100vh', paddingBottom: 'calc(88px + var(--vg-safe-b, 0px))' }}>
      <TopBar title="Settings" showBack />
      <div style={{ padding: '12px 16px' }}>
        {heroCard && <div style={{ marginBottom: 12 }}><SettingsCard card={heroCard} /></div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginBottom: 12 }}>
          {rest.map(c => <SettingsCard key={c.id} card={c} />)}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
          <DangerCard icon="logout" title="Sign out" desc="Sign out of your VERGR account." onClick={handleLogout} />
          <DangerCard icon="delete" title="Delete account" desc="Permanently delete your account." onClick={() => navigate('/settings/delete-account')} />
        </div>
      </div>
    </div>
  );
}
