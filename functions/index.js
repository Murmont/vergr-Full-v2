const { getFirestore } = require('firebase-admin/firestore');
const functions = require('firebase-functions/v2');
const functionsV1 = require('firebase-functions/v1');
const axios = require('axios');
const cheerio = require('cheerio');
const admin = require('firebase-admin');

if (admin.apps.length === 0) admin.initializeApp();
functions.setGlobalOptions({ region: 'europe-west1' });
const db = getFirestore('vgrdb');

// Huawei Push Kit (HMS) — the push channel for Huawei devices, which have no
// Google Play Services (so no FCM). sendHuaweiPush is a no-op until the two
// secrets below hold real AppGallery-Connect values, so declaring them on the
// push triggers below is safe. Any trigger that should reach Huawei users must
// list these two secrets so v2 injects them into process.env.
const { sendHuaweiPush } = require('./huaweiPush');
const HUAWEI_PUSH_APP_ID = functions.params.defineSecret('HUAWEI_PUSH_APP_ID');
const HUAWEI_PUSH_CLIENT_SECRET = functions.params.defineSecret('HUAWEI_PUSH_CLIENT_SECRET');
const HUAWEI_PUSH_SECRETS = [HUAWEI_PUSH_APP_ID, HUAWEI_PUSH_CLIENT_SECRET];

// Cron consolidation shim: turns a former scheduled-function definition into a
// plain async handler (drops the schedule, keeps the body). The handlers are
// invoked by the consolidated dispatchers (cronDaily / cronEvery6h /
// cronMonthly) at the bottom of this file, so 12 separate Cloud Scheduler jobs
// collapse into 3 without changing any handler logic. The 2nd arg is always the
// handler, whether the original passed a cron string or an options object.
const defer = (_opts, fn) => fn;

// Public-UGC server renderer — bot-readable HTML + JSON-LD for
// /post /clip /user /u /watch + /sitemap-ugc.xml (SEO viral engine).
const ugcRenderer = require('./ugcRenderer');
exports.ugcRenderer = ugcRenderer.ugcRenderer;

// HTTP 410 for the help articles removed in the revenue-share migration.
// Hosting rewrites the removed slugs here, ahead of the SPA catch-all, because
// `redirects` can only emit 3xx and the catch-all would otherwise answer 200
// with the app shell (a soft 404). See functions/gone.js for the full reasoning.
const gone = require('./gone');
exports.goneHelp = gone.goneHelp;

// Scheduled-post publisher (releases scheduled posts/polls + honours options).
const scheduledPosts = require('./scheduledPosts');
// publishScheduledPosts — folded into cron5Min dispatcher (see EOF).

// KYC module — exports its own callables and a purge helper.
const kyc = require('./kyc');
exports.reviewKyc = kyc.reviewKyc;
exports.decideKyc = kyc.decideKyc;
// scheduledKycRetention — folded into cronDaily dispatcher (see EOF).

// Geo-blocking — country + US-state blocklist for compliance with
// skill-gaming-for-cash regulations. See functions/geo.js.
const geo = require('./geo');
exports.getRegionStatus = geo.getRegionStatus;
exports.checkRegion     = geo.checkRegion;

// Didit.me KYC — government-ID age + identity verification (free tier).
// Webhook writes verified result onto `users/{uid}.kyc`. Replaces Persona.
// See functions/didit.js.
const didit = require('./didit');
exports.startKycVerification = didit.startKycVerification;
exports.diditWebhook         = didit.diditWebhook;

// Marketing forms — Contact, Careers, Partner application. See
// functions/marketingForms.js. Submissions land in Firestore inboxes.
const marketingForms = require('./marketingForms');
exports.submitContactForm = marketingForms.submitContactForm;

// DM/group/squad push fan-out — called by the vergr-chat relay on every
// broadcast. The relay forwards DM ciphertext + sender/membership context;
// this function looks up offline recipients' FCM tokens and pushes data-only
// notifications. Service worker decrypts (DMs) and renders the notification.
// See functions/dmNotify.js + public/firebase-messaging-sw.js.
const dmNotify = require('./dmNotify');
exports.notifyDmDelivery = dmNotify.notifyDmDelivery;

// Economy, shared rate-limit helpers.
//
// REMOVED 2026-08-16, with the gem unit itself:
//   convertCoinsToGems  a user-invoked conversion into a second currency.
//                       Revenue share now accrues automatically at receipt, in
//                       micro-USD, and is never something a user converts into.
//   sendGems /          person-to-person transfer of cashable value. Locked
//   quoteGemSend        decision 4, founder: "its a red flag."
// Their callables are undeployed rather than left throwing: a deployed endpoint
// that only errors is still an endpoint an auditor has to be told about.
const economy = require('./economy');

// ── Creator payouts (revenue share) — docs/REVENUE_SHARE_PLAN.md ──
// Scheduled supplier settlement. NOT yet the live payout path: it needs a
// payout partner wired into disbursePayout() before it can move money, and
// functions/withdrawals.js is still the active rail. Two systems must never be
// able to move the same gems at once, so the cutover is deliberate and separate.
exports.runCreatorPayouts = require('./creatorPayouts').runCreatorPayouts;

// Creator Program: anyone can use Vergr, only a creator can monetize.
// Wallet-moving actions ported off the client so `wallets.balance` and
// `wallets.vp` could be locked in firestore.rules. See functions/walletActions.js.
const walletActions = require('./walletActions');
exports.awardActionVp = walletActions.awardActionVp;
exports.recordAdWatch = walletActions.recordAdWatch;
exports.contributeToSquad = walletActions.contributeToSquad;
exports.purchaseBoost = walletActions.purchaseBoost;

// Creator quests, server-authoritative claims. The old client-side claim both
// trusted a client-supplied VP amount AND always failed on rules.
const creatorQuests = require('./creatorQuests');
exports.claimCreatorQuest = creatorQuests.claimCreatorQuest;
exports.getCreatorQuests = creatorQuests.getCreatorQuests;

const creatorProgram = require('./creatorProgram');
exports.getCreatorEligibility = creatorProgram.getCreatorEligibility;
exports.applyForCreator = creatorProgram.applyForCreator;
exports.adminListCreatorApplications = creatorProgram.adminListCreatorApplications;
exports.adminDecideCreatorApplication = creatorProgram.adminDecideCreatorApplication;
exports.previewCreatorPayoutRun = require('./creatorPayouts').previewCreatorPayoutRun;
exports.adminRecordPayoutStrike = require('./creatorPayouts').adminRecordPayoutStrike;
exports.adminReversePayoutStrike = require('./creatorPayouts').adminReversePayoutStrike;
exports.getPayoutAccount = require('./creatorPayouts').getPayoutAccount;
exports.enrollForPayouts = require('./creatorPayouts').enrollForPayouts;
exports.adminSetPayoutAccountState = require('./creatorPayouts').adminSetPayoutAccountState;

// Solvency: are creator liabilities covered by what we hold. Alarms on shortfall
// AND on "cannot tell", because an unverifiable solvency figure is not solvency.
exports.reconcileSolvency = require('./solvencyLedger').reconcileSolvency;
exports.getSolvencyLedger = require('./solvencyLedger').getSolvencyLedger;

// buyCoinsWithGems REMOVED 2026-08-16. It turned accrued revenue share back
// into spending credit, which is precisely what made the payable look like a
// balance the creator holds. A creator who wants to spend buys coins like
// anyone else.

// Stripe was the second card rail from 2026-08-11. Stripe closed the account,
// so on 2026-08-13 the rail was removed outright rather than left dormant:
// `createStripeCheckout`, `stripeWebhook` and the legacy unsigned
// `handleStripeWebhook` are gone, along with the SDK and the secrets. PayRam is
// the card rail again (functions/payram.js), Play Billing is the other.
// Do NOT re-add a processor without wiring its webhook signature check first.

// Admin security — TOTP step-up, audit log, rate-limit, alert pipeline.
// Every privileged callable wraps through these helpers.
// See CLAUDE.md "🚨 Security hardening" for full spec.
const adminSecurity = require('./adminSecurity');
exports.enrollAdminTotp              = adminSecurity.enrollAdminTotp;
exports.confirmAdminTotpEnrollment   = adminSecurity.confirmAdminTotpEnrollment;
exports.verifyAdminTotp              = adminSecurity.verifyAdminTotp;
exports.disableAdminTotp             = adminSecurity.disableAdminTotp;
exports.getMyAdminSecurityStatus     = adminSecurity.getMyAdminSecurityStatus;
// cleanupExpiredTotpEnrollments — folded into cronDaily dispatcher (see EOF).

// Account security — TOTP step-up 2FA for ANY user (Settings → Security).
// Zero-cost: real authenticator second factor that gates sensitive account
// actions (not Firebase login itself, which needs paid Identity Platform).
const accountSecurity = require('./accountSecurity');
exports.enrollAccountTotp            = accountSecurity.enrollAccountTotp;
exports.confirmAccountTotpEnrollment = accountSecurity.confirmAccountTotpEnrollment;
exports.verifyAccountTotp            = accountSecurity.verifyAccountTotp;
exports.disableAccountTotp           = accountSecurity.disableAccountTotp;
exports.getMyAccountSecurityStatus   = accountSecurity.getMyAccountSecurityStatus;

// Admin access — founder-invited sub-admins with per-screen scopes.
// See functions/adminAccess.js.
const adminAccess = require('./adminAccess');
exports.inviteAdmin         = adminAccess.inviteAdmin;
exports.revokeAdminInvite   = adminAccess.revokeAdminInvite;
exports.acceptAdminInvite   = adminAccess.acceptAdminInvite;
exports.setAdminScreens     = adminAccess.setAdminScreens;
exports.revokeAdminAccess   = adminAccess.revokeAdminAccess;
exports.listAdmins          = adminAccess.listAdmins;
exports.getMyAdminAccess    = adminAccess.getMyAdminAccess;

// Admin → Users screen. See functions/adminUsers.js.
const adminUsers = require('./adminUsers');
exports.adminListUsers         = adminUsers.adminListUsers;
exports.adminGetUserDetail     = adminUsers.adminGetUserDetail;
exports.adminGetUserStats      = adminUsers.adminGetUserStats;
exports.adminBanUser           = adminUsers.adminBanUser;
exports.adminUnbanUser         = adminUsers.adminUnbanUser;
exports.adminMuteUser          = adminUsers.adminMuteUser;
exports.adminUnmuteUser        = adminUsers.adminUnmuteUser;
exports.adminSetUserRole       = adminUsers.adminSetUserRole;
exports.adminForceLogoutUser   = adminUsers.adminForceLogoutUser;
exports.adminSendPasswordReset = adminUsers.adminSendPasswordReset;
// Manual guest cleanup, replacing a daily cron sweep that would have cost reads
// forever to do a job the founder can do in one click when he sees one.
exports.adminDeleteGuestAccount = adminUsers.adminDeleteGuestAccount;
exports.adminResetBoostStats   = adminUsers.adminResetBoostStats;

// Official announcement channels. Vergr's own accounts appear in the user's
// message list as chats. ONE shared doc + ONE shared messages subcollection per
// channel, so a send is two writes at any audience size, and push rides a
// per-channel FCM topic so a mute is honoured at the transport layer.
// See docs/ANNOUNCEMENTS_PLAN.md section 2.
const officialChannels = require('./officialChannels');
exports.adminUpsertChannel          = officialChannels.adminUpsertChannel;
exports.adminListChannels           = officialChannels.adminListChannels;
exports.adminSetChannelActive       = officialChannels.adminSetChannelActive;
exports.adminAddChannelMembers      = officialChannels.adminAddChannelMembers;
exports.adminRemoveChannelMember    = officialChannels.adminRemoveChannelMember;
exports.adminListChannelMembers     = officialChannels.adminListChannelMembers;
exports.resolveMyChannels           = officialChannels.resolveMyChannels;
exports.adminSendChannelMessage     = officialChannels.adminSendChannelMessage;
exports.adminListChannelMessages    = officialChannels.adminListChannelMessages;
exports.adminDeleteChannelMessage   = officialChannels.adminDeleteChannelMessage;
exports.setChannelPushSubscription  = officialChannels.setChannelPushSubscription;
exports.onChannelMessageCreated     = officialChannels.onChannelMessageCreated;
exports.adminEnsureCommunityRoom    = officialChannels.adminEnsureCommunityRoom;

// Editable transactional email templates (D3). A bad edit can never break a
// transactional email: rendering falls back to the shipped default in code.
const emailTemplates = require('./emailTemplates');
exports.adminListEmailTemplates     = emailTemplates.adminListEmailTemplates;
exports.adminSaveEmailTemplate      = emailTemplates.adminSaveEmailTemplate;
exports.adminResetEmailTemplate     = emailTemplates.adminResetEmailTemplate;
exports.adminPreviewEmailTemplate   = emailTemplates.adminPreviewEmailTemplate;
// Coin sale promos (D2). Changes the quantity delivered, never the price
// charged, which is why it is safe next to a live payment rail.
const coinPromos = require('./coinPromos');
exports.adminUpsertCoinPromo        = coinPromos.adminUpsertCoinPromo;
exports.adminListCoinPromos         = coinPromos.adminListCoinPromos;
exports.adminSetCoinPromoActive     = coinPromos.adminSetCoinPromoActive;
exports.getActiveCoinPromo          = coinPromos.getActiveCoinPromo;

// Campaigns: one doc per announcement, every surface derived from it.
// See functions/campaigns.js for why the callable never sends.
const campaigns = require('./campaigns');
exports.adminUpsertCampaign         = campaigns.adminUpsertCampaign;
exports.adminListCampaigns          = campaigns.adminListCampaigns;
exports.adminSendCampaign           = campaigns.adminSendCampaign;
exports.adminRecallCampaign         = campaigns.adminRecallCampaign;
exports.onCampaignSending           = campaigns.onCampaignSending;
exports.recordCampaignEvent         = campaigns.recordCampaignEvent;
exports.getWhatsNew                 = campaigns.getWhatsNew;
exports.adminUpdateWhatsNew         = campaigns.adminUpdateWhatsNew;

// Support channels: one two-way thread per user + the agent queue.
// See functions/supportChannel.js for why a thread is a group conversation.
const supportChannel = require('./supportChannel');
exports.openSupportThread           = supportChannel.openSupportThread;
exports.adminListSupportThreads     = supportChannel.adminListSupportThreads;
exports.adminSetSupportThreadState  = supportChannel.adminSetSupportThreadState;
exports.syncSupportAgents           = supportChannel.syncSupportAgents;

// Admin → Economy screen. See functions/adminEconomy.js.
const adminEconomy = require('./adminEconomy');
exports.adminGetEconomyStats     = adminEconomy.adminGetEconomyStats;
exports.adminGetNavBadges        = adminEconomy.adminGetNavBadges;
exports.adminListTopWallets      = adminEconomy.adminListTopWallets;
exports.adminListTransactions    = adminEconomy.adminListTransactions;
exports.adminListPayoutRequests  = adminEconomy.adminListPayoutRequests;
// The live outbound path: creator payout runs + per-creator statements.
exports.adminGetPayoutOverview   = adminEconomy.adminGetPayoutOverview;
exports.adminListPayoutStatements = adminEconomy.adminListPayoutStatements;
exports.adminGrantCoins          = adminEconomy.adminGrantCoins;
exports.adminGrantVp             = adminEconomy.adminGrantVp;
// Was adminGrantGems. Renamed with the unit; the old name is undeployed.
exports.adminGrantOwed           = adminEconomy.adminGrantOwed;
exports.adminDeductCoins         = adminEconomy.adminDeductCoins;
exports.adminUpdatePayoutStatus  = adminEconomy.adminUpdatePayoutStatus;
exports.adminGetEconomyConfig    = adminEconomy.adminGetEconomyConfig;
exports.adminSetEconomyConfig    = adminEconomy.adminSetEconomyConfig;

// Admin → Moderation Queue. See functions/adminModeration.js.
const adminModeration = require('./adminModeration');
exports.adminGetModerationStats  = adminModeration.adminGetModerationStats;
exports.adminListReports         = adminModeration.adminListReports;
exports.adminGetReportDetail     = adminModeration.adminGetReportDetail;
exports.adminResolveReport       = adminModeration.adminResolveReport;
exports.adminBulkResolveReports  = adminModeration.adminBulkResolveReports;
// Audit sub-screen (/admin/reports/audit).
exports.adminListResolvedReports          = adminModeration.adminListResolvedReports;
exports.adminGetModeratorStats            = adminModeration.adminGetModeratorStats;
exports.adminListAppeals                  = adminModeration.adminListAppeals;
exports.adminGetAppealDetail              = adminModeration.adminGetAppealDetail;
exports.adminResolveAppeal                = adminModeration.adminResolveAppeal;
exports.submitAppeal                      = adminModeration.submitAppeal;
exports.adminGetModerationPolicySettings  = adminModeration.adminGetModerationPolicySettings;
exports.adminSetModerationPolicySettings  = adminModeration.adminSetModerationPolicySettings;

// Admin → App Config screen. See functions/adminConfig.js.
const adminConfig = require('./adminConfig');
exports.adminGetConfig          = adminConfig.adminGetConfig;
exports.adminSetConfigField     = adminConfig.adminSetConfigField;
exports.adminBulkSetConfig      = adminConfig.adminBulkSetConfig;
exports.adminListConfigHistory  = adminConfig.adminListConfigHistory;
exports.adminGetSystemHealth    = adminConfig.adminGetSystemHealth;

// Admin → Live Stats screen. See functions/adminStats.js.
const adminStats = require('./adminStats');
exports.adminGetLiveStatsOverview = adminStats.adminGetLiveStatsOverview;
exports.adminGetSystemMetrics     = adminStats.adminGetSystemMetrics;
exports.adminGetGeographyStats    = adminStats.adminGetGeographyStats;
exports.adminGetLiveActivityFeed  = adminStats.adminGetLiveActivityFeed;
exports.adminGetEventLoad         = adminStats.adminGetEventLoad;
exports.adminGetCostSnapshot      = adminStats.adminGetCostSnapshot;
exports.adminGetUsersLive         = adminStats.adminGetUsersLive;
exports.adminGetEngagementStats   = adminStats.adminGetEngagementStats;
exports.adminGetErrorLog          = adminStats.adminGetErrorLog;
// writePresenceSnapshot — folded into cronEvery6h dispatcher (see EOF).

// Admin → Dashboard landing page. See functions/adminDashboard.js.
const adminDashboard = require('./adminDashboard');
exports.adminGetDashboardSummary = adminDashboard.adminGetDashboardSummary;

// Dashboard charts — daily rollup cron + chart-data callable. See functions/dailyMetricsRollup.js
const dailyMetricsRollup = require('./dailyMetricsRollup');
// rollupDailyMetrics — folded into cronDaily dispatcher (see EOF).
exports.adminGetDashboardCharts   = dailyMetricsRollup.adminGetDashboardCharts;
exports.adminBackfillDailyMetrics = dailyMetricsRollup.adminBackfillDailyMetrics;

// Admin → Tournaments screen REMOVED 2026-08-17 (founder). All 18 of its
// callables are undeployed; functions/adminTournaments.js stays on disk unused.
// Pass 2 — VGT / Announcements / Overrides / Settings / Logs.

// Admin → Subscriptions screen. See functions/adminSubscriptions.js.
const adminSubscriptions = require('./adminSubscriptions');
exports.adminGetSubscriptionStats         = adminSubscriptions.adminGetSubscriptionStats;
exports.adminGetSubscriptionTrend         = adminSubscriptions.adminGetSubscriptionTrend;
exports.adminGetRecentSubscriptionEvents  = adminSubscriptions.adminGetRecentSubscriptionEvents;
exports.adminGetUpcomingRenewals          = adminSubscriptions.adminGetUpcomingRenewals;
exports.adminListSubscriptions            = adminSubscriptions.adminListSubscriptions;
exports.adminGetBillingStats              = adminSubscriptions.adminGetBillingStats;
exports.adminListInvoices                 = adminSubscriptions.adminListInvoices;
// Pass 2 — Plans & Pricing, Comp & Overrides, Settings, Logs, Bulk actions.
exports.adminListPlans                       = adminSubscriptions.adminListPlans;
exports.adminUpsertPlan                      = adminSubscriptions.adminUpsertPlan;
exports.adminDeletePlan                      = adminSubscriptions.adminDeletePlan;
exports.adminSchedulePriceChange             = adminSubscriptions.adminSchedulePriceChange;
exports.adminCancelScheduledPriceChange      = adminSubscriptions.adminCancelScheduledPriceChange;
// applyScheduledPriceChanges — folded into cronDaily dispatcher (see EOF).
exports.adminListOverrides                   = adminSubscriptions.adminListOverrides;
exports.adminCompUser                        = adminSubscriptions.adminCompUser;
exports.adminApplyOverride                   = adminSubscriptions.adminApplyOverride;
exports.adminRevokeOverride                  = adminSubscriptions.adminRevokeOverride;
exports.adminGetSubscriptionSettings         = adminSubscriptions.adminGetSubscriptionSettings;
exports.adminSetSubscriptionSettings         = adminSubscriptions.adminSetSubscriptionSettings;
exports.adminListSubscriptionLogs            = adminSubscriptions.adminListSubscriptionLogs;
exports.adminBulkCancelSubscriptions         = adminSubscriptions.adminBulkCancelSubscriptions;
exports.adminBulkCompSubscriptions           = adminSubscriptions.adminBulkCompSubscriptions;

// Admin → Audit Log screen. See functions/adminAudit.js.
const adminAudit = require('./adminAudit');
exports.adminListAuditActions = adminAudit.adminListAuditActions;
exports.adminGetAuditDetail   = adminAudit.adminGetAuditDetail;
exports.adminGetAuditFacets   = adminAudit.adminGetAuditFacets;
exports.adminExportAuditCsv   = adminAudit.adminExportAuditCsv;

const adminAlerts = require('./adminAlerts');
exports.onAdminActionCreated        = adminAlerts.onAdminActionCreated;
// adminTotpBruteForceMonitor — folded into cron15Min dispatcher (see EOF).

// R2 media storage — presigned upload URLs + engagement-driven cold-tiering.
const r2 = require('./r2');
exports.getR2UploadUrl      = r2.getR2UploadUrl;
exports.getImportUploadUrl  = r2.getImportUploadUrl;
exports.coldStorageDemotion = r2.coldStorageDemotion;
exports.setR2CorsPolicy     = r2.setR2CorsPolicy;

// Per-view tracker that powers the cold-tiering decision.
const coldStorage = require('./coldStorage');
exports.markMediaViewed = coldStorage.markMediaViewed;

// User wallet — PIN + TOTP + whitelist + security status (Phase 0-2 of the
// self-custody USDC plan). Circle Wallets integration + deposit detection +
// withdrawal pipeline land in Phase 3-4 (separate session).
const wallet = require('./wallet');
exports.setupWalletPin               = wallet.setupWalletPin;
exports.verifyWalletPin              = wallet.verifyWalletPin;
exports.changeWalletPin              = wallet.changeWalletPin;
exports.enrollWalletTotp             = wallet.enrollWalletTotp;
exports.confirmWalletTotpEnrollment  = wallet.confirmWalletTotpEnrollment;
exports.verifyWalletTotp             = wallet.verifyWalletTotp;
exports.useTotpRecoveryCode          = wallet.useTotpRecoveryCode;
exports.disableWalletTotp            = wallet.disableWalletTotp;
exports.addWhitelistedAddress        = wallet.addWhitelistedAddress;
exports.removeWhitelistedAddress     = wallet.removeWhitelistedAddress;
exports.getMyWalletSecurityStatus    = wallet.getMyWalletSecurityStatus;
exports.adminMintWalletUnlockToken   = wallet.adminMintWalletUnlockToken;

// functions/withdrawals.js DELETED 2026-08-16 with the gem unit.
//
// It was the user-initiated withdrawal pipeline: a customer naming an amount
// and a destination and pulling value out of a balance we held. That shape is
// the money-transmission fact pattern the revenue-share model exists to avoid,
// `requestWithdrawal` had already been disabled, and the whole module was
// denominated in gems. The only outbound path is now creatorPayouts.js, which
// pays suppliers on Vergr's schedule.
//
// `adminGetNavBadges` lived in that file for no reason other than history and
// AdminShell calls it on load, so it moved to adminEconomy.js.

// Circle Wallets — Phase 3 deposit detection. circleWalletsWebhook (HTTPS,
// HMAC-verified) handles Circle Notifications; pollCircleDeposits (every 5min)
// is the belt-and-suspenders polling fallback. Both share processInboundDeposit
// with idempotency via circle_deposits/{txId}. See functions/circleWallets.js
// for the locked attribution flow (PayRam refId match → coin credit; else
// unattributed_deposits/ for manual review).
const circleWallets = require('./circleWallets');
exports.circleWalletsWebhook = circleWallets.circleWalletsWebhook;

// Map thumbnail proxy (Google Static Maps, dark-styled) — see functions/mapThumbnail.js.
const mapThumbnail = require('./mapThumbnail');
exports.mapThumb = mapThumbnail.mapThumb;
exports.pollCircleDeposits   = circleWallets.pollCircleDeposits;

// AdMob Rewarded watch-to-earn — server-side-verified coin crediting.
const admobReward = require('./admobReward');
exports.admobSsvCallback = admobReward.admobSsvCallback;

// Squad challenges — auto-distribute VP/coin rewards on completion.
// Also handles squad invitation notifications.
const squadChallenges = require('./squadChallenges');
exports.onSquadChallengeCompleted = squadChallenges.onSquadChallengeCompleted;
exports.onSquadInvitationCreated = squadChallenges.onSquadInvitationCreated;

// Vanguard moderator program — founder + Commander/Overseer callables for
// invitations, rank changes, and status flips. Treasury distribution +
// stream join announcements land in later build steps.
const vanguard = require('./vanguard');
exports.inviteToVanguard           = vanguard.inviteToVanguard;
exports.acceptVanguardInvitation   = vanguard.acceptVanguardInvitation;
exports.declineVanguardInvitation  = vanguard.declineVanguardInvitation;
exports.changeVanguardRank         = vanguard.changeVanguardRank;
exports.setVanguardStatus          = vanguard.setVanguardStatus;
exports.setVanguardSquadConfig     = vanguard.setVanguardSquadConfig;
// distributeVanguardTreasury — folded into cronMonthly dispatcher (see EOF).
exports.adminTriggerVanguardDistribution = vanguard.adminTriggerVanguardDistribution;
exports.vanguardCallTournamentWinner     = vanguard.vanguardCallTournamentWinner;
exports.vanguardResolveReport            = vanguard.vanguardResolveReport;
exports.vanguardReviewAiFlag             = vanguard.vanguardReviewAiFlag;
exports.vanguardMuteUser                 = vanguard.vanguardMuteUser;
exports.vanguardTempBanUser              = vanguard.vanguardTempBanUser;
exports.vanguardPermaBanUser             = vanguard.vanguardPermaBanUser;
exports.vanguardResolveQueueItem         = vanguard.vanguardResolveQueueItem;

// Pay-per-minute stream quality boost (1 coin/min for 720p, 2 coin/min for 1080p).
// ⚠ TWO DIFFERENT BOOSTS, DO NOT CONFUSE THEM. 'streamingBoost' is the
// pay-per-minute VIDEO QUALITY boost (720p/1080p). 'streamBoost' is the
// DISCOVERY boost that pushes a stream to more viewers.
const streamBoost = require('./streamBoost');
exports.purchaseVpBonus = require('./vpBonuses').purchaseVpBonus;
// Boosts are TOKENS you own: buy adds to wallets/{uid}.boosts, apply spends one
// onto any target. See functions/boosts.js.
const boostPacks = require('./boosts');
exports.purchaseBoostPack = boostPacks.purchaseBoostPack;
exports.applyBoost = boostPacks.applyBoost;
exports.recordBoostImpressions = boostPacks.recordBoostImpressions;
exports.recordPostViews = require('./postViews').recordPostViews;
exports.boostStream = streamBoost.boostStream;
const streamingBoost = require('./streamingBoost');
exports.requestStreamQualityBoost = streamingBoost.requestStreamQualityBoost;
exports.cancelStreamQualityBoost  = streamingBoost.cancelStreamQualityBoost;
// chargeStreamBoosts — folded into cronMinute dispatcher (see EOF).

// Co-stream invitations (host invites publishers; SFU room is `ingest_<streamId>`).
const coStream = require('./coStream');
exports.inviteToCoStream     = coStream.inviteToCoStream;
exports.acceptCoHostInvite   = coStream.acceptCoHostInvite;
exports.declineCoHostInvite  = coStream.declineCoHostInvite;
exports.cancelCoHostInvite   = coStream.cancelCoHostInvite;
exports.removeCoHost         = coStream.removeCoHost;

// Tip catalog (host-configured tier messages; Gemini-moderated on save).
const tipCatalog = require('./tipCatalog');
exports.setTipCatalog   = tipCatalog.setTipCatalog;
exports.clearTipCatalog = tipCatalog.clearTipCatalog;

// Phase 8: cohost auto-trigger + R2 segment cleanup cron.
const streamingCleanup = require('./streamingCleanup');
exports.triggerCohostComposite      = streamingCleanup.triggerCohostComposite;
exports.cleanupExpiredStreamSegments = streamingCleanup.cleanupExpiredStreamSegments;
exports.cleanupExpiredProofChunks    = streamingCleanup.cleanupExpiredProofChunks;

// Per-stream chat moderation (host: mute/ban/banned-words).
const streamChatMod = require('./streamChatMod');
exports.muteViewer            = streamChatMod.muteViewer;
exports.unmuteViewer          = streamChatMod.unmuteViewer;
exports.banViewer             = streamChatMod.banViewer;
exports.unbanViewer           = streamChatMod.unbanViewer;
exports.setStreamBannedWords  = streamChatMod.setStreamBannedWords;
exports.setStreamSlowMode     = streamChatMod.setStreamSlowMode;
exports.setStreamFollowersOnly = streamChatMod.setStreamFollowersOnly;
exports.setStreamTts = streamChatMod.setStreamTts;   // effect 13, host-only
exports.pinStreamMessage      = streamChatMod.pinStreamMessage;
exports.setStreamModerator    = streamChatMod.setStreamModerator;

// Username index — maintains usernameLower + usernames/{lower} so username
// search and vergr.me (/u/:username) actually resolve. Trigger keeps it in
// sync; backfillUsernameIndex (token-gated HTTP) seeds existing users.
const usernameIndex = require('./usernameIndex');
exports.maintainUsernameIndex = usernameIndex.maintainUsernameIndex;
exports.backfillUsernameIndex = usernameIndex.backfillUsernameIndex;

// Music: Last.fm "now playing" + Pretzel Rocks recommendation are the
// agreed approach (see project_music_integration memory). Implementation
// deferred to its own task; NowPlayingCard.jsx is already in place and
// data-agnostic.

// Tournament participant Summons, REMOVED 2026-08-17 with the tournament
// backend (callables + the every-minute crons).
// summonsParticipants — folded into cronMinute dispatcher (see EOF).
// detectParticipantNoShows — folded into cron5Min dispatcher (see EOF).

// Lobby-screenshot verification, REMOVED 2026-08-17 with the tournament backend.
// detectLobbyVerificationTimeouts — folded into cron5Min dispatcher (see EOF).

// Same-lobby verification, the player-facing half (self-attest, OCR receiver,
// reschedule, dispute evidence, follow-match, thank-mod) was REMOVED 2026-08-17.
// modVerifyMatchPlayer + vanguardHeartbeat are KEPT: /vanguard/wall and
// /vanguard/moderation-room are still routed and call them.

const matchVerification = require('./matchVerification');
exports.modVerifyMatchPlayer        = matchVerification.modVerifyMatchPlayer;
exports.vanguardHeartbeat           = matchVerification.vanguardHeartbeat;

// AC7 cheat-signature staleness cron REMOVED 2026-08-17, it pushed admins at
// /admin/cheat-signatures, which no longer exists.
// cheatSignaturesHealthCron — folded into cronMonthly dispatcher (see EOF).

// Trust / rivalry / sportsmanship / AI match summarizer, REMOVED 2026-08-17.

// Tournament esports batch 2 (squad-funded pools, sponsors, tip-underdog,
// replay-on-demand), REMOVED 2026-08-17.

// GR5 Brawl quickplay, REMOVED 2026-08-17 (it synthesised a 2-player tournament).


// Tournament discovery + VOD AI, REMOVED 2026-08-17.
// startingSoonPushCron — folded into cronMinute dispatcher (see EOF).

// Anti-cheat scan ingest + signature CRUD, REMOVED 2026-08-17. It existed only
// to police tournament matches.


// VOD archive transcode pipeline (Hetzner ffmpeg job → R2 → match.archiveVodUrl).
const vodArchive = require('./vodArchive');
exports.dispatchStreamVodArchive     = vodArchive.dispatchStreamVodArchive;
exports.markVodArchived              = vodArchive.markVodArchived;

// HLS rendition ladder for shorts/clips — lets the viewer's connection pick the
// quality instead of everyone getting the uploader's single bitrate.
const videoLadder = require('./videoLadder');
exports.dispatchVideoLadder = videoLadder.dispatchVideoLadder;
exports.markLadderReady     = videoLadder.markLadderReady;

// Engine-independent server-side stream clipping (works on Apple webviews).
exports.requestStreamClip            = require('./streamClips').requestStreamClip;
// On-demand translation via self-hosted LibreTranslate (box 2).
exports.translateContent             = require('./translate').translateContent;

// Two-camera proof feed for high-stakes tournament matches, REMOVED 2026-08-17.

// Viewer-reactions-per-5s aggregator that drives HypeMeter on broadcaster HUD.
const streamHype = require('./streamHype');
exports.recordStreamReaction         = streamHype.recordStreamReaction;

// Short-lived HMAC creds for self-hosted coturn (Hetzner). Fetched by the
// WebRTC client before opening any P2P call so symmetric-NAT pairs fall
// back through our TURN relay instead of failing outright.
const turnCredentials = require('./turnCredentials');
exports.getTurnCredentials           = turnCredentials.getTurnCredentials;

// 48h per-match timeout enforcer, REMOVED 2026-08-17.
// detectMatchTimeouts — folded into cron5Min dispatcher (see EOF).

// Tournament AI moderation, the overlay ingest + config callables were REMOVED
// 2026-08-17. analyzeTournamentMatch is KEPT: /vanguard/moderation-room is
// still routed and calls it.
const tournamentAi = require('./tournamentAi');
exports.analyzeTournamentMatch  = tournamentAi.analyzeTournamentMatch;

// Content moderation Phase 2 — Gemini-powered chat + post + image + video.
// Scope: CSAM (mandatory), nudity (platform policy), doxxing, scam links.
// General rudeness/harassment handled by reports + Vanguard mods, not AI.
const contentAi = require('./contentAi');
exports.moderateChatMessage = contentAi.moderateChatMessage;
exports.moderateNewPost     = contentAi.moderateNewPost;

// Adaptive video: queue a transcode job for posts carrying video. Writes ONE doc
// to transcode_jobs and touches nothing else, so it cannot affect posting.
exports.enqueueVideoTranscode = require('./transcodeQueue').enqueueVideoTranscode;
exports.rescanPost          = contentAi.rescanPost;

// Vanguard tournament-assignment system (claim-based). KEPT on purpose:
// /vanguard/schedule, /vanguard/wall and /vanguard/queue are all still routed
// and call these. They will have nothing to operate on now that tournaments are
// gone, retiring those Vanguard screens is a separate founder decision.
const vanguardAssignments = require('./vanguardAssignments');
exports.onTournamentCreated                  = vanguardAssignments.onTournamentCreated;
exports.vanguardClaimTournament              = vanguardAssignments.vanguardClaimTournament;
exports.vanguardReleaseTournamentAssignment  = vanguardAssignments.vanguardReleaseTournamentAssignment;
exports.vanguardCheckIn                      = vanguardAssignments.vanguardCheckIn;
exports.vanguardCompleteAssignment           = vanguardAssignments.vanguardCompleteAssignment;
// detectTournamentNoShows — folded into cron5Min dispatcher (see EOF).
// notifyUpcomingAssignments — folded into cron15Min dispatcher (see EOF).

// Per-match Vanguard claiming + auto-OCR suggestion cron + Commander review.
const tournamentMatchClaims = require('./tournamentMatchClaims');
exports.vanguardClaimMatch           = tournamentMatchClaims.vanguardClaimMatch;
exports.vanguardReleaseMatchClaim    = tournamentMatchClaims.vanguardReleaseMatchClaim;
// autoSuggestMatchWinners — folded into cronMinute dispatcher (see EOF).
exports.commanderResolveMatchReview  = tournamentMatchClaims.commanderResolveMatchReview;
// detectTournamentStreamDrops — folded into cronMinute dispatcher (see EOF).

// Live streaming — Oracle nginx-rtmp + R2 + Cloudflare CDN architecture.
// Provisions stream keys, charges/refunds Stream Boost, ranks discovery feed.
// See CLAUDE.md "Live streaming architecture" for design rationale.
const streaming = require('./streaming');
exports.createStreamSession      = streaming.createStreamSession;
exports.endStreamSession         = streaming.endStreamSession;
// The host's own publish credential, which is no longer a field on the
// world-readable stream document. Host (or admin) only.
exports.getStreamIngest          = streaming.getStreamIngest;
exports.getLikelyTipperScore     = streaming.getLikelyTipperScore;
exports.getLiveDiscoveryFeed     = streaming.getLiveDiscoveryFeed;
exports.recordStreamTip          = streaming.recordStreamTip;
exports.setLiveStreamingPaused   = streaming.setLiveStreamingPaused;

// Entry announcements. The client sends only WHICH stream; follower state,
// subscription tier and VP rank are resolved server-side, because the entrance
// is keyed to rank and the old client-written join doc was fully spoofable.
// See docs/ENTRY_ANNOUNCEMENTS_SPEC.md.
const streamJoins = require('./streamJoins');
exports.announceStreamJoin       = streamJoins.announceStreamJoin;

// Keeps users/{uid}.vpLevel in step with wallets/{uid}.vp. Nothing wrote that
// field before, which left avatar frames permanently locked for every user and
// every "Lvl" list showing 1. See audit A110 + docs/GAMIFICATION_PLAN.md.
const vpLevel = require('./vpLevel');
exports.syncVpLevel              = vpLevel.syncVpLevel;

// Twitch mirror (Twitch → Vergr): poll Twitch for linked users going live and
// surface them as native Vergr streams (Twitch embed in our UI).
const twitchMirror = require('./twitchMirror');
exports.pollTwitchMirrors  = twitchMirror.pollTwitchMirrors;
exports.syncTwitchMirrorNow = twitchMirror.syncTwitchMirrorNow;
exports.refreshTwitchMirrorTokens = twitchMirror.refreshTwitchMirrorTokens;
exports.getTwitchMirrorViewers = twitchMirror.getTwitchMirrorViewers;
exports.twitchChannelImport = twitchMirror.twitchChannelImport;

// PayRam — the only inbound rail (card/Apple Pay/bank → USDC on Base → Circle
// omnibus). createPayramPayment opens a hosted PayRam payment (shown in an
// in-app popup), getPayramOrderStatus is polled to confirm, payramWebhook
// settles on FILLED/OVER_FILLED, pollPayramOrders reconciles missed webhooks.
// See functions/payram.js header. Short-circuits until PAYRAM_API_KEY +
// PAYRAM_NODE_URL are set with real values.
const payram = require('./payram');
exports.createPayramPayment   = payram.createPayramPayment;
// The quote the buy screen renders. Same regional + FX maths as the payment,
// so the figure shown is the figure billed.
exports.getCoinPriceQuote    = payram.getCoinPriceQuote;
exports.getPayramOrderStatus  = payram.getPayramOrderStatus;
exports.payramWebhook         = payram.payramWebhook;
exports.pollPayramOrders      = payram.pollPayramOrders;

// Subscriptions — Tier A (card via NOWPayments invoice → activated by IPN)
// and Tier B (coins debited from VERGR wallet, instant). Daily cron handles
// auto-renewal + reminders + downgrade.
const subs = require('./subscriptions');
const memberships = require('./memberships');
exports.subscribeWithCoins         = subs.subscribeWithCoins;
exports.cancelSubscription         = subs.cancelSubscription;
// renewExpiringSubscriptions — folded into cronDaily dispatcher (see EOF).

// Tournaments, the server-authoritative escrow / bracket / payout callables
// were REMOVED 2026-08-17 (founder). functions/tournaments.js and
// functions/tournamentSeries.js stay on disk, unreferenced and undeployed.

// Ticketed events — non-gambling funding model. Fans buy spectator tickets;
// Ticketed events: fans buy a ticket to attend. No competitors, no prize purse.
const eventTickets = require('./eventTickets');
exports.purchaseEventTicket  = eventTickets.purchaseEventTicket;
exports.getEventTicketStatus = eventTickets.getEventTicketStatus;
exports.purchaseSeasonPass   = eventTickets.purchaseSeasonPass;

// Event CREATION. Separate from tournaments on purpose: tournaments are retired
// and their money-moving callables throw, so an event must not be able to grow
// back into one through a shared path. See functions/events.js.
const events = require('./events');
exports.createEventSecure = events.createEventSecure;
exports.closeEventSecure  = events.closeEventSecure;

// Paid access to content: locked posts, locked chat media, paid streams. ONE
// system for all of them, so the next thing that charges for access does not
// become the eighth bespoke purchase flow in this file. Prices are always
// re-read server-side; the client only names the resource.
// See functions/entitlements.js and docs/CREATOR_MONETIZATION_PLAN.md.
const entitlements = require('./entitlements');
exports.purchaseAccess = entitlements.purchaseAccess;
exports.getAccess      = entitlements.getAccess;

// Creating locked posts. Separate from r2.js on purpose: that one presigns into
// a PUBLIC prefix and returns a CDN URL, which for paid content would mean the
// bytes are reachable by anyone who reads the document.
const lockedPosts = require('./lockedPosts');
exports.getLockedUploadUrl = lockedPosts.getLockedUploadUrl;
exports.createLockedPost   = lockedPosts.createLockedPost;

// The same mechanism on a message (DMs, groups, squad chats). entitlements.js
// has had the `message` resolver since M0; this is what finally writes a price
// onto one. Unpriced private chat is untouched and still unscanned.
// One-shot sweep returning every unsettled prediction stake. Predictions were
// retired; this is the only path those coins have back to their owners.
const refundPicks = require('./refundOutstandingPicks');
exports.refundOutstandingPicks = refundPicks.refundOutstandingPicks;

const lockedMessages = require('./lockedMessages');
exports.getLockedMessageUploadUrl = lockedMessages.getLockedMessageUploadUrl;
exports.sendLockedMessage         = lockedMessages.sendLockedMessage;

// Content Packs: a saved, priced set a creator re-sends without re-uploading.
// Sends go through the same writer as an ordinary locked send, so a pack is not
// a second kind of purchase.
const mediaPacks = require('./mediaPacks');
exports.createMediaPack = mediaPacks.createMediaPack;
exports.deleteMediaPack = mediaPacks.deleteMediaPack;
exports.sendMediaPack   = mediaPacks.sendMediaPack;

// Google Play Billing — coin purchases on the Play store build only. Verifies
// the purchase token against the Play Developer API before crediting; see
// functions/playBilling.js for the founder setup steps it depends on.
const playBilling = require('./playBilling');
exports.redeemPlayPurchase     = playBilling.redeemPlayPurchase;
exports.redeemPlaySubscription = playBilling.redeemPlaySubscription;

// Discord-server clone (Phase 1: structure → Vergr groups + voice channels).
// See functions/discordClone.js. Needs the DISCORD_BOT_TOKEN secret + the bot
// added to the server by its owner.
const discordClone = require('./discordClone');
exports.getDiscordCloneSetup        = discordClone.getDiscordCloneSetup;
exports.cloneDiscordServerStructure = discordClone.cloneDiscordServerStructure;
exports.importDiscordMessages       = discordClone.importDiscordMessages;
exports.postDiscordMigrationNotice  = discordClone.postDiscordMigrationNotice;
exports.checkDiscordRejoin          = discordClone.checkDiscordRejoin;
exports.claimDiscordRejoin          = discordClone.claimDiscordRejoin;

// WhatsApp export import (owner-supplied "Export chat" file → relay store).
const whatsappImport = require('./whatsappImport');
exports.importWhatsAppExport  = whatsappImport.importWhatsAppExport;
exports.claimWhatsAppMessages = whatsappImport.claimWhatsAppMessages;

// vergr.me public analytics — counts logged-out visitors via the Admin SDK
// (vergrMeViews is server-write-only). See functions/vergrMe.js.
const vergrMe = require('./vergrMe');
exports.trackVergrMeEvent = vergrMe.trackVergrMeEvent;
exports.onVergrMeLead = vergrMe.onVergrMeLead;

// vergr.me wallet-native digital sales — 8% flat fee, seller paid in GEMS
// directly (no coin→gem conversion commission). See functions/vergrMeShop.js.
const vergrMeShop = require('./vergrMeShop');
exports.getVergrMeProductUploadUrl   = vergrMeShop.getVergrMeProductUploadUrl;
exports.purchaseVergrMeProduct       = vergrMeShop.purchaseVergrMeProduct;
exports.getVergrMeProductDownloadUrl = vergrMeShop.getVergrMeProductDownloadUrl;
exports.cancelVergrMeOrder           = vergrMeShop.cancelVergrMeOrder;
exports.fetchShopCatalog             = vergrMeShop.fetchShopCatalog;

// Custom domains for vergr.me pages: REMOVED 2026-08-20 (founder decision).
// functions/vergrMeDomains.js stays on disk but is deliberately NOT required
// here and its three callables are undeployed. Cloudflare for SaaS custom
// hostnames are the only way to serve them, and this account has no quota
// (API errors 1456 + 1404); the sole route to it is Enterprise. Re-exporting
// this without first proving a POST to /zones/{id}/custom_hostnames succeeds
// would put the "not switched on yet" panel back in front of Pro members for
// a feature that cannot be switched on.

// Vergr Shop — external store integrations (Shopify / WooCommerce). Seller
// connects with an API token; we import products as native coin-buyable items
// and keep inventory in sync. See functions/shopSync.js. The daily reconcile
// (syncAllShopInventories) is folded into cronDaily below.
const shopSync = require('./shopSync');
const guestCleanup = require('./guestCleanup');
exports.connectShopIntegration    = shopSync.connectShopIntegration;
exports.syncShopInventory         = shopSync.syncShopInventory;
exports.disconnectShopIntegration = shopSync.disconnectShopIntegration;
exports.getMyShopIntegration      = shopSync.getMyShopIntegration;

// RETIRED 2026-07-23. The public Shopify app is now VLink, which lives in its
// OWN REPO (GitHub/VLink) and deploys as the separate "vlink" functions
// codebase. shopifyApp survives only as a webhook tombstone: webhooks
// registered by a legacy install still point at /shopify/webhooks and stay
// registered until that shop re-authorises, so it must keep answering them
// (mandatory compliance webhooks included). Every other /shopify path now
// redirects to /vlink. Retire it fully once shopify_shops is empty.
const shopifyApp = require('./shopifyApp');
exports.shopifyApp = shopifyApp.shopifyApp;

// Vergr Shop's "connect via the Shopify app" path. Moved out of shopifyApp.js
// when that retired: shopSync.js reads the shopIntegration doc this writes, so
// deleting it with the legacy app would have silently killed that path.
exports.linkShopifyStore = require('./vlinkAccountLink').linkShopifyStore;

// Steam GSI — auto-result detection for CS2 and Dota 2 via Valve's
// official Game State Integration. See functions/gsi.js for the contract.
const gsi = require('./gsi');
exports.linkSteamAccount   = gsi.linkSteamAccount;
exports.unlinkSteamAccount = gsi.unlinkSteamAccount;
exports.getSteamGsiConfig  = gsi.getSteamGsiConfig;

// Tier B wrappers — community/unofficial integrations behind a health
// monitor that alerts admins when one breaks. See functions/wrappers/.
const wrapperMonitor = require('./wrapperMonitor');
exports.wrapperHealthCheck       = wrapperMonitor.wrapperHealthCheck;
exports.runWrapperHealthCheckNow = wrapperMonitor.runWrapperHealthCheckNow;

// Per-match wrapper polling REMOVED 2026-08-17, it existed to auto-detect
// tournament match winners. The wrapper HEALTH monitor above stays: it watches
// the community APIs that Linked Accounts still depends on.

// OAuth — generic OAuth2 flow for Twitch, YouTube, Discord, Battle.net, Epic.
// Steam (OpenID 2.0) and Xbox (OpenXBL) have bespoke flows and are not
// routed through this module. Secrets are declared via defineSecret in
// functions/oauth.js — set them via `firebase functions:secrets:set <NAME>`.
const oauth = require('./oauth');
exports.getOAuthStartUrl = oauth.getOAuthStartUrl;
exports.oauthCallback    = oauth.oauthCallback;

// Steam OpenID 2.0 sign-in — replaces the manual Steam64 paste flow.
const steamAuth = require('./steamAuth');
exports.getSteamSignInUrl   = steamAuth.getSteamSignInUrl;
exports.steamOpenIdCallback = steamAuth.steamOpenIdCallback;

// ── PLAN ECONOMY (mirrors src/utils/tierSystem.js + vpSystem.js) ──
const PLAN_VP_MULT = { free: 1, lite: 1.5, pro: 2 };
const MONTHLY_VP_BONUS = { free: 0, lite: 1000, pro: 3000 };
const MONTHLY_COIN_BONUS = { free: 0, lite: 50, pro: 150 };
// Gifting → VP (sender only). Mirrors src/utils/vpSystem.js GIFT_COINS_PER_VP —
// 1 VP per 25 coins tipped (sub-1:1), plan-multiplied. See sendTip.
const GIFT_COINS_PER_VP = 25;
const applyVPMultiplier = (base, plan) => Math.round(base * (PLAN_VP_MULT[plan] || 1));
// Canonical plan read off a user doc's data. `subscription` (string) is the
// field the purchase flows write; `tier`/`plan` are legacy fallbacks. Reading
// only the latter returned 'free' for every paying user, so the VP multiplier
// always collapsed to 1×.
const normalizePlan = (d) => {
  if (!d) return 'free';
  const s = d.subscription;
  const t = (typeof s === 'string' ? s : (s && s.tier)) || d.tier || d.plan || 'free';
  return t === 'lite' || t === 'pro' ? t : 'free';
};
const getUserPlan = async (uid) => {
  try {
    const snap = await db.collection('users').doc(uid).get();
    return snap.exists ? normalizePlan(snap.data()) : 'free';
  } catch { return 'free'; }
};

// ──────────────────────────────────────────────────────────────
// 1. LINK PREVIEW
// ──────────────────────────────────────────────────────────────
exports.getLinkPreviewV2 = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  try {
    const response = await axios.get(url, { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)' } });
    const $ = cheerio.load(response.data);
    const title = $('meta[property="og:title"]').attr('content') || $('title').text() || url;
    const description = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '';
    const image = $('meta[property="og:image"]').attr('content') || '';
    const resolvedImage = image ? new URL(image, url).href : '';
    return res.json({ title: title.trim(), description: description.trim(), image: resolvedImage, url });
  } catch (error) {
    console.error('Link preview error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch preview' });
  }
});

// ──────────────────────────────────────────────────────────────
// 2. RSS PROXY – fetch any RSS/Atom feed and return JSON (improved)
// ──────────────────────────────────────────────────────────────
exports.rssProxy = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).send('');
    return;
  }

  const feedUrl = req.query.url;
  if (!feedUrl) {
    res.status(400).json({ error: 'Missing url parameter' });
    return;
  }

  try {
    const decodedUrl = decodeURIComponent(feedUrl);
    console.log(`Fetching RSS: ${decodedUrl}`);
    
    const response = await axios.get(decodedUrl, {
      timeout: 15000,
      headers: { 
        'User-Agent': 'Mozilla/5.0 (compatible; RSSBot/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      },
      maxRedirects: 5
    });
    
    const xml = response.data;
    
    // Try to parse as XML
    let $;
    try {
      $ = cheerio.load(xml, { xmlMode: true });
    } catch (parseErr) {
      console.error(`XML parse error for ${decodedUrl}:`, parseErr.message);
      res.json({ items: [] });
      return;
    }

    const items = [];
    // Support both RSS (<item>) and Atom (<entry>)
    const feedItems = $('item').length ? $('item') : $('entry');
    
    if (feedItems.length === 0) {
      console.warn(`No items found in feed: ${decodedUrl}`);
      res.json({ items: [] });
      return;
    }

    feedItems.each((i, elem) => {
      try {
        const $item = $(elem);
        let title = $item.find('title').text();
        let link = $item.find('link').text();
        let pubDate = $item.find('pubDate').text() || $item.find('published').text() || $item.find('updated').text();
        let rawContent = $item.find('description').text() || $item.find('content\\:encoded').text() || $item.find('content').text() || $item.find('summary').text();
        let thumbnail = null;
        let youtubeVideoId = null;

        // For Atom feeds, link might be in href attribute
        if (!link) {
          const linkTag = $item.find('link');
          if (linkTag.attr('href')) link = linkTag.attr('href');
        }

        // --- Extract YouTube video ID from iframes/embeds in content ---
        const ytIframeMatch = rawContent.match(/(?:youtube\.com\/embed\/|youtube-nocookie\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
        if (ytIframeMatch) {
          youtubeVideoId = ytIframeMatch[1];
        }
        // Also check for youtube.com/watch links in the content
        if (!youtubeVideoId) {
          const ytLinkMatch = rawContent.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
          if (ytLinkMatch) youtubeVideoId = ytLinkMatch[1];
        }
        // Check media:content for video
        const mediaVideo = $item.find('media\\:content[medium="video"], media\\:content[type^="video"]');
        if (!youtubeVideoId && mediaVideo.attr('url')) {
          const mvMatch = mediaVideo.attr('url').match(/(?:youtube\.com\/embed\/|youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
          if (mvMatch) youtubeVideoId = mvMatch[1];
        }

        // --- Extract thumbnail (try multiple sources) ---
        const enclosure = $item.find('enclosure');
        if (enclosure.attr('url') && enclosure.attr('type')?.startsWith('image/')) {
          thumbnail = enclosure.attr('url');
        }
        // media:content with medium=image
        if (!thumbnail) {
          const mediaImg = $item.find('media\\:content[medium="image"]');
          if (mediaImg.attr('url')) thumbnail = mediaImg.attr('url');
        }
        // media:content with image type
        if (!thumbnail) {
          const mediaImgType = $item.find('media\\:content[type^="image"]');
          if (mediaImgType.attr('url')) thumbnail = mediaImgType.attr('url');
        }
        // media:content without type qualifier (common in many feeds)
        if (!thumbnail) {
          const mediaAny = $item.find('media\\:content');
          if (mediaAny.attr('url') && !mediaAny.attr('type')?.startsWith('video')) {
            thumbnail = mediaAny.attr('url');
          }
        }
        // media:thumbnail
        const mediaThumb = $item.find('media\\:thumbnail');
        if (!thumbnail && mediaThumb.attr('url')) {
          thumbnail = mediaThumb.attr('url');
        }
        // First <img> in raw content — try both double and single quotes, and data-src
        if (!thumbnail && rawContent) {
          const imgMatch = rawContent.match(/<img[^>]+src=["']([^"'>]+)["']/);
          if (imgMatch) thumbnail = imgMatch[1];
        }
        if (!thumbnail && rawContent) {
          const dataSrcMatch = rawContent.match(/<img[^>]+data-src=["']([^"'>]+)["']/);
          if (dataSrcMatch) thumbnail = dataSrcMatch[1];
        }
        // Try <figure> or <picture> source
        if (!thumbnail && rawContent) {
          const sourceMatch = rawContent.match(/<source[^>]+srcset=["']([^\s"'>]+)/);
          if (sourceMatch) thumbnail = sourceMatch[1];
        }
        // Use YouTube thumbnail if we found a video but no image
        if (!thumbnail && youtubeVideoId) {
          thumbnail = `https://img.youtube.com/vi/${youtubeVideoId}/hqdefault.jpg`;
        }

        // --- Extract paragraph text (up to 1000 chars) for preview ---
        let paragraphText = '';
        try {
          const $content = cheerio.load(rawContent);
          // Gather text from <p> tags
          $content('p').each((_, p) => {
            if (paragraphText.length < 1000) {
              const pText = $content(p).text().trim();
              if (pText.length > 15) {
                paragraphText += (paragraphText ? ' ' : '') + pText;
              }
            }
          });
          // Fallback: strip all tags if no paragraphs found
          if (!paragraphText) {
            paragraphText = rawContent.replace(/<[^>]*>/g, '').trim();
          }
        } catch {
          paragraphText = rawContent.replace(/<[^>]*>/g, '').trim();
        }

        title = title.trim();

        if (title || link) {
          items.push({
            title: title || 'Untitled',
            link: link || '#',
            pubDate: pubDate || new Date().toUTCString(),
            description: paragraphText.slice(0, 1000),
            thumbnail: thumbnail || null,
            youtubeVideoId: youtubeVideoId || null,
          });
        }
      } catch (itemErr) {
        console.error(`Error parsing RSS item:`, itemErr.message);
      }
    });

    console.log(`RSS proxy success: ${items.length} items from ${decodedUrl}`);
    res.json({ items });
  } catch (err) {
    console.error(`RSS proxy error for ${feedUrl}:`, err.message);
    // Return empty array on error to avoid breaking frontend
    res.status(200).json({ items: [], error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────
// 3. DAILY LOGIN — 5 consecutive days to earn 25 coins
// ──────────────────────────────────────────────────────────────
// Public VP read. The wallet doc (where VP is authoritative) is owner-only
// readable because it holds USDC balance / KYC / withdrawal limits, so a visitor
// cannot read another user's VP directly. This callable reads the wallet
// server-side and returns ONLY the VP integer — no financial data leaks.
exports.getUserVP = functions.https.onCall(async (request) => {
  // `wallets` is otherwise `allow read: if isOwner(userId)`, so this callable is
  // a deliberate hole in that gate exposing one field. VP is already semi-public
  // (levels and ranks show on profiles), but it had NO auth check at all, so any
  // anonymous caller could read any uid's VP. Requiring a session is free.
  if (!request.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const targetUid = request.data?.uid;
  if (!targetUid) throw new functions.https.HttpsError('invalid-argument', 'uid required');
  const snap = await db.collection('wallets').doc(targetUid).get();
  return { vp: snap.exists ? (snap.data().vp || 0) : 0 };
});

/**
 * Top-VP leaderboard.
 *
 * ## Why this is a callable and not a client query
 *
 * The Leaderboard ordered `users` by `vp`, but NOTHING writes vp to a user doc:
 * every writer targets `wallets/{uid}.vp`. Firestore omits documents missing the
 * ordered field, so the board returned nothing, forever — and Top VP is the
 * DEFAULT tab, so an empty board is what every user saw (audit A20).
 *
 * The obvious fix, denormalising vp onto `users`, means either mirroring at
 * every VP writer (easy to miss one, and new ones will not know) or a trigger on
 * every wallet write, which bills a function invocation on every tip, purchase
 * and quest claim to keep a leaderboard fresh. Reading the real source instead
 * costs ONE invocation per leaderboard view and cannot drift.
 *
 * A client cannot do this directly: `wallets` is owner-only, correctly, because
 * it holds money. The Admin SDK bypasses that, and only `vp` is returned —
 * never balance, never the payable.
 */
exports.getVpLeaderboard = functions.https.onCall(async (request) => {
  if (!request.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const snap = await db.collection('wallets').orderBy('vp', 'desc').limit(50).get();
  return {
    rows: snap.docs
      .map((d) => ({ uid: d.id, vp: Number(d.data().vp || 0) }))
      .filter((r) => r.vp > 0),
  };
});

/**
 * Top Earners leaderboard.
 *
 * Same shape and same reasoning as getVpLeaderboard: the figure lives on
 * `wallets`, which is owner-only because it holds money, so a client cannot
 * query it and the Admin SDK does it here instead. ONE invocation per view, no
 * denormalisation to drift.
 *
 * Ranks by `totalEarnedCoinsGross` — LIFETIME GROSS COINS EARNED, the same
 * aggregate the revenue-share ladder keys off. Deliberately not:
 *   • `owedMicroUsd`, which is the outstanding payable, i.e. what Vergr owes
 *     right now. That goes DOWN when someone is paid, so a leaderboard of it
 *     would rank creators by how recently they had NOT been paid.
 *   • `totalEarned`, which admin grants used to inflate before that was fixed.
 *
 * Only the ranking figure is returned. Never a balance, never the payable.
 */
exports.getEarnersLeaderboard = functions.https.onCall(async (request) => {
  if (!request.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const snap = await db.collection('wallets')
    .orderBy('totalEarnedCoinsGross', 'desc').limit(50).get();
  return {
    rows: snap.docs
      .map((d) => ({ uid: d.id, earned: Number(d.data().totalEarnedCoinsGross || 0) }))
      .filter((r) => r.earned > 0),
  };
});

exports.claimDailyReward = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');

  const walletRef = db.collection('wallets').doc(uid);
  const userRef = db.collection('users').doc(uid);

  return db.runTransaction(async (tx) => {
    const walletSnap = await tx.get(walletRef);
    const userSnap = await tx.get(userRef);
    const currentBalance = walletSnap.exists ? (walletSnap.data().balance || 0) : 0;
    const currentEarned = walletSnap.exists ? (walletSnap.data().totalEarned || 0) : 0;
    const currentStreak = walletSnap.exists ? (walletSnap.data().dailyStreak || 0) : 0;
    const lastCheckIn = walletSnap.exists ? walletSnap.data().lastDailyCheckIn : null;

    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    if (lastCheckIn) {
      const lastDate = lastCheckIn.toDate ? lastCheckIn.toDate() : new Date(lastCheckIn);
      if (lastDate.toISOString().slice(0, 10) === today) {
        throw new functions.https.HttpsError('already-exists', 'Already checked in today');
      }
    }

    let newStreak = 1;
    // The uncapped record, kept separately from the 5-day reward loop.
    const bestConsecutive = walletSnap.exists ? (walletSnap.data().bestConsecutiveDays || 0) : 0;
    const distinctDays = walletSnap.exists ? (walletSnap.data().distinctDaysActive || 0) : 0;
    let consecutiveDays = 1;
    if (lastCheckIn) {
      const lastDate = lastCheckIn.toDate ? lastCheckIn.toDate() : new Date(lastCheckIn);
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      if (lastDate.toISOString().slice(0, 10) === yesterday.toISOString().slice(0, 10)) {
        newStreak = currentStreak + 1;
        consecutiveDays = (walletSnap.exists ? (walletSnap.data().consecutiveDays || 0) : 0) + 1;
      }
    }

    const plan = normalizePlan(userSnap.exists ? userSnap.data() : null);
    const mult = PLAN_VP_MULT[plan] || 1;
    // Daily login is VP-ONLY. It never mints coins (founder: coins for daily
    // login were never approved). Base 10 VP/day, 50 VP on the 5-day milestone,
    // both plan-multiplied (Free 1× / Lite 1.5× / Pro 2×).
    const milestone = newStreak >= 5;
    const baseVp = milestone ? 50 : 10;
    const vpReward = applyVPMultiplier(baseVp, plan);
    const streakToSave = milestone ? 0 : newStreak;

    const walletData = {
      balance: currentBalance,
      totalEarned: currentEarned,
      vp: (walletSnap.exists ? (walletSnap.data().vp || 0) : 0) + vpReward,
      totalSpent: walletSnap.exists ? (walletSnap.data().totalSpent || 0) : 0,
      owedMicroUsd: walletSnap.exists ? (walletSnap.data().owedMicroUsd || 0) : 0,
      totalOwedMicroUsd: walletSnap.exists ? (walletSnap.data().totalOwedMicroUsd || 0) : 0,
      totalReceived: walletSnap.exists ? (walletSnap.data().totalReceived || 0) : 0,
      totalTipped: walletSnap.exists ? (walletSnap.data().totalTipped || 0) : 0,
      tier: plan, // keep the denormalised wallet.tier in sync with the real plan
      lastDailyCheckIn: now,
      dailyStreak: streakToSave,
      // ── Milestone counters ───────────────────────────────────────
      // `dailyStreak` above is a REWARD LOOP: it caps at 5 and resets to 0 so
      // the +50 bonus can recur. It is therefore useless as a record — a
      // "longest streak" read from it can never exceed 5.
      //
      // `consecutiveDays` is the actual record: same yesterday/not-yesterday
      // rule, never capped, never reset by the bonus. `bestConsecutiveDays`
      // only ever rises. `distinctDaysActive` counts check-ins, so a user who
      // shows up every Saturday still accrues toward a loyalty badge.
      //
      // All three ride THIS write, which already happens once per user per
      // day, so they add no invocations and no reads.
      consecutiveDays: consecutiveDays,
      bestConsecutiveDays: Math.max(bestConsecutive, consecutiveDays),
      distinctDaysActive: distinctDays + 1,
      updatedAt: now,
      ...(!walletSnap.exists ? { createdAt: now } : {}),
    };
    // ⚠ `{ merge: true }` IS LOAD-BEARING. This was a bare `tx.set`, which
    // REPLACES the whole document, so every wallet field not enumerated in
    // `walletData` above was destroyed on each daily check-in — including
    // `boostTokens` (the rank reward, wiped the next time the user opened the
    // app), `totalEarnedCoinsGross` (which drives the revenue-share ladder),
    // `totalPaidMicroUsd`, `totalGrantedCoins` and the payout-account fields.
    // The enumerated fields are read-then-written above precisely because the
    // original author was working around the overwrite; that pattern only
    // protects the fields somebody remembered to list.
    tx.set(walletRef, walletData, { merge: true });

    const claimId = `${uid}_daily_login_${today}`;
    tx.set(db.collection('quest_claims').doc(claimId), {
      userId: uid, questId: 'daily_login', amount: vpReward, currency: 'vp', claimedAt: now,
    });

    // VP milestone notification on streak completion (no coins).
    if (milestone) {
      tx.set(db.collection('transactions').doc(), {
        userId: uid, type: 'daily_reward', amount: vpReward, currency: 'vp',
        description: `5-day login streak: +${vpReward} VP`, createdAt: now,
      });
      tx.set(db.collection('notifications').doc(), {
        recipientId: uid, type: 'vp',
        title: `+${vpReward} VP — 5-day streak!`,
        body: 'Streak complete — start again tomorrow!',
        read: false, data: { vp: vpReward, type: 'daily_reward' }, createdAt: now,
      });
    }

    return {
      vpReward, baseVp, plan, multiplier: mult,
      milestone,
      streak: streakToSave,
      dayOfStreak: milestone ? 5 : newStreak,
      message: milestone
        ? `5-day streak complete! +${vpReward} VP`
        : `Day ${newStreak}/5 — +${vpReward} VP`,
    };
  });
});

// ──────────────────────────────────────────────────────────────
// 4. QUEST REWARD CLAIM (callable)
// ──────────────────────────────────────────────────────────────
//
// ## Why the registry below exists
//
// This callable used to take `reward` from the CLIENT and validate the quest
// id against nothing. Only a handful of ids had inline `if` blocks; every
// other id fell straight through to the payout at whatever amount was sent.
// Three consequences, all live until 2026-08-19:
//
//   1. Seven shipped quests (daily_post, daily_like, daily_squad_msg,
//      weekly_posts, weekly_follow, first_stream, add_phone) paid for work
//      nobody had done. Pressing the button was the whole requirement.
//   2. An INVENTED id was accepted. The claim doc is keyed by questId, so
//      calling with 'x1', 'x2', 'x3'... had no limit at all: 5000 VP a time,
//      doubled again by the Pro multiplier.
//   3. `add_phone` double-paid. savePhoneNumber already awards its 1000 VP
//      against the one-time claim `${uid}_add_phone`, but this function keyed
//      it per-DAY, making it a fresh 1000 VP every day.
//
// Minted VP is not cosmetic. It drives Vanguard promotion eligibility (a
// Recruit crossing a threshold is auto-flagged as a promotion candidate), the
// enumeration filter, and every level, rank and badge.
//
// The shape is the one functions/creatorQuests.js already uses, whose header
// says it best: the client sends only WHICH quest, never how much. Amounts
// come from this table, and every id carries a verifier that has to agree the
// thing was done. A quest that cannot be verified is not offered.
//
// Keep the ids in sync with QUEST_DEFS in src/screens/home/EarnCoinsScreen.jsx.
// That client copy is DISPLAY ONLY.

const startOfUtcDayMs = (now = Date.now()) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
const startOfUtcWeekMs = (now = Date.now()) => startOfUtcDayMs(now) - 6 * 86400000;

/** How many posts `uid` authored since `sinceMs`, capped. */
async function questPostCount(uid, sinceMs, cap = 20) {
  const snap = await db.collection('posts')
    .where('authorId', '==', uid)
    .where('createdAt', '>=', new Date(sinceMs))
    .limit(cap).get();
  return snap.size;
}

// Profile-completion quests (founder-approved table 2026-07-09). These amounts
// were already server-locked and individually verified; they move into the
// registry so there is ONE table instead of two.
const PROFILE_QUEST_REWARDS = {
  profile_avatar: 500, profile_banner: 300, profile_bio: 200,
  profile_interests: 200, first_follow_5: 300, profile_gaming_link: 500,
};

// `verify` must return true before any VP moves. `oneTime` keys the claim doc
// without a date. `inlineVerify` means the check lives inside the transaction
// below instead, because it needs to reserve a cap or emit a per-field message.
const QUEST_REGISTRY = {
  // ── Daily ──────────────────────────────────────────────────────────
  daily_post: {
    vp: 15,
    verify: async (uid) => (await questPostCount(uid, startOfUtcDayMs(), 1)) >= 1,
    unmet: 'Create a post today to claim this.',
  },
  daily_like: {
    vp: 5,
    // Like docs are posts/{postId}/likes/{uid}, carrying userId + createdAt.
    verify: async (uid) => {
      const snap = await db.collectionGroup('likes')
        .where('userId', '==', uid)
        .where('createdAt', '>=', new Date(startOfUtcDayMs()))
        .limit(5).get();
      return snap.size >= 5;
    },
    unmet: 'Like 5 posts today to claim this.',
  },
  daily_squad_msg: {
    vp: 10,
    // Squad messages are squads/{squadId}/chat/{id}, with authorId + createdAt.
    verify: async (uid) => {
      const snap = await db.collectionGroup('chat')
        .where('authorId', '==', uid)
        .where('createdAt', '>=', new Date(startOfUtcDayMs()))
        .limit(1).get();
      return !snap.empty;
    },
    unmet: 'Send a message in any squad today to claim this.',
  },

  // ── Weekly ─────────────────────────────────────────────────────────
  weekly_posts: {
    vp: 50,
    verify: async (uid) => (await questPostCount(uid, startOfUtcWeekMs(), 3)) >= 3,
    unmet: 'Create 3 posts this week to claim this.',
  },
  weekly_follow: {
    vp: 50,
    verify: async (uid) => {
      const snap = await db.collection('follows')
        .where('followerId', '==', uid)
        .where('createdAt', '>=', new Date(startOfUtcWeekMs()))
        .limit(10).get();
      return snap.size >= 10;
    },
    unmet: 'Follow 10 new people this week to claim this.',
  },

  // ── One-time ───────────────────────────────────────────────────────
  first_stream: {
    vp: 100, oneTime: true,
    verify: async (uid) => {
      const snap = await db.collection('streams').where('hostUid', '==', uid).limit(1).get();
      return !snap.empty;
    },
    unmet: 'Go live once to claim this.',
  },
  add_phone: {
    vp: 1000, oneTime: true,
    // savePhoneNumber pays this on the first save and writes the SAME one-time
    // claim doc (`${uid}_add_phone`), so this path normally returns
    // 'already-exists'. `oneTime` is what makes that true: keyed per-day, as it
    // was, the same 1000 VP could be re-claimed every day.
    verify: async (uid) => {
      const snap = await db.collection('users').doc(uid).get();
      return !!(snap.exists && snap.data().phoneHash);
    },
    unmet: 'Add and verify a phone number first.',
  },

  first_event: {
    vp: 100, oneTime: true,
    // Ticketed events are stored in `tournaments` (the ticketed pivot reused
    // that collection) and the host is `adminId` — confirmed against
    // eventTickets.js, which pays the host share to `t.adminId`. One-time, so
    // no date bound: "your first ticketed event".
    //
    // This id is offered by the NATIVE /earn screen only and the audit's list
    // of seven unverified quests missed it, so it was an eighth pay-for-nothing
    // button. Found by cross-checking QUEST_DEFS against this registry.
    verify: async (uid) => {
      const snap = await db.collection('tournaments').where('adminId', '==', uid).limit(1).get();
      return !snap.empty;
    },
    unmet: 'Host a ticketed event to claim this.',
  },

  // ── Verified inline, inside the transaction ────────────────────────
  creator_content:  { vp: 100,  oneTime: true, inlineVerify: true },
  first_squad:      { vp: 50,   oneTime: true, inlineVerify: true },
  // Tournaments are retired and unrouted, so no client offers this any more.
  // Kept with its verifier rather than deleted, per the no-deletion rule.
  first_tournament: { vp: 50,   oneTime: true, inlineVerify: true },
  refer_friend:     { vp: 5000, inlineVerify: true },

  // ── Profile completion (verified inline, per-field messages) ───────
  ...Object.fromEntries(Object.entries(PROFILE_QUEST_REWARDS)
    .map(([id, vp]) => [id, { vp, oneTime: true, inlineVerify: true }])),
};

exports.claimQuestReward = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');

  const { questId, title } = request.data || {};
  if (!questId) throw new functions.https.HttpsError('invalid-argument', 'questId required');

  if (questId === 'daily_login') {
    throw new functions.https.HttpsError('invalid-argument', 'Use the daily login banner');
  }

  const quest = QUEST_REGISTRY[questId];
  // The single line that closes the invented-id mint.
  if (!quest) throw new functions.https.HttpsError('invalid-argument', 'Unknown quest.');

  // The amount comes from the table, never from the caller. `request.data.reward`
  // is now ignored entirely: the old `reward > 5000` check was not a control,
  // it was a ceiling on the theft.
  let reward = quest.vp;

  // Registry-verified quests are checked here, before anything is written. The
  // `inlineVerify` ones are checked inside the transaction below instead, where
  // they can reserve caps (refer_friend) and give per-field messages (profile).
  if (!quest.inlineVerify) {
    const done = await quest.verify(uid);
    if (!done) throw new functions.https.HttpsError('failed-precondition', quest.unmet);
  }

  const today = new Date().toISOString().split('T')[0];
  const isOneTime = quest.oneTime === true;
  // `refer_friend` is special: one claim *per friend*, not one per referrer.
  // We key on both uids so the same referrer can claim multiple invites.
  const claimId = questId === 'refer_friend'
    ? `${uid}_refer_friend_${request.data?.friendId || 'missing'}`
    : isOneTime
      ? `${uid}_${questId}`
      : `${uid}_${questId}_${today}`;
  const claimRef = db.collection('quest_claims').doc(claimId);
  const walletRef = db.collection('wallets').doc(uid);

  // Subscriber VP multiplier (Free 1× / Lite 1.5× / Pro 2×) applies to all
  // engagement/creation quests. Referral payouts are LOCKED fixed amounts
  // (referrer 5000 / referee 3000) and are never multiplied.
  const plan = await getUserPlan(uid);

  return db.runTransaction(async (tx) => {
    const claimSnap = await tx.get(claimRef);
    if (claimSnap.exists) throw new functions.https.HttpsError('already-exists', 'Already claimed');

    // Server-side validation for refer_friend
    // ─────────────────────────────────────────
    // Completion criteria (all required):
    //   1. friend's user doc exists and isn't soft-deleted
    //   2. friend has a phoneHash (phone number verified) — this is the only
    //      completion gate now. The old "join a squad OR subscribe" step was
    //      too much to ask of a brand-new invitee and killed most referrals,
    //      so it was dropped (founder decision 2026-07-03): reward fires as
    //      soon as the invited friend verifies a phone number.
    //   3. friend's `referredBy` matches the caller (uid). This is set at
    //      signup when the invitee lands via `?ref=<uid>`.
    //
    // Payouts:
    //   • Referrer: +5000 VP (rewards the person who brought the user in)
    //   • Referred friend: +3000 VP (welcome bonus to encourage completion)
    let referralFriendId = null;
    if (questId === 'refer_friend') {
      const { friendId } = request.data;
      if (!friendId || friendId === uid) throw new functions.https.HttpsError('invalid-argument', 'friendId required');
      referralFriendId = friendId;

      const friendSnap = await tx.get(db.collection('users').doc(friendId));
      if (!friendSnap.exists || friendSnap.data().deleted) {
        throw new functions.https.HttpsError('failed-precondition', 'Invited user no longer exists');
      }
      const friend = friendSnap.data();
      if (friend.referredBy !== uid) {
        throw new functions.https.HttpsError('failed-precondition',
          'That user wasn\'t referred by you. They must sign up via your invite link.');
      }
      if (!friend.phoneHash) {
        throw new functions.https.HttpsError('failed-precondition', 'Friend needs to verify a phone number first');
      }

      // Per-week referral cap. Vanguard members bypass (they're incentivised
      // to grow the platform — more users = more tournament fees = more
      // for the treasury). Otherwise free=5/week, lite/pro=20/week.
      // The counter lives at users/{uid}.referrals.thisWeek + weekStart.
      // Week boundary: Monday 00:00 UTC.
      const userSnap = await tx.get(db.collection('users').doc(uid));
      const userData = userSnap.exists ? userSnap.data() : {};
      const isVanguardActive =
        userData.vanguard?.rank &&
        userData.vanguard?.status !== 'suspended' &&
        userData.vanguard?.status !== 'retired';
      if (!isVanguardActive) {
        const callerTier = normalizePlan(userData);
        const isPaid = callerTier === 'lite' || callerTier === 'pro';
        const weeklyCap = isPaid ? 20 : 5;
        // Compute Monday-00:00-UTC of this week.
        const now = new Date();
        const dayUtc = now.getUTCDay(); // 0 = Sun, 1 = Mon, ...
        const daysSinceMon = (dayUtc + 6) % 7;
        const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMon, 0, 0, 0));
        const storedWeekStart = userData.referrals?.weekStart?.toMillis?.()
          || (userData.referrals?.weekStart?.seconds ? userData.referrals.weekStart.seconds * 1000 : 0);
        const sameWeek = storedWeekStart === weekStart.getTime();
        const thisWeekCount = sameWeek ? (userData.referrals?.thisWeek || 0) : 0;
        if (thisWeekCount >= weeklyCap) {
          throw new functions.https.HttpsError('resource-exhausted',
            `Weekly referral cap reached (${weeklyCap}/${weeklyCap}). Resets Monday 00:00 UTC. Become Vanguard for unlimited.`);
        }
        // Reserve a slot — write the incremented counter as part of the same
        // transaction so two concurrent claims can't both squeak past the cap.
        tx.update(db.collection('users').doc(uid), {
          'referrals.weekStart': weekStart,
          'referrals.thisWeek': sameWeek ? admin.firestore.FieldValue.increment(1) : 1,
          'referrals.allTime': admin.firestore.FieldValue.increment(1),
          'referrals.lastReferralAt': admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        // Vanguard — still log all-time for stats, no cap.
        tx.update(db.collection('users').doc(uid), {
          'referrals.allTime': admin.firestore.FieldValue.increment(1),
          'referrals.lastReferralAt': admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // Override the reward sent by the client — server is the source of truth.
      reward = 5000;
    }

    if (questId === 'creator_content') {
      const postsSnap = await db.collection('posts')
        .where('authorId', '==', uid)
        .where('status', '==', 'published')
        .orderBy('createdAt', 'desc')
        .limit(50).get();
      const qualifying = postsSnap.docs.filter(d => {
        const data = d.data();
        return (data.likeCount || 0) >= 5 && (data.commentCount || 0) >= 5;
      });
      if (qualifying.length < 10) {
        throw new functions.https.HttpsError('failed-precondition', 
          `Need 10 posts with 5+ likes and 5+ comments. You have ${qualifying.length} qualifying posts.`);
      }
    }

    if (questId === 'first_squad') {
      const squadsSnap = await db.collectionGroup('members')
        .where('userId', '==', uid).limit(1).get();
      if (squadsSnap.empty) throw new functions.https.HttpsError('failed-precondition', 'Join a squad first');
    }

    if (questId === 'first_tournament') {
      const tourneysSnap = await db.collection('tournaments')
        .where('participants', 'array-contains', uid).limit(1).get();
      if (tourneysSnap.empty) throw new functions.https.HttpsError('failed-precondition', 'Enter a tournament first');
    }

    if (PROFILE_QUEST_REWARDS[questId] != null) {
      const fail = (msg) => { throw new functions.https.HttpsError('failed-precondition', msg); };
      if (questId === 'first_follow_5') {
        const followsSnap = await db.collection('follows')
          .where('followerId', '==', uid).limit(5).get();
        if (followsSnap.size < 5) fail(`Follow 5 accounts first (${followsSnap.size}/5)`);
      } else {
        const uSnap = await db.collection('users').doc(uid).get();
        const u = uSnap.exists ? uSnap.data() : {};
        if (questId === 'profile_avatar' && !u.avatar) fail('Add a profile picture first');
        if (questId === 'profile_banner' && !u.banner) fail('Add a profile banner first');
        if (questId === 'profile_bio' && String(u.bio || '').trim().length < 20) fail('Write a bio of at least 20 characters first');
        if (questId === 'profile_interests' && (u.gameTags || []).length < 3) fail('Pick at least 3 interests first');
        if (questId === 'profile_gaming_link' && !(u.linkedAccounts && Object.keys(u.linkedAccounts).length > 0)) fail('Connect a gaming account first');
      }
      reward = PROFILE_QUEST_REWARDS[questId];
    }

    // Pay out — quest rewards are VP ONLY (CLAUDE.md hard rule:
    // "Creator quests award VP only — never coins"). Earlier versions of this
    // function credited `balance` instead of `vp`; that was a bug.
    const walletSnap = await tx.get(walletRef);
    const currentVP = walletSnap.exists ? (walletSnap.data().vp || 0) : 0;

    // Referral payouts stay at their locked amount; every other quest is
    // plan-multiplied for Lite/Pro subscribers.
    const payoutVp = questId === 'refer_friend' ? reward : applyVPMultiplier(reward, plan);

    if (walletSnap.exists) {
      tx.update(walletRef, { vp: currentVP + payoutVp, updatedAt: new Date() });
    } else {
      tx.set(walletRef, {
        balance: 0, gems: 0, vp: payoutVp,
        totalEarned: 0, totalSpent: 0, totalReceived: 0, totalTipped: 0,
        tier: plan, dailyStreak: 0, lastDailyCheckIn: null,
        createdAt: new Date(), updatedAt: new Date(),
      });
    }

    tx.set(claimRef, { userId: uid, questId, amount: payoutVp, currency: 'vp', claimedAt: new Date(), ...(referralFriendId && { friendId: referralFriendId }) });
    tx.set(db.collection('transactions').doc(), {
      userId: uid, type: 'quest_reward', amount: payoutVp, currency: 'vp',
      description: title || `Quest: ${questId}`, createdAt: new Date(),
    });
    tx.set(db.collection('notifications').doc(), {
      recipientId: uid, type: 'vp',
      title: `+${payoutVp} VP earned!`,
      body: title || `Quest completed: ${questId}`,
      read: false, data: { amount: payoutVp, currency: 'vp', type: 'quest_reward' }, createdAt: new Date(),
    });

    // refer_friend: also pay the invitee their 3000 VP welcome bonus. Use a
    // distinct claim doc so we don't double-pay if the referrer ever retries.
    if (questId === 'refer_friend' && referralFriendId) {
      const FRIEND_REWARD = 3000; // VP, not coins
      const friendClaimRef = db.collection('quest_claims').doc(`${referralFriendId}_referred_bonus`);
      const friendClaimSnap = await tx.get(friendClaimRef);
      if (!friendClaimSnap.exists) {
        const friendWalletRef = db.collection('wallets').doc(referralFriendId);
        const friendWalletSnap = await tx.get(friendWalletRef);
        const fVP = friendWalletSnap.exists ? (friendWalletSnap.data().vp || 0) : 0;
        if (friendWalletSnap.exists) {
          tx.update(friendWalletRef, { vp: fVP + FRIEND_REWARD, updatedAt: new Date() });
        } else {
          tx.set(friendWalletRef, {
            balance: 0, gems: 0, vp: FRIEND_REWARD,
            totalEarned: 0, totalSpent: 0, totalReceived: 0, totalTipped: 0,
            tier: 'free', dailyStreak: 0, lastDailyCheckIn: null,
            createdAt: new Date(), updatedAt: new Date(),
          });
        }
        tx.set(friendClaimRef, { userId: referralFriendId, questId: 'referred_bonus', amount: FRIEND_REWARD, currency: 'vp', claimedAt: new Date(), referrerId: uid });
        tx.set(db.collection('transactions').doc(), {
          userId: referralFriendId, type: 'quest_reward', amount: FRIEND_REWARD, currency: 'vp',
          description: 'Referral bonus — thanks for joining!', createdAt: new Date(),
        });
        tx.set(db.collection('notifications').doc(), {
          recipientId: referralFriendId, type: 'vp',
          title: `+${FRIEND_REWARD} VP referral bonus!`,
          body: 'You completed your VERGR setup — here\'s your welcome reward.',
          read: false, data: { amount: FRIEND_REWARD, type: 'quest_reward' }, createdAt: new Date(),
        });
      }
    }

    // Return what was ACTUALLY paid, not the base, so the client can show a
    // truthful toast instead of echoing its own hardcoded number. refer_friend
    // is never multiplied, so its 5000 is unchanged for the referral screens.
    return { reward: payoutVp, baseReward: reward, questId, friendReward: questId === 'refer_friend' ? 3000 : 0 };
  });
});

// ──────────────────────────────────────────────────────────────
// 4b. PHONE NUMBER — save + award one-time VP, and match contacts
// ──────────────────────────────────────────────────────────────
// The client submits an E.164 phone string. We:
//   • normalize + sha-256 hash it server-side (never trust client-sent hash)
//   • store `phone` (raw, owner-readable) and `phoneHash` (used for lookup)
//   • award 100 VP once via quest-claim `${uid}_add_phone`
//
// `matchContactHashes` takes an array of sha-256 hex hashes (generated in the
// browser from the user's picked phone contacts via SubtleCrypto) and
// returns which of those match registered VERGR users. We require the caller
// to have saved their own phone first — this prevents drive-by enumeration
// of the user base from a logged-in account that never added its number.
const crypto = require('crypto');

function normalizePhone(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  // Accept "+<digits>" (E.164) with 8–15 total digits. We strip spaces,
  // dashes, parens; we do NOT try to infer country codes.
  const cleaned = trimmed.replace(/[\s\-()]/g, '');
  if (!/^\+\d{8,15}$/.test(cleaned)) return null;
  return cleaned;
}

function hashPhone(normalized) {
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

exports.savePhoneNumber = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');

  const normalized = normalizePhone(request.data?.phone);
  if (!normalized) {
    throw new functions.https.HttpsError('invalid-argument',
      'Phone must be in E.164 format (e.g. +441234567890).');
  }
  const phoneHash = hashPhone(normalized);

  const userRef = db.collection('users').doc(uid);
  const walletRef = db.collection('wallets').doc(uid);
  const claimRef = db.collection('quest_claims').doc(`${uid}_add_phone`);

  const PHONE_ADD_REWARD = 1000; // VP awarded once, when the first phone is saved

  return db.runTransaction(async (tx) => {
    const claimSnap = await tx.get(claimRef);
    const alreadyClaimed = claimSnap.exists;

    // The RAW number goes to the owner-only private subcollection, never to
    // `users/{uid}`, which is `allow read: if true` — world-readable, signed
    // out included. It used to be written here as `phone`, so every user's
    // real phone number was public, and `phoneVisibility` ('public' /
    // 'contacts' / 'selected' / 'hidden', enforced in matchContactHashes
    // below) was cosmetic: setting it to 'hidden' hid you from contact
    // matching while your number stayed one getDoc away. Nothing ever read
    // `users.phone` — not one call site in src/ or functions/ — so it was
    // write-only PII. `phoneHash` STAYS on the user doc: matchContactHashes
    // needs `where('phoneHash','in',...)` and a collection query cannot reach
    // into a subcollection.
    tx.set(db.collection('users').doc(uid).collection('private').doc('contact'),
      { phone: normalized, updatedAt: new Date() }, { merge: true });
    tx.update(userRef, {
      phoneHash,
      phone: admin.firestore.FieldValue.delete(), // migrate anyone already exposed
      updatedAt: new Date(),
    });

    // One-time grant — only on the first ever save. Later edits won't
    // re-award, but they do update the hash so contact matching keeps working.
    if (!alreadyClaimed) {
      const walletSnap = await tx.get(walletRef);
      // VP, NOT coins. This credited `balance` (and `totalEarned`), which are
      // real spendable coins at ~$0.0127 each, so adding a phone number minted
      // about $12.70 of value and inflated a lifetime earnings aggregate.
      // Everything around it always said VP: the constant's own comment, the
      // notification ("+1000 VP earned!", type 'vp') and the quest registry.
      // claimQuestReward had the identical bug and its fix carries the same
      // note: "Earlier versions credited `balance` instead of `vp`."
      const vp = walletSnap.exists ? (walletSnap.data().vp || 0) : 0;
      if (walletSnap.exists) {
        tx.update(walletRef, { vp: vp + PHONE_ADD_REWARD, updatedAt: new Date() });
      } else {
        tx.set(walletRef, {
          balance: 0, vp: PHONE_ADD_REWARD, totalEarned: 0, totalSpent: 0, totalReceived: 0, totalTipped: 0,
          tier: 'free', dailyStreak: 0, lastDailyCheckIn: null, createdAt: new Date(), updatedAt: new Date(),
        });
      }
      tx.set(claimRef, { userId: uid, questId: 'add_phone', amount: PHONE_ADD_REWARD, currency: 'vp', claimedAt: new Date() });
      // `currency: 'vp'` matters: without it the wallet's txUnit() cannot tell
      // what the row is and renders the amount with no unit (and, before the
      // A1 fix, rendered it as coins).
      tx.set(db.collection('transactions').doc(), {
        userId: uid, type: 'quest_reward', amount: PHONE_ADD_REWARD, currency: 'vp',
        description: 'Added phone number', createdAt: new Date(),
      });
      tx.set(db.collection('notifications').doc(), {
        recipientId: uid, type: 'vp',
        title: `+${PHONE_ADD_REWARD} VP earned!`,
        body: 'Phone number added — invite your contacts to earn more.',
        read: false, data: { amount: PHONE_ADD_REWARD, type: 'quest_reward' }, createdAt: new Date(),
      });
    }

    return { phone: normalized, awarded: !alreadyClaimed ? PHONE_ADD_REWARD : 0 };
  });
});

exports.matchContactHashes = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');

  // Gate: the caller must have saved their own phone. Prevents a random
  // account from batch-hashing leaked phone lists and enumerating who's on
  // VERGR. This also matches the "add phone → can invite contacts" UX.
  const meSnap = await db.collection('users').doc(uid).get();
  if (!meSnap.exists || !meSnap.data().phoneHash) {
    throw new functions.https.HttpsError('failed-precondition',
      'Add your own phone number before matching contacts.');
  }

  const hashes = Array.isArray(request.data?.hashes) ? request.data.hashes : [];
  // Cap the batch so one call can't scan the whole user base.
  const cleanHashes = hashes
    .filter(h => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h))
    .slice(0, 300);
  if (cleanHashes.length === 0) return { matches: [] };

  const chunks = [];
  for (let i = 0; i < cleanHashes.length; i += 10) chunks.push(cleanHashes.slice(i, i + 10));

  const results = await Promise.all(chunks.map(async (chunk) => {
    const snap = await db.collection('users').where('phoneHash', 'in', chunk).get();
    return snap.docs.map(d => ({
      uid: d.id,
      data: d.data(),
    }));
  }));
  const rawMatches = results.flat().filter(m => m.uid !== uid);

  // Respect each matched user's phone visibility setting. Values:
  //   'public'    → always visible
  //   'contacts'  → visible only if the caller follows or is followed by them
  //   'selected'  → visible only if caller's uid is in phoneVisibilityAllowList
  //   'hidden'    → never visible via contact match
  // Default to 'public' if the field isn't set (back-compat for early users).
  const filtered = [];
  await Promise.all(rawMatches.map(async (m) => {
    const vis = m.data.phoneVisibility || 'public';
    if (vis === 'hidden') return;
    if (vis === 'selected') {
      const list = Array.isArray(m.data.phoneVisibilityAllowList) ? m.data.phoneVisibilityAllowList : [];
      if (!list.includes(uid)) return;
    }
    if (vis === 'contacts') {
      // Either direction satisfies "is a contact": caller follows them, or
      // they follow caller. One doc check each; parallel.
      const [a, b] = await Promise.all([
        db.collection('follows').doc(`${uid}_${m.uid}`).get(),
        db.collection('follows').doc(`${m.uid}_${uid}`).get(),
      ]);
      if (!a.exists && !b.exists) return;
    }
    filtered.push({
      uid: m.uid,
      phoneHash: m.data.phoneHash,
      username: m.data.username || '',
      displayName: m.data.displayName || '',
      avatar: m.data.avatar || '',
    });
  }));

  return { matches: filtered };
});

// ──────────────────────────────────────────────────────────────
// 5. ENGAGEMENT REWARD — post liked → author gets 2 VP (skip news bots)
// ──────────────────────────────────────────────────────────────
exports.onPostLiked = functions.firestore
  .onDocumentCreated({ document: 'posts/{postId}/likes/{userId}', database: 'vgrdb', secrets: HUAWEI_PUSH_SECRETS }, async (event) => {
    const postId = event.params.postId;
    const likerId = event.params.userId;
    try {
      const postSnap = await db.collection('posts').doc(postId).get();
      if (!postSnap.exists) return;
      const authorId = postSnap.data().authorId;

      // Skip if author is a news bot (starts with "news-") – they don't earn VP
      if (authorId && authorId.startsWith('news-')) return;

      if (authorId === likerId) return;

      const today = new Date().toISOString().slice(0, 10);
      const capRef = db.collection('wallets').doc(authorId).collection('daily_caps').doc(today);
      const capSnap = await capRef.get();
      const authorPlan = await getUserPlan(authorId);
      const likerPlan = await getUserPlan(likerId);
      const authorVP = applyVPMultiplier(2, authorPlan);
      const likerVP = applyVPMultiplier(1, likerPlan);
      if ((capSnap.exists ? (capSnap.data().likeVP || 0) : 0) < 40) {
        await db.collection('wallets').doc(authorId).update({ vp: admin.firestore.FieldValue.increment(authorVP) });
        await capRef.set({ likeVP: admin.firestore.FieldValue.increment(authorVP) }, { merge: true });
      }
      await db.collection('wallets').doc(likerId).update({ vp: admin.firestore.FieldValue.increment(likerVP) }).catch(() => {});

      const liker = await db.collection('users').doc(likerId).get();
      const likerName = liker.exists ? (liker.data().displayName || 'Someone') : 'Someone';
      await db.collection('notifications').add({
        recipientId: authorId, type: 'like', title: 'Post liked', body: `${likerName} liked your post`,
        senderId: likerId, data: { postId }, read: false, createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await sendPushToUser(authorId, 'Post liked', `${likerName} liked your post`, { type: 'like', postId });
    } catch (error) {
      console.error('onPostLiked error:', error);
    }
  });

// ──────────────────────────────────────────────────────────────
// 6. MONTHLY TIER REWARDS (1st of month)
// ──────────────────────────────────────────────────────────────
// [Removed] monthlyTierRewards — superseded by payMonthlyPlanBonus (see bottom of file).
// The new function pays the updated amounts (50/150 coins + 1,000/3,000 VP) and is idempotent
// via quest_claims/{uid}_plan_bonus_{YYYY-MM}.

// ──────────────────────────────────────────────────────────────
// 7. ADMIN ANNOUNCEMENT
// ──────────────────────────────────────────────────────────────
exports.sendAnnouncement = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  await requireAdmin(uid);
  // Mass-reach + can grant coins → require fresh TOTP step-up.
  // (If founder hasn't enrolled TOTP yet, requireFreshStepUp is a no-op.)
  const stepUp = await adminSecurity.requireFreshStepUp(uid);
  await adminRateLimit(uid, 'send_announcement', { perHour: 5, perDay: 20, perMonth: 100 });
  const meta = extractRequestMeta(request);

  const { title, body, audience, type, coinReward, actionUrl } = request.data || {};
  if (!title) throw new functions.https.HttpsError('invalid-argument', 'Title required');
  // Cap reward per-send to limit blast radius if TOTP secret is stolen.
  const safeReward = Math.max(0, Math.min(1000, Number(coinReward || 0)));

  // Target by the user-doc `subscription` field (what purchases write). The old
  // wallets.where('tier',...) queries hit a field that was never set on purchase,
  // so lite/pro/paid announcements reached nobody. Doc ids match (both keyed by
  // uid) so downstream recipientId logic is unchanged.
  let usersQuery;
  if (audience === 'lite') usersQuery = db.collection('users').where('subscription', '==', 'lite');
  else if (audience === 'pro') usersQuery = db.collection('users').where('subscription', '==', 'pro');
  else if (audience === 'paid') usersQuery = db.collection('users').where('subscription', 'in', ['lite', 'pro']);
  else usersQuery = db.collection('users').select();

  const snap = await usersQuery.get();
  const now = new Date();
  let count = 0;
  let batch = db.batch();

  for (const userDoc of snap.docs) {
    const recipientId = userDoc.id;
    batch.set(db.collection('notifications').doc(), {
      recipientId, type: type || 'system', title, body: body || '',
      read: false, actionUrl: actionUrl || null,
      data: safeReward > 0 ? { amount: safeReward, type: 'admin_reward' } : null, createdAt: now,
    });
    if (safeReward > 0 && type === 'coins') {
      batch.update(db.collection('wallets').doc(recipientId), {
        balance: admin.firestore.FieldValue.increment(safeReward),
        totalEarned: admin.firestore.FieldValue.increment(safeReward),
      });
      batch.set(db.collection('transactions').doc(), {
        userId: recipientId, type: 'admin_reward', amount: safeReward, description: title, createdAt: now,
      });
    }
    count++;
    if (count % 200 === 0) { await batch.commit(); batch = db.batch(); }
  }
  if (count % 200 !== 0) await batch.commit();
  sendPushToAll(snap.docs.map(d => d.id), title, body || '', { type: type || 'system' }).catch(() => {});
  await auditAdminAction({
    actor: uid,
    action: 'send_announcement',
    target: { type: 'audience', id: audience || 'all' },
    meta: { recipients: count, title, type: type || 'system', coinReward: safeReward },
    ip: meta.ip,
    userAgent: meta.userAgent,
    stepUpEnforced: true,
    stepUpFresh: !!stepUp.stepUpEnforced,
  }).catch(() => {});
  return { count, title };
});

// ──────────────────────────────────────────────────────────────
// 8. MONTHLY SQUAD ELECTIONS
// ──────────────────────────────────────────────────────────────
const _monthlySquadElections = defer('0 12 1 * *', async () => {
    const squadsSnap = await db.collection('squads').where('memberCount', '>=', 3).get();
    let count = 0;
    for (const squadDoc of squadsSnap.docs) {
      const squad = squadDoc.data();
      try {
        const membersSnap = await db.collection('squads').doc(squadDoc.id).collection('members').get();
        const candidates = membersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (candidates.length < 3) continue;
        const voteRef = db.collection('squads').doc(squadDoc.id).collection('votes').doc();
        await voteRef.set({
          title: 'Monthly President Election', type: 'election', targetRole: 'president',
          options: candidates.map(c => c.id), voteCounts: {}, voterIds: [], totalVotes: 0,
          status: 'active', isMonthlyElection: true,
          expiresAt: new Date(Date.now() + 72 * 3600000), createdAt: new Date(),
        });
        const batch = db.batch();
        for (const m of candidates) {
          batch.set(db.collection('notifications').doc(), {
            recipientId: m.id, type: 'squad', title: 'Squad Election',
            body: `Monthly president vote is open for ${squad.name}. Cast your vote!`,
            read: false, data: { squadId: squadDoc.id }, createdAt: new Date(),
          });
        }
        await batch.commit();
        count++;
      } catch (err) { console.error(`Election error for ${squadDoc.id}:`, err); }
    }
    console.log(`Created elections for ${count} squads`);
  });

// ──────────────────────────────────────────────────────────────
// 9. RESOLVE EXPIRED VOTES (every 6 hours)
// ──────────────────────────────────────────────────────────────
const _resolveExpiredVotes = defer('0 */6 * * *', async () => {
    const now = new Date();
    const squadsSnap = await db.collection('squads').get();
    let resolved = 0;
    for (const squadDoc of squadsSnap.docs) {
      const votesSnap = await db.collection('squads').doc(squadDoc.id).collection('votes')
        .where('status', '==', 'active').get();
      for (const voteDoc of votesSnap.docs) {
        const vote = voteDoc.data();
        const expiresAt = vote.expiresAt?.toDate ? vote.expiresAt.toDate() : new Date(vote.expiresAt);
        if (expiresAt > now) continue;
        try {
          const batch = db.batch();
          const voteCounts = vote.voteCounts || {};
          let winnerIndex = null, maxVotes = 0;
          Object.entries(voteCounts).forEach(([idx, cnt]) => { if (cnt > maxVotes) { maxVotes = cnt; winnerIndex = idx; } });

          batch.update(voteDoc.ref, { status: 'resolved', winnerIndex, resolvedAt: now });

          // --- Handle elect_role (yes/no) votes ---
          if (vote.type === 'elect_role' && winnerIndex !== null && vote.options?.[winnerIndex] === 'Yes' && vote.targetUserId && vote.targetRole) {
            // Remove current holder of this role (if any)
            const currentHolders = await db.collection('squads').doc(squadDoc.id).collection('members')
              .where('role', '==', vote.targetRole).get();
            for (const holder of currentHolders.docs) {
              if (holder.id !== vote.targetUserId) {
                batch.update(holder.ref, { role: 'member' });
              }
            }
            // Assign new role
            const targetMemberRef = db.collection('squads').doc(squadDoc.id).collection('members').doc(vote.targetUserId);
            batch.update(targetMemberRef, { role: vote.targetRole });
            // ✅ Update squad owner if the role is president
            if (vote.targetRole === 'president') {
              batch.update(squadDoc.ref, { ownerId: vote.targetUserId });
            }
            batch.set(db.collection('notifications').doc(), {
              recipientId: vote.targetUserId, type: 'squad',
              title: `You are now ${vote.targetRole.replace('_', ' ')}!`,
              body: `Elected by your squad`,
              read: false, data: { squadId: squadDoc.id }, createdAt: now,
            });
          }

          // --- Handle election (candidate list) votes ---
          if (vote.type === 'election' && vote.targetRole && winnerIndex !== null && vote.options?.[winnerIndex]) {
            const winnerId = vote.options[winnerIndex];
            const holders = await db.collection('squads').doc(squadDoc.id).collection('members')
              .where('role', '==', vote.targetRole).get();
            for (const h of holders.docs) { if (h.id !== winnerId) batch.update(h.ref, { role: 'member' }); }
            batch.update(db.collection('squads').doc(squadDoc.id).collection('members').doc(winnerId), { role: vote.targetRole });
            // ✅ Update squad owner if the role is president
            if (vote.targetRole === 'president') {
              batch.update(squadDoc.ref, { ownerId: winnerId });
            }
            batch.set(db.collection('notifications').doc(), {
              recipientId: winnerId, type: 'squad',
              title: `You are now ${vote.targetRole.replace('_', ' ')}!`,
              body: `Elected by your squad`, read: false, data: { squadId: squadDoc.id }, createdAt: now,
            });
          }

          // --- Handle kick votes ---
          if (vote.type === 'kick' && winnerIndex === '0' && maxVotes > 0 && vote.targetUserId) {
            batch.delete(db.collection('squads').doc(squadDoc.id).collection('members').doc(vote.targetUserId));
            batch.update(squadDoc.ref, {
              memberCount: admin.firestore.FieldValue.increment(-1),
              memberIds: admin.firestore.FieldValue.arrayRemove(vote.targetUserId),
            });
          }

          await batch.commit();
          resolved++;
        } catch (err) { console.error(`Vote resolve error:`, err); }
      }
    }
    if (resolved > 0) console.log(`Resolved ${resolved} expired votes`);
  });

// ──────────────────────────────────────────────────────────────
// PUSH HELPERS
// ──────────────────────────────────────────────────────────────
// Map a push `type` → the settings category key in
// users/{uid}.settings.notifications.{key}_push (NotificationSettingsScreen).
// Default ALLOW: only suppress when the user explicitly turned the mapped
// category's _push toggle off. Unmapped types are always allowed.
const PUSH_TYPE_TO_PREF = {
  like: 'likes', comment: 'comments', mention: 'mentions', squad_mention: 'mentions', follow: 'followers',
  dm: 'dm', message: 'dm', msgreq: 'msgreq',
  tip: 'tips', tip_received: 'tips', payout: 'payout', summary: 'summary',
  // An unlock is a creator payment, so it rides the existing "Tips" toggle
  // rather than adding a preference the settings screen does not render yet.
  content_unlocked: 'tips',
  squad_invite: 'squads_inv', squad_activity: 'squads_act', squad: 'squads_act',
  tournament_starting_soon: 'tourney_start', tournament_match_starting: 'tourney_start',
  tournament_match_ready: 'tourney_remind', tournament_assignment_reminder: 'tourney_remind',
  tournament_match_reschedule: 'tourney_remind',
  tournament_won: 'tourney_results', tournament_player_advanced: 'tourney_results',
  security: 'security', updates: 'updates', surveys: 'surveys',
  incoming_call: 'calls',
  stream_live: 'live', stream_scheduled_reminder: 'live', stream_scheduled_soon: 'live',
};
function pushCategoryAllowed(userData, type) {
  if (!type) return true;
  const key = PUSH_TYPE_TO_PREF[type];
  if (!key) return true; // unmapped → always allowed
  const prefs = userData?.settings?.notifications;
  if (!prefs) return true; // no prefs set → default on
  return prefs[`${key}_push`] !== false;
}

async function sendPushToUser(userId, title, body, data = {}) {
  try {
    const fcmRef = db.collection('users').doc(userId).collection('private').doc('fcm');
    const fcmDoc = await fcmRef.get();
    if (!fcmDoc.exists) return;
    const tokens = fcmDoc.data()?.tokens || [];          // FCM (web/PWA + GMS Android)
    const hmsTokens = fcmDoc.data()?.hmsTokens || [];    // Huawei (HMS, no GMS)
    if (tokens.length === 0 && hmsTokens.length === 0) return;
    const user = await db.collection('users').doc(userId).get();
    if (user.exists && user.data()?.settings?.pushNotifications === false) return;
    // Per-category opt-out (Settings → Notifications). Global flag above is the
    // master kill; this respects the individual category toggles.
    if (user.exists && !pushCategoryAllowed(user.data(), data?.type)) return;
    // Data-only payload — the service worker / native service builds the visible
    // notification from data.title / data.body so we control display + routing.
    const payload = { ...data, title, body };
    const strPayload = Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, String(v ?? '')]));
    // Calls must wake a Dozing/closed app immediately → high priority + no TTL.
    const isCall = data?.type === 'incoming_call';
    if (tokens.length > 0) {
      const response = await admin.messaging().sendEachForMulticast({
        tokens,
        data: strPayload,
        android: isCall ? { priority: 'high', ttl: 0 } : { priority: 'high' },
      });
      const invalid = [];
      response.responses.forEach((r, i) => {
        if (!r.success && (r.error?.code === 'messaging/invalid-registration-token' || r.error?.code === 'messaging/registration-token-not-registered')) invalid.push(tokens[i]);
      });
      if (invalid.length > 0) await fcmRef.update({ tokens: admin.firestore.FieldValue.arrayRemove(...invalid) });
    }
    // Huawei push — fully isolated so it can never affect the FCM path above.
    // No-op unless the HUAWEI_PUSH_* secrets hold real values on this function.
    if (hmsTokens.length > 0) {
      try {
        const r = await sendHuaweiPush(hmsTokens, payload);
        if (r.invalidTokens && r.invalidTokens.length) await fcmRef.update({ hmsTokens: admin.firestore.FieldValue.arrayRemove(...r.invalidTokens) });
      } catch (_) {}
    }
  } catch (err) {}
}
async function sendPushToAll(userIds, title, body, data = {}) {
  for (let i = 0; i < userIds.length; i += 10) {
    await Promise.allSettled(userIds.slice(i, i + 10).map(uid => sendPushToUser(uid, title, body, data)));
  }
}

// ──────────────────────────────────────────────────────────────
// FCM fan-out for server-written notifications.
// Crons + server events write notifications/{id} docs for the in-app drawer
// but most don't fire a system push. This trigger sends a real FCM push for
// the allowlisted types below. Inline-pushed types (follow/comment/like/dm)
// are deliberately EXCLUDED so they don't double-push — add a new server
// type here to make it push.
// ──────────────────────────────────────────────────────────────
const PUSHABLE_NOTIFICATION_TYPES = new Set([
  // Getting paid is the single most push-worthy event for a creator, and it was
  // missing: this whole set was tournament-only (a retired feature), so a tip
  // wrote an in-drawer notification that never pushed. `sendTip` does no inline
  // push either, so before this a creator got no push when tipped. Added
  // 2026-08-22 during the messages audit. (If tips should NOT push, remove this
  // one line.)
  'tip',
  // Reaching a new level is the payoff of the whole VP ladder. Written by the
  // syncVpLevel trigger, which only fires when the level band actually changes,
  // so this cannot spam: at most 99 of these in an account's lifetime.
  'vp_level_up',
  'tournament_starting_soon',
  'tournament_won',
  'tournament_cancelled',
  'tournament_match_disqualified',
  'tournament_match_forfeit',
  'tournament_match_disputed',
  'tournament_match_double_no_show',
  'tournament_match_verified',
  'tournament_match_ready',
  'tournament_assignment_reminder',
  'tournament_flagged_for_review',
  'tournament_match_reschedule',
  'tournament_dispute_evidence',
  'tournament_match_starting',
  'tournament_player_advanced',
  'tournament_mod_thanks',
  'tournament_result_confirm',
  'tournament_result_confirmed',
  'tournament_summons',
  'tournament_no_show',
  'cheat_signatures_stale',
  'admin_test_notification',
  // Someone paid to unlock your content. Written by entitlements.js inside the
  // purchase transaction, so it is not inline-pushed and belongs here.
  'content_unlocked',
  'stream_scheduled_reminder',
  'squad_mention',
  // Squad activity (elections, role changes, kicks) — written as type 'squad'
  // notification docs; gated by the "Squad activity" toggle via PUSH_TYPE_TO_PREF.
  'squad',
]);

exports.onNotificationCreated = functions.firestore
  .onDocumentCreated({ document: 'notifications/{notifId}', database: 'vgrdb', secrets: HUAWEI_PUSH_SECRETS }, async (event) => {
    const n = event.data?.data();
    if (!n || !n.recipientId || !n.title) return;
    if (!PUSHABLE_NOTIFICATION_TYPES.has(n.type)) return;
    const data = { type: n.type || '' };
    if (n.data && typeof n.data === 'object') {
      for (const [k, v] of Object.entries(n.data)) data[k] = v;
    }
    if (n.actionUrl) data.actionUrl = n.actionUrl;
    else if (n.link) data.actionUrl = n.link;
    try {
      await sendPushToUser(n.recipientId, n.title, n.body || '', data);
    } catch (err) { console.error('onNotificationCreated push error:', err); }
  });

// ──────────────────────────────────────────────────────────────
// SQUAD CHAT @MENTIONS — write a pushable notification when a squad
// message mentions a member by @username. Squad chat is Firestore-based
// (PRIVATE surface, no Gemini), so a doc trigger is the natural hook.
// Capped at 5 mentions per message; only resolves usernames that belong
// to actual squad members; never notifies the sender about themselves.
// ──────────────────────────────────────────────────────────────
exports.onSquadMessageMention = functions.firestore
  .onDocumentCreated({ document: 'squads/{squadId}/messages/{msgId}', database: 'vgrdb' }, async (event) => {
    const m = event.data?.data();
    const { squadId } = event.params;
    const text = m?.text || '';
    if (!m?.senderId || !text.includes('@')) return;
    const usernames = [...new Set(
      [...text.matchAll(/@([a-zA-Z0-9_.]{2,30})/g)].map(x => x[1].toLowerCase()),
    )].slice(0, 5);
    if (!usernames.length) return;

    const squadSnap = await db.collection('squads').doc(squadId).get();
    if (!squadSnap.exists) return;
    const squad = squadSnap.data() || {};
    const memberIds = new Set(squad.memberIds || []);

    const batch = db.batch();
    let writes = 0;
    for (const uname of usernames) {
      const uq = await db.collection('users').where('username', '==', uname).limit(1).get();
      if (uq.empty) continue;
      const target = uq.docs[0];
      if (target.id === m.senderId || !memberIds.has(target.id)) continue;
      batch.set(db.collection('notifications').doc(), {
        recipientId: target.id,
        type: 'squad_mention',
        title: `${m.senderName || 'A squadmate'} mentioned you in ${squad.name || 'squad chat'}`,
        body: text.slice(0, 120),
        read: false,
        actionUrl: `/squads/${squadId}/chat`,
        data: { squadId, type: 'squad_mention' },
        createdAt: new Date(),
      });
      writes++;
    }
    if (writes) await batch.commit();
  });

// ──────────────────────────────────────────────────────────────
// NEWS BOT ACCOUNTS — RSS SYNC (runs once per day, max 2 posts/bot)
// ──────────────────────────────────────────────────────────────
// Cost note: each bot is capped at 2 new posts per 24h. Images are
// stored as remote URLs (no Storage usage), so the only cost is the
// Firestore writes for the post documents themselves.

const NEWS_BOT_ACCOUNTS = [
  // Major Gaming News Outlets
  { id: 'news-ign', username: 'ign', displayName: 'IGN', bio: 'IGN is the leading site for PC games, with expert reviews, news, previews, game trailers, cheat codes, wiki guides & walkthroughs.', website: 'https://www.ign.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://feeds.feedburner.com/ign/all' },
  { id: 'news-gamespot', username: 'gamespot', displayName: 'GameSpot', bio: 'GameSpot delivers the best and most comprehensive video game and entertainment coverage.', website: 'https://www.gamespot.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.gamespot.com/feeds/mashup/' },
  { id: 'news-kotaku', username: 'kotaku', displayName: 'Kotaku', bio: 'Kotaku is a video game website and blog that covers the gaming industry, gaming culture, and the community surrounding them.', website: 'https://www.kotaku.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://kotaku.com/rss' },
  { id: 'news-polygon', username: 'polygon', displayName: 'Polygon', bio: 'Polygon is a gaming website that covers news, reviews, features, and video content.', website: 'https://www.polygon.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.polygon.com/rss/index.xml' },
  { id: 'news-eurogamer', username: 'eurogamer', displayName: 'Eurogamer', bio: 'Eurogamer is the leading video game website in Europe, covering news, reviews, and features.', website: 'https://www.eurogamer.net', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.eurogamer.net/?format=rss' },
  { id: 'news-destructoid', username: 'destructoid', displayName: 'Destructoid', bio: 'Destructoid is a video game blog that covers gaming news, reviews, and culture.', website: 'https://www.destructoid.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.destructoid.com/feed/' },
  { id: 'news-pcgamer', username: 'pcgamer', displayName: 'PC Gamer', bio: 'PC Gamer is the world\'s best-selling PC gaming magazine, covering news, reviews, and hardware.', website: 'https://www.pcgamer.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.pcgamer.com/rss' },
  { id: 'news-rockpapershotgun', username: 'rockpapershotgun', displayName: 'Rock Paper Shotgun', bio: 'Rock Paper Shotgun is a PC gaming website covering news, reviews, and features.', website: 'https://www.rockpapershotgun.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.rockpapershotgun.com/feed' },
  { id: 'news-vg247', username: 'vg247', displayName: 'VG247', bio: 'VG247 is a video game news website covering all major platforms.', website: 'https://www.vg247.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.vg247.com/feed' },
  { id: 'news-nintendolife', username: 'nintendolife', displayName: 'Nintendo Life', bio: 'Nintendo Life covers all things Nintendo: news, reviews, and features for Switch, 3DS, and more.', website: 'https://www.nintendolife.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.nintendolife.com/feed' },
  { id: 'news-pushsquare', username: 'pushsquare', displayName: 'Push Square', bio: 'Push Square is dedicated to PlayStation news, reviews, and community.', website: 'https://www.pushsquare.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.pushsquare.com/feed' },
  { id: 'news-purexbox', username: 'purexbox', displayName: 'Pure Xbox', bio: 'Pure Xbox covers Xbox news, reviews, and community content.', website: 'https://www.purexbox.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.purexbox.com/feed' },
  // Developer & Publisher Blogs (Official)
  { id: 'news-blizzard', username: 'blizzard', displayName: 'Blizzard News', bio: 'Official news from Blizzard Entertainment: Warcraft, Overwatch, Diablo, and more.', website: 'https://news.blizzard.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://news.blizzard.com/en-us/news?feed=rss' },
  { id: 'news-xboxwire', username: 'xboxwire', displayName: 'Xbox Wire', bio: 'Official Xbox news, game announcements, and updates.', website: 'https://news.xbox.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://news.xbox.com/en-us/feed/' },
  { id: 'news-playstation', username: 'playstation', displayName: 'PlayStation Blog', bio: 'Official PlayStation news, game releases, and community updates.', website: 'https://blog.playstation.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://blog.playstation.com/feed/' },
  { id: 'news-ubisoft', username: 'ubisoft', displayName: 'Ubisoft News', bio: 'Official Ubisoft news: game updates, events, and announcements.', website: 'https://news.ubisoft.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://news.ubisoft.com/en-us/rss' },
  { id: 'news-epicgames', username: 'epicgames', displayName: 'Epic Games News', bio: 'Official Epic Games news: Fortnite, Unreal Engine, and store updates.', website: 'https://www.epicgames.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.epicgames.com/site/en-US/news?lang=en-US&feed=rss' },
  { id: 'news-bethesda', username: 'bethesda', displayName: 'Bethesda Blog', bio: 'Official Bethesda Softworks news: Elder Scrolls, Fallout, Starfield.', website: 'https://bethesda.net', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://bethesda.net/en/dashboard?rss=news' },
  { id: 'news-squareenix', username: 'squareenix', displayName: 'Square Enix News', bio: 'Official Square Enix news: Final Fantasy, Kingdom Hearts, and more.', website: 'https://square-enix-games.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://square-enix-games.com/en-us/news.rss' },
  { id: 'news-cdprojekt', username: 'cdprojekt', displayName: 'CD Projekt Red', bio: 'Official CD Projekt Red news: Cyberpunk 2077, The Witcher.', website: 'https://www.cdprojektred.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.cdprojektred.com/en/news/feed' },
  { id: 'news-valve', username: 'valve', displayName: 'Valve News', bio: 'Official Steam and Valve news.', website: 'https://store.steampowered.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://store.steampowered.com/news/rss/' },
  // Industry & Indie (removed GamesIndustry.biz and Siliconera)
  { id: 'news-gamedeveloper', username: 'gamedeveloper', displayName: 'Game Developer', bio: 'Game Developer (formerly Gamasutra) covers game development, design, and industry trends.', website: 'https://www.gamedeveloper.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.gamedeveloper.com/feed' },
  { id: 'news-gematsu', username: 'gematsu', displayName: 'Gematsu', bio: 'Gematsu covers Japanese games, news, and updates.', website: 'https://www.gematsu.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.gematsu.com/feed' },
  { id: 'news-bluesnews', username: 'bluesnews', displayName: 'Blue\'s News', bio: 'Blue\'s News: long-standing source for game updates, patches, and industry news.', website: 'https://www.bluesnews.com', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://www.bluesnews.com/rss.xml' },
  { id: 'news-itchio', username: 'itchio', displayName: 'itch.io News', bio: 'New indie game releases and updates from itch.io.', website: 'https://itch.io', rssUrl: 'https://api.rss2json.com/v1/api.json?rss_url=https://itch.io/games/feed' },
];

// YouTube gaming channels — synced as Shorts (embed-only, zero storage).
const YOUTUBE_SHORTS_BOTS = [
  { id: 'yt-ign', username: 'ign_shorts', displayName: 'IGN Shorts', bio: 'Quick gaming clips from IGN', website: 'https://youtube.com/@IGN', channelId: 'UCKy1dAqELo0zrOtPkf0eTMw' },
  { id: 'yt-gamespot', username: 'gamespot_shorts', displayName: 'GameSpot Shorts', bio: 'Bite-sized gaming highlights from GameSpot', website: 'https://youtube.com/@GameSpot', channelId: 'UCbu2SsF1frCRhGXlSv85E_c' },
  { id: 'yt-nintendo', username: 'nintendo_shorts', displayName: 'Nintendo Shorts', bio: 'Official Nintendo clips and trailers', website: 'https://youtube.com/@NintendoAmerica', channelId: 'UCGIY_O-8vW4rfx98KlMkvRg' },
  { id: 'yt-playstation', username: 'playstation_shorts', displayName: 'PlayStation Shorts', bio: 'Official PlayStation clips', website: 'https://youtube.com/@PlayStation', channelId: 'UC-2Y8dQb0S6DtpxNgAKoJKA' },
  { id: 'yt-xbox', username: 'xbox_shorts', displayName: 'Xbox Shorts', bio: 'Official Xbox clips and highlights', website: 'https://youtube.com/@Xbox', channelId: 'UCXGgrKt94gR6lmN4aN3mYTg' },
  { id: 'yt-riotgames', username: 'riotgames_shorts', displayName: 'Riot Games Shorts', bio: 'LoL, Valorant, and TFT clips from Riot', website: 'https://youtube.com/@riotgames', channelId: 'UC0VmEGa2AAIMKL2HStZMCzA' },
];

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

// SEO-friendly slug for a news/article post: a readable title slug plus the
// content hash so it's unique even when two articles share a title (e.g.
// "werewolf-metroidvania-revealed-5k8ymm"). Used as the post's `slug` field +
// its canonical /post/<slug> URL; the doc id stays the dedup key.
function newsSlug(title, hash) {
  const base = String(title || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // strip accents (é -> e)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return base ? `${base}-${hash}` : `post-${hash}`;
}

// Official brand icon for a bot account — Google's public favicon service
// serves the outlet's own site icon (recognizable, official, always up,
// nothing scraped or rehosted). 128px is plenty for card avatars.
function botFavicon(siteUrl) {
  try { return `https://www.google.com/s2/favicons?sz=128&domain=${new URL(siteUrl).hostname}`; }
  catch { return null; }
}

// Brand sites for the YouTube shorts bots — their `website` is a youtube.com
// channel URL whose favicon is just the YouTube logo; use the actual brand
// domain for a recognizable avatar instead.
const SHORTS_BOT_BRAND_SITE = {
  'yt-ign': 'https://www.ign.com',
  'yt-gamespot': 'https://www.gamespot.com',
  'yt-nintendo': 'https://www.nintendo.com',
  'yt-playstation': 'https://www.playstation.com',
  'yt-xbox': 'https://www.xbox.com',
  'yt-riotgames': 'https://www.riotgames.com',
};

// Self-heal a bot account's branding: favicon avatar when missing, and the
// newest article/video image as the profile banner when missing. Runs every
// sync so new bots and bots whose first image arrives later both get covered.
async function healBotBranding(userRef, userData, { faviconSite, bannerCandidate = null }) {
  const updates = {};
  if (!userData.avatar && faviconSite) {
    const fav = botFavicon(faviconSite);
    if (fav) updates.avatar = fav;
  }
  if (!userData.banner) {
    let banner = bannerCandidate;
    if (!banner) {
      // Newest post by this bot that carries an image.
      try {
        const snap = await db.collection('posts')
          .where('authorId', '==', userRef.id)
          .orderBy('createdAt', 'desc')
          .limit(8).get();
        for (const d of snap.docs) {
          const p = d.data();
          const img = p.linkPreview?.image || p.thumbnailUrl || (p.mediaUrls || [])[0];
          if (img && /^https:\/\//.test(img)) { banner = img; break; }
        }
      } catch (err) { console.warn(`healBotBranding query failed ${userRef.id}:`, err.message); }
    }
    if (banner) updates.banner = banner;
  }
  if (Object.keys(updates).length > 0) {
    await userRef.update({ ...updates, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    console.log(`🎨 Bot branding healed: ${userRef.id} (${Object.keys(updates).join(', ')})`);
  }
}

const _syncNewsBotFeeds = defer('0 6 * * *', async () => {
    // KILL SWITCH — flip app_config/general.botsPaused = true in Firestore to halt all bot posting.
    const cfg = await db.collection('app_config').doc('general').get();
    if (cfg.exists && cfg.data()?.botsPaused === true) {
      console.log('[syncNewsBotFeeds] PAUSED via app_config.botsPaused — skipping run');
      return;
    }
    // STEP 1: Create ALL bot accounts (ignores RSS failures)
    for (const bot of NEWS_BOT_ACCOUNTS) {
      const userRef = db.collection('users').doc(bot.id);
      const snap = await userRef.get();
      if (snap.exists) {
        // Self-heal branding on existing bots (favicon avatar + newest
        // article image as banner — drives the Explore creator cards).
        await healBotBranding(userRef, snap.data() || {}, { faviconSite: bot.website });
      }
      if (!snap.exists) {
        await userRef.set({
          username: bot.username,
          displayName: bot.displayName,
          bio: bot.bio,
          avatar: botFavicon(bot.website),
          banner: null,
          website: bot.website,
          accountType: 'news_bot',
          isVerified: true,
          isOnboarded: true,
          followerCount: 0,
          followingCount: 0,
          postCount: 0,
          level: 0,
          totalXP: 0,
          tier: null,
          vp: 0,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`✅ Created bot account: ${bot.id}`);
      }
    }

    // STEP 2: Fetch RSS and sync posts. Limit is admin-configurable via
    // app_config/general.maxPostsPerBotPerRun (defaults to 2). Per-bot pause
    // is checked from each user doc's `botPaused` field.
    const cfgData = (cfg.exists && cfg.data()) || {};
    const PER_BOT_DAILY_LIMIT = Math.max(0, Number(cfgData.maxPostsPerBotPerRun ?? 2));
    let totalCreated = 0;
    for (const bot of NEWS_BOT_ACCOUNTS) {
      try {
        // Per-bot pause check
        const botSnap = await db.collection('users').doc(bot.id).get();
        if (botSnap.exists && botSnap.data()?.botPaused === true) {
          console.log(`[syncNewsBotFeeds] ${bot.id} paused — skipping`);
          continue;
        }
        let botHasBanner = !!(botSnap.exists && botSnap.data()?.banner);
        const response = await axios.get(bot.rssUrl, { timeout: 10000 });
        // Pull a small candidate window — we only need enough headroom to
        // skip already-ingested items and still find ~2 fresh ones.
        const items = (response.data?.items || []).slice(0, 6);
        let createdForThisBot = 0;
        for (const item of items) {
          if (createdForThisBot >= PER_BOT_DAILY_LIMIT) break;
          if (!item.link) continue;
          const linkHash = hashString(item.link);
          const postId = `${bot.id}-${linkHash}`;
          const postRef = db.collection('posts').doc(postId);
          const postSnap = await postRef.get();
          if (postSnap.exists) continue;

          // Extract image (enclosure, description, thumbnail)
          let imageUrl = null;
          if (item.enclosure && item.enclosure.url && item.enclosure.type?.startsWith('image/')) {
            imageUrl = item.enclosure.url;
          } else if (item.description) {
            const imgMatch = item.description.match(/<img[^>]+src="([^">]+)"/);
            if (imgMatch) imageUrl = imgMatch[1];
          } else if (item.thumbnail) {
            imageUrl = item.thumbnail;
          }
          if (imageUrl && !imageUrl.startsWith('http')) imageUrl = null;

          // Clean preview (first 300 chars of description)
          let cleanPreview = (item.description || '')
            .replace(/<[^>]*>/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 300);
          if (cleanPreview.length === 0) cleanPreview = item.title || '';

          await postRef.set({
            authorId: bot.id,
            content: item.title || '',
            type: 'text',
            slug: newsSlug(item.title, linkHash),
            mediaUrls: imageUrl ? [imageUrl] : [],
            hashtags: [],
            likeCount: 0,
            commentCount: 0,
            shareCount: 0,
            saveCount: 0,
            viewCount: 0,
            status: 'published',
            rankScore: 0,
            sourceUrl: item.link,
            isNewsPost: true,
            previewText: cleanPreview,
            needsEnrichment: true,
            needsSeoRewrite: true,
            linkPreview: {
              url: item.link,
              title: item.title || '',
              description: cleanPreview,
              image: imageUrl,
            },
            createdAt: item.pubDate ? new Date(item.pubDate) : new Date(),
            updatedAt: new Date(),
          });

          const botUpdate = { postCount: admin.firestore.FieldValue.increment(1) };
          // First image we see while the bot has no banner = its banner
          // (newest article art keeps the Explore card fresh + relevant).
          if (!botHasBanner && imageUrl) {
            botUpdate.banner = imageUrl;
            botHasBanner = true;
          }
          await db.collection('users').doc(bot.id).update(botUpdate);
          totalCreated++;
          createdForThisBot++;
        }
      } catch (err) {
        console.error(`RSS sync failed for ${bot.id}:`, err.message);
      }
    }
    console.log(`RSS sync complete. Created ${totalCreated} new posts.`);

    // STEP 3: Sync YouTube Shorts (embed-only, zero storage cost)
    let shortsCreated = 0;
    for (const bot of YOUTUBE_SHORTS_BOTS) {
      try {
        // Ensure bot account exists
        const userRef = db.collection('users').doc(bot.id);
        const snap = await userRef.get();
        const brandSite = SHORTS_BOT_BRAND_SITE[bot.id] || bot.website;
        if (!snap.exists) {
          await userRef.set({
            username: bot.username, displayName: bot.displayName, bio: bot.bio,
            avatar: botFavicon(brandSite), banner: null, website: bot.website,
            accountType: 'shorts_bot', isVerified: true, isOnboarded: true,
            followerCount: 0, followingCount: 0, postCount: 0,
            level: 0, totalXP: 0, tier: null, vp: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } else {
          await healBotBranding(userRef, snap.data() || {}, { faviconSite: brandSite });
        }

        const rssUrl = `https://api.rss2json.com/v1/api.json?rss_url=https://www.youtube.com/feeds/videos.xml?channel_id=${bot.channelId}`;
        const response = await axios.get(rssUrl, { timeout: 10000 });
        const items = (response.data?.items || []).slice(0, 6);
        let createdForBot = 0;

        for (const item of items) {
          if (createdForBot >= 2) break;
          if (!item.link) continue;

          // Extract YouTube video ID
          const vidMatch = item.link.match(/[?&]v=([\w-]+)/);
          const videoId = vidMatch ? vidMatch[1] : null;
          if (!videoId) continue;

          const linkHash = hashString(item.link);
          const postId = `${bot.id}-${linkHash}`;
          const postRef = db.collection('posts').doc(postId);
          const postSnap = await postRef.get();
          if (postSnap.exists) continue;

          await postRef.set({
            authorId: bot.id,
            // YouTube embeds can't play in the native Shorts/Clips vertical
            // viewers (those need uploaded video), so a 'short' type just made
            // a dead grey tile. Keep as a regular post — PostCard renders the
            // YouTube embed inline from youtubeVideoId.
            content: item.title || '',
            type: 'text',
            slug: newsSlug(item.title, linkHash),
            mediaUrls: [],
            hashtags: [],
            embedVideoUrl: item.link,
            youtubeVideoId: videoId,
            thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
            likeCount: 0, commentCount: 0, shareCount: 0, saveCount: 0, viewCount: 0,
            status: 'published',
            rankScore: 0,
            sourceUrl: item.link,
            isNewsPost: true,
            needsSeoRewrite: true,
            createdAt: item.pubDate ? new Date(item.pubDate) : new Date(),
            updatedAt: new Date(),
          });
          await userRef.update({ postCount: admin.firestore.FieldValue.increment(1) });
          shortsCreated++;
          createdForBot++;
        }
      } catch (err) {
        console.error(`YouTube shorts sync failed for ${bot.id}:`, err.message);
      }
    }
    console.log(`YouTube shorts sync complete. Created ${shortsCreated} shorts.`);
  });

// ──────────────────────────────────────────────────────────────
// HELPER: Extract YouTube ID from URL
// ──────────────────────────────────────────────────────────────
function getYouTubeId(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([\w-]+)/,
    /(?:youtu\.be\/)([\w-]+)/,
    /(?:youtube\.com\/embed\/)([\w-]+)/,
    /(?:youtube\.com\/v\/)([\w-]+)/,
  ];
  for (const p of patterns) {
    const match = url.match(p);
    if (match) return match[1];
  }
  return null;
}

// ──────────────────────────────────────────────────────────────
// HELPER: Extract first paragraph or YouTube video from article
// ──────────────────────────────────────────────────────────────
async function extractFirstParagraphOrVideo(url) {
  try {
    const response = await axios.get(url, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ContentBot/1.0)' } });
    const $ = cheerio.load(response.data);

    // Look for YouTube video
    let youtubeId = null;
    const ogVideo = $('meta[property="og:video"]').attr('content');
    const ogVideoUrl = $('meta[property="og:video:url"]').attr('content');
    const twitterPlayer = $('meta[name="twitter:player"]').attr('content');
    if (ogVideo) youtubeId = getYouTubeId(ogVideo);
    if (!youtubeId && ogVideoUrl) youtubeId = getYouTubeId(ogVideoUrl);
    if (!youtubeId && twitterPlayer) youtubeId = getYouTubeId(twitterPlayer);
    if (!youtubeId) {
      $('iframe[src*="youtube.com"]').each((i, el) => {
        const src = $(el).attr('src');
        if (src && !youtubeId) youtubeId = getYouTubeId(src);
      });
    }
    if (!youtubeId) {
      $('a[href*="youtube.com/watch"]').each((i, el) => {
        const href = $(el).attr('href');
        if (href && !youtubeId) youtubeId = getYouTubeId(href);
      });
    }
    if (youtubeId) {
      return { type: 'video', youtubeId };
    }

    // No video – extract first TWO paragraphs so the client always needs a "Read more".
    let paragraphs = [];
    const selectors = ['article p', '.post-content p', '.entry-content p', '.content p', 'main p', 'p'];
    for (const sel of selectors) {
      const found = $(sel);
      if (found.length) {
        found.each((i, el) => {
          if (paragraphs.length >= 2) return;
          const txt = $(el).text().replace(/\s+/g, ' ').trim();
          // Skip short fragments, bylines, image captions
          if (txt.length > 60) paragraphs.push(txt);
        });
        if (paragraphs.length >= 2) break;
      }
    }
    let combined = paragraphs.join('\n\n');
    if (!combined) {
      combined = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 1600);
    }
    // Cap at ~1600 chars so the UI always has enough to require a "Read more"
    combined = combined.slice(0, 1600);
    return { type: 'text', text: combined || null };
  } catch (err) {
    console.error(`Error processing ${url}:`, err.message);
    return { type: 'text', text: null };
  }
}

// ──────────────────────────────────────────────────────────────
// ENRICHMENT FUNCTION (runs once per day, right after RSS sync)
// With the per-bot daily cap of 2 posts, ~54 docs/day max — one
// run with a larger batch easily clears the queue.
// ──────────────────────────────────────────────────────────────
const _enrichNewsPosts = defer('30 6 * * *', async () => {
    // KILL SWITCH — same flag as syncNewsBotFeeds.
    const cfg = await db.collection('app_config').doc('general').get();
    if (cfg.exists && cfg.data()?.botsPaused === true) {
      console.log('[enrichNewsPosts] PAUSED via app_config.botsPaused — skipping run');
      return;
    }
    const postsRef = db.collection('posts');
    const batchSize = 25;
    let processed = 0;
    let snapshot = await postsRef.where('needsEnrichment', '==', true).where('sourceUrl', '!=', null).limit(batchSize).get();
    while (!snapshot.empty) {
      const batch = db.batch();
      for (const doc of snapshot.docs) {
        const post = doc.data();
        const url = post.sourceUrl;
        if (!url) continue;
        const result = await extractFirstParagraphOrVideo(url);
        const updateData = { needsEnrichment: false, enrichedAt: admin.firestore.FieldValue.serverTimestamp() };
        if (result.type === 'video') {
          updateData.youtubeVideoId = result.youtubeId;
          // News-bot videos are YouTube EMBEDS — they can't play in the
          // TikTok-style Clips/Shorts vertical viewers (which need native
          // uploaded video), so they rendered as dead grey tiles there.
          // Keep them as regular posts (type stays 'text'); PostCard renders
          // the YouTube embed inline from youtubeVideoId. Do NOT set type:'clip'.
          // CRITICAL: clear any stale mediaUrls/mediaUrl left over from the
          // initial ingest (they contained the article hero image and would
          // make PostCard render a broken <video> element on top of the embed).
          updateData.mediaUrls = [];
          updateData.mediaUrl = null;
          // Keep previewText so we still show article text above the video.
        } else if (result.text && result.text.length > 50) {
          updateData.previewText = result.text;
        }
        batch.update(doc.ref, updateData);
        processed++;
      }
      await batch.commit();
      snapshot = await postsRef.where('needsEnrichment', '==', true).where('sourceUrl', '!=', null).limit(batchSize).get();
    }
    console.log(`Enriched ${processed} news posts (videos or paragraphs).`);
  });

// ──────────────────────────────────────────────────────────────
// ONE-TIME BACKFILL: clean up existing news posts that have both
// a youtubeVideoId AND stale mediaUrls causing a ghost video player.
// Also re-enrich any posts whose previewText is still just the title.
// ──────────────────────────────────────────────────────────────
exports.backfillNewsPosts = functions.https.onRequest(async (req, res) => {
  const postsRef = db.collection('posts');
  const snap = await postsRef.where('isNewsPost', '==', true).limit(500).get();
  let cleaned = 0;
  let requeued = 0;
  let retyped = 0;
  const batch = db.batch();
  for (const d of snap.docs) {
    const p = d.data();
    const updates = {};
    // 0) Bot YouTube-embed posts wrongly typed as clip/short — they can't play
    //    in the native vertical viewers and showed as dead grey tiles. Revert
    //    to a regular post so PostCard renders the embed inline.
    if ((p.youtubeVideoId || p.embedVideoUrl) && (p.type === 'clip' || p.type === 'short')) {
      updates.type = 'text';
      retyped++;
    }
    // 1) Embed posts with stale mediaUrls
    if ((p.youtubeVideoId || p.embedVideoUrl) && (Array.isArray(p.mediaUrls) ? p.mediaUrls.length > 0 : !!p.mediaUrl)) {
      updates.mediaUrls = [];
      updates.mediaUrl = null;
      cleaned++;
    }
    // 2) Posts whose previewText is still just the title or missing —
    //    re-queue for enrichment so they get the 2-paragraph version.
    const pt = (p.previewText || '').trim();
    const title = (p.content || '').trim();
    if (p.sourceUrl && (!pt || pt === title || pt.length < 120)) {
      updates.needsEnrichment = true;
      requeued++;
    }
    if (Object.keys(updates).length > 0) batch.update(d.ref, updates);
  }
  await batch.commit();
  res.status(200).json({ scanned: snap.size, cleaned, requeued, retyped });
});

// ──────────────────────────────────────────────────────────────
// MANUAL TRIGGER TO CREATE ALL BOT ACCOUNTS IMMEDIATELY
// ──────────────────────────────────────────────────────────────
exports.createNewsBots = functions.https.onRequest(async (req, res) => {
  let created = 0;
  let existing = 0;

  for (const bot of NEWS_BOT_ACCOUNTS) {
    const userRef = db.collection('users').doc(bot.id);
    const snap = await userRef.get();
    if (!snap.exists) {
      await userRef.set({
        username: bot.username,
        displayName: bot.displayName,
        bio: bot.bio,
        avatar: null,
        banner: null,
        website: bot.website,
        accountType: 'news_bot',
        isVerified: true,
        isOnboarded: true,
        followerCount: 0,
        followingCount: 0,
        postCount: 0,
        level: 0,
        totalXP: 0,
        tier: null,
        vp: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      created++;
    } else {
      existing++;
    }
  }

  res.status(200).send(`✅ Created ${created} new bot accounts. ${existing} already existed.`);
});

// ──────────────────────────────────────────────────────────────
// AUTH TRIGGERS (v1 API — no v2 equivalent for onCreate/onDelete)
// ──────────────────────────────────────────────────────────────

exports.onUserCreated = functionsV1.region('europe-west1').auth.user().onCreate(async (user) => {
  const batch = db.batch();
  batch.set(db.collection('users').doc(user.uid), {
    uid: user.uid,
    email: user.email || null,
    displayName: user.displayName || null,
    username: null,
    avatar: user.photoURL || null,
    banner: null,
    bio: '',
    role: 'user',
    verificationTier: null,
    isOnboarded: false,
    followerCount: 0,
    followingCount: 0,
    postCount: 0,
    coinBalance: 0,
    gameTags: [],
    linkedAccounts: {},
    settings: {
      pushNotifications: true,
      emailNotifications: true,
      dmPrivacy: 'everyone',
      profileVisibility: 'public',
      activityStatus: true,
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastActiveAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  batch.set(db.collection('wallets').doc(user.uid), {
    userId: user.uid,
    balance: 0,
    gems: 0,
    vp: 0,
    totalEarned: 0,
    totalSpent: 0,
    totalTipped: 0,
    totalReceived: 0,
    // Revenue share owed to this user, in micro-USD. Seeded so the Earnings
    // screen and the payout engine never read undefined.
    owedMicroUsd: 0,
    totalOwedMicroUsd: 0,
    totalPaidMicroUsd: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  batch.set(db.collection('notifications').doc(), {
    recipientId: user.uid,
    type: 'system',
    title: 'Welcome to VERGR! 🎮',
    body: 'Where Gamers Converge. Complete your profile to get started.',
    read: false,
    actionUrl: '/onboarding',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await batch.commit();
  console.log(`New user created: ${user.uid}`);
});

exports.onUserDeleted = functionsV1.region('europe-west1').auth.user().onDelete(async (user) => {
  await db.collection('users').doc(user.uid).update({
    deleted: true,
    deletedAt: admin.firestore.FieldValue.serverTimestamp(),
    displayName: 'Deleted User',
    username: null,
    avatar: null,
    banner: null,
    bio: '',
    email: null,
  });
  // GDPR Article 17 — erase KYC data + encrypted documents
  await kyc.purgeKycForUser(user.uid);
  console.log(`User deleted (soft) + KYC purged: ${user.uid}`);
});

// ──────────────────────────────────────────────────────────────
// FIRESTORE TRIGGERS — NOTIFICATIONS
// ──────────────────────────────────────────────────────────────

exports.onNewFollower = functions.firestore
  .onDocumentCreated({ document: 'follows/{followId}', database: 'vgrdb', secrets: HUAWEI_PUSH_SECRETS }, async (event) => {
    const data = event.data.data();
    const { followerId, followingId } = data;
    try {
      const follower = await db.collection('users').doc(followerId).get();
      const followerName = follower.exists ? (follower.data().displayName || 'Someone') : 'Someone';

      const batch = db.batch();
      batch.update(db.collection('users').doc(followerId), { followingCount: admin.firestore.FieldValue.increment(1) });
      batch.update(db.collection('users').doc(followingId), { followerCount: admin.firestore.FieldValue.increment(1) });
      batch.set(db.collection('notifications').doc(), {
        recipientId: followingId,
        type: 'follow',
        title: 'New follower',
        body: `${followerName} started following you`,
        senderId: followerId,
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await batch.commit();

      await sendPushToUser(followingId, 'New follower', `${followerName} started following you`, { type: 'follow', senderId: followerId });
    } catch (err) { console.error('onNewFollower error:', err); }
  });

// onStreamWentLive — when a public stream flips to 'live', notify the host's
// followers once ("X is live"). Opt-out via streams/{id}.notifyFollowers===false.
// Deduped with a wentLiveNotified flag so a re-render / status churn can't
// double-fire. Capped fan-out via sendPushToAll.
exports.onStreamWentLive = functions.firestore
  .onDocumentUpdated({ document: 'streams/{streamId}', database: 'vgrdb' }, async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    const streamId = event.params.streamId;
    const becameLive = before.status !== 'live' && after.status === 'live';
    if (!becameLive) return;
    // Engagement VP for going live (capped per UTC day). Awarded before the
    // notification early-returns below so a friends-only or 0-follower stream
    // still earns it. `becameLive` guards against re-award on later updates.
    if (after.hostUid) {
      try {
        const { creditEngagementVp } = require('./engagementVp');
        await creditEngagementVp(db, after.hostUid, 'go_live');
      } catch (e) { console.error('go_live VP failed', streamId, e?.message || e); }
    }
    if (after.wentLiveNotified === true) return;
    if (after.notifyFollowers === false) return;
    // Only public / followers-audience streams ping followers (not friends-only).
    if (after.audience && !['public', 'followers'].includes(after.audience)) return;
    const hostUid = after.hostUid;
    if (!hostUid) return;
    try {
      // Claim the notify slot first (idempotent guard).
      await db.collection('streams').doc(streamId).update({ wentLiveNotified: true });
      const host = await db.collection('users').doc(hostUid).get();
      const hostName = host.exists ? (host.data().displayName || host.data().username || 'Someone') : 'Someone';
      const followersSnap = await db.collection('users').doc(hostUid)
        .collection('followers').limit(5000).get();
      const followerIds = followersSnap.docs.map(d => d.id).filter(id => id !== hostUid);
      if (followerIds.length === 0) return;
      const title = `${hostName} is live`;
      const body = after.title ? `${after.title}` : 'Tap to watch the stream';
      await sendPushToAll(followerIds, title, body, {
        type: 'stream_live',
        streamId,
        senderId: hostUid,
        actionUrl: `/watch/${streamId}`,
      });
    } catch (err) { console.error('onStreamWentLive error:', err); }
  });

// notifyScheduledStreams — reminder cron for schedule-ahead streams. A host can
// schedule a stream from Go Live (scheduled_streams/{id}, status:'scheduled').
// ~10 min before scheduledStart we ping the host to go live and, if
// notifyFollowers, ping their followers ("X is going live soon"). If the host is
// already live we link the doc as 'started' (no reminder). Docs >3h past a
// missed start are expired so they don't linger. €0: one small query every 5
// min + direct pushes (no per-message Firestore fan-out).
const _notifyScheduledStreams = defer('*/5 * * * *', async () => {
    const now = Date.now();
    const DUE_WINDOW = 10 * 60 * 1000;   // remind within 10 min of start
    const STALE = 3 * 60 * 60 * 1000;    // expire 3h after a missed start
    let snap;
    try {
      snap = await db.collection('scheduled_streams').where('status', '==', 'scheduled').limit(200).get();
    } catch (e) { console.error('notifyScheduledStreams query', e); return; }
    for (const docSnap of snap.docs) {
      const s = docSnap.data();
      const start = Number(s.scheduledStart) || 0;
      if (!start) continue;
      try {
        if (start < now - STALE) { await docSnap.ref.update({ status: 'expired' }); continue; }
        if (start > now + DUE_WINDOW) continue;   // not due yet
        if (s.reminderSentAt) continue;           // already reminded
        const hostUid = s.hostUid;
        if (!hostUid) continue;
        // Already live → link the schedule + skip the reminder.
        const liveSnap = await db.collection('streams')
          .where('hostUid', '==', hostUid).where('status', '==', 'live').limit(1).get();
        if (!liveSnap.empty) {
          await docSnap.ref.update({ status: 'started', startedStreamId: liveSnap.docs[0].id });
          continue;
        }
        await docSnap.ref.update({ reminderSentAt: admin.firestore.FieldValue.serverTimestamp() });
        // Host gets BOTH channels: an in-app drawer entry (this doc) +, because
        // the type is allowlisted, onNotificationCreated fires the push.
        await db.collection('notifications').add({
          recipientId: hostUid,
          type: 'stream_scheduled_reminder',
          title: 'Your scheduled stream starts soon',
          body: s.title ? `Time to go live: ${s.title}` : 'Tap to start your stream',
          actionUrl: '/go-live',
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        // Followers get a push heads-up (same pattern as onStreamWentLive — no
        // per-follower drawer docs, to avoid N Firestore writes per stream).
        if (s.notifyFollowers !== false) {
          const host = await db.collection('users').doc(hostUid).get();
          const hostName = host.exists ? (host.data().displayName || host.data().username || 'Someone') : 'Someone';
          const followersSnap = await db.collection('users').doc(hostUid).collection('followers').limit(5000).get();
          const followerIds = followersSnap.docs.map(d => d.id).filter(id => id !== hostUid);
          if (followerIds.length) {
            await sendPushToAll(followerIds, `${hostName} is going live soon`,
              s.title ? s.title : 'Tap to catch the stream',
              { type: 'stream_scheduled_soon', senderId: hostUid, actionUrl: `/user/${hostUid}` });
          }
        }
      } catch (e) { console.error('notifyScheduledStreams item', docSnap.id, e); }
    }
  });

// onCallCreated — push an incoming-call notification to the callee(s) the moment
// a ringing call doc is written. The in-app overlay (IncomingCallOverlay) covers
// the foreground case; this covers backgrounded/closed apps. Gated by the
// 'calls' notification category (default on). Web-push can't play a custom
// ringtone on a closed app (OS limit), but the notification will show + tapping
// opens the call.
exports.onCallCreated = functions.firestore
  .onDocumentWritten({ document: 'calls/{callId}', database: 'vgrdb', secrets: HUAWEI_PUSH_SECRETS }, async (event) => {
    const before = event.data?.before?.data() || null;
    const after = event.data?.after?.data() || null;
    if (!after || after.status !== 'ringing') return;
    // CRITICAL: call docs reuse the conversation id (calls/{chatId}), so a
    // repeat call is an UPDATE of an existing (ended) doc, NOT a create. The
    // old onDocumentCreated trigger therefore never fired for any call after
    // the first one. Fire on the transition INTO ringing instead.
    if (before && before.status === 'ringing') return;
    const c = after;
    const callId = event.params.callId;
    const callerId = c.callerId;
    const callees = (c.participants || []).filter((uid) => uid && uid !== callerId);
    if (callees.length === 0) return;
    const callerName = c.callerName || 'Someone';
    const type = c.type === 'video' ? 'video' : 'audio';
    // A GROUP call rides the SFU (/group-call); a 1:1 stays raw WebRTC P2P
    // (/call). Sending a group callee to the P2P route would drop them into a
    // mesh that cannot work — the route MUST follow the call kind.
    const isGroup = c.isGroup === true;
    const title = isGroup
      ? `${c.groupName || 'Group'} call`
      : `${callerName} is calling`;
    const body = isGroup
      ? `${callerName} started a ${type === 'video' ? 'video' : 'voice'} call`
      : (type === 'video' ? 'Incoming video call' : 'Incoming voice call');
    try {
      await Promise.allSettled(callees.map((uid) => sendPushToUser(uid, title, body, {
        type: 'incoming_call',
        callId,
        callType: type,
        senderId: callerId || '',
        isGroup: isGroup ? 'true' : 'false',
        actionUrl: isGroup ? `/group-call/${callId}` : `/call/${callId}/${type}?role=callee`,
      })));
    } catch (err) { console.error('onCallCreated error:', err); }
  });

exports.onNewComment = functions.firestore
  .onDocumentCreated({ document: 'posts/{postId}/comments/{commentId}', database: 'vgrdb', secrets: HUAWEI_PUSH_SECRETS }, async (event) => {
    const postId = event.params.postId;
    const comment = event.data.data();
    try {
      const post = await db.collection('posts').doc(postId).get();
      if (!post.exists) return;
      const authorId = post.data().authorId;

      await db.collection('posts').doc(postId).update({ commentCount: admin.firestore.FieldValue.increment(1) });

      // Engagement VP: the POST AUTHOR earns for receiving a comment (never for
      // commenting on their own post). Capped per UTC day inside the helper.
      if (authorId && authorId !== comment.authorId) {
        try {
          const { creditEngagementVp } = require('./engagementVp');
          await creditEngagementVp(db, authorId, 'get_comment');
        } catch (e) { console.error('get_comment VP failed', postId, e?.message || e); }
      }

      const commenter = await db.collection('users').doc(comment.authorId).get();
      const commenterName = commenter.exists ? (commenter.data().displayName || 'Someone') : 'Someone';
      const preview = (comment.content || '').substring(0, 100);

      // B5: a reply (parentId set) notifies the PARENT COMMENT author. Resolve
      // them first so we can also avoid double-notifying the post author below.
      let parentAuthorId = null;
      if (comment.parentId) {
        const parent = await db.collection('posts').doc(postId).collection('comments').doc(comment.parentId).get().catch(() => null);
        parentAuthorId = parent && parent.exists ? parent.data().authorId : null;
        if (parentAuthorId && parentAuthorId !== comment.authorId) {
          await db.collection('notifications').add({
            recipientId: parentAuthorId,
            type: 'comment_reply',
            title: 'New reply',
            body: `${commenterName} replied to your comment`,
            senderId: comment.authorId,
            data: { postId, commentId: event.params.commentId, parentId: comment.parentId },
            read: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          await sendPushToUser(parentAuthorId, 'New reply', `${commenterName}: ${preview}`, { type: 'comment_reply', postId });
        }
      }

      // Post-author notification — skip when they authored the comment, or when
      // they already got the reply notification above (they were the parent).
      if (authorId === comment.authorId || authorId === parentAuthorId) return;

      await db.collection('notifications').add({
        recipientId: authorId,
        type: 'comment',
        title: 'New comment',
        body: `${commenterName} commented on your post`,
        senderId: comment.authorId,
        data: { postId, commentId: event.params.commentId },
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await sendPushToUser(authorId, 'New comment', `${commenterName}: ${preview}`, { type: 'comment', postId });
    } catch (err) { console.error('onNewComment error:', err); }
  });

// Engagement VP for creating a post. Posts are written client-side, so the VP
// (advertised on /prestige "How to earn") has to be granted from a trigger. The
// per-UTC-day cap in creditEngagementVp stops this being a spam faucet. Bots and
// drafts/scheduled posts are excluded (a scheduled post that is created now and
// published later by the cron deliberately does not earn create_post VP).
exports.onPostCreatedAwardVp = functions.firestore
  .onDocumentCreated({ document: 'posts/{postId}', database: 'vgrdb' }, async (event) => {
    const post = event.data?.data();
    if (!post) return;
    if (post.status && post.status !== 'published') return;
    const authorId = post.authorId;
    if (!authorId) return;
    if (String(post.authorAccountType || '').includes('bot')) return;
    try {
      const { creditEngagementVp } = require('./engagementVp');
      await creditEngagementVp(db, authorId, 'create_post');
    } catch (e) { console.error('create_post VP failed', event.params.postId, e?.message || e); }

    // Milestone counter for the "Clipped" badge. Rides THIS trigger, which
    // already fires on every post create, so it adds no invocation — only one
    // conditional write on the small fraction of posts that are clips.
    // `postCount` already covers posts, so only the clip case needs a field.
    if (post.type === 'clip') {
      try {
        await db.collection('users').doc(authorId)
          .set({ clipCount: admin.firestore.FieldValue.increment(1) }, { merge: true });
      } catch (e) { console.error('clipCount failed', event.params.postId, e?.message || e); }
    }
  });

const MESSAGE_TYPE_LABELS = {
  image: 'a photo', video: 'a video', voice: 'a voice message',
  audio: 'an audio file', giphy: 'a GIF', file: 'a file',
  sticker: 'a sticker', clip: 'a clip', meme: 'a meme',
  location: 'a location', contact: 'a contact', wallet: 'coins',
};

function buildPreview(message) {
  const text = (message.text || message.content || '').substring(0, 100);
  if (text) return text;
  return `Sent ${MESSAGE_TYPE_LABELS[message.type] || 'a message'}`;
}

exports.onNewMessage = functions.firestore
  .onDocumentCreated({ document: 'conversations/{convoId}/messages/{messageId}', database: 'vgrdb', secrets: HUAWEI_PUSH_SECRETS }, async (event) => {
    const convoId = event.params.convoId;
    const message = event.data.data();
    // Skip — relayMessage already handled push + metadata
    if (message._relayed) return;
    try {
      const preview = buildPreview(message);
      await db.collection('conversations').doc(convoId).update({
        lastMessageText: preview,
        lastMessage: preview, // keep old field for backward compat
        lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
        lastMessageBy: message.senderId,
        lastMessageSenderId: message.senderId,
      });

      const convo = await db.collection('conversations').doc(convoId).get();
      if (!convo.exists) return;

      const participants = convo.data().participants || [];
      const sender = await db.collection('users').doc(message.senderId).get();
      const senderData = sender.exists ? sender.data() : {};
      const senderName = senderData.displayName || 'Someone';
      const senderAvatar = senderData.photoURL || senderData.avatar || senderData.profilePicture || null;

      for (const pid of participants) {
        if (pid === message.senderId) continue;
        await sendPushToUser(pid, senderName, preview, {
          type: 'message',
          conversationId: convoId,
          senderId: message.senderId,
          senderAvatar: senderAvatar || '',
        });
      }
    } catch (err) { console.error('onNewMessage error:', err); }
  });

// ──────────────────────────────────────────────────────────────
// RELAY MESSAGE — single callable that writes message + metadata + push
// Replaces the trigger-based flow for the primary send path. The trigger
// remains as a fallback for direct Firestore writes (e.g. the offline
// outbox falling back when the callable is unreachable).
// ──────────────────────────────────────────────────────────────
exports.relayMessage = functions.https.onCall({ secrets: HUAWEI_PUSH_SECRETS }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');

  const { chatId, text = '', type = 'text', contentUrl = null, videoUrl = null,
          fileName = null, fileSize = null, fileMime = null, duration = null,
          replyTo = null, contact = null, location = null, wallet = null,
          forwarded = null, thumbnailBase64 = null, stickerUrl = null,
          width = null, height = null, clientId = null } = request.data || {};

  if (!chatId) throw new functions.https.HttpsError('invalid-argument', 'chatId required');

  // 1. Verify participant
  const convoRef = db.collection('conversations').doc(chatId);
  const convo = await convoRef.get();
  if (!convo.exists) throw new functions.https.HttpsError('not-found', 'Conversation not found');
  const participants = convo.data().participants || [];
  if (!participants.includes(uid)) {
    throw new functions.https.HttpsError('permission-denied', 'Not a participant');
  }

  // 2. Build message doc (strip nulls to keep Firestore tidy)
  const msgData = {
    senderId: uid,
    text: (text || '').substring(0, 4000),
    type,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    _relayed: true,
  };
  if (contentUrl) msgData.contentUrl = contentUrl;
  if (videoUrl) msgData.videoUrl = videoUrl;
  if (fileName) msgData.fileName = fileName;
  if (fileSize) msgData.fileSize = fileSize;
  if (fileMime) msgData.fileMime = fileMime;
  if (duration) msgData.duration = duration;
  if (replyTo) msgData.replyTo = replyTo;
  if (contact) msgData.contact = contact;
  if (location) msgData.location = location;
  if (wallet) msgData.wallet = wallet;
  if (forwarded) msgData.forwarded = forwarded;
  if (thumbnailBase64) msgData.thumbnailBase64 = String(thumbnailBase64).substring(0, 2000);
  if (stickerUrl) msgData.stickerUrl = stickerUrl;
  if (width) msgData.width = width;
  if (height) msgData.height = height;
  if (clientId) msgData.clientId = clientId;

  // 3. Write message
  const msgRef = await convoRef.collection('messages').add(msgData);

  // 4. Update conversation metadata (correct field names the inbox reads)
  const preview = buildPreview(msgData);
  const unreadUpdates = {};
  for (const pid of participants) {
    if (pid !== uid) unreadUpdates[`unreadCount.${pid}`] = admin.firestore.FieldValue.increment(1);
  }
  await convoRef.update({
    lastMessageText: preview,
    lastMessage: preview,
    lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
    lastMessageSenderId: uid,
    lastMessageBy: uid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...unreadUpdates,
  });

  // 5. Push to other participants — batched multicast for group efficiency
  try {
    const sender = await db.collection('users').doc(uid).get();
    const senderData = sender.exists ? sender.data() : {};
    const senderName = senderData.displayName || 'Someone';
    const senderAvatar = senderData.photoURL || senderData.avatar || senderData.profilePicture || '';

    // Collect all tokens in parallel
    const otherPids = participants.filter(p => p !== uid);
    const fcmDocs = await Promise.all(
      otherPids.map(pid => db.collection('users').doc(pid).collection('private').doc('fcm').get())
    );
    const userDocs = await Promise.all(
      otherPids.map(pid => db.collection('users').doc(pid).get())
    );

    const allTokens = [];
    const tokenToUser = new Map();
    fcmDocs.forEach((fcmDoc, i) => {
      const pid = otherPids[i];
      const userDoc = userDocs[i];
      if (userDoc.exists && userDoc.data()?.settings?.pushNotifications === false) return;
      const tokens = fcmDoc.exists ? (fcmDoc.data()?.tokens || []) : [];
      for (const t of tokens) {
        allTokens.push(t);
        tokenToUser.set(t, pid);
      }
    });

    if (allTokens.length > 0) {
      const payload = {
        title: senderName,
        body: preview,
        type: 'message',
        conversationId: chatId,
        senderId: uid,
        senderAvatar,
      };
      const response = await admin.messaging().sendEachForMulticast({
        tokens: allTokens,
        data: Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, String(v ?? '')])),
      });
      // Clean up invalid tokens in bulk
      const invalidByUser = new Map();
      response.responses.forEach((r, i) => {
        if (!r.success && (r.error?.code === 'messaging/invalid-registration-token' ||
                           r.error?.code === 'messaging/registration-token-not-registered')) {
          const pid = tokenToUser.get(allTokens[i]);
          if (!pid) return;
          const arr = invalidByUser.get(pid) || [];
          arr.push(allTokens[i]);
          invalidByUser.set(pid, arr);
        }
      });
      for (const [pid, invalid] of invalidByUser) {
        await db.collection('users').doc(pid).collection('private').doc('fcm')
          .update({ tokens: admin.firestore.FieldValue.arrayRemove(...invalid) }).catch(() => {});
      }
    }
    // Huawei (HMS) push for the same recipients — isolated from FCM, no-op
    // until the HUAWEI_PUSH_* secrets hold real values.
    try {
      const hmsPayload = {
        title: senderName, body: preview, type: 'message',
        conversationId: chatId, senderId: uid, senderAvatar,
      };
      await Promise.all(otherPids.map(async (pid, i) => {
        const userDoc = userDocs[i];
        if (userDoc?.exists && userDoc.data()?.settings?.pushNotifications === false) return;
        const fcmDoc = fcmDocs[i];
        const hmsTokens = fcmDoc?.exists ? (fcmDoc.data()?.hmsTokens || []) : [];
        if (!hmsTokens.length) return;
        const r = await sendHuaweiPush(hmsTokens, hmsPayload);
        if (r.invalidTokens && r.invalidTokens.length) {
          await db.collection('users').doc(pid).collection('private').doc('fcm')
            .update({ hmsTokens: admin.firestore.FieldValue.arrayRemove(...r.invalidTokens) }).catch(() => {});
        }
      }));
    } catch (_) {}
  } catch (err) { console.error('relayMessage push error:', err); }

  return { messageId: msgRef.id, clientId: clientId || null };
});

/**
 * Hard-delete a message and fan out a 'message_deleted' FCM so every
 * participant's device can purge the message from its Dexie cache. This is
 * critical because onSnapshot listeners scoped to createdAt > lastSync do not
 * fire 'removed' events for older cached-only messages.
 */
exports.deleteMessage = functions.https.onCall({ secrets: HUAWEI_PUSH_SECRETS }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  const { chatId, messageId } = request.data || {};
  if (!chatId || !messageId) throw new functions.https.HttpsError('invalid-argument', 'chatId and messageId required');

  const convoRef = db.collection('conversations').doc(chatId);
  const convo = await convoRef.get();
  if (!convo.exists) throw new functions.https.HttpsError('not-found', 'Conversation not found');
  const participants = convo.data().participants || [];
  if (!participants.includes(uid)) {
    throw new functions.https.HttpsError('permission-denied', 'Not a participant');
  }

  // Only the sender can delete their own message
  const msgRef = convoRef.collection('messages').doc(messageId);
  const msgSnap = await msgRef.get();
  if (msgSnap.exists) {
    const msgData = msgSnap.data();
    if (msgData.senderId !== uid) {
      throw new functions.https.HttpsError('permission-denied', 'Only the sender can delete');
    }
    await msgRef.delete();
  }

  // Recount each recipient's actual unread messages and overwrite the
  // counter. More reliable than incremental ±1 because it self-heals from
  // any drift (failed earlier increments, stale data, etc.).
  try {
    const others = participants.filter(p => p !== uid);
    if (others.length > 0) {
      const all = await convoRef.collection('messages').get();
      const counts = {};
      for (const m of all.docs) {
        const d = m.data();
        if (d.read === true) continue;
        if (d.deleted === true) continue;
        if (!d.senderId) continue;
        for (const pid of others) {
          if (pid !== d.senderId) counts[pid] = (counts[pid] || 0) + 1;
        }
      }
      const updates = {};
      for (const pid of others) updates[`unreadCount.${pid}`] = counts[pid] || 0;
      await convoRef.update(updates);
    }
  } catch (err) {
    console.warn('deleteMessage unread recount failed:', err.message);
  }

  // Fan out a silent FCM to every other participant's devices so they can
  // scrub the message from their local cache.
  try {
    const otherPids = participants.filter(p => p !== uid);
    if (otherPids.length > 0) {
      const fcmDocs = await Promise.all(
        otherPids.map(pid => db.collection('users').doc(pid).collection('private').doc('fcm').get())
      );
      const allTokens = [];
      const tokenToUser = new Map();
      fcmDocs.forEach((fcmDoc, i) => {
        const pid = otherPids[i];
        const tokens = fcmDoc.exists ? (fcmDoc.data()?.tokens || []) : [];
        for (const t of tokens) { allTokens.push(t); tokenToUser.set(t, pid); }
      });
      if (allTokens.length > 0) {
        const response = await admin.messaging().sendEachForMulticast({
          tokens: allTokens,
          data: {
            type: 'message_deleted',
            conversationId: String(chatId),
            messageId: String(messageId),
            senderId: String(uid),
          },
        });
        // Clean up invalid tokens
        const invalidByUser = new Map();
        response.responses.forEach((r, i) => {
          if (!r.success && (r.error?.code === 'messaging/invalid-registration-token' ||
                             r.error?.code === 'messaging/registration-token-not-registered')) {
            const pid = tokenToUser.get(allTokens[i]);
            if (!pid) return;
            const arr = invalidByUser.get(pid) || [];
            arr.push(allTokens[i]);
            invalidByUser.set(pid, arr);
          }
        });
        for (const [pid, invalid] of invalidByUser) {
          await db.collection('users').doc(pid).collection('private').doc('fcm')
            .update({ tokens: admin.firestore.FieldValue.arrayRemove(...invalid) }).catch(() => {});
        }
      }
    }
    // Huawei (HMS) silent cache-scrub for the same recipients.
    try {
      const otherPids2 = participants.filter(p => p !== uid);
      const hmsData = {
        type: 'message_deleted',
        conversationId: String(chatId),
        messageId: String(messageId),
        senderId: String(uid),
      };
      await Promise.all(otherPids2.map(async (pid) => {
        const fcmDoc = await db.collection('users').doc(pid).collection('private').doc('fcm').get();
        const hmsTokens = fcmDoc.exists ? (fcmDoc.data()?.hmsTokens || []) : [];
        if (!hmsTokens.length) return;
        const r = await sendHuaweiPush(hmsTokens, hmsData);
        if (r.invalidTokens && r.invalidTokens.length) {
          await db.collection('users').doc(pid).collection('private').doc('fcm')
            .update({ hmsTokens: admin.firestore.FieldValue.arrayRemove(...r.invalidTokens) }).catch(() => {});
        }
      }));
    } catch (_) {}
  } catch (err) { console.error('deleteMessage push error:', err); }

  return { ok: true };
});

// aggregateTournamentStats (tournaments/{id} onUpdate) removed 2026-08-17 with
// the rest of the tournament backend. It only ever wrote users.tournamentStats,
// which nothing reads now.

// Recount conversation.unreadCount whenever a message is deleted (regardless
// of which path deleted it — the callable, a direct deleteDoc fallback, or
// an admin-side scrub). This is the self-healing source-of-truth: the
// callable's inline recount above is a fast path, but this trigger is what
// makes "deletes always update the badge" guaranteed.
exports.recountUnreadOnMessageDelete = functions.firestore
  .onDocumentDeleted({ document: 'conversations/{chatId}/messages/{messageId}', database: 'vgrdb' }, async (event) => {
    const chatId = event.params.chatId;
    const convoRef = db.collection('conversations').doc(chatId);
    try {
      const convo = await convoRef.get();
      if (!convo.exists) return;
      const participants = convo.data().participants || [];
      if (participants.length === 0) return;

      const all = await convoRef.collection('messages').get();
      const counts = {};
      for (const m of all.docs) {
        const d = m.data();
        if (d.read === true) continue;
        if (d.deleted === true) continue;
        if (!d.senderId) continue;
        for (const pid of participants) {
          if (pid !== d.senderId) counts[pid] = (counts[pid] || 0) + 1;
        }
      }
      const updates = {};
      for (const pid of participants) updates[`unreadCount.${pid}`] = counts[pid] || 0;
      await convoRef.update(updates);
    } catch (err) {
      console.warn('recountUnreadOnMessageDelete failed', chatId, err.message);
    }
  });

exports.autoModCheck = functions.firestore
  .onDocumentCreated({ document: 'posts/{postId}', database: 'vgrdb' }, async (event) => {
    const post = event.data.data();
    try {
      const config = await db.collection('app_config').doc('general').get();
      if (!config.exists || !config.data().autoModEnabled) return;

      const bannedDoc = await db.collection('banned_words').doc('list').get();
      const bannedWords = bannedDoc.exists ? (bannedDoc.data().words || []) : [];
      if (bannedWords.length === 0) return;

      const content = (post.content || '').toLowerCase();
      const foundWords = bannedWords.filter(w => content.includes(w.toLowerCase()));

      if (foundWords.length > 0) {
        await event.data.ref.update({
          status: 'flagged',
          flaggedReason: 'banned_words',
          flaggedWords: foundWords,
          flaggedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await db.collection('mod_actions').add({
          action: 'auto_flag',
          targetType: 'post',
          targetId: event.params.postId,
          reason: `Banned words detected: ${foundWords.join(', ')}`,
          automated: true,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    } catch (err) { console.error('autoModCheck error:', err); }
  });

// ──────────────────────────────────────────────────────────────
// SCHEDULED — RANKING, TRENDING, STORIES CLEANUP
// ──────────────────────────────────────────────────────────────

// Ranking runs every 6 hours. With the feed ordering by createdAt first
// and rankScore only used as a tiebreaker in the top slice, 6h stale ranks
// are indistinguishable to users on a small app but cut reads by 6×.
// Author boost is read ONCE per author per run via in-memory cache instead
// of N+1 lookups, and we batch-fetch authors with `where(__name__, in, [...])`.
const _calculateRankScores = defer('0 */6 * * *', async () => {
    const now = Date.now();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);
    const posts = await db.collection('posts').where('status', '==', 'published').where('createdAt', '>=', twentyFourHoursAgo).get();

    // 1. Collect unique authorIds we still need to look up
    const authorBoosts = new Map();
    const uniqueAuthorIds = [...new Set(posts.docs.map(d => d.data().authorId).filter(Boolean))];

    // 2. Batch-fetch authors in chunks of 30 (Firestore "in" query limit)
    for (let i = 0; i < uniqueAuthorIds.length; i += 30) {
      const chunk = uniqueAuthorIds.slice(i, i + 30);
      const authorRefs = chunk.map(id => db.collection('users').doc(id));
      const authorSnaps = await db.getAll(...authorRefs);
      for (const snap of authorSnaps) {
        if (!snap.exists) { authorBoosts.set(snap.id, 1.0); continue; }
        const vt = snap.data().verificationTier;
        let boost = 1.0;
        if (vt === 'pro') boost = 2.0;
        else if (vt === 'legend') boost = 2.5;
        else if (vt === 'verified') boost = 1.5;
        authorBoosts.set(snap.id, boost);
      }
    }

    let batch = db.batch();
    let count = 0;
    for (const doc of posts.docs) {
      const post = doc.data();
      const likes = post.likeCount || 0;
      const comments = post.commentCount || 0;
      const shares = post.shareCount || 0;
      const saves = post.saveCount || 0;
      const engagementScore = (likes * 1) + (comments * 3) + (shares * 5) + (saves * 2);
      const postAge = (now - (post.createdAt?.toMillis ? post.createdAt.toMillis() : new Date(post.createdAt).getTime())) / (1000 * 60 * 60);
      const recencyScore = Math.max(0, 100 - (postAge * 4));

      let boostMultiplier = authorBoosts.get(post.authorId) ?? 1.0;
      if (post.isNewsPost) boostMultiplier *= 0.8;

      batch.update(doc.ref, { rankScore: (engagementScore + recencyScore) * boostMultiplier, lastRankedAt: admin.firestore.FieldValue.serverTimestamp() });
      count++;
      if (count % 400 === 0) { await batch.commit(); batch = db.batch(); }
    }
    await batch.commit();
    console.log(`Ranked ${count} posts using ${uniqueAuthorIds.length} unique authors`);

    // Staleness sweep. The rescoring above only touches the last-24h window, so a
    // post that once trended keeps a frozen-high rankScore forever and Trending
    // (orderBy rankScore desc) drifts into an ALL-TIME leaderboard. Drain it at
    // the source: walk the HEAD of the rankScore list (the exact posts that
    // dominate Trending) and zero any that have aged past the 72h trending window
    // (matches the getTrendingPosts client cutoff). Bounded (one indexed query,
    // ≤400 docs/run, no new index); since the list is desc and scores are always
    // ≥0, we can stop at the first ≤0. A trickle crosses 72h each run, so the head
    // of the list stays genuinely recent without ever rescoring the whole corpus.
    try {
      const staleCutoff = now - 72 * 60 * 60 * 1000;
      const head = await db.collection('posts')
        .where('status', '==', 'published')
        .orderBy('rankScore', 'desc')
        .limit(400).get();
      let sweep = db.batch();
      let swept = 0;
      for (const doc of head.docs) {
        const d = doc.data();
        if ((d.rankScore || 0) <= 0) break; // rest are already ≤0
        const created = d.createdAt?.toMillis ? d.createdAt.toMillis() : new Date(d.createdAt).getTime();
        if (created < staleCutoff) {
          sweep.update(doc.ref, { rankScore: 0 });
          swept++;
          if (swept % 400 === 0) { await sweep.commit(); sweep = db.batch(); }
        }
      }
      if (swept > 0) await sweep.commit();
      console.log(`Staleness sweep zeroed ${swept} posts older than 72h`);
    } catch (e) { console.error('rank staleness sweep failed:', e?.message); }
  });

// Trending hashtags refreshed every 3 hours (was hourly). A trending tag
// list does not need minute-level freshness, and this query reads every
// published post from the last 24h on each run.
const _updateTrending = defer('0 */3 * * *', async () => {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const posts = await db.collection('posts').where('status', '==', 'published').where('createdAt', '>=', twentyFourHoursAgo).get();

    const tagCounts = {};
    for (const doc of posts.docs) {
      const post = doc.data();
      const hashtags = post.hashtags || [];
      const engagement = (post.likeCount || 0) + (post.commentCount || 0) * 3;
      for (const tag of hashtags) {
        if (!tagCounts[tag]) tagCounts[tag] = { count: 0, engagement: 0 };
        tagCounts[tag].count++;
        tagCounts[tag].engagement += engagement;
      }
    }

    const sorted = Object.entries(tagCounts)
      .map(([tag, data]) => ({ tag, score: data.count * 10 + data.engagement, ...data }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    await db.collection('trending').doc('hashtags').set({
      tags: sorted,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const batch = db.batch();
    for (const item of sorted) {
      batch.set(db.collection('hashtags').doc(item.tag), {
        tag: item.tag,
        postCount24h: item.count,
        engagement24h: item.engagement,
        trendScore: item.score,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await batch.commit();
    console.log(`Updated ${sorted.length} trending hashtags`);
  });

// Stories cleanup every 6 hours. A story expiring up to 6 hours late is
// irrelevant (the client already hides stories older than 24h on read).
const _cleanupExpiredStories = defer('0 */6 * * *', async () => {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const expired = await db.collection('stories').where('active', '==', true).where('createdAt', '<=', twentyFourHoursAgo).get();
    if (expired.empty) return;
    const batch = db.batch();
    let count = 0;
    for (const doc of expired.docs) {
      batch.update(doc.ref, { active: false, expiredAt: admin.firestore.FieldValue.serverTimestamp() });
      count++;
    }
    await batch.commit();
    if (count > 0) console.log(`Expired ${count} stories`);
  });

// The Status feature writes to `statuses` (NOT the legacy `stories` collection
// the job above sweeps), and NOTHING ever deleted them — they piled up in
// Firestore forever, and a 24h status past its window kept counting against the
// author-scoped query. Delete statuses older than 24h. Batched + capped so one
// run can't blow the write budget; the next run continues the backlog.
const _cleanupExpiredStatuses = defer('0 */6 * * *', async () => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const expired = await db.collection('statuses').where('createdAt', '<=', cutoff).limit(400).get();
    if (expired.empty) return;
    const batch = db.batch();
    for (const doc of expired.docs) batch.delete(doc.ref);
    await batch.commit();
    console.log(`Deleted ${expired.size} expired statuses`);
  });

// ──────────────────────────────────────────────────────────────
// CALLABLE — TIPS, PURCHASES, REPORTS, COMMERCE, MEMBERSHIPS
// ──────────────────────────────────────────────────────────────

exports.sendTip = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  const { recipientId, amount, message, postId, streamId } = request.data;
  if (!recipientId || typeof recipientId !== 'string') throw new functions.https.HttpsError('invalid-argument', 'recipientId required');
  if (!amount || typeof amount !== 'number' || amount < 1 || !Number.isInteger(amount)) throw new functions.https.HttpsError('invalid-argument', 'amount must be a positive integer');
  if (uid === recipientId) throw new functions.https.HttpsError('invalid-argument', 'Cannot tip yourself');
  if (amount > 50000) throw new functions.https.HttpsError('invalid-argument', 'Maximum tip is 50,000 coins');

  // Admin kill switch. `tipsPaused` is a toggle on /admin/config AND
  // /admin/economy that, until 2026-08-19, was read by nothing: an operator
  // could flip "Pause Tipping" and tips kept flowing. Same class of problem as
  // payoutsPaused in creatorPayouts.js — a control that is trusted and inert.
  const tipCfgSnap = await db.collection('app_config').doc('general').get();
  if (tipCfgSnap.exists && tipCfgSnap.data()?.tipsPaused === true) {
    throw new functions.https.HttpsError('failed-precondition', 'Tipping is temporarily paused. Try again shortly.');
  }

  const senderPlan = await getUserPlan(uid);

  return db.runTransaction(async (tx) => {
    const senderWalletRef = db.collection('wallets').doc(uid);
    const recipientWalletRef = db.collection('wallets').doc(recipientId);
    // All reads MUST precede writes in a transaction.
    const senderWallet = await tx.get(senderWalletRef);
    const recipientWallet = await tx.get(recipientWalletRef);
    // Read the recipient's user doc for the Vanguard exemption. Inside the
    // transaction so a rank flip mid-write is still consistent, and BEFORE any
    // write because Firestore requires all reads first.
    const recipientUserSnap = await tx.get(db.collection('users').doc(recipientId));
    if (!senderWallet.exists) throw new functions.https.HttpsError('not-found', 'Sender wallet not found');
    if (!recipientWallet.exists) throw new functions.https.HttpsError('not-found', 'Recipient wallet not found');
    const senderBalance = senderWallet.data().balance || 0;
    if (senderBalance < amount) throw new functions.https.HttpsError('failed-precondition', 'Insufficient coin balance');

    // ── Sender (gifter) VP — sub-1:1 (1 VP per 25 coins), plan-multiplied, uncapped ──
    const vpEarned = applyVPMultiplier(Math.floor(amount / GIFT_COINS_PER_VP), senderPlan);

    const senderUpdate = { balance: admin.firestore.FieldValue.increment(-amount), totalSpent: admin.firestore.FieldValue.increment(amount), totalTipped: admin.firestore.FieldValue.increment(amount), updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (vpEarned > 0) senderUpdate.vp = admin.firestore.FieldValue.increment(vpEarned);
    tx.update(senderWalletRef, senderUpdate);
    // AUTO-CONVERT AT RECEIPT (2026-08-11). A received tip lands as GEMS, at the
    // recipient's commission rate AT THIS MOMENT, not whatever rate they happen
    // to hold when they later choose to cash out.
    //
    // Closes a real leak: a Rookie used to be able to sit on earned coins, grind
    // to Immortal, and convert the whole stored balance at 15% instead of 30%.
    //
    // The recipient can spend in-app again via `buyCoinsWithGems` (flat 1:1).
    // That round trip is lossy at every rank, so it is not an exploit; see
    // functions/gemBuyback.js.
    //
    // ONE RATE (2026-08-14, docs/REVENUE_SHARE_PLAN.md). This used to take a
    // flat 10% here and THEN a VP-tier commission at conversion, so the
    // advertised "flat 10% fee" really took 24-37%. Both deductions are now
    // replaced by the single revenue-share ladder: the whole tip is gross
    // revenue, and the creator accrues their tier's share of it.
    const { earnedShareCredit, isVanguardExempt, microUsdToStr, COIN_MICRO_USD } = require('./coinLedger');
    const tipCredit = earnedShareCredit(
      amount,
      recipientWallet.data().totalEarnedCoinsGross || 0,
      {
        vanguardExempt: isVanguardExempt(recipientUserSnap.exists ? recipientUserSnap.data() : null),
        // Not a creator yet: the tip still lands, it just does not accrue.
        creatorActive: (recipientUserSnap.exists ? recipientUserSnap.data()?.creator?.status : null) === 'active',
      },
    );
    // Gross revenue this tip generated, and Vergr's share of it. `platformFee`
    // keeps its name so existing ledger rows, admin reports and the daily
    // rollup in dailyMetricsRollup.js keep their shape.
    const recipientAmount = amount;
    // Vergr's share of the gross, in micro-USD. `platformFee` keeps its name so
    // admin reports and dailyMetricsRollup.js keep their shape, but it is now a
    // money figure rather than a coin count.
    const platformFee = (amount * COIN_MICRO_USD) - tipCredit.owedMicroUsd;
    tx.update(recipientWalletRef, {
      ...tipCredit.fields,
      totalEarned: admin.firestore.FieldValue.increment(recipientAmount),
      totalReceived: admin.firestore.FieldValue.increment(recipientAmount),
    });

    const tipRef = db.collection('tips').doc();
    tx.set(tipRef, { senderId: uid, recipientId, amount, recipientAmount, platformFee, vpEarned, message: message || null, postId: postId || null, streamId: streamId || null, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    tx.set(db.collection('transactions').doc(), { userId: uid, type: 'tip_sent', amount: -amount, balance: senderBalance - amount, recipientId, tipId: tipRef.id, vpEarned, description: `Tipped ${amount} coins${vpEarned > 0 ? ` (+${vpEarned} VP)` : ''}`, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    // The ledger row records BOTH sides: the gross coins the tip was worth and
    // the share actually accrued. Recording only one leaves no way to answer
    // "why did I get this number", which is the question every support ticket
    // about earnings is.
    tx.set(db.collection('transactions').doc(), { userId: recipientId, type: 'tip_received', earning: true, currency: 'usd', amountMicroUsd: tipCredit.owedMicroUsd, amount: tipCredit.owedMicroUsd, senderId: uid, tipId: tipRef.id, meta: { grossCoins: recipientAmount, share: tipCredit.share, tipAmount: amount, platformFee }, description: `Earned ${microUsdToStr(tipCredit.owedMicroUsd)}, your ${Math.round(tipCredit.share * 100)}% share of a ${amount} coin tip`, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    tx.set(db.collection('notifications').doc(), { recipientId, type: 'tip', title: 'You received a tip!', body: `Someone tipped you ${amount} coins, you earned ${microUsdToStr(tipCredit.owedMicroUsd)}${message ? ': "' + message + '"' : ''}`, senderId: uid, read: false, data: { tipId: tipRef.id, amount: recipientAmount, owedMicroUsd: tipCredit.owedMicroUsd }, createdAt: admin.firestore.FieldValue.serverTimestamp() });

    // Top-gifters leaderboard: accumulate this sender's running coin total for
    // the stream they're watching (server-written so the board can't be faked).
    // Display-only; names/avatars are resolved client-side from the uid.
    if (streamId && typeof streamId === 'string') {
      tx.set(db.collection('streams').doc(streamId).collection('gifters').doc(uid), {
        uid, coins: admin.firestore.FieldValue.increment(amount),
        lastTipAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    return { tipId: tipRef.id, recipientAmount, platformFee, vpEarned };
  });
});

exports.purchaseCoins = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  const { packageId, paymentIntentId } = request.data;
  if (!packageId || !paymentIntentId) throw new functions.https.HttpsError('invalid-argument', 'packageId and paymentIntentId required');

  const packageDoc = await db.collection('coin_packages').doc(packageId).get();
  if (!packageDoc.exists || !packageDoc.data().active) throw new functions.https.HttpsError('not-found', 'Coin package not found or inactive');

  const pkg = packageDoc.data();
  const bonusCoins = Math.floor(pkg.coins * ((pkg.priceBonusPercent || 0) / 100));
  const totalCoins = pkg.coins + bonusCoins;

  await db.runTransaction(async (tx) => {
    const walletRef = db.collection('wallets').doc(uid);
    const wallet = await tx.get(walletRef);
    if (!wallet.exists) throw new functions.https.HttpsError('not-found', 'Wallet not found');
    const currentBalance = wallet.data().balance || 0;
    tx.update(walletRef, { balance: admin.firestore.FieldValue.increment(totalCoins), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    tx.update(db.collection('users').doc(uid), { coinBalance: admin.firestore.FieldValue.increment(totalCoins) });
    tx.set(db.collection('transactions').doc(), { userId: uid, type: 'purchase', amount: totalCoins, balance: currentBalance + totalCoins, packageId, packageName: pkg.name, priceEUR: pkg.priceEUR, baseCoins: pkg.coins, bonusCoins, paymentIntentId, description: `Purchased ${pkg.name}: ${totalCoins} coins (${pkg.coins} + ${bonusCoins} bonus)`, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  });

  return { totalCoins, baseCoins: pkg.coins, bonusCoins };
});

exports.getWalletBalance = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  const wallet = await db.collection('wallets').doc(uid).get();
  if (!wallet.exists) return { balance: 0, totalEarned: 0, totalSpent: 0 };
  const w = wallet.data();
  return { balance: w.balance || 0, totalEarned: w.totalEarned || 0, totalSpent: w.totalSpent || 0, totalTipped: w.totalTipped || 0, totalReceived: w.totalReceived || 0 };
});

exports.submitReport = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  const { targetType, targetId, reason, details } = request.data;
  const validTypes = ['post', 'comment', 'user', 'squad', 'message', 'stream', 'review'];
  if (!validTypes.includes(targetType)) throw new functions.https.HttpsError('invalid-argument', 'Invalid target type');
  if (!targetId) throw new functions.https.HttpsError('invalid-argument', 'targetId required');
  if (!reason) throw new functions.https.HttpsError('invalid-argument', 'reason required');

  const existing = await db.collection('reports').where('reporterId', '==', uid).where('targetId', '==', targetId).where('targetType', '==', targetType).limit(1).get();
  if (!existing.empty) throw new functions.https.HttpsError('already-exists', 'You already reported this');

  const report = await db.collection('reports').add({
    reporterId: uid, targetType, targetId, reason, details: details?.substring(0, 1000) || null, status: 'pending',
    priority: reason === 'underage' ? 'critical' : 'normal', createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const reportCount = await db.collection('reports').where('targetId', '==', targetId).where('status', 'in', ['pending', 'reviewing']).get();
  const config = await db.collection('app_config').doc('general').get();
  const threshold = config.exists ? (config.data().reportThreshold || 5) : 5;

  if (reportCount.size >= threshold && targetType === 'post') {
    await db.collection('posts').doc(targetId).update({ status: 'hidden', hiddenReason: 'auto_mod_reports', hiddenAt: admin.firestore.FieldValue.serverTimestamp() });
    await db.collection('mod_actions').add({ action: 'auto_hide', targetType, targetId, reason: `Reached ${threshold} reports`, automated: true, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  }

  return { reportId: report.id };
});

exports.createOrder = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  const { shippingAddress, paymentMethod, useCoins, coinAmount } = request.data;
  if (!shippingAddress) throw new functions.https.HttpsError('invalid-argument', 'Shipping address required');

  const cartItems = await db.collection('carts').doc(uid).collection('items').get();
  if (cartItems.empty) throw new functions.https.HttpsError('failed-precondition', 'Cart is empty');

  return db.runTransaction(async (tx) => {
    let subtotalEUR = 0;
    const orderItems = [];
    for (const cartDoc of cartItems.docs) {
      const ci = cartDoc.data();
      const productRef = db.collection('products').doc(ci.productId);
      const product = await tx.get(productRef);
      if (!product.exists || !product.data().active) throw new functions.https.HttpsError('not-found', `Product ${ci.productId} unavailable`);
      const p = product.data();
      if (p.stock < ci.quantity) throw new functions.https.HttpsError('failed-precondition', `Insufficient stock for ${p.name}`);
      const itemTotal = p.priceEUR * ci.quantity;
      subtotalEUR += itemTotal;
      orderItems.push({ productId: ci.productId, name: p.name, priceEUR: p.priceEUR, quantity: ci.quantity, totalEUR: itemTotal, image: p.images?.[0] || null });
      tx.update(productRef, { stock: admin.firestore.FieldValue.increment(-ci.quantity), soldCount: admin.firestore.FieldValue.increment(ci.quantity) });
    }
    const shippingEUR = subtotalEUR >= 500 ? 0 : 4.99;
    const vatRate = 0.15;
    const vatEUR = Math.round(subtotalEUR * vatRate * 100) / 100;
    let coinDiscount = 0;
    if (useCoins && coinAmount > 0) {
      const walletRef = db.collection('wallets').doc(uid);
      const wallet = await tx.get(walletRef);
      const balance = wallet.data()?.balance || 0;
      const maxCoinsUsable = Math.min(coinAmount, balance, subtotalEUR * 10);
      coinDiscount = maxCoinsUsable / 10;
      tx.update(walletRef, { balance: admin.firestore.FieldValue.increment(-maxCoinsUsable), totalSpent: admin.firestore.FieldValue.increment(maxCoinsUsable), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    const totalEUR = subtotalEUR + shippingEUR + vatEUR - coinDiscount;
    const orderRef = db.collection('orders').doc();
    tx.set(orderRef, { userId: uid, status: 'pending_payment', items: orderItems, itemCount: orderItems.length, subtotalEUR, shippingEUR, vatEUR, coinDiscount, totalEUR: Math.max(0, totalEUR), shippingAddress, paymentMethod, trackingNumber: null, trackingUrl: null, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    for (const cartDoc of cartItems.docs) tx.delete(cartDoc.ref);
    return { orderId: orderRef.id, totalEUR: Math.max(0, totalEUR), itemCount: orderItems.length };
  });
});

// `handleStripeWebhook` lived here and was deleted with the rest of Stripe on
// 2026-08-13. It flipped `orders/{id}` to paid from an UNSIGNED public POST,
// so anyone who learned the URL could mark any order paid. `createOrder` above
// is left in place (it is not Stripe's), but note it has no payment path and
// nothing in src/ calls it. If merch checkout is ever revived, give it a rail
// with a verified webhook signature and do not restore this shape.

exports.requestPayout = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  const creator = await db.collection('creators').doc(uid).get();
  if (!creator.exists) throw new functions.https.HttpsError('failed-precondition', 'Not a registered creator');
  const wallet = await db.collection('wallets').doc(uid).get();
  const balance = wallet.data()?.balance || 0;
  if (balance < 1000) throw new functions.https.HttpsError('failed-precondition', 'Minimum payout is 1000 coins');
  const payoutCoins = request.data.amount || balance;
  const payoutEUR = payoutCoins / 10;
  const payout = await db.collection('creators').doc(uid).collection('payouts').add({ amount: payoutCoins, amountEUR: payoutEUR, status: 'pending', requestedAt: admin.firestore.FieldValue.serverTimestamp() });
  return { payoutId: payout.id, amountEUR: payoutEUR };
});

// Creator memberships (subscribe/cancel/list) live in ./memberships — they read the
// real `creators/{uid}.membershipTiers` the Studio editor writes (the old inline
// versions read a `memberships` collection nothing ever populated). Auto-renew cron
// is registered in cronDaily below.
exports.subscribeMembership = memberships.subscribeMembership;
exports.cancelMembership = memberships.cancelMembership;
exports.getMyMemberships = memberships.getMyMemberships;

// Scheduled messages (Lite/Pro) — creation callable; the relay executes due ones.
exports.scheduleMessage = require('./scheduledMessages').scheduleMessage;

// Platform announcements — @Vergr broadcasts a flagged post to the FCM
// `announcements` topic (one send, all devices, bypasses post-notif prefs).
const announcements = require('./announcements');
exports.subscribeAnnouncements = announcements.subscribeAnnouncements;
exports.unsubscribeAnnouncements = announcements.unsubscribeAnnouncements;
exports.postAnnouncement = announcements.postAnnouncement;

// Email verification (6-digit code over Spacemail SMTP; dormant until the SMTP
// secrets are real — see functions/emailVerification.js + docs/EMAIL_VERIFICATION.md).
const emailVerification = require('./emailVerification');
exports.sendEmailVerificationCode = emailVerification.sendEmailVerificationCode;
exports.verifyEmailCode = emailVerification.verifyEmailCode;

// ──────────────────────────────────────────────────────────────
// STORAGE LIFECYCLE: delete chat media past its TTL.
// We tag uploads with customMetadata.ttlExpiry (ISO date). This sweeper
// runs nightly, walks the chat folders, and deletes any object that's
// expired. Profile/post media (no TTL set) are left alone.
// ──────────────────────────────────────────────────────────────
const TTL_FOLDERS = [
  'chat_media/', 'chat_images/', 'chat_videos/', 'chat_files/',
  'voice_notes/', 'squad_voice/', 'squad_images/', 'squad_videos/',
  'comment_media/',
];

async function deleteExpiredFiles(folderPrefix) {
  const bucket = admin.storage().bucket();
  let pageToken;
  let deleted = 0;
  let scanned = 0;
  const now = Date.now();
  do {
    const [files, _, apiResp] = await bucket.getFiles({ prefix: folderPrefix, maxResults: 1000, pageToken });
    pageToken = apiResp?.nextPageToken;
    for (const file of files) {
      scanned++;
      try {
        const [metadata] = await file.getMetadata();
        const ttlIso = metadata?.metadata?.ttlExpiry;
        // Fallback: if no TTL set, treat anything older than 30 days as expired
        const created = metadata?.timeCreated ? new Date(metadata.timeCreated).getTime() : 0;
        const ttlMs = ttlIso ? new Date(ttlIso).getTime() : (created + 30 * 86400000);
        if (ttlMs && ttlMs < now) {
          await file.delete().catch(() => {});
          deleted++;
        }
      } catch (err) {
        // Skip individual file errors
      }
    }
  } while (pageToken);
  return { folderPrefix, scanned, deleted };
}

const _cleanupExpiredMedia = defer({ schedule: '0 3 * * *', timeZone: 'Etc/UTC' }, async () => {
    const results = [];
    for (const folder of TTL_FOLDERS) {
      try {
        results.push(await deleteExpiredFiles(folder));
      } catch (err) {
        console.error(`Cleanup failed for ${folder}:`, err.message);
      }
    }
    console.log('Storage cleanup complete:', JSON.stringify(results));
  });

// Manual trigger for the same sweep — call once to clean out a stuffed bucket.
exports.cleanupExpiredMediaNow = functions.https.onRequest(async (req, res) => {
  const results = [];
  for (const folder of TTL_FOLDERS) {
    try { results.push(await deleteExpiredFiles(folder)); }
    catch (err) { results.push({ folderPrefix: folder, error: err.message }); }
  }
  res.status(200).json(results);
});

// ──────────────────────────────────────────────────────────────
// SHARE LINK PREVIEWS
// Returns server-rendered HTML with the right Open Graph tags so when a
// VERGR post/clip URL is pasted into WhatsApp/Discord/Slack/Twitter the
// crawler sees a proper title/description/image instead of our SPA's
// default tags. Real users get a meta refresh into the SPA route.
// Hosting rewrite: /share/post/:id and /share/clip/:id → this function.
// ──────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

exports.shareLink = functions.https.onRequest(async (req, res) => {
  // Path looks like /share/post/abc123, /share/clip/abc123, /share/stream/abc123
  const parts = (req.path || '').split('/').filter(Boolean);
  // Function rewrite strips the /share prefix and we get [kind, id]
  let [kind, id] = parts.length === 2 ? parts : [parts[parts.length - 2], parts[parts.length - 1]];
  if (kind === 'live') kind = 'stream'; // alias
  if (!id || !['post', 'clip', 'stream'].includes(kind)) {
    return res.status(404).send('Not found');
  }

  const APP_BASE = 'https://vergr.app';
  const APP_ROUTE_BASE = kind === 'clip' ? `/clip/${id}` : kind === 'stream' ? `/watch/${id}` : `/post/${id}`;
  // Forward a referral code so a shared clip/stream/post credits the sharer.
  // captureReferral() in the SPA reads ?ref once the human lands on APP_ROUTE.
  const refRaw = typeof req.query?.ref === 'string' ? req.query.ref : '';
  const ref = /^[A-Za-z0-9_-]{6,64}$/.test(refRaw) ? refRaw : '';
  const APP_ROUTE = ref ? `${APP_ROUTE_BASE}?ref=${ref}` : APP_ROUTE_BASE;
  // Canonical = the REAL app route (now server-rendered by ugcRenderer), so
  // /share/* never competes with /post|/clip|/watch in the index (SEO_PLAN 8.6).
  // Always the CLEAN route (no ?ref) so referral params never pollute the index.
  const canonicalUrl = `${APP_BASE}${APP_ROUTE_BASE}`;
  const fallbackImage = `${APP_BASE}/og/share-poster.jpg`;

  let title = 'VERGR — Where Gamers Converge';
  let description = 'Compete, create, earn and shop with the gaming community.';
  let image = fallbackImage;
  let videoEmbed = null;

  try {
    if (kind === 'stream') {
      const sSnap = await db.collection('streams').doc(id).get();
      if (sSnap.exists) {
        const s = sSnap.data();
        const live = s.status === 'live';
        let host = s.hostUsername || null;
        if (!host && s.hostUid) {
          const h = (await db.collection('users').doc(s.hostUid).get()).data();
          host = h?.displayName || h?.username || null;
        }
        host = host || 'A creator';
        const streamTitle = (s.title || '').trim();
        title = `${live ? '🔴 LIVE · ' : ''}${host}${streamTitle ? ` — ${streamTitle}` : ' is streaming'} on VERGR`;
        description = s.game
          ? `${live ? 'Live now' : 'Streaming'} · ${s.game}. Tap to watch on VERGR.`
          : `${live ? 'Live now on VERGR.' : 'Watch on VERGR.'} Tap to join the stream.`;
        image = s.coverUrl || s.thumbnailUrl || fallbackImage;
      }
    } else {
      // Resolve by doc id first, then by SEO slug (news/article pretty URLs).
      let postSnap = await db.collection('posts').doc(id).get();
      if (!postSnap.exists) {
        const q = await db.collection('posts').where('slug', '==', id).limit(1).get();
        if (!q.empty) postSnap = q.docs[0];
      }
      if (postSnap.exists) {
        const post = postSnap.data();
        const author = post.authorId ? (await db.collection('users').doc(post.authorId).get()).data() : null;
        const authorName = author?.displayName || author?.username || 'A gamer';
        title = post.content
          ? `${authorName}: ${post.content.slice(0, 60)}${post.content.length > 60 ? '…' : ''}`
          : `${authorName} on VERGR`;
        description = (post.previewText || post.content || description).slice(0, 200);
        const firstMedia = Array.isArray(post.mediaUrls) ? post.mediaUrls[0] : post.mediaUrl;
        if (firstMedia) image = firstMedia;
        else if (post.youtubeVideoId) {
          image = `https://img.youtube.com/vi/${post.youtubeVideoId}/hqdefault.jpg`;
          videoEmbed = `https://www.youtube.com/embed/${post.youtubeVideoId}`;
        }
      }
    }
  } catch (err) {
    console.error('shareLink lookup failed:', err.message);
  }

  // Live streams should not be CDN-cached long (status flips); others can.
  res.set('Cache-Control', kind === 'stream' ? 'public, max-age=30, s-maxage=30' : 'public, max-age=300, s-maxage=600');
  res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
  <meta property="og:type" content="${videoEmbed ? 'video.other' : 'article'}" />
  <meta property="og:site_name" content="VERGR" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image" content="${escapeHtml(image)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
  ${videoEmbed ? `<meta property="og:video" content="${escapeHtml(videoEmbed)}" />\n  <meta property="og:video:url" content="${escapeHtml(videoEmbed)}" />\n  <meta property="og:video:secure_url" content="${escapeHtml(videoEmbed)}" />\n  <meta property="og:video:type" content="text/html" />` : ''}
  <meta name="twitter:card" content="${videoEmbed ? 'player' : 'summary_large_image'}" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(image)}" />
  <meta http-equiv="refresh" content="0; url=${escapeHtml(APP_BASE + APP_ROUTE)}" />
  <style>body{margin:0;background:#07080D;color:#ECEFFE;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;padding:24px}</style>
</head>
<body>
  <div>
    <h1 style="margin:0 0 12px">${escapeHtml(title)}</h1>
    <p style="margin:0 0 24px;opacity:0.7">${escapeHtml(description)}</p>
    <a href="${escapeHtml(APP_BASE + APP_ROUTE)}" style="color:#4DFFD4">Open in VERGR →</a>
  </div>
</body>
</html>`);
});

// One-shot audit: report storage usage by folder so we can see what's
// actually eating quota. Hit GET to read the breakdown.
exports.storageAudit = functions.https.onRequest(async (req, res) => {
  const bucket = admin.storage().bucket();
  const totals = {};
  let pageToken;
  do {
    const [files, _, apiResp] = await bucket.getFiles({ maxResults: 1000, pageToken });
    pageToken = apiResp?.nextPageToken;
    for (const f of files) {
      const folder = f.name.includes('/') ? f.name.split('/')[0] : '(root)';
      const size = parseInt(f.metadata?.size || '0', 10);
      const slot = totals[folder] || (totals[folder] = { count: 0, bytes: 0 });
      slot.count += 1;
      slot.bytes += size;
    }
  } while (pageToken);
  const formatted = Object.entries(totals)
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .map(([folder, v]) => ({ folder, count: v.count, mb: +(v.bytes / 1048576).toFixed(2) }));
  const totalMb = +(formatted.reduce((sum, x) => sum + x.mb, 0)).toFixed(2);
  res.status(200).json({ totalMb, byFolder: formatted });
});

// ──────────────────────────────────────────────────────────────
// MEDIA PROXY — CDN-FRIENDLY STORAGE STREAMING
// ──────────────────────────────────────────────────────────────
// Streams files from Firebase Storage with long cache headers so Cloudflare
// caches them at the edge. First request pays Storage egress; every subsequent
// one is served by Cloudflare for $0.
//
// URL pattern: /media/{storagePath}
// e.g. /media/posts/abc123/clip.mp4
//
// The Firebase Hosting rewrite forwards /media/** → this function.
exports.serveMedia = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'GET') return res.status(405).send('GET only');

  // Strip leading /media/ to get the storage object path
  const pathMatch = req.path.replace(/^\/media\//, '');
  if (!pathMatch || pathMatch === '/') return res.status(400).send('Missing path');

  const bucket = admin.storage().bucket();
  const file = bucket.file(decodeURIComponent(pathMatch));

  try {
    const [exists] = await file.exists();
    if (!exists) return res.status(404).send('Not found');

    const [metadata] = await file.getMetadata();
    const contentType = metadata.contentType || 'application/octet-stream';
    const size = parseInt(metadata.size, 10);

    // Long cache: 30 days edge (s-maxage), 7 days browser (max-age).
    // Cloudflare respects s-maxage for edge caching.
    res.set('Cache-Control', 'public, max-age=604800, s-maxage=2592000');
    res.set('Content-Type', contentType);
    if (size) res.set('Content-Length', String(size));
    // Allow range requests for video seeking
    res.set('Accept-Ranges', 'bytes');

    // Handle range requests (video scrubbing)
    const rangeHeader = req.headers.range;
    if (rangeHeader && size) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : size - 1;
      res.status(206);
      res.set('Content-Range', `bytes ${start}-${end}/${size}`);
      res.set('Content-Length', String(end - start + 1));
      file.createReadStream({ start, end: end + 1 }).pipe(res);
    } else {
      file.createReadStream().pipe(res);
    }
  } catch (err) {
    console.error('serveMedia error:', err.message);
    if (!res.headersSent) res.status(500).send('Internal error');
  }
});

// ──────────────────────────────────────────────────────────────
// MONTHLY PLAN BONUS — Lite/Pro subscribers get VP + coins on the 1st
// ──────────────────────────────────────────────────────────────
const _payMonthlyPlanBonus = defer(
  { schedule: '0 6 1 * *', timeZone: 'UTC', region: 'europe-west1' },
  async () => {
    const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
    const plans = ['lite', 'pro'];
    let paid = 0;

    for (const plan of plans) {
      const vpBonus = MONTHLY_VP_BONUS[plan];
      const coinBonus = MONTHLY_COIN_BONUS[plan];
      if (!vpBonus && !coinBonus) continue;

      let lastDoc = null;
      while (true) {
        // Query the `subscription` field — that's what the purchase flows
        // (payram.js / subscriptions.js) actually write. The old `tier` query
        // matched nobody, so the monthly bonus never paid out.
        let q = db.collection('users').where('subscription', '==', plan).limit(400);
        if (lastDoc) q = q.startAfter(lastDoc);
        const batch = await q.get();
        if (batch.empty) break;
        lastDoc = batch.docs[batch.docs.length - 1];

        await Promise.all(batch.docs.map(async (userDoc) => {
          const uid = userDoc.id;
          const claimId = `${uid}_plan_bonus_${monthKey}`;
          const claimRef = db.collection('quest_claims').doc(claimId);
          const claimSnap = await claimRef.get();
          if (claimSnap.exists) return;

          const walletRef = db.collection('wallets').doc(uid);
          const now = new Date();
          try {
            await db.runTransaction(async (tx) => {
              const ws = await tx.get(walletRef);
              const cur = ws.exists ? ws.data() : {};
              tx.set(walletRef, {
                balance: (cur.balance || 0) + coinBonus,
                totalEarned: (cur.totalEarned || 0) + coinBonus,
                vp: (cur.vp || 0) + vpBonus,
                tier: plan,
                updatedAt: now,
                ...(!ws.exists ? { createdAt: now, gems: 0, totalSpent: 0 } : {}),
              }, { merge: true });
              tx.set(claimRef, { userId: uid, questId: 'plan_bonus', month: monthKey, plan, coins: coinBonus, vp: vpBonus, claimedAt: now });
              tx.set(db.collection('transactions').doc(), {
                userId: uid, type: 'plan_bonus', amount: coinBonus,
                description: `${plan.toUpperCase()} monthly: +${coinBonus} coins + ${vpBonus} VP`,
                createdAt: now,
              });
              tx.set(db.collection('notifications').doc(), {
                recipientId: uid, type: 'coins',
                title: `+${coinBonus} coins + ${vpBonus} VP`,
                body: `Your ${plan.toUpperCase()} monthly bonus has landed!`,
                read: false, data: { type: 'plan_bonus', plan, coins: coinBonus, vp: vpBonus }, createdAt: now,
              });
            });
            paid++;
          } catch (e) {
            console.error(`plan_bonus failed for ${uid}:`, e.message);
          }
        }));

        if (batch.docs.length < 400) break;
      }
    }

    console.log(`payMonthlyPlanBonus ${monthKey}: paid ${paid} users`);
    return null;
  }
);

// ──────────────────────────────────────────────────────────────
// GEMINI-BACKED MODERATION
// Uses Gemini 1.5 Flash via REST (no SDK dep) with safety settings
// to classify content. Free tier: 15 RPM / 1M TPM — more than enough
// for chat + periodic stream frame checks at our current scale.
// Set the API key with: firebase functions:secrets:set GEMINI_API_KEY
// ──────────────────────────────────────────────────────────────
const GEMINI_SECRET = functions.params.defineSecret('GEMINI_API_KEY');

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';

const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_LOW_AND_ABOVE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_LOW_AND_ABOVE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_LOW_AND_ABOVE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_LOW_AND_ABOVE' },
];

async function callGemini(apiKey, parts) {
  try {
    const res = await axios.post(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      contents: [{ role: 'user', parts }],
      safetySettings: SAFETY_SETTINGS,
      generationConfig: { temperature: 0, maxOutputTokens: 16 },
    }, { timeout: 8000 });
    const data = res.data;
    // If the prompt was blocked by safety, promptFeedback carries the reason.
    if (data.promptFeedback?.blockReason) {
      return { flagged: true, reason: data.promptFeedback.blockReason.toLowerCase(), raw: data };
    }
    // If a candidate came back with a safety block, candidates[].finishReason === 'SAFETY'
    const candidate = data.candidates?.[0];
    if (candidate?.finishReason === 'SAFETY') {
      const worst = (candidate.safetyRatings || []).find(r => r.probability && r.probability !== 'NEGLIGIBLE');
      return { flagged: true, reason: worst?.category?.toLowerCase() || 'safety', raw: data };
    }
    // Otherwise parse the model's Yes/No answer
    const text = (candidate?.content?.parts?.[0]?.text || '').trim().toLowerCase();
    return { flagged: text.startsWith('yes'), reason: text.startsWith('yes') ? 'flagged_by_model' : null, raw: data };
  } catch (err) {
    console.error('Gemini call failed:', err.response?.data || err.message);
    // Fail-open: if Gemini is down we don't want to drop every message.
    // The client-side rules already caught obvious violations.
    return { flagged: false, reason: 'gemini_unavailable', error: true };
  }
}

// Public callable — viewers call this before a message goes into Firestore.
// Returns { ok, reason? }. Caller should block send if ok===false.
exports.moderateMessage = functions.https.onCall(
  { secrets: [GEMINI_SECRET], region: 'europe-west1' },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    const { text, chatId } = request.data || {};
    if (typeof text !== 'string' || !text.trim()) {
      throw new functions.https.HttpsError('invalid-argument', 'text required');
    }
    // Short-circuit very short messages — Gemini is overkill for "gg"
    if (text.length < 12) return { ok: true, skipped: 'too_short' };

    const apiKey = GEMINI_SECRET.value();
    if (!apiKey) {
      console.warn('GEMINI_API_KEY not set — moderation pass-through');
      return { ok: true, skipped: 'no_api_key' };
    }

    const prompt = `Act as a content moderator for a gaming community chat. Is the following message toxic, hateful, harassing, or sexually explicit? Reply with only "Yes" or "No".\n\nMessage: ${text}`;
    const result = await callGemini(apiKey, [{ text: prompt }]);

    if (result.flagged) {
      // Log to mod_actions for the streamer to review
      await db.collection('mod_actions').add({
        action: 'auto_block_chat',
        targetType: 'chat_message',
        targetUserId: uid,
        chatId: chatId || null,
        messageText: text.slice(0, 500),
        reason: result.reason,
        automated: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }).catch(() => {});
      return { ok: false, reason: result.reason || 'flagged' };
    }
    return { ok: true };
  }
);

// Stream frame check — broadcaster client grabs a canvas frame every N seconds,
// converts to base64 JPEG, and sends it here. Returns { ok, reason? }.
// Repeated flags on the same streamId bump the offender's strike counter.
exports.moderateStreamFrame = functions.https.onCall(
  { secrets: [GEMINI_SECRET], region: 'europe-west1', timeoutSeconds: 30 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    const { streamId, imageBase64, mimeType = 'image/jpeg' } = request.data || {};
    if (!imageBase64) throw new functions.https.HttpsError('invalid-argument', 'imageBase64 required');

    const apiKey = GEMINI_SECRET.value();
    if (!apiKey) return { ok: true, skipped: 'no_api_key' };

    // Strip data URL prefix if caller included it
    const b64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
    const prompt = 'Act as a content moderator. Does this image contain sexually explicit content, nudity, or graphic violence? Reply with only "Yes" or "No".';
    const result = await callGemini(apiKey, [
      { text: prompt },
      { inlineData: { mimeType, data: b64 } },
    ]);

    if (result.flagged) {
      // Increment the broadcaster's strike counter; auto-kill at 3.
      const strikeRef = db.collection('stream_strikes').doc(uid);
      let strikes = 1;
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(strikeRef);
        strikes = (snap.data()?.count || 0) + 1;
        tx.set(strikeRef, {
          count: strikes,
          lastStreamId: streamId || null,
          lastReason: result.reason || 'flagged',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      });

      await db.collection('mod_actions').add({
        action: strikes >= 3 ? 'auto_kill_stream' : 'warn_stream',
        targetType: 'live_stream',
        targetUserId: uid,
        streamId: streamId || null,
        reason: result.reason || 'flagged',
        strikeCount: strikes,
        automated: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      if (streamId) {
        await db.collection('streams').doc(streamId).set({
          moderationStatus: strikes >= 3 ? 'killed' : 'warned',
          moderationReason: result.reason || 'flagged',
          moderationAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true }).catch(() => {});
      }

      return { ok: false, reason: result.reason || 'flagged', strikes, shouldKill: strikes >= 3 };
    }
    return { ok: true };
  }
);

// Viewer-submitted report → creates a doc that mods can triage.
exports.reportStream = functions.https.onCall(
  { region: 'europe-west1' },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    const { streamId, reason, detail } = request.data || {};
    if (!streamId || !reason) throw new functions.https.HttpsError('invalid-argument', 'streamId and reason required');
    await db.collection('stream_reports').add({
      streamId, reason, detail: detail || null, reporterId: uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'pending',
    });
    return { ok: true };
  }
);

// ─────────────────────────────────────────────────────────────────────────
// AUDIENCE DEMOGRAPHICS — GDPR-lawful passive signals + creator aggregates
// ─────────────────────────────────────────────────────────────────────────

/**
 * getClientSignals
 * Callable. Returns approximate country (and region/city when available)
 * derived from the request IP using headers set by upstream CDNs/load
 * balancers. Best-effort — returns null fields when not determinable.
 *
 * The client is responsible for gating calls to this function behind the
 * user's `audienceAnalytics` consent (see src/utils/captureSignals.js).
 */
exports.getClientSignals = functions.https.onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  }
  // Firebase Hosting + Google Cloud Functions v2 may set various geo headers
  // depending on how the request is routed. Read whichever is populated.
  const h = request.rawRequest?.headers || {};
  const pick = (...keys) => {
    for (const k of keys) {
      const v = h[k] || h[k.toLowerCase()];
      if (v && typeof v === 'string') return v.trim();
    }
    return null;
  };
  const country = pick(
    'x-appengine-country',          // App Engine / Firebase Hosting
    'cf-ipcountry',                 // Cloudflare
    'fastly-geo-country-code',      // Fastly
    'x-country-code',               // Common proxy header
    'x-vercel-ip-country',
  );
  const region = pick(
    'x-appengine-region',
    'cf-region-code',
    'x-vercel-ip-country-region',
  );
  const city = pick(
    'x-appengine-city',
    'cf-ipcity',
    'x-vercel-ip-city',
  );
  return {
    country: country && country !== 'ZZ' ? country.toUpperCase() : null,
    region:  region  || null,
    city:    city    ? decodeURIComponent(city) : null,
  };
});

/**
 * aggregateCreatorAudience
 * Callable. Reads the caller's followers, joins their `users/{uid}/meta/signals`
 * + DOB/gender, and writes anonymized aggregates to
 * `creators/{uid}/aggregates/audience`.
 *
 * Only includes followers whose `audienceAnalytics` consent is granted —
 * others are counted only in a "consent-withheld" bucket (for UI transparency).
 * Cached server-side for 1 hour.
 */
exports.aggregateCreatorAudience = functions.https.onCall(
  { timeoutSeconds: 60, memory: '256MiB' },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');

    const aggRef = db.collection('creators').doc(uid).collection('aggregates').doc('audience');
    const existing = await aggRef.get();
    const now = Date.now();
    if (existing.exists) {
      const d = existing.data();
      const last = d.updatedAtMs || 0;
      if (now - last < 60 * 60 * 1000) {
        return { cached: true, ...d };
      }
    }

    // Fetch followers (flat collection: users/{creatorId}/followers/{followerId})
    const followersSnap = await db.collection('users').doc(uid).collection('followers').limit(5000).get();
    const followerIds = followersSnap.docs.map(d => d.id);
    const totalFollowers = followerIds.length;

    const ageBuckets   = { '13-17': 0, '18-24': 0, '25-34': 0, '35-44': 0, '45+': 0, unknown: 0 };
    const genderCounts = { male: 0, female: 0, nyb: 0, unknown: 0 };
    const countryCounts = {};
    const languageCounts = {};
    const gameCounts     = {};
    const tagCounts      = {};
    const contentTypeCounts = {};
    const activeHours    = new Array(24).fill(0);
    let consentWithheld = 0;
    let affinityContributors = 0;

    // Batch reads in chunks of 10 (Firestore getAll limit is higher, but keeps memory low)
    const chunkSize = 30;
    for (let i = 0; i < followerIds.length; i += chunkSize) {
      const chunk = followerIds.slice(i, i + chunkSize);
      const userRefs   = chunk.map(id => db.collection('users').doc(id));
      const signalRefs = chunk.map(id => db.collection('users').doc(id).collection('meta').doc('signals'));
      const consentRefs = chunk.map(id => db.collection('users').doc(id).collection('meta').doc('consents'));
      const affinityRefs = chunk.map(id => db.collection('users').doc(id).collection('meta').doc('affinity'));
      const [users, signals, consents, affinities] = await Promise.all([
        db.getAll(...userRefs),
        db.getAll(...signalRefs),
        db.getAll(...consentRefs),
        db.getAll(...affinityRefs),
      ]);
      for (let j = 0; j < chunk.length; j++) {
        const u = users[j].exists   ? users[j].data()   : null;
        const s = signals[j].exists ? signals[j].data() : null;
        const c = consents[j].exists ? consents[j].data() : null;
        const ok = c?.audienceAnalytics?.granted === true;
        if (!ok) { consentWithheld++; continue; }

        const bucket = u?.ageBucket;
        if (bucket && ageBuckets[bucket] != null) ageBuckets[bucket]++;
        else ageBuckets.unknown++;

        const g = u?.gender;
        if (g && genderCounts[g] != null) genderCounts[g]++;
        else genderCounts.unknown++;

        const country = u?.country || s?.country;
        if (country) countryCounts[country] = (countryCounts[country] || 0) + 1;

        const lang = s?.language;
        if (lang) {
          const primary = String(lang).split('-')[0];
          languageCounts[primary] = (languageCounts[primary] || 0) + 1;
        }

        // Merge affinity rollups (only present for users with personalizedAds consent)
        const aff = affinities[j].exists ? affinities[j].data() : null;
        if (aff) {
          affinityContributors++;
          (aff.topGames || []).forEach(({ name, value }) => {
            if (name) gameCounts[name] = (gameCounts[name] || 0) + (value || 1);
          });
          (aff.topTags || []).forEach(({ name, value }) => {
            if (name) tagCounts[name] = (tagCounts[name] || 0) + (value || 1);
          });
          (aff.topContentTypes || []).forEach(({ name, value }) => {
            if (name) contentTypeCounts[name] = (contentTypeCounts[name] || 0) + (value || 1);
          });
          if (Array.isArray(aff.activeHours) && aff.activeHours.length === 24) {
            for (let h = 0; h < 24; h++) activeHours[h] += aff.activeHours[h] || 0;
          }
        }
      }
    }

    // Rank top countries/languages/games/tags/contentTypes
    const rank = (obj, n = 10) => Object.entries(obj)
      .sort((a, b) => b[1] - a[1]).slice(0, n)
      .map(([name, value]) => ({ name, value }));
    const topCountries    = rank(countryCounts);
    const topLanguages    = rank(languageCounts);
    const topGames        = rank(gameCounts);
    const topTags         = rank(tagCounts, 15);
    const topContentTypes = rank(contentTypeCounts);

    const payload = {
      totalFollowers,
      consentedFollowers: totalFollowers - consentWithheld,
      consentWithheld,
      ageBuckets,
      genderCounts,
      topCountries,
      topLanguages,
      topGames,
      topTags,
      topContentTypes,
      activeHours,
      affinityContributors,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: now,
    };
    await aggRef.set(payload, { merge: true });
    return { cached: false, ...payload };
  }
);

// ─────────────────────────────────────────────────────────────────────────
// USER AFFINITY — rolls raw users/{uid}/events → users/{uid}/meta/affinity
// ─────────────────────────────────────────────────────────────────────────

/**
 * Core rollup: reads last 30 days of events for a uid and writes a
 * compact affinity doc: topGames, topTags, topCreators, topContentTypes,
 * activeHours (0-23 histogram), totalEvents, lastRollupAt.
 *
 * Event-type weights reflect intent strength (a share is worth more than a view).
 */
async function rollupAffinityFor(uid) {
  if (!uid) return null;
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  const snap = await db.collection('users').doc(uid).collection('events')
    .where('tsMs', '>=', cutoff)
    .limit(5000)
    .get();

  if (snap.empty) {
    await db.collection('users').doc(uid).collection('meta').doc('affinity')
      .set({ topGames: [], topTags: [], topCreators: [], topContentTypes: [],
             activeHours: new Array(24).fill(0), totalEvents: 0,
             lastRollupAt: admin.firestore.FieldValue.serverTimestamp(),
             lastRollupAtMs: Date.now() }, { merge: true });
    return { totalEvents: 0 };
  }

  const W = {
    view: 1, dwell: 2, short_watched: 3,
    like: 5, comment: 6, save: 6, repost: 8, share: 8,
    profile_visit: 4, creator_follow: 10,
    tag_click: 4, game_click: 5, search: 2,
    ad_click: 6, ad_impression: 1, ad_dismiss: -1,
    unlike: -3, hide: -5, report: -10,
  };

  const games = {}, tags = {}, creators = {}, types = {};
  const hours = new Array(24).fill(0);
  let total = 0;

  snap.docs.forEach(d => {
    const e = d.data();
    const w = W[e.type] != null ? W[e.type] : 1;
    total++;
    if (e.gameId)      games[e.gameId] = (games[e.gameId] || 0) + w;
    if (e.contentType) types[e.contentType] = (types[e.contentType] || 0) + w;
    if (e.authorId)    creators[e.authorId] = (creators[e.authorId] || 0) + w;
    if (Array.isArray(e.tags)) e.tags.forEach(t => { if (t) tags[t] = (tags[t] || 0) + w; });
    if (e.tsMs) {
      const h = new Date(e.tsMs).getUTCHours();
      if (h >= 0 && h < 24) hours[h]++;
    }
  });

  const rank = (obj, n = 10) => Object.entries(obj)
    .filter(([,v]) => v > 0)
    .sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([name, value]) => ({ name, value }));

  const affinity = {
    topGames: rank(games),
    topTags:  rank(tags, 15),
    topCreators: rank(creators, 25),
    topContentTypes: rank(types),
    activeHours: hours,
    totalEvents: total,
    lastRollupAt: admin.firestore.FieldValue.serverTimestamp(),
    lastRollupAtMs: Date.now(),
  };

  await db.collection('users').doc(uid).collection('meta').doc('affinity')
    .set(affinity, { merge: true });
  return affinity;
}

/** Callable — lets the client force-refresh its own affinity (used by ad targeting). */
exports.rollupUserAffinity = functions.https.onCall(
  { timeoutSeconds: 60, memory: '256MiB' },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
    // Respect consent: only roll up if personalizedAds is granted
    const c = await db.collection('users').doc(uid).collection('meta').doc('consents').get();
    if (c.data()?.personalizedAds?.granted !== true) {
      return { skipped: true, reason: 'consent-not-granted' };
    }
    const res = await rollupAffinityFor(uid);
    return { ok: true, ...res };
  }
);

/**
 * Scheduled — rolls up affinity for users who have recent events.
 * Runs daily at 03:30 UTC. Scans users with new events in the last 36h.
 */
const _scheduledRollupAffinity = defer('30 3 * * *', async () => {
    // Walk the collectionGroup of recent events to find active uids
    const since = Date.now() - 36 * 3600 * 1000;
    const recent = await db.collectionGroup('events')
      .where('tsMs', '>=', since)
      .select() // minimize reads — we only need paths
      .limit(20000)
      .get();

    const uids = new Set();
    recent.docs.forEach(d => {
      // path: users/{uid}/events/{eventId}
      const parts = d.ref.path.split('/');
      const uidIdx = parts.indexOf('users');
      if (uidIdx >= 0 && parts[uidIdx + 1]) uids.add(parts[uidIdx + 1]);
    });

    let count = 0;
    for (const uid of uids) {
      try { await rollupAffinityFor(uid); count++; } catch (e) { console.warn('rollup fail', uid, e.message); }
    }
    console.log(`rollupAffinity: rolled up ${count}/${uids.size} users`);
  });

/**
 * Scheduled — deletes raw events older than 90 days.
 * Affinity rollups survive; raw logs are GDPR-minimised.
 * Runs daily at 04:00 UTC.
 */
const _scheduledPruneEvents = defer('0 4 * * *', async () => {
    const cutoff = Date.now() - 90 * 24 * 3600 * 1000;
    const old = await db.collectionGroup('events')
      .where('tsMs', '<', cutoff)
      .limit(5000)
      .get();
    if (old.empty) return;
    const batchSize = 400;
    let deleted = 0;
    for (let i = 0; i < old.docs.length; i += batchSize) {
      const b = db.batch();
      old.docs.slice(i, i + batchSize).forEach(d => b.delete(d.ref));
      await b.commit();
      deleted += Math.min(batchSize, old.docs.length - i);
    }
    console.log(`prunedEvents: deleted ${deleted}`);
  });

// ──────────────────────────────────────────────────────────────
// SUPER ADMIN — bot management callables.
// All require profile.role === 'admin' on the caller's user doc.
// ──────────────────────────────────────────────────────────────
// Reuse the shared admin gate so we get audit + rate-limit + step-up
// helpers consistent across every privileged callable. The local
// requireAdmin alias is kept for backward-compat with existing call
// sites in this file.
const { requireAdmin, adminRateLimit, auditAdminAction, extractRequestMeta } = adminSecurity;

// Manually trigger the daily bot sync. Honors the same paused flags as the cron.
exports.runBotSyncNow = functions.https.onCall(async (request) => {
  await requireAdmin(request.auth?.uid);
  await adminRateLimit(request.auth.uid, 'run_bot_sync_now', { perHour: 10, perDay: 30 });
  const meta = extractRequestMeta(request);
  const cfg = await db.collection('app_config').doc('general').get();
  if (cfg.exists && cfg.data()?.botsPaused === true) {
    return { ok: false, reason: 'Bots are globally paused. Resume first.' };
  }
  const PER_BOT_LIMIT = Math.max(0, Number(cfg.data()?.maxPostsPerBotPerRun ?? 2));
  let totalCreated = 0;
  for (const bot of NEWS_BOT_ACCOUNTS) {
    try {
      const botSnap = await db.collection('users').doc(bot.id).get();
      if (botSnap.exists && botSnap.data()?.botPaused === true) continue;
      const response = await axios.get(bot.rssUrl, { timeout: 10000 });
      const items = (response.data?.items || []).slice(0, 6);
      let createdForThisBot = 0;
      for (const item of items) {
        if (createdForThisBot >= PER_BOT_LIMIT) break;
        if (!item.link) continue;
        const linkHash = hashString(item.link);
        const postId = `${bot.id}-${linkHash}`;
        const postRef = db.collection('posts').doc(postId);
        const postSnap = await postRef.get();
        if (postSnap.exists) continue;
        let imageUrl = null;
        if (item.enclosure?.url && item.enclosure.type?.startsWith('image/')) imageUrl = item.enclosure.url;
        else if (item.description) {
          const m = item.description.match(/<img[^>]+src="([^">]+)"/);
          if (m) imageUrl = m[1];
        } else if (item.thumbnail) imageUrl = item.thumbnail;
        if (imageUrl && !imageUrl.startsWith('http')) imageUrl = null;
        let cleanPreview = (item.description || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
        if (!cleanPreview) cleanPreview = item.title || '';
        await postRef.set({
          authorId: bot.id, content: item.title || '', type: 'text',
          slug: newsSlug(item.title, linkHash),
          mediaUrls: imageUrl ? [imageUrl] : [], hashtags: [],
          likeCount: 0, commentCount: 0, shareCount: 0, saveCount: 0, viewCount: 0,
          status: 'published', rankScore: 0, sourceUrl: item.link, isNewsPost: true,
          previewText: cleanPreview, needsEnrichment: true,
          // MUST match the cron path (_syncNewsBotFeeds). Without this flag a
          // manually-synced post is never queued for its SEO rewrite, so it
          // stays a verbatim copy and ugcRenderer keeps it noindex forever.
          needsSeoRewrite: true,
          linkPreview: { url: item.link, title: item.title || '', description: cleanPreview, image: imageUrl },
          createdAt: item.pubDate ? new Date(item.pubDate) : new Date(),
          updatedAt: new Date(),
        });
        await db.collection('users').doc(bot.id).update({ postCount: admin.firestore.FieldValue.increment(1) });
        totalCreated++; createdForThisBot++;
      }
    } catch (err) {
      console.error(`runBotSyncNow ${bot.id} failed:`, err.message);
    }
  }
  await auditAdminAction({
    actor: request.auth.uid,
    action: 'run_bot_sync_now',
    ip: meta.ip,
    userAgent: meta.userAgent,
    meta: { totalCreated },
  }).catch(() => {});
  return { ok: true, totalCreated };
});

// Delete the most recent N posts from a specific bot (cleanup helper).
exports.deleteBotPosts = functions.https.onCall(async (request) => {
  await requireAdmin(request.auth?.uid);
  await adminRateLimit(request.auth.uid, 'delete_bot_posts', { perHour: 20, perDay: 100 });
  const meta = extractRequestMeta(request);
  const { botId, count = 10 } = request.data || {};
  if (!botId) throw new functions.https.HttpsError('invalid-argument', 'botId required');
  const snap = await db.collection('posts')
    .where('authorId', '==', botId)
    .orderBy('createdAt', 'desc')
    .limit(Math.min(500, Number(count) || 10))
    .get();
  let deleted = 0;
  const batch = db.batch();
  snap.forEach(doc => { batch.delete(doc.ref); deleted++; });
  await batch.commit();
  await db.collection('users').doc(botId).update({
    postCount: admin.firestore.FieldValue.increment(-deleted),
  }).catch(() => {});
  await auditAdminAction({
    actor: request.auth.uid,
    action: 'delete_bot_posts',
    target: { type: 'bot', id: botId },
    meta: { requested: count, deleted },
    ip: meta.ip,
    userAgent: meta.userAgent,
  }).catch(() => {});
  return { ok: true, deleted };
});

// Pause / resume globally — single source of truth for the kill switch.
exports.setBotsPaused = functions.https.onCall(async (request) => {
  await requireAdmin(request.auth?.uid);
  await adminRateLimit(request.auth.uid, 'set_bots_paused', { perHour: 20, perDay: 60 });
  const meta = extractRequestMeta(request);
  const { paused } = request.data || {};
  const cfgRef = db.collection('app_config').doc('general');
  const before = (await cfgRef.get()).data()?.botsPaused ?? null;
  await cfgRef.set({ botsPaused: !!paused }, { merge: true });
  await auditAdminAction({
    actor: request.auth.uid,
    action: 'set_bots_paused',
    target: { type: 'app_config', id: 'general' },
    before: { botsPaused: before },
    after:  { botsPaused: !!paused },
    ip: meta.ip,
    userAgent: meta.userAgent,
  }).catch(() => {});
  return { ok: true, paused: !!paused };
});

// Update per-run cap (max posts per bot per run).
exports.setBotPostLimit = functions.https.onCall(async (request) => {
  await requireAdmin(request.auth?.uid);
  await adminRateLimit(request.auth.uid, 'set_bot_post_limit', { perHour: 20, perDay: 60 });
  const meta = extractRequestMeta(request);
  const { limit } = request.data || {};
  const n = Math.max(0, Math.min(20, Number(limit)));
  const cfgRef = db.collection('app_config').doc('general');
  const before = (await cfgRef.get()).data()?.maxPostsPerBotPerRun ?? null;
  await cfgRef.set({ maxPostsPerBotPerRun: n }, { merge: true });
  await auditAdminAction({
    actor: request.auth.uid,
    action: 'set_bot_post_limit',
    target: { type: 'app_config', id: 'general' },
    before: { maxPostsPerBotPerRun: before },
    after:  { maxPostsPerBotPerRun: n },
    ip: meta.ip,
    userAgent: meta.userAgent,
  }).catch(() => {});
  return { ok: true, limit: n };
});

// ──────────────────────────────────────────────────────────────
// CONSOLIDATED CRON DISPATCHERS
// 11 former scheduled maintenance jobs are folded into 3 Cloud Scheduler
// jobs below (see the `defer` shim near the top). Each handler runs inside
// its own try/catch so one failure never aborts the others. notifyScheduledStreams
// keeps its own every-5-min schedule (time-sensitive go-live reminders).
// ──────────────────────────────────────────────────────────────
async function _runJobs(label, jobs) {
  for (const [name, fn] of jobs) {
    try { await fn(); }
    catch (e) { console.error(`[${label}] ${name} failed:`, e?.message || e); }
  }
}

// Daily maintenance — cleanups, prunes, affinity rollup, and the news bot
// sync + enrich + SEO rewrite (order guaranteed: sync → enrich → rewrite,
// so the day's new bot posts get their original Gemini write-up in the
// same pass; see newsSeoRewrite.js — no polling, founder directive).
const newsSeoRewrite = require('./newsSeoRewrite');
exports.cronDaily = functions.scheduler.onSchedule(
  {
    schedule: '0 3 * * *', timeZone: 'UTC', region: 'europe-west1',
    timeoutSeconds: 540, secrets: [newsSeoRewrite.GEMINI_POST_TEXT_KEY],
  },
  async () => _runJobs('cronDaily', [
    ['cleanupExpiredMedia', _cleanupExpiredMedia],
    ['scheduledPruneEvents', _scheduledPruneEvents],
    ['scheduledRollupAffinity', _scheduledRollupAffinity],
    ['syncNewsBotFeeds', _syncNewsBotFeeds],
    ['enrichNewsPosts', _enrichNewsPosts],
    ['rewriteNewsForSeo', newsSeoRewrite.rewriteNewsForSeo],
    ['cleanupExpiredTotpEnrollments', adminSecurity.cleanupExpiredTotpEnrollments],
    ['scheduledKycRetention', kyc.scheduledKycRetention],
    ['rollupDailyMetrics', dailyMetricsRollup.rollupDailyMetrics],
    ['applyScheduledPriceChanges', adminSubscriptions.applyScheduledPriceChanges],
    ['renewExpiringSubscriptions', subs.renewExpiringSubscriptions],
    ['renewMemberSubscriptions', memberships.renewMemberSubscriptions],
    ['syncAllShopInventories', shopSync.syncAllShopInventories],
    ['purgeStaleGuests', guestCleanup.purgeStaleGuests],
    // Play renews subscriptions on its own schedule and does not tell us, so a
    // tier granted once would outlive the payment without this reconcile.
    ['syncPlaySubscriptions', playBilling.syncPlaySubscriptions],
  ]),
);

// Every 6 hours — vote resolution, rank scores, trending, story expiry.
exports.cronEvery6h = functions.scheduler.onSchedule(
  { schedule: '0 */6 * * *', timeZone: 'UTC', region: 'europe-west1' },
  async () => _runJobs('cronEvery6h', [
    ['resolveExpiredVotes', _resolveExpiredVotes],
    ['calculateRankScores', _calculateRankScores],
    ['updateTrending', _updateTrending],
    ['cleanupExpiredStories', _cleanupExpiredStories],
    ['cleanupExpiredStatuses', _cleanupExpiredStatuses],
    ['writePresenceSnapshot', adminStats.writePresenceSnapshot],
    // Rolls the RTDB view counters into posts.viewCount. Firestore writes
    // scale with ACTIVE POSTS x 4/day, never with how many times they were seen.
    ['aggregatePostViews', require('./postViews')._internal.aggregatePostViews],
  ]),
);

// Monthly — plan bonus + squad elections (1st of month, 06:00 UTC).
exports.cronMonthly = functions.scheduler.onSchedule(
  { schedule: '0 6 1 * *', timeZone: 'UTC', region: 'europe-west1' },
  async () => _runJobs('cronMonthly', [
    ['payMonthlyPlanBonus', _payMonthlyPlanBonus],
    ['monthlySquadElections', _monthlySquadElections],
    ['distributeVanguardTreasury', vanguard.distributeVanguardTreasury],
  ]),
);

// Every minute — tournament/stream live machinery. Each handler self-gates
// (queries for live/imminent work and returns fast when there is none), so
// calling them sequentially from one Scheduler job is behaviour-identical to
// the 5 former every-1-minute jobs, at 1/5th the Scheduler cost. 540s timeout
// covers autoSuggestMatchWinners' worst case; handlers run in try/catch.
exports.cronMinute = functions.scheduler.onSchedule(
  { schedule: 'every 1 minutes', timeZone: 'UTC', region: 'europe-west1', timeoutSeconds: 540 },
  async () => _runJobs('cronMinute', [
    ['chargeStreamBoosts', streamingBoost.chargeStreamBoosts],
    ['reapStaleStreams', streaming.reapStaleStreams],
  ]),
);

// Every 5 minutes — tournament timeout/no-show sweeps, scheduled-post publish,
// scheduled-stream reminders. All self-gate (query for due work, return fast
// when none). detectMatchTimeouts was a 30-min job; running it every 5 min is
// behaviour-safe (it just checks deadlines more often) and saves a Scheduler
// job. Payment pollers + secret/money-out crons intentionally kept standalone.
exports.cron5Min = functions.scheduler.onSchedule(
  { schedule: 'every 5 minutes', timeZone: 'UTC', region: 'europe-west1', timeoutSeconds: 300 },
  async () => _runJobs('cron5Min', [
    ['detectTournamentNoShows', vanguardAssignments.detectTournamentNoShows],
    ['publishScheduledPosts', scheduledPosts.publishScheduledPosts],
    ['notifyScheduledStreams', _notifyScheduledStreams],
    // Self-gates to a single indexed query returning nothing when no campaign
    // is scheduled, so it is folded in here rather than earning its own
    // Cloud Scheduler job (a new schedule is a recurring bill).
    ['releaseScheduledCampaigns', campaigns.releaseScheduledCampaigns],
  ]),
);

// Every 15 minutes — assignment reminders + admin TOTP brute-force monitor.
// Both self-gate and carry no secrets. (processReadyWithdrawals stays a
// standalone 512MB money-out job; payment pollers stay standalone too.)
exports.cron15Min = functions.scheduler.onSchedule(
  { schedule: 'every 15 minutes', timeZone: 'UTC', region: 'europe-west1' },
  async () => _runJobs('cron15Min', [
    ['notifyUpcomingAssignments', vanguardAssignments.notifyUpcomingAssignments],
    ['adminTotpBruteForceMonitor', adminAlerts.adminTotpBruteForceMonitor],
  ]),
);
exports.backfillNewsSeoQueue = newsSeoRewrite.backfillNewsSeoQueue;

// IndexNow (Bing/Yandex/Naver/Seznam fast path — Google does NOT participate).
exports.indexNowBacklog = require('./indexNow').indexNowBacklog;
exports.adminRewriteNewsSeo = newsSeoRewrite.adminRewriteNewsSeo;
