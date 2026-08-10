import { useNavigate } from 'react-router-dom';
import VergrLogo from '../../components/VergrLogo';
import Icon from '../../components/Icon';
import { FIRST_BOOT_EVENT } from '../../components/FirstBootIntro';

export default function OnboardingCompleteScreen() {
  const navigate = useNavigate();
  const handleGetStarted = () => {
    // Arm the one-time First Boot intro, then land on the feed where it plays.
    try { localStorage.setItem('vergr.firstBoot.pending', '1'); } catch {}
    window.dispatchEvent(new Event(FIRST_BOOT_EVENT));
    navigate('/', { replace: true });
  };
  return (
    <div className="screen-container min-h-screen flex flex-col items-center justify-center p-6">
      <div className="mb-8">
        <VergrLogo size={56} />
      </div>
      <h1 className="font-syne text-text-primary text-2xl font-bold text-center mb-2">You're all set</h1>
      <p className="text-text-muted text-sm text-center max-w-[280px] mb-10">Your account is ready. Start exploring the community.</p>
      <button onClick={handleGetStarted} className="btn-primary w-full max-w-[320px]">Get Started</button>
    </div>
  );
}
