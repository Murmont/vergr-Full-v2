/**
 * Desktop Auth Bridge for VERGR
 *
 * In Tauri, signInWithPopup() doesn't work because there's no browser popup
 * context. This module implements Google OAuth via the system browser:
 *
 * 1. Tauri starts a localhost HTTP server on a random port
 * 2. We open the Google OAuth consent URL in the system browser
 *    using implicit grant flow (response_type=token)
 * 3. Google redirects to http://localhost:{port}/callback#access_token=...
 * 4. The localhost server extracts the token and emits a Tauri event
 * 5. We receive the event and use signInWithCredential() to complete auth
 *
 * SETUP REQUIRED:
 * 1. In Google Cloud Console → APIs & Services → Credentials:
 *    - Open your OAuth 2.0 Web Client (the one Firebase uses)
 *    - Under "Authorized JavaScript origins", add: http://localhost
 *    - Under "Authorized redirect URIs", add: http://localhost/callback
 *      (Google allows any port on localhost automatically once the origin is added)
 * 2. Set VITE_GOOGLE_OAUTH_CLIENT_ID in your .env file
 *    (Find it in Firebase Console → Auth → Sign-in method → Google → Web client ID)
 */

import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { auth } from '../firebase/config';
import { isDesktopApp } from './platform';

// Dynamically import Tauri APIs only when in desktop context. The OAuth
// localhost bridge (start_oauth_listener) is a desktop-only command, so this
// must gate on the DESKTOP shell, not just any Tauri runtime (mobile also
// reports Tauri but has no such command).
let invoke = null;
let listen = null;
let openShell = null;

async function loadTauriAPIs() {
  if (!isDesktopApp()) return;
  try {
    const core = await import('@tauri-apps/api/core');
    const event = await import('@tauri-apps/api/event');
    const shell = await import('@tauri-apps/plugin-shell');
    invoke = core.invoke;
    listen = event.listen;
    openShell = shell.open;
  } catch (e) {
    console.warn('Failed to load Tauri APIs:', e);
  }
}

// Pre-load APIs on module init
loadTauriAPIs();

/**
 * Generate a random state parameter for CSRF protection
 */
function generateState() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Google OAuth flow for Tauri desktop.
 * Opens the system browser for consent, captures the token via localhost callback.
 */
export async function desktopGoogleAuth() {
  if (!invoke || !listen || !openShell) {
    await loadTauriAPIs();
  }

  if (!invoke) {
    throw new Error('Tauri APIs not available. Are you running in the desktop app?');
  }

  const clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      'VITE_GOOGLE_OAUTH_CLIENT_ID is not set. ' +
      'Find it in Firebase Console → Auth → Sign-in method → Google → Web client ID, ' +
      'then add it to your .env file.'
    );
  }

  // 1. Start the localhost OAuth listener (Tauri command)
  const port = await invoke('start_oauth_listener');

  // 2. Build Google OAuth URL (implicit grant = returns token directly)
  const state = generateState();
  const redirectUri = `http://localhost:${port}/callback`;
  const oauthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  oauthUrl.searchParams.set('client_id', clientId);
  oauthUrl.searchParams.set('redirect_uri', redirectUri);
  oauthUrl.searchParams.set('response_type', 'token');
  oauthUrl.searchParams.set('scope', 'openid email profile');
  oauthUrl.searchParams.set('state', state);
  oauthUrl.searchParams.set('prompt', 'select_account');

  // 3. Wait for the OAuth callback event (set up listener before opening browser)
  const tokenPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Google sign-in timed out. Please try again.'));
    }, 120_000); // 2 minute timeout

    listen('oauth-callback', (event) => {
      clearTimeout(timeout);
      const payload = event.payload;

      if (payload.error) {
        reject(new Error(`Google auth error: ${payload.error}`));
        return;
      }

      if (payload.state && payload.state !== state) {
        reject(new Error('OAuth state mismatch — possible CSRF attack.'));
        return;
      }

      if (!payload.access_token) {
        reject(new Error('No access token received from Google.'));
        return;
      }

      resolve(payload.access_token);
    });
  });

  // 4. Open the system browser
  await openShell(oauthUrl.toString());

  // 5. Wait for and process the token
  const accessToken = await tokenPromise;

  // 6. Use the access token to sign into Firebase
  const credential = GoogleAuthProvider.credential(null, accessToken);
  return signInWithCredential(auth, credential);
}
