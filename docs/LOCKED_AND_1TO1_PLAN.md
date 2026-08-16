# Paid content + 1:1 sessions — design & build plan

Written 2026-08-10, before any further code. Covers: 1:1 sessions (DM, group,
squad), locked images, locked videos, locked posts, locked live streams.

Reference model is Tango, checked rather than assumed:
- A **1-on-1** is a *private one-way broadcast* gated by a price — the creator
  streams, the invited viewer watches, chats and sends gifts. It is **not** a
  two-way call.
- A **Premium Live** is invite-only: uninvited followers get no notification and
  the stream does not appear on their following page. Entry is a fixed price.
- Tango auto-ends a premium session if the host disappears for 2–4 minutes, so a
  viewer never pays for dead air.

Sources: [Tango Help — starting a Premium Live](https://help.tango.me/en/articles/2985209-how-do-i-start-a-premium-live-broadcast-on-tango),
[Tango premium content](https://tango.me/maximize-your-tango-earnings-with-premium-content/),
[1-on-1 Premium](https://buffget.com/news/tango-live-1-on-1-premium-bypass-queues-with-diamonds)

---

## 0. What already exists (verified in code, not assumed)

| Piece | Where | State |
|---|---|---|
| `purchaseAccess` / `getAccess`, one entitlement per `{type}_{id}_{buyer}` | `functions/entitlements.js` | Live. Resolvers: post, stream, message, creator, call |
| Fee 10% (8% Pro), price 50–10,000 coins | `entitlements.js` | Live, founder-locked |
| Locked post upload → private `locked/{uid}/` prefix, key in `users/{uid}/private/lockedPostFiles` | `functions/lockedPosts.js` | Live |
| Locked message, same shape, `lockedMessageFiles` | `functions/lockedMessages.js` | Live |
| CSAM/NCII-only scan on priced media | `contentAi.scanPricedImage` | Live |
| Paid stream: `hlsUrl` withheld, moved to `streams/{id}/private/playback` | `functions/streaming.js` | Live |
| Discovery guard (`unlisted`/`discoverable`/`one_to_one`) | `src/utils/streamVisibility.js` | Live as of today |
| Full-screen media viewer with pinch-zoom + save | `src/components/MediaLightbox.jsx` | Live. **Locked media does not use it — this is the main UI gap** |

**The gap that matters most:** `LockedMedia` renders a 240px blurred square and,
after unlocking, an `<img>` of the same size. There is no way to see the media
full size. Nobody should pay to look at a thumbnail.

---

## 1. 1:1 sessions

### 1.1 The model

A 1:1 is a **private live broadcast with an invite list**. One host publishes;
invited people watch, chat and tip. Same media pipeline as any stream. What
changes is who may see it, and whether entry costs coins.

| Surface | Who can join | Max viewers | Where the invite lands |
|---|---|---|---|
| DM | the other participant | 1 | the DM thread |
| Group chat | group members | group size | the group thread |
| Squad chat | squad members | squad cap (100) | the squad thread |

It is **never** two-way video. The founder's phrase for it: "it's a one-way
call". Live chat is the return channel, which is why chat must be present.

### 1.2 Data

Reuses `streams/{streamId}`. New/《used》fields:

```
sessionType : 'one_to_one'                  // already stamped by createStreamSession
audience    : 'unlisted'                    // already
scope       : { kind: 'dm'|'group'|'squad', chatId }   // NEW — who the invite went to
inviteUids  : [uid, …]                      // NEW — server-enforced allow-list
access      : { mode: 'free'|'paid', priceCoins }      // already
maxConcurrentViewers : 1 for dm, else member count     // already for dm
```

`inviteUids` is the enforcement, and it is **BUILT** (2026-08-10). Unlisted
alone was never privacy: `streams/{id}` is world-readable, so a leaked id was a
leaked session. `assertInvited` in `functions/entitlements.js` runs in both
`getAccess` and `purchaseAccess`; not on the list → no playback URL, free or
paid, and no way to buy in either. A 1:1 also withholds `hlsUrl` from the public
document the same way a paid stream does.

Sessions created before this shipped have no `inviteUids` and are deliberately
left open rather than retroactively closed — locking their own participants out
would be a worse failure than the one being fixed.

### 1.3 Flow

1. Host: attachment menu → **1:1** → PriceSheet (Free / Paid + quick-pick).
2. `createStreamSession({ sessionType:'one_to_one', scope, inviteUids, access })`.
3. Server: forces `unlisted`, sets viewer cap, writes `inviteUids`, withholds
   `hlsUrl` when paid.
4. Client posts a **join card** into that conversation (message type
   `onetoone`, `contentUrl` = streamId, price in `text`).
5. Host lands on `/broadcast/:id`.
6. Invitee taps **Join** → `/watch/:id` → `getAccess('stream', id)`:
   - not on `inviteUids` → "This session is private."
   - free → play.
   - paid, unpaid → paywall → `purchaseAccess` → play.
7. Chat + tips are the existing viewer-screen components.

### 1.4 Protections

- **Host-absent auto-end. BUILT.** Folded into the existing `reapStaleStreams`
  sweep (runs every minute) rather than added as a second cron. A 1:1 uses
  tighter windows than a broadcast: 120s without a heartbeat ends it
  (`endReason:'host-absent'`), and a session that never produced a frame ends
  after 5 minutes (`endReason:'never-started'`). The public-broadcast windows
  are unchanged, because there the trade runs the other way: killing a healthy
  alt-tabbed streamer costs more than a stale card in a discovery list.
- **No refunds. SETTLED (founder, 2026-08-10).** An earlier draft proposed
  refunding a buyer who saw under 60 seconds. Rejected: *"No, Tango doesn't
  refund things like that."* There is also no never-started refund to write,
  because the join card only offers **Join** while the session is actually
  `live` — a buyer cannot pay for a session that has not started.
- **One purchase per session**, guaranteed by the deterministic entitlement id.

### 1.5 UI

**Join card (in-thread), ~250px wide:**
```
┌──────────────────────────────┐
│ ◉  1:1 session          LIVE │   ← pink dot + LIVE pill while status==='live'
│    Damie · 250 coins to join │
│ ┌──────────────────────────┐ │
│ │          Join            │ │   ← violet, full width. Hidden for the host,
│ └──────────────────────────┘ │      who instead sees "You started this"
│                       12:04 ✓✓│
└──────────────────────────────┘
```
Card goes grey with "Session ended" when the stream doc flips to `ended` — a
dead Join button is worse than no button.

**Viewer screen:** unchanged layout, plus a small `1:1 · private` chip beside the
title so it is obvious this is not public.

---

## 2. Locked images

### 2.1 Data (built)
Post/message carries `locked: { priceCoins, previewUrl, isVideo, unlockCount }`
and **no** `mediaUrl`. Real bytes on `locked/{uid}/…`, key in a private doc.
`getAccess` mints a 5-minute presigned GET.

### 2.2 The three states, and what each looks like

**A. Locked.** Blurred preview, generated on the *sender's* device before upload
(never a CSS blur over real bytes).

```
┌────────────────────────┐
│  ▒▒▒ blurred preview ▒▒│
│                        │
│         🔒             │
│    Locked photo        │
│  ┌──────────────────┐  │
│  │ Unlock · 100 🪙  │  │
│  └──────────────────┘  │
│    48 people unlocked  │
└────────────────────────┘
```
Fixes vs today:
- **Real aspect ratio**, not a forced square. Store `previewW`/`previewH` at
  upload; fall back to 4:5. A cropped square is the single biggest reason the
  current bubble "looks like shit".
- Chat bubble max 260px wide; feed card up to 520px tall.
- Never render this state while `getAccess` is still resolving — placeholder
  only, or an owner watches their own post sit behind a paywall then pop open,
  which reads as a bypass.

**B. Unlocking.** Button → spinner in place. No layout shift.

**C. Unlocked — this is the part that does not exist yet.**
Renders the real image **and it is tappable**, opening `MediaLightbox`
(`items:[{url, type:'image'}]`) with the pinch-zoom, save-to-gallery and
open-original it already supports. A ✓ Unlocked chip replaces the price.

### 2.3 The signed-URL problem to solve here
The GET expires in 5 minutes and the lightbox may open later. `LockedMedia`
must therefore **re-fetch on open**, not reuse the mount-time URL. Simplest
correct approach: an `onOpenFullscreen` callback that calls `getAccess` again
and hands the fresh URL to the lightbox.

---

## 3. Locked videos

Everything in §2 applies, plus:

- **Preview:** `makeBlurredPreview` only handles images, so a locked video today
  has *no* preview at all — that is why the bubble is a flat gradient. Fix: grab
  frame at `t=0.1s` to a canvas on the sender's device, downscale, blur, upload
  as the preview. Same guarantee, same one function.
- **Locked state** adds a ▶ glyph and duration pill so it reads as a video.
- **Unlocked** uses `InlineVideoPlayer` in the bubble, and the lightbox in video
  mode for full screen.
- **TTL:** a 5-minute URL cannot serve a 20-minute video. Raise
  `SIGNED_URL_TTL_SECONDS` to 3600 **for video only**, or the player dies
  mid-playback. This is a real bug waiting to happen and is not currently
  handled.

---

## 4. Locked posts

Same mechanism, different surface.

- **Feed card:** locked block replaces the media area at the post's real aspect
  ratio; caption, author, likes and comments stay visible and public. Selling
  the media, not the post.
- **Profile grid:** locked tile shows the blurred preview with a small 🔒 and the
  price; the grid never leaks a real thumbnail.
- **Create:** composer Lock button → PriceSheet (built). Copy must state
  create-time-only, since an existing post's bytes are already on a public CDN
  URL and cannot be retroactively protected.
- **After unlock:** normal post media, tap → lightbox.

---

## 5. Locked live streams (Tango Premium Live)

### 5.1 Model
A public-ish broadcast with a fixed entry price. Distinct from a 1:1: it has an
audience. Distinct from a free stream: `hlsUrl` is withheld from the
world-readable doc (built) and served only by `getAccess` after purchase.

### 5.2 Discovery — SETTLED (founder, 2026-08-10)
**A Premium Live is PUBLIC and DISCOVERABLE, behind a paywall.** It appears in
Explore and every other discovery surface with a price badge, and anyone may
join by paying. It is not invite-only. That is the funnel: people see it, want
in, and buy coins to get in.

Consequence for `streamVisibility.js`: a paid stream must NOT be filtered out.
Only `sessionType:'one_to_one'` and the relationship-gated audiences
(followers/friends/unlisted) are hidden. A paid public stream is discoverable
exactly like a free one, with a price badge on the card.

### 5.3 UI
- **Go Live:** the price control built today, plus an optional invite picker.
- **Explore card (if discoverable):** a `250 🪙` badge on the thumbnail so nobody
  taps in expecting free.
- **Viewer paywall:** built. Should also show host, title, viewer count and "you
  can leave any time".
- **Protections:** same host-absent auto-end and never-started refund as §1.4.

---

## 6. Shared UI rules (why the current one looks bad)

1. **Aspect ratio is preserved.** Never force a square. Store dimensions at
   upload.
2. **Every unlocked medium opens full screen** through the one existing
   `MediaLightbox`. No second viewer.
3. **Loading is never the locked state.** Placeholder until `getAccess` answers.
4. **Price is always visible before payment**, in coins, on the button itself.
5. **One PriceSheet** everywhere a price is set. Already true.
6. **Owner never sees a paywall** on their own content, and never a flash of one.
7. **Dead states are explicit**: "Session ended", "No longer available" — never
   a button that does nothing.

---

## 7. Build order

| # | Item | Status |
|---|---|---|
| 1 | Full-screen viewing for unlocked media (§2.2C, §3), incl. fresh-URL-on-open | ✅ shipped + deployed 2026-08-10 |
| 2 | Aspect-ratio + video preview frame (§2.2A, §3) | ✅ shipped + deployed 2026-08-10 |
| 3 | Video signed-URL TTL (§3) | ✅ shipped + deployed 2026-08-10 |
| 4 | `inviteUids` enforcement in the stream resolver (§1.2) | ✅ shipped + deployed 2026-08-10 |
| 5 | 1:1 join card states + group/squad scopes (§1.5) | ✅ shipped + deployed 2026-08-10 |
| 6 | Host-absent auto-end (§1.4) | ✅ shipped + deployed 2026-08-10 (refund dropped, see §1.4) |
| 7 | Locked post feed/grid states (§4) | ✅ shipped 2026-08-10 — see note |
| 8 | Premium-live discovery decision (§5.2) | ✅ settled: public + paywalled |

### What shipped, precisely (2026-08-10)

**1–3, locked media.**
- `makeBlurredPreview` now handles **video** (decodes a frame at 0.1s, not 0 —
  encoders emit blank first frames) and returns `{blob, width, height,
  durationMs}` instead of a bare Blob. Locked videos previously had no preview
  at all, which is why that bubble was a flat gradient.
- Dimensions and duration ride the `locked` block through `sendLockedMessage`
  and `createLockedPost`, so every bubble reserves the **real aspect ratio**
  before the preview paints. Nothing is cropped square any more.
- `getAccess` returns a `preview` block (url, w, h, isVideo, durationMs,
  unlockCount). This is what makes the relay chat path work: relay frames carry
  a fixed field set and no `locked` block, so the client had no idea what shape
  to draw. The server was already the authority on price; it is now the
  authority on shape.
- Unlocked media is **tappable and opens `MediaLightbox`** with a URL minted at
  the moment of opening, not the mount-time one — a thread left open for ten
  minutes would otherwise open onto an expired signature.
- **Video signed URLs live 3600s**, images stay at 300s. A 5-minute URL cannot
  serve a 20-minute video; the player would have stalled partway through
  something already paid for. Chosen off `contentType` recorded at upload.
- Chat bubbles lost the border on media types (`image`, `video`, `locked`,
  `onetoone`) — that 1px rim tracing a photo is the "thick border".
- `PostCard` passes `minRatio={0.72}` so a 9:16 locked clip cannot swallow the
  whole feed.

**4, privacy.** This was the real hole. A 1:1 was protected only by being
unlisted, and `streams/{id}` is `allow read: if true` — for a FREE session the
playback URL was on that document, so a forwarded id was a forwarded session.
Now: `createStreamSession` takes `inviteUids`, stores host+guests, and
**withholds `hlsUrl` from a 1:1 exactly as it does from a paid stream**, putting
both URLs in `streams/{id}/private/playback`. `assertInvited` runs in *both*
`getAccess` and `purchaseAccess` — the latter so a stranger cannot buy their way
into a session never offered to them. Refusal is `not-found`, identical to a
session that never existed, so probing ids reveals nothing.

**5, the card.** New `src/components/monetization/OneToOneCard.jsx`, shared by DM
and squad chat. Subscribes to the stream doc and shows the state the session is
actually in: *Starting soon* → **Join** (pink, or **Tip to Join** when priced) →
*Session ended*, greyed and not tappable. Backdrop is the host's own thumbnail,
dimmed. Squad chat gained the whole feature (a videocam button in the compose
tools, the price sheet, and the card), which it did not have before.

**Also fixed in transit:** `MobileLiveViewer` never resolved paid access at all,
so a **paid stream on a phone showed an empty player and no paywall** — it now
runs the same getAccess path and renders `StreamPaywall`. And the followers-only
gate was catching 1:1 sessions (they are unlisted too), which would have told an
invited guest to go and follow the person who had just invited them.

**Copy corrections.** `startOneToOne` carried a large comment insisting "THIS IS
A CALL, NOT A STREAM" and the sheet said "it rings them directly" — both left
over from the two-way-call version that was built and reverted. A 1:1 is a
private one-way broadcast; the code was right and the comments were wrong.

**Note on 7.** There is no separate profile media grid to fix: `PostCard` is used
everywhere posts appear (feed, profile tabs, pinned, post detail), so the feed
work covered it. A locked post carries no `mediaUrl` by design, so no grid could
leak a real thumbnail. Verified the Shorts query already excludes locked clips
(it drops any post with no `videoUrl`).

## 8. Open decisions (founder)

1. ~~Paid stream discoverable?~~ **SETTLED: yes, public + paywalled.** §5.2
2. ~~Host-absent auto-end window~~ **SETTLED: 120s, built.** §1.4
3. ~~Refund rule for a session that ends early~~ **SETTLED: no refund.** §1.4
4. **Does the coin count actually differ by payment method?** Tango's web
   checkout shows "+50% coins" on EVERY method (Visa, Mastercard, Google Pay,
   PayPal, Skrill) — the bonus is a promotion, not a per-method difference. My
   cart currently shows FEWER coins for Google Play. Need a screenshot of the
   Android app's checkout to know whether Tango reduces coins there.

---

## 8b. Gap closure — ✅ ALL SHIPPED + DEPLOYED 2026-08-10

Everything below was outstanding after the section 7 build order finished.

| Gap | What shipped |
|---|---|
| Google Play "fewer coins" model | `STORE_COIN_OVERRIDES` deleted. One ladder. Play price fetched live, row disabled if unavailable, single-pack only. `playSubPriceFor()` added. Section 17.3 |
| Premium Live invisible in discovery | `streamPremium()` + `<StreamStateBadge>`: PREMIUM pill with coin price on Explore (web + native), the following rail, the home rail, Shorts and the avatar live ring |
| Paid streams autoplaying a free preview | Shorts `LiveSlide` shows a still + padlock + price for a paid stream and never mounts a player. `canAutoplayPreview()` states the rule |
| Join gate was a generic panel; free 1:1 had none | `StreamPaywall` rebuilt to the section 22 design (blurred still, avatar, state line, coin price, gradient pill). ONE screen for both products, and a free 1:1 now gets it too |
| Send sheet missing most of section 19 | `PriceSheet` gained the media strip with remove + "+", the Free/Premium segmented control, and a proportional stepper. Quick picks now descend |
| Locked sends were single-item only | Full sets end to end: `items[]` through `sendLockedMessage`, `keys[]` in the private doc, `signAll()` returning `mediaUrls[]`, and a carousel with dots, chevrons and an `N PICS` label. Bought once. EVERY image in a set is scanned, not just the cover |
| Content Packs did not exist | Section 20 |

**Two bugs found in passing.** `MobileLiveViewer` never resolved paid access at
all, so a paid stream on a phone showed an empty player and no paywall. And the
followers-only gate was catching 1:1 sessions (they are unlisted too), which
would have told an invited guest to go and follow the person who had just
invited them.

---

## 9. UI reference — read off Tango screenshots (2026-08-10)

Supplied by the founder. These are observations from real screens, not
inference. Where Tango says "Gift", **we say Tip**.

### 9.1 Locked media bubble — multi-item ("3 PICS")

```
┌────────────────────────────┐   ~220px wide, radius ~16
│                          › │   ← chevron on the right edge = carousel
│      ▒▒ blurred image ▒▒   │      PORTRAIT / natural ratio, not square
│                            │
│            🔓              │   ← ONE large centred glyph, white, ~44px,
│                            │      semi-transparent. No circular badge.
│         • • ○              │   ← page dots at the image's bottom edge
├────────────────────────────┤
│           3 PICS           │   ← count label, centred, small caps,
│  ┌──────────────────────┐  │      on a darker panel below the image
│  │   Unlock   🪙 99     │  │   ← SOLID WHITE pill, full width, dark text
│  └──────────────────────┘  │
│  Dick               21:25  │   ← sender left, time right
└────────────────────────────┘
```

What my current design got wrong, specifically:
- Forced square crop → theirs keeps the real ratio, often portrait.
- Small icon in a circular chip → theirs is one big bare glyph.
- Dark scrim over the whole image → theirs relies on the blur alone, so the
  image still reads as a photograph you want.
- Ghost/outline button → theirs is a solid high-contrast pill, the loudest
  thing in the bubble.
- No multi-item support at all → theirs carousels N items with dots + a count.

### 9.2 Tip-gated variant ("Gift to View" → **"Tip to View"**)

Same card, different call to action:
- Centred **3D gift/heart glyph in brand colour** instead of the padlock.
- Coin icon + amount directly beneath the glyph, above the button.
- Button is a **pink/magenta gradient pill**, not white.
- Timestamp sits on a dark rounded chip over the image, bottom-right.

So there are two lock modes and they look different on purpose:
`unlock` (padlock, white pill) and `tip` (gift glyph, gradient pill).

### 9.3 Coin store

- Section-based, not one flat grid: **Coin Store**, then promotional bands
  (**🚀 Super Coin Boost** with a `⏱ x5` countdown chip, **VIP Upgrade Offer!**).
- 3 across. Each card: coin icon + amount, a **"+50% More"** bonus line, a
  distinct **illustration per tier** (coin pile → trophy → treasure chest →
  VIP badge → bronze/silver/gold medal), and the price in a footer bar.
- Badge pills on the card's top edge: `⭐ Popular`, `🔥 Hot`, `👍 Best Value`.
- Our grid has none of this: no illustrations, no bonus line, no tiering.

### 9.4 Checkout — this is what our cart should look like

```
←  Checkout                                    ✕
┌──────────────────────────────────────────────┐
│ 🪙 750                                 $4.99 │   ← what you get / what you pay
└──────────────────────────────────────────────┘
Cards                                    [Edit]
 ◉ VISA        Visa ···· 1794      [+50% coins]
 ○ MC          Mastercard ···· 6609 [+50% coins]
 ○ ▭           Add Card             [+50% coins]
More
 ○ G Pay       Google Pay           [+50% coins]
 ○ PayPal      PayPal               [+50% coins]
 ○ Skrill      Skrill               [+50% coins]

      ╔══════════════════════════════════╗
      ║              Pay                 ║   ← full-width pink gradient
      ╚══════════════════════════════════╝
        Amount inclusive of Fees: $5.84      ← appears once a method is chosen
                                                (before: "Taxes / Fees ⓘ")
   VISA  MC  AMEX  DISCOVER  GPay  SSL  PCI   ← trust badges
   By clicking Pay you agree to Terms of Use
   and Privacy Policy. "TANGOME CYPRUS LIMITED",
   Agias Fylaxeos 42, … Send questions to support@tango.me
```

Directly relevant to Stripe underwriting, and all of it missing from our cart:
- Saved payment instruments as **radio rows**, grouped `Cards` / `More`.
- **One** Pay button, not a method picker plus a separate checkout.
- **Fees disclosed on the button area**, and the total changes to
  "Amount inclusive of Fees" once a method is picked.
- **Trust badges** row (card networks, SSL, PCI).
- **Legal entity name + registered address + support email** directly under Pay.
  We have the entity in the Terms; Tango puts it at the point of payment.

**Open question, do not guess:** every method here shows the SAME `+50% coins`.
So in Tango's web checkout the bonus is a promotion, not a per-method penalty.
Our cart currently shows fewer coins for Google Play. Need the Android app's
checkout to know whether Tango reduces the coin count there.

### 9.5 Chat list

- LIVE story circles above the list (avatar ring + `LIVE` badge).
- Filter chips: `All` · `Unread (n)` · `Gifters` · `❤️ Favorites` · `+`.
- A 1:1 invite shows in the list preview as plain text **"Live 1 to 1"**.
- Persistent bottom-right: `⭐ Get more Coins now`, and a **pink gradient FAB
  with a video-camera icon** — the entry point for going live / starting a 1:1.
- Coin balance pill with a pink `+` button in the top bar, always visible.

---

# PART B — Coin store, cart and checkout

Written to be built from without asking a follow-up question. Where a value is
a founder decision it says so explicitly rather than being left implied.

## 10. The constraint that shapes all of this

Tango's checkout is **in-app**: saved cards as radio rows, one Pay button, fees
disclosed inline. That is only possible because they hold the payment
relationship.

> **⚠ 2026-08-13: Stripe closed the account and the rail was removed.** The
> "Target (Stripe)" column below is now a description of what an in-app card
> sheet WOULD need from any processor, not a plan with a named one. The two-layer
> split it argues for still holds and is still the right shape: the cart is
> processor-agnostic, the adapter is not. PayRam is the only card rail today, so
> the hosted hand-off is the reality, not a temporary state.

**We cannot build that on PayRam.** PayRam hands back a hosted URL and the user
completes payment on PayRam's own page. We cannot render their card list, cannot
save an instrument, cannot show a Pay button that charges. So:

| | Today (PayRam) | Target (Stripe) |
|---|---|---|
| Where card details are entered | PayRam hosted page, opened in a popup / system browser | In-app, Stripe Elements or Payment Element |
| Saved cards | Not possible | Stripe Customer + saved PaymentMethods, shown as radio rows |
| Google Pay / Apple Pay | Whatever PayRam offers on its page | Native buttons in our sheet |
| Fee line | Shown by us before hand-off | Shown by us, exact |
| Trust badges + legal | Ours, before hand-off | Ours, above Pay |

**Therefore the cart is built once, in two layers:**
- `CartContents` — lines, totals, methods, fees, legal. Identical either way.
- A **checkout adapter** — `payram` today, `stripe` later. Swapping the adapter
  must not touch the cart.

This is the whole reason to build it now: the surface a Stripe reviewer looks at
is finished, and the day the account opens we change one adapter.

## 11. Coin store (`/wallet/buy`)

### 11.1 Layout
Sections, not one flat grid (Tango §9.3):

1. **Coin packs** — the 8 SKUs, 3 across on desktop, 2 on mobile.
2. *(optional, founder)* promotional bands e.g. "Super Coin Boost".

### 11.2 Pack card — exact contents, top to bottom
```
┌───────────────────────────┐
│  [⭐ POPULAR]             │ ← badge pill, top edge, only if pack.badge
│                           │
│        (illustration)     │ ← per-tier art, 72px. MISSING TODAY.
│                           │
│   🪙 1,200                │ ← coins, dmmono bold tabular
│   +1,500 VP bonus         │ ← only when pack.vpBonus > 0
│   tagline                 │
│                           │
│   $13.54                  │ ← USD, from the server quote
│   ≈ €11.49 · charged in USD│
│  ┌─────────┐ ┌──────────┐ │
│  │   Add   │ │ Buy now  │ │
│  └─────────┘ └──────────┘ │
└───────────────────────────┘
```
- **Illustrations are a founder asset decision.** Eight images at
  `/brand/packs/{id}.webp`. Until they exist, keep the current coin glyph.
- Badge values already exist in `COIN_PACKS` (`badge`, `badgeStyle`).
- Price is ALWAYS the server quote, never computed client-side.

## 12. Cart

### 12.1 Where it lives
- **Desktop:** slide-in drawer from the right, over the page. Browsing continues.
- **Mobile:** full page at `/wallet/cart`, so it has a URL and a back button.
- Both render `CartContents`. Never fork the totals.
- Present in **every** build including Play (alternative billing is permitted).

### 12.2 Cart contents — exact spec
Cart state stores **`{sku, qty}` only**. No prices, ever. Max 20 lines, qty 1–99.
Persisted to `localStorage['vergr.cart.v1']`.

**Line row:** coin glyph · pack name · `N coins` (+VP if any) · `€X.XX each` ·
`[− qty +]` · `Remove` · line total right-aligned.

**Summary block, in this order:**
```
Coins (n items)                              1,200 coins
Subtotal                                            €11.49
VERGR fee                                            €0.00
──────────────────────────────────────────────────────────
Total                                               $13.54
                                    ≈ €11.49 · charged in USD
```

### 12.3 Payment method rows
Grouped exactly as Tango: **`Cards`** then **`More`**.

| Row | Shown when | Note |
|---|---|---|
| Saved card ···· 1794 | Stripe only, per saved PaymentMethod | radio |
| Add card | Stripe only | radio |
| Card / Apple Pay / crypto | always (PayRam today) | radio |
| Google Play | Android app with billing available | radio |
| PayPal, Skrill | only if the processor offers them | radio |

Each row: logo · label · optional right-hand pill · radio. One selected at all
times; default = first available.

**The right-hand pill is a bonus, not a penalty.** Tango shows `+50% coins` on
every method. **Whether the coin count differs per method is an OPEN
QUESTION — see §14.** Until answered, show no pill and no per-method coin
difference.

### 12.4 Fees
- Before a method is chosen: `Taxes / Fees ⓘ` (tappable, explains that the
  final amount includes processor fees).
- After: `Amount inclusive of Fees: $X.XX`, from the server.
- **The fee number must come from the quote.** If the processor does not return
  one, show `Taxes / Fees ⓘ` and nothing more. Never estimate a fee on the
  client.

### 12.5 Below the Pay button — required for underwriting
1. Trust badges: Visa · Mastercard · Amex · Discover · G Pay · SSL · PCI.
2. `By clicking Pay you agree to our Terms and Privacy Policy.`
3. `Murmont LLC, trading as VERGR, 1309 Coffeen Ave, Ste 1200, Sheridan, WY 82801, United States.`
4. `Questions: support@vergr.app`
5. Digital-goods + refund line, linking `/platform/refunds`.

All five are non-negotiable and must render on desktop and mobile.

### 12.6 States
| State | Behaviour |
|---|---|
| Empty | Cart icon, "Your basket is empty", `Browse packs` |
| Quoting | Total shows `…`, Pay disabled. **Never a stale total.** |
| Quote failed | Inline error, Pay disabled. Fail closed — the quote and the charge fail closed together |
| Paying | Pay → `Opening checkout…`, disabled |
| Popup blocked | Toast, cart **kept** (`startCheckout` returns false) |
| Success | Cart cleared, coins land via the wallet snapshot |
| Play partial | "3 of 5 purchases completed", only bought lines removed |

## 13. Checkout adapters

```
checkout({ lines, method }) -> { ok, amountUSD, feeUSD? }
```
- **payram** (today): `createPayramPayment({ cart })` → hosted URL → popup or
  system browser → poll `payram_orders/{ref}` until settled.
- **googlePlay**: one Play Billing purchase per line × qty, sequential, stops on
  first cancel.
- **stripe** (later): PaymentIntent from the same server-side cart re-price;
  Payment Element in-sheet; saved methods from the Stripe Customer.

The server re-prices the cart in every adapter. **The client never sends an
amount.** That rule is what makes a cart safe to accept at all.

---

## 14. Screenshots still needed

Founder constraint: **Tango blocks screenshots of live streams**, so nothing
below asks for one. A Premium Live is confirmed to be an ordinary live stream
plus a pay-to-view gate, so our own streaming UI is the reference for the
player itself; only the *gate* and the *discovery card* are unknown.

Ordered by how much each unblocks.

| # | Screenshot | Unblocks | Why it cannot be inferred |
|---|---|---|---|
| 1 | **Android app** coin checkout, one pack selected, method list visible | §12.3 | Web shows `+50% coins` on every method. If the Android sheet shows a different coin count for Google Play, our per-method difference is right; if not, it is invented and must be removed |
| 2 | Tapping the **pink camera FAB** in the chat list — the sheet it opens | §1.3 | Whether a 1:1 starts from the chat list or from inside a thread, and whether the price is set there |
| 3 | The **1:1 invite bubble** as the RECIPIENT sees it in the DM | §1.5 | I have the sender side only. Need the join affordance, and whether price shows before or after tapping |
| 4 | The **pay-to-join gate** before entering a paid session (any type) | §5.3, §1.3 | The one screen a payer sees before spending. Not a live stream, so it should capture |
| 5 | A **locked VIDEO** bubble in chat, still locked | §3 | Play glyph, duration pill, whether the preview is a blurred frame or a flat panel |
| 6 | An **unlocked** image bubble, after paying | §2.2C | Whether it becomes a normal photo, and whether tapping opens full screen |
| 7 | The **full-screen view** of an unlocked multi-image set | §9.1 | How the carousel behaves once paid, and whether the count label persists |
| 8 | Sending locked media: the **composer / price sheet** the SENDER uses | §2, §3 | Our PriceSheet is a guess at this. Also shows whether multi-select is offered at send time |
| 9 | A **paid stream's card in Explore** (thumbnail + price badge), not the stream itself | §5.3 | Confirmed discoverable; need the badge treatment |
| 10 | The **tip sheet inside a stream** | §9.2 | We are replacing "gift" with "tip"; need the amount ladder and layout |

If any of these cannot be captured, say which and I will specify it from our own
design language rather than guessing at Tango's.

## 15. Decisions still owned by the founder

1. **Per-method coin difference** — blocked on screenshot #1. Until then the
   cart shows one coin count for every method.
2. **Pack illustrations** — 8 images, or keep the coin glyph. §11.2
3. **Host-absent auto-end window.** Tango 2–4 min; proposed **120s**. §1.4
4. **Early-end refund rule.** Proposed: full refund if the buyer saw **< 60s**. §1.4
5. **Promotional bands** in the coin store (Super Coin Boost / VIP tiers) — a
   pricing and promotion decision, not a build one. §11.1

## 16. Settled — do not reopen

- Premium Live is **public and discoverable**, paywalled. Anyone may pay to join.
- A 1:1 is a **private one-way broadcast**, never a two-way call.
- Coins are **one global price**; regional pricing applies to subscriptions only.
- Never surface a regional discount in the UI.
- The cart holds **SKUs and quantities only**; the server re-prices everything.
- USD is the displayed AND charged currency, quoted by the server.

---

# PART C — Resolved from founder screenshots + research, 2026-08-10

Supersedes any earlier guess in this document. Everything below is either read
off a real screen or answered by the founder.

## 17. Google Play + alternative billing — the recommendation

### 17.1 What the rules actually say
- Play's **Billing Choice** programme went live **30 June 2026** for the EEA, UK
  and US. Developers may offer an alternative billing system in-app, or link out.
- Service fee 10% on the first $1M/yr, with a **4% reduction** on transactions
  paid through the alternative system.
- **In the US the alternative-billing fees are currently switched off** — Google
  is not assessing them and not requiring transaction reporting. Murmont LLC is
  a US entity, so this is the regime that applies to us today.
- The binding UX rule: the user must be able to compare the two options fairly,
  **with no thumb on the scale** toward the developer's billing system. Buttons
  must be visually equivalent, side by side, each clearly identifying who is
  taking the payment.

### 17.2 The founder's worry is the correct one
> "google may not like it if we list products that do not match what is displayed"

Exactly right, and it is the decisive constraint. A Play IAP product has **one
fixed quantity and one Play-set price per market**. If our cart displays a
number that differs from what the Play sheet then charges, that is the
displayed-versus-charged mismatch again, and Play does reject for it.

### 17.3 What I built is the risky version — FIXED 2026-08-10
`STORE_COIN_OVERRIDES` is **deleted**. `STORE_COIN_PACKS` is now literally
`COIN_PACKS`, so there is one ladder everywhere and no second quantity to drift.
The cart shows one coin count, the Play row carries Play's own formatted price
(fetched, never computed) and is disabled when that fetch has not answered.
Because Play prices one product per sheet, the Play row is offered only for a
single pack at quantity one; anything larger says so plainly and uses the card
rail. `playSubPriceFor()` was added for subscriptions.

The rest of this section is kept as the reasoning, which has not changed.

Today (historical): **same price, fewer coins** on Google Play (1,000 vs 1,200). Two problems.
1. It is a thumb on the scale expressed in the *product itself*, which is the
   least defensible form of it.
2. It forces a second SKU quantity, so the shelf shows one number and Play shows
   another depending on where you look.

### 17.4 The recommendation: same coins, different price
Flip the model.

| | Coins | Card / crypto | Google Play |
|---|---|---|---|
| Pro Pack | **1,200** | $13.54 | $14.99 |

- The Play IAP product is literally "1,200 coins, $14.99". Console and UI agree
  exactly. Nothing to reject.
- The price difference is an ordinary, disclosed consequence of the store fee,
  which is how apps that do this present it.
- The user compares two prices for the same thing. That is a fair comparison.
- `playPriceFor(coins, country)` in `src/utils/storePricing.js` **already
  computes the price needed to hold our net per market**, including
  VAT-inclusive markets. It was written for exactly this. Only the
  reduced-quantity ladder (`STORE_COIN_OVERRIDES`) is deleted.

### 17.5 Hard rules for the Play row
1. **Never display a Play price we calculated.** Fetch it live with
   `fetchPlayPrices()` (already implemented) and render Play's own formatted
   string. If the fetch fails, disable the row rather than guess.
2. **No fee line on the Play row.** We cannot add a surcharge; Play charges the
   SKU price. Disclose with a caption, not arithmetic:
   `Includes Google Play's service fee.`
3. **Visual parity.** Same row height, type size, button treatment and tap
   target. No highlight, no "best value", no pre-selected card row that makes
   Play the second-class option.
4. **Each row names who takes the money**: `Google Play` vs
   `Card, Apple Pay or crypto - processed by our payment provider`.
5. Default selection = first available row in DOM order, not a preference.

**On the founder's "put the difference under taxes and fees" idea:** it cannot
work, because we cannot add anything to a Play charge; the SKU price is final.
The honest equivalent is the caption in rule 2 plus the price itself.

### 17.6 Residual risk, stated plainly
A price difference is still a mild thumb on the scale. It is the smallest
defensible one and it is what the market does. If Google ever objects, the
fallback is one config flag: price both rails identically and absorb the fee on
Play sales.

---

## 18. Locked media bubble — final spec (from screenshots)

Read off a real locked pack, so these are measurements, not preferences.

```
+-----------------------------+  radius 16, NO BORDER
| [03:44]                   > |  duration pill top-LEFT (video only)
|                             |  chevron right edge, dark circle (multi only)
|      ~~ blurred media ~~    |  NATURAL ratio, portrait allowed
|             @               |  ONE padlock glyph, centred, ~44px,
|                             |  rounded-square body, white ~85%
|         . . . . o           |  page dots, bottom of image (multi only)
+-----------------------------+  darker panel starts here
|          5 VIDEOS           |  count + type, centred, bold, small caps
|  +-----------------------+  |
|  |    Unlock    (c) 199  |  |  SOLID WHITE pill, dark text, full width
|  +-----------------------+  |
|  PACK 1              11:52  |  pack TITLE left, time right
+-----------------------------+
```

Confirmed details:
- **Packs are titled** ("PACK 1") and the title shows on the bubble.
- Count label reads `N PICS` / `N VIDEOS`.
- Video shows **duration top-left**, over the blur.
- **No border anywhere.** Founder: our current image and video bubbles have a
  thick border "which makes it look stupid". Tango has none; the media is the
  bubble, and any accompanying text sits in its own bubble sized to the media.
- Two action variants:
  - **Unlock** - padlock glyph, solid white pill.
  - **Tip to View** - 3D gift glyph in brand colour, coin + amount above the
    button, **pink gradient pill**. (Tango says "Gift"; we say **Tip**.)

### 18.1 Unlocked state
Becomes an ordinary media bubble, no border, natural ratio, and taps into our
existing full-screen carousel, which the founder confirms is fine as-is.

---

## 19. Send-locked-media sheet (from screenshot)

```
                                              X
 +-----+
 |thumb| x        <- selected items, small, removable. A "+" tile adds more
 +-----+
 +------+---------+
 | Free | Premium |   <- segmented toggle, Premium = white pill
 +------+---------+
 +---+-----------------------+---+
 | - |       (c) 399         | + |   <- stepper, outlined pill row
 +---+-----------------------+---+
 [4K] [2K] [999] [499] [199]        <- quick amounts, descending
 +---+------------------------+---+
 | + | Message...             | > |   <- normal composer stays below
 +---+------------------------+---+
```
- Multi-select happens **before** the sheet opens; the sheet also carries a
  **+** to add more.
- `Free` / `Premium` toggle is where "locked" is chosen, not a separate button.
- Stepper **and** quick chips, both editing the same number.
- Our `PriceSheet` is close but must gain: the media strip, the +, the segmented
  Free/Premium control, and the stepper.

## 20. Content Packs (new feature, founder-specified) — ✅ SHIPPED 2026-08-10

`functions/mediaPacks.js`: `createMediaPack`, `deleteMediaPack`, `sendMediaPack`.
Public half at `users/{uid}/mediaPacks/{id}` (title, price, blurred previews,
sendCount) is owner-read and callable-write-only; the object keys live in
`users/{uid}/private/mediaPackFiles`, which rules deny to every client and which
is now on the same deny-list as `lockedPostFiles`.

**Sending a pack writes an ordinary locked message** through the same
`writeLockedMessage` a fresh upload uses, so the entitlement stays keyed to the
MESSAGE. Two sends are two independent sales; buying it in one conversation does
not unlock it in another. Keying the entitlement to the pack would have been a
hole, not a feature.

No re-scan on send: every image was scanned at pack creation, the bytes are
immutable on a private prefix, and re-scanning would spend a Vision call per fan
to re-derive an answer already on file. Deleting a pack leaves the R2 objects
alone, because past buyers' messages point at them.

UI: `ContentPacksSheet.jsx`, opened by the lock button in DM and squad chat, with
the founder-specified empty state. `PriceSheet` gained `allowSaveAsPack`, so a
normal locked send can be saved as a pack on its way out; that write is a side
effect and can never fail the send.

### Original spec

Empty state, read off the screen:
> **Content Packs** X - image glyph - **"Create a Media Pack"** -
> *"Give your Fans something to get excited about!"* - pink `+ Create` pill

Behaviour the founder described: Create opens the gallery; the user builds a
pack, **titles** it, **prices** it, and it is stored for reuse, so a creator
does not reopen their gallery and reselect the same ten items for every fan.

Data: `users/{uid}/mediaPacks/{packId}` =
`{ title, priceCoins, items[], coverPreviewUrl, createdAt }`, items on the
private `locked/{uid}/` prefix exactly like a single locked send. Sending a pack
writes ONE message referencing `packId`; the entitlement stays
`message_{chatId}:{messageId}_{buyer}`, so a pack is bought once.

## 21. Premium Live — presentation (founder-confirmed)

- **Public and discoverable.** Appears in Explore, feeds and the stories/online
  circle like any live stream.
- Circle badge reads **PREMIUM**, not LIVE.
- Feed card shows a **premium badge** and, unlike a normal live card, **does not
  autoplay a looping clip** - a still only. That is the paywall working: no free
  preview of paid content.
- Join gate is the **same screen** as a 1:1 join (section 22).

## 22. Join gate — ONE screen, used by BOTH 1:1 and Premium Live

Read off the premium-join screenshot; founder confirms reuse for 1:1.

```
        (blurred still of the stream, full screen)

               (O)  circular avatar, centred
            badges row
              In Premium          <- state line
                 (*)              <- 3D tip glyph, brand colour
                (c) 99            <- coin icon + price
      +===========================+
      |       Tip to Join         |  <- pink gradient pill, full width
      +===========================+
```
Ours: state line reads `In Premium` or `1:1 session`; button reads
**`Tip to Join`** when priced, **`Join`** when free.

## 23. 1:1 card in the DM (from screenshot)

```
+------------------------------+
|   (host thumbnail, dimmed)   |
|      Cyprus - Playb0y        |  <- host name + badges, centred, bold
|       +---------------+      |
|       | LIVE completed|      |  <- state pill
|       +---------------+      |
|                       23:03  |
+------------------------------+
```
- **Live:** pill becomes a **pink `Join` button** (founder's correction).
- **Ended:** grey `LIVE completed`, not tappable.
- Background is the host's own thumbnail, dimmed, not a flat panel.

## 24. Decisions — now answered

| # | Decision | Answer |
|---|---|---|
| 1 | Per-method coin difference | **Changed.** Same coins, different price. Section 17 |
| 2 | Pack illustrations | **Yes**, but they load too slowly. Must be compressed and **instant on mobile** - see 24.1 |
| 3 | Host-absent auto-end | **Yes, 120s** |
| 4 | Early-end refund | **No.** Tango does not refund this and neither do we. Remove from section 1.4 |
| 5 | Promotional bands in the coin store | Founder invited a proposal - see 24.2 |

### 24.1 Pack illustrations — making them instant
1. Serve **WebP at 2 sizes** (144px grid, 288px retina), quality ~72. Eight
   images should total well under 200KB.
2. **Preload the visible ones** with `<link rel="preload" as="image">` in the
   store route, so they are in cache before the grid paints.
3. **Explicit width/height** on every img so the grid never reflows.
4. Native: bundle them **in the APK** under assets rather than fetching from the
   CDN. A local file is instant and works offline; this is the only way to hit
   "instant" on mobile.
5. `loading="eager"` for the first row, `lazy` below the fold.

### 24.2 Proposed promotional structure (founder decision)
Tango runs three bands: base store, a timed **Super Coin Boost** (x5 chip
counting down), and a **VIP Upgrade Offer**. Proposal, smallest version that
works:

- **One** promotional band, not three. `app_config/general.coinPromo` =
  `{ active, label, endsAt, packs:[{sku, bonusPct}] }`.
- Bonus is **extra coins on the same price** (never a cheaper coin: coins redeem
  at a fixed rate, so discounting the price is the arbitrage we already ruled
  out in reference-never-discount-a-redeemable).
- A countdown chip on the band header, from `endsAt`.
- Bonus coins are credited by the SAME server path as the purchase, from config,
  never from the client.
- Start it as a launch offer, then run it monthly if it converts.

This is a founder call on whether to run promotions at all; the mechanism above
is what I would build if yes.
