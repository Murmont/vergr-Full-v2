// useSeo — lightweight per-page SEO head injector.
//
// HashRouter URLs (#/learn/coins, #/learn/tournaments, etc.) get the same
// underlying index.html, so the `<title>`, meta description, OG tags, and
// Twitter card tags need to be updated client-side as the user navigates.
//
// Googlebot renders JavaScript and reads the resulting DOM, so dynamic
// head updates ARE picked up — but only if we set them BEFORE the page
// finishes its initial render. This hook does that with useLayoutEffect.
//
// No external dependency (react-helmet-async etc.) — keeps the bundle lean.
//
// Usage in a page component:
//
//   useSeo({
//     title: 'Stream Gameplay. Earn From Day One. | VERGR',
//     description: 'Go live straight from your browser...',
//     image: 'https://vergr.app/brand/og-live.png',
//     canonical: 'https://vergr.app/#/learn/live',
//   });

import { useLayoutEffect } from 'react';
import { isTauri } from './platform';

const DEFAULT = {
  title: 'Vergr - Go Live. Hang Out. Share the Moment.',
  description: 'Vergr is where you go live, share clips and hang out with your people in voice chats and DMs, all in one app.',
  image: 'https://vergr.app/brand/og-default.png',
  type: 'website',
  siteName: 'VERGR',
};

function setMeta(selector, attr, value) {
  if (typeof document === 'undefined') return;
  let el = document.head.querySelector(selector);
  if (!el) {
    // Create the tag if it doesn't exist yet. Parse the selector for the
    // tag name + the attribute pair.
    const match = selector.match(/^(\w+)\[(\w+)="([^"]+)"\]$/);
    if (!match) return;
    el = document.createElement(match[1]);
    el.setAttribute(match[2], match[3]);
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value || '');
}

function setLink(rel, href) {
  if (typeof document === 'undefined') return;
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

export default function useSeo({
  title,
  description,
  image,
  canonical,
  type,
} = {}) {
  useLayoutEffect(() => {
    const t = title || DEFAULT.title;
    const d = description || DEFAULT.description;
    const img = image || DEFAULT.image;
    const tp = type || DEFAULT.type;

    // Web: the full per-page SEO title (Googlebot reads it). Desktop/native
    // shell: a stable short "VERGR" — the WebView2 renderer process is labelled
    // by document.title, so the long marketing string showed up as the Task
    // Manager process name ("WebView2: VERGR — Where Gamers Converge | …"). A
    // fixed "VERGR" also gives the desktop a stable window title bar. Crawlers
    // never see the desktop shell, so meta/OG tags below keep the real title.
    document.title = isTauri() ? 'VERGR' : t;
    setMeta('meta[name="description"]', 'content', d);

    // Open Graph (Facebook, LinkedIn, Discord, WhatsApp, etc.)
    setMeta('meta[property="og:title"]', 'content', t);
    setMeta('meta[property="og:description"]', 'content', d);
    setMeta('meta[property="og:image"]', 'content', img);
    setMeta('meta[property="og:type"]', 'content', tp);
    setMeta('meta[property="og:site_name"]', 'content', DEFAULT.siteName);
    if (canonical) {
      setMeta('meta[property="og:url"]', 'content', canonical);
    }

    // Twitter card
    setMeta('meta[name="twitter:card"]', 'content', 'summary_large_image');
    setMeta('meta[name="twitter:title"]', 'content', t);
    setMeta('meta[name="twitter:description"]', 'content', d);
    setMeta('meta[name="twitter:image"]', 'content', img);

    if (canonical) setLink('canonical', canonical);
  }, [title, description, image, canonical, type]);
}
