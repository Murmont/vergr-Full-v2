# 05 — Voice-note modulators

**STATUS: NOT BUILT — AND NO LONGER AN UNLOCK. Founder, 2026-08-26:**
*"I am not sure that a voice modulator is something a user should need to
unlock, it should be default."* So this ships FREE FOR EVERYONE and gets **no
ladder row**. The Champion LV1 slot it was penciled into is released.

⚠ It never had a row in `RANK_UNLOCKS` anyway, so nothing is being removed —
this only settles that none should be added.

⚠ The §2 pitch-shift decision is STILL OPEN and still gates the copy: with no
pitch-shift node in Web Audio, either ship radio/echo/muffled and call them
"voice filters", or take on a granular shifter. Do not write "pitch" until then. Rules: [00-RULES.md](00-RULES.md)

---

## 1. Research

Source: [MDN — Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API),
[Pitch shifting](https://en.wikipedia.org/wiki/Pitch_shifting)

The effect is applied to the microphone stream **before encoding**, so it is
baked into the uploaded file. Every recipient hears it with no client support,
on any platform, forever — including someone downloading the file. Applying it
at playback instead would need every player on every platform to implement it.

```
getUserMedia({audio:true})
  -> MediaStreamAudioSourceNode
  -> [effect chain]
  -> MediaStreamAudioDestinationNode
  -> MediaRecorder(dest.stream) -> existing upload path
```

### Effects with a native node — trivial

| Effect | Node | Settings |
|---|---|---|
| Radio / telephone | `BiquadFilterNode` | `type:'bandpass'`, `frequency: 1800`, `Q: 1.4` |
| Echo | `DelayNode` + `GainNode` feedback loop | `delayTime: 0.18–0.26`, feedback gain **< 1.0** |
| Muffled | `BiquadFilterNode` | `type:'lowpass'`, `frequency: 900` |

⚠ The echo feedback gain must be **strictly below 1.0**. At exactly 1.0 the
delay line never decays and the recording runs until the buffer is exhausted.

### 2. ⚠ THE DECISION: there is NO pitch-shift node

The Web Audio API has no pitch shifter. The frequency ratio is
`2^(semitones/12)`, but *applying* it requires one of:

| Approach | Cost | Problem |
|---|---|---|
| `playbackRate` on a buffer | free | changes speed AND pitch together — a chipmunk that also talks fast |
| Resampling | small | same duration problem |
| Phase vocoder / granular | real work, a dependency or ~150 lines | the only one that preserves duration |

**Decide before promising "pitch shift" in the ladder copy:**

- **(a)** Ship radio / echo / muffled only. All native nodes, no dependency,
  buildable in an afternoon. The ladder row reads "voice filters".
- **(b)** Add a granular pitch shifter. Real work and a maintenance surface.

This document does not assume either. Do not write "pitch" into user-facing
copy until it is chosen.

## 3. Surfaces

### 3.1 Recording — must apply the chain

⚠ **THE FIRST VERSION OF THIS TABLE WAS WRONG IN THREE WAYS. Re-verified
against source 2026-08-27; the corrected inventory is below.** It named
CreateComposer, which does not record audio at all; it declared squad chat had no
recorder, which stopped being true; and it listed three surfaces as three code
paths when two of them share one function. Building from the old table would have
shipped a modulator that skipped squad chat and edited a file with no recorder in
it — the avatar-orbit failure exactly.

**Three user-facing surfaces, TWO code paths:**

| Surface | Recorder | Path |
|---|---|---|
| DM voice note | `startVoiceRecording()` | `src/utils/mediaHelpers.js:10` |
| **Squad chat voice note** | `startVoiceRecording()` | same function (`SquadChatThreadScreen.jsx:766`) |
| Profile name clip | its own `getUserMedia` | `src/screens/profile/EditProfileScreen.jsx:573` |

✅ `mediaHelpers.startVoiceRecording()` is a genuine choke point: patching it
covers DM **and** squad chat at once. It already builds an `AudioContext` and a
`MediaStreamAudioSourceNode` for the waveform analyser (`mediaHelpers.js:26-31`),
so the chain has a context and a source node in hand already and must REUSE them
rather than opening a second context on the same stream.

❌ **`CreateComposer.jsx` records no audio.** Its only `MediaRecorder` hit is a
comment about R2 content types (line 894). It is NOT a surface for this effect.

❌ **`AppPermissionsScreen.jsx:72`** calls `getUserMedia({audio:true})` to probe the
permission. It records nothing and must not be touched.

Verified with `grep -rln "MediaRecorder" src` plus a read of every hit, not with a
name grep alone — a name grep is what produced the wrong table.

### 3.2 Playback — NO change required

`src/components/media/InlineAudioPlayer.jsx` and every other player are
untouched, because the effect is already in the file. This is the whole reason
for encoding-time application.

### 3.3 Related, do NOT modify

`src/utils/mediaCompression.js`, `src/utils/nativeTranscode.js`,
`src/utils/r2Storage.js` — the chain sits upstream of all of them and they need
no awareness of it.

## 4. Implementation

1. `src/components/effects/audio/VoiceModulator.js` — a pure function
   `buildChain(ctx, source, effectId) -> AudioNode`, no React, no level check.
2. The TWO recording paths route through it when an effect is selected.
   ⚠ **No `isEffectOn` gate and no level check.** The founder made this free for
   everyone (see the header), so there is no `voice_fx` effect id to check and
   none should be added. The only condition is "the user picked one".
3. ⚠ **`AudioContext` must be created inside the user gesture** that starts
   recording, and closed when recording stops. A leaked context holds the
   microphone and the audio hardware open.
4. Preview before send: the user must hear the effect before committing, or
   they will send a ruined message. The preview reuses the same chain on the
   recorded blob.

## 5. Verification

- Record 2 seconds through each chain, decode the result, and assert the
  spectrum changed in the expected direction: bandpass = energy outside
  1.8kHz ± Q is attenuated; echo = autocorrelation peak at the delay time.
  Numeric, not "it sounds different".
- Assert `AudioContext.state === 'closed'` after recording stops, on all three
  surfaces.
- Assert the uploaded file plays correctly in `InlineAudioPlayer` with no client
  changes — that is the proof the effect is baked in.
