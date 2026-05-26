// Redesigned Connected Accounts page — list of platforms with connect/disconnect.
// Persists via updateLinkedAccount / removeLinkedAccount.
//
// Steam is the special case: it writes its own rich object via the secure
// linkSteam callable (issues a per-user GSI token + reverse-lookup doc) and
// shows extra CS2 / Dota 2 setup rows once the account is linked. Those
// setup rows install Valve GSI .cfg files into the player's Steam folder —
// see src/utils/gsiInstaller.js for the Tauri / FSA / download fallback.
import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { useLayout } from '../../context/LayoutContext';
import {
  updateLinkedAccount, removeLinkedAccount,
  linkSteam, unlinkSteam, getSteamGsiConfig,
  getOAuthStartUrl, getSteamSignInUrl,
} from '../../firebase/firestore';
import { installGsiConfig, detectGsiMethod, GSI_METHOD } from '../../utils/gsiInstaller';
import TopBar from '../../components/TopBar';
import useResponsive from '../../hooks/useResponsive';
import { C, PageShell } from './_settingsUI';

// Platforms that go through the generic OAuth2 flow in functions/oauth.js.
// Clicking Connect on these redirects the browser to the provider's authorize
// URL via getOAuthStartUrl; the backend handles the callback and writes the
// linked-account info. Steam, Riot, EA/Origin, Xbox, PSN keep manual entry.
const OAUTH_PLATFORMS = new Set(['twitch', 'youtube', 'discord', 'battlenet', 'epicgames', 'steam', 'openxbl']);

const PLATFORMS = [
  { id: 'steam',       name: 'Steam',         color: '#1b2838', letter: 'S', textColor: '#c7d5e0', desc: 'Link Steam to enable auto-result detection in CS2 and Dota 2 tournaments via Valve\'s Game State Integration.', placeholder: '7656119xxxxxxxxxx (your 17-digit Steam64 ID)' },
  { id: 'riotgames',   name: 'Riot Games',    color: '#c6362f', letter: 'R', textColor: '#fff',    desc: 'Connect your Riot account to verify your identity and (once Riot approves our key) auto-detect Valorant / LoL / TFT match results.',  placeholder: 'Name#TAG' },
  { id: 'battlenet',   name: 'Battle.net',    color: '#00aeff', letter: 'B', textColor: '#fff',    desc: 'Link your Battle.net BattleTag to enable Overwatch 2 auto-result detection. Your career profile must be public.', placeholder: 'YourTag#1234' },
  { id: 'origin',      name: 'EA / Origin',   color: '#ff5252', letter: 'O', textColor: '#fff',    desc: 'Connect your EA / Origin handle to enable Apex Legends auto-result detection.', placeholder: 'Your Origin or Steam handle' },
  { id: 'openxbl',     name: 'Xbox',          color: '#107c10', letter: 'X', textColor: '#fff',    desc: 'Sign in with Xbox to connect your Gamertag and enable cross-platform squad matchmaking.', placeholder: 'Your Gamertag' },
  { id: 'discord',     name: 'Discord',       color: '#5865f2', letter: 'D', textColor: '#fff',    desc: "Connect Discord to join our community and get role rewards.",                placeholder: 'Username#1234' },
  { id: 'playstation', name: 'PlayStation™ Network', color: '#003087', letter: 'P', textColor: '#fff', desc: 'Connect your PlayStation account to track trophies and game progress.',     placeholder: 'Your PSN ID' },
  { id: 'epicgames',   name: 'Epic Games',    color: '#2a2a2a', letter: 'E', textColor: '#fff',    desc: 'Connect your Epic Games account to access exclusive events and rewards.',    placeholder: 'Your Epic display name' },
  { id: 'twitch',      name: 'Twitch',        color: '#9146FF', letter: 'T', textColor: '#fff',    desc: 'Mirror your Twitch streams to your VERGR profile.',                          placeholder: 'Your Twitch username' },
  { id: 'youtube',     name: 'YouTube',       color: '#FF0000', letter: 'Y', textColor: '#fff',    desc: 'Link your channel and share videos.',                                        placeholder: 'Your YouTube channel name' },
];

export default function LinkedAccountsScreen() {
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const { showToast } = useUI();
  const { isMobile } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();
  const [connectModal, setConnectModal] = useState(null);
  const [inputValue, setInputValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    setRightPanel(null);
    setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign]);

  // Surface the OAuth callback result. The backend redirects to
  // /settings/linked?linked=<platform>&status=ok|error[&msg=...]. Toast it
  // and clean the query string so reloads don't re-toast.
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] || window.location.search);
    const linkedParam = params.get('linked');
    const status = params.get('status');
    if (!linkedParam || !status) return;
    if (status === 'ok') showToast(`${linkedParam} connected!`, 'success');
    else showToast(`Connect failed: ${params.get('msg') || 'unknown error'}`, 'error');
    // Strip the params from the URL.
    const cleanHash = window.location.hash.split('?')[0];
    window.history.replaceState({}, '', cleanHash || '#/settings/linked');
  }, []); // eslint-disable-line

  const linked = profile?.linkedAccounts || {};
  const steamLinked = !!linked.steam?.steamId64;

  // For OAuth providers we redirect the browser to the provider's authorize
  // URL instead of opening the manual-entry modal.
  const startOAuth = async (platformId) => {
    setBusyId(platformId);
    try {
      // Steam uses OpenID 2.0; everything else uses generic OAuth2.
      const result = platformId === 'steam'
        ? await getSteamSignInUrl()
        : await getOAuthStartUrl(platformId);
      const { url, state } = result || {};
      if (!url) throw new Error('No auth URL returned');
      // OpenXBL strips state from its redirect, so we stash it in a cookie
      // for the callback to read. 10-min TTL matches the server-side state.
      if (platformId === 'openxbl' && state) {
        document.cookie = `vergr_oauth_state=${encodeURIComponent(state)}; Path=/; Max-Age=600; SameSite=Lax; Secure`;
      }
      window.location.href = url;
    } catch (err) {
      showToast(err?.message || 'Failed to start sign-in', 'error');
      setBusyId(null);
    }
  };

  const handleConnect = async () => {
    if (!inputValue.trim() || !connectModal || saving) return;
    setSaving(true);
    try {
      if (connectModal.id === 'steam') {
        // Steam goes through the secure callable so we generate a GSI token
        // server-side. The user pastes their Steam64 ID; once we add Steam
        // OpenID it'll be one click instead.
        const trimmed = inputValue.trim();
        if (!/^7656119\d{10}$/.test(trimmed)) {
          showToast('Steam ID must be a 17-digit Steam64 (starts with 7656119)', 'error');
          setSaving(false);
          return;
        }
        await linkSteam({ steamId64: trimmed });
        showToast('Steam connected — set up CS2 or Dota 2 below', 'success');
      } else {
        await updateLinkedAccount(currentUser.uid, connectModal.id, inputValue.trim());
        showToast(`${connectModal.name} connected!`, 'success');
      }
      setConnectModal(null); setInputValue('');
    } catch (err) {
      showToast(err?.message || 'Failed to connect', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async (p) => {
    if (busyId) return;
    setBusyId(p.id);
    try {
      if (p.id === 'steam') {
        await unlinkSteam();
      } else {
        await removeLinkedAccount(currentUser.uid, p.id);
      }
      showToast(`${p.name} disconnected`, 'success');
    } catch (err) {
      showToast(err?.message || 'Failed to disconnect', 'error');
    } finally {
      setBusyId(null);
    }
  };

  // Install a CS2 / Dota 2 GSI config file. game = 'cs2' | 'dota2'.
  const handleInstallGsi = async (game) => {
    setBusyId(`gsi:${game}`);
    try {
      const config = await getSteamGsiConfig({ game });
      const result = await installGsiConfig(config);
      if (result.needsManualInstall) {
        showToast(`Downloaded — drop it into ${config.installPath}`, 'success');
      } else {
        showToast(`${game.toUpperCase()} configured — start the game to test`, 'success');
      }
    } catch (err) {
      if (String(err?.message || '').toLowerCase().includes('cancel')) {
        // User cancelled the picker — silent.
      } else {
        showToast(err?.message || 'Setup failed', 'error');
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ background: C.bg, minHeight: '100%' }}>
      {isMobile && <TopBar title="Connected Accounts" showBack />}
      <PageShell>
        {/* Header */}
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
          padding: 18, display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12,
        }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 24, color: C.purple }}>link</span>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Connected Accounts</div>
            <div style={{ fontSize: 12, color: C.textVeryDim, marginTop: 3 }}>
              Connect your favorite platforms to unlock extra features, sync progress, and enhance your experience.
            </div>
          </div>
        </div>

        {/* List */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          {PLATFORMS.map(p => {
            const isConnected = !!linked[p.id];
            // Steam stores a rich object; everything else stores a string or
            // legacy {username} object.
            const username = p.id === 'steam'
              ? linked.steam?.steamId64
              : (typeof linked[p.id] === 'string' ? linked[p.id] : linked[p.id]?.username);
            return (
              <div key={p.id}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px',
                borderBottom: `1px solid ${C.borderSoft}`,
                flexWrap: isMobile ? 'wrap' : 'nowrap',
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: p.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  color: p.textColor, fontWeight: 800, fontSize: 14,
                }}>{p.letter}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: C.textVeryDim, marginTop: 2 }}>{p.desc}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {isConnected ? (
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: C.green, justifyContent: 'flex-end' }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: C.green }}/>
                        Connected
                      </div>
                      {username && <div style={{ fontSize: 11, color: C.textVeryDim, marginTop: 2 }}>{username}</div>}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.textVeryDim }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#3a3a5a' }}/>
                      Not connected
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={busyId === p.id}
                    onClick={() => {
                      if (isConnected) return handleDisconnect(p);
                      if (OAUTH_PLATFORMS.has(p.id)) return startOAuth(p.id);
                      setConnectModal(p); setInputValue('');
                    }}
                    style={{
                      background: isConnected ? 'transparent' : `linear-gradient(135deg,${C.purple},${C.purpleDeep})`,
                      border: isConnected ? `1px solid ${C.borderHard}` : 'none',
                      color: isConnected ? C.textMuted : '#fff',
                      borderRadius: 8, padding: '7px 20px', fontSize: 13, fontWeight: 600,
                      cursor: busyId === p.id ? 'wait' : 'pointer',
                      whiteSpace: 'nowrap', minWidth: 100,
                      opacity: busyId === p.id ? 0.6 : 1,
                    }}
                  >
                    {busyId === p.id ? '…' : isConnected ? 'Disconnect' : 'Connect'}
                  </button>
                </div>
              </div>

              {/* Steam-only: per-game GSI setup rows. Shown once Steam is
                  linked. Each row downloads the per-user .cfg and either
                  writes it directly (Tauri / FSA) or triggers a download. */}
              {p.id === 'steam' && steamLinked && (
                <SteamGsiRows
                  busyId={busyId}
                  onInstall={handleInstallGsi}
                  cs2Linked={!!linked.steam?.cs2Linked}
                  dota2Linked={!!linked.steam?.dota2Linked}
                  isMobile={isMobile}
                />
              )}
              </div>
            );
          })}
        </div>

        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
          padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 12, color: C.textVeryDim, marginTop: 12,
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>info</span>
          We'll never post to your social accounts without your permission. You can disconnect any account at any time.
        </div>
      </PageShell>

      {/* Connect modal */}
      {connectModal && (
        <div
          onClick={() => setConnectModal(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 16,
              padding: 24, width: 420, maxWidth: '95vw',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12, background: connectModal.color,
                color: connectModal.textColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: 14,
              }}>{connectModal.letter}</div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Connect {connectModal.name}</div>
                <div style={{ fontSize: 12, color: C.textVeryDim, marginTop: 2 }}>Enter your {connectModal.name} username.</div>
              </div>
            </div>
            <input
              type="text"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              placeholder={connectModal.placeholder}
              autoFocus
              style={{
                width: '100%', background: C.cardSoft, border: `1px solid ${C.borderHard}`,
                borderRadius: 8, padding: '11px 14px', fontSize: 14, color: C.text,
                outline: 'none', boxSizing: 'border-box', marginBottom: 16,
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setConnectModal(null)} style={{
                background: 'transparent', border: `1px solid ${C.borderHard}`, borderRadius: 8,
                color: C.textMuted, fontSize: 13, padding: '8px 16px', cursor: 'pointer',
              }}>Cancel</button>
              <button type="button" onClick={handleConnect} disabled={saving || !inputValue.trim()} style={{
                background: `linear-gradient(135deg,${C.purple},${C.purpleDeep})`,
                border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, padding: '8px 20px',
                fontWeight: 600, cursor: saving ? 'wait' : 'pointer', opacity: saving || !inputValue.trim() ? 0.6 : 1,
              }}>{saving ? 'Connecting…' : 'Connect'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Steam-specific connect modal override: replaces the generic input
          hint with a "where to find your Steam64 ID" tip. We piggyback on
          the same connectModal state above so the surrounding modal frame
          still renders; this just appends a helper note. */}
    </div>
  );
}

// ─── Steam GSI per-game setup rows ────────────────────────────────────
function SteamGsiRows({ busyId, onInstall, cs2Linked, dota2Linked, isMobile }) {
  const method = detectGsiMethod();
  const methodLabel = method === GSI_METHOD.TAURI
    ? 'Direct write (desktop app)'
    : method === GSI_METHOD.FSA
      ? 'One-click via folder picker'
      : 'Download .cfg + manual install';

  const Row = ({ id, name, color, letter, linked }) => {
    const busy = busyId === `gsi:${id}`;
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '12px 20px 12px 56px',
        borderBottom: `1px solid ${C.borderSoft}`,
        background: 'rgba(124,58,237,0.03)',
        flexWrap: isMobile ? 'wrap' : 'nowrap',
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 9, background: color,
          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 800, fontSize: 12, flexShrink: 0,
        }}>{letter}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{name} auto-result detection</div>
          <div style={{ fontSize: 11, color: C.textVeryDim, marginTop: 2 }}>
            {linked ? 'Configured. Re-install to update the .cfg if you reinstalled the game.' : `Install Valve GSI config — ${methodLabel}.`}
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => onInstall(id)}
          style={{
            background: linked ? 'transparent' : `linear-gradient(135deg,${C.purple},${C.purpleDeep})`,
            border: linked ? `1px solid ${C.borderHard}` : 'none',
            color: linked ? C.textMuted : '#fff',
            borderRadius: 8, padding: '6px 16px', fontSize: 12, fontWeight: 600,
            cursor: busy ? 'wait' : 'pointer',
            whiteSpace: 'nowrap', minWidth: 90,
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? '…' : (linked ? 'Re-install' : 'Set up')}
        </button>
      </div>
    );
  };

  return (
    <>
      <Row id="cs2"   name="Counter-Strike 2" color="#cf6a32" letter="CS" linked={cs2Linked} />
      <Row id="dota2" name="Dota 2"           color="#6c1212" letter="D2" linked={dota2Linked} />
    </>
  );
}
