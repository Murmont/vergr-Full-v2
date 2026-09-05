// /platform/learn/live — live streaming.
//
// SCOPE RULE: a person lands here to find out what streaming on Vergr is and how
// it works. Every commercial detail is ONE line and a link out. A previous
// version carried a plan-comparison table, a revenue-share ladder and a boost
// price rail; none of it belongs here. Plans and earning have their own pages.
//
// ── COLOUR DISCIPLINE (added 2026-08-30 after the page was called cheesy) ────
// An earlier pass tinted everything: ember/violet/gold step numerals, three
// differently-coloured hero chips, and a different icon colour per section. Six
// accents competing on one page reads as a game UI, not a platform.
//
// ⚠ THERE ARE NOW EXACTLY THREE ACCENTS AND EACH ONE MEANS SOMETHING:
//     violet  the default accent for everything structural
//     ember   LIVE only — the eyebrow, and the diagram markers, which annotate a
//             live broadcast and tie to the red LIVE badge inside the art
//     gold    money only — the one block about getting paid
// Do not introduce a fourth, and do not use one of these three decoratively. If
// a new element has no live or money meaning, it is violet or it is neutral.
//
// ⚠ NO HARDCODED <br> IN A FLUID HEADING. The hero used forced breaks against a
// clamp() font size, so the text re-wrapped INSIDE them and shipped shredded
// across six ragged lines. Headings wrap naturally, bounded by maxWidth, with
// text-wrap: balance. Never reintroduce a <br> here.
//
// ⚠ THE PHONE ART IS THE FOUNDER'S AND CALLOUTS MUST POINT AT THINGS VISIBLE IN
// IT. Every CALLOUT was checked against the image, not the codebase. The chat
// rank crest is real in the product but is NOT in this frame, so it is prose
// with no marker. Re-check every marker if the art is re-exported.
//
// Art: public/brand/live/viewer.webp (447w) + @2x (894w), alpha, background
// removed from the founder's original. /brand/** already has cache headers in
// firebase.json; the catch-all ** rule is no-store, so check that before adding
// any new directory under public/.
//
// Facts, each traced to the code that enforces it:
//   * No follower gate and no coin charge to go live. Both sit behind
//     app_config/general.streamFollowerGateEnabled (functions/streaming.js:256,
//     :295-310) and it is OFF. ⚠ RUNTIME SWITCH — turning it back on in
//     /admin/config makes the "no gate" copy false the same second.
//   * OBS is not tier-gated. streaming.js:221 validates mode as rtmp|browser
//     and never reads the plan.
//   * One rendition, no transcode ladder, so every viewer gets source quality.
//     PLAN_RULES.maxViewerRendition has zero client consumers.
//   * Framerate backpressure is real: FPS_LADDER + the recovery timer in
//     BroadcasterScreen.jsx:416-433 step fps down and back up.
//   * Entry ribbon tiers: ENTRY_TIERS in rankUnlocks.js:55, enforced by
//     functions/streamJoins.js and JoinAnnouncer.jsx.
//   * Co-host: functions/coStream.js:24 MAX_COHOSTS = 3, so host + 3.
//   * Payouts run on VERGR'S schedule (resolveCadence, creatorPayouts.js).
//     Never write "on your schedule" — docs/REVENUE_SHARE_PLAN.md 1.4.

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon';
import useSeo from '../../utils/seo';
import JsonLd, { faqSchema } from '../../utils/JsonLd';
import { MarketingShell, C } from './PublicMarketingScreens';

// ─────────────────────────────────────────────────────────────────────
// Motion
//
// ⚠ THE RESTING STATE IS THE VISIBLE ONE. Everything animates TO opacity 1 and
// no transform, so if IntersectionObserver never fires, if JS is off, or if a
// reduced-motion rule kills the transition, the content is still there. The
// failure mode of a reveal must never be invisible copy.
//
// ⚠ TWO REDUCED-MOTION SWITCHES EXIST (CLAUDE.md): the OS media query and the
// app's own html[data-reduced-motion="true"]. Both are handled in LiveStyles.
// ─────────────────────────────────────────────────────────────────────

function Reveal({ children, delay = 0, style }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setShown(true); return undefined; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setShown(true); io.disconnect(); }
    }, { threshold: 0.08, rootMargin: '0px 0px -8% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`vg-reveal${shown ? ' is-in' : ''}`}
      style={{ transitionDelay: `${delay}ms`, ...style }}
    >{children}</div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Shared bits
// ─────────────────────────────────────────────────────────────────────

function Eyebrow({ children, color = C.violet }) {
  return (
    <div className="vg-mono" style={{
      fontSize: 11, fontWeight: 700, color,
      letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: 14,
    }}>{children}</div>
  );
}

/**
 * ⚠ THE SECTION DIVIDER IS A FADING RULE, NOT A BORDER.
 * This used `borderTop: 1px solid` on every band, which is precisely the
 * "cage edge" src/styles/surface.css warns about: a rule that stops at full
 * strength against a bare corner. Eight of them down one page is a large part
 * of why the design read as cheap. `.vg-band::before` ramps in at 18% and out
 * at 76%, the same profile as `.vg-rule-h`.
 *
 * `glow` places a soft spotlight behind the section. Passing a DIFFERENT
 * position per section is what stops nine identically-lit slabs stacking up.
 * `wide` lets a section break the 1180 container when its content wants room.
 */
function Band({ children, glow = null, wide = false, pad = '92px 32px' }) {
  return (
    <section className="vg-band vg-section" style={{ padding: pad, position: 'relative' }}>
      {glow && (
        <div aria-hidden style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', width: 900, height: 900, borderRadius: '50%',
            background: `radial-gradient(circle, ${glow.color} 0%, transparent 62%)`,
            top: glow.top, left: glow.left, right: glow.right,
            transform: 'translateY(-30%)',
          }} />
        </div>
      )}
      <div style={{ maxWidth: wide ? 1340 : 1180, margin: '0 auto', position: 'relative' }}>{children}</div>
    </section>
  );
}

function SectionTitle({ eyebrow, title, lede, color = C.violet, center }) {
  return (
    <Reveal style={{
      maxWidth: center ? 660 : 760,
      margin: center ? '0 auto 48px' : '0 0 44px',
      textAlign: center ? 'center' : 'left',
    }}>
      {eyebrow && <Eyebrow color={color}>{eyebrow}</Eyebrow>}
      <h2 className="vg-syne vg-balance" style={{
        fontSize: 'clamp(28px, 3.7vw, 44px)', fontWeight: 800,
        letterSpacing: '-0.028em', margin: 0, lineHeight: 1.12,
      }}>{title}</h2>
      {lede && (
        <p style={{ marginTop: 16, fontSize: 16.5, lineHeight: 1.66, color: C.text2 }}>{lede}</p>
      )}
    </Reveal>
  );
}

/**
 * Neutral surface. No 1px cage: it lifts by VALUE, a lit top edge, and a cast
 * shadow. The first version had only the hairline and read as a flat grey
 * rectangle — a card needs to sit on the page, not be drawn onto it.
 */
const surface = {
  padding: 28,
  borderRadius: 18,
  background: 'linear-gradient(180deg, rgba(255,255,255,0.058) 0%, rgba(255,255,255,0.016) 100%)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10), 0 22px 46px -28px rgba(0,0,0,0.95)',
};

function PhoneArt() {
  return (
    <img
      src="/brand/live/viewer.webp"
      srcSet="/brand/live/viewer.webp 447w, /brand/live/viewer@2x.webp 894w"
      sizes="(max-width: 900px) 72vw, 360px"
      alt="A Vergr live stream on a phone: the host, a tip goal, coins landing, arrivals and live chat."
      style={{ width: '100%', height: 'auto', display: 'block' }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// 1. Hero
// ─────────────────────────────────────────────────────────────────────

function LiveHero() {
  return (
    <section className="vg-section" style={{ padding: '56px 32px 72px', position: 'relative', overflow: 'hidden' }}>
      <div aria-hidden style={{
        position: 'absolute', top: -220, right: -160, width: 720, height: 720,
        background: `radial-gradient(circle, ${C.violet}1a 0%, transparent 64%)`,
        pointerEvents: 'none',
      }} />
      <div className="vg-live-hero" style={{
        maxWidth: 1180, margin: '0 auto', position: 'relative',
        display: 'grid', gap: 56, alignItems: 'center',
        gridTemplateColumns: 'minmax(0, 1fr)',
      }}>
        <Reveal>
          <Eyebrow color={C.ember}>Live</Eyebrow>
          {/* ⚠ No <br>. maxWidth + balance does the wrapping. */}
          <h1 className="vg-syne vg-balance" style={{
            fontSize: 'clamp(36px, 4.4vw, 56px)', fontWeight: 800,
            letterSpacing: '-0.038em', lineHeight: 1.04, margin: 0, maxWidth: 560,
          }}>
            Go live from your phone or your PC.
          </h1>
          <p style={{ marginTop: 22, fontSize: 17.5, lineHeight: 1.62, color: C.text2, maxWidth: 470 }}>
            Stream from the Vergr app on Android or Windows, or straight from a browser tab if you
            would rather not install anything. No follower count to hit first, no application to
            fill in.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 34 }}>
            <Link to="/signup" className="vg-btn-primary" style={{ textDecoration: 'none' }}>Start streaming</Link>
            <Link to="/platform/download" className="vg-btn-ghost" style={{ textDecoration: 'none' }}>Get the app</Link>
          </div>
        </Reveal>
        <Reveal delay={120} style={{ display: 'grid', placeItems: 'center' }}>
          <div className="vg-float" style={{ width: 'min(330px, 72vw)' }}><PhoneArt /></div>
        </Reveal>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 2. Going live
// ─────────────────────────────────────────────────────────────────────

const STEPS = [
  ['Hit Go Live', 'It is right there in the app. Nothing to set up beforehand.'],
  ['Pick what people see', 'Your camera, your screen, or both together. Change it mid-stream.'],
  ['That is it, you are on', 'Chat opens, your followers get pinged, and people start arriving.'],
];

const PLATFORMS = [
  ['smartphone', 'Android app', 'Stream and watch from your pocket'],
  ['desktop_windows', 'Windows app', 'A proper desktop app, not a shortcut'],
  ['language', 'Any browser', 'Nothing to install if you would rather not'],
];

function GoingLive() {
  return (
    <Band glow={{ color: 'rgba(123,111,255,0.13)', top: 0, left: '-8%' }}>
      <SectionTitle
        eyebrow="Getting on air"
        title="Going live takes about a minute"
        lede="The same three steps whether you are in the app on your phone, the desktop app, or a browser."
      />
      <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        {STEPS.map(([t, b], i) => (
          <Reveal key={t} delay={i * 90}>
            {/* ⚠ Uniform index, not a coloured numeral per step. Three different
                colours on 1/2/3 was the single loudest bit of the old page. */}
            <div className="vg-card" style={{ ...surface, height: '100%' }}>
              <div className="vg-mono" style={{ fontSize: 11, fontWeight: 700, color: C.text3, letterSpacing: '0.2em' }}>
                {String(i + 1).padStart(2, '0')}
              </div>
              <div className="vg-syne" style={{ fontSize: 18, fontWeight: 700, color: C.text, marginTop: 14 }}>{t}</div>
              <p style={{ fontSize: 14.5, lineHeight: 1.62, color: C.text2, margin: '8px 0 0' }}>{b}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={140}>
        <div style={{ ...surface, marginTop: 18, padding: '20px 24px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <span style={{ color: C.violet, display: 'grid', marginTop: 1 }}><Icon name="desktop_windows" size={18} /></span>
          <p style={{ fontSize: 14, color: C.text2, lineHeight: 1.65, margin: 0 }}>
            <b style={{ color: C.text }}>Already on OBS?</b> Point it at us and keep every scene, overlay
            and alert you have built. Standard RTMP, no plugin, and it works the same whether you are
            paying us or not.
          </p>
        </div>
      </Reveal>

      <Reveal delay={180}>
        <div style={{
          marginTop: 34, paddingTop: 30, borderTop: `1px solid ${C.borderSoft}`,
          display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'center',
        }}>
          {PLATFORMS.map(([ic, t, b]) => (
            <div key={t} style={{ display: 'flex', gap: 13, alignItems: 'flex-start', flex: '1 1 220px' }}>
              <span style={{ color: C.violet, display: 'grid', marginTop: 2 }}><Icon name={ic} size={19} /></span>
              <div>
                <div className="vg-syne" style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{t}</div>
                <div style={{ fontSize: 13, color: C.text2, marginTop: 3, lineHeight: 1.5 }}>{b}</div>
              </div>
            </div>
          ))}
          <Link to="/platform/download" style={{ color: C.violet, fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap' }}>
            Get the app →
          </Link>
        </div>
      </Reveal>
    </Band>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 3. Anatomy
//
// ⚠ MARKERS SIT ON THE PHONE'S EDGE, NOT ON THE FEATURE. The first version put a
// dot on top of each element and covered the very things it named — the goal
// total, "Sent Galaxy", the SUB badge, the heart. A callout that hides its
// subject is worse than none.
//
// It also had a second fault: the connector SVG painted BENEATH the phone image,
// so every line died at the bezel and left a stub floating in space that read as
// a rendering bug. Raising the SVG would have fixed the lines but dragged them
// across the host's face.
//
// Terminating at the edge solves both. Lines run their whole length in clear
// space, nothing is covered, and it stays unambiguous because no two features
// share a height on the same side. Sides are not arbitrary either: each feature
// is marked on the edge it sits nearest, bar the goal and arrival lines, which
// span the full width and are honest on either.
// ─────────────────────────────────────────────────────────────────────

// heightPct is DERIVED, not eyeballed: at width (right-left)% of a wrapper whose
// aspect is 1000/620, the art's 894x1647 gives
//   0.28 * (1647/894) / (620/1000) = 0.832
// Change the width and recompute, or every marker drifts off the edge.
const STAGE = { left: 36, right: 64, top: 8.4, heightPct: 83.2 };

// featY = where the thing is on the PHONE, in % of the art's height.
// labelY = where its label sits in the gutter, in % of the wrapper.
const CALLOUTS = [
  { n: 1, side: 'right', labelY: 13, featY: 4.7, icon: 'workspace_premium',
    title: 'Your regulars, up top',
    body: 'The people backing you most that stream, where everyone can see them.' },
  { n: 2, side: 'left', labelY: 19, featY: 12.1, icon: 'flag',
    title: 'A goal the room can watch',
    body: 'Say what you are saving for. The bar fills in front of everybody.' },
  { n: 3, side: 'left', labelY: 52, featY: 57.0, icon: 'monetization_on',
    title: 'Coins landing, live',
    body: 'Every one shows up on screen with their name on it while you play.' },
  { n: 4, side: 'right', labelY: 66, featY: 71.1, icon: 'sensor_door',
    title: 'People see you walk in',
    body: 'Your entry ribbon announces you to the room, and it gets louder as you rank up.' },
  { n: 5, side: 'left', labelY: 74, featY: 76.6, icon: 'star',
    title: 'Members stand out',
    body: 'Anyone subscribed to you is badged in chat, so you know who your people are.' },
  { n: 6, side: 'right', labelY: 83, featY: 89.2, icon: 'favorite',
    title: 'One tap to react',
    body: 'Hearts float up the screen. Nobody has to type to join in.' },
];

const markerX = (c) => (c.side === 'left' ? STAGE.left : STAGE.right);
const markerY = (c) => STAGE.top + (c.featY / 100) * STAGE.heightPct;

function CalloutCard({ c, align }) {
  return (
    <div style={{
      display: 'flex', gap: 12, alignItems: 'flex-start',
      flexDirection: align === 'right' ? 'row-reverse' : 'row',
      textAlign: align === 'right' ? 'right' : 'left',
    }}>
      <span style={{
        width: 32, height: 32, borderRadius: 10, flexShrink: 0,
        background: 'rgba(255,255,255,0.06)', color: C.text2,
        display: 'grid', placeItems: 'center',
      }}><Icon name={c.icon} size={16} /></span>
      <div style={{ minWidth: 0 }}>
        <div className="vg-syne" style={{ fontSize: 14.5, fontWeight: 700, color: C.text, lineHeight: 1.3 }}>{c.title}</div>
        <div style={{ fontSize: 12.5, color: C.text2, marginTop: 5, lineHeight: 1.55 }}>{c.body}</div>
      </div>
    </div>
  );
}

function Marker({ n, numbered }) {
  const d = numbered ? 22 : 13;
  return (
    <span className="vg-mono" style={{
      width: d, height: d, borderRadius: 999,
      background: C.ember, border: '2px solid rgba(255,255,255,0.92)',
      boxShadow: '0 0 0 3px rgba(255,77,106,0.22), 0 2px 6px rgba(0,0,0,0.6)',
      display: 'grid', placeItems: 'center',
      fontSize: 11, fontWeight: 800, color: '#fff',
    }}>{numbered ? n : ''}</span>
  );
}

function StreamAnatomy() {
  const ref = useRef(null);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setDrawn(true); return undefined; }
    const io = new IntersectionObserver((e) => {
      if (e.some((x) => x.isIntersecting)) { setDrawn(true); io.disconnect(); }
    }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Band wide glow={{ color: 'rgba(255,77,106,0.10)', top: 0, left: '22%' }}>
      <SectionTitle
        center
        eyebrow="On screen"
        title="This is what your stream looks like"
        lede="Tips, goals, arrivals, members and chat are part of the player. There is no widget to wire up and no second app running in the background."
      />

      <div ref={ref} className="vg-anatomy-wide" style={{ position: 'relative', width: '100%', aspectRatio: '1000 / 620' }}>
        <svg viewBox="0 0 1000 620" preserveAspectRatio="none" aria-hidden
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0 }}>
          {CALLOUTS.map((c, i) => {
            const mx = markerX(c), my = markerY(c);
            const ax = c.side === 'left' ? 26 : 74;
            const ex = ax + (mx - ax) * 0.45;
            return (
              <polyline
                key={c.n}
                className={`vg-lead${drawn ? ' is-drawn' : ''}`}
                style={{ transitionDelay: `${220 + i * 90}ms` }}
                pathLength="100"
                points={`${ax * 10},${c.labelY * 6.2} ${ex * 10},${c.labelY * 6.2} ${mx * 10},${my * 6.2}`}
                fill="none" stroke="rgba(255,77,106,0.62)" strokeWidth="1.25"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>

        <div style={{
          position: 'absolute', zIndex: 1,
          left: `${STAGE.left}%`, top: `${STAGE.top}%`,
          width: `${STAGE.right - STAGE.left}%`,
        }}>
          <PhoneArt />
        </div>

        {CALLOUTS.map((c, i) => (
          <span key={c.n}
            className={`vg-mark${drawn ? ' is-in' : ''}`}
            style={{
              position: 'absolute', zIndex: 3,
              left: `${markerX(c)}%`, top: `${markerY(c)}%`,
              transitionDelay: `${420 + i * 90}ms`,
            }}><Marker n={c.n} /></span>
        ))}

        {CALLOUTS.map((c, i) => (
          <div key={c.n}
            className={`vg-callout${drawn ? ' is-in' : ''}`}
            style={{
              position: 'absolute', zIndex: 2,
              top: `${c.labelY}%`, width: '24%',
              transitionDelay: `${300 + i * 90}ms`,
              ...(c.side === 'left' ? { left: 0 } : { right: 0 }),
            }}>
            <CalloutCard c={c} align={c.side === 'left' ? 'right' : 'left'} />
          </div>
        ))}
      </div>

      <div className="vg-anatomy-narrow">
        <div style={{ position: 'relative', width: 'min(300px, 72vw)', margin: '0 auto' }}>
          <PhoneArt />
          {CALLOUTS.map((c) => (
            <span key={c.n} style={{
              position: 'absolute',
              left: c.side === 'left' ? '0%' : '100%', top: `${c.featY}%`,
              transform: 'translate(-50%, -50%)',
            }}><Marker n={c.n} numbered /></span>
          ))}
        </div>
        <ol style={{ listStyle: 'none', padding: 0, margin: '32px 0 0', display: 'grid', gap: 18 }}>
          {CALLOUTS.map((c) => (
            <li key={c.n} style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}>
              <span className="vg-mono" style={{
                width: 22, height: 22, borderRadius: 999, flexShrink: 0,
                background: C.ember, color: '#fff', fontSize: 11, fontWeight: 800,
                display: 'grid', placeItems: 'center',
              }}>{c.n}</span>
              <div>
                <div className="vg-syne" style={{ fontSize: 14.5, fontWeight: 700, color: C.text }}>{c.title}</div>
                <div style={{ fontSize: 13.5, color: C.text2, marginTop: 3, lineHeight: 1.55 }}>{c.body}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Band>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 4. Getting seen
// ─────────────────────────────────────────────────────────────────────

const ENTRY_STEPS = [
  ['Followers see you arrive', 'From your very first level.'],
  ['The whole room sees you', 'Including people who have never met you.'],
  ['Light sweeps your ribbon', 'It catches the eye on the way in.'],
  ['It shimmers, and they hear you', 'The loudest entrance on the platform.'],
];

function GettingSeen() {
  return (
    <Band glow={{ color: 'rgba(245,197,66,0.09)', top: '10%', right: '-10%' }}>
      <div style={{ display: 'grid', gap: 56, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'center' }}>
        {/* ⚠ The closing "rank travels into chat" line lives INSIDE this column.
            As a full-width paragraph under both columns it was an orphan sitting
            in a large void, which made the whole section read as unfinished. */}
        <div>
          <SectionTitle
            eyebrow="Walking in"
            title="Everyone knows when you turn up"
            lede="Watch, chat, stream, and you level up. What that buys you is not a number on a settings page, it is an entrance the whole room can see."
          />
          <Reveal delay={120}>
            <p style={{ fontSize: 14, color: C.text3, lineHeight: 1.65, margin: '-20px 0 0', maxWidth: 460 }}>
              Your rank travels with you into chat too, sitting beside your name on every message
              you send.
            </p>
          </Reveal>
        </div>
        <div>
          {ENTRY_STEPS.map(([t, b], i) => (
            <Reveal key={t} delay={i * 90}>
              <div style={{
                display: 'flex', gap: 16, alignItems: 'flex-start',
                padding: '16px 0', borderBottom: i < 3 ? `1px solid ${C.borderSoft}` : 'none',
              }}>
                <span className="vg-mono" style={{
                  fontSize: 11, fontWeight: 700, color: C.text3,
                  letterSpacing: '0.14em', marginTop: 4, flexShrink: 0,
                }}>{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <div className="vg-syne" style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{t}</div>
                  <div style={{ fontSize: 13.5, color: C.text2, marginTop: 3, lineHeight: 1.55 }}>{b}</div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </Band>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 5 + 6. Two-up feature bands
// ─────────────────────────────────────────────────────────────────────

function FeatureCard({ icon, title, body, children, delay }) {
  return (
    <Reveal delay={delay}>
      <div className="vg-card" style={{ ...surface, height: '100%' }}>
        <span style={{
          width: 40, height: 40, borderRadius: 12,
          background: 'rgba(255,255,255,0.06)', color: C.violet,
          display: 'grid', placeItems: 'center',
        }}><Icon name={icon} size={21} /></span>
        <div className="vg-syne" style={{ fontSize: 18.5, fontWeight: 700, color: C.text, marginTop: 16 }}>{title}</div>
        <p style={{ fontSize: 14.5, lineHeight: 1.65, color: C.text2, margin: '9px 0 0' }}>{body}</p>
        {children}
      </div>
    </Reveal>
  );
}

function Quality() {
  return (
    <Band glow={{ color: 'rgba(123,111,255,0.13)', top: '5%', right: '-6%' }}>
      <SectionTitle eyebrow="Holding up" title="It does not fall apart when your wifi does" />
      <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <FeatureCard icon="hd" title="Everyone watches what you sent"
          body="We do not re-encode your stream into a ladder of worse copies. What leaves your machine is what lands on every screen watching, whatever anyone is paying." />
        <FeatureCard icon="network_check" delay={100} title="A bad minute does not freeze the room"
          body="If your upload dips we ease the framerate back instead of buffering everybody, then bring it up again once you are clear. Most of the time nobody notices." />
      </div>
    </Band>
  );
}

function Together() {
  return (
    <Band glow={{ color: 'rgba(255,77,106,0.10)', top: '8%', left: '-10%' }}>
      <SectionTitle eyebrow="Not on your own" title="Nobody streams alone" />
      <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <FeatureCard icon="groups" title="Bring people on screen"
          body="Up to three guests join you in one feed, sharing one chat. Run a collab, a co-commentary, or a squad night. It costs nothing on any plan.">
          <div style={{ display: 'flex', gap: 9, marginTop: 18 }}>
            {['You', '+1', '+2', '+3'].map((l, i) => (
              <div key={l} style={{
                flex: 1, aspectRatio: '1', borderRadius: 10,
                background: i === 0 ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)',
                display: 'grid', placeItems: 'center',
              }}>
                <span className="vg-mono" style={{ fontSize: 11, fontWeight: 700, color: i === 0 ? C.text : C.text3 }}>{l}</span>
              </div>
            ))}
          </div>
        </FeatureCard>
        <FeatureCard icon="sync_alt" delay={100} title="Keep streaming on Twitch too"
          body="One OBS output goes to both places at once, and the two chats are bridged so you are only reading one room. You do not have to pick a side, or move your people before you are ready." />
      </div>
    </Band>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 7. Earning
//
// ⚠⚠ AN EARLIER VERSION OF THIS SECTION SAID "There is no partner programme and
// no threshold to cross before any of it switches on." THAT WAS FALSE TWICE.
//
//   1. There IS a programme. functions/creatorProgram.js line 4: "Users are not
//      creators by default, they apply and a human reviews it." Rejection
//      carries a 30-day reapply cooldown (REAPPLY_COOLDOWN_DAYS).
//   2. There ARE thresholds. measureRequired() demands KYC >= 1, 18+, and zero
//      active strikes, and measurePaths() demands ONE of four routes. Payout
//      then adds its own gates in creatorPayouts.js blockingReason():
//      MIN_ACCOUNT_AGE_DAYS = 30, kycLevel >= 1, tax form on file, a connected
//      payout account, and MIN_PAYOUT_MICRO_USD = $100.
//
// The truth is also BETTER COPY than the invention was, which is the whole
// lesson. Twitch's affiliate test includes an average-concurrent-viewer
// requirement that is unreachable early; creatorProgram.js drops it on purpose
// ("Twitch's concurrency test is impossible below a few thousand users, so it is
// dropped and the rest are scaled down") and offers four routes instead. Being
// able to qualify by POSTING, or by BRINGING PEOPLE, without ever hitting a
// viewer count, is a real differentiator. Say that instead of pretending there
// is no bar at all.
//
// ⚠ Coins are never refused before approval. coinLedger.js:266 moves them to
// `pendingCreatorCoins` and adminDecideCreatorApplication converts them on
// approval, so "you can be tipped from your first stream" IS true — it is only
// the conversion into money owed that waits.
// ─────────────────────────────────────────────────────────────────────

const PATHS = [
  ['group', 'Audience', 'Reach 100 followers.'],
  ['videocam', 'Streamer', 'Stream on five separate days, two hours in total, within a month.'],
  ['diversity_3', 'Builder', 'Bring five friends who join and are still around a week later.'],
  ['edit_note', 'Contributor', 'Publish twenty posts in a month.'],
];

function Earning() {
  return (
    <Band glow={{ color: 'rgba(245,197,66,0.09)', top: 0, left: '-6%' }}>
      <SectionTitle
        color={C.gold}
        eyebrow="Getting paid"
        title="Four ways in. Only one of them is streaming."
        lede="Most platforms give you a single road in, and it usually runs through a viewer count you cannot reach when you are starting out. Twitch wants an average concurrent audience before it will talk to you. We dropped that test and replaced it with a menu, so the route that suits you is the one you take."
      />

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {PATHS.map(([ic, t, b], i) => (
          <Reveal key={t} delay={i * 80}>
            <div className="vg-card" style={{ ...surface, height: '100%' }}>
              <span style={{
                width: 38, height: 38, borderRadius: 11,
                background: 'rgba(255,255,255,0.06)', color: C.gold,
                display: 'grid', placeItems: 'center',
              }}><Icon name={ic} size={19} /></span>
              <div className="vg-syne" style={{ fontSize: 17, fontWeight: 700, color: C.text, marginTop: 15 }}>{t}</div>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: C.text2, margin: '8px 0 0' }}>{b}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={140}>
        <p style={{ fontSize: 15, lineHeight: 1.7, color: C.text2, margin: '28px 0 0', maxWidth: 780 }}>
          Hit any one of those and you can apply. Everybody also has to verify who they are, be over
          18, and have a clean record, because that is what stops a platform filling up with people
          who are here to work it rather than use it. A person reads your application, not a script.
        </p>
      </Reveal>

      <Reveal delay={180}>
        <div style={{
          ...surface, marginTop: 26,
          display: 'grid', gap: 30, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        }}>
          <div>
            <div className="vg-syne" style={{ fontSize: 16.5, fontWeight: 700, color: C.text }}>
              You can be tipped before any of that
            </div>
            <p style={{ fontSize: 14, lineHeight: 1.65, color: C.text2, margin: '9px 0 0' }}>
              Coins people send you on your very first stream are never turned away. They are held
              against your name, and the moment you are approved they convert into real money you
              are owed, backdated. Nothing you earned while you were getting there is lost.
            </p>
          </div>
          <div>
            <div className="vg-syne" style={{ fontSize: 16.5, fontWeight: 700, color: C.text }}>
              What it takes to actually get paid
            </div>
            <p style={{ fontSize: 14, lineHeight: 1.65, color: C.text2, margin: '9px 0 0' }}>
              Your account needs to be a month old, your identity and tax details on file, and at
              least $100 owed to you. After that we pay you on a schedule that gets quicker the
              longer you are around. You never file a request for it.
            </p>
          </div>
        </div>
      </Reveal>

      <Reveal delay={220}>
        <p style={{ fontSize: 14, color: C.text3, lineHeight: 1.7, margin: '24px 0 0', maxWidth: 780 }}>
          You keep between 50% and 80% of everything you generate, set by what you have earned in
          total across your whole account. It climbs as you earn and it never drops back down. There
          is no separate fee on tips, on memberships or on getting paid.{' '}
          <Link to="/platform/learn/coins" style={{ color: C.gold, fontWeight: 700 }}>How earning works →</Link>
        </p>
      </Reveal>
    </Band>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 8. Moderation
// ─────────────────────────────────────────────────────────────────────

const MOD_TOOLS = [
  ['shield_person', 'Hand a regular a mod badge',
    'Anyone you trust gets a shield next to their name and the tools to use it, on your channel only.'],
  ['block', 'Your own banned-word list',
    'Words you never want to see are filtered out on the way through, before anybody in the room reads them.'],
  ['hourglass_bottom', 'Slow mode when it gets busy',
    'Put a cooldown between messages so a rush of new arrivals does not bury the people already talking.'],
  ['group', 'Followers-only chat in one tap',
    'Lock sending to people who actually follow you when someone decides to make your night difficult.'],
];

function Moderation() {
  return (
    <Band glow={{ color: 'rgba(123,111,255,0.13)', top: '12%', right: '-12%' }}>
      <div style={{ display: 'grid', gap: 52, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'start' }}>
        <SectionTitle
          eyebrow="Your chat, your rules"
          title="Moderation that is already there"
          lede="You should not have to run a bot account, sign up to a third-party service and keep a second dashboard open on another monitor just to keep your own chat civil. All of this is in the stream page, and it is on every plan."
        />
        <div>
          {MOD_TOOLS.map(([ic, t, b], i) => (
            <Reveal key={t} delay={i * 80}>
              <div style={{
                display: 'flex', gap: 14, alignItems: 'flex-start',
                padding: '15px 0', borderBottom: i < MOD_TOOLS.length - 1 ? `1px solid ${C.borderSoft}` : 'none',
              }}>
                <span style={{ color: C.violet, display: 'grid', marginTop: 3 }}><Icon name={ic} size={17} /></span>
                <div>
                  <div className="vg-syne" style={{ fontSize: 14.5, fontWeight: 700, color: C.text }}>{t}</div>
                  <div style={{ fontSize: 13.5, color: C.text2, marginTop: 4, lineHeight: 1.55 }}>{b}</div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </Band>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 8 + 9. FAQ + CTA
// ─────────────────────────────────────────────────────────────────────

const FAQS = [
  ['Do I need followers before I can go live?',
    'No. You can stream publicly from your first day on every plan, including the free one. There is no follower threshold and nothing to pay to start a stream.'],
  ['Do I have to install anything?',
    'Only if you want to. There is a Vergr app for Android and one for Windows, and both are worth having, but you can also just open Vergr in a browser and go live from there with nothing downloaded. If you would rather use OBS, that works on every plan too.'],
  ['Can I stream from my phone?',
    'Yes. Go live from the Android app, and watch from it as well. Everything on this page works there, including chat, tips, goals, guests and clipping.'],
  ['Do people watching on the free plan get worse quality?',
    'No. There is one version of your stream and we do not re-encode it, so everybody watching sees exactly what you sent, whatever plan they are on.'],
  ['How long can I stream for?',
    'Thirty minutes a day on the free plan, four hours a day on Lite, and as long as you like on Pro.'],
  ['Are my old streams saved?',
    'On Pro every broadcast is kept for 90 days so people can watch it back. On Free and Lite streams are not saved once they end.'],
  ['Can I charge people to watch?',
    'Yes. Any stream can be set to paid, and people either buy a pass for that one stream or get in automatically if they are already a member of yours.'],
  ['What do I actually keep?',
    'Between 50% and 80%, based on what you have earned in total over time. Your rate goes up as you earn and never drops back down, and there is no separate fee on tips, memberships or payouts.'],
  ['Do I have to join something before I can earn?',
    'To turn what people send you into money you are owed, yes. You apply to the creator programme and a person reviews it. Everyone needs verified identity, to be over 18, and no active strikes, and then you qualify on any one of four routes: 100 followers, five streaming days totalling two hours in a month, five friends you brought who are still around a week later, or twenty posts in a month. Coins people send you before you are approved are held for you, not turned away, and they convert the moment you are in.'],
  ['When can I actually withdraw?',
    'Your account has to be at least a month old, your identity and tax details have to be on file, and you need at least $100 owed to you. Once that is true we pay you on a schedule that gets faster the longer you have been around, and you never have to file a request.'],
];

function FaqItem({ q, a, open, onToggle }) {
  return (
    <div style={{ borderBottom: `1px solid ${C.borderSoft}` }}>
      <button type="button" onClick={onToggle} aria-expanded={open} style={{
        width: '100%', display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between',
        padding: '20px 0', background: 'none', border: 'none', cursor: 'pointer',
        textAlign: 'left', color: C.text, font: 'inherit',
      }}>
        <span className="vg-syne" style={{ fontSize: 16, fontWeight: 700 }}>{q}</span>
        <span style={{
          color: open ? C.violet : C.text3, flexShrink: 0, display: 'grid',
          transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.25s ease',
        }}><Icon name="expand_more" size={20} /></span>
      </button>
      <div className="vg-faq-body" style={{ gridTemplateRows: open ? '1fr' : '0fr' }}>
        <div style={{ overflow: 'hidden' }}>
          <p style={{ fontSize: 14.5, lineHeight: 1.7, color: C.text2, margin: '0 0 22px', maxWidth: 760 }}>{a}</p>
        </div>
      </div>
    </div>
  );
}

function Faq() {
  const [open, setOpen] = useState(0);
  return (
    <Band>
      <SectionTitle eyebrow="Questions" title="Before you start" />
      <Reveal>
        <div>
          {FAQS.map(([q, a], i) => (
            <FaqItem key={q} q={q} a={a} open={open === i} onToggle={() => setOpen(open === i ? -1 : i)} />
          ))}
        </div>
      </Reveal>
    </Band>
  );
}

function FinalCta() {
  return (
    <section className="vg-section" style={{ padding: '20px 32px 110px' }}>
      <Reveal style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div style={{
          padding: '72px 32px', borderRadius: 24, textAlign: 'center',
          position: 'relative', overflow: 'hidden',
          background: `radial-gradient(120% 140% at 50% 0%, ${C.violet}22 0%, rgba(7,8,13,0) 62%)`,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07)',
        }}>
          <h2 className="vg-syne vg-balance" style={{
            fontSize: 'clamp(28px, 3.6vw, 42px)', fontWeight: 800,
            letterSpacing: '-0.03em', margin: '0 auto', maxWidth: '16ch',
          }}>
            Your first stream is minutes away.
          </h2>
          <p style={{ fontSize: 16.5, color: C.text2, margin: '18px auto 32px', maxWidth: 480, lineHeight: 1.6 }}>
            Nobody to ask and nothing to qualify for. Make an account and go live.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/signup" className="vg-btn-primary" style={{ textDecoration: 'none' }}>Create my account</Link>
            <Link to="/platform/download" className="vg-btn-ghost" style={{ textDecoration: 'none' }}>Get the app</Link>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────

function LiveStyles() {
  return (
    <style>{`
      .vg-balance { text-wrap: balance; }

      /* ⚠ FADING SECTION RULE, not a border. A rule that stops at full strength
         against a bare corner reads as a cage edge (src/styles/surface.css).
         Same ramp profile as .vg-rule-h: in at 18%, out at 76%. */
      .vg-band::before {
        content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px;
        background: linear-gradient(90deg,
          transparent,
          rgba(186,176,255,0.20) 18%,
          rgba(186,176,255,0.20) 76%,
          transparent);
      }

      /* ⚠ GRAIN. src/styles/surface.css calls this "the single biggest
         cheap-to-designed lever on a dark UI", and it costs no asset and no
         request. feTurbulence inline, soft-light so it is tooth on the surface
         rather than grey haze over it. z-index -1 keeps it above the section
         background but below every bit of in-flow content. */
      .vg-band::after {
        content: ''; position: absolute; inset: 0; z-index: -1;
        pointer-events: none; opacity: 0.055; mix-blend-mode: soft-light;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
        background-size: 160px 160px;
      }

      /* Card hover: the shared .vg-lift animates border-color, and these cards
         deliberately have no border, so it did nothing here. */
      .vg-card { transition: transform 220ms cubic-bezier(.22,.61,.36,1), box-shadow 220ms ease; }
      .vg-card:hover {
        transform: translateY(-3px);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.16), 0 30px 60px -30px rgba(0,0,0,1);
      }

      .vg-reveal, .vg-callout, .vg-mark {
        opacity: 0;
        transform: translateY(18px);
        transition: opacity 620ms cubic-bezier(.22,.61,.36,1),
                    transform 620ms cubic-bezier(.22,.61,.36,1);
        will-change: opacity, transform;
      }
      .vg-reveal.is-in, .vg-callout.is-in { opacity: 1; transform: none; }

      /* The marker keeps its centring transform, so it fades and scales only. */
      .vg-mark { transform: translate(-50%, -50%) scale(0.7); }
      .vg-mark.is-in { opacity: 1; transform: translate(-50%, -50%) scale(1); }

      /* Callouts are vertically centred on their labelY. */
      .vg-callout { transform: translateY(calc(-50% + 18px)); }
      .vg-callout.is-in { transform: translateY(-50%); }

      /* Leader lines draw themselves in. pathLength=100 normalises every
         polyline so one dash length works for all six regardless of geometry. */
      .vg-lead {
        stroke-dasharray: 100;
        stroke-dashoffset: 100;
        transition: stroke-dashoffset 900ms cubic-bezier(.22,.61,.36,1);
      }
      .vg-lead.is-drawn { stroke-dashoffset: 0; }

      .vg-float { animation: vg-live-float 7s ease-in-out infinite; }
      @keyframes vg-live-float {
        0%, 100% { transform: translateY(0); }
        50%      { transform: translateY(-10px); }
      }

      .vg-faq-body { display: grid; transition: grid-template-rows 280ms cubic-bezier(.22,.61,.36,1); }

      .vg-anatomy-narrow { display: none; }
      @media (max-width: 1000px) {
        .vg-anatomy-wide { display: none !important; }
        .vg-anatomy-narrow { display: block; }
      }
      @media (min-width: 900px) {
        .vg-live-hero { grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr) !important; }
      }

      /* ⚠ BOTH reduced-motion switches. Every resting state here is the VISIBLE
         one, so killing the transition can only reveal, never hide. */
      @media (prefers-reduced-motion: reduce) {
        .vg-reveal, .vg-callout, .vg-mark, .vg-lead, .vg-float, .vg-faq-body {
          transition: none !important; animation: none !important;
        }
        .vg-reveal, .vg-callout { opacity: 1 !important; transform: none !important; }
        .vg-mark { opacity: 1 !important; transform: translate(-50%, -50%) !important; }
        .vg-lead { stroke-dashoffset: 0 !important; }
      }
      html[data-reduced-motion="true"] .vg-reveal,
      html[data-reduced-motion="true"] .vg-callout,
      html[data-reduced-motion="true"] .vg-mark,
      html[data-reduced-motion="true"] .vg-lead,
      html[data-reduced-motion="true"] .vg-float {
        transition: none !important; animation: none !important;
      }
      html[data-reduced-motion="true"] .vg-reveal,
      html[data-reduced-motion="true"] .vg-callout { opacity: 1 !important; transform: none !important; }
      html[data-reduced-motion="true"] .vg-mark { opacity: 1 !important; transform: translate(-50%, -50%) !important; }
      html[data-reduced-motion="true"] .vg-lead { stroke-dashoffset: 0 !important; }
    `}</style>
  );
}

export default function LearnLiveScreen() {
  useSeo({
    // ⚠ Keep identical to the /platform/learn/live entry in
    // scripts/prerenderHelp.mjs, and keep its h1 matching the <h1> above.
    title: 'Live Streaming on VERGR | Go Live From Your Phone or PC',
    description: 'Go live from the Vergr app on Android or Windows, or straight from a browser tab. No follower gate and no application. Tips, members and paid streams work from your first broadcast.',
    canonical: 'https://vergr.app/platform/learn/live',
  });
  return (
    <MarketingShell>
      <LiveStyles />
      <JsonLd data={faqSchema(FAQS)} />
      <LiveHero />
      <GoingLive />
      <StreamAnatomy />
      <GettingSeen />
      <Quality />
      <Together />
      <Earning />
      <Moderation />
      <Faq />
      <FinalCta />
    </MarketingShell>
  );
}
