// VERGR Help Center — content INDEX + METADATA module.
//
// STRUCTURE (article bodies are split per-file, done 2026-06-06):
//   This file holds the INDEX only: HELP_CATEGORIES, the RAW title library,
//   slugify(), buildArticles(), search, POPULAR_FAQS, and the public exports
//   (HELP_ARTICLES, HELP_ARTICLE_BY_SLUG, HELP_CATEGORY_BY_ID, articlesInCategory,
//   publishedArticles, searchArticles).
//   The article BODIES live in one editable file per article:
//     ./articles/<category-id>/<slug>.jsx   -> export default { summary, updated, body:[...] }
//     ./articles/<category-id>/index.js     -> lists/maps that category's article files
//     ./articles/index.js                   -> merges all categories into the BODIES map
//   `import BODIES from './articles'` (below) is the only wiring; everything
//   downstream is unchanged. PublicMarketingScreens.jsx still imports the same
//   public API from this file, so it needs no edits.
//
//   To PUBLISH a new article: create ./articles/<category>/<slug>.jsx, import it
//   in that folder's index.js, and add one `'<slug>': alias,` map line. The slug
//   must match slugify(title) for the title in the RAW library below.
//
// Single source of truth for the help center index. Mirrors the legalContent.js
// data-module convention. Authoring rules + the full title library live in
// docs/HELP_CENTER_TITLES.md.
//
// Architecture (SEO-safe): every TITLE is listed so the index + search are
// fully populated, but only articles with a `body` are PUBLISHED — they get
// a live /platform/help/[slug] route, appear as links, and are indexable.
// Titles without a body render as "coming soon" (non-linked, noindex) so we
// never ship thousands of thin pages (the scaled-content-abuse risk).
//
// Voice: human + conversational on how-tos; precise on money/safety/legal.
// USER-FACING ONLY. No stack, infrastructure, processor names, or backend.

// Article bodies, merged from the per-category folders (slug -> { summary, updated, body }).
import BODIES from './articles';

// ── Categories (35) ──────────────────────────────────────────────────
export const HELP_CATEGORIES = [
  { id: 'getting-started', label: 'Getting started',        icon: 'rocket_launch',          blurb: 'New here? Start with the basics of what VERGR is and how to use it.' },
  { id: 'account',         label: 'Account & sign up',       icon: 'person_add',             blurb: 'Create an account, log in, verify, and connect your other accounts.' },
  { id: 'profile',         label: 'Your profile',            icon: 'account_circle',         blurb: 'Edit your profile, avatar, banner, bio, and what others can see.' },
  { id: 'vergrme',         label: 'Vergr.me',                icon: 'link',                   blurb: 'Your link-in-bio page: set it up, customize it, share it.' },
  { id: 'verification',    label: 'Verification & KYC',      icon: 'verified_user',          blurb: 'Identity checks, what they unlock, and why we ask.' },
  { id: 'security-privacy',label: 'Security & privacy',      icon: 'lock',                   blurb: 'PIN, 2FA, login history, blocking, and your data.' },
  { id: 'economy',         label: 'Coins & VP',        icon: 'paid',                   blurb: 'Coins and VP explained, and how they work together.' },
  { id: 'buying-coins',    label: 'Buying Coins',            icon: 'shopping_cart',          blurb: 'How to buy VC, payment methods, packs, and first-purchase offers.' },
  { id: 'wallet',          label: 'Wallet',                  icon: 'account_balance_wallet', blurb: 'Balances, transaction history, receipts, and the wallet PIN.' },
  { id: 'earning',         label: 'Making money',            icon: 'savings',                blurb: 'Every way to earn on VERGR, and what is realistic.' },
  { id: 'tips',            label: 'Tips',                    icon: 'volunteer_activism',     blurb: 'Sending and receiving tips, fees, and tip goals.' },
  { id: 'vp-ranks',        label: 'VP & ranks',              icon: 'military_tech',          blurb: 'Earn VP, rank up, and unlock lower fees.' },
  { id: 'posting',         label: 'Posting & content',       icon: 'edit_note',              blurb: 'Every post type, scheduling, visibility, likes, and comments.' },
  { id: 'feed-discovery',  label: 'Feed & discovery',        icon: 'explore',                blurb: 'The feed, search, trending, explore, and leaderboards.' },
  { id: 'clips-shorts',    label: 'Clips & Shorts',          icon: 'movie',                  blurb: 'Watch, create, clip, and share short-form video.' },
  { id: 'streaming',       label: 'Going live',              icon: 'videocam',               blurb: 'Broadcasting: devices, quality, boosts, co-host, and moderation.' },
  { id: 'watching',        label: 'Watching streams',        icon: 'live_tv',                blurb: 'Chat, tip, react, vote, clip, and watch replays.' },
  { id: 'twitch',          label: 'Twitch & multi-streaming',icon: 'cast',                   blurb: 'Connect Twitch so your streams show on VERGR.' },
  { id: 'squads',          label: 'Squads',                  icon: 'groups',                 blurb: 'Create, join, run, and earn with a squad.' },
  { id: 'creator-studio',  label: 'Creator Studio',          icon: 'dashboard',              blurb: 'Dashboard, earnings, analytics, memberships, and quests.' },
  { id: 'memberships',     label: 'Plans & memberships',     icon: 'workspace_premium',      blurb: 'Free, Lite, Pro, and creator memberships explained.' },
  { id: 'messaging',       label: 'Messaging & calls',       icon: 'chat',                   blurb: 'DMs, group chats, voice channels, and calls.' },
  { id: 'notifications',   label: 'Notifications',           icon: 'notifications',          blurb: 'Turn notifications on or off and pick what you get.' },
  { id: 'status',          label: 'Status',                  icon: 'bolt',                   blurb: 'Post a status and control who sees it.' },
  { id: 'vanguard',        label: 'The Vanguard',            icon: 'shield',                 blurb: 'The moderator program: what it is, how to join, how it pays.' },
  { id: 'safety',          label: 'Safety & reporting',      icon: 'gpp_maybe',              blurb: 'Report, block, appeal, and stay safe.' },
  { id: 'referrals',       label: 'Referrals',               icon: 'group_add',              blurb: 'Refer friends and what you both get.' },
  { id: 'apps',            label: 'Apps & install',          icon: 'download',               blurb: 'Install on Android, desktop, and your phone home screen.' },
  { id: 'settings',        label: 'Settings',                icon: 'settings',               blurb: 'Display, language, storage, permissions, and linked accounts.' },
  { id: 'troubleshooting', label: 'Troubleshooting',         icon: 'build',                  blurb: 'Fixes for the most common problems.' },
  { id: 'trust',           label: 'Trust, fees & legality',  icon: 'gavel',                  blurb: 'Is it legit, is it gambling, the fees, and where it works.' },
];

// ── Title library (category id -> [title, tier]) ─────────────────────
// tier: 'core' | 'std' | 'long'
const RAW = {
  'getting-started': [
    ['What is VERGR and how does it work?', 'core'],
    ['How do I get started on VERGR?', 'core'],
    ['Is VERGR free to use?', 'core'],
    ['How do I sign up for VERGR?', 'core'],
    ['What can I do on VERGR?', 'core'],
    ['How do I make money on VERGR?', 'core'],
    ['Do I need to be good at games to use VERGR?', 'std'],
    ['What games can I play on VERGR?', 'std'],
    ['What devices can I use VERGR on?', 'std'],
    ['Is VERGR available in my country?', 'std'],
    ['How old do I have to be to use VERGR?', 'core'],
    ['What is the difference between a player, a creator, and a streamer on VERGR?', 'std'],
    ['What are Coins and VP?', 'std'],
    ['Is VERGR legit?', 'long'],
    ['Is VERGR a scam?', 'long'],
    ['Is VERGR safe to use?', 'long'],
    ['How does VERGR make money?', 'long'],
  ],
  'account': [
    ['How do I create an account?', 'core'],
    ['How do I sign up with Google?', 'std'],
    ['How do I sign up with my phone number?', 'std'],
    ['How do I verify my email address?', 'std'],
    ['How do I verify my phone number?', 'std'],
    ['What is an account type and which should I pick?', 'std'],
    ['How do I choose a username?', 'std'],
    ['Can I change my username later?', 'std'],
    ['What if my username is already taken?', 'std'],
    ['How do I set up my profile during onboarding?', 'std'],
    ['How do I pick my interests and get good recommendations?', 'std'],
    ['How do I find people to follow when I am new?', 'std'],
    ['How do I log in?', 'core'],
    ['I forgot my password, how do I reset it?', 'std'],
    ['How do I change my password?', 'std'],
    ['Why do I have to confirm my date of birth?', 'std'],
    ['How do I connect my accounts?', 'std'],
    ['Which accounts can I connect?', 'std'],
    ['Why connect my accounts?', 'std'],
    ['How do I disconnect a linked account?', 'std'],
    ['How do I switch accounts?', 'std'],
    ['Can I have more than one VERGR account?', 'long'],
  ],
  'profile': [
    ['How do I edit my profile?', 'core'],
    ['How do I change my profile picture?', 'std'],
    ['How do I add or change my banner?', 'std'],
    ['How do I write a good bio?', 'std'],
    ['How do I add my social media links to my profile?', 'std'],
    ['How do I set my date of birth and why it matters?', 'std'],
    ['What is a public profile and what do other people see?', 'std'],
    ['How do I make my profile private?', 'std'],
    ['What are prestige levels?', 'std'],
    ['Can a team or club have a page on VERGR?', 'std'],
    ['How do I see who follows me?', 'std'],
    ['How do I see who I am following?', 'std'],
    ['How do I follow or unfollow someone?', 'std'],
    ['How do I find and browse creators?', 'std'],
    ['What do the badges on a profile mean?', 'std'],
    ['How do I get verified on VERGR?', 'long'],
  ],
  'vergrme': [
    ['What is Vergr.me?', 'core'],
    ['How do I set up my Vergr.me page?', 'core'],
    ['How do I add links to my Vergr.me page?', 'std'],
    ['How do I reorder or hide links on Vergr.me?', 'std'],
    ['How do I customize the look of my Vergr.me page?', 'std'],
    ['How do I add a tip jar to my Vergr.me page?', 'std'],
    ['How do I share my Vergr.me link?', 'std'],
    ['How do I see how many people visited my Vergr.me page?', 'std'],
    ['What is my Vergr.me handle and can I change it?', 'std'],
    ['Vergr.me vs Linktree: what is the difference?', 'long'],
  ],
  'verification': [
    ['Do I need to verify my identity to use VERGR?', 'core'],
    ['What is KYC and why does VERGR ask for it?', 'std'],
    ['How do I complete identity verification?', 'std'],
    ['What documents do I need for verification?', 'std'],
    ['What are the verification levels and what does each unlock?', 'std'],
    ['How long does verification take?', 'std'],
    ['My verification was rejected, what do I do?', 'std'],
    ['Is my ID and selfie data safe?', 'std'],
  ],
  'security-privacy': [
    ['Is my VERGR wallet secure?', 'core'],
    ['How do I set up two-factor authentication?', 'core'],
    ['How do I set up my wallet PIN?', 'std'],
    ['I forgot my wallet PIN, what do I do?', 'std'],
    ['How do I review my security settings?', 'std'],
    ['How do I see which devices are logged into my account?', 'std'],
    ['How do I log out of all devices?', 'std'],
    ['How does VERGR keep my information private?', 'core'],
    ['Are my direct messages private?', 'std'],
    ['Does VERGR store my messages?', 'std'],
    ['How do I control who can message me?', 'std'],
    ['How do I control who can see my content?', 'std'],
    ['How do I block someone?', 'std'],
    ['How do I unblock someone?', 'std'],
    ['How do I block words I do not want to see?', 'std'],
    ['What is the phone allow list?', 'std'],
    ['How do I download a copy of my data?', 'std'],
    ['How do I delete my account?', 'std'],
    ['What happens to my data when I delete my account?', 'std'],
    ['Does VERGR sell my data?', 'long'],
    ['Will my profile show up on Google?', 'long'],
  ],
  'economy': [
    ['What are VC (Coins)?', 'core'],
    ['What is VP (Vergr Points)?', 'core'],
    ['How do Coins and VP work together?', 'std'],
    ['What can I spend Coins on?', 'std'],
    ['How do I earn VP?', 'std'],
    ['What does VP actually do for me?', 'std'],
    ['Do Coins expire?', 'std'],
    ['Why does VERGR use Coins instead of just real money?', 'long'],
  ],
  'buying-coins': [
    ['How do I buy VC (Coins)?', 'core'],
    ['What payment methods can I use to buy Coins?', 'core'],
    ['Why can I not pay with Google Pay or Apple Pay?', 'core'],
    ['Can I buy Coins with cryptocurrency?', 'std'],
    ['Can I buy Coins with a card?', 'std'],
    ['What coin packs are available and what do they cost?', 'std'],
    ['Which coin pack is the best value?', 'std'],
    ['Is there a discount for my first purchase?', 'std'],
    ['Is buying Coins secure?', 'std'],
    ['My payment failed, what do I do?', 'std'],
    ['I paid but my Coins did not arrive, what do I do?', 'std'],
    ['Can I get a refund on a Coin purchase?', 'std'],
    ['What is a chargeback and what happens if I file one?', 'std'],
    ['What is the minimum amount of Coins I can buy?', 'long'],
    ['Is there a custom Coin amount?', 'long'],
  ],
  'wallet': [
    ['How does the VERGR wallet work?', 'core'],
    ['How do I open my wallet?', 'std'],
    ['How do I check my Coin balance?', 'std'],
    ['How do I see my transaction history?', 'std'],
    ['How do I filter my transactions?', 'std'],
    ['How do I view or share a transaction receipt?', 'std'],
    ['What do the different transaction types mean?', 'std'],
    ['Why is my wallet asking for a PIN?', 'std'],
    ['How do I exit the wallet and get back to the app?', 'std'],
  ],
  'earning': [
    ['What are all the ways to make money on VERGR?', 'core'],
    ['Can I make real money on VERGR?', 'core'],
    ['How much money can I realistically make?', 'std'],
    ['How do I earn from streaming?', 'std'],
    ['How do I earn from my squad?', 'std'],
    ['How do I earn from memberships?', 'std'],
    ['How do I earn as a Vanguard moderator?', 'std'],
    ['How do I earn from referrals?', 'std'],
    ['How do tips work and how much do I keep?', 'std'],
    ['Do I keep more money on a paid plan?', 'std'],
    ['What is the fastest way to start earning as a new user?', 'long'],
    ['Do I need an audience to make money on VERGR?', 'long'],
  ],
  'tips': [
    ['How do I tip a creator?', 'core'],
    ['How do I tip during a live stream?', 'std'],
    ['What is the fee on a tip?', 'std'],
    ['How much does the creator actually receive from my tip?', 'std'],
    ['How do I set up a tip goal on my stream?', 'std'],
    ['Can I tip from a post or a profile?', 'std'],
    ['What is the minimum tip?', 'long'],
  ],
  'vp-ranks': [
    ['What is VP and how do I earn it?', 'core'],
    ['What are the VERGR ranks?', 'core'],
    ['How do I rank up?', 'std'],
    ['What do I unlock at each rank?', 'std'],
    ['How does rank lower my fees?', 'std'],
    ['What is the highest rank?', 'std'],
    ['Do paid plans earn VP faster?', 'std'],
    ['What are prestige levels and how are they different from VP ranks?', 'std'],
    ['Why did my VP go up or down?', 'long'],
  ],
  'posting': [
    ['How do I create a post?', 'core'],
    ['What types of posts can I make on VERGR?', 'std'],
    ['How do I post text?', 'std'],
    ['How do I post a photo?', 'std'],
    ['How do I post a clip?', 'std'],
    ['How do I write an article?', 'std'],
    ['How do I post an achievement?', 'std'],
    ['What is an LFG post and how do I make one?', 'std'],
    ['How do I make a tier list?', 'std'],
    ['How do I quote someone elses post?', 'std'],
    ['How do I create a poll?', 'std'],
    ['How do I schedule a post for later?', 'std'],
    ['Who can see my post?', 'std'],
    ['How do I add media to a post?', 'std'],
    ['How do I delete a post?', 'std'],
    ['How do I edit a post?', 'std'],
    ['How do I report a post?', 'std'],
    ['How do likes, comments, and reposts work?', 'std'],
    ['How do I bookmark or save a post?', 'std'],
    ['What is the difference between a Clip and a Short?', 'long'],
    ['Why was my post hidden or removed?', 'long'],
  ],
  'feed-discovery': [
    ['How does the home feed work?', 'std'],
    ['What is the For You feed?', 'std'],
    ['How do I find live streams to watch?', 'std'],
    ['How do I explore creators, squads, and clips?', 'std'],
    ['How do I search for a user?', 'std'],
    ['How do I search by username or handle?', 'std'],
    ['What are trending hashtags?', 'std'],
    ['How does the leaderboard work?', 'std'],
    ['How do I see what is trending?', 'std'],
    ['Why am I seeing certain posts in my feed?', 'long'],
  ],
  'clips-shorts': [
    ['How do I watch Shorts?', 'std'],
    ['How do I create a Short?', 'std'],
    ['How do I clip a moment from a live stream?', 'std'],
    ['How long can my clips and Shorts be?', 'std'],
    ['How do I save a clip to my profile?', 'std'],
    ['How do I share a clip?', 'std'],
    ['Why can I not clip on my device?', 'long'],
  ],
  'streaming': [
    ['How do I go live on VERGR?', 'core'],
    ['Do I need followers to go live?', 'core'],
    ['What is a Stream Boost and how does it work?', 'std'],
    ['How does the Stream Boost pay for itself?', 'std'],
    ['How do I choose my camera and microphone before going live?', 'std'],
    ['How do I stream with my camera, screen, or both?', 'std'],
    ['What streaming quality do I get on my plan?', 'std'],
    ['How do I stream from OBS?', 'std'],
    ['How do I stream directly from my browser?', 'std'],
    ['How do I schedule a stream in advance?', 'std'],
    ['How do I notify my followers when I go live?', 'std'],
    ['How do I add a title, game, and tags to my stream?', 'std'],
    ['How do I add a cover image to my stream?', 'std'],
    ['How do I set a tip goal for my stream?', 'std'],
    ['How do I run a poll during my stream?', 'std'],
    ['How do I co-host a stream with someone else?', 'std'],
    ['How do I invite a co-host while I am live?', 'std'],
    ['How do I clip a moment while I am broadcasting?', 'std'],
    ['How do I moderate my stream chat?', 'std'],
    ['How do I set banned words for my stream chat?', 'std'],
    ['How do I end a stream?', 'std'],
    ['What is in my stream recap?', 'std'],
    ['Where do I see my stream analytics?', 'std'],
    ['Do my streams get recorded?', 'std'],
    ['Why was I disconnected while streaming?', 'long'],
    ['What internet speed do I need to stream?', 'long'],
    ['Why does my stream look lower quality than I set?', 'long'],
  ],
  'watching': [
    ['How do I watch a live stream?', 'std'],
    ['How do I chat during a stream?', 'std'],
    ['How do I tip a streamer while watching?', 'std'],
    ['How do I react during a stream?', 'std'],
    ['How do I vote in a stream poll?', 'std'],
    ['How do I follow a streamer?', 'std'],
    ['How do I clip a moment as a viewer?', 'std'],
    ['How do I share a stream?', 'std'],
    ['How do I watch a replay after a stream ends?', 'std'],
    ['Why does the stream say reconnecting?', 'long'],
  ],
  'twitch': [
    ['How do I connect my Twitch account so my streams show on VERGR?', 'std'],
    ['How does the Twitch mirror work?', 'std'],
    ['Do I need to change my OBS setup to stream on both Twitch and VERGR?', 'std'],
    ['Does my Twitch chat sync with VERGR?', 'std'],
    ['Why is my Twitch stream not showing up on VERGR?', 'long'],
  ],
  'squads': [
    ['What is a squad?', 'core'],
    ['How do I create a squad?', 'core'],
    ['How do I join a squad?', 'core'],
    ['How do I find squads to join?', 'std'],
    ['How do I invite members to my squad?', 'std'],
    ['How do I accept or decline a squad invitation?', 'std'],
    ['How do squad join requests work?', 'std'],
    ['What is the squad treasury and how does it work?', 'std'],
    ['How does the squad earnings split work?', 'std'],
    ['What are squad roles and permissions?', 'std'],
    ['How do I manage my squad members?', 'std'],
    ['How do I run a squad voice hangout or stream?', 'std'],
    ['How do squad announcements work?', 'std'],
    ['How do squad events work?', 'std'],
    ['What are squad challenges?', 'std'],
    ['How do I see my squad analytics?', 'std'],
    ['How does the squad leaderboard work?', 'std'],
    ['How do I share media in my squad?', 'std'],
    ['How do I pin something in my squad?', 'std'],
    ['How do I change my squad settings?', 'std'],
    ['How do I leave a squad?', 'std'],
    ['How do I delete a squad?', 'std'],
    ['What is the maximum squad size?', 'long'],
  ],
  'creator-studio': [
    ['What is the Creator Studio?', 'core'],
    ['How do I use the Creator Studio?', 'core'],
    ['How do I read my creator dashboard?', 'std'],
    ['How do I see my earnings?', 'std'],
    ['How do I see my content performance?', 'std'],
    ['How do I see my audience insights?', 'std'],
    ['How do I manage my community?', 'std'],
    ['How do I schedule content?', 'std'],
    ['What are creator quests and how do I complete them?', 'std'],
    ['How do I read my monthly analytics?', 'std'],
    ['How do I set up creator memberships?', 'std'],
    ['How do members subscribe to me?', 'std'],
    ['How do I get the creator verification badge?', 'std'],
    ['Why are creator quests VP-only and not Coins?', 'long'],
  ],
  'memberships': [
    ['What are the VERGR plans?', 'core'],
    ['What does each plan include?', 'core'],
    ['How do I upgrade my plan?', 'std'],
    ['Can I pay for a plan with Coins?', 'std'],
    ['How do I cancel my subscription?', 'std'],
    ['What is the difference between Lite and Pro?', 'std'],
    ['Do paid plans change the fees I pay?', 'std'],
    ['What is a creator membership and how is it different from a VERGR plan?', 'std'],
    ['How do I subscribe to a creator?', 'long'],
    ['How do I pause or cancel a creator membership?', 'long'],
  ],
  'messaging': [
    ['How do I send a direct message?', 'core'],
    ['How do I start a group chat?', 'std'],
    ['How do I add or remove people from a group chat?', 'std'],
    ['How do message requests work?', 'std'],
    ['How do I manage my friends list?', 'std'],
    ['How do I send a photo, clip, or voice message in chat?', 'std'],
    ['How do I make a voice or video call?', 'std'],
    ['How do voice channels work?', 'std'],
    ['How do I change my chat settings?', 'std'],
    ['How do I report a message or a conversation?', 'std'],
    ['How do I leave or delete a conversation?', 'std'],
    ['Are my messages and calls private?', 'std'],
    ['Why did I not get a call notification?', 'long'],
  ],
  'notifications': [
    ['How do I turn notifications on or off?', 'std'],
    ['How do I choose which notifications I get?', 'std'],
    ['Why am I not getting push notifications?', 'std'],
    ['How do I get notified when someone I follow goes live?', 'std'],
    ['How do I get notifications on my phone?', 'long'],
  ],
  'status': [
    ['What is a status and how do I post one?', 'std'],
    ['Who can see my status?', 'std'],
  ],
  'vanguard': [
    ['What is the Vanguard?', 'core'],
    ['How do I join the Vanguard?', 'core'],
    ['What do Vanguard moderators do?', 'std'],
    ['How do Vanguard moderators get paid?', 'std'],
    ['What are the Vanguard ranks?', 'std'],
    ['Is my identity hidden as a Vanguard moderator?', 'std'],
    ['What are the requirements to become a moderator?', 'long'],
  ],
  'safety': [
    ['How do I report someone?', 'core'],
    ['How do I report content?', 'core'],
    ['What happens after I report something?', 'std'],
    ['How does VERGR handle reports?', 'std'],
    ['What is the Code of Conduct?', 'std'],
    ['What gets you banned on VERGR?', 'std'],
    ['My account was muted or banned, what do I do?', 'std'],
    ['How do I appeal a ban or a moderation decision?', 'std'],
    ['What content is not allowed on VERGR?', 'long'],
    ['How do I keep myself safe on VERGR?', 'long'],
  ],
  'referrals': [
    ['How does the referral program work?', 'std'],
    ['How do I refer a friend?', 'std'],
    ['What do I get for referring someone?', 'std'],
    ['What does my friend get when they sign up with my link?', 'std'],
  ],
  'apps': [
    ['How do I install the VERGR app on Android?', 'std'],
    ['How do I install VERGR on my desktop?', 'std'],
    ['How do I add VERGR to my iPhone home screen?', 'std'],
    ['How do I update the VERGR app?', 'std'],
    ['Is there an iOS app?', 'std'],
    ['Why is VERGR not on the Play Store or App Store?', 'long'],
  ],
  'settings': [
    ['How do I change my display settings?', 'std'],
    ['How do I change the app language?', 'std'],
    ['How do I manage app permissions?', 'std'],
    ['How do I manage my storage and cache?', 'std'],
    ['How do I back up my settings?', 'std'],
    ['How do I manage my linked accounts?', 'std'],
    ['Where do I find all my account settings?', 'std'],
  ],
  'troubleshooting': [
    ['I can not go live, what do I do?', 'std'],
    ['My upload keeps failing, what do I do?', 'std'],
    ['My payment will not go through, what do I do?', 'std'],
    ['My video or clip will not play, what do I do?', 'std'],
    ['I can not log in, what do I do?', 'std'],
    ['The app looks broken or out of date, how do I refresh it?', 'std'],
    ['My camera or microphone is not working, what do I do?', 'std'],
    ['I am not receiving the verification code, what do I do?', 'std'],
    ['My balance looks wrong, what do I do?', 'std'],
    ['Icons or text look broken, what do I do?', 'long'],
    ['The app is slow, what can I do?', 'long'],
  ],
  'trust': [
    ['Is VERGR gambling?', 'core'],
    ['What fees does VERGR charge?', 'std'],
    ['Where is VERGR available?', 'std'],
    ['Why do I have to be 18+?', 'std'],
    ['What is VERGRs refund policy?', 'std'],
    ['How is VERGR different from Twitch, TikTok, and other platforms?', 'long'],
  ],
};

// ── Slugify ──────────────────────────────────────────────────────────
export function slugify(title) {
  return title
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ')
    .replace(/['’.]/g, '')           // drop apostrophes + periods (can't -> cant)
    .replace(/[^a-z0-9]+/g, '-')     // everything else -> hyphen
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

// ── Article bodies (PUBLISHED only) ──────────────────────────────────
// Bodies now live in per-article files under ./articles/<category>/<slug>.jsx
// and are merged into the BODIES map by ./articles/index.js (imported at the
// top of this file). To publish a new article: create the <slug>.jsx file in
// its category folder, import it in that folder index.js, and add one map line.
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

// ── Build flat article list (stable slugs, dedup) ────────────────────
function buildArticles() {
  const out = [];
  const seen = new Set();
  for (const cat of HELP_CATEGORIES) {
    const rows = RAW[cat.id] || [];
    for (const [title, tier] of rows) {
      let slug = slugify(title);
      if (seen.has(slug)) {
        let n = 2;
        while (seen.has(`${slug}-${n}`)) n += 1;
        slug = `${slug}-${n}`;
      }
      seen.add(slug);
      const published = !!BODIES[slug];
      out.push({
        slug,
        title,
        category: cat.id,
        tier: tier || 'std',
        published,
        summary: published ? BODIES[slug].summary : '',
        body: published ? BODIES[slug].body : null,
        updated: published ? BODIES[slug].updated : null,
      });
    }
  }
  return out;
}

export const HELP_ARTICLES = buildArticles();

export const HELP_ARTICLE_BY_SLUG = HELP_ARTICLES.reduce((m, a) => { m[a.slug] = a; return m; }, {});

export const HELP_CATEGORY_BY_ID = HELP_CATEGORIES.reduce((m, c) => { m[c.id] = c; return m; }, {});

export function articlesInCategory(catId) {
  return HELP_ARTICLES.filter(a => a.category === catId);
}

export function publishedArticles() {
  return HELP_ARTICLES.filter(a => a.published);
}

// Lightweight client-side search over title + category label.
export function searchArticles(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/);
  return HELP_ARTICLES
    .map(a => {
      const hay = `${a.title} ${HELP_CATEGORY_BY_ID[a.category]?.label || ''}`.toLowerCase();
      const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
      return { a, score };
    })
    .filter(x => x.score === terms.length)   // all terms must match
    .sort((x, y) => (y.a.published - x.a.published) || y.score - x.score)
    .map(x => x.a)
    .slice(0, 40);
}

// ── Popular / compliance FAQs (shown on the index) ───────────────────
// Kept in the precise compliance register (not the conversational voice).
export const POPULAR_FAQS = [
  ['How old do I have to be to use VERGR?',
   'You must be at least 18. We verify date of birth at signup, and creators complete a one-time government-ID and selfie check before VERGR can pay them their revenue share. We never knowingly hold accounts for anyone under 18.'],
  ['Is VERGR available in my country?',
   'VERGR is not available in a small number of jurisdictions, mainly those under sanctions or where the underlying payment rails are prohibited. The current blocklist is published in the Terms of Service. If your country is on that list, you cannot use wallet or payout features. Using a VPN to bypass this is a breach of the Terms of Service.'],
  ['Does VERGR offer any form of gambling?',
   'No. VERGR does not offer betting, wagering, prediction markets, casino games, loot boxes, random prize draws, or prize competitions. Coins are in-app currency spent on tips, creator memberships, paid live streams, and boosts. There is nothing to stake and nothing to win.'],
  ['What is the fee on a tip?',
   '10% flat, on every tip, regardless of subscription tier. The sender pays N coins; we take 10%; the recipient receives the rest.'],
  ['How do creators get paid?',
   'Creators do not request payouts. VERGR works out the revenue share it owes and pays it automatically on a schedule, monthly to begin with, once the balance reaches $100. Identity verification and an account at least 30 days old are required first. Nothing on VERGR can be withdrawn, converted or transferred by a user.'],
  ['Can I get a refund on coin purchases?',
   'Coin purchases are non-refundable once the coins are delivered to your wallet, because they are a digital item delivered immediately on payment. Erroneous, duplicate, or unauthorised charges can be refunded; write to support@vergr.app within 30 days.'],
];
