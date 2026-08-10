// Growth / SEO money pages: React renderers for growthContent.js.
//
// Three screens, all driven by the pure-data content module so the
// build-time prerender (scripts/prerenderHelp.mjs) can bake the exact
// same content into static HTML for Bing + AI crawlers:
//   - MakeMoneyGamingScreen  -> /platform/make-money-gaming
//   - LegitScreen            -> /platform/legit
//   - PlayGameScreen         -> /platform/play/:gameSlug
// Reuses the marketing primitives exported by PublicMarketingScreens.
import React from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import useSeo from '../../../utils/seo';
import JsonLd, { breadcrumbSchema, faqSchema, webPageSchema } from '../../../utils/JsonLd';
import {
  MarketingShell, PageHero, Section, H2, P, Grid, Tile, C,
} from '../PublicMarketingScreens';
import { PILLAR_PAGE, LEGIT_PAGE, GAME_PAGE_BY_SLUG } from './growthContent';

const ACCENT = { cyan: C.cyan, violet: C.violet, pink: C.pink, gold: C.gold, ember: C.ember };

function Block({ block }) {
  if (block.p != null) return <P max={760}>{block.p}</P>;
  if (Array.isArray(block.tiles)) {
    return (
      <Grid cols={block.cols || 3} min={block.min || 260}>
        {block.tiles.map((t, i) => (
          <Tile key={i} icon={t.icon} accent={ACCENT[t.accent] || C.violet} title={t.title} body={t.body} />
        ))}
      </Grid>
    );
  }
  if (Array.isArray(block.list)) {
    return (
      <ul style={{ maxWidth: 760, margin: '12px 0', paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {block.list.map((x, i) => (
          <li key={i} style={{ fontSize: 15, color: C.text2, lineHeight: 1.7 }}>{x}</li>
        ))}
      </ul>
    );
  }
  if (Array.isArray(block.steps)) {
    return (
      <ol style={{ maxWidth: 760, margin: '12px 0', paddingLeft: 26, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {block.steps.map((x, i) => (
          <li key={i} style={{ fontSize: 15, color: C.text2, lineHeight: 1.7 }}>{x}</li>
        ))}
      </ol>
    );
  }
  if (Array.isArray(block.faq)) {
    return (
      <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {block.faq.map(([q, a], i) => (
          <div key={i} style={{
            padding: '16px 18px', borderRadius: 12,
            background: C.surface, border: `1px solid ${C.borderSoft}`,
          }}>
            <h3 className="vg-syne" style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: '0 0 8px' }}>{q}</h3>
            <p style={{ fontSize: 14, color: C.text2, lineHeight: 1.7, margin: 0 }}>{a}</p>
          </div>
        ))}
      </div>
    );
  }
  if (block.note != null) {
    return (
      <div style={{
        maxWidth: 760, padding: '14px 18px', borderRadius: 12, margin: '12px 0',
        background: `${C.cyan}0E`, border: `1px solid ${C.cyan}44`,
        fontSize: 14, color: C.text2, lineHeight: 1.7,
      }}>{block.note}</div>
    );
  }
  if (Array.isArray(block.links)) {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '14px 0' }}>
        {block.links.map((l, i) => (
          <Link key={i} to={l.to} className="vg-link" style={{
            fontSize: 14, textDecoration: 'none', color: C.cyan,
            padding: '8px 14px', borderRadius: 999,
            border: `1px solid ${C.cyan}44`, background: `${C.cyan}0A`,
          }}>{l.label} →</Link>
        ))}
      </div>
    );
  }
  return null;
}

function collectFaq(page) {
  const out = [];
  for (const s of page.sections) {
    for (const b of s.blocks) if (Array.isArray(b.faq)) out.push(...b.faq);
  }
  return out;
}

function GrowthPage({ page, crumbs }) {
  useSeo({
    title: page.metaTitle,
    description: page.metaDescription,
    canonical: `https://vergr.app${page.path}`,
  });
  const faq = collectFaq(page);
  const schema = [
    webPageSchema({ name: page.metaTitle, description: page.metaDescription, url: page.path }),
    breadcrumbSchema(crumbs),
  ];
  if (faq.length) schema.push(faqSchema(faq));
  return (
    <MarketingShell>
      <JsonLd data={schema} id={`vg-growth-${page.slug}`} />
      <PageHero title={page.h1} subtitle={page.subtitle} accent={page.accent} centered />
      {page.sections.map((s, i) => (
        <Section key={i} bordered={i > 0}>
          {s.h2 ? <H2>{s.h2}</H2> : null}
          {s.blocks.map((b, j) => <Block key={j} block={b} />)}
        </Section>
      ))}
      {page.cta ? (
        <Section bordered>
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <H2>{page.cta.title}</H2>
            <Link to="/signup" className="vg-btn-primary" style={{ textDecoration: 'none' }}>
              {page.cta.label} →
            </Link>
          </div>
        </Section>
      ) : null}
    </MarketingShell>
  );
}

export function MakeMoneyGamingScreen() {
  return (
    <GrowthPage
      page={PILLAR_PAGE}
      crumbs={[
        { name: 'Home', path: '/platform' },
        { name: 'Make Money Gaming', path: PILLAR_PAGE.path },
      ]}
    />
  );
}

export function LegitScreen() {
  return (
    <GrowthPage
      page={LEGIT_PAGE}
      crumbs={[
        { name: 'Home', path: '/platform' },
        { name: 'Is VERGR Legit?', path: LEGIT_PAGE.path },
      ]}
    />
  );
}

export function PlayGameScreen() {
  const { gameSlug } = useParams();
  const page = GAME_PAGE_BY_SLUG[gameSlug];
  if (!page) return <Navigate to={PILLAR_PAGE.path} replace />;
  return (
    <GrowthPage
      key={page.slug}
      page={page}
      crumbs={[
        { name: 'Home', path: '/platform' },
        { name: 'Make Money Gaming', path: PILLAR_PAGE.path },
        { name: page.game, path: page.path },
      ]}
    />
  );
}
