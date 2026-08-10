// ═══════════════════════════════════════════
// VERGR SUBSCRIPTION TIERS — Free / Lite / Pro
// ═══════════════════════════════════════════
// Commission is determined ONLY by VP level, NOT by plan.
// Plans grant VP multipliers, monthly bonuses, and feature unlocks.

export const TIERS = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    priceLabel: 'Free',
    color: '#7B82A8',
    icon: 'person',
    tagline: 'Get started',
    // First 5 are the headline "Top Perks" shown on the subscription screen.
    // Rest follow as additional perks in the full feature list.
    features: [
      'Core social + tournaments',
      '200MB uploads',
      '720p photos & 60s shorts',
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
    features: [
      'No ads',
      'Stream publicly from day one (720p)',
      '1.5× VP multiplier + monthly bonuses',
      'Create squads & tournaments (up to 32 players)',
      '1GB uploads, 1080p photos',
      'Voice messages',
      'Post boosts + scheduled posts',
      'Custom banner',
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
    features: [
      '1080p streaming + co-streaming',
      'Past broadcasts: streams saved as 90-day replays',
      '2× VP multiplier + biggest monthly bonuses',
      'Tournaments up to 256 players, all bracket formats',
      'Vergr.me custom domain + advanced analytics',
      'Private streaming (IP masked from viewers)',
      '5GB uploads, 4K photos',
      'Animated avatar + Pro badge',
      'Priority support + early access',
    ],
  },
};

// ── FEATURE FLAGS (per tier, complete matrix) ──
export const TIER_FEATURES = {
  free: {
    // Access & Core
    ads: true,
    mediaPerDay: 50,
    // Uploads (synced with src/utils/mediaCompression.js TIER_MAX_BYTES + functions/r2.js SIZE_CAPS)
    maxUploadMB: 200,
    maxShortSeconds: 60,
    maxClipMinutes: 5,
    maxQuality: '720p',
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
    streamHoursPerMonth: 15, // soft cap — 30min/day × 30days
    privateStreamingTURN: false, // IP exposure to peers in P2P
    coStream: false,
    // Tournaments
    canCreateTournament: false,
    maxTournamentSize: 0,
    tournamentBracketTypes: [],
    // Squads
    canCreateSquad: false,
    maxSquadsOwned: 0,
    maxSquadMembers: 0,
    // Messaging
    voiceMessages: false,
    videoMessages: false,
    maxPinnedChats: 0,
    // Economy
    vpMultiplier: 1,
    monthlyVP: 0,
    monthlyCoins: 0,
    coinPackDiscount: 0,
    // Vergr.me
    vergrMeEnabled: true,
    vergrMeCustomDomain: false,
    vergrMeAnalytics: false,
    vergrMeThemes: 'basic',
    // Content creation
    postBoosts: false,
    scheduledPosts: false,
    draftsLimit: 5,
    // Profile
    animatedAvatar: false,
    customBanner: false,
    profileBadge: null,
    // Tools
    advancedAnalytics: false,
    earlyAccess: false,
    prioritySupport: false,
  },
  lite: {
    ads: false,
    mediaPerDay: 200,
    maxUploadMB: 1024,
    maxShortSeconds: 60,
    maxClipMinutes: 15,
    maxQuality: '1080p',
    canStream: true,
    canStreamPublic: true,
    streamFollowerGate: 0,
    streamBoostCoinFee: 0,
    streamQuality: '720p30',
    viewerRenditionCap: '720p',
    streamMinutesPerDay: 240,
    streamHoursPerMonth: 40,
    privateStreamingTURN: false,
    coStream: false,
    canCreateTournament: true,
    maxTournamentSize: 32,
    tournamentBracketTypes: ['single_elim', 'double_elim', 'round_robin'],
    canCreateSquad: true,
    maxSquadsOwned: 2,
    maxSquadMembers: 25,
    voiceMessages: true,
    videoMessages: false,
    maxPinnedChats: 5,
    vpMultiplier: 1.5,
    monthlyVP: 1000,
    monthlyCoins: 50,
    coinPackDiscount: 0.05,
    vergrMeEnabled: true,
    vergrMeCustomDomain: false,
    vergrMeAnalytics: true,
    vergrMeThemes: 'standard',
    postBoosts: true,
    scheduledPosts: true,
    draftsLimit: 25,
    animatedAvatar: false,
    customBanner: true,
    profileBadge: 'lite',
    advancedAnalytics: false,
    earlyAccess: false,
    prioritySupport: false,
  },
  pro: {
    ads: false,
    mediaPerDay: Infinity,
    maxUploadMB: 5120,
    maxShortSeconds: 180,
    maxClipMinutes: 60,
    maxQuality: '4K',
    canStream: true,
    canStreamPublic: true,
    streamFollowerGate: 0,
    streamBoostCoinFee: 0,
    streamQuality: '1080p60',
    viewerRenditionCap: '1080p',
    streamMinutesPerDay: Infinity,
    streamHoursPerMonth: Infinity,
    privateStreamingTURN: true, // IP masking via Cloudflare TURN, paid feature
    coStream: true,
    canCreateTournament: true,
    maxTournamentSize: 256,
    tournamentBracketTypes: ['single_elim', 'double_elim', 'round_robin', 'swiss', 'battle_royale', 'invitational'],
    canCreateSquad: true,
    maxSquadsOwned: 10,
    maxSquadMembers: 100,
    voiceMessages: true,
    videoMessages: true,
    maxPinnedChats: 25,
    vpMultiplier: 2,
    monthlyVP: 3000,
    monthlyCoins: 150,
    coinPackDiscount: 0.10,
    vergrMeEnabled: true,
    vergrMeCustomDomain: true,
    vergrMeAnalytics: true,
    vergrMeThemes: 'premium',
    postBoosts: true,
    scheduledPosts: true,
    draftsLimit: Infinity,
    animatedAvatar: true,
    customBanner: true,
    profileBadge: 'pro',
    advancedAnalytics: true,
    earlyAccess: true,
    prioritySupport: true,
  },
};

// ── TIER COMPARISON ROWS (used by pricing screen) ──
export const TIER_COMPARISON = [
  { section: 'Core',          feature: 'Ads',                 free: 'Yes',      lite: 'No',        pro: 'No' },
  { section: 'Core',          feature: 'Media/day',           free: '50',       lite: '200',       pro: 'Unlimited' },
  { section: 'Uploads',       feature: 'Upload limit',        free: '200MB',    lite: '1GB',       pro: '5GB' },
  { section: 'Uploads',       feature: 'Max clip length',     free: '5 min',    lite: '15 min',    pro: '60 min' },
  { section: 'Uploads',       feature: 'Max short length',    free: '60s',      lite: '60s',       pro: '180s' },
  { section: 'Uploads',       feature: 'Max photo quality',   free: '720p',     lite: '1080p',     pro: '4K' },
  { section: 'Streaming',     feature: 'Squad / private streams', free: '✓ (free)', lite: '✓', pro: '✓' },
  { section: 'Streaming',     feature: 'Public live streams', free: 'After 100 followers', lite: 'Yes', pro: 'Yes' },
  { section: 'Streaming',     feature: 'Stream Boost (50 coins)', free: 'Required — refunded by tips, +1.5× reach', lite: 'Optional — same boost effect', pro: 'Optional — same boost effect' },
  { section: 'Streaming',     feature: 'Stream quality',      free: '480p',     lite: '720p30',    pro: '1080p60' },
  { section: 'Streaming',     feature: 'Daily stream cap',    free: '30 min',   lite: '4 hours',   pro: 'Unlimited' },
  { section: 'Streaming',     feature: 'Monthly stream hrs',  free: '~15h',     lite: '40h',       pro: 'Unlimited' },
  { section: 'Streaming',     feature: 'Co-streaming',        free: 'No',       lite: 'No',        pro: 'Yes' },
  { section: 'Streaming',     feature: 'IP masking (TURN)',   free: 'No',       lite: 'No',        pro: 'Yes' },
  { section: 'Tournaments',   feature: 'Create tournaments',  free: 'No',       lite: 'Up to 32',  pro: 'Up to 256' },
  { section: 'Tournaments',   feature: 'Bracket formats',     free: '—',        lite: '3 formats', pro: 'All 6 formats' },
  { section: 'Squads',        feature: 'Create squads',       free: 'No',       lite: '2 squads',  pro: '10 squads' },
  { section: 'Squads',        feature: 'Max members',         free: '—',        lite: '25',        pro: '100' },
  { section: 'Messaging',     feature: 'Voice messages',      free: 'No',       lite: 'Yes',       pro: 'Yes' },
  { section: 'Messaging',     feature: 'Video messages',      free: 'No',       lite: 'No',        pro: 'Yes' },
  { section: 'Messaging',     feature: 'Pinned chats',        free: '0',        lite: '5',         pro: '25' },
  { section: 'Economy',       feature: 'VP multiplier',       free: '1×',       lite: '1.5×',      pro: '2×' },
  { section: 'Economy',       feature: 'Monthly VP',          free: '0',        lite: '1,000',     pro: '3,000' },
  { section: 'Economy',       feature: 'Monthly coins',       free: '0',        lite: '50',        pro: '150' },
  { section: 'Economy',       feature: 'Coin pack discount',  free: '0%',       lite: '5%',        pro: '10%' },
  { section: 'Vergr.me',      feature: 'Custom domain',       free: 'No',       lite: 'No',        pro: 'Yes' },
  { section: 'Vergr.me',      feature: 'Analytics',           free: 'No',       lite: 'Basic',     pro: 'Advanced' },
  { section: 'Vergr.me',      feature: 'Themes',              free: 'Basic',    lite: 'Standard',  pro: 'Premium' },
  { section: 'Content',       feature: 'Post boosts',         free: 'No',       lite: 'Yes',       pro: 'Yes' },
  { section: 'Content',       feature: 'Scheduled posts',     free: 'No',       lite: 'Yes',       pro: 'Yes' },
  { section: 'Content',       feature: 'Drafts',              free: '5',        lite: '25',        pro: 'Unlimited' },
  { section: 'Profile',       feature: 'Animated avatar',     free: 'No',       lite: 'No',        pro: 'Yes' },
  { section: 'Profile',       feature: 'Custom banner',       free: 'No',       lite: 'Yes',       pro: 'Yes' },
  { section: 'Profile',       feature: 'Plan badge',          free: '—',        lite: 'Lite',      pro: 'Pro' },
  { section: 'Tools',         feature: 'Advanced analytics',  free: 'No',       lite: 'No',        pro: 'Yes' },
  { section: 'Tools',         feature: 'Early access',        free: 'No',       lite: 'No',        pro: 'Yes' },
  { section: 'Tools',         feature: 'Priority support',    free: 'No',       lite: 'No',        pro: 'Yes' },
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
