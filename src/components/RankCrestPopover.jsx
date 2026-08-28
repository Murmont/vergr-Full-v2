// The card that opens when someone taps a rank crest in chat. Effect 21.
//
// ## Why this exists
//
// The crest is the only place most users ever SEE the level ladder. Founder,
// 2026-08-27: it is "encouragement for other users to level up". A crest you
// cannot interrogate is decoration; a crest that tells you what it is, what it
// took and what it unlocks is a recruiting poster.
//
// ## ⚠ WHAT IT CAN AND CANNOT SHOW, AND WHY — READ BEFORE ADDING A FIGURE
//
// `firestore.rules:1568` is `match /wallets/{userId} { allow read: if
// isOwner(userId) }`. **Another user's VP is not readable, by anyone, ever.**
// So for somebody else's crest this shows level, rank, and the ladder — all
// derived from `vpLevel`, which the relay already stamps on every message, so
// it costs ZERO reads (R9). It does NOT show their progress bar, because the
// number behind that bar cannot be obtained. Do not add one: a bar filled from
// a guess is worse than no bar.
//
// Your OWN crest gets the bar, because UserContext already holds your wallet.
//
// ## ⚠ IT MUST BE A PORTAL
//
// The chat column is an `overflow-y: auto` scroller. A popover rendered inside
// a message row is clipped by it — the card would be cut off at the panel edge,
// which is exactly how it would ship looking broken. It renders to `body` and
// positions itself in viewport coordinates against the crest's rect.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getRankBanner } from '../utils/rankBanners';
import { getCurrentBadge } from '../utils/badgeSystem';
import { RANK_UNLOCKS } from '../utils/rankUnlocks';
// ⚠ `getVPProgress` RETURNS A BARE NUMBER (0-100), not an object. The first
// draft of this file called a `levelProgress()` that does not exist anywhere in
// the codebase — it would have built green and thrown the moment somebody
// tapped their own crest. Checked against the export list, not from memory.
import { RANK_TIERS, getVPProgress, MAX_VP_LEVEL } from '../utils/vpSystem';

const CARD_W = 268;
const GAP = 10;

/** Rows the ladder grants AT this exact level. */
const unlocksAt = (level) => RANK_UNLOCKS.filter((r) => r.level === level);

/**
 * The next level that grants something worth walking towards.
 *
 * ⚠ IT SKIPS THE VP-RATE ROWS, AND THAT IS THE WHOLE VALUE OF THIS CARD.
 * Every single level carries a `vprate_` row (+0.5% earn rate), so a naive
 * "next level" lookup returns that on roughly seventy of the hundred levels.
 * Measured on the live card before this changed: level 74 read "Unlocked at 74:
 * +0.5% VP earn rate. Next, at level 75: +0.5% VP earn rate." Truthful, and
 * completely inert as encouragement — which is the one job the founder gave
 * this card.
 *
 * So it looks ahead for a real unlock and falls back to the rate bump only when
 * there is genuinely nothing else left.
 */
const isMilestone = (r) => r.kind !== 'vprate' && !String(r.id).startsWith('vprate_');

const nextUnlock = (level) => {
  const ahead = RANK_UNLOCKS.filter((r) => r.level > level).sort((a, b) => a.level - b.level);
  if (!ahead.length) return null;
  const target = ahead.find(isMilestone) || ahead[0];
  const at = target.level;
  // Everything granted at that level, milestones first so the headline reward
  // is the one the reader sees.
  const rows = ahead.filter((r) => r.level === at)
    .sort((a, b) => Number(isMilestone(b)) - Number(isMilestone(a)));
  return { level: at, rows };
};

export default function RankCrestPopover({ level, anchorRect, isSelf, wallet, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });

  const lvl = Number(level) || 0;
  const rank = getRankBanner(lvl);
  const badge = getCurrentBadge(lvl);
  const tier = RANK_TIERS.find((t) => lvl >= t.min && lvl <= t.max) || RANK_TIERS[0];
  const granted = unlocksAt(lvl);
  const next = nextUnlock(lvl);

  // ⚠ Measured AFTER paint and BEFORE the browser shows it, so the card never
  // appears in the wrong place for a frame and jumps. It also flips above the
  // crest when there is no room below, which in the overlay layout (chat sitting
  // on the bottom of a video) is the common case, not the edge case.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchorRect) return;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchorRect.left + anchorRect.width / 2 - CARD_W / 2;
    left = Math.max(8, Math.min(left, vw - CARD_W - 8));
    let top = anchorRect.bottom + GAP;
    if (top + h > vh - 8) top = Math.max(8, anchorRect.top - h - GAP);
    setPos({ left, top });
  }, [anchorRect]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    // `true` = capture, so a click anywhere closes it even when the click lands
    // on something that stops propagation (chat rows do).
    const onDown = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    // A scrolling chat would otherwise leave the card stranded mid-air.
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  // Only ever computed for your own crest — see the header.
  const pct = isSelf && wallet ? getVPProgress(wallet.vp || 0) : null;

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`${rank.name}, level ${lvl}`}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', left: pos.left, top: pos.top, width: CARD_W, zIndex: 9999,
        background: 'linear-gradient(180deg, #16161F, #101018)',
        borderRadius: 14, padding: '14px 15px 13px',
        boxShadow: `0 18px 44px -14px rgba(0,0,0,0.85), 0 0 0 1px ${rank.ring}33, 0 0 34px -14px ${rank.ring}`,
        color: '#fff', font: '13px/1.5 inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        {badge?.art && (
          <img
            src={badge.art}
            alt=""
            width={46}
            height={46}
            style={{
              width: 46, height: 46, objectFit: 'contain', flexShrink: 0,
              filter: `drop-shadow(0 0 10px ${rank.ring}66)`,
            }}
          />
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15,
            color: rank.ring, letterSpacing: '0.01em',
          }}>{rank.name}</div>
          <div style={{ color: '#9CA3AF', fontSize: 11.5 }}>
            Level <span className="font-dmmono tabular-nums" style={{ fontWeight: 700, color: '#fff' }}>{lvl}</span>
            <span style={{ opacity: 0.5 }}> · band {tier.min}–{tier.max}</span>
          </div>
        </div>
      </div>

      {/* ⚠ OWN CREST ONLY. See the header: another user's VP is unreadable.
          ⚠ AND NOT AT MAX. Rendered on the live L100 account this read
          "Progress to level 101 — 100%", against a sidebar on the same screen
          correctly saying "Max level". There is no level 101. `getVPProgress`
          returns 100 at the cap, so the bar was full and the label was fiction. */}
      {pct !== null && lvl < MAX_VP_LEVEL && (
        <div style={{ marginTop: 12 }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            fontSize: 10.5, color: '#6B7280', marginBottom: 5,
          }}>
            <span>Progress to level {lvl + 1}</span>
            <span className="font-dmmono tabular-nums">
              {Math.round(pct)}%
            </span>
          </div>
          <div style={{ height: 5, borderRadius: 99, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
            <div style={{
              width: `${Math.max(2, Math.min(100, pct))}%`, height: '100%',
              borderRadius: 99, background: `linear-gradient(90deg, ${rank.ring}, #fff)`,
            }} />
          </div>
        </div>
      )}

      {pct !== null && lvl >= MAX_VP_LEVEL && (
        <div style={{ marginTop: 12, fontSize: 11.5, fontWeight: 700, color: rank.ring }}>
          Max level reached
        </div>
      )}

      {granted.length > 0 && (
        <div style={{ marginTop: 13 }}>
          <div style={{ fontSize: 10, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
            Unlocked at {lvl}
          </div>
          {granted.slice(0, 3).map((r) => (
            <div key={r.id} style={{ marginTop: 5, fontSize: 12, color: '#D7D7E0' }}>
              <span style={{ color: rank.ring, marginRight: 6 }}>•</span>{r.name}
            </div>
          ))}
        </div>
      )}

      {next && (
        <div style={{ marginTop: 13, paddingTop: 11, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ fontSize: 10, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
            Next, at level {next.level}
          </div>
          {next.rows.slice(0, 2).map((r) => (
            <div key={r.id} style={{ marginTop: 5, fontSize: 12, color: '#D7D7E0' }}>
              <span style={{ color: '#6B7280', marginRight: 6 }}>•</span>{r.name}
            </div>
          ))}
        </div>
      )}

      {/* ⚠ The CTA only appears on your OWN crest. Sending a viewer to
          /prestige to look at somebody else's rank is a dead end — that screen
          shows YOUR ladder. */}
      {isSelf && (
        <a
          href="/prestige"
          style={{
            display: 'block', marginTop: 13, textAlign: 'center',
            padding: '8px 10px', borderRadius: 9, fontSize: 12, fontWeight: 700,
            background: rank.ring, color: '#0B0B14', textDecoration: 'none',
          }}
        >View your ladder</a>
      )}
    </div>,
    document.body,
  );
}
