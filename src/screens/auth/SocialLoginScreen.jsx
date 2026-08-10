import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import VergrLogo from '../../components/VergrLogo';
import Icon from '../../components/Icon';
import { IS_HUAWEI_BUILD } from '../../utils/platform';

export default function SocialLoginScreen() {
  const navigate = useNavigate();
  const { loginWithGoogle } = useAuth();
  const { showToast } = useUI();

  const handleGoogle = async () => { try { await loginWithGoogle(); navigate('/', { replace: true }); } catch(e) { showToast(e.message, 'error'); }};

  // Google sign-in needs Google Play Services, absent on Huawei devices, so the
  // option is dropped on the AppGallery build rather than offered and failing.
  const socials = [
    ...(IS_HUAWEI_BUILD ? [] : [
      { id: 'google', label: 'Continue with Google', icon: 'chrome', color: 'bg-white/5 hover:bg-white/10', handler: handleGoogle },
    ]),
    { id: 'discord', label: 'Continue with Discord', icon: 'message-circle', color: 'bg-[#5865F2]/10 hover:bg-[#5865F2]/20', handler: () => showToast('Discord login coming soon', 'info') },
    { id: 'twitch', label: 'Continue with Twitch', icon: 'tv', color: 'bg-[#9146FF]/10 hover:bg-[#9146FF]/20', handler: () => showToast('Twitch login coming soon', 'info') },
  ];

  return (
    <div className="screen-container min-h-screen flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-[400px]">
        <div className="flex justify-center mb-12"><VergrLogo size={52} /></div>
        <h1 className="font-syne text-text-primary text-2xl font-bold text-center mb-2">Sign In</h1>
        <p className="text-text-secondary text-center mb-10">Choose your preferred login method</p>
        <div className="flex flex-col gap-4 mb-8">
          {socials.map(s => (
            <button key={s.id} onClick={s.handler} className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl border border-surface-border ${s.color} transition-colors`}>
              <Icon name={s.icon} size={22} className="text-white" />
              <span className="text-white font-semibold">{s.label}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4 mb-8">
          <div className="flex-1 h-px bg-surface-border" /><span className="text-text-secondary text-sm">or</span><div className="flex-1 h-px bg-surface-border" />
        </div>
        <button onClick={() => navigate('/login')} className="btn-primary w-full py-4 rounded-2xl text-lg font-bold mb-4">Sign in with Email</button>
        <p className="text-center text-text-secondary text-sm">Don't have an account? <button onClick={() => navigate('/signup')} className="text-primary font-semibold">Sign Up</button></p>
      </div>
    </div>
  );
}
