/**
 * Persistent "DEV" marker, dev-channel builds only.
 *
 * The dev-channel APK is deliberately store-identical (same gates, same Play
 * Billing routing), which makes it visually indistinguishable from the release.
 * That is the point, and it is also the hazard: an unreleased build is easy to
 * mistake for the shipped one, and a screenshot of it is easy to publish by
 * accident. This chip makes the channel unmistakable at a glance.
 *
 * Compiles to nothing on every other build: IS_DEV_CHANNEL is a compile-time
 * constant, so the whole component tree-shakes out of the web, sideload, Play
 * and Huawei bundles.
 *
 * Tappable to collapse to a dot, because it must never sit on top of something
 * the founder is trying to look at. It never disappears entirely.
 */
import { useState } from 'react';
import { IS_DEV_CHANNEL } from '../utils/platform';
import { APP_VERSION } from '../utils/appVersion';

export default function DevChannelBadge() {
  const [small, setSmall] = useState(false);
  if (!IS_DEV_CHANNEL) return null;

  return (
    <button
      onClick={() => setSmall((s) => !s)}
      aria-label={`Dev channel build ${APP_VERSION}`}
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top) + 4px)',
        right: 4,
        zIndex: 2147483647,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: small ? 4 : '2px 7px',
        borderRadius: 999,
        background: 'rgba(240,165,0,0.92)',
        color: '#0B0B14',
        fontSize: 9,
        fontWeight: 800,
        letterSpacing: 0.5,
        lineHeight: 1,
        border: 'none',
        boxShadow: '0 1px 6px rgba(0,0,0,0.45)',
        pointerEvents: 'auto',
      }}
    >
      {small ? (
        <span style={{ width: 6, height: 6, borderRadius: 999, background: '#0B0B14' }} />
      ) : (
        <>DEV {APP_VERSION}</>
      )}
    </button>
  );
}
