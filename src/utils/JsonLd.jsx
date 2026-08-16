// JsonLd — inject structured data (schema.org JSON-LD) into <head>.
//
// One small component + typed builders, per the SEO plan. Renders nothing
// visible; on mount it appends a <script type="application/ld+json"> and
// removes it on unmount. Client-side injection works for Googlebot (it
// renders JS); the prerender pass (later) bakes the same JSON into static
// HTML so Bing + AI crawlers see it too.
//
// Usage:
//   <JsonLd data={articleSchema({...})} />
//   <JsonLd data={[articleSchema({...}), breadcrumbSchema([...])]} />
//
// Builders return plain objects. Pass one, or an array (they get wrapped
// in a @graph). Only ever feed these PUBLIC, user-facing facts — never
// internal identifiers, infrastructure, or processor detail.

import { useLayoutEffect } from 'react';

const SITE = 'https://vergr.app';

// ── Robots meta helper (for noindex on thin / unpublished pages) ──────
export function useRobots(noindex) {
  useLayoutEffect(() => {
    if (typeof document === 'undefined') return undefined;
    if (!noindex) return undefined;
    let el = document.head.querySelector('meta[name="robots"]');
    const created = !el;
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('name', 'robots');
      document.head.appendChild(el);
    }
    const prev = el.getAttribute('content');
    el.setAttribute('content', 'noindex,follow');
    return () => {
      // Restore the previous value (default pages are index,follow by absence)
      if (created) el.remove();
      else if (prev != null) el.setAttribute('content', prev);
    };
  }, [noindex]);
}

// ── The injector component ───────────────────────────────────────────
export default function JsonLd({ data, id = 'vg-jsonld' }) {
  useLayoutEffect(() => {
    if (typeof document === 'undefined' || !data) return undefined;
    const items = Array.isArray(data) ? data : [data];
    const payload = items.length === 1
      ? items[0]
      : { '@context': 'https://schema.org', '@graph': items.map(stripContext) };

    const tag = document.createElement('script');
    tag.type = 'application/ld+json';
    tag.setAttribute('data-vg', id);
    tag.text = JSON.stringify(payload);
    document.head.appendChild(tag);
    return () => { tag.remove(); };
  }, [data, id]);
  return null;
}

function stripContext(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const { '@context': _ctx, ...rest } = obj;
  return rest;
}

const abs = (path) => (path?.startsWith('http') ? path : `${SITE}${path || ''}`);

// ── Typed builders ───────────────────────────────────────────────────

export function breadcrumbSchema(crumbs) {
  // crumbs: [{ name, path }]
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: abs(c.path),
    })),
  };
}

export function faqSchema(qa) {
  // qa: [[question, answer], ...] or [{ q, a }]
  const pairs = qa.map((x) => (Array.isArray(x) ? { q: x[0], a: x[1] } : x));
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: pairs.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

export function howToSchema({ name, description, steps }) {
  // steps: [{ name, text }] or [string]
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name,
    ...(description ? { description } : {}),
    step: steps.map((s, i) => {
      const text = typeof s === 'string' ? s : s.text;
      const nm = typeof s === 'string' ? `Step ${i + 1}` : (s.name || `Step ${i + 1}`);
      return { '@type': 'HowToStep', position: i + 1, name: nm, text };
    }),
  };
}

export function articleSchema({ headline, description, url, datePublished, dateModified }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline,
    ...(description ? { description } : {}),
    mainEntityOfPage: { '@type': 'WebPage', '@id': abs(url) },
    author: { '@type': 'Organization', name: 'VERGR', url: SITE },
    publisher: {
      '@type': 'Organization',
      name: 'VERGR',
      url: SITE,
      logo: { '@type': 'ImageObject', url: `${SITE}/icons/icon-512-v2.png` },
    },
    ...(datePublished ? { datePublished } : {}),
    ...(dateModified ? { dateModified } : (datePublished ? { dateModified: datePublished } : {})),
  };
}

// SoftwareApplication / MobileApplication: the download pages.
//
// HONEST LIMIT: Google's Software App rich result REQUIRES aggregateRating or
// review. VERGR has no ratings, and inventing one would breach both Google's
// structured-data policy and basic honesty, so this builder deliberately omits
// them and the pages are NOT rich-result eligible. It is still worth emitting:
// it is valid schema.org, it states the app's OS/version/size/price in machine
// form, and AI crawlers (allowed in robots.txt) read it. Add aggregateRating
// only when real user ratings exist to report.
//
// `type` is 'MobileApplication' for the APK and 'SoftwareApplication' for the
// desktop installer.
export function softwareAppSchema({
  type = 'SoftwareApplication',
  name,
  description,
  url,
  operatingSystem,
  applicationCategory = 'SocialNetworkingApplication',
  softwareVersion,
  fileSize,
  downloadUrl,
  datePublished,
}) {
  return {
    '@context': 'https://schema.org',
    '@type': type,
    name,
    ...(description ? { description } : {}),
    url: abs(url),
    ...(operatingSystem ? { operatingSystem } : {}),
    applicationCategory,
    ...(softwareVersion ? { softwareVersion } : {}),
    // schema.org fileSize is a string with a unit, not a raw byte count.
    ...(fileSize ? { fileSize } : {}),
    ...(downloadUrl ? { downloadUrl } : {}),
    ...(datePublished ? { datePublished } : {}),
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    publisher: { '@type': 'Organization', name: 'VERGR', url: SITE },
  };
}

export function webPageSchema({ name, description, url }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name,
    ...(description ? { description } : {}),
    url: abs(url),
  };
}
