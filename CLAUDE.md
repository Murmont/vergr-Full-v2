# VERGR — Claude working notes

Keep this file current. It replaces long re-exploration every session.

## Hard rules (do not violate)

- **Zero out-of-pocket cost.** No new paid services. Firebase Spark-compatible only.
- **Coin economy floor (full-price): €0.0090 per coin.** Full-price packs never go below this. Starter (100 / €0.99) anchors at €0.0099; bulk packs scale down to €0.0090. The first-purchase discount is the **only** exception — a one-shot 20% off any pack, no cap. New users sit at Rookie (30% commission) so the conversion-side margin still covers the discount at sale time; subsequent purchases are full-price. Source of truth: `src/utils/vpSystem.js` (`COIN_PACKS`, `FIRST_PURCHASE_DISCOUNT`). Coin→gem conversion: gems are the only withdrawable currency. Min payout 1,000 gems. Referral payouts: referrer +5,000 VP, referee +3,000 VP, gated server-side.
- **Terse output.** No trailing recaps, no emoji in code/docs unless asked.
- **WebRTC, never Jitsi.** We use raw WebRTC + Google STUN. Never call it Jitsi.
- **Creator quests award VP only — never coins.** Coins are bought/earned via tips/memberships/tournaments/boosts.
- **No "Gifts" as a revenue category.** VERGR has: Tips, Memberships, Tournament prizes, Boosts. That's it. No Ads, no Sponsored, no Gifts category.
- **Content types:** Text, Photo, Clip, Article, Short, Achievement, LFG, TierList, Quote, Live Stream. No "Reels".
- **Moderation UI belongs to Mod/Manager/Owner dashboards — NOT the creator dashboard.**
- **Desktop-only-actions rule applies to Moderator/Manager/Super-Admin dashboards. Creator dashboard must work on mobile AND desktop.**
- **Don't wander.** Only do what the user asked. No proactive docs, refactors, or tangents.

## Stack

- React 18 + Vite SPA, HashRouter
- Tailwind (no `grid-cols-24` — use inline `gridTemplateColumns` style)
- Firebase v10.14: Firestore, Functions (`europe-west1`), Hosting, FCM
- Recharts (installed), Dexie.js (installed — chat cache)
- Tauri desktop wrapper
- Material Symbols Rounded icons via `<Icon name="..." />`
- Fonts: **Syne** (headings), **DM Sans** (body), **DM Mono** (all numbers, with `tabular-nums`)

## Design tokens

```
--brand-cyan   #4DFFD4   (hex used in Recharts: #22d3ee)
--brand-violet #7B6FFF   (hex in charts:        #a78bfa)
--brand-pink   #C87FFF   (hex in charts:        #f472b6)
--brand-gold   #F5C542   (hex in charts:        #fbbf24)
--brand-ember  #FF4D6A   (hex in charts:        #fb7185)
--bg-dark      #07080D
--surface-1    #0F1118
```
Chart palette lives in `src/components/creator/charts.jsx` → `PALETTE`.

## Key paths

| Path | Purpose |
|---|---|
| `src/router/AppRouter.jsx` | All routes. Creator Studio lives in its own `<Outlet>` group outside `MainLayout` so CreatorLayout owns the chrome. |
| `src/layouts/MainLayout.jsx` | Regular app shell (`ResponsiveLayout` → `DesktopSidebar` + `BottomNav`) |
| `src/components/ResponsiveLayout.jsx` | Injects `DesktopSidebar` + `BottomNav` on `/`-style routes |
| `src/components/BottomNav.jsx` | `HIDE_ON_PATHS` includes `/creator` — extend when adding more immersive routes |
| `src/components/creator/CreatorLayout.jsx` | Creator Studio chrome: 260px collapsible sidebar + 64px topbar + mobile bottom nav + Exit Studio button |
| `src/components/creator/Widgets.jsx` | `Card`, `KpiCard`, `SectionHeader`, `InsightCard`, `StatRow`, `PeriodPicker` |
| `src/components/creator/charts.jsx` | `Sparkline`, `TrendLineChart`, `StackedAreaChart`, `HorizontalBarChart`, `VerticalBarChart`, `DonutChart`, `ActivityHeatmap`, `compactNum`, `PALETTE` |
| `src/firebase/firestore.js` | All Firestore helpers (`getUserPosts`, `getTransactions`, `getFollowers`, `getFollowing`, `claimQuestReward`, etc.) |
| `src/context/UserContext.jsx` | `profile`, `wallet`, etc. |
| `src/context/AuthContext.jsx` | `currentUser` |
| `src/hooks/useResponsive.js` | `{ isDesktop, isTablet, isMobile }` |

## Creator Studio screens

All wrap themselves in `<CreatorLayout page="..." title="..." subtitle="...">`.

- `CreatorDashboardScreen` (`/creator/dashboard`) — Home: KPIs, Trend+Donut, top posts, wallet, quest teaser
- `CreatorEarningsScreen` (`/creator/earnings`) — Revenue hero, stacked area, donut, supporters, payouts, tx list
- `CreatorContentScreen` (`/creator/content`) — Post grid with engagement chips, filters
- `CreatorScheduleScreen` (`/creator/schedule`) — Month grid + agenda view, type-colored chips
- `CreatorAudienceScreen` (`/creator/audience`) — Growth trend, gender/age/country, top supporters
- `CreatorCommunityScreen` (`/creator/community`) — Activity stream, announcement composer, replies needed, milestones, sentiment. **No moderation.**
- `MonthlyAnalyticsScreen` (`/creator/analytics`) — accepts `embedded` prop; route wraps it in CreatorLayout
- `CreatorQuestsScreen` (`/creator/quests`) — same pattern. **VP rewards only.**
- `MembershipTiersScreen` (`/creator/membership`) — same pattern
- `CreatorVerificationScreen` (`/creator/verify`) — still inside MainLayout (flow screen)

## Build + deploy

```
npm run build
firebase deploy --only hosting     # → https://vergr-44494.web.app
firebase deploy --only functions   # europe-west1
```

## Conventions

- **Numbers use DM Mono + `tabular-nums`:** `className="font-dmmono font-bold tabular-nums"`. Not Syne.
- **Empty states always present** — use `Icon` + muted copy, never render blank charts.
- **Period pickers use the shared `PeriodPicker` widget** — options default `['7d','30d','90d','6m','All']`.
- **Firestore timestamps**: always normalize via `tsMs(t)` helper (supports `.toDate()`, `.seconds`, ISO).
- **Currency display**: coins use `compactNum` + `"c"` suffix (e.g. `1.2Kc`). USD shown as `$X.XX` next to coins, NOT instead of.
- **Never create new files unless necessary.** Prefer editing existing. No unsolicited README/docs.

## Media storage on Cloudflare R2 (May 2026)

**Status: LIVE.** All user-generated images/videos go to R2, served via
`https://cdn.vergr.app`. Firebase Storage egress costs are now $0 for new
uploads. KYC docs (`KycWizard.jsx`) intentionally stay on Firebase Storage
because they need Firebase Auth scoping.

**Architecture:**
- `functions/r2.js` → `getR2UploadUrl` callable: validates plan + size +
  content type, issues a presigned PUT URL (expires 5 min). Returns
  `{ uploadUrl, publicUrl, key }`. Bucket: `vergr-media`. Public base:
  `https://cdn.vergr.app`. Account ID, access key, secret stored as Firebase
  secrets (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  `R2_BUCKET`, `R2_PUBLIC_BASE`).
- `src/utils/r2Storage.js` → `uploadToR2(file, kind)` — frontend helper that
  fetches the URL, PUTs the blob, returns `{ url, key }`. Save the `key` on
  the post doc as `mediaKey` if you want the auto-tiering function to be
  able to demote it later.
- All previous `firebase/storage` callers in `src/firebase/firestore.js`
  (`uploadAvatar`, `uploadBanner`, `uploadPostMedia`, `uploadFile`),
  `src/utils/mediaHelpers.js` (`uploadMediaFile`, `uploadBlob`),
  `AdCenterScreen`, `ChatSettingsScreen`, `ProfileSetupScreen`,
  `StatusScreen`, `VergrMeEditorScreen` are migrated.

**Cost model (why this is cheap):**
- Storage: $0.015/GB/month (R2 Standard), $0.010/GB/month after 90 days
  (R2 Infrequent Access — bucket lifecycle rule auto-applies).
- Egress: **$0** when served via `cdn.vergr.app` (Cloudflare CDN).
  First view per region pulls from R2 (free Class B op until 1M/month);
  every subsequent view in that region is served from cache.
- Free 10 GB storage + 10M Class A ops + 1M Class B ops/month forever.

**Plan-based size caps** (mirrored in `functions/r2.js` SIZE_CAPS and
`src/utils/mediaCompression.js` TIER_MAX_BYTES — keep in sync):

| Tier | Per-upload cap | Approx content |
|---|---|---|
| Free | 200 MB | ~5-min 720p gaming clip |
| Lite | 1 GB | ~15-min 1080p clip |
| Pro | 5 GB | Full-match VOD / extended highlight |

**Video duration caps** (in `src/utils/mediaCompression.js`):
- `SHORTS_LIMITS` — Shorts (vertical short-form): 60s for everyone.
- `CLIP_LIMITS` — Clips (feed video): free=5min, lite=15min, pro=60min.
- Pass `kind: 'clip'` to `compressVideo()` to use clip limits;
  defaults to `'short'` for backward compat.

**Video format:** WebM (VP9, falls back to VP8). VP9 is ~50% smaller than
H.264 MP4 at equal quality. **Don't switch to MP4** — that's why our
storage stays cheap. The CLAUDE.md note about "H.264 720p MP4" was a
planning artifact, not the implementation.

**Emergency kill switch** (free tier only):
- Flip `app_config/general.freeUploadsPaused = true` in Firestore →
  free uploads halt within 5 seconds (no redeploy needed). Paid users
  always pass. Use this if R2 costs spike unexpectedly.

**Engagement-driven storage tiering (DORMANT until 5,000 posts):**
- `coldStorageDemotion` in `functions/r2.js` runs Sundays 03:00 UTC.
- Activates only when `app_config/general.totalPosts >= 5000` OR when
  `tieringEnabled === true`. Below threshold, R2's bucket lifecycle rule
  handles cold-tiering by itself, and running this function would cost
  more in Firestore reads than it saves.
- When active: scans posts where `lastViewedAt > 90 days ago` AND
  `storageTier !== 'cold'`, runs `CopyObject` with
  `StorageClass: STANDARD_IA` against R2, sets `storageTier: 'cold'` on
  the post doc. ~33% storage cost saving on those bytes.
- **Never punishes paid users.** Tier moves are invisible — same URL,
  same quality, ~200ms slower first byte on the cold-cache miss.

**Why we never block paid uploads:** the tier system is designed so that
hot storage cost grows with engagement (which generates revenue via tips,
memberships, tournament fees). Inactive content auto-tiers to near-free
cold storage. Single users can't break the system because of per-upload
caps, and a global revenue dashboard + cost alerts catch macro problems.
**There is no "delete old stuff to upload new" gating** — that's not a
solution we'll ever ship.

**Cost alerts (TODO, manual):** set up Cloudflare Notifications →
Billing → R2 spend > €10/month threshold. Independent of code.

**Twelve-month re-encode-to-480p (rejected):** considered, then dropped.
The visible quality drop on old content is not worth the marginal saving
once content is already in IA tier. Leave old content alone.

## Things NOT done yet (backlog — only touch if asked)

- Scheduled posts backend (`CreatorScheduleScreen` uses mock `buildMockSchedule`)
- Audience demographics backend (gender/age/country in `CreatorAudienceScreen` are placeholders)
- `claimQuestReward` still credits coins server-side — needs VP field migration
- Chat messaging rewrite (Dexie + `relayMessage` relay) — plan file exists but not executed
- Thanos dissolve delete effect for messages — plan file exists
- **Live stream clip button is fake** — `makeClip` in `BroadcasterScreen.jsx` only increments a counter + shows a toast. No capture, no upload, nothing saved. Wire after Gcore is set up. Plan: capture last N seconds from HLS buffer client-side → upload MP4 to R2 via presigned URL. Plan-based limits: Free=30s/3 clips per stream, Lite=60s/5 clips per stream, Pro=90s/unlimited.

## What wastes tokens (do not do)

- Reading docx/pdf files in `Downloads/` or temp dirs unless the user points at them
- Re-exploring the codebase when this file already documents the relevant paths
- Running broad greps when the user's request names a specific file
- Asking confirmation for tasks the user already specified
- Trailing "here's what I did" summaries after edits — the diff shows it
