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
  getOAuthStartUrl, twitchChannelImport,
} from '../../firebase/firestore';
import { installGsiConfig, detectGsiMethod, GSI_METHOD } from '../../utils/gsiInstaller';
import TopBar from '../../components/TopBar';
import useResponsive from '../../hooks/useResponsive';
import { C, PageShell } from './_settingsUI';
import DiscordRejoinPrompt from '../../components/messages/DiscordRejoinPrompt';
import { openExternalUrl } from '../../utils/externalBrowser';

// Platforms that go through the generic OAuth2 flow in functions/oauth.js.
// Clicking Connect on these redirects the browser to the provider's authorize
// URL via getOAuthStartUrl; the backend handles the callback and writes the
// linked-account info. Steam, Riot, EA/Origin, Xbox, PSN keep manual entry.
//
// Epic Games is manual-entry too: their OAuth app sat "pending approval" for
// months with no sign of going through, and Epic has no functional integration
// here (it's identity/cosmetic only — unlike Twitch's mirror, Discord's server
// clone, or Steam's GSI, which genuinely need a real token). So we just store
// the typed Epic handle, no API key / approval to maintain.
//
// 2026-09-08: that reasoning now covers everything except Twitch and Discord.
// Founder decision: every other row is a DISPLAY LINK, not a real connection.
// The user types their handle and we show it on their profile, which is all
// these rows ever did for anyone looking at them.
//
// Only two platforms still need a real token, because something actually reads
// it afterwards: Twitch drives the stream mirror and its chat bridge, and
// Discord drives the server clone and role rewards. The rest were an OAuth app,
// a client secret and an approval process maintained to store a username.
//
// ⚠ REMOVING A PLATFORM FROM THIS SET IS HALF THE CHANGE. The other half is
// `functions/oauth.js`: its PROVIDERS table and ALL_SECRETS must drop the same
// platform, or the callable keeps binding a secret nothing uses. The two lists
// are meant to stay in step.
const OAUTH_PLATFORMS = new Set(['twitch', 'discord']);

// Real brand logos (24x24 single-path glyphs, fill=currentColor so the tile's
// textColor drives the colour). Paths from the public Simple Icons set, keyed
// by our platform id (see PLATFORMS below).
const BRAND_PATHS = {
  steam: 'M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z',
  riotgames: 'M13.458.86 0 7.093l3.353 12.761 2.552-.313-.701-8.024.838-.373 1.447 8.202 4.361-.535-.775-8.857.83-.37 1.591 9.025 4.412-.542-.849-9.708.84-.374 1.74 9.87L24 17.318V3.5Zm.316 19.356.222 1.256L24 23.14v-4.18l-10.22 1.256Z',
  battlenet: 'M18.94 8.296C15.9 6.892 11.534 6 7.426 6.332c.206-1.36.714-2.308 1.548-2.508 1.148-.275 2.4.48 3.594 1.854.782.102 1.71.28 2.355.429C12.747 2.013 9.828-.282 7.607.565c-1.688.644-2.553 2.97-2.448 6.094-2.2.468-3.915 1.3-5.013 2.495-.056.065-.181.227-.137.305.034.058.146-.008.194-.04 1.274-.89 2.904-1.373 5.027-1.676.303 3.333 1.713 7.56 4.055 10.952-1.28.502-2.356.536-2.946-.087-.812-.856-.784-2.318-.19-4.04a26.764 26.764 0 0 1-.807-2.254c-2.459 3.934-2.986 7.61-1.143 9.11 1.402 1.14 3.847.725 6.502-.926 1.505 1.672 3.083 2.74 4.667 3.094.084.015.287.043.332-.034.034-.06-.08-.124-.131-.149-1.408-.657-2.64-1.828-3.964-3.515 2.735-1.929 5.691-5.263 7.457-8.988 1.076.86 1.64 1.773 1.398 2.595-.336 1.131-1.615 1.84-3.403 2.185a27.697 27.697 0 0 1-1.548 1.826c4.634.16 8.08-1.22 8.458-3.565.286-1.786-1.295-3.696-4.053-5.17.696-2.139.832-4.04.346-5.588-.029-.08-.106-.27-.196-.27-.068 0-.067.13-.063.187.135 1.547-.263 3.2-1.062 5.19zm-8.533 9.869c-1.96-3.145-3.09-6.849-3.082-10.594 3.702-.124 7.474.748 10.714 2.627-1.743 3.269-4.385 6.1-7.633 7.966h.001z',
  origin: 'M16.635 6.162l-5.928 9.377H4.24l1.508-2.3h4.024l1.474-2.335H2.264L.79 13.239h2.156L0 17.84h12.072l4.563-7.259 1.652 2.66h-1.401l-1.473 2.299h4.347l1.473 2.3H24zm-11.461.107L3.7 8.604l9.52-.035 1.474-2.3z',
  openxbl: 'M4.102 21.033C6.211 22.881 8.977 24 12 24c3.026 0 5.789-1.119 7.902-2.967 1.877-1.912-4.316-8.709-7.902-11.417-3.582 2.708-9.779 9.505-7.898 11.417zm11.16-14.406c2.5 2.961 7.484 10.313 6.076 12.912C23.002 17.48 24 14.861 24 12.004c0-3.34-1.365-6.362-3.57-8.536 0 0-.027-.022-.082-.042-.063-.022-.152-.045-.281-.045-.592 0-1.985.434-4.805 3.246zM3.654 3.426c-.057.02-.082.041-.086.042C1.365 5.642 0 8.664 0 12.004c0 2.854.998 5.473 2.661 7.533-1.401-2.605 3.579-9.951 6.08-12.91-2.82-2.813-4.216-3.245-4.806-3.245-.131 0-.223.021-.281.046v-.002zM12 3.551S9.055 1.828 6.755 1.746c-.903-.033-1.454.295-1.521.339C7.379.646 9.659 0 11.984 0H12c2.334 0 4.605.646 6.766 2.085-.068-.046-.615-.372-1.52-.339C14.946 1.828 12 3.545 12 3.545v.006z',
  discord: 'M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z',
  playstation: 'M8.984 2.596v17.547l3.915 1.261V6.688c0-.69.304-1.151.794-.991.636.18.76.814.76 1.505v5.875c2.441 1.193 4.362-.002 4.362-3.152 0-3.237-1.126-4.675-4.438-5.827-1.307-.448-3.728-1.186-5.39-1.502zm4.656 16.241l6.296-2.275c.715-.258.826-.625.246-.818-.586-.192-1.637-.139-2.357.123l-4.205 1.5V14.98l.24-.085s1.201-.42 2.913-.615c1.696-.18 3.785.03 5.437.661 1.848.601 2.04 1.472 1.576 2.072-.465.6-1.622 1.036-1.622 1.036l-8.544 3.107V18.86zM1.807 18.6c-1.9-.545-2.214-1.668-1.352-2.32.801-.586 2.16-1.052 2.16-1.052l5.615-2.013v2.313L4.205 17c-.705.271-.825.632-.239.826.586.195 1.637.15 2.343-.12L8.247 17v2.074c-.12.03-.256.044-.39.073-1.939.331-3.996.196-6.038-.479z',
  epicgames: 'M3.537 0C2.165 0 1.66.506 1.66 1.879V18.44a4.262 4.262 0 00.02.433c.031.3.037.59.316.92.027.033.311.245.311.245.153.075.258.13.43.2l8.335 3.491c.433.199.614.276.928.27h.002c.314.006.495-.071.928-.27l8.335-3.492c.172-.07.277-.124.43-.2 0 0 .284-.211.311-.243.28-.33.285-.621.316-.92a4.261 4.261 0 00.02-.434V1.879c0-1.373-.506-1.88-1.878-1.88zm13.366 3.11h.68c1.138 0 1.688.553 1.688 1.696v1.88h-1.374v-1.8c0-.369-.17-.54-.523-.54h-.235c-.367 0-.537.17-.537.539v5.81c0 .369.17.54.537.54h.262c.353 0 .523-.171.523-.54V8.619h1.373v2.143c0 1.144-.562 1.71-1.7 1.71h-.694c-1.138 0-1.7-.566-1.7-1.71V4.82c0-1.144.562-1.709 1.7-1.709zm-12.186.08h3.114v1.274H6.117v2.603h1.648v1.275H6.117v2.774h1.74v1.275h-3.14zm3.816 0h2.198c1.138 0 1.7.564 1.7 1.708v2.445c0 1.144-.562 1.71-1.7 1.71h-.799v3.338h-1.4zm4.53 0h1.4v9.201h-1.4zm-3.13 1.235v3.392h.575c.354 0 .523-.171.523-.54V4.965c0-.368-.17-.54-.523-.54zm-3.74 10.147a1.708 1.708 0 01.591.108 1.745 1.745 0 01.49.299l-.452.546a1.247 1.247 0 00-.308-.195.91.91 0 00-.363-.068.658.658 0 00-.28.06.703.703 0 00-.224.163.783.783 0 00-.151.243.799.799 0 00-.056.299v.008a.852.852 0 00.056.31.7.7 0 00.157.245.736.736 0 00.238.16.774.774 0 00.303.058.79.79 0 00.445-.116v-.339h-.548v-.565H7.37v1.255a2.019 2.019 0 01-.524.307 1.789 1.789 0 01-.683.123 1.642 1.642 0 01-.602-.107 1.46 1.46 0 01-.478-.3 1.371 1.371 0 01-.318-.455 1.438 1.438 0 01-.115-.58v-.008a1.426 1.426 0 01.113-.57 1.449 1.449 0 01.312-.46 1.418 1.418 0 01.474-.309 1.58 1.58 0 01.598-.111 1.708 1.708 0 01.045 0zm11.963.008a2.006 2.006 0 01.612.094 1.61 1.61 0 01.507.277l-.386.546a1.562 1.562 0 00-.39-.205 1.178 1.178 0 00-.388-.07.347.347 0 00-.208.052.154.154 0 00-.07.127v.008a.158.158 0 00.022.084.198.198 0 00.076.066.831.831 0 00.147.06c.062.02.14.04.236.061a3.389 3.389 0 01.43.122 1.292 1.292 0 01.328.17.678.678 0 01.207.24.739.739 0 01.071.337v.008a.865.865 0 01-.081.382.82.82 0 01-.229.285 1.032 1.032 0 01-.353.18 1.606 1.606 0 01-.46.061 2.16 2.16 0 01-.71-.116 1.718 1.718 0 01-.593-.346l.43-.514c.277.223.578.335.9.335a.457.457 0 00.236-.05.157.157 0 00.082-.142v-.008a.15.15 0 00-.02-.077.204.204 0 00-.073-.066.753.753 0 00-.143-.062 2.45 2.45 0 00-.233-.062 5.036 5.036 0 01-.413-.113 1.26 1.26 0 01-.331-.16.72.72 0 01-.222-.243.73.73 0 01-.082-.36v-.008a.863.863 0 01.074-.359.794.794 0 01.214-.283 1.007 1.007 0 01.34-.185 1.423 1.423 0 01.448-.066 2.006 2.006 0 01.025 0zm-9.358.025h.742l1.183 2.81h-.825l-.203-.499H8.623l-.198.498h-.81zm2.197.02h.814l.663 1.08.663-1.08h.814v2.79h-.766v-1.602l-.711 1.091h-.016l-.707-1.083v1.593h-.754zm3.469 0h2.235v.658h-1.473v.422h1.334v.61h-1.334v.442h1.493v.658h-2.255zm-5.3.897l-.315.793h.624zm-1.145 5.19h8.014l-4.09 1.348z',
  twitch: 'M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z',
  youtube: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
};

function BrandLogo({ id, color, size = 22 }) {
  const d = BRAND_PATHS[id];
  if (!d) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const PLATFORMS = [
  // These four used to sell "auto-result detection" for tournaments. Tournaments
  // are gone and the ~70 Cloud Functions behind that detection were deleted on
  // 2026-08-17, so linking could not produce a result for anything. The rows
  // STAY (linkSteamAccount / unlinkSteamAccount / getSteamGsiConfig are still
  // deployed and the screen is live) and now describe the benefit that survives:
  // showing the handle on your profile.
  { id: 'steam',       name: 'Steam',         color: '#1b2838', letter: 'S', textColor: '#c7d5e0', desc: 'Link Steam to show your Steam handle on your Vergr profile so people can find you in game.', placeholder: '7656119xxxxxxxxxx (your 17-digit Steam64 ID)' },
  { id: 'riotgames',   name: 'Riot Games',    color: '#c6362f', letter: 'R', textColor: '#fff',    desc: 'Connect your Riot account to show your Riot ID on your Vergr profile.',  placeholder: 'Name#TAG' },
  { id: 'battlenet',   name: 'Battle.net',    color: '#00aeff', letter: 'B', textColor: '#fff',    desc: 'Link your Battle.net BattleTag to show it on your Vergr profile.', placeholder: 'YourTag#1234' },
  { id: 'origin',      name: 'EA / Origin',   color: '#ff5252', letter: 'O', textColor: '#fff',    desc: 'Connect your EA / Origin handle to show it on your Vergr profile.', placeholder: 'Your Origin or Steam handle' },
  { id: 'openxbl',     name: 'Xbox',          color: '#107c10', letter: 'X', textColor: '#fff',    desc: 'Sign in with Xbox to connect your Gamertag and enable cross-platform squad matchmaking.', placeholder: 'Your Gamertag' },
  { id: 'discord',     name: 'Discord',       color: '#5865f2', letter: 'D', textColor: '#fff',    desc: "Connect Discord to join our community and get role rewards.",                placeholder: 'Username#1234' },
  { id: 'playstation', name: 'PlayStation™ Network', color: '#003087', letter: 'P', textColor: '#fff', desc: 'Connect your PlayStation account to track trophies and game progress.',     placeholder: 'Your PSN ID' },
  { id: 'epicgames',   name: 'Epic Games',    color: '#2a2a2a', letter: 'E', textColor: '#fff',    desc: 'Connect your Epic Games account to access exclusive events and rewards.',    placeholder: 'Your Epic display name' },
  { id: 'twitch',      name: 'Twitch',        color: '#9146FF', letter: 'T', textColor: '#fff',    desc: 'Connect once, then just go live on Twitch — your stream shows up live on VERGR automatically, with chat synced both ways. No OBS changes needed.', placeholder: 'Your Twitch username' },
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
  const [rejoinForce, setRejoinForce] = useState(false);
  const [twitchSetupOffer, setTwitchSetupOffer] = useState(false);
  const [twitchSetupBusy, setTwitchSetupBusy] = useState(false);

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
    // Fresh Discord link → immediately check for cloned communities they were
    // in (the auto-rejoin net; force bypasses the daily cache).
    if (linkedParam === 'discord' && status === 'ok') setRejoinForce(true);
    // Fresh Twitch link → offer the one-tap channel import (profile prefill +
    // starter vergr.me with their VODs/clips embedded).
    if (linkedParam === 'twitch' && status === 'ok') setTwitchSetupOffer(true);
    // Strip the params from the URL.
    const cleanHash = window.location.hash.split('?')[0];
    window.history.replaceState({}, '', cleanHash || '/settings/linked');
  }, []); // eslint-disable-line

  const linked = profile?.linkedAccounts || {};
  const steamLinked = !!linked.steam?.steamId64;

  // For OAuth providers we redirect the browser to the provider's authorize
  // URL instead of opening the manual-entry modal.
  const startOAuth = async (platformId) => {
    setBusyId(platformId);
    try {
      // Only Twitch and Discord reach here now: the Steam OpenID branch and the
      // OpenXBL cookie dance went with the display-link change, along with the
      // functions and secrets behind them.
      const { url } = (await getOAuthStartUrl(platformId)) || {};
      if (!url) throw new Error('No auth URL returned');
      // On native, run OAuth in the SYSTEM browser, not this WebView. An
      // in-WebView redirect ends on the web origin (vergr.app) with no native
      // Firebase session, so the link "looks connected but never shows". Opening
      // externally keeps the app + its live linkedAccounts listener alive, and
      // the verified vergr.app App Link returns the user when done.
      if (openExternalUrl(url)) {
        showToast('Continue in your browser, then come back to VERGR.', 'info');
        setBusyId(null);
        return;
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
        {/* Fresh Discord link → offer to rejoin cloned communities they were in */}
        {rejoinForce && <DiscordRejoinPrompt force />}
        {/* Fresh Twitch link → one-tap channel import */}
        {twitchSetupOffer && (
          <div style={{
            background: 'rgba(145,70,255,0.10)', border: '1px solid rgba(145,70,255,0.35)',
            borderRadius: 12, padding: '14px 16px', marginBottom: 12,
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          }}>
            <span style={{
              width: 36, height: 36, borderRadius: 9, background: '#9146FF', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, flexShrink: 0,
            }}>T</span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Bring your channel over</div>
              <div style={{ fontSize: 11.5, color: C.textVeryDim }}>
                One tap: your Twitch bio and art prefill your profile, and a vergr.me page is generated with your VODs and clips embedded.
              </div>
            </div>
            <button
              onClick={async () => {
                if (twitchSetupBusy) return;
                setTwitchSetupBusy(true);
                try {
                  const res = await twitchChannelImport();
                  showToast(res?.pageCreated
                    ? `Channel imported — ${(res.vods || 0) + (res.clips || 0)} videos on your new vergr.me page`
                    : 'Profile filled from Twitch (your vergr.me page was left as-is)', 'success');
                  setTwitchSetupOffer(false);
                } catch (err) {
                  showToast(err?.message || 'Import failed', 'error');
                } finally { setTwitchSetupBusy(false); }
              }}
              disabled={twitchSetupBusy}
              style={{
                padding: '10px 16px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: '#9146FF', color: '#fff', fontWeight: 800, fontSize: 12.5,
                opacity: twitchSetupBusy ? 0.6 : 1,
              }}>
              {twitchSetupBusy ? 'Importing…' : 'Set up from Twitch'}
            </button>
          </div>
        )}
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
                }}><BrandLogo id={p.id} color={p.textColor} /></div>
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
              }}><BrandLogo id={connectModal.id} color={connectModal.textColor} /></div>
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
