// /vanguard on vergr.app — hands a Vanguard moderator the Vergr Vanguard app.
//
// The moderation dashboard left the web app on 2026-09-21 and became its own
// desktop app. This page is the only way in, and it only works for a member:
//   - a non-member is sent home (the page has nothing for them)
//   - the download itself is LOCKED on box 1 (infra/ops-auth): the installer is
//     served only with a 15-minute ticket that getMyAdminSecurityStatus mints
//     for an active member, and a Vanguard ticket opens /ops/vanguard/ only.
//
// ⚠ The ticket rides an Authorization header, so an <a href> cannot carry it.
// The file is fetched with the header and saved from a blob. nginx answers the
// CORS preflight for https://vergr.app on /ops/vanguard/ for exactly this.

import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/config';
import { useUser } from '../../context/UserContext';
import { isVanguard, rankMeta } from '../../utils/vanguard';
import Icon from '../../components/Icon';

const MANIFEST = 'https://sfu.vergr.app/ops/vanguard/latest.json';

const C = {
  bg: '#0B0B14', card: '#14141F', card2: '#1C1C2B', text: '#FFFFFF',
  dim: '#9CA3AF', muted: '#6B7280', violet: '#7B1FFF', bad: '#F04060',
};

async function ticketHeader() {
  const r = await httpsCallable(functions, 'getMyAdminSecurityStatus')({});
  const t = r?.data?.vanguardTicket;
  if (!t) throw new Error('Your account cannot download Vergr Vanguard right now.');
  return { Authorization: `VergrOps ${t}` };
}

export default function VanguardGetAppScreen() {
  const navigate = useNavigate();
  const { profile, loading } = useUser();
  const [manifest, setManifest] = useState(null);   // { version, size, url }
  const [state, setState] = useState('idle');       // idle | loading | ready | none | busy | done | error
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState('');
  const member = isVanguard(profile);

  useEffect(() => {
    if (!member) return undefined;
    let live = true;
    (async () => {
      setState('loading');
      try {
        const headers = await ticketHeader();
        const res = await fetch(MANIFEST, { headers, cache: 'no-store' });
        if (res.status === 404) { if (live) setState('none'); return; }
        if (!res.ok) throw new Error(`The download server answered ${res.status}.`);
        const m = await res.json();
        const url = m?.platforms?.['windows-x86_64']?.url;
        if (!url) throw new Error('No Windows build is published yet.');
        if (live) { setManifest({ version: m.version, size: m.size || 0, url }); setState('ready'); }
      } catch (e) {
        if (live) { setErr(e?.message || 'Could not reach the download server.'); setState('error'); }
      }
    })();
    return () => { live = false; };
  }, [member]);

  if (loading && !profile) return null;
  if (!member) return <Navigate to="/" replace />;

  const download = async () => {
    if (!manifest) return;
    setState('busy'); setPct(0); setErr('');
    try {
      // A fresh ticket: the one the manifest used may be close to expiring.
      const headers = await ticketHeader();
      const res = await fetch(manifest.url, { headers, cache: 'no-store' });
      if (!res.ok || !res.body) throw new Error(`The download server answered ${res.status}.`);
      const total = Number(res.headers.get('Content-Length')) || manifest.size || 0;
      const reader = res.body.getReader();
      const parts = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        got += value.length;
        if (total) setPct(Math.min(99, Math.round((got / total) * 100)));
      }
      const blob = new Blob(parts, { type: 'application/octet-stream' });
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `Vergr-Vanguard-Setup-${manifest.version}.exe`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
      setPct(100);
      setState('done');
    } catch (e) {
      setErr(e?.message || 'The download failed.');
      setState('ready');
    }
  };

  const rank = rankMeta(profile?.vanguard?.rank);
  const mb = manifest?.size ? `${(manifest.size / 1e6).toFixed(0)} MB` : '';

  return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', justifyContent: 'center', padding: 16, overflowY: 'auto' }}>
      <div style={{ width: '100%', maxWidth: 460, margin: 'auto', background: C.card, borderRadius: 18, padding: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <img src={rank?.badge || '/brand/logo.png'} alt="" style={{ width: 44, height: 44, objectFit: 'contain' }} draggable={false} />
          <div>
            <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 22, color: C.text }}>Vergr Vanguard</div>
            <div style={{ fontSize: 13, color: C.dim }}>{rank?.label ? `${rank.label} · ` : ''}the moderation app</div>
          </div>
        </div>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: C.dim, margin: '0 0 8px' }}>
          Moderation now happens in its own desktop app. Sign in with this Vergr account and set up an
          authenticator app the first time you open it. It updates itself after that.
        </p>
        <p style={{ fontSize: 13, lineHeight: 1.6, color: C.muted, margin: '0 0 20px' }}>
          Windows only for now. Keep the installer to yourself: it is for Vanguard members.
        </p>

        {state === 'loading' && <div style={{ fontSize: 13, color: C.dim }}>Checking the latest version…</div>}
        {state === 'none' && (
          <div style={{ fontSize: 13, color: C.dim, background: C.card2, borderRadius: 12, padding: 14 }}>
            The first build is on its way. Check back soon.
          </div>
        )}
        {(state === 'ready' || state === 'busy' || state === 'done') && (
          <button
            type="button"
            onClick={download}
            disabled={state === 'busy'}
            style={{
              width: '100%', padding: '14px 16px', borderRadius: 12, border: 'none',
              background: state === 'busy' ? C.card2 : C.violet, color: '#fff', fontSize: 15, fontWeight: 700,
              cursor: state === 'busy' ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            <Icon name={state === 'done' ? 'check_circle' : 'download'} size={20} />
            {state === 'busy' ? `Downloading ${pct}%`
              : state === 'done' ? 'Downloaded. Run the installer.'
              : `Download for Windows${manifest?.version ? ` · ${manifest.version}` : ''}${mb ? ` · ${mb}` : ''}`}
          </button>
        )}
        {err && <div style={{ color: C.bad, fontSize: 13, marginTop: 12, lineHeight: 1.5 }}>{err}</div>}

        <button
          type="button"
          onClick={() => navigate('/')}
          style={{ width: '100%', marginTop: 12, padding: '12px 16px', borderRadius: 12, border: 'none', background: 'transparent', color: C.dim, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
        >
          Back to Vergr
        </button>
      </div>
    </div>
  );
}
