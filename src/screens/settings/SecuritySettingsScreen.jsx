import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../../firebase/config';
import { getMyAccountSecurityStatus, disableAccountTotp } from '../../firebase/accountSecurityCallables';
import { TwoFactorSetupModal, StepUpModal } from '../../components/settings/TwoFactor';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';

export default function SecuritySettingsScreen() {
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);
  const { currentUser, logout } = useAuth();
  const { profile } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();

  const [enrolled, setEnrolled] = useState(!!profile?.settings?.twoFactorEnabled);
  const [recoveryLeft, setRecoveryLeft] = useState(null);
  const [setupOpen, setSetupOpen] = useState(false);
  // Step-up: a pending action that runs only after a verified code.
  const [stepUp, setStepUp] = useState(null); // { title, run }

  useEffect(() => {
    let alive = true;
    getMyAccountSecurityStatus()
      .then(s => { if (alive) { setEnrolled(!!s.enrolled); setRecoveryLeft(s.recoveryCodesRemaining); } })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Run `fn` directly, or behind a TOTP step-up when 2FA is enabled.
  const guarded = (title, fn) => {
    if (enrolled) setStepUp({ title, run: fn });
    else fn();
  };

  const doChangePassword = async () => {
    try {
      await sendPasswordResetEmail(auth, currentUser.email);
      showToast('Password reset email sent!', 'success');
    } catch {
      showToast('Failed to send reset email', 'error');
    }
  };

  const doSignOutAll = async () => {
    if (!confirm('Sign out from all devices? You will need to log in again.')) return;
    try {
      await logout();
      navigate('/login');
    } catch {
      showToast('Failed to sign out', 'error');
    }
  };

  const handleToggle2FA = () => {
    if (!enrolled) {
      setSetupOpen(true);
      return;
    }
    // Disabling requires a current code.
    setStepUp({
      title: 'Disable two-factor authentication',
      run: async (code) => {
        try {
          await disableAccountTotp({ code });
          setEnrolled(false);
          setRecoveryLeft(null);
          showToast('Two-factor authentication disabled', 'success');
        } catch (err) {
          showToast(err?.message || 'Failed to disable', 'error');
        }
      },
      passCode: true,
    });
  };

  const items = [
    { icon: 'key', label: 'Change Password', desc: 'Send a password reset email',
      action: () => guarded('Confirm password change', doChangePassword) },
    { icon: 'shield', label: 'Two-Factor Authentication',
      desc: enrolled ? `Enabled${recoveryLeft != null ? ` · ${recoveryLeft} recovery codes left` : ''}` : 'Add an authenticator app', toggle: true },
    { icon: 'lock', label: 'Wallet Security', desc: 'PIN and biometric settings',
      action: () => guarded('Confirm access to wallet security', () => navigate('/wallet/security')) },
    { icon: 'logout', label: 'Sign Out All Devices', desc: 'Log out everywhere', danger: true,
      action: () => guarded('Confirm sign out', doSignOutAll) },
  ];

  return (
    <div className={isDesktop ? "min-h-screen pb-8" : "screen-container min-h-screen pb-8"}>
      <TopBar title="Security" showBack />
      <div className="px-4 py-4 space-y-2">
        {items.map(item => (
          <button key={item.label} onClick={item.toggle ? undefined : item.action}
            className="flex items-center gap-3 w-full p-4 rounded-2xl bg-surface-1 border border-white/[0.06] text-left">
            <Icon name={item.icon} size={20} className={item.danger ? 'text-brand-ember' : 'text-text-secondary'} />
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${item.danger ? 'text-brand-ember' : ''}`}>{item.label}</p>
              {item.desc && <p className="text-xs text-text-muted">{item.desc}</p>}
            </div>
            {item.toggle ? (
              <button onClick={(e) => { e.stopPropagation(); handleToggle2FA(); }}
                className={`w-12 h-7 rounded-full transition-colors shrink-0 ${enrolled ? 'bg-brand-violet' : 'bg-surface-3'}`}>
                <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${enrolled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            ) : (
              <Icon name="chevron_right" size={18} className="text-text-muted" />
            )}
          </button>
        ))}

        <div className="mt-4 p-4 rounded-2xl bg-surface-1 border border-white/[0.06]">
          <p className="text-text-muted text-xs mb-1">Signed in as</p>
          <p className="text-sm font-dmmono text-brand-violet-light">{currentUser?.email}</p>
        </div>
      </div>

      {setupOpen && (
        <TwoFactorSetupModal
          onClose={() => setSetupOpen(false)}
          onEnrolled={() => { setEnrolled(true); getMyAccountSecurityStatus().then(s => setRecoveryLeft(s.recoveryCodesRemaining)).catch(() => {}); }}
        />
      )}

      {stepUp && (
        <StepUpModal
          title={stepUp.title}
          verify={!stepUp.passCode}
          onClose={() => setStepUp(null)}
          onSuccess={(code) => {
            const { run, passCode } = stepUp;
            setStepUp(null);
            // For disable (passCode), hand the raw code to the callable which
            // verifies it server-side. For plain gating, the modal already verified.
            run(passCode ? code : undefined);
          }}
        />
      )}
    </div>
  );
}
