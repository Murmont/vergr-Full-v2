# Handover: Vergr Admin, operator, bans, sub-admins (2026-09-20 to 2026-09-21)

Written for a new session picking this up on another account. Read this, then the
newest entries in `docs/UPDATE_LOG.md`, then the Vergr Admin sections of `CLAUDE.md`
(search for "OPERATOR", "staff", "SUB-ADMINS", "VERGR ADMIN"). **When a note and the
source disagree, the source wins.**

## What was built

### 1. Vergr Admin is its own desktop app (no longer on the website)
- Files: `admin.html`, `src/admin/{main.jsx, AdminApp.jsx, OperatorGate.jsx, AdminUpdateGate.jsx, openExternal.js}`,
  `src-tauri/tauri.admin.conf.json` (identifier `com.vergr.admin`, output `dist-admin`).
- Build: `npm run admin:build`. Dev: `npm run admin:dev`.
- It reuses `src/router/AdminRoutes.jsx`, so every admin screen has ONE implementation.
- **MemoryRouter, not BrowserRouter.** A packaged Tauri app cannot answer a reload on a deep path.
- `/admin` was removed from the web build. `AppRouter.jsx` no longer imports AdminRoutes.
- ⚠ **The admin app has NO consumer routes.** `navigate('/messages/…')` or `<a href="/…">` inside an
  admin screen bounces to the dashboard. Product pages open on vergr.app via
  `openInVergr(path)` in `src/admin/openExternal.js`, which uses the Tauri shell plugin.
  `window.open` does not reach the system browser from a Tauri window.

### 2. The admin is the OPERATOR (an Auth custom claim, no profile)
- `functions/operator.js`. `operator: true` custom claim; the account has NO `users/{uid}` or wallet doc.
- Armed from Admin Access (on the existing `inviteAdmin` callable, `operator: true`); `onUserCreated`
  claims it first and creates no profile.
- 2FA is compulsory and fails closed (`requireOperatorSession`, 12h window). Enrollment returns 10
  one-use recovery codes, stored hashed.
- Authenticator setup screen now shows a QR code (qrcode.react, the server's `otpauthUrl`) plus the
  typed secret as a fallback, and a "Get Google Authenticator" button with the Play prism.
- Verified live: 1 Auth account carries the operator claim; 0 of 53 user docs carry `role: 'admin'`.

### 3. Authority vs perks split
- **Authority** (ban, mute, grant, admin screens) = the operator claim.
- **Perks** (upload caps, geo block, stream and translate limits, vergr.me limits, paywall bypass) =
  `users/{uid}.staff === true`, read through `isStaffDoc()` in `functions/staff.js` and `profile.staff`
  on the client. `staff` is server-only in firestore.rules (`lockedUserFields`).
- The founder's email `vergenerd@gmail.com` was hardcoded in 15 server files and 8 client files. All removed
  (only a comment in `functions/staff.js` and the demo fixture `src/demo/mockAuth.js` remain).
- Six admin-alert queries moved from `role == 'admin'` to `staff == true`.

### 4. Bans and mutes are real now
- `functions/bans.js` (a module, not a Cloud Function): Auth `disabled: true` + token revocation +
  flags; `BannedGate.jsx` on the client. Unban re-enables the account. Expiry sweep rides `cronEvery6h`.
- Mutes ride the ID token as a custom claim (`mutedUntil`), read free in firestore.rules
  (`canPublish()`), plus a client gate in the composer. Claims are MERGED, never overwritten.
- 2026-09-21 fix, DEPLOYED: `bans.assertBannable` and `adminUsers.assertNotFounder` only checked
  `role === 'admin'` (on no account), so the founder's account could have been banned or muted. Both
  now also refuse `isStaffDoc()` and the operator. `vanguardMuteUser` had no check at all; it now calls
  `assertBannable`. Deployed: adminBanUser, adminMuteUser, adminSetUserRole, adminForceLogoutUser,
  adminDeleteGuestAccount, vanguardMuteUser, vanguardTempBanUser, vanguardPermaBanUser.

### 5. Sub-admins can actually get in
- `acceptAdminInvite` needs no invite id: the server finds the pending invite from the caller's Auth
  email. No profile required. `requireAdminIdentity` admits active sub-admins, so they can enroll 2FA.
- 2FA is compulsory for sub-admins too.
- The Access screen can now grant "Support agent" (the `support` screen was missing from the chips).
- `previewCreatorPayoutRun` (Economy dry run) now uses `requireAdminScreen(uid, 'economy')`, deployed.
- Distribution: the founder sends the installer; the sub-admin installs, signs in and presses Accept.

### 6. Vergr Admin auto-updates (SUPERSEDED 2026-09-21 by the locked channel, see UPDATE_LOG)
⚠ From 1.0.219 the endpoint is `https://sfu.vergr.app/ops/admin/latest.json` on box 1, served only
with a 15-minute download ticket from `getMyAdminSecurityStatus`, and the publisher uploads by scp.
The R2 path below is what 1.0.216 to 1.0.218 still poll.
- Endpoint baked into the binary: `https://cdn.vergr.app/ops/f6192a31fcb647101e63fb3b96d42e0f/admin-latest.json`.
- Publisher: `scripts/publish-admin-update.mjs` (reads the slug from the config, matches only
  `Vergr Admin_*-setup.exe`, asserts the version, uploads installer THEN manifest).
- `tauri.admin.conf.json` has its own `version`. Currently **1.0.218**, live on the update path and
  copied to `Downloads/Vergr-Admin-Setup.exe`.
- Signing: the build step fails on "no private key" (expected). Sign standalone FROM BASH:
  `npx tauri signer sign -f /c/Users/damie/vergr-keystore/tauri-updater.key -p '' "src-tauri/target/release/bundle/nsis/Vergr Admin_<ver>_x64-setup.exe"`
  then `node scripts/publish-admin-update.mjs` (optional `VERGR_ADMIN_UPDATE_NOTES=...`).
- Verify from the artifact: grep `dist-admin/assets/*.js` for new strings, confirm the `admin-*.js`
  entry chunk name appears inside `src-tauri/target/release/vergr-desktop.exe`, then curl the live
  manifest version and installer Content-Length. (A string scan of the NSIS .exe finds nothing; it is
  LZMA-compressed.)

### 7. Admin UI fixes in 1.0.218
- Support queue "Reply on vergr.app", "View profile" (was `/profile/:uid`, real route `/user/:id`),
  channels "Open the room" and "Room settings" (was `/messages/:id/info`, real route `/messages/:id/group`)
  now open vergr.app. Sidebar "Back to App" is now "Open Vergr".
- Moderation Queue detail shows the reported post's media (was fetched, never drawn), letterboxed.
- "Open user" from a report opens that user's drawer (Users screen now reads `?uid=`).
- Economy ledger, Recent grants and Live Stats show `usd`/`owed` rows as dollars (were raw micro-dollars).
- Removed the false "Cryptomus Wallet, awaiting underwriting" row and Cryptomus processor copy; App
  Config now names PayRam, Google Play Billing and HUAWEI IAP. Two inert payout inputs (min payout in
  gems, payout currency) replaced by read-only facts ($100 minimum, 30-day account age).
- Creators approval no longer says "credited as undefined gems".

### 8. Cost cleanup
- Artifact Registry cleanup policy re-applied (it had vanished). 183 build-cache packages deleted.
- Dead dependency `get-video-duration` removed from functions (image 61 MB to 28 MB).

## Status of the old open items (2026-09-21, second session; detail in UPDATE_LOG)
1. Subscriptions → Settings: DONE. Two enforced switches (pause new plans, grace period).
2. Billing & Invoices: DONE. Now "Payments", read from the `subscriptions/` rows every rail writes.
3. Tournament callables: DONE. 22 functions deleted, two cron jobs removed, `vergr-ocr` stopped on box 1.
4. ~150-function step-up redeploy: NOT NEEDED. Accepting an invite now gives `pending_2fa`, and the old
   bundled `requireAdminScreen` refuses anything but `active`.
5. Live Stats costs: the "needs secrets" note was wrong (the Cloudflare token exists and worked). The
   panel now also counts DISABLED secret versions, which Google bills.
6. Git: never suggest committing. The founder keeps this local only; the GitHub repo is public.
7. Updater: moved to a LOCKED channel on box 1. 1.0.219 is the build that uses it.

## Still open (founder)
- ✅ DONE 2026-09-21 (founder-approved): the `/ops/` block is live on box 1 and the two dead OCR
  proxies are gone. Measured: anonymous 401, forged or wrong-key ticket 401, a real ticket passes
  the gate (404 until a file is published), /healthz /ingest-healthz /sysinfo-healthz still 200.
  Backup of the old site file: `/root/nginx-backups/sfu.vergr.app.2026-09-21.bak` (outside
  sites-enabled on purpose: nginx loads every file in there).
- ✅ Vergr Admin 1.0.219 PUBLISHED to the locked channel 2026-09-21 (founder go-ahead). Measured: manifest
  1.0.219 with a ticket, installer byte-exact (96,022,326) with a ticket, 401 without. The old R2 copies under
  `ops/f6192a31fcb647101e63fb3b96d42e0f/` are DELETED (R2 and CDN edge both 404). Installed 1.0.216 to 1.0.218
  cannot reach 1.0.219: install `Downloads/Vergr-Admin-Setup.exe` by hand once.
- ✅ DONE 2026-09-21 (founder-approved): 36 disabled secret versions destroyed. Re-checked first:
  all DISABLED, none the newest of its secret, none pinned by any of 362 functions or 360 Cloud Run
  services/jobs; the only direct Secret Manager reader (`kyc.js`) reads `kyc-private-key/latest`,
  not on the list. Billed versions 107 → 71. Six secret-using functions cold-started fine after.
- `/connect-gaming` and `/esports-team/:teamId` are still routed (nothing links to them; 0 teams exist).
- "Gamer Pack" coin pack name: a rename needs the Play and AppGallery product titles changed too.
- Dashboard revenue chart plots dead series; the real margin is `platform_revenue_daily`.

### Fixed 2026-09-21, second pass (see UPDATE_LOG "BROKEN AND MISSING ADMIN")
- App Config is 10 real switches with a guard (`scripts/admin-config-check.mjs`); health is real probes.
- A takedown now stops the stream (rtmp-auth drop, ingest listener, on_publish refuses reconnect).
- Appeals: owner-checked, windowed, `/appeal` screen; moderation settings all read; 9 indexes added.
- Payout account panel in the Users drawer (2FA step-up on its three callables).
- STILL OPEN from the audit below: the Vanguard items (mute/ban callables with no caller, non-post
  reports, stream takedown for Vanguard, Vanguard 2FA, see-through fills), co-host loopback takedown.

### Audit 2026-09-21 (measured, not from notes)
- **App Config: 58 allowlisted settings have NO reader** anywhere in src/, functions/ or infra/
  (script: every key in `FIELD_WHITELIST` grepped outside the config code). ~40 are SHOWN on the screen,
  including Maintenance mode (never redirects to `/maintenance`), Allow new registrations, IP allowlist,
  failed-login lockout, min password length, DMs on/off, quiet hours, data retention. Only
  `liveStreamingPaused`, the payment kill switches and chat-media expiry are real.
- **Taking down a live stream does not stop it.** `endStreamSession` is host-only. Admin approving a
  stream report writes `status: 'ended_by_admin'`, but vergr-ingest checks status only at `/init`
  (segments ride an in-memory session) and vergr-rtmp-auth only at `on_publish`; the broadcaster keeps
  pushing to the CDN. Vanguard has no stream action at all.
- **Vanguard mute / temp-ban / perma-ban are deployed with ZERO callers.** `vanguardResolveReport`
  approve only hides POSTS; user, comment, message and stream reports change status and nothing else.
- Vanguard Chat is not a chat (pinned notes + a link to /messages). Treasury, payouts and the Vanguard
  wallet have no inflow (both old sources deleted). Unenrolled non-admins skip `requireFreshStepUp`, so
  Vanguard have no authenticator requirement. 52 see-through fills in the live Vanguard screens.
- **0 Vanguard members exist** (no user doc carries `vanguard.rank`).
- No live client screen calls a deleted function (every miss is in unrouted tournament files).

## Rules that bit this work (read before touching anything)
- Never spend the founder's money: no new functions, crons, secrets, paid calls, or big redeploys without a yes.
- Deploy functions with `FUNCTIONS_DISCOVERY_TIMEOUT=180`, log to a file, refuse an empty `--only` list
  (an empty one deploys EVERYTHING).
- Run `npm run check` (eslint no-undef included) BEFORE deploying.
- Rules: never guard with `exists()`/`get()`; use the free token claim (`isOperatorClaim()`) first.
- Every function uses `getFirestore('vgrdb')`.
- CRLF and LF files are mixed; normalise patch anchors to the file's own endings. Use
  `s.replace(a, () => b)`, and write backslash-containing code with the Edit/Write tools, not a shell heredoc.
- No em dashes in any output. Terse replies. Research, decide and do; do not hand the founder menus.
