import { useState, useMemo, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import VergrLogo from '../../components/VergrLogo';
import Icon from '../../components/Icon';
import AuthShell from '../../components/auth/AuthShell';
import { fetchRegionStatus, regionDisplayName } from '../../utils/geoBlocks';
import { computeAge, latestAdultDob } from '../../utils/age';
import { LEGAL_VERSION } from '../marketing/legal/legalContent';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/config';


export default function SignUpStep1() {
  const [email, setEmail] = useState('');
  // Can this address receive mail? Checked on Continue, before an account
  // exists (verifyEmailCode op 'check': shape, typos, throwaway domains, MX).
  const [emailIssue, setEmailIssue] = useState(null); // { message, suggestion }
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [dob, setDob] = useState('');
  const [agreed, setAgreed] = useState(false);
  // Separate compliance confirmation — user warrants that their use of
  // VERGR is lawful in their own jurisdiction (ToS §4A.2 + §4A.4). Stored
  // as `complianceConfirmedAt` on the user doc so we have evidence.
  const [complianceConfirmed, setComplianceConfirmed] = useState(false);
  const [regionStatus, setRegionStatus] = useState(null);
  const [guestLoading, setGuestLoading] = useState(false);
  const navigate = useNavigate();
  const { signInAsGuest, isAnonymous } = useAuth();
  const { showToast } = useUI();

  // /linkinbio "Claim it" passes ?handle=; stash it so SignUpStep2 can
  // prefill the username (query params don't survive the step navigation).
  useEffect(() => {
    try {
      const h = new URLSearchParams(window.location.search).get('handle');
      if (h) sessionStorage.setItem('vergr_claim_handle', h.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20));
    } catch { /* no-op */ }
  }, []);

  // Block account creation from prohibited jurisdictions. The server
  // re-enforces this on every wallet/tournament/payout callable, but
  // signup-time blocking gives the user a clear explanation instead of
  // discovering it later.
  useEffect(() => {
    fetchRegionStatus().then(setRegionStatus);
  }, []);

  const age = useMemo(() => computeAge(dob), [dob]);
  const adult = age != null && age >= 18;

  const passwordStrength = useMemo(() => {
    if (!password) return { score: 0, label: '', color: '' };
    let score = 0;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    if (password.length >= 12) score++;
    const labels = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Excellent'];
    const colors = ['', 'bg-brand-ember', 'bg-orange-500', 'bg-brand-gold', 'bg-brand-violet', 'bg-green-500'];
    return { score, label: labels[score] || '', color: colors[score] || '' };
  }, [password]);

  const blockedRegion = regionStatus?.blocked === true;
  const canContinue =
    email && password.length >= 8 && password === confirmPassword &&
    adult && agreed && complianceConfirmed && !blockedRegion;

  const handleContinue = async () => {
    if (!canContinue || checkingEmail) return;
    setCheckingEmail(true);
    try {
      const r = await httpsCallable(functions, 'verifyEmailCode')({ op: 'check', email: email.trim() });
      if (r?.data && r.data.ok === false) {
        setEmailIssue({ message: r.data.message, suggestion: r.data.suggestion || null });
        setCheckingEmail(false);
        return;
      }
    } catch {
      // Network trouble: carry on. The verification email is the real proof,
      // and the server checks the address again before sending it.
    }
    setCheckingEmail(false);
    navigate('/signup/step2', {
      state: {
        email, password, dob,
        // The CURRENT legal version. This said 4 while the Terms were at 6, so
        // every new email account got the "Terms updated" re-accept modal the
        // moment it finished signing up (TosVersionGate). Fixed 2026-09-27.
        tosVersion: LEGAL_VERSION,
        tosAcceptedAt: Date.now(),
        complianceConfirmedAt: Date.now(),
        // Tell step 2 whether this is a brand-new signup or a guest
        // conversion. Step 2 picks linkWithCredential vs createUser.
        fromGuest: isAnonymous === true,
      },
    });
  };

  const handleGuestBrowse = async () => {
    setGuestLoading(true);
    try {
      await signInAsGuest();
      navigate('/', { replace: true });
    } catch (err) {
      showToast(err?.message || 'Could not start guest session', 'error');
    }
    setGuestLoading(false);
  };

  return (
    <AuthShell>
      <div className="w-full">
        <div className="flex justify-center mb-8 lg:hidden">
          <VergrLogo size={64} />
        </div>
        <h1 className="font-syne text-2xl font-extrabold text-center mb-1">Create Account</h1>
        <p className="text-text-muted text-sm text-center mb-8">Set up your VERGR account</p>

        <div className="flex flex-col gap-4">
          {/* Email */}
          <label className="block relative group">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-text-muted group-focus-within:text-brand-violet-light transition-colors">
              <Icon name="mail" size={22} />
            </div>
            <input type="email" placeholder="Email Address" value={email} onChange={e => { setEmail(e.target.value); setEmailIssue(null); }} className="input-with-icon" />
          </label>
          {emailIssue && (
            <div className="-mt-1 text-sm" role="alert" style={{ color: '#FF8FA3' }}>
              {emailIssue.message}{' '}
              {emailIssue.suggestion && (
                <button type="button" className="font-semibold underline" style={{ color: '#C9A6FF' }}
                  onClick={() => { setEmail(emailIssue.suggestion); setEmailIssue(null); }}>
                  Use {emailIssue.suggestion}
                </button>
              )}
            </div>
          )}

          {/* Password */}
          <label className="block relative group">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-text-muted group-focus-within:text-brand-violet-light transition-colors">
              <Icon name="lock" size={22} />
            </div>
            <input
              type={showPassword ? 'text' : 'password'} placeholder="Password (min 8 chars)"
              value={password} onChange={e => setPassword(e.target.value)} className="input-with-icon pr-12" autoComplete="new-password"
            />
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 pr-4 flex items-center text-text-muted hover:text-text-primary transition-colors">
              <Icon name={showPassword ? 'visibility_off' : 'visibility'} size={20} />
            </button>
          </label>

          {/* Password strength meter */}
          {password && (
            <div className="px-1">
              <div className="flex gap-1 mb-1">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className={`flex-1 h-1 rounded-full ${i <= passwordStrength.score ? passwordStrength.color : 'bg-surface-3'} transition-colors`} />
                ))}
              </div>
              <p className="text-xs text-text-secondary">{passwordStrength.label}</p>
            </div>
          )}

          {/* Confirm Password */}
          <label className="block relative group">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-text-muted group-focus-within:text-brand-violet-light transition-colors">
              <Icon name="lock" size={22} />
            </div>
            <input
              type="password" placeholder="Confirm Password"
              value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="input-with-icon" autoComplete="new-password"
            />
            {confirmPassword && (
              <div className="absolute inset-y-0 right-0 pr-4 flex items-center">
                <Icon name={password === confirmPassword ? 'check_circle' : 'cancel'} size={20}
                  className={password === confirmPassword ? 'text-brand-violet-light' : 'text-brand-ember'} />
              </div>
            )}
          </label>

          {/* Date of birth — VERGR is 18+ only. This is the self-declared
              first gate; Persona's government-ID check is the authoritative
              gate before wallet/tournament/payout access. */}
          <label className="block">
            <span className="text-text-secondary text-xs font-bold uppercase tracking-wider mb-1.5 block">Date of birth</span>
            <input
              type="date"
              value={dob}
              max={latestAdultDob()}
              onChange={e => setDob(e.target.value)}
              className="input-with-icon pl-4"
            />
            {dob && !adult && (
              <p className="text-brand-ember text-xs mt-1.5">You must be at least 18 to create a VERGR account.</p>
            )}
          </label>

          {/* Geo block notice */}
          {blockedRegion && (
            <div className="rounded-xl border border-brand-ember/40 bg-brand-ember/10 p-3 text-text-primary text-xs leading-relaxed">
              <strong>Not available in {regionDisplayName(regionStatus)}.</strong>
              {' '}VERGR's virtual-currency features are
              not currently offered in your region.
            </div>
          )}

          {/* Terms */}
          <label className="flex items-start gap-3 px-1 cursor-pointer">
            <button type="button" onClick={() => setAgreed(!agreed)}
              className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                agreed ? 'bg-brand-violet border-brand-violet' : 'border-white/[0.06] bg-surface-2'
              }`}>
              {agreed && <Icon name="check" size={14} className="text-bg-dark" />}
            </button>
            <span className="text-text-secondary text-sm">
              I am 18+ and agree to the{' '}
              <Link to="/terms" target="_blank" className="text-brand-violet-light">Terms of Service</Link>,{' '}
              <Link to="/privacy" target="_blank" className="text-brand-violet-light">Privacy Policy</Link>, and{' '}
              <Link to="/acceptable-use" target="_blank" className="text-brand-violet-light">Acceptable Use Policy</Link>.
            </span>
          </label>

          {/* Local-law compliance confirmation — required separately so the
              record is unambiguous if a regulator ever questions the
              user-responsibility shift. Backs ToS §4A.2. */}
          <label className="flex items-start gap-3 px-1 cursor-pointer">
            <button type="button" onClick={() => setComplianceConfirmed(!complianceConfirmed)}
              className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                complianceConfirmed ? 'bg-brand-violet border-brand-violet' : 'border-white/[0.06] bg-surface-2'
              }`}>
              {complianceConfirmed && <Icon name="check" size={14} className="text-bg-dark" />}
            </button>
            <span className="text-text-secondary text-sm">
              I confirm that my use of VERGR — including Coin purchases,
              subscriptions, and receiving a creator revenue share — is
              lawful in my jurisdiction. I take sole
              responsibility for verifying this and indemnify VERGR
              accordingly.
            </span>
          </label>

          <button onClick={handleContinue} disabled={!canContinue}
            className={`btn-primary mt-2 ${!canContinue ? 'opacity-40 cursor-not-allowed' : ''}`}>
            {checkingEmail ? 'Checking…' : 'Continue'}
          </button>
        </div>

        <div className="text-center mt-6 space-y-3">
          <p className="text-text-secondary text-sm">
            Already have an account? <Link to="/login" className="text-brand-violet-light font-semibold">Log In</Link>
          </p>
          {!isAnonymous && (
            <button
              type="button"
              onClick={handleGuestBrowse}
              disabled={guestLoading}
              className="text-text-muted text-xs underline underline-offset-4 hover:text-text-primary transition-colors disabled:opacity-50"
            >
              {guestLoading ? 'Starting guest session…' : 'Or browse as a guest first'}
            </button>
          )}
          {isAnonymous && (
            <p className="text-brand-violet-light text-xs">
              You're currently browsing as a guest — completing this form
              upgrades your guest session to a permanent account.
            </p>
          )}
        </div>
      </div>
    </AuthShell>
  );
}
