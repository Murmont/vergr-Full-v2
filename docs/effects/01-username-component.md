# 01 — `<UserName>` component

**STATUS: BUILT, MIGRATED, GUARDED, DEPLOYED (2026-08-24).** 167 instances live.
Docs 03 and 04 are unblocked: a name effect is now one edit to one file.

Read §3.3 before touching any of it — especially the corruption section, which
cost 36 broken sites across two codemod runs with a green build every time.

Rules: [00-RULES.md](00-RULES.md)

---

## 1. The problem

Measured against the codebase on 2026-08-24:

| | Count | Command |
|---|---|---|
| JSX sites rendering a name or handle | **723** | `grep -rn "{[a-zA-Z_.?]*\(displayName\|username\|authorName\|senderName\)[^}]*}" src --include=*.jsx` |
| Files containing at least one | **148** | same, `-l` |
| Shared component for names | **none** | `find src -iname "*UserName*"` → nothing |
| Shared component for avatars (`UserAvatar`) | exists, used in **124 files** | |

The avatar orbit (effect `orbit`) was a one-line change *because* `UserAvatar`
exists. Names have no equivalent.

**Consequence:** Username font (Rookie L3), Username colour (Contender L1),
Animated name gradient (Rival L2) and Animated crest (Veteran L2) would each
require editing up to 723 call sites. Missing one leaves a name rendered
inconsistently, and there is no mechanism that would catch it.

**There is no research to do here.** This is not a technique problem, it is an
architecture gap. The fix is a shared component, exactly as `UserAvatar` already
is for the other half of an identity.

## 2. Design

`src/components/UserName.jsx`, mirroring `UserAvatar`'s contract.

```jsx
<UserName user={u} viewer={me} context="chat" size="md" />
```

It resolves in ONE place, in this order (order matters):

1. `applyVanguardMask(user, viewer)` — a masked persona shows nothing personal,
   cosmetics included. **This wins over everything below.**
2. Bot / official-channel labelling.
3. The verified tick and `PlanBadge`.
4. The rank crest, from `vpLevel` (R9 — free).
5. The accent colour (doc 04).
6. The font choice (doc 04).
7. The animated gradient (doc 03).

`context` selects the ruleset: `chat` | `profile` | `feed` | `plain`.
`plain` renders exactly what the app renders today, with no cosmetics — that is
what makes the migration a no-op refactor.

## 3. Surfaces — the complete inventory

### 3.1 MUST adopt it (identity shown to other people)

| Surface | File |
|---|---|
| Feed post header + comments | `src/components/PostCard.jsx` |
| Live stream chat | `src/components/streams/ChatPanel.jsx` |
| DM thread | `src/screens/messages/ChatThreadScreen.jsx` (4324 lines) |
| DM thread, compact | `src/screens/messages/ChatDetailScreen.jsx` |
| Squad chat | `src/screens/squads/SquadChatThreadScreen.jsx` (1642) |
| Native messages | `src/screens/messages/native/NativeMessageScreens.jsx` (518) |
| Native friends | `src/screens/messages/native/NativeFriendsScreen.jsx` |
| Message list / inbox | `src/components/MessagesListPanel.jsx` |
| Own profile | `src/screens/profile/ProfileScreen.jsx` |
| Public profile | `src/screens/profile/PublicProfileScreen.jsx` |
| Native profiles | `src/screens/profile/native/NativeProfileScreens.jsx` |
| Stream entry ribbon | `src/components/streams/JoinAnnouncer.jsx` |
| Live viewer (desktop) | `src/screens/streams/ViewerStreamScreen.jsx` (11 sites) |
| Live viewer (mobile) | `src/components/streams/MobileLiveViewer.jsx` (9 sites) |
| Notifications drawer | `src/components/NotificationsDrawer.jsx` |
| Notifications screen | `src/screens/home/NotificationsScreen.jsx` |
| Search results | `src/screens/search/SearchResultsAllScreen.jsx` |
| Explore | `src/screens/explore/ExploreScreen.jsx` |
| Explore, native | `src/screens/explore/native/NativeDiscoveryScreens.jsx` (9), `NativeExploreScreen.jsx` |
| Home, native | `src/screens/home/native/NativeHomeScreens.jsx` (6) |
| Suggestions / discovery | `src/components/SuggestionsCarousel.jsx`, `src/components/DiscoveryStrip.jsx` |
| Right rail | `src/components/RightSidebarPanel.jsx` |
| Squad members | `src/screens/squads/SquadMembersScreen.jsx` |
| Shorts | `src/screens/shorts/ShortsDeck.jsx` |
| Clip viewer | `src/screens/viewer/ClipViewerScreen.jsx` |
| Public UGC (SEO pages) | `src/screens/public/PublicUgcScreens.jsx` (18 sites) |
| vergr.me | `src/screens/VergrMePage.jsx` (7), `src/components/VergrMeView.jsx` |
| Calls | `src/screens/calls/CallsScreen.jsx` |
| Tip modal | `src/components/TipPostModal.jsx` |
| Send coins | `src/components/SendCoinsModal.jsx` |
| User picker | `src/components/UserPickerSheet.jsx` |
| Mobile nav drawer | `src/components/MobileNavDrawer.jsx` |
| Follow suggestions | `src/screens/onboarding/FollowSuggestionsScreen.jsx` |

### 3.2 MUST NOT adopt it

- `src/screens/admin/**` — a moderator must see the plain, true name. An
  animated gradient in an admin table is a legibility and an integrity problem.
  (`AdminUsersScreen`, `AdminEconomyScreen` (9 sites), `AdminChannelsTab` (5),
  `AdminBotsScreen` (5), `AdminDashboardScreen`, `AdminStatsScreen`.)
- `src/screens/onboarding/**`, `src/screens/auth/**` — forms, own name only.
- `src/screens/settings/**` — forms.
- `src/screens/marketing/help/**` — static documentation.
- Anywhere `applyVanguardMask` is active — handled inside the component, but do
  not add cosmetics upstream of it.

## 3.3 MIGRATION STATE (2026-08-24) — read this before continuing

**166 `<UserName>` instances live and deployed.** Every mechanical OBJECT site
is done: `username-codemod.mjs` now reports **0 remaining**. Verified on the
live site by measurement, not by screenshot: every migrated span is a bare
`<span>` with no class and no style, and its computed colour, size, weight and
family equal its parent's on every page checked. **0 mismatches.**

Four scripts own this work. Run them rather than re-deriving:

| Script | Purpose |
|---|---|
| `scripts/username-sites.mjs` | live worklist: OBJ / STR / DONE per file |
| `scripts/username-codemod.mjs [--apply]` | mechanical OBJECT sites, dry-run by default |
| `scripts/username-string-audit.mjs` | classifies STRING sites by kind |
| `scripts/username-repair.mjs [--apply]` | undoes the damage described below |

⚠ **`username-sites.mjs` OVER-REPORTS.** Its OBJECT regex also matches
`${x.username}` inside template literals and `alt={x.username}` in attributes,
neither of which may migrate. Trust the codemod's own dry-run count for what is
actually left, not that file's "remaining sites" total.

### ⚠⚠ THE CODEMOD SHIPPED 36 BROKEN SITES AND THE BUILD WAS GREEN EVERY TIME

The single most important thing on this page. The patterns matched
`{a.displayName || ...}` without checking the character before the `{`, and the
same text means three different things:

| Context | Result |
|---|---|
| JSX child (the only valid one) | correct |
| `` `Invited ${u.displayName}` `` | the `$` is stranded and the element text lands **inside the string**, so a toast read literally ``Invited $<UserName user={user} ... />`` |
| `alt={u.displayName}` | **JSX legally allows an element as an attribute value, so it COMPILES** |

The attribute case is the dangerous one, because nothing complains:

- `alt=` and `title=` became `[object Object]`
- `value=<UserName/>` on `EditProfileScreen`'s input **broke editing your own
  display name**, and the same on the vergr.me appearance panel
- `CoinCard`'s `otherName` calls `.toUpperCase()` on it, which **throws and
  crashes the whole DM thread** on any coin message
- 13 sites in `PublicUgcScreens` put raw JSX into `<title>` and `og:title`, so
  the indexed SEO pages read ``$<UserName user={who} masked /> on VERGR``

`npm run build` passed on every one of these. **A green build proves the syntax
parsed, never that the app works.** The guard is now `CTX = (?<![$=])` on every
`displayName` pattern, negative-tested: re-running the codemod over the repaired
files reports 0 sites.

Handle patterns (`@{...}`) need no guard and must not get one: `@${` cannot
match `@\{`, and no attribute is ever written `attr=@{`.

### Found while verifying: every deploy broke the whole SEO surface

Not a migration bug, but it was hiding this one. `functions/ugcRenderer.js`
cached the SPA shell for **10 minutes**, and Vite content-hashes every chunk, so
for ten minutes after any hosting deploy `/u/**`, `/post/**`, `/clip/**` and
`/live/**` booted a bundle that had been deleted, and rendered ErrorBoundary's
"Something went wrong". Fixed with a conditional GET (`If-None-Match`, 304) plus
a 5s burst guard. Detail in the comment at the top of `getShell()`.

### ⚠ NOT EVERY REMAINING SITE SHOULD MIGRATE

The raw count of "renders a name string" was ~100 and that number was
misleading. Classified (`username-string-audit.mjs`):

| Kind | Count | Action |
|---|---|---|
| **Visible render** | **24** | migrate |
| `alt` / `title` attribute | 4 | **must stay a string** |
| `name={}` prop to a child | 6 | **must stay a string** |
| template literal / `confirm` | 2 | **must stay a string** |

A React element in an `alt=` renders `[object Object]`; in a `name={}` prop it
breaks the child that expects text; in a template literal it stringifies. Those
34 sites are CORRECT as they are — leave them.

⚠ **A bare `{name}` does not identify a person.** Verified false positives from
the first audit pass: `Icon.jsx` renders an ICON ligature, `EmojiPicker` uses it
as a React `key`, and `CreateSquadScreen` / `CreateGroupChatScreen` /
`CreateEventScreen` use it as a form `value` for the SQUAD / GROUP / EVENT name.
`AuthContext` passes it to a Firebase call. The audit script now excludes
`value=` / `key=` / `ref=` and requires a JSX text position; two `AuthContext`
lines still surface and are also false positives.

### ⚠ THE "24" WAS ALSO TOO HIGH. The real number was 14.

Tracing each local string back to where it came from — which is the only way to
know — cut it again. A name is only migratable if a **user object is in scope**.
Nine of the 24 fail that test and are correct exactly as they are:

| Site | Why it stays a string |
|---|---|
| `ChatThreadScreen:613` | inside `CoinCard`; the value is `.toUpperCase()`d |
| `ChatThreadScreen:972` | `chatPartner()` returns `{name, avatar}`, not a user |
| `ChatDetailScreen:619` | "Block X" — your own nickname in a confirmation |
| `OneToOneCard:80` | reads `stream.hostName`, a stream doc field |
| `TipPostModal:76` | the post's DENORMALISED author snapshot wins by design |
| `ProfileScreen:373`, `PublicProfileScreen:453` | already migrated; the audit was matching `fallback={displayName}` |
| `AuthContext:77,173` | a Firebase `updateProfile()` argument |

⚠ **A nickname must never carry the other person's cosmetics.** It is YOUR
private label for them, not their identity. `ChatDetailScreen` therefore renders
`{nickname ? displayName : <UserName …/>}`, and the real name still appears
underneath whenever a nickname is overriding it.

### The 14 that were migrated (2026-08-24, deployed)

| Cluster | Sites |
|---|---|
| Profile headings + dock headers | `ProfileScreen:182,373` · `PublicProfileScreen:293,453` · `NativeProfileScreens:257,310,520,563` |
| Composer preview (your OWN name — should show your cosmetics) | `CreateComposer:316,538,1133` |
| DM / chat | `ChatDetailScreen:403,619` · `ChatThreadScreen:613,972` |
| Money + modals | `SendCoinsModal:78` · `TipPostModal:76` · `OneToOneCard:80` |
| Misc | `MobileNavDrawer:154` · `profilePolish:72` · `JoinAnnouncer:248` · `HomeFeedScreen:1271` |

⚠ `profilePolish.jsx:72` is `MiniDockHeader`, which takes `name` as a STRING
prop. Migrating the four call sites that feed it requires changing its API to
take a user object first — do that one component, then its callers.

⚠ **`ChatThreadScreen` is 4324 lines and owns DMs.** Only 2 of its sites are
real renders. It is NOT the large data-flow refactor the earlier estimate
implied; do not rewrite its participant resolution.

## 4. Implementation, without breaking anything

**Phase A — pure refactor, zero visual change.** Ship `<UserName>` supporting
only `context="plain"`, which renders byte-identically to today. Migrate the
3.1 files. Verify by screenshot diff: nothing should move by one pixel.

✅ **Phase A DONE, deployed and verified 2026-08-24.** Proven on the live
`@vergr` account, not by inspection: changing the display name once in
`/edit-profile` propagated to three separate `<UserName>` renders at 12px, 14px
and 22px (sidebar, mini dock header, profile heading), with **0 computed-style
mismatches** against their parents. Restored afterwards.

✅ **Phase B DONE.** `scripts/username-render-check.mjs`, **31 assertions**,
negative-tested BOTH ways (reintroduce a raw render → fails; reintroduce an
`alt=<UserName/>` → fails). It found a real miss on its first run:
`MessagesListPanel:586`, a three-way `displayName || name || 'Member'` ladder no
codemod pattern covered.

⚠ **Neither this check nor `vp-mirror-check.mjs` was wired into anything** —
both were manual-only, which is precisely why 36 corrupted sites shipped. Now:

```json
"check":    "node scripts/vp-mirror-check.mjs && node scripts/username-render-check.mjs",
"prebuild": "npm run check",
```

so `npm run build` cannot succeed while either fails. Note npm only fires
`prebuild` for `npm run build`; the `build:android*` scripts call `vite build`
directly and are NOT covered. Wire them if a native release ever needs it.

**Phase C — effects.** Docs 03 and 04 become one file each.

Order inside Phase A: `PostCard` → `ChatPanel` → `ChatThreadScreen` →
`SquadChatThreadScreen` → profiles → the rest. Highest-traffic first, so a
regression surfaces immediately rather than in a rarely-opened screen.

## 5. Verification

- `scripts/username-render-check.mjs` passes, and **fails when a raw render is
  deliberately reintroduced** (negative test, mandatory).
- Rendered count: `<UserName>` instances after migration >= the 3.1 site count.
- Vanguard mask: a masked persona renders no accent, no gradient, no crest, on
  every one of the four chat surfaces.
