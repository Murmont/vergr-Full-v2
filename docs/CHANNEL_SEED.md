# Official channels: seeding, avatars and visibility

Channels are DATA, not code (founder decision D1), so they are created through the
same `adminUpsertChannel` callable the admin UI uses. That is deliberate: the
creation path gets exercised by its first real use rather than by a script nobody
runs again.

Create them at **`/admin/announce` -> Channels -> + New**.

---

## 1. The four channels

| Channel id | Display name | Handle | One way | Order | Accent | Who sees it |
|---|---|---|---|---|---|---|
| `vergr` | Vergr | `vergrnews` | yes | 10 | `#7B1FFF` violet | Everyone |
| `vergr_offers` | Vergr Offers | `vergroffers` | yes | 20 | `#F0A500` gold | Everyone |
| `vergr_creators` | Vergr Creators | `vergrcreators` | yes | 30 | `#C87FFF` pink | **Automatic: creators** |
| `vergr_support` | Vergr Support | `vergrsupport` | **no** | 40 | `#B44FFF` violet-light | Everyone |

Notes:

- **The handle is not `@vergr`.** Channels are separate identities from the
  `@vergr` user account (founder ruling), and the server rejects a handle that
  collides with a real user handle or with the `usernames/` reservation index.
- `vergr_support` is the only two-way channel. Its reply path is Phase 3; until
  then the thread shows a notice rather than a composer that does nothing.
- **A channel does not appear in anyone's inbox until it has posted at least
  once.** `buildOfficialRows` skips a channel with no `lastMessageAt`, because an
  empty chat row is noise.
- Support's accent was originally `#3D7FFF` (the `gemBlue` token). Changed to
  violet-light because the brand rule is violet, pink and gold only, and blue sits
  next to the cyan that was explicitly ruled off-brand. Change it if you disagree,
  it is one field.

---

## 2. Avatar specs

### Constraints that drive the design

They render at **52px** in the message list, **38px** in the thread header and
**34px** in admin. So:

- **One bold motif, no fine detail, and no text.** Any word is unreadable at 34px.
- **Flat and graphic, never photographic.** Real user avatars are photos, so a flat
  mark reads as "official" instantly without needing a label.
- **Distinct from each other at a glance**, because the whole point of separate
  channels is that a user can tell "discount" from "your payout is ready" without
  reading.
- Square, **512x512**, exported **WebP**. Upload via the Avatar field in the
  channel editor, which routes through the existing `announcement` R2 kind.
- Design on a **dark background** (`#0B0B14`). A white-background asset will glow
  as a bright square in the list.
- Circular crop: the UI masks to a circle, so keep the motif inside the middle
  ~80% or the corners get cut.

### Per channel

**Vergr (`vergrnews`)**: the house account, so it should be the actual brand mark
rather than an invented icon.
- The **V logo**, white, centred on a violet gradient (`#7B1FFF` to `#B44FFF`,
  135deg). Source available: `public/brand/logo.png` and `public/icons/icon-512-v2.png`.
- This is the one users must recognise as "Vergr itself", so do not get creative.

**Vergr Offers (`vergroffers`)**: has to read as money from across the room. Tango
uses a `%` for exactly this.
- A **coin** mark (the existing coin/gem art at `public/brand/gems.webp` is a
  starting point) or a bold **`%`**, in `#0B0B14`, on a gold gradient (`#F5C842` to
  `#F0A500`).
- Gold is the strongest signal you have and nothing else in the list uses it, so
  this becomes the most identifiable row.

**Vergr Creators (`vergrcreators`)**: aimed at people who earn.
- A **spark or four-point star**, white, on a pink to violet gradient (`#C87FFF` to
  `#7B1FFF`). A star reads as "creator" without borrowing the crown that usually
  means "premium tier".
- Avoid a camera or a microphone: they read as "start streaming", not "here is
  news about your earnings".

**Vergr Support (`vergrsupport`)**: must read as help, and must NOT look
alarming, because it also carries account notices.
- A **lifebuoy ring** or a **speech bubble with a question mark**, white, on a soft
  violet-light gradient (`#B44FFF` to `#7B1FFF`).
- Avoid a warning triangle or red anything. This channel will sometimes deliver
  bad news and the avatar should not pre-announce it.

### Making them

Any vector tool. If you want them consistent fast, build one 512x512 artboard with
a circular gradient fill and swap the centred white glyph and the two gradient
stops per channel. That guarantees identical weight and padding across all four,
which is what makes a set look designed rather than assembled.

---

## 3. Access: three modes, and two of them are private

### Everyone
Open. Every user sees the row. Use for Vergr and Vergr Offers.

### Automatic, by who they are
**Private, and it keeps itself correct.** Set rules (creators, tier, Vanguard,
minimum account age) and membership is EVALUATED against each user, not stamped
once. Someone who becomes a creator next month is added on their next app open.
Someone who stops qualifying loses access the same way.

Non-members cannot read the messages, cannot read the preview, and cannot tell the
channel exists. That is enforced by security rules, not by the app choosing not to
render it.

All ticked rules must be true together. Guests, bots and banned accounts are never
included whatever you pick.

This is what Vergr Creators should be: creator news that general users must not
see.

### Invite only
**Private, and the list is yours.** Nobody is added automatically. Search a person
by name, handle or email and add them.

You can also add someone by hand to an Automatic channel. A manual add is never
removed automatically, so an explicit invite always beats the rules.

### How it stays correct

`resolveMyChannels` runs for the signed-in user on app open. It checks that ONE
user against the criteria channels and grants or revokes their own membership row.
Cheap (a few reads about one person), and it only writes when the answer actually
changed.

No scheduled scan of the user table, and nothing to re-run by hand. An earlier
version of this used a one-time bulk add, which drifted the moment anyone's status
changed, and was replaced for exactly that reason.

**Cost note:** membership is the only fan-out in the channel system, at two small
documents per member. The messages are still one shared write no matter how many
members there are.

---

## 4. Done =

- The four channels appear in Channels with their avatars.
- A test post to `vergr` shows up in the message list on a real account, in the
  same list as DMs, sorted by recency.
- Muting it in the thread stops the push and leaves the message in place.
- Deleting the chat removes the row, and the next post brings it back.
- A members-only test channel is invisible to an account that is not a member,
  including its preview text.
- An account that becomes a creator gains Vergr Creators on its next app open,
  without anyone touching the admin panel.
