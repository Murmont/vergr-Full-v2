# `src/components/effects/` — unlockable effects

One file per effect. That is the founder's call and it is the right one, for a
reason worth writing down: the profile-theme system burned a full session and
shipped broken three times, and the root cause was not difficulty. It was that
**two files both claimed to define a theme** (`profileThemes.js` and
`rankCollections.js`), so the swatch on `/prestige` previewed one thing and the
profile drew another, and nobody could see the disagreement by reading either
file alone.

## The split

| Owns | Where | Contains |
|---|---|---|
| **WHEN you get it** | `src/utils/rankUnlocks.js` | the level → effect id table. Data, not logic. |
| **HOW it looks** | `src/components/effects/**` | one file per effect, self-contained. |
| **WHAT is on right now** | `users/{uid}.cosmetics` | the user's equipped choices. |

Nothing else may decide any of the three. If you find yourself writing a second
place that maps a level to an effect, stop: that is the exact shape of the bug
this layout exists to prevent.

## The rules

1. **An effect file owns its own look, end to end.** No effect reads another
   effect's internals. Improving one must never require touching another.

2. **An effect renders nothing when it is off.** `enabled === false` returns
   `null` before any work — no canvas, no listener, no timer. An unlocked effect
   somebody has not equipped must cost exactly zero.

3. **Never gate a level check inside an effect.** The effect receives
   `enabled`; it does not know what a level is. That keeps the ladder in one
   file and makes every effect testable on its own.

4. **Chat effects resolve from `vpLevel` and nothing else.** The `vergr-chat`
   relay loads the sender's user doc **once per connection** and puts `vpLevel`
   on every message (`infra/chat/src/main.go`). So a chat cosmetic derived from
   that integer costs nothing. Anything needing a second lookup per message is
   forbidden — that is a per-message Firestore read at stream-chat volume.

5. **Respect `prefers-reduced-motion`.** Every animated effect degrades to a
   static form. This is not optional politeness; motion effects on a profile
   trigger vestibular symptoms in real people.

6. **Render it before you ship it.** Three consecutive theme versions shipped
   unrendered and all three were wrong. `scripts/` has headless-Chrome harnesses
   (`entry-ribbon-preview.mjs` is the pattern) — add one for anything visual.

## Layout

```
effects/
  visual/     drawn things: orbits, ambilight, gradients, environments
  audio/      Web Audio: voice modulators, ambiance, notification intros
  triggers/   real-time: reactions, typing indicators, takeovers
  index.js    the ONLY import surface. Screens import from here, never deep.
```

`index.js` exists so a screen never deep-imports a path. When an effect is
renamed, split or replaced, one file changes and no screen notices.
