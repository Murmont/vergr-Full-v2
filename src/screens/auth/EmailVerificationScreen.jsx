import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { onAuthStateChanged, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { auth, functions } from '../../firebase/config';
import { useUI } from '../../context/UIContext';
import Icon from '../../components/Icon';
import AuthShell from '../../components/auth/AuthShell';
import { refreshAfterVerification } from '../../utils/emailGate';

// /verify-email. REQUIRED since 2026-09-29 (founder): an account whose email
// is not verified can browse but cannot post, message or buy.
//
// Three ways in:
//   ?u=<uid>&t=<token>  the one-tap button in the email. Works signed out and on
//                       another device; verifies through verifyEmailCode.
//   ?next=<path>        from the prompt or sign-up: sends the email, then waits.
//   (nothing)           same, returning home afterwards.
//
// While it waits it re-reads the Auth account every few seconds and when the
// window regains focus, so tapping the link on a phone finishes the flow on the
// laptop too. Firebase Auth reloads are not Firestore reads.
//
// "Not now" stays: unverified accounts can still browse. The block itself is
// server-side (firestore.rules, the chat relay, checkout).

const clean = (msg) => String(msg || '')
  .replace(/^.*?\/(failed-precondition|resource-exhausted|invalid-argument|not-found|permission-denied|deadline-exceeded|already-exists):?\s*/i, '')
  .replace(/^(email_undeliverable|requires_recent_login|email_unverified):\s*/, '');

export default function EmailVerificationScreen() {
  const navigate = useNavigate();
  const { showToast } = useUI();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';
  const linkUid = params.get('u');
  const linkToken = params.get('t');

  // sending | ready | verifying | done | linkError | undeliverable | changing
  const [phase, setPhase] = useState(linkToken ? 'verifying' : 'sending');
  const [problem, setProblem] = useState('');
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [cooldown, setCooldown] = useState(0);
  const [email, setEmail] = useState(auth.currentUser?.email || '');
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const inputs = useRef([]);
  const started = useRef(false);

  const finish = useCallback(async () => {
    await refreshAfterVerification();
    setPhase('done');
  }, []);

  const sendEmail = useCallback(async (isResend = false, changeTo = null) => {
    try {
      const r = await httpsCallable(functions, 'sendEmailVerificationCode')(changeTo ? { newEmail: changeTo } : {});
      if (r?.data?.email) setEmail(r.data.email);
      if (r?.data?.alreadyVerified) { await finish(); return; }
      setPhase('ready');
      setCooldown(45);
      if (isResend || changeTo) showToast(changeTo ? 'Email updated. Check your new inbox.' : 'New email sent', 'success');
    } catch (err) {
      const msg = String(err?.message || '');
      if (msg.includes('email_unconfigured')) { setPhase('ready'); showToast('Email is not set up yet. Try again later.', 'error'); return; }
      if (msg.includes('email_undeliverable')) {
        setProblem(clean(msg));
        setNewEmail(err?.details?.suggestion || '');
        setPhase('undeliverable');
        return;
      }
      if (changeTo) { setPhase('changing'); showToast(clean(msg) || 'Could not change your email', 'error'); return; }
      setPhase('ready');
      showToast(clean(msg) || 'Could not send the email', 'error');
    }
  }, [finish, showToast]);

  // One tap from the email.
  useEffect(() => {
    if (!linkToken || started.current) return;
    started.current = true;
    (async () => {
      try {
        await httpsCallable(functions, 'verifyEmailCode')({ uid: linkUid, token: linkToken });
        // Only refresh a session that IS this account; the link may be opened
        // while signed in as someone else, or signed out.
        await new Promise((res) => { const un = onAuthStateChanged(auth, () => { un(); res(); }); });
        if (auth.currentUser?.uid === linkUid) await refreshAfterVerification();
        setPhase('done');
      } catch (err) {
        setProblem(clean(err?.message) || 'This link is not valid.');
        setPhase('linkError');
      }
    })();
  }, [linkToken, linkUid]);

  // Normal entry: wait for Firebase to restore the session, then send.
  useEffect(() => {
    if (linkToken) return undefined;
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      if (started.current) return;
      started.current = true;
      if (!user || user.isAnonymous) { navigate('/login', { replace: true }); return; }
      setEmail(user.email || '');
      if (user.emailVerified) { setPhase('done'); return; }
      sendEmail(false);
    });
    return () => unsub();
  }, [linkToken, navigate, sendEmail]);

  // Tapped the link somewhere else? Notice it here.
  useEffect(() => {
    if (phase !== 'ready' || linkToken) return undefined;
    const check = async () => {
      const u = auth.currentUser;
      if (!u) return;
      try { await u.reload(); } catch { return; }
      if (auth.currentUser?.emailVerified) finish();
    };
    const id = setInterval(check, 5000);
    window.addEventListener('focus', check);
    return () => { clearInterval(id); window.removeEventListener('focus', check); };
  }, [phase, linkToken, finish]);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const setDigit = (i, v) => {
    const c = v.replace(/\D/g, '');
    if (!c) { setDigits((d) => { const n = [...d]; n[i] = ''; return n; }); return; }
    setDigits((d) => {
      const n = [...d];
      if (c.length > 1) {
        c.slice(0, 6 - i).split('').forEach((ch, k) => { n[i + k] = ch; });
        inputs.current[Math.min(i + c.length, 5)]?.focus();
      } else {
        n[i] = c;
        if (i < 5) inputs.current[i + 1]?.focus();
      }
      return n;
    });
  };

  const onKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) inputs.current[i - 1]?.focus();
  };

  const verifyCode = async (code) => {
    setPhase('verifying');
    try {
      await httpsCallable(functions, 'verifyEmailCode')({ code });
      await finish();
    } catch (err) {
      setPhase('ready');
      setDigits(['', '', '', '', '', '']);
      inputs.current[0]?.focus();
      showToast(clean(err?.message) || 'Verification failed', 'error');
    }
  };

  useEffect(() => {
    const code = digits.join('');
    if (code.length === 6 && phase === 'ready') verifyCode(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits, phase]);

  const changeEmail = async (e) => {
    e?.preventDefault();
    const target = newEmail.trim().toLowerCase();
    if (!target || !password) return;
    setBusy(true);
    try {
      const u = auth.currentUser;
      await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, password));
      await sendEmail(false, target);
      setPassword('');
    } catch (err) {
      const code = String(err?.code || '');
      showToast(code.includes('wrong-password') || code.includes('invalid-credential')
        ? 'That password is not right.' : (clean(err?.message) || 'Could not change your email'), 'error');
    }
    setBusy(false);
  };

  const leave = () => {
    // A full load after verifying, so chat connections reopen with the new
    // token instead of the one that still says "unverified".
    if (phase === 'done') window.location.replace(next.startsWith('/') ? next : '/');
    else navigate(next, { replace: true });
  };

  const isPasswordAccount = auth.currentUser?.providerData?.some((p) => p.providerId === 'password');

  // ── Render ─────────────────────────────────────────────────────────────

  const Badge = ({ icon, tone = 'violet' }) => (
    <div
      className="w-16 h-16 rounded-2xl mx-auto mb-6 flex items-center justify-center"
      style={{ background: tone === 'green' ? '#123524' : tone === 'red' ? '#3A1420' : '#23133F' }}
    >
      <Icon name={icon} size={30} style={{ color: tone === 'green' ? '#34D399' : tone === 'red' ? '#FF7A93' : '#C9A6FF' }} />
    </div>
  );

  if (phase === 'sending' || (phase === 'verifying' && linkToken)) {
    return (
      <AuthShell>
        <div className="flex flex-col items-center py-16 gap-4">
          <div className="w-8 h-8 border-4 border-brand-violet border-t-transparent rounded-full animate-spin" />
          <p className="text-text-muted text-sm">{linkToken ? 'Verifying your email…' : 'Sending your verification email…'}</p>
        </div>
      </AuthShell>
    );
  }

  if (phase === 'done') {
    return (
      <AuthShell>
        <div className="w-full text-center">
          <Badge icon="verified" tone="green" />
          <h1 className="font-syne text-2xl font-extrabold text-text-primary mb-2">Email verified</h1>
          <p className="text-text-muted text-sm mb-7">You can post, message and buy on Vergr now.</p>
          <button onClick={leave} className="w-full h-12 rounded-2xl bg-brand-violet text-white font-bold text-[15px] hover:brightness-110 transition">
            Continue
          </button>
        </div>
      </AuthShell>
    );
  }

  if (phase === 'linkError') {
    return (
      <AuthShell>
        <div className="w-full text-center">
          <Badge icon="link_off" tone="red" />
          <h1 className="font-syne text-2xl font-extrabold text-text-primary mb-2">That link didn’t work</h1>
          <p className="text-text-muted text-sm mb-7">{problem}</p>
          <button onClick={() => navigate('/verify-email', { replace: true })} className="w-full h-12 rounded-2xl bg-brand-violet text-white font-bold text-[15px] hover:brightness-110 transition">
            Send a new email
          </button>
        </div>
      </AuthShell>
    );
  }

  if (phase === 'undeliverable' || phase === 'changing') {
    return (
      <AuthShell>
        <form onSubmit={changeEmail} className="w-full text-center">
          <Badge icon="alternate_email" tone={phase === 'undeliverable' ? 'red' : 'violet'} />
          <h1 className="font-syne text-2xl font-extrabold text-text-primary mb-2">
            {phase === 'undeliverable' ? 'We can’t email that address' : 'Change your email'}
          </h1>
          {phase === 'undeliverable' && <p className="text-text-muted text-sm mb-1">{problem}</p>}
          <p className="text-text-muted text-sm mb-6 break-all">Current: <span className="text-text-secondary">{email}</span></p>
          {isPasswordAccount ? (
            <>
              <input
                type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                placeholder="New email address" autoComplete="email"
                className="w-full h-12 px-4 mb-3 rounded-2xl bg-surface-2 text-text-primary text-[15px] focus:outline-none focus:ring-2 focus:ring-brand-violet"
              />
              <input
                type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Your Vergr password" autoComplete="current-password"
                className="w-full h-12 px-4 mb-5 rounded-2xl bg-surface-2 text-text-primary text-[15px] focus:outline-none focus:ring-2 focus:ring-brand-violet"
              />
              <button
                type="submit" disabled={busy || !newEmail.trim() || !password}
                className="w-full h-12 rounded-2xl text-white font-bold text-[15px] transition"
                style={{ background: busy || !newEmail.trim() || !password ? '#2A2340' : '#7B1FFF' }}
              >
                {busy ? 'Updating…' : 'Use this email'}
              </button>
            </>
          ) : (
            <p className="text-text-muted text-sm">This account signs in with Google, so its email is managed by Google. Email support@vergr.app if it needs changing.</p>
          )}
          <div className="mt-6 flex flex-col gap-3">
            {phase === 'changing' && (
              <button type="button" onClick={() => setPhase('ready')} className="text-sm font-semibold text-brand-violet-light hover:brightness-110">
                Keep {email}
              </button>
            )}
            <button type="button" onClick={leave} className="text-text-muted text-sm hover:text-text-secondary transition-colors">Not now</button>
          </div>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="w-full text-center">
        <Badge icon="mark_email_unread" />
        <h1 className="font-syne text-2xl font-extrabold text-text-primary mb-2">Check your email</h1>
        <p className="text-text-muted text-sm mb-1">Tap <b className="text-text-secondary">Verify my email</b> in the email we sent to</p>
        <p className="text-brand-violet-light text-sm font-semibold mb-6 break-all">{email}</p>
        <p className="text-text-muted text-xs mb-3">Or enter the 6-digit code from the email</p>

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
              aria-label={`Digit ${i + 1}`}
              disabled={phase === 'verifying'}
              className="w-11 h-14 sm:w-12 sm:h-16 text-center text-2xl font-bold rounded-2xl bg-surface-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-violet transition-all disabled:opacity-50"
            />
          ))}
        </div>

        {phase === 'verifying' && (
          <div className="flex items-center justify-center gap-2 text-text-muted text-sm mb-4">
            <div className="w-4 h-4 border-2 border-brand-violet border-t-transparent rounded-full animate-spin" /> Verifying…
          </div>
        )}

        <div className="flex flex-col items-center gap-3">
          <button
            onClick={() => cooldown === 0 && sendEmail(true)}
            disabled={cooldown > 0}
            className="text-sm font-semibold text-brand-violet-light hover:brightness-110 disabled:text-text-muted disabled:cursor-default transition-colors"
          >
            {cooldown > 0 ? `Resend email in ${cooldown}s` : 'Resend email'}
          </button>
          {isPasswordAccount && (
            <button onClick={() => { setNewEmail(''); setPhase('changing'); }} className="text-sm text-text-muted hover:text-text-secondary">
              Wrong address? Change it
            </button>
          )}
        </div>

        <div className="mt-8">
          <button onClick={leave} className="text-text-muted text-sm hover:text-text-secondary transition-colors">
            Not now
          </button>
          <p className="text-text-muted text-xs mt-2">You can browse Vergr, but posting, messaging and buying stay locked until you verify.</p>
        </div>
      </div>
    </AuthShell>
  );
}
