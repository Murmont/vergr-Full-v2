# AUDIT RULES — read this before starting any audit

**An audit is not cosmetic, and it is not technical. It is both, plus UX, plus what would
make the thing better.** Founder, 2026-09-03, after an audit reported "clean" and he found
fake glass, a wrong typeface and a clipped verified tick within minutes of reading it.

A pass that covers one dimension and reports success is worse than no audit, because it
gets believed. All five sections below are mandatory. If a section could not be done, it
goes in the open-items doc as **not done** — it is never silently dropped.

---

## 0. The two rules that decide whether the rest is worth anything

⚠⚠ **MEASURE THE RENDERED PAGE. A SOURCE GREP IS NOT AN AUDIT.** Rules checked against
source miss every shipped component the surface imports, every value that only exists after
compositing, and everything the browser computes. The fake-glass and ghost-outline rules had
been "enforced" by grep for weeks while both were live on screen.

⚠⚠ **EVERY PROBE NEEDS A CONTROL RUN.** Measure with the thing, and without it. Three
findings this session were artifacts of my own harness and would have sent me rewriting
working code: phantom occluders from rows scrolled out of their list, a "long names break
the layout" that was really a leftover overlay, and a 23px tap target that was a card
mid-entry-animation. If a probe cannot demonstrate the fault it exists to catch, it has not
been shown to work.

---

## ⚠⚠ RULE 0b — ASK THE OTHER QUESTION

Added 2026-09-04, after ten surfaces and seventeen sheets were reported clean and the
founder then found three defects by looking at the screen.

Every probe in the harness asked **"is there something BAD in what is rendered?"**. None
asked **"is the RIGHT thing rendered at all?"** So a co-host grid drawing one video
instead of two passed all nine probes, oversized tiles were MEASURED AND PRINTED with
nothing to compare them to, and a PiP that rendered nothing produced no findings at all,
because **an absence generates no evidence**.

Three things are therefore mandatory:

1. **EXPECTATIONS.** Declare per surface and state what MUST be present — element counts,
   required labels, size bounds. An absence must FAIL, not stay silent.
2. **FLIP EVERY CONTROL.** A handler existing is not the control working. Press it and
   assert the screen changed. "Has an onClick" passed a PiP toggle that could not reach
   the component it was meant to drive.
3. **LOOK AT IT.** Screenshot every surface and state and READ the picture. The only defect
   the harness caught in that round came from a screenshot, not a probe.

⚠ **AN EMPTY MEASUREMENT IS NOT A PASS.** A check that measured nothing must say so.
⚠ **A PROBE'S OWN BOUNDS CAN MANUFACTURE A FINDING.** A `width > 100` filter hid a 96px
element and reported it missing.

## 1. TECHNICAL — does it actually work

- **Every control is reachable.** `elementFromPoint` at the control's own visible centre
  must return that control. A button that is present, styled and buried is a dead control.
- **No console errors** on any surface, in any state.
- **State machine is complete.** Every state the product can enter has a screen: loading,
  reconnecting, host dropped, ended, offline, muted, banned, gated, empty, zero-viewers.
- **Blocking states genuinely block**, and non-blocking states do not. Getting this backwards
  is what buried End stream and Mic under the audio-only layer.
- **Nothing is inert theatre.** A toggle, kill switch or counter that nothing reads is worse
  than no control. This repo has shipped at least six.
- **Performance**: 60fps idle; measure frame gaps (p50/p90/p99) and long tasks, not vibes.
  Measure the heaviest surface with several animations firing at once.

## 2. COSMETIC — does it look designed

Founder's standing laws. Each exists because something shipped that broke it.

- **No fake glass.** No semi-transparent pill, chip, row, card or button background. A wash
  has no value of its own, changes with whatever is behind it, and over video turns to mud.
  Use a solid hex a real step off its surface. **Exception: a full-bleed scrim, whose job is
  to let the video through. A scrim is not a pill.**
- **No outline lighter than its own fill.** Composite the fill over its painted backdrop and
  the border over that; if the edge is brighter, the hairline is doing the separating a value
  step should do. **Exception: an input's border — that IS the affordance.**
- **A selected state is a SOLID accent fill**, never a tint plus a ring.
- **A pill is not a switch.** A switch is a track with a sliding knob.
- **One typeface.** Never declare a font the app does not load — it falls silently to the OS
  font and renders differently to everything beside it.
- **Contrast**: 4.5:1 for body, 3:1 for large. Composite against the PAINTED backdrop, not
  the declared one.
- **Tap targets ≥ 24×24** (WCAG 2.2 AA). Widen with a pseudo-element so layout does not move.
- **Nothing occludes anything.** Compare rects directly — a badge overlapping its own avatar
  is the shape a naive probe misses, because the coverer is its own ancestor.
- **No brand cyan.** Violet, pink, gold.

## 3. UI/UX — does it make sense to use

- **Every control leads somewhere.** No dead buttons, no menu row that only closes the menu.
- **Every failure names the cause and the next step.** Not "something went wrong". If there
  is no action, say so plainly rather than offering a button that cannot help.
- **The copy must be true.** Never promise a position, a guarantee or a number the system
  cannot deliver. If a counter under-counts by design, the label says what it counts.
- **A modal is a modal**: `role="dialog"`, `aria-modal`, focus moved in, focus restored on
  close, Escape dismisses, and everything behind it inert.
- **Keyboard**: a visible focus ring on every control, and a tab order that follows the
  visual layout.
- **Accessible names**: an icon-only control needs `aria-label` or `title`. `<Icon>` is
  `aria-hidden`, so a ligature is NOT a name.
- **Empty and zero states exist** and say what to do next.
- **Reduced motion**: check BOTH switches — the app's `data-reduced-motion` attribute and the
  OS `prefers-reduced-motion` query. The app's one fast-forwards animations to their FINAL
  keyframe, so anything whose last frame is "gone" becomes invisible.
- **Real content**: long display names, empty lists, huge numbers, RTL, CJK.

## 4. IMPROVEMENTS — not just defects

An audit that only lists faults has done half the job. Also record:

- What a real user will want here that is missing.
- Where the flow costs a step it does not need.
- Where two surfaces solve the same problem differently and should agree.
- What is technically fine but reads as cheap, unfinished, or untrustworthy.

These go in the open-items doc as proposals, with the reasoning. **Anything touching price,
rates, limits or the economy is a founder decision — record it, never implement it.**

## 5. COVERAGE — what "everything" means

Every combination, not the one that was on screen:

| Axis | Values |
|---|---|
| Surface | every screen and every render branch within it |
| Role | broadcaster, viewer, moderator, platform staff, signed-out |
| Device | every preset, narrowest and widest, portrait and landscape |
| State | every playback, chat, format, health and phase state |
| Overlays | every sheet, modal and confirm |
| **Transients** | **every timed thing, FIRED and measured while it is up** |

⚠⚠ **TRANSIENTS ARE THE BLIND SPOT.** Alerts, ribbons, toasts, celebrations, poll cards and
countdown banners all expire. A sweep that walks the DOM sees whichever happens to be up —
usually none. **Fire each one, wait for its entry animation to settle, then measure.** This
single hole hid four defects behind a "finished" audit.

---

## The traps that produce false results

⚠ **Reset state between measurements.** A sheet or overlay left open by an earlier step
reports the NEXT surface's controls as blocked. Three false alarms this session.

⚠ **Scroll the surface fully into view.** Anything below the fold returns `null` from
`elementFromPoint`, which reads as "unreachable" and is really "not scrolled to".

⚠ **Clip against every scroll ancestor**, not just the viewport. A row scrolled out of its
own list still has a rect.

⚠ **Measure after entry animations settle.** `getBoundingClientRect` is post-transform;
`offsetWidth` is not. A card animating in from `scale(0.96)` reports 23.04px for a 24px button.

⚠ **Scope to the product.** Not the admin chrome around a simulator, and not the browser
extension's own overlay (`claude-agent-glow-border`, z 2147483646).

⚠ **Know what a detector cannot see:**
- `scrollWidth` ignores transforms → phantom overflow on any rotated element.
- `backgroundColor` is transparent when the fill is a **gradient** → a deliberately glossy
  badge looks like a ring over nothing.
- `document.fonts.check()` returns **true** for a family that will actually fall back.
  Measure glyph widths.
- A `<style>` tag inside a component is TEXT CONTENT, and text content becomes the
  accessible name.
- `position: fixed` resolves against the viewport, so inside a simulated device it escapes
  the frame unless an ancestor carries a transform.

⚠ **A token can exist in more than one copy.** `glass`/`glassDark` were defined three times;
fixing two left two whole surfaces still wrong. Count the definitions before believing a fix
landed.

⚠ **Guards must be scoped and negative-tested.** Match a statement, not a bare name; slice to
the statement's own close, not a fixed character window; strip comments before asserting a
file does not contain something the comment explains. Five self-matching guards this session.

---

## Definition of done

An audit is finished when, for every cell of the coverage matrix:

1. Technical, cosmetic and UI/UX sections have each been **measured**, not read.
2. Every finding is either **fixed and re-measured**, or **written into the open-items doc**
   with what was measured and why it was left.
3. Every fix that could regress has a **guard**, and the guard has been **negative-tested**.
4. Improvements are recorded, not just defects.
5. The work is **built and deployed**, and verified on the deployed URL.

**Listing something does not close it.** Deferred items stay open until the founder decides.
