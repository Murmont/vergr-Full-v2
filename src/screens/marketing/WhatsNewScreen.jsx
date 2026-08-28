// What's New: the public changelog (founder decision D4, public with full control).
//
// One component serves both the list (/whats-new) and a single entry
// (/whats-new/:slug), because they are the same data at two levels of detail and
// splitting them would be two places to keep in step.
//
// Nothing appears here automatically. An announcement is only published to this
// page when that surface is explicitly ticked in the admin, so an internal
// message can never leak onto a public URL by default.
//
// Canonical comes from the ENTRY, not the route (reference-canonical-from-entity),
// so a slug reached by any path still points search engines at one address.

import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import Icon from '../../components/Icon';
import useSeo from '../../utils/seo';
import { useRobots } from '../../utils/JsonLd';

const CATEGORY_TONE = {
  update:  { bg: 'rgba(123,31,255,0.14)', border: 'rgba(180,79,255,0.4)', text: '#C87FFF' },
  feature: { bg: 'rgba(34,197,94,0.13)',  border: 'rgba(34,197,94,0.4)',  text: '#4ADE80' },
  fix:     { bg: 'rgba(61,127,255,0.13)', border: 'rgba(61,127,255,0.4)', text: '#7FA9FF' },
  notice:  { bg: 'rgba(240,165,0,0.13)',  border: 'rgba(240,165,0,0.4)',  text: '#F5C842' },
};

const fmtDate = (ms) => (ms
  ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
  : '');

export default function WhatsNewScreen() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, enabled: true, entries: [] });

  useEffect(() => {
    let alive = true;
    httpsCallable(getFunctions(undefined, 'europe-west1'), 'getWhatsNew')({ slug: slug || null })
      .then((r) => { if (alive) setState({ loading: false, ...r.data }); })
      .catch(() => { if (alive) setState({ loading: false, enabled: true, entries: [] }); });
    return () => { alive = false; };
  }, [slug]);

  const entry = slug ? state.entries[0] : null;
  const gone = !state.loading && slug && !entry;

  // Canonical comes from the ENTRY, never the route, so the same update
  // reached by any path points at one address (reference-canonical-from-entity).
  useSeo({
    title: entry ? `${entry.heading} | What's New | Vergr` : "What's New | Vergr",
    description: entry
      ? (entry.body || '').replace(/\s+/g, ' ').slice(0, 155)
      : 'Everything new on Vergr: features, changes and notices, newest first.',
    canonical: entry ? `https://vergr.app/whats-new/${entry.slug}` : 'https://vergr.app/whats-new',
  });
  // An entry can be de-indexed on its own, or the whole section can be. Either
  // one wins: the stricter answer is the safe one.
  useRobots(state.enabled === false || !!gone || (entry ? !!entry.noindex : false));

  return (
    <div style={{ minHeight: '100vh', background: '#0B0B14' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 20px 80px' }}>
        <Link to="/platform" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#9CA3AF', fontSize: 13, textDecoration: 'none', marginBottom: 26 }}>
          <Icon name="arrow_back" size={16} />
          Vergr
        </Link>

        {slug && (
          <button onClick={() => navigate('/whats-new')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: 0, color: '#9CA3AF', fontSize: 13, cursor: 'pointer', marginBottom: 20, padding: 0 }}>
            <Icon name="chevron_left" size={16} />
            All updates
          </button>
        )}

        {!slug && (
          <>
            <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 38, color: '#fff', letterSpacing: '-0.02em', marginBottom: 10 }}>
              What&apos;s new
            </h1>
            <p style={{ color: '#9CA3AF', fontSize: 15, lineHeight: 1.7, marginBottom: 36 }}>
              Everything we have shipped, newest first.
            </p>
          </>
        )}

        {state.loading && <div style={{ color: '#6B7280', fontSize: 14 }}>Loading…</div>}

        {/* The section can be switched off globally without a deploy. Say so
            plainly rather than showing an empty page that looks broken. */}
        {!state.loading && state.enabled === false && (
          <div style={{ color: '#6B7280', fontSize: 14, lineHeight: 1.7 }}>
            This page is not available right now.
          </div>
        )}

        {gone && state.enabled !== false && (
          <div style={{ color: '#9CA3AF', fontSize: 14, lineHeight: 1.8 }}>
            <div style={{ color: '#fff', fontSize: 19, fontWeight: 700, marginBottom: 8, fontFamily: 'Syne, sans-serif' }}>
              That update is no longer here.
            </div>
            It may have been taken down or renamed.
            <div style={{ marginTop: 16 }}>
              <Link to="/whats-new" style={{ color: '#B44FFF' }}>See everything else</Link>
            </div>
          </div>
        )}

        {!state.loading && !slug && state.enabled !== false && state.entries.length === 0 && (
          <div style={{ color: '#6B7280', fontSize: 14, lineHeight: 1.7 }}>
            Nothing here yet. Updates will appear as they ship.
          </div>
        )}

        {entry && <Entry e={entry} full />}

        {!slug && state.entries.map((e) => <Entry key={e.campaignId} e={e} />)}
      </div>
    </div>
  );
}

function Entry({ e, full }) {
  const tone = CATEGORY_TONE[e.category] || CATEGORY_TONE.update;
  const go = (url) => {
    if (!url) return;
    if (url.startsWith('/')) window.location.assign(`/#${url}`);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  const inner = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={{
          padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800,
          textTransform: 'uppercase', letterSpacing: '0.05em',
          background: tone.bg, border: `1px solid ${tone.border}`, color: tone.text,
        }}>{e.category}</span>
        <span style={{ fontSize: 12.5, color: '#6B7280' }}>{fmtDate(e.publishedAt)}</span>
      </div>

      <h2 style={{
        fontFamily: 'Syne, sans-serif', fontWeight: 700,
        fontSize: full ? 30 : 20, color: '#fff', lineHeight: 1.3, marginBottom: 10,
        letterSpacing: '-0.01em',
      }}>{e.heading}</h2>

      {e.imageUrl && (
        <img src={e.imageUrl} alt="" loading="lazy"
          style={{ width: '100%', borderRadius: 14, marginBottom: 14, display: 'block' }} />
      )}

      {e.body && (
        <p style={{
          color: '#9CA3AF', fontSize: full ? 15.5 : 14, lineHeight: 1.75,
          whiteSpace: 'pre-wrap', margin: 0,
        }}>
          {e.body}{!full && e.body.length >= 200 ? '…' : ''}
        </p>
      )}

      {full && e.ctaLabel && e.ctaUrl && (
        <button onClick={() => go(e.ctaUrl)}
          style={{
            marginTop: 20, padding: '12px 24px', borderRadius: 12, border: 0,
            background: '#7B1FFF', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}>
          {e.ctaLabel}
        </button>
      )}
    </>
  );

  if (full) {
    return <article>{inner}</article>;
  }
  return (
    <Link to={`/whats-new/${e.slug}`} style={{ textDecoration: 'none', display: 'block' }}>
      <article style={{
        padding: 22, marginBottom: 14, borderRadius: 16,
        background: 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.015))',
        border: '1px solid rgba(255,255,255,0.07)',
      }}>
        {inner}
      </article>
    </Link>
  );
}
