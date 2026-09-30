// Vergr.me public marketing / acquisition page, "free link in bio".
// Lives at /linkinbio (prerendered; see scripts/prerenderHelp.mjs
// MARKETING_PAGES, keep the head there in sync with useSeo here).
// Every Vergr account gets a vergr.me page, so this doubles as the landing
// for the "Get your free link in bio" footer pill on every free page.

import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { checkUsername } from '../../utils/usernameValidation';
import { VERGRME_DISPLAY_PREFIX } from '../../utils/vergrMeUrl';
import Icon from '../../components/Icon';
import useSeo from '../../utils/seo';
import JsonLd, { faqSchema } from '../../utils/JsonLd';
import { MarketingShell, C, Section, H2, P, Grid, Tile } from './PublicMarketingScreens';

const FAQS = [
  ['Is Vergr.me really free?',
    'Yes. Every Vergr account includes a vergr.me page with unlimited links and blocks, themes, QR codes and click analytics at no cost. Paid plans add extras like hiding the footer badge, tracking pixels, custom CSS and deeper analytics.'],
  ['How do I get my link in bio page?',
    'Create a free Vergr account and your page exists instantly at vergr.app/u/yourusername. Open the editor, add your links and pick a design, changes autosave and go live when you hit Publish.'],
  ['What can I put on my page?',
    'Over 18 block types: links, image galleries, video, music players (Spotify, Apple Music, SoundCloud), products, contact forms, email collection, tips, and live Vergr content like your stream, ticketed events and squad.'],
  ['How is Vergr.me different from Linktree?',
    'Vergr.me is built into a live streaming platform: your page can show your live stream, ticketed events and community in real time, fans can tip or message you directly, and the generous free tier includes analytics and full design systems instead of a single button list.'],
  ['Can I collect emails or sell things?',
    'Yes, contact form and email pop-up blocks capture leads you can export to CSV, and support/product blocks link out to your storefronts. Tips arrive as VC Coins, and Vergr pays you a share of that revenue: 50% to start, up to 80%.'],
  ['Does it work on TikTok, Instagram and YouTube?',
    'Yes. vergr.app/u/you is a normal URL you can paste into any bio field. The page loads fast on mobile, where most bio-link taps happen.'],
];

export default function LinkInBioScreen() {
  useSeo({
    title: 'Vergr.me | Get Your Free Link in Bio',
    description: 'Claim your free vergr.me link in bio page: unlimited links, 18+ block types, real design systems, analytics, QR codes and live stream integration. Free forever, no credit card.',
    canonical: 'https://vergr.app/linkinbio',
  });

  return (
    <MarketingShell>
      <Hero />

      <Section>
        <H2>Everything a bio link should do, free</H2>
        <P max={720}>
          One short link that holds everything you are: your socials, content, shop, music and community.
          Unlimited blocks on the free plan, no credit card, no watermark ransom on your own audience.
        </P>
        <Grid cols={3} min={240}>
          <Tile icon="add_link" accent={C.violet} title="18+ block types"
            body="Links, galleries, video, music players, products, contact forms, email capture, tips and more." />
          <Tile icon="palette" accent={C.pink} title="Real design systems"
            body="10 full themes with fonts, animated backgrounds and per-block typography, not one row of buttons." />
          <Tile icon="query_stats" accent={C.gold} title="Free analytics"
            body="Views, clicks and top blocks included free. Pro adds traffic sources, devices and engagement." />
          <Tile icon="stream" accent={C.ember} title="Live content blocks"
            body="Show your live stream, next ticketed event or squad on your page, updating in real time. Nobody else has this." />
          <Tile icon="qr_code_2" accent={C.violet} title="QR codes + scheduling"
            body="Custom-color QR for print, scheduled links, passcode and age-gated links, whole-page forwarding." />
          <Tile icon="paid" accent={C.gold} title="Get paid on-page"
            body="Fans tip you right from your bio link. Vergr pays you 50% to 80% of that revenue, rising with your lifetime earnings. Nothing hidden." />
        </Grid>
      </Section>

      <Section bordered>
        <H2>Free where others charge</H2>
        <ComparisonTable />
        <p style={{ marginTop: 10, fontSize: 12, color: C.text3 }}>
          "Typical paid tiers" reflects features commonly gated behind $5-24/mo plans on major link-in-bio tools as of July 2026.
        </p>
      </Section>

      <Section bordered>
        <H2>Built into your Vergr profile</H2>
        <P max={720}>
          Your vergr.me page is wired into the Vergr platform: linking your Twitch prefills a starter page with
          your VODs and clips, your live stream appears on your page the second you go live, and visitors can
          follow or message you without leaving. It's a bio link that works for you, not just a list of doors.
        </P>
        <div style={{ marginTop: 20, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link to="/signup" style={{
            padding: '14px 28px', borderRadius: 12, fontWeight: 800, fontSize: 15,
            background: `linear-gradient(90deg, ${C.violet}, ${C.pink})`, color: '#fff', textDecoration: 'none',
          }}>Claim your page free</Link>
          <Link to="/platform/creators" style={{
            padding: '14px 28px', borderRadius: 12, fontWeight: 800, fontSize: 15,
            border: `1px solid ${C.borderSoft}`, color: C.text, textDecoration: 'none',
          }}>For streamers</Link>
        </div>
      </Section>

      <Section bordered>
        <H2>Frequently asked questions</H2>
        <div style={{ marginTop: 8 }}>
          {FAQS.map(([q, a]) => (
            <details key={q} style={{
              borderBottom: `1px solid ${C.borderSoft}`, padding: '14px 4px',
            }}>
              <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 15, color: C.text }}>{q}</summary>
              <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.6, color: C.text2, maxWidth: 760 }}>{a}</p>
            </details>
          ))}
        </div>
        <JsonLd data={faqSchema(FAQS)} />
      </Section>
    </MarketingShell>
  );
}

// ── Hero with the live handle checker ─────────────────────────────────
function Hero() {
  return (
    <section style={{ padding: '72px 32px 48px', textAlign: 'center' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <p style={{
          fontSize: 12, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase',
          color: C.violet, marginBottom: 14,
        }}>Vergr.me</p>
        <h1 className="vg-syne" style={{ fontSize: 'clamp(34px, 6vw, 58px)', fontWeight: 800, lineHeight: 1.08, color: C.text }}>
          Get your free<br />
          <span style={{
            background: `linear-gradient(90deg, ${C.violet}, ${C.pink})`,
            WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
          }}>link in bio</span>
        </h1>
        <p style={{ marginTop: 18, fontSize: 17, lineHeight: 1.6, color: C.text2, maxWidth: 620, marginInline: 'auto' }}>
          One link for everything you create. Unlimited blocks, real themes, analytics and
          live stream integration, free forever with every Vergr account.
        </p>
        <HandleChecker />
        <p style={{ marginTop: 14, fontSize: 12, color: C.text3 }}>Free forever · No credit card · Set up in 2 minutes</p>
      </div>
    </section>
  );
}

// Live availability check against the public usernames index (1 read,
// debounced). Prefills from ?handle= (the vergr.me 404 page links here).
function HandleChecker() {
  const { search } = useLocation();
  const [handle, setHandle] = useState(() => {
    try { return (new URLSearchParams(search).get('handle') || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24); } catch { return ''; }
  });
  const [state, setState] = useState('idle'); // idle | checking | available | taken | blocked
  const timer = useRef(null);

  // Full signup-grade validation (shared checkUsername: format, reserved
  // brand/founder names, profanity blocklist, then uniqueness) — never a raw
  // availability lookup, or blocked handles read as "available".
  useEffect(() => {
    clearTimeout(timer.current);
    if (!handle || handle.length < 3) { setState('idle'); return; }
    setState('checking');
    timer.current = setTimeout(async () => {
      try {
        const err = await checkUsername(handle);
        if (!err) setState('available');
        else if (err.includes('taken')) setState('taken');
        else setState('blocked');
      } catch { setState('idle'); }
    }, 450);
    return () => clearTimeout(timer.current);
  }, [handle]);

  const available = state === 'available';
  const claimTo = `/signup${available && handle ? `?handle=${encodeURIComponent(handle)}` : ''}`;

  return (
    <div style={{ marginTop: 30 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0, maxWidth: 480, margin: '0 auto',
        borderRadius: 14, border: `1px solid ${(state === 'taken' || state === 'blocked') ? 'rgba(255,77,106,0.5)' : state === 'available' ? 'rgba(94,222,138,0.5)' : C.borderSoft}`,
        background: C.surface, padding: '6px 6px 6px 18px',
      }}>
        <span style={{ fontSize: 15, color: C.text3, fontWeight: 600, whiteSpace: 'nowrap' }}>{VERGRME_DISPLAY_PREFIX}</span>
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24))}
          placeholder="yourname"
          aria-label="Choose your vergr.me handle"
          style={{
            flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
            color: C.text, fontSize: 15, fontWeight: 600, padding: '10px 6px',
          }}
        />
        <Link to={claimTo} style={{
          padding: '11px 20px', borderRadius: 10, fontWeight: 800, fontSize: 14, whiteSpace: 'nowrap',
          background: `linear-gradient(90deg, ${C.violet}, ${C.pink})`, color: '#fff', textDecoration: 'none',
        }}>Claim it</Link>
      </div>
      <div style={{ marginTop: 10, fontSize: 13, minHeight: 20 }}>
        {state === 'checking' && <span style={{ color: C.text3 }}>Checking…</span>}
        {state === 'available' && (
          <span style={{ color: '#5EDE8A', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Icon name="check_circle" size={15} /> {VERGRME_DISPLAY_PREFIX}{handle} is available
          </span>
        )}
        {state === 'taken' && (
          <span style={{ color: C.ember, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Icon name="cancel" size={15} /> Taken, <a href={`https://vergr.app/u/${handle}`} style={{ color: C.text2 }}>see that page</a> or try another
          </span>
        )}
        {state === 'blocked' && (
          <span style={{ color: C.ember, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Icon name="block" size={15} /> That handle isn't available, try another
          </span>
        )}
      </div>
    </div>
  );
}

function ComparisonTable() {
  const rows = [
    ['Unlimited links & blocks', true, true],
    ['18+ block types (video, music, forms, products)', true, false],
    ['Full design systems + animated backgrounds', true, false],
    ['Click analytics', true, false],
    ['Email / lead capture', true, false],
    ['Custom QR codes', true, false],
    ['Link scheduling, passcodes, age gates', true, false],
    ['Live stream + community blocks', true, false],
    ['Get tipped by fans (keep 50-80%)', true, false],
  ];
  const Mark = ({ yes }) => yes
    ? <Icon name="check_circle" size={18} style={{ color: '#5EDE8A' }} />
    : <span style={{ fontSize: 12, color: C.text3 }}>Paid</span>;
  return (
    <div style={{
      marginTop: 16, borderRadius: 16, overflow: 'hidden',
      border: `1px solid ${C.borderSoft}`, background: 'var(--vg-grad-card)',
    }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 14,
        padding: '14px 18px', background: 'rgba(123,111,255,0.08)',
        borderBottom: `1px solid ${C.borderSoft}`,
        fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
        color: C.text3, textTransform: 'uppercase',
      }}>
        <div />
        <div style={{ color: C.violet }}>Vergr.me free</div>
        <div>Typical paid tiers</div>
      </div>
      {rows.map(([label, us, them]) => (
        <div key={label} style={{
          display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 14, alignItems: 'center',
          padding: '13px 18px', borderBottom: `1px solid ${C.borderSoft}`, fontSize: 14,
        }}>
          <div style={{ color: C.text }}>{label}</div>
          <div><Mark yes={us} /></div>
          <div><Mark yes={them} /></div>
        </div>
      ))}
    </div>
  );
}
