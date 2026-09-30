// TipComboFeed — the tip drops that stack above live chat.
//
// ⚠⚠ THIS LIVES IN PRODUCTION, NOT IN THE PREVIEW. It was built in
// `streamPreview/previewSoloParts.jsx` as `GiftFeed`, and the real screens were
// left on `TipAlertOverlay` — a single centred pill with a translucent fill and
// a backdrop blur, anchored over the host capsule. So the design the founder
// approved had never rendered anywhere a viewer could see it. The preview now
// imports from here; there is one definition of what a tip looks like.
//
// ⚠ THERE ARE NO GIFTS. Coins are the only thing a viewer can send, and the
// `gift` vocabulary in the preview is legacy naming. A row is avatar, name,
// "Tipped", the coin, and a big xN that climbs while the same person keeps
// sending. Do not build a gift catalogue off these names.
import { useState, useEffect, useCallback, useLayoutEffect, useMemo } from 'react';
import UserAvatar from '../UserAvatar';
import vcCoinIcon from '../../assets/stream/vc-coin.webp';

const GOLD = '#F5C842';
const DIM = '#a0a0b8';

// A row lives this long after its last hit.
const COMBO_MS = 4200;
// Rows on screen at once. Older ones drop off the top.
const MAX_ROWS = 3;

function compact(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

// ⚠ THE NAME MUST NOT ELLIPSISE IN A PILL WITH ROOM TO SPARE. A percentage
// max-width resolves against a shrink-to-fit parent whose own width depends on
// this child, and that circularity resolves tiny. Both caps are pixels.
export function TipComboRow({ name, avatar, count = 1 }) {
  return (
    <div style={{
      animation: 'vgrTipIn 0.22s ease-out', display: 'inline-flex', alignItems: 'center',
      gap: 8, padding: '4px 13px 4px 4px', borderRadius: 999, maxWidth: 300,
      boxShadow: '0 6px 18px rgba(0,0,0,0.42)', background: '#100C1C', border: 'none',
    }}>
      <UserAvatar src={avatar} size={30} />
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
        <span style={{ fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 168 }}>{name}</span>
        <span style={{ fontSize: 9.5, color: DIM, whiteSpace: 'nowrap' }}>Tipped</span>
      </div>
      <img src={vcCoinIcon} alt="" style={{ width: 26, height: 26, objectFit: 'contain', flexShrink: 0 }} />
      {/* keyed on count so each combo hit re-runs the pop */}
      <span key={count} style={{ animation: 'vgrTipPop 0.34s cubic-bezier(0.2,1.6,0.4,1)', fontSize: 19, fontWeight: 900, fontStyle: 'italic', color: GOLD, flexShrink: 0, textShadow: '0 1px 6px rgba(245,200,66,0.5)' }}>x{compact(count)}</span>
    </div>
  );
}

// Oldest at the top, newest at the bottom, so a new drop appears closest to the
// chat and the stack grows upward into empty space.
//
// ⚠ ABSOLUTE, ALWAYS. These are transient; in normal flow every drop would push
// the chat and the composer down and back up again.
export function TipComboFeed({ tips, style }) {
  if (!tips?.length) return null;
  return (
    <div style={{ position: 'absolute', left: 12, bottom: 8, zIndex: 5, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, pointerEvents: 'none', ...style }}>
      <style>{'@keyframes vgrTipIn{from{transform:translateY(10px);opacity:0}to{transform:translateY(0);opacity:1}}@keyframes vgrTipPop{0%{transform:scale(0.55)}45%{transform:scale(1.3)}100%{transform:scale(1)}}'}</style>
      {tips.map((t) => <TipComboRow key={t.id} name={t.name} avatar={t.avatar} count={t.count} />)}
    </div>
  );
}

// Combo state machine. `event` is `{ uid, name, avatar, qty, ts }` and a new
// `ts` is what pushes a drop, so the same object re-rendering does nothing.
//
// ⚠ KEYED ON THE PERSON ALONE. Coins are the only currency, so there is no
// second half of the key, and two tips from one person must climb one counter
// rather than opening a second row.
export function useTipCombo(event) {
  const [tips, setTips] = useState([]);

  const push = useCallback((g) => {
    const name = g?.name || 'Someone';
    const qty = Math.max(1, Math.floor(g?.qty || 1));
    const avatar = g?.avatar || null;
    const uid = g?.uid || null;
    setTips((prev) => {
      // Keyed on the uid when both sides carry one, so two people who share a
      // display name never climb one counter.
      const i = prev.findIndex((t) => (uid && t.uid ? t.uid === uid : t.name === name));
      if (i >= 0) {
        const next = prev.slice();
        next[i] = { ...next[i], count: next[i].count + qty, ts: Date.now() };
        return next;
      }
      return [...prev, { id: `${name}-${Date.now()}`, uid, name, avatar, count: qty, ts: Date.now() }].slice(-MAX_ROWS);
    });
  }, []);

  useEffect(() => {
    if (!tips.length) return undefined;
    const id = setInterval(() => {
      const now = Date.now();
      setTips((prev) => prev.filter((t) => now - t.ts < COMBO_MS));
    }, 600);
    return () => clearInterval(id);
  }, [tips.length]);

  // ⚠ A STALE EVENT MUST NOT REPLAY ON MOUNT. The stream doc carries the last
  // tip forever, so a refresh mid-stream would otherwise fire an alert for
  // something that happened an hour ago. Same 12s window TipAlertOverlay uses.
  const [seenTs, setSeenTs] = useState(0);
  useEffect(() => {
    const ts = event?.ts || 0;
    if (!ts || ts <= seenTs) return;
    setSeenTs(ts);
    if (Date.now() - ts > 12_000) return;
    push(event);
  }, [event, seenTs, push]);

  return { tips, push };
}

// The live screens' feed, from the server-written `streams/{id}.lastTip`.
// `sendTip` stamps the sender's uid, name and avatar there (functions/index.js),
// so every viewer draws the same face without a read of their own.
export function useLastTipCombo(lastTip) {
  const ts = lastTip?.ts || 0;
  const fromUid = lastTip?.fromUid || null;
  const fromName = lastTip?.fromName || 'Someone';
  const fromAvatar = lastTip?.fromAvatar || null;
  const coins = lastTip?.coins || 1;
  const event = useMemo(
    () => (ts ? { uid: fromUid, name: fromName, avatar: fromAvatar, qty: coins, ts } : null),
    [ts, fromUid, fromName, fromAvatar, coins],
  );
  return useTipCombo(event);
}

// ── Where the feed sits ─────────────────────────────────────────────────────
//
// ⚠⚠ THE OFFSET CANNOT BE A CONSTANT, AND EVERY SURFACE HAD ONE. The mobile
// viewer used `calc(30% + 84px)` and the broadcaster `76px`, which put the feed
// at the TOP EDGE OF THE CHAT BOX on one and ON TOP OF THE MESSAGES on the
// other. A live chat is bottom-anchored: with five messages in a 256px box,
// 82px of that box is empty, so anchoring to the box left a visible hole
// between the drops and the first message. Founder, 2026-09-05, with the gap
// boxed in red on a screenshot.
//
// So it is measured. `contentTop` is the top of the highest row that actually
// has height, clamped to the visible box, and the feed's bottom edge is placed
// `gap` above it. That is correct whether the chat is empty, sparse or full,
// and whatever sits between the list and the bottom of the screen.
//
// ⚠ scrollHeight IS NOT THE ANSWER. ChatPanel bottom-anchors with a
// `margin-top:auto` spacer rather than justify-content, so its scrollHeight
// always equals clientHeight and a scrollHeight-based offset would put the feed
// back at the top of the box on exactly the surface this exists to fix.
export function useAboveChat(dep, gap = 8) {
  const [list, setList] = useState(null);
  const [anchor, setAnchor] = useState(null);
  const [bottom, setBottom] = useState(null);

  useLayoutEffect(() => {
    if (!list || !anchor) return undefined;
    const measure = () => {
      const lr = list.getBoundingClientRect();
      const ar = anchor.getBoundingClientRect();
      let top = lr.bottom;
      for (const child of list.children) {
        const cr = child.getBoundingClientRect();
        if (cr.height > 0.5 && cr.top < top) top = cr.top;
      }
      // Scrolled-back chat can put rows above the box; the feed still belongs
      // above the box, never inside the video it would then cover.
      if (top < lr.top) top = lr.top;
      setBottom(Math.max(0, Math.round(ar.bottom - top + gap)));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    ro.observe(anchor);
    for (const child of list.children) ro.observe(child);
    // ⚠ ROWS THAT ARRIVE LATER HAVE TO BE WATCHED TOO. The real chat's rows come
    // over a socket, not through `dep`, and a bottom-anchored list does not change
    // size when one lands, so without this the feed stayed where the first
    // message put it.
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver((recs) => {
      for (const r of recs) r.addedNodes.forEach((node) => { if (node.nodeType === 1) ro.observe(node); });
      measure();
    });
    if (mo) mo.observe(list, { childList: true });
    // The keyboard lifts the viewer's dock with a TRANSFORM, which no resize
    // observer sees. Re-measure when a transition inside the frame settles.
    anchor.addEventListener('transitionend', measure);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      if (mo) mo.disconnect();
      anchor.removeEventListener('transitionend', measure);
      window.removeEventListener('resize', measure);
    };
  }, [list, anchor, dep, gap]);

  return { setList, setAnchor, bottom };
}
