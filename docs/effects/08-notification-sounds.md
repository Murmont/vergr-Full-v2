# 08 — Custom notification sounds

**STATUS: NOT BUILT — AND NO LONGER AN UNLOCK. Founder, 2026-08-26:**
*"notification sounds won't cost us anything, it should be default for all
users."* Free for everyone, **no ladder row**; the Veteran LV1 slot is released.

⚠ STILL GATED ON AN APK. Nothing here can ship as a web deploy: an Android
notification sound is a property of a NotificationChannel and the audio must be
a bundled raw resource (§1). Free-for-all changes who gets it, not how it ships. Rules: [00-RULES.md](00-RULES.md)

---

## 1. Research

Sources: [Pushwoosh — Custom notification sound for Android 8+](https://help.pushwoosh.com/hc/en-us/articles/360020246811-Custom-notification-sound-for-Android-8-devices),
[EMBP — Custom push sound with FCM](https://embusinessproducts.com/how-to-add-a-custom-push-notification-sound-on-ios-and-android-with-react-native-firebase-and-fcm)

The idea as proposed was "a high-tier user's DMs arrive with their own sound".
Two platform facts change what is actually buildable.

### ⚠ Fact 1: on Android 8+, sound belongs to a CHANNEL, not to the payload

From Android 8 (API 26) a notification sound is a property of the
**NotificationChannel**, not of the message. To play a given sound you must:

1. create a channel for that sound **inside the app**, and
2. set `android_channel_id` on the FCM payload (FCM delivers it as
   `channel_id`).

⚠ **A channel's sound cannot be changed after the channel is created.** Changing
it requires deleting and recreating the channel, which resets any user
customisation on it. So the sound set is effectively immutable per install.

### ⚠ Fact 2: the audio must be bundled in the APK

The sound is referenced as a raw resource. A file downloaded at runtime cannot
be used as a channel sound. **Therefore the set of sounds is fixed at build
time.**

### What this means for the ladder

| Proposed | Buildable |
|---|---|
| A user uploads their own notification sound | **No.** Runtime files cannot be channel sounds. |
| A user picks from a shipped set | **Yes.** One pre-created channel per shipped sound. |

The ladder copy must say "choose your notification sound", never "upload".

Also note this makes the feature **N channels in the app's notification
settings** — the user's own Android settings screen will list every sound
channel Vergr creates. Keep N small (3–4), or the app's notification settings
become unusable.

## 2. Surfaces

| Concern | File |
|---|---|
| Channel creation | `android/` — Kotlin app init (alongside the existing default channel) |
| Push send | `functions/index.js` — `sendPushToUser` and the `onNotificationCreated` fan-out |
| Sound choice storage | `users/{uid}.cosmetics.notifSound` |
| Picker UI | settings, plus the effects panel |

⚠ **`sendPushToUser` is the single choke point** for every push in the app
(`functions/index.js`). Adding `android_channel_id` there covers DMs and every
allowlisted notification type at once. Verify the allowlist
(`PUSHABLE_NOTIFICATION_TYPES`) while touching it.

⚠ **iOS uses a different mechanism** (`sound` in the APNs payload, file bundled
in the app). Vergr's native shell is Android-only today (Tauri), so this is
Android-only until an iOS build exists. Do not write cross-platform copy.

## 3. Implementation

1. Ship 3–4 sounds as raw resources in the Android project. Short (< 2s) — a
   notification sound longer than that is truncated by the OS anyway.
2. Create one channel per sound at app start, with stable ids
   (`vergr_dm_default`, `vergr_dm_chime`, …). ⚠ Ids must never be reused for a
   different sound, because existing installs keep the old channel.
3. The SENDER's chosen sound determines the channel on the payload, so the
   recipient hears who it is. This is the point of the feature.
4. `sendPushToUser` looks up the sender's `cosmetics.notifSound` and sets
   `android_channel_id`. ⚠ That is an extra Firestore read per push unless the
   sender's doc is already loaded — check the call sites and pass it through
   rather than re-reading (R9's spirit applies to pushes too).

## 4. Verification

- On a real device (an emulator's notification sound behaviour is unreliable):
  send from a user with each sound and confirm the correct one plays.
- Assert the app's Android notification settings list exactly the intended
  channels and no orphans from a previous build.
- Assert a push from a user with no choice falls back to the default channel and
  still arrives.
- ⚠ Assert no additional Firestore read was introduced per push.

## 5. Scheduling

This needs an **APK release**; it cannot ship as a web deploy. Batch it with the
next native build ([[feedback-batch-native-work]] — one build, not several).
