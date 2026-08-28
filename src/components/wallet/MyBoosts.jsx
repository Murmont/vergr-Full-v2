// What boosts you own, and how many.
//
// ⚠ Founder, 2026-08-28: *"I should have a way to see what boosts and how many I
// have in the wallet."* Boosts are inventory now, and inventory you cannot see is
// indistinguishable from inventory you do not have.
//
// Deliberately shows only what you HOLD. The shop is one tab away and repeating
// the whole catalogue here would make the wallet a second storefront.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../context/AuthContext';
import { getMyActiveBoosts } from '../../firebase/firestore';
import { boostRemainingMs, formatBoostRemaining } from '../../utils/promoBoost';

import { useUser } from '../../context/UserContext';
import {
  BOOSTS, boostInventory, formatBoostDuration, boostArt, totalBoosts,
} from '../../utils/boosts';
import { WALLET_TOKENS } from './primitives';
import Icon from '../Icon';
import { boostById } from '../../utils/boosts';

/**
 * One running boost, with what it has delivered.
 *
 * ⚠ FOLLOWERS GAINED IS THE HEADLINE, deliberately. Impressions say the thing
 * is running; followers say it worked. It is also the only one of the three
 * that costs nothing extra to produce (the follow documents already exist) AND
 * the only one that is COMPLETE: a follow counts wherever the boost was seen,
 * while the other two only ever count the in-feed suggestion block.
 *
 * ⚠ THE OTHER TWO NUMBERS ARE PARTIAL BY DESIGN AND THE COPY MUST SAY SO.
 * Only SuggestedPeopleBlock calls recordBoostImpressions. Counting on all six
 * surfaces was tried on 2026-08-28 and REVERTED: it is a spend decision and the
 * founder's answer was to keep the cheap count and relabel it honestly. If you
 * ever make counting complete, remove the qualifier below in the same commit.
 *
 * ⚠ NO DISPLAY FLOOR HERE, unlike a public view count. This is a receipt shown
 * only to the person who paid, so there is nobody to be embarrassed in front of,
 * and a low number is USEFUL: it says the boost underdelivered.
 */
function RunningBoost({ row }) {
  const pack = boostById(row.boostId);
  const left = boostRemainingMs({ boostExpiresAt: row.expiresAt });
  const stat = (n, label) => (
    <div style={{ minWidth: 0 }}>
      <div className="font-dmmono tabular-nums" style={{
        color: WALLET_TOKENS.text, fontWeight: 800, fontSize: 15,
      }}>{(n || 0).toLocaleString()}</div>
      <div style={{ color: WALLET_TOKENS.textMuted, fontSize: 10 }}>{label}</div>
    </div>
  );
  return (
    <div style={{
      padding: 12, borderRadius: 12, background: WALLET_TOKENS.surface2,
      display: 'grid', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="rocket_launch" size={14} style={{ color: WALLET_TOKENS.ember }} />
        <span style={{ color: WALLET_TOKENS.text, fontSize: 13, fontWeight: 800 }}>
          {pack?.name || row.boostId}
        </span>
        <span style={{
          marginLeft: 'auto', color: WALLET_TOKENS.ember, fontSize: 11,
          fontWeight: 800, fontVariantNumeric: 'tabular-nums',
        }}>{formatBoostRemaining(left)} left</span>
      </div>
      <div style={{ display: 'flex', gap: 18 }}>
        {row.followersGained != null && stat(row.followersGained, 'new followers')}
        {stat(row.impressions, 'feed shows')}
        {stat(row.views, 'feed viewers')}
      </div>
      {/* ⚠ THE LABEL CARRIES THE LIMIT, because the number cannot. Only the
          in-feed suggestion block reports; the home rail, discovery strip,
          right sidebar, both Explore screens and onboarding show the boost and
          count nothing. Calling these "impressions" claimed a total reach we do
          not measure. Founder decision 2026-08-28: keep the partial count and
          make the copy honest rather than pay to count everywhere. */}
      <div style={{ color: WALLET_TOKENS.textMuted, fontSize: 10, lineHeight: 1.4 }}>
        Feed placements only. Your boost also runs in Explore, the sidebar and
        suggestions, which are not counted here. New followers counts them all.
      </div>
    </div>
  );
}

export default function MyBoosts({ compact = false }) {
  const { wallet } = useUser();
  const navigate = useNavigate();

  const { currentUser } = useAuth();
  const [running, setRunning] = useState([]);

  useEffect(() => {
    if (!currentUser?.uid) return undefined;
    let alive = true;
    getMyActiveBoosts(currentUser.uid)
      .then((rows) => { if (alive) setRunning(rows); })
      .catch(() => { /* the inventory must still render */ });
    return () => { alive = false; };
  }, [currentUser?.uid]);

  const inv = boostInventory(wallet);
  const held = BOOSTS.filter((b) => (inv[b.id] || 0) > 0);
  const total = totalBoosts(wallet);

  return (
    <div style={{
      padding: 14, borderRadius: 16, background: WALLET_TOKENS.surface1,
      boxShadow: `inset 0 0 0 1px ${WALLET_TOKENS.hairline}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
        <Icon name="rocket_launch" size={16} style={{ color: WALLET_TOKENS.ember }} />
        <span className="font-syne" style={{ color: WALLET_TOKENS.text, fontWeight: 800, fontSize: 15 }}>
          My boosts
        </span>
        {total > 0 && (
          <span style={{
            marginLeft: 'auto', color: WALLET_TOKENS.ember,
            fontWeight: 800, fontSize: 13,
          }}>{total}</span>
        )}
      </div>

      {running.length > 0 && (
        <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
          <div style={{ color: WALLET_TOKENS.textSecondary, fontSize: 11, fontWeight: 800, letterSpacing: '0.06em' }}>
            RUNNING NOW
          </div>
          {running.map((r) => <RunningBoost key={r.id} row={r} />)}
        </div>
      )}

      {held.length === 0 ? (
        <>
          <p style={{ color: WALLET_TOKENS.textSecondary, fontSize: 12, margin: '4px 0 10px', lineHeight: 1.45 }}>
            You have no boosts. Buy them once and keep them until you want them —
            they work on your own posts, streams and squads, or anyone else’s.
          </p>
          <button
            onClick={() => navigate('/wallet/buy')}
            style={{
              padding: '9px 14px', borderRadius: 11, border: 'none',
              background: 'rgba(240,64,96,0.16)', color: WALLET_TOKENS.ember,
              fontSize: 12.5, fontWeight: 800, cursor: 'pointer',
            }}
          >Get boosts</button>
        </>
      ) : (
        <>
          <p style={{ color: WALLET_TOKENS.textSecondary, fontSize: 12, margin: '4px 0 10px', lineHeight: 1.45 }}>
            Apply one from the post, profile, squad or stream you want to boost.
          </p>
          <div style={{ display: 'grid', gap: 8 }}>
            {held.map((b) => (
              <div key={b.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: 10,
                borderRadius: 12, background: WALLET_TOKENS.surface2,
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                  display: 'grid', placeItems: 'center',
                  background: 'radial-gradient(120% 120% at 30% 20%, rgba(240,64,96,0.28), rgba(10,10,18,0.9) 70%)',
                }}>
                  <img
                    src={boostArt(b)}
                    alt=""
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 9 }}
                  />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ color: WALLET_TOKENS.text, fontSize: 13, fontWeight: 800 }}>
                    {b.name}
                  </div>
                  {!compact && (
                    <div style={{ color: WALLET_TOKENS.textMuted, fontSize: 11, marginTop: 1 }}>
                      {formatBoostDuration(b.minutes)} each
                    </div>
                  )}
                </div>
                <span className="font-dmmono tabular-nums" style={{
                  color: WALLET_TOKENS.ember, fontWeight: 800, fontSize: 15,
                }}>x{inv[b.id]}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
