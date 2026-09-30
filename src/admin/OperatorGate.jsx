// OperatorGate — everything between opening Vergr Admin and using it.
//
// The states, in order, and none of them can be skipped by the client because
// the server re-checks every one on every admin call (functions/operator.js
// and functions/adminSecurity.js):
//   1. signed out             → sign in with the operator or sub-admin address
//   2. invited, not accepted  → one button, no code to type (AcceptInvite)
//   3. neither, no invite     → this account has no admin authority at all
//   4. admin, no 2FA          → enroll an authenticator app (compulsory)
//   5. admin, stale session   → enter a 6-digit code (or a recovery code)
//
// ⚠ "admin" here is the OPERATOR (full) or an active SUB-ADMIN (scoped to
// allowedScreens, which AdminShell filters the sidebar by). Both need 2FA.
//
// Founder, 2026-09-19: "just use 2fa or something that is free, like the
// authenticator app", and, on losing the phone: "what if my device breaks?
// thats a stupid idea claude." Hence recovery codes, shown once at enrollment.

import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { authErrorMessage } from '../utils/authErrors';
import { QRCodeSVG } from 'qrcode.react';
import { GooglePlayPrism } from '../components/wallet/PaymentMethodPicker';
import { openExternal } from './openExternal';

const C = {
  bg: '#09090f', card: '#12121e', card2: '#171727', border: '#1e1e30',
  text: '#e0e0f0', dim: '#7070a0', accent: '#7c3aed', bad: '#f04060', good: '#34d399',
};

// Google Authenticator on Google Play. A constant so the button and the
// fallback text can never point at different places.
const AUTHENTICATOR_PLAY_URL =
  'https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2';

export const GATE_COLORS = C;
export const input = {
  width: '100%', padding: '12px 14px', borderRadius: 10, background: C.card2,
  border: `1px solid ${C.border}`, color: C.text, fontSize: 14, outline: 'none',
  boxSizing: 'border-box',
};
export const button = (disabled) => ({
  width: '100%', padding: '12px 14px', borderRadius: 10, border: 'none',
  background: disabled ? '#2a2a40' : C.accent, color: '#fff', fontSize: 14,
  fontWeight: 700, cursor: disabled ? 'default' : 'pointer', marginTop: 12,
});

// ⚠⚠ `margin: auto` ON THE CARD, NEVER `align-items: center` ON THE FLEX
// PARENT. Measured 2026-09-20: once the enrollment screen carried a QR, the
// card came to 741px against a 768px viewport, and a centred flex child that
// overflows is clipped at BOTH ends with no way to scroll to them — the Sign
// out button was simply unreachable. `margin: auto` centres it while it fits
// and lets it scroll normally when it does not.
// [[reference-flex-centering-leftovers]]
export function Shell({ title, subtitle, children }) {
  return (
    <div style={{
      minHeight: '100vh', background: C.bg, display: 'flex',
      justifyContent: 'center', padding: 24, overflowY: 'auto',
    }}>
      <div style={{ width: '100%', maxWidth: 380, margin: 'auto', background: C.card, borderRadius: 16, padding: 24 }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 20, marginBottom: 4 }}>{title}</div>
        {subtitle && <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>{subtitle}</div>}
        {children}
      </div>
    </div>
  );
}

export function Err({ children }) {
  if (!children) return null;
  return <div style={{ color: C.bad, fontSize: 13, marginTop: 10, lineHeight: 1.45 }}>{children}</div>;
}

export default function OperatorGate({ children }) {
  const { currentUser, loading: authLoading, login, signUp, logout } = useAuth();

  const [isOperator, setIsOperator] = useState(null); // null = unknown
  const [status, setStatus] = useState(null);         // getMyAdminSecurityStatus
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState('');
  const [justCreated, setJustCreated] = useState(false);

  // The claim rides the ID token the client already holds: no network call and
  // no Firestore read. forceRefresh only after enrollment, when it can change.
  const readClaim = useCallback(async (force = false) => {
    if (!currentUser) { setIsOperator(null); return false; }
    try {
      const r = await currentUser.getIdTokenResult(force);
      const v = r?.claims?.operator === true;
      setIsOperator(v);
      return v;
    } catch { setIsOperator(false); return false; }
  }, [currentUser]);

  const readStatus = useCallback(async () => {
    setChecking(true);
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
      await readClaim();
      // ⚠ UNCONDITIONAL, and it used to be `if (op)`. Gating this on the
      // operator claim meant a sub-admin never had their status loaded, so the
      // gate saw neither their access nor their pending invitation and refused
      // them. The call answers for any signed-in account and discloses only
      // facts about that account, so there is nothing to withhold here.
      if (live) await readStatus();
    })();
    return () => { live = false; };
  }, [readClaim, readStatus]);

  if (authLoading) return <Shell title="Vergr Admin" subtitle="Checking your session…" />;

  // ── 1. signed out ──────────────────────────────────────────────────────────
  if (!currentUser) return <SignIn login={login} signUp={signUp} onCreated={() => setJustCreated(true)} />;

  // ── 2. signed in but not an operator ───────────────────────────────────────
  // ⚠ WaitingForClaim, not a refusal, right after the account is created. The
  // claim is set by the onUserCreated trigger a second or two later, and the
  // client's ID token only learns about it on a forced refresh.
  if (isOperator === false && justCreated) {
    return <WaitingForClaim onTick={() => readClaim(true)} onGiveUp={() => setJustCreated(false)} />;
  }

  if (isOperator === null || (checking && !status)) {
    return <Shell title="Vergr Admin" subtitle="Checking your access…" />;
  }

  // ⚠⚠ A SUB-ADMIN IS NOT AN OPERATOR AND MUST STILL GET IN. Vergr Admin is the
  // only admin surface that exists now, so gating purely on the operator claim
  // made every invited sub-admin unreachable: they could be invited, and then
  // had nowhere to accept it and nothing to open. The server decides both
  // facts (functions/adminSecurity.js getMyAdminSecurityStatus); this only
  // draws them, and AdminShell scopes the sidebar to allowedScreens.
  const subAdmin = !!status?.subAdmin;
  const pendingInvite = !!status?.pendingInvite;

  if (!isOperator && !subAdmin) {
    if (pendingInvite) return <AcceptInvite onDone={readStatus} logout={logout} />;
    return (
      <Shell
        title="No admin authority"
        subtitle="This account holds no admin access and has no invitation waiting. Vergr Admin cannot be used with an ordinary Vergr account."
      >
        <button type="button" style={button(false)} onClick={() => logout()}>Sign out</button>
      </Shell>
    );
  }

  // ── 3 + 4. authenticator ───────────────────────────────────────────────────
  // ⚠ Compulsory for a sub-admin too, not only the operator. They can ban and
  // mute real people on the screens they hold, and `requireFreshStepUp` fails
  // closed for both, so an unenrolled sub-admin would be refused by every
  // guarded call with nothing on screen explaining why.
  const enrolled = !!status?.enrolled;
  const lastStepUp = status?.lastStepUpAt || 0;
  const fresh = enrolled && Date.now() - lastStepUp < 12 * 60 * 60 * 1000;

  if (!enrolled) {
    return <Enroll onDone={async () => { await readClaim(true); await readStatus(); }} logout={logout} />;
  }
  if (!fresh) {
    return <StepUp onDone={readStatus} logout={logout} remaining={status?.recoveryCodesRemaining} />;
  }

  return (
    <>
      {children}
      <Err>{err}</Err>
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────────
function SignIn({ login, signUp, onCreated }) {
  // `create` is the ONE-TIME first run: the operator account does not exist
  // until someone makes it. It only works on an email that an existing admin
  // armed first (inviteAdmin with operator: true), so this form cannot hand
  // anyone authority — an unarmed email just creates an ordinary account with
  // no claim, which the gate then refuses.
  const [create, setCreate] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (create && password !== confirm) { setErr('Those passwords do not match.'); return; }
    setBusy(true); setErr('');
    try {
      if (create) { await signUp(email.trim(), password); onCreated?.(); }
      else await login(email.trim(), password);
    } catch (e2) {
      setErr(authErrorMessage(e2));
      setBusy(false);
    }
  };

  return (
    <Shell
      title="Vergr Admin"
      subtitle={create
        ? 'First run. Use the email that was armed for the operator, and a password only you know.'
        : 'Sign in with the operator account. This is not a Vergr user account.'}
    >
      <form onSubmit={submit}>
        <input
          style={input} type="email" autoComplete="username" placeholder="Email"
          value={email} onChange={(e) => setEmail(e.target.value)} required
        />
        <div style={{ height: 10 }} />
        <input
          style={input} type="password" autoComplete={create ? 'new-password' : 'current-password'} placeholder="Password"
          value={password} onChange={(e) => setPassword(e.target.value)} required
        />
        {create && (
          <>
            <div style={{ height: 10 }} />
            <input
              style={input} type="password" autoComplete="new-password" placeholder="Confirm password"
              value={confirm} onChange={(e) => setConfirm(e.target.value)} required
            />
          </>
        )}
        <button type="submit" style={button(busy)} disabled={busy}>
          {busy ? (create ? 'Creating…' : 'Signing in…') : (create ? 'Create operator account' : 'Sign in')}
        </button>
        <Err>{err}</Err>
      </form>
      <button
        type="button"
        style={{ ...button(false), background: 'transparent', color: C.dim, marginTop: 6 }}
        onClick={() => { setCreate((v) => !v); setErr(''); }}
      >
        {create ? 'I already have the operator account' : 'First run: create the operator account'}
      </button>
    </Shell>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// The whole sub-admin on-ramp, and it deliberately asks for NOTHING.
//
// ⚠⚠ THERE IS NO INVITE CODE TO TYPE, BY DESIGN. The old flow needed an
// inviteId, which nothing in the product ever delivered: the notification that
// was meant to carry it looked the invitee up by a users/{uid}.email field
// removed in 2026-09, so it matched nobody and sent nothing. An invitee may
// also be a profile-less ops account with no app to receive a notification in.
// So the server finds the pending invite from the signed-in address itself
// (acceptAdminInvite with no argument), and the only thing to hand a new
// sub-admin is the installer.
function AcceptInvite({ onDone, logout }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const accept = async () => {
    setBusy(true); setErr("");
    try {
      await httpsCallable(functions, "acceptAdminInvite")({});
      await onDone();
    } catch (e) {
      setErr(e?.message || "Could not accept the invitation.");
      setBusy(false);
    }
  };
  return (
    <Shell
      title="You have been invited"
      subtitle="An administrator invited this address to Vergr Admin. Accepting grants only the screens they chose, and you will set up an authenticator next."
    >
      <button type="button" style={button(busy)} disabled={busy} onClick={accept}>
        {busy ? "Accepting…" : "Accept invitation"}
      </button>
      <button
        type="button"
        style={{ ...button(false), background: "transparent", color: C.dim, marginTop: 6 }}
        onClick={() => logout()}
      >
        Sign out
      </button>
      <Err>{err}</Err>
    </Shell>
  );
}

// The claim is written by a server trigger moments after the account exists, so
// the app waits for the token to catch up rather than declaring "not an admin"
// at the one moment that is guaranteed to look wrong.
function WaitingForClaim({ onTick, onGiveUp }) {
  const [waited, setWaited] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setWaited((w) => {
        if (w >= 30) { clearInterval(t); onGiveUp(); return w; }
        onTick();
        return w + 3;
      });
    }, 3000);
    return () => clearInterval(t);
  }, [onTick, onGiveUp]);
  return <Shell title="Finishing setup" subtitle={`Waiting for the server to grant this account operator access… ${waited}s`} />;
}

// ───────────────────────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────
// A way to GET an authenticator, on the screen that demands one.
//
// ⚠ GOOGLE'S OWN PRISM, UNMODIFIED, ON A NEUTRAL BUTTON. The official "Get it
// on Google Play" badge is a fixed asset that may not be redrawn, and this repo
// does not have it, so faking one would breach Google's brand guidelines. The
// prism on a neutral ground with descriptive text is the pattern Google
// documents and the one Vergr already ships at checkout, so it is reused from
// PaymentMethodPicker rather than copied.
//
// ⚠ `window.open` DOES NOT REACH THE SYSTEM BROWSER FROM A TAURI WINDOW. It
// would either do nothing or navigate the console itself to Google Play, which
// on a packaged app is a dead end with no address bar to get back from. The
// shell plugin is loaded lazily so this file stays importable on the web.
function GetAuthenticator() {
  const [failed, setFailed] = useState(false);
  const open = async () => {
    if (!(await openExternal(AUTHENTICATOR_PLAY_URL))) setFailed(true);
  };
  return (
    <>
      <button
        type="button"
        onClick={open}
        style={{
          width: '100%', padding: '11px 14px', borderRadius: 10, border: 'none',
          background: C.card2, color: C.text, fontSize: 13, fontWeight: 700,
          cursor: 'pointer', marginTop: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        }}
      >
        <GooglePlayPrism size={18} />
        Get Google Authenticator
      </button>
      <div style={{ color: C.dim, fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
        Any authenticator app works. Opens Google Play in your browser.
      </div>
      {failed && (
        <div style={{ color: C.dim, fontSize: 11, marginTop: 6, wordBreak: 'break-all' }}>
          {AUTHENTICATOR_PLAY_URL}
        </div>
      )}
    </>
  );
}

// `note` replaces the admin wording when Vergr Vanguard reuses this screen.
export function Enroll({ onDone, logout, note }) {
  const [data, setData] = useState(null);     // { secret, otpauthUrl }
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);   // recovery codes, shown ONCE
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let live = true;
    httpsCallable(functions, 'enrollAdminTotp')({})
      .then((r) => { if (live) setData(r?.data || null); })
      .catch((e) => { if (live) setErr(e?.message || 'Could not start enrollment.'); });
    return () => { live = false; };
  }, []);

  const confirm = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await httpsCallable(functions, 'confirmAdminTotpEnrollment')({ code: code.trim() });
      // Shown once and never again: they are stored hashed, so nobody,
      // including this screen, can recover them later.
      if (r?.data?.recoveryCodes?.length) setCodes(r.data.recoveryCodes);
      else await onDone();
    } catch (e2) {
      setErr(e2?.message || 'That code was not accepted.');
    } finally { setBusy(false); }
  };

  if (codes) {
    return (
      <Shell
        title="Save your recovery codes"
        subtitle="Each one signs you in once if you lose your phone. They are stored hashed, so this is the only time they are shown. Print them or put them in a safe."
      >
        <div style={{
          background: C.card2, borderRadius: 10, padding: 14,
          fontFamily: 'DM Mono, monospace', fontSize: 14, lineHeight: 1.9, letterSpacing: 1,
        }}>
          {codes.map((c) => <div key={c}>{c}</div>)}
        </div>
        <button
          type="button"
          style={{ ...button(false), background: C.card2 }}
          onClick={() => { navigator.clipboard?.writeText(codes.join('\n')).catch(() => {}); }}
        >
          Copy all
        </button>
        <button type="button" style={button(false)} onClick={onDone}>I have saved them</button>
      </Shell>
    );
  }

  return (
    <Shell
      title="Set up your authenticator"
      subtitle={note || 'Scan this with an authenticator app, then enter the 6-digit code it shows. Required: the server refuses every admin action without it.'}
    >
      {data?.otpauthUrl ? (
        <>
          {/* ⚠ THE QR IS THE PRIMARY PATH, NOT A NICETY. This screen used to
              show the base32 secret alone, so setup meant typing 32 characters
              into a phone by hand, with a wrong character reading as a wrong
              code and no way to tell the two apart. Google Authenticator and
              every other TOTP app scan this. AdminSecurityScreen already drew
              one; the console that made enrollment COMPULSORY did not. */}
          <div style={{ background: '#fff', borderRadius: 12, padding: 12, display: 'flex', justifyContent: 'center' }}>
            <QRCodeSVG value={data.otpauthUrl} size={160} level="M" />
          </div>
          <div style={{ color: C.dim, fontSize: 12, marginTop: 10, marginBottom: 6 }}>
            Cannot scan? Type this instead:
          </div>
          <div style={{
            background: C.card2, borderRadius: 10, padding: 14, wordBreak: 'break-all',
            fontFamily: 'DM Mono, monospace', fontSize: 13, letterSpacing: 1,
          }}>
            {data.secret}
          </div>
          <GetAuthenticator />
        </>
      ) : <div style={{ color: C.dim, fontSize: 13 }}>Preparing…</div>}
      <form onSubmit={confirm}>
        <div style={{ color: C.dim, fontSize: 12, marginTop: 14, marginBottom: 6 }}>
          Then enter the 6-digit code it shows
        </div>
        <input
          style={{ ...input, fontFamily: 'DM Mono, monospace', letterSpacing: 4, textAlign: 'center' }}
          inputMode="numeric" maxLength={6} placeholder="000000"
          value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
        <button type="submit" style={button(busy || code.length !== 6)} disabled={busy || code.length !== 6}>
          {busy ? 'Checking…' : 'Confirm'}
        </button>
        <Err>{err}</Err>
      </form>
      <button
        type="button"
        style={{ ...button(false), background: 'transparent', color: C.dim, marginTop: 6 }}
        onClick={() => logout()}
      >
        Sign out
      </button>
    </Shell>
  );
}

// ───────────────────────────────────────────────────────────────────────────
export function StepUp({ onDone, logout, remaining }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await httpsCallable(functions, 'verifyAdminTotp')({ code: code.trim() });
      if (r?.data?.usedRecovery) {
        // Say so plainly. A recovery code is spent, and there is a finite
        // number of them.
        setErr(`Recovery code used. ${r.data.remainingCodes} left.`);
      }
      await onDone();
    } catch (e2) {
      setErr(e2?.message || 'That code was not accepted.');
    } finally { setBusy(false); }
  };

  return (
    <Shell
      title="Enter your code"
      subtitle="Your authenticator code, or one recovery code if you cannot reach your phone."
    >
      <form onSubmit={submit}>
        <input
          style={{ ...input, fontFamily: 'DM Mono, monospace', letterSpacing: 4, textAlign: 'center' }}
          maxLength={10} placeholder="000000"
          value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^0-9A-F]/g, ''))}
        />
        <button type="submit" style={button(busy || code.length < 6)} disabled={busy || code.length < 6}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
        <Err>{err}</Err>
      </form>
      {typeof remaining === 'number' && (
        <div style={{ color: C.dim, fontSize: 12, marginTop: 10 }}>
          {remaining} recovery {remaining === 1 ? 'code' : 'codes'} left.
        </div>
      )}
      <button
        type="button"
        style={{ ...button(false), background: 'transparent', color: C.dim, marginTop: 6 }}
        onClick={() => logout()}
      >
        Sign out
      </button>
    </Shell>
  );
}
