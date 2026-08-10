import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, functions } from '../../firebase/config';
import { useUI } from '../../context/UIContext';
import Icon from '../../components/Icon';
import AuthShell from '../../components/auth/AuthShell';

// 6-digit email verification. Sends a code on mount; if the email backend
// isn't configured yet (SMTP secrets still placeholder) the send throws
// `email_unconfigured` and we transparently skip to the next step so the live
// app is never blocked. Verification is always skippable (gift shop, not toll
// booth — see docs/handover/15_ONBOARDING_AUTH.md).

export default function EmailVerificationScreen() {
  const navigate = useNavigate();
  const { showToast } = useUI();
  const [params] = useSearchParams();
  const next = params.get('next') || '/onboarding';

  const [phase, setPhase] = useState('sending'); // sending | ready | verifying
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [cooldown, setCooldown] = useState(0);
  const email = auth.currentUser?.email || '';
  const inputs = useRef([]);
  const sentOnce = useRef(false);

  const sendCode = async (isResend = false) => {
    try {
      await httpsCallable(functions, 'sendEmailVerificationCode')();
      setPhase('ready');
      setCooldown(45);
      if (isResend) showToast('New code sent', 'success');
    } catch (err) {
      const msg = String(err?.message || '');
      // Backend not configured yet → skip verification silently.
      if (msg.includes('email_unconfigured')) { navigate(next, { replace: true }); return; }
      setPhase('ready');
      showToast(msg.replace(/^.*?\/(failed-precondition|resource-exhausted):?\s*/i, '') || 'Could not send a code', 'error');
    }
  };

  // Wait for Firebase to RESTORE the session before deciding logged-in-or-not.
  // On a cold page load auth.currentUser is null for the first moments even for
  // a logged-in user, so a synchronous check here bounced real users to /login.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      if (sentOnce.current) return;
      sentOnce.current = true;
      if (!user) { navigate('/login', { replace: true }); return; }
      sendCode(false);
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const setDigit = (i, v) => {
    const clean = v.replace(/\D/g, '');
    if (!clean) { setDigits((d) => { const n = [...d]; n[i] = ''; return n; }); return; }
    setDigits((d) => {
      const n = [...d];
      // A paste of the whole code lands in one input too.
      if (clean.length > 1) {
        clean.slice(0, 6 - i).split('').forEach((ch, k) => { n[i + k] = ch; });
        inputs.current[Math.min(i + clean.length, 5)]?.focus();
      } else {
        n[i] = clean;
        if (i < 5) inputs.current[i + 1]?.focus();
      }
      return n;
    });
  };

  const onKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) inputs.current[i - 1]?.focus();
  };

  const verify = async (code) => {
    setPhase('verifying');
    try {
      await httpsCallable(functions, 'verifyEmailCode')({ code });
      showToast('Email verified!', 'success');
      navigate(next, { replace: true });
    } catch (err) {
      setPhase('ready');
      setDigits(['', '', '', '', '', '']);
      inputs.current[0]?.focus();
      showToast(String(err?.message || '').replace(/^.*?:\s*/, '') || 'Verification failed', 'error');
    }
  };

  useEffect(() => {
    const code = digits.join('');
    if (code.length === 6 && phase === 'ready') verify(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits, phase]);

  if (phase === 'sending') {
    return (
      <AuthShell>
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-brand-violet border-t-transparent rounded-full animate-spin" />
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="w-full text-center">
        <div className="w-16 h-16 rounded-2xl mx-auto mb-6 flex items-center justify-center"
          style={{ background: 'rgba(123,31,255,0.14)', border: '1px solid rgba(180,79,255,0.4)' }}>
          <Icon name="mark_email_unread" size={30} className="text-brand-violet-light" />
        </div>
        <h1 className="font-syne text-2xl font-extrabold text-text-primary mb-2">Verify your email</h1>
        <p className="text-text-muted text-sm mb-1">Enter the 6-digit code we sent to</p>
        <p className="text-brand-violet-light text-sm font-semibold mb-7 break-all">{email}</p>

        <div className="flex justify-center gap-2 sm:gap-2.5 mb-6">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => (inputs.current[i] = el)}
              value={d}
              onChange={(e) => setDigit(i, e.target.value)}
              onKeyDown={(e) => onKeyDown(i, e)}
              inputMode="numeric"
              maxLength={6}
              disabled={phase === 'verifying'}
              className="w-11 h-14 sm:w-12 sm:h-16 text-center text-2xl font-bold rounded-2xl bg-surface-2 border border-white/[0.08] text-text-primary focus:border-brand-violet/70 focus:outline-none focus:shadow-[0_0_14px_rgba(123,31,255,0.25)] transition-all disabled:opacity-50"
            />
          ))}
        </div>

        {phase === 'verifying' && (
          <div className="flex items-center justify-center gap-2 text-text-muted text-sm mb-4">
            <div className="w-4 h-4 border-2 border-brand-violet border-t-transparent rounded-full animate-spin" /> Verifying…
          </div>
        )}

        <button
          onClick={() => cooldown === 0 && sendCode(true)}
          disabled={cooldown > 0}
          className="text-sm font-semibold text-brand-violet-light hover:brightness-110 disabled:text-text-muted disabled:cursor-default transition-colors"
        >
          {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
        </button>

        <div className="mt-8">
          <button onClick={() => navigate(next, { replace: true })} className="text-text-muted text-sm hover:text-text-secondary transition-colors">
            Skip for now
          </button>
        </div>
      </div>
    </AuthShell>
  );
}
