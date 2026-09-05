# Before the next APK and desktop build

Written 2026-09-04, after the live-stream port. Everything below was checked against
the machine and the live site, not from memory.

---

## 1. BLOCKERS. Do these or the build is wrong.

### 1.1 Commit the untracked files. THIS IS THE BIGGEST RISK.

**56 files are untracked, and one of them is `scripts/stream-preview-check.mjs`.**

That script is invoked by `prebuild`, so it runs on every `npm run build`. A
`git checkout`, `git reset` or `git clean` deletes it and **the build fails
outright**, which at least fails loudly. The quieter danger is the rest of the
untracked set: `src/components/streams/states/`, `GiftSubSheet.jsx`,
`coin-ladder-check.mjs`, `audit-harness.js`.

CLAUDE.md already records this exact class of loss: the four
`src-tauri/tauri.*.conf.json` files were untracked, a `git checkout` removed them,
and the next APK **built, installed and ran** as a web-mode app with every native
screen compiled out. It cost a release and a day.

Those four config files are tracked now (verified). The new work is not.

**Committing is a founder call, so it has not been done.**

### 1.2 Bump the version. 1.0.205 is already live.

`https://vergr.app/version.json` returns `androidVersionCode 205`, so 205 is
published and the next build must be **206**.

Three fields move together or the app lies about itself:

| File | Field | Now |
|---|---|---|
| `src-tauri/tauri.conf.json` | `version` | 1.0.205 |
| `src/utils/appVersion.js` | `APP_VERSION` | 1.0.205 |
| `src/utils/appVersion.js` | `APP_VERSION_CODE` | 205 |
| `public/version.json` | `androidVersion` + `androidVersionCode` | 1.0.205 / 205 |

`src-tauri/Cargo.toml` stays at 1.0.1 deliberately: touching it invalidates the
whole Rust cache.

### 1.3 Rewrite the release notes. They describe a different release.

`public/version.json` `notes` currently opens *"Every level from 1 to 100 now gives
you something..."* which is the VP-ladder release. CLAUDE.md already flags that
those notes must be rewritten before the next APK. They are shown in the app.

---

## 2. What is NOT a blocker, but is genuinely unfinished

| Item | State |
|---|---|
| Native broadcast-health card | The web broadcaster has it; the native one has **no `netWarn` state at all**, so there is no signal to drive it. Building that signal is real work, not a port. |
| Go Live structural restyle | Copy and the white washes are fixed on both files. The visual pass is not started. |
| `hostdropped` playback state | Needs a server signal that does not exist. |
| Peak viewers on the ended card | `peakViewers` is only maintained for **Twitch-mirror** streams (`twitchMirror.js:138`); a native stream initialises it to 0 and nothing raises it, so it would read 0 forever. |
| Gift-a-sub bulk | The callable accepts up to 25 recipients; the sheet gifts to one. Bulk is a multi-select, a UI addition only. |

---

## 3. Build sequence

Verified against `package.json`.

### Android

```
npm run android:build          # tauri android build --target aarch64
node scripts/publish-apk.mjs   # refuses a bad artifact, do not bypass
```

`publish-apk.mjs` reads the finished APK and **refuses to publish** if:
- the ABI list is anything but `arm64-v8a` (escape hatch: `--allow-multi-abi`)
- `assets/tauri.conf.json` inside the APK has `assetProtocol` off
- the embedded bundle still carries pruned assets, which proves a web-mode build

Those guards exist because all three of those shipped to the founder's phone once
and none of them failed loudly. Do not weaken them.

⚠ `ANDROID_HOME` is **unset in this shell**. The SDK is at `C:\Android\sdk`.

### Desktop

```
npm run desktop:dist           # tauri build, regenerate latest.json, then vite build
```

The trailing `vite build` matters: see below.

### ⚠⚠ AFTER EITHER NATIVE BUILD, REBUILD THE WEB BUNDLE BEFORE DEPLOYING HOSTING

`build:android` and `build:android:store` run `vite build --mode native` and
overwrite `dist/` with the **native-mode** bundle. Deploying that to hosting serves
the app bundle as the website. `npm run build` first, every time.

---

## 4. What can actually be tested, and what needs a live stream

Most of the port cannot be exercised without going live. Being honest about which
is which saves a wasted test pass.

**Testable now, no stream:**
- `/go-live` on web and native: the audio-only toggle and the who-can-clip picker
- `/admin/stream-preview`: every state, transient, sheet and layout
- The Go Live copy fixes (17 em dashes) and the solid-fill pass

**Needs a live broadcast:**
- Audio-only actually rendering the audio stage for a viewer
- The clip policy rejecting a non-follower or non-subscriber
- The chat-state banner and the composer lock (needs the relay to reject a send)
- The offline state (go live, then drop the viewer's wifi)
- Zero-viewer state (it shows for the first minutes of any real stream)
- The movable tip goal on a real broadcast

**Needs a second account:**
- Gift a sub (a creator with tiers, and a viewer to receive it)
- The appeal path (requires being timed out by a moderator)

---

## 5. Guard state

`npm run check` is **1306 assertions** and runs as `prebuild`, so a regression in
any of it stops the build. Every rule added during the port was negative-tested in
both directions.
