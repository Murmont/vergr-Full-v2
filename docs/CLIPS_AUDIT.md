# Clips / Shorts immersive player — audit (2026-09-13)

Founder: *"run an audit of clips all ui, it needs to be on the level of tiktok and not okay ... the
majority of users will be scrolling here the most so it needs to be perfect ... research, then plan,
then write code, then use the emulator to check"*, and *"when i said research i meant what other
platforms do and the quality bar"*.

Scope: `/shorts` (web + native) and `/clip/:postId` (what the feed tile, the Clips shelf and Explore
open), the rail, caption, gestures, progress, comments entry, menu, loader.

---

## 1. Research: the quality bar (what TikTok, Reels and YouTube Shorts do)

The three have converged on one interaction model. Each line below is sourced.

| Behaviour | TikTok | Instagram Reels | YouTube Shorts |
|---|---|---|---|
| Swipe up/down pages full-screen video | yes | yes | yes |
| Tap pauses | yes | yes | yes ("click directly on it") |
| Double-tap likes, heart on the video | yes | yes | yes (heart icon since June 2026) |
| **Hold an edge = 2x speed** | yes | yes, since March 2025 | yes, since June 2026 |
| Hold the middle = options menu | yes (Not interested, Clear mode, ...) | | |
| Right rail: avatar + follow, like, comment, save, share | yes | yes | yes |
| Secondary actions in a ⋯ menu | share sheet / long-press | ⋯ | ⋯ (Save, Download, Report moved there, 2026) |
| **Clear screen mode** (hide all overlays) | yes | | yes, June 2026 |
| Dedicated mute control | | | yes, 2026 |
| Progress line → scrubber with dot + timecode | yes (thin line thickens on touch) | on some reels | yes |
| "Not interested" | yes | yes | yes |

Overlay footprint on a 1080x1920 frame (creator safe-zone guides): about **130px top**, **140px right**
for the action rail, and **250-484px bottom** for caption, audio and progress (Reels ~500, Shorts ~320).

YouTube's stated reason for its 2026 Shorts simplification: on-screen icons had come to feel
*"less like interface affordances and more like splotches on your windshield"*. That is the same
judgement as this repo's no-fake-glass rule.

Sources: [ppc.land, YouTube Shorts changes (3 Jul 2026)](https://ppc.land/youtube-kills-shorts-dislike-button-adds-2x-speed-and-mute-today/),
[Chrome Unboxed, Shorts makeover (26 Jun 2026)](https://chromeunboxed.com/youtube-shorts-makeover-adds-2x-speed-and-a-clear-screen-mode-but-removes-the-dislike-button/),
[iDownloadBlog, Reels hold-to-skip (28 Mar 2025)](https://www.idownloadblog.com/2025/03/28/instagram-reels-skip-ahead-announcement/),
[MacRumors, Reels fast-forward](https://www.macrumors.com/2025/03/28/instagram-new-fast-forward-feature/),
[iDownloadBlog, TikTok scrubbing](https://www.idownloadblog.com/2021/07/14/tiktok-fast-forward-backward-video-navigation-tutorial/),
[TechCrunch, TikTok scrub thumbnails](https://techcrunch.com/2023/01/05/tiktok-video-scrubbing-thumbnails-find-specific-parts-of-videos),
[Adweek, TikTok Clear Mode](https://www.adweek.com/media/tiktok-how-to-use-clear-mode/),
[TikTok Newsroom, limiting unwanted content](https://newsroom.tiktok.com/en-us/limiting-unwanted-content),
[YouTube Help, Watch Shorts](https://support.google.com/youtube/answer/12319243),
[9to5Google, YouTube player redesign (Oct 2025)](https://9to5google.com/2025/10/14/youtube-video-player-redesign-more/),
[Kreatli safe-zone hub](https://kreatli.com/guides/safe-zone-guide),
[Syllaby, safe zones](https://syllaby.io/blog/aspect-ratios-safe-zones-shorts-reels-tiktok/).

---

## 2. Findings (before the change)

### Technical
- **Two players.** `/clip/:postId` (`ClipViewerScreen`) was a separate copy of `ShortsDeck` with a flick
  detector (no drag-follow), no progress bar, no mute, no double-tap like, no preloading.
- **`/clip` could play the wrong clip.** If the opened clip was older than the newest 30, it played
  index 0 instead.
- **30 sequential author reads** before `/clip` showed anything (`await getUser` inside a loop).
- **Live slides shifted the clip under the thumb.** They load after the clips paint and are
  interleaved at index 2, 6, 10..., so every index from 2 onward moved by one mid-watch.
- **Double-tap toggled pause twice** (the video's own click handler fired on both taps).
- **"Not interested" could not work here**: the shorts query is date-ordered, not ranked, so a
  negative signal changed nothing on this surface.
- **The rail avatar showed a masked Vanguard persona's real face** (the name was masked, the image was not).
- **`pb-8` + `.safe-bottom` / `pt-4` + `.safe-top` on the same elements**: two rules for one padding,
  one of them silently lost.

### Cosmetic
- Translucent discs behind every rail icon, the back/mute/create buttons, the 2x pill, the paused
  glyph, the counter pill and the embed spinner (fake glass, banned).
- A "3 / 12" counter pill (no platform shows one).
- Double-tap heart always dead centre; a separate hashtag row duplicated tags already in the caption.
- A bouncing scroll-hint arrow on every open, forever.
- Landscape clips sat in black bands (letterboxing is correct policy, the empty bands were not).

### UI/UX
- No follow control on the clip.
- No Report, no "Not interested", no Copy link from the clip itself.
- Captions could not expand.
- No scrubbing and no buffering signal: a stall looked like a frozen app.
- Hold anywhere = 2x, so there was no way to open options by holding.
- Icon-only top-bar buttons had no accessible name.

---

## 3. What changed (source)

| Area | Now |
|---|---|
| One player | `/clip/:postId` renders `ShortsDeck` opened on that clip. `useShortsFeed` is the one loader for `/shorts` (web + native) and `/clip`. |
| Loader | authors fetched once per distinct author in parallel; deep link fetched by id if not in page 1, otherwise an honest "This clip isn't available" screen; the clip on screen stays on screen when live slides arrive; muted authors filtered. |
| Gestures | single tap waits 260ms (so double-tap never pauses); double-tap heart at the tap point with repeats; hold outer 28% = 2x; hold middle = menu. |
| Rail | bare filled icons with shadows and counts; avatar with a solid follow badge that follows in one tap (reads the cached follow list, hidden when that list is not loaded). |
| Caption | display name + time, two-line clamp with more/less only when it overflows, hashtags bold inline. |
| Progress | 2px line at the bottom inset; under the finger it grows to 6px with a dot and a large timecode, rail and caption fade out; buffering sweep after 450ms of stall. |
| Menu | ⋯ or hold: Not interested (hides that creator here, device-local), Clear screen, Copy link, Report (same reasons as PostCard). Proper dialog: focus in, focus restored, Escape. |
| Clear screen | hides every overlay except the timeline; a solid "Show" chip brings them back; persists for the session. |
| Letterbox | the clip's own colours fill the bands (10x6 sample, heavily blurred); never cropped. |
| Chrome | no translucent control backgrounds; solid chips for 2x / refreshing / hint; first-run-only "Swipe up for more"; explicit safe-area values everywhere; accessible names on every control. |
| Guard | `scripts/clips-check.mjs`, 12 checks, in `npm run check`; `--self-test` proves each check fails on its fault (12/12). |

**Cost:** no new reads, writes or services. Follow uses `followingCache`; "Not interested" uses
`feedPrefs` (localStorage plus the existing debounced own-doc sync PostCard already triggers). The
`/clip` open now does FEWER reads (deduped authors).

---

## 4. Verification on the emulator

Release-signed APK (native entry `index-8IpvhRq6.js`, proven inside the arm64 `.so`) on the
`vergr_pixel` AVD, signed in, viewport 412x915 @2.625. Everything below was measured over CDP or seen
in an `adb screencap`, not read off the diff.

### Passed on the device

| Check | Measured |
|---|---|
| All 9 controls present (Back, Mute, More, Create, avatar, Like, Comments, Save, Share) | yes, each is the top element at its own centre |
| Tap targets | top bar 44x44, rail 56x64, avatar 48x57 |
| No translucent control backgrounds | 0 found on /shorts (the same probe on Home DID find some, see open items: the control worked) |
| Clears the status bar | top bar y=55 against a 49px inset |
| Clears the gesture bar | timeline 24px, rail 58px above the bottom against a 24px inset |
| Landscape clip never cropped | `object-fit: contain`, 412x232, bands filled with its own colours |
| Counts render | `0` under every rail button |
| Tap pauses / second tap resumes | yes, play glyph shown |
| Hold left edge = 2x | `playbackRate` 2 + "2x speed" chip, back to 1 on release |
| Hold middle = menu | "Clip options" dialog; release did not close it or pause |
| Scrub | "0:08 / 0:15" timecode, rail and caption faded to 0, video seeked 2.5s → 8.9s → 11.5s |
| Clear screen / Show | rail hidden with a solid Show chip, restored on tap |
| Comments | sheet over the clip, empty state, composer |
| Mute | `video.muted` flips |
| Swipe up / down | clip changes and returns |
| Own clip | menu hides Not interested and Report; no follow badge on your own avatar |
| Upload fix from 2026-09-12 | the portrait test clip posted through the gallery plays with its media and caption, hashtags bold inline |

### Defects the device found (fixed in source, guarded, self-tested)

1. **A sideways drag across the video ended as a tap and paused it.** Fixed with a `moved` flag.
2. **A real Android long press fires no click, so the swallow flag it armed ate the first tap inside
   the menu it opened** (Cancel did nothing). The reset now runs before the overlay early-return.
3. **Hold threshold 380ms** sat inside the range of an ordinary slow tap. Now 450ms, matching
   Android's own 400-500ms long-press timeout.

`scripts/clips-check.mjs` 14/14, `--self-test` 14/14.

### NOT verified, stated plainly

- **The three fixes above are NOT re-verified on a device.** The rebuilt APK carrying them
  (`index-Cq5i0bLo.js`, proven in the `.so`) installed, but the emulator was killed by host memory four
  times (7.9 GB host, about 1.9 GB free with Claude using ~1 GB), once before the app even launched,
  including with `-memory 1280 -no-snapshot`. A browser control run was planned instead and Claude in
  Chrome was not connected.
- **Double-tap like with the heart at the finger: not verified.** Every attempt was contaminated by
  harness timing (a spawned-per-step CDP client split the gesture) or by the swallow defect.
- **Deep link `/clip/:id` and the "This clip isn't available" screen: not verified on a device**
  (the emulator died before those steps).
- ⚠ **A stray test like remains** on clip `wucb7tSnBhrEI87UGxjE` (Verion's test-pattern clip) from the
  signed-in AVD account. It should be removed by tapping Unlike on that clip.

### Second pass, 2026-09-13: everything above marked NOT verified, now verified

Founder: *"why is there still a square around the avatar, why do the comments still go to a
seperate page ... you should have checked yourself"*. Root cause of what he saw: **his phone runs
the Play build (1.0.208), which predates every clip fix.** The web and the emulator were already
fixed; nothing had been shipped to his device. Three more routes to a clip's comments were also
still landing on the post page, and are now fixed:

- the feed's comment button on a clip opened the clip but not the sheet → `/clip/:id?comments=1`
- any `/post/:id` link to a clip (notifications, search, profile, discovery, old shares) rendered it
  as a regular post → PostDetail (web + native) redirects short-format posts into the clip player
- comment notifications now carry `?comments=1`

Measured on the emulator, build `index-Dnl3i5Zu.js` (plain `emulator -avd vergr_pixel`, which stays
up; the earlier "memory" crashes were `-no-window`, exit 139):

| Check | Result |
|---|---|
| Rail avatar | round: wrapper and image radius 9999px, 1.9px white border, 48x48 |
| Rail Comments | sheet opens, route stays `/shorts` |
| Feed comment button on a clip card | `/clip/bdvEFznwlCkLoxE7llOf?comments=1`, sheet open |
| `/post/<clipId>` | redirected to `/clip/<clipId>` |
| `/post/<clipId>?comments=1` | redirected with the sheet open |
| Sideways drag from mid-screen | does not pause (control: a tap on the same spot pauses) |
| 300ms hold | a tap, no menu |
| Long press → menu → one real tap on Cancel | menu closes |
| Double tap | heart drawn at 120,308 for a tap at 120,300 |
| Liked state on arrival | clip with a like shows filled heart + count 1 |
| Stray test like | removed by a real tap; server reads no like doc, likeCount 0 |
| Deep link / missing clip | exact clip opens; bad id shows "This clip isn't available" |

Fixes guarded: `clips-check` 18/18, `--self-test` 18/18. Liked/saved state now loads per clip viewed
(2 reads, once per clip per session), on the founder's instruction to reach TikTok level.

### Harness traps (each produced a false finding first)

- `Page.captureScreenshot` does not capture the Android WebView video surface: `adb exec-out screencap`
  is the control.
- CDP touch moves are cancelled after one move: drive drags, holds and scrubs with `adb shell input`.
- A new node process per CDP step adds up to ~430ms, enough to turn a tap into a hold.
- Escape with no overlay open is Back; a "reset" with Escape leaves the screen.
- Git Bash rewrites `/shorts` into a Windows path: `MSYS_NO_PATHCONV=1`.

---

## 5. Open items (founder decisions, not done)

1. **Show "already liked / saved" when a clip opens.** 2 reads per clip viewed (the same PostCard pays
   per feed card). Until then an already-liked clip shows an empty heart; a tap fills it without a
   second like.
2. **Sound row** ("original sound · @creator"). Every platform has one; Vergr has no sounds feature,
   so the row would be a dead control. Needs the feature first.
3. **Hashtag pages.** Search only substring-matches 20 recent posts, so tapping a tag would land on a
   near-empty page. Tags are bold text until a real tag page exists.
4. **For You / Following tabs** at the top (TikTok, Reels). A Following tab would need its own query.
5. **Naming:** the bottom nav says "Shorts", the home shelf says "Clips", the viewer title says "Shorts".
6. **Comment sheet** layout vs TikTok (like heart position, emoji row): looked right on the device
   (sheet over the clip, empty state, composer); no TikTok-parity redesign was done.
7. **Home feed video cards still use translucent controls**, found by the probe's control run on
   Home: the play button `rgba(123,31,255,0.9)` and fullscreen button `rgba(0,0,0,0.7)` on every
   feed video card, the coin pill `rgba(26,26,42,0.6)` and the "All" chip `rgba(255,255,255,0.1)`.
   Outside the clip player itself; not changed.
8. **Re-verify on a device** the three gesture fixes, the double-tap heart, the `/clip` deep link and
   the missing-clip screen, then remove the stray test like (section 4).
