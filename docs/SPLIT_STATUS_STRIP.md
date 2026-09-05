# Split view — what goes in the band under the tip goal

Status: **PLAN.** Founder asked for the space to be filled and for options.

## The space

Solo split is a 16:9 desktop source on a portrait phone. The source is ~56% of
the width in height, so roughly a third of the screen is left over above and
below it. The tip goal now sits under the header (matching solo immersive); the
band between it and the video box is what needs filling, and it has to hold up
when the host has NOT set a goal — otherwise it is dead space again.

## What the reference puts there

TikTok's own solo mockup has a chip row directly under the header: **category
("Dancing"), rank ("Top 2"), connection ("Good connection")** — plus a promo
card on the right ("Dobble your impact"). Nothing there is decorative; every
chip is a fact about the stream that a viewer arriving cold wants in one glance.

## Proposal — three rows, all sourced from real fields

**1. Title + game.** The founder's instinct is right that it is usually the
game. `streams/{id}` already carries `title` and `game`, both set in Go Live, so
there is nothing new to build and nothing to invent. Title first, game as a
tinted chip beside it.

~~**2. A live counter row.**~~ **CUT — founder, 2026-09-01.**

> "you obviously didnt look at the screen or you would have seen the viewers,
> top supporters, and likes are in the header. please look before claiming shit."

He is right and this was written from the code rather than from the screen.
The header on this view ALREADY carries all three: the host capsule shows the
like total ("342 Likes"), the gifters cluster shows the top three supporters
with their coin totals, and the viewer pill shows the count. Proposing them for
the band below was duplication that would have made the header redundant.

⚠ The lesson is the narrow one: I have browser access to this screen now, and
a plan about what a screen is MISSING has to start by looking at the screen.

**3. The subscribe / member state.** The founder asked for "sub/subscribed".
`memberships` decides it, and there are exactly two states:
- not a member → a **Subscribe** chip
- member → a **Member** chip with their tier name

⚠ It has to be a real read, not a placeholder. `subscribeMembership` and the
`memberships/{sub}_{creator}` doc already exist, so the state is available; a
chip that always says "Subscribe" to someone who already pays is worse than no
chip.

## What I would NOT put there

- **A second chat.** The chat is below the video and duplicating it splits
  attention.
- **Anything that moves.** This band sits directly under a fixed video box; a
  ticker or animation next to a static frame drags the eye off the stream.
- **Invented stats.** "Top 2", streaks, watch-time — we do not compute any of
  them, and a fabricated number on a screen whose captures ship on the Play
  listing is a claim we cannot back.

## Ordering, and why

Title/game first because it answers "what am I watching". Counters second
because they answer "is this worth staying for". Subscribe last because it is
the ask, and an ask before the context reads as a paywall.

## Open question for the founder

Is the **connection indicator** ("Good connection" in the reference) something
we want? We have the data on the broadcaster side, but showing a viewer their
own connection quality invites blame for something we do not control. I would
leave it out; TikTok shows it to the HOST, not to viewers, and our split view
is the viewer's screen.
