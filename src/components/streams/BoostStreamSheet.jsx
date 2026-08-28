// Boost a live stream — the panel inside the GIFT MENU where a viewer spends
// coins, or an earned VP token, on somebody's broadcast.
//
// ⚠ THE THING THIS REPLACES CHARGED 50 COINS FOR A BADGE. See
// src/utils/streamBoost.js for the full account. Every number shown here comes
// from BOOST_TIERS, which is mirrored server-side and guarded by
// vp-mirror-check, so the price on the button is the price the wallet is
// debited — a UI that advertises its own numbers is how that drift starts.
import { useEffect, useState } from 'react';

import { getFunctions, httpsCallable } from 'firebase/functions';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import {
  BOOST_TIERS, TOKEN_TIER_ID, BOOST_REACH_CEILING,
  boostReach, boostRemainingMs, formatRemaining,
} from '../../utils/streamBoost';
import Icon from '../Icon';

const C = {
  surface: '#14141F', line: 'rgba(255,255,255,0.08)',
  text: '#fff', dim: '#9CA3AF', muted: '#6B7280',
  violet: '#7B1FFF', violetLight: '#B44FFF', gold: '#F0A500',
};

/**
 * The live countdown. ⚠ Founder asked for TikTok's visible timer, and it is not
 * decoration: a boost nobody can see ending is indistinguishable from the
 * permanent badge this whole feature exists to replace.
 */
export function BoostTimer({ stream, className = '', style }) {
  const [ms, setMs] = useState(() => boostRemainingMs(stream));

  useEffect(() => {
    // One interval, and it stops itself the moment the boost lapses — a timer
    // that keeps ticking on an expired boost is a wrong number on screen.
    const id = setInterval(() => {
      const left = boostRemainingMs(stream);
      setMs(left);
      if (left <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [stream]);

  if (ms <= 0) return null;
  const reach = boostReach(stream);
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 800,
        background: 'linear-gradient(135deg, #7B1FFF, #B44FFF)', color: '#fff',
        letterSpacing: '0.02em', ...style,
      }}
    >
      <Icon name="rocket_launch" size={11} className="" />
      {reach.toFixed(1)}x
      <span style={{ opacity: 0.75, fontVariantNumeric: 'tabular-nums' }}>{formatRemaining(ms)}</span>
    </span>
  );
}

/**
 * The Boost panel, rendered INSIDE the gift modal.
 *
 * ⚠ IT IS NOT ITS OWN SHEET, AND THAT WAS A CORRECTION. The first version put
 * a Boost pill straight on the stream action row beside Tip / Clip / Share.
 * Founder, 2026-08-27: boost belongs in the GIFT MENU, the way TikTok does it
 * (swipe across from the gifts). A fourth pill competing with Tip on the main
 * surface also splits the two spend actions apart, when they are the same
 * gesture: giving something to the person streaming.
 */
export function BoostPanel({ streamId, stream, onClose, onBoosted }) {
  const { wallet } = useUser();
  const { showToast } = useUI();
  const [busy, setBusy] = useState(null);

  const coins = Number(wallet?.balance) || 0;
  const tokens = Number(wallet?.boostTokens) || 0;
  const reach = boostReach(stream);
  const atCeiling = reach >= BOOST_REACH_CEILING;

  const send = async (tierId, useToken) => {
    if (busy) return;
    setBusy(useToken ? 'token' : tierId);
    try {
      const call = httpsCallable(getFunctions(undefined, 'europe-west1'), 'boostStream');
      await call({ streamId, tierId, useToken });
      showToast(useToken ? 'Boost sent. No coins spent.' : 'Stream boosted.', 'success');
      onBoosted?.();
      onClose?.();
    } catch (e) {
      // The server owns every refusal reason (not live, unlisted, no funds), so
      // its message is shown rather than a guess made here.
      showToast(e?.message || 'Could not boost this stream.', 'error');
    } finally {
      setBusy(null);
    }
  };

  // ⚠ NO PORTAL AND NO SCRIM. The gift modal already owns both; nesting a second
  // fixed-position overlay inside one gives two stacked backdrops and two
  // competing click-to-close targets.
  return (
    <div>
        {boostRemainingMs(stream) > 0 && (
          <div style={{ marginBottom: 10 }}><BoostTimer stream={stream} /></div>
        )}
        <p style={{ margin: '0 0 14px', color: C.dim, fontSize: 13, lineHeight: 1.5 }}>
          Puts this stream in front of people who watch this kind of thing — not just
          higher in discovery, but on the home feed at the top tier.
        </p>

        {/* ⚠ THE TOKEN PATH IS FIRST, and deliberately so. Founder: someone who
            earns a boost through VP should be able to give it to a creator
            rather than pay coins. Burying that under three prices would make the
            earned reward look like an upsell. */}
        {tokens > 0 && (
          <button
            type="button"
            disabled={!!busy}
            onClick={() => send(TOKEN_TIER_ID, true)}
            style={{
              width: '100%', textAlign: 'left', marginBottom: 12, cursor: 'pointer',
              padding: '13px 14px', borderRadius: 12, border: 'none',
              background: 'linear-gradient(135deg, rgba(240,165,0,0.22), rgba(240,165,0,0.08))',
              boxShadow: `inset 0 0 0 1px ${C.gold}55`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="redeem" size={16} className="" style={{ color: C.gold }} />
              <span style={{ color: C.text, fontWeight: 800, fontSize: 14 }}>
                Use a Boost token
              </span>
              <span style={{ marginLeft: 'auto', color: C.gold, fontWeight: 800, fontSize: 12 }}>
                {tokens} left
              </span>
            </div>
            <div style={{ color: C.dim, fontSize: 12, marginTop: 4 }}>
              Earned from your rank. Costs no coins, and works on anyone's stream.
            </div>
          </button>
        )}

        <div style={{ display: 'grid', gap: 8 }}>
          {BOOST_TIERS.map((t) => {
            const afford = coins >= t.coins;
            const on = busy === t.id;
            return (
              <button
                key={t.id}
                type="button"
                disabled={!!busy || !afford}
                onClick={() => send(t.id, false)}
                style={{
                  textAlign: 'left', padding: '12px 14px', borderRadius: 12, border: 'none',
                  background: 'rgba(255,255,255,0.04)',
                  boxShadow: `inset 0 0 0 1px ${C.line}`,
                  opacity: afford ? 1 : 0.45,
                  cursor: afford ? 'pointer' : 'not-allowed',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: C.text, fontWeight: 800, fontSize: 14 }}>{t.name}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 999,
                    background: 'rgba(123,31,255,0.22)', color: C.violetLight,
                  }}>{t.reach}x reach</span>
                  <span style={{ marginLeft: 'auto', color: C.text, fontWeight: 800, fontSize: 13 }}>
                    {on ? '…' : `${t.coins}c`}
                  </span>
                </div>
                <div style={{ color: C.dim, fontSize: 12, marginTop: 3 }}>
                  {t.desc} Lasts {t.minutes} minutes.
                </div>
              </button>
            );
          })}
        </div>

        {/* Honest about the cap rather than letting someone spend into a wall. */}
        {atCeiling && (
          <p style={{ color: C.gold, fontSize: 12, margin: '12px 0 0' }}>
            This stream is already boosted as far as it goes ({BOOST_REACH_CEILING}x).
            Another boost extends how long it stays boosted, but not how far it reaches.
          </p>
        )}
        <p style={{ color: C.muted, fontSize: 11, margin: '12px 0 0' }}>
          You have {coins.toLocaleString()} coins.
        </p>

        {/* ⚠ THE PANEL OWNS ITS OWN CLOSE. The gift modal's Cancel/Send footer
            lives inside the TIP branch — Send must never render over the boost
            tiers — so switching to Boost would otherwise leave the scrim as the
            only way out, which is not discoverable. */}
        <button
          type="button"
          onClick={onClose}
          disabled={!!busy}
          style={{
            width: '100%', marginTop: 14, padding: 10, borderRadius: 9,
            border: `1px solid ${C.line}`, background: 'transparent',
            color: C.dim, fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}
        >Close</button>
    </div>
  );
}
