// The default membership tiers a creator starts with.
//
// ONE DEFINITION, because there were two and they had already drifted. The
// creator screen (MembershipTiersScreen.jsx) held the real ones and the stream
// preview restated them by hand; names and prices matched, perks did not:
//
//   Supporter  real "Exclusive posts & behind-the-scenes"  preview "Exclusive posts"
//   VIP        real had a 4th perk "Discord members channel", preview dropped it
//   Legend     real had "Private Discord channel", preview dropped it
//
// So the subscribe and gift-a-sub sheets, which are captured for the store, were
// advertising a slightly different product from the one a creator is handed.
// Same class as the TTS unlock level and the VP numbers: read the real thing,
// never restate it.
//
// ⚠ NO `id` HERE ON PURPOSE. Ids are minted per creator at first use
// (MembershipTiersScreen assigns one with mkId() when it seeds a new creator),
// so a shared constant must not carry one or two creators would share tier ids.
//
// ⚠ THESE ARE DEFAULTS, NOT PLATFORM PRICES. A creator sets their own name,
// price and perks; the perks are free text they write, so they are creator
// promises and not features Vergr enforces. Tiers live at
// `creators/{uid}.membershipTiers`.
export const DEFAULT_MEMBERSHIP_TIERS = [
  {
    name: 'Supporter',
    priceCoins: 100,
    perks: ['Subscriber badge in chat & profile', 'Exclusive posts & behind-the-scenes', 'Priority chat'],
    badge: { color: '#7B1FFF', icon: 'favorite' },
    seatLimit: null,
    communities: [],
    published: true,
    popular: false,
    order: 0,
  },
  {
    name: 'VIP',
    priceCoins: 500,
    perks: ['Everything in Supporter', 'Custom emotes (5 slots)', 'Monthly shoutout on stream', 'Discord members channel'],
    badge: { color: '#C87FFF', icon: 'star' },
    seatLimit: null,
    communities: [],
    published: true,
    popular: true,
    order: 1,
  },
  {
    name: 'Legend',
    priceCoins: 1000,
    perks: ['Everything in VIP', 'Co-stream invites', 'Private Discord channel', 'Merch discounts'],
    badge: { color: '#F0A500', icon: 'workspace_premium' },
    seatLimit: null,
    communities: [],
    published: false,
    popular: false,
    order: 2,
  },
];
