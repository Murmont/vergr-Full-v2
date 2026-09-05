# Play submission — what you need, and what is already done

For the 1.0.200 release. Companion to `PLAY_SUBSCRIPTION_SETUP.md` (products and
pricing) — this covers everything else Play asks for.

Every "already done" line below was verified against the repo or a live API on
2026-08-20, not recalled.

---

## Already verified — do not redo

| Item | Evidence |
|---|---|
| Play Android Developer API enabled | Service Usage API, `state: ENABLED` on project `vergr-44494` |
| Service account in Play Console | `vergr-44494@appspot.gserviceaccount.com`, Active |
| Coin products + subscriptions | Created by founder 2026-08-20 |
| **16 store items NOT yet created** | 9 VP bonus packs (`vpb_*`) + 7 boosts (`boost_*`), added to `play-products.csv` 2026-08-30. **These still need creating in Console**, as one-time products, consumable, exactly as the coin packs were. Until they exist, the Play build falls back to the coin price only and a buyer with an empty wallet cannot buy a boost on Android. |
| Privacy policy URL | https://vergr.app/platform/privacy |
| Terms URL | https://vergr.app/platform/terms |
| **Account deletion URL** | https://vergr.app/platform/delete-account — public, no login. This is a hard Play requirement and a common rejection. |
| Eight compliance policies | `/platform/{content-moderation, identity-and-consent, age-verification, anti-slavery, csam-policy, law-enforcement, aml-policy, anti-fraud}` |
| In-app reporting + blocking | Required for UGC apps. `submitReport` + block are live. |

One thing still unproven: the service account being *listed* is not the same as
holding **View financial data** and **Manage orders and subscriptions**. I could
not test it (impersonating the service account needs Token Creator, which your
account does not hold, and no Play purchase has ever run so there are no logs).
The first test purchase proves it. If it 403s, that permission pair is why.

---

## App access — you must supply a test login

Vergr requires an account to see anything, so Play review will be blocked
without credentials. **Play Console → App content → App access → All or some
functionality is restricted.**

Provide a working email + password for a real account. Add a note:

```
Sign in with the email and password above. The app is 18+ and requires a date
of birth at signup. Subscriptions are under Settings > Subscription. Coins are
under the Wallet tab. No other steps are needed to reach any surface.
```

Do not give a Google-sign-in-only account — reviewers cannot use it.

---

## Data safety form

Play cross-checks this against the privacy policy, so these answers are taken
from `legalContent.js` §2 rather than invented. Declare **collected** for all of
the following.

**Personal info:** Name · Email address · User IDs · Address (KYC and billing) ·
Phone number (optional) · Other info (date of birth, country, bio)

**Financial info:** User payment info · Purchase history · Other financial info
(payout details, wallet movements)

**Location:** Approximate location only (derived from IP: country, region, city).
**Not** precise location.

**Messages:** Other in-app messages (DMs, squad and stream chat). Not SMS.

**Photos and videos:** Photos · Videos

**Audio:** Voice or sound recordings (voice notes, livestream audio)

**Files and docs:** government ID and selfie for identity verification — collected
by Didit on our behalf; we receive the result plus derived attributes.

**App activity:** App interactions · In-app search history · Other user-generated
content · Other actions

**App info and performance:** Crash logs · Diagnostics · Other performance data

**Device or other IDs:** Device or other IDs — includes the **advertising ID**,
because AdMob serves ads to free-tier users.

For each: **encrypted in transit** = Yes. **Users can request data deletion** =
Yes, and give the deletion URL above.

⚠ Two judgement calls that are yours, not mine:

1. **Shared vs collected.** Play treats a service provider acting on your behalf
   as *not* shared. Didit, the payment processors and Cloudflare are service
   providers. **AdMob is the one to think hardest about** — if you serve
   personalised ads, the advertising ID is generally *shared* for advertising.
   Check AdMob's own Data Safety guidance and answer from that.
2. **Identity documents.** Didit collects them and we never store the images.
   Whether you declare them as collected-by-you is a call worth being
   conservative on: over-declaring is safe, under-declaring is a violation.

---

## Content rating (IARC questionnaire)

Answer honestly against the current policy (`compliancePolicies.js`, reversed
2026-08-14 to **no nudity or sexual content on any surface**):

- Users can interact / communicate: **Yes**
- User-generated content is shared: **Yes**
- Users can share their location with others: **No**
- Digital purchases: **Yes**
- Nudity or sexual content: **No**
- Gambling, simulated gambling, contests of chance: **No** — and this is now
  true in the product, not just on paper: tournaments, betting, predictions and
  prize competitions are all retired and unrouted. `public/llms.txt` states it
  publicly.
- Mature or suggestive themes, strong language: **Yes** — mature language and
  adult subject matter are explicitly allowed on an 18+ platform.

Target audience: **18 and over**. Do not tick any child category; it triggers
Families policy and Vergr would fail it.

---

## Ads declaration

**Contains ads: Yes.** AdMob serves free-tier users; Lite and Pro remove ads
(`VergrAd` and `WatchToEarnQuest` both gate on `isFree`). The store listing must
carry the "Contains ads" label.

---

## Financial features declaration

Play asks whether the app has financial features. Answer carefully:

- In-app purchases of a virtual currency: **Yes**, that is Coins.
- Crypto exchange / wallet / trading: **No** on the Play build. PayRam and every
  crypto surface are compiled out by `IS_STORE_BUILD`; the store build routes
  all digital purchases through Play Billing. Do not describe Vergr to Play as
  crypto-adjacent — on this binary it is not.
- Money transmission: **No.** Vergr is the principal in every transaction and
  pays its own suppliers. See `docs/REVENUE_SHARE_PLAN.md` §1.4 before answering
  any question phrased around "sending money between users".

---

## Country availability

Exclude, per `docs/play/play-blocked-countries.csv`:
**CN, KP, IR, SY, CU, RU, BY, VE**

Set at the app level, not per product.

---

## How to actually upload and release it

### Step 1 — deal with the existing unpublished release first

Play allows only ONE draft release per track. If a previous AAB was uploaded and
never rolled out, the track shows **Edit release**, not **Create new release**.
You cannot start a second one alongside it.

Go to **Test and release → Testing → Internal testing** and look at the track:

- **"Edit release"** — a draft is sitting there. Open it, remove the old AAB
  (the bin icon next to it), upload the new one. Or scroll down and **Discard
  release**, then start fresh.
- **"Create new release"** — nothing pending, go straight ahead.
- **"In review"** — it was submitted. Wait for it to clear or cancel the
  submission; you cannot upload over a release under review.

A previously uploaded AAB never blocks a new one on version grounds: 200 is
higher than anything before it, which is all Play checks.

### Step 2 — go to Internal testing, not Production

Internal testing has **no review wait** (minutes, not days) and license testers
purchase at no charge with accelerated renewals. Production for a first release
can take days and you would be waiting to find out whether billing works.

**Test and release → Testing → Internal testing → Create new release**

### Step 3 — upload

Drag `C:\Users\damie\Downloads\VERGR-1.0.200.aab` into the App bundles box.

**Play App Signing:** if this is the first bundle ever accepted, Play asks you to
enrol. Accept "Let Google create and manage my app signing key". If a previous
AAB was already accepted, the key is set and you see nothing.

Fill in:

- **Release name:** `1.0.200` (internal only)
- **Release notes**, inside the `<en-US>` tags:

```
Pro now keeps your photos at full 4K, saves past broadcasts as 90-day replays,
and adds an animated avatar, a Pro badge and advanced analytics. Plan
descriptions across the app were corrected so every listed feature is one you
actually get. Plus faster icon loading and a long list of privacy and wallet
fixes.
```

**Next** → **Save and publish** (or **Start rollout to Internal testing**).

### Step 4 — add yourself as a tester

Same Internal testing page → **Testers** tab → create an email list containing
your Google account → Save.

Then copy the **Join on Android** opt-in link at the bottom of that tab, open it
on the phone, accept, and install from the Play link it gives you.

⚠ Install from that link, not by sideloading the APK. Play Billing checks the
install source and will not work otherwise.

### Step 5 — App content declarations

**Test and release → App content.** Production rollout is blocked until every
row is green, and some rows gate internal testing too. Work down the list:
Privacy policy, App access, Ads, Content rating, Target audience, News app,
Data safety, Government apps, Financial features, Health, Advertising ID.

All the answers are in this document.

### Step 6 — promote to Production when billing is proven

Internal testing → the release row → **Promote release → Production**. The same
bundle moves across; you do not rebuild.

---

## The artifact

The AAB is at `C:\Users\damie\Downloads\VERGR-1.0.200.aab` (copied out of the
gradle output directory immediately, because a later sideload build overwrites
that path with a Play-rejectable artifact).

Version fields for this release, all three moved together:
`tauri.conf.json` 1.0.200 · `appVersion.js` APP_VERSION 1.0.200 +
APP_VERSION_CODE 200 · `version.json` 200 with new notes.
`Cargo.toml` deliberately left at 1.0.1.

Release notes for the Play listing:

```
Pro now keeps your photos at full 4K, saves past broadcasts as 90-day replays,
and adds an animated avatar, a Pro badge and advanced analytics. Plan
descriptions across the app were corrected so every listed feature is one you
actually get. Plus faster icon loading and a long list of privacy and wallet
fixes.
```

---

## After the first test purchase

Confirm all four, in this order:

1. Google charges the localized price from `play-prices-by-market.csv`, not the
   web price.
2. The subscription screen shows that same figure (the store build reads Play's
   own string; a mismatch means the billing bridge failed and it fell back).
3. `users/{uid}.subscription` reads `lite` or `pro`.
4. `users/{uid}.subscriptionPreferredMethod` reads `google_play`.

If the purchase completes at Google but nothing is granted, it is the service
account permission pair, not the code. The client deliberately leaves the
purchase unconsumed so it retries rather than taking money for nothing.

---

## The two upload messages (measured 2026-08-20, both non-blocking)

### Error: "Your app does not support 16 KB memory page sizes"

**Click Proceed anyway.** It reads as an error but it is advisory until
**1 February 2026**, after which apps targeting Android 15+ cannot ship updates
without it.

Measured, not assumed — arm64 LOAD-segment alignment in the 1.0.200 AAB:

| Library | Align | |
|---|---|---|
| libbarhopper_v3.so | 0x4000 | ok |
| libgpupixel.so | 0x4000 | ok |
| libmars-face-kit.so | 0x4000 | ok |
| libxeno_native.so | 0x4000 | ok |
| libvergr_desktop_lib.so | 0x1000 | **ours** — fixed by `src-tauri/.cargo/config.toml`, applies from the next build |
| libimage_processing_util_jni.so | 0x1000 | **CameraX** — not fixable by us |

Check any future build with:

```
llvm-readelf --wide --program-headers <lib.so> | awk '/LOAD/{print $NF}'
```

`libimage_processing_util_jni.so` ships prebuilt inside
`androidx.camera:camera-core`, pinned at **1.3.4**. Clearing the warning fully
means bumping CameraX to a release that ships 16 KB aligned. That is an
API-surface change across camera-core / camera2 / lifecycle / view and needs its
own camera regression pass (AR filters, video notes, recording), so it is
deliberately NOT bundled into a release being shipped for billing testing.

AGP is 8.11.0, above the 8.5.1 that made zip alignment automatic, so no Gradle
change is needed.

### Warning: "you've not uploaded debug symbols"

Optional, affects only crash readability. It cannot be fixed by
`android.ndk.debugSymbolLevel` — see the note in `app/build.gradle.kts`, which
records that being tried and verified inert, because our Rust `.so` is prebuilt
and dropped into jniLibs rather than built by Gradle.

Per-release manual upload:

```
llvm-objcopy --strip-debug src-tauri/target/aarch64-linux-android/release/libvergr_desktop_lib.so out.so
```

Then Play Console → the release → App bundle → upload the symbol file.
