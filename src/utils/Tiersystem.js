// ═══════════════════════════════════════════
// VERGR SUBSCRIPTION TIERS — Free / Lite / Pro
// ═══════════════════════════════════════════
// A PLAN NEVER CHANGES WHAT A CREATOR IS PAID. The revenue share is set by
// LIFETIME EARNINGS alone (50%-80%, functions/coinLedger.js shareForEarnings),
// never by plan and never by VP rank. Plans grant VP multipliers, monthly
// bonuses, and feature unlocks. Nothing that lets a creator earn, see earnings
// or get paid may sit behind a paid tier.

export const TIERS = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    priceLabel: 'Free',
    color: '#7B82A8',
    icon: 'person',
    tagline: 'Get started',
    // Display values read by the create screens. maxFileUploadMB mirrors the
    // SERVER cap in functions/r2.js SIZE_CAPS (the only cap that is enforced).
    // imageMaxDim is the canvas cap applied by uploadPostMedia(), which picks
    // its preset via mediaCompression.postPresetForTier(). Free and Lite share
    // PRESETS.post (1600px); Pro alone gets PRESETS.post4k (3840px).
    // Keep these three numbers in step with that map.
    maxFileUploadMB: 200,
    imageMaxDim: 1600,
    // First 5 are the headline "Top Perks" shown on the subscription screen.
    // Rest follow as additional perks in the full feature list.
    features: [
      'Core social + live streaming',
      '200MB uploads',
      'Squads, voice messages, co-streaming and post boosts',
      'Free squad streaming (voice + video)',
      'Public live streaming once you hit 100 followers',
      'Watch any stream',
      'Ads between posts',
    ],
  },
  lite: {
    id: 'lite',
    name: 'Lite',
    price: 4.99,
    priceLabel: '$4.99/mo',
    color: '#7B6FFF',
    icon: 'bolt',
    tagline: 'Level up faster',
    maxFileUploadMB: 1024,
    imageMaxDim: 1600,
    // AUDITED 2026-08-19 against the code that enforces each line. Anything
    // that had no tier check was REMOVED rather than gated, on founder
    // instruction: squads, voice messages, post boosts and custom banners are
    // open to everyone and are not plan features. Do not re-add them.
    features: [
      'No ads',
      'Stream publicly from day one, 720p',
      '4 hours of streaming a day',
      '1.5× VP, plus 1,000 VP and 50 coins every month',
      '1GB uploads',
      'Scheduled posts and scheduled DMs',
      'Auto-translate any conversation',
      'Creator analytics and content calendar',
      'Hide Vergr branding on your vergr.me page',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 9.99,
    priceLabel: '$9.99/mo',
    color: '#F5C542',
    icon: 'workspace_premium',
    tagline: 'Go all-in',
    maxFileUploadMB: 5120,
    imageMaxDim: 3840,
    // AUDITED 2026-08-19. Co-streaming was removed from this list on founder
    // instruction (it is open to everyone: it drives tips on live streams, so
    // gating it would cost revenue). "Private streaming, IP masked" and
    // "priority support + early access" were removed because nothing
    // implemented them. Everything left here is enforced or is being built.
    features: [
      '1080p streaming with no daily limit',
      'Past broadcasts saved as 90-day replays',
      '2× VP, plus 3,000 VP and 150 coins every month',
      '5GB uploads, 4K photos',
      // "Your own domain on vergr.me" was REMOVED 2026-08-20 (founder decision).
      // Delivering it needs Cloudflare for SaaS custom hostnames, which the API
      // refuses on this account: error 1456 "this feature is available with SSL
      // for SaaS" and 1404 "no quota has been allocated for this zone or for
      // this account". Cloudflare's public plans page claims 100 free hostnames
      // on every tier; that is NOT true for this zone. Do not re-add this line
      // without a working POST to /zones/{id}/custom_hostnames.
      'Full vergr.me design kit: custom themes, colours, video backgrounds, custom CSS',
      'Lead capture, tracking pixels and webhooks',
      'Advanced analytics',
      'Animated avatar and Pro badge',
    ],
  },
};

// ── FEATURE FLAGS (per tier) ──
//
// AUDITED 2026-08-19. Every flag below was traced to the code that reads it.
// Flags that described a limit NOTHING enforced were DELETED, not left sitting
// here looking authoritative: mediaPerDay, maxShortSeconds, maxClipMinutes,
// streamHoursPerMonth, maxPinnedChats and draftsLimit had zero consumers, and a
// plausible-looking constant is how a false promise ends up on a pricing page.
//
// Flags that were false-but-consumed are now TRUE for every tier, on founder
// instruction, because the features are open to everyone and are not plan
// perks: squads (rules allow any registered user, cap is a flat 1), voice and
// video messages, post boosts (a 50-coin purchase), custom banners, and
// co-streaming (it drives tips on live streams, so gating it costs revenue).
//
// privateStreamingTURN is gone: functions/streaming.js returns `privateTurn`
// and no client ever read it, so nothing was ever masked.
//
// RULE: do not add a flag here unless something reads it. The authoritative
// server mirrors are functions/streaming.js PLAN_RULES and functions/r2.js
// SIZE_CAPS; keep those in sync, they are what actually rejects.
export const TIER_FEATURES = {
  free: {
    // Access & Core
    ads: true,
    // Uploads. Server mirror: functions/r2.js SIZE_CAPS (the enforcing copy)
    // and src/utils/mediaCompression.js TIER_MAX_BYTES.
    maxUploadMB: 200,
    // Longest edge of an uploaded photo after compression.
    maxPhotoPx: 1600,
    // Streaming — squad streams (voice + ≤2 video publishers per room) always allowed
    // via Pion SFU on Hetzner (not WebRTC mesh — server-mediated SFU is the actual stack).
    // Public streams gated behind 100-follower threshold + 50-coin Stream Boost ignition fee.
    canStream: true,
    canStreamPublic: false, // unlocked at 100 followers
    streamFollowerGate: 100,
    streamBoostCoinFee: 50, // 50c → real algorithmic amplification (see below) + refunded by first 50c of tips
    streamQuality: '480p',
    viewerRenditionCap: '480p',
    streamMinutesPerDay: 30,
    // Days an ended broadcast stays replayable. 0 = deleted with the segments
    // at the normal 24h sweep. Server mirror: functions/vodArchive.js.
    replayRetentionDays: 0,
    // Open to everyone. Listed so nobody re-gates them by accident.
    coStream: true,
    canCreateSquad: true,
    voiceMessages: true,
    videoMessages: true,
    postBoosts: true,
    customBanner: true,
    paidStreams: true,
    // Economy
    vpMultiplier: 1,
    monthlyVP: 0,
    monthlyCoins: 0,
    // Vergr.me
    vergrMeEnabled: true,
    vergrMeCustomDomain: false,
    vergrMeHideBranding: false,
    vergrMeProDesign: false,      // custom themes/colours/video bg/CSS
    vergrMeLeads: false,          // lead capture, export, pixels, webhooks
    vergrMeEngagementStats: false, // basic views/clicks are free for everyone
    // Content creation
    scheduledPosts: false,
    scheduledDms: false,
    chatAutoTranslate: false,
    // Profile
    animatedAvatar: false,
    profileBadge: null,
    // Tools
    creatorAnalytics: false,
    advancedAnalytics: false,
  },
  lite: {
    ads: false,
    maxUploadMB: 1024,
    maxPhotoPx: 1600,
    canStream: true,
    canStreamPublic: true,
    streamFollowerGate: 0,
    streamBoostCoinFee: 0,
    streamQuality: '720p30',
    viewerRenditionCap: '720p',
    streamMinutesPerDay: 240,
    replayRetentionDays: 0,
    coStream: true,
    canCreateSquad: true,
    voiceMessages: true,
    videoMessages: true,
    postBoosts: true,
    customBanner: true,
    paidStreams: true,
    vpMultiplier: 1.5,
    monthlyVP: 1000,
    monthlyCoins: 50,
    vergrMeEnabled: true,
    vergrMeCustomDomain: false,
    vergrMeHideBranding: true,
    vergrMeProDesign: false,
    vergrMeLeads: false,
    vergrMeEngagementStats: false,
    scheduledPosts: true,
    scheduledDms: true,
    chatAutoTranslate: true,
    animatedAvatar: false,
    profileBadge: 'lite',
    creatorAnalytics: true,
    advancedAnalytics: false,
  },
  pro: {
    ads: false,
    maxUploadMB: 5120,
    // 4K long edge. Pro is the only tier whose photos are not downscaled to
    // 1600px; see mediaCompression.js PRESETS.post4k.
    maxPhotoPx: 3840,
    canStream: true,
    canStreamPublic: true,
    streamFollowerGate: 0,
    streamBoostCoinFee: 0,
    streamQuality: '1080p60',
    viewerRenditionCap: '1080p',
    streamMinutesPerDay: Infinity,
    replayRetentionDays: 90,
    coStream: true,
    canCreateSquad: true,
    voiceMessages: true,
    videoMessages: true,
    postBoosts: true,
    customBanner: true,
    paidStreams: true,
    vpMultiplier: 2,
    monthlyVP: 3000,
    monthlyCoins: 150,
    vergrMeEnabled: true,
    vergrMeCustomDomain: true,
    vergrMeHideBranding: true,
    vergrMeProDesign: true,
    vergrMeLeads: true,
    vergrMeEngagementStats: true,
    scheduledPosts: true,
    scheduledDms: true,
    chatAutoTranslate: true,
    animatedAvatar: true,
    profileBadge: 'pro',
    creatorAnalytics: true,
    advancedAnalytics: true,
  },
};

// ── TIER COMPARISON ROWS (used by pricing screen) ──
// AUDITED 2026-08-19. Every row below was traced to the code that enforces it.
// Rows whose limits existed only in this file were DELETED, not reworded:
// media/day, clip length, short length, monthly stream hours, pinned chats and
// drafts were never implemented anywhere; co-streaming, paid streams, squad
// creation and member caps, voice and video messages, post boosts and custom
// banners have no tier check and are free for everyone by founder decision;
// IP masking, early access and priority support were never built.
// DO NOT add a row here without pointing at the code that rejects.
export const TIER_COMPARISON = [
  { section: 'Core',          feature: 'Ads',                 free: 'Yes',      lite: 'No',        pro: 'No' },
  { section: 'Uploads',       feature: 'Upload limit',        free: '200MB',    lite: '1GB',       pro: '5GB' },
  { section: 'Uploads',       feature: 'Max photo quality',   free: '1600px',   lite: '1600px',    pro: '4K' },
  { section: 'Streaming',     feature: 'Squad / private streams', free: '✓ (free)', lite: '✓', pro: '✓' },
  { section: 'Streaming',     feature: 'Public live streams', free: 'After 100 followers', lite: 'Yes', pro: 'Yes' },
  { section: 'Streaming',     feature: 'Stream Boost (50 coins)', free: 'Required — refunded by tips, +1.5× reach', lite: 'Optional — same boost effect', pro: 'Optional — same boost effect' },
  { section: 'Streaming',     feature: 'Stream quality',      free: '480p',     lite: '720p30',    pro: '1080p60' },
  { section: 'Streaming',     feature: 'Daily stream cap',    free: '30 min',   lite: '4 hours',   pro: 'Unlimited' },
  { section: 'Streaming',     feature: 'Past broadcasts',     free: 'No',       lite: 'No',        pro: '90-day replays' },
  { section: 'Messaging',     feature: 'Scheduled DMs',       free: 'No',       lite: 'Yes',       pro: 'Yes' },
  { section: 'Messaging',     feature: 'Chat auto-translate', free: 'No',       lite: 'Yes',       pro: 'Yes' },
  { section: 'Economy',       feature: 'VP multiplier',       free: '1×',       lite: '1.5×',      pro: '2×' },
  { section: 'Economy',       feature: 'Monthly VP',          free: '0',        lite: '1,000',     pro: '3,000' },
  { section: 'Economy',       feature: 'Monthly coins',       free: '0',        lite: '50',        pro: '150' },
  { section: 'Vergr.me',      feature: 'Hide Vergr branding', free: 'No',       lite: 'Yes',       pro: 'Yes' },
  { section: 'Vergr.me',      feature: 'Design kit',          free: 'Basic themes', lite: 'Basic themes', pro: 'Custom themes, colours, video backgrounds, CSS' },
  { section: 'Vergr.me',      feature: 'Leads & tracking',    free: 'No',       lite: 'No',        pro: 'Capture, export, pixels, webhooks' },
  { section: 'Vergr.me',      feature: 'Page analytics',      free: 'Views & clicks', lite: 'Views & clicks', pro: '+ engagement, devices, sources' },
  { section: 'Content',       feature: 'Scheduled posts',     free: 'No',       lite: 'Yes',       pro: 'Yes' },
  { section: 'Profile',       feature: 'Animated avatar',     free: 'No',       lite: 'No',        pro: 'Yes' },
  { section: 'Profile',       feature: 'Plan badge',          free: '—',        lite: 'Lite',      pro: 'Pro' },
  { section: 'Tools',         feature: 'Creator analytics',   free: 'No',       lite: 'Yes',       pro: 'Yes' },
  { section: 'Tools',         feature: 'Content calendar',    free: 'No',       lite: 'Yes',       pro: 'Yes' },
  { section: 'Tools',         feature: 'Advanced analytics',  free: 'No',       lite: 'No',        pro: 'Yes' },
];

export default TIERS;

export const getTierConfig = (t) => TIERS[t] || TIERS.free;
export const getTierFeatures = (t) => TIER_FEATURES[t] || TIER_FEATURES.free;

// resolveTier — canonical way to read a user's plan off the profile.
// The plan is WRITTEN by the purchase flows as a top-level string field
// `subscription` ('free'|'lite'|'pro') — see functions/payram.js +
// functions/subscriptions.js. Historically the client read three different
// shapes (`profile.tier`, `profile.subscription.tier`, `profile.subscription`),
// only one of which matched what was stored, so paid users were silently read
// as free across the paywall, tournament gate, monthly bonus, etc. This helper
// is the single source of truth: it accepts every legacy shape and normalises
// to one of 'free' | 'lite' | 'pro'. Admin override stays in useTier.
export const resolveTier = (profile) => {
  if (!profile) return 'free';
  const s = profile.subscription;
  let t = typeof s === 'string' ? s : (s && typeof s === 'object' ? s.tier : null);
  t = (t || profile.tier || 'free').toString().toLowerCase();
  return t === 'lite' || t === 'pro' ? t : 'free';
};

export const checkFeatureAccess = (tier, feature) => {
  const t = TIER_FEATURES[tier] || TIER_FEATURES.free;
  return t[feature] ?? TIER_FEATURES.free[feature];
};

export const checkFileSizeAccess = (tier, fileSize) => {
  const isBytes = fileSize > 1000;
  const mb = isBytes ? fileSize / 1024 / 1024 : fileSize;
  const max = (TIER_FEATURES[tier] || TIER_FEATURES.free).maxUploadMB;
  return {
    allowed: mb <= max,
    message: mb > max ? `File too large. Max ${max}MB for ${tier} tier.` : 'OK',
    maxMB: max,
  };
};
