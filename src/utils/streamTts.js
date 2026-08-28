// Text-to-speech on a stream. Effect 13. Doc: docs/effects/13-tts-on-stream.md
//
// ⚠ THE AUDIO PLAYS ON EVERY VIEWER'S OWN MACHINE, NOT THE STREAMER'S.
// The doc's original design had the streamer's browser speak, relying on their
// capture to pick it up. Researched 2026-08-26 and that is inaudible BY
// CONSTRUCTION for camera-only browser broadcasters: `BroadcasterScreen.jsx`
// captures the mic only and sets `echoCancellation: true`, which actively
// strips speaker output. And it cannot be fixed by routing speech into the
// broadcast audio graph, because `speechSynthesis` output is not exposed as a
// MediaStreamTrack or Web Audio node at all — an open spec gap
// (WICG/speech-api#69, WebAudio/web-audio-api#1764).
//
// So each viewer speaks it locally. Same zero cost, works identically for every
// capture setup. Trade-off, stated plainly: it is NOT in the VOD and NOT on a
// Twitch mirror, because it never enters the video stream.
import { isUnlocked } from './rankUnlocks';

/** Ladder id, mirrored in rankUnlocks.js and firestore.rules. */
export const TTS_UNLOCK_ID = 'tts_stream';

/**
 * Level OR Pro. Founder, 2026-08-26: "both, can be unlocked or by subscribing
 * to pro". No coin charge — the two gates are the price.
 *
 * ⚠ Deliberately the same shape as `canUseChatThemes()`, including the
 * two-shape subscription read. `resolveTier` is the canonical reader and this
 * mirrors the one comparison chatThemes.js settled on; do not "simplify" it to
 * a single field, the client historically wrote three.
 */
export const canUseStreamTts = (profile) => {
  if (!profile) return false;
  if (profile.role === 'admin') return true;
  const level = Number(profile.vpLevel) || 1;
  if (isUnlocked(TTS_UNLOCK_ID, level)) return true;
  return profile.subscription === 'pro' || profile.subscription?.tier === 'pro';
};

/** Hard cap on one spoken message. Mirrored server-side — the client cap is UX. */
export const TTS_MAX_CHARS = 200;

/**
 * ⚠ WEB SPEECH IS AUTOPLAY-GATED AND FAILS SILENTLY.
 * Measured on the live site 2026-08-26: `speak()` with no prior user gesture
 * fires `error: not-allowed` and produces no sound, with nothing visible to the
 * user. ONE real gesture unlocks it for the rest of the session — the same
 * bargain as audio autoplay.
 *
 * A stream viewer has almost certainly gestured already (stream audio is
 * autoplay-gated too), but "almost certainly" is how ProfileAudio shipped a
 * double-play bug. Arm it explicitly.
 */
let armed = false;
export const ttsArmed = () => armed;

/** Call from any real user gesture. Cheap, idempotent, silent. */
export function armStreamTts() {
  if (armed || typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    // A zero-volume empty-ish utterance consumes the gesture without noise.
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
    armed = true;
  } catch { /* not available; speak() will report it */ }
}

/**
 * ⚠ `getVoices()` IS ASYNC ON A COLD PROFILE. It commonly returns [] until the
 * `voiceschanged` event fires. Measured 25 voices immediately on a warm profile,
 * which is exactly how this bug hides in testing. Anything picking a voice must
 * wait for the event or it silently gets the default.
 */
export function voicesReady() {
  const s = typeof window !== 'undefined' && window.speechSynthesis;
  if (!s) return Promise.resolve([]);
  const have = s.getVoices();
  if (have.length) return Promise.resolve(have);
  return new Promise((res) => {
    let done = false;
    const finish = () => { if (!done) { done = true; res(s.getVoices()); } };
    s.addEventListener('voiceschanged', finish, { once: true });
    // Never hang: some engines never fire it, and the default voice is fine.
    setTimeout(finish, 2000);
  });
}

/**
 * Pick a stable voice for the viewer's locale, or null for the engine default.
 * ⚠ The voice list differs per OS, per browser and per install, so the ladder
 * copy promises AN EFFECT and never a named voice (doc §2).
 */
export function pickVoice(voices, lang = 'en') {
  if (!voices || !voices.length) return null;
  const want = String(lang || 'en').toLowerCase().slice(0, 2);
  const matches = (v) => v.lang?.toLowerCase().startsWith(want);

  // ⚠ PREFER A NETWORK VOICE (`localService === false`). This is the whole
  // difference between "sounds very robot" (founder, 2026-08-26, hearing it for
  // the first time) and something you would actually put on a broadcast.
  //
  // Measured on the test machine: 25 voices, of which the DEFAULT was
  // "Microsoft David" — a SAPI5 voice from the Windows XP era, and unmistakably
  // robotic. Sitting right beside it were 19 Google voices (Google US English,
  // Google UK English Female/Male, …), all `localService: false`, which are
  // synthesised server-side and sound close to natural.
  //
  // The old order here preferred `v.default`, which picked David every time.
  // Preferring remote first is the entire fix.
  //
  // ⚠ Remote voices need the network. If one is unavailable the utterance fires
  // `error` and the queue advances (see createTtsQueue), so the fallback chain
  // below still matters — it is not decoration.
  return voices.find((v) => matches(v) && v.localService === false)
      || voices.find((v) => v.localService === false && v.lang?.toLowerCase().startsWith('en'))
      || voices.find((v) => matches(v) && v.default)
      || voices.find(matches)
      || voices.find((v) => v.default)
      || voices[0];
}

/**
 * A speaking queue.
 *
 * ⚠ `speechSynthesis` HAPPILY OVERLAPS UTTERANCES and the result is
 * unintelligible (doc §4.4). One at a time, always.
 *
 * ⚠ AND IT MUST DROP UNDER FLOOD. A busy stream can out-produce speech, which
 * runs in real time — an unbounded queue would fall further behind for the
 * whole broadcast and read out messages from minutes ago. Oldest goes first.
 */
export function createTtsQueue({ maxQueued = 4, onState } = {}) {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  let queue = [];
  let speaking = false;
  let muted = false;
  let voice = null;
  // ⚠ SET WHEN AN UTTERANCE IS REFUSED FOR WANT OF A GESTURE.
  // Found live 2026-08-26: the arming listener is attached when the chat panel
  // MOUNTS, so a click the viewer made before that — which on a stream page is
  // most of them, since they click to open or unmute the player — arms nothing.
  // The first spoken message then fails `not-allowed` and is dropped in total
  // silence, with no way for the viewer to know they missed anything.
  // The UI surfaces this as a one-tap prompt instead.
  let needsGesture = false;

  const emit = () => onState?.({ speaking, queued: queue.length, muted, needsGesture });

  const next = () => {
    if (!synth || speaking || muted || !queue.length) return;
    const item = queue.shift();
    const u = new SpeechSynthesisUtterance(String(item.text).slice(0, TTS_MAX_CHARS));
    if (voice) u.voice = voice;
    u.rate = 1.0;
    u.volume = 1.0;
    speaking = true;
    emit();
    const done = () => { speaking = false; emit(); next(); };
    u.addEventListener('end', () => { needsGesture = false; done(); }, { once: true });
    // ⚠ An `error` MUST advance the queue too. `not-allowed` on an unarmed
    // page would otherwise wedge it closed for the whole session.
    u.addEventListener('error', (e) => {
      // `not-allowed` is not a failure of the message, it is a missing gesture.
      // Flag it so the UI can offer one tap, and PUT THE MESSAGE BACK so it is
      // heard rather than lost — the viewer never chose to miss it.
      if (e?.error === 'not-allowed') {
        needsGesture = true;
        if (queue.length < maxQueued) queue.unshift(item);
      }
      done();
    }, { once: true });
    try { synth.speak(u); } catch { done(); }
  };

  return {
    async init(lang) { voice = pickVoice(await voicesReady(), lang); },
    push(text) {
      if (!synth || muted || !text) return;
      queue.push({ text });
      if (queue.length > maxQueued) queue = queue.slice(-maxQueued);
      emit();
      next();
    },
    /** Per-viewer mute. ⚠ MANDATORY, not polish: this is a stranger's words in
     *  the viewer's ears, and they must be able to stop it instantly. */
    setMuted(v) {
      muted = !!v;
      if (muted) { queue = []; try { synth?.cancel(); } catch { /* noop */ } speaking = false; }
      emit();
      return muted;
    },
    isMuted: () => muted,
    needsGesture: () => needsGesture,
    /** Call from a real gesture: arms speech and drains anything held back. */
    armAndResume() {
      armStreamTts();
      needsGesture = false;
      emit();
      next();
    },
    stop() { queue = []; try { synth?.cancel(); } catch { /* noop */ } speaking = false; emit(); },
  };
}
