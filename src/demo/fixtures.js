/**
 * DEMO-ONLY seed data for the in-memory Firestore shim (mockFirestore.js).
 * Rich, realistic fake content for store-listing screenshots. No real users.
 *
 * Timestamps are written as { __ts__: <ms> } and revived into Timestamp objects
 * by mockFirestore's clone(). Images/media use public placeholder + sample
 * hosts; none of this touches the real VERGR backend.
 */
import { DEMO_UID } from './mockAuth';

const now = Date.now();
const min = 60_000, hour = 3_600_000, day = 86_400_000;
const ts = (agoMs = 0) => ({ __ts__: now - agoMs });
const av = (seed) => `https://i.pravatar.cc/300?u=${seed}`;
const img = (seed, w = 900, h = 900) => `https://picsum.photos/seed/${seed}/${w}/${h}`;
const SAMPLE_HLS = 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8';
const SAMPLE_MP4 = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';
const SAMPLE_MP3 = 'https://download.samplelib.com/mp3/sample-6s.mp3';

const SEED = {};
const put = (path, data) => { SEED[path] = data; };

// ─── Users ──────────────────────────────────────────────────────────────
const people = [
  { id: DEMO_UID, username: 'you', displayName: 'You', bio: 'Just here to win. Squad up.', followers: 1280, following: 342, verified: true, game: 'Valorant' },
  { id: 'u_nova', username: 'novastrike', displayName: 'Nova Strike', bio: 'Radiant Valorant • watch me clutch', followers: 48200, following: 210, verified: true, game: 'Valorant' },
  { id: 'u_kai', username: 'kaizen', displayName: 'Kaizen', bio: 'FPS coach • 1v1 me • crosshair in bio', followers: 15600, following: 530, verified: true, game: 'CS2' },
  { id: 'u_luna', username: 'lunaplays', displayName: 'Luna', bio: 'cozy streams + ranked grind 💜', followers: 9800, following: 410, verified: false, game: 'League of Legends' },
  { id: 'u_rook', username: 'rookie_rook', displayName: 'Rook', bio: 'controller on PC, fight me', followers: 3400, following: 890, verified: false, game: 'Fortnite' },
  { id: 'u_zeke', username: 'zeke', displayName: 'Zeke', bio: 'tournament organizer @ VERGR', followers: 22100, following: 120, verified: true, game: 'Apex Legends' },
  { id: 'u_mira', username: 'miragg', displayName: 'Mira', bio: 'support main • good vibes only', followers: 6700, following: 300, verified: false, game: 'Overwatch 2' },
  { id: 'u_dex', username: 'dexterous', displayName: 'Dex', bio: 'speedruns + chaos', followers: 41200, following: 65, verified: true, game: 'Minecraft' },
  { id: 'u_sova', username: 'sova_main', displayName: 'Sova', bio: 'recon dart enjoyer', followers: 5200, following: 240, verified: false, game: 'Valorant' },
  { id: 'u_ghost', username: 'ghostlyy', displayName: 'Ghostly', bio: 'edits + montages', followers: 18800, following: 90, verified: true, game: 'Fortnite' },
  { id: 'u_brie', username: 'brie', displayName: 'Brie', bio: 'variety streamer, cat mom 🐱', followers: 7300, following: 510, verified: false, game: 'Various' },
  { id: 'u_ten', username: 'tenzfan', displayName: 'Ten', bio: 'aim diff', followers: 2100, following: 730, verified: false, game: 'Valorant' },
  { id: 'u_pix', username: 'pixel', displayName: 'Pixel', bio: 'indie dev + gamer', followers: 990, following: 300, verified: false, game: 'Minecraft' },
  { id: 'u_vex', username: 'vex', displayName: 'Vex', bio: 'apex predator badge holder', followers: 33400, following: 80, verified: true, game: 'Apex Legends' },
];
const P = Object.fromEntries(people.map((p) => [p.id, p]));
for (const p of people) {
  put(`users/${p.id}`, {
    username: p.username, displayName: p.displayName, handle: p.username, name: p.displayName,
    bio: p.bio, photoURL: av(p.username), avatarUrl: av(p.username), avatar: av(p.username),
    bannerUrl: img(`banner-${p.username}`, 1200, 400), banner: img(`banner-${p.username}`, 1200, 400),
    isVerified: p.verified, verified: p.verified, followerCount: p.followers, followersCount: p.followers,
    followingCount: p.following, country: 'US', location: 'United States', mainGame: p.game, favoriteGame: p.game,
    isOnboarded: true, isGuest: false, role: p.id === DEMO_UID ? 'admin' : 'user',
    subscription: { tier: p.id === DEMO_UID ? 'pro' : (p.verified ? 'lite' : 'free') }, tier: p.id === DEMO_UID ? 'pro' : 'free',
    tournamentPoints: 800 + (p.followers % 1500), vp: 15000 + (p.followers % 9000), level: 12 + (p.followers % 40), prestige: 1 + (p.followers % 4),
    postCount: 40 + (p.followers % 120), clipCount: 12 + (p.followers % 40),
    status: 'online', lastSeen: ts(2 * min), createdAt: ts(300 * day),
    hideFromEnumeration: false, searchVis: true, profileVis: 'public',
  });
}

put(`wallets/${DEMO_UID}`, {
  balance: 24500, gems: 3820, vp: 15240, tier: 'pro', dailyStreak: 6,
  totalEarned: 91000, totalSpent: 42000, totalReceived: 30000, totalTipped: 8000, totalGemsEarned: 5200,
});

for (const p of people) if (p.id !== DEMO_UID) {
  put(`users/${DEMO_UID}/following/${p.id}`, { uid: p.id, createdAt: ts(10 * day) });
  put(`users/${p.id}/followers/${DEMO_UID}`, { uid: DEMO_UID, createdAt: ts(10 * day) });
}

put('app_config/general', { chatRelayEnabled: false, liveStreamingPaused: false, freeUploadsPaused: false, streamFollowerGateEnabled: false });

// ─── Feed posts / clips ──────────────────────────────────────────────────
const postSeed = [
  { a: 'u_nova', type: 'clip', text: '1v4 clutch to close out the map 🔥 no way this worked', media: img('clip-nova', 800, 1000), likes: 3420, comments: 214, game: 'Valorant' },
  { a: 'u_dex', type: 'photo', text: 'new personal best speedrun. 18:42 🏁 six months of grinding paid off', media: img('dex-run', 1000, 750), likes: 5210, comments: 402, game: 'Minecraft' },
  { a: 'u_ghost', type: 'clip', text: 'montage drop 🎬 which clip goes hardest? honest answers only', media: img('ghost-monta', 900, 1100), likes: 8900, comments: 640, game: 'Fortnite' },
  { a: 'u_kai', type: 'text', text: 'Aim routine that took me from Gold to Global 🧵\n1. 10 min gridshot\n2. 10 min tracking\n3. deathmatch until your wrist gives up', likes: 1880, comments: 96, game: 'CS2' },
  { a: 'u_luna', type: 'photo', text: 'cozy ranked night, come hang 💜 new setup reveal', media: img('luna-cozy', 1000, 1000), likes: 2140, comments: 130, game: 'League of Legends' },
  { a: 'u_vex', type: 'clip', text: 'predator lobbies are actually unfair rn 😭 3rd party central', media: img('vex-apex', 900, 1100), likes: 6100, comments: 288, game: 'Apex Legends' },
  { a: 'u_zeke', type: 'text', text: 'Weekend Apex tournament is LIVE for signups. 128 slots, FREE to enter, 180k coin purse. drop your IGN below 👇', likes: 990, comments: 210, game: 'Apex Legends' },
  { a: 'u_mira', type: 'clip', text: 'perfectly timed grav surge = full team wipe. chef’s kiss', media: img('mira-ow', 800, 1000), likes: 1520, comments: 88, game: 'Overwatch 2' },
  { a: 'u_rook', type: 'photo', text: 'built different (the build fights carried, not me)', media: img('rook-fn', 1000, 800), likes: 760, comments: 54, game: 'Fortnite' },
  { a: 'u_nova', type: 'text', text: 'GM. what rank are we hitting today? 👀 goal is Immortal by friday', likes: 640, comments: 300, game: 'Valorant' },
  { a: 'u_brie', type: 'photo', text: 'stream buddy approves of the new ranked climb 🐱', media: img('brie-cat', 1000, 900), likes: 4300, comments: 512, game: 'Various' },
  { a: 'u_sova', type: 'clip', text: 'recon into double kill, love this agent', media: img('sova-clip', 800, 1000), likes: 1220, comments: 44, game: 'Valorant' },
  { a: 'u_dex', type: 'text', text: 'hot take: hardcore mode is the only real way to play. change my mind', likes: 2600, comments: 780, game: 'Minecraft' },
  { a: 'u_ghost', type: 'photo', text: 'thumbnail for the next vid, thoughts?', media: img('ghost-thumb', 1000, 700), likes: 3100, comments: 260, game: 'Fortnite' },
  { a: 'u_kai', type: 'clip', text: 'one tap collateral. still shaking 🤯', media: img('kai-collat', 800, 1000), likes: 4500, comments: 190, game: 'CS2' },
  { a: 'u_ten', type: 'text', text: 'lost 8 RR for a draw?? explain this riot', likes: 410, comments: 120, game: 'Valorant' },
  { a: 'u_vex', type: 'photo', text: 'season grind wrapped: #47 predator 🏆 gg to my squad', media: img('vex-pred', 1000, 900), likes: 7200, comments: 340, game: 'Apex Legends' },
  { a: 'u_luna', type: 'clip', text: 'pentakill on stream and i SCREAMED 😭 clip of the month?', media: img('luna-penta', 800, 1000), likes: 5600, comments: 430, game: 'League of Legends' },
];
postSeed.forEach((p, i) => {
  const a = P[p.a];
  put(`posts/post_${i}`, {
    authorId: p.a, authorUid: p.a, userId: p.a, authorName: a.displayName, authorUsername: a.username,
    authorAvatar: av(a.username), authorPhotoURL: av(a.username), authorVerified: a.verified,
    type: p.type, content: p.text, text: p.text, caption: p.text, body: p.text,
    mediaUrl: p.media || null, imageUrl: p.media || null, thumbnailUrl: p.media || null, contentUrl: p.media || null,
    game: p.game, tags: [p.game],
    likeCount: p.likes, likesCount: p.likes, likes: p.likes, commentCount: p.comments, commentsCount: p.comments,
    repostCount: Math.floor(p.likes / 20), viewCount: p.likes * 12, shareCount: Math.floor(p.likes / 30), bookmarkCount: Math.floor(p.likes / 40),
    status: 'published', visibility: 'public', createdAt: ts(i * 80 * min + 5 * min), timestamp: ts(i * 80 * min + 5 * min),
  });
});

// ─── Live streams ─────────────────────────────────────────────────────────
put('streams/live_nova', {
  hostUid: 'u_nova', streamerId: 'u_nova', hostName: 'Nova Strike', hostUsername: 'novastrike', hostAvatar: av('novastrike'),
  title: 'RADIANT grind → road to #1 leaderboard', game: 'Valorant', isLive: true, status: 'live', audience: 'public', ingestType: 'fmp4',
  viewerCount: 1284, viewers: 1284, heartCount: 20400, hearts: 20400, likeCount: 20400,
  thumbnailUrl: img('stream-nova', 1280, 720), coverUrl: img('stream-nova', 1280, 720),
  hlsUrl: SAMPLE_HLS, playbackUrl: SAMPLE_HLS, playlistUrl: SAMPLE_HLS, compositeHlsUrl: SAMPLE_HLS, streamKey: 'demo_nova',
  moderatorUids: ['u_mira'], lastHeartbeat: ts(5000), startedAt: ts(42 * min), createdAt: ts(42 * min),
});
put('streams/live_dex', {
  hostUid: 'u_dex', streamerId: 'u_dex', hostName: 'Dex', hostUsername: 'dexterous', hostAvatar: av('dexterous'),
  title: 'speedrun marathon (any%) — WR attempts all night', game: 'Minecraft', isLive: true, status: 'live', audience: 'public', ingestType: 'fmp4',
  viewerCount: 642, viewers: 642, heartCount: 8800, hearts: 8800, thumbnailUrl: img('stream-dex', 1280, 720),
  coverUrl: img('stream-dex', 1280, 720), hlsUrl: SAMPLE_HLS, playbackUrl: SAMPLE_HLS, compositeHlsUrl: SAMPLE_HLS, streamKey: 'demo_dex',
  moderatorUids: [], lastHeartbeat: ts(4000), startedAt: ts(90 * min), createdAt: ts(90 * min),
});
put('streams/live_vex', {
  hostUid: 'u_vex', streamerId: 'u_vex', hostName: 'Vex', hostUsername: 'vex', hostAvatar: av('vex'),
  title: 'ranked to Pred — grinding with the squad', game: 'Apex Legends', isLive: true, status: 'live', audience: 'public', ingestType: 'fmp4',
  viewerCount: 2210, viewers: 2210, heartCount: 31200, hearts: 31200, thumbnailUrl: img('stream-vex', 1280, 720),
  coverUrl: img('stream-vex', 1280, 720), hlsUrl: SAMPLE_HLS, playbackUrl: SAMPLE_HLS, compositeHlsUrl: SAMPLE_HLS, streamKey: 'demo_vex',
  moderatorUids: [], lastHeartbeat: ts(3000), startedAt: ts(120 * min), createdAt: ts(120 * min),
});
[['u_kai', 4200, 'kaizen'], ['u_sova', 2600, 'sova_main'], ['u_rook', 1500, 'rookie_rook'], ['u_ten', 900, 'tenzfan'], ['u_brie', 500, 'brie']]
  .forEach(([uid, coins, uname]) => put(`streams/live_nova/gifters/${uid}`, { uid, coins, name: P[uid].displayName, avatar: av(uname) }));

// ─── Tournaments ────────────────────────────────────────────────────────
const tourneys = [
  { id: 't_val', name: 'VERGR Valorant Clash', game: 'Valorant', prize: 250000, entrants: 96, cap: 128, status: 'open' },
  { id: 't_apex', name: 'Apex Weekend Warzone', game: 'Apex Legends', prize: 180000, entrants: 128, cap: 128, status: 'active' },
  { id: 't_cs', name: 'CS2 Ace League', game: 'CS2', prize: 120000, entrants: 42, cap: 64, status: 'open' },
  { id: 't_ow', name: 'Overwatch Open Cup', game: 'Overwatch 2', prize: 90000, entrants: 24, cap: 32, status: 'open' },
  { id: 't_fn', name: 'Fortnite Build Battle', game: 'Fortnite', prize: 150000, entrants: 200, cap: 256, status: 'open' },
  { id: 't_lol', name: 'Rift Rumble 5v5', game: 'League of Legends', prize: 110000, entrants: 40, cap: 64, status: 'active' },
];
tourneys.forEach((t, i) => {
  put(`tournaments/${t.id}`, {
    name: t.name, title: t.name, game: t.game, bannerUrl: img(`tour-${t.id}`, 1200, 480), coverArt: img(`tour-${t.id}`, 1200, 480), coverUrl: img(`tour-${t.id}`, 1200, 480),
    prizePool: t.prize, declaredPurse: t.prize, entryFee: 0, fundingModel: 'ticketed',
    participantCount: t.entrants, maxParticipants: t.cap, capacity: t.cap, status: t.status, state: t.status,
    hostUid: 'u_zeke', hostName: 'Zeke', bracketType: 'single_elim', region: 'NA', visibility: 'public',
    scheduledStart: ts(-1 * day - i * hour), startsAt: ts(-1 * day - i * hour), createdAt: ts(5 * day + i * hour),
    ticket: { priceCoins: 300, capacity: 5000, purseSlicePct: 20, audience: 'public' },
  });
});

// ─── Squads ─────────────────────────────────────────────────────────────
const squads = [
  { id: 's_apex', name: 'Apex Predators', tag: 'APEX', members: 42, game: 'Apex Legends' },
  { id: 's_val', name: 'Radiant Rejects', tag: 'RDNT', members: 28, game: 'Valorant' },
  { id: 's_chill', name: 'Chill Gamers Club', tag: 'CHILL', members: 87, game: 'Various' },
];
const squadMembers = [DEMO_UID, 'u_zeke', 'u_mira', 'u_rook', 'u_kai', 'u_vex', 'u_sova'];
squads.forEach((s) => {
  put(`squads/${s.id}`, {
    name: s.name, tag: s.tag, game: s.game, memberCount: s.members, members: s.members,
    memberIds: squadMembers, isPublic: true,
    avatarUrl: img(`squad-${s.id}`, 400, 400), iconUrl: img(`squad-${s.id}`, 400, 400),
    bannerUrl: img(`squadb-${s.id}`, 1200, 400), coverUrl: img(`squadb-${s.id}`, 1200, 400),
    ownerId: DEMO_UID, ownerUid: DEMO_UID, description: `${s.name} — we grind, we win, we vibe. Weekly scrims, monthly tournaments, and a stacked coin treasury.`,
    treasury: 12400, treasuryBalance: 12400, visibility: 'public', createdAt: ts(60 * day),
  });
  squadMembers.forEach((uid, idx) => put(`squads/${s.id}/members/${uid}`, {
    uid, userId: uid, role: uid === DEMO_UID ? 'owner' : (idx === 1 ? 'admin' : 'member'),
    displayName: P[uid]?.displayName, username: P[uid]?.username, avatar: av(P[uid]?.username), joinedAt: ts((60 - idx * 4) * day),
  }));
});

// ─── Chat threads (rich, natural histories) ─────────────────────────────
// buildThread: lines assigned increasing timestamps. `g` = minutes since the
// previous line (default 6); big `g` values create day/hour separators.
function buildThread(convoId, lines) {
  const g = lines.map((l, i) => (i === 0 ? 0 : (l.g == null ? 6 : l.g)));
  let fwd = 0; const F = g.map((x) => (fwd += x));
  const maxF = F[F.length - 1];
  lines.forEach((l, i) => {
    const from = l.f === 'me' ? DEMO_UID : l.f;
    const agoMs = (maxF - F[i] + 9) * min;
    const base = {
      senderId: from, senderUid: from, authorId: from,
      type: l.type || 'text', text: l.t || '', content: l.t || '',
      createdAt: ts(agoMs), timestamp: ts(agoMs), read: i < lines.length - 3 || from === DEMO_UID,
    };
    if (l.img) { base.type = 'image'; base.contentUrl = l.img; base.thumbnailUrl = l.img; }
    if (l.vid) { base.type = 'video'; base.contentUrl = SAMPLE_MP4; base.posterUrl = l.vid; base.thumbnailUrl = l.vid; }
    if (l.voice) { base.type = 'voice'; base.contentUrl = SAMPLE_MP3; base.duration = l.voice; }
    if (l.sys) { base.type = 'system'; }
    if (l.reply) base.replyTo = l.reply;
    put(`conversations/${convoId}/messages/${convoId}_m${i}`, base);
  });
  return lines[lines.length - 1];
}

const convos = [
  { id: 'c_nova', with: 'u_nova', group: false, unread: 2 },
  { id: 'c_kai', with: 'u_kai', group: false, unread: 0 },
  { id: 'c_luna', with: 'u_luna', group: false, unread: 1 },
  { id: 'c_ghost', with: 'u_ghost', group: false, unread: 0 },
  { id: 'c_squad', with: null, group: true, unread: 5, name: 'Apex Predators', game: 'Apex Legends' },
];

const THREADS = {
  c_nova: [
    { f: 'u_nova', t: 'yo you catch the vct match last night?', g: 0 },
    { f: 'me', t: 'yeah that overtime was insane', g: 3 },
    { f: 'u_nova', t: 'the 1v3 retake on ascent 🤯', g: 2 },
    { f: 'me', t: 'i rewound it like 4 times lol', g: 4 },
    { f: 'u_nova', t: 'anyway you free to queue tonight? need a duo', g: 700 },
    { f: 'me', t: 'yeah after 8, gotta finish work stuff', g: 5 },
    { f: 'u_nova', t: 'bet. what rank are you now', g: 3 },
    { f: 'me', t: 'plat 3, so close to diamond i can taste it', g: 2 },
    { f: 'u_nova', t: 'lets get you there tonight then 💪', g: 2 },
    { f: 'u_nova', t: 'watch this from my last game', vid: img('nova-clip-share', 800, 450), g: 30 },
    { f: 'me', t: 'HELLO?? that flick', g: 8 },
    { f: 'me', t: 'how do you even hit that', g: 1 },
    { f: 'u_nova', t: 'muscle memory + copium', g: 2 },
    { f: 'u_nova', t: 'send me your crosshair, i’ll fix it', g: 3 },
    { f: 'me', t: 'here', img: img('crosshair-cfg', 700, 500), g: 4 },
    { f: 'u_nova', t: 'yeah your thickness is way too high, drop it to 1', g: 5 },
    { f: 'u_nova', t: 'and turn off the outline', g: 1 },
    { f: 'me', t: 'trying it now', g: 3 },
    { f: 'me', t: 'ok this feels so much cleaner already', g: 6 },
    { f: 'u_nova', t: 'told you 😌', g: 2 },
    { f: 'u_nova', t: 'quick voice, easier to explain the peeking thing', voice: 14, g: 40 },
    { f: 'me', t: 'ok that actually makes sense, jiggle then commit', g: 9 },
    { f: 'u_nova', t: 'exactly. you’ll climb fast', g: 3 },
    { f: 'me', t: 'appreciate you 🙏 tipping you a coffee', g: 4 },
    { f: 'me', t: 'sent 500 🪙', type: 'text', g: 1 },
    { f: 'u_nova', t: 'W friend 🫡 see you at 8', g: 2 },
    { f: 'u_nova', t: 'gg that was insane, run it back?', g: 620 },
  ],
  c_kai: [
    { f: 'me', t: 'yo coach, got 10 min for a vod review?', g: 0 },
    { f: 'u_kai', t: 'ofc, drop the clip', g: 4 },
    { f: 'me', t: 'here, the round i threw', vid: img('kai-vod', 800, 450), g: 3 },
    { f: 'u_kai', t: 'ok first thing — you’re over-peeking mid every round', g: 7 },
    { f: 'u_kai', t: 'they know exactly where you’ll be', g: 1 },
    { f: 'me', t: 'yeah i felt predictable', g: 3 },
    { f: 'u_kai', t: 'vary your timings. sometimes hold, sometimes fast peek', g: 4 },
    { f: 'u_kai', t: 'here’s my crosshair + sens if you want to try it', g: 3 },
    { f: 'u_kai', t: 'sent you the crosshair code 🎯', g: 1 },
    { f: 'me', t: 'copied. running a DM now', g: 5 },
    { f: 'me', t: 'wrist already feels better ngl', g: 12 },
    { f: 'u_kai', t: 'lower sens = more consistent. trust the process', g: 3 },
    { f: 'u_kai', t: 'same time next week?', g: 400 },
    { f: 'me', t: 'yes please 🙏', g: 6 },
  ],
  c_luna: [
    { f: 'u_luna', t: 'omg did you see i hit a pentakill on stream', g: 0 },
    { f: 'me', t: 'i saw the clip! you SCREAMED lmao', g: 4 },
    { f: 'u_luna', t: 'i was NOT normal about it 😭😭', g: 2 },
    { f: 'u_luna', t: 'clip', vid: img('luna-penta-share', 800, 450), g: 2 },
    { f: 'me', t: 'chat went feral, deserved', g: 5 },
    { f: 'u_luna', t: 'anyway new setup came in, wanna see 👀', g: 300 },
    { f: 'u_luna', t: '', img: img('luna-setup', 900, 700), g: 1 },
    { f: 'me', t: 'ok that is GORGEOUS, the purple lighting 💜', g: 6 },
    { f: 'u_luna', t: 'thank youuu, took all weekend to cable manage', g: 3 },
    { f: 'me', t: 'worth it. streaming tonight?', g: 4 },
    { f: 'u_luna', t: 'stream tonight? 💜', g: 200 },
  ],
  c_ghost: [
    { f: 'u_ghost', t: 'new montage dropping friday, want a shoutout in it?', g: 0 },
    { f: 'me', t: 'wait for real? that’d be sick', g: 5 },
    { f: 'u_ghost', t: 'yeah you’ve got that clip from last week, mind if i use it', g: 3 },
    { f: 'me', t: 'go for it 🙏 tag me when it’s up', g: 4 },
    { f: 'u_ghost', t: 'bet. here’s a rough preview', vid: img('ghost-preview', 800, 450), g: 8 },
    { f: 'me', t: 'the transitions are insane, how long did this take', g: 10 },
    { f: 'u_ghost', t: 'like 14 hours lol worth it though', g: 3 },
    { f: 'me', t: 'respect. can’t wait for the full thing', g: 4 },
  ],
  c_squad: [
    { f: 'u_zeke', t: 'aight team, scrim block tonight. who’s in', g: 0 },
    { f: 'u_mira', t: 'in 🙋', g: 3 },
    { f: 'u_vex', t: 'in, but i can only do after 9', g: 2 },
    { f: 'u_rook', t: 'same, 9 works', g: 1 },
    { f: 'me', t: 'i’m down, 9 is good', g: 2 },
    { f: 'u_zeke', t: 'perfect. we’re running the new comp', g: 4 },
    { f: 'u_zeke', t: 'here’s the vod from our last scrim to review', vid: img('squad-vod', 800, 450), g: 3 },
    { f: 'u_mira', t: 'we ALWAYS lose the mid fight, we gotta rotate faster', g: 60 },
    { f: 'u_vex', t: 'agreed, i’ll shotcall rotates tonight', g: 4 },
    { f: 'u_kai', t: 'i can flex to entry if we need it', g: 3 },
    { f: 'u_rook', t: 'gg last night btw, that final zone was clean', g: 200 },
    { f: 'u_mira', t: 'the treasury hit 12k coins, next tournament buy-in is covered 🏆', g: 30 },
    { f: 'me', t: 'let’s gooo', g: 2 },
    { f: 'u_zeke', t: 'reminder: apex weekend warzone signups close friday', g: 400 },
    { f: 'u_mira', t: 'scrims at 8pm lock in', g: 300 },
  ],
};

convos.forEach((c) => {
  const other = c.group ? null : P[c.with];
  const participants = c.group ? [DEMO_UID, 'u_zeke', 'u_mira', 'u_rook', 'u_vex', 'u_kai'] : [DEMO_UID, c.with];
  const last = buildThread(c.id, THREADS[c.id]);
  const lastText = last.t || (last.vid ? '🎬 Video' : last.img ? '📷 Photo' : last.voice ? '🎤 Voice message' : 'Media');
  put(`conversations/${c.id}`, {
    participants, isGroup: c.group, type: c.group ? 'group' : 'dm', status: 'active', visibility: c.group ? 'public' : 'private',
    name: c.group ? c.name : null, groupName: c.group ? c.name : null,
    groupIcon: c.group ? img(`gc-${c.id}`, 200, 200) : null, icon: c.group ? img(`gc-${c.id}`, 200, 200) : null,
    lastMessage: lastText, lastMessageText: lastText, lastMessageAt: ts(9 * min), updatedAt: ts(9 * min),
    unreadCount: { [DEMO_UID]: c.unread }, hiddenFor: {}, createdAt: ts(40 * day),
    metadata: c.group
      ? { 'u_zeke': { displayName: 'Zeke', username: 'zeke', avatar: av('zeke') } }
      : { [c.with]: { displayName: other.displayName, username: other.username, photoURL: av(other.username), avatar: av(other.username), status: 'online' } },
  });
});

// ─── Notifications ──────────────────────────────────────────────────────
const notifs = [
  { id: 'n1', type: 'follow', from: 'u_dex', text: 'Dex started following you' },
  { id: 'n2', type: 'like', from: 'u_luna', text: 'Luna liked your clip' },
  { id: 'n3', type: 'comment', from: 'u_kai', text: 'Kaizen commented: “insane flick 🔥”' },
  { id: 'n4', type: 'coins', from: 'u_nova', text: 'Nova Strike tipped you 500 coins' },
  { id: 'n5', type: 'like', from: 'u_vex', text: 'Vex and 231 others liked your post' },
  { id: 'n6', type: 'follow', from: 'u_ghost', text: 'Ghostly started following you' },
  { id: 'n7', type: 'mention', from: 'u_zeke', text: 'Zeke mentioned you in Apex Predators' },
  { id: 'n8', type: 'comment', from: 'u_brie', text: 'Brie replied to your comment' },
  { id: 'n9', type: 'tournament', from: 'u_zeke', text: 'Your match in CS2 Ace League starts in 30 min' },
  { id: 'n10', type: 'like', from: 'u_sova', text: 'Sova liked your clip' },
];
notifs.forEach((n, i) => put(`notifications/${n.id}`, {
  userId: DEMO_UID, recipientId: DEMO_UID, uid: DEMO_UID, type: n.type,
  fromUid: n.from, fromUser: n.from, actorId: n.from, actorName: P[n.from]?.displayName, actorAvatar: av(P[n.from]?.username),
  title: n.text, body: n.text, message: n.text, read: i > 3, seen: i > 3, createdAt: ts(i * 40 * min + 8 * min),
}));

export { SEED };
