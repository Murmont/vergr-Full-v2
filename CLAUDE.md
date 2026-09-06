# VERGR — Claude working notes

Keep this current. Condensed 2026-05-22 (full historical detail preserved in `CLAUDE.md.bak`, now at `C:\Users\damie\Downloads\CLAUDE.md.bak`, + git history). When a build ships or a TODO is added, update the relevant section.

---

## 🔎 AUDIT RULES — `docs/AUDIT_RULES.md`, READ IT BEFORE AUDITING ANYTHING

**An audit is never only cosmetic and never only technical.** Founder, 2026-09-03, after a
"finished" audit reported clean and he found fake glass, the wrong typeface and a clipped
verified tick in the first minute of reading it. Every audit covers, and reports on, all
five: **technical** (does it work), **cosmetic** (does it look designed), **UI/UX** (does it
make sense to use), **improvements** (not just defects), and **coverage** (every surface x
role x device x state x overlay x TRANSIENT).

The two rules the rest depends on:

- ⚠⚠ **MEASURE THE RENDERED PAGE. A SOURCE GREP IS NOT AN AUDIT.** Rules checked in source
  miss every shipped component the surface imports and every value the browser computes.
- ⚠⚠ **EVERY PROBE NEEDS A CONTROL RUN.** Three findings in that session were artifacts of
  the harness, not the product, and each would have sent a session rewriting working code.

⚠ **TRANSIENTS ARE THE BLIND SPOT.** Alerts, ribbons, toasts, celebrations, poll cards and
countdown banners expire, so a sweep that walks the DOM sees whichever happens to be up —
usually none. Fire each one, let its entry animation settle, then measure. That single hole
hid four defects behind a completed audit.

Running record and open items: `docs/LIVE_STREAM_AUDIT.md`. **Listing an item does not close
it** — deferrals stay open until the founder decides.

---

## ⚠⚠ READ BEFORE TRUSTING ANYTHING BELOW (audited 2026-08-16)

This file was found stale in five places on 2026-08-16, and a session repeated the stale facts to a
payment processor. **When this file and the source disagree, the SOURCE WINS. Grep before you assert.**

The four things most often gotten wrong, all verified against code on 2026-08-16:

1. **NOBODY CAN WITHDRAW ANYTHING, EVER.** No convert, no withdraw, no gem transfer, no gems-to-coins.
   Those modules are DELETED and their callables undeployed (2026-08-16). Coins are a revocable licence to
   access features, no cash value, non-transferable. Gems are revenue share Vergr OWES, not a balance.
   Any sentence in this file implying otherwise is stale — fix it rather than repeat it.
2. **Vergr is the PRINCIPAL, not a marketplace.** See "What Vergr IS" below and
   `docs/REVENUE_SHARE_PLAN.md` §1.4. Never write "marketplace", "multi-vendor", "selling on behalf
   of others", "forwarding funds" or "stored value" about Vergr. `sellerUid` in
   `functions/entitlements.js` is PRE-MIGRATION NAMING, not the legal relationship.
3. **Tournaments are DEAD and UNROUTED.** `AppRouter.jsx` has exactly one tournament route,
   `/vanguard/lookup/tournament`, admin-only. The enormous tournaments section immediately below is
   DEAD-CODE DOCUMENTATION kept for the files on disk. It is NOT a build queue and NOT current work.
4. **The UI and the public help centre HAVE now caught up (done + deployed 2026-08-16).** 31 help
   articles removed, ~178 sentence rewrites, ToS + privacy + AML + anti-fraud corrected, the crypto
   deposit surface unrouted, 14 live components rewritten. Removed URLs return HTTP 410 via
   `functions/gone.js`. **Full record, with tick-boxes so you do not redo finished work:**
   `docs/WITHDRAWAL_REMOVAL_LIST.md`. Handover prompt: `docs/HANDOVER_WITHDRAWAL_CLEANUP.md`.

### Second audit, 2026-08-23. Seven MORE stale claims, one of which caused a live bug.

The 2026-08-16 audit above did not catch these. Each was checked against source, not memory:

| Claim in this file | Truth |
|---|---|
| "React 18 + Vite SPA, **HashRouter**" (twice) and a TODO to "kill HashRouter" | **BrowserRouter since before 2026-08-23.** `AppRouter.jsx:750`. The migration was listed as outstanding launch work long after it shipped. |
| the repo has no source for `vergr-sfu`/`vergr-ingest`/`vergr-rtmp-auth`/`vergr-chat` | **All four have full source** in `infra/*/src/`. Only `stream-node-agent` genuinely lacks it. |
| "1.0.198 SHIPPED" as the current-version header | **1.0.203.** |
| Subscriptions section selling tournaments, a vergr.me custom domain, IP-masked streaming, priority support, co-streaming as a Pro perk, EUR prices | All four were deleted or never existed; co-streaming is FREE; the charge is USD. The 2026-08-19 audit in this same file already said so and the tier section was never updated to match. |
| "tip 10% fee ... credits platform_revenue" | **No tip fee exists.** `feePctFor()` returns 0. |
| Vanguard perks: 5% tournament mod cut + conversion fee waived | Both are against deleted features. Vanguard have no working comp. |

⚠ **The HashRouter one was not harmless.** `ErrorBoundary.jsx` set `window.location.hash = '#/'` for its
"Go home" button, which under BrowserRouter appends `#/` to the crashed path and reloads the SAME
crash. The only escape hatch on the crash screen was dead. Fixed 2026-08-23.

**So the rule below is not enough on its own.** A stale line here does not just misinform, it gets
DESIGNED AGAINST: the "no source for the relay" line caused a per-message Firestore read to be
built for rank crests in chat, when the relay already loads the user doc once per connection and
the field was free. **If this file tells you something is impossible or missing, verify it exists
or does not exist on disk before you architect around it.**

**Rule going forward: do not write "removed", "shipped" or "done" in this file without grepping for
the callsites first.** A claim here that the code contradicts is worse than no claim at all, because
it gets repeated to founders, processors and future sessions as fact.

---

## 🏛 THE OPERATING ENTITY IS **VERGR LLC (KENTUCKY)** (2026-08-20, shipped)

Murmont LLC (Wyoming) is **superseded**. Never write it on a form, a policy, a
processor application or a statement again.

| Field | Value | Source |
|---|---|---|
| Legal name | **Vergr LLC** | Articles of Organization, Article I ("VERGR LLC") |
| Formed | Commonwealth of Kentucky, **20 August 2026** | Articles, filed 8/20/2026 2:14 PM |
| Organization Number | **1622652** | Kentucky's own term, and the ONLY entity id it issues. Verified 2026-08-20 in the SoS business search: VERGR LLC, Active, standing Good. The Articles stamp reads `1622652.06`; **.06 is a per-document suffix, not part of the number**. Northwest's Initial Resolutions call it a "filing number" only because that template is generic across 50 states |
| Registered office + mailing address | **212 N. 2nd St, Ste 100, Richmond, KY 40475** | Articles, Articles II and III (they give the same address) |
| Registered agent | **Northwest Registered Agent LLC** | Articles, Article II |
| Management | **Member-managed**, sole member Damien Ashton, 100% | Articles Article IV + Operating Agreement 4.1 + Certification of Member |
| EIN | ⚠ **NOT YET ISSUED.** Application pending. | founder, 2026-08-20 |

**Three different numbers, do not mix them up.** The **Organization Number**
(1622652, KY SoS) is the company registration number a processor or app store
asks for. The **EIN** is the federal tax id, still pending. The **CBI**
(Commonwealth Business Identifier, 10 digits, KY Department of Revenue via the
One Stop portal) is a state TAX account number that only appears once the LLET
registration happens; it is never the answer to "company registration number".

⚠ **Murmont's EIN was 35-2825718. That belongs to a DIFFERENT COMPANY.** It must
never appear on a Vergr LLC document. Any form asking for a tax ID gets "applied
for, not yet issued" until the IRS CP 575 arrives, then this table gets the real
number and `docs/processors/nextgen-precheck-answers.html` gets its row back.

**One place decides all of this: `OPERATOR` in
`src/screens/marketing/legal/legalContent.js`.** Terms, Privacy, AUP, Refunds,
Cookies, Child Safety and all eight compliance policies interpolate it, as do
the marketing footer, the Business Details block, ProSubscriptionSite, the
checkout disclosure in `CartContents.jsx` and the payout statement header in
`PayoutScreens.jsx`. **Never hardcode the company name in a component** — the
last two were hardcoded and were the only things this change could not fix by
editing one constant.

`LEGAL_VERSION` went **5 → 6**, because the counterparty to the user's contract
changed, which is the most material term there is. `TosVersionGate` therefore
shows every signed-in user a blocking re-accept modal on next load. That is
intended; do not roll it back to 5 to make the modal go away.

**Two things that did NOT change and need a founder decision:**
- **Governing law is still `jurisdiction: 'Republic of South Africa'`** with
  exclusive jurisdiction in the Johannesburg courts (ToS §27). That is a
  deliberate pre-existing choice, separate from `formationState`, so it was left
  alone. A US-formed entity electing SA law is unusual and an underwriter will
  ask about it.
- **The Play Console developer name.** The Child Safety Standards page must name
  the developer as it appears on the store listing (Google checks this). If the
  Play account is still registered to Murmont LLC, the page and the listing now
  disagree. Same for AdMob, Relay banking, PayRam and Circle: every account
  opened in Murmont's name needs the entity updated or reopened.

### Migrating the PLAY account off Murmont: the order is forced (researched 2026-08-21)

D-U-N-S for Vergr LLC arrived 2026-08-21. **EIN still pending, and it blocks everything below.**

**This is NOT a rename, it is a new payments profile.** Google cannot update the
country, the account type, or the **D-U-N-S number** on an existing payments
profile (only name and address). Murmont and Vergr are separate entities with
separate D-U-N-S numbers, so the path is: create a NEW Google payments profile
for Vergr LLC, verify it, then **link the verified profile to the EXISTING
developer account**.

✅ **No app transfer is required.** Apps, reviews, install base, Play Billing
products and subscription SKUs all stay on the same developer account. Do not
reach for the app-transfer process; it is the wrong tool here.

**The EIN gates it because a seller profile is a MERCHANT profile:**
- Tax info is a **W-9**, and Google requires LLCs to give the **federal EIN** plus
  the business name so they match what it reports to the IRS. Cannot be completed
  without the EIN.
- The payout **bank account name must MATCH the legal name on the profile**, so the
  Murmont-named Relay account cannot receive Vergr LLC payouts.

Forced order: **EIN → Vergr bank account → new payments profile → Play identity.**

⚠ **Do NOT start and stall.** A name/address mismatch against D&B raises a
"no longer verified" banner with a deadline, and Google's stated consequence is
account restriction and **removal of all apps from Google Play**. Waiting costs
nothing; a half-finished switch risks the listing.

⚠ **Do NOT rename the Murmont D-U-N-S record at D&B.** Google's "update D&B first"
flow is for ONE entity changing its own name/address. There is now a separate Vergr
D-U-N-S. Renaming Murmont's record would produce a D-U-N-S matching neither EIN.

⚠ **Play is one of five.** AdMob keeps its own payments profile; Relay, PayRam and
Circle were all opened in Murmont's name too. Changing Play changes none of them.

**EIN timing depends on one fact nobody has recorded yet:** whether the SS-4
responsible party has an SSN/ITIN. With one, the IRS online assistant issues the EIN
immediately. Without one, the online tool is unavailable and it is fax (~4 business
weeks) or mail (4-6 weeks). If it is the second case, faxing the SS-4 is the
critical-path item for the whole entity migration.

Known live inconsistency, deliberately NOT fixed early: in-app legal pages already
say Vergr LLC (the `OPERATOR` constant shipped) while the Play listing still says
Murmont, so the Child Safety Standards page and the store listing disagree. Google
does check that pair. It is a smaller risk than a half-finished payments profile,
so it gets fixed as part of the single coordinated switch.

Sources: Play Console Help 16260648 (identity details managed by a payments
profile), 13634888 (keeping account info up to date), 13634081 (view/manage account
info), payments center 7163598 (merchant tax information).

Corporate documents regenerated for the new entity (unsigned, print/date/sign
before sending): `docs/corporate/{member-register.html,
certificate-of-ownership.html, ownership-structure.svg}`.

---

## 📦 CURRENT VERSION IS **1.0.203** (`appVersion.js` + `tauri.conf.json`, verified 2026-08-23)

The 1.0.198 record below is kept for the artifact detail. **Do not read it as current.** Anything
in this file that says "not yet in a build" against 1.0.198 or 1.0.201 has been superseded by at
least one version bump since; check `src/utils/appVersion.js` before repeating a version claim.

### 1.0.198 shipped 2026-08-18 (desktop + sideload APK + Play AAB)

Announcements system complete (all seven founder decisions D1-D7). Full record:
`docs/ANNOUNCEMENTS_PLAN.md` section 19.

| Artifact | Where | Verified from the ARTIFACT |
|---|---|---|
| Desktop installer | `cdn.vergr.app/downloads/VERGR-Setup.exe` (103.7 MB) | signed, 416-char sig in the live `latest.json` |
| Sideload APK | `cdn.vergr.app/downloads/VERGR.apk` (128.3 MB) | arm64-v8a ONLY, `beforeBuildCommand: npm run build:android`, assetProtocol on with 4 scope entries, pruned assets absent |
| Play AAB | `C:UsersdamieDownloadsVERGR-1.0.198.aab` (183.1 MB) | arm64-v8a + armeabi-v7a, `build:android:store`, **REQUEST_INSTALL_PACKAGES absent**, versionName 1.0.198 |

Version fields moved together: `tauri.conf.json` 1.0.198, `appVersion.js`
APP_VERSION 1.0.198 + APP_VERSION_CODE 198, `version.json` notes. `Cargo.toml`
deliberately left at 1.0.1 (touching it invalidates the whole Rust cache).

⚠ The native builds overwrite `dist/` with the native-mode bundle. `npm run build`
was re-run before `firebase deploy --only hosting`, or the WEBSITE would have
been served the app bundle. Check this on every future native release.

---

## 🤖 PLAY CONSOLE "5 actions recommended" ON 1.0.201, TRIAGED (2026-08-21)

Play showed five advisories against the 1.0.201 bundle. Three needed no code, two
were real and are fixed in source. **NOT YET IN A BUILD:** 1.0.201 is already
uploaded, so shipping these needs a version bump (`tauri.conf.json`,
`appVersion.js` APP_VERSION + APP_VERSION_CODE, `version.json`) and a new AAB.

| Advisory | Verdict |
|---|---|
| Edge-to-edge may not display for all users | **Already correct, no action.** `MainActivity.kt:103` calls `enableEdgeToEdge()` before `super.onCreate`, `index.html:174` sets `viewport-fit=cover`, and the web layer consumes `env(safe-area-inset-*)` throughout. Play cannot statically prove inset handling in a WebView app, so it advises every SDK 35+ app. |
| Deprecated edge-to-edge APIs | **Not ours, not fixable, harmless.** All six call sites are library code: `androidx.activity.o.b/p.b/r.b` are the obfuscated `EdgeToEdgeApi*` classes INSIDE `enableEdgeToEdge()` (they set `statusBarColor` for API 24-34 back-compat), plus MaterialDatePicker and Huawei's `BridgeActivity`. Checked the androidx.activity release notes through **1.13.0**: no version stops calling them, so upgrading does nothing. On Android 15+ these are no-ops, not crashes. Our own `themes.xml` also sets `android:statusBarColor`/`navigationBarColor`, deliberately kept because minSdk is 24 and they still do work below API 35. |
| Resizability / orientation restrictions | **REAL, ours, fixed.** See the long comment now in `AndroidManifest.xml`. |
| Bitmap image optimization | **REAL, ours, fixed.** See below. |
| R8 optimization | **Half fixed.** `isShrinkResources = true` added. **AGP 9.0 deliberately NOT taken**, see below. |

### Orientation: opt-out taken, with an expiry date

`ScannerActivity` and `ArCameraActivity` are `screenOrientation="portrait"` and have
no landscape layout. Targeting SDK 36 means that attribute is **ignored on any
display >= 600dp smallest width** (tablets, unfolded foldables), so today a tablet
user rotating either screen gets a portrait UI rendered sideways, and because
neither activity declared `configChanges`, the activity was also destroyed and
recreated mid-capture.

Both now carry Google's own opt-out property
`android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY = true`, plus
`configChanges="screenSize|screenLayout|smallestScreenSize|keyboardHidden"`.

⚠ **`orientation` is deliberately absent from `configChanges`**, because claiming to
handle a rotation we have no layout for is worse than being recreated.
⚠ **The opt-out DIES AT targetSdk 37.** A real landscape pass on those two capture
screens is required before that bump. `LifecycleCameraController` + a MATCH_PARENT
`PreviewView` already re-lay out on a size change, so the work is layout, not camera.
Huawei's `BridgeActivity` (`screenOrientation="BEHIND"`) is third-party and left
alone; overriding a vendor bridge activity's orientation is not worth the risk.

### Bitmap decode was an OOM waiting to happen (fixed)

`VergrMessagingService` called `BitmapFactory.decodeStream(input)` with **no
Options** on both the notification photo and the sender avatar. That allocates at
FULL source resolution before any downscale runs, so a 4000x3000 CDN photo was a
48MB ARGB_8888 allocation **inside a background FCM service**, the smallest heap
the app ever gets. The avatar path was worse: it circle-cropped and PNG-encoded at
full resolution (two 16MB bitmaps plus a multi-megabyte lossless PNG in cache) for
something the OS draws at 64dp.

Now: `downloadToFile()` streams to a temp file, `decodeBounded()` does the canonical
two-pass `inJustDecodeBounds` + `inSampleSize` decode (`PHOTO_MAX_DIM` 1024,
`AVATAR_MAX_DIM` 512), and `downscale`/`circleCrop` recycle their intermediates.
**No image library was added.** Play suggests Coil/Glide; that is a dependency and
APK weight for two call sites, and the manual two-pass decode is the same fix.

### R8: resource shrinking yes, AGP 9 no

`isShrinkResources = true` is safe here **because nothing resolves a resource by
name at runtime** (`getIdentifier` appears nowhere in the Kotlin, verified). The
win is `com.google.android.material`, which ships every component's resources while
this app uses it for one theme parent and instantiates no Material widgets. Tauri's
web bundle lives in `assets/`, which resource shrinking does not touch.

**AGP 9.0 was declined, not forgotten.** We are on AGP 8.11.0 / Gradle 8.14.3 /
Kotlin **1.9.25**, and that Kotlin pin is load-bearing: `build.gradle.kts` documents
that billing-ktx and newer core-splashscreen ship Kotlin 2.x metadata which fails
this module outright. AGP 9 also needs Gradle 9.x, which would drag in the
`buildSrc` Rust plugin and the Tauri subprojects. That is a release-breaking
migration for a marginal optimisation gain. Revisit when the Tauri Android template
supports it.

Kotlin changes compile-verified with
`./gradlew :app:compileUniversalReleaseKotlin` (ANDROID_HOME=C:\Android\sdk).
Useful fact: **the Rust build is wired into `merge*JniLibFolders`, NOT into Kotlin
compilation** (`buildSrc/.../RustPlugin.kt:60,78`), so that task is a ~40s syntax
check and does not trigger a 20-minute cargo build.

---
## 💳 LITE / PRO AUDITED AND MADE TRUE (2026-08-19, SHIPPED + DEPLOYED)

Driver: the founder was entering the subscriptions into Google Play and needed
the advertised benefits confirmed. Every Lite and Pro claim was traced to the
code that enforces it. **Most of Pro was not real.** Source of truth for the
plans is `src/utils/tierSystem.js`, now annotated line by line.

**Play Console product ids are NOT free choice** (`functions/playBilling.js:67`):
`sub_lite` → Lite $4.99, `sub_pro` → Pro $9.99. Create them as SUBSCRIPTIONS
with one monthly base plan each. Redemption, acknowledge-before-grant,
account binding and the daily reconcile were already correct.

### Claims DELETED because nothing gated them (founder decision: they stay free)
Squad creation, voice messages, video messages, post boosts, custom banners,
paid streams, **co-streaming** (founder: it drives tips on live streams, gating
it costs revenue). All are now `true` for every tier in `TIER_FEATURES` and are
gone from the Lite/Pro bullets, the comparison table, and the help centre.
`MAX_SQUAD_OWN` is a flat 1 for everyone and squad `maxMembers` a flat 100.

### Claims DELETED because nothing implemented them
"Private streaming, IP masked" (`streaming.js` returns `privateTurn`, no client
ever read it) and "priority support + early access".

### Comparison-table rows deleted (limits that existed only in that file)
mediaPerDay, maxShortSeconds, maxClipMinutes, streamHoursPerMonth,
maxPinnedChats, draftsLimit. **Zero consumers each.** Do not re-add a tier flag
without a caller.

### Claims KEPT and BUILT this session
| Claim | What was actually wrong, and the fix |
|---|---|
| Pro 4K photos | `uploadPostMedia` hardcoded `'free'` + a fixed 1600px preset, so every plan got the same photo. New `PRESETS.post4k` (3840px) + `postPresetForTier()`; the helper now resolves the caller's plan itself, so all 9 callsites got it. |
| Pro 90-day replays | **Was completely dead** and did not need box 2. See below. |
| Pro animated avatar | `uploadAvatar` canvas-encoded JPEG, which keeps frame one. Pro GIF/WebP/APNG under 8MB now passes through uncompressed. |
| Pro badge | `profileBadge` was a flag nothing rendered. New `src/components/PlanBadge.jsx`, shown next to the handle on the public profile, suppressed on a Vanguard persona. |
| Pro advanced analytics | Flag with zero consumers. Now three real things in `MonthlyAnalyticsScreen`: follower online-times (via the existing `getAudienceActivity`, with its honest not-enough-data state), a 12-month window vs Lite's 90 days, and every post in the period in one sortable table. |
| Pro custom vergr.me domain | UI said "Contact support". Now self-serve, see below. |

### ⚠ PRO REPLAYS: box 2 is NOT required, and this corrects two stale claims
`vodArchive.js` was pointed at `archive.vergr.app`, which returns **503**, and
`dispatchStreamVodArchive` had **never been deployed**. But a finished broadcast
is ALREADY a playable VOD on R2: vergr-ingest writes `#EXT-X-ENDLIST` and
r2-sync only ever copies. The only thing killing replays was
`streamingCleanup.js` deleting `streams/<key>/*` at 24h.

So a replay is a **retention decision, not a rendering job**. Now: the dispatcher
stamps the manifest and `streamingCleanup` holds those objects until
`vodExpiresAt` (`replayHeldKeys`, keyed on `vodKind === 'hls'`). Zero ffmpeg,
zero new spend. The remux path is kept behind `app_config/general.streamVodRemux`
for when a box exists; **do not flip it on without checking the box answers.**

**OBS is covered too.** nginx-rtmp's playlist is a sliding 18s window, so
`buildRtmpVodManifest()` rebuilds a VOD playlist from the R2 object listing
(sorted numerically, EXTINF = duration / segment count, since fragments are
uniform by construction). `ARCHIVABLE_INGEST` now includes `rtmp`.

Two corrections to this file's own claims, both verified on the box:
- **`/opt/vergr-vod-archive` and ffmpeg are BOTH present on box 1.** The Box 2
  section saying archiving lived only on box 2 is wrong. The unit is `inactive`
  and `disabled`, not absent.
- Live nginx is `hls_fragment 1s`, `hls_playlist_length 18s`, `hls_nested on`.

Also fixed in passing: `InlineVideoPlayer` now lazy-loads hls.js for `.m3u8`
sources (it is a plain `<video>`, so an HLS replay would have shown a black
frame everywhere except Safari), and `isRestricted()` is one shared helper that
now includes `access.mode === 'paid'` — a paid stream's replay was being
published to the public `archiveVodUrl`.

### ❌ CUSTOM DOMAINS: REMOVED AS A FEATURE 2026-08-20 (founder decision)

**Cloudflare for SaaS is NOT available on this account.** Queried live with a
real token scoped to the vergr.app zone:

```
GET /zones/{id}/custom_hostnames/fallback_origin
  → 1456 "Access to configure this resource has not been granted for this
     zone. This feature is available with SSL for SaaS."
GET /zones/{id}/custom_hostnames
  → 1404 "No quota has been allocated for this zone or for this account...
     contact our sales team" (Enterprise)
```

⚠ **Cloudflare's public plans page says every tier including Free gets 100
custom hostnames. That is NOT true for this account.** I quoted that page as
fact before testing it, which is the second time in one session I asserted a
docs figure without checking it against the real thing. Test the API, not the
pricing table.

Also learned while checking: **`api.vergr.app` is NOT a spare hostname.** It is
the live geo-blocking endpoint (`src/utils/geoBlocks.js:41` →
`https://api.vergr.app/getRegionStatus`, live since 2026-07-28) and its
`AAAA 100::` record is a Worker binding, not a leftover. Do not reuse it.

**What was removed:** the Pro bullet, the comparison row, the vergr.me settings
card, `CustomDomainSite` + the host gate in `AppRouter`, the `vergrme_domains`
Firestore rule, the boot guard in `main.jsx`, `infra/vergr-custom-domains/`, and
ten copy references across the help centre and marketing. The three callables
are **deleted from the project**, `functions/vergrMeDomains.js` is on disk but
is deliberately NOT required by `index.js`, and both `CLOUDFLARE_*` secrets are
destroyed.

**If it is ever revived** it needs either Cloudflare Enterprise, or the Firebase
Hosting custom-domain API instead (which sidesteps the Host-header problem
entirely because Firebase would own the domain, but caps at 20 subdomains per
apex due to cert minting limits). Do not re-add the claim to any plan copy until
a `POST /zones/{id}/custom_hostnames` actually succeeds.

<details><summary>Superseded: the build that was done before this was cancelled</summary>
`functions/vergrMeDomains.js` (Cloudflare for SaaS custom hostnames) +
`CustomDomainPanel` in `SettingsPanel.jsx` + `vergrme_domains/{hostname}`
(public read, callable write) + host resolution in `AppRouter`'s `RootRoute`.
Cost checked, not assumed: **Cloudflare for SaaS is on the FREE plan, 100
hostnames included, then $0.10/hostname/month.**

**Both secrets exist holding the literal string `unset`**, which the code treats
as absent, so the callables deploy and the UI shows "being switched on". To go
live there is NO code change and NO redeploy, just:
```
firebase functions:secrets:set CLOUDFLARE_API_TOKEN        # SSL and Certificates: Edit
firebase functions:secrets:set CLOUDFLARE_ZONE_ID          # the vergr.app zone id
```
Then enable Cloudflare for SaaS on the zone and set the fallback origin.

</details>

### Other real bugs found while auditing
- The create screens rendered literal **"undefinedp"** and **"undefinedMB"**:
  four screens read `tierConfig.videoMaxHeight` / `imageMaxDim` /
  `maxFileUploadMB`, none of which existed on `TIERS`.
- **`commissionForVP` has ZERO callers.** The 30%→15% VP ladder charges nothing.
  The help article `do-paid-plans-change-the-fees-i-pay` stated it as fact and
  contradicted its own summary; rewritten. The only real rate is the revenue
  share, 50%→80% by lifetime gross earnings.
- `what-does-each-plan-include` claimed paid plans reach a better revenue share
  sooner. **False** and against the locked rule. Rewritten.
- Euro prices (€4.99/€9.99) in four help articles and the animated-emoji upsell,
  where the charge is USD. Fixed.
- `adminSubscriptions.js` plan seeds still advertised "Tournaments to 256
  players" and co-streaming.

### ⚠ THREE KILL SWITCHES WERE INERT (found + wired 2026-08-19)

`payoutsPaused`, `conversionsPaused` and `tipsPaused` are offered as toggles on
**both** `/admin/config` and `/admin/economy`, are in the `adminConfig.js`
write allowlist, and were **read by nothing**. Flipping "Pause creator payouts"
did not pause payouts. Flipping "Pause Tipping" did not stop tips. A safety
control that is trusted and does nothing is worse than no control.

Now enforced: `payoutsPaused` in `creatorPayouts.runCreatorPayouts` (before
`buildRunPlan`, records a `blocked` run so the reason is visible),
`tipsPaused` in `sendTip`, `conversionsPaused` in `coinLedger.settleEarnedShare`
(defers, does not discard — the settlement marker is only written on success,
so clearing the switch lets the same sourceId accrue normally).

⚠ **The accrual gate lives in `coinLedger.js`, which is bundled into every
function that requires it.** Redeploying one caller does NOT update the others.
The accrual entry points that had to be redeployed together: `sendTip`,
`purchaseAccess`, `purchaseEventTicket`, `purchaseSeasonPass`,
`subscribeMembership`, `admobSsvCallback`, `cronDaily`
(`renewMemberSubscriptions`). Add any new accrual surface to that list.
`creditReferralPurchaseBonus` is an internal helper, NOT a deployed function —
passing it to `--only` aborts the whole deploy.

The two admin screens also **disagreed about what the same flag meant**:
`/admin/config` called `conversionsPaused` "Pause Coin → Gem Conversions"
(a deleted feature) while `/admin/economy` correctly calls it "Pause
revenue-share accrual". An operator reading the first would have halted creator
earnings thinking they were stopping something dead. Both now match.

### ⚠ "Commission" copy was still live on five screens (fixed 2026-08-19)

`commissionForVP` / `COMMISSION_RATES` (30%→15% by VP) **charges nothing** — no
caller anywhere debits it. But the COPY was still live and telling users they
paid it: `BuyCoinsScreen` ("Higher VP = lower commission when you convert coins
→ gems"), `VanguardMeScreen` (x2), `VanguardInvitationScreen`,
`VanguardHandbookScreen`, `LevelUpCelebration`, `VanguardStubs`. All described
gems, conversion and withdrawals, which are deleted, and the numbers did not
even agree (5–30% in the Vanguard screens vs 15–30% in the constant).

**Grepping for the FUNCTION name is not enough. Grep for the WORD in copy.**
Finding zero callers and calling it dead is how five live screens kept selling a
model the business does not have. The constants now carry a do-not-display
warning; the stale "still imported by VPRanksScreen / wallet v2 / marketing rate
tables" note on them was itself wrong and was acting as cover.

Also corrected: the coin floor rationale in `storePricing.js` and `vpSystem.js`
was derived from "Immortal 15% commission, then the 2% withdrawal spread" and
coins converting to gems. **The floor number is UNCHANGED** (that is a founder
decision); only the reasoning was rewritten so nobody re-derives a price from a
dead model.

---

---

## 🎖 VP LADDER, PROFILE COSMETICS + ENTRY RIBBONS — VERIFIED END TO END (2026-08-24, SHIPPED + DEPLOYED)

Run `node scripts/vp-mirror-check.mjs` before touching any of this. 68 assertions,
`--list` prints every one so a green run can be shown to be real rather than vacuous.
It fails the build if a client promise and a server payment ever drift apart.

### Profile THEMES were reverted to plain gradients, and the reason matters

The multi-surface theme system (nameplates, collections, paper/carved treatments,
`ThemeLayer.jsx`, `rankCollections.js`) is **GONE**, on founder instruction after
it consumed a full session. **A theme has to restyle EVERY surface** (left nav,
right rail, post cards, and hundreds of inline colours), and every surface missed
looked like a bug rather than a theme. That is a whole-app design system, not a
background picker. Do not attempt it again without that being the explicit scope.

What a theme IS now: **one gradient, plus the user's accent colour.** Nothing else.

⚠ **Two defects were found by MEASURING the live page, both of which made themes
do literally nothing. Neither was visible from reading the source.**

1. `THEME_TOKENS` in `profileThemes.js` only ever had `default` and `deep`, so
   **six of the eight themes fell back to `default`** and painted identically to
   Standard on the owner's own profile. The swatch on `/prestige` previewed a
   gradient the profile never drew. `THEME_TOKENS` is now ONE shared surface set
   for every theme, so there is no second place for a theme to half-apply.
2. The header block and an uploaded banner `<img>` occupy the **identical rect**
   (measured x241 y0 1049x220, `object-fit:cover`, `opacity:1`), so a gradient
   drawn on the header paints **zero visible pixels** for anyone with a banner.
   And every gradient anchored its light at the TOP (`at 18% 0%`, `at -5% 0%`),
   which is exactly the occluded part.

The fix is `themeSeamStyle(themeId)` in `profileThemes.js`: a per-theme signature
glow drawn as a band **directly below the banner, anchored at y=0 so it rises from
the seam and falls downward**. It never touches the user's art and is visible with
or without a banner. Wired identically in `ProfileScreen`, `PublicProfileScreen`
and `NativeProfileScreens` (native banner is 176px, not 220px).

⚠ `.vg-profile { position: relative }` in `surface.css` is **load-bearing** — the
band is absolutely positioned against it. Without it the band escapes to the
nearest positioned ancestor and paints across the whole app shell, which is how
an earlier pass leaked a profile treatment onto the left nav.

`PublicProfileScreen` also lost `backgroundAttachment: 'fixed'`, which was pinning
the theme behind the whole page and reading as wallpaper with content sliding
over it.

Also fixed while measuring: the profile tab row used `border-b`, a hard 1px rule
running the full 1049px content width and terminating at full strength against
the nav's own 0.8px right border. Two hard rules meeting at a bare corner is the
"cage edge" this file already warns about. It is now a gradient rule that ramps
in and out at both ends.

### The 12 "How to earn VP" rows all have a real server writer (each traced)

| Advertised | Pays it |
|---|---|
| Host a live event +150 | `creatorQuests.js:93` `creator_host_event` |
| Gift / tip +1 per 25c | `index.js:3709` `GIFT_COINS_PER_VP` |
| Go live +30 | `engagementVp` ← `index.js:2889` |
| Complete a quest +20 | `creatorQuests.js:143` |
| Buy coins +25 | `payram.js:506`, `playBilling.js:226` |
| Per hour streamed +20 | `engagementVp` `stream_hour` |
| Create a post +15 | `engagementVp` ← `index.js:3103` |
| 5-day login streak +50 | `index.js:1178` |
| Boost a post +10 | `walletActions` `purchaseBoost` |
| Daily login +10 | `walletActions.js:86` |
| Get a comment +5 | `engagementVp` ← `index.js:3040` |
| Get a like +2 | `index.js:1817` |

Rewards verified live: rank VP bonus (+0.5%/level, cap 1.5x) mirrored in BOTH
`engagementVp.js:71` and `walletActions.js:51`; boost tokens granted at
[5,14,26,41,50,76,93] by `vpLevel.js` counting every level CROSSED (not just the
one landed on) and spent in `streaming.js:366` with a **token** refund at :587 (a
coin refund would mint coins); `vp_level_up` notification written by
`vpLevel.js:104` and push-allowlisted at `index.js:2121`.

`LevelUpCelebration` smoke-tested on the live site by rewinding
`localStorage['vergr.lastVpLevel.<uid>']`: it fires and reads the real ladder
(lists what the level granted, names the next unlock). Marker restored after.

### Entry ribbons: art wired, and the name size is now MEASURED

Founder art for all 11 ranks built to `/brand/entry/{rankId}.webp` + `@2x` by
`scripts/build-entry-banners.mjs` (sources 4128x1024 JPEG ~2-4MB each → 258KB
total for 22 files). `/brand/**` already has cache headers in `firebase.json`;
check that before adding any new `public/` directory, because the catch-all `**`
rule is `no-store`.

⚠ **The username size took THREE attempts. Do not "improve" it by eye.**
- A hand-tuned step ladder by character count truncated `nova_kill` to `NOVA_...`
  with visible space to spare.
- Replacing it with one measured constant (1.017 x fontSize per character) made
  MORE names truncate, because 1.017 was the NARROWEST sample, not the average.
- Measured spread of Syne 800 italic uppercase, per char per unit font-size:
  `nova_kill` 1.017 · `Sable` 1.072 · `ALEX` 1.086 · `DrLupo` 1.197 ·
  `Vergr` 1.211 · `xQcOW` 1.368. **A 34% spread — character count does not
  predict width**, so no constant can ever be right.

`nameSizeFor(name, w, h)` in `rankBanners.js` now measures the actual string with
canvas `measureText`, which costs nothing and is exact. `scripts/entry-ribbon-preview.mjs`
renders all 11 ribbons at the real 280x70 against the real art and re-measures in
the browser, because node has no canvas and would otherwise show the fallback.

---

### 🚀 STREAM BOOST WAS A BADGE. NOW IT IS REAL (2026-08-27, SHIPPED + DEPLOYED)

⚠ **UNTIL THIS DATE, THE 50-COIN STREAM BOOST BOUGHT NOTHING.** `boosted` was
read only to draw a badge; all four live lists queried `orderBy(viewerCount)`
directly; the 1.5x multiplier sat in `getLiveDiscoveryFeed`, **a deployed
callable nothing in `src/` ever called**. The help centre said it pushed your
stream in discovery. Add it to the inert-controls list beside the three kill
switches. `src/utils/streamBoost.js` + `functions/streamBoost.js`.

**Three tiers (50/150/500 coins → 1.5x/2.5x/4x, 15/30/60 min).** An earned VP
token spends as a boost on ANY stream, including someone else's — that is the
point of the founder's change, so a non-broadcaster still has a use for the
reward. Stacking is capped at **3.0x** and is **additive on the excess**, never
multiplicative. Every boost expires and the countdown is visible.

⚠ **THE DURATIONS AND THE CEILING ARE MY NUMBERS, NOT THE FOUNDER'S.** Everything
else in the tier table came from him. They are one-line constants.

⚠ **A LIST SURFACE MUST RUN `rankStreams()` AND FIRE THE SECOND BOOST QUERY.**
Ordering the top-24-by-viewers cannot surface a boosted stream with three
viewers, which is exactly why the old boost was worthless. `boostExpiresAt` is a
single-field inequality — no composite index. `LiveUsersContext` is deliberately
NOT wired: it loads all 300 live streams to light up avatars, so ranking there
means nothing.

⚠ **`inferStreamTopics` IS THE ONE DEFINITION** of what a stream is about,
extracted out of `captureStreamInterest`. Interest matching costs zero reads —
affinity is device-local in `feedPrefs`. Do not write a second copy.

⚠ **BOOST TOKENS ARE NOW 11, ONE PER RANK BAND** (was 7, with two in Elite and
none in Challenger/Champion/Veteran/Mythic). Founder-authorised economy change.
Mirrored in `functions/vpLevel.js`; the guard fails on drift.

### 📊 THE LADDER WAS HALF EMPTY — 44/100 → 70/100 (2026-08-27, SHIPPED + DEPLOYED)

**56 of 100 levels gave nothing but the +0.5% VP earn rate.** Full record and the
remaining options: `docs/effects/26-LADDER-COVERAGE.md`.

⚠ **`assertNoDeadLevels` IS NOT COVERAGE.** It proves every level has a ROW, and
every level always did, because every level carries a `vprate_` row. It was green
the entire time the ladder was half hollow. Do not cite it as evidence the ladder
is populated; count rows that are NOT `vprate_`.

⚠ **THE CAUSE WAS 32 SHIPPED ITEMS GRANTED BY 3 ROWS** — 18 typefaces at L3, 8
chat themes at L23, 6 typing styles at L32 — while `PROFILE_ACCENTS` and
`PROFILE_THEMES` were drip-fed one per level from the start. The pattern existed
and was applied inconsistently. Fixing it filled 26 levels with **zero new
content**. **Adding a reward pool means assigning a level to every ITEM, never to
the pool**; `npm run check` now fails if two items share a level.

⚠ **`nameFontFor` NEVER CHECKED THE LEVEL.** A bare `fontById()` lookup, harmless
while one row granted all 18 faces, wrong the moment they were spread. Now
mirrors `typingStyleFor`: firestore.rules enforces the floor and the enum, the
resolver enforces the per-item level at render time.

⚠ **THE RE-SPREAD WINDOW IS CLOSED AFTER LAUNCH.** Spreading a pool REMOVES items
from anyone already past the new levels. Free today (test data, nobody above L2);
after real users it needs a grandfather clause.

⚠ **L94-99 IS STILL SIX HOLLOW LEVELS AND 66,000 VP**, right before L100 — the
longest dry stretch, at the worst place. Nothing in the existing pools is an
Ascendant-worthy reward. **More boost tokens would fix it and is an ECONOMY
change, so it is a founder decision, not a session decision.**

### ⚡ VP BONUS PACKS — BUILT, SHIPPED + DEPLOYED (2026-08-28)

Nine timed VP multipliers. `src/utils/vpBonuses.js` is the source of truth,
`functions/vpBonuses.js` is the mirror that charges for them, shop at
`/prestige` → **VP bonuses** tab (`src/components/prestige/BonusShop.jsx`).

⚠ **COINS ONLY. THERE IS NO VP PRICE AND NONE MAY BE ADDED.** Founder,
2026-08-28. It is not only a preference: **a VP-priced VP multiplier is an
infinite loop.** Price it above what it returns and nobody buys it; below, and
VP inflates without limit. There is no price that works. `vp-mirror-check.mjs`
asserts no `vp:` price exists on either side.

⚠ **PACKS ARE ALSO LADDER REWARDS, AND THAT IS WHAT FIXED THE FILLED LADDER.**
`BONUS_LADDER_LEVELS` hands 14 levels a pack instead of a boost token, so
**L93-99 is no longer seven identical rows** and no two consecutive levels grant
the same thing anywhere on the ladder. Boost tokens 37 levels → 23 levels,
47 tokens total.

⚠ **THE BONUS LIVES ON `users/{uid}.vpBonuses`, NOT THE WALLET.** Both VP credit
paths already `tx.get(userRef)` for the plan tier and `vpLevel` and neither ever
READS the wallet, so the multiplier **costs zero extra reads**. Expiry is
evaluated at read time; there is no cron and none is wanted.

⚠ **SCOPED PACKS TAKE THE ACTION KEY.** `planMultiplier(uid, action)` gained a
second argument for exactly this: a Watcher Surge must not pay on posting. A
call site that forgets it silently turns a focused pack into a blanket one.

⚠ **`vpBonuses.js` IS BUNDLED INTO EVERY FUNCTION THAT REQUIRES THE VP PATHS.**
Redeploying one caller does NOT update the others — same trap as `coinLedger.js`.
The set: `purchaseVpBonus`, `syncVpLevel`, `awardActionVp`, `recordAdWatch`,
`purchaseBoost`, `contributeToSquad`, `onStreamWentLive`, `onNewComment`,
`onPostCreatedAwardVp`, `endStreamSession`.

⚠ **`vpBonuses` IS SERVER-ONLY IN firestore.rules.** Owner-writable would let
anyone stamp themselves a 3x with no expiry, which is a one-line route to
Immortal and to every reward `vpLevel` gates.

⚠ Stacking is **additive on the excess, ceiling 3.0** — deliberately the same
rule `boostReach()` uses, so the product has ONE stacking model. It multiplies
on top of plan (Pro 2x) and rank, so 3.0 already reaches 6x base.

⚠ **NOT BUILT and each is a DIFFERENT mechanic, not another table row:** Open Bar
(daily-cap lift), Streak Shield (streak counters), Squad Surge (treasury +
fan-out). The L100 answer is still unanswered.

✅ **PLACEHOLDER ART SHIPPED FOR ALL 16 STORE CARDS (2026-08-28).** Generator:
`scripts/build-store-art.mjs`, re-runnable, writes 288px + `@2x` to
`public/brand/boosts/` and `public/brand/bonuses/`. Founder: *"at least make it
look good enough so we can replace it later."* **The filenames are the contract:
drop a real render at the same path and it takes over with no code change**,
because `boostArt()` / `bonusArt()` resolve by art id.

- **The 9 VP packs use the REAL VP icon** (`/brand/vp-gem.webp`), on founder
  instruction, so they look finished rather than placeholder. Only the bloom
  intensity varies, scaled by multiplier, so a 3x reads hotter than a 1.5x
  without inventing nine arts.
- **The 7 boosts use the SVGs already in `scripts/chat-pattern-icons`** (Phosphor
  MIT + game-icons CC BY, already credited on `/platform/credits`), so there is
  no new dependency and **no new licence obligation**. Rocket, chats, sparkle,
  shield, broadcast, star, crown.

⚠ **THE FIRST RENDER WAS EXACTLY THE REJECTED BADGE LOOK** — flat pastel glyphs
on faint circles — and it took rendering a contact sheet to see it. Two causes:
a 50% white specular over the top half (**semi-transparent white over a saturated
fill averages toward grey**, the same lesson `.vg-bloom` already records), and a
near-invisible white plate that gave the glyph nothing to separate it from the
card. Depth now comes from the RAMP RANGE plus a DARK WELL behind, with a rim lit
from the upper left. **Do not put a white overlay back on these.**

⚠ **`density` SCALES AN SVG BUT NOT WHAT YOU COMPOSITE ONTO IT.** Passing
`density: 384` to a 288px background rasterised it to 1536px while the gem stayed
224px, so every VP pack rendered a speck floating in a violet cloud. Rasterise
the canvas at the size you want, then size the overlay against THAT.

⚠⚠ **THE ART URLS CARRY `ART_V` AND IT IS LOAD-BEARING. BUMP IT WHENEVER THE ART
CHANGES.** `/brand/**` has 7-day browser and 30-day CDN cache headers, and
Firebase's SPA rewrite answers a MISSING asset with `index.html` at **HTTP 200**,
not a 404. So every session that opened the shop BEFORE the art existed cached an
HTML body at the image URL, and `PackArt`'s `onError` hid the image for the life
of that cache. Measured live 2026-08-28 right after deploying the art: **9 of 9
bonus images `naturalWidth: 0`, `visibility: hidden`**, while the identical URL
with a cache-buster loaded at 288. The files were correct on disk and on the CDN
the whole time.

**The same trap fires on REPLACEMENT**, which is the part that matters later: drop
a founder render at the same path and nobody sees it for up to 30 days. `ART_V`
in `src/utils/boosts.js` and `src/utils/vpBonuses.js` is the fix; both were
verified after the bump at **9/9 and 7/7 loaded, 0 hidden**.

This is [[reference-spa-rewrite-masks-404]] in a new place. A contact sheet of the
generated files proves nothing about what the browser has cached.


⚠ Quality 80, ~24KB at 1x, against 19KB for the coin pack art beside it.
`/brand/**` already carries cache headers, so no `firebase.json` change was
needed. Check that before adding any new directory under `public/`.



### 👁 PUBLIC POST VIEW COUNTS — BUILT ON RTDB, NOT FIRESTORE (2026-08-28, SHIPPED + DEPLOYED)

`incrementViewCount()` had ZERO callers since the day it was written, so
`viewCount` was always 0 and the PostCard display code never rendered. The reason
it was never built is real: **Firestore bills per WRITE** (20k/day free), so one
write per view means a single popular post spends the whole platform budget.

⚠ **THE ANSWER IS THE REALTIME DATABASE, WHICH IS NOT BILLED PER OPERATION.**
RTDB charges storage + bandwidth only. It was ALREADY in the stack (presence uses
it), so no new connection is opened.

```
client (batched ~20s) -> recordPostViews callable -> RTDB /postViewDeltas/{postId}
cronEvery6h           -> drain deltas            -> ONE Firestore write per post
```

**Measured, not estimated: 25.2 bytes per post in RTDB.** Cost at 100k views/day
is **$0.54/mo** vs **$2.16/mo** writing straight to Firestore; at 1M views/day
**$4.86 vs $26.46**. The saving scales with VIEWS PER POST — a post seen 10,000
times costs 4 writes/day instead of 10,000.

⚠ **ACCURACY IS EXACT, ONLY FRESHNESS LAGS.** RTDB holds the true per-post count
and is incremented immediately; the 6h drain just moves the accumulated total.
The Firestore copy exists ONLY so Creator Studio can SORT by viewCount. To show a
live number, read RTDB directly — do not add Firestore writes for freshness.

⚠ **THE ADMIN SDK BYPASSES RTDB RULES**, which is why the write is a callable.
That also means `database.rules.json` needs no change — and it must not get one
casually: there is NO rules file checked in, so deploying one would REPLACE
whatever presence depends on.

⚠ **THE DRAIN SUBTRACTS WHAT IT APPLIED** instead of deleting the key, so a view
arriving mid-drain is counted on the next run rather than thrown away. It is
piggybacked on the EXISTING `cronEvery6h`; a new Cloud Scheduler job is one of the
few things that actually costs money here.

⚠ **REUSES THE EXISTING OBSERVER.** `useImpressionTracker` already fired at >=50%
visible for 1s on every post card. A second IntersectionObserver would be
duplicated work that could drift.

⚠ **A HIDDEN TAB FIRES NO INTERSECTIONOBSERVER CALLBACKS**, so this cannot be
tested through CDP unless the Chrome window is actually visible on screen. A
minimised window reports `visibilityState: 'hidden'` even when `hasFocus()` is
true. Verified working once the founder scrolled with the window foregrounded:
six posts, one view each.

⚠ **HETZNER IS THE ALTERNATIVE IF COSTS EVER BITE.** The box is already paid for,
so a counter service there is genuinely zero marginal cost. Against it: box 1 is
NOT backed up, it is a single point of failure, and it is another service to
deploy and watch. Swapping is contained — only the callable's implementation
changes.

### 📡 BOOST DELIVERY: FAIR, TARGETED, AND ON ALL SIX SURFACES (2026-08-28, SHIPPED + DEPLOYED)

Founder opened Explore, the profile he had boosted was not there, and the model
turned out to be worse than one missing surface. Plan: `docs/BOOST_DELIVERY_PLAN.md`.

⚠ **THE OLD READER DELIVERED NOTHING TO ALMOST EVERYONE.** Every surface ran
`orderBy('boostExpiresAt').limit(2)`, which is DETERMINISTIC: the two boosts
expiring soonest went to every viewer everywhere. With 1,000 boosts live, 998
people had paid and got ZERO impressions. Not an unfair split — a total failure
to deliver, getting worse the better the product does.

⚠ **I WIRED 2 OF 6 SUGGESTION SURFACES.** Same failure as the avatar orbit. The
six are HomeFeedRail, DiscoveryStrip, ExploreScreen, NativeExploreScreen,
RightSidebarPanel and OnboardingFlowScreen. **They now all call ONE
`getBoostedUsers()`**, and `vp-mirror-check` fails the build if any of them
stops calling it or hand-rolls its own boost query. Negative-tested.

⚠ **FAIRNESS IS IN THE DATA LAYOUT, NOT A COUNTER.** Each boost gets a random
`boostBucket` (0-99); a reader queries ONE random bucket. **The empty-bucket
fallback is not optional** — with three live boosts a random bucket is empty
~97% of the time and nobody would ever be shown, so an empty bucket re-runs
unsharded. Self-tuning with no threshold to remember.

⚠ **RELEVANCE IS THE ONLY TIEBREAK** (founder). Ordering by spend would make it
an ad auction. A guard asserts no spend term enters `rankBoostedForViewer`.
Ranking uses device-local affinity, so it costs **zero reads**, and it shards the
pool a second time by interest.

⚠ **A RAIL CANNOT SCALE; THE FEED CAN.** Four slots is a hard ceiling however
many people buy. `SuggestedPeopleBlock` appears every 14 posts, so inventory
grows with scroll depth. Labelled and dismissible: an unlabelled paid suggestion
in the feed is an ad pretending to be content.

⚠ **ONE WRITE PER IMPRESSION IS UNAFFORDABLE** (20k writes/day; one popular item
would spend all of them). So impressions are BATCHED (~20s, flushed on
`visibilitychange` — mobile often never fires `unload`) and **counted only while
a boost is live**. That bounds cost by boosts SOLD rather than by content volume.
Counters are server-only and clamped.

⚠ **`viewCount` WAS CLIENT-WRITABLE BY ANYONE, ON ANY POST** — it sat in the same
allowlist as the like and comment counters. Nothing displayed it, but Creator
Studio already sorted and totalled by it. Now server-only. `incrementViewCount()`
still has zero callers: **public post view counts are deliberately NOT built**,
because counting every post is the cost we cannot carry.

⚠ **THE COPY MUST NOT PROMISE A SLOT.** "Shown first" or "guaranteed placement"
cannot be kept the moment two people buy the same boost. The wording is about
REACH and about who sees it, never about position.

### 🎫 BOOSTS ARE TOKENS YOU OWN (2026-08-28, SHIPPED + DEPLOYED)

Founder: *"users can keep boosts, you should see them like tokens. I could have
10 boosts all different or multiple of the same one... and I should be able to
apply a boost to my own or anyone else's content."* The first build got all three
halves wrong: it fired at checkout, locked you to your own content, and gave you
nowhere to look.

**`src/utils/boosts.js` is now the ONE catalogue** and replaced two that had
drifted: `BOOST_COSTS` (post/profile/lfg/squad) and `BOOST_TIERS` (three stream
tiers). Mirrored in `functions/boosts.js`.

| | |
|---|---|
| Inventory | `wallets/{uid}.boosts = { [id]: count }` |
| Buy | `purchaseBoostPack({boostId, qty})` — coins in, inventory up. Applies NOTHING. |
| Apply | `applyBoost({boostId, targetId})` — inventory down, target stamped |

⚠ **NO OWNERSHIP CHECK IN `applyBoost`, AND THAT IS DELIBERATE.** You may boost
anyone. The check I added the day before belonged to the old buy-for-a-target
model and is wrong here. Do not "restore" it.

⚠ **STREAMS TAKE AN ARRAY, EVERYTHING ELSE TAKES AN EXPIRY.** `boostReach()` sums
each entry's `reach` to stack and `hasFeedRail()` matches `tier === 'mega'`, so
writing only `boostExpiresAt` on a stream would show a countdown on a stream that
was never ranked — a boost that buys a badge, exactly what this replaced.
`applyBoost` writes the same shape `boostStream` does.

⚠ **THE CATALOGUE ID AND THE STREAM TIER ID DIFFER ON PURPOSE.** `stream_boost` /
`stream_super` / `stream_mega` map to the shipped `boost` / `super` / `mega` tier
strings via `STREAM_TIER`. Renaming those would un-boost every live stream.

⚠ **LEGACY `boostTokens` IS FOLDED IN AT READ TIME, NOT MIGRATED.**
`boostInventory()` adds it to `stream_boost`, and `applyBoost` spends the typed
inventory first and the legacy counter second. No backfill job, nothing lost.

⚠ **`wallets.boosts` IS SERVER-ONLY.** Each entry is worth its coin price, so an
owner-writable map is a coin printer with extra steps.

**Entry points, all four profile views included:** post (own = a visible button
only the author sees, others = three-dot menu), profile (web own + public, native
own + public), squad page, and the live-stream gift menu.

⚠ **`BoostSheet` HAS AN `embedded` MODE** for the gift menu, which already owns a
scrim and a dismiss. Nesting a second fixed overlay gives two backdrops and two
competing click-to-close targets.

⚠ **QUICK BUY NEVER NAVIGATES.** Founder: *"if I am on a stream I won't want to
leave the stream in order to purchase more coins."* The sheet buys the boost in
place, and if you are short on coins it opens the basket over the page you are
on. **`GlobalCartDrawer` is mounted in `AppRouter`** — `CartProvider` was already
global but `CartDrawer` was trapped inside `wallet/v2/BuyScreen`, so a basket
opened anywhere else had nowhere to render. It renders nothing while closed.

### 🧾 THE BUYER'S RECEIPT WAS BLANK, AND PROFILE BOOSTS WERE UNSHARDED (2026-08-28, SHIPPED + DEPLOYED)

Four defects found by auditing the paths the previous session listed as NEVER
EXERCISED (squad boost, stream boost, buyer receipt). Three were real and all
three sat on the SAME callable, `purchaseBoost` in `functions/walletActions.js`,
which is the one that sells the **Profile Boost, the only boost sold from the
shop tab.** Squad-boost ownership (`ownerId`) and the whole stream-boost path
(`STREAM_TIER`, `boostReach`, the array shape) were checked and are correct.

| Defect | Effect |
|---|---|
| `purchaseBoost` never wrote `boostBucket` | Only `applyBoost` stamped one. A users doc MISSING that field matches NO bucket query, so every profile boost bought from the shop survived purely on the empty-bucket fallback. That fallback stops firing once buckets are non-empty, so the boost would have gone dark **exactly when the platform finally had an audience.** |
| `purchaseBoost` wrote `type`, the receipt reads `target` + `boostId` + `startedAt` | `getMyActiveBoosts` fell back to `posts/{uid}` while the real counters sat on the USERS doc, so RUNNING NOW rendered a **blank name, 0 impressions, 0 people**, and `followersGained` never ran (it is gated on `target === 'user'`). Verion's live boost had `boostImpressions 2 / boostViews 1` that the receipt could never read. |
| 1 of 6 surfaces counts an impression | NOT A DEFECT. `SuggestedPeopleBlock` is the only caller of `recordBoostImpressions`, and the home rail, discovery strip, right sidebar, both Explore screens and onboarding deliberately do not report. See the warning below: this is a COST decision. |
| `aggregatePostViews` chunk guard used a cumulative counter | `if (posts === 0)` is the RUNNING TOTAL, so after any chunk had written, a later all-zero chunk still committed an empty batch and called `rtdb().update({})` with no paths. |

⚠⚠ **IMPRESSION COUNTING STAYS ON ONE SURFACE. I CHANGED THAT WITHOUT ASKING AND
IT WAS REVERTED THE SAME DAY.** Founder, 2026-08-28: *"the previous session did
this and its because i didnt want to increase my costs. and instead of fixing it
to make it work, you changed it without my permission which in effect will
increase my costs."*

I had moved the call into `getBoostedUsers`, the one query all six surfaces
share, on the reasoning that the plan says "the reader that already decided to
show the item also increments boostImpressions". **That reasoning was about
correctness and ignored the bill, which was not mine to spend.** The measured
effect: `boostStats` dedupes by `target:targetId` and sends ONE callable per 20s
window, so it does NOT multiply writes by six; what it multiplies is the number
of SESSIONS that report at all, from "those that scrolled to the feed block" to
"every session that opens the app". Bounded by live boosts, but real, and
growing with users.

**The receipt therefore UNDERCOUNTS impressions ON PURPOSE, and the COPY now says
so.** Founder decision 2026-08-28: keep the cheap count, relabel it honestly,
rather than pay to count everywhere. `MyBoosts.jsx` shows **feed shows** and
**feed viewers** (not "impressions" and "people"), under a qualifier naming the
surfaces that are not counted. **New followers is the headline precisely because
it is the one number that is COMPLETE**: a follow counts wherever the boost was
seen, while the other two only ever count the in-feed suggestion block. If
counting is ever made complete, delete that qualifier in the same commit.

⚠ **`followersGained` NOW RUNS FOR `purchaseBoost` ROWS TOO**, because they
finally carry `target: 'user'` and `startedAt`. It already ran for `applyBoost`
rows, so this is consistency rather than a new mechanism, but it is a real read:
one `follows` query capped at 200 docs per profile-boost row, only when the owner
opens the receipt. Lower the cap or drop the stat if that is unwanted.

⚠ **`purchaseBoost` NOW WRITES BOTH SHAPES' FIELDS, and the reader normalises.**
The normaliser (`b.boostId || b.type`, target resolved from the catalogue) is only
load-bearing for boosts that were already live at deploy time, but it is what
makes an existing buyer's receipt correct **without a data migration**, which
matters because there is no service-account key on this machine and no way to
backfill Firestore from here.

⚠ **THE GUARD I WROTE FIRST WAS USELESS AND I ONLY FOUND OUT BY NEGATIVE-TESTING
IT.** `check(read('functions/boosts.js').includes('boostBucket'))` is a substring
test over a WHOLE FILE, comments included, and it was green the entire time
`purchaseBoost` had no bucket. Its replacement then ALSO passed with the field
deleted, because `purchaseBoost`'s return statement says `boostId: boostRef.id`
twenty lines below the ledger row. The working version slices out the
`tx.set(boostRef, {...})` block and asserts inside THAT. **Assert the code, in the
right scope, and prove the guard fails before believing it passes.**

⚠ **A template literal eats regex escapes.** `` new RegExp(`\b${field}\s*:`) ``
inside a template literal is a BACKSPACE character followed by a literal `s`, so
the guard matched nothing and reported a fault that was not there. Replaced with
a plain `row.includes(field + ':')`: no escaping to get wrong, and the slice is
one object literal so `target:` cannot collide with `targetId:`.

⚠ **`_runJobs` LOGS ONLY FAILURES**, so a healthy `aggregatePostViews` was
completely silent and "ran with nothing to do" was indistinguishable from "never
ran". That ambiguity is the entire reason the drain sat unverified after
shipping. It now logs both outcomes. **A cron job nobody can observe cannot be
called verified.**

⚠ **THE 12:00 UTC RUN PROVED NOTHING**, and reading it as a failure would have
been wrong: `cronEvery6h` was redeployed at **15:45 UTC**, so the 12:00 run
executed the OLD code that had no drain in it. Check the function's update time
before concluding anything from a scheduled run.

⚠ **"ENGAGEMENT" MUST MEAN AN INTERACTION. IT WAS POINTED AT THE RENDER COUNT.**
Founder, 2026-08-28: *"how can engagement be two if we didn't engage in anyway
with the post?"* He was right and it was my error: he asked for the three stats
to read views / engagement / follows, and I mapped "engagement" onto
`boostImpressions`, which counts how many times the card was DRAWN. Showing
someone a card is an impression. Engagement is them acting on it. There was no
interaction signal in the product at all, so the label named a number that could
never mean what it said.

`boostEngagements` now counts a real interaction: opening the profile from a
boosted card, or following from it. **It costs essentially nothing by
construction** — it rides the SAME pending row and the SAME 20s flush as the
impression that must already have happened, because you cannot click a card that
was never shown. So it adds a FIELD to a write that was already going to happen,
not a new write, and clicks are orders of magnitude rarer than renders anyway.

⚠ **ONLY A BOOSTED CARD REPORTS.** An organic suggestion has no buyer owed a
number, so counting it would be a write with nothing attached to it.

⚠ `boostEngagements` is **server-only in firestore.rules** beside the other two,
and clamped hardest of the three (20, against 50): nobody legitimately clicks one
card twenty times in a twenty-second window.

⚠ **THE FOLLOWER COUNT IS GONE FROM THE RIGHT-RAIL SUGGESTION CARD**, number and
label. Founder: it is not appropriate there, it belongs on the public profile.
`{c.handle} · {compact(c.followers)}` in `HomeFeedRail.jsx` was also an
unlabelled mystery number, and on a small platform it mainly advertised that
nobody has followers yet. **Do not put a metric back on that card.**


✅ **ENGAGEMENT VERIFIED AS AN INTERACTION (2026-08-28).** Measured on @Vergr
against @Verion's live Profile Boost, all three counters zeroed first:

| step | views | engagement | shows |
|---|---|---|---|
| after reset | 0 | 0 | 0 |
| card RENDERED, not touched | 1 | **0** | 4 |
| card CLICKED | 1 | **1** | 4 |

Engagement moved only on the click, and the browser landed on
`/user/dosQs...` confirming a real profile open. Views held at 1 throughout.

⚠ **THE FIRST ATTEMPT AT THIS TEST WAS CONTAMINATED AND LOOKED LIKE A BUG.** It
read `views=0 shows=2` with an EMPTY seen-key, which is impossible under the new
code, and the temptation was to go hunting in the source. The real cause was the
test: the block rendered during the page load BEFORE the seen-key was cleared, so
`markSeen` correctly matched the previous run and counted no view, and the
already-pending 20s flush then landed AFTER the counters had been reset, carrying
its impressions onto a freshly-zeroed doc. **A batched, timer-flushed counter
cannot be tested by resetting mid-flight.** Clear storage, reload, let the
in-flight flush land, THEN reset, THEN act.


✅ **VIEWS ARE NOW DEVICES, PROVEN BY MEASUREMENT (2026-08-28).** Founder caught
the fault by arithmetic, not by reading code: a boost claimed 5 viewers on a
platform with 2 accounts. `seenThisSession` was an in-memory Set, so every page
load started a fresh session and re-counted the same person, while the comment
directly above it said a refresh must not re-count.

Now deduped in `localStorage` under `vergr.boostSeen`, keyed by target AND the
boost's `boostExpiresAt`, so a refresh cannot re-count while a NEW boost on the
same target still counts fresh. Costs nothing and only ever lowers the number.

Verified live on @Vergr against @Verion's live Profile Boost, counters zeroed
first with the new `adminResetBoostStats`:

| | views | engagement |
|---|---|---|
| after reset | 0 | 0 |
| one session, scrolled | 1 | 2 |
| **after a full page reload**, scrolled again | **1** | 4 |

Views held while engagement doubled. Under the old code views would read 2.

⚠ **THE LABELS NOW DEFINE THEMSELVES.** views = devices, once per boost run;
engagement = every showing including repeats; follows = real follows and the only
COMPLETE number, because a follow counts on every surface while the other two are
counted in the feed block alone. Founder rejected "feed shows"/"feed viewers" as
still vague. A number on a paid receipt has to say what it counts.

⚠ **`adminResetBoostStats` EXISTS BECAUSE THESE COUNTERS ARE SERVER-ONLY AND A BUG
HAD INFLATED THEM WITH NO WAY TO CORRECT IT.** It writes zeroes to
`boostImpressions`/`boostViews` and nothing else, admin-gated and audited.


✅ **THE RECEIPT IS VERIFIED LIVE ON @Verion (2026-08-28).** Three running boosts
render (two Post Boosts, one Profile Boost). The Profile Boost card reads
**0 new followers / 10 feed shows / 5 feed viewers**, with the pack NAME resolved
and the qualifier line beneath it. Before the fix that same card rendered a blank
name, 0, 0 and no followers row at all, because the reader fell back to
`posts/{uid}` and `followersGained` is gated on `target === 'user'`. So all three
halves are confirmed: the normaliser, the counters coming off the users doc, and
the followers query actually running. No ErrorBoundary.

✅ **THE DRAIN IS VERIFIED END TO END.** The 18:00 UTC run logged
`[aggregatePostViews] drained 10 views across 8 posts`, with no failure line
beside it. `_runJobs` logs failures, and the log statement sits after every
`batch.commit()`, so the Firestore writes landed. Post view counting is proven
across the whole path: client batches (~20s) to `recordPostViews`, RTDB holds the
hot counter, `cronEvery6h` rolls it into `posts.viewCount` four times a day. This
was only observable because the job was given a log line first; before that a
healthy run and a run that never happened looked identical.

`eslint no-undef` caught a real one again in transit: the normaliser called
`tsMs`, which is a `const` declared **inside a different function** in the same
file. Third instance of that exact shape (`EditProfileScreen`,
`NativeProfileScreens`, now `firestore.js`).

`npm run check` is **2154**.

⚠ **A DOTTED KEY IN `set()` IS NOW GUARDED**, because that is the bug that cost 50
coins and produced an inventory the buyer could not see. Only `update()` resolves
a dotted path; `set()` creates a field whose NAME is the literal string "a.b". The
guard scans each `.set(` up to its OWN closing `);` and is regex-free on purpose:
three separate attempts to generate the check as a regex through a template
literal silently lost their backslashes and matched nothing.

⚠ **ITS FIRST VERSION FAILED ITS CONTROL RUN.** A fixed 300-character window bled
out of the `set()` into the NEXT statement and flagged a perfectly legal dotted
`update()` sitting below it. Both directions are now proven: it fails on a dotted
key inside `set()`, and passes with a legal dotted `update()` present.

⚠ **EVERY FILE IN THIS FEATURE IS UNTRACKED IN GIT, INCLUDING THE GUARD ITSELF.**
`functions/{boosts,postViews,streamBoost,vpBonuses}.js`,
`src/utils/{boosts,boostDelivery,boostStats,promoBoost,streamBoost,postViews,vpBonuses}.js`,
`src/components/boost/*`, `src/components/wallet/MyBoosts.jsx` and
`scripts/vp-mirror-check.mjs` are all `??` to git. This is the SAME EXPOSURE that
deleted the four `src-tauri/tauri.*.conf.json` files and shipped a web-mode APK: a
`git checkout`, `reset` or `clean` takes the lot, nothing fails loudly, and here
`npm run check` and `prebuild` would break outright because the guard script would
be gone. **Committing this work is a founder call, so it has NOT been done.**

### 🚨 EVERY PAID BOOST BOUGHT NOTHING. NOW WIRED (2026-08-28, SHIPPED + DEPLOYED)

Founder asked what an LFG boost even is. The answer turned out to be worse than
jargon: **`collection('boosts')` appeared EXACTLY ONCE in the whole repo** — the
write in `purchaseBoost`. Nothing read it, and the callable never touched the
target post/profile/squad, so Post, Profile, LFG and Squad Boost were all coin
debits with no effect. Same defect as the old Stream Boost that bought a badge,
and the three inert kill switches.

**The mechanic is the one `streamBoost.js` already uses:** the server stamps
`boostExpiresAt` (millis) on the TARGET doc, expiry is evaluated at read time, no
cron, and `boostExpiresAt > now` is a single-field inequality so **no composite
index is needed**. Reader side: `src/utils/promoBoost.js`.

| Boost | Target | Reader |
|---|---|---|
| Post | `posts/{id}` | `feedRank.scorePost` × `POST_BOOST_REACH` (3) |
| Teammate Search (was LFG) | `posts/{id}` | same — an LFG post IS a post |
| Profile | `users/{uid}` | `HomeFeedRail` who-to-follow + `DiscoveryStrip` |
| Squad | `squads/{id}` | `getSquads` |

⚠ **A BOOSTED ITEM MUST COME FROM ITS OWN QUERY.** Ranking the top N by the
primary sort (followers, memberCount) can never surface something that just paid
to be seen. Every reader runs a second `where('boostExpiresAt','>',now)` query and
merges via `mergeBoostedFirst`. This is the same lesson the stream boost left.

⚠ **THE POST MULTIPLIER IS GUARDED ON `s > 0`.** Multiplying a NEGATIVE score by
3 pushes a muted author further down, which is not what was bought.

⚠ **OWNERSHIP WAS NEVER CHECKED.** `targetId` came straight off the request. That
was harmless only while nothing read the result; the moment a boost does
something it lets anyone promote someone else's post. `purchaseBoost` now reads
the target in the transaction and rejects a non-owner.

⚠ **`boostExpiresAt` IS SERVER-ONLY IN firestore.rules ON ALL THREE COLLECTIONS.**
`posts` granted the AUTHOR write on any field and `squads` granted a squad admin
the same, so without this lock a user self-stamps the boost and takes the paid 3x
for free. This was the single biggest hole in the feature.

⚠ **BOOSTS EXTEND, THEY DO NOT RESET.** Buying a second while one runs adds time
rather than replacing a longer window with a shorter one.

⚠ **`BOOST_COSTS.stream` NOW REFUSES** and says where the real one is. It is
60c/4h "pinned to the Live tab" while `BOOST_TIERS.boost` is 50c/15min of
discovery reach: two products, one name. Taking coins for the dead duplicate is
worse than refusing it.

⚠ **COPY NAMES THE OUTCOME, NOT OUR SURFACES.** Was "3x visibility in For You",
"Shown in Suggested Users", "Pinned to top of LFG". **There is no LFG list to pin
to** — an LFG post is a post, so that boost is now a cheaper, shorter post boost
named "Teammate Search Boost".

### 💵 BOOSTS + VP BONUSES NOW HAVE A CASH PRICE (2026-08-30, SHIPPED + DEPLOYED)

Founder: *"a user can only be charged coins for the boosts if they have in their
wallet, so the boosts need to be set up to charge usd"*, and every card in both
tabs was greyed out and unbuyable: *"we cant create a design that prevents the
user from checking out if they are already there and willing to pay."*

Full record, including both wrong pricings: `docs/play/BOOST_BONUS_PRICING_PLAN.md`.

**The rule.** `priceUSD = charmRound(max(coins × RETAIL_COIN_USD, $0.99))`,
`RETAIL_COIN_USD = $0.99 / 78` — the Starter pack, the ladder's WORST per-coin
rate. `functions/payram.js` already uses that exact number as
`CUSTOM_COIN_PRICE_USD` so a custom amount cannot undercut a pack; this is its
mirror. A coin therefore has ONE value on both routes, which is the answer to
*"are you trying to devalue the coins?"*: the cash price is DERIVED from the coin
price, at retail.

⚠⚠ **NEVER PRICE AN ITEM OFF `playPriceFor(item.coins)` OR OFF THE NET FLOOR.**
Two pricings shipped past review and both were wrong in the same direction:
`playPriceFor(75)` gave $1.09, which is what a 78-coin pack costs; anchoring on
the net floor ($0.011628) and doubling gave **$2.09, worse than the bug it
replaced**. $0.99 buys 78 coins, spend 75, keep 3. **The net floor is what a coin
must be WORTH after Google's cut. It is not what anyone PAYS for one.**

⚠ **THE GUARD THAT CATCHES BOTH:** an item must never cost MORE in cash than the
cheapest coin pack that would buy it outright, or the cash button is irrational.
In `coin-ladder-check.mjs`, **negative-tested both ways** before being believed.
`npm run check` is **183**. A tie passes on purpose: under 78 coins the $0.99 Play
minimum and the Starter pack are the same money.

⚠ **DURATIONS DID NOT CHANGE.** Founder: *"I did not say that you can change the
times."* One hour is still cheapest in coins. In cash the Play floor flattens the
bottom four items to $0.99, which is Google's constraint, not a re-spec.

**The buy rule lives in ONE place**, `useStoreBuy` in `StoreTabs.jsx`, so a bonus
and a boost cannot diverge: wallet covers it → coins, in place; else Play build →
the Play sheet; else → the basket. Both prices always shown, payable one large.

⚠ **THE CASH GRANT CALLS THE SAME HELPERS THE COIN GRANT CALLS.** `applyPack` and
`creditBoosts` are now exported from `functions/{vpBonuses,boosts}.js` and used by
BOTH `redeemPlayPurchase` and `settlePayramOrder`, inside the transaction that
records the payment. A second grant path would be a second definition of what
owning a boost means.

⚠⚠ **`circleWallets.js` HAS A SECOND SETTLEMENT PATH AND IT WOULD HAVE EATEN THE
ITEM.** A Circle USDC deposit carrying a PayRam `refId` credits `coinsToCredit`
and marks the order settled **on its own**, knowing nothing about items, and an
order settles once. A mixed basket would have credited the coins and dropped the
boost with no way to recover. It now defers any order carrying items to
`settlePayramOrder`, exactly as it already defers subscriptions. **Any new order
`kind` must be added to that carve-out.**

⚠ **`settlePayramOrder` IS BUNDLED INTO `payramWebhook` AND `pollPayramOrders`**,
same trap as `coinLedger.js`. Redeployed together with `circleWalletsWebhook` and
`pollCircleDeposits`.

⚠ **A STORE ITEM'S SKU *IS* ITS PLAY PRODUCT ID** (`vpb_flash`, `boost_post`),
one namespace across the cart, Play and the ledger. Running one through
`playProductIdFor()` asks Play for `coins_vpb_flash` and the sheet reports
"product not loaded". `isStoreItemSku()` guards the two places that map it.

⚠ **`playBilling.js` AND `payram.js` ARE CRLF; THE REST OF THE REPO IS LF.** A
multi-line patch anchor silently matches nothing across that boundary. Normalise
anchor and replacement to the file's own endings.
[[reference-mixed-line-endings]]

⚠⚠ **CLICKING A BOOST CRASHED THE BASKET TO THE ERRORBOUNDARY, AND BOTH THE BUILD
AND THE GUARD WERE GREEN.** The cart's line renderer resolved a coin pack and
branched at every field (`pack ? pack.x : item.x`). Forty lines below the
resolve, the line TOTAL still read `pack.priceUSD * line.qty`. A store item has
no pack, so the first boost added dereferenced null and took the whole cart down.
**Nothing caught it because nothing had ever resolved a boost SKU.**

Fixed by removing the class, not the instance: `rowFor(sku)` in `CartContents.jsx`
flattens a pack and an item into ONE non-null row, and `pack`/`item` are
deliberately **out of scope** in the renderer, so no field can deref through an
absent one by omission. `coin-ladder-check` now resolves every shop SKU and
asserts each row carries every field the basket renders (**239 assertions**,
negative-tested by blanking one field).

⚠ `src/utils/storeItems.js` imports with **explicit `.js` extensions**, unlike the
rest of `src/`. Vite does not care; raw node does, and the guard imports it. Drop
the extension and the guard can no longer load the file it guards.

⚠ **GOOGLE PAY ON THE WEB IS NOT A BUG AND NOT A CONSOLE SETTING.** Play Billing
is an Android-app API (`window.VergrBilling`, the Kotlin bridge); a browser has
no bridge, and Play Console products are IAPs redeemable only inside the app.
Google Pay is a different product entirely, added as a wallet inside a processor.
Founder decision, separate work.

✅ **GEO PRICING DONE, 40 MARKETS.** `docs/play/play-products.csv` is now **26
products** and `play-prices-by-market.csv` carries all 16 items. Coin pack prices
were NOT touched: `coins_starter` US is still $1.09, matching live Console.
🔴 **The 16 products still need CREATING in Play Console** (one-time, consumable).
Until then the Play build offers only the coin price.

### 🛒 THE SHOP IS ONE CARD, THREE TONES (2026-08-28)

Founder: *"The card design should be the same as the coin packs but with a
different colour."* So `src/components/wallet/StorePackCard.jsx` lifts the coin
pack treatment verbatim — top-lit gradient, bloom behind the art, fixed 132px art
box, footer price shelf — and only the TONE changes.

| Tone | For | Why |
|---|---|---|
| `gold` | coins | the existing packs |
| `violet` | VP bonuses | **already the VP tone**: `COIN_PACKS` with `badgeStyle: 'vp'` render violet on the buy screen today |
| `ember` | boosts | the hottest of the three, so a boost never reads as a coin pack at a glance |

⚠ **DO NOT HAND-ROLL A SECOND SHOP CARD.** Give it a tone here instead. A second
visual language in one shop is what got the milestone badges rejected.

⚠ **Tabs are on `/wallet/buy` (web AND native) as well as `/prestige`**, all
rendering the same `StoreTabs.jsx`. The founder asked why the shop had no bonus
tab and where the other packs were; the answer to the second was that
`BoostScreen` existed at `/boost` and nothing in the wallet pointed at it.

⚠ **`src/screens/wallet/BuyCoinsScreen.jsx` IS UNROUTED DEAD CODE.** The live buy
screen is `wallet/v2/BuyScreen.jsx`. The dead one still references
`FIRST_PURCHASE_DISCOUNT` and NOWPayments, both long gone. Do not edit it by
mistake.

⚠ **ONLY `profile` BOOST IS SOLD FROM THE TAB.** Post, squad and LFG boost a
SPECIFIC thing, and selling one with `targetId: null` takes coins for a boost
that promotes nothing, so those route to `/boost` where the target is picked.

⚠ **`BOOST_COSTS.stream` IS DELIBERATELY ABSENT FROM THE TAB.** It is 60 coins /
4h "pinned to the Live tab" while `BOOST_TIERS.boost` is 50 coins / 15min of
discovery reach: **two products, one name, different prices.** Still on `/boost`.
**Resolve the collision before either shop lists both.**

Plan, pricing derivation and the rejected alternatives:
`docs/VP_BONUS_PACKS_PLAN.md`.

### 📜 VP BONUS PACKS + THE L100 SINK — PLANNED, NOT BUILT (2026-08-27)

`docs/VP_BONUS_PACKS_PLAN.md`. Founder rejected an indefinite VP rate increase in
favour of **timed bonuses** (6h / 12h / 24h / 48h / 7d), a **VP shop** so VP has a
use at L100, and **coin-bought bonuses**.

⚠ **THE FLAT +0.5%/LEVEL RATE PAYS LITERALLY NOTHING FOR MOST OF THE LADDER.**
Measured, not assumed: awards run through `Math.round()`, so `like_post` and
`squad_message` (1 VP) **never** change at any level, `get_like` (2 VP) changes
**once** in 100 levels (L51), `get_comment` twice. And `VP_BONUS_MAX = 1.5` is
never reached — L100 pays 1.495x. The cap is dead code.

⚠ **THE BONUS BELONGS ON `users/{uid}`, NOT ON THE WALLET.** Both VP credit paths
already `tx.get(userRef)` for the plan tier and `vpLevel`, and neither ever READS
the wallet. Putting it there makes the multiplier cost zero extra reads; putting
it on the wallet adds one to every VP award in the product.

⚠ **A MULTIPLIER ALREADY LIFTS THE DAILY CAP** (`engagementVp.js:74`), which is
correct and must stay. It also means a cap-lift pack is a genuinely different
lever, not a duplicate.

⚠ **`GIFT_COINS_PER_VP = 25` IS THE CONSTRAINT ON SELLING BONUSES FOR COINS.** Its
own comment says coins must not buy rank. The ARBITRAGE loop is fine (the ladder
prices VP at ~0.006 coins each, so any price over ~20 coins is strictly lossy),
but buying rank progression with money is a VALUES call and is unanswered.
**Three options in §6.2 of the plan; recommendation is that coins never buy a VP
rate.**

⚠ **`vpSystem.js:122` ALREADY ANTICIPATES PRESTIGE** (`0 at L100 unless prestige`).
The recommended L100 answer is **Legacy VP** (§7.2): past L100 VP keeps accruing
into a spendable balance. It needs NO NEW ART, which matters because prestige
crests, reaction packs, milestone badges and the entry ribbon are all parked on
art the founder cannot author.

### ✅ THE LADDER IS COMPLETE: 100/100, NO HOLLOW LEVELS (2026-08-27, SHIPPED + DEPLOYED)

Founder: *"I have already told you how boosts will work in the VP ladder, we are
using them to fill empty gaps."* The 26 levels still paying nothing but the +0.5%
earn rate now grant a Stream Boost token. **`BOOST_TOKEN_LEVELS` 11 -> 37**,
mirrored in `functions/vpLevel.js` (redeployed, not just built).

⚠ **NOTHING ELSE COULD HAVE FILLED THEM, and this was checked rather than
assumed.** Fonts 18 built (15 drip-fed + 3 free), chat themes 8/8, accents 12/12,
profile gradients 7 + 1 free, typing styles 5 + 1 free: **every built cosmetic
already had a level.** The only available fillers were boost tokens or content
that does not exist. Do not go looking for unplaced content; there is none.

⚠ **`assertNoDeadLevels` IS STILL NOT COVERAGE** and must never be cited as such.
New **`assertNoHollowLevels()`** counts rows that are NOT `vprate_` and
`vp-mirror-check.mjs` fails the build on any level returning zero.
Negative-tested: deleting two levels made it name 95 and 96.

⚠ Fixed in passing: the boost mirror check split the server array on `,` with no
blank filter, so the trailing comma on the now-multi-line array invented a
**phantom level 0** and failed a mirror that was correct. A guard that cries wolf
gets ignored.

⚠ **L93-99 IS SEVEN CONSECUTIVE BOOST TOKENS** (shorter runs at 42-43, 58-59,
76-78). No level is hollow, which was the goal, but the top band pays the same
reward seven times. Breaking it up means either granting MORE tokens at high
levels (a level->count map, no schema change) or a HIGHER TIER token (a real
schema change: the wallet holds one flat `boostTokens` count and `boostStream`
always redeems at `TOKEN_TIER_ID`). **Both are economy decisions, founder only.**

⚠ The boost row copy said "so a public stream costs you nothing", which died with
the 50-coin gate. It now reads as what the token actually does: spend it on your
own stream or anyone else's. `public/version.json` release notes still carry the
old "seven levels" claim and must be rewritten before the next APK.

Full table and the options: `docs/effects/26-LADDER-COVERAGE.md`.

### 🏅 THE LIVING CREST — effect 21, L62 (2026-08-27, SHIPPED + DEPLOYED)

`animated_crest`. The rank crest in live chat gains an intermittent sweep of
light, masked to the badge art that already ships. No new art, because the art
route is blocked: the founder cannot author it and rejected the existing badge
art, which is what parks effects 10 and 18.

⚠ **THE DUTY CYCLE IS THE DESIGN, NOT A TUNING KNOB.** 900ms of a 5,600ms cycle,
phase hashed per uid, so 84% of the time nothing moves and two crests almost
never sweep together. That is the answer to the founder's standing question
about "multiple users who have unlocked it". **Twitch does not allow animated
chat badges at all** (PNG, 25 KB, no animation) — not a reason to refuse, but it
is the restraint bar. Widening the sweep fails `npm run check`.

⚠ **THE CREST ART IS 1024x1024 AND AVERAGES 167 KB, TO PAINT A 13-PIXEL ICON.**
A chat with eight rank bands present pulled ~1.4 MB and decoded eight 4 MB RGBA
surfaces. Worse, **`/badges/` had no `firebase.json` headers entry**, so the
catch-all no-store rule re-downloaded all of it on EVERY page load.
`scripts/build-badge-sizes.mjs` now emits 64px variants (1.9 KB avg, -98.9%) to
`public/badges/sm/` and the path has real cache headers. `RankBadge` uses the
small art; `/prestige` renders at 96px and keeps the full-size files. **Check
`firebase.json` before adding any directory under `public/`.**

⚠ **THREE VISUAL DEFECTS SHIPPED PAST A GREEN RUN, all found by rendering it:**
(1) `overflow: hidden` on a box sized exactly to the icon squared off the crest's
own glow into a hard grey rectangle — every probe read OUTSIDE the box and the
damage was inside it; (2) the gradient and the mask were on one element, and a
transform drags an element's mask with it, so the sweep was a white cut-out of
the badge sliding over the badge; (3) semi-transparent white over dark art
averages to grey, so it occluded the crest instead of lighting it — `.vg-bloom`
in the same stylesheet already recorded that fix and it had not been applied.
**The mask now lives on a static parent and only `::before` moves.** Full
account, including the three times the TESTS were wrong, in
`docs/effects/21-animated-crest.md` §9.

⚠ **A RAMP EXPRESSED IN PERCENTAGES DOES NOT SURVIVE A TINY BOX.** A band with
20% falloff is 1.5 real pixels at 13px, so the "soft" edge was hard. R3 in
another costume.

Harness: `node scripts/crest-preview.mjs --measure` (24 assertions, reads the
framebuffer over CDP). Every probe carries a control run that proves it can see
the fault it exists to catch — the first R1 probe reported 255 in both runs
because it was reading the username glyphs beside the crest. `npm run check` is
**1,844**.

### 🧹 ESLINT INSTALLED, AND IT FOUND EIGHT REAL DEFECTS ON ITS FIRST RUN (2026-08-27, SHIPPED + DEPLOYED)

`eslint.config.mjs` + `npm run lint`, wired as the FIRST step of `npm run check`,
so it gates every build. Three rules only, and **every one of them catches a
crash, not a style preference**:

| Rule | The defect it exists for |
|---|---|
| `no-undef` | `canUseAnimatedAvatar` / `compressVideo` / `useRef` / `rankStreams` all shipped unimported in one session. The bundler compiled every one. |
| `react/jsx-no-undef` | an unimported `<Component />` is legal JSX and builds green |
| `react-hooks/rules-of-hooks` | the React #310 hook-order crash that took the profile to ErrorBoundary |

⚠ **`exhaustive-deps` is deliberately OFF and this is NOT a style linter.** Every
rule added here is a rule someone satisfies on every future edit. Add one only
when a BUG got through, the way these three did. Negative-tested: a probe file
with all three faults reports all three, and it is deleted after the test.

**What the first run found. Three were on LIVE screens:**

| Where | Defect |
|---|---|
| `EditProfileScreen.jsx` | `ProfileImagesTab` read `myVpLevel`, a const declared inside `EditProfileScreen`, a SIBLING function. The Profile Images tab threw `myVpLevel is not defined` on render, on web and native. Now one module-scope `ownVpLevel(wallet, profile)`. |
| `NativeProfileScreens.jsx` | `NativePublicProfileScreen` read `accentHex` from the OTHER component in the file, so the profile-music block threw for every visitor. It would also have painted the VIEWER's accent. Now `accentFor(user)`, the profile owner's. |
| `StreamShareSheet.jsx` | `useState` sat BELOW `if (!streamId) return null`, so a render without an id called one fewer hook and #310 fires when the id arrives. Hoisted. |
| `SeriesScoreboard.jsx` | the `bo1` early return sat above a `useMemo`, and `seriesFormat` is read off the LIVE match doc, so a bo1 match restamped bo3 changes the hook count. |
| `SpectatorPanels.jsx` | `if (IS_STORE_BUILD) return null` before every hook. The effect now skips its listener instead, so the Play build still opens no subscription. |
| `BRScoreboard.jsx` | `<Header>` used 4x, never defined. That component has thrown on render for its entire life. |
| `MatchDetailsScreen.jsx` | `applyVanguardMask(rawUser, profile)` with no `profile` destructured. |
| `seed-firestore.js` | a stray `}` closed `seed()` 31 lines early. `node seed-firestore.js` has been a SyntaxError for months. |

⚠ **The two profile ones are the same shape and it is worth naming: a const in
one component is invisible to a sibling component in the same file, and nothing
in the build says so.** Both files read fine top to bottom. Only a scope-aware
tool sees it.

⚠ **The config reads the `__VERGR_*__` defines out of `vite.config.js` rather than
restating them**, and throws if it finds none, so adding a define cannot leave a
stale globals list behind. Same reason the VP guards read the real tables.

Cost: ~31s added to `npm run check`. `scripts/` carries BOTH node and browser
globals on purpose, because puppeteer `page.evaluate()` callbacks are real
browser code living in a node file.

### Effect 22 documented, and writing it SHRANK it (2026-08-27, DOC ONLY)

`docs/effects/22-accent-presence.md`. **Not built, and it needs a founder answer
before it is.** The scope table said "accent tints presence app-wide"; the
document argues that is the theme system deleted on 2026-08-24 wearing a smaller
palette, and that the argument which cut effect 17 ("a second accent on the same
card would give a rainbow feed") generalises to every surface showing more than
one user at a time.

What survives is **one-owner surfaces**, which in practice means the LIVE STREAM:
the one large surface in the app that belongs to a single person and carries no
personalisation at all. Both viewers already load the host's full user doc
(`ViewerStreamScreen.jsx:221`, `MobileLiveViewer.jsx:377`), so it would cost zero
extra reads. Checked, not assumed: Discord tints the NAME only, Twitch and
YouTube tint the CHANNEL PAGE only, TikTok has no per-user accent. Vergr already
ships both halves except on the stream.

⚠ **It fills ONE hollow level (proposed L94), not six.** L95-99 stay hollow.

### Milestone badges (2026-08-24, SHIPPED + DEPLOYED)

⚠ **THE BADGE ART IS REJECTED. Founder, 2026-08-24: "those look like shit."**
The SYSTEM is sound (counters, evaluator, zero-cost contract, mirror check) and
none of that needs revisiting. What needs redoing is the FACE: currently a
Material Symbols glyph on a tinted rounded square, which reads as a settings row,
not as something earned. Come back to this and design real badge art. Do NOT
rebuild the data layer while doing it.


`src/utils/milestones.js` + `src/components/profile/MilestoneCase.jsx`, mounted on
all four profile views (web own/public, native own/public). 24 threshold badges in
6 families + 3 rare one-offs.

**Evaluation is CLIENT-SIDE and costs nothing.** `milestonesFor()` is a pure pass
over a static table using counters already on the user and wallet docs the screen
has loaded. No cron, no trigger, no `earned` collection. That is only safe because
every counter is server-written AND server-only in `firestore.rules`; the worst a
tampering user achieves is lying to themselves on their own screen, because a
visitor's view evaluates from the OWNER's real doc.

⚠ **`users.streamMinutes` was read by the whole "On air" family and written by
NOTHING.** Four badges were permanently unearnable. A name grep looked fine
because `streamMinutesPerDay` in `streaming.js` is a per-tier LIMIT with a
confusingly similar name. It is now incremented in `endStreamSession` next to the
existing `stream_hour` VP award, in MINUTES so a 40-minute stream still counts.

⚠ **`dailyStreak` is a REWARD LOOP, not a record.** It caps at 5 and resets to 0
so the +50 can recur, so a "longest streak" read from it can never exceed 5.
`claimDailyReward` now also writes uncapped `consecutiveDays` /
`bestConsecutiveDays` / `distinctDaysActive`, all riding the write that already
happens once per user per day.

⚠ **`claimDailyReward` did `tx.set(walletRef, walletData)` with NO merge**, which
REPLACES the document: every wallet field not enumerated was destroyed on each
daily check-in, `boostTokens` included (granted by the VP ladder, then wiped the
next time the user opened the app). Fixed; do not remove that `{ merge: true }`.

New counters, all locked server-only: `users.clipCount`, `users.streamMinutes`,
`wallets.{consecutiveDays,bestConsecutiveDays,distinctDaysActive}`.
`users.referrals.allTime` already existed.

⚠ `PUBLIC_LAUNCH_MS` in `milestones.js` gates the two rare badges (Day One,
Founder Era) and is a PLACEHOLDER (2026-09-01). Set it once to the real launch
instant and never move it: shifting it retroactively grants or revokes a badge on
live accounts.

`scripts/vp-mirror-check.mjs` is now 91 assertions and asserts every badge's
counter against the file that writes it. Each badge NAMES its writer file rather
than the script pattern-matching for `field: FieldValue.increment` — that first
attempt produced two false negatives (`bestConsecutiveDays: Math.max(...)` and the
dotted `'referrals.allTime':`), and a check that cries wolf gets ignored.
Negative-tested: pointing a badge at a nonexistent field fails the run.

**Not the daily-login bug the founder reported.** Measured: only 3 `vp`
notifications exist on that account ever (2026-08-02, 08-07, 08-22), none
duplicated, and `'vp'` is not in `PUBLIC_NOTIFICATION_TYPES` so it cannot push.
The 08-22 milestone notification is still `read: false` and resurfaces at the top
of the drawer on every login. It is never re-created, only never cleared.

---

### `src/components/effects/` — the unlockable-effects layer (2026-08-24)

Founder's architecture call, and the right one. Read
`src/components/effects/README.md` before adding anything here.

**The split, and why it exists.** The theme system failed because TWO files both
claimed to define a theme (`profileThemes.js` and `rankCollections.js`), so the
`/prestige` swatch previewed one thing and the profile drew another, and neither
file showed the disagreement.

| Owns | Where |
|---|---|
| WHEN you get it | `EFFECTS` in `src/utils/rankUnlocks.js` — data, not logic |
| HOW it looks | one file per effect under `effects/{visual,audio,triggers}/` |
| WHAT is on now | `users/{uid}.cosmetics.fx` |

Screens import from `effects/index.js` only, never a deep path, and call
`useEffectEnabled(id, ownerProfile)`. An effect never learns what a level is.

⚠ **`cosmetics.fx` stores OPT-OUTS only and therefore needs NO firestore rule.**
`{ ambilight: false }` means "I turned this off". Writing `true` for something
unlocked buys nothing: `isEffectOn()` ANDs it against `vpLevel`, which is
server-written and server-only, and a visitor's client evaluates the PROFILE
OWNER's vpLevel.

Shipped: `orbit` (L6) and `ambilight` (L21).

**`AvatarOrbit`** isolates the existing `.vg-orbit` from `surface.css`. The
static ring stays STATE (live / unseen); the travelling light is IDENTITY. Two
behaviours, so they never compete. It was previously hardcoded always-on.

### Ambilight — REWRITTEN 2026-08-24 after the first version was rejected

⚠ **The first version was "a gradient blur" and the founder was right.** It is
recorded here because the mistakes are the instructive part.

Reference: https://www.smashingmagazine.com/2023/07/recreating-youtube-ambient-mode-glow-effect/

| | Correct | First version |
|---|---|---|
| Canvas | **10x6** | 32x18 — you could still make out the picture |
| Blur | **`ctx.filter` at SOURCE scale**, before the upscale | CSS blur on the upscaled result |
| Extent | canvas **larger than the content**, content inset inside it | four separate edge strips |
| Edges | `box-shadow: inset` feathers it into the page | hard-edged strips |
| Opacity | ~0.4-0.7 | 0.75 with per-edge zone colours |

The 10x6 canvas is THE EFFECT, not a performance compromise: downscaling that
far discards every detail and keeps only dominant colour, so the upscale is huge
soft fields. And a 1px blur on a 10px-wide canvas covers a tenth of the image;
the same 1px after upscaling covers nothing.

The per-edge "zone glows" were invented, not researched. They cannot produce a
corner, so they always read as four gradients meeting.

**Doing it correctly DELETED the CORS problem.** The old version called
`getImageData` to compute per-edge colours, which taints on cross-origin media
and needed a cache-busting query param. `drawImage` has no such restriction, so
with nothing read back, cdn.vergr.app media works with no crossOrigin attribute,
no extra fetch and no cache trickery. (For the record, since it cost a round of
debugging: cdn.vergr.app DOES send `Access-Control-Allow-Origin` on a real
object. An earlier probe hit a 404, which never carries it.)

⚠ **BOTH LIGHT LAYERS MUST BE `z-index: -1`.** At 0 they are positioned
siblings, and positioned elements paint above non-positioned ones, so the glow
washed over the stats row and made the follower counts and the VP figure
unreadable. A negative z-index child paints above the parent's BACKGROUND but
below its in-flow content, which is exactly what a light layer needs.

⚠ **STRUCTURAL LIMIT, NOT YET FIXED.** The profile banner is FULL-BLEED: it
touches the top of the page and both content edges. So three of the four
directions are clipped and the light can only travel DOWNWARD, which is
inherently a gradient no matter how well the sampling is done. YouTube's video
is inset with padding, which is why its glow surrounds the content. Making this
effect genuinely impressive needs the banner inset (margin + radius) so light
spills on all four sides. That is a profile-header design change and needs a
founder decision.

**Where ambilight runs (2026-08-24):** profile banner (own + public + native), `InlineVideoPlayer` (our own video: PostCard feed, MediaLightbox, LockedMedia, VergrMeView, MobileLiveViewer, native screens) and `EmbedVideoPlayer`.

⚠ **A YOUTUBE EMBED IS A CROSS-ORIGIN IFRAME AND ITS PIXELS CANNOT BE READ.**
No flag, proxy or permission changes that; it is a browser security boundary.
So an embed samples the POSTER FRAME (`img.youtube.com/vi/<id>/hqdefault.jpg`,
which the component already resolves) and its glow is STATIC — right colours,
not following playback. Our own videos sample live, because we own the pixels.
Do not file this as a bug or try to "fix" it.

⚠ **The theme seam-band is DELETED**, not suppressed: themes are gone (founder,
2026-08-24). The 8 gradients survive as the Profile gradient unlockable.

⚠ **A LIGHT LAYER MUST NEVER REACH OUTSIDE ITS OWN BOX.** Rejected twice for
this. `inset: -spread` means the glow covers whatever in-flow siblings sit above
and below it: the post text above a video, the link card below it. And
`isolation: isolate` on the wrapper makes it worse, because the wrapper then
paints as one unit above every PRECEDING sibling.

The reference does not do this. YouTube gives the video PADDING and the glow
fills the padded box, so the light occupies space the layout already reserved
and nothing can be washed, by construction. Ambilight is now always
`inset: 0`; the CALLER pads or sizes the wrapper. Verified on the live profile:
the glow box is exactly its reserved box and stops 253px above the next heading.

### ⌨ Custom typing indicator — SHIPPED + DEPLOYED 2026-08-25 (doc 06)

`typing_style` at **L32**, six styles (`dots` default, `wave`, `bars`, `orbit`,
`pixel`, `comet`), picked on `/prestige` → Effects. Look lives in
`src/components/effects/triggers/TypingStyles.{jsx,css}`; WHEN in
`TYPING_STYLES` (`rankUnlocks.js`); resolver `typingStyleFor(typistProfile)`.

⚠ **The DM typing bubble had NEVER rendered.** `ChatThreadScreen` mounted
`<TypingIndicator />` with no `users` prop against a component that opens
`if (users.length === 0) return null`. Fixed.

⚠ **`grep -rl 'TypingIndicator'` returns 2 files and the real answer is 6.**
That grep finds the component's consumers, not the surfaces that DRAW an
indicator: squad chat hand-rolled `.typing-dots` (`squad.css:452`) and three
inbox rows built the sentence as a string. **Grep for the THING, not for the
component you expect to be there.**

⚠ **The relay has no typing feature** (`grep -rn 'typing' infra/chat/src` = one
comment). Typing rides the `conversations/{id}.typingUsers` doc. Doc 06's
original research argued for deriving the style from `vpLevel` to avoid a Go
redeploy that was never needed; the style is a free user choice instead.

⚠ **A defect can pass every numeric assertion.** `comet` shipped as a SOLID BAR
through the first measurement round: `.vg-typing i` sets a background *colour*
and comet only overrode background-*image*. It animated, it travelled, and it
looped byte-identically, because a uniform bar does. Only rendering it showed
it. `scripts/typing-preview.mjs --measure` now also asserts mid-cycle differs
from the start (29 assertions); `npm run check` is 114.

⚠ **`slimUser()` now persists `vpLevel` + `cosmetics`** (`chatIdentity.js`).
Without them a COLD start lost name colour, typeface and gradient on every chat
surface until the refetch landed.

✅ **VERIFIED LIVE ON TWO ACCOUNTS.** @vergr typing, @Verion watching: three
indicators measured on the visitor's screen, all carrying the TYPIST's accent
(`#f04060`), equip persisted across a reload, and @Verion at L1 correctly sees
"unlocks at level 32". Doc 06 §8.2.

⚠ **`useTyping` DIED ON EVERY COLD LOAD** (found live, fixed, deployed). It read
`auth.currentUser` with `[chatId]` deps, so a reload / pasted link / push-launch
bailed before subscribing and never re-ran: **the thread's typing listener was
dead for the whole session** while the inbox row kept working. Now tracks
`onAuthStateChanged`. Same class as [[reference-auth-null-is-not-signed-out]].

⚠ **THERE ARE TWO REDUCED-MOTION SWITCHES AND A MEDIA QUERY ONLY CATCHES ONE.**
Settings → Appearance sets `html[data-reduced-motion="true"]` and `index.css`
answers with `animation-duration: 0.001ms; iteration-count: 1`, which does not
stop an animation, it **fast-forwards it to its final keyframe**. For anything
whose last frame is its resting pose that means invisible: `pixel` measured 0.20
opacity, `dots` 0.42. Any future animated effect must declare static poses for
BOTH switches.

⚠ **SQUAD TYPING HAS NEVER WORKED AND NEEDS A FOUNDER DECISION.**
`SquadChatThreadScreen:298` never takes `setTyping`, and `useTyping(squadId)`
listens to `conversations/{squadId}`, a doc nothing creates. Not a regression;
the `.typing-dots` markup there was dead. Squad messages are Firestore, not the
relay, so typing state would most naturally ride the squad doc — where every
member already has a listener, so each keystroke burst bills a read per member.
Doc 06 §8.2.3.

### 🎵 PROFILE MUSIC (effect 09): SHIPPED + LIVE-VERIFIED 2026-08-25

The MySpace idea. A track the profile OWNER picks, playing for VISITORS, artist
credited. L81. `users/{uid}.cosmetics.profileAudio`. Two sources, owner chooses:
**Audius** (~1M real tracks, free, no ads, whole track plays) or **upload**
(30s/2MB, DMCA safe harbour).

⚠ **YOUTUBE AND SPOTIFY ARE RULED OUT. DO NOT RE-SUGGEST THEM.** YouTube ads on
embeds are unavoidable and got MORE frequent in Aug 2024 (`rel=0`/
`modestbranding` no longer help), plus it reports playback data to Google on
page load. Spotify embeds give a 30-SECOND PREVIEW unless the visitor is
desktop + logged in + Premium; mobile always gets the preview.

⚠ **A PAID PLAN ON THE SOURCE DOES NOT REMOVE ADS FOR VISITORS.** YouTube
Premium / SoundCloud Go+ remove ads for the LISTENER only. What controls ads is
the TRACK OWNER's monetisation setting. Never put "get a paid plan" in help copy.

⚠ **Audius needs NO API KEY and NO iframe.** Its stream endpoint is CORS-open
`audio/mpeg` with range support, so a plain `<audio>` element plays it. That is
why there is no third-party player, no tracking pixel and no consent problem.

⚠ **`isPlayable()` IS NOT OPTIONAL.** Measured: `is_streamable` was FALSE on 1
of 10 search results and that track 404s. It also rejects `is_stream_gated`
(artist deliberately withheld) and non-empty `allowed_api_keys`.

⚠ **THE FAB POPUP IS THE ATTRIBUTION** (artist, title, artwork, licence, link
back). Remove it and the credit goes with it.

⚠ **A DOUBLE-PLAY BUG SHIPPED AND ONLY TESTING FOUND IT.** One mounted component
produced TWO Audio objects playing in lockstep: `play()`'s rejection handler
outlived its cleanup and armed a second gesture listener on a dead element.
Nothing in the source looked wrong. Fixed with a `cancelled` flag AND a
module-level `liveAudio` singleton.

✅ **Verified live on two accounts:** locked below L81, silent on the owner's own
profile, FAB + credit popup for the visitor, plays (0:14 of 3:17), exactly one
audio, stops on navigation, survives breakpoint remounts. Masked persona and
native are NOT yet verified.
### 🏅 L100 `name_glow` WAS AN INERT LADDER ROW (fixed 2026-08-25)

`RANK_UNLOCKS` promised "Immortal name glow" at L100 and **nothing read it**.
`UserName.jsx` resolved font, colour, chat colour and the gradient, and had no
glow. Same shape as the inert `cosmetics.nameEffect` toggle and the three inert
kill switches. Now a two-pass `drop-shadow` (a FILTER, not `text-shadow`: on the
gradient path the glyphs are transparent), static on purpose so it needs no
reduced-motion handling.

⚠ **`assertNoDeadLevels` DID NOT CATCH IT and could not.** It only proves every
LEVEL 1-100 has a row, never that the row's reward EXISTS. `vp-mirror-check.mjs`
now maps every ladder id to the file that implements it (`REWARD_OWNERS`) and
fails the build on a row with no owner. It caught a real error on its first run
(`vpLevel.js` is in `functions/`, not `src/utils/`). Negative-tested. **Adding a
ladder row now means naming the file that honours it.** `npm run check` is 447 +
216 + 31 + 34 assertions.

⚠ **ANIMATION CANNOT BE MEASURED IN A HIDDEN TAB.** Chrome freezes animation
timelines at `visibilityState === "hidden"`, so `Animation.currentTime` stops
advancing and a perfectly healthy animation looks dead. Check visibility before
concluding anything about motion.
### 🎨 CHAT THEMES: 8 SHIPPED + DEPLOYED 2026-08-25 (doc 12)

Arcade / Dracula / Gaia / Chatter / Cosmos / Neon / Vault / Studio. One id on the
conversation doc, seen by BOTH people, the SETTER's unlock decides, DMs only.
Each theme = 4 gradient colours + an icon pattern + `out`/`in`/`accent` bubbles.

⚠ **THE TILES ARE ON R2, NOT HOSTING, AND MUST STAY THERE.** Founder: "hosting
costs me money". ~300KB per tile, one fetched per themed chat. The generator
writes to **`chat-pattern-tiles/`** at the repo root, NOT `public/`, because
Firebase hosting `ignore` globs were tried and DID NOT exclude them. Publish
with `node scripts/publish-chat-patterns.mjs`.

⚠ **A 200 FROM HOSTING PROVES NOTHING** — the SPA rewrite answers any unmatched
path with index.html at 200. Check `content-type`, not status. See
[[reference-spa-rewrite-masks-404]].

⚠ **BLANK-SPOT RATIO CANNOT SEE A ROUND HOLE.** It blurs over a neighbourhood,
so specks around a gap still average fine. The founder spotted holes the metric
called clean. Measure the **largest inscribed empty circle** instead (cosmos was
r=24.7, a ~23px bald patch). And measure INK, not circle geometry: a first fix
measured distance to the nearest circle EDGE and changed nothing, because the
holes sit INSIDE the packing circles where a sparse glyph fails to fill its own.

⚠ **FIVE MOTION MODELS, and "Lissajous" is not automatically non-circular.** The
first fix used frequency ratios near 1:1, and a Lissajous at 1:1 with a phase
offset IS AN ELLIPSE. `drift`/`tide`/`pulse`/`wander`/`orbit` are structurally
different; `orbit` is deliberately circular and is the control that validates
the measurement (it scores 0.912 radius min/max where the others score <0.12).
Motion is chosen PER CONVERSATION and is separate from the theme.
⚠ **THE ICONS CARRY A LICENCE OBLIGATION.** 174 icons: 120 Phosphor (MIT, no
credit needed) + 54 game-icons.net (**CC BY 3.0, artists MUST be credited**).
`/platform/credits` names Lorc, Delapouite, Skoll, Caro Asercion, Darkzaitzev.
`scripts/chat-contrast-check.mjs` reads the icon manifest and **fails the build**
if that page stops naming an artist whose work ships. Do not delete that page.

⚠ **DO NOT RETUNE THE PATTERN PACKING.** `BANDS`, the void-fill loop and the
palettes in `build-chat-patterns.mjs` are founder-approved. Swapping the icon
source is NOT licence to touch them; that was tried and rejected 2026-08-25
("all you needed to do was copy and then replace the icons"). The generator now
draws `Path2D` from SVG instead of font glyphs, and nothing else changed.

⚠ **THE 7 WALLPAPERS ARE UNTOUCHED AND MUST STAY THAT WAY.** Founder: "i dont
want you messing with the existing backgrounds since users will still need
them". `public/backgrounds/static/` is a separate shipped feature; themes are
ADDITIVE. The build guard asserts all seven files still exist.

⚠ **The bubble contrast floor is ENFORCED IN CODE**, not trusted to the palette.
`chatBubbleColors()` runs every colour through `ensureContrast(c, "#FFFFFF", 4.5)`,
so a free-hex custom colour cannot produce an unreadable bubble. It caught two
preset accents that were under the 3:1 floor. NO `backdrop-filter` on bubbles.

⚠ Source SVGs live in `scripts/chat-pattern-icons/`, **never `public/`** — they
are build inputs and only the generated tile is served. `/chat-patterns/**` has
its own cache headers in `firebase.json`; the catch-all `**` rule is `no-store`.

`npm run check` is now **354 assertions** across four guards.
📄 **`docs/effects/` — ONE DOCUMENT PER EFFECT.** Start at
`docs/effects/00-RULES.md` (nine rules, each one a defect that shipped, plus the
build order and the definition of done). Then the numbered doc for the effect
you are about to build.

⚠ **DO NOT START AN EFFECT WITHOUT ITS DOCUMENT BEING COMPLETE:** researched
technique with cited sources, an EXHAUSTIVE surface inventory, an implementation
plan, and a MEASURABLE verification step. Ambilight was rejected three times
because each pass discovered one more surface from a bug report instead of from
an inventory.

### ⚠ THE AVATAR ORBIT WAS INVISIBLE TO EVERYONE BUT ITS OWNER (fixed 2026-08-24)

`grep -rn 'AvatarOrbit' src` returned ONE file: `ProfileScreen.jsx`, your own
profile. So a cosmetic whose whole purpose is to be seen by other people was
seen by nobody, for its entire life. Found by inventorying mount points while
writing `docs/effects/15-avatar-orbit.md`, not from a report.

**Rule this leaves: when an effect ships, grep its mount points and confirm it
renders on the VISITOR-facing screen, not just the owner's.** An unlock only
you can see is not a reward.

Two things were needed and either alone still looks broken: the orbit must
render there, AND `themeTokens()` must run there, because `.vg-orbit` consumes
`--vg-accent-faint/-dim/-bloom` and `PublicProfileScreen` never called it.

⚠ **`useEffectEnabled` calls `useMemo`, so it must sit ABOVE every early
return.** Placing it next to the accent put it after
`if (loading) return <ProfileSkeleton/>`; the hook count then changed between
renders, React threw **#310**, and the screen went to ErrorBoundary. The
Vanguard mask is applied at the use site as a plain boolean — a mask must never
gate a hook.

⚠ `NativeProfileScreens` still has NO orbit. Remaining gap.

### 🎛 The Appearance panel is THREE TABS, not one long page (2026-08-24)

`CosmeticEquip.jsx` = **Name / Profile / Effects**. Founder: "I don't want a 100
mile long page that users need to scroll through just to make a change." Every
unlock had been appended as one more full-width Row, so the page grew with every
ship. A new unlock now joins a tab instead of lengthening the page.

⚠ **NO OUTLINE-ONLY SELECTED STATES IN THIS PANEL.** Founder: "I HATE THE
OUTLINE FAKE GLASS you used for the selected/active typeface, this is bad UI and
I can't stand how cheap it looks." Selection is a SOLID accent fill plus a real
value step, never a hairline ring on a transparent box. Same rule as
[[feedback-no-border-soup]].

⚠ **The animated-name TOGGLE lives WITH the gradient it switches on.** They were
two separate sections for one feature, which is what made the page feel endless.

⚠ **"Profile theme" is now "Profile gradient", and the copy is honest.** The
multi-surface theme system was deleted 2026-08-24; what survives is exactly one
gradient behind the profile plus the accent. The heading still said "theme" and
"surface treatment" long after that stopped being true, which is why it read as
dead UI.

⚠ **`accentFor()` in `rankUnlocks.js` is THE ONE ACCENT RESOLVER.** All three
profile screens hand-rolled `PROFILE_ACCENTS.find(...)`, so a free-hex accent
would have worked in the picker and silently done nothing on two of them — and
desynced the avatar orbit, which reads the same token. Free hex is
`cosmetics.accentHex`; the 12 presets stay as `cosmetics.accent`.

### 🔤 18 typefaces, demand-loaded (2026-08-24)

`src/utils/nameFonts.js`. Founder: "there are only 3 options for typeface? can't
we add cool and weird fonts". The old three-font list used cost as an excuse to
avoid work.

⚠ **The cost concern was real; the conclusion was lazy.** The risk is a chat
with 30 speakers pulling 30 fonts. The fix is DEMAND LOADING, not fewer fonts:
`ensureNameFont(id)` injects a family's stylesheet the FIRST time a name using
it renders, once per page, weight 400 only, `display=swap` so a name is never
invisible mid-load. Verified live: all 18 render, and the app's own three
(DM Sans / Syne / DM Mono) never trigger a fetch.

⚠ **NO CSP CHANGE WAS NEEDED — checked, not assumed.** `tauri.conf.json`
already allows `fonts.googleapis.com` in `style-src` and `fonts.gstatic.com` in
`font-src`, so this works in the native build too. Cost to Vergr is zero;
Google serves the files.

⚠ **The enum is mirrored in `firestore.rules`.** Add a face to `NAME_FONTS` and
to that list together, or the picker offers something the server refuses.

### 🎨 Name colour + typeface — SHIPPED + DEPLOYED 2026-08-24 (doc 04)

`cosmetics.nameColor` (free hex, L12 `name_color`) and `cosmetics.nameFont`
(enum, L3 `name_font`). Both resolve in `<UserName>`.

⚠ **DO NOT USE `inkFor()` FROM `profileThemes.js` FOR ANY NAME OR TEXT COLOUR.**
It ONLY DARKENS (`c * 0.95`, 40 times), which is right for dark ink on a light
surface and catastrophic on Vergr's near-black ones: it drives a dim colour to
invisible. It is also not exported. Use `ensureContrast()` in `utils/color.js`,
which picks the direction from the background luminance.

⚠ **The font is a CURATED ENUM and must stay one.** A free font choice is a
webfont download, and live chat with 30 speakers would be up to 30 font loads on
the busiest surface in the app. The three options are the families already
loaded (Syne / DM Sans / DM Mono). Verified live: equipping one loads ZERO new
families. Enforced in firestore.rules as `in ['default','display','mono']`.

⚠ **Colour precedence, since three systems now colour the same text:** gradient
(L63) > user's chosen colour (L12) > rank colour (L3) > inherit. The Vanguard
mask beats all of them; `context="plain"` opts out entirely.

`scripts/name-contrast-check.mjs` (34 assertions) is in `npm run check`, so the
build fails if any name colour could render illegibly. Measurement corrected the
doc's own guesses: `violet` 3.25:1 and `ruby` 4.12:1 really did fail, but `onyx`
— flagged as the likeliest failure — measures 6.03:1 and was always fine.

### 🎨 Animated name gradient — SHIPPED + DEPLOYED 2026-08-24 (doc 03)

⚠ **The user picks the colours AND how many** (2 to 6). Founder: "what if the
user doesn't want 3 colours? why must you try to force things", and "forcing the
user to select from swatches is bad UX". So: ONE `GradientEditor` with a ramp,
a chip per stop, add/remove, and a shared `ColorField` picker carrying a
**screen eyedropper** (`EyeDropper` API, Chromium-only, feature-detected) —
"most people don't know the codes".

⚠ **The gradient IMAGE is built in JS** (`nameSweepImage()`), not from CSS
custom properties, because the stop count varies and CSS cannot loop.
`.vg-name-sweep` still owns the clip, fill, size and animation, so the
seamless-loop maths lives in exactly one place.

Three colours the USER PICKS, sweeping through their name on every surface.
Founder: "it is after all their achievement and not our choice", and "forcing
the user to select from swatches is bad UX". So the UNLOCK is earned (L63
`name_effect`); the colours are free hex via a real picker
(`src/components/prestige/ColorPicker.jsx`: SV field, hue slider, hex input,
accents demoted to presets). Stored at `users/{uid}.cosmetics.nameGradient
{a,b,c}`.

⚠ **A LOOPING GRADIENT MUST TRANSLATE BY EXACTLY ONE PERIOD OF A PERIODIC
IMAGE, or it flickers, and no easing hides it.** The old one ran
`background-size: 220%` animated `220% → -20%` — a 240% journey across a 220%
image, so every cycle snapped to a new phase. Now: a `200%` image holding TWO
identical A→B→C→A cycles, starting and ending on A, animated `0% → 100%`, which
is exactly `(element − image)` = one period. Verified by pausing via
`getAnimations()` and comparing a zoomed screenshot at `0%` and `100%`:
pixel-identical.

⚠ **The gradient is `90deg` on purpose.** An angled one has a vertical
component, so horizontal translation would not land on the same pixels and the
seam comes back. A tilt is worth less than a clean loop.

⚠ **Colours are hex-validated in THREE places** (`isHexColor`,
`nameGradientFor`, and `hexOrAbsent` in firestore.rules) because they are
interpolated into a `linear-gradient()` through a CSS custom property, which can
carry arbitrary tokens. The picker is not the boundary.

⚠ **`cosmetics.nameEffect` had been an INERT toggle** on /prestige — nothing
read it, ever. Now honoured as an OPT-OUT (undefined = on), matching
`isEffectOn()`. Add to the list of controls that were trusted and did nothing.

Full record, including the two-colour version that could not read on a short
name: `docs/effects/03-name-gradient.md`.

✅ **`<UserName>` IS BUILT, MIGRATED AND GUARDED (2026-08-24, SHIPPED + DEPLOYED).**
167 instances. Username font, username colour, the animated name gradient and
the animated chat crest are now one edit to one file each.
Full record: `docs/effects/01-username-component.md`.

Proven on the live `@vergr` account rather than by inspection: one display-name
change in `/edit-profile` propagated to three `<UserName>` renders at 12px, 14px
and 22px, with 0 computed-style mismatches. `npm run check` (31 assertions,
negative-tested both ways) now runs as `prebuild`, so a build cannot pass while a
name is rendered outside the component.

⚠⚠ **THE CODEMOD SHIPPED 36 BROKEN SITES AND `npm run build` WAS GREEN EVERY
TIME.** The single most valuable lesson of that session. `{a.displayName}` means
three different things depending on the character before the `{`:

- JSX child — the only place it may become an element
- `` `Invited ${a.displayName}` `` — the `$` is stranded and the element text
  lands INSIDE the string; a toast read literally ``Invited $<UserName ... />``
- `alt={a.displayName}` — **JSX legally accepts an element as an attribute
  value, so it COMPILES.** `alt`/`title` became `[object Object]`;
  `value=<UserName/>` broke the display-name input on `/edit-profile` and on
  vergr.me; `CoinCard`'s `otherName` calls `.toUpperCase()` on it and **crashed
  the DM thread**; and 13 sites put raw JSX into `<title>` and `og:title` on the
  indexed SEO pages.

`scripts/username-repair.mjs` undid it by replaying the patterns against HEAD.
The codemod now carries `CTX = (?<![$=])` on every `displayName` pattern.
**A green build proves the syntax parsed, never that the app works.**

⚠ **`scripts/username-sites.mjs` OVER-REPORTS** — its OBJECT regex also matches
`${x.username}` and `alt={x.username}`. Trust the codemod's own dry-run count.
And a name is only migratable if a USER OBJECT is in scope: a `.toUpperCase()`d
string, a `chatPartner()` `{name, avatar}`, a stream doc's `hostName` and a
post's denormalised author snapshot all correctly stay strings. A NICKNAME must
never carry the other person's cosmetics: it is your private label, not their
identity.

### ⚠ Every deploy broke the whole SEO surface for 10 minutes (fixed 2026-08-24)

Found while verifying the above, and it is not a migration bug.
`functions/ugcRenderer.js` cached the SPA shell for **10 minutes**. Vite
content-hashes every chunk, so a deploy DELETES the old ones, and for ten
minutes `/u/**`, `/post/**`, `/clip/**` and `/live/**` — exactly the pages
Googlebot crawls — booted a bundle that no longer existed. The route chunk 404s,
the SPA rewrite answers that 404 with `index.html` (**HTTP 200, text/html**), the
dynamic import fails on the MIME type, and ErrorBoundary paints "Something went
wrong". Nothing reported it.

Fixed with a conditional GET: Hosting serves `index.html` as `no-cache` WITH an
ETag, so revalidation costs a 304 with no body. 5s burst guard for crawl spikes;
the ETag, not the clock, is what keeps it correct. Verified 8s after a deploy:
static and both SSR routes all reported the same new bundle hash.

⚠ A 200 on a missing asset does NOT mean the asset exists — the SPA rewrite
returns `index.html` for anything unmatched. Check `content-type`, not status.
## 🤝 HANDOVER: profile cosmetics + effects — `docs/HANDOVER_PROFILE_COSMETICS.md`

A NEW SESSION PICKING UP THE EFFECTS WORK READS THAT FILE FIRST. It carries the
process the founder requires (research with sources -> exhaustive file
inventory -> doc -> build -> verify by measurement in Chrome), the full list of
mistakes that shipped, and the remaining checklist.

⚠ The single most repeated error it exists to stop: **there are FOUR profile
views, not one** (web own, web public, native own, native public). Work done on
`ProfileScreen.jsx` alone leaves the page every OTHER user sees untouched, which
is how the avatar orbit shipped visible to nobody but its owner.

---
## 📒 SESSION-BY-SESSION RECORD: `docs/UPDATE_LOG.md`

Newest first, and every entry is labelled **SHIPPED**, **DEPLOYED** or **SOURCE
ONLY**. Two sessions now run against this repo (two Claude accounts), so append
there rather than only editing sections of this file, or the two lose track of
each other. "Done" with no deployment state is banned in that file for the same
reason it is banned here.

---

## ▶ Active build queue (READ FIRST each session)

Work **one item per session**; checkpoint to this file before `/clear`. Founder tracks granular completion in a Google Doc (a "Done =" acceptance test per task). **Do NOT trust "batch done" — verify each task** (show the diff, run `npm run build`, deploy if user-facing) and state plainly what was NOT done.

---

## 🏆 TOURNAMENTS — ❌ DEAD SECTION, NOT CURRENT WORK (retired 2026-08-09, verified unrouted 2026-08-16)

> **Do not work from this section and do not cite it.** Tournaments were retired from the product.
> `AppRouter.jsx` mounts exactly ONE tournament route and it is admin-only
> (`/vanguard/lookup/tournament`). `public/llms.txt` states publicly that Vergr has no betting,
> wagering, prediction markets, prize competitions, loot boxes or games of chance. The screens and
> Cloud Functions remain on disk under the no-deletion rule. Everything below is kept ONLY as a record
> of what those files do, should they ever be revived. It is not a queue, not a TODO, and nothing in
> it is "next up".

Comprehensive audit 2026-05-25. Tournaments are functional but have real gaps before they're ready for real users. Don't trust prior "shipped" labels — verify each item with code reads + smoke tests.

**CORE LIFECYCLE AUDIT 2026-05-26 (1v1 single-elim spine):** Traced create → join → start → verify → report → advance → finalize → payout in code. **Spine is correct**: join does atomic coin escrow + prizePool increment; start seeds + builds round-1 match docs (`match.player1`/`player2` hold UIDs) + flips status `active`; report needs two-player agreement or trusted source, routes disagreement to `disputed`; advance handles byes + auto-finalizes the final; finalize is winner-takes-all + idempotent (`payoutStatus:'paid'` inside the tx) + awards TP/VP/XP. **Findings:** (1) ✅ FIXED — `joinTournamentSecure` ran `assertKycVerified`+`assertRegionAllowed` unconditionally, blocking FREE-tournament joins for non-KYC users; now gated on `entryFee > 0` (free = no KYC, so friend-tests work). (2) ✅ FIXED 2026-05-26 — `recordMatchResultInternal` now rejects non-trusted (player/host) result reports unless BOTH sides have engaged verification (status `verified` OR `self_attested`). Trusted sources (admin/vanguard/gsi/gameapi) bypass so mods can unstick a match; only enforced when the match has a `verifyState` scaffold (byes/legacy skip). Accepts `self_attested` (not just `verified`) so manual/"Other" games without OCR/mod still complete. Deployed on `reportMatchResultSecure` + `reportGameResultSecure`. (3) ⚠️ OPEN (low) — a bracket round consisting ENTIRELY of byes wouldn't re-trigger `advanceBracketAfterMatch`; only possible in odd non-power-of-2 shapes (2/4/8/16-player are fine). Still UNVERIFIED by a live run: a real friend-test tournament end-to-end (the actual smoke test).

### Anti-cheat & verification gaps (CRITICAL — money on the line)
| # | Item | Status |
|---|---|---|
| AC1 | **Live in-match score OCR pipeline** (separate from lobby-code OCR which IS wired). Continuous Tesseract pass against broadcaster's stream, 1 frame / 10s, per-game crop region defined in `tournamentGames.js` (e.g. CS2 score `{x:920,y:30,w:80,h:50}`), writes `match.liveScore.{playerUid}` + `match.liveScoreSource.{playerUid}='ocr'`. Overlay `TournamentOverlayNeon` already has the slot ready. Calibrate top 3 games first (FIFA/NBA2K/CS2). ~30min per game. | ✅ SHIPPED + DEPLOYED 2026-05-26. Built as a 10s self-loop INSIDE the `vergr-ocr` Hetzner box (NOT a Cloud Function — avoids quota burn + base64 round-trips). Box now runs Firebase Admin (creds `/etc/vergr-ocr/firebase-admin.json`, reused from rtmp-auth); every 10s scans `streams` where `status=='live'` with a `tournamentId`, finds the `in_progress` match, looks up the game crop region, OCRs the cropped scoreboard (`/ocr` gained fractional `crop{x,y,w,h}` + `digitsOnly` whitelist), parses "A - B", writes `match.liveScore.{uid}` + `liveScoreSource.{uid}='ocr'` + `liveScoreAt`. Overlay already reads these (no FE change). Crop regions: `src/utils/tournamentGames.js` `liveScore` field (cs2/fc25/nba2k) MIRRORED in `infra/vergr-ocr/main.go`. ⚠️ Crop fractions are STARTING values — refine vs a real broadcast frame per game. More games = add a `liveScore` region to BOTH files. Deploy: scp 3 files to `/opt/vergr-ocr/src/`, `go mod tidy && go build -o /opt/vergr-ocr/vergr-ocr`, `systemctl restart vergr-ocr`. |
| AC2 | **Lobby code OCR auto-verification.** ⚠️ Prior "optimised for chat only" note was WRONG — there was NO automated lobby-code scanner at all (`ocrVerifyMatchPlayer` in `matchVerification.js` was a receiver nothing called; verification was mod+self-attest only). BUILT + DEPLOYED 2026-05-26: the `vergr-ocr` 10s loop now also OCRs each player's OWN gameplay stream (found via `streams.hostUid` + `tournamentMatchId`), full-frame text search for the `VERGR-XXXX` code (tolerant of OCR glyph confusions), and on a hit flips `match.verifyState.{uid}='verified'` source=ocr + fires the same `tournament_match_verified` / `tournament_match_ready` notifications the callable would (direct Firestore writes — no Cloud Functions deploy needed). Full-frame search covers ALL 4 verifyMethods (chat/name/lobby_name/match_screen) at once. 🟡 Remaining = optional per-method×game crop calibration to tighten accuracy: populate `lobbyCropRegions["<game>:<method>"]` in `infra/vergr-ocr/main.go` (empty = full-frame, the robust default). | ✅ scanner shipped; 🟡 crop calibration optional |
| AC3 | **Real-time during-match cheat-flag pass** — `aiCheatFlagVod` only runs AFTER VOD is archived. Flags land minutes after the match. Stream-time sampling would let mods intervene live. | ✅ DEPLOYED 2026-05-27. New cheat-scan self-loop in the `vergr-ocr` Hetzner box (`infra/vergr-ocr/main.go`, default 30s/match), runs alongside the AC1/AC2 loops. For each LIVE stream carrying tournamentId+matchId+hostUid whose match is `in_progress`, grabs the latest gameplay frame and sends it to **Gemini 1.5 Flash** (cheap) with a single-frame cheat-tell prompt (visible ESP/wallhack overlays, injected menus, radar overlays — explicitly NOT aimbot-from-a-still). On a verdict that WORSENS (clean→suspicious→likely_cheat) it writes a `tournament_review_queue` doc (source `live_sampling`, consumed by the Vanguard Review Queue) + pre-emptively notifies both players (`tournament_flagged_for_review`, FCM-allowlisted). Always stamps `match.liveCheatFlag.{overall,at}` (overlay/mods read it). **AI suggests, mod confirms — no auto-DQ. COST CONTROLS:** only in_progress tournament matches; 30s cadence (not 10s); Flash not Pro; `app_config/general.liveCheatSampling=false` kills it instantly (no deploy); `app_config/general.liveCheatDailyCap` (default 3000) hard-caps Vision calls/UTC-day; review docs only on verdict-worsening (no per-tick spam); unparseable Gemini output treated as clean (never false-flags). Box env gained `GEMINI_API_KEY` (set from the GEMINI_POST_IMAGE_KEY secret). Deploy: scp `main.go` → `/opt/vergr-ocr/src/`, `go build -o /opt/vergr-ocr/vergr-ocr .`, `systemctl restart vergr-ocr`. ⚠️ Prompt tuning + per-game ESP-overlay calibration want refinement against a real cheating VOD; UNVERIFIED on a live match (none streaming). |
| AC4 | **Webcam face-presence check mid-match** — webcam mandatory at >5000c but we don't verify the player's face stays in frame. Player could point cam at the wall. Gemini Vision face-detection on the proof feed (1 frame / 60s) would catch this. | ✅ DEPLOYED 2026-05-27. In the `vergr-ocr` cheat-scan loop: for HIGH-STAKES matches (`tournament.entryFee > 5000`), per participant, throttled ~60s, fetch the latest proof-feed chunk (`match.proofFeed[uid].chunks[]` newest by idx, a composite game+webcam-PiP WebM on R2), extract a frame, ask Gemini Flash `{face:true|false}` (the proof feed includes the webcam inset). 3 consecutive no-face samples → `tournament_review_queue` (source `face_absent`) + `tournament_flagged_for_review` notice to the player ("keep your face in the webcam"). On Gemini error/unparseable → assume face present (never false-flags). Counts against the same daily Vision cap. Mod hint, no auto-action. |
| AC5 | **Two-devices-one-account detection** — fingerprint binds THIS device but doesn't catch a player running Vergr on phone + cheats on a separate PC playing the same Steam account. | ✅ DEPLOYED 2026-05-27 (implementable portion). `enrollOrCheckFingerprint` now takes `matchId` and binds the FIRST device fingerprint seen per (match, uid) on `match.deviceBinding.{uid}`. A reload/crash on the same machine = same fingerprint (no flag, plays nice with IM2). A DIFFERENT fingerprint for the same account while the match is live → `match.deviceBindingFlag.{uid}` + `tournament_review_queue` (source `two_device`) + a `tournament_flagged_for_review` notice ("play and run Vergr on the same machine"). Mod hint, no auto-action, idempotent per second-device. **Residual limit (honest):** the pure "Vergr always on phone, game always on a separate PC" case shows only ONE fingerprint so there's no divergence to catch — that attack is bounded by requiring the desktop anti-cheat scan (AC1 native scan) to run on the gaming machine, not by this signal. This catches device-SWITCHING within a match. |
| AC6 | **Stream-source spoof fingerprint** — broadcaster could feed a fake video instead of live game capture. We don't fingerprint the stream source. | ✅ DEPLOYED 2026-05-27. Free perceptual-hash heuristic folded into the `vergr-ocr` cheat-scan loop (no Vision call): computes a 64-bit average-hash (8x8 cell-centre luminance) of each sampled gameplay frame, tracks consecutive near-identical frames per stream (Hamming <4); ~6 frozen samples (~3 min frozen mid-match) → stamps `match.liveCheatFlag.spoofSuspected` + `tournament_review_queue` (source `spoof_static`). Re-arms when motion resumes. Low-confidence mod HINT only — a paused/looped fake feed is the target; never an auto-DQ. |
| AC7 | **Quarterly cheat-signatures refresh** — seed of ~40 was deployed once. Need a cadence (founder review or cron import from a public BYOVD list). | ✅ DEPLOYED 2026-05-26 (cadence-nudge form). New `cheatSignaturesHealthCron` (`functions/cheatSignaturesRefresh.js`, monthly `0 6 1 * *` UTC, re-exported from index.js): reads `cheat_signatures`, computes newest-signature age, writes `app_config/cheat_signatures_health`, and when empty or >90d stale pushes every `role:'admin'` a `cheat_signatures_stale` notification (added to FCM allowlist) deep-linking `/admin/cheat-signatures`, de-duped per month via `cheat_signatures_alerts/{YYYY-MM}`. Client staleness banner added to CheatSignaturesScreen (computed from the loaded list, no cron dependency). **Deliberately NOT auto-fetching an external BYOVD feed** (loldrivers.io etc.) — a feed format change would flood `pending` docs + is a supply-chain surface; the reliable zero-cost core is the staleness nudge prompting founder review. Opt-in auto-import deferred. |
| AC8 | **Detection of suspended/uninstalled launchers mid-match** — Tauri scan catches running cheat tools, not absent legit ones. Steam closed mid-match = silent. | ✅ DEPLOYED 2026-05-27 (backend-only, no Tauri rebuild — the native scan already sends the full process list). `submitAntiCheatScan` checks the submitted processes for a known game launcher (`LAUNCHER_EXES`: steam/EA/Battle.net/Epic/Riot/Ubisoft), stamps `match.antiCheat.{uid}.launcherSeen` once one is seen, and if a later `in_progress` scan has NO launcher running (was seen, not already flagged) writes `match.antiCheat.{uid}.launcherGone` + an `anti_cheat_alerts` doc (kind `launcher_gone`, orange) + a `tournament_flagged_for_review` notice. Mod hint, no auto-action. (Game-specific launcher narrowing via `linkedPlatform` is a possible refinement; the universal "launcher present→absent" transition is the robust signal.) |
| AC9 | **macOS minimum doc + enforcement** — `getDisplayMedia` needs macOS 13+. Mac players on older OS can't claim high-stakes wins. Need explicit version-gate at tournament join for Mac users. | ✅ DEPLOYED 2026-05-26. At join of a high-stakes tournament (`entryFee > WEBCAM_PRIZE_THRESHOLD` 5000c), MatchDetailsScreen `handleJoin` runs `highStakesCaptureSupported()` — **feature-detects `getDisplayMedia` (the true macOS 13+/Safari 16 requirement)** plus a best-effort UA-CH `platformVersion` macOS<13 check (raw UA OS-version parsing is unreliable: Apple freezes the string). On fail it blocks with a clear "screen capture required, macOS 13+ or current browser, you can still spectate" modal and does NOT escrow. Server mirror: `joinTournamentSecure` accepts `displayCaptureSupported` and rejects high-stakes joins when explicitly false (defense in depth — the hard enforcement remains the proof-feed wall in `recordMatchResultInternal`, so a spoofed `true` just fails at claim time). `joinTournamentSecure` firestore.js wrapper now takes an opts arg. |

#### AC3-AC9 implementation plan (infra block — drafted 2026-05-26, NOT yet greenlit)
Honest grouping by effort class. AC3/AC4/AC6 are NOT screen edits — they extend the `vergr-ocr` Hetzner box's existing 10s loop with Gemini Vision sampling (recurring API cost). AC5/AC7 are backend heuristics/crons (≈€0). AC8 is a native Tauri scan extension. AC9 is a small join-time gate (codeable now, ≈€0).

- **Group A — live stream-time Vision sampling (on `vergr-ocr`, recurring Gemini cost).** The box already runs Firebase Admin + a 10s loop + grabs stream frames (AC1/AC2). Extend it, do NOT add Cloud Functions.
  - **AC3 real-time cheat-flag:** every ~30s per in-progress match, send the latest gameplay frame to Gemini Vision with the same cheat-tell prompt `aiCheatFlagVod` uses post-VOD; on a non-clean verdict write `tournament_review_queue` doc + `tournament_flagged_for_review` notif (already an allowlisted push type) so mods can intervene LIVE instead of minutes later. Cost driver = frames/min × live matches. Gate behind `app_config/general.liveCheatSampling` so it can be throttled/killed.
  - **AC4 webcam face-presence:** sample the proof-feed webcam PiP (high-stakes matches only, `entryFee > WEBCAM_PRIZE_THRESHOLD`) 1 frame / 60s through Gemini Vision face-detect; if no face for N consecutive samples, write a soft flag to the match + nudge the mod. Cheap (only high-stakes, 1/min).
  - **AC6 stream-source spoof:** perceptual-hash consecutive frames; a feed that is too static / loops / matches a known VOD fingerprint = flag. Heuristic first (frame-diff entropy), Vision only on suspicion. Lowest confidence of the three — frame it as a mod hint, never an auto-DQ.
- **Group B — backend heuristics / crons (≈€0).**
  - **AC5 two-devices-one-account:** cross-reference `tournamentFingerprint` enrollments + login/session activity; flag when the same account has an active Vergr session on device X but the game-account telemetry (GSI/wrapper) originates elsewhere, or two distinct fingerprints touch one match slot. Backend trigger + mod flag, no native.
  - **AC7 cheat-signatures refresh cadence:** monthly cron that pulls a public BYOVD/cheat-tool list into `cheat_signatures/` as `pending` for founder review at `/admin/cheat-signatures` (don't auto-activate). Plus a staleness banner when the seed is >90d old.
- **Group C — native (Tauri) + gate.**
  - **AC8 absent-launcher detection:** extend `scan_processes` to also report whether the tournament's required game launcher (Steam/EA/Battle.net per `tournamentGames.js`) is RUNNING; `submitAntiCheatScan` flags a mid-match disappearance (was present at match start, gone now). Native scan already exists — this is an additive check, not v2 overlay work.
  - **AC9 macOS version gate (smallest, codeable now, ≈€0):** at join of a high-stakes tournament (`entryFee > WEBCAM_PRIZE_THRESHOLD`), parse `navigator.userAgent`/`navigator.userAgentData` for macOS <13 and block with a clear "macOS 13+ required to claim high-stakes wins — you can still spectate" modal (mirror the existing two-camera explainer copy). Server mirror in `joinTournamentSecure` so it can't be bypassed.

**Recommendation:** ship AC9 + AC7 first (self-contained, €0, no infra risk). Group A needs a founder cost decision on Gemini Vision sampling cadence before building (it is the only recurring-cost item). AC5/AC6/AC8 are medium backend/native work with diminishing confidence — schedule after Group A's value is proven.

### Operational tournament flow (P0 — blocks "users can actually run real tournaments")
| # | Item | Status |
|---|---|---|
| OP1 | **TournamentApplicationsScreen has placeholder buttons** ([src/screens/tournaments/TournamentApplicationsScreen.jsx:4](src/screens/tournaments/TournamentApplicationsScreen.jsx)). Wire `approveTournamentApplication` / `declineTournamentApplication` callables to actual buttons. Backend exists, UI doesn't fire. | ✅ ALREADY WIRED (verified 2026-05-26). Buttons call `handleResolve` → `approveTournamentApplication`/`declineTournamentApplication` (firestore.js → exported callables in `tournaments.js:2588`). The "placeholder/not implemented" header comment was STALE; corrected. No build change was needed, only the comment. |
| OP2 | **TournamentScreen overview shows dummy spotlight data** — the top "tournament of the day" card uses placeholders. Wire to `tournament_discovery/{daily}` doc (cron already populates). | ✅ DEPLOYED 2026-05-26. (Note: it was never "dummy" — it derived spotlight client-side from the loaded list.) TournamentScreen now prefers the cron-curated pick at `featured/tournament_of_the_day` (NOT `tournament_discovery/{daily}` — that path was wrong) via new `getFeaturedTournament()` in firestore.js, falling back to highest-prize open/live from the loaded list when the curated doc is missing/stale. ⚠️ firestore.js change uncommitted (intermixed with founder WIP). |
| OP3 | **No first-time-player tournament tutorial** — new user clicks Tournaments, sees a list, no explainer of entry-fee → escrow → lobby-code → mod-verify → result → payout. Build a 3-step onboarding overlay (first-time per user, localStorage-gated). | ✅ DEPLOYED 2026-05-26. `<TournamentOnboarding>` in TournamentScreen.jsx: 3-step overlay (Join & escrow → Play & verify → Win & get paid), progress dots, Skip/Next, shown once per device via `localStorage 'vergr.tourney.onboarded'`. Renders on both mobile + desktop. |
| OP4 | **Mobile CreateTournament wizard missing structure picker** — Single Stage / Swiss→SE / RR Groups→SE etc. unavailable on mobile. Mobile users can't create multi-stage tournaments. | ✅ ALREADY DONE (verified 2026-05-26, label was stale — actually shipped in Phase 3.4). MobileWizard renders the "Tournament Structure" Field iterating STAGE_PRESETS (line ~1315) + Series Format + Seeding, same as desktop. |
| OP5 | **"Have you got the game installed?" join warning** — player can join a CS2 tournament without owning CS2 and fail at lobby. Optional warning modal at join with one-click LaunchGameDropdown to test. | ✅ DEPLOYED 2026-05-26. `<GameOwnershipModal>` in MatchDetailsScreen.jsx fires before join: resolves the tournament's game via `gameById`, warns about ownership + escrow/forfeit, embeds `<LaunchGameDropdown>` to test-launch, then Cancel/Register. The Join button now opens this instead of joining directly. |
| OP6 | **Apex/OW2 wrapper auto-detect reliability** — Tier B wrappers break when community APIs change. `wrapperMonitor` alerts admins but acknowledge wrapper games = mod-primary, auto = bonus. Doc this clearly in tournament create flow per game. | ✅ DEPLOYED 2026-05-27. `<WrapperReliabilityNote>` in CreateTournamentScreen renders under the Game picker (desktop + mobile wizard) when the selected game's `detection === 'wrapper'` (Apex, OW2 in `tournamentGames.js`): tells the host auto-detection uses a community API that can break, the match is mod-verified as the PRIMARY result, auto is a bonus, and to plan for a moderator. Derived via `TOURNAMENT_GAMES.find(label===game).detection`; passed into MobileWizard as `isWrapperGame`. |

### Notifications + comms (P1 — blocks "smooth")
| # | Item | Status |
|---|---|---|
| NT1 | **Tournament-starts-in-5-min push to PLAYERS** — `notifyUpcomingAssignments` cron pings MODS only. Build the player-side equivalent. | ✅ DEPLOYED 2026-05-26. Added player pings to `startingSoonPushCron` (`functions/tournamentDiscovery.js`, every 1 min, fires 4.5-6 min before `scheduledStart`): now notifies the PLAYERS themselves ("get ready / check in"), resolving squad `memberIds` for squad-mode tournaments, in ADDITION to the existing follower "tap to watch" ping. Idempotent via `startingSoonNotified` flag. |
| NT2 | **Reschedule flow** — if both players agree to push a match 30 min, no UI exists. They just no-show + dispute. | ✅ DEPLOYED 2026-05-26. `proposeMatchReschedule` / `respondMatchReschedule` callables (`functions/matchVerification.js`); `<RescheduleControls>` in `MatchFlowExtras.jsx` (+15/+30/+1h chips, accept/decline) on TournamentMatchScreen. On accept, stamps `match.rescheduledUntil` (ms); `detectMatchTimeouts` skips matches until that passes, so an agreed delay never auto-forfeits. |
| NT3 | **Tournament cancellation push** — `adminCancelTournament` refunds but doesn't notify. Players check wallet randomly + are confused. | ✅ ALREADY DONE (note was stale). `adminCancelTournament` (`functions/adminTournaments.js:345`) already writes a `tournament_cancelled` notification to every participant inside the refund transaction ("X coins refunded to your wallet"). Verified 2026-05-26. |
| NT4 | **"You've been disqualified" notification copy** — `detectMatchTimeouts` auto-DQs silently. Player just sees their bracket slot vanish. | ✅ DEPLOYED 2026-05-26. `detectMatchTimeouts` already notified players, but the forfeit case sent BOTH sides the same "opponent didn't show up, P1 advances" copy (confusing for the actual no-show). Now per-side: winner gets "you advance", the forfeited/no-show player gets a clear `tournament_match_disqualified` "you were disqualified for not checking in within Xh" message; double-no-show gives both a clear DQ message. New `notifyOne` helper carries a correct match deep-link. |
| NT5 | **"You've been flagged for review"** subject notif when AI cheat-flag fires — currently subject finds out only if mod confirms via Vanguard Review Queue resolution. Pre-emptive notification + appeal path. | ✅ DEPLOYED 2026-05-26. `aiCheatFlagVod` (`functions/tournamentDiscovery.js`) now notifies BOTH participants (`tournament_flagged_for_review`) when a non-clean flag fires. Appeal path: `<AppealReviewButton>` in `MatchFlowExtras.jsx` calls existing `submitAppeal` ({targetType:'tournament_match_review', targetId:matchId}); shown on TournamentMatchScreen when `match.cheatFlag.overall !== 'clean'`. |
| NT6 | **Dispute evidence collection workflow** — disputed matches go to `awaiting_confirmation` but neither side gets an evidence-upload prompt. Mod has to chase in DMs. Build per-side "upload your screenshot of the result" modal. | ✅ DEPLOYED 2026-05-26. `uploadDisputeEvidence` callable (`functions/matchVerification.js`) writes `match.disputeEvidence.{uid}` + nudges the other side. `<DisputeEvidenceUpload>` in `MatchFlowExtras.jsx` (compress → R2 `tournament` kind → record) renders on TournamentMatchScreen for players when `status==='disputed'`, showing both sides' submit state. |

> **🔔 Notifications now PUSH (2026-05-26).** Previously, cron/server-written `notifications/{id}` docs only populated the in-app drawer — there was NO `notifications` onCreate trigger, so they never fired a system/FCM push (only inline events like follow/DM/comment pushed). New `onNotificationCreated` trigger in `functions/index.js` fans out `sendPushToUser` for an ALLOWLIST of types (`PUSHABLE_NOTIFICATION_TYPES` — tournament/match/comms types). Inline-pushed types (follow/comment/like/dm) are deliberately EXCLUDED to avoid double-push. **To make any new server-written notification type push, add its `type` to that Set.** Test util: `functions/scripts/testNotification.js` (writes type `admin_test_notification`, which is allowlisted). ⚠️ `index.js` change is uncommitted (intermixed with founder's WIP) — commit it with your next batch.

### Money / payouts (P1)
| # | Item | Status |
|---|---|---|
| MP1 | **PrizeReceiptScreen** ([src/screens/tournaments/PrizeReceiptScreen.jsx](src/screens/tournaments/PrizeReceiptScreen.jsx)) exists but is never auto-routed. Winners get coins silently. Auto-show on first load after finalize + shareable. | ✅ DEPLOYED 2026-05-26. `finalizeInternal` now sends the winner (solo) / champions (squad) a `tournament_won` notification (added to FCM allowlist → real push) deep-linking to the existing `/prize-receipt/:prizeId` route (prizeId = tournamentId). PrizeReceiptScreen self-loads the prize from `tournament.payoutBreakdown` when opened via the link/share (no longer needs nav state) and gained a Share button (navigator.share / clipboard). Note: the in-match TrophyCeremony already handles the live winner celebration; this closes the "silent payout + not shareable" gap. True auto-popup not added (the push + deep-link is the route-in). |
| MP2 | **Mid-tournament prize-pool live update** — `prizePool` grows as players join, but UI shows the value at page load only. No live counter. | ✅ DEPLOYED 2026-05-26. New `subscribeTournament(id, cb)` Firestore helper (onSnapshot on the tournament doc). MatchDetailsScreen live-patches `prizePool`/`participants`/`maxParticipants`/`status` from the snapshot (one-time load still owns matches + resolved participant profiles), so Prize Pool + Players tiles update without reload; gold pulse dot on the Prize Pool tile while status is open/registration. |
| MP3 | **Squad treasury inflow line-items** — squad members see treasury grow with no breakdown of "which tournament added what". | ✅ DEPLOYED 2026-05-26. Backend ledger already existed (`finalizeInternal` writes a `transactions` doc per squad win with `tournamentId` + `description`). New `getSquadTreasuryInflows()` helper + a "Recent inflows" breakdown list under the Squad Wallet card on SquadDetailScreen. |
| MP4 | ~~**"Tip the moderator" surface for players**~~ | ❌ REJECTED 2026-05-26 (founder) — a player paying coins directly to the mod who judges their match is a bribery vector that corrupts Vanguard neutrality. Do NOT build. Non-monetary thanks is covered by IM4 (`thankMatchMod`). Mod compensation stays the treasury distribution path only. |

### Discovery / list UX (P1)
| # | Item | Status |
|---|---|---|
| DS1 | **TournamentStatsScreen** is built but never linked from anywhere ([src/screens/tournaments/TournamentStatsScreen.jsx](src/screens/tournaments/TournamentStatsScreen.jsx)). Users don't know it exists. Add nav entry + link from profile + post-match. | ✅ DEPLOYED 2026-05-26. Desktop: `TournamentRightRail` "My Stats" card now has a "View All" action → `/tournaments/me/stats`. Mobile: new leaderboard-icon button in TournamentScreen top bar. (Profile + post-match links not added; the tournaments-section links cover discoverability.) |
| DS2 | **No "tournaments hosted by my squads" filter** on TournamentListScreen. | ✅ DEPLOYED 2026-05-26. Added proper `hostSquadId` field: `createTournamentSecure` accepts + validates (caller must be squad member/owner) + persists it; "Hosted By (optional)" picker on CreateTournament desktop + mobile wizard; mapper exposes it; TournamentListScreen "My squads' events" quick filter (shown when viewer is in any squad). Forward-looking — only tags NEW tournaments. |
| DS3 | **No quick filters** — list has Status/Game/Region. Missing: Free entry, ≤50c entry, ≤100 players, this weekend, BR-friendly. | ✅ DEPLOYED 2026-05-26. Quick-filter toggle chips on TournamentListScreen (mobile + desktop): Entry ≤50c, ≤100 players, This weekend (computed Sat-Sun window vs `startMs`), Battle Royale. Independently toggleable, layered on top of status/game/region. (Free entry already existed as a status tab.) |
| DS4 | **No tournament banner upload UI** on CreateTournamentScreen — `bannerUrl` exists on schema, no input field. Lists look bland without banners. | ✅ ALREADY DONE (verified 2026-05-26, label was stale). `<BannerPicker>` in CreateTournamentScreen (desktop line ~482 + mobile wizard ~1262): per-game preset banners + custom upload (`handleBannerFile` → `uploadTournamentBanner` real R2 upload) + clear; `bannerUrl` saved on create. |
| DS5 | **Skill-matched recommendations** — list is chronological. Recommend tournaments matching the viewer's TP (Tournament Points) bracket. Existing `users.tournamentPoints` already powers leaderboard. | ✅ DEPLOYED 2026-05-26. "For my level" quick filter on TournamentListScreen: keeps tournaments whose entry stake is within a comfort ceiling scaled from the viewer's `tournamentPoints` (TP 0 → 100c, capped at 10,000c). Heuristic (no per-tournament skill field exists), but keeps newcomers off whale-stakes events. |
| DS6 | **Champion Picks (predictions) discoverability** — viewer must already know to look in SpectatorPanels. Surface "Predict the winner, earn coins" prompt on the discovery feed for live matches. | ✅ DEPLOYED 2026-05-26. Home discovery rail (`src/components/DiscoveryStrip.jsx`, rendered by ResponsiveLayout) now has a "Predict & Earn" section listing live/active tournaments with a "predict the winner, earn coins" CTA → `/match/:id`. |
| DS7 | **"Follow this match" toggle** for spectators — push notif when this specific match starts. | ✅ DEPLOYED 2026-05-26. `setMatchFollow` callable (arrayUnion/Remove on `match.spectatorFollowers`) + `<FollowMatchButton>` in MatchFlowExtras, rendered on TournamentMatchScreen for non-participants. New `tournamentMatchFollowerPush` trigger pings followers when the match flips to `in_progress` (type `tournament_match_starting`, on FCM allowlist). |
| DS8 | **Followed-player advance push** — bracket pulse exists (shipped). Push notif to follower when their player advances is missing. | ✅ DEPLOYED 2026-05-26. Same `tournamentMatchFollowerPush` trigger: on a match completing with a winner who did NOT win the whole tournament (solo mode; the eventual champion gets `tournament_won` instead), pings that player's `users/{uid}/followers` with type `tournament_player_advanced` (FCM allowlisted). |
| DS9 | **Trophy ceremony for spectators** — only winners + host see it. Spectators who watched the final get nothing. | ✅ DEPLOYED 2026-05-26. MatchDetailsScreen ceremony gate relaxed: now shows to ANY viewer of a completed tournament (winner/host/spectator), still once per user via the existing `ceremonyKey` localStorage gate. |

### In-match (P1/P2)
| # | Item | Status |
|---|---|---|
| IM1 | **No per-match opponent chat** — players in a match can't text each other unless they already follow + can DM. Add lightweight per-match chat that auto-closes on match end. | ✅ DEPLOYED 2026-05-26. `<MatchChat>` in `MatchFlowExtras.jsx`, rendered on TournamentMatchScreen for players when an opponent exists. **Decision: Firestore subcollection `tournaments/{tId}/matches/{mId}/chat`, NOT the Hetzner WS relay** — the LOCKED "chat rides the relay" rule targets the high-volume stream-chat firehose; a 2-player match thread is low-volume and benefits from persistence as a dispute trail, so Firestore + zero new infra wins. Input auto-closes (read-only) when `match.status` ∈ {completed, cancelled, disputed}; history stays visible for mods. firestore.rules: only the two match participants (own `senderUid`) may create; anyone may read; update/delete admin-only. No AI moderation pass (2 identified players in a money match, abuse reportable via existing ReportOpponentButton). |
| IM2 | **No crash-recovery re-entry flow** — alt-F4 + reload = re-do lobby verification + scan consent re-prompt. Friction. Cache verified-state per device. | ✅ DEPLOYED 2026-05-26. Per-device localStorage caches in TournamentMatchScreen.jsx: `vergr.scanConsent.{uid}` (= SCAN_SCOPE_VERSION) is a fast-path that skips the async getDoc + consent modal on reload when this device already consented at the current scope (written on modal accept AND when the server read confirms consent); `vergr.matchVerified.{matchId}.{uid}` seeds `revealShown` so the lobby-code reveal does not replay once this player is verified. Server stays source of truth: verifyState lives on the match doc (re-hydrated by the snapshot) and the `recordMatchResultInternal` verifyState gate is untouched. Caches only suppress the UI flash during the reload window. |
| IM3 | **"Report this opponent" surface on match screen** — only available via long DMs flow currently. | ✅ DEPLOYED 2026-05-26. `<ReportOpponentButton>` on TournamentMatchScreen result screen (reason chips + detail box) files a `user` report via the existing `submitReport` callable, tagged with tournament/match id in details. |
| IM4 | **Mod thank-you after match** — players never see who decided their match. Show mod's rank badge + handle + "Thanks for the call" optional button. | ✅ DEPLOYED 2026-05-26. `<ModThankYou>` on the completed-match screen shows who decided it (identity-masked "a Vanguard mod") + one-tap thanks; new `thankMatchMod` callable notifies the mod (`tournament_mod_thanks`, FCM allowlisted, one per player per match). |

### Auto-generated content (P2)
| # | Item | Status |
|---|---|---|
> **AG direction correction (founder, 2026-05-26):** clips are USER-AUTHORED — the user creates and chooses their own clips; we do NOT auto-publish or algorithmically curate. The `autoCutVodHighlights` cron output is repurposed as a PRIVATE "suggested moments" tray the owner picks from. AG2 (algorithmic engagement-ranked reel) was reverted before commit/deploy and is dropped. AG3 (public auto-publish) was reverted.

| AG1 | **VOD highlights playlist per user** → **private "suggested moments" tray** — `autoCutVodHighlights` output exposed only to the owner as suggestions. | ✅ DEPLOYED 2026-05-26 (corrected form). "Suggested moments" Section on TournamentStatsScreen (`/tournaments/me/stats`, owner-only) flattens the Gemini-cut clips (`match.highlights[]`) across the user's completed matches with an `archiveVodUrl`, newest first (cap 12). Copy makes clear these are private AI suggestions, nothing published until chosen. `<HighlightCard>` is click-to-load (VOD seeked via `#t=start,end`) + a **"Save as clip"** button that calls `createPost(uid, { type:'clip', mediaUrls:[vodUrl#t=start,end], visibility:'public' })` so a user-CHOSEN clip lands on their profile. Reuses the existing collectionGroup matches query — no new index. |
| AG2 | ~~**Weekly auto-curated reels**~~ | ❌ DROPPED 2026-05-26 (founder) — algorithmic curation conflicts with user-authored clips. Reverted before commit/deploy. No automated "best of the week" reel; discovery of good clips happens through the normal clip/feed surfaces once users publish their own. |
| AG3 | ~~**Tournament VODs auto-pinned to placer profile**~~ | ❌ REVERTED 2026-05-26 (founder) — auto-publishing AI-chosen clips to a user's PUBLIC profile conflicts with "users choose their own." Public-profile "Highlights" tab + `UserHighlightsReel.jsx` removed. Users publish clips themselves via AG1's "Save as clip" → they appear in the normal Clips tab they already own. |

### Growth features (P3 — drives retention)
| # | Item |
|---|---|
| GR1 | **Public tournament host profile** — show host's W/L ratio, fairness rating, mod-calls-overturned %, sponsor tier. Answers "is this host legit?" in one click. |
| GR2 | ✅ DEPLOYED 2026-05-27. **Per-game seasonal leaderboards** — "By Game (week)" category on LeaderboardScreen with a popular-games picker. `getGameWeeklyLeaderboard(gameLabel)` tallies from completed solo tournaments of that game in the last 7 days (match docs lack `game`, tournaments have it), score = wins*3 + participations, top 50 resolved to profiles. ⚠️ Needs the composite index `tournaments(game ==, status ==)` — Firestore prints the create deep-link in the function/console log on first query; click it once. |
| GR3 | ✅ DEPLOYED 2026-05-27. **Squad-vs-squad rivalry tracker** — in squad-mode tournaments the match `player1/player2` hold squad IDs, so the existing `recordRivalryOnMatchComplete` trigger already accumulates `rivalries/{a_b}` keyed by squad. New `getSquadRivalries(squadId)` (two single-field queries on uidA/uidB, keeps pairs met 3+ times) + a "Rivalries" head-to-head section on SquadDetailScreen (opponent tag/name resolved via getSquad, W-L colored, click to opponent squad). |
| GR4 | ✅ DEPLOYED 2026-05-27. **Tournament-themed avatar frames** — `finalizeInternal` stamps `users/{uid}.championFrameUntil` (now+7d) + `championFrameTournament` on the solo winner / each squad champion. `UserAvatar` gained `championFrame`/`championUntilMs` props (gold animated ring + `workspace_premium` crown). PublicProfileScreen renders the gold ring + crown on the main avatar when `championFrameUntil > now` (not for masked Vanguard personas). Frame auto-expires (timestamp compare, no cleanup cron). Reaches UserAvatar callsites that pass the prop; profile is the primary flex surface. |
| GR5 | ✅ DEPLOYED 2026-05-27. **Brawl mode (quickplay)** — instant 1v1 matchmaking. `functions/brawl.js`: `joinBrawlQueue({game,stake})` finds a waiting opponent on the same game+stake (queue `brawl_queue/{id}`); on a pair it runs a transaction that escrows both wallets + SYNTHESIZES a 2-player single-elim tournament + its one match (mirrors the `startTournamentSecure` single-elim shape — `bracketData {format:single_elim,size:2,totalRounds:1}`, match `r1m1`, verifyState scaffold, bo1), so the existing verify→report→advance→`finalizeInternal` flow runs the winner-takes-all payout (2×stake) + TP unchanged. No opponent waiting → enqueue + the caller subscribes to their queue doc for `matchedTournamentId`. `leaveBrawlQueue` cancels. Paid brawls (stake>0) run the same KYC/region asserts as paid entry. firestore.rules: `brawl_queue` read-if-auth, writes callable-only. `<BrawlQuickplay>` modal (game + stake picker, searching state, auto-route on pair) opens from a Brawl button on TournamentScreen (mobile top bar + desktop). |
| GR6 | ✅ DEPLOYED 2026-05-27. **Coaching marketplace** — `functions/coaching.js`: `upsertCoachingListing` (one `coaching_listings/{uid}` per coach: game, title, price, durationMin, blurb, active + denormalized coach name/avatar), `setCoachingListingActive`, `bookCoaching` (atomic: debits learner wallet, credits coach `floor(price*0.9)`, records the 10% fee — rides the coin economy, NOT a new revenue category; creates `coaching_bookings/{id}` + tags a DM thread for scheduling + notifies coach via `coaching_booked` push). New `/coaching` screen (NOT the public `/store` coin-pack marketing page — that's unauthenticated marketing; user-to-user paid listings need an in-app screen): browse active coaches (game-filter chips), book, and a listing editor for your own. Loss-screen CTA on TournamentMatchScreen ("Want pro coaching for <game>?") deep-links `/coaching?game=<label>`. firestore.rules: listings public-read, bookings party-only-read, all writes callable-only. |
| GR7 | ✅ DEPLOYED 2026-05-27. **Squad sponsorship of public tournaments** — new `sponsorTournamentFromTreasury` callable: squad-owner-only, atomically debits the squad treasury, adds to the tournament `prizePool` (+`sponsorBonusCoins`, respects the 500k cap), appends to a `sponsors[]` array + sets the `sponsor` branding, writes a `squad_sponsor_tournament` ledger row. (Distinct from the admin-only branding-only `attachTournamentSponsor` and the member-pooling `contributeToSquadTournament`.) `<SquadSponsorModal>` in HostingExtras (picks one of the viewer's OWNED squads, amount slider capped to treasury, optional branding) opens from a "Sponsor from squad treasury" button on the public-tournament overview. |
| GR8 | ✅ DEPLOYED 2026-05-27. **Battle-overlay variant for two-streamer live streams** — `StreamerBattleOverlay` at route `/overlay/battle/:streamId/neon` reuses the exported `OVERLAY_CSS` + neon layout (top rail, two-cell lower-third, tug-of-war bar) but subscribes to `streams/{streamId}` + the first `linkedStreamIds` opponent stream + each side's host user. Battle meter = per-side tip total (`tipTotal`/`totalTips`/`goal.currentCoins`) → viewer count → 50/50 fallback. OBS browser-source, 1920×1080, transparent, fit-scaled. (`OVERLAY_CSS` is now `export`ed from TournamentOverlayNeon for reuse.) |

### Carried over from earlier batches (verify status before trusting)
| # | Item | Status |
|---|---|---|
| CO1 | Cheat-signatures seed default deployed via admin button (founder click-action) | ✅ done |
| CO2 | Consent scope-version re-prompt logic in TournamentMatchScreen | ✅ done |
| CO3 | VOD pipeline Hetzner deploy (vergr-vod-archive on port 8097) | ✅ done |
| CO4 | Vanguard Review Queue real consequences (auto-DQ on AC red, notifs, audit) | ✅ done |
| CO5 | Tournament prize payout = winner-takes-all locked | ✅ done |
| CO6 | Standings/PrizePool screens wired with real data | ✅ done |
| CO7 | Two-camera proof for high-stakes (recorder + viewer + server gate + R2 cleanup cron + explainer modal) | ✅ done |
| CO8 | Suspicious-moment shareable clip (CheatFlagShareList + CheatFlagClipScreen + VodFlagScrubber) | ✅ done |
| CO9 | HypeMeter wired into BroadcasterScreen + recordStreamReaction backend | ✅ done |
| CO10 | Bracket fly-in + followed-player advance pulse | ✅ done |
| CO11 | Verification chip pulse + OCR-scanning animated text | ✅ done |
| CO12 | Tip-the-winner CTA in TrophyCeremony | ✅ done |
| CO13 | Deep links to game launchers + per-game .exe path fallback | ✅ done |
| CO14 | VOD scrubber rewind/forward + keyboard shortcuts (J/L/arrows) | ✅ done |
| CO15 | Self-hosted coturn TURN fallback (replaces "Cloudflare TURN" plan, €0) | ✅ done |
| CO16 | Tournament Overlay Neon — first OBS browser-source pack, route `/overlay/:tournamentId/neon` with predictions tug-of-war bar + score-source pip + stacked Vanguard rank badges + SCREEN SCAN label | ✅ done |

### Next 3 priorities (recommendation)
1. **NT1 + NT3 + NT4** — notification holes (start-soon ping, cancellation push, DQ notif). Without these real tournaments WILL strand players and you'll get refund disputes.
2. **NT6 + MP1** — dispute evidence flow + auto-routed PrizeReceiptScreen. Each closes a "user is confused" loop.
3. **AC1 + AC2** — live score OCR for top 3 games + lobby-code OCR calibration per verifyMethod. Closes the biggest cheat-evasion vector + makes overlays actually show live scores.

The list above is the source of truth. Move items to "done" only after verifying with a code read + smoke test, NOT after a deploy log.

---

1. **Live-stream screen rebuild** (next up). See "Live-stream screens — rebuild punchlist" below. New mockups: `C:\Users\damie\Downloads\New UI Screens\Streamng-Live stream Screens\`. Order: (a) fix `goLive()` → `createStreamSession` + route to broadcaster; (b) solo broadcast real data (kill the `Math.random` stats + `GCORE_CONFIG` gate); (c) co-host broadcast screen (does not exist — build it); (d) viewer repoint to `cdn.vergr.app` + real stream-doc; (e) chat WS relay on the stream box (NOT Firestore).

2. **Tournament esports** (worked on the founder's other machine; **NOT independently verified in this repo — verify before trusting**):
   - **Phase 0 carry-over UI (a–e):** claim button, commander-review pane (`/vanguard/queue`), squad champion-vote UI (`SquadChampionVote.jsx` reported created), backup roster row, AI-suggestion banner. Prior session hit the usage limit mid-item-(c) — confirm what actually landed.
   - **Phase 1 (next big backend):** series Bo1/Bo3/Bo5 + standard 1v16 seeding + byes. New `functions/tournamentSeries.js` + edits to `functions/tournaments.js` (`reportMatchResultSecure` → `reportGameResultSecure`, Bo1 shim kept; `validateSeriesFormat`). Then **Phase 2** multi-stage + one-time dry-run migration script; **Phase 3** squad rosters + supply gating.
   - **Anti-cheat:** v1 shipped (Tauri webview HUD, 30s process scan vs `cheat_signatures/`, consent modal, `/admin/cheat-signatures` CRUD, mod heartbeat). v2 deferred (native wgpu overlay, Windows.Graphics.Capture, DLL/USB/PCI detection). ⚠️ cheat-signatures seed NOT deployed; consent scope-version re-prompt pending.
   - Full granular punchlist (~60h, P0–P3, with "Done =" tests) lives in the **founder's tracker doc** + `CLAUDE.md.bak`.

---

## 🛑 Current truth (supersedes any stale memory)

**Dead / abandoned — never reference as current, never reintroduce:** MoonPay/Helio Commerce, Cryptomus, NOWPayments, Tebex, Xsolla, Polar, Banxa, Shyft/TymeBank settlement chain, Solana as a settlement chain (replaced by Base USDC). Code for these may still exist in the repo; it is NOT in the live flow.

**Stripe: REMOVED 2026-08-13.** Stripe closed the account, so the rail was deleted outright rather than left dormant: `functions/stripeCheckout.js`, `StripeCheckoutPanel.jsx`, the `createStripeCheckout` helper, the `useStripeReturn` handler, the SDK deps and `VITE_STRIPE_PUBLISHABLE_KEY` are gone; the deployed `createStripeCheckout` / `stripeWebhook` / `handleStripeWebhook` functions were deleted and both `STRIPE_*` secrets destroyed. **Card = PayRam again** (one "Card or crypto" row in `PaymentMethodPicker`; `checkoutFees.js` no longer has a Stripe rail or an `activeCardRail` switch). Play Billing is the other live rail and was untouched. Nothing was left half-wired. Note the product changes made FOR Stripe underwriting (tournaments retired 2026-08-09, predictions removed, 1:1 free + link-only) are now reversible but remain in place pending a founder decision.

### LIVE payment + custody stack (Path C, locked, on Base mainnet)

| Role | Provider | Status |
|---|---|---|
| Inbound onramp (card/Apple Pay/bank → USDC) | **PayRam** embedded checkout on Base | Self-hosted node live; no merchant KYB; end-user KYC via PayRam's onramp partners. |
| Outbound — crypto cashout | **Circle Wallets API** → user's whitelisted Base address | Code ready. |
| Outbound, user cashout | **DOES NOT EXIST.** Removed 2026-08-15. | ❌ There is no user cashout of any kind, fiat or crypto. `requestWithdrawal` is DELETED (2026-08-16). The only outbound path is Vergr paying a CREATOR their revenue share, on Vergr's schedule, via `functions/creatorPayouts.js`. The old "crypto-only cashout" / `FiatCashoutHelper` / Coinbase guidance rows are stale and deleted. |
| Custody (all float) | **Circle Programmable Wallets** (developer-controlled MPC), Circle-only + software guards | Operating omnibus + insurance reserve. No hardware/multisig in v1; software guards = per-tx caps + destination whitelist + timelock + auto-freeze + insurance fund. Upgrade to Safe + Ledger when monthly revenue OR insurance fund > €5,000. |
| KYC | **Didit** (`src/components/verify/KycWizard.jsx`) | Wired. Extend per KYC tiers below. |
| Settlement chain | **Base USDC ONLY**, contract `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` | Per-user attribution via PayRam `refId` (→ `payram_orders/{ref}`) or hex-encoded `vergr:{uid}` in tx `data` field. EVM ERC-20 has no native memo. |

### Firebase Secrets (project `vergr-44494`, region `europe-west1`)

```
CIRCLE_API_KEY                LIVE_API_KEY:... (MAINNET)
CIRCLE_ENTITY_SECRET          64-char hex (mainnet, registered in Circle console)
CIRCLE_WALLET_SET_ID          76fd3094-c7c8-53a5-9d9d-9528a7cc0511 (vergr-omnibus-mainnet)
CIRCLE_HOT_WALLET_ID          9afa3a94-8b26-5796-b5fe-95aecee20877 (SCA, Base mainnet)
CIRCLE_HOT_WALLET_ADDRESS     0xbb1b1445d73cad5df9925b484996dc1f7f032240 (mainnet omnibus = PayRam contract cold wallet)
CIRCLE_BLOCKCHAIN             BASE
WALLET_UNLOCK_SECRET          32-byte hex (PIN unlock-token signing)
PAYRAM_API_KEY                bd2bfb95e9485bb3f4a38f2ae65e762a (Vergr project key)
PAYRAM_NODE_URL               https://payram.vergr.app:8443  (API on :8443 — :443 is the dashboard UI, returns 404 for API)
HETZNER_API_TOKEN             set (Live Stats System tab)
VERGR_SYSINFO_TOKEN           set (in-box sysinfo agent)
```
PENDING secrets: `CIRCLE_NOTIFICATIONS_PUBLIC_KEY` (mainnet webhook signature verify — `pollCircleDeposits` covers inbound until then), `CIRCLE_WEBHOOK_TOKEN`. PayRam needs no webhook secret (API-Key header auth). Gemini moderation keys: `GEMINI_CHAT_KEY`, `GEMINI_POST_TEXT_KEY`, `GEMINI_POST_IMAGE_KEY`, `GEMINI_POST_VIDEO_KEY`. OAuth/wrapper secrets: `STEAM_API_KEY`, `TWITCH_*`, `YOUTUBE_*`, `DISCORD_*`, `BATTLENET_*`, `OPENXBL_*`, `APEX_API_KEY` (placeholder — founder must register at apexlegendsapi.com). Use `printf`/`echo -n` (never `echo`) when setting secrets — trailing newlines broke R2 once (see R2 section).

### 🚦 ~~GO-LIVE READINESS~~ — ✅ COMPLETE. Payments are LIVE.

⚠ **Never say "gated on Base gas" again** (memory `project-payments-live`). The steps below are kept
as a record of what was done, not as outstanding work.

Everything codeable without spending money is done + deployed on mainnet. Remaining to flip live:
1. Fund the MetaMask **master wallet `0x59b5277E6fb2128eee9D4FdFBC2882e8Cb358763`** with ~$1–2 ETH on **Base mainnet** (chain 8453). (In progress 2026-05-22 — founder buying via MetaMask card on-ramp; ZAR card may hit "no quotes" → raise amount ~R450 or use VALR→withdraw on Base network.)
2. PayRam dashboard → Wallet Management → Deposit Wallet → **Deploy Contract** on Base, cold wallet = `0xbb1b1445d73cad5df9925b484996dc1f7f032240`, master = MetaMask (Base 8453). Signs the deploy (the gas spend).
3. Confirm PayRam webhook (Dashboard → Developer → Webhook) → `https://europe-west1-vergr-44494.cloudfunctions.net/payramWebhook`.
4. Crypto withdrawals: Circle omnibus needs a little Base ETH gas + USDC liquidity (runtime funding; code ready).
5. Smoke test: card buy → coins credit (via `payramWebhook`); crypto withdraw → USDC out via Circle.
- Circle **mainnet webhook** subscription still pending → set `CIRCLE_NOTIFICATIONS_PUBLIC_KEY` once located in Circle console; `pollCircleDeposits` (every 5 min) covers inbound reconciliation meanwhile.

### PayRam node — operational facts (Hetzner `91.98.79.244`)

Docker container `payram` (image `payramapp/payram:latest`), host ports `127.0.0.1:18080`(→80)/`18443`/`18081`/`18444`, nginx-reverse-proxied to public `payram.vergr.app`. **API = `:8443`, dashboard UI = `:443`.** Mainnet (`BLOCKCHAIN_NETWORK_TYPE=mainnet`, `SERVER=PRODUCTION`).
- ⚠️ **DB persistence:** PayRam keeps all config (project, API keys, branding, contracts, webhook) in internal Postgres at container path `/var/lib/payram/db`. A `docker rm`+`run` (needed to change env/image) on the original install wiped config → `UNAUTHORIZED`. Fixed: DB now on host mount `/opt/payram/pgdata` (`-v /opt/payram/pgdata:/var/lib/payram/db`, `chown 999:999`). **Any future container recreate MUST keep this mount.** Testnet container kept stopped as `payram_testnet_bak`.
- ⚠️ **Crash mode:** inner `payram-web` can crash-loop on `EADDRINUSE` (:80/:443) while the container stays `Up` → public 504. Fix: `docker restart payram`. Hardened: watchdog `/usr/local/bin/payram-watchdog.sh` + root cron `*/2 * * * *` auto-restarts on 000/502/503/504.
- RPC pool cleaned to Base mainnet only (Sepolia nodes ids 5–8 deactivated). The old testnet deposit contract is stale on mainnet — a NEW Base-mainnet contract must be deployed (step 2 above).
- SMTP unconfigured (`payram.smtp.host not found`) — PayRam's own emails won't send; non-blocking.
- SSH from Windows: copy `~/.ssh/vergr-streaming.key` to temp, `icacls <copy> /inheritance:r /grant:r <user>:R`, then `ssh -i <copy> -o StrictHostKeyChecking=no root@91.98.79.244`.

### Payment Cloud Functions (deployed, mainnet)
`functions/payram.js`: `createPayramPayment` (POST /api/v1/payment, EUR→USD live rate + buffer, fails closed if no rate), `payramWebhook` (GET, API-Key header auth, credits on FILLED/OVER_FILLED), `pollPayramOrders` (5-min reconciler). `functions/circleWallets.js`: `circleWalletsWebhook` + `pollCircleDeposits` (REST-polls inbound USDC, idempotent via `circle_deposits/{txId}`). `functions/withdrawals.js`: `requestWithdrawal`, `cancelWithdrawal`, `getMyWithdrawals`, `processReadyWithdrawals` (3-day hold → Circle createTransaction), admin ones. All settle via shared `payram_orders/{ref}.status: awaiting_settlement → settled` lock (exactly-once across webhook/poll/Circle rails).

---

## 🎯 Master next-session punchlist (LIVING)

### P0 — block public launch
| Status | Build |
|---|---|
| ✅ | Tournament AI moderation Phase 1 (Tesseract via Hetzner `vergr-ocr` + Google Vision OCR, 2-signal consensus; OBS overlay display-only; winners called by Vanguard mods) |
| ✅ | Phase 2 content moderation (chat + post text/image/video Gemini scanner; audit `content_moderation_log/`; auto-hide on block) |
| ✅ | Vanguard per-tournament Moderation Room + 1h scheduling buffer for no-API games |
| 🟡 | Operator account migration (move `role:'admin'` off public `@vergr` to a catch-all `ops-*@vergr.app` Spacemail identity) |
| ✅ | TOTP step-up + `admin_actions` audit + real-time push alerts + admin rate-limits |
| ✅ | Broadcaster bitrate enforcement (`vergr-rtmp-auth` Go service: nginx-rtmp `on_publish` + 5s watchdog disconnects >cap for 15s; Free 4 / Lite 6 / Pro 9 Mbps) |

### P1 — ship before scaling
| Status | Build |
|---|---|
| ✅ | Pay-per-minute stream quality boost (callables + `chargeStreamBoosts` cron, 1 coin/min 720p / 2 coin/min 1080p; rtmp-auth reads `qualityBoost.targetTier`). Boost-effectiveness metrics dashboard still TODO. |
| 🟢 | Admin dashboard rebuild — every primary screen wired; remaining: real-data wiring for Live Stats System sub-tab (Cloudflare/GCP adapters — see PLANNED specs below). |
| 🟡 | Admin live metrics — Hetzner CPU/mem/bw, R2 storage, Circle balance, active streams, treasury size (replaces 5 vendor dashboards). |
| 🟡 | Admin upgrade-needed notifications (SFU/Hetzner capacity alerts). |
| ✅ | R2 segment cleanup cron. **BUILT + DEPLOYED, this row read 🟡 for months and was wrong** (verified 2026-09-06: `exports.cleanupExpiredStreamSegments` at `functions/index.js:472` ← `functions/streamingCleanup.js:108`, hourly). |
| 🟡 Partial | Identity-mask coverage: ✅ rosters; ⏳ notifications drawer + live-stream chat write-time mask. |
| 🔴 | **Live-stream UI rebuild** — current screens are old Gcore-era + mostly dummy. See "Live-stream screens" section below for the full per-screen punchlist. |

### Two-camera proof feed (high-stakes tournaments)
- Trigger: `tournament.entryFee > 5,000c` (constant `WEBCAM_PRIZE_THRESHOLD` mirrored in `src/screens/tournaments/TournamentMatchScreen.jsx` + `functions/tournamentRules.js` — keep both in sync).
- Player flow: explainer modal (`HighStakesProofExplainerModal.jsx`, once per match via localStorage) → click Start → recorder fires `getDisplayMedia({displaySurface:'window'})` → canvas composite (game + webcam PiP) → MediaRecorder 10s VP9 chunks → `uploadToR2('tournament-proof')` → `appendProofChunk` callable writes `match.proofFeed[uid].chunks[]`.
- Server gate: `recordMatchResultInternal` rejects player/host-reported results when `(tournament.entryFee||0) > WEBCAM_PRIZE_THRESHOLD && !match.proofFeed[winnerId]?.chunks?.length`. Trusted sources (`admin`/`vanguard`/`gameapi`/`gsi`) bypass — mod/auto-detect overrides chunk requirement (handles cam outages without unfair forfeit). Error message tells the player to start the recorder.
- Mod review: `TwoCameraProofViewer.jsx` on `TournamentMatchScreen` for `iAmMod`, plays chunks sequentially with per-chunk jump pills.
- Retention: `cleanupExpiredProofChunks` daily cron (`functions/streamingCleanup.js`) deletes `tournament-proof/` R2 objects older than 30d.
- **macOS minimum:** `getDisplayMedia` shipped in Safari 16 (macOS 13 Ventura) — tournament-eligible Mac players must be on macOS 13+. Older macOS = recorder shows "Encoder unavailable" → cannot claim a high-stakes win → must defer to mod call.
- Native overlay path (no picker, no yellow border, no per-match prompt) is on the deferred v2 anti-cheat plan — gated on signing solution (SignPath Foundation / MS Store / reputation farming, NOT a paid cert). Don't reach for v2 as the answer to v1 UX issues.

### Content policy REVERSED + 8 compliance policies shipped (2026-08-14)

**No nudity or sexual content anywhere.** This reverses the 2026-08-13 "adult permitted on paid private surfaces" model. Driver: every processor had declined, and the one available (via Frank) wanted $1,000+/yr plus 15% per transaction. Founder instruction was to thread the needle like Tango: say no nudity plainly, frame Vergr as a place to play and meet people.

- AUP section 3 rewritten as one flat standard applying to every surface (was two sections holding broadcasts and paid-private to different standards). New 3A covers mature language and themes, which ARE allowed.
- `contentRating: 'nsfw'` SURVIVES as an advisory label + the on-stream banner, per founder. Real nudity never reaches storage anyway (scanner `block` verdict at upload), so the marker only ever means the softer `adult:true` band.
- **Three filters switched off together, restore all three or none:** `feedRank.js` `passesRating` is now `() => true`; `entitlements.js` `assertNsfwViewerAllowed` is a documented no-op with call sites left wired; `streaming.js` `getLiveDiscoveryFeed` no longer excludes marked streams.

**Eight compliance policies** in `src/screens/marketing/legal/compliancePolicies.js`, rendered by the existing `LegalScreen` (lookup falls through `LEGAL_DOCUMENTS` then `COMPLIANCE_DOCUMENTS`), in the footer, in `sitemap.xml`, and prerendered: `/platform/{content-moderation, identity-and-consent, age-verification, anti-slavery, csam-policy, law-enforcement, aml-policy, anti-fraud}`. Titled exactly as processor checklists name them. **Every threshold in them was read out of the code first** (CSAM block at 0.30, other categories 0.85, KYC tier caps, 3-day withdrawal hold). Keep them true or delete them; an overstated control is the document you get held to.

### pro.vergr.app — Paddle subscription surface (2026-08-14, SHIPPED, DNS PENDING)

`src/screens/marketing/ProSubscriptionSite.jsx`, gated on hostname at the top of `AppRouter` (returns BEFORE the providers, so no auth/presence/cart mounts on that host). Serves 4 pages on that host and nothing else: `/` product, `/terms`, `/refunds`, `/privacy`. Legal docs render on THAT host on purpose, because Paddle requires them "clearly accessible via navigation on your website" and a cross-domain link would send the reviewer to the main site.

**THE RULE FOR THAT FILE: nothing on it may sell, price, advertise or link to Coins, tips, gifts, unlocks, withdrawals or the wallet.** Coins are Paddle's first-listed prohibited category ("Virtual currency or stored value..."). If a feature cannot be described without mentioning Coins, leave it off that page. This is separation, not concealment: the coin economy IS disclosed to Paddle in the application. Do NOT bundle coins into the subscription to route them through Paddle, that converts a clean SaaS product into a wrapper for stored value.

**NOT LIVE UNTIL DNS EXISTS.** The gate is `window.location.hostname === 'pro.vergr.app'`, so nothing is reachable until the founder adds the custom domain in Firebase Hosting and the Cloudflare record. There is deliberately no localhost or query-param bypass (one was added temporarily to eyeball it and reverted before deploy).

Prices come from `src/utils/tierSystem.js` (USD $4.99 / $9.99, matching what is actually charged, not the EUR figures elsewhere in this file).


### GEMS ARE DELETED (2026-08-16, founder-instructed, SHIPPED + DEPLOYED)

**"Gems dont have a purpose any more therefore they need to be removed everywhere."**

The accrued revenue share is now stored as MONEY, in micro-USD, on the wallet.
There is no second currency anywhere in the money path.

| Was | Is |
|---|---|
| `wallets/{uid}.gems` | `wallets/{uid}.owedMicroUsd` |
| `wallets/{uid}.totalGemsEarned` | `wallets/{uid}.totalOwedMicroUsd` |
| `wallets/{uid}.totalPaidOut` (gems) | `wallets/{uid}.totalPaidMicroUsd` |
| ledger `currency:'gems'`, `amount` | `currency:'usd'`, `amountMicroUsd`, `earning:true` |
| `earnedGemCredit` / `settleEarnedToGems` | `earnedShareCredit` / `settleEarnedShare` |
| `earned_gem_settlements/` | `revenue_share_settlements/` |
| tx type `earned_auto_converted` | `revenue_share_accrued` |

**No rate, threshold or cap changed.** 50-80% ladder, $100 minimum, KYC caps: all
identical. Gems were an integer-cent unit that `creatorPayouts.js` converted back
into dollars before doing anything, so deleting them removed an intermediate, not
a policy.

**ONE deliberate behavioural delta:** accrual now keeps sub-cent precision
(`floor(coins * share * 10_000)` micro-USD instead of `floor(coins * share)`
whole cents). The old truncation was an artifact of gems being integers and the
remainder was silently kept by the platform. Strictly in the creator's favour.
Revert by flooring to whole cents in `coinLedger.js` if that is not wanted.

**DELETED outright** (source gone AND undeployed, not left throwing):
`functions/gemTransfer.js`, `gemBuyback.js`, `withdrawals.js`, `nowpayments.js`;
callables `convertCoinsToGems`, `sendGems`, `quoteGemSend`, `buyCoinsWithGems`,
`requestWithdrawal`, `cancelWithdrawal`, `getMyWithdrawals`,
`processReadyWithdrawals`, `adminReleaseWithdrawalNow`, `adminGetWithdrawalContext`.
Also the PayRam **buy-and-send** branch (card payment minting value straight into
someone else's wallet, the clearest transmission shape in the product), and
screens `WithdrawScreen`, `ConvertScreen`, `ConvertCoinsScreen`, `SendGemsModal`,
`RequestPayoutScreen`, `WalletScreen`, `wallet/PayoutScreens`, `NativeConvertScreen`.

⚠ `adminGetNavBadges` was moved OUT of withdrawals.js into `adminEconomy.js`
before deletion. AdminShell calls it on every load.

**What still contains the letters "gem" and is NOT currency:** `BadgeGem`
(membership badge SHAPE), `gemBlue` (a colour token), `cheerGem` (an emote),
`/brand/gems.webp` (art), and `gem_transfer` entries in notification-icon maps
for a type nothing writes any more. Left alone deliberately.

**No migration was run.** Part 2 decision 7: balances are test data, clean
cutover, founder re-confirmed 2026-08-16.

---

### Creator program end-to-end audit (2026-08-16, SHIPPED + DEPLOYED)

The program was **unenterable and unpayable**. Both ends failed on the same
field: `users/{uid}.kycLevel` had readers and NO writer. Didit wrote
`users/{uid}.kyc.verified` and nothing else, so `creatorProgram.measureRequired`
never passed (Apply button permanently disabled) and `creatorPayouts.blockingReason`
returned `kyc_required` forever with a KYC cap of 0.

| Fixed | Detail |
|---|---|
| kycLevel | `diditWebhook` now writes `users.kycLevel = 1` + mirrors to the wallet on a verified decision. Only ever raises. L2/L3 stay admin-set. |
| Identity UI | `/creator/verify` mounted `KycWizard` (uploads ID images to Firebase Storage, writes `verification_applications`), a SECOND identity system. Now mounts `DiditVerify`. Note `/wallet/kyc` still routes its Start button to `/onboarding/identity`, which is a **profile form with no KYC in it**. NOT fixed. |
| Payout destroys funds | `payOne` debited the payable then called `disbursePayout()`, which throws unconditionally, and the catch deliberately leaves the debit. Added `PAYOUT_PARTNER_CONFIGURED = false`, checked BEFORE anything is reserved; the run marks itself `blocked` and moves nothing. **Flip that flag in the same commit that implements `disbursePayout`.** |
| Approval double-credit | `adminDecideCreatorApplication` credited the share for `pendingCreatorCoins` without removing the coins, which are still in the wallet. Creator got 100% as coins AND ~50% as share. Now debits balance/earnedBalance, clamped, and no longer double-increments `totalEarnedCoinsGross`. |
| Rate ladder stuck at 50% | Only `entitlements.js` used `earnedCoinCredit()`. Memberships (x2), tickets, season passes, ad rewards, referral revenue and Vanguard treasury all hand-rolled the wallet write and omitted `totalEarnedCoinsGross`, so those earnings never moved a creator up a tier. All six now use the helper. |
| Unlock revenue stranded | `entitlements.js` was the ONLY earning surface that never called the settle helper: unlock revenue sat as spendable coins forever, never payable, and invisible on Earnings. Now settles post-commit, idempotent on the entitlement id. |
| Notification never delivered | `entitlements.js` addressed "someone unlocked your content" with `userId`; the drawer queries `recipientId`. (`refundOutstandingPicks.js:124` has the same bug, untouched.) |
| Memberships paywalled | `requiredTier="pro"` was still on the route AND the native screen despite the founder ruling. The NAV lock had been removed, so there was no warning before the wall. Both gone. |
| Quests always failed | `claimQuestReward` was a CLIENT transaction taking the VP amount as an argument, and rules deny client writes to `quest_claims`, so every claim threw. New `functions/creatorQuests.js`: server owns amounts, per-quest verifiers, idempotent per UTC day, VP to `wallets.vp`. Unverifiable quests are not offered. |
| Earnings filter | `isEarning()` required `currency === 'gems'` against a hand-kept type allowlist; four of its eight types never carried that field so could never match. Server now stamps `earning: true`. |
| Native dashboard | `/creator/dashboard` re-exported the DEPRECATED `CreatorDashboardScreen` while web rendered `CreatorHomeScreen`. |
| Fabricated data | `CreatorCommunityScreen` shipped four invented fans, three invented pending comments and a hardcoded 74/21/5 sentiment split as live data. Removed; honest empty states. |
| Quests hero | Was a tournament-earnings ladder reading a ledger scan that could only return 0, advertising prize competitions the compliance pages say do not exist. Removed. |
| Undeployed admins | `adminSetPayoutAccountState` / `adminRecordPayoutStrike` / `adminReversePayoutStrike` existed in source and index.js but were never deployed. Now deployed. They are still the ONLY way to set `partnerPayeeId` / `taxFormStatus`, and there is no admin UI for them. |

**Rules hardened + deployed.** `wallets`: the payable and every lifetime
aggregate are now server-only (they were owner-writable, so a client could mint
the liability Vergr owes it). `users`: `kycLevel`, `kyc`, `pendingCreatorCoins`,
`vp` and `creator` are server-only. `users.kyc` matters most: `assertKycVerified`
trusts `kyc.verified`, and the owner could set it on themselves.

✅ **EVERY money field on `wallets` is now server-only** (2026-08-16). `balance`,
`vp`, `totalEarned`, `totalSpent`, `totalReceived`, `totalTipped` joined the
denylist once the three live client writers moved into
`functions/walletActions.js` (`awardActionVp`, `recordAdWatch`,
`contributeToSquad`) and seven DEAD client money movers were deleted from
`firestore.js` (`purchaseService`, `approveServiceOrder`, `disputeServiceOrder`,
`requestPayout`, `joinTournament`, `leaveTournament`, `distributePrizePool`, all
zero-caller). The only owner-writable fields left on the wallet are preferences.

⚠ Watch-to-Earn still TRUSTS that an ad was watched: Monetag Direct Link has no
server callback. What moved server-side is the AMOUNT, the per-day count and the
streak maths. AdMob rewarded video (`admobReward.js`) has real SSV and is the
verified path.

⚠ **THE PAYOUT PARTNER IS STILL NOT WIRED.** Nobody can be paid, by design, and
the run now refuses to move anything rather than destroying the payable. That is
the one remaining blocker to money actually reaching a creator.


### Box 2 (`vergr-stream-2` / `edge2`) DELETED 2026-08-17

**Hetzner is now €5.49/mo net + €0.07 snapshot, down from €40.98.** Saved ~€35.42/mo.

Box 2 was a `cpx32` (4 dedicated vCPU, €35.49 net) running as the PRIMARY stream
edge (`stream_nodes/edge2`, `priority: 10`), at load 0.00 for its entire 74-day
life, with zero live streams and zero HLS output ever.

**What went with it:** adaptive transcode (`vergr-transcode`), VOD archiving AND
server-side clip cutting (`vergr-vod-archive`, the Safari/iOS fallback for the
Clip button), and ALL translation (LibreTranslate). Streaming itself survived:
box 1 is `priority: 0` and `pickStreamNode` fails over to it automatically.

`archive.vergr.app` on box 1 was a reverse proxy to box 2's private IP
(`10.0.0.2:8097` and `:5000`). It is now a **fast 503** rather than a 30s hang,
because `contentAi.js` calls the translate endpoint on EVERY post create and a
hang there is far worse than an error. Original vhost kept at
`/etc/nginx/sites-available/archive.vergr.app.box2-era.bak` on box 1 and in the
restore bundle.

**Full restore bundle: `infra/box2-restore/`** (43 files, secrets gitignored) and
a second copy WITH secrets at `~/Downloads/vergr-box2-backup-2026-08-17/`.
`RESTORE.md` is an 11-step runbook. All 8 executables sha256-verified against the
live box before deletion. Hetzner snapshot `420931000` (4.69GB) also retained.

⚠ **CORRECTED 2026-08-23. THIS SECTION WAS WRONG AND MISLED SESSIONS.** It said
the repo had no source for `vergr-sfu`, `vergr-ingest`, `vergr-rtmp-auth`,
`stream-node-agent` or `vergr-chat`. Verified by listing the directories:

| Service | Source in repo? |
|---|---|
| `vergr-sfu` | ✅ `infra/sfu/src/main.go` |
| `vergr-ingest` | ✅ `infra/ingest/src/main.go` |
| `vergr-rtmp-auth` | ✅ `infra/rtmp-auth/src/main.go` |
| `vergr-chat` | ✅ `infra/chat/src/` (main.go, dm.go, store.go, history.go, search.go, twitch.go, …) |
| `vergr-ocr` | ✅ `infra/vergr-ocr/` |
| `vergr-cohost-launcher` | ✅ `infra/cohost-launcher/` |
| `vergr-community-import` | ✅ `infra/community-import/` |
| `stream-node-agent` | ❌ only `node_modules`, no source |

So **only `stream-node-agent` genuinely lacks source.** Do NOT plan around
"we cannot change the relay": `vergr-chat` is fully editable, and on 2026-08-23 it
was edited (VP level added to the wire format) precisely because a session had
read this stale warning and designed an expensive client-side workaround instead.
There are still **no `infra/*/deploy.sh` scripts**; deploy is scp + go build +
systemctl restart, as documented per service.

⚠ **BOX 1 IS STILL NOT BACKED UP.** That part stands: if box 1 dies the running
binaries and their env/systemd config are gone, even though the source survives here.

Still to do: `edge2.vergr.app` DNS still points at the released IP `178.105.238.230`
(Cloudflare, founder access).

### Payments reality check (2026-08-17)

Measured, not assumed:
- `payram_orders`: **23 rows, ALL `expired`, zero settled, ever** (21 May - 11 Aug).
  Founder confirms all 23 were his own tests. So PayRam is **unproven, not proven
  broken**, it has never completed a payment end to end, not even once.
- The only two completed coin purchases in the platform's history were **Stripe**,
  on 12 Aug, the day before the account closed.
- Circle omnibus (`0xbb1b…2240`, BASE, LIVE): **balance zero**.
- **Total creator liability platform-wide: $0.01.** Zero wallets with
  `owedMicroUsd > 0`; one wallet holds 1 legacy gem.

**Vergr currently has no proven way to take money.** That is the priority item,
ahead of any feature work.

### What Vergr IS (canonical, use this for ANY processor / underwriter / partner form)

**READ THIS AND `docs/REVENUE_SHARE_PLAN.md` §1.4 BEFORE answering any question about what the
business does.** Not just before touching earnings code. Getting this wrong on an application is
how you get declined, and a session did exactly that on 2026-08-16 by describing Vergr from
memory instead of from the docs.

**Vergr is a live streaming and creator platform, and Vergr is the PRINCIPAL in every transaction.**
The official one-liner is in `public/llms.txt` and `index.html`: "a live streaming and social
platform for gamers and creators."

The value path, which is the part that gets misread:

1. A viewer buys Coins **from Vergr**. That is Vergr revenue at that moment. There is no third-party seller.
2. The viewer spends Coins on **Vergr** features: unlocks, memberships, paid stream access, tips.
3. Vergr owes the creator a **share of the revenue their content generated**, as a supplier.
4. Vergr pays its suppliers **on Vergr's schedule**, as accounts payable.

This is the Twitch / YouTube / Patreon / App Store structure. Paying your own suppliers is not
money transmission and is not a marketplace.

**Things that are therefore FALSE and must never be written on a form:**

| Do NOT say | Why it is wrong |
|---|---|
| "marketplace", "multi-vendor", "selling on behalf of others" | Vergr sells its own product. Defeating this characterization is the entire point of the revenue-share migration. |
| "forwarding funds" / "user-to-user payments" | No buyer money is forwarded. Buyer money is Vergr revenue; creator payment is an expense on Vergr's schedule. |
| "stored value" / "wallet balance the user can call on" | Coins are a revocable licence to access features, no cash value, non-transferable. The withdrawal and gem-transfer modules are deleted and their callables undeployed (2026-08-16). |
| "dating" / "a place to meet people" | Vergr is broadcast and creator-led, one-to-many. Reads as a dating app to an underwriter and makes acceptance harder. |
| anything about tournaments, prizes, predictions or betting | **Retired and UNROUTED.** `AppRouter.jsx` has exactly one tournament route, `/vanguard/lookup/tournament`, admin-only. The huge tournaments section further up this file is DEAD CODE documentation. `llms.txt` states plainly: no betting, wagering, prediction markets, prize competitions, loot boxes or games of chance. |

⚠ The `sellerUid` variable in `functions/entitlements.js` is **pre-migration naming**, not the legal
relationship. Do not read a variable name and conclude Vergr is a marketplace.

⚠ The two Shopify surfaces are NOT Vergr taking third-party money. `functions/shopifyApp.js` is a
public App Store "link in bio" app where **buyers check out inside Shopify**; `functions/shopSync.js`
is the coin-paid Vergr Shop on our own checkout. `createOrder` (physical merch, `functions/index.js:3551`)
**has no payment path and nothing in `src/` calls it.**

What IS honestly disclosable and should never be hidden: Coins are an in-app credit; the inbound rail
(PayRam) settles in USDC on Base and payouts run through Circle, so crypto involvement is real and gets
ticked on any form that asks.

### PADDLE: coins never, subscriptions maybe (checked 2026-08-14)

Vergr hits SIX prohibited categories in Paddle's AUP: virtual currency/stored value, digital marketplaces enabling non-Paddle sellers, donations/community access, crypto, regulated financial services, and dating. More fundamentally Paddle is a Merchant of Record: it buys your product and resells it, so it structurally cannot carry user-to-user money. Removing adult content changes none of it. Detail in memory `project-paddle-rejected`.

⚠ **That category list is PADDLE'S READING, not a description of Vergr, and it misled a later session into repeating it to a different processor.** Two of those labels are wrong about us and must not be reused: Vergr is not a marketplace and does not sell on behalf of others (see "What Vergr IS" below), and Vergr is not a dating product. Cite this paragraph only as "what Paddle concluded", never as fact about the business.

⚠ Trap: marketing Vergr as "a place to meet people" reads as a dating app to an underwriter and makes mainstream acceptance HARDER. Copy Tango's rules, not Tango's marketing line.

### SEO: news-post noindex was TRIED AND REVERTED (2026-08-14). Do not redo it without measuring first.

On 2026-08-14 I noindexed every syndicated post and pulled all 1,888 of them from the UGC sitemap, arguing from Google's scaled-content-abuse policy. **Founder reverted it the same day: "you removed the posts from google that werent getting flagged as duplicate ... you have actually made seo worse."** Everything is back to the `seoText.length >= 400` gate in `ugcRenderer.js` (renderPost + renderSitemapPosts) and `indexNow.js`, and `rewriteNewsForSeo` pings IndexNow again. Verified live: posts serve `index,follow`, sitemap back to 984 + 904.

**What was wrong with the reasoning, so it is not repeated:** a sitemap count tells you what is SUBMITTED, never what is INDEXED. I never opened Search Console to check whether those rewritten pages were indexed and performing, or actually sitting in the duplicate bucket. The rewrite exists precisely so they are NOT duplicates, so removing them plausibly removed the site's only working indexed content. **Before touching noindex/sitemap/canonical on any URL set again, get the real indexation status of those exact URLs out of Search Console first.**

**Also settled while investigating:** the "Gaming News" home-feed tab is NOT reaching Google and cannot. It renders RSS fetched client-side into React state (`newsItems`, HomeFeedScreen ~L564), nothing is persisted to Firestore, those items have no URLs, and `HomeFeedScreen` only renders for a logged-in user (logged-out hits `<Navigate to="/platform">` at AppRouter ~L222). Googlebot is logged out, so it never sees that tab. There is nothing to stop there.

### Native CSP blocked all video, audio and native thumbnails (2026-08-14, FIXED in 1.0.195)

Found from founder screenshots after 1.0.194 fixed the status-bar overlap. Three separate faults, all in `src-tauri/tauri.conf.json`:

- **No `media-src` directive at all.** `<video>` and `<audio>` therefore fell back to `default-src 'self' asset: https://asset.localhost`, which has neither `https:` nor `blob:`. Every clip, round video note and voice note is served from `cdn.vergr.app`, so the CSP blocked all of them: the grey blurred play glyph in the screenshots is the Android WebView's broken-media poster, and the voice bubble sat at 0:00. **This hit the desktop app too**, so the fix is in the shared conf, not the android one.
- **Android serves the asset protocol over `http://asset.localhost`, not `https://`.** (Windows too; macOS and Linux use `asset://localhost`.) The CSP allowed only the `https://` form, so every `convertFileSrc()` URL stayed blocked even once `assetProtocol` was re-enabled: gallery-grid thumbnails rendered as broken-image glyphs. `connect-src` needed it as well, because `resolveDeviceMedia`, `nativeTranscode` and `shareIn` all `fetch(convertFileSrc(...))`, so picking a photo would have failed at send time even if the thumbnail had drawn.
- **`worker-src` was missing**, so blob workers fell through to `script-src`, which has no `blob:`. hls.js and ffmpeg.wasm both build workers that way. Added `worker-src 'self' blob:`; it can only unblock.

Separately: **the `hud` window is declared in `tauri.conf.json` and Tauri creates config windows on Android as well**, which is why a stray "VERGR HUD, idle" panel (`HudOverlay.jsx:106`) appeared over a blank screen on the phone. The Rust commands are correctly `#[cfg(desktop)]`; the window declaration was not gated by anything. `tauri.android.conf.json` now overrides `app.windows` to the main window only (RFC 7396 merge patch replaces arrays wholesale, so listing one entry drops the HUD).

**Rule: a CSP directive that is absent is not permissive, it inherits `default-src`.** `default-src` here is deliberately tight, so every media type the app loads needs its own directive spelled out. When adding a new kind of remote or local media, check `media-src`/`img-src`/`connect-src`/`worker-src` before assuming the network is at fault.


### 1.0.193 APK shipped as a WEB build: src-tauri lost its untracked configs (2026-08-14, FIXED)

Founder reported the APK overlapping the phone's status bar on Messages "and other" screens, video notes stuck on a grey play glyph, and the chat gallery grid showing no files. Three unrelated-looking symptoms, **two config files that had been deleted**.

`git reflog` shows a `checkout: moving from kotlin-native to main` plus resets around 2026-08-09. That wiped every UNTRACKED file under `src-tauri/`. Nothing failed. The APK built, installed and ran.

**What was lost, and what each one broke:**

| Lost | Consequence |
|---|---|
| `src-tauri/tauri.android.conf.json` | Tauri auto-merges `tauri.<platform>.conf.json` (confirmed in the CLI binary + [v2 docs](https://v2.tauri.app/develop/configuration-files/); merge order is base → platform → `--config`, so the store/huawei/dev `--config` still wins). It was the ONLY thing pointing android at `npm run build:android`. Without it the build fell back to `tauri.conf.json`'s `beforeBuildCommand: "npm run build"` = plain `vite build` = **`__VERGR_NATIVE__` false**. Every `IS_NATIVE_BUILD` branch compiled out: no native screens (`IS_NATIVE_BUILD ? <Native> : <web>` all took the web arm), no status-bar insets (`TopBar.jsx:19`, `MessagesInboxScreen.jsx:211`, dozens more), and `useResponsive` no longer forced the mobile tier so the WebView's ~980px width produced the broken `isMobile:false, isDesktop:false` tablet tier. |
| `app.security.assetProtocol` (lived in that same file) | Tauri defaulted to `{enable:false, scope:[]}`, so **every `convertFileSrc()` URL was dead**: gallery-grid thumbnails (`nativeMedia.js` → `cache/media_thumbs`), the on-device media cache behind video notes and avatars (`fileMediaCache.js` → `MediaCacheBridge.kt` `files/vergr_media`, `cache/vergr_media`, `files/vergr_video`), `nativeTranscode`, `shareIn`, `nativeArCamera`. The CSP in `tauri.conf.json` still allows `asset:` / `https://asset.localhost`, which is the leftover proving the block used to exist. |
| `tauri.store.conf.json`, `tauri.huawei.conf.json`, `tauri.dev.conf.json` | `android:build:store` / `:huawei` / `:dev` pass these with `--config`; they would have failed outright on the next store or Huawei build. |

**Verified from the ARTIFACT, not from the command that was typed** (per [[reference-store-manifest-strip-ordering]]): the shipped `app-universal-release.apk` embeds `/downloads/latest.json`, `/og/share.mp4` and every `*_Desktop.*` background, all of which `prune-mobile-dist.mjs` deletes, so the pruner never ran, and its own `assets/tauri.conf.json` records `beforeBuildCommand: "npm run build"` and `assetProtocol {enable:false, scope:[]}`.

**Fixed:** all four conf files restored and now **tracked in git** (they were untracked, which is why they vanished silently and why git showed a clean `src-tauri/`). `tauri.android.conf.json` carries the native `beforeBuildCommand`, `beforeDevCommand: "vite --mode native"` (`android:dev` had the same defect), and the `assetProtocol` scope, which is the app's own private sandbox (`/data/data/…` and `/data/user/*/…` `cache/**` + `files/**`) rather than an enumeration of bridge subdirectories, a tighter list silently breaks the next bridge that adds a directory.

**Two new guards in `scripts/publish-apk.mjs`, both of which reject the 1.0.193 APK:** it refuses to publish an APK whose embedded bundle still carries pruned assets (proves a web-mode build), and it inflates `assets/tauri.conf.json` straight out of the APK and refuses to publish when `assetProtocol` is off. A guard that cannot read the artifact fails closed rather than waving it through.

**The rule this leaves behind: nothing that decides how the APK is built may sit untracked.** A silent fallback to a config that still builds, installs and runs is indistinguishable from a pile of UI regressions, and it cost a release plus a day of the founder's time.


### Sideload APK regressed to a universal (multi-ABI) build (2026-08-14)

The published `downloads/VERGR.apk` (1.0.193) is **282 MB**. It is supposed to be **arm64-only, ~85 MB** (memory `project-native-app`: "Bootstrap APK ... arm64-only ~85MB; build with `npx tauri android build --target aarch64`").

Measured from the artifact itself (`aapt dump badging` + `unzip -l`), not inferred:
- ABIs present: `arm64-v8a`, `armeabi-v7a`. It is a universal build.
- `lib/arm64-v8a/libvergr_desktop_lib.so` 104.2 MB + `lib/armeabi-v7a/libvergr_desktop_lib.so` 101.6 MB, plus `libxeno_native.so` 20.6 + 15.3 MB = 257 MB of the 282 MB.
- **No `.exe`, `.msi`, nested `.apk` or `downloads/` inside.** The desktop installer is NOT baked in; `prune-mobile-dist.mjs` is doing its job. (Do not re-diagnose this as the old baked-APK bug, it is a different cause.)

`libvergr_desktop_lib.so` is just the Rust crate name (`vergr_desktop_lib`), shared by the desktop and Android targets. It is not the desktop app inside the phone app.

**Fixed so far (no build run, per the batch-native rule):**
- `package.json` `android:build` is now `tauri android build --target aarch64`. It had no `--target`, so it built every ABI.
- `scripts/publish-apk.mjs` parses the ABI list out of `aapt dump badging` and REFUSES to publish anything but arm64-v8a, with `--allow-multi-abi` as the deliberate escape hatch. Verified it would have blocked 1.0.193. The store AAB is untouched and should keep both ABIs, since Play splits per device.

**STILL UNEXPLAINED, do not guess:** arm64-only would land ~165 MB, still about double the documented ~85 MB. The embedded payload has grown since that figure was recorded and nobody has established why. Next step is to compare the embedded web bundle against the ~72 MB that memory records, from the artifact, not from `dist/` in the working tree (measuring the web-mode `dist/` instead of the native-mode one is exactly the mistake made in this session).

### Download-page size display (2026-08-14, SHIPPED + DEPLOYED)

`formatMb` divided by 1048576 and labelled the result MB, so the page said 269 MB for a file Chrome reports as 282 MB. Now decimal MB (10^6) with a GB rollover, matching what browsers, Android and Play show, so the page agrees with the download bar. Installer now reads 104 MB, APK 282 MB.

### Downloads split off the landing page (2026-08-14, SHIPPED + DEPLOYED)

`/platform` no longer links at any binary. Its section is now two cards, "Get the mobile app" and "Get the desktop app", each routing to its own page.

| Route | Screen | Carries |
|---|---|---|
| `/platform/download` | `DownloadScreen` (now a **hub**) | Mobile / Desktop / Web cards. Route kept: it is in `sitemap.xml`, in the prerender list, and referenced by a help article. |
| `/platform/download/mobile` | `MobileAppScreen` (new) | APK download, provenance panel, Play Protect + unknown-sources steps, iPhone add-to-home-screen, `AndroidInstallModal` + browser-install prompt (both relocated off the landing page) |
| `/platform/download/desktop` | `DesktopAppScreen` (new) | Windows installer, provenance panel, SmartScreen step, feature list, requirements |

- **Provenance is real, not decorative.** Version / size / release date / SHA-256, read at RUNTIME from `/downloads/latest.json` and `/version.json` so the page cannot drift from what is on the CDN. `scripts/make-update-manifest.mjs` now writes `sha256`; `scripts/publish-apk.mjs` now writes `apkSize` / `apkSha256` / `apkPublishedAt`. The 1.0.193 values were backfilled by stream-hashing the live CDN files.
- **`softwareAppSchema()` added to `src/utils/JsonLd.jsx`.** HONEST LIMIT: Google's Software App rich result REQUIRES `aggregateRating` or `review`. Vergr has no ratings and inventing one breaches Google's structured-data policy, so the builder omits them and **these pages are NOT rich-result eligible**. Add ratings only when real ones exist.
- Both pages added to `public/sitemap.xml` and to the marketing list in `scripts/prerenderHelp.mjs`.
- The desktop-install help article was updated to match (Download page -> Desktop -> Download for Windows) and now documents the SmartScreen notice.

**Note on the Safe Browsing question that started this:** moving links between pages does nothing for Safe Browsing. The site interstitial keys on what a HOST serves (binaries are already on `cdn.vergr.app`, which usefully isolates blast radius from `vergr.app`), and the "unusual file" warning is SmartScreen reputation on an unsigned binary, fixable only by signing plus download volume. The download pages help by being real provenance a human reviewer can read, not by relocating the anchor tag.

### TODO before public indexing (do not forget)
- **Google Safe Browsing check** — 2026-05-25 an old tab loaded `vergr.app` and showed Chrome "Dangerous site" phishing warning; a fresh tab loaded fine. Recheck via `transparencyreport.google.com/safe-browsing/search?url=vergr.app` once the app is feature-complete + before any user invite/marketing push. **2026-08-14: recheck NOT completed** (the transparency report is a JS app; WebFetch returns no verdict and the in-app browser was denied that origin). Founder must open the link himself, it is a 5-second check. If flagged: find offending URL via Search Console → Security Issues, remove (likely R2 user upload), submit review request (24-72h). Also harden: scan R2 uploads through Gemini BEFORE the public URL goes live (currently lives during scan window).
- ~~**Kill HashRouter → BrowserRouter**~~ ✅ **DONE.** `AppRouter.jsx:750` mounts `<BrowserRouter>` and `firebase.json` carries the SPA rewrite. Verified 2026-08-23. This entry sat here as outstanding work long after it shipped, and CLAUDE.md still described the stack as HashRouter in two places, which is how `ErrorBoundary.jsx` kept a `window.location.hash = '#/'` "Go home" button that could not go home (fixed 2026-08-23). Residual `#/` in `CreateTournamentScreen.jsx:866` is inside unrouted dead code and is deliberately left alone.

### P2 — post-launch hardening
| Status | Build |
|---|---|
| 🟡 | Step-up on first Vanguard dashboard load from new device |
| 🟡 | Auto-revoke refresh tokens on suspicious activity |
| ✅ | Founder ineligible for public enumeration (`shouldHideFromEnumeration`) |
| ✅ | Vanguard audit-log search UI + promotion-eligible Recruit auto-flag |
| ✅ | Pion SFU scale-up triggers documented (see SFU section) |
| ✅ | Tournament match-pair lobby-screenshot verification (Gemini Vision OCR cross-check) |
| ✅ | Tournament same-lobby verification — per-match unique `lobbyCode` (VERGR-XXXXXXX) shown in-game per game's `verifyMethod` (chat/name/lobby_name/match_screen); OCR + mod + self-attest sources; real-time per-player verification status via Firestore subscription; both-verified gate before play. Front-end at `/tournaments/:tId/match/:mId` (`TournamentMatchScreen`). Backend: `functions/matchVerification.js`. Games registry in `src/utils/tournamentGames.js` + `functions/games.js` (37 non-mobile competitive games). Tournament VODs flagged `archiveLowQuality:true` + 7-day retention (vs 24h default) for second-mod review — live stays full quality. |
| ✅ | Tournament esports polish batch 1: animated 3-2-1 lobby-code reveal, UFC-style walk-on intro, trophy ceremony podium, hardware fingerprint binding (`tournamentFingerprint.js` + `enrollOrCheckFingerprint`), trust score (hidden until ≥5 verified matches), rivalry auto-detect trigger, AI match summarizer (Gemini multimodal), 1% sportsmanship bonus routing, dispute timeline, match-card share PNG generator, mandatory webcam for >5,000 coin tournaments. Backend `functions/tournamentTrust.js`. Components in `src/components/tournament/`. |
| ✅ | Tournament esports polish batch 2: Mod Wall (`/vanguard/wall`, V/R/D/J shortcuts, live grid with severity badges); Personal stats (`/tournaments/me/stats`, per-game W/L, rivals); LeaderboardScreen extended with `tournamentTrust.score`/`tournamentPrizeCoins`/`tournamentTrust.verifiedMatches` categories; `<StartingSoonCarousel>` + `<TournamentOfTheDayCard>` + `<CrossTournamentLeaderboard>` (DiscoveryStrip.jsx); live betting + tip-underdog + hype aggregator (`tournamentExtras.js` + `<SpectatorBetPanel>` + `<TipUnderdogButton>` + `<BracketChat>` + `<PiPCohost>`); warmup-lobby launcher, scheduling DM, replay-on-demand, double-or-nothing rematch (`MatchFlowExtras.jsx`); squad-funded prize pools + sponsor slots (`HostingExtras.jsx`); AI cheat-flag VOD trigger (`aiCheatFlagVod`) writes `tournament_review_queue`; tournament-of-the-day cron + starting-soon push cron + VOD highlights auto-cut. Backend `functions/tournamentExtras.js` + `functions/tournamentDiscovery.js`. |
| 🟢 | Tournament native batch (Tauri/Rust) — **v1 shipped**: Second Tauri webview window (`label:"hud"`, transparent, alwaysOnTop, skipTaskbar, click-through default) renders `/hud` route with 4-light status strip (REC/OCR/MOD/OPP), heartbeat pulse, lobby code, mod presence. Rust commands `scan_processes`/`open_hud`/`close_hud`/`set_hud_click_through`/`set_hud_position`. Cross-window pub/sub via Tauri events (`vergr:hud:set-match` / `vergr:hud:clear`) with localStorage fallback. Game-only capture via `getDisplayMedia({ displaySurface: 'window' })` (OS-enforced). Anti-cheat: `functions/antiCheat.js` ingests scans, matches against admin-managed `cheat_signatures/`. Admin CRUD at `/admin/cheat-signatures` with route guard + Seed-Defaults button populating ~40 known cheat tools (`seedCheatSignatures.js`). Auto-runs scan pre-match + every 30s; **gated by explicit consent modal** (`AntiCheatConsentModal`, scope version stamped on `users.tournamentScanConsent`). Mod heartbeat callable `vanguardHeartbeat` keeps HUD MOD light fresh. **Deferred to native batch v2:** wgpu native overlay, Windows.Graphics.Capture, Cronus/XIM USB fingerprinting, capture-card PCI enum, foreign-DLL-in-game-process detection. |
| ✅ | Tournament VOD archive pipeline: `functions/vodArchive.js` triggers on tournament-stream end → POSTs Hetzner `vergr-vod-archive` launcher (`infra/vod-archive/` — Node service, ffmpeg downscale to 480p H.264 + AAC 64k, R2 upload at `archives/tournaments/{matchId}.mp4`) → `markVodArchived` HTTP webhook writes `archiveVodUrl` on match. Unblocks `aiCheatFlagVod` + `autoCutVodHighlights`; 7-day retention path in `streamingCleanup.js` already reads `tournamentMatchId`/`tournamentId` for TTL. **Deployed 2026-05-25** on Hetzner `vergr-stream-1` (91.98.79.244): systemd unit `vergr-vod-archive` on `127.0.0.1:8097` (NOT 8095 — that's `vergr-chat`; 8096 is `vergr-cohost-launcher`), env at `/etc/vergr-vod-archive.env` (HOST_OPS_TOKEN + R2 creds), nginx vhost `archive.vergr.app` → SSL via certbot (renews ~2026-08-23). Cloud Fns `dispatchTournamentVodArchive` (`streams/{streamId}` onUpdate trigger) + `markVodArchived` (HTTP callback) were live in europe-west1 **at the time of writing (2026-05-25). BOTH ARE NOW GONE:** `dispatchTournamentVodArchive` was deleted with the tournament backend on 2026-08-17, and `markVodArchived` is undeployed because the box behind it (BOX 2) was deleted on 2026-08-17. Do not cite this line as current. Verified: HTTPS 200 on `/healthz`, 401 without Bearer, 202+schema-validation with Bearer. **Update `infra/vod-archive/deploy.sh` port from 8095→8097 if re-deploying.** |
| ✅ | Vanguard Review Queue (`/vanguard/queue`) — single mod surface with 3 tabs: AI Review (`tournament_review_queue`), Anti-Cheat (`anti_cheat_alerts`), Replay Requests (`replay_review_requests`). Live counters + focused detail pane + confirm/clear/open-match actions. Mod heartbeat fires automatically from ModWallScreen. |
| ✅ | Tournament integrity hardening — bet settlement now hooked into ALL match-completion paths (recordMatchResultInternal, admin override, dispute resolution); bet refund on tournament cancel; `modVerifyMatchPlayer` requires either active tournament assignment OR Commander+ rank; TrophyCeremony wired to tournament completion (top-3 finishers + host) with winnerId fallback; WalkOnIntro persistence via `match.walkOnShownAt`; HUD auto-closes on TournamentMatchScreen unmount regardless of match status; Anti-cheat consent decline now actually calls `leaveTournamentSecure` + refunds entry. |
| ✅ | **All 7 tournament types from `Tournament System.docx` are server-generated end-to-end** (no client-side bracket generation reliance). At `startTournamentSecure`: single-elim/squad-single-elim use `buildSingleElimRound1`; double-elim uses `buildDoubleElimBracket` (full WB+LB+GF skeleton with `feedFrom` metadata; `fillDoubleElimFeeders` populates downstream slots on each completion with crossed pairing in even LB rounds; GF reset emerges from "2 losses out" rule via `advanceDoubleElimIfNeeded`); squad/solo round-robin uses `buildRoundRobinSchedule` (circle method, every pair exactly once); battle royale uses `buildBattleRoyaleGames` (creates `brGameCount` FFA game slots, host/admin records placements via new `reportBattleRoyaleGame` callable, points 15/12/10/8/6/5/4/3/2/1/0); swiss uses `buildSwissRound1` random + `advanceSwissIfNeeded` triggered when each round completes (greedy fold pairing within score buckets, rematch avoidance); invitational treats participants array as host-defined seed and uses single-elim path (no random shuffle). Unknown types throw rather than silently fail. **Squad tournaments route 100% of placement to `squads/{squadId}.treasury`**; 48h per-match timeout cron `detectMatchTimeouts` auto-forfeits/disputes/cancels; bracket-tab UI renders real match docs via `tournamentBracketShape.js`; per-match `<NextMatchHint>` shows winner/loser destinations with click-to-jump. |
| ✅ | All bracket types finalize correctly + Tournament Points (TP) system. `computeRankingForTournament` produces a full ordered ranking of every participant per bracket type using structural rules only — no client flags required: single-elim/squad/invitational rank by round-eliminated (later = better); double-elim by 2nd-loss order (no `isGrandFinal` flag — uses the format's own rule of "2 losses out"); BR by sum of placement points across games; RoundRobin by wins → goal differential → goals-for; Swiss by wins → Buchholz. `finalizeInternal` writes both `placements` (first/second/third for prize payouts) and full `ranking` (for TP), then awards **Tournament Points to every participant**: base 1000/600/400/250 for 1-4, 175 for 5-8, 100 for 9-16, 50 for 17-32, 25 for 33+ (participation), scaled by `log2(participants)` size mult and `1 + min(2, entryFee/1000)` stake mult. Stored on `users.tournamentPoints` (global) + `users.tournamentPointsByType.<type>` (per-format). Per-award transaction rows + `tournament.tournamentPointsAwarded` audit. `autoCompleteNonSingleElimIfDone` detects done structurally — BR via `brGameCount`, RR via `N*(N-1)/2` matches, Swiss via configured rounds, double-elim via "all but one player has 2 losses", invitational via "all but one player has 1 loss". New leaderboard category "Top Players" pinned at the top of LeaderboardScreen reading `users.tournamentPoints`. |
| 🟡 | Batch 2 follow-ups: warmup-lobby route `/squads/warmup/:tag` (thin wrapper around SquadStreamScreen); `tournament_review_queue` mod consumer screen; surface `match.cheatFlag` + `match.highlights` in MatchDetails; users `tournamentPrizeCoins` aggregate cron. |
| ✅ | Tournament layered-mod + payouts hardening (2026-05-24). **Q1 per-game lobby caps:** `getMaxLobbySize(gameId)` + `supportsBattleRoyale(gameId)` in `src/utils/tournamentGames.js` (mirror `functions/games.js`); `createTournamentSecure` rejects BR on incompatible games + caps maxParticipants by true lobby size. **Q2 auto-OCR + Commander override:** `autoSuggestMatchWinners` cron (every 60s) runs Tesseract+Vision via new `_internal_analyzeAssignment` export, stamps `match.aiSuggestion` (NEVER records — mod still confirms). `vanguardCallTournamentWinner` now reads aiSuggestion: if AI is `high` confidence and non-Commander mod picks opposite → returns `reviewRequired:true`, sets `match.commanderReviewRequired`, audits row. `commanderResolveMatchReview` callable lets Commander/Overseer/founder confirm or override. **Q3 per-match claiming:** `vanguardClaimMatch` + `vanguardReleaseMatchClaim` writing `tournament_match_claims/{tournamentId_matchId}`; hard-checks no time-slot overlap with mod's other claims; multiple mods can co-moderate one tournament. **Q4 30s grace + 2-strikes forfeit:** `detectTournamentStreamDrops` cron (every 60s) checks each in-progress match participant's stream `lastFrameAt`; 30s grace → strike; 2 strikes → forfeit via `_internal_recordMatchResult` source='forfeit_stream_drop'. **Q5 champion vote + backups:** `selectSquadChampionsSecure` now accepts `backupUids[]` (stamps `squadBackupChampions[squadId]`). New `startSquadChampionVote` / `castSquadChampionVote` / `finalizeSquadChampionVote` — squad-member multi-select poll, top N = champions, next M = backups, auto-stamps tournament doc. **Q6 realistic VP/XP:** squad placement now grants squad `xp` (1st=500/2nd=250/3rd=125 — calibrated against `xpNext = level*500`) + `leaderboardPoints` (300/150/75) + per-champion VP (200/100/50); solo placement grants winner VP (200/100/50). TP loop fans out per-champion in squad mode (was incorrectly crediting squadId as a uid). All deployed europe-west1. |
| ✅ | **Tournament carry-over UI batch (a-e) shipped + deployed 2026-05-25.** (a) `MatchClaimButton` in new `src/components/tournament/MatchClaimAndAi.jsx` wires `vanguardClaimMatch` / `vanguardReleaseMatchClaim`, rendered on TournamentMatchScreen (full label, with status row) + ModWallScreen tile (compact). (b) Commander Review category added to `/vanguard/queue` (sits above Tournaments) — live `collectionGroup('matches').where('commanderReviewRequired','==',true)` subscription; case-detail drawer shows AI vs mod proposed winners + 3 resolution paths (confirm mod / override to AI / pick either side), calls `commanderResolveMatchReview`; Commander+ gated, Seniors see row but can't resolve. (c) New `SquadChampionVote.jsx`: `StartSquadChampionVoteModal` (president opens vote), `ChampionBallot` (members multi-select up to slots+backups, live tally bars, president finalize-button auto-stamps tournament), `SquadChampionVoteEntry` (single button per pending squad tournament). Wired into SquadDetailScreen via new "Pending Tournaments" section (subscribes to `tournaments` where `participants array-contains squadId` and champions not yet locked). (d) `BackupChampionsRow` surfaces both rosters (champions in gold pills + backups in dashed pills) on TournamentMatchScreen for squad-mode matches. (e) `AiSuggestionBanner` reads `match.aiSuggestion` (winner + confidence pill + sources) live on TournamentMatchScreen; compact AI strip on each ModWall tile. ModWall match-data fetch extended with `aiSuggestion`/`claimedModeratorId`/`commanderReviewRequired`. **Indexes (f/g/h) auto-prompted on first query** — click deep-link from function log. **Pre-existing build blockers fixed in transit:** `SpectatorPanels.jsx` + `ModWallScreen.jsx` HlsPlayer path → `../streams/HlsPlayer`, `TrophyCeremony.jsx` compactNum → `../creator/charts`, `WalkOnIntro.jsx` useMaskedUser → default from `../../hooks/useMaskedUser`, `VanguardHandbookScreen.jsx` raw `>` chars escaped to `{'>'}`. |
| 🟡 | **Still pending (carry-over holes, NOT YET DONE):** cheat signatures seed deploy executed (founder click-action on `/admin/cheat-signatures` Seed Defaults button). Consent scope-version re-prompt = ✅ shipped 2026-05-25 (`TournamentMatchScreen.jsx` re-prompts when `consent.scopeVersion !== SCAN_SCOPE_VERSION`). VOD pipeline = ✅ deployed 2026-05-25 (see line above). |
| ✅ | **Vanguard Review Queue real consequences (2026-05-25).** New callable `vanguardResolveQueueItem({kind,itemId,action,notes})` in `functions/vanguard.js`. Wraps in `runVanguardAction` for audit row + monthly action count + rank VP. Per-kind effects: **AI confirm** → `match.cheatFlag.confirmed=true` + `users.tournamentTrust.confirmedFlags++` + subject notif; **AI clear** → `match.cheatFlag.cleared=true` + subject notif. **AC confirm red** → forfeit current match via `_internal_recordMatchResult` (winner=opponent, source='admin') + `users.tournamentTrust.confirmedCheatScans++` + subject notif. **AC confirm orange/yellow** → flag only + notif. **AC clear** → dismiss notif. **RP confirm** → create `tournament_review_queue` doc (`source:'replay_escalation'`) for deeper AI pass + requester notif. **RP clear** → requester notif. Authority gate: AC red confirm needs `canTempBan` (Senior+); everything else `canApproveReject` (Vanguard+). `VanguardReviewQueueScreen` now calls this instead of writing the status field directly. Deployed.|
| ✅ | **Tournament Esports v2 Phase 3 shipped + deployed 2026-05-25.** Team identity + supply gating + RR/Swiss Bo3 + mobile parity. **(P3.1) Squad-as-team identity:** MatchDetailsScreen now loads `getSquad()` instead of `getUser()` when `tournament.mode === 'squad'` and stamps each participant with `{kind:'squad', tag, banner, name}`. `tournamentBracketShape.js → seat()` forwards kind+tag+banner+avatar. `BracketVisualization.MatchCard` renders squad badge (banner thumbnail or tag-letter fallback in gradient pill) + tag prefix on every bracket node — bracket seats now show "TAG · Squad Name 2-1 ✓" instead of "0xabc123". **(P3.2) Soft supply gating:** new `getEligibleSquadCount(minMembers)` in `firestore.js` (cheap: reads top 100 squads by memberCount, returns count); CreateTournamentScreen fetches once on mount, hides/disables squad bracket types when `eligibleSquadCount < smallestPlayers`, shows cyan "Unlocks at X squads" badge with line "Only N eligible squads on the platform — needs X+." Optimistic on query failure (gate stays open). **(P3.3) RR/Swiss Bo3/Bo5 unlock:** `validateSeriesFormat` dropped the RR/Swiss restriction; `startTournamentSecure` + `advanceSwissIfNeeded` + `advanceStageIfNeeded` now stamp `t.seriesFormat` (or `stage.seriesFormat`) on each RR/Swiss match instead of hardcoded `'bo1'`. Series-aware bye stamps proper `seriesScore` like `{a:2,b:0}` for Bo3 byes. Frontend Series Format picker no longer hidden for RR/Swiss. **(P3.4) Mobile parity:** MobileWizard accepts `seriesFormat`/`seedingMode`/`structurePreset`/`eligibleSquadCount` props and renders Tournament Structure + Series Format + Seeding sections in step 2 (same UX as desktop). Mobile format picker also gets supply-gate badge. **Deployed:** `createTournamentSecure`, `startTournamentSecure`. **All 3 phases complete. Tournaments are now real esports tournaments:** Bo1/Bo3/Bo5 series, standard 1v16 seeding (random/manual/rating), bye support, 5 multi-stage presets (Single / Swiss→SE / Swiss→DE / Groups→SE / DE-only), automatic stage transitions with per-format standings (Buchholz/goal-diff/2nd-loss/BR points), squad-as-team identity throughout, soft supply gating, AI auto-suggestion + Commander override gate, hardware fingerprint, anti-cheat scan, stream-drop forfeit, webcam mandate at high stakes, real TP/VP/XP fan-out, trust scores, dispute timeline. |
| ✅ | **Tournament Esports v2 Phase 2 shipped + deployed 2026-05-25.** Multi-stage tournaments. **Backend (`functions/tournamentStages.js` new):** tournament gains optional `stages[]` array — each stage = `{id,name,type,seriesFormat,seedingMode,advanceCount,swissRounds?,brGameCount?}`. 4 presets shipped: Single Stage (legacy), Swiss→SE (top 8 → SE Bo3), Swiss→DE (top 8 → DE Bo3), RR Groups→SE, DE-only Bo3. `tournament.currentStageId` tracks active stage; `match.stageId` scopes to stage (missing stageId = stage 1 for legacy compat). New `advanceStageIfNeeded` invoked from both `autoCompleteNonSingleElimIfDone` and `advanceBracketAfterMatch`'s final-completion branch — computes stage standings (per-format Swiss/RR/SE/DE/BR ranking helpers), takes top N advanceCount, applies next-stage `seedingMode` (inherit/random/rating), routes to the existing per-format match-doc builders with `{stageId}__` prefixed match IDs, flips `tournament.type` to the new stage's type so subsequent auto-complete checks fire correctly, appends to `stageHistory`, sends per-advancer push notification. **Backwards compat:** tournaments WITHOUT `stages[]` keep working identically (implicit single-stage); zero churn for in-flight legacy tournaments. **Frontend:** CreateTournamentScreen gains "Tournament Structure" picker with 4 preset cards (stage_1's type/seriesFormat/seedingMode auto-mirrors top-level fields so backend validation passes). MatchDetailsScreen bracket tab gains `<MultiStageTabs>` for multi-stage tournaments — chip per stage with completed checkmark + current-stage pulse dot; bracket viewer filters matches by `viewStageId` and routes to the right viz (SingleElim/DE/RR/Swiss) per stage's type. `tournamentBracketShape.js` already series-aware from Phase 1, no changes needed. **Migration script** at `functions/scripts/migrateTournamentsToStages.js` — dry-run by default, prints diff per doc + unsafe-row warnings, refuses to touch already-migrated. Hard-migrate not blocking since design is additive; run with `--apply` for uniform data shape. **Deployed:** `createTournamentSecure`, `startTournamentSecure`. **Phase 3 next** = squad-as-team locked roster per tournament + soft supply gating (hide formats with insufficient squad supply from create flow). Mobile CreateTournament wizard still missing structure picker (deferred). |
| ✅ | **Tournament Esports v2 Phase 1 shipped + deployed 2026-05-25.** Series + seeding + byes. **Backend (`functions/tournamentSeries.js` new):** `seriesFormat: 'bo1'\|'bo3'\|'bo5'`, `seriesScore: {a,b}`, `games[]`, `seriesWinner` stamped on every match doc at `startTournamentSecure`. New `reportGameResultSecure` callable records one game in a series — trusted sources (admin/mod/host) credit immediately; player reports need opponent agreement per-game (disagreement marks THAT GAME disputed, series continues). When either side hits ⌈N/2⌉ wins, helper invokes `_internal_recordMatchResult` so bracket-advance + payouts + bets + ranking + TP all run identically. `validateSeriesFormat` rejects Bo3/Bo5 for BR/RR/Swiss + BR-category games (Bo1 only). `reportMatchResultSecure` left untouched = Bo1 shim. **Seeding:** `startTournamentSecure` honours `t.seedingMode`: `'random'` (default — shuffle then standard bracket placement), `'manual'` (host order = seed), `'rating'` (sort by `users.tournamentPoints` desc). Byes already worked via `buildSingleElimRound1` pow2 padding — verified pass-through. **Frontend:** `CreateTournamentScreen` gained "Series Format" (Bo1/Bo3/Bo5) + "Seeding" (Random/Manual/Rating) cards in step 2 (hidden for BR/RR/Swiss). New `SeriesScoreboard.jsx` on TournamentMatchScreen renders big 2-1 score + per-game pips (1/2/3/?/!) + "Report Game N" buttons calling `reportGameResultSecure`; Bo1 matches fall through to the legacy "I won / They won" CTAs unchanged. `tournamentBracketShape.js` derives `homeScore`/`awayScore` from `seriesScore`; `BracketVisualization.MatchCard` shows per-side game-wins + series-format pill (Bo3/Bo5) above each node. **Deployed:** `reportGameResultSecure` (new), `createTournamentSecure`, `startTournamentSecure`. **Phase 2** = multi-stage tournaments (Swiss→SE, RR groups→SE) + one-time hard migration script. **Phase 3** = squad-as-team locked roster per tournament + soft supply gating. Solo 1v1/FFA paths stay first-class. Mobile CreateTournament wizard inherits safe defaults (Bo1 + random); explicit mobile controls deferred to a follow-up. |
| ✅ | Tournament **Champion Picks** — skill-prediction layer, NOT gambling. Pari-mutuel pool share but rebranded throughout: "pick" not "bet", "back" not "wager", "reward" not "winnings", visual "support bar" not numerical odds. Stake 10c-5000c per spectator per match. **Daily cap of 3 picks per spectator** (skill framing — keeps it out of grind/casino territory). Streak + accuracy tracked on `users/{uid}.predictor` (currentStreak, totalCorrect, totalRewardCoins). Rewards = withdrawable `balance` (founder mandate: ToS shifts gambling-regulation liability to user, geo-block + KYC tiers gate jurisdictions). Players cannot pick on their own match. Picks lock at match start. Pari-mutuel formula: `reward = stake / winningStakes × totalPool`. Top Predictor + Hottest Streak leaderboard categories added. `settleMatchBets` reads from `picks/` subcollection, updates streak counters, hooks into `recordMatchResultInternal` completion path. `refundMatchBets` available for cancelled/disputed paths (not yet wired). Visuals deliberately cyan/violet, no gold-rush styling, no casino iconography. |
| ⚪ Deferred (profit-gated) | Co-host interactive games + TikTok-style gifting (see Gifting section) |
| 🟡 | Stream goals (see spec) |
| 🟡 | Creator Fan / Super Fan recurring memberships (see spec) |

### P3 — backlog (don't start without founder go-ahead)
- Tournament Plan B (non-cashable tournament-won coins) — DEFERRED. Spec in `CLAUDE.md.bak`. Reactivation ~4-6h.
- Estonia OÜ incorporation via e-Residency (unblocks processor underwriting + liability shield; ~€750 yr1; legal-text-only change).
- Tournaments → PostgreSQL migration (only if bracket queries slow / cross-tournament leaderboards needed).
- Geographic SFU federation (trigger: first APAC/NA-West voice-lag complaint).
- `/security` disclosure page + `security@vergr.app`.

Status legend: ✅ done · 🟢 in progress · 🟡 planned · 🟡 Partial · 🔴 blocked · ⚪ deferred.

---

## Hard rules (do not violate)

- **NEVER remove a feature/screen/route/button/link without explicit permission.** Don't "clean up dead links" or delete duplicates from both places. Broken/unbuilt screen → build it or stub "Coming soon", don't delete the entry point. When in doubt, ASK.
- **The Android APK can be built WRONG in ways that still compile, install and run. Verify the ARTIFACT before publishing, never the command you typed.** `node scripts/publish-apk.mjs` enforces this now (it reads the finished APK and refuses to upload a bad one); do not weaken or bypass those guards. The three silent failures, all of which shipped to the founder's phone on 2026-08-13 and cost a day (full detail in "1.0.193 APK shipped as a WEB build" and "Native CSP blocked all video" below):
  1. `src-tauri/tauri.android.conf.json` missing → tauri falls back to the desktop `beforeBuildCommand` (`npm run build`) → `__VERGR_NATIVE__` false → **every native screen, safe-area inset and the mobile `useResponsive` tier compiles out.** Check: `unzip -p <apk> assets/tauri.conf.json` must show `beforeBuildCommand: "npm run build:android"`.
  2. `app.security.assetProtocol` off or unscoped → **every `convertFileSrc()` URL dies** (gallery thumbnails, on-device media cache, transcode, share-in). Same check, same file.
  3. A CSP directive that is ABSENT inherits `default-src`, which is deliberately tight, so it BLOCKS rather than allows. `media-src` missing killed all video and audio; Android serves the asset protocol over `http://asset.localhost`, not `https://`.
- **Nothing that decides how the app is built may sit UNTRACKED in git.** All four `src-tauri/tauri.*.conf.json` files are tracked for this reason. A `git checkout`/`reset`/`clean` deleted them once and nothing failed, it just built the wrong app. If a build config is not in `git ls-files`, that is a bug to fix, not a detail.
- ⚠⚠ **YOU ARE NEVER ALLOWED TO MAKE A CHOICE THAT COSTS THE FOUNDER MONEY. EVER.**
  Founder, 2026-09-06, verbatim, after a Cloudflare bill arrived: *"YOU ARE NEVER ALLOWED TO
  MAKE A CHOICE THAT WILL COST ME MONEY, EVER! IS THAT UNDERSTOOD!"*

  **Absolute. Not a default, not a trade-off, no threshold below which it is fine.** "It is
  only a few dollars", "it is inside the free tier" and "it pays for itself" are all
  violations. When a design needs spending: STOP, say what it would cost, say what the free
  alternative is, and let him choose.

  **What counts as spending — all banned without an explicit yes:** a storage class,
  lifecycle rule or retention setting; a Cloud Scheduler job or any new cron; a new service,
  box, plan, add-on or paid tier (Hetzner, Cloudflare, Firebase, GCP, Play, a processor);
  anything billed per call, Gemini above all — **including raising the RATE at which an
  existing paid call fires**; raising a cap, quota, cadence or sampling frequency with a
  per-unit cost; writes that scale with users (Firestore bills per write, so a per-view or
  per-impression write is a spending decision even at fractions of a cent); moving a counter
  or log onto a billed backend.

  **It has already happened twice.** (1) The R2 `cold-storage` lifecycle rule was switched on
  as an "optimisation" and produced this project's first Cloudflare bill: **$9.92 for 38
  objects totalling 32 MB**, because Infrequent Access has NO free tier and every transition
  rounds up to a whole billing unit. See the R2 section. (2) Boost-impression counting was
  moved into a shared reader "for correctness", which widened how many sessions reported;
  reverted the same day — *"you changed it without my permission which in effect will
  increase my costs."* **Correctness is never a reason to spend his money.**

- **Zero out-of-pocket cost.** No new paid services. Firebase Spark-compatible only.
- **NEVER use em dashes (—) in any output to the user** (chat, commits, PRs, emails, code comments, this file). Use commas/periods/parentheses/colons.
- **Terse output.** No trailing recaps, no emoji in code/docs unless asked.
- **Don't wander.** Only do what's asked. No proactive docs/refactors/tangents.
- **Always update this file when work completes** (move shipped → done, add new follow-ups). Don't wait to be asked.
- **Material Symbols:** loaded font is `material-symbols-outlined`. Never use `material-symbols-rounded` (not loaded → renders raw text). Use `<Icon name="..." />`.
- **TOURNAMENTS DO NOT EXIST. Stop re-raising them.** Retired 2026-08-09, unrouted, and on 2026-08-16 the founder ordered the CONTENT deleted too: the 37-article help category, 7 tournament articles hiding in other categories, the `TOURNAMENT_RULES` legal document, and the growth funnel that was built on prize pools and money matches. `AppRouter.jsx` mounts exactly ONE tournament route and it is admin-only (`/vanguard/lookup/tournament`). The huge tournaments section above is DEAD-CODE DOCUMENTATION for files still on disk. Never cite entry fees, prize pools, mod cuts or prize payouts as current.
- **[RETIRED, see above]** Tournament prize payout (was: winner-takes-all for every bracket type). Solo wins → winner's wallet; squad wins → winning squad's treasury (`squadTreasuryPct:100`). No 2nd/3rd/4th coin payouts. Multi-place rewards happen only in (a) Tournament Points on the global leaderboard (1000/600/400/250/175/100/50/25 by `tournamentPointsFor`) and (b) placement XP/VP for top 3 (`squadXpByPlace`/`vpByPlace` in `finalizeInternal`) — these are separate from coins. Source: `src/utils/tournamentTypes.js` + `functions/tournamentRules.js` PRIZE_DISTRIBUTION, payout loop in `functions/tournaments.js → finalizeInternal`.
- **Coin ladder is NATIVE USD** (re-denominated 2026-08-11). 8 packs, $0.99/78 coins to $249.99/21,500 coins, floor $0.01163/coin, one worldwide price. Source: `COIN_PACKS` in `src/utils/vpSystem.js` (line numbers drift, grep the name). **NOTHING IS WITHDRAWABLE. Users can never withdraw anything, ever.** Coins are a revocable licence to access features, no cash value, non-transferable; the accrued revenue share Vergr owes lives in micro-USD on `wallets/{uid}.owedMicroUsd` and is NOT a balance. GEMS NO LONGER EXIST (deleted 2026-08-16, see that section). `requestWithdrawal`, `sendGems`, `quoteGemSend`, `buyCoinsWithGems` and `convertCoinsToGems` are all deleted and undeployed. The old €0.0090 floor, "gems are the only withdrawable currency" and "min payout 1,000 gems" lines were all stale and are deleted. Regional pricing applies to SUBSCRIPTIONS ONLY (`functions/geoPricing.js`), never coins. Referral: referrer +5,000 VP, referee +3,000 VP, server-gated.
- **Revenue share is the ONLY model. There is no fee on any surface.** A tip, membership, ticket, season pass, locked-content unlock, ad reward and referral all credit the FULL amount as gross revenue; Vergr's share is taken ONCE, when the creator accrues. Creator keeps **50% rising to 80%**, keyed to LIFETIME GROSS EARNED, never to VP and never to plan (`functions/coinLedger.js:169` `REVENUE_SHARE_RATES` + `shareForEarnings`). Active Vanguard keep 100%. `entitlements.js feePctFor()` returns **0**. ⚠ The old "flat 10% at send time, recipient gets floor(N×0.90)" rule is **DEAD** (removed from all copy 2026-08-16) and `firestore.js` `sendCoins` merely forwards to the `sendTip` callable. The ONE genuinely different rate is Vergr.me shop sales: flat 8%, seller keeps 92%, credited directly (`vergrMeShop.js:39`, founder-locked).
- **Creator quests award VP only, never coins.**
- **What a LEVEL gives you lives in `src/utils/rankUnlocks.js`, and nowhere else.** Built 2026-08-23. Two locked rules: (1) rank shows in LIVE CHAT and the STREAM ENTRANCE RIBBON only, never on an avatar ring (that ring means live or status); (2) every reward resolves from `users/{uid}.vpLevel` alone, so it costs ZERO reads. The chat crest is free because the relay already loads the sender profile once per connection; the VP earn bonus is free because both credit paths already read the user doc for the plan multiplier. ⚠ **Do not add a row to that table for something that does not exist yet.** Eight rewards were cut before shipping for exactly that reason (emote packs, pinned-post slots, comment tint/pin, audio clip, profile links, trophy case, post reactions): none had a system behind it. Build the system, then add the row. Full record: `docs/GAMIFICATION_PLAN.md` build-state block.
- **Revenue categories:** Tips, Memberships, Tournament prizes, Boosts. No Ads/Sponsored/Gifts category.
- **Content types:** Text, Photo, Clip, Article, Short, Achievement, LFG, TierList, Quote, Live Stream. No "Reels".
- **Moderation UI belongs to Mod/Manager/Owner dashboards, NOT the creator dashboard.** Creator dashboard must work mobile + desktop. Mod/Manager/Super-Admin dashboards are desktop-only-actions.
- **Always compress before uploading:** `compressMedia(file, tier, preset)` from `src/utils/mediaCompression.js` before `uploadToR2()`. Presets: avatar/background/post/chat. `firestore.js` helpers `uploadAvatar/uploadBanner/uploadFile` + `mediaHelpers` already compress; direct `uploadToR2` callers must compress themselves.
- **Streaming routing (LOCKED):** (1) 1-on-1 voice/video DM = raw WebRTC P2P (Google STUN + self-hosted coturn TURN fallback on `91.98.79.244:3478`, creds via `getTurnCredentials` callable HMACed with `COTURN_SECRET`). (2) Squad streams (≤100 members, voice + ≤2 video) = **Pion SFU** on Hetzner. (3) Public single-broadcaster = browser fMP4 / OBS RTMP → nginx-rtmp → HLS → R2 → Cloudflare CDN + `p2p-media-loader`. (4) Public co-host + tournaments = Pion SFU ingest room → ffmpeg `xstack` → nginx-rtmp → HLS → CDN; **tournaments disable p2p-media-loader** (prize-money reliability). **Never call it Jitsi.** Pion is the only SFU (no Mediasoup/LiveKit/Janus).
- **Source-upload bitrates (LOCKED):** Free 480p30 @ 3 Mbps (intentional paywall lever — Lite jumps to 720p60), Lite 720p60 @ 4.5 Mbps, Pro 1080p60 @ 6.5 Mbps. Single-rendition (no transcode ladder). Viewer cap matches source.
- **Free public live streaming requires 100 followers + 50-coin Stream Boost.** Boost is a real growth lever, not a punishment: refunded by first 50 coins of tips, +1.5× discovery visibility, push-notif eligibility, surfaced to high-`likelyTipperScore` viewers, shows "Boosted" badge. Lite/Pro skip the fee but can opt-in.
- **`liveStreamingPaused` / `freeUploadsPaused` global kill switches** in `app_config/general` (5s halt, no redeploy).

---

## Stack + conventions

- React 18 + Vite SPA, **BrowserRouter** (migrated; the `#/` era is over, and `firebase.json` already has the SPA rewrite). Tailwind (no `grid-cols-24` — use inline `gridTemplateColumns`). Firebase v10.14 (Firestore **named DB `vgrdb`**, Functions `europe-west1`, Hosting, FCM). Recharts, Dexie. Tauri desktop wrapper. Material Symbols via `<Icon name="..."/>`. Fonts: Syne (headings), DM Sans (body), DM Mono (numbers + `tabular-nums`).
- **Cloud Functions use `getFirestore('vgrdb')`** (named DB), not default. `admin.initializeApp()` runs in `index.js` before module requires. New scheduled crons: `functions.scheduler.onSchedule({ schedule, region:'europe-west1', timeZone:'UTC' }, fn)` in a module, re-exported from `index.js`.
- Numbers: `font-dmmono font-bold tabular-nums`. Empty states always present. Firestore timestamps: normalize via `tsMs(t)`. Currency: coins `compactNum`+`"c"`, USD shown alongside not instead.
- **Never create new files unless necessary.** Prefer editing. No unsolicited README/docs.

### Design tokens (source of truth: `tailwind.config.js`)
```
--brand-cyan #4DFFD4 · --brand-violet #7B1FFF · --brand-violet-light #B44FFF · --brand-pink #C87FFF
--brand-gold #F0A500 · --brand-gold-light #F5C842 · --brand-ember #F04060 · --gem-blue #3D7FFF
--bg-dark #0B0B14 · --surface-1 #14141F · --surface-2 #1A1A2A
--text-primary #FFFFFF · --text-secondary #9CA3AF · --text-muted #6B7280
```
Chart palette: `src/components/creator/charts.jsx → PALETTE`. Note: settings/wallet/admin/composer redesigns deliberately use inline-style scoped palettes (not Tailwind tokens) — not brand drift; don't "reskin to match" without asking.

### Material surface system (`src/styles/surface.css`, added 2026-08-15)
**Founder ruling: hairline outlines on every box read as cheap AI design. Vergr is a social/entertainment app, not a fintech dashboard. Do NOT use Stripe/Linear/Revolut as visual references.**

Root cause of the border habit: page `#0B0B14` to surface-1 `#14141F` is only a 3.5% value step and `tailwind.config.js` has no boxShadow scale, so a 1px stroke was the only way to make a surface visible. Fix the ladder, not the symptom.

Reusable classes (compose them, they are independent):
- `.vg-material` offset radial sheens (warm high left, cool low right) over a near-black base, so light has a direction.
- `.vg-grain` inline feTurbulence noise at 42% on soft-light. **This is the single biggest cheap-to-designed lever on a dark UI** and costs zero assets.
- `.vg-beam` / `.vg-beam-violet` conic gradient rotated via a registered `@property --vg-angle`, masked to a 1px ring, so light travels the perimeter. Degrades to a static gradient edge without `@property`.
- `.vg-rule-v` / `.vg-rule-h` dividers that fade at both ends. A rule that stops at full strength reads as a cage edge.
- `.vg-tile` raised inner surface with NO stroke: lifts by value plus inset highlight plus shadow, with press-scale.
- `.vg-seg` / `.vg-knob` ring-segment draw-in and track-knob halo pulse. All motion respects `prefers-reduced-motion`.

First adopter: `TierHero` in `CreatorEarningsScreen.jsx` (4 zones, 12-segment gauge ring via `pathLength=100`, glowing track knob, raised lifetime tile). Native re-exports the web screen so one edit covers both. **Art slot** at `/brand/earnings/tier-vault.webp` (1x 25KB) + `@2x.webp` (61KB), founder-supplied render trimmed from 1536x1024/300KB. Served via `<picture>` with a `media:(min-width:1024px)` source so phones never fetch it, plus a 370-byte inlined LQIP as the sub-lg src and first-frame paint. Still self-hides via onError.

⚠️ **`firebase.json` has a catch-all `**` rule of `no-cache, no-store, must-revalidate`.** Any new static directory under `public/` is therefore re-downloaded on EVERY load until it gets its own headers entry. `/brand/**` now mirrors `/media/**` (7d browser, 30d CDN). Check this before blaming an image for being slow.

**Gold is NEVER a solid fill.** Flat `#F0A500` reads as orange paint. Real gold is the ramp `#FCEFB4 → #F5C842 → #E9A517 → #C97F12`: `GOLD_TEXT` clips it to glyphs (glow must be a `filter`, not `text-shadow`, since the text is transparent), an SVG `linearGradient` fills the ring segments, and the track fill uses the same stops. Same rule for violet and pink when those surfaces get built.

**The gauge plots the SHARE, the track plots progress-to-next-tier.** They are different numbers. Conflating them shipped a ring sitting at 0% next to a label reading 50%. Ring segments are chunky (strokeWidth 15 at r44 in a 120 viewBox, 16 butt-capped segments) and unlit segments sit at `rgba(255,255,255,0.13)` so the empty part of the gauge is legible charcoal, not invisible.

**Carved, not painted (`.vg-deboss` / `.vg-hub` + the SVG `carve` filter).** Dark neumorphism: the plate is charcoal (a DIFFERENT value from the material around it, never the same grey), lit from the upper left, so the top-left inner wall falls to shadow and the bottom-right catches light. Reverse those and it pops out instead of sinking in. The track blocks run through an inner-shadow filter (offset the alpha down, subtract, flood black = a dark top wall; offset up = a lit bottom wall) and the hub sits inside casting onto the groove floor, which is what gives the channel two walls.

**Glow must be ONE blurred copy of the whole lit arc, not a per-segment `drop-shadow`.** Per-block shadows on butt-capped rectangles give every segment its own square halo, which reads as blocky.

**Superseded, keep both facts.** One blurred copy is still just a blur. Emission is ADDITIVE: three passes (stdDeviation 1.1 / 3.6 / 9, opacity .42 / .34 / .22, hottest and narrowest at the core) in their own overlay layer carrying `.vg-bloom` (`mix-blend-mode: plus-lighter`, `screen` fallback) so light SUMS with the panel behind it. The bloom layer must sit UNDER the sharp blocks: painted over them it washes each face flat and destroys the bevel.

**A recess must fade to zero BEFORE it reaches an edge.** Shading a hard-edged disc gives a black circle pasted on the surface, and the eye reads the boundary instead of the depth. The recess element is `-inset-[30px]` (larger than the ring) so its falloff has room to die outside the ring bounds. Directional walls (dark upper, lit lower) are masked to the annulus with a feathered `radial-gradient` mask.

**Each block is beveled with three concentric strokes** (face, outer highlight, inner shade). `pathLength=100` normalises per-circle, so a bevel stroke at a different radius lines up angularly with its own face for free.

⚠️ **Do not ship this class of work unrendered.** Three consecutive versions shipped blind and all three were wrong. Screenshot loop that works here: a scratch `preview.cjs` serving the real markup against the real `surface.css` on a fresh port, then `chrome.exe --headless=new --screenshot --force-device-scale-factor=2`, writing to a path OUTSIDE the scratchpad (Chrome gets Access Denied there). Reuse it before touching this panel again.

### MEASURE the reference, never eyeball it (2026-08-15, learned the expensive way)

Five rejected passes on this one ring, all the same root cause: working from an impression of the founder mockup instead of its pixels. Numbers pulled with `sharp` (circle-fit the gold pixels for the centre, radial profile for the band edges, angular walk at band-centre for the block count and duty, direct sampling for colour):

| Property | Measured | What had shipped |
|---|---|---|
| Segments | 12 | 12 ✓ (had drifted to 16 once) |
| thickness / mid-radius | **0.159** | 0.368 (2.3x too thick) |
| Duty cycle (block/pitch) | **0.935** | 0.72 (gaps far too wide) |
| Unlit block | **#20232A** | #3A3D46 |
| Gold ramp | **#FAE177 top → #EDAB2A bottom** | #FFF6D4 → #DE9A0C |
| Interior vs page | lum 9.5 vs 7.5, **no disc** | a black pool |

**A blur is not a glow, and no amount of tuning a blur fixes that.** The measured falloff is amber, ~33% of source luminance immediately beside the block, dead within one band-width. Drawn as four concentric strokes sharing the block dash pattern: gaps stay dark (a Gaussian floods them), the falloff is exact, and there is zero filter cost. `feGaussianBlur` is now absent from this screen and should stay absent.

The measuring scripts are worth rewriting whenever a pixel-accurate mockup arrives. Run them from the repo root so `sharp` resolves.

#### Measured 2026-08-15 from three founder mockups (hero panel, tier list, stat cards)

**The one construction repeated everywhere:** a coloured fill anchored TOP-LEFT dying to near-black bottom-right, inside a 1px border that is saturated at the TOP and gone by the BOTTOM. It is never a stroke. Stat cards: border top #33552D / #5C431B / #4F245F against a bottom of #000105; fill #1A3718 / #231B0B / #190D21 to #060A0D. Shipped as `.vg-wash` (drive with `--vg-accent` and `--vg-wash`).

**Hero panel background:** plane from lum 14.3 top-left to 7.2 right, a 2x range, cool hue (B over R by ~1.5). Light upper-left, falls off horizontally more than vertically.
- Detrended grain sd 0.43-0.71, i.e. ±0.5 levels. Grain must be almost subliminal (opacity 0.07, was 0.40).
- Directional autocorrelation 0.34 / 0.30 / 0.29 / 0.11. **NO brushing.** An earlier pass added diagonal streaks that are not in the reference; they are removed. Radial washes plus a real gradient is what stops it reading flat, not texture.

**Border:** 1px, radius ~7px at 847px panel width. Neutral base #1C1D1E (solved: white at 0.11), amber peak #715B21 on the LEFT edge at 60% height (solved: rgba(240,190,70,0.45)), secondary amber on the top edge above the ring. The founder explicitly asked for light that travels the perimeter, so `.vg-beam` stays animated, retuned to this palette (it was running a #F8D24E peak at 0.95, far too hot).

**Dividers:** 1px, peak lum 89 = contrast 79 over the panel, warm, ramping in by 18% and out from 76%, warming toward the bottom. `.vg-rule-*` had been running at ~a third of that.

**Inner tile:** fill only +4 lum over the panel (#0B0D11 vs #07090D), lit top edge lum 22, bottom edge DARKER than the panel at 6. A shallow lift, not a raised card. `.vg-tile` was ~3x too strong.

**Tier list** (`TierLadder` in CreatorEarningsScreen): rows on a 26px pitch, **no separator lines between rows**, only the current row has a border, only the current row's percentage is gold (#E7CC28) while the rest are white (#E0E0E3). Current row is NOT glass: an amber wash anchored LEFT (lum 20.3 at x=30 falling to 10.9 by x=700) inside a 1px amber border brightest on the left (135), then top (87), then bottom (55). Rail: 6 dots at 84.6px pitch, 7px diameter, lit #F5C53B / unlit #343942, 2px connector #191C21. Badge ring per tier: gold / silver / silver / bronze #CC9650 / olive #B7C367 / cyan #37B2D1 / violet.
- ⚠️ **Tier 6 cyan comes from the mockup and conflicts with [[project-brand-no-cyan]].** Isolated in `TIER_ACCENT` as a one-line change if the brand rule wins.
- ⚠️ Rail fills in the mockup (43/9/7/5/4/3/3 percent against a lifetime of $0.00) match no formula and are placeholder. Implemented as real progress toward each tier threshold instead; rows 2-7 look identical, row 1 differs because it shows a true number.
- **Rows must be a GRID, never a flex line.** The CURRENT pill only exists on one row, so as flex it pushed that row's threshold, rail and percentage ~90px right of every other row. Columns are `26px 46px 66px 128px minmax(0,1fr) 48px` and the pill column is RENDERED EMPTY on non-current rows so nothing reflows.

#### Earnings screen, remaining mockups (founder supplied 2026-08-15, in `Downloads/vergr-mockups/`)

DONE: `PayoutSpeed` (replaces `CadenceLadder`) and `InfoDot`.
- `InfoDot` is a transient hover/tap popover. Do NOT wire a per-figure "i" to `components/InfoTooltip`: that is a dismissible banner that writes a localStorage flag, so the icon would vanish permanently after one read.
- **The mockup labels the first requirement "Account age". The server does not gate on account age.** `resolveCadence()` gates on days since FIRST PAYOUT + successful payouts + KYC level + no strikes. The mockup also omits the KYC row entirely. This surface decides when someone gets money, so it follows the rule, not the picture. `getPayoutAccount` now returns `daysSinceFirstPayout` and `nextCadence {key,label,minDaysSinceFirstPayout,minSuccessfulPayouts,minKyc}` so the UI can never drift from the server. Deployed.

NOT DONE, still only mockups:
- **Set up payouts hero** (`ChatGPT Image Aug 14 11_32_08 PM`, top half). Needs a 3D wallet render, same slot pattern as `/brand/earnings/tier-vault.webp`.
- **Earnings over time** (`Aug 14 11_38_09 PM` bar + `11_37_48 PM` line). 4 KPI cards with coloured icon chips (gold/violet/blue/green), a bar-vs-line toggle, gold gradient bars with value labels, footer note. Recharts is already in the stack.
- **Where it came from** (`Aug 15 12_03_22 AM`, top). Source list + donut + right-hand table + "Top source" callout + date-range picker. `DonutChart` and `SOURCE_DEFS` already exist.
- **Statements table** (same image, middle). Columns, green status pills, per-row download/view actions, pagination. `Statements` component exists and needs the design pass.

**ALL SHIPPED 2026-08-15.** `SetUpPayouts` (enrolment banner, art at `/brand/earnings/payout-wallet.webp` 1x 27KB + @2x 68KB from the founder-supplied render), `EarningsOverTime` (4 KPI cards, bar/line toggle, Recharts), `WhereItCameFrom` (source list + donut + table + Top source), `Statements` (table, status pills, pagination), plus shared `HexIcon` / `PanelHead` / `RangePicker` / `KpiCard`.

**TWO gate sets exist in `functions/creatorPayouts.js` and only one was being shown:**
- `blockingReason()` decides whether you get paid AT ALL: 3+ active strikes, frozen, kycLevel < 1, tax form not on file, no `partnerPayeeId`, balance under `MIN_PAYOUT_GEMS`.
- `resolveCadence()` decides HOW FAST: any active strike drops to standard, then days since **firstPayoutAt** (90/180), successfulPayouts (3/12), kycLevel >= 2.
Showing only the second lets someone see green ticks while an unshown condition holds their money. `PayoutSpeed` now renders both groups.

✅ **ACCOUNT-AGE GATE SHIPPED 2026-08-15 (founder-instructed, non-negotiable).** `MIN_ACCOUNT_AGE_DAYS = 30` in `functions/creatorPayouts.js`. Enforced inside `blockingReason()`, which means it gates the payout RUN (`buildRunPlan`) and not just the screen. **Fails CLOSED:** an unreadable `users/{uid}.createdAt` is treated as too new, because holding a legitimate payout one cycle costs far less than releasing one to a fraudulent fresh account. Rationale from the founder: abuse (DM scams, chargeback rings) surfaces days after signup, not on day one, and the account must be old enough for a report against it to have been filed and actioned. Reason code `account_too_new`; `getPayoutAccount` returns `accountAgeDays` + `minAccountAgeDays`. The screen renders a "your first payout unlocks soon" state, NOT "finish setup", because there is nothing to finish. Deployed with `runCreatorPayouts` + `previewCreatorPayoutRun`.

⚠️ Statement docs carry `runId, gems, amountMicroUsd, cadence, periodFromMs, status, createdAt`. There is **no earnings/fees split** (the share is applied upstream, `amountMicroUsd` is already net), so the mockup's EARNINGS and FEES columns are deliberately absent rather than fabricated.

**Rotate the `<g>`, never the `<svg>`.** Rotating the root carries the gradients with it and tilts the light source off the panel's own.

**Metal needs direction.** Radial washes alone still read as a flat fill with a glow on it. `.vg-material` layers two frequencies of anisotropic brushing at 114deg plus one broad specular band, over a base that falls vertically. **Segment count and colour come from the founder's mockup: 12 segments, gold ramp `#FFF0BC → #F8D24E → #EFB01C → #DC9A10` (no brown).** Do not adjust either without being asked.

⚠️ `var(--brand-gold)` is NOT defined globally (only inside `TournamentOverlayNeon.jsx`). Using it elsewhere silently voids the whole declaration. Use literal hex. Fixed one such dead gradient on the earnings progress bar.

App-wide sweep is agreed but NOT done: 2,211 border declarations across 383 files, no shared Card primitive. Order: PostCard/feed, Shorts, live viewer, profile, messages, create, wallet, settings. Admin stays boxed (dense tables are the one place a rule helps).

### Key paths
| Path | Purpose |
|---|---|
| `src/router/AppRouter.jsx` | All routes. Creator Studio + wallet `/wallet/*` live outside `MainLayout`. |
| `src/layouts/MainLayout.jsx`, `components/ResponsiveLayout.jsx`, `BottomNav.jsx` | App shell (`HIDE_ON_PATHS` hides bottom nav on immersive routes). |
| `src/components/creator/{CreatorLayout,Widgets,charts}.jsx` | Creator Studio chrome + KPI/chart primitives. |
| `src/firebase/firestore.js` | All Firestore helpers (`createPost`, `createPoll`, `getAudienceActivity`, `searchUsers`, `getFollowers`, etc.). |
| `src/context/{UserContext,AuthContext,UIContext,LayoutContext}.jsx` | `profile`/`wallet`, `currentUser`, `showToast`, `setRightPanel`/`setContentAlign`. |
| `src/hooks/useResponsive.js` | `{ isDesktop, isTablet, isMobile }`. |
| `src/utils/{vpSystem,tierSystem,badgeSystem,vanguardRanks,tournamentTypes,mediaCompression}.js` | Source-of-truth constants. |

### Creator Studio screens
All wrap in `<CreatorLayout page=... title=... subtitle=...>`. Routes: `/creator/{dashboard,earnings,content,schedule,audience,community,quests,membership,analytics,verify}`. Community has NO moderation. Quests = VP only.

---

## 💳 Wallet (Option 1 self-custody) — build phases

| Phase | What | Status |
|---|---|---|
| 0 | Circle Wallets + omnibus + Firestore schema + `functions/wallet.js` (12 callables: PIN scrypt + TOTP + whitelist + HMAC unlock tokens) + firestore.rules | ✅ |
| 1 | Wallet UX: `WalletLayout` shell + onboarding + 13 screens (`src/screens/wallet/v2/*`) + walkthrough | ✅ |
| 2 | PIN + 2FA gates (`WalletUnlockContext.requirePin` 5-min HMAC window, `PinUnlockModal`, `useWalletUnlock`) | ✅ |
| 3 | Deposit detection (`circleWalletsWebhook` + `pollCircleDeposits`, idempotent) | ✅ |
| 4 | ~~Crypto withdrawal pipeline~~ | ❌ **DELETED 2026-08-16.** `functions/withdrawals.js` is gone and every withdrawal callable is undeployed. |
| 4b | ~~Bank withdrawal~~ | ❌ never existed, never will |
| 5 | Compliance: geo-block, Chainalysis sanctions on Base, Travel Rule data, SAR cron, ToS/Privacy | 🟡 |
| 6 | Software guards: TimelockController on Base, Alchemy auto-freeze watcher, reconciliation cron, PoR publisher, insurance Circle wallet, bug bounty page | 🟡 |
| 7 | Commission extraction admin screen (three-bucket ledger + 5% insurance auto-route + TOTP gate, 80% cap, 24h cooldown, 7-day whitelisted founder dest) | 🟡 |

**Wallet UI = its own navigation** ("Exit Wallet" button), single UI for everyone (no persona branching). **There is no Withdraw screen and no Convert screen** (routes removed 2026-08-15). Coin packs = 8 fixed SKUs (`COIN_PACKS`, native USD) + custom amount, `MIN_CUSTOM_USD = 10` (`src/screens/wallet/v2/buyCheckout.js:29`). Buy = in-app PayRam popup (card/crypto) with status polling. Use real `RANK_TIERS` (11 tiers), real `commissionForLevel()`. **The floor is 15%, NOT 5%, and it is keyed to TOTAL VP, not level:** `COMMISSION_RATES = [0.30,0.28,0.25,0.22,0.20,0.18,0.15]` against `VP_THRESHOLDS = [0,500,2000,5000,15000,40000,100000]`, mirrored byte-identical in `src/utils/vpSystem.js:86`, `functions/economy.js:31`, `functions/coinLedger.js:194`. Active Vanguard are exempt (0%).

**KYC tiers (Didit, extend `KycWizard.jsx` with flow types):**
| Level | Verification | Unlocks |
|---|---|---|
| L0 | none | buy/tip/earn/deposit. Cannot withdraw. |
| L1 | ID + selfie | required before Vergr pays a creator their revenue share |
| L2 | + proof of address | higher lifetime payout ceiling |
| L3 | + source-of-funds | highest payout ceiling |

⚠ **This table used to describe user-initiated crypto withdrawal limits. That is gone.** KYC now gates only whether Vergr can pay a creator on Vergr's own schedule. The remaining caps live in `functions/creatorPayouts.js`, not here — read them there.

**Platform revenue accrual:** ⚠ **THERE IS NO TIP FEE.** The "tip 10% fee" this line used to claim is dead (see the locked rule: revenue share is the only model, `entitlements.js feePctFor()` returns 0). Platform revenue is the share Vergr retains at accrual time in `coinLedger.js`, i.e. `1 - shareForEarnings(...)`, credited once when a creator accrues. (The "withdrawal 2% spread" that used to be listed here died with the withdrawal flow; `PLATFORM_SPREAD_BPS` is vestigial.) (integer micro-USDC, atomic). Three-bucket ledger: `user_balances` + `platform_revenue` + `insurance_reserve`. Daily reconciliation invariant: `circle_operating == user_balances + platform_revenue`; drift >€5 → freeze + page.

**Threats not fully defendable (honest):** founder personal compromise, GCP root breach (bounded by ≤10% hot + caps), Circle issuer failure, regulatory action against unlicensed CASP (mitigated by KYC tiers + geo-block + OFAC + Travel Rule + clear ToS), signer-code bug, cold-key-holder loss. Biggest control = keep hot wallet small + insurance fund.

---

## 🚨 Security hardening — Tier 1 SHIPPED

Deployed: `admin_actions` append-only audit, `admin_security/{uid}` + `admin_totp_enrollment/{uid}` (server-only), `functions/adminSecurity.js` (`requireAdmin`, `requireFreshStepUp` 5-min window, `adminRateLimit`, `auditAdminAction`, `guardedAdmin`, TOTP callables), `functions/adminAlerts.js` (push on every `admin_actions` create + TOTP brute-force monitor), `cleanupExpiredTotpEnrollments` cron. Privileged callables wrapped (audit + rate-limit + optional step-up): bot controls, `sendAnnouncement` (always step-up), Vanguard invite/rank/status/squad-config/treasury-distribution. `requireFreshStepUp` is a no-op until the admin enrolls TOTP (founder not locked out). Frontend `/admin/security` (`AdminSecurityScreen.jsx`): enroll/step-up via QR + recent actions.

**Founder one-time actions:** enroll TOTP at `/admin/security` + print secret to safe; set up Spacemail catch-all `ops-<random>@vergr.app` as operator email for all infra logins; run operator-account migration (Tier 2).

**Tier 2/3 NOT built:** operator-account migration script (move `role:'admin'` off `@vergr`); out-of-band email confirmation for top-tier actions (needs email provider); step-up on first Vanguard load from new device; auto-revoke refresh tokens on suspicious activity; dedicated admin browser profile; quarterly access audit; `/security` page; backup-hardware-keys runbook. Decision: keep `@vergr` public as platform voice (zero admin authority post-migration); operator identity = catch-all Spacemail + FIDO2/TOTP, no SMS fallback anywhere.

---

## 🛡️ Moderation — 5 layers (operational reference)

1. **AI write-time (Gemini, `functions/contentAi.js`)** — chat (`moderateChatMessage` callable pre-write), post text/image/video-thumbnail (`moderateNewPost` trigger). 4 separate keys. Verdicts: pass / flag (visible + queued) / block (hidden + notify). Scans CSAM (≥0.30 auto-block), nudity (≥0.85), doxxing, scam/RMT links. Ignores: swearing/banter, criticism, game gore, suggestive-but-not-explicit, non-soliciting crypto talk. Audit `content_moderation_log/`. ~€10-15/mo.
2. **AI tournament (Tesseract on Hetzner `vergr-ocr` + Google Vision OCR)** — mod hits Analyze in Moderation Room → 2-signal consensus stamps suggested winner (high/med/low confidence). AI suggests, **mod always confirms** (`vanguardCallTournamentWinner`). OBS overlay is display-only (no winner buttons; player-overlay endpoint retired). Format-aware slot labels (squad/team/player). ~€0-1/mo.
3. **Vanguard mod queue** — humans review AI flags + user reports + appeals. Authority by rank (below).
4. **Escalations** — Senior → Commander → Overseer. `/vanguard/escalations`.
5. **Founder oversight** (`role:'admin'`) — full mod authority via `loadActor()` (synthetic Overseer), bypasses all gates, logged with `rank:'founder'`, does NOT earn treasury share or VP.

Audit trails: L1 → `content_moderation_log/`; L2 → `tournament_assignments.aiVerdict` + `vanguard_actions/`; L3/4/5 → `vanguard_actions/`. Browse at `/admin/vanguard` Audit Log tab. Phase-2 still TODO: cheating-detection on overturned tournament VODs (multimodal via `GEMINI_POST_VIDEO_KEY`).

---

## Vanguard moderator program (SHIPPED, foundation live)

Anonymous moderator collective — public persona = "Vanguard" + rank badge; real identity masked from general users, visible to other Vanguard + founder. Founder-invite only. Email-bound (quitting = quitting the account). Source of truth: `src/utils/vanguardRanks.js` (ES) + `functions/vanguardRanks.js` (CJS mirror — keep in sync).

**Rank ladder (LOCKED):**
| Rank | Order | Authority | Per-action VP | Treasury weight | VP threshold |
|---|---|---|---|---|---|
| Recruit | 1 | read-only/shadow | +10 | 0× | 0 |
| Vanguard | 2 | approve/reject, manual winners, mute ≤24h | +50 | 1.0× | 25,000 |
| Senior | 3 | temp-ban 1–30d, resolve disputes | +100 | 2.0× | 250,000 |
| Commander | 4 | permaban, promote Recruit→Vanguard | +200 | 4.0× | 1,000,000 (founder approval) |
| Overseer | 5 | full control, see real IDs, unlimited squads | +500 | 8.0× | 5,000,000 (founder approval) |

**Perks:** ⚠ both headline perks are against DELETED features and neither can pay out today. The 5% tournament mod cut needs tournaments (retired, 70 callables deleted 2026-08-17) and the "coin→gem conversion fee waived to 0%" needs gems and conversion (both deleted 2026-08-16). The treasury cron and its `rank_weight × monthly_actions` split are still deployed and still correct, they just have no inflow. **Vanguard compensation needs a founder decision.** MRR-gated stipend ladder dormant until MRR ≥€10k. Referral VP milestones in `vanguardRanks.js`.

**Treasury cron** `distributeVanguardTreasury` (`5 0 1 * *` UTC) — settles previous month via `distributeMonth(db, monthKey)`: idempotent (`vanguard_payouts/{YYYY-MM}`), largest-remainder rounding, refunds to platform if no eligible recipients. Founder manual trigger on `/admin/vanguard`. **TODO:** extend cron to consume `assignmentWeightBonus[month]` (from tournament check-ins) in the share formula.

**Identity mask:** `src/utils/vanguard.js → applyVanguardMask(user, viewer)` (only decider) + `useMaskedUser` hook + `<VanguardBadge rank=.. />`. Masked surfaces: PublicProfile, PostCard, SquadChat, PostDetail comments, FollowList, BrowsePlayers (filtered out), SearchResults, SquadInfoRail, DM header, MatchDetails roster. **NOT yet masked (TODO):** notifications drawer sender text (server-side write-time fix), live-stream chat sender (write-time mask when real stream chat ships).

**Callables (`functions/vanguard.js`):** `inviteToVanguard`, `accept/declineVanguardInvitation`, `changeVanguardRank`, `setVanguardStatus`, `setVanguardSquadConfig`, `vanguardCallTournamentWinner`, `vanguardResolveReport`, `vanguardMute/TempBan/PermaBanUser`, generic `runVanguardAction` helper. Claim-based tournament assignments: `functions/vanguardAssignments.js` (`vanguardClaimTournament`, `vanguardCheckIn`, `detectTournamentNoShows`, `notifyUpcomingAssignments`) + `tournament_assignments/{id}`. Screens: `/vanguard/{me,schedule,queue,today,...}`. `<VanguardPresence parentPath=.. />` for stream/tournament presence banners (Overseers join silently).

**Still TODO:** notifications-drawer + live-chat write-time mask; streaming-chat sender mask (depends on live chat shipping).

---

## Admin dashboard (rebuild — `/admin/*`, AdminShell)

Replaces old card-grid. Permission model: founder (`role:'admin'`) = full; sub-admins = `admin_users/{uid}.allowedScreens[]` (founder-managed via `/admin/access`; invites in `admin_invites/`). Foundation: `functions/adminAccess.js` (`requireAdminScreen(uid, screen)`), `useAdminAccess` hook, `AdminShell.jsx` (`ADMIN_NAV`, `ADMIN_COLORS`), `_adminGuarded.jsx` (`useGuardedCall` auto-prompts TOTP on STEP_UP_REQUIRED, `KpiCard`, `Tabs`, formatters).

**Shipped screens:** Dashboard, Users, Creators, Economy, Moderation queue + audit sub-screen (`/admin/reports`, `/admin/reports/audit`, appeals via `submitAppeal`), App Config (`/admin/config`, 9 tabs, field whitelist + history + sensitive-field step-up), Audit Log (`/admin/audit`, CSV export), Subscriptions (pass 1+2: overview/list/billing/plans/comp/settings/logs, `plans/` + `subscription_overrides/`), Announcements, Stream Preview, Live Stats (`/admin/stats`: overview/system/geography wired; Pion `/healthz` + Hetzner API + `presence_snapshots/` + Firebase doc-counts + `vergr-sysinfo` agent all real). Secondary nav: Admin Security, Admin Access, News Bots, Vanguard.

**Remaining punchlists:** Subscriptions pass-3 (discount consumption at renewal, logs CSV); Live Stats pass-2 (Transactions/Errors tabs, world map); Moderation pass-3 (reports-by-type donut needs reason enum, CSV, per-mod timeline, surface handbook on `/vanguard/me`, user-side appeal UI).

### Admin: Tournaments + Cheat Signatures REMOVED, Users + Economy corrected (2026-08-17, founder-instructed, SHIPPED + DEPLOYED)

**Nav:** `/admin/tournaments` and `/admin/cheat-signatures` are unmounted and their
sidebar entries are gone. Screen files stay on disk per the no-deletion rule but
nothing imports them, so they are out of the admin chunk (435 KB -> 392 KB).
`'tournaments'` is out of `ADMIN_SCREENS` in `functions/adminAccess.js`;
`'creators'` was ADDED, because it was in the sidebar and never in that list, so
`normalizeScreens()` silently dropped it and a sub-admin could never be granted
the Creators screen.

**70 Cloud Functions deleted** (verified by diffing `firebase functions:list`
against the source exports, then re-listing: 404 -> 335). All 18 `adminTournaments`
callables, the 3 cheat-signature ones, the whole player-facing tournament
backend, the GSI hooks, the wrapper match-poller, and `aggregateTournamentStats`.
**10 tournament jobs removed from the cron dispatchers**, six of them from
`cronMinute`, which had been sweeping for tournament work every 60 seconds
forever. 15 now-dead `require()`s dropped, so those modules stop loading on
every cold start.

⚠ `aggregateStreamHype` could NOT be deleted: it is a scheduled function whose
Cloud Scheduler job is already missing, and `functions:delete` 404s on the job
before it removes the function. It has no scheduler job so it never fires.
Needs `gcloud functions delete` (gcloud is not installed on this machine).

**KEPT deliberately, and this is a decision left open for the founder:** the
Vanguard tournament-moderation callables, because `/vanguard/schedule`,
`/vanguard/wall`, `/vanguard/queue` and `/vanguard/moderation-room` are all still
ROUTED and call them (`vanguardClaimTournament`, `vanguardCheckIn`,
`vanguardCompleteAssignment`, `vanguardClaimMatch`, `vanguardReleaseMatchClaim`,
`commanderResolveMatchReview`, `modVerifyMatchPlayer`, `vanguardHeartbeat`,
`analyzeTournamentMatch`, `vanguardCallTournamentWinner`, `onTournamentCreated`,
`detectTournamentNoShows`, `notifyUpcomingAssignments`). They will have nothing
to operate on. Retiring those Vanguard screens is a separate call. Steam
(`linkSteamAccount` / `unlinkSteamAccount` / `getSteamGsiConfig`) is also kept:
the live Linked Accounts screen uses it.

⚠ **The `tournaments` COLLECTION is where ticketed EVENTS live** and is still
read by `adminGetEventLoad` + the doc-count tiles. Do not sweep it up. The admin
labels now say "Events".

**Users screen, four real bugs fixed:**

| Bug | Detail |
|---|---|
| Active was never activity | `lastActiveAt` is written ONCE at account creation (`index.js` signup) and never again. The Active tab, the Active KPI and the Last Active column all read it, so "Active (7d)" meant "signed up in the last 7 days" and every older account showed Inactive with a Last Active equal to its signup date. The real field is `lastSeen` (AuthContext on sign-in + UsePresence). `ACTIVITY_FIELD` in `adminUsers.js` is now the single decider. |
| Load more re-served page one | `loadMore` did `setCursor(next)` then immediately called `loadPage()`, which had already closed over the OLD cursor. Cursor is now an argument, never state, plus a uid de-dupe and a request-id guard. Same bug existed in the Economy Transactions tab; fixed there too. |
| nextCursor was unconditional | The server returned a cursor even on a short final page, and computed it from the pre-filter array, so Load more never went away. It now over-fetches in a loop until the page is full and only returns a cursor when a spare row proves more exist. |
| Username search was exact-match | `where('username','<=', term + '')`, an EMPTY upper bound, so the "prefix" query matched only exact handles, and it ran against `username` (original case) not `usernameLower`. Now `usernameLower` with the `\uf8ff` sentinel. |

**Guests are no longer counted as users.** A guest is an anonymous Firebase auth
session from "continue without an account", not a signup. They now have their own
**Guests tab** and their own KPI, and are subtracted from Total on both the Users
screen and the Dashboard (which was also counting bots, and comparing its
`lastSeen` filter against a raw millis NUMBER instead of a Date, so "Active (7d)"
on the dashboard was always 0).

**Why some guests read `Guest` and others `playerxxxx`** (the founder's question,
answered from the generator, not guessed): `signInAsGuest` writes
`displayName:'Guest'` + `username: guest_<uid6>`. When a doc arrives with NO
username, `maintainUsernameIndex` assigns one, `guest_<uid6>` if `isGuest` is
set, otherwise `baseHandle()` derives from displayName then email, and with
neither it falls back to `'player'`, which is in `RESERVED`, so the loop produces
`player` + 4 random chars. So `playerxxxx` = an anonymous session that never got
the `isGuest` flag. Those are invisible to `purgeStaleGuests` (it only queries
`isGuest == true`) and sit in the user table indefinitely.

⚠ **The fix for that is a BUTTON, not a cron.** I first added a daily
`reclassifyAnonymousSessions()` sweep to `cronDaily` and the founder rejected it
on cost: *"Did I ask you to add user cleanup things to the cron which will cost me
money? a free and simple solution would be to add a delete account button for
guest account next to ban etc"*. That function is reverted and `guestCleanup.js`
is byte-identical to before. **Do not reintroduce a scheduled scan for this.**

Shipped instead: **`adminDeleteGuestAccount`** + a "Delete guest account" row in
the user drawer beside Temp ban / Permaban. Costs nothing until clicked. It is
scoped to guests and refuses anything else, and guest-ness is proved against the
**Firebase Auth record** (anonymous = an Auth user with no email and no
providers), never the doc flag alone, because a missing `isGuest` is the whole
reason those `playerxxxx` docs exist. Also refuses `convertedFromGuestAt` (a real
account that merely started as a guest, same uid) and anything with an email. An
ORPHAN doc with no Auth record at all IS deletable, which is the other thing the
button is for. It calls `guestCleanup._purgeGuest` so the manual and daily paths
delete identically: Auth first, then a recursive doc delete. TOTP step-up +
audited as `admin_delete_guest`.

The user drawer also shows the sign-in method read off the Auth record, which is
the only authoritative way to tell a guest from an abandoned real signup.

**Economy screen:** the "Withdrawals" tab is now **Creator payouts** and shows the
real pipeline (`payout_runs`, `payout_statements`, `payout_accounts`, a dry-run
button on `previewCreatorPayoutRun`, and a loud banner while
`PAYOUT_PARTNER_CONFIGURED` is false). The legacy `payout_requests` table is
collapsed at the bottom, labelled as the deleted flow, with Cancel still working
so a row stuck non-terminal can return its held amount. New
`adminGetPayoutOverview` + `adminListPayoutStatements`; the partner flag is read
out of `creatorPayouts._internal` so the screen can never claim a partner is
wired when the code refuses to send.

⚠ **`adminGrantGems` renamed to `adminGrantOwed` and its cap was BROKEN.** The cap
came across untranslated when gems were deleted: `100_000` meant 100,000 gems
($1,000) before and 100,000 micro-USD (**$0.10**) after, so every real correction
was rejected as too large. Now `MAX_OWED_GRANT_MICRO_USD` = $1,000, and the Grant
form takes DOLLARS and converts, because nobody is going to type 25000000 to mean
$25. `adminGrantGems` is deleted and undeployed.

Also fixed: `adminStats.js` counted guests as `accountType == 'guest'`, which
nothing has ever written, so that tile always read 0. Dead transaction-type
filters (conversion, withdrawal_*) replaced with the types the server actually
writes. `tournamentsEnabled` removed from App Config (a toggle reading ON for a
retired feature is worse than no toggle).

⚠ Found while diffing: `dispatchStreamVodArchive`, `markVodArchived` and
`onTournamentCreated` are exported in source but not deployed. **This is
expected, not a bug:** `vergr-vod-archive` lived on BOX 2, which was deleted on
2026-08-17 to save ~€35/mo (see the Box 2 section above). A webhook with no box
behind it has nothing to receive. The tournaments-section line claiming both are
"live in europe-west1" is dated 2026-05-25 and is superseded by the box 2
deletion. **Read the Box 2 section before concluding anything about archive,
transcode, clip-cutting or translate being missing.**

9 Firestore composite indexes added and deployed for the new tab/filter
combinations (`users` isGuest/banned/role/subscription x createdAt/lastSeen,
`payout_statements` runId/status x createdAt).

### PLANNED — Cloudflare cost-visibility (`/admin/stats` r2/cdn tiles)
Build `fetchCloudflareStats()` in `adminStats.js` using Cloudflare **GraphQL Analytics API** (`api.cloudflare.com/client/v4/graphql`): `r2StorageAdaptiveGroups` + `r2OperationsAdaptiveGroups` (split actionType into Class A writes / Class B reads) + zone `httpRequests1dGroups` for CDN egress/cache-hit. Secrets (read-only): `CLOUDFLARE_API_TOKEN` (Account Analytics:Read + Zone Analytics:Read), `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`. Free-tier alerts: R2 storage >80% of 10GB, Class A >80% of 10M/mo, Class B >80% of 1M/mo, cache-hit <60%. CDN egress is unlimited-free (monitor only). ~3-4h. (Full draft adapter in `CLAUDE.md.bak`.)

### PLANNED — Firebase/GCP cost-visibility (replaces doc-counts with billing metrics)
Build `fetchFirebaseUsage()` via Cloud Monitoring API (`@google-cloud/monitoring`, service account already has access or grant `roles/monitoring.viewer`). Pull MTD: Firestore read/write/delete counts + egress + storage, Functions invocations + GB-sec + egress, Hosting bandwidth, Storage bucket size. Add a cost estimator (per-SKU prices × usage) + `reconcileFirebaseCosts` daily cron → `cost_snapshots/{YYYY-MM-DD}` with alerts (>€5 MTD, >50% of any free tier, >2× yesterday). UI: "Estimated this month" card + Firestore/Functions/Hosting/Storage tiles + collection-sizes moved to a secondary section. Optional later: BigQuery billing export adapter for exact figures. ~5-6h. (Full draft in `CLAUDE.md.bak`.)

### Admin operational-metrics (P1, not built)
New `/admin/metrics` (`AdminMetricsScreen.jsx`) + `functions/adminMetrics.js` (Hetzner CPU/mem/bw + 20TB cap, R2 storage/ops, Circle balance, active streams, treasury, Functions error rate, Pion rooms/peers) cached 30-60s. `functions/upgradeAlerts.js` cron (15 min) reads `app_config/general.upgradeThresholds` → writes `admin_alerts/` + push (Hetzner CPU >70%/15min, bw >80% of 20TB, R2 Class B >900k/mo, Pion rooms >40, Functions error >2%/1h). `admin_upgrade_alert` notification type (gold, high-priority).

---

## Live streaming — current architecture (Hetzner + R2 + Cloudflare CDN)

Self-hosted nginx-rtmp on **Hetzner CX23 `vergr-stream-1`** (NBG1, `91.98.79.244`, Ubuntu 24.04, €4.59+€0.92/mo). Streamer → RTMP (OBS, Lite/Pro) or browser fMP4 (free) → nginx-rtmp HLS → `r2-sync.service` pushes to R2 → `cdn.vergr.app` ($0 egress; per-viewer cost $0 since VPS uploads each segment once). DNS: `rtmp.vergr.app` + `sfu.vergr.app` DNS-only (grey cloud — Cloudflare can't proxy RTMP/WebRTC UDP). Cost guard = `liveStreamingPaused` kill switch (the old daily-egress kill switch was removed — read a field nothing wrote).

**Per-tier ingest caps enforced LIVE** by `vergr-rtmp-auth` (Go, `127.0.0.1:8093`, Firebase Admin reads `streams` in `vgrdb`): `on_publish` validates streamKey + plan + status; 5s watchdog parses `/rtmp-stat`, drops streams >hard-cap for 15s (Free 4 / Lite 6 / Pro 9 Mbps). Cohost loopback streams skipped (not in auth flow).

**Infra services on the box (all `infra/*/deploy.sh`):**
- `vergr-sfu` (`infra/sfu/`) — Pion SFU, `wss://sfu.vergr.app/ws` + `/healthz`. Squad rooms (voice-all + ≤2 video, cap 100 = squad member cap) + `ingest_<streamId>` cohost rooms. Firebase-Admin token auth. Localhost bridge `127.0.0.1:8090` (no auth, ingest_* only).
- `vergr-ingest` (`infra/ingest/`) — browser fMP4 chunked ingest, `https://sfu.vergr.app/ingest/{init,seg/<n>,end}`, Bearer streamKey auth, writes `.m4s`. `createStreamSession({ mode:'browser' })` returns this base + sets `ingestType`.
- `vergr-cohost` (`infra/cohost/`) — `vergr-cohost@<streamId>.service`, subscribes to 2 SFU publishers, ffmpeg `xstack` composite → RTMP loopback. Auto-trigger on 2nd publisher still TODO (currently manual `systemctl start`).
- `vergr-sysinfo` (`infra/vergr-sysinfo/`) — `/proc` mem/disk/load/uptime, `127.0.0.1:8094`, header token, proxied at `sfu.vergr.app/sysinfo`.

**SFU scale-up (single box now):** safe ceiling ~50 rooms / ~1,500 peers on CX23. Provision box #2 when any: rooms >40 / peers >1,000 (sustained 1h) / CPU >70% (15min) / SDP p95 >800ms / mem >2.5GB. Steps: 2nd CX23 in `vergr-streaming-pg`, apt-install + clone deploy, add round-robin A record on `sfu.vergr.app`. Federation only if cross-box rooms needed. Manual check: `curl -s https://sfu.vergr.app/healthz | jq`.

**Backend `functions/streaming.js`** — DEPLOYED: `createStreamSession`, `endStreamSession`, `getLikelyTipperScore`, `getLiveDiscoveryFeed`, `recordStreamTip`, `setLiveStreamingPaused`. Enforces follower gate + boost charge + daily caps + plan rendition + viewer caps + kill switches. Pay-per-minute boost: `functions/streamingBoost.js` (`requestStreamQualityBoost`, `cancelStreamQualityBoost`, `chargeStreamBoosts` cron). Squad hangout UI `SquadStreamScreen.jsx` (`/squads/:id/stream`). Discord-style voice-only = reuse with cam hidden (TODO).

**Oracle Cloud (dormant):** account live, retry script `C:\Users\damie\oci-retry\retry.js` (4 OCPU/24GB ARM, Frankfurt) — capacity sold out, still failing. If it opens: mirror box, promote to primary with an 80%-of-free-tier auto-switch back to Hetzner (10TB egress cap). Don't burn $300 trial credits on a paid x86 shape. Holds at €0 — keep.

**Streaming TODOs:** ~~clip button is fake~~ ✅ DONE 2026-05-26 — in-stream clipping is now functional + user-authored. New `src/hooks/useStreamClipBuffer.js` runs a continuous `MediaRecorder` on the HLS `<video>` via `captureStream()` with a 1s timeslice, keeping the header chunk + a pruned rolling window (95s cap) so memory stays bounded; `grab(n)` assembles the last N seconds into one WebM Blob. ViewerStreamScreen has a "Clip" ActionPill (tier-gated Free 30s/3, Lite 60s/5, Pro 90s/∞ per session) → `uploadToR2(file,'clip')` → `createPost(uid,{type:'clip',...})`, so the clip is a USER-CHOSEN post on their own profile. captureStream+MediaRecorder is a Chromium-class feature (hls.js/MSE path; Windows-Tauri WebView2 + Android WebView qualify). **Apple webviews (macOS/iOS = WebKit, incl. desktop Safari) taint the cross-origin video → client path `isSupported()` returns false; ViewerStreamScreen then transparently falls back to a SERVER-SIDE cut** so clipping works on every device: new `requestStreamClip` callable (`functions/streamClips.js`, deployed europe-west1) tier-gates + quota-counts (`stream_clip_quota/{streamId}_{uid}`) then POSTs the Hetzner vod-archive box's new synchronous `POST /clip` endpoint (`infra/vod-archive/launcher.js`, deployed on `archive.vergr.app`/:8097), which parses the live HLS manifest, downloads the tail segments (+ EXT-X-MAP init for fMP4), binary-concats, `ffmpeg -ss <total-want> -t <want>` → mp4 → R2 `clips/`, returns the URL; the client then `createPost(type:'clip')`. Box endpoint verified live (healthz, 401 no-auth, clean error on bad manifest). ⚠️ Both the Chromium MediaRecorder path and the server ffmpeg-cut against a REAL live manifest still need an end-to-end test on an actual broadcast (no live stream available to test from here). Still TODO: R2 segment cleanup cron (below); cohost auto-trigger; broadcaster-side clip button; boost-effectiveness metrics.

⚠ **"canvas compositor in `BroadcasterScreen`" WAS ON THIS LIST AND IS BUILT.** Corrected
2026-09-06 by reading the file, not grepping. `src/utils/streamCompositor.js` is a
multi-layer rAF compositor with five layouts (`camera`, `screen`, `screen_cam_pip`,
`cam_screen_pip`, `side_by_side`), scene cards, AR effects and per-plan sizing;
`BroadcasterScreen.jsx` composites on desktop always and on mobile behind an opt-in Studio
toggle. **It already renders `'landscape'` (16:9) AND `'portrait'` (9:16)** via
`canvasSize()`. What it cannot do is both AT ONCE — MediaRecorder binds one MediaStream at
construction, so one canvas is one encode is one upload. That distinction is the whole of
the Dual Format problem; see `docs/LIVE_COMPETITIVE_AND_UI.md` §6.

## ☎ CALL PREVIEW: EVERY CALL SURFACE HAS A SIMULATOR (2026-09-06, SHIPPED + DEPLOYED)

`/admin/call-preview`, the same tool as the stream preview but for calls. Full
record: `docs/UPDATE_LOG.md`, newest entry. Guard:
`scripts/call-preview-check.mjs`, **110 assertions**, in `npm run check`.

**Eleven surfaces, and four are not a call screen:** 1:1 voice, 1:1 video
(`CallScreen.jsx`, one file, branches on `callType`), group call
(`GroupCallScreen.jsx` + `utils/groupCall.js`), squad hangout
(`SquadStreamScreen.jsx`), voice channel (`VoiceChannelScreen.jsx` +
`utils/voiceSession.js`), incoming ring (`IncomingCallOverlay.jsx`), floating
pill, calls hub, in-thread call row, and the two channel modals.

✅ **CALLS HAVE ONE IMPLEMENTATION EACH, UNLIKE THE STREAM SCREENS.**
`NativeCallScreen`, `NativeVoiceChannelScreen` and `NativeSquadStreamScreen` all
`export { default } from` the web file. Do NOT go looking for a native fork the
way `/broadcast` and `/go-live` have one; there isn't one.

⚠ **EVERY PREVIEW SURFACE IS A COPY, AND THAT IS THE OPPOSITE RULE TO THE STREAM
PREVIEW.** That tool imports its prop-only components because importing cannot
drift. NOTHING on a call screen is prop-only: CallScreen owns a peer connection,
GroupCallScreen subscribes to a module singleton, VoiceChannelScreen reads
Firestore and joins the SFU on mount. Importing one would open a real socket and
ask for the camera from inside an admin page. Each copy records
`Copied layout source: <file>:<line>`; the guard fails the build without it.

⚠ **THE CAST AND THE UPLOAD STORE ARE SHARED WITH THE STREAM PREVIEW.**
`callCast.js` imports `CAST` from `streamPreview/previewCast` and the sim uses
the same `previewAssets` IndexedDB store, so a face uploaded in either tool is
that person's face in both. Do not add a second store.

🔴 **EIGHT REAL DEFECTS IN THE SHIPPED CALL SCREENS, NONE FIXED.** They render in
the tool's own "What is broken" panel and guard rule 15 asserts the CallScreen
ones are still true, so a fix must delete its line in the same commit. The worst
three: **flip camera has no `onClick` at all** (`CallScreen.jsx:353`, a styled
div, the most used control on a phone video call); the **speaker button flips a
state nothing reads** (:346, no `setSinkId`, so audio stays on the earpiece); and
**every incoming ring claims "Encrypted P2P Call" including a GROUP one**
(`IncomingCallOverlay.jsx:327`), which is false because a group call routes
through our own SFU. Also: no call surface reads `getStats()`, so a call degrades
in silence and then dies.

⚠ **`IncomingCallManager.jsx` IS DEAD CODE.** AppRouter mounts
`IncomingCallOverlay` only. It still holds a divergent copy of the accept and
decline rules, so it is the file a session fixes by mistake.

⚠ **TWO THINGS IN THE PREVIEW DO NOT EXIST IN THE PRODUCT** and the rail says so
in amber: the connection-quality pill and the group call's elapsed clock. Do not
screenshot either as a shipped feature.

⚠⚠ **EVERY FILE IN THIS FEATURE IS UNTRACKED IN GIT, INCLUDING THE GUARD.**
`src/screens/admin/callPreview/*`, `AdminCallPreviewScreen.jsx` and
`scripts/call-preview-check.mjs` are all `??`. Same exposure as the boost work
and as the four `src-tauri/tauri.*.conf.json` files that a `git checkout` once
deleted silently: a `checkout`, `reset` or `clean` takes the lot. It is worse
here, because `npm run check` now RUNS that guard, so losing it breaks
`prebuild` outright. **Committing is a founder call and has not been done.**

## 📺 LIVE STREAM: THE SIMULATOR IS DONE, THE REAL SCREENS ARE NOT (2026-09-02)

**Read `docs/LIVE_STREAM_READINESS.md` before touching anything live-stream.** And
**`docs/LIVE_STREAM_PORT_PLAN.md` before touching a real stream screen** (2026-09-04):
it is the execution doc for moving the preview design onto production, and it
records the fact that decides most of the work, that **`/broadcast` and `/go-live`
each have TWO implementations** (web + native) while the viewer has one. It is the
current state; the 2026-05-22 punchlist immediately below is older than it and describes the
REAL screens, which are still largely as it says.

`/admin/stream-preview` went through a seven-stage rebuild and is now the design surface for
the whole feature. Guard: `scripts/stream-preview-check.mjs`, **851 assertions**, wired into
`npm run check`, so `npm run build` fails if any of it regresses. Session-by-session detail
is in `docs/UPDATE_LOG.md` (newest first).

⚠⚠ **THE PREVIEW IS NOW AHEAD OF THE REAL SCREENS, so the port is no longer a copy in one
direction.** These exist in the simulator and NOT in `MobileLiveViewer` /
`ViewerStreamScreen` / `BroadcasterScreen`: the **zero-viewer state** (the shipped
broadcaster renders the digit `0` and nothing else), **broadcast health warnings** (the real
screen shows a kbps number nobody reads mid-stream), the **empty-chat state**, the four
**replay states** with real actions, **share the replay / up next / schedule next**, the
**appeal path** and the **guidelines link from chat**, **VP earned this stream** for both
sides, **audio-only broadcasts**, the **who-can-watch / who-can-clip** host controls, and
the **mod-only channel**.

### Founder decisions, answered 2026-09-02 (full reasoning in the readiness doc)

| | |
|---|---|
| Giveaways / raffles | ❌ **NO.** Do not build. Matches `llms.txt`. |
| Audio-only streams | ✅ yes — a co-host already joins audio-only, so refusing a solo host was an inconsistency |
| Paid / subscriber-only streams | ✅ yes, at launch |
| Mod-only chat channel | ✅ **BUILT + DEPLOYED** — relay enforces the join (`canJoinModRoom`, box 1) |
| Who may clip | ✅ followers and/or subs, and the per-plan limits are SEPARATE |
| Gift-a-sub | ✅ no gifter gate, no renewal, bulk at qty × price **with no discount** |
| Raid / host | ✅ **BUILT + DEPLOYED** — `functions/raids.js` + `RaidControls.jsx`. Target controls who may raid them; countdown + Stay here; VP capped daily. Host mode dropped. |

✅ **THE MOD CHANNEL IS LIVE END TO END** — relay gate, client, and the switch in the real
`ChatPanel` (which both viewers render). The composer names the room, because the one
failure mode is a mod typing something private into public chat.

✅ **ENFORCED AT THE RELAY** (`canJoinModRoom`, `infra/chat/src/main.go`,
tested by `modroom_test.go`, deployed to box 1 on 2026-09-02). Room is `streamID + ":mods"`.

⚠⚠ **VANGUARD READ IT, SILENTLY, AND EVERY READ IS AUDITED.** A private room the platform
cannot see is a moderation blind spot. They are excluded from `viewerCount` and presence
(`Peer.silent`) so a named platform moderator is not identified by elimination in a
three-person room, and each join writes a `vanguard_actions` row. **Vanguard do NOT get the
broadcaster’s mute/ban tier — `loadStreamForMod` refuses them.**

⚠ **THE MODS ROOM RUNS NO PRESENCE**: `startPresence` would write
`streams/<id>:mods.viewerCount` every 10s to a doc that does not exist.

⚠ **TWO SEPARATE CLIP LIMITS AND CONFLATING THEM BREAKS THE PLANS.** The HOST picks WHO may
clip; HOW MUCH is the CLIPPER's own plan — Free 30s/3, Lite 60s/5, Pro 90s/unlimited
(`functions/streamClips.js:24`). A Pro subscriber on a followers-only stream still gets 90s.

⚠ **`Icon` IS NOW `aria-hidden` AND THAT IS APP-WIDE** (~97 files). A screen reader was
announcing every icon button by its ligature ("close", "cameraswitch", "micMic").
**Consequence:** an icon-only button anywhere that relied on that accidental name now has
none until it gets an `aria-label`. The stream surfaces were all labelled; sweep the rest as
you touch it.

⚠ **DESIGN RULES THE FOUNDER RESTATED, having said them before:** no semi-transparent pill
backgrounds (use a solid value from `S` in `previewStates.jsx`), no hairline ring on a solid
fill, and **a pill is not a switch** — a switch is a track with a sliding knob. Guard rule
43 enforces it, with deliberate exemptions for sheet scrims, the shipped `glass` dock
treatment, the `border` token and the drawn `SceneFallback` art.

⚠ **TWO STALE RATE COMMENTS CORRECTED** while answering the gift-sub question:
`memberships.js` claimed "10% platform fee, creator keeps 90% (mirrors tips)" — both halves
false (the full price is credited as gross and the share is taken at accrual; tips have no
fee). `coaching.js` charges a real 10%, but **COACHING DOES NOT EXIST ON VERGR** — the file is
dead code from the retired tournaments build: unrouted, imported by nothing, and **not
exported from `functions/index.js`, so none of it is deployed.** I raised it to the founder
as a live pricing decision and it is not one. **Check routed AND exported before calling a
rate a policy.**

---

### Live-stream screens — rebuild punchlist (🔴 P1, audited 2026-05-22)

**New design source:** `C:\Users\damie\Downloads\New UI Screens\Streamng-Live stream Screens\` (PNG mockups): `Go Live Screen.png` + `Go live screen (2).png` (setup), `Streaming screen - broadcaster view - co hosting stream.png` (+ `- full screen mode.png`), `Streaming screen - user viewer view - co hosting stream.png` (+ `- full screen mode.png`). The new design centres on **co-hosting** (broadcaster + viewer, each normal + fullscreen). Earlier Go-Live HTML pass came from `Vergr Wallet (6).zip` (misnamed — contains Settings + Go Live; extract → `_wallet6_tmp/Go Live Screens.html`, screens 02–05 = broadcaster/viewer/broadcaster-fullscreen/viewer-fullscreen). `GoLiveSetupScreen` already got the design pass; broadcaster/viewer views did NOT.

**These front-end screens are OLD (Gcore-era, pre-Hetzner-migration, pre-composer-redesign). Not yet rebuilt.** They still import `GCORE_CONFIG`/`getPlaybackUrl` from `src/utils/streamConfig.js` (DEAD — points at `api.gcore.com`). The media *pipeline* (Hetzner nginx-rtmp + `vergr-ingest` + R2 + `cdn.vergr.app`, and `createStreamSession`/`endStreamSession`) is the live truth; the screens must be repointed to it.

**Screen inventory + required state:**
| Screen | Route | File | State | Needs |
|---|---|---|---|---|
| **Setup** | `/go-live` | `GoLiveSetupScreen` | ❌ dead end | `goLive()` only `navigate('/')` + toast. Must call `createStreamSession`, persist title/tags/visibility on the `streams` doc, then route to `/broadcast/:streamId` (solo) or `/go-live/co-stream` → co-host. |
| **Co-host setup** | `/go-live/co-stream` | `CoStreamingScreen` | ✅ **BUILT, this row was STALE** | ⚠ CORRECTED 2026-09-04. It is **429 lines**, not 74, and it is functional: `createStreamSession({ kind: co_stream })` at :82, `inviteToCoStream` at :142, `cancelCoHostInvite` at :157, `removeCoHost` at :170, then routes to `/broadcast/{id}?cohost=1` at :181. The "stub that bounces to /go-live" description was wrong and would have sent a session rebuilding something that already works. |
| **Solo broadcast** | `/broadcast/:streamId` | `BroadcasterScreen` | ⚠️ pipeline real, UI faked | REAL: `getUserMedia`, mic/cam toggles, `createStreamSession`, chunked ingest upload, `endStreamSession`, Gemini frame sampler. FAKE: viewer count (`getDummyViewerCount`), bitrate/dropped/mic/desktop meters (`Math.random`), activity feed (random follows/tips/subs/raids from hardcoded names), earnings counter, poll votes, chat (local + `PREVIEW_CHAT_MESSAGES`, no relay). Drop `GCORE_CONFIG.enabled` preview gate. |
| **Co-host broadcast** | — | **does not exist** | 🔴 missing | No UI joins the Pion SFU `ingest_<streamId>` room as a 2nd publisher. Infra exists (`vergr-cohost` ffmpeg `xstack` composite + SFU ingest rooms) but no front-end. Build it (publisher tiles, host controls, leave). |
| **Viewer** | `/watch/:streamId` | `ViewerStreamScreen` | ⚠️ player real, rest faked | REAL: `HlsPlayer` + p2p-media-loader. FAKE: `isPreview = !GCORE_CONFIG.enabled` keeps it in mock mode; `getPlaybackUrl` returns a Gcore URL not `cdn.vergr.app/streams/<key>/index.m3u8`; chat simulated; viewer count/list dummy; metadata hardcoded ("NovaKill"/"Valorant"). Repoint playback to CDN, subscribe to the real `streams/{id}` doc, add real chat + presence. |
| **Old viewer mockup** | `/stream/:streamId` | `LiveStreamScreen` | ❌ static mockup | Fully hardcoded (no player, "2.4K", "Streamer / Elden Ring", local chat, ignores `streamId`). Retire the route or redirect to `/watch/:streamId` (don't delete without confirming nothing links to it). |
| Misc | — | `StreamEndingScreen`, `StreamAnalyticsScreen`, `StreamModerationScreen`, `SquadStreamScreen` | — | Review separately; not part of this audit. |

**Chat architecture (LOCKED decision — do NOT use Firestore):** live-stream chat must ride the **streaming server**, not Firestore. Build a WebSocket relay co-located with the stream box (extend `vergr-sfu` or add a `vergr-chat` service on Hetzner): broadcaster + viewers connect over WS, messages fan out in real time, **Gemini moderation runs at the relay (server-side) before fan-out**, identity-mask applied at write-time (covers the Vanguard live-chat mask TODO). Firestore is wrong here (per-message read/write cost + latency). Persist only what's needed (e.g., pinned/mod actions), not the firehose.

**streamConfig.js must be repointed:** retire `GCORE_CONFIG`; `getPlaybackUrl(streamId)` → `https://cdn.vergr.app/streams/<streamKey>/index.m3u8`; ingest base comes from `createStreamSession` (browser fMP4 via `vergr-ingest`, or RTMP key for OBS).

### R2 segment cleanup cron — ✅ BUILT + DEPLOYED (this section said "TODO" for months and was WRONG)

Verified against source 2026-09-06. It lives in **`functions/streamingCleanup.js:108`** (NOT `functions/streaming.js`, as this section used to claim) and is exported at `functions/index.js:472`. Runs `every 60 minutes`. Retention, read off the constants:

| Content | Deleted after |
|---|---|
| Ended streams | **24h** (`ENDED_TTL_MS`) |
| Orphans (no stream doc) | **6h** (`ORPHAN_TTL_MS`) |
| Two-camera proof chunks | **30d** (`PROOF_TTL_MS`, `cleanupExpiredProofChunks`) |
| ~~Tournament-linked~~ | `TOURNAMENT_TTL_MS` (7d) is **INERT DEAD CODE** — tournaments are retired, so `tournamentLinkedKeys` is always empty and every stream falls to the 24h branch. Harmless, but do not cite it as a live policy. |

⚠ This is why live streaming does not threaten the 10 GB free tier: a 1h stream at 3 Mbps is ~1.35 GB of segments, and they are gone within 24h of the stream ending.

---

## Media storage on Cloudflare R2 (LIVE)

All user media → R2, served `https://cdn.vergr.app` ($0 egress). KYC docs stay on Firebase Storage (need Auth scoping). `functions/r2.js → getR2UploadUrl` (presigned PUT, plan size caps, content-type allowlist) + `src/utils/r2Storage.js → uploadToR2(file, kind)`. `uploadPostMedia(postId, file)` ignores postId, just returns the R2 URL. Video format = **WebM/VP9** (~50% smaller than MP4 — don't switch). Plan caps: Free 200MB / Lite 1GB / Pro 5GB. Clip duration: Free 5min / Lite 15min / Pro 60min. ⚠⚠ **NO COLD TIERING. THE `cold-storage` LIFECYCLE RULE IS DISABLED (2026-09-06) AND MUST STAY THAT WAY.** The line that used to sit here called it a saving. It was the opposite, and it caused the FIRST Cloudflare bill this project ever received: **$9.92 for 38 objects totalling 32 MB.** Facts, all measured: Infrequent Access has **NO free tier** (Standard's 10 GB / 1M / 10M does not apply to it), and each IA line item rounds UP to a whole billing unit, so **38 transitions were billed as a full million at $9.00**. Cost scales with **OBJECT COUNT, not bytes** — an 11 KB avatar costs the same transition as a 5 GB video. Break-even vs Standard is **~1.8 TB**; the bucket is 0.74 GB. A lifecycle rule filters on **PREFIX ONLY**, so it can never express "Pro users only" while keys are `post/<uid>/...`. `coldStorageDemotion` (`functions/r2.js`) is deployed, dormant at `totalPosts=0 < 5000`, and has **NO tier filter**, so arming it repeats this exactly. Kill switch `freeUploadsPaused`. `<ImageProtection />` in AppRouter blocks right-click/drag on all `<img>`.

### 💬 DM/CHAT MEDIA: OWN PREFIX + EXPIRY MECHANISM (2026-09-06, SHIPPED + DEPLOYED, SWEEP OFF)

**The on-device half was always real** (`src/utils/fileMediaCache.js`, native
`window.VergrCache` bridge, Android; `deviceMediaCache.js` Dexie fallback on
desktop). What never worked was the *server copy being transient*.

⚠⚠ **THE CAUSE WAS A NO-OP TERNARY.** `uploadMediaFile()` in `mediaHelpers.js`
read `const kind = folder.startsWith('post') ? 'post' : 'post'` — both branches
'post' — so the `folder` argument did nothing and **every DM photo, video, voice
note and comment attachment went to `post/<uid>/...`, mixed in with real feed
media.** `uploadBlob()` hardcoded `'post'` too. That is precisely why the expiry
sweep could never be repointed at R2: an age-based delete over `post/` would
have destroyed users' actual posts.

Three other pieces were broken in the same chain:
- `tierConfig.mediaRetentionDays` **did not exist in `tierSystem.js`**, so every
  caller passed `undefined`.
- `uploadMediaFile`'s `ttlDays` param was accepted and never used.
- `_cleanupExpiredMedia` (nightly, in `cronDaily`) swept
  `admin.storage().bucket()` = **FIREBASE STORAGE**, folders `chat_media/`,
  `voice_notes/` etc. Nothing has written there since the R2 migration on
  2026-05-06, so it scanned an empty backend every night for four months.

**Now:** `chat` + `comment` are in `ALLOWED_KINDS`; `kindForFolder()` maps folder
to prefix; `deleteExpiredR2ChatMedia()` sweeps R2 and resolves each uploader's
tier from the uid in the key (one Firestore read per uid, cached).

⚠⚠ **THE SWEEP IS OFF AND MUST STAY OFF UNTIL THE FOUNDER SETS RETENTION.** Two
keys in `app_config/general` (both in the adminConfig allowlist, no deploy
needed): `chatMediaExpiryEnabled: true` and `chatMediaRetentionDays:
{free,lite,pro}` in DAYS. A tier absent or null is **kept forever**. There is no
default number on purpose. **Arming it DELETES user media, and the device cache
is ANDROID-ONLY** — desktop/web fall back to evictable Dexie, so an expired DM
photo is gone permanently there.

⚠ **`post/` IS NEVER SWEPT.** Legacy chat media already living there stays
forever: message docs store absolute URLs and nothing can distinguish an old DM
photo from a real post. Do not add `post/` to `R2_CHAT_PREFIXES`.

⚠ **DEPLOY ORDER IS FORCED: FUNCTIONS BEFORE HOSTING.** The client now requests
`kind: 'chat'`; a server without it in `ALLOWED_KINDS` throws and every DM media
send fails. Deployed in that order 2026-09-06.

⚠ `firebase deploy` failed once with *"Cannot determine backend specification.
Timeout after 10000"*. **Not a code fault** — `index.js` loads in 5.5s but the
analyzer's 10s budget is tight on this machine. `FUNCTIONS_DISCOVERY_TIMEOUT=180`
fixes it. Use that before hunting for a load-time bug.

---

⚠ **ADAPTIVE (PER-VIEWER QUALITY) VIDEO IS PAUSED, NOT LOST, AND THE PAUSE IS DELIBERATE.** Verified 2026-09-06. `enqueueVideoTranscode` (`functions/transcodeQueue.js`, exported at `index.js:593`) is still deployed and still writes rows to `transcode_jobs`, but the worker that consumed them (`infra/transcode/worker.js`) ran on **BOX 2, which the founder deliberately deleted 2026-08-17** to save ~€35/mo until there is revenue. `archive.vergr.app` returns **HTTP 503** (measured). So today every viewer gets the single uploaded file at whatever quality `compressMedia` produced; nothing renders a per-connection rendition. The 4 `adaptive/` objects in R2 (`selftest-probe`, `queuetest-1`, 2026-08-12) are test artifacts from before the box went.

✅ **THE RESTORE PATH IS INTACT AND WAS PLANNED FOR:** Hetzner snapshot **420931000** (4.69 GB), plus `infra/box2-restore/` (43 files, 11-step `RESTORE.md`, all 8 executables sha256-verified before deletion) and a second copy with secrets at `~/Downloads/vergr-box2-backup-2026-08-17/`. **Bring box 2 back and adaptive video works again with no code change.** Do NOT describe this as broken or as something that needs rebuilding, and do not "fix" it by rewriting the transcode path.
- ⚠️ **If R2 uploads fail:** `/admin` has "Apply CORS / Diagnose" (`setR2CorsPolicy` callable) printing bucket/endpoint/CORS/presigned-URL state. Past root cause: every R2 secret had a trailing `\n` (set via `echo` not `printf`) → bucket name `vergr-media\n` → CORS never matched. Fix in `r2.js` trims every secret on read (`env()`); **don't remove the trim**. AWS SDK v3 auto-injects `x-amz-sdk-checksum-algorithm` which R2 CORS doesn't match → client uses `requestChecksumCalculation:'WHEN_REQUIRED'`. CORS managed via Cloudflare dashboard (token is Object R/W, can't PutBucketCors). Allowed origins include vergr.app + web.app + firebaseapp.com + localhost. `ALLOWED_KINDS`: avatar/banner/post/short/clip/article/squad/tournament.

---

## Subscriptions + tiers (`src/utils/tierSystem.js`)

- **Free** $0: core social + live streaming, squads, voice messages, **co-streaming and post boosts** (those are free, not paid perks), free squad streaming, public stream after 100 followers + 50-coin boost, 480p30, 200MB uploads, ads between posts.
- **Lite** $4.99/mo: no ads, day-1 public streaming at 720p, 4h/day, 1.5× VP + 1,000 VP and 50 coins monthly, 1GB uploads, scheduled posts and DMs, auto-translate, creator analytics and content calendar, hide Vergr branding on vergr.me.
- **Pro** $9.99/mo: 1080p with no daily limit, 90-day replays, 2× VP + 3,000 VP and 150 coins monthly, 5GB uploads + 4K photos, full vergr.me design kit, lead capture/pixels/webhooks, advanced analytics, animated avatar + Pro badge.
⚠ **This section was stale for months and is now read straight off `TIERS[].features`.** It used to sell tournaments (retired), a vergr.me custom domain (removed 2026-08-20, Cloudflare for SaaS is unavailable on this account), IP-masked private streaming and priority support (never built), and co-streaming as a Pro perk (it is free). It also quoted EUR while the charge is USD. **Re-read `tierSystem.js` before repeating any tier claim; the 2026-08-19 audit section above is the authority on why each bullet exists.**

- Both paid tiers buyable with coins (~500=Lite, ~1000=Pro) or PayRam card popup. Top-5 `features` array entries = headline perks. Subscription field is `profile.subscription.tier`. `getTierConfig(t)`, `checkFileSizeAccess`. Daily renewal cron handles coin-funded renewals. **Scheduled posts are a Lite/Pro feature** (free sees the entry with an upgrade pill + prompt to `/settings/subscription`).

---

## Create-post composer (REBUILT 2026-05-22, design pack `Vergr Posting.zip`)

`src/components/composer/CreateComposer.jsx` + `src/styles/composer.css` (scoped `.cmp`, own palette/fonts mapped to DM Sans/Mono). Rendered as a blurred-backdrop popup with a framer-motion fly-in from the trigger's `originRect`. Opened from HomeFeedScreen (desktop composer row + New Post + mobile FAB, each passes `openCreate(e)` capturing the rect) + DesktopSidebar. Old `CreatePostModal.jsx` kept on disk, no longer used by those entries.
- **Compose view:** identity + visibility picker (public/followers/squad, stored on post), composer + quick chips (insert real prompt prefixes), Add-media dropzone + thumbs (real R2 upload), 5 action cards (Go Live → `/go-live`, Share Clip → video picker, Create Poll → in-place poll mode, Squad Update → `/squads`, Tournament Result → `/tournaments`), tip banner.
- **Toolbar tools (all functional):** Media (file), GIF (MediaPanel), Poll (toggle), Clip (video), Mood/Stats/Tag-players/Location (popovers that insert real content; Tag uses live `searchUsers`).
- **Poll mode:** question, drag-to-reorder options (HTML5 drag), duration menu, multi/anon toggles, templates, live 0-vote-honest preview.
- **Schedule view (Lite/Pro only):** real calendar + time picker (future-only); Optimize column = REAL best-time slots + heatmap from `getAudienceActivity(uid)` (buckets followers' `lastSeen` by day/hour; honest "not enough data" when <5 active); additional options (allow-early / notify-on-post / auto-share-to-squads) persisted as `scheduleOptions`.
- **Backend:** `createPost` accepts `visibility`, `scheduledFor`, `scheduleOptions` (status flips to `scheduled`); `createPoll` respects passed `status`. **`publishScheduledPosts` cron** (`functions/scheduledPosts.js`, every 5 min) flips scheduled posts→published / polls→active when due, honors allowEarly (15min window), sends reminder notification, auto-shares to the author's squad chats.

---

## Tournaments (E2E SHIPPED, coins, friend-test ready)

Secure callables (`functions/tournaments.js`): `createTournamentSecure`, `joinTournamentSecure` (atomic escrow + invite-only enforce), `leaveTournamentSecure`, `startTournamentSecure`, `reportMatchResultSecure` (two-player-agree else `disputed`), `finalizeTournamentSecure`/`finalizeInternal` (auto-finalize from `advanceBracketAfterMatch`; idempotent on `payoutStatus`), `resolveTournamentDispute`, `applyToTournamentSecure` + `approve/declineTournamentApplication`, `aggregateTournamentStats` trigger. Frontend wired to secure callables. Server mirror of limits in `functions/tournamentRules.js` (mirror `tournamentTypes.js` exactly). UI: shared `src/components/tournament/*`, `TournamentListScreen` (variants all/mine/following/past/type), `TournamentApplicationsScreen`.

**Game result detection:** Tier A publisher APIs (CS2/Dota2 via Steam GSI `functions/gsi.js`; OW2/Apex via `functions/wrappers/`; LoL/VALORANT pending Riot prod-key — render "Soon"). Tier B = manual mod (lobby-screenshot verification spec below). Tier C = "Other". OAuth connected accounts via `functions/oauth.js` + `steamAuth.js` (Twitch/YouTube/Discord/Battle.net/Epic/Steam/Xbox). Riot domain verify: `public/riot.txt` holds exactly ONE token (strict equality) — swap + redeploy per app under review.

**TODO — match-pair lobby-screenshot verification:** for Tier B, both players upload lobby screenshots → `functions/lobbyVerification.js` (Firestore trigger) runs Gemini Vision OCR, cross-checks each player's expected in-game handle appears in the other's screenshot → stamp `verification: verified|pending|failed` on the match; failed = auto-DQ + warn. UI in `MatchDetailsScreen` + Moderation Room badge. ToS clause needed (no proof images retained >30d). ~2 Vision calls/match (~€3/1k).

---

## PLANNED specs (not built — don't start without go-ahead)

### Stream goals
`streams/{id}.goal = { active, targetCoins, reason, coverImageUrl, currentCoins, scope:'stream'|'monthly'|'lifetime', completedAt }`. `functions/streamGoals.js`: `setStreamGoal`/`clearStreamGoal` + `sendCoins` increments goal on tip + monthly reset cron. Viewer HUD progress pill; goal-reached → celebration (reuses gift-overlay engine) + chat broadcast; post-stream summary. €0 cost.

### Creator Fan / Super Fan memberships
Two creator-set-price monthly tiers. `creators/{uid}/fanship` + `memberships/{sub}_{creator}`. `functions/fanship.js`: `setupFanship`, `subscribeToCreator`, `cancelMembership`, `pauseFanship`, `chargeFanMemberships` cron (10% platform fee, 7-day grace on fail). Fan entry-card HUD animation on stream join. Creator Studio `/creator/fanship`.

### Gifting + co-host games (DEFERRED until profitable — do NOT start without explicit go-ahead)
Full design + per-gift AI-production prompts + free-tool account list (Meshy/Mixamo/Runway/Kling/Freesound) preserved in `CLAUDE.md.bak`. Summary: shared on-stream HUD + animation engine (PixiJS particles + three.js + Lottie + WebM-alpha, all client-side, €0 per-display). Gift catalog 4 tiers (Sparkle 1-25c / Cheer 50-200c / Big Hit 500-2000c / Ultra 5000c+), recipes in `app_config/general.gifts.catalog`. `sendGift` wraps `sendCoins` (gifts ARE tips — 10% fee, no separate revenue category). Co-host games (Coin Battle / Trivia / Lock-In / Tip Race / Audience Adjudication) via `streams/{id}/games/{id}` + `startCohostGame`.

---

## Known issues (founder-flagged, TODO)

- **Squad stream entry undiscoverable** — entry is the "Hangout"/"Voice Hangout" button (`SquadDetailScreen:178`, `SquadOverviewScreen:143` → `/squads/:id/stream`). Rename to "Start Squad Stream" or add an obvious header CTA.
- **Mobile + desktop apps stale** — Tauri `src-tauri/tauri.conf.json` bundles `dist/` at build time (`frontendDist: "../dist"`), no working auto-update. **This is the root cause of "desktop app looks broken" reports** (2026-05-27: founder saw icons-as-text, blank Explore `streamsToShow is not defined`, CSP-blocks-eval, missing profile follow/message buttons — ALL were already correct in current source; the installed `.exe` predated them. Tell-tale: the running app blocked `eval` while the current `tauri.conf` CSP allows `unsafe-eval`). Fix when a desktop bug is reported: bump `version` + `npx tauri build` + redistribute the installer (`src-tauri/target/release/bundle/{nsis,msi}/`). Proper fix = wire the Tauri Updater (key pair already in conf `plugins.updater`, endpoint `https://vergr.app/downloads/latest.json`, `createUpdaterArtifacts:true` already set — just need the signed `latest.json` published). PWA: bump SW version (`vergr-vN`) + `controllerchange`→reload toast + `clients.claim()`.
- **Icon font now self-hosted (2026-05-27)** — `index.html` `@font-face` for Material Symbols pointed at a gstatic `v240` URL that started 404ing → icons fell back to raw ligature TEXT. Now bundled at `public/fonts/material-symbols-outlined.woff2` (primary `src`, CDN `v341` as fallback), so icons render offline / under CSP / on CDN failure. If icons ever show as text again, re-fetch the current woff2 from the `fonts.googleapis.com/css2?family=Material+Symbols+Outlined...` CSS (needs a browser UA) and replace the bundled file.

## Backlog (don't touch unless asked)
- Scheduled posts backend now EXISTS (`publishScheduledPosts` cron) — the old "not built" note is obsolete.
- Audience demographics in `CreatorAudienceScreen` still placeholders.
- Chat rewrite (Dexie + relay), Thanos-dissolve message delete plan — plan files exist, not executed.
- Edit profile: ✅ DOB (18+ gate). TODO: profile accent colour, pinned posts/clips picker, weekly schedule grid, audio name clip. Skipped (founder): pronouns/location/timezone/country.

---

## Build + deploy
```
npm run build
firebase deploy --only hosting        # → https://vergr-44494.web.app / vergr.app
firebase deploy --only functions:<name>,...   # europe-west1; specify names to avoid full redeploy
firebase deploy --only firestore:rules
```
User checks the LIVE site — "build passes" isn't visible to them; you MUST deploy. SW caches hard → tell them Ctrl+Shift+R. Composite-index prompts print a deep-link in the function log on first filtered query.

## What wastes tokens (don't do)
- Reading docx/pdf/temp files unless pointed at them.
- Re-exploring the codebase when this file documents the path.
- Broad greps when the request names a specific file.
- Asking confirmation for already-specified tasks.
- Trailing "here's what I did" summaries after edits — the diff shows it.


#### Two bugs worth not repeating (2026-08-15)

⚠️ **`String.replace` treats `$$` in the REPLACEMENT as an escaped `$`.** Splicing JSX containing `` `$${value}` `` silently collapsed it to `` `${value}` ``, so every currency symbol on the earnings screen vanished and a KPI shipped reading "10.01" with no unit. **Always pass a function: `s.replace(from, () => to)`.** Applies to every codegen/splice script in this repo.

⚠️ **A positive gems row is NOT income.** `coin_to_gem_conversion` credits gems from coins the creator BOUGHT; so do admin grants and refunds. The old filter was `amount > 0 && currency === "gems"`, which reported $10.01 of "earnings" to an account that had earned nothing. There is now ONE definition, `isEarning()` in CreatorEarningsScreen, excluding `NOT_EARNINGS = /conversion|purchase|grant|reward|refund|revers|topup|payout|commission|_fee|_sent$/i`. Every total on the screen uses it.

**Language: never "platform cut", "commission" or "fee" to a creator.** It is a revenue share and the creator-facing framing is what they KEEP. Founder ruling: that vocabulary reads as a casino. Say "your share", "what you kept", "your revenue share rate".

#### Earnings figures: one basis per number (2026-08-15, after three contradicted each other live)

The screen showed Lifetime earned $0, Available $0.01 and chart Total $0.00 at the same time. Root causes:

1. **`coinsToUsd` floors to whole dollars.** `Math.floor(coins/100)` turns 1 coin ($0.01) into "$0". New `unitsToUsd()` is cents-accurate and is the ONLY formatter allowed for a balance. `coinsToUsd` is now reserved for tier THRESHOLDS, which are round by construction.
2. **Lifetime totals were summed from a CAPPED query.** `getTransactions(uid, 500)` returns at most 500 rows; summing it for a lifetime figure silently under-reports past the cap. **Lifetime money must come from the wallet aggregates, never from the ledger.**

**The data model (functions/coinLedger.js → `earnedGemCredit`).** A creator earns GROSS COINS. One transaction increments all three: `totalEarnedCoinsGross += gross`, `gems += floor(gross * share)`, `totalGemsEarned += that`. Coins and gems are both worth $0.01.

| Figure on screen | Source of truth | Basis |
|---|---|---|
| Lifetime earned, before your share | `wallets/{uid}.totalEarnedCoinsGross` | gross coins |
| Your share, all time | `wallets/{uid}.totalGemsEarned` | kept, lifetime |
| Available now | `wallets/{uid}.gems` via `availableMicroUsd` | kept, unspent, unpaid |
| Paid to date | `wallets/{uid}.totalPaidOut` | gems already sent |
| Monthly chart | ledger, `isEarning()` rows | time series only, capped at TX_WINDOW |

These are DIFFERENT numbers by design and every label now states its basis. If "Your share, all time" is $0.00 while "Available now" is $0.01, that gem entered the wallet by a route other than earning (coin→gem conversion, admin grant, purchase) — which is now visible instead of looking like a bug.

**Rule: never put two different bases on one screen without naming each one in its label.**

#### Money filters must be ALLOWLISTS (2026-08-15)

The earnings chart reported **$10.01 to an account that had earned nothing**. Cause: the filter was a denylist (`NOT_EARNINGS` regex). **A denylist fails OPEN** — every row type it had not anticipated counted as income. It let through `gem_transfer_received` (gemTransfer.js has an explicit comment saying these "must never get counted as creator earnings in the Studio breakdowns") and `withdrawal_cancelled` (the user's own held gems being returned).

Now `EARNING_TYPES`, an explicit Set verified against every writer of a positive gems row in `functions/`: `tip_received`, `earned_auto_converted` (the shared `settleEarnedToGems` path), `content_unlock_sale`, `event_ticket_sale`, `season_pass_sale`, `vergrme_sale`, `coaching_earning`, `coin_to_gem_conversion` (gem side; only EARNED coins can convert). Anything unrecognised is NOT income.

**DURABLE FIX, not done:** have the server stamp `earning: true` on those rows so the client filters on a fact rather than a name.

`totalGemsEarned` was checked and IS sound as "your share, all time": only `earnedGemCredit`, `settleEarnedToGems`, `convertCoinsToGems` and `vergrMeShop` increment it. `gemTransfer` and admin withdrawal-cancel deliberately do not.

#### READ docs/REVENUE_SHARE_*.md BEFORE touching earnings or wallet

Four docs, and they are the spec: `REVENUE_SHARE_PLAN.md` (why), `PART2_DECISIONS.md` (locked founder decisions), `PART3_SCREENS.md`, `MOCKUP_BRIEF.md`. Key facts I got wrong by not reading them:
- **Gems are NOT a currency.** Per §3.1 they are "accrued revenue share owed by Vergr", not transferable, not a balance the user calls on. Coins are "a licence to access Vergr features, revocable, no cash value".
- **Conversion is NOT a user action.** It is "automatic accrual at the moment revenue is earned". `ConvertScreen` is slated to RETIRE.
- **`gemTransfer` is REMOVE** (locked decision 4, founder: "its a red flag"). `sendGems`/`quoteGemSend` are already disabled server-side.
- Vergr LLC has **no money transmitter licence**, and balances + on-demand withdrawal + arbitrary crypto destinations are the three things that look like transmission. Never describe or design toward user-invoked conversion or withdrawal.

⚠️ ~~STATE AS OF 2026-08-15: the WALLET FRONTEND IS NOT GUTTED~~ — **superseded.** Re-verified 2026-08-16: `/wallet/convert`, `/wallet/withdraw`, `/wallet/withdraw/new-address`, `/wallet/addresses` and `/wallet/security/addresses` are all UNROUTED, and `WalletScreen.jsx` (which still holds "Convert Coins" CTAs) is lazy-imported at `AppRouter.jsx:486` but NEVER MOUNTED. **What IS still live and must come out: the crypto deposit surface** (`/wallet/security/deposit`, `AppRouter.jsx:1092`, linked from 4 places) **and 21 indexed public help articles documenting withdrawal.** See `docs/WITHDRAWAL_REMOVAL_LIST.md`.

#### The $10.01 that would not die (2026-08-15) — root cause: admin grants counted as earnings

`adminEconomy.js` `grantCurrency()` had `totalMap = { coins: "totalEarned", gems: "totalGemsEarned" }`, so **every admin gem grant incremented the lifetime EARNINGS total**. The founder account had been granted 1001 gems, so the Earnings screen reported $10.01 earned against zero real earnings. Not a display bug: the aggregate itself was polluted, which is why it survived a display fix and then survived switching the KPI TO that aggregate.

Fixed at the source: grants now land in `totalGrantedCoins` / `totalGrantedGems`. A grant is a comp, a support credit or test data. It is never revenue and must never appear in an earnings figure.

**No migration.** Existing wallets still carry inflated `totalGemsEarned`. Part 2 decision 7 says balances today are test data and the cutover is clean, so nothing is being rewritten.

**Therefore the Earnings screen derives lifetime from the LEDGER, not the aggregate.** The ledger is auditable line by line (type, amount, timestamp) so a questioned figure can be reconciled; an aggregate cannot be. This reverses the earlier note about capped queries: the cap is a real limitation, but a wrong number is worse than an incomplete window, and the window is flagged in the footer when it is hit.

**Rule: an aggregate counter is only trustworthy if you have checked EVERY writer.** Three writers were checked and cleared (`earnedGemCredit`, `settleEarnedToGems`, `convertCoinsToGems`); the fourth, sitting in a different file, was not, and it was the one doing the damage.

#### Part 3 wallet gutting — started 2026-08-15

Spec: `docs/REVENUE_SHARE_PART3_SCREENS.md` §15.3 and §18. **Nothing deleted; screens stay on disk and routes redirect**, per the hard rule.

DONE:
- `requestWithdrawal` **DISABLED server-side** (`functions/withdrawals.js`). On-demand pull is the shape §1.5 calls "the single highest-leverage change". The body is retained because the Circle plumbing, sanctions screening and hold logic are still wanted by the scheduled payout path. `cancelWithdrawal` and `getMyWithdrawals` stay LIVE on purpose so anyone with an in-flight request can see and cancel it.
- ~~Routes redirecting to `/creator/earnings`~~ — superseded by the section below: `/wallet/convert`, `/wallet/withdraw` and `/wallet/withdraw/new-address` were later removed outright rather than redirected. Only `/request-payout` and `/wallet/payout` still redirect (`AppRouter.jsx:986-987`).
- Verified already done by earlier work: Gems tile, Convert button, Withdraw button and Withdrawal-limits card are gone from `wallet/v2/HomeScreen.jsx`; `SendGemsModal` is no longer mounted anywhere (only referenced in a comment in SendCoinsModal); `sendGems`/`quoteGemSend` already disabled server-side.

STILL OUTSTANDING on Part 3:
- `HistoryScreen` should become an earnings statement rather than a transaction list.
- Wallet labelled "Coins" throughout (§18 copy change).
- "You have earnings, view in Creator Studio" row for users with earnings.
- `gemBuyback` (gems→coins) still makes gems look like a currency; §4.1 flags it as needing a founder call.
- `withdrawals.js` `PLATFORM_SPREAD_BPS = 200` dies with the flow, not before.
- Native mirrors batch into ONE APK at the end ([[feedback-batch-native-work]]).

#### Convert / withdraw / address book are GONE (2026-08-15, founder-instructed)

**"The ONLY way to make money on Vergr is revenue share."** Users cannot convert coins to gems and cannot start a withdrawal. These are not redirects, the routes do not exist:
`/wallet/convert`, `/wallet/withdraw`, `/wallet/withdraw/new-address`, `/wallet/payout/history`, `/wallet/payout/:payoutId`, `/wallet/security/addresses`, `/wallet/addresses`.

Also removed: Convert/Withdraw from `WalletLayout` desktop + mobile nav and breadcrumbs; the Convert card on `VanguardWalletScreen`; Convert/Withdraw controls in `NativeWalletScreens`; the address-book link in wallet Settings.

⚠ **2026-08-16: the "Receive USDC" removal claimed here originally DID NOT LAND, and has now been
done properly.** The crypto deposit route `/wallet/security/deposit` is unmounted, both lazy imports
and the `WalletLayout` breadcrumb are gone, and all four entry points are cut
(`NativeWalletScreens` QuickAction + LinkCard, wallet `SettingsScreen` card, `SecurityScreens` block).
The "Whitelisted addresses" block and the Vanguard "Request Payout / Withdraw" card went with them.
Screens remain on disk, unreachable. Verified by grep, not by assumption. Record:
`docs/WITHDRAWAL_REMOVAL_LIST.md` section B.

Server-side, which is what actually enforces it: as of 2026-08-16 all of these are DELETED, not disabled. `functions/withdrawals.js` and `functions/gemTransfer.js` no longer exist and no withdrawal or gem callable is deployed.

**Screen FILES stay on disk** (ConvertScreen, WithdrawScreen, NewAddressScreen, SecurityScreens address book) per the no-delete rule. They are unrouted and unreachable; their internal links to dead routes are harmless.

**The wallet is the BUYER surface only:** coins held, buy coins, purchase/spend history, who you sent to, active subscriptions, security. Nothing that holds or moves cashable value.

⚠️ **The wallet does NOT link to Creator Studio.** A wallet user is not a creator, and `/creator/earnings` sits behind `lock:'lite'`, so an Earnings link pointed most users at a locked surface. Removed: the Earnings quick action, the Earnings card in the right rail, and the "How creators get paid" help link. Part 3 §18 proposes a conditional "you have earnings" row; founder rejected even that, so there is no wallet-to-earnings path at all.

⚠️ Native mirrors are edited in source but NOT shipped: one APK at the end ([[feedback-batch-native-work]]).

#### NEVER paywall access to money already owed (2026-08-15, founder ruling)

`/creator/earnings` was gated `lock:'lite'` in `CreatorLayout` NAV plus `requiredTier="lite"` on the screen. Both removed. Earnings is now free for every account.

**Why this is not a pricing preference.** Two separate reasons:
1. Commercially: nobody pays a company they do not know for the opportunity to earn. It kills creator acquisition at the exact moment you are asking someone to try.
2. Legally: a fee standing between a creator and money already accrued to them is the worst possible shape for the principal/revenue-share argument in `docs/REVENUE_SHARE_PLAN.md` §1.5. Revenue share is the ONLY way to make money on Vergr, so paywalling it paywalls the entire creator proposition.

**CORRECTED by the founder 2026-08-15, the earlier distinction was wrong.** Memberships is not an "upsell", it IS revenue share, so it cannot be charged for. **Nothing that lets a creator earn, see earnings, or get paid may sit behind a paid tier, full stop.** Now free: Earnings, Memberships, Payout setup, Statements. Legitimate Lite upsells are TOOLS that do not move money: Analytics, Schedule, Audience.

✅ `memberships` gate REMOVED 2026-08-15 on founder instruction, along with `requiredTier="lite"` on PayoutScreens (payout setup + statements), which was charging creators to get paid.

#### Buyer/creator split completed 2026-08-15

`buyCoinsWithGems` DISABLED server-side: spending accrued revenue share treated it as a held balance, the stored-value shape §1.5 removes. Body retained.

Wallet is **"Coins"** everywhere (sidebar, titles, all breadcrumbs) and its History is now the BUYER ledger: Coins bought, Tips sent, Unlocks, Subscriptions. Conversion and withdrawal filters removed, they could only ever be empty. Money RECEIVED is revenue share and appears only in Creator Studio.

The internal accrual unit is never printed next to a user-facing amount. Remaining references live in unrouted screens only.