// AntiCheatConsentModal — explicit opt-in before any process scan runs.
//
// Stores acceptance on the user doc with timestamp + scope hash so a future
// scope change forces re-consent. Declining the modal blocks the scan
// effect (TournamentMatchScreen) and surfaces an exit-tournament CTA.

import { useState } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { leaveTournamentSecure } from '../../firebase/firestore';
import Icon from '../Icon';

const C = {
  bg: '#14141F', soft: '#1A1A2A', border: 'rgba(255,255,255,0.10)',
  text: '#fff', dim: 'rgba(255,255,255,0.65)', mute: 'rgba(255,255,255,0.45)',
  cyan: '#B44FFF', amber: '#f59e0b', red: '#ef4444',
};

// Bump if the scope changes (e.g. add USB device enum) → re-consent required.
export const SCAN_SCOPE_VERSION = 'v1.process+exehash';

const SCAN_ITEMS = [
  { icon: 'list_alt', text: 'List of currently running processes (name + PID)' },
  { icon: 'fingerprint', text: 'SHA-256 hash of each running executable\'s path' },
  { icon: 'terminal', text: 'First 200 characters of each process\'s command line' },
];
const NOT_SCANNED = [
  'Your files, documents, browser history, or passwords',
  'Anything outside your running process list',
  'Anything when you are not actively in a tournament match',
];

export default function AntiCheatConsentModal({ tournamentId, onAccept, onDecline }) {
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const [busy, setBusy] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  const accept = async () => {
    if (!currentUser) return;
    setBusy(true);
    try {
      await setDoc(doc(db, 'users', currentUser.uid), {
        tournamentScanConsent: {
          acceptedAt: serverTimestamp(),
          scopeVersion: SCAN_SCOPE_VERSION,
          userAgent: navigator.userAgent.slice(0, 200),
        },
      }, { merge: true });
      onAccept?.();
    } finally { setBusy(false); }
  };

  // Decline = actually leave the tournament + refund entry fee. Two-step
  // confirm because this is destructive (loses tournament slot).
  const decline = async () => {
    if (!confirmingLeave) { setConfirmingLeave(true); return; }
    if (!tournamentId) { onDecline?.(); return; }
    setBusy(true);
    try {
      await leaveTournamentSecure(tournamentId);
      showToast('Left tournament — entry refunded.', 'info');
      onDecline?.();
    } catch (err) {
      // If they're past the leave window, server returns a precondition error;
      // still let them navigate away so they're not stuck.
      showToast(err?.message || 'Could not leave — contact a mod.', 'error');
      onDecline?.();
    } finally { setBusy(false); }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
      zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{
        background: C.bg, borderRadius: 16, padding: 22, maxWidth: 480, width: '100%',
        border: `1px solid ${C.border}`, color: C.text,
        fontFamily: 'Inter, system-ui, sans-serif',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: `${C.cyan}22`, border: `1px solid ${C.cyan}66`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="shield" size={20} className="" style={{ color: C.cyan }} />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 900 }}>Match integrity scan</div>
            <div style={{ fontSize: 11, color: C.dim }}>Required to enter tournament matches</div>
          </div>
        </div>

        <p style={{ fontSize: 13, color: C.dim, lineHeight: 1.55, margin: '12px 0' }}>
          To keep tournaments fair, VERGR scans your machine for known cheat
          tools while you are in a match. We are open about exactly what we
          collect, and you can fetch your full scan report at any time.
        </p>

        <div style={{ background: C.soft, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: C.cyan, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
            What we scan
          </div>
          {SCAN_ITEMS.map((it, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
              <Icon name={it.icon} size={14} className="" style={{ color: C.cyan, marginTop: 2 }} />
              <div style={{ fontSize: 12, color: C.text }}>{it.text}</div>
            </div>
          ))}
        </div>

        <div style={{ background: C.soft, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.amber, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
            What we never touch
          </div>
          {NOT_SCANNED.map((t, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
              <Icon name="block" size={14} className="" style={{ color: C.amber, marginTop: 2 }} />
              <div style={{ fontSize: 12, color: C.dim }}>{t}</div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 11, color: C.mute, lineHeight: 1.5, marginBottom: 14 }}>
          Scans run only during tournament matches. By accepting you confirm you are 18+,
          agree to our <a href="/legal/terms" style={{ color: C.cyan }}>Terms</a> and
          our <a href="/legal/anti-cheat" style={{ color: C.cyan }}>Anti-Cheat policy</a>.
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={decline} disabled={busy} style={{
            flex: 1, padding: 12, borderRadius: 10,
            background: confirmingLeave ? `${C.red}22` : 'transparent',
            border: `1px solid ${confirmingLeave ? C.red : C.border}`,
            color: confirmingLeave ? C.red : C.text,
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
            opacity: busy ? 0.6 : 1,
          }}>
            {busy ? 'Leaving…' : confirmingLeave ? 'Confirm leave + refund' : 'Decline · leave tournament'}
          </button>
          <button onClick={accept} disabled={busy} style={{
            flex: 2, padding: 12, borderRadius: 10, border: 'none',
            background: `linear-gradient(135deg, ${C.cyan}, #7B6FFF)`,
            color: '#000', fontSize: 13, fontWeight: 900, cursor: 'pointer',
            opacity: busy ? 0.6 : 1,
          }}>{busy ? 'Saving…' : 'I consent · enable scanning'}</button>
        </div>
      </div>
    </div>
  );
}
