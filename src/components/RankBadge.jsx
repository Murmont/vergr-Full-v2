// RankBadge — the user's VP rank, shown beside their name across the app.
//
// ## Why this is a badge and NOT an avatar ring
//
// `UserAvatar` already supports a rank ring, but `showTierRing` defaults to
// FALSE with a deliberate note: "painting one on every avatar in every list made
// the whole app look permanently on fire". That decision stands. A small crest
// beside the name is the calm version of the same signal, and it is what
// docs/GAMIFICATION_PLAN.md section 6 calls the highest-coverage reward in the
// system ("one change, enormous surface coverage").
//
// ## Why it starts at Contender (L11) and not L1
//
// If every account carries a badge, the badge means nothing and every list is
// noisy again. Rookie deliberately shows NOTHING, so the first badge is a real
// moment at L11 and every badge on screen is a signal. This mirrors the entry
// ribbon, where Rookie gets no ribbon at all.
//
// ## Data
//
// `level` comes from `users/{uid}.vpLevel`, denormalised from `wallets/{uid}.vp`
// by the syncVpLevel trigger (functions/vpLevel.js). Other users' wallets are not
// readable, so that field is the ONLY way to show someone else's rank. If it is
// absent the badge renders nothing rather than guessing Rookie.

import { useState } from 'react';
import { getRankBanner } from '../utils/rankBanners';
import { useUser } from '../context/UserContext';
import RankCrestPopover from './RankCrestPopover';
import { getCurrentBadge, smallBadgeArt } from '../utils/badgeSystem';
import { ANIMATED_CREST_LEVEL, CREST_CYCLE_MS, crestPhaseMs } from '../utils/rankUnlocks';

/** Below this level no badge is shown at all. Keeps the signal meaningful. */
export const MIN_BADGE_LEVEL = 11;

export default function RankBadge({
  level,
  uid,
  role,
  size = 15,
  showLabel = false,
  showLevel = false,
  className = '',
  style,
  onOpen,
  animated = false,
  isSelf = false,
  // ⚠⚠ IN A MESSAGE FEED THE CREST MUST NOT BE ITS OWN TAB STOP. Measured on the live
  // preview 2026-09-03: **35 of 45 tab stops on the stream were chat crests**, 21 of them
  // scrolled out of view, and a real chat holds far more rows than that sample. A keyboard
  // user would tab through every historic crest before reaching the dock or the composer.
  //
  // `tabIndex={-1}` keeps it clickable and programmatically focusable — it only leaves
  // SEQUENTIAL navigation. Nothing is lost, because the same rank information is on the
  // profile and the username beside it is still a tab stop that opens it.
  //
  // ⚠ DEFAULT IS FALSE. Everywhere else — profile, lists, search — there is one crest per
  // screen, not one per row, and it stays fully keyboard reachable.
  feed = false,
}) {
  // ⚠ HOOKS FIRST, ABOVE EVERY EARLY RETURN. This component returns null below
  // MIN_BADGE_LEVEL, so a hook placed after that return changes the hook count
  // between renders and React throws #310 — the exact crash `useEffectEnabled`
  // caused on ProfileScreen (CLAUDE.md). `useState` must sit here.
  const [card, setCard] = useState(null);
  const { wallet } = useUser();
  // ⚠ THERE IS DELIBERATELY NO ADMIN ALLOWANCE HERE, AND THAT IS A REVERSAL.
  //
  // `UserName` and `isEffectOn()` both resolve `role === 'admin'` to level 100
  // so cosmetics can be judged on a real account (CLAUDE.md). This component was
  // given the same allowance on 2026-08-27 and it was WRONG — rendered on the
  // live profile it put an ASCENDANT CREST directly beside the account's own
  // "ROOKIE" pill, with the sidebar reading LVL 2. Three rank claims on one
  // screen, two of them true.
  //
  // The distinction is the point: a name colour, typeface or gradient makes no
  // claim about anything. A CREST ASSERTS A RANK. A cosmetic may be previewed;
  // a rank may not be faked, not even for the founder, not even to test with.
  //
  // ⚠ CONSEQUENCE, STATED PLAINLY: there are currently ZERO users at L11+ in
  // production, so the crest renders nowhere on live data. That is correct
  // behaviour, not a bug — but it does mean the crest CANNOT be smoke-tested
  // without first giving some account a real `vpLevel` (a server-only field).
  const lvl = Number(level) || 0;
  if (lvl < MIN_BADGE_LEVEL) return null;

  const rank = getRankBanner(lvl);
  const badge = getCurrentBadge(lvl);
  if (!badge?.art) return null;

  // ⚠ THE SMALL VARIANT, ALWAYS. The full-size art is 1024x1024 and averages
  // 167 KB to paint a 13px icon; a chat with eight rank bands present pulled
  // ~1.4 MB and decoded eight 4 MB RGBA surfaces. See badgeSystem.smallBadgeArt.
  const art = smallBadgeArt(badge.art);
  // ⚠ THE SWEEP IS OPT-IN PER SURFACE, THE CREST IS NOT.
  // Founder, 2026-08-27: "they dont all need to be animated, the crest just
  // needs to be visible if they are higher than rookie". So the crest shows on
  // every surface from L11, and the L62 sweep is something a caller asks for —
  // today only live chat does. An always-on sweep would put motion into
  // follower lists and search results, which is the "permanently on fire" look
  // this component was written to avoid.
  const living = animated && lvl >= ANIMATED_CREST_LEVEL;

  return (
    <span
      // ⚠ `vg-crest-hit` WIDENS THE TAP TARGET TO 24x24 WITHOUT MOVING ANYTHING.
      // This span is the button (see the note below) and it sizes to the 13px art,
      // which is under the WCAG 2.2 AA target minimum and, in a scrolling chat on a
      // phone, is a scroll rather than a tap. The extra reach is a pseudo-element,
      // so layout is untouched; see surface.css for the clearance measurements.
      className={`vg-crest-hit inline-flex items-center gap-1 shrink-0 align-middle ${className}`}
      title={`${rank.name} · Level ${lvl}`}
      style={{ ...style, cursor: 'pointer' }}
      // ⚠ THE HIT TARGET IS THIS OUTER SPAN, NOT THE CREST WRAPPER. `.vg-crest`
      // carries `pointer-events: none` (its padded box overlaps the username by
      // design), so a click lands here — its parent — which is exactly what we
      // want: one target whether or not the crest is a living one.
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        if (onOpen) onOpen(rect); else setCard(rect);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          if (onOpen) onOpen(rect); else setCard(rect);
        }
      }}
      role="button"
      tabIndex={feed ? -1 : 0}
      aria-label={`${rank.name}, level ${lvl}. Open rank details`}
    >
      {/* Effect 21. The wrapper exists ONLY when the crest is living, so a
          normal crest keeps exactly the markup it had — no extra element, no
          stacking context, nothing to measure. R6's `isolation: isolate` and
          the overflow clip both live on `.vg-crest`. */}
      <span
        className={living ? 'vg-crest vg-crest-live' : undefined}
        style={living ? {
          // ⚠ NO width/height HERE. The wrapper must size itself to the image
          // PLUS --vg-crest-pad; pinning it to `size` under border-box would
          // squeeze the content box to a couple of pixels and crush the crest.
          '--vg-crest-ring': `${rank.ring}88`,
          '--vg-crest-cycle': `${CREST_CYCLE_MS}ms`,
          // Negative, so phases are already spread on the first painted frame
          // rather than every crest sitting dark waiting for its first turn.
          '--vg-crest-phase': `${crestPhaseMs(uid)}ms`,
        } : undefined}
      >
        <img
          src={art}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          draggable={false}
          style={{
            width: size, height: size, objectFit: 'contain',
            filter: `drop-shadow(0 0 ${Math.round(size * 0.3)}px ${rank.ring}66)`,
          }}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
        {living && (
          // ⚠ R7: this reads its OWN copy of the art as a mask and never touches
          // the <img> being decorated. Same file, so it is a cache hit, not a
          // second download.
          <span
            className="vg-crest-sheen"
            aria-hidden="true"
            style={{ WebkitMaskImage: `url(${art})`, maskImage: `url(${art})` }}
          />
        )}
      </span>
      {/* ⚠ THE CARD LIVES HERE, NOT AT THE CALL SITE. It was first wired only
          in ChatPanel via onOpen, so on the profile, the feed, lists and DMs the
          crest rendered and did nothing when tapped — a popup the founder asked
          for on the crest, delivered on one surface out of eleven. Owning it
          here means every crest is tappable with zero per-site wiring.
          The `onOpen` prop survives as an override for a caller that must
          position the card itself — ChatPanel does, because its column is an
          overflow scroller that would clip a locally-rendered popover. */}
      {card && (
        <RankCrestPopover
          level={lvl}
          anchorRect={card}
          isSelf={isSelf}
          wallet={wallet}
          onClose={() => setCard(null)}
        />
      )}
      {showLabel && (
        <span style={{ color: rank.ring, fontSize: Math.round(size * 0.72), fontWeight: 700 }}>
          {rank.name}
        </span>
      )}
      {showLevel && (
        <span
          className="font-dmmono tabular-nums"
          style={{ color: rank.ring, fontSize: Math.round(size * 0.68), fontWeight: 700 }}
        >
          {lvl}
        </span>
      )}
    </span>
  );
}
