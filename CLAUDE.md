# VERGR — Claude working notes

Keep this current. Condensed 2026-05-22 (full historical detail preserved in `CLAUDE.md.bak`, now at `C:\Users\damie\Downloads\CLAUDE.md.bak`, + git history). When a build ships or a TODO is added, update the relevant section.

---

## ▶ Active build queue (READ FIRST each session)

Work **one item per session**; checkpoint to this file before `/clear`. Founder tracks granular completion in a Google Doc (a "Done =" acceptance test per task). **Do NOT trust "batch done" — verify each task** (show the diff, run `npm run build`, deploy if user-facing) and state plainly what was NOT done.

---

## 🏆 TOURNAMENTS — FULL FUNCTIONAL TODO (read first, work top-down)

Comprehensive audit 2026-05-25. Tournaments are functional but have real gaps before they're ready for real users. Don't trust prior "shipped" labels — verify each item with code reads + smoke tests.

**CORE LIFECYCLE AUDIT 2026-05-26 (1v1 single-elim spine):** Traced create → join → start → verify → report → advance → finalize → payout in code. **Spine is correct**: join does atomic coin escrow + prizePool increment; start seeds + builds round-1 match docs (`match.player1`/`player2` hold UIDs) + flips status `active`; report needs two-player agreement or trusted source, routes disagreement to `disputed`; advance handles byes + auto-finalizes the final; finalize is winner-takes-all + idempotent (`payoutStatus:'paid'` inside the tx) + awards TP/VP/XP. **Findings:** (1) ✅ FIXED — `joinTournamentSecure` ran `assertKycVerified`+`assertRegionAllowed` unconditionally, blocking FREE-tournament joins for non-KYC users; now gated on `entryFee > 0` (free = no KYC, so friend-tests work). (2) ✅ FIXED 2026-05-26 — `recordMatchResultInternal` now rejects non-trusted (player/host) result reports unless BOTH sides have engaged verification (status `verified` OR `self_attested`). Trusted sources (admin/vanguard/gsi/gameapi) bypass so mods can unstick a match; only enforced when the match has a `verifyState` scaffold (byes/legacy skip). Accepts `self_attested` (not just `verified`) so manual/"Other" games without OCR/mod still complete. Deployed on `reportMatchResultSecure` + `reportGameResultSecure`. (3) ⚠️ OPEN (low) — a bracket round consisting ENTIRELY of byes wouldn't re-trigger `advanceBracketAfterMatch`; only possible in odd non-power-of-2 shapes (2/4/8/16-player are fine). Still UNVERIFIED by a live run: a real friend-test tournament end-to-end (the actual smoke test).

### Anti-cheat & verification gaps (CRITICAL — money on the line)
| # | Item | Status |
|---|---|---|
| AC1 | **Live in-match score OCR pipeline** (separate from lobby-code OCR which IS wired). Continuous Tesseract pass against broadcaster's stream, 1 frame / 10s, per-game crop region defined in `tournamentGames.js` (e.g. CS2 score `{x:920,y:30,w:80,h:50}`), writes `match.liveScore.{playerUid}` + `match.liveScoreSource.{playerUid}='ocr'`. Overlay `TournamentOverlayNeon` already has the slot ready. Calibrate top 3 games first (FIFA/NBA2K/CS2). ~30min per game. | ✅ SHIPPED + DEPLOYED 2026-05-26. Built as a 10s self-loop INSIDE the `vergr-ocr` Hetzner box (NOT a Cloud Function — avoids quota burn + base64 round-trips). Box now runs Firebase Admin (creds `/etc/vergr-ocr/firebase-admin.json`, reused from rtmp-auth); every 10s scans `streams` where `status=='live'` with a `tournamentId`, finds the `in_progress` match, looks up the game crop region, OCRs the cropped scoreboard (`/ocr` gained fractional `crop{x,y,w,h}` + `digitsOnly` whitelist), parses "A - B", writes `match.liveScore.{uid}` + `liveScoreSource.{uid}='ocr'` + `liveScoreAt`. Overlay already reads these (no FE change). Crop regions: `src/utils/tournamentGames.js` `liveScore` field (cs2/fc25/nba2k) MIRRORED in `infra/vergr-ocr/main.go`. ⚠️ Crop fractions are STARTING values — refine vs a real broadcast frame per game. More games = add a `liveScore` region to BOTH files. Deploy: scp 3 files to `/opt/vergr-ocr/src/`, `go mod tidy && go build -o /opt/vergr-ocr/vergr-ocr`, `systemctl restart vergr-ocr`. |
| AC2 | **Lobby code OCR auto-verification.** ⚠️ Prior "optimised for chat only" note was WRONG — there was NO automated lobby-code scanner at all (`ocrVerifyMatchPlayer` in `matchVerification.js` was a receiver nothing called; verification was mod+self-attest only). BUILT + DEPLOYED 2026-05-26: the `vergr-ocr` 10s loop now also OCRs each player's OWN gameplay stream (found via `streams.hostUid` + `tournamentMatchId`), full-frame text search for the `VERGR-XXXX` code (tolerant of OCR glyph confusions), and on a hit flips `match.verifyState.{uid}='verified'` source=ocr + fires the same `tournament_match_verified` / `tournament_match_ready` notifications the callable would (direct Firestore writes — no Cloud Functions deploy needed). Full-frame search covers ALL 4 verifyMethods (chat/name/lobby_name/match_screen) at once. 🟡 Remaining = optional per-method×game crop calibration to tighten accuracy: populate `lobbyCropRegions["<game>:<method>"]` in `infra/vergr-ocr/main.go` (empty = full-frame, the robust default). | ✅ scanner shipped; 🟡 crop calibration optional |
| AC3 | **Real-time during-match cheat-flag pass** — `aiCheatFlagVod` only runs AFTER VOD is archived. Flags land minutes after the match. Stream-time sampling would let mods intervene live. | ❌ |
| AC4 | **Webcam face-presence check mid-match** — webcam mandatory at >5000c but we don't verify the player's face stays in frame. Player could point cam at the wall. Gemini Vision face-detection on the proof feed (1 frame / 60s) would catch this. | ❌ |
| AC5 | **Two-devices-one-account detection** — fingerprint binds THIS device but doesn't catch a player running Vergr on phone + cheats on a separate PC playing the same Steam account. | ❌ |
| AC6 | **Stream-source spoof fingerprint** — broadcaster could feed a fake video instead of live game capture. We don't fingerprint the stream source. | ❌ |
| AC7 | **Quarterly cheat-signatures refresh** — seed of ~40 was deployed once. Need a cadence (founder review or cron import from a public BYOVD list). | ✅ DEPLOYED 2026-05-26 (cadence-nudge form). New `cheatSignaturesHealthCron` (`functions/cheatSignaturesRefresh.js`, monthly `0 6 1 * *` UTC, re-exported from index.js): reads `cheat_signatures`, computes newest-signature age, writes `app_config/cheat_signatures_health`, and when empty or >90d stale pushes every `role:'admin'` a `cheat_signatures_stale` notification (added to FCM allowlist) deep-linking `/admin/cheat-signatures`, de-duped per month via `cheat_signatures_alerts/{YYYY-MM}`. Client staleness banner added to CheatSignaturesScreen (computed from the loaded list, no cron dependency). **Deliberately NOT auto-fetching an external BYOVD feed** (loldrivers.io etc.) — a feed format change would flood `pending` docs + is a supply-chain surface; the reliable zero-cost core is the staleness nudge prompting founder review. Opt-in auto-import deferred. |
| AC8 | **Detection of suspended/uninstalled launchers mid-match** — Tauri scan catches running cheat tools, not absent legit ones. Steam closed mid-match = silent. | ❌ |
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
| OP6 | **Apex/OW2 wrapper auto-detect reliability** — Tier B wrappers break when community APIs change. `wrapperMonitor` alerts admins but acknowledge wrapper games = mod-primary, auto = bonus. Doc this clearly in tournament create flow per game. | 🟡 |

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
| AG1 | **VOD highlights playlist per user** — `autoCutVodHighlights` runs, output not exposed in any UI. Add a tab on user profile. | ✅ DEPLOYED 2026-05-26. New "Highlights" Section on TournamentStatsScreen (`/tournaments/me/stats`) flattens the Gemini-cut clips (`match.highlights[]` = `{startSec,endSec,title,reason}` written by `autoCutVodHighlights`) across every match the user played that has an `archiveVodUrl`, newest first, capped at 12. `<HighlightCard>` is click-to-load: plays the archived VOD seeked to the clip range via a media fragment (`#t=start,end`), keeping the page light until played. Reuses the screen's existing collectionGroup matches query (player1/player2 == uid, status completed) — no new index. Surfaced on the tournament-stats screen (the per-user tournament profile), not the social profile; AG3 covers the public-profile pin. |
| AG2 | **Weekly auto-curated reels** — "best clutch" / "biggest upset" of the week assembled from highlights cron, surfaced on home feed. | ❌ |
| AG3 | **Tournament VODs pinned to placer profile** — players who placed top-3 get the highlight reel auto-pinned to their profile. | ❌ |

### Growth features (P3 — drives retention)
| # | Item |
|---|---|
| GR1 | **Public tournament host profile** — show host's W/L ratio, fairness rating, mod-calls-overturned %, sponsor tier. Answers "is this host legit?" in one click. |
| GR2 | **Per-game seasonal leaderboards** — top 100 CS2 players this week. Drives habitual return. |
| GR3 | **Squad-vs-squad rivalry tracker** — if two squads played 3+ tournaments, head-to-head on each profile. |
| GR4 | **Tournament-themed avatar frames** — winners get a 7-day frame around their avatar across the app. Visible flex. |
| GR5 | **Brawl mode (quickplay)** — solo player walks up, gets matched into a 1v1 instantly. Lower barrier than committing to a 16-player bracket. |
| GR6 | **Coaching marketplace** — pro players list paid coaching slots; tournament loss screen surfaces them ("Want pro coaching for €5 / 30 min?"). New revenue line. |
| GR7 | **Squad sponsorship of public tournaments** — squads use treasury to sponsor public events. Gives treasuries an outlet beyond holding coins. |
| GR8 | **Battle-overlay variant for two-streamer live streams** — reuse `TournamentOverlayNeon` CSS, swap data source from tournament/match → stream/coHost. "Streamer battle" overlay. ~1-2h work. |

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

### LIVE payment + custody stack (Path C, locked, on Base mainnet)

| Role | Provider | Status |
|---|---|---|
| Inbound onramp (card/Apple Pay/bank → USDC) | **PayRam** embedded checkout on Base | Self-hosted node live; no merchant KYB; end-user KYC via PayRam's onramp partners. |
| Outbound — crypto cashout | **Circle Wallets API** → user's whitelisted Base address | Code ready. |
| Outbound — fiat/bank | **NONE.** Confirmed 2026-05-21: PayRam has no crypto→fiat offramp; Circle Mint can't pay arbitrary user banks. | User cashout is **crypto-only**. Withdraw screen's "to my bank" tab is honest guidance + `FiatCashoutHelper` recommending Coinbase (verified Base-USDC + bank withdrawal). A dedicated offramp provider is a future founder decision. |
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

### 🚦 GO-LIVE READINESS — remaining steps (gated on ~$1–2 Base ETH gas)

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
| 🟡 | R2 segment cleanup cron (delete ended-stream segments after 24h — see TODO below). |
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

### TODO before public indexing (do not forget)
- **Google Safe Browsing check** — 2026-05-25 an old tab loaded `vergr.app` and showed Chrome "Dangerous site" phishing warning; a fresh tab loaded fine. Recheck via `transparencyreport.google.com/safe-browsing/search?url=vergr.app` once the app is feature-complete + before any user invite/marketing push. If flagged: find offending URL via Search Console → Security Issues, remove (likely R2 user upload), submit review request (24-72h). Also harden: scan R2 uploads through Gemini BEFORE the public URL goes live (currently lives during scan window).
- **Kill HashRouter → BrowserRouter** — every URL is `vergr.app/#/…` which looks broken/old. Migrate `src/router/AppRouter.jsx` to `BrowserRouter`, add Firebase Hosting rewrite `"source":"**","destination":"/index.html"` in `firebase.json` (or confirm it's already there), QA every `navigate()` + `window.location` callsite for hard hash assumptions, regenerate any external links that use `#/` (push notifications, email templates, FCM `actionUrl` fields). Founder wants the `#` gone before launch.

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
| ✅ | Tournament VOD archive pipeline: `functions/vodArchive.js` triggers on tournament-stream end → POSTs Hetzner `vergr-vod-archive` launcher (`infra/vod-archive/` — Node service, ffmpeg downscale to 480p H.264 + AAC 64k, R2 upload at `archives/tournaments/{matchId}.mp4`) → `markVodArchived` HTTP webhook writes `archiveVodUrl` on match. Unblocks `aiCheatFlagVod` + `autoCutVodHighlights`; 7-day retention path in `streamingCleanup.js` already reads `tournamentMatchId`/`tournamentId` for TTL. **Deployed 2026-05-25** on Hetzner `vergr-stream-1` (91.98.79.244): systemd unit `vergr-vod-archive` on `127.0.0.1:8097` (NOT 8095 — that's `vergr-chat`; 8096 is `vergr-cohost-launcher`), env at `/etc/vergr-vod-archive.env` (HOST_OPS_TOKEN + R2 creds), nginx vhost `archive.vergr.app` → SSL via certbot (renews ~2026-08-23). Cloud Fns `dispatchTournamentVodArchive` (`streams/{streamId}` onUpdate trigger) + `markVodArchived` (HTTP callback) live in europe-west1. Verified: HTTPS 200 on `/healthz`, 401 without Bearer, 202+schema-validation with Bearer. **Update `infra/vod-archive/deploy.sh` port from 8095→8097 if re-deploying.** |
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
- **Zero out-of-pocket cost.** No new paid services. Firebase Spark-compatible only.
- **NEVER use em dashes (—) in any output to the user** (chat, commits, PRs, emails, code comments, this file). Use commas/periods/parentheses/colons.
- **Terse output.** No trailing recaps, no emoji in code/docs unless asked.
- **Don't wander.** Only do what's asked. No proactive docs/refactors/tangents.
- **Always update this file when work completes** (move shipped → done, add new follow-ups). Don't wait to be asked.
- **Material Symbols:** loaded font is `material-symbols-outlined`. Never use `material-symbols-rounded` (not loaded → renders raw text). Use `<Icon name="..." />`.
- **Tournament caps (Riot-disclosed, do not raise without re-notifying Riot):** entry fee ≤10,000 coins; prize pool ≤500,000 coins; mod cut 5%. Source: `src/utils/tournamentTypes.js` (`validateTournamentLimits`). Enforced in `CreateTournamentScreen` UI + `createTournament` + must be called by any Cloud Function creating tournaments.
- **Tournament prize payout (LOCKED 2026-05-25): WINNER-TAKES-ALL coins for every bracket type.** Solo wins → winner's wallet; squad wins → winning squad's treasury (`squadTreasuryPct:100`). No 2nd/3rd/4th coin payouts. Multi-place rewards happen only in (a) Tournament Points on the global leaderboard (1000/600/400/250/175/100/50/25 by `tournamentPointsFor`) and (b) placement XP/VP for top 3 (`squadXpByPlace`/`vpByPlace` in `finalizeInternal`) — these are separate from coins. Source: `src/utils/tournamentTypes.js` + `functions/tournamentRules.js` PRIZE_DISTRIBUTION, payout loop in `functions/tournaments.js → finalizeInternal`.
- **Coin economy floor: €0.0090/coin.** Packs never below. Starter anchors €0.0099. No coin-purchase discounts. Source: `src/utils/vpSystem.js` `COIN_PACKS`. Gems are the only withdrawable currency. Min payout 1,000 gems. Referral: referrer +5,000 VP, referee +3,000 VP, server-gated.
- **Tip economy: flat 10% platform fee at send time.** Recipient gets `floor(N×0.90)`. Conversion coin→gem applies a separate VP-tier commission. Source: `firestore.js → sendCoins`.
- **Creator quests award VP only, never coins.**
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

- React 18 + Vite SPA, HashRouter. Tailwind (no `grid-cols-24` — use inline `gridTemplateColumns`). Firebase v10.14 (Firestore **named DB `vgrdb`**, Functions `europe-west1`, Hosting, FCM). Recharts, Dexie. Tauri desktop wrapper. Material Symbols via `<Icon name="..."/>`. Fonts: Syne (headings), DM Sans (body), DM Mono (numbers + `tabular-nums`).
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
| 4 | Crypto withdrawal pipeline (`requestWithdrawal` → 3-day hold → `processReadyWithdrawals` → Circle) + History UI | ✅ |
| 4b | Bank withdrawal | ⛔ not possible (no offramp — crypto-only) |
| 5 | Compliance: geo-block, Chainalysis sanctions on Base, Travel Rule data, SAR cron, ToS/Privacy | 🟡 |
| 6 | Software guards: TimelockController on Base, Alchemy auto-freeze watcher, reconciliation cron, PoR publisher, insurance Circle wallet, bug bounty page | 🟡 |
| 7 | Commission extraction admin screen (three-bucket ledger + 5% insurance auto-route + TOTP gate, 80% cap, 24h cooldown, 7-day whitelisted founder dest) | 🟡 |

**Wallet UI = its own navigation** ("Exit Wallet" button), single UI for everyone (no persona branching). KYC is the only gate on Withdraw. Coin packs = 8 fixed SKUs (`COIN_PACKS`) + custom amount (soft min €10, configurable `app_config/general.payramMinEUR`). Buy = in-app PayRam popup (card/crypto) with status polling. Use real `RANK_TIERS` (11 tiers), real `commissionForLevel()` (Rookie 30% → Immortal 5%).

**KYC tiers (Didit, extend `KycWizard.jsx` with flow types):**
| Level | Verification | Unlocks |
|---|---|---|
| L0 | none | buy/tip/earn/deposit. Cannot withdraw. |
| L1 | ID + selfie | convert coins→gems; crypto withdraw <€50/mo |
| L2 | + proof of address | crypto withdraw €500/day, €2,500/mo |
| L3 | + source-of-funds (first deposit >€1k) | crypto withdraw €2,500/day, €15,000/mo |

**Commission accrual:** tip 10% fee, coin→gem VP-tier commission, withdrawal 2% spread — all credit `platform_revenue` (integer micro-USDC, atomic). Three-bucket ledger: `user_balances` + `platform_revenue` + `insurance_reserve`. Daily reconciliation invariant: `circle_operating == user_balances + platform_revenue`; drift >€5 → freeze + page.

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

**Perks:** 5% tournament mod cut → Vanguard squad treasury (when `vanguardModerated:true`), auto-split monthly by `rank_weight × monthly_actions`; coin→gem conversion fee waived to 0% for active Vanguard. MRR-gated stipend ladder dormant until MRR ≥€10k. Referral VP milestones in `vanguardRanks.js`.

**Treasury cron** `distributeVanguardTreasury` (`5 0 1 * *` UTC) — settles previous month via `distributeMonth(db, monthKey)`: idempotent (`vanguard_payouts/{YYYY-MM}`), largest-remainder rounding, refunds to platform if no eligible recipients. Founder manual trigger on `/admin/vanguard`. **TODO:** extend cron to consume `assignmentWeightBonus[month]` (from tournament check-ins) in the share formula.

**Identity mask:** `src/utils/vanguard.js → applyVanguardMask(user, viewer)` (only decider) + `useMaskedUser` hook + `<VanguardBadge rank=.. />`. Masked surfaces: PublicProfile, PostCard, SquadChat, PostDetail comments, FollowList, BrowsePlayers (filtered out), SearchResults, SquadInfoRail, DM header, MatchDetails roster. **NOT yet masked (TODO):** notifications drawer sender text (server-side write-time fix), live-stream chat sender (write-time mask when real stream chat ships).

**Callables (`functions/vanguard.js`):** `inviteToVanguard`, `accept/declineVanguardInvitation`, `changeVanguardRank`, `setVanguardStatus`, `setVanguardSquadConfig`, `vanguardCallTournamentWinner`, `vanguardResolveReport`, `vanguardMute/TempBan/PermaBanUser`, generic `runVanguardAction` helper. Claim-based tournament assignments: `functions/vanguardAssignments.js` (`vanguardClaimTournament`, `vanguardCheckIn`, `detectTournamentNoShows`, `notifyUpcomingAssignments`) + `tournament_assignments/{id}`. Screens: `/vanguard/{me,schedule,queue,today,...}`. `<VanguardPresence parentPath=.. />` for stream/tournament presence banners (Overseers join silently).

**Still TODO:** notifications-drawer + live-chat write-time mask; streaming-chat sender mask (depends on live chat shipping).

---

## Admin dashboard (rebuild — `/admin/*`, AdminShell)

Replaces old card-grid. Permission model: founder (`role:'admin'`) = full; sub-admins = `admin_users/{uid}.allowedScreens[]` (founder-managed via `/admin/access`; invites in `admin_invites/`). Foundation: `functions/adminAccess.js` (`requireAdminScreen(uid, screen)`), `useAdminAccess` hook, `AdminShell.jsx` (`ADMIN_NAV`, `ADMIN_COLORS`), `_adminGuarded.jsx` (`useGuardedCall` auto-prompts TOTP on STEP_UP_REQUIRED, `KpiCard`, `Tabs`, formatters).

**Shipped screens:** Dashboard (real KPIs + Revenue/User-Growth charts from `daily_metrics/` rollup), Users (`adminUsers.js` ban/mute/role/force-logout/pw-reset; founder protected), Economy (grants, withdrawals — **no refunds concept; cancel returns held gems; sent withdrawals irreversible**, transactions, kill switches), Moderation queue + audit sub-screen (`/admin/reports`, `/admin/reports/audit`, appeals via `submitAppeal`), App Config (`/admin/config`, 9 tabs, field whitelist + history + sensitive-field step-up), Audit Log (`/admin/audit`, CSV export), Subscriptions (pass 1+2: overview/list/billing/plans/comp/settings/logs, `plans/` + `subscription_overrides/`), Tournaments (pass 1+2: overview/all/VGT/announcements/cancel-refund/disputes/overrides/settings/logs — tournament entry-fee refunds DO exist, distinct from withdrawal no-refund rule), Announcements redesign, Live Stats (`/admin/stats`: overview/system/geography wired; Pion `/healthz` + Hetzner API + `presence_snapshots/` + Firebase doc-counts + `vergr-sysinfo` agent all real).

**Remaining punchlists:** Subscriptions pass-3 (discount consumption at renewal, logs CSV); Tournaments pass-3 (`adminListTournaments` return `participantUids`, spectator broadcast, VGT health rail, bulk CSV seeding); Live Stats pass-2 (Users/Engagement/Transactions/Errors tabs, world map); Moderation pass-3 (reports-by-type donut needs reason enum, CSV, per-mod timeline, surface handbook on `/vanguard/me`, user-side appeal UI).

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

**Streaming TODOs:** clip button is fake (`makeClip` only increments a counter — wire HLS-buffer capture → R2; Free 30s/3, Lite 60s/5, Pro 90s/∞); R2 segment cleanup cron (below); canvas compositor in `BroadcasterScreen` (game-share + facecam PiP); "Browser broadcast" entry in `GoLiveSetupScreen`; cohost auto-trigger; clip-on-stream + boost-effectiveness metrics.

### Live-stream screens — rebuild punchlist (🔴 P1, audited 2026-05-22)

**New design source:** `C:\Users\damie\Downloads\New UI Screens\Streamng-Live stream Screens\` (PNG mockups): `Go Live Screen.png` + `Go live screen (2).png` (setup), `Streaming screen - broadcaster view - co hosting stream.png` (+ `- full screen mode.png`), `Streaming screen - user viewer view - co hosting stream.png` (+ `- full screen mode.png`). The new design centres on **co-hosting** (broadcaster + viewer, each normal + fullscreen). Earlier Go-Live HTML pass came from `Vergr Wallet (6).zip` (misnamed — contains Settings + Go Live; extract → `_wallet6_tmp/Go Live Screens.html`, screens 02–05 = broadcaster/viewer/broadcaster-fullscreen/viewer-fullscreen). `GoLiveSetupScreen` already got the design pass; broadcaster/viewer views did NOT.

**These front-end screens are OLD (Gcore-era, pre-Hetzner-migration, pre-composer-redesign). Not yet rebuilt.** They still import `GCORE_CONFIG`/`getPlaybackUrl` from `src/utils/streamConfig.js` (DEAD — points at `api.gcore.com`). The media *pipeline* (Hetzner nginx-rtmp + `vergr-ingest` + R2 + `cdn.vergr.app`, and `createStreamSession`/`endStreamSession`) is the live truth; the screens must be repointed to it.

**Screen inventory + required state:**
| Screen | Route | File | State | Needs |
|---|---|---|---|---|
| **Setup** | `/go-live` | `GoLiveSetupScreen` | ❌ dead end | `goLive()` only `navigate('/')` + toast. Must call `createStreamSession`, persist title/tags/visibility on the `streams` doc, then route to `/broadcast/:streamId` (solo) or `/go-live/co-stream` → co-host. |
| **Co-host setup** | `/go-live/co-stream` | `CoStreamingScreen` | ⚠️ stub (74 lines) | Only an invite-picker that bounces to `/go-live`. Must create a co-host stream + SFU `ingest_<streamId>` room and route invited publishers into the co-host broadcast screen. |
| **Solo broadcast** | `/broadcast/:streamId` | `BroadcasterScreen` | ⚠️ pipeline real, UI faked | REAL: `getUserMedia`, mic/cam toggles, `createStreamSession`, chunked ingest upload, `endStreamSession`, Gemini frame sampler. FAKE: viewer count (`getDummyViewerCount`), bitrate/dropped/mic/desktop meters (`Math.random`), activity feed (random follows/tips/subs/raids from hardcoded names), earnings counter, poll votes, chat (local + `PREVIEW_CHAT_MESSAGES`, no relay). Drop `GCORE_CONFIG.enabled` preview gate. |
| **Co-host broadcast** | — | **does not exist** | 🔴 missing | No UI joins the Pion SFU `ingest_<streamId>` room as a 2nd publisher. Infra exists (`vergr-cohost` ffmpeg `xstack` composite + SFU ingest rooms) but no front-end. Build it (publisher tiles, host controls, leave). |
| **Viewer** | `/watch/:streamId` | `ViewerStreamScreen` | ⚠️ player real, rest faked | REAL: `HlsPlayer` + p2p-media-loader. FAKE: `isPreview = !GCORE_CONFIG.enabled` keeps it in mock mode; `getPlaybackUrl` returns a Gcore URL not `cdn.vergr.app/streams/<key>/index.m3u8`; chat simulated; viewer count/list dummy; metadata hardcoded ("NovaKill"/"Valorant"). Repoint playback to CDN, subscribe to the real `streams/{id}` doc, add real chat + presence. |
| **Old viewer mockup** | `/stream/:streamId` | `LiveStreamScreen` | ❌ static mockup | Fully hardcoded (no player, "2.4K", "Streamer / Elden Ring", local chat, ignores `streamId`). Retire the route or redirect to `/watch/:streamId` (don't delete without confirming nothing links to it). |
| Misc | — | `StreamEndingScreen`, `StreamAnalyticsScreen`, `StreamModerationScreen`, `SquadStreamScreen` | — | Review separately; not part of this audit. |

**Chat architecture (LOCKED decision — do NOT use Firestore):** live-stream chat must ride the **streaming server**, not Firestore. Build a WebSocket relay co-located with the stream box (extend `vergr-sfu` or add a `vergr-chat` service on Hetzner): broadcaster + viewers connect over WS, messages fan out in real time, **Gemini moderation runs at the relay (server-side) before fan-out**, identity-mask applied at write-time (covers the Vanguard live-chat mask TODO). Firestore is wrong here (per-message read/write cost + latency). Persist only what's needed (e.g., pinned/mod actions), not the firehose.

**streamConfig.js must be repointed:** retire `GCORE_CONFIG`; `getPlaybackUrl(streamId)` → `https://cdn.vergr.app/streams/<streamKey>/index.m3u8`; ingest base comes from `createStreamSession` (browser fMP4 via `vergr-ingest`, or RTMP key for OBS).

### TODO: R2 segment cleanup cron
`cleanupExpiredStreamSegments` hourly in `functions/streaming.js`: `ListObjectsV2` on `vergr-media/streams/`, per stream-key match `streams` doc; if `status:'ended'` AND `endedAt < now-24h` → `DeleteObjects` (batch 1000); orphans (no doc) delete after 6h. Log to `streaming_cleanup_logs/`. Path is per-key (`hls_nested on`). nginx `hls_cleanup` only clears local disk, not R2.

---

## Media storage on Cloudflare R2 (LIVE)

All user media → R2, served `https://cdn.vergr.app` ($0 egress). KYC docs stay on Firebase Storage (need Auth scoping). `functions/r2.js → getR2UploadUrl` (presigned PUT, plan size caps, content-type allowlist) + `src/utils/r2Storage.js → uploadToR2(file, kind)`. `uploadPostMedia(postId, file)` ignores postId, just returns the R2 URL. Video format = **WebM/VP9** (~50% smaller than MP4 — don't switch). Plan caps: Free 200MB / Lite 1GB / Pro 5GB. Clip duration: Free 5min / Lite 15min / Pro 60min. Lifecycle rule auto-tiers to IA after 90 days; `coldStorageDemotion` cron dormant until 5,000 posts. Kill switch `freeUploadsPaused`. `<ImageProtection />` in AppRouter blocks right-click/drag on all `<img>`.
- ⚠️ **If R2 uploads fail:** `/admin` has "Apply CORS / Diagnose" (`setR2CorsPolicy` callable) printing bucket/endpoint/CORS/presigned-URL state. Past root cause: every R2 secret had a trailing `\n` (set via `echo` not `printf`) → bucket name `vergr-media\n` → CORS never matched. Fix in `r2.js` trims every secret on read (`env()`); **don't remove the trim**. AWS SDK v3 auto-injects `x-amz-sdk-checksum-algorithm` which R2 CORS doesn't match → client uses `requestChecksumCalculation:'WHEN_REQUIRED'`. CORS managed via Cloudflare dashboard (token is Object R/W, can't PutBucketCors). Allowed origins include vergr.app + web.app + firebaseapp.com + localhost. `ALLOWED_KINDS`: avatar/banner/post/short/clip/article/squad/tournament.

---

## Subscriptions + tiers (`src/utils/tierSystem.js`)

- **Free** €0: core social + tournaments, free squad streaming, public stream after 100 followers + 50-coin boost, 480p30 stream, 200MB uploads.
- **Lite** €4.99/mo: no ads, day-1 public streaming 720p60, 1.5× VP, 1GB uploads, voice messages, post boosts, scheduled posts, custom banner, squads/tournaments ≤32 players.
- **Pro** €9.99/mo: 1080p60 + co-streaming, 2× VP, tournaments ≤256 + all bracket formats, Vergr.me custom domain, advanced analytics, IP-masked private streaming (Cloudflare TURN), animated avatar, 5GB uploads, priority support.
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
- **Mobile + desktop apps stale** — Tauri `src-tauri/tauri.conf.json` bundles `dist/` at build time, version stuck `1.0.0`, no updater. Fix: bump version + rebuild + redistribute now; proper fix = wire Tauri Updater plugin (key pair, `plugins.updater` endpoint, signed manifest on R2). PWA: bump SW version (`vergr-vN`) + add `controllerchange`→reload toast + `clients.claim()`.

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
