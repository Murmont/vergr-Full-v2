// VanguardGate — everything between opening Vergr Vanguard and moderating.
//
// The states, in order. None can be skipped by the client, because the server
// re-checks membership, rank and the authenticator on every action
// (functions/vanguard.js runVanguardAction, functions/adminSecurity.js):
//   1. signed out            → sign in with your Vergr account
//   2. not a moderator       → refused; an invited user accepts on vergr.app
//   3. moderator, no 2FA     → enroll an authenticator app (compulsory)
//   4. moderator, stale code → enter a 6-digit code (or a recovery code)
//
// ⚠ The OPERATOR gets in too, as founder oversight: the server treats it as a
// synthetic Overseer. It has no Vergr profile, so VanguardApp hands the
// screens a stand-in.
//
// ⚠ The screens read Firestore directly (reports, notes, escalations), and the
// rules decide those reads by membership, not by this gate. The gate stops a
// signed-in moderator using the app without a code; the SERVER is what stops
// any action without one.

import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { authErrorMessage } from '../utils/authErrors';
import { Shell, Err, Enroll, StepUp, input, button, GATE_COLORS as C } from '../admin/OperatorGate';
import { openInVergr } from '../admin/openExternal';

// Same session length the server enforces (VANGUARD_SESSION_SEC).
const SESSION_MS = 12 * 60 * 60 * 1000;

export default function VanguardGate({ children }) {
  const { currentUser, loading: authLoading, login, loginWithGoogle, logout } = useAuth();
  const [isOperator, setIsOperator] = useState(null);
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState('');

  const readClaim = useCallback(async () => {
    if (!currentUser) { setIsOperator(null); return false; }
    try {
      const r = await currentUser.getIdTokenResult();
      const v = r?.claims?.operator === true;
      setIsOperator(v);
      return v;
    } catch { setIsOperator(false); return false; }
  }, [currentUser]);

  const readStatus = useCallback(async () => {
    setChecking(true); setErr('');
    try {
      const res = await httpsCallable(functions, 'getMyAdminSecurityStatus')({});
      setStatus(res?.data || null);
    } catch (e) {
      setStatus(null);
      setErr(e?.message || 'Could not reach the server.');
    } finally { setChecking(false); }
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!currentUser) { setStatus(null); return; }
      await readClaim();
      if (live) await readStatus();
    })();
    return () => { live = false; };
  }, [currentUser, readClaim, readStatus]);

  if (authLoading) return <Shell title="Vergr Vanguard" subtitle="Checking your session…" />;

  // ── 1. signed out ──────────────────────────────────────────────────────────
  if (!currentUser) return <SignIn login={login} loginWithGoogle={loginWithGoogle} />;

  if (isOperator === null || (checking && !status)) {
    return <Shell title="Vergr Vanguard" subtitle="Checking your access…" />;
  }
  if (!status) {
    return (
      <Shell title="Vergr Vanguard" subtitle="Could not reach the server.">
        <Err>{err}</Err>
        <button type="button" style={button(false)} onClick={readStatus}>Try again</button>
        <SignOut logout={logout} />
      </Shell>
    );
  }

  // ── 2. not a moderator ─────────────────────────────────────────────────────
  const member = !!status.vanguard;
  if (!isOperator && !member) {
    return (
      <Shell
        title="Not a Vanguard moderator"
        subtitle="This account is not an active member of the Vanguard. If you were invited, accept the invitation on vergr.app first, then sign in here again."
      >
        <button type="button" style={button(false)} onClick={() => openInVergr('/vanguard/invitation')}>
          Open my invitation on vergr.app
        </button>
        <button type="button" style={{ ...button(false), background: C.card2 }} onClick={readStatus}>
          I have accepted it
        </button>
        <SignOut logout={logout} />
      </Shell>
    );
  }

  // ── 3 + 4. authenticator ───────────────────────────────────────────────────
  const enrolled = !!status.enrolled;
  const fresh = enrolled && Date.now() - (status.lastStepUpAt || 0) < SESSION_MS;
  if (!enrolled) {
    return (
      <Enroll
        onDone={readStatus}
        logout={logout}
        note="Scan this with an authenticator app, then enter the 6-digit code it shows. Required: the server refuses every moderation action without it."
      />
    );
  }
  if (!fresh) {
    return <StepUp onDone={readStatus} logout={logout} remaining={status.recoveryCodesRemaining} />;
  }

  return (
    <>
      {children({ isOperator: !!isOperator, rank: status.vanguard?.rank || null })}
      <Err>{err}</Err>
    </>
  );
}

function SignOut({ logout }) {
  return (
    <button
      type="button"
      style={{ ...button(false), background: 'transparent', color: C.dim, marginTop: 6 }}
      onClick={() => logout()}
    >
      Sign out
    </button>
  );
}

// A moderator signs in with the SAME Vergr account they were invited on, by
// whichever method that account uses. There is no sign-up here: an account
// that is not a Vanguard member is refused at step 2 anyway.
function SignIn({ login, loginWithGoogle }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await login(email.trim(), password); }
    catch (e2) { setErr(authErrorMessage(e2)); setBusy(false); }
  };
  const google = async () => {
    setBusy(true); setErr('');
    try { await loginWithGoogle(); }
    catch (e2) { setErr(authErrorMessage(e2)); setBusy(false); }
  };

  return (
    <Shell title="Vergr Vanguard" subtitle="Sign in with the Vergr account you moderate with.">
      <form onSubmit={submit}>
        <input
          style={input} type="email" autoComplete="username" placeholder="Email"
          value={email} onChange={(e) => setEmail(e.target.value)} required
        />
        <div style={{ height: 10 }} />
        <input
          style={input} type="password" autoComplete="current-password" placeholder="Password"
          value={password} onChange={(e) => setPassword(e.target.value)} required
        />
        <button type="submit" style={button(busy)} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <button type="button" style={{ ...button(busy), background: C.card2 }} disabled={busy} onClick={google}>
        Continue with Google
      </button>
      <Err>{err}</Err>
    </Shell>
  );
}
