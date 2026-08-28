# Vergr announcements: full plan and build order

Status: **ALL SHIPPED AND DEPLOYED, 2026-08-17.** Every one of the seven locked
founder decisions (D1-D7, section 1) is built and live. Written 2026-08-17,
revised the same day after those decisions, which are the spec. Build progress is
tracked in section 19 at the bottom; treat that as the source of truth for what
exists versus what is still planned.

What remains is founder action, not code: create the channels, and set the two
SMTP secrets so email stops being dormant. Both are listed at the top of section
19's "Next, in order".

Every build section is numbered steps with the actual files, fields and callables
involved, plus a "Done =" test, so a later session can execute from this without
re-deriving anything.

---

## 0. Audit of what exists today

Verified against source, not assumed.

| Fact | Consequence |
|---|---|
| Nothing anywhere writes the top-level `announcements` collection. `AdminAnnounceScreen.jsx:295` subscribes to it. | The History tab is permanently empty and always will be. The `announcements` doc-count tile on Live Stats reads 0 forever. |
| `sendAnnouncement` writes N `notifications` docs plus an audit row and nothing else. | There is no record of an announcement. You cannot edit, recall, re-send or measure one. |
| Per send to N users: N notification writes, N `onNotificationCreated` trigger invocations, 2N reads inside `sendPushToAll` (fcm doc + user doc, per user, serial in batches of 10). | About 4N Firestore operations per announcement. ~1,600 ops at today's ~400 real users. 200,000 at 50k, inside a callable with a 60s default timeout. |
| No idempotency key in the path. | A timeout followed by a retry sends twice. |
| `sendPushToAll(...).catch(() => {})` is not awaited. | It keeps running after the callable returns and is killed when the instance is reclaimed. Pushes stop part way and nothing records it. |
| `'system'` and `'coins'` are absent from `PUSH_TYPE_TO_PREF`, so `pushCategoryAllowed` returns true unconditionally. | Announcements bypass every notification preference, including `updates_push` and `surveys_push` which exist for this. |
| `audience === 'all'` runs `db.collection('users').select()`. | Guests, news bots and banned users all receive announcements. |
| The coins type increments `totalEarned`, capped at 1,000 per user with no total cap. | Re-introduces the grant-counted-as-earnings bug at mass scale, and 1,000 x 400 users is 400,000 coins from one click. Deleted outright per decision 2. |
| The Schedule step says on screen that scheduling is not built. | One of four wizard steps is a placeholder. |
| `functions/announcements.js` already does a single FCM topic send to every device, with an idempotency marker. The admin screen does not use it. | Two parallel systems exist and the screen picked the expensive one. |

---

## 1. Founder decisions, locked

These are the spec. Nothing may contradict them.

**D1 Threads.**
- Users can **delete** the chat and **clear** the chat and **mute** the channel.
- Users can **NOT** unsubscribe. The messages are important and always arrive.
- Users **can** turn off notifications for a channel, the same way as every other
  notification category.
- Ship the four proposed channels, and **channels must be creatable from admin**
  so more can be added later without a deploy.
- Everything is controlled from **admin**. The founder must never have to use the
  app itself to run this.
- **Support must be two way**, and the founder must be able to grant a user
  access to act as support staff.

**D2 No coin granting.** Delete that capability. What is wanted instead is
**sale announcements**: buy N coins and get extra coins, or get extra VP.
Configurable from admin, and it **must not affect payments**.

**D3 No bulk email.** Instead, a way to **edit the existing emails** (welcome,
password reset and so on).

**D4 What's New is public**, with **full control**. Never boxed in.

**D5 English only.** Auto-translate is added **only** once box 2 is restored.

**D6 Popup fires per announcement**, once, as an entrance popup. No recurrence
logic, no fatigue timer. That was an invented constraint and is removed.

**D7 Phase order is mine to choose.** Section 16.

---

## 2. Official channels in the message list

The primary channel. Vergr's own accounts sit in the message list as chats,
mixed in with real conversations, exactly as Tango does.

Observed in the founder's screenshot: "Tango Discounts" (a % icon avatar,
offers), "Tango" (brand logo, "Reminder: 10 Million Coins + 10..."), "Tango
Creator" (distinct purple gradient, "Emma Aven Is LIVE"), carrying unread badges
of 1, 14 and 18, interleaved with genuine DMs and sorted by recency in the same
list.

Four properties make it work, all deliberate:

1. **An official channel is a peer of a DM, not a special widget.** Same row
   component, same avatar treatment, same recency sort, no "system message"
   styling holding it at arm's length. That is why it gets opened. A design that
   visually quarantines these rows throws away the whole benefit.
2. **Messages accumulate in a thread instead of evaporating.** A notification is
   gone once dismissed; an unread count of 18 is a standing invitation.
3. **Separate identities let the user self-sort.** Muting offers does not cost
   you platform news.
4. **Rich previews.** The truncated line carries emoji and real copy, so the row
   sells the open before the tap.

Tango runs 14 and 18 unread. The mechanism is worth copying, that volume is not.

### 2.0 The four channels

| Channel | Handle | Purpose | Default push cap |
|---|---|---|---|
| Vergr | `@vergrnews` | Platform news, releases, maintenance | 3 / week |
| Vergr Offers | `@vergroffers` | Coin promos, subscription offers | 2 / week |
| Vergr Creators | `@vergrcreators` | Creator programme, payouts, monetisation | 3 / week |
| Vergr Support | `@vergrsupport` | Replies to reports and appeals, account notices | uncapped (transactional) |

**These are separate identities from the `@vergr` user account** (founder ruling,
2026-08-17). That account keeps posting to the feed; a channel is not the same
account wearing a different hat. The handles are deliberately distinct so the two
can never be mistaken for each other, and each is validated on creation against
`isDisallowedUsername` AND against the `usernames/` reservation index, so a
channel handle can never shadow or impersonate a real user's handle.

Vergr Support is the only two-way channel. The other three replace the composer
with a non-interactive notice.

More channels are creatable from admin at any time without a deploy (D1), which is
why the four are seeded through the same `adminUpsertChannel` callable the UI uses
rather than through a migration script.

### 2.1 Why this cannot be a `conversations` doc

`getConversations` queries `where('participants','array-contains',uid)`. A shared
conversation doc would appear in nobody's inbox, and a doc per user per channel is
N docs plus N message writes per send, which is the fan-out problem in a more
expensive form.

Second reason: per `reference-cleared-chat-watermark`, real chat message bodies
live on the relay and in the device's Dexie cache, not in Firestore. The relay
(`vergr-chat`) has **no source in the repo**, only a compiled binary on box 1.
Putting admin-authored broadcast messages through it would be building against a
binary we cannot rebuild. Official channel messages therefore live in Firestore,
which also gives durability across devices and reinstalls, which is right for
messages the user cannot unsubscribe from.

### 2.2 Data model

```
official_channels/{channelId}
  name              string      "Vergr", "Vergr Offers", ...
  handle            string      @vergrnews, @vergroffers  (thread header; never @vergr)
  avatarUrl         string      R2
  accentColor       string      hex, drives the avatar ring and header
  oneWay            bool        false only for Support
  order             number      inbox sort weight among official rows
  visibility        object      { segment } or null for everyone (see 2.6)
  active            bool        false hides it everywhere without deleting it
  messageCount      number      server-incremented
  lastMessage       string      denormalised preview text
  lastMessageAt     timestamp
  lastMessageId     string
  createdAt, createdBy

official_channels/{channelId}/messages/{messageId}
  body              string      limited markdown: bold, italic, link
  imageUrl          string|null
  videoUrl          string|null
  videoPosterUrl    string|null
  ctaLabel          string|null
  ctaUrl            string|null
  campaignId        string|null back-reference when sent by a campaign
  segment           object|null soft client-side filter, see 2.6
  createdAt         timestamp
  createdBy         string      admin uid, never shown to users
```

Per-user state is **one document**, not a map on the channel doc. A map keyed by
uid on a shared doc means every user writing the same document, which is
contention and unbounded document growth.

```
channel_state/{uid}
  channels: {
    [channelId]: {
      lastReadAt      number    ms
      lastReadId      string
      mutedUntil      number|true|null    matches MUTE_OPTIONS semantics
      clearedAt       number    hide messages at or before this
      deletedAt       number    hide the ROW until a message newer than this
      pinned          number|null
      archived        bool
    }
  }
  updatedAt
```

Cost per send: **one message write plus one channel doc update**, at any audience
size. Cost per user: one read of their own `channel_state` doc on app open, one
write when they open, mute, clear or delete a channel.

### 2.3 The three user actions, defined exactly

This is the part that must not be ambiguous, because D1 says delete is allowed
and unsubscribe is not.

| Action | Effect | Reappears? |
|---|---|---|
| **Mute** | No push. The channel stops contributing to the global unread badge. Messages still arrive and the thread still shows them. Reuses `MUTE_OPTIONS` (8 hours / 1 week / Always). | n/a |
| **Clear chat** | `clearedAt = now`. Messages at or before it are hidden at render. The row stays in the list. | The row never left. |
| **Delete chat** | `deletedAt = now` and `clearedAt = now`. The row disappears from the inbox. | **Yes.** The next message newer than `deletedAt` brings the row back with that message as the only content. This is what makes delete a tidy-up rather than an unsubscribe. |

Render rules, stated so any future cache reader gets them right (this is exactly
the class of bug `reference-cleared-chat-watermark` records):

- Show the row if `channel.lastMessageAt > max(clearedAt, deletedAt)` OR
  `deletedAt` is unset.
- Show a message if `message.createdAt > clearedAt`.
- Unread count is messages with `createdAt > lastReadAt`, and contributes to the
  global badge only when not muted.

There is deliberately **no unsubscribe control anywhere in the UI**, and no
server path that would let a user opt out of receiving a channel message.

### 2.4 Reusing the existing inbox with zero component churn

The existing helpers in `src/utils/chatOps.js` read per-user state off the
conversation object: `isChatMutedFor(chatInfo, uid)` reads `chatInfo.muted[uid]`,
`isChatPinnedFor` reads `pinned[uid]`, `isChatArchivedFor` reads `archived[uid]`,
and `sortInboxChats` sorts on those plus `lastMessageAt`.

So the synthetic row is built to **that exact shape**:

```js
{
  id: `official:${channelId}`,
  isOfficial: true,
  isGroup: false,
  participants: [uid],
  lastMessage, lastMessageAt, lastSenderId: channelId,
  muted:    { [uid]: state.mutedUntil ?? undefined },
  pinned:   { [uid]: state.pinned ?? undefined },
  archived: { [uid]: state.archived || undefined },
  unreadCount: { [uid]: computedUnread },
  otherUsers: [{ id: channelId, displayName: name, avatar: avatarUrl, isOfficial: true }],
}
```

Every existing helper, the archive folder, pin ordering, unread filter and search
then work unchanged. This is the whole reason for matching the shape rather than
inventing a parallel one.

### 2.5 Build steps

**Step 1. Collections and rules.**
- Add `official_channels` (+ `messages` subcollection) and `channel_state` to
  `firestore.rules`: channels and messages are **public read, server-only write**;
  `channel_state/{uid}` is **owner read and write**, with a field allowlist so a
  client cannot write anything except the six state fields.
- Indexes: `official_channels` by `active` + `order`; messages by `createdAt` desc.
- Done = rules deploy, a manual doc read from the client succeeds, a client write
  to a channel doc is denied.

**Step 2. Channel registry callables** (`functions/officialChannels.js`, new).
- `adminUpsertChannel({ channelId?, name, handle, avatarUrl, accentColor, oneWay, order, visibility, active })`.
  Creates or edits. Slug-validates `channelId`, rejects collisions with reserved
  handles by reusing `isDisallowedUsername` from `functions/usernameIndex.js` so
  an official handle can never collide with or impersonate a user handle.
- `adminListChannels()`, `adminSetChannelActive({ channelId, active })`.
- `adminSendChannelMessage({ channelId, body, media, cta, segment, campaignId? })`:
  one transaction writing the message and bumping
  `messageCount`/`lastMessage`/`lastMessageAt`/`lastMessageId`.
- All wrapped in `guardedAdmin` with the `announcements` screen scope and audited.
- **Seed the four channels** (D1) through this same callable, not a migration
  script, so the creation path is exercised by its first use.
- Done = the four channels exist, created from the admin UI, and a fifth can be
  created without a deploy.

**Step 3. Client read layer** (`src/firebase/officialChannels.js`, new).
- `subscribeOfficialChannels(cb)`: `onSnapshot` on `official_channels` where
  `active == true`, ordered by `order`. A handful of docs, cached by the SDK.
- `subscribeChannelState(uid, cb)`: `onSnapshot` on `channel_state/{uid}`.
- `buildOfficialRows(channels, state, uid)`: pure function producing the
  synthetic rows in the 2.4 shape, applying the 2.3 render rules. Pure so it is
  unit-testable without Firestore.
- `setChannelMuted`, `clearChannel`, `deleteChannelChat`, `markChannelRead`:
  single merge writes to `channel_state/{uid}`.
- Done = `buildOfficialRows` has unit tests covering muted, cleared, deleted, and
  deleted-then-new-message.

**Step 4. Inbox integration** (`MessagesInboxScreen.jsx` and the native mirror).
- Merge the synthetic rows into the same array the screen already filters, before
  `sortInboxChats`. One insertion point.
- The row renders through the **existing DM row component**, unchanged, with only
  an official badge on the avatar. No new row component. This is a hard
  requirement, not a preference: a bespoke row is how these drift into looking
  like system notices.
- Swipe/long-press menu gains Mute, Clear chat, Delete chat for official rows and
  hides Block/Report, which are meaningless against a platform channel.
- Done = the four channels appear in the inbox on a real account, sort by
  recency alongside DMs, and all three actions behave per the 2.3 table
  including a deleted channel reappearing on the next message.

**Step 5. Thread screen.**
- `/messages/c/:channelId` renders the message list from Firestore rather than the
  relay. Reuses the existing bubble components.
- Header shows the channel identity and, for `oneWay`, replaces the composer with
  a non-interactive notice. Support keeps a working composer.
- Opening writes `lastReadAt`/`lastReadId` once, debounced.
- Media renders inline: image with a lightbox, video with the existing player.
- Done = a message with an image, a video and a CTA renders correctly, the
  composer is absent on a one-way channel and present on Support.

**Step 6. Push preferences per channel** (D1: "turn off notification like they do
with all other notifications").
- Add to `PUSH_TYPE_TO_PREF` in `functions/index.js`:
  `channel_vergr: 'updates'`, `channel_offers: 'offers'`,
  `channel_creators: 'creator'`, `channel_support: 'support'`.
- `offers`, `creator` and `support` are new preference keys. Add them to the
  Settings notification screen with the same control the existing ones use.
- **`support` is transactional and defaults to on**; a user muting account
  notices is a support burden, so it is togglable but warned about.
- The delivery worker skips push for a user whose channel is muted OR whose
  preference is off. The message still lands in the thread either way, which is
  precisely the D1 split: **delivery is not optional, notification is**.
- Done = muting a channel stops its push and leaves the message in the thread.

### 2.6 Channel and message targeting

`official_channels.visibility.segment` decides who **sees the channel at all**
(Vergr Creators only for enrolled creators, for example). Evaluated client-side
from the profile already in memory, and enforced nowhere else, because the
messages are world-readable by design.

`messages.segment` is an optional soft filter for "this message is for Pro users".
Also client-side.

**Consequence, stated plainly: nothing personalised, private or sensitive may go
in a broadcast thread.** A shared thread is a public bulletin board with a nice
avatar. Anything genuinely per-user is a real notification or a real DM, and the
composer must warn when a message contains what looks like personal data.

---

## 3. Support channel and support staff (D1)

The one two-way channel, and the only part of this that needs an inbox on the
admin side.

**Data.** A support conversation is per-user and therefore a real document:

```
support_threads/{uid}
  uid, status: open|pending|closed, assignedTo, priority,
  lastMessage, lastMessageAt, lastSenderRole: user|agent,
  unreadForAgent: number, unreadForUser: number, tags[]
support_threads/{uid}/messages/{id}
  body, media, senderRole, senderUid, agentDisplayName, createdAt, internal: bool
```

`internal: true` messages are agent-only notes, never rendered to the user. That
is the field most support tools regret not having on day one.

**Agent access, granted from admin (D1).**
- Add `'support'` to `ADMIN_SCREENS` in `functions/adminAccess.js`.
- A support agent is an `admin_users` doc with `allowedScreens: ['support']` and
  nothing else. That reuses the whole existing invite, scope and audit machinery
  rather than inventing a second permission system.
- `requireAdminScreen(uid, 'support')` gates every support callable.
- Agents get an **identity for display**: `admin_users.supportDisplayName`
  (default "Vergr Support") so a user never sees a real name or uid. This matches
  the Vanguard masking principle already in the product.

**Admin surface** `/admin/support`: queue list with filters (open, unassigned,
mine, pending, closed), a thread pane, canned replies, assign, tag, priority,
close, and internal notes. The founder never opens the app to answer support,
per D1.

**Build steps.**
1. Collections and rules: `support_threads/{uid}` readable and creatable by that
   uid; messages creatable by the owner (with `senderRole: 'user'` forced by
   rules) and by the server; `internal` messages readable server-side only.
2. `functions/support.js`: `userSendSupportMessage`, `agentListThreads`,
   `agentSendMessage`, `agentSetStatus`, `agentAssign`, `agentAddNote`.
3. Push to the user on an agent reply, type `channel_support`.
4. `/admin/support` screen.
5. The user-side entry point is the Support channel row in the inbox, plus a
   "Contact support" action from Settings and from a report/appeal outcome.
- Done = a user sends a message from the app, it appears in `/admin/support`, an
  agent with only the `support` scope can reply and cannot reach any other admin
  screen, and the user receives the reply as a push and in the thread.

---

## 4. Notification drawer

Announcements currently land here indistinguishable from "someone liked your
post".

**Build steps.**
1. Extend the drawer's data source: it keeps `subscribeToNotifications` for
   per-user events and additionally reads active campaign docs whose `surfaces`
   include `drawer` and whose segment matches, merged and sorted client-side. No
   per-user notification writes for broadcasts.
2. A distinct platform-message row: Vergr mark, channel identity, title, body,
   optional thumbnail, optional CTA. Visually a peer, not a banner.
3. Read state per campaign in `announcement_reads/{campaignId}__{uid}`, which is
   also where the impression metric comes from, so tracking is free.
4. Identity masking still applies (the drawer sender mask is an open TODO in
   CLAUDE.md; do not make it worse).
- Done = one campaign appears in every recipient's drawer with zero per-user
  writes at send time.

---

## 5. Entrance popup (D6)

Fires once per user per campaign, on the next app entrance. No recurrence, no
fatigue timer.

**Build steps.**
1. `<AnnouncementPopup>` mounted once in `ResponsiveLayout`, alongside the
   existing `GuestSignupPrompt`.
2. On mount, pick the newest active campaign with a `popup` surface that the user
   matches and has no `announcement_reads` entry for.
3. **Synchronous suppression first.** Check a `localStorage` key before the
   Firestore read so a dismissed popup never flashes on that device. Per
   `reference-first-frame-needs-sync-data`, localStorage is the only render-time
   read available. The Firestore doc is the cross-device source of truth and the
   localStorage key is the anti-flicker cache.
4. Suppress while a call, stream or checkout is active. Everything else about
   when it shows is a per-campaign toggle with a sensible default, so the founder
   is never boxed in (D4's principle applied here too).
5. Renders heading, body, image or video (autoplay muted), one primary CTA and a
   dismiss. Dismiss and CTA both write `announcement_reads` so it never returns
   and both are measured separately.
- Done = the popup shows once, on entrance, never again on any device, and the
  dismissal survives a reinstall.

---

## 6. Push

**Build steps.**
1. **Topic subscription.** Extend the existing token-save path
   (`src/utils/pushNotifications.js` already subscribes to the `announcements`
   topic) to also subscribe `tier_<t>`, `plat_<p>`, `locale_<l>`,
   `role_creator`. Unsubscribe and resubscribe on tier change.
2. **Segmented topic send.** FCM condition expressions combine up to 5 topics, so
   "Pro on Android in English" is one send at any audience size. Reuse the
   `functions/announcements.js` pattern.
3. **Token-list fallback** only where topics cannot express the segment, in pages
   of 500 with `delivery.cursor` advanced per page so a timeout resumes rather
   than restarts.
4. **Preferences respected** via the new keys in 2.5 step 6.
5. **Image support**: the payload is data-only today and the service worker builds
   the notification, so add an image field to the payload and render it in the SW
   and in the native notification builder. Android shows BigPicture; iOS Safari
   web push ignores it.
6. **Quiet hours** 22:00 to 08:00 local for non-transactional push, held to the
   next window rather than dropped. Per-campaign override.
- Done = one campaign to all Pro users costs one FCM call, and a user with the
  category off receives nothing.

---

## 7. Service banner

Not requested. Kept as a proposal because Vergr can pause streaming and free
uploads platform-wide with **no way to tell anyone why**. One active banner doc,
read on app open, dismissal in `localStorage` plus the read-state doc, severity
colouring, expiry. Scheduled last so it never blocks the requested work.

---

## 8. What's New page (D4: public, full control)

Public and indexed, and the founder controls every lever.

**Build steps.**
1. `announcements/{id}.surfaces.whatsNew = { slug, category, publishedAt, noindex }`.
   Nothing appears here unless that surface is explicitly selected. There is no
   auto-publish.
2. Route `/whats-new` (list) and `/whats-new/:slug` (entry). Add both to
   `public/sitemap.xml` and the marketing list in `scripts/prerenderHelp.mjs`,
   which is how the rest of the marketing surface is already indexed.
3. **Full control, concretely:**
   - Per entry: publish, unpublish, edit after publishing, delete, and a
     **per-entry `noindex` toggle**.
   - Global: `app_config/general.whatsNewEnabled` and `whatsNewIndexable`, so the
     whole section can be pulled or de-indexed in seconds with no deploy.
   - An unpublished or deleted slug returns **410 via `functions/gone.js`**, which
     is the pattern already used for the removed help articles, rather than a
     soft 404.
4. Canonical URL comes from the entry, not the route, per
   `reference-canonical-from-entity`.
5. **Do not touch noindex or sitemap policy on any other URL set** while doing
   this. `project-seo` records that a noindex sweep was tried and reverted, and
   that indexation status must be read from Search Console before any such
   change. This section adds URLs; it changes nothing existing.
- Done = an entry is live at a stable URL, prerendered, in the sitemap, and can
  be de-indexed or pulled from admin without a deploy.

---

## 9. Coin sale promos (D2)

Replaces coin granting entirely. "Buy N coins, get extra coins or extra VP",
configured in admin, **without touching payments**.

### 9.1 The design rule that keeps payments untouched

**A promo changes the quantity delivered, never the price charged.**

PayRam and Play Billing keep charging exactly the same USD. The server adds bonus
coins or VP when it credits the purchase. Nothing in the pricing, checkout, cart,
tax or settlement path changes. That is the whole reason this is safe, and it is
also why the price must never be discounted instead.

Supporting facts: `COIN_PACKS` in `src/utils/vpSystem.js` already carries a
`vpBonus` field, live on Titan (+1,500) and Ascendant (+3,000). Bonus-on-purchase
is an existing, shipped concept, not a new mechanism.

### 9.2 The two credit paths must share one source

There are two independent server-side pack maps with deliberately different coin
counts, because Play takes 30%:

| Path | File | Example |
|---|---|---|
| Web (card and crypto via PayRam) | `functions/payram.js` PACKS | `pro: 815 coins / $9.99` |
| Android (Play Billing) | `functions/playBilling.js` PLAY_PRODUCTS | `coins_pro: 1000 coins` |

A promo applied in one and not the other silently works on web and not Android.
This codebase has been bitten by mirrored constants repeatedly, so the promo
resolver is **one shared module both require**, never two copies.

### 9.3 Data model

```
coin_promos/{promoId}
  name              string
  active            bool
  startsAt, endsAt  timestamp
  appliesTo         'all' | { packIds: [...] }     custom amounts excluded by default
  bonus: {
    kind            'coins_pct' | 'coins_flat' | 'vp_flat' | 'vp_pct'
    value           number
    minSpendUSD     number|null
  }
  perUserLimit      number|null    redemptions per user, null = unlimited
  totalLimit        number|null    global redemption cap
  redemptions       number         server-incremented
  bonusCoinsIssued  number
  bonusVpIssued     number
  campaignId        string|null    the announcement that promotes it
  createdBy, createdAt
```

### 9.4 Build steps

**Step 1. Shared resolver** (`functions/coinPromos.js`, new).
- `resolveActivePromo({ now })`: returns at most one active promo. If more than
  one is active, the highest bonus wins and the collision is logged, because
  stacking promos is how you give away the treasury by accident.
- `bonusFor({ promo, packId, coins, priceUSD, uid })`: returns
  `{ bonusCoins, bonusVp, promoId }` or zeroes. Pure and unit-testable.
- **Server only.** The client never computes a bonus. Per
  `reference-client-side-price-constant` the client sends WHAT, not HOW MUCH, and
  that rule extends to bonuses.
- Done = unit tests for each `bonus.kind`, for `minSpendUSD`, for the window
  boundaries, and for the multi-promo collision.

**Step 2. Wire both credit paths.**
- `payram.js`: at order construction (where `order = { kind, sku, coins, vpBonus, priceUSD }`
  is built), add the bonus to `coins` and `vpBonus` and stamp `promoId` on
  `payram_orders/{ref}`. Settlement already credits `coinsToCredit` and `vpBonus`,
  so no settlement change at all.
- `playBilling.js`: same, in `redeemPlayPurchase` where `{ coins, vpBonus }` comes
  out of `PLAY_PRODUCTS`.
- Both stamp `promoId` on the transaction row so the bonus is auditable and
  distinguishable from the base purchase forever.
- Done = a test purchase on each path credits base plus bonus, the price charged
  is unchanged, and the transaction rows show which promo applied.

**Step 3. Redemption limits and idempotency.**
- `promo_redemptions/{promoId}__{uid}__{orderId}` written in the same transaction
  as the credit, so a webhook replay cannot double-issue a bonus.
- `perUserLimit` and `totalLimit` checked in that transaction, not before it.
- Done = replaying a settled PayRam webhook issues the bonus exactly once.

**Step 4. Admin surface** `/admin/economy` new "Promos" tab.
- Create, edit, activate, deactivate, schedule, and a live readout of
  redemptions, bonus coins issued and bonus VP issued.
- A **projected cost** figure before activation: bonus per purchase times an
  expected redemption count, so the giveaway is a number you saw first.
- Done = a promo is created, scheduled, runs, and its cost is visible without a
  Firestore console.

**Step 5. Store display.**
- Coin pack cards show the bonus as a badge, read from a
  `getActiveCoinPromo` callable, never computed client-side.
- The badge styling reuses the existing `badgeStyle: 'vp'` treatment already used
  by Titan and Ascendant.
- Done = the store shows the promo and the amount shown matches what the server
  credits, verified on both web and Android.

### 9.5 One decision I will not make alone

**Bonus VP is unambiguously safe.** VP has no monetary path out of the platform.

**Bonus COINS need your call, because of a specific interaction.** The comment in
`src/utils/vpSystem.js` warns that coins must never be discounted because they
"redeem back into money at a fixed rate", and the old arbitrage was buy cheap,
tip, withdraw. Withdrawal is deleted, so that exact loop is gone. But the
revenue-share path is not: **a creator who receives tips accrues real USD in
`wallets.owedMicroUsd` at the full rate.** So discounted coins tipped to your own
second account convert a promo into a real, payable liability at the undiscounted
rate.

Three options:
- **(a) VP-only promos.** Zero financial exposure. Weakest sales lever.
- **(b) Bonus coins that are flagged non-earning**, so tipping them credits the
  creator nothing. Closes the loop completely, but it makes two classes of coin,
  which is real complexity in the ledger and could surprise a creator.
- **(c) Bonus coins, accepted as a marketing cost**, with a total issuance cap per
  promo, exclusion of self-tipping between linked accounts, and monitoring of
  `owedMicroUsd` growth against coin sales.

My recommendation is **(c) with a hard cap**, because the exposure is bounded by
the cap and (b)'s two-tier coin is the kind of complexity that causes a worse bug
later. But this is money and per your standing instruction I am not choosing it.

---

## 10. Editing the existing emails (D3)

No bulk email. An editor for the emails already sent.

### 10.1 What actually exists, honestly

| Email | Sent by | Editable? |
|---|---|---|
| Verification code | **Ours.** `functions/emailVerification.js` over Spacemail SMTP, hardcoded HTML in `buildEmail()`. Dormant because `SMTP_USER`/`SMTP_PASS` are the literal string `'placeholder'`. | Fully, once templated |
| Password reset | **Firebase's.** Client `sendPasswordResetEmail`; the admin path only generates a link to copy. | Only via Firebase Console, and only crudely |
| Welcome email | **Does not exist.** The "Welcome to VERGR" is an in-app notification, not an email. | Would be new |

So "edit current emails" is really three jobs: template the one we own, take over
the one Firebase owns, and create the welcome email that was assumed to exist.

Taking over password reset means generating the link with
`getAuth().generatePasswordResetLink(email)` and sending it ourselves. That gives
total design control and requires the same two SMTP secrets. Everything here is
free: SMTP is already in the Spacemail plan and nodemailer is already a
dependency.

### 10.2 Build steps

**Step 1. Template store and renderer** (`functions/emailTemplates.js`, new).
```
email_templates/{templateId}      # verification, password_reset, welcome, ...
  subject           string        {{name}} style tokens
  preheader         string
  blocks            array         see the block table below
  updatedAt, updatedBy
  version           number        incremented on save
```
`renderEmail(templateId, vars)` produces HTML **and** a plain-text alternative
from the same blocks. HTML-only is a spam signal, so plain text is generated, not
optional. Falls back to the shipped default if the doc is missing, so a bad edit
can never break password reset.

**Step 2. Block set.** Table layout with inline styles, because email clients
demand it. The existing `buildEmail()` dark violet card is the proven base.

| Block | Notes |
|---|---|
| Hero image | max 600px, alt text required |
| Heading | |
| Paragraph | bold, italic, link |
| Code pill | the big monospaced code, as today |
| Button | rendered as a table cell, not a styled anchor, because Outlook |
| Divider | |
| Footer | logo, address, preferences link. Auto-appended, not authorable |

Explicitly **no video block.** Email clients do not play video and a design that
implies otherwise is lying about what the recipient sees.

**Step 3. Admin surface** `/admin/emails`.
- Template list, block editor, token reference, live iframe preview of the real
  rendered HTML, plain-text preview, version history with restore, and
  **"send test to me"**.
- A visible readout of SMTP configuration status, so it is obvious when email is
  dormant rather than silently failing.

**Step 4. Retrofit verification** to read its template from the store.
- Done = editing the template in admin changes the next verification email, and
  deleting the doc falls back to the shipped default.

**Step 5. Take over password reset** (only if you want the design control).
- New `sendPasswordResetEmail` callable using `generatePasswordResetLink` plus our
  template. Client switches to it with a fallback to Firebase's on failure, so a
  broken SMTP can never lock anyone out of their account.
- Done = the reset email is ours, and killing SMTP falls back to Firebase's.

**Step 6. Welcome email**, new, sent on first sign-in completion, behind the
`updates` preference.

**Founder action required, five minutes, no code:** create the
`noreply@vergr.app` mailbox in Spacemail and run
`firebase functions:secrets:set SMTP_USER` and `SMTP_PASS`. Nothing in section 10
delivers a real email until that is done. Also worth verifying that the SPF, DKIM
and DMARC records added by hand in Cloudflare cover the `noreply@` identity, or
these land in spam.

---

## 11. The campaign object

One document is the campaign; every surface derives from it.

```
announcements/{campaignId}
  title                 string      internal name, never shown to users
  status                enum        draft | scheduled | sending | sent | paused | recalled | failed
  createdBy, createdAt, updatedAt
  idempotencyKey        string

  content: {                        English only for now (D5), map kept for later
    en: { heading, body, imageUrl, videoUrl, videoPosterUrl, ctaLabel, ctaUrl }
  }

  surfaces: {
    thread:   { channelId } | null
    drawer:   true | null
    popup:    true | null                     once per user, no recurrence (D6)
    push:     { quietHours: bool } | null
    banner:   { severity, expiresAt } | null
    feed:     { postId } | null
    whatsNew: { slug, category, noindex } | null
  }

  segment: {
    include: { tiers, platforms, locales, countries, roles, activity, accountAge, hasPurchased, creatorEnrolled }
    exclude: { guests: true, bots: true, banned: true, uids: [] }   # first three forced true server-side
  }
  estimatedRecipients   number

  scheduleAt            timestamp|null
  expiresAt             timestamp|null
  promoId               string|null           links a sale announcement to its promo

  stats: { targeted, pushSent, pushFailed, impressions, opens, clicks, dismissals }
  delivery: { startedAt, completedAt, cursor, perSurface: {...}, errors[] }
```

Note what is absent: no `grant` block. Coin granting is deleted per D2 and
replaced by `promoId` pointing at a `coin_promos` doc.

---

## 12. Delivery engine

**The callable never sends anything.** It validates, computes the segment
estimate, writes the campaign, returns. A worker does the work. That is what makes
scheduling, cancel, pause, resume and honest metrics possible, and it is the same
shape as the creator payout run that already exists.

Worker order:
1. **O(1) surfaces:** thread message, drawer campaign doc, popup availability,
   banner, whatsNew entry. One write each, because they are shared documents read
   by clients rather than fan-outs.
2. **Push:** topic condition send, or resumable paged token-list.
3. **Feed post** if selected, reusing `postAnnouncement`.

Idempotency: every unit of work keyed `{campaignId, surface, uid|page}`, so a
retry is a no-op.

Scheduling rides the existing `cron5Min` dispatcher. **No new Cloud Scheduler
job**, so no added recurring cost. Per the founder's standing instruction, nothing
here adds a scheduled scan whose cost is proportional to the user table.

Recall: sets `status: 'recalled'`, which immediately stops passive surfaces
rendering. It **cannot** unsend a push, and the UI must say so rather than
implying otherwise.

### 12.1 Segmentation, and which fields are actually ready

Built from fields that already exist. The readiness column matters because two of
these need work before the segment builder can offer them honestly.

| Dimension | Source | Ready? |
|---|---|---|
| Tier | `users.subscription` | Yes |
| Creator | `payout_accounts.enrolled`, `wallets.totalEarnedCoinsGross > 0` | Yes |
| Activity recency | `users.lastSeen` | Yes, and correct only since the Users-screen fix. `lastActiveAt` is written once at signup and must never be used |
| Account age | `users.createdAt` | Yes |
| Vanguard rank | `users.vanguard.rank` | Yes |
| Squad membership | `squads` | Yes |
| Explicit uid list | pasted or CSV | Trivial |
| Locale | `users.settings.language` | Needs checking that it is actually written |
| Country | `functions/geo.js` | Partial |
| **Platform** | none | **Missing.** Needs a `lastPlatform` field written on FCM token save. Small addition, and it is the segment behind "the new APK is out", so it is worth doing in Phase 1 |
| **Has purchased** | coin purchase transactions | **Missing as a queryable field.** Needs a `hasPurchased` flag or a counter on the wallet, because scanning transactions per campaign does not scale |

Forced server-side on every campaign, never a checkbox someone can forget:
exclude guests (`isGuest`), bots (`accountType` contains `bot`), and banned users.

Every segment gets a **dry run** returning the real count plus a sample of ten
matching accounts before anything is scheduled. The audience size should never be
something you learn from the send.

**Push fatigue.** D6 removes popup recurrence limits, but push still needs a
ceiling or opt-out rates collapse and you do not get a user back once they
disable notifications at the OS level. Proposed: max 5 non-transactional pushes
per user per 7 days, per-campaign override, and transactional (support, payout,
security) exempt. A campaign that would breach the cap for a given user skips
**that user's push only** and records it in `stats`; the message still lands in
the thread, per D1.

### 12.2 Measurement

The funnel, per surface:

```
targeted -> delivered -> impression -> open -> click
                      \-> dismissal
```

**Steps.**
1. Impressions, opens, clicks and dismissals all come free from
   `announcement_reads/{campaignId}__{uid}`: the client already has to write that
   doc to track read state, so it carries the metrics at no extra cost.
2. Click tracking through a redirect endpoint so the number is reliable, with the
   target link recorded per campaign.
3. Aggregate with `FieldValue.increment` on a counter doc, never by rewriting the
   campaign doc, to avoid write contention on a hot document.
4. Campaign detail page shows the funnel, the per-surface breakdown, the top
   clicked link and a sampled error list.
5. Channel-level view: messages sent, average unread age, mute rate and delete
   rate per channel. **Mute rate is the health metric that matters**, because it
   is the earliest signal that a channel is being overused, and it is visible long
   before anyone complains.

---

## 13. Admin UI

Everything is controlled from admin (D1). Three areas plus the two new screens.

**`/admin/announce` becomes three tabs.**

- **Campaigns.** Status pill, surfaces as icons, audience size, schedule, headline
  funnel per row. Filters by status and surface. Detail page with the funnel,
  per-surface state, error sample, and actions: duplicate, edit (draft and
  scheduled), cancel, pause, recall.
- **Composer**, one page rather than steps:
  - Left: content, media pickers, CTA.
  - Middle: surface toggles, each revealing only its own options and greying out
    media the surface cannot render.
  - Right: previews that render the **real components**: the actual inbox row, the
    actual drawer row, the actual popup, an OS push mock. The current preview is
    an invented card that matches nothing.
  - Bottom: segment builder with live recipient count, dry run, schedule, send.
- **Channels.** Create and edit channels (D1), avatar upload, accent colour,
  one-way flag, ordering, visibility, activate and deactivate. Plus a per-channel
  message composer for a one-off message that is not a full campaign, because most
  channel posts will be exactly that.

**New screens:** `/admin/support` (section 3) and `/admin/emails` (section 10).
**Extended:** `/admin/economy` gains the Promos tab (section 9).

---

## 14. Media

- Add `announcement` to `ALLOWED_KINDS` in `functions/r2.js`.
- New `announcement` preset in `compressMedia`: images to 1200px WebP, video to
  1080p VP9 WebM. WebM is the project standard and must not be switched to MP4.
- Caps: image 400KB, poster 200KB, video 20MB.
- Poster frame extracted client-side from the first frame.

Per-surface support, so the composer can grey out what will not work:

| Surface | Image | Video |
|---|---|---|
| Thread | yes | yes, inline |
| Drawer | thumbnail | no, links out |
| Popup | yes | yes, autoplay muted |
| Push | Android and native only | no |
| Banner | icon | no |
| Feed | yes | yes, existing pipeline |
| What's New | yes | yes |

---

## 15. Safety, rules, indexes

- TOTP step-up on send, already present, kept.
- Type-the-recipient-count confirmation above 1,000.
- `app_config/general.announcementsPaused` kill switch, matching the existing
  switch pattern.
- Guests, bots and banned users excluded **server-side**, not by a checkbox.
- Every campaign, channel, promo, support and email-template action audited.
- Sub-admin split: drafting and sending are separable scopes.
- Rules: campaigns and channels public-read where sent and active, server-write;
  `channel_state/{uid}` and `announcement_reads/{campaignId}__{uid}` owner-write
  with a field allowlist; support threads owner plus agent, `internal` notes
  server-side only.
- Indexes: `announcements` by status + scheduleAt and status + createdAt;
  `official_channels` by active + order; channel messages by createdAt;
  `support_threads` by status + lastMessageAt and assignedTo + lastMessageAt;
  `coin_promos` by active + startsAt.

---

## 16. Phase order (D7, my call)

Ordered so each phase is independently useful and nothing half-lands.

**Phase 1. Foundation and the message-list channel.** Campaign object, worker
delivery, idempotency, real Campaigns tab replacing the empty History, dry run,
server-side exclusions, drawer surface, and the four official channels end to end
including mute, clear, delete and the notification preferences. Delete
`sendAnnouncement` only once its replacement is live.

Why first: it is the channel you actually pointed at, it removes every broken
behaviour in section 0, and it is the piece the rest hangs off.

**Phase 2. Coin sale promos.** Self-contained, touches money, and it is the thing
with direct revenue upside. Needs decision 9.5 answered before it starts. Its
announcement side is already done by Phase 1.

**Phase 3. Support.** Two-way threads, agent scopes, `/admin/support`. Sits on
Phase 1's channel row so the entry point already exists. Deliberately after
promos because a sale drives volume and I would rather support exist before that
volume arrives, but it is one place behind because promos are the smaller build.

**Phase 4. Reach and polish.** Topic push, scheduling, entrance popup, media,
What's New.

**Phase 5. Emails.** Template store, editor, retrofit verification, password
reset takeover, welcome email. Last because it is gated on your SMTP secrets and
DNS verification, not on code.

**Phase 6. Service banner**, and the auto-translate hook once box 2 is restored
(D5). `infra/box2-restore/` holds the runbook.

---

## 17. Open questions

Only one that blocks work, plus two small ones.

All three resolved by the founder on 2026-08-17. Kept here as the record of what
was decided and why.

1. **RESOLVED, Phase 2:** the founder ruled the `vpSystem.js` "never discount
   coins" warning outdated. Half of it is: coins no longer redeem back into money
   for the BUYER, because withdrawal was deleted 2026-08-16, so the original
   arbitrage loop is closed. The half that survives is different and bounded: a
   tipped coin still accrues real USD in `wallets.owedMicroUsd` at the FULL rate,
   so a discounted coin creates an undiscounted liability. That is a marketing
   cost, not a hole. Promos therefore build on **option (c): bonus coins with a
   hard per-promo issuance cap**, plus monitoring of `owedMicroUsd` growth against
   coin sales. The stale comment in `src/utils/vpSystem.js` gets corrected in
   Phase 2 when that file is touched, not before, to avoid churn.
2. **RESOLVED: channels are separate identities** from the existing `@vergr` user
   account. See the table in section 2.
3. **RESOLVED: Support sits alongside** the existing appeals path, it does not
   replace it.

   Flagged, not absorbed: the founder noted he has never seen the appeals surface
   himself. Appeals do exist (`submitAppeal` writes them, `/admin/reports` reads
   them) but the user-side appeal UI is still open in CLAUDE.md under Moderation
   pass-3. Out of scope here and deliberately not folded in, but the two want
   joining up later, because an appeal outcome is exactly the sort of message that
   should land in the Support thread.

---

## 18. Constraints I cannot remove

- **Nothing in section 10 sends a real email until you set the two SMTP secrets.**
- **Cross-client email rendering cannot be verified from here.** No free service
  does it reliably; it means real test sends to Gmail, Outlook and Apple Mail.
- **A shared broadcast thread is world-readable.** Nothing personalised may go in
  one.
- **Recall cannot unsend a push.**
- **iOS Safari web push ignores notification images.** The native app is where
  rich push works.
- **Auto-translate is not available until box 2 returns** (D5), so content is
  English only and the locale map is a placeholder for later.
- I cannot verify the live admin screens in a browser from here, because the
  in-app browser has no session and I will not enter your credentials.
  Verification is against the built artifact and the deployed function list.

---

## 19. Build log

Appended as work lands. "Deployed" means verified against
`firebase functions:list` or a rules deploy, not against the command that was typed.

### Phase 1, slice 1: official channels backend. DONE + DEPLOYED 2026-08-17

| Piece | State |
|---|---|
| `firestore.rules`: `official_channels` (+ `messages`) public-read / server-write, `channel_state/{uid}` owner-only with a `hasOnly(['channels','updatedAt'])` field allowlist | deployed |
| Index `official_channels` active + order | deployed |
| `functions/officialChannels.js` | deployed |
| `adminUpsertChannel`, `adminListChannels`, `adminSetChannelActive` | deployed |
| `adminSendChannelMessage`, `adminListChannelMessages`, `adminDeleteChannelMessage` | deployed |
| `setChannelPushSubscription`, `onChannelMessageCreated` | deployed |
| `src/firebase/officialChannels.js` client layer + pure `buildOfficialRows` | written, not yet wired to the inbox |
| `isDisallowedUsername` / `normHandle` exported from `usernameIndex.js` | done |

**Two design improvements made during the build, both better than what this doc
originally specified:**

1. **Push rides a PER-CHANNEL FCM topic** (`chan_<channelId>`), not a per-user
   fan-out, and not the single global `announcements` topic. Two wins. Cost: one
   FCM call per channel message at any audience size. Correctness: **mute becomes
   real at the transport layer**, because a muted user is unsubscribed from the
   topic, so no push is ever addressed to them. The original sketch read a
   preference per user at send time, which is both expensive and easy to get
   wrong. Section 6's topic work is therefore partly done already.
2. `onChannelMessageCreated` **deliberately does not push for a message carrying
   a `segment`.** A segment is a soft client-side render filter and a topic send
   cannot honour it, so pushing would notify people who will never see the
   message. Segmented messages land silently in the thread.

**Tested, not eyeballed.** 25 assertions, all passing:
- `assertNotPersonal` and `previewOf` (13): allows normal copy, our own
  `@vergr.app` addresses, https links, long compound words, prices, emoji and
  markdown; blocks a user email, a Firebase uid and a card number. Found and fixed
  a real bug: stripping a separator that merely PRECEDED the digits welded them to
  the previous word and destroyed the `\b` the card test needs, so
  "card 4111 1111 1111 1111" matched nothing. Now uses a lookbehind.
- `buildOfficialRows` (12): visibility, tier segment, read state, mute forever,
  expired mute, cleared, cleared-then-new, deleted, **deleted-then-new brings the
  row back**, and that the emitted shapes are exactly what `chatOps.js` reads.

That deleted-then-new case is the D1 contract in test form: delete is a tidy-up,
never an unsubscribe.

**Note on the deploy:** the first attempt failed with
`User code failed to load. Cannot determine backend specification. Timeout after 10000`.
Both modules were verified to load locally in ~1.5s with no error, so it was a
cold-discovery timeout, and the retry succeeded. Worth knowing before anyone
starts debugging a phantom load error.

### Phase 1, slice 2: the channel appears in the app. DONE + DEPLOYED 2026-08-17

| Piece | State |
|---|---|
| `chatPartner` in `src/utils/chatIdentity.js` gained an `isOfficial` branch | done |
| `MessagesInboxScreen` merges synthetic rows into the array it already filters | done |
| `InboxRow` routes, badges and swipe-acts correctly for official rows | done |
| `ChannelThreadScreen` at `/messages/c/:channelId` | done |
| Route nested INSIDE the messages master-detail | done |
| `AdminChannelsTab` on `/admin/announce`, now the default tab | deployed |
| `announcement` added to R2 `ALLOWED_KINDS`, `getR2UploadUrl` redeployed | deployed |

**Decisions taken during this slice:**

- **Official identity went into `chatPartner`, not into each callsite.** That
  function's own comment calls it the one shared resolver for every chat surface.
  Without the branch it resolved `otherId` to null and rendered "Unknown" with no
  avatar, because an official row's `participants` is just `[me]`. Putting it
  there means the thread header and any future surface get it right for free.
- **The route is nested inside the messages master-detail**, not standalone. My
  first placement was in the standalone block, which would have opened a channel
  full-screen on desktop while a DM opens beside the inbox rail. `c/:channelId` is
  two segments so it can never collide with the single-segment `:chatId`.
- **Presence is not queried for a channel.** `useOnlineStatus` was being handed the
  channel id, which would have subscribed to a user document that does not exist.
- **The avatar opens the thread** rather than `/user/<channelId>`, which would
  dead-end on a profile page for something that is not a user.
- **Delete says what it does.** The confirm text states that the chat comes back
  when Vergr next posts, and that official channels cannot be unsubscribed from.
  Softening that would be the one genuinely misleading thing in the screen.
- **Removed the card-number guard** from `assertNotPersonal`. The founder
  challenged it and was right: Vergr never handles a PAN (PayRam takes card entry
  on web, Play Billing on Android), so there is nothing to paste one from, and the
  digit-collapsing would have blocked a legitimate 13-digit order reference. The
  email and uid checks stay, because the admin user drawer displays both.

**Verified from the built artifact**, not from the command that was typed: the code
splits into `officialChannels-*.js` (shared), `ChannelThreadScreen-*.js` and the
admin chunk, and `MessagesInboxScreen-*.js` imports the shared chunk.

**Still to do before this slice does anything for users:** the four channels have
to be created, see `docs/CHANNEL_SEED.md`. A channel with no posts deliberately
does not appear in anyone's inbox, so nothing changes until the first post.

### Next, in order

**All seven founder decisions (D1-D7) are shipped and deployed as of 2026-08-17.**
What is left is not code:

1. **Founder, 5 minutes, no code:** create the channels in `/admin/announce` →
   Channels, per `docs/CHANNEL_SEED.md`. Support provisions itself on first use,
   so only Vergr, Offers and Creators need creating by hand.
2. **Founder, 5 minutes, no code:** create `noreply@vergr.app` in Spacemail and
   set the `SMTP_USER` / `SMTP_PASS` secrets. Until then every email is dormant
   and the Emails tab says so on screen.
3. **Native mirrors are in source, unbuilt.** One APK when the founder says go
   (`feedback-batch-native-work`).

Not started, and deliberately so:

- **Password reset takeover.** The template exists; generating the link
  ourselves is only worth doing once SMTP is live, and it needs a fallback to
  Firebase so a broken SMTP can never lock anyone out of their account.
- **Service banner** (section 7). Never requested; kept as a proposal because
  streaming and free uploads can be paused platform-wide with no way to say why.

### Fixes on first real use, 2026-08-17 (founder testing)

| Report | Cause | Fix |
|---|---|---|
| Avatar upload "flickers grey then broken image" | `uploadToR2` resolves to `{ url, key }`; both upload handlers took the object whole, so `avatarUrl` held a map and React rendered `src="[object Object]"`. Nothing threw, so it read as an upload failure when the upload had succeeded. Had it been saved, a map would have gone into Firestore where a string belongs. | Destructure `{ url }` + assert it is a non-empty string before it reaches state, in both handlers. `UserAvatar` now coerces a non-string `src` to `null` so this class can never render a broken image again. Same bug found and fixed in `useLiveClip.js`, where every Chromium-path live clip had been posting a dead `mediaUrls[0]`. |
| `"@vergroffers" is reserved or blocked by username policy` | `assertHandleAvailable` ran the full `isDisallowedUsername`, whose `RESERVED_SUBSTRINGS` contains `vergr`. That list exists to stop a USER passing themselves off as Vergr. An official channel IS Vergr, so the rule was inverted for this caller and blocked exactly the handles these channels should have. | New `isObsceneHandle` in `usernameIndex.js`: profanity and slurs only. **Channels use it. Users still get the full policy, now stricter (see below).** Uniqueness is unchanged for channels: still enforced against the live `usernames/` index and against other channels, because a collision is a real problem and a brand reservation is not. |
| "no one should be able to use vergr or anything close to it" | The brand check was a plain substring, so `v3rgr`, `verqr`, `ver9r`, `vrgr`, `veregr` and `vevrgr` all passed, and those are the handles an impersonator would actually choose. | `foldConfusables` + capped Damerau-Levenshtein in `usernameIndex.js`, mirrored in `src/utils/usernameValidation.js`. Confusable glyphs fold to a base letter, repeated runs collapse, then one edit is allowed anywhere inside the handle. Deliberately over-blocks (`converge`, `verger`, `vergil`). Existing handles are grandfathered: enforcement only fires on `usernameChanged`. |
| "you speak too much like a robot" | Explanations were crammed into ALL-CAPS labels as parentheticals ("Order (lower sorts first among channels)"), which is the worst possible place for them, and one line printed a raw enum ("added by auto"). | Labels are now short nouns; explanations moved under the field in sentence case via a `Hint` component. Rewrote every label, option description and toggle hint in the editor. Also fixed a correctness bug found while rewriting: the composer banner said "Everyone sees this" unconditionally, which is false on a restricted channel, and now names the real audience. |

**Rule this leaves behind:** an explanation that only makes sense to the person who wrote the code is not documentation, it is noise. If a label needs a parenthetical to be understood, the parenthetical is the real label and belongs below the field.

### Phase 1, slice 2: channel KINDS + support + reachability. 2026-08-17

`oneWay` was a boolean whose off state did nothing. It is now `kind`:
`broadcast | support | community`, chosen per channel in the editor, and the
kind decides where the messages live.

| Piece | State |
|---|---|
| `official_channels.kind` + derived `oneWay`, admin picker | deployed |
| Support thread = a group `conversations` doc (`supportThread`, participants = user + agents) | deployed |
| `openSupportThread` (no args; auto-provisions the default channel if none exists) | deployed |
| `adminListSupportThreads` / `adminSetSupportThreadState` / `syncSupportAgents` | deployed |
| `AdminSupportQueue`: waiting-first inbox, claim, resolve, open the real thread | deployed |
| `'support'` in `ADMIN_SCREENS` (grantable on its own) | deployed |
| Community room: `adminEnsureCommunityRoom` + membership synced by `resolveMyChannels` | deployed |
| Agent identity masked in the thread AND in the push (`dmNotify`) | deployed |
| `syncChannelPushSubscriptions`: device subscribes to `chan_<id>`, mute unsubscribes | deployed |
| 4 composite indexes on `conversations` | deployed |

**Design notes worth keeping:**

- A support thread is a GROUP conversation, not a DM, because the DM relay path
  is ciphertext and only the two endpoints can read it. Support has to be
  readable by whichever agent picks it up next.
- Support threads carry every agent in `participants`, which is what makes the
  existing rules and thread screen work for an agent with no special-casing.
  They are filtered out of an agent's PERSONAL inbox in both
  `NotificationContext` and `getConversations`, or the role would bury them.
- Mute is enforced by UNSUBSCRIBING the device from the topic. A topic send
  cannot be filtered per recipient, so that is the only place a mute can be
  honest.
- Agent masking is applied at push-build time as well as in the UI, because a
  push is the one surface the app does not render, so a client-only mask would
  leak the agent's name onto a lock screen.

**Two things corrected after founder review, both the same root cause (building
the feature and not the way in):**

1. A channel used to be hidden until a message existed, so a creator who
   qualified later would not see the Creators channel and nobody could open
   support to ask a question. Channels now appear as soon as the user belongs to
   one, with an honest empty preview. No seed messages needed.
2. "Contact Support" in the Help Centre had **no `onClick` at all**. It now
   opens a real thread, and Settings has a `Message support` row above the help
   centre. Both live in `getSettingsCards` so native gets them too. There is
   deliberately NO help-page fallback in that path: someone asking for support
   wants a person, and answering with a public FAQ loses them.

### Phase 1, slice 3: the campaign object + drawer + popup. 2026-08-17

One document per announcement, every surface derived from it. Replaces the old
`sendAnnouncement`, which cost ~4N Firestore operations and left no record.

| Piece | State |
|---|---|
| `announcements/{campaignId}` + `adminUpsertCampaign` / `adminListCampaigns` | deployed |
| `adminSendCampaign` (validates + flips status; step-up required) | deployed |
| `adminRecallCampaign` (honest about push already delivered) | deployed |
| `onCampaignSending` trigger does the delivery, keyed per surface | deployed |
| `releaseScheduledCampaigns` folded into `cron5Min`, no new Scheduler job | deployed |
| `recordCampaignEvent` (impression/open/click/dismiss, once per user) | deployed |
| `<AnnouncementPopup>` mounted in AppRouter, suppressed on stream/call/checkout | deployed |
| Campaign rows merged into the notification drawer via `useMergedNotifications` | deployed |
| `AdminCampaignsTab`: one message, tick where it appears, live popup preview | deployed |
| Rules for `announcements` (sent-only read) + `announcement_reads` (uid-bound id) | deployed |
| 2 composite indexes | deployed |

**The cost shape, which is the whole point:** thread is one message write, drawer
and popup are ZERO writes (the client reads the shared campaign doc), push is one
topic send. A campaign to a million users costs the same as one to ten. Per-user
documents are written only by people who actually engage, and that same write is
what suppresses the popup on their other devices, so measurement and suppression
are one mechanism rather than two.

**Deliberate limitation, stated in the UI rather than hidden:** a segmented
campaign does NOT push. A topic send reaches whole devices and cannot honour a
segment, and buzzing people about something they cannot see is worse than not
buzzing them. `delivery.perSurface.push` records `skipped_segmented` so it is
visible after the fact rather than looking like a failure.

**Old surfaces removed:** the `create` and `history` tabs are gone.
`history` subscribed to a collection nothing ever wrote, so it was permanently
empty by construction; `create` was the 4N fan-out with the coin-grant path D2
deleted.

### Phase 2: coin sale promos (D2). DONE + DEPLOYED 2026-08-17

| Piece | State |
|---|---|
| `functions/coinPromos.js`: `resolveActivePromo`, `bonusFor`, `claimBonus`, `applyPromo` | deployed |
| PayRam rail wired (claim at order creation, keyed on `referenceId`) | deployed |
| Play Billing rail wired (claim at redemption, keyed on `purchaseToken`) | deployed |
| `adminUpsertCoinPromo` / `adminListCoinPromos` / `adminSetCoinPromoActive` | deployed |
| `getActiveCoinPromo` for the store badge | deployed |
| `/admin/economy` → **Coin sales** tab, with a live cost projection | deployed |
| Badge on the coin-pack cards, number from the server | deployed |
| Rules: `coin_promos` + `promo_redemptions` fully server-only | deployed |

**The rule everything rests on:** a promo changes the QUANTITY DELIVERED, never
the PRICE CHARGED. Nothing in pricing, checkout, cart, tax or settlement moved.
`COIN_PACKS.vpBonus` already shipped this concept (Titan +1,500, Ascendant
+3,000); a promo is that field made temporary and configurable.

**One resolver, both rails.** The two pack maps carry deliberately different coin
counts because Play takes 30%, so a promo applied to one and not the other would
silently work on web and not Android. `coinPromos.js` is required by both; it is
never copied. `PLAY_PRODUCTS` gained `priceUSD` (used only to evaluate
`minSpendUSD`, never to charge) rather than a second parallel price map.

**Caps are enforced inside the credit transaction**, alongside the redemption
record, so a webhook replay, a double settlement or two concurrent purchases
cannot exceed a cap or issue twice. Checking first and writing after is exactly
how a cap gets breached under load.

**A coin promo REQUIRES a cap** and the callable rejects one without it. Bonus
coins can be tipped, and a tip accrues real USD to a creator in `owedMicroUsd`,
so the giveaway has to be bounded. The admin shows the worst-case liability in
dollars before the promo is switched on. VP promos need no cap: VP has no path
out of the platform.

**Claim timing differs per rail, deliberately.** PayRam claims at ORDER creation
so the bonus is reserved when it is promised (an abandoned order holds a slice of
the cap, which errs toward under-issuing). Play claims at REDEMPTION, because on
that rail the money has already moved by the time we see it.

**Founder call carried forward:** option (c) from §9.5, bonus coins as a bounded
marketing cost. The old "never discount coins" warning in `vpSystem.js` described
buy-cheap/tip/withdraw, and withdrawal is deleted.

⚠ A promo never stacks. If two are active the largest wins and the overlap is
logged.

### Phase 5: editable transactional emails (D3). DONE + DEPLOYED 2026-08-17

| Piece | State |
|---|---|
| `functions/emailTemplates.js`: block renderer, HTML + plain text from one source | deployed |
| Shipped defaults IN CODE for `verification`, `password_reset`, `welcome` | deployed |
| `adminListEmailTemplates` / `adminSaveEmailTemplate` / `adminResetEmailTemplate` / `adminPreviewEmailTemplate` | deployed |
| `sendEmailVerificationCode` renders from the template, falls back to built-in | deployed |
| `/admin/announce` → **Emails** tab: block editor + live iframe preview + plain-text view | deployed |
| Rules: `email_templates` and its `versions` fully server-only | deployed |

**A bad edit can never break a transactional email.** Every template has a
default in CODE, and `renderEmail` falls back to it when the stored doc is
missing, malformed, or renders an empty body. Proved by running it with Firestore
unreachable: the verification email still rendered with the code in both the HTML
and the text. `emailVerification.js` keeps its original `buildEmail` as a second
net for the case where the module itself fails.

**A token that carries the email's purpose cannot be deleted.** Saving a
verification template without `{{code}}`, or a reset without `{{resetLink}}`, is
rejected with a message saying why. `{{name}}` is a nicety and is not enforced.
That failure would otherwise be invisible until a real user could not sign in.

**Plain text is generated from the same blocks**, never hand-kept. HTML-only is a
spam signal and two hand-written versions drift.

**Buttons render as a table cell, not a styled anchor**, because Outlook drops
padding and background on an `<a>` and the "button" arrives as underlined text.
**Image blocks require alt text**, enforced server-side, since most clients block
images by default and the alt is what most people actually read.

**No video block, deliberately.** Email clients cannot play video and the editor
says so rather than offering a block that lies about what the reader sees.

⚠ **Still dormant, and the screen says so.** `SMTP_USER`/`SMTP_PASS` are the
literal string `placeholder`, so nothing sends. The Emails tab shows a banner
naming the exact two secrets rather than letting dormant look like broken.
Founder action, five minutes, no code: create `noreply@vergr.app` in Spacemail
and set both secrets. Worth confirming the hand-added Cloudflare SPF/DKIM/DMARC
records cover that identity or the mail lands in spam.

⚠ **Password reset is still Firebase's.** The template is written and ready; the
takeover needs `generatePasswordResetLink` plus a client switch with a fallback
to Firebase, so a broken SMTP can never lock anyone out. Not done, and not
started, because it is only worth doing once SMTP is live.

### Phase 4: What's New (D4) + notification prefs + native parity. DONE + DEPLOYED 2026-08-17

| Piece | State |
|---|---|
| `surfaces.whatsNew = { slug, category, noindex }` on the campaign | deployed |
| `getWhatsNew` (public, unauthenticated, honours the global kill switch) | deployed |
| `adminUpdateWhatsNew`: edit after publishing, unpublish, per-entry noindex | deployed |
| `/whats-new` + `/whats-new/:slug`, one component | deployed |
| Prerendered, in `sitemap.xml`, canonical from the entry | deployed |
| **Vergr channels** section in Settings → Notifications | deployed |
| Official channels added to the NATIVE inbox (they were missing entirely) | deployed |

**Full control, concretely (D4):** per entry publish, unpublish, edit after
publishing, and an individual `noindex`. Globally `app_config/general
.whatsNewEnabled` and `.whatsNewIndexable`, both effective in seconds with no
deploy. Either the entry's noindex or the global one wins, because the stricter
answer is the safe one.

**A sent campaign is frozen, and What's New is the deliberate exception.** The
campaign doc is the record of what was DELIVERED, so editing it would make that
record a lie. But the public page is a living page, not a delivery receipt, so
`adminUpdateWhatsNew` edits only its copy and stamps `whatsNewEditedAt`. It
cannot change what was pushed or posted to a thread, because those already
happened.

**Only the LIST page is prerendered.** Entries are created from the admin and
change without a deploy, so prerendering them from a build script would guarantee
a stale copy. The list is the stable crawlable entry point.

**No existing URL's noindex or sitemap policy was touched**, per `project-seo`:
a sweep was tried once and reverted, and indexation must be read from Search
Console before any such change. This adds URLs and changes nothing.

**Channel notifications are a SEPARATE section in Settings, not a `*_push` key,**
and that is not a shortcut. A channel push is an FCM topic send, which cannot be
filtered per recipient, so the only honest way to stop one is to unsubscribe the
device from the topic. The toggle therefore writes the same mute state the thread
does. Adding a `channel_*_push` key would have created a switch that appeared to
work and silently did nothing.

⚠ **Native inbox had NO official channels at all.** Web had them; the APK simply
never showed a channel row. Now merged with the same `buildOfficialRows` helper,
the same routing resolver and the same verified pip. Verified in the built
artifact: `NativeMessageScreens` imports the officialChannels chunk and carries
the badge markup.

**Native mirrors are in SOURCE only.** No APK built, per
`feedback-batch-native-work`: one build, when the founder says go.
