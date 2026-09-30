// AdminUpdateGate — keeps every Vergr Admin install current.
//
// ⚠⚠ THIS EXISTS BECAUSE THE ADMIN APP HAD NO WAY TO UPDATE ITSELF. The
// consumer desktop app has updated silently from `latest.json` for months;
// `tauri.admin.conf.json` shipped with `createUpdaterArtifacts: false` and no
// updater block, so every installed console was frozen at whatever build it was
// handed. That is worse here than on the consumer app: a stale moderation
// console is one that bans with old rules and shows screens that no longer
// match the server.
//
// ⚠⚠ THE UPDATE IS LOCKED, NOT HIDDEN (2026-09-21). It used to be a public R2
// file at an unguessable path, so anyone given the URL could download the admin
// console. It now lives on box 1 behind nginx auth_request (infra/ops-auth), and
// nginx serves it only to a request carrying a 15-minute download ticket. The
// ticket comes from getMyAdminSecurityStatus, which mints one ONLY for the
// operator or an active sub-admin. So nothing admin is downloadable without
// signing in as an admin, and the check cannot run until someone has.
//
// ⚠ The ticket is NOT the Firebase ID token, on purpose: see adminSecurity.js.
// The signing key pair is still the consumer app's; the signature proves the
// bytes came from us, the ticket decides who may fetch them.
//
// ⚠ NEVER BLOCKS. An admin who cannot reach the CDN, or whose update fails, is
// let straight into the current build. Trapping the only moderation console
// behind a failed download is a worse outcome than running one build behind.

import { useEffect, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { checkDesktopUpdate, applyDesktopUpdate } from '../utils/tauriUpdater';

// A fresh download ticket, or null for anyone who may not have one. Never throws.
// `field` picks the app: 'updateTicket' (Vergr Admin, scope admin) or
// 'vanguardTicket' (Vergr Vanguard, scope vanguard). Each only opens its own
// /ops/<scope>/ path on the box.
async function ticketHeaders(field = 'updateTicket') {
  try {
    const r = await httpsCallable(functions, 'getMyAdminSecurityStatus')({});
    const t = r?.data?.[field];
    return t ? { headers: { Authorization: `VergrOps ${t}` } } : null;
  } catch {
    return null;
  }
}

const C = {
  bg: '#09090f', card: '#12121e', border: '#1e1e30',
  text: '#e0e0f0', dim: '#7070a0', accent: '#7c3aed', bad: '#f04060',
};

export default function AdminUpdateGate({ children, ticketField = 'updateTicket', appName = 'Vergr Admin' }) {
  const [update, setUpdate] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState('');
  const [dismissed, setDismissed] = useState(false);

  const { currentUser } = useAuth();
  const checkedFor = useRef(null);

  // Checks once per signed-in account. Signed out = nothing to check with.
  useEffect(() => {
    const uid = currentUser?.uid;
    if (!uid || checkedFor.current === uid) return undefined;
    checkedFor.current = uid;
    let live = true;
    (async () => {
      const opts = await ticketHeaders(ticketField);
      if (!opts) return; // not an admin (yet): no ticket, no check
      const u = await checkDesktopUpdate(opts); // never throws
      if (live && u) setUpdate(u);
    })();
    return () => { live = false; };
  }, [currentUser, ticketField]);

  if (!update || dismissed) return children;

  const apply = async () => {
    setBusy(true); setErr('');
    let total = 0, got = 0;
    try {
      // A fresh ticket: the one the check used may have expired while this
      // card sat open.
      const opts = await ticketHeaders(ticketField);
      if (!opts) throw new Error('Could not authorise the download.');
      await applyDesktopUpdate(update, (e) => {
        if (e?.event === 'Started') total = e.data?.contentLength || 0;
        if (e?.event === 'Progress') {
          got += e.data?.chunkLength || 0;
          if (total) setPct(Math.min(99, Math.round((got / total) * 100)));
        }
      }, opts);
    } catch (e) {
      // Let them work. A console one build behind beats no console.
      setErr(`${e?.message || 'Update failed.'} You can keep using this version.`);
      setBusy(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', background: C.bg, display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 380, background: C.card, borderRadius: 16, padding: 24 }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 20, marginBottom: 4, color: C.text }}>
          Update available
        </div>
        <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
          {update.version ? `${appName} ${update.version} is ready. ` : ''}
          Installing keeps this app in step with the server.
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={apply}
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 10, border: 'none',
            background: busy ? '#2a2a40' : C.accent, color: '#fff', fontSize: 14,
            fontWeight: 700, cursor: busy ? 'default' : 'pointer',
          }}
        >
          {busy ? (pct ? `Installing ${pct}%` : 'Installing…') : 'Update now'}
        </button>
        {!busy && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 10, border: 'none',
              background: 'transparent', color: C.dim, fontSize: 14, fontWeight: 700,
              cursor: 'pointer', marginTop: 6,
            }}
          >
            Later
          </button>
        )}
        {err && <div style={{ color: C.bad, fontSize: 13, marginTop: 10, lineHeight: 1.45 }}>{err}</div>}
      </div>
    </div>
  );
}
