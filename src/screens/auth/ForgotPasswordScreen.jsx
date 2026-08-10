import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import VergrLogo from '../../components/VergrLogo';
import Icon from '../../components/Icon';
import AuthShell from '../../components/auth/AuthShell';
import { authErrorMessage } from '../../utils/authErrors';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const { resetPassword } = useAuth();
  const { showToast } = useUI();
  const navigate = useNavigate();

  const handleReset = async (e) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    try {
      await resetPassword(email);
      setSent(true);
      showToast('Reset link sent! Check your email.', 'success');
    } catch (err) {
      showToast(authErrorMessage(err, 'Failed to send reset email'), 'error');
    }
    setLoading(false);
  };

  if (sent) {
    return (
      <AuthShell>
        <div className="text-center">
          <div className="w-20 h-20 rounded-full bg-brand-violet/12 flex items-center justify-center mx-auto mb-6">
            <Icon name="mark_email_read" size={40} className="text-brand-violet-light" />
          </div>
          <h1 className="font-syne text-2xl font-bold mb-2">Check Your Email</h1>
          <p className="text-text-secondary mb-8">We've sent a password reset link to<br /><span className="text-brand-violet-light">{email}</span></p>
          <button onClick={() => navigate('/login')} className="btn-primary max-w-[300px] mx-auto">Back to Login</button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="w-full">
        <div className="flex justify-center mb-8 lg:hidden"><VergrLogo size={44} /></div>
        <h1 className="font-syne text-2xl font-bold text-center mb-2">Forgot Password?</h1>
        <p className="text-text-secondary text-center mb-8">Enter your email and we'll send you a reset link</p>
        <form onSubmit={handleReset} className="flex flex-col gap-5">
          <label className="block relative group">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-text-muted group-focus-within:text-brand-violet-light transition-colors">
              <Icon name="mail" size={22} />
            </div>
            <input type="email" placeholder="Email Address" value={email} onChange={e => setEmail(e.target.value)} className="input-with-icon" autoComplete="email" />
          </label>
          <button type="submit" disabled={!email || loading} className={`btn-primary ${!email ? 'opacity-40' : ''}`}>
            {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Send Reset Link'}
          </button>
        </form>
        <div className="text-center mt-6">
          <Link to="/login" className="text-text-secondary text-sm hover:text-brand-violet-light transition-colors">← Back to Login</Link>
        </div>
      </div>
    </AuthShell>
  );
}
