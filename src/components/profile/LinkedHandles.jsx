// LinkedHandles — the game and platform handles someone added in
// Settings → Connected accounts, shown under their bio on all four profile
// views (web own, web public, native own, native public).
//
// A handle with a public profile URL (Steam, YouTube) opens it; one without
// (Riot ID, BattleTag, Gamertag, PSN, Epic, EA) copies to the clipboard, which
// is what someone looking at it actually wants to do with it.
//
// Solid chips, no outline, no translucent wash. Costs nothing: it reads the
// profile document the screen already has.

import { useState } from 'react';
import { linkedHandlesList, openSocialLink } from '../../utils/profileSocials';

export default function LinkedHandles({ linkedAccounts, platforms, className = '', style }) {
  const rows = linkedHandlesList(linkedAccounts, platforms);
  const [copied, setCopied] = useState(null);
  if (!rows.length) return null;

  const copy = async (r) => {
    try {
      await navigator.clipboard.writeText(r.handle);
      setCopied(r.id);
      setTimeout(() => setCopied((c) => (c === r.id ? null : c)), 1500);
    } catch { /* clipboard blocked: nothing to do */ }
  };

  return (
    <div className={className} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, ...style }}>
      {rows.map((r) => {
        const body = (
          <>
            <span aria-hidden="true" style={{
              minWidth: 18, height: 18, padding: '0 4px', borderRadius: 5, background: r.bg, color: r.fg,
              fontSize: 9.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>{r.mark}</span>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>
              {copied === r.id ? 'Copied' : r.handle}
            </span>
          </>
        );
        const chip = {
          display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 9px 0 4px',
          borderRadius: 8, background: '#1A1A26', color: '#c9c9d6', fontSize: 11.5, fontWeight: 600,
          border: 0, cursor: 'pointer', textDecoration: 'none',
        };
        return r.href ? (
          <a key={r.id} href={r.href} target="_blank" rel="noreferrer" title={`${r.label}: ${r.handle}`}
             aria-label={`${r.label} ${r.handle}`} onClick={(e) => openSocialLink(e, r.href)} style={chip}>
            {body}
          </a>
        ) : (
          <button key={r.id} type="button" onClick={() => copy(r)} title={`${r.label}: ${r.handle}. Tap to copy`}
                  aria-label={`${r.label} ${r.handle}, copy`} style={chip}>
            {body}
          </button>
        );
      })}
    </div>
  );
}
