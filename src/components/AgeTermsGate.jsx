// AgeTermsGate — the date of birth and Terms acceptance an OAuth sign-up never
// gave (founder, 2026-09-27).
//
// Email sign-up asks both on /signup (SignUpStep1). A Google (or Apple) sign-up
// skipped straight into the app, so until 2026-09-27 the 18+ rule and the Terms
// record only covered email accounts. Any signed-in, non-guest account without a
// saved `dob` or a Terms acceptance sees this once, before the app. The same
// three things email sign-up asks: date of birth, "I am 18+ and agree", and the
// local-law confirmation. Under 18 cannot continue: a brand-new account is
// deleted (the onUserDeleted trigger cleans up), an older one is signed out, and
// nothing about the minor is saved.
//
// Mounted once beside TosVersionGate. TosVersionGate stays silent for an account
// that never accepted any version, so the two never show together.

import { useState, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { doc, updateDoc } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useUser } from '../context/UserContext';
import { useUI } from '../context/UIContext';
import { auth, db } from '../firebase/config';
import Icon from './Icon';
import { computeAge, latestAdultDob, MIN_AGE } from '../utils/age';
import { LEGAL_VERSION } from '../screens/marketing/legal/legalContent';

// Screens where the gate must not sit on top: sign-up writes these fields
// itself a moment after the account exists, and the legal pages are what the
// checkbox links to.
const SKIP = ['/signup', '/login', '/platform'];

export default function AgeTermsGate() {
  const { currentUser, logout } = useAuth();
  const { profile } = useUser();
  const { showToast } = useUI();
  const { pathname } = useLocation();
  const [dob, setDob] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [lawful, setLawful] = useState(false);
  const [saving, setSaving] = useState(false);
  const age = useMemo(() => computeAge(dob), [dob]);

  if (!currentUser || currentUser.isAnonymous || !profile) return null;
  if (profile.dob && Number(profile.tosVersion) > 0) return null;
  if (SKIP.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;

  const adult = age != null && age >= MIN_AGE;
  const tooYoung = age != null && age < MIN_AGE;
  const ready = adult && agreed && lawful && !saving;

  const refuseMinor = async () => {
    setSaving(true);
    const u = auth.currentUser;
    const created = Date.parse(u?.metadata?.creationTime || '') || 0;
    try {
      // A brand-new account is removed outright; an older one only signed out
      // (deleting an established account needs a fresh sign-in and is not a
      // step to take on a typed date alone).
      if (u && created > 0 && Date.now() - created < 15 * 60 * 1000) await u.delete();
    } catch { /* falls through to sign-out */ }
    try { await logout(); } catch { /* already signed out */ }
    showToast?.(`You must be at least ${MIN_AGE} to use VERGR.`, 'error');
    setSaving(false);
  };

  const save = async () => {
    if (!ready) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', currentUser.uid), {
        dob,
        tosVersion: LEGAL_VERSION,
        tosAcceptedAt: Date.now(),
        complianceConfirmedAt: Date.now(),
      });
    } catch (e) {
      console.error('[age gate] save failed', e);
      showToast?.('Could not save that. Please try again.', 'error');
      setSaving(false);
    }
  };

  const box = (on) => ({
    width: 20, height: 20, borderRadius: 6, flexShrink: 0, marginTop: 2,
    display: 'grid', placeItems: 'center',
    background: on ? '#7B1FFF' : '#1A1A2A',
  });

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#0B0B14', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, overflowY: 'auto' }}>
      <div style={{ width: '100%', maxWidth: 420, background: '#14141F', borderRadius: 20, padding: 24 }}>
        <h2 className="font-syne" style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>One more step</h2>
        <p style={{ fontSize: 13.5, lineHeight: 1.55, color: '#9CA3AF', marginBottom: 18 }}>
          VERGR is for adults. Tell us your date of birth and accept our terms to continue.
        </p>

        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={{ display: 'block', fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9CA3AF', marginBottom: 6 }}>Date of birth</span>
          <input type="date" value={dob} max={latestAdultDob()} onChange={(e) => setDob(e.target.value)}
            className="input-with-icon pl-4" style={{ width: '100%' }} />
          {tooYoung && (
            <span style={{ display: 'block', fontSize: 12, color: '#F04060', marginTop: 6 }}>
              You must be at least {MIN_AGE} to use VERGR.
            </span>
          )}
        </label>

        <button type="button" onClick={() => setAgreed(!agreed)} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', textAlign: 'left', background: 'none', border: 0, padding: 0, marginBottom: 12, cursor: 'pointer', color: '#9CA3AF', fontSize: 13.5, lineHeight: 1.5 }}>
          <span style={box(agreed)}>{agreed && <Icon name="check" size={14} className="text-white" />}</span>
          <span>
            I am {MIN_AGE}+ and agree to the{' '}
            <Link to="/platform/terms" target="_blank" onClick={(e) => e.stopPropagation()} className="text-brand-violet-light">Terms of Service</Link>,{' '}
            <Link to="/platform/privacy" target="_blank" onClick={(e) => e.stopPropagation()} className="text-brand-violet-light">Privacy Policy</Link>, and{' '}
            <Link to="/platform/acceptable-use" target="_blank" onClick={(e) => e.stopPropagation()} className="text-brand-violet-light">Acceptable Use Policy</Link>.
          </span>
        </button>

        <button type="button" onClick={() => setLawful(!lawful)} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', textAlign: 'left', background: 'none', border: 0, padding: 0, marginBottom: 20, cursor: 'pointer', color: '#9CA3AF', fontSize: 13.5, lineHeight: 1.5 }}>
          <span style={box(lawful)}>{lawful && <Icon name="check" size={14} className="text-white" />}</span>
          <span>
            I confirm that my use of VERGR, including Coin purchases, subscriptions and receiving a
            creator revenue share, is lawful in my jurisdiction. I take sole responsibility for
            verifying this and indemnify VERGR accordingly.
          </span>
        </button>

        {tooYoung ? (
          <button type="button" onClick={refuseMinor} disabled={saving}
            style={{ width: '100%', height: 48, borderRadius: 14, border: 0, background: '#1A1A2A', color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
            {saving ? 'Signing out…' : 'Sign out'}
          </button>
        ) : (
          <button type="button" onClick={save} disabled={!ready}
            style={{ width: '100%', height: 48, borderRadius: 14, border: 0, background: ready ? '#7B1FFF' : '#2A2540', color: ready ? '#fff' : '#8A8699', fontWeight: 800, fontSize: 14, cursor: ready ? 'pointer' : 'default' }}>
            {saving ? 'Saving…' : 'Continue'}
          </button>
        )}
      </div>
    </div>
  );
}
