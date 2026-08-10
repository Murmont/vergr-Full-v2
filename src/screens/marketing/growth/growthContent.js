// Growth / SEO money pages: content data (pure JS, no imports, no JSX).
//
// Consumed by TWO places:
//   1. src/screens/marketing/growth/GrowthScreens.jsx (the React pages)
//   2. scripts/prerenderHelp.mjs (bakes static HTML + JSON-LD + sitemap
//      entries at build time so Bing + AI crawlers see real content)
// Keep this file dependency-free so Node can import it directly.
//
// Block model per section: { h2, blocks: [ {p} | {tiles, cols, min} |
// {list} | {steps} | {faq} | {note} | {links} ] }
// Tile accents are color NAMES (cyan|violet|gold|ember|pink), resolved by
// the renderer. All copy rules: answer-first, skill-based (never gambling
// terms), 18+, no income promises, no internal stack/vendor names.

const UPDATED = '2026-06-09';

// ── Pillar: Make Money Gaming ─────────────────────────────────────────
export const PILLAR_PAGE = {
  slug: 'make-money-gaming',
  path: '/platform/make-money-gaming',
  metaTitle: 'How to Make Money Playing Video Games (For Real) | VERGR',
  metaDescription: 'The honest guide to earning real money from gaming: skill-based tournaments, 1v1 money matches, streaming tips from day one, and squad prize pools. How payouts actually work, what is realistic, and how to start free. 18+.',
  h1: 'Make Money Playing Video Games. For Real.',
  subtitle: 'Skill-based tournaments, 1v1 money matches, streaming tips from your first viewer, and squad prize pools. One account, real payouts, no follower gates. 18+ only, available where local law permits.',
  accent: 'gold',
  updated: UPDATED,
  sections: [
    {
      blocks: [
        { p: 'The short answer: yes, you can make money playing video games without being a pro or a famous streamer, and the legitimate ways all come down to skill and audience. On VERGR both live in one account: you compete for prize pools in the games you already play and earn tips the moment you go live (no 50-follower affiliate gate). Winnings arrive as coins, convert to gems, and withdraw as real money once you verify your identity.' },
        { p: 'This page is the honest version of that pitch. It covers each earning path, what is actually realistic, how payouts work end to end, and why none of this is gambling. No income promises, because anyone promising you an income from gaming is selling something.' },
      ],
    },
    {
      h2: 'The four real ways to earn on VERGR',
      blocks: [
        { tiles: [
          { icon: 'emoji_events', accent: 'gold', title: '1. Tournaments with cash prize pools', body: 'Enter free or paid tournaments in 35+ competitive titles. Entry fees go into server-side escrow, results are verified, and the winner takes the posted prize pool. Entry fees range from free to 10,000 coins.' },
          { icon: 'sports_mma', accent: 'ember', title: '2. 1v1 money matches (Brawl)', body: 'Instant matchmaking against an opponent at the same stake in the same game. Both stakes are escrowed when you match, you play one game, and the winner takes the pot. The fastest way to turn skill into coins.' },
          { icon: 'payments', accent: 'cyan', title: '3. Streaming tips from day one', body: 'Viewers tip you in coins while you stream. There is no affiliate threshold: your first viewer can tip you in your first session. A flat 10% platform fee applies and you keep the rest.' },
          { icon: 'groups', accent: 'pink', title: '4. Squad prize pools', body: 'Enter team tournaments with your squad. Squad winnings pay into a shared squad treasury that the team distributes by its own agreed rules.' },
          { icon: 'card_membership', accent: 'violet', title: 'Plus: memberships', body: 'Once you have fans, they can support you with recurring monthly memberships at prices you set. Recurring income stacks on top of tips and prize money.' },
        ], cols: 3, min: 260 },
      ],
    },
    {
      h2: 'What is actually realistic',
      blocks: [
        { p: 'Honesty first: most players should treat gaming earnings as a bonus, not a salary. Competitive earnings scale with skill, and streaming earnings scale with audience and consistency. What VERGR changes is the floor: you do not need a partner badge, an affiliate threshold, or thousands of followers before the first coin can reach you. A decent player can win free-entry tournaments and small-stakes 1v1s the same week they sign up, and a brand-new streamer can receive a tip in their first session.' },
        { p: 'A sensible progression looks like this: start with free-entry tournaments to learn the verification flow, move to small-stakes Brawl matches in your best game, stream your matches so tips stack on top of prizes, and raise stakes only as your win rate proves out. Skilled players who treat it like practice with upside do best. Players chasing losses do worst, which is why entry fees are capped and competition stays skill-based.' },
      ],
    },
    {
      h2: 'How payouts actually work, in plain terms',
      blocks: [
        { steps: [
          'You win coins: tournament prizes, 1v1 pots, and tips all arrive as coins in your VERGR wallet.',
          'Coins convert to gems: gems are the withdrawable currency. A conversion commission applies that shrinks as your rank grows (from 30% at the newest rank down to 5% at the highest), so active players keep more.',
          'Verify your identity once: a quick ID + selfie check (KYC) unlocks conversion and withdrawal. This is a legal requirement for any platform that pays out real money, and it is also what keeps cheaters and multi-accounters out of prize pools.',
          'Withdraw: gems withdraw as USDC crypto to your own whitelisted wallet address, with a minimum payout of 1,000 gems. Withdrawals have a security hold before release.',
        ] },
        { note: 'Every entry fee is held in server-side escrow from the moment you join until the result is final, so prize money is never an IOU. Results are verified before anything pays out.' },
      ],
    },
    {
      h2: 'Is this gambling? No, and the difference matters',
      blocks: [
        { p: 'Gambling is staking money on chance. VERGR competitions are staking your performance on your own skill: the outcome of a CS2 match, an EA Sports FC game, or a Rocket League series is decided by execution and decision-making, not by random number generation. There is no house to bet against, no odds, no slot mechanics, and no random-chance prizes anywhere on the platform.' },
        { p: 'That is why skill-based competition is treated differently from gambling in most jurisdictions. VERGR additionally requires every user to be 18 or older, geo-gates paid competition to regions where it is permitted, verifies identity before money leaves the platform, and publishes its tournament rules. If skill-based competition is not permitted where you live, paid entry is not available to you, and free play still is.' },
        { links: [
          { label: 'Read the full trust and legitimacy breakdown', to: '/platform/legit' },
          { label: 'Tournament rules', to: '/platform/learn/tournament-rules' },
        ] },
      ],
    },
    {
      h2: 'Play the games you already play',
      blocks: [
        { p: 'You do not need to switch to obscure mobile puzzle games to earn. VERGR runs real competitive titles, with per-game verification built for each one:' },
        { links: [
          { label: 'Play EA Sports FC for money', to: '/platform/play/fc25' },
          { label: 'CS2 money matches and tournaments', to: '/platform/play/cs2' },
          { label: 'Warzone cash tournaments', to: '/platform/play/warzone' },
          { label: 'NBA 2K money matches', to: '/platform/play/nba2k' },
          { label: 'Apex Legends cash tournaments', to: '/platform/play/apex' },
          { label: 'Rocket League money matches', to: '/platform/play/rocketleague' },
        ] },
        { p: 'Beyond these, the tournament system supports 35+ titles across FPS, sports, fighting, racing, MOBA, card, and RTS, including Dota 2, VALORANT, League of Legends, Fortnite, Street Fighter 6, Tekken 8, Madden NFL, and F1. Any game can also be run with manual verification when hosts want it.' },
      ],
    },
    {
      h2: 'Earning as a streamer: why day one matters',
      blocks: [
        { p: 'On the big streaming platforms you cannot earn anything until you cross a threshold: roughly 50 followers and streaming-hour requirements for Twitch Affiliate, similar bars elsewhere. Months of free work before the first dollar is possible. On VERGR, tipping is on from your first live session. Stream your ranked grind or your tournament matches, and viewers can tip coins in the moment. Paid tiers unlock public streaming instantly; free accounts unlock it at 100 followers with a discovery boost that refunds itself from your first tips.' },
        { links: [
          { label: 'Streaming on VERGR, in depth', to: '/platform/learn/live' },
          { label: 'Creator monetization overview', to: '/platform/monetization' },
        ] },
      ],
    },
    {
      h2: 'Frequently asked questions',
      blocks: [
        { faq: [
          ['Can you really make money playing video games?', 'Yes. The legitimate paths are competing for prize money and earning tips and memberships from an audience. VERGR combines all of them in one account with verified results and real payouts. What no honest platform can promise is how much you will earn: that depends on your skill, consistency, and audience.'],
          ['How much money can you make playing video games?', 'It ranges from pocket money to a real income, and skill is the main variable. A strong player entering regular small-stakes tournaments and 1v1s can earn steadily; most casual players should treat winnings as a bonus. VERGR publishes no income claims because every player is different.'],
          ['Do I need to pay to start earning?', 'No. Free-entry tournaments pay real coin prizes, and streaming tips require no spend at all. Paid entry fees are optional and capped at 10,000 coins.'],
          ['How do I cash out my winnings?', 'Coins convert to gems inside your wallet, then gems withdraw as USDC crypto to your own whitelisted address. You verify your identity once (ID + selfie), and the minimum payout is 1,000 gems. The conversion commission shrinks from 30% to 5% as your rank grows.'],
          ['Is playing games for money legal?', 'Skill-based competition for prizes is legal in most jurisdictions because outcomes are determined by player skill, not chance. VERGR is 18+ only and geo-gates paid competition to regions that permit it. If your region does not, you can still play free events.'],
          ['Is VERGR gambling?', 'No. There is no betting against the house, no odds, no random-chance mechanics, and no casino games. You compete against another player in a video game, and the better performance wins. See the full breakdown on the trust page.'],
          ['What stops cheaters from taking the prize money?', 'Layered verification: per-game result detection, lobby-code verification, an optional anti-cheat process scan for tournament matches, webcam proof feeds on high-stakes matches, and human moderator review on every dispute. Confirmed cheating forfeits the match and the entry.'],
          ['Which games can I play for money?', 'EA Sports FC, CS2, NBA 2K, Warzone, Apex Legends, Rocket League, Dota 2, VALORANT, Fortnite, Street Fighter 6, Tekken 8, Madden, F1, and 20+ more competitive titles, plus manual-verification support for anything else a host wants to run.'],
        ] },
      ],
    },
  ],
  cta: { title: 'Start free. Win your first tournament.', label: 'Create my account' },
};

// ── Trust hub: Is VERGR legit ─────────────────────────────────────────
export const LEGIT_PAGE = {
  slug: 'legit',
  path: '/platform/legit',
  metaTitle: 'Is VERGR Legit? How Payouts, Escrow & Anti-Cheat Work | VERGR',
  metaDescription: 'A direct answer to "is VERGR legit": how prize escrow works, how results are verified, how cheaters are caught, how identity checks protect prize pools, and exactly how money gets in and out. Skill-based, 18+, not gambling.',
  h1: 'Is VERGR Legit? Here Is Exactly How It Works.',
  subtitle: 'Every platform that handles real money owes you a straight answer. This page explains how prize money is held, how results are verified, how cheating is punished, and how you get paid, in plain language.',
  accent: 'cyan',
  updated: UPDATED,
  sections: [
    {
      blocks: [
        { p: 'Yes, VERGR is a legitimate skill-gaming platform: entry fees are held in server-side escrow until results are final, match results are verified by game integrations and human moderators, identity verification (KYC) is required before any money leaves the platform, and payouts go to your own wallet address. This page walks through each of those claims so you can judge them yourself rather than take our word for it.' },
      ],
    },
    {
      h2: 'Where your money is between entry and payout',
      blocks: [
        { tiles: [
          { icon: 'lock', accent: 'cyan', title: 'Escrow at entry', body: 'The moment you join a paid tournament or 1v1, your entry is moved into server-side escrow. It is not floating, not promised, and not spendable by anyone. Leave before the event starts and it returns to you.' },
          { icon: 'verified', accent: 'violet', title: 'Locked until verified', body: 'Prize pools only pay out after the result is final: verified by the game integration where available, agreed by both players, or ruled on by a moderator with evidence. Disputed matches pay nobody until resolved.' },
          { icon: 'receipt_long', accent: 'gold', title: 'Audited ledger', body: 'Every coin movement (entry, escrow, prize, tip, fee, refund) is a ledger transaction you can see in your own wallet history. Cancelled tournaments refund entries automatically.' },
        ], cols: 3, min: 260 },
      ],
    },
    {
      h2: 'How results are verified (so nobody can lie about a win)',
      blocks: [
        { p: 'Result fraud is the way skill-gaming platforms die, so verification is layered per game rather than left to screenshots and arguments:' },
        { list: [
          'Game-reported results: for CS2 and Dota 2, a one-time Steam game-state config makes the game itself report the outcome the moment the match ends.',
          'Linked-account detection: for Apex Legends and Overwatch 2, linking your game account lets VERGR detect results from the game’s own stats, with a moderator confirming.',
          'Lobby-code verification: every match gets a unique VERGR code that players show in-game (chat, lobby name, or player name per the game’s method) proving both players are in the same real lobby.',
          'Dual report: both players report the result in-app. Agreement advances the bracket; disagreement freezes the match as disputed, and a moderator reviews evidence before anything pays out.',
          'High-stakes proof: matches above 5,000 coins entry require a recorded game + webcam proof feed, reviewable by moderators.',
        ] },
      ],
    },
    {
      h2: 'How cheaters are caught and what happens to them',
      blocks: [
        { tiles: [
          { icon: 'memory', accent: 'ember', title: 'Anti-cheat process scan', body: 'Tournament players on the desktop app consent to a process scan that checks for known cheat tools before and during the match. Red flags route to human review, never silent auto-bans.' },
          { icon: 'smart_display', accent: 'violet', title: 'Recorded evidence', body: 'Tournament streams and VODs are archived for review. Suspicious moments are flagged by automated review and confirmed or cleared by a human moderator.' },
          { icon: 'gavel', accent: 'gold', title: 'Human final say', body: 'A ranked moderator collective (Vanguard) reviews flags, disputes, and appeals. Confirmed cheating forfeits the match and entry, and repeat offenders lose the account. Every moderator action is audit-logged.' },
        ], cols: 3, min: 260 },
      ],
    },
    {
      h2: 'Is VERGR gambling? No. Here is the legal framing.',
      blocks: [
        { p: 'Gambling stakes money on chance. VERGR competitions stake entry fees on the outcome of a video game match decided by the players’ own skill. There is no house to bet against, no odds-making, no random-number prizes, no casino or slot mechanics anywhere on the platform, and spectator predictions are capped, skill-framed picks rather than open wagering.' },
        { list: [
          'Skill determines outcomes: the same reason chess tournaments and bowling leagues with entry fees are not casinos.',
          '18+ only: age verification is part of identity checks before money moves.',
          'Geo-gating: paid competition is only available in regions whose law permits skill-based competition; elsewhere, free play remains.',
          'Published rules: entry caps (10,000 coins), prize caps (500,000 coins), and the fixed 5% platform fee are public and enforced server-side.',
          'No income promises: VERGR never advertises earnings figures, because honest platforms cannot promise winnings.',
        ] },
      ],
    },
    {
      h2: 'How money gets in and out',
      blocks: [
        { steps: [
          'Buying coins: card or crypto checkout at posted prices. Coins are the in-platform currency for entries and tips.',
          'Winning: prizes, tips, and 1v1 pots arrive as coins with a ledger entry for each.',
          'Converting: coins convert to gems, the withdrawable currency. Conversion requires one-time identity verification (ID + selfie) and applies a rank-based commission, from 30% at the newest rank down to 5%.',
          'Withdrawing: gems withdraw as USDC crypto to a wallet address you whitelist yourself, minimum 1,000 gems, with a security hold before release. Withdrawals to someone else’s address are impossible by design.',
        ] },
        { note: 'Why crypto payouts? They settle to a wallet only you control, work in every supported country, and avoid holding your bank details. Use any major exchange to convert USDC to your local currency.' },
      ],
    },
    {
      h2: 'Fair questions, direct answers',
      blocks: [
        { faq: [
          ['Is VERGR legit?', 'Yes. Entry fees sit in server-side escrow until results are verified, every coin movement is ledgered, identity is verified before withdrawal, and payouts go only to a wallet address you whitelist yourself. Free events exist so you can test the full flow without spending anything.'],
          ['Is VERGR a scam?', 'No, and you should not take any platform’s word for that, including ours. Test it the safe way: create a free account, join a free-entry tournament, win coins, and run the verification flow yourself before ever paying an entry fee.'],
          ['Is VERGR gambling?', 'No. Outcomes are decided by player skill in real video game matches, not chance. There is no house, no odds, and no random-prize mechanics. Skill-based competition with entry fees is the same legal category as a chess open or a fishing tournament.'],
          ['How do I know I will get paid if I win?', 'Because the prize pool is already escrowed before you play. Payout is automatic on finalization: winner coins land in your wallet seconds after the result is final, with a ledger entry you can see.'],
          ['Why does VERGR need my ID?', 'Identity verification is legally required before a platform can pay out real money (anti-money-laundering rules), and it is also what keeps multi-account cheaters out of prize pools. It is required once, only when you want to convert or withdraw, never to play free events.'],
          ['What happens if my opponent cheats or lies about the result?', 'The match freezes as disputed, nobody is paid, both sides submit evidence, and a moderator rules on it with access to game-reported data, lobby verification, and recorded proof. Confirmed cheating forfeits the cheater’s entry.'],
          ['Is VERGR safe for my money?', 'Your spendable balance is ledgered, escrow is server-side, withdrawals require your PIN plus identity verification and go only to addresses you whitelisted. No platform should ever hold your life savings, and VERGR’s entry caps exist so it cannot.'],
          ['Who is behind VERGR and how does it make money?', 'VERGR makes money from published fees only: a fixed 5% tournament fee, a flat 10% tip fee, rank-based conversion commission, and optional subscriptions. No hidden spread on prizes, no ad-selling of your data, no house edge, because there is no house.'],
        ] },
        { links: [
          { label: 'Help Center: Is VERGR legit?', to: '/platform/help/is-vergr-legit' },
          { label: 'Help Center: Is VERGR a scam?', to: '/platform/help/is-vergr-a-scam' },
          { label: 'Tournament rules', to: '/platform/learn/tournament-rules' },
          { label: 'How to make money gaming', to: '/platform/make-money-gaming' },
        ] },
      ],
    },
  ],
  cta: { title: 'Test it yourself, free.', label: 'Create my account' },
};

// ── Per-game pages ────────────────────────────────────────────────────
// Slugs match the tournament registry ids in src/utils/tournamentGames.js.
export const GAME_PAGES = [
  {
    slug: 'fc25',
    path: '/platform/play/fc25',
    game: 'EA Sports FC',
    metaTitle: 'Play EA Sports FC for Money: 1v1 Money Matches & Tournaments | VERGR',
    metaDescription: 'Play EA Sports FC (FIFA) for real money: instant 1v1 money matches, knockout brackets, verified results from the post-match screen, and prize payouts in seconds. Free entry available. 18+, skill-based.',
    h1: 'Play EA Sports FC for Money',
    subtitle: 'Turn your Ultimate Team grind into prize money: instant 1v1 money matches, knockout cups, and verified results. Free-entry events to start, real stakes when you are ready.',
    accent: 'cyan',
    updated: UPDATED,
    sections: [
      {
        blocks: [
          { p: 'If you win most of your FC games, you can play EA Sports FC for money on VERGR today: queue an instant 1v1 money match at a stake you choose, or enter a knockout tournament with a posted prize pool. Both stakes go into escrow before kickoff, you play the match in-game as normal, and the winner takes the pot, usually within seconds of the result being confirmed.' },
          { p: 'FC money matches on VERGR run on the honor-free model that makes prize football work: a unique match code verifies both players are in the same lobby, the post-match result screen is the evidence standard, both players confirm the score in-app, and any disagreement goes to a human moderator before a single coin moves.' },
        ],
      },
      {
        h2: 'How an FC money match works',
        blocks: [
          { steps: [
            'Match up: queue Brawl (instant 1v1 at your stake) or join an open FC tournament. Your entry is escrowed immediately.',
            'Verify the lobby: you get a unique VERGR match code. Add your opponent in-game and confirm the code per the instructions so both sides are provably in the same match.',
            'Play your game: standard online friendly or the ruleset the host posted (half length, squad type, custom tactics allowed or not). The rules are visible before you enter.',
            'Confirm the result: both players report the score from the post-match screen. Agreement pays the winner instantly; disagreement freezes the match for moderator review with screenshot evidence.',
          ] },
        ],
      },
      {
        h2: 'Formats that run for EA Sports FC',
        blocks: [
          { tiles: [
            { icon: 'sports_mma', accent: 'ember', title: '1v1 Brawl money matches', body: 'Instant matchmaking at an agreed stake. One match, winner takes the pot. The fastest stakes-to-payout loop on the platform.' },
            { icon: 'account_tree', accent: 'cyan', title: 'Knockout cups', body: 'Single and double elimination brackets from 4 to 256 players, free entry or paid. Winner takes the posted prize pool.' },
            { icon: 'loop', accent: 'violet', title: 'Leagues and groups', body: 'Round-robin groups and Swiss formats for community leagues where everyone gets a full card of matches.' },
            { icon: 'groups', accent: 'gold', title: 'Co-op and squad events', body: '2v2 club-style events run as squad tournaments, with winnings paid into your squad treasury.' },
          ], cols: 2, min: 280 },
        ],
      },
      {
        h2: 'Entry fees, prizes, and what it costs',
        blocks: [
          { p: 'Free-entry FC tournaments with real coin prizes run regularly, so you can learn the flow without spending anything. Paid entries range from small stakes up to a hard cap of 10,000 coins, with per-tournament prize pools capped at 500,000 coins. VERGR takes a fixed 5% platform fee on tournaments and nothing else: there is no spread on your winnings and no house cut on 1v1 pots beyond the published fee structure. Winnings convert to gems and withdraw as real money after a one-time identity check.' },
        ],
      },
      {
        h2: 'Fair play in FC money matches',
        blocks: [
          { list: [
            'Posted rulesets: half length, squad restrictions (e.g. 85-rated max), and custom tactics rules are set by the host and visible before you enter. No mid-match rule disputes.',
            'Disconnect handling: rage-quits and disconnects are covered by the dispute flow with the post-match screen and recorded proof as evidence; moderators rule on it, not the other player.',
            'High-stakes proof: matches above 5,000 coins entry require a recorded game + webcam proof feed.',
            'One account, one identity: identity verification at cashout keeps multi-accounting smurfs out of prize pools.',
          ] },
        ],
      },
      {
        h2: 'EA Sports FC money match FAQ',
        blocks: [
          { faq: [
            ['Can I play FC 25 for money?', 'Yes. VERGR runs instant 1v1 EA Sports FC money matches and knockout tournaments with coin prize pools. Stakes are escrowed before the match, results are confirmed from the post-match screen, and the winner is paid in seconds.'],
            ['How do you verify FC results without a game API?', 'Three layers: a unique match code proves both players are in the same lobby, both players report the result from the post-match screen, and disagreements go to a human moderator with screenshot and recording evidence. Nobody can win by lying.'],
            ['What platforms can I play on?', 'Any platform where you can play your opponent directly (PC and current consoles with cross-play enabled where the game supports it). The host posts the lobby requirements per event.'],
            ['What happens if my opponent quits?', 'A confirmed disconnect or quit is handled by the dispute flow with the in-game result and evidence; a moderator rules. You are never forced to accept a loss because your opponent pulled the plug.'],
            ['Do I have to pay to enter?', 'No. Free-entry FC events with real prizes run regularly. Paid stakes are optional and capped at 10,000 coins entry.'],
            ['Is playing FIFA for money legal?', 'Skill-based competition for prizes is legal in most regions because match outcomes are decided by player skill, not chance. VERGR is 18+ and geo-gates paid play to permitted regions.'],
          ] },
          { links: [
            { label: 'How to make money gaming: the full guide', to: '/platform/make-money-gaming' },
            { label: 'Is VERGR legit? How escrow and payouts work', to: '/platform/legit' },
            { label: 'How tournaments work', to: '/platform/learn/tournaments' },
          ] },
        ],
      },
    ],
    cta: { title: 'Queue your first FC money match.', label: 'Create my account' },
  },
  {
    slug: 'cs2',
    path: '/platform/play/cs2',
    game: 'Counter-Strike 2',
    metaTitle: 'CS2 Money Matches & Cash Tournaments, Auto-Verified | VERGR',
    metaDescription: 'Play CS2 for money: 1v1 money matches and 5v5 cash tournaments with results auto-reported by the game itself via Steam game-state integration. Escrowed prize pools, anti-cheat screening, instant payouts. 18+, skill-based.',
    h1: 'CS2 Money Matches and Cash Tournaments',
    subtitle: 'The game itself reports your win. Steam game-state integration auto-verifies CS2 results, so money matches end in payouts, not screenshot arguments.',
    accent: 'violet',
    updated: UPDATED,
    sections: [
      {
        blocks: [
          { p: 'CS2 is the best-verified game on VERGR: a one-time Steam game-state integration (GSI) config file makes the game client itself report the match outcome the moment the post-game scoreboard loads. That means 1v1 aim duels and 5v5 squad tournaments for real stakes where the result is recorded automatically, the prize pool is already escrowed, and the winner is paid without either player touching a screenshot.' },
          { p: 'Setup is one file: VERGR generates your personal GSI config, you drop it into your CS2 cfg folder once, and every tournament match after that self-reports. No software runs in the background, no overlay touches your game, and the config only sends match-state data for matches you entered.' },
        ],
      },
      {
        h2: 'How a CS2 money match works',
        blocks: [
          { steps: [
            'Enter: queue a 1v1 Brawl at your stake or join a CS2 bracket (free or paid entry). Entry is escrowed immediately.',
            'Install GSI once: download your generated config file into the CS2 cfg folder. Ten seconds, one time, covers every future match.',
            'Verify the lobby: a unique VERGR match code shown in-game (lobby chat) confirms both sides are in the same server.',
            'Play: the game reports the result when the match ends. The bracket advances and the pot pays automatically; disputes are rare and go to moderator review with the GSI log as evidence.',
          ] },
        ],
      },
      {
        h2: 'Formats that run for CS2',
        blocks: [
          { tiles: [
            { icon: 'sports_mma', accent: 'ember', title: '1v1 aim duels', body: 'Instant Brawl matchmaking at your stake. Aim maps or wingman-style rulesets per the posted rules, winner takes the pot.' },
            { icon: 'groups', accent: 'cyan', title: '5v5 squad tournaments', body: 'Full team brackets, entered as a squad. Winnings pay into the squad treasury, and the bracket runs squad-vs-squad with seeding and byes.' },
            { icon: 'grid_on', accent: 'violet', title: 'Swiss events', body: 'Swiss-system tournaments pair teams by record across configurable rounds, ideal for 16+ entrants, with standings computed automatically.' },
            { icon: 'account_tree', accent: 'gold', title: 'Single & double elimination', body: 'Classic knockout cups up to 256 entrants, best-of-1 to best-of-5 series, free or paid entry.' },
          ], cols: 2, min: 280 },
        ],
      },
      {
        h2: 'Anti-cheat: the part that actually matters in CS2',
        blocks: [
          { p: 'Money attracts cheaters, and CS2 is a cheat-heavy ecosystem, so VERGR layers defenses beyond VAC: tournament players on the desktop app consent to a process scan against a database of known cheat tools before and during matches, tournament streams are archived and reviewed for visual cheat tells, lobby codes prevent ringers playing on someone else’s entry, and high-stakes matches require a webcam proof feed. Flags route to human moderators with evidence, and confirmed cheating forfeits the match, the entry, and eventually the account.' },
        ],
      },
      {
        h2: 'CS2 money match FAQ',
        blocks: [
          { faq: [
            ['Can I play CS2 for money?', 'Yes. VERGR runs 1v1 CS2 money matches and 5v5 cash tournaments. Entry fees are escrowed, results are auto-reported by the game via Steam game-state integration, and the winner takes the posted pot.'],
            ['How does CS2 result verification work?', 'A one-time game-state integration (GSI) config file in your CS2 cfg folder makes the game client report the outcome to VERGR when the match ends. No screenshots, no manual reporting, no background software.'],
            ['Is the GSI config safe?', 'Yes. GSI is an official Valve feature built for tournaments and broadcasters. The config only sends match-state data (score, players, round results) to the endpoint for matches you entered. It cannot read files, see your desktop, or affect gameplay.'],
            ['What about cheaters?', 'Beyond VAC: a consented process scan against known cheat tools during tournament play, archived match VODs reviewed for cheat tells, lobby-code identity verification, webcam proof on high-stakes matches, and human moderators ruling on every flag.'],
            ['Can my team enter together?', 'Yes. Squad tournaments run full 5v5 brackets where your team enters as one unit and winnings pay into a shared squad treasury your team controls.'],
            ['Do I need to pay to start?', 'No. Free-entry CS2 events with real coin prizes run regularly. Paid entries are capped at 10,000 coins.'],
          ] },
          { links: [
            { label: 'How to make money gaming: the full guide', to: '/platform/make-money-gaming' },
            { label: 'Is VERGR legit? How escrow and payouts work', to: '/platform/legit' },
            { label: 'How tournaments work', to: '/platform/learn/tournaments' },
          ] },
        ],
      },
    ],
    cta: { title: 'Your aim, auto-verified, paid.', label: 'Create my account' },
  },
  {
    slug: 'warzone',
    path: '/platform/play/warzone',
    game: 'Call of Duty: Warzone',
    metaTitle: 'Warzone Cash Tournaments: Placement-Point Battle Royale | VERGR',
    metaDescription: 'Enter Call of Duty: Warzone cash tournaments: multi-game placement-point format, verified lobbies, escrowed prize pools, and payouts in seconds. Free-entry events available. 18+, skill-based competition.',
    h1: 'Warzone Cash Tournaments',
    subtitle: 'Drop in for real stakes: multi-game placement-point tournaments built for battle royale, with escrowed prize pools and verified results.',
    accent: 'ember',
    updated: UPDATED,
    sections: [
      {
        blocks: [
          { p: 'Warzone tournaments on VERGR use the format the BR community actually competes in: a series of games where your placement in each earns points (15 for a win down through the placement table), and the leaderboard after the final game takes the escrowed prize pool. Solo, duos, or squads, free entry or staked, with every lobby verified so the scoreboard is real.' },
          { p: 'Because Warzone has no public results API, verification is built around identity and evidence instead: your in-game name is verified against your VERGR entry before games count, placements are reported per game with the host or tournament moderator recording results from the lobby, and the dispute flow with recorded proof backs every contested placement.' },
        ],
      },
      {
        h2: 'How a Warzone tournament works',
        blocks: [
          { steps: [
            'Enter solo or as a squad: entry fees are escrowed at join. Squad winnings pay to the squad treasury.',
            'Verify your identity: your in-game player name is matched to your entry via the per-match verification code so nobody can sub in a ringer.',
            'Play the series: a posted number of games (commonly 3 to 5). Placement points accumulate per game: 15, 12, 10, 8, 6, 5, 4, 3, 2, 1.',
            'Get paid: when the final game’s placements are recorded, the points table finalizes and the leader takes the prize pool automatically.',
          ] },
        ],
      },
      {
        h2: 'Why placement points beat kill races',
        blocks: [
          { p: 'Kill-race formats reward hot-dropping and feasting on bots; placement formats reward the skill that actually wins Warzone: rotations, positioning, and clutch endgames. The point spread still pays aggression (a win is worth 15, a mid-pack finish a few), but you cannot buy a title with one lucky lobby, because the format runs across multiple games. It is also the fairest format to verify, since placements are objective and visible on the post-game screen.' },
        ],
      },
      {
        h2: 'Stakes, prizes, and fair play',
        blocks: [
          { tiles: [
            { icon: 'payments', accent: 'gold', title: 'Escrowed pools', body: 'Entries are held in server-side escrow from join to finalization. Free-entry Warzone events with real prizes run alongside staked ones (entry capped at 10,000 coins).' },
            { icon: 'how_to_reg', accent: 'cyan', title: 'Verified lobbies', body: 'Per-match verification codes tie the in-game name to the VERGR account, with name checks before placements count.' },
            { icon: 'gavel', accent: 'violet', title: 'Human-ruled disputes', body: 'Contested placements freeze for moderator review with the post-game screen and recordings as evidence. Nobody is paid until it is resolved.' },
            { icon: 'videocam', accent: 'ember', title: 'High-stakes proof', body: 'Events above 5,000 coins entry require a recorded game + webcam proof feed, reviewable by moderators.' },
          ], cols: 2, min: 280 },
        ],
      },
      {
        h2: 'Warzone cash tournament FAQ',
        blocks: [
          { faq: [
            ['How do Warzone cash tournaments work?', 'A posted series of games where each placement earns points (15 down to 1). Entries are escrowed at join, placements are recorded per game with verified identities, and the points leader after the final game takes the prize pool.'],
            ['Can I enter with my squad?', 'Yes. Duos and squad entries run as team tournaments, and winnings pay into a shared squad treasury your team distributes by its own rules.'],
            ['How are results verified without an API?', 'Identity-first verification: a unique code ties your in-game name to your entry, placements are recorded from the post-game screen, and disputes are ruled by moderators with recorded evidence. High-stakes events also require proof feeds.'],
            ['What about cheaters and ringers?', 'Name verification stops account-sharing ringers, the consented anti-cheat process scan covers desktop tournament play, recorded proof covers the rest, and confirmed cheating forfeits entry and winnings.'],
            ['Is there free entry?', 'Yes. Free-entry Warzone events with real coin prizes run regularly, and they are the recommended way to learn the format before staking.'],
            ['Is this legal where I live?', 'Skill-based competition is legal in most regions; VERGR is 18+ and geo-gates paid entry to regions that permit it. Free play is available everywhere VERGR operates.'],
          ] },
          { links: [
            { label: 'How to make money gaming: the full guide', to: '/platform/make-money-gaming' },
            { label: 'Is VERGR legit? How escrow and payouts work', to: '/platform/legit' },
            { label: 'Apex Legends cash tournaments', to: '/platform/play/apex' },
          ] },
        ],
      },
    ],
    cta: { title: 'Drop in. Place high. Get paid.', label: 'Create my account' },
  },
  {
    slug: 'nba2k',
    path: '/platform/play/nba2k',
    game: 'NBA 2K',
    metaTitle: 'Play NBA 2K for Money: 1v1 Money Matches & Tournaments | VERGR',
    metaDescription: 'Play NBA 2K for real money: instant 1v1 money matches, knockout brackets, results verified from the post-game screen, escrowed stakes, payouts in seconds. Free-entry events available. 18+, skill-based.',
    h1: 'Play NBA 2K for Money',
    subtitle: 'Your jumper, your handles, your money: instant 1v1 NBA 2K money matches and knockout tournaments with escrowed stakes and verified results.',
    accent: 'gold',
    updated: UPDATED,
    sections: [
      {
        blocks: [
          { p: 'If you cook people in 2K, you can get paid for it: VERGR runs instant 1v1 NBA 2K money matches (queue at your stake, winner takes the pot) and bracket tournaments with posted prize pools. Stakes are escrowed before tip-off, the post-game score screen is the evidence standard, and both players confirm the result in-app, so a win pays in seconds and a lie goes to a moderator instead of working.' },
          { p: 'Rulesets are posted before you enter: game length, team restrictions (current rosters, all-time teams allowed or not), and Play Now vs MyTeam style rules are the host’s call and visible up front, so there are no mid-game arguments about what is allowed.' },
        ],
      },
      {
        h2: 'How an NBA 2K money match works',
        blocks: [
          { steps: [
            'Queue or join: Brawl 1v1 at your stake for instant matchmaking, or a bracket with free or paid entry. Entry escrows at join.',
            'Verify the lobby: a unique VERGR match code confirms both players are in the same game per the posted method.',
            'Play your game: the posted ruleset applies (quarter length, team rules). Pause abuse and quit-outs are covered by the dispute flow.',
            'Confirm and get paid: both players report the final score from the post-game screen. Agreement pays instantly; disagreement freezes the pot for moderator review.',
          ] },
        ],
      },
      {
        h2: 'Formats and stakes',
        blocks: [
          { tiles: [
            { icon: 'sports_mma', accent: 'ember', title: '1v1 money matches', body: 'Instant Brawl matchmaking at your chosen stake. One game, winner takes the pot, paid on confirmation.' },
            { icon: 'account_tree', accent: 'cyan', title: 'Knockout cups', body: 'Single and double elimination brackets, free or staked entry up to the 10,000-coin cap, prize pools up to 500,000 coins.' },
            { icon: 'loop', accent: 'violet', title: 'Leagues', body: 'Round-robin and Swiss formats for community 2K leagues where one bad game does not end your run.' },
            { icon: 'live_tv', accent: 'gold', title: 'Stream your matches', body: 'Stream your money matches on VERGR and earn viewer tips on top of your winnings. Tips are live from your first session.' },
          ], cols: 2, min: 280 },
        ],
      },
      {
        h2: 'Fair play in 2K money matches',
        blocks: [
          { list: [
            'Posted rules beat arguments: quarter length, squad restrictions, and pause rules are fixed before entry.',
            'Score-screen evidence: the post-game screen is the canonical result; both players confirm it in-app.',
            'Quit-out protection: disconnects and rage quits route to the dispute flow with evidence, ruled by a moderator, never by the other player.',
            'High-stakes proof: entries above 5,000 coins require a recorded game + webcam proof feed.',
            'One identity per account: KYC at cashout keeps smurf multi-accounts out of prize pools.',
          ] },
        ],
      },
      {
        h2: 'NBA 2K money match FAQ',
        blocks: [
          { faq: [
            ['Can I play NBA 2K for money?', 'Yes. VERGR runs instant 1v1 NBA 2K money matches and bracket tournaments with escrowed stakes. The winner takes the pot, paid seconds after both players confirm the post-game score.'],
            ['How are NBA 2K results verified?', 'A unique match code proves both players are in the same lobby, the post-game score screen is the evidence standard, both players confirm in-app, and a moderator rules on any disagreement with screenshots and recordings.'],
            ['What if my opponent quits when losing?', 'Quit-outs go to the dispute flow, not to the honor system. With the score screen and recorded evidence, a moderator awards the result. Serial quitters lose entries and eventually accounts.'],
            ['What rulesets are used?', 'Hosts post the ruleset before entry: game length, current vs all-time teams, and pause rules. Brawl 1v1 uses standard rules shown at queue time. If you do not like a ruleset, do not enter that event.'],
            ['Do I need to pay to play?', 'No. Free-entry 2K events with real coin prizes run regularly. Staked play is optional, capped at 10,000 coins entry.'],
            ['Is playing 2K for money gambling?', 'No. The outcome is decided by your skill on the sticks, not chance. Skill-based competition with entry fees is legal in most regions; VERGR is 18+ and geo-gates paid play.'],
          ] },
          { links: [
            { label: 'How to make money gaming: the full guide', to: '/platform/make-money-gaming' },
            { label: 'Is VERGR legit? How escrow and payouts work', to: '/platform/legit' },
            { label: 'Play EA Sports FC for money', to: '/platform/play/fc25' },
          ] },
        ],
      },
    ],
    cta: { title: 'Put your game on the line.', label: 'Create my account' },
  },
  {
    slug: 'apex',
    path: '/platform/play/apex',
    game: 'Apex Legends',
    metaTitle: 'Apex Legends Cash Tournaments: Placement Points, Verified | VERGR',
    metaDescription: 'Enter Apex Legends cash tournaments: multi-game placement-point format, linked-account result detection plus moderator confirmation, escrowed prize pools, squad treasury payouts. Free entry available. 18+, skill-based.',
    h1: 'Apex Legends Cash Tournaments',
    subtitle: 'Placement-point tournaments for the Apex grind: linked-account result detection, escrowed prize pools, and squad payouts your team controls.',
    accent: 'pink',
    updated: UPDATED,
    sections: [
      {
        blocks: [
          { p: 'Apex tournaments on VERGR run the competitive BR format: a posted series of games, placement points per game (15 for the win down through the table), and the points leader takes the escrowed prize pool. Enter solo or as a three-stack squad, free entry or staked, with results detected from your linked EA account and confirmed by a tournament moderator.' },
          { p: 'Honest detail about how Apex verification works: VERGR reads results through community stats endpoints for Apex, which is detection assistance rather than an official esports API. So a moderator confirms results as the primary record, with the automated detection as a cross-check, the same dual-layer model used for high-stakes events in every game. You will never lose a placement because an API hiccupped, and nobody can fake one past a moderator.' },
        ],
      },
      {
        h2: 'How an Apex cash tournament works',
        blocks: [
          { steps: [
            'Enter solo or as a squad: entry escrows at join. Squad winnings pay into the shared squad treasury.',
            'Link your EA account once: it ties your in-game identity to your entry and enables automated result detection.',
            'Play the series: a posted number of games with placement points per game (15, 12, 10, 8, 6, 5, 4, 3, 2, 1).',
            'Finalize and get paid: the moderator confirms placements (cross-checked against detection), the table finalizes, and the leader takes the pool automatically.',
          ] },
        ],
      },
      {
        h2: 'Built for squads',
        blocks: [
          { p: 'Apex is a squad game, and VERGR squads are first-class: your three-stack enters as one unit, the bracket runs squad-vs-squad, and prize money lands in a shared squad treasury with line-item history that the whole squad can see. Distribute it equally, by contribution, or however your squad has agreed. Win as a team, get paid as a team.' },
          { tiles: [
            { icon: 'groups', accent: 'cyan', title: 'Squad treasury', body: 'Tournament winnings pay the squad, not one player’s pocket, with a transparent inflow ledger per tournament.' },
            { icon: 'leaderboard', accent: 'violet', title: 'Squad leaderboards', body: 'Results count toward squad rankings and rivalries tracked across every tournament you enter.' },
            { icon: 'cast_for_education', accent: 'gold', title: 'Co-stream your runs', body: 'Stream your tournament games on VERGR while you play; viewer tips stack on top of placement winnings.' },
          ], cols: 3, min: 240 },
        ],
      },
      {
        h2: 'Apex cash tournament FAQ',
        blocks: [
          { faq: [
            ['How do Apex cash tournaments work?', 'A posted series of games where placements earn points (15 down to 1). Entries are escrowed at join, results are detected from your linked EA account and confirmed by a moderator, and the points leader takes the prize pool.'],
            ['How are Apex results verified?', 'Two layers: automated detection from your linked EA account’s stats, and a tournament moderator confirming placements as the primary record. Disputes are ruled with recorded evidence before anything pays out.'],
            ['Can my three-stack enter together?', 'Yes, squads are the native way to play Apex on VERGR. Your team enters as one unit and winnings pay into a shared squad treasury with full inflow history.'],
            ['Is there free entry?', 'Yes. Free-entry Apex events with real coin prizes run regularly. Staked entries are capped at 10,000 coins.'],
            ['What about cheaters?', 'Linked-account identity, the consented anti-cheat process scan for desktop tournament play, recorded proof feeds on high-stakes events, and human moderators ruling on every flag. Confirmed cheating forfeits entry and winnings.'],
            ['Is this gambling?', 'No. Placements are earned by your movement, aim, and rotations, not chance. Skill-based competition is legal in most regions; VERGR is 18+ and geo-gates paid entry.'],
          ] },
          { links: [
            { label: 'How to make money gaming: the full guide', to: '/platform/make-money-gaming' },
            { label: 'Is VERGR legit? How escrow and payouts work', to: '/platform/legit' },
            { label: 'Warzone cash tournaments', to: '/platform/play/warzone' },
          ] },
        ],
      },
    ],
    cta: { title: 'Three-stack. Place high. Split the pool.', label: 'Create my account' },
  },
  {
    slug: 'rocketleague',
    path: '/platform/play/rocketleague',
    game: 'Rocket League',
    metaTitle: 'Rocket League Money Matches & Cash Tournaments | VERGR',
    metaDescription: 'Play Rocket League for money: 1v1 money matches, 2v2 and 3v3 cash tournaments, private-lobby verification, escrowed prize pools, instant payouts. Free-entry events available. 18+, skill-based competition.',
    h1: 'Rocket League Money Matches and Cash Tournaments',
    subtitle: 'From 1v1 duels to 3v3 squad cups: private-lobby verified matches with escrowed stakes, for the ranks who are tired of playing for nothing.',
    accent: 'cyan',
    updated: UPDATED,
    sections: [
      {
        blocks: [
          { p: 'Rocket League money matches on VERGR run in private lobbies you verify with a unique match code: queue a 1v1 Brawl at your stake, or enter 2v2 and 3v3 bracket tournaments with posted prize pools. Stakes are escrowed before kickoff, both sides confirm the result from the post-game screen, and the winner takes the pot in seconds.' },
          { p: 'Verification is built on Rocket League’s private-match system: the unique VERGR code becomes the lobby name (or password per the posted method), which proves both entrants are in the same private arena. It is simple, fast, and impossible to fake past the dispute flow, which has the post-game screen and recordings as evidence.' },
        ],
      },
      {
        h2: 'How a Rocket League money match works',
        blocks: [
          { steps: [
            'Queue or join: Brawl 1v1 for instant matchmaking at your stake, or a 2v2/3v3 bracket. Entry escrows at join.',
            'Create the private match: name the lobby with your unique VERGR match code per the instructions, so both sides are provably in the same arena.',
            'Play the series: best-of-1 up to best-of-5 per the posted format, standard or host-posted mutator rules.',
            'Confirm and get paid: both sides report the result from the post-game screen. Agreement pays instantly; disagreement freezes for moderator review.',
          ] },
        ],
      },
      {
        h2: 'Formats that run for Rocket League',
        blocks: [
          { tiles: [
            { icon: 'sports_mma', accent: 'ember', title: '1v1 duels', body: 'Instant Brawl money matches at your stake. Pure mechanics, winner takes the pot.' },
            { icon: 'groups', accent: 'violet', title: '2v2 and 3v3 squad cups', body: 'Enter as a squad; the bracket runs team-vs-team and winnings pay into your shared squad treasury.' },
            { icon: 'account_tree', accent: 'cyan', title: 'Knockouts and Swiss', body: 'Single elim, double elim, and Swiss formats from quick evening cups to full community events, best-of series supported.' },
            { icon: 'live_tv', accent: 'gold', title: 'Stream your ladder', body: 'Broadcast your money matches on VERGR; viewer tips are live from your first session and stack on top of winnings.' },
          ], cols: 2, min: 280 },
        ],
      },
      {
        h2: 'Stakes and fair play',
        blocks: [
          { list: [
            'Free-entry Rocket League events with real coin prizes run regularly; staked entries are capped at 10,000 coins.',
            'Prize pools are escrowed server-side from join to finalization, paid automatically to the winner.',
            'Posted formats: series length and mutator rules are visible before you enter.',
            'Disconnect and forfeit handling runs through the dispute flow with evidence, ruled by moderators.',
            'High-stakes matches (above 5,000 coins entry) require a recorded game + webcam proof feed.',
          ] },
        ],
      },
      {
        h2: 'Rocket League money match FAQ',
        blocks: [
          { faq: [
            ['Can I play Rocket League for money?', 'Yes. VERGR runs 1v1 Rocket League money matches and 2v2/3v3 cash tournaments in verified private lobbies. Stakes are escrowed and the winner takes the pot on result confirmation.'],
            ['How are Rocket League results verified?', 'The unique VERGR match code names the private lobby, proving both entrants are in the same arena. Both sides confirm the post-game result in-app, and a moderator rules on any disagreement with evidence.'],
            ['Can I enter with my teammates?', 'Yes. 2v2 and 3v3 events run as squad tournaments: your team enters as one unit and winnings pay into a shared squad treasury.'],
            ['What ranks can compete?', 'Any rank. Free-entry events are the right starting point, and staked matches pair you at the stake you choose: you control the risk, and skill-matched recommendations keep newcomers away from whale-stakes events.'],
            ['Do I need to pay to start?', 'No. Free-entry events with real prizes run regularly. Paid stakes are optional and capped at 10,000 coins.'],
            ['Is this legal?', 'Skill-based competition for prizes is legal in most regions because outcomes are decided by mechanics and game sense, not chance. VERGR is 18+ and geo-gates paid play to permitted regions.'],
          ] },
          { links: [
            { label: 'How to make money gaming: the full guide', to: '/platform/make-money-gaming' },
            { label: 'Is VERGR legit? How escrow and payouts work', to: '/platform/legit' },
            { label: 'How tournaments work', to: '/platform/learn/tournaments' },
          ] },
        ],
      },
    ],
    cta: { title: 'What a save. What a payout.', label: 'Create my account' },
  },
];

export const GAME_PAGE_BY_SLUG = Object.fromEntries(GAME_PAGES.map((g) => [g.slug, g]));
export const ALL_GROWTH_PAGES = [PILLAR_PAGE, LEGIT_PAGE, ...GAME_PAGES];
