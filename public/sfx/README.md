# Streaming SFX bank

Royalty-free, commercial-safe sound effects sourced from Mixkit (https://mixkit.co/free-sound-effects/).
Mixkit License: free for commercial use, no attribution required.

All files MUST stay short (≤ 1.5s) and small (≤ 30KB each, MP3 96-128kbps mono).

## Curated source list

Download each, rename to the target filename, and commit under `public/sfx/`.
Avoiding: cash-register dings, fanfares, casino bells, slot wins, anime
"ding!" tones — anything that screams "free asset pack".

| Target file | Mixkit source | Use case |
|---|---|---|
| `tap.mp3` | mixkit-modern-technology-select-3124 | UI tap acknowledgement |
| `heart.mp3` | mixkit-water-droplet-impact-1133 | Heart-react pop (warm low pop) |
| `tip-small.mp3` | mixkit-clear-quick-tap-tone-2818 | 1-49 coin tip |
| `tip-mid.mp3` | mixkit-bell-notification-933 | 50-499 coin tip |
| `tip-big.mp3` | mixkit-magic-marimba-2820 | 500c+ tip (short, no fanfare) |
| `stream-start.mp3` | mixkit-game-show-suspense-waiting-667 (trim to first 0.8s) | Go-live whoosh |
| `stream-end.mp3` | mixkit-soft-quick-tone-notification-2887 | End-stream fade |
| `follow.mp3` | mixkit-positive-interface-beep-221 | New follower (broadcaster) |
| `link.mp3` | mixkit-positive-notification-951 | Multi-Guest linked |
| `unlink.mp3` | mixkit-software-interface-back-2575 | Multi-Guest partner left |

## How to add

1. Browse Mixkit, download the source MP3.
2. Trim with Audacity to the suggested length (≤1.5s, fade out last 50ms).
3. Export as MP3, mono, 96 kbps.
4. Save to `public/sfx/<target-file>.mp3`.
5. Commit.

If a track later proves too cliché in playtesting, replace it without changing
the consuming code — `src/utils/sfx.js` references files by name.

## Total size budget

≤ 200 KB across all 10 files. Anything bigger is wrong; re-encode.
