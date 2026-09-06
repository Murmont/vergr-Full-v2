// The simulator's clock and state.
//
// ⚠ SIMULATION ONLY. Nothing here writes to Firestore, opens a socket, calls a
// callable or touches a wallet. It is a bag of React state plus a timer, so the
// admin preview can show the real components doing real things without any of
// it being real.
//
// ⚠ CHAT MUST BE BOUNDED. A message every second with no cap is an array that
// grows until the tab dies, and this screen is left open for long stretches
// while screenshots are taken. MAX_MESSAGES trims from the front.

import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { HEART_COMBO_MAX } from '../../../components/streams/ComboMeter';
import { loadAssets, putAsset, deleteAsset, avatarKey, videoKey } from './previewAssets';
import {
  CHAT_SCRIPT, TIP_SCRIPT, SUB_SCRIPT, JOIN_SCRIPT,
  makeMessage, makeJoinEvent, castByUid, nextId, HELD_SEED,
} from './previewCast';

const MAX_MESSAGES = 40;
// JoinAnnouncer keeps its own display timer; this only bounds the array we pass.
const MAX_JOINS = 6;

export default function useStreamSim(initialDoc) {
  const [doc, setDoc] = useState(initialDoc);
  const [messages, setMessages] = useState(() =>
    CHAT_SCRIPT.slice(0, 5).map(([uid, text]) => {
      const m = makeMessage(uid, text);
      return { ...m, sub: !!castByUid(uid).sub };
    }));
  const [joinEvents, setJoinEvents] = useState([]);
  const [chatRate, setChatRate] = useState(3);   // seconds between messages, 0 = paused
  const [openSheet, setOpenSheet] = useState(null);
  // Viewer-dismissable chat. Lives here so the rail can toggle it and both
  // states are capturable, and so every surface reads one flag.
  const [chatHidden, setChatHidden] = useState(false);
  // Membership state for the status strip. Real product reads
  // memberships/{sub}_{creator}; here it is a toggle so both chips can be
  // captured. A chip that always says Subscribe to somebody who already pays
  // is worse than no chip.
  const [subscribed, setSubscribed] = useState(false);
  const [reactions, setReactions] = useState([]);
  // ⚠ FAILURE AND RESTRICTION ARE STATES YOU MUST BE ABLE TO SELECT. The
  // preview could draw a stream working and nothing else — no reconnect, no
  // host-dropped, no paywall, no "you are muted". Those are screens real people
  // hit, and a creator deciding whether to price a stream needs to SEE what a
  // non-subscriber sees.
  const [playback, setPlayback] = useState('live');   // previewStates.PLAYBACK_STATES
  const [chatState, setChatState] = useState('open'); // previewStates.CHAT_STATES
  const [gate, setGate] = useState('none');           // none | subs | paid
  // ⚠ THE REAL ENDED SCREEN HAS FOUR COPY STATES AND THE PREVIEW HAD ONE.
  // MobileLiveViewer.jsx:657-660 branches on replayUrl / vodPending /
  // vodExpired / neither, and each says something different about whether
  // there is anything left to watch. The preview offered no replay at all,
  // on a product where Pro sells 90-day replays.
  const [vod, setVod] = useState('available');        // available | pending | expired | none
  // Spoken chat. Never actually speaks — see TtsStrip.
  const [tts, setTts] = useState('off');              // previewStates.TTS_STATES
  // The broadcaster's own uplink. A number nobody reads is not a warning.
  const [health, setHealth] = useState('ok');         // previewStates.HEALTH_STATES
  // ⚠ THE VIEWER'S OWN WALLET. Every tip and boost price is checked against it,
  // and 'not enough coins' is a state the preview could not draw at all.
  const [balance, setBalance] = useState(240);
  // ⚠ WHAT THE VIEWER HAS EARNED BY BEING HERE. Vergr pays VP for watching and
  // for tipping already; the stream just never said so.
  const [watchMinutes, setWatchMinutes] = useState(42);
  const [levelUp, setLevelUp] = useState(false);
  // Founder decision 2026-09-02: audio-only broadcasts are allowed.
  const [audioOnly, setAudioOnly] = useState(false);
  // Founder decision 2026-09-02: followers and/or subs may clip. The per-plan
  // LENGTH and COUNT limits are separate and untouched (streamClips.js:24).
  const [clipWho, setClipWho] = useState('everyone'); // everyone | followers | subs
  // Founder decision 2026-09-02: a mod-only channel. UI here; the relay must
  // enforce the membership or it is not private.
  const [chatChannel, setChatChannel] = useState('public'); // public | mods
  // A raid landing on this viewer. Founder decisions: VP to the raider, no viewer
  // floor, never onto an audio-only or gated stream (enforced in functions/raids.js).
  // ⚠⚠ THE TIP BAR IS PLACED BY THE BROADCASTER, NOT BY US. Founder, twice: it must be
  // movable and resizable. Measured before this existed: on the split viewer the bar
  // covered the subject band by 9,704px and on landscape by 6,872px — it sat across the
  // broadcaster's face in every capture. A fixed position cannot be right for every
  // framing, which is the whole reason it is a control and not a constant.
  // Percentages of the STAGE, so it survives a device-preset change.
  // The default is deliberately low-left: clear of the subject band (15-65% vertical).
  // ⚠ null = THE BROADCASTER HAS NOT PLACED IT YET, so each surface falls back to a
  // default suited to ITS OWN SHAPE. One shared default cannot work: measured on the
  // full-bleed portrait broadcaster, yPct 70 is 70% of the WHOLE SCREEN and lands the
  // bar inside the chat. The moment the broadcaster drags or resizes, this becomes a
  // concrete box and every surface — including every viewer — uses that instead.
  const [goalBox, setGoalBox] = useState(null);
  // off by default so a capture is clean; on, the broadcaster can drag and resize
  const [goalEdit, setGoalEdit] = useState(false);
  const [raiding, setRaiding] = useState(false);
  // ⚠ THE SWITCH CHANGES THE REAL CHAT, so the moderators’ room is a MESSAGE LIST
  // like any other — not a second panel drawn over the first. One surface, two
  // rooms, which is what the founder asked for and is also how the relay will
  // model it.
  // ⚠ BUILT THROUGH makeMessage, NEVER HAND-ROLLED. The first version spelled the
  // uids and names out inline and an existing guard caught it: a person invented here
  // is not in CAST, so an uploaded avatar can never reach them and their vpLevel,
  // crest and cosmetics are whatever I happened to type.
  const modMessages = useMemo(() => ([
    makeMessage('c5', 'watching the guy spamming links in caps'),
    makeMessage('c4', 'timeout him 10m, he did it on the last stream too'),
    makeMessage('c5', 'done, logged it'),
  ]), []);

  // ── uploaded assets ──────────────────────────────────────────────────
  //
  // ⚠ THE RAIL MUST LET YOU SUPPLY REAL MEDIA, not just generate placeholders.
  // Founder, 2026-08-31. Identicons and the drawn scene are the FALLBACK so
  // nothing renders empty before anything is uploaded; these overrides are the
  // point. Upload a face for Riven and it appears everywhere Riven appears.
  //
  // ⚠ UPLOADS SURVIVE A REFRESH, AND THAT IS NOT OPTIONAL. Founder, 2026-08-31:
  // "when i refresh the page all the images and video is removed." The FILES
  // live in IndexedDB (previewAssets.js); only the blob URL is per-tab, and it
  // is minted fresh on every mount. Still entirely local — no R2, no Firestore,
  // no callable, nothing leaves the machine.
  //
  // ⚠ THE URL IS CREATED IN THE HANDLER OR THE LOADER, NEVER IN RENDER. Minting
  // one in a render body makes a new URL every pass, which flickers the media
  // and leaks every previous one. [[reference-object-url-in-render]]
  const [avatars, setAvatars] = useState({});      // { [uid]: blobUrl }
  // ⚠ ONE MAP, ONE SLOT PER TILE. It used to be two separate states, `scene`
  // and `facecam`, and the co-host grid handed the SAME facecam clip to every
  // guest tile — a four-way capture showed one person duplicated three times.
  // Keyed by slot so adding a layout means adding a slot, not another useState.
  const [videos, setVideos] = useState({});        // { [slot]: blobUrl }

  // Live blob URLs, so unmount can revoke exactly what it minted without the
  // cleanup effect having to depend on state it would then re-run for.
  const liveUrls = useRef(new Set());
  const mintUrl = useCallback((blob) => {
    const u = URL.createObjectURL(blob);
    liveUrls.current.add(u);
    return u;
  }, []);
  const dropUrl = useCallback((u) => {
    if (!u) return;
    URL.revokeObjectURL(u);
    liveUrls.current.delete(u);
  }, []);

  // Rehydrate on mount. Guarded so a slow read that resolves after the screen
  // has closed does not mint URLs nothing will ever revoke.
  useEffect(() => {
    let alive = true;
    loadAssets().then((blobs) => {
      if (!alive) return;
      const faces = {};
      const vids = {};
      Object.entries(blobs).forEach(([id, blob]) => {
        if (id.startsWith('video:')) vids[id.slice(6)] = mintUrl(blob);
        else if (id.startsWith('avatar:')) faces[id.slice(7)] = mintUrl(blob);
      });
      if (Object.keys(faces).length) setAvatars(faces);
      if (Object.keys(vids).length) setVideos(vids);
    }).catch(() => {});   // a blocked/absent IndexedDB degrades to session-only
    return () => { alive = false; };
  }, [mintUrl]);

  const setAvatar = useCallback((uid, file) => {
    if (!file) return;
    const url = mintUrl(file);
    setAvatars((prev) => {
      dropUrl(prev[uid]);
      return { ...prev, [uid]: url };
    });
    putAsset(avatarKey(uid), file).catch(() => {});
  }, [mintUrl, dropUrl]);

  const clearAvatar = useCallback((uid) => {
    setAvatars((prev) => {
      if (!prev[uid]) return prev;
      dropUrl(prev[uid]);
      const next = { ...prev };
      delete next[uid];
      return next;
    });
    deleteAsset(avatarKey(uid)).catch(() => {});
  }, [dropUrl]);

  // ⚠ A LAYOUT IS AS MANY SOURCES AS IT HAS TILES. A PiP is two (stage +
  // facecam); a four-way co-host is four different people. One clip cannot
  // stand in for several — the same footage in two tiles reads as a mirror,
  // and in four tiles it reads as a bug. Slots are declared in previewAssets.js
  // (VIDEO_SLOTS) so the rail and the renderers agree by construction.
  const setVideo = useCallback((slot, file) => {
    const url = file ? mintUrl(file) : null;
    setVideos((prev) => {
      dropUrl(prev[slot]);
      if (!url) { const next = { ...prev }; delete next[slot]; return next; }
      return { ...prev, [slot]: url };
    });
    if (file) putAsset(videoKey(slot), file).catch(() => {});
    else deleteAsset(videoKey(slot)).catch(() => {});
  }, [mintUrl, dropUrl]);

  // Revoke on unmount so leaving the screen leaks nothing. The FILES stay in
  // IndexedDB; only these tab-scoped pointers go.
  useEffect(() => () => {
    liveUrls.current.forEach((u) => URL.revokeObjectURL(u));
    liveUrls.current.clear();
  }, []);


  const chatIdx = useRef(CHAT_SCRIPT.length > 5 ? 5 : 0);
  const tipIdx = useRef(0);
  const subIdx = useRef(0);
  const joinIdx = useRef(0);

  const pushMessage = useCallback((uid, text, extra = {}) => {
    const c = castByUid(uid);
    setMessages((prev) => {
      const next = [...prev, { ...makeMessage(uid, text, extra), sub: !!c.sub }];
      return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
    });
  }, []);

  // ── Auto moderation ──────────────────────────────────────────────────────
  // ⚠⚠ THE DIAL CHANGES ROUTING, NOT SCANNING, SO IT COSTS NOTHING EXTRA.
  // The relay ALREADY calls Gemini Flash on every message and returns
  // pass | flag | block (infra/chat/src/main.go:9-21). Today a 'flag' fans out
  // and is only logged for Vanguard. All the dial does is decide whether a flag
  // is HELD instead — same one call per message, no second model, no new spend.
  // The two strictest steps add signals that need no AI at all: whether this
  // person has spoken here before, whether the text carries a link, and how old
  // the account is. Every one of those is already on the doc.
  //
  // ⚠ THE SHIPPING DEFAULT IS A FOUNDER CALL. 'standard' here is a simulator
  // default so the queue has something in it to look at. Twitch ships AutoMod
  // OFF. Do not read this line as a policy decision.
  const [autoMod, setAutoMod] = useState('standard');   // off | light | standard | strict
  const [held, setHeld] = useState(HELD_SEED);
  const heldIdx = useRef(0);

  // ⚠ APPROVE PUTS THE MESSAGE IN CHAT. A queue whose Approve button only
  // removes the row proves nothing: the whole promise of holding a message is
  // that approving it releases it, so the simulator has to actually release it.
  const approveHeld = useCallback((id) => {
    setHeld((prev) => {
      const row = prev.find((h) => h.id === id);
      if (row) pushMessage(row.uid, row.text, { held: true });
      return prev.filter((h) => h.id !== id);
    });
  }, [pushMessage]);
  const denyHeld = useCallback((id) => setHeld((prev) => prev.filter((h) => h.id !== id)), []);
  const fireHeld = useCallback(() => {
    const seed = HELD_SEED[heldIdx.current % HELD_SEED.length];
    heldIdx.current += 1;
    setHeld((prev) => [...prev, { ...seed, id: seed.id + ':' + heldIdx.current, at: Date.now() }]);
  }, []);
  const clearHeld = useCallback(() => setHeld([]), []);

  // ── Chat rules ───────────────────────────────────────────────────────────
  // ⚠⚠ THESE LIVED IN `useState` INSIDE ModerationSheet, so switching
  // followers-only on and closing the sheet threw the setting away, and nothing
  // outside that sheet could ever show that chat was restricted. A host who
  // locks chat down and then wonders why it has gone quiet is the failure that
  // makes a moderation control worse than none.
  //
  // ⚠ THE RAIL'S `chatState` IS A DIFFERENT AXIS, NOT A DUPLICATE OF THIS.
  // `chatState` is what THIS viewer experiences (including being muted or
  // banned personally); `chatRules` is what the HOST has switched on. A viewer
  // can be muted while no rule is set, so collapsing them into one value would
  // lose a state. Two sources for one fact is what killed the theme system; two
  // sources for two different facts is correct.
  //
  // ⚠ `verified` AND `subs` HAVE NO SERVER RULE YET. Measured 2026-09-06: the
  // relay honours `followersOnly` and `slowModeSec` and nothing else
  // (infra/chat/src/main.go:713), and functions/streamChatMod.js writes no
  // subscriber or verified field. They are designed here and are NOT claimed to
  // work; the port needs one bool each, beside the two that exist.
  const [chatRules, setChatRules] = useState({ followers: false, subs: false, verified: true, tts: false, slow: 0 });
  const shieldSaved = useRef(null);
  const setChatRule = useCallback((k, v) => setChatRules((prev) => ({ ...prev, [k]: v })), []);

  // ⚠ THE SHIELD ACTUALLY MOVES THE RULES, and putting them back is the whole
  // difference between a panic button and a foot-gun. The previous state is
  // captured on the way up and restored on the way down, so a host's own slow
  // mode survives a raid.
  const raiseShield = useCallback((levers) => {
    setChatRules((prev) => {
      if (!shieldSaved.current) shieldSaved.current = prev;
      return {
        ...prev,
        followers: levers.followersOnly ? true : prev.followers,
        subs: levers.subsOnly ? true : prev.subs,
        slow: levers.slowMode ? 30 : prev.slow,
      };
    });
    if (levers.clearChat) setMessages([]);
  }, []);
  const lowerShield = useCallback(() => {
    setChatRules((prev) => shieldSaved.current || prev);
    shieldSaved.current = null;
  }, []);

  // ── Hype train ───────────────────────────────────────────────────────────
  // A shared support moment: when support lands close together the whole room
  // gets one escalating thing to push on, instead of each tip scrolling past
  // alone. Twitch's version is the reference; this is the mechanic, not a copy
  // of their rewards.
  //
  // ⚠⚠ THE REWARD IS RECOGNITION, AND NOTHING ELSE, UNTIL THE FOUNDER SAYS
  // OTHERWISE. Every currency answer is an economy decision that is not mine:
  // paying COINS mints currency out of a celebration; paying VP inflates the
  // ladder and walks straight into `GIFT_COINS_PER_VP`, whose own comment says
  // coins must not buy rank. So a train currently pays what it costs nothing to
  // pay — the room sees the level, and it names who got it there.
  //
  // ⚠⚠ EVERY NUMBER BELOW IS MINE, NOT THE FOUNDER'S. They are one-line
  // constants precisely so they can be replaced with his once he decides.
  const TRAIN_LEVEL_COINS = 500;      // support needed per level
  const TRAIN_MAX_LEVEL = 5;
  const TRAIN_WINDOW_MS = 300_000;    // 5 min, pushed out by each contribution
  // ⚠ A SUB'S WORTH IS A REAL UNKNOWN, NOT A ROUNDING. A creator sets their own
  // membership price, so what one contributes to a train cannot be derived here.
  // Placeholder, flagged, single use.
  const TRAIN_SUB_COINS = 250;

  const [train, setTrain] = useState(null);   // { level, into, endsAtMs, riders }
  const addTrainSupport = useCallback((uid, coins) => {
    const amount = Math.max(0, Math.floor(Number(coins) || 0));
    if (!amount) return;
    setTrain((prev) => {
      const live = prev && prev.endsAtMs > Date.now() ? prev : null;
      const base = live || { level: 1, into: 0, riders: {} };
      let into = base.into + amount;
      let level = base.level;
      while (into >= TRAIN_LEVEL_COINS && level < TRAIN_MAX_LEVEL) {
        into -= TRAIN_LEVEL_COINS;
        level += 1;
      }
      if (level >= TRAIN_MAX_LEVEL) into = Math.min(into, TRAIN_LEVEL_COINS);
      return {
        level,
        into,
        goal: TRAIN_LEVEL_COINS,
        maxLevel: TRAIN_MAX_LEVEL,
        endsAtMs: Date.now() + TRAIN_WINDOW_MS,
        riders: { ...base.riders, [uid]: (base.riders[uid] || 0) + amount },
      };
    });
  }, []);
  const endTrain = useCallback(() => setTrain(null), []);

  // ── Vertical framing (Dual Format, route C) ──────────────────────────────
  // ⚠⚠ ONE ENCODE. The host publishes 16:9 exactly as today; this is a rect the
  // MOBILE VIEWER applies. Measured on box 1 before choosing this: a real
  // server-side 9:16 transcode runs at 2.89x realtime at free-tier 480p, 1.69x
  // at lite 720p and **0.85x at Pro 1080p** — it cannot keep up with a single
  // Pro stream, on a 2-vCPU box that also runs chat, ingest, the SFU and the
  // PayRam node. Viewer-side framing costs nothing and works identically at
  // every tier.
  //
  // ⚠⚠ NULL IS THE DEFAULT AND MEANS "DO NOT CROP". The founder's standing rule
  // is never crop the broadcaster, letterbox instead. He granted ONE exception
  // (2026-09-06): a crop the host chose and previewed. So an unset frame must
  // behave exactly as before — no silent reframing of anybody's stream.
  //
  // A 9:16 window at full source height is 0.3164 of a 16:9 frame's width, so
  // the host only has two things to choose: where it sits and how far in it
  // zooms. Anything more is a video editor, not a framing control.
  const [vFrame, setVFrame] = useState(null);   // null | { x: 0..1, zoom: 1..2 }
  const clearVFrame = useCallback(() => setVFrame(null), []);
  const setFrameX = useCallback((x) => setVFrame((f) => ({ zoom: 1, ...(f || {}), x: Math.min(1, Math.max(0, x)) })), []);
  const setFrameZoom = useCallback((z) => setVFrame((f) => ({ x: 0.5, ...(f || {}), zoom: Math.min(2, Math.max(1, z)) })), []);
  const subCoinsForTrain = TRAIN_SUB_COINS;

  // ⚠ THE TRAIN EXPIRES ON A CLOCK, so the bar has to re-read time even when no
  // support arrives — otherwise a finished train sits on screen until the next
  // tip. One interval for the whole simulator, not one per surface.
  useEffect(() => {
    if (!train) return undefined;
    const id = setInterval(() => {
      setTrain((t) => (t && t.endsAtMs <= Date.now() ? null : t && { ...t }));
    }, 1000);
    return () => clearInterval(id);
  }, [train]);

  // Rolling chat. Cycles the script rather than stopping, so the feed keeps
  // moving for as long as the screen is open.
  useEffect(() => {
    if (!chatRate) return undefined;
    const id = setInterval(() => {
      const [uid, text] = CHAT_SCRIPT[chatIdx.current % CHAT_SCRIPT.length];
      chatIdx.current += 1;
      pushMessage(uid, text);
    }, chatRate * 1000);
    return () => clearInterval(id);
  }, [chatRate, pushMessage]);

  // ⚠ TAKES AN OPTIONAL AMOUNT so the viewer's own tip sheet can fire a REAL
  // tip. The Send button used to be `onClose` — the sheet dismissed, no drop
  // appeared, no counter moved. `coins` overrides the scripted amount; the
  // sender is still the scripted viewer, because a tip must come from someone
  // and the person watching the preview is not in the cast.
  const fireTip = useCallback((arg = null) => {
    // ⚠⚠ THIS IS PASSED STRAIGHT TO onClick, SO THE FIRST ARGUMENT IS A CLICK
    // EVENT, NOT A NUMBER. Adding a `coins` parameter and trusting it broke the
    // rail's own Tip button instantly: the SyntheticEvent is truthy, so the goal
    // maths did `raised + <event>` and the tip goal rendered **0 / 5,000**.
    // Anything handed to a bare `onClick={fn}` must validate its own argument.
    const coins = Number.isFinite(arg) && arg > 0 ? arg : null;
    const scripted = TIP_SCRIPT[tipIdx.current % TIP_SCRIPT.length];
    const t = coins ? { ...scripted, coins } : scripted;
    tipIdx.current += 1;
    const c = castByUid(t.uid);
    addTrainSupport(t.uid, t.coins);
    setDoc((d) => ({
      ...d,
      // ⚠⚠ `lastGift` IS WHAT THE DESIGNED TIP COMPONENT READS, AND NOTHING
      // EVER WROTE IT. useGiftFeed's own comment says "lastGift (from the admin
      // Fire tip button via the mock doc) pushes a drop" — but Fire tip only
      // ever set `lastTip`, which drives the plain centred pill. So the combo
      // feed the founder designed (avatar, "Sent X", coin, big xN counter, left
      // aligned, TikTok-style) had never fired once, on any surface, and what he
      // saw instead was the generic alert.
      lastGift: { uid: t.uid, name: c.displayName, avatar: c.avatar, qty: t.coins, ts: Date.now() },
      // `lastTip` is kept ONLY because the goal bar and the ledger read it. It
      // no longer drives any on-screen tip UI in the preview.
      lastTip: { coins: t.coins, fromName: c.displayName, ts: Date.now() },
      // A tip also lands in chat as a highlighted row, exactly as it does live.
      goal: d.goal?.active
        ? { ...d.goal, currentCoins: Math.min(d.goal.targetCoins, (d.goal.currentCoins || 0) + t.coins) }
        : d.goal,
    }));
    pushMessage(t.uid, `sent ${t.coins} coins`, { tipCoins: t.coins });
  }, [pushMessage]);

  const fireSub = useCallback(() => {
    const s = SUB_SCRIPT[subIdx.current % SUB_SCRIPT.length];
    subIdx.current += 1;
    const c = castByUid(s.uid);
    addTrainSupport(s.uid, subCoinsForTrain);
    setDoc((d) => ({
      ...d,
      lastSub: { tierName: s.tierName, fromName: c.displayName, badge: s.badge, ts: Date.now() },
    }));
  }, []);

  const fireJoin = useCallback((uid = null) => {
    const target = uid || JOIN_SCRIPT[joinIdx.current % JOIN_SCRIPT.length];
    if (!uid) joinIdx.current += 1;
    setJoinEvents((prev) => {
      const next = [...prev, makeJoinEvent(target)];
      return next.length > MAX_JOINS ? next.slice(next.length - MAX_JOINS) : next;
    });
    setDoc((d) => ({ ...d, viewerCount: (d.viewerCount || 0) + 1 }));
  }, []);


  // ── overlays ────────────────────────────────────────────────────────
  // All four take props and nothing else, so the simulator only has to supply
  // the shape each one reads. No copies: these ARE the shipped components.

  /** StreamPollCard reads poll.question / options / votes / totalVotes / expiresAt. */
  const firePoll = useCallback(() => {
    setDoc((d) => (d.previewPoll ? { ...d, previewPoll: null } : {
      ...d,
      previewPoll: {
        id: nextId(),
        question: 'Which map next?',
        options: ['Dust corridor', 'Skyline', 'Refinery'],
        votes: [41, 27, 12],
        totalVotes: 80,
        expiresAt: Date.now() + 90_000,
      },
    }));
  }, []);

  /** ⚠ THE CARD'S OWN DISMISS NEEDS A REAL HANDLER. StreamPollCard renders its close
   *  button only when onClose is truthy, so passing () => {} draws a control that
   *  swallows the tap — inert theatre on the one surface that gets captured. */
  const dismissPoll = useCallback(() => setDoc((d) => (d.previewPoll ? { ...d, previewPoll: null } : d)), []);

  /** ReactionsFloor reads [{ id, originX? }] and floats one heart per entry. */
  // ⚠ NO originX. ReactionsFloor uses it as a raw CSS `left` value, so the
  // Math.random() fraction this used to pass (0.37) is not a valid length and
  // collapsed every heart to the LEFT EDGE — while the like button that is
  // supposed to be emitting them sits on the right. No real caller passes
  // originX at all; leaving it out gives the component's own default of
  // `calc(100% - 44px)`, directly under the button.
  // ── likes: one per tap, a combo meter, and a burst only when it fills ──
  //
  // ⚠ SIX HEARTS PER TAP WAS WRONG. Founder, 2026-09-01: "i think there are too
  // many hearts showing when the user presses like once, that burst should only
  // show when the user gets to 100 likes or something". He is right and the
  // real viewer already agrees — MobileLiveViewer's sendHeart calls
  // spawnHearts(1). One tap, one heart.
  //
  // ⚠ THE BURST IS THE REWARD FOR FILLING THE METER, which is what makes the
  // meter worth filling. HEART_COMBO_MAX (30) is the existing cap, so the
  // celebration lands exactly when the bar tops out rather than at an arbitrary
  // count nobody can see coming.
  const [combo, setCombo] = useState(0);
  const comboDecay = useRef(0);

  // ⚠⚠ THE ARRAY MUST BE DRAINED, NOT JUST CAPPED, AND THIS IS WHY ONE TAP KEPT
  // PRODUCING A CROWD. `ReactionsFloor` re-maps its ENTIRE `events` array every
  // time the array identity changes — it has no notion of "only the new ones".
  // Production copes because MobileLiveViewer:273 REMOVES each reaction from its
  // own state after 2600ms, so `events` is only ever the live ones. This kept a
  // rolling 40, so the seventh tap re-spawned all seven and the founder saw the
  // same crowd after I had "fixed" the count to one. `slice(-40)` looked like a
  // bound and was actually the bug.
  //
  // Same 2600ms as the real viewer, so the two behave identically.
  const spawnHearts = useCallback((n) => {
    const burst = Array.from({ length: n }, () => ({ id: nextId() }));
    setReactions((prev) => [...prev, ...burst]);
    setTimeout(() => setReactions((prev) => prev.filter((r) => !burst.find((b) => b.id === r.id))), 2600);
  }, []);

  const fireReaction = useCallback((n = 1) => {
    spawnHearts(n);
    setCombo((c) => {
      const next = Math.min(HEART_COMBO_MAX, c + 1);
      // Filling the bar pays out. Fires once, on the tap that reaches the cap.
      if (next === HEART_COMBO_MAX && c < HEART_COMBO_MAX) spawnHearts(14);
      return next;
    });
    // ⚠ THE DECAY IS WHAT MAKES IT A STREAK RATHER THAN A SCORE. Same 1.1s as
    // the real viewer, so the preview and the product behave identically.
    clearTimeout(comboDecay.current);
    comboDecay.current = setTimeout(() => setCombo(0), 1100);
  }, [spawnHearts]);

  useEffect(() => () => clearTimeout(comboDecay.current), []);
  /** BoostTimer reads stream.boosts[] and counts the newest one down. */
  // ⚠ ACCEPTS THE SHIPPED IDS TOO. `src/utils/boosts.js` calls them
  // stream_boost / stream_super / stream_mega, and the viewer's boost tab sends
  // those; the admin rail sends the short forms. Taking both means neither
  // caller has to know about the other's naming.
  const fireBoost = useCallback((tier = 'super') => {
    // Same defence as fireTip: only a real tier id counts, so wiring this to a
    // bare onClick later cannot feed it a SyntheticEvent.
    const raw = typeof tier === 'string' ? tier : 'super';
    const key = raw.replace('stream_', '');
    const T = { boost: [1.5, 15], super: [2.5, 30], mega: [4, 60] }[key] || [1.5, 15];
    setDoc((d) => ({
      ...d,
      boosted: true,
      boosts: [{ tier, reach: T[0], expiresAt: Date.now() + T[1] * 60_000 }],
    }));
  }, []);

  // NOW PLAYING IS DELIBERATELY NOT SIMULATED. Founder, 2026-09-04.
  // `streams/{id}.nowPlaying` is READ in 3 places (MobileLiveViewer:1082,
  // ViewerStreamScreen:929, and here) and WRITTEN BY NOTHING: no callable, no
  // cron, no client writer. NowPlayingCard’s own header cites
  // `functions/spotifyNowPlaying.js` and `functions/spotifyAuth.js`, and NEITHER
  // FILE EXISTS. There is no Creator Studio music section and no music route.
  //
  // So the preview was fabricating a card the product can never populate, which
  // is worse than showing nothing: it puts an unbuilt feature into a store
  // screenshot. Do NOT re-add the simulator for it. If music is built, the
  // writer comes first and this follows it.
  const setGoal = useCallback((patch) => {
    setDoc((d) => ({ ...d, goal: { ...d.goal, ...patch } }));
  }, []);

  const setField = useCallback((patch) => setDoc((d) => ({ ...d, ...patch })), []);

  const resetChat = useCallback(() => {
    chatIdx.current = 0;
    setMessages([]);
  }, []);

  // ⚠ THE ENTRANCE RIBBON READS `ev.user.avatar`, SO AN OVERRIDE HAS TO BE
  // FOLDED IN HERE, NOT AT THE CONSUMER. The events were built when the person
  // joined, which is before the founder uploads their face; resolving at the
  // source means every screen that renders a ribbon gets it with no threading,
  // and a face uploaded mid-session applies to ribbons already on screen.
  // Same at the source for chat, so a surface added later inherits uploaded
  // faces without anyone remembering to thread the map through it.
  const resolvedMessages = useMemo(
    () => messages.map((m) => (avatars[m.uid] ? { ...m, avatar: avatars[m.uid] } : m)),
    [messages, avatars],
  );

  const resolvedJoins = useMemo(
    () => joinEvents.map((ev) => (avatars[ev.user?.uid]
      ? { ...ev, user: { ...ev.user, avatar: avatars[ev.user.uid] } }
      : ev)),
    [joinEvents, avatars],
  );

  return {
    goalBox, setGoalBox, goalEdit, setGoalEdit,
    doc, messages: resolvedMessages, joinEvents: resolvedJoins, openSheet, chatRate, reactions,
    chatHidden, setChatHidden, subscribed, setSubscribed,
    onToggleChat: () => setChatHidden((v) => !v),
    combo, comboMax: HEART_COMBO_MAX,
    avatars, videos, setAvatar, clearAvatar, setVideo,
    // Derived aliases: the two roles that existing call sites name directly.
    sceneVideo: videos.stage || null, facecamVideo: videos.facecam || null,
    setOpenSheet, setChatRate, setGoal, setField,
    fireTip, fireSub, fireJoin, pushMessage, resetChat,
    playback, setPlayback, chatState, setChatState, gate, setGate,
    vod, setVod,
    tts, setTts,
    health, setHealth,
    balance, setBalance,
    watchMinutes, setWatchMinutes,
    levelUp, setLevelUp,
    audioOnly, setAudioOnly,
    clipWho, setClipWho,
    chatChannel, setChatChannel, modMessages, dismissPoll,
    raiding, setRaiding,
    autoMod, setAutoMod, held, approveHeld, denyHeld, fireHeld, clearHeld,
    train, addTrainSupport, endTrain,
    vFrame, setVFrame, clearVFrame, setFrameX, setFrameZoom,
    chatRules, setChatRule, raiseShield, lowerShield,
    firePoll, fireReaction, fireBoost,
  };
}
