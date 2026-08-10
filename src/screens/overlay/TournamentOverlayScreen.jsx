// /overlay/:tournamentId — HUD-ONLY tournament overlay for OBS / browser.
//
// IMPORTANT (2026-05-17): this overlay is DISPLAY-ONLY. Winner declarations
// are made by Vanguard moderators in the Moderation Room — the streamer
// can NOT declare winners through this overlay because money is on the line
// and the streamer is the player. Trust the OCR signals + the mod, not the
// player's button-press.
//
// URL format: /#/overlay/<tournamentId>?token=<overlayToken>&mode=obs|tab
//
// The token-based auth still exists so the streamer's overlay can fetch
// real-time match state (so viewers see who's playing) without us exposing
// tournament internals to anyone with the URL.

import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

const FN_BASE = 'https://europe-west1-vergr-44494.cloudfunctions.net';

export default function TournamentOverlayScreen() {
  const { tournamentId } = useParams();
  const [params] = useSearchParams();
  const overlayToken = params.get('token');
  const mode = params.get('mode') || 'tab';

  const [cfg, setCfg] = useState(null);
  const [err, setErr] = useState(null);

  const loadConfig = useCallback(async () => {
    if (!tournamentId || !overlayToken) return;
    try {
      const url = `${FN_BASE}/getOverlayConfig?tournamentId=${encodeURIComponent(tournamentId)}&overlayToken=${encodeURIComponent(overlayToken)}`;
      const r = await fetch(url);
      const data = await r.json();
      if (!data.ok) { setErr(data.error || 'failed'); return; }
      setCfg(data);
      setErr(null);
    } catch (e) {
      setErr(e?.message || 'Network error');
    }
  }, [tournamentId, overlayToken]);

  useEffect(() => { loadConfig(); }, [loadConfig]);
  useEffect(() => {
    const t = setInterval(loadConfig, 10_000);
    return () => clearInterval(t);
  }, [loadConfig]);

  if (err) {
    return (
      <div style={S.errorRoot}>
        <div style={S.errorBox}>
          <div style={S.errorTitle}>Overlay error</div>
          <div style={S.errorMsg}>{err}</div>
          <div style={S.errorHint}>Check your tournament's overlay URL. The token expires when the tournament ends.</div>
        </div>
      </div>
    );
  }
  if (!cfg) return <div style={S.loading}>Loading tournament overlay…</div>;

  const isObsMode = mode === 'obs';
  const t = cfg.tournament;
  const m = cfg.match;

  return (
    <div style={isObsMode ? S.obsRoot : S.tabRoot}>
      <div style={isObsMode ? S.obsHud : S.tabHud}>
        <div style={S.brand}>
          <img src="/brand/logo.png" alt="VERGR" style={{ height: 24, width: 24 }} />
          <div>
            <div style={S.brandName}>VERGR</div>
            <div style={S.brandSub}>{t.game}</div>
          </div>
        </div>
        <div style={S.tName}>{t.name}</div>
        <div style={S.tMeta}>
          <span style={S.tBadge}>● LIVE</span>
          <span>{t.prizePool ? `${t.prizePool.toLocaleString()}c prize` : ''}</span>
          <span>{t.participantCount} players</span>
        </div>

        {m ? (
          <div style={S.matchBox}>
            <div style={S.matchHeader}>Match #{m.matchNumber || '?'} · {m.status}</div>
            <div style={S.matchPlayers}>
              <span style={S.playerSlot}>{m.player1DisplayName || 'Player 1'}</span>
              <span style={S.vs}>vs</span>
              <span style={S.playerSlot}>{m.player2DisplayName || 'Player 2'}</span>
            </div>
          </div>
        ) : (
          <div style={S.matchBox}>
            <div style={S.matchHeader}>No active match</div>
            <div style={S.matchMeta}>Wait for the bracket to advance.</div>
          </div>
        )}

        {!isObsMode && (
          <div style={S.footer}>
            <div><strong>This overlay is display-only.</strong> Winners are called by Vanguard moderators in the Moderation Room — never by the player.</div>
            <div style={{ marginTop: 4 }}>Add this URL as an OBS browser source (append <code>&mode=obs</code>) to display tournament info to your viewers on stream.</div>
          </div>
        )}
      </div>
    </div>
  );
}

const S = {
  obsRoot: { margin: 0, padding: 16, background: 'transparent', color: '#fff', fontFamily: 'DM Sans, sans-serif', minHeight: '100vh' },
  tabRoot: { margin: 0, padding: 16, background: '#0B0B14', color: '#fff', fontFamily: 'DM Sans, sans-serif', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  obsHud: { background: 'linear-gradient(135deg, rgba(11,11,20,0.85), rgba(123,31,255,0.18))', border: '1px solid rgba(180,79,255,0.3)', borderRadius: 12, padding: 14, maxWidth: 360, backdropFilter: 'blur(8px)' },
  tabHud: { background: '#12121e', border: '1px solid #1e1e30', borderRadius: 14, padding: 22, width: 'min(560px, 95vw)' },
  brand: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 },
  brandName: { fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 14, letterSpacing: '.05em' },
  brandSub: { fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#9CA3AF', marginTop: 1 },
  tName: { fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18, marginBottom: 4 },
  tMeta: { display: 'flex', gap: 8, fontFamily: 'DM Mono, monospace', fontSize: 10.5, color: '#9CA3AF', flexWrap: 'wrap', marginBottom: 12 },
  tBadge: { padding: '2px 7px', background: '#F04060', borderRadius: 4, color: '#fff', fontWeight: 700, letterSpacing: '.08em' },
  matchBox: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: 12 },
  matchHeader: { fontFamily: 'DM Mono, monospace', fontSize: 10.5, color: '#9CA3AF', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.12em' },
  matchPlayers: { display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'DM Sans, sans-serif', fontSize: 13, fontWeight: 700 },
  playerSlot: { flex: 1, padding: '6px 10px', background: 'rgba(180,79,255,0.08)', border: '1px solid rgba(180,79,255,0.2)', borderRadius: 6, textAlign: 'center' },
  vs: { fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#9CA3AF' },
  matchMeta: { fontFamily: 'DM Sans, sans-serif', fontSize: 12, color: '#9CA3AF' },
  footer: { marginTop: 14, padding: 10, background: 'rgba(245,200,66,0.05)', border: '1px solid rgba(245,200,66,0.15)', borderRadius: 6, color: '#9CA3AF', fontFamily: 'DM Sans, sans-serif', fontSize: 11, lineHeight: 1.5 },
  errorRoot: { minHeight: '100vh', background: '#0B0B14', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: 'DM Sans, sans-serif' },
  errorBox: { background: '#12121e', border: '1px solid rgba(240,64,96,0.4)', borderRadius: 12, padding: 24, maxWidth: 460 },
  errorTitle: { fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18, color: '#F04060', marginBottom: 8 },
  errorMsg: { fontSize: 13, color: '#fff', marginBottom: 12 },
  errorHint: { fontSize: 12, color: '#9CA3AF', lineHeight: 1.5 },
  loading: { minHeight: '100vh', background: '#0B0B14', color: '#9CA3AF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'DM Sans, sans-serif' },
};
