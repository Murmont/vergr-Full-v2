import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import VergrLogo from '../../components/VergrLogo';
import Icon from '../../components/Icon';
import AuthShell from '../../components/auth/AuthShell';
import { authErrorMessage } from '../../utils/authErrors';
import { IS_HUAWEI_BUILD } from '../../utils/platform';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login, loginWithGoogle, signInAsGuest } = useAuth();
  const { showToast } = useUI();
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) { showToast('Please fill in all fields', 'error'); return; }
    setLoading(true);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      showToast(authErrorMessage(err, 'Login failed. Please try again.'), 'error');
    }
    setLoading(false);
  };

  const handleGoogleLogin = async () => {
    try {
      await loginWithGoogle();
      navigate('/', { replace: true });
    } catch (err) {
      showToast(authErrorMessage(err, 'Google login failed. Please try again.'), 'error');
    }
  };

  const handleGuestBrowse = async () => {
    setLoading(true);
    try {
      await signInAsGuest();
      navigate('/', { replace: true });
    } catch (err) {
      showToast(err?.message || 'Could not start guest session', 'error');
    }
    setLoading(false);
  };

  return (
    <AuthShell>
      <div className="w-full flex flex-col">
        <div className="flex flex-col">
          <div className="flex justify-center mb-8 lg:hidden">
            <VergrLogo size={64} />
          </div>
          <div className="mb-8 px-2">
            <h1 className="font-syne text-text-primary tracking-tight text-[32px] font-extrabold leading-tight text-center mb-2">Welcome back</h1>
            <p className="text-text-muted text-sm text-center">Sign in to continue</p>
          </div>
          <form onSubmit={handleLogin} className="flex flex-col gap-4 px-1">
            <label className="block relative group">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-text-muted group-focus-within:text-brand-violet-light transition-colors">
                <Icon name="mail" size={20} />
              </div>
              <input type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} className="input-with-icon" autoComplete="email" />
            </label>
            <label className="block relative group">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-text-muted group-focus-within:text-brand-violet-light transition-colors">
                <Icon name="lock" size={20} />
              </div>
              <input type={showPassword ? 'text' : 'password'} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="input-with-icon pr-12" autoComplete="current-password" />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 pr-4 flex items-center text-text-muted hover:text-text-primary transition-colors">
                <Icon name={showPassword ? 'visibility_off' : 'visibility'} size={18} />
              </button>
            </label>
            <div className="flex justify-end">
              <Link to="/forgot-password" className="text-text-secondary text-xs font-medium hover:text-text-primary transition-colors">Forgot password?</Link>
            </div>
            <button type="submit" disabled={loading} className="btn-primary mt-1">
              {loading ? (<div className="w-5 h-5 border-2 border-bg-dark/30 border-t-bg-dark rounded-full animate-spin" />) : ('Sign In')}
            </button>
          </form>
          {/* Google sign-in needs Google Play Services, which Huawei devices do
              not ship. On the AppGallery build the button could only ever fail,
              so it is removed — along with the "or" divider, since Google is the
              only thing under it and a lone divider reads as a broken layout. */}
          {!IS_HUAWEI_BUILD && (<>
          <div className="flex items-center gap-4 my-8 px-1">
            <div className="flex-1 h-px bg-white/[0.06]" />
            <span className="text-text-muted text-xs">or</span>
            <div className="flex-1 h-px bg-white/[0.06]" />
          </div>
          <div className="flex gap-3 px-1">
            <button onClick={handleGoogleLogin} className="flex-1 h-[48px] rounded-full border border-white/[0.08] bg-transparent flex items-center justify-center gap-2 hover:bg-surface-2/50 transition-colors active:scale-[0.97]">
              <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              <span className="text-text-primary text-sm font-medium">Google</span>
            </button>
          </div>
          </>)}
        </div>
        <div className="text-center py-6 space-y-3">
          <p className="text-text-muted text-sm">
            {"Don't have an account? "}
            <Link to="/signup" className="text-text-primary font-semibold hover:text-brand-violet-light transition-colors">Sign Up</Link>
          </p>
          {/* Guest mode — anonymous browsing for reviewers and curious
              visitors. Restricted to read-only inside the app; upgrade
              via Sign Up preserves the uid. */}
          <button
            type="button"
            onClick={handleGuestBrowse}
            disabled={loading}
            className="text-text-muted text-xs underline underline-offset-4 hover:text-text-primary transition-colors disabled:opacity-50"
          >
            Continue as guest — browse without signing up
          </button>
        </div>
      </div>
    </AuthShell>
  );
}
