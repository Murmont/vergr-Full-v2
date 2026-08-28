// pro.vergr.app - the subscription product, on its own domain.
//
// WHY THIS EXISTS AS A SEPARATE SURFACE
//
// Vergr sells two unrelated things. Lite and Pro are ordinary software
// subscriptions: a monthly fee unlocks features. VC Coins are stored value that
// moves between users and can eventually be withdrawn. A merchant-of-record
// processor like Paddle sells the first and prohibits the second by name
// ("Virtual currency or stored value, including but not limited to store
// credit, gift cards, vouchers").
//
// Paddle's domain review does not require a seller's whole site to be
// Paddle-processed, but it does ask that the submitted domain be "directly
// related to the product you're selling via Paddle". So the subscription gets
// its own domain, describing only the subscription.
//
// ⚠ THE RULE FOR THIS FILE: nothing here may sell, price, advertise or link to
// Coins, tips, gifts, unlocks, withdrawals or the wallet. Not a card, not a
// footer link, not a passing mention in a feature list. The moment this page
// routes a buyer toward stored value it stops being a clean subscription
// surface and becomes the reason the account is declined, or worse, terminated
// after onboarding. If a feature cannot be described without mentioning Coins,
// leave the feature off this page.
//
// This is separation, not concealment. The coin economy is disclosed to the
// processor in the application itself. What we do not do is SELL it here.
//
// Terms, Refund and Privacy render on THIS host too (Paddle requires them
// "clearly accessible via navigation on your website"), so a reviewer never has
// to leave the domain to find them.

import { useEffect, useState } from 'react';
import { TIERS } from '../../utils/tierSystem';
import { LEGAL_DOCUMENTS, OPERATOR } from './legal/legalContent';
import { MarketingStyles, C } from './PublicMarketingScreens';
import Icon from '../../components/Icon';

const APP_URL = 'https://vergr.app';

// This host serves four pages and nothing else. Anything unrecognised falls
// back to the product page rather than 404ing into the main app's router.
const PAGES = {
  '/': 'product',
  '/terms': 'terms',
  '/refunds': 'refunds',
  '/privacy': 'privacy',
};

const NAV = [
  ['/', 'Product'],
  ['/terms', 'Terms'],
  ['/refunds', 'Refunds'],
  ['/privacy', 'Privacy'],
];

function useHashlessPath() {
  const [path, setPath] = useState(() => window.location.pathname.replace(/\/+$/, '') || '/');
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname.replace(/\/+$/, '') || '/');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = (to) => {
    window.history.pushState({}, '', to);
    setPath(to);
    window.scrollTo(0, 0);
  };
  return [path, go];
}

function Shell({ path, go, children }) {
  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh' }}>
      <MarketingStyles />
      <header style={{
        position: 'sticky', top: 0, zIndex: 20,
        background: 'rgba(7,8,13,0.86)', backdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${C.borderSoft}`,
      }}>
        <div style={{
          maxWidth: 1080, margin: '0 auto', padding: '14px 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        }}>
          <button
            type="button"
            onClick={() => go('/')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'baseline', gap: 8 }}
          >
            <span className="vg-syne" style={{ fontWeight: 800, fontSize: 18, letterSpacing: '0.16em', color: C.text }}>VERGR</span>
            <span className="vg-mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', color: C.violet }}>PRO</span>
          </button>
          <nav style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            {NAV.map(([to, label]) => (
              <button
                key={to}
                type="button"
                onClick={() => go(to)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  fontSize: 14, fontWeight: 700,
                  color: path === to ? C.text : C.text2,
                }}
              >{label}</button>
            ))}
          </nav>
        </div>
      </header>

      {children}

      <footer style={{ borderTop: `1px solid ${C.borderSoft}`, marginTop: 48 }}>
        <div style={{
          maxWidth: 1080, margin: '0 auto', padding: '28px 24px 48px',
          display: 'flex', flexWrap: 'wrap', gap: 20, justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 13, color: C.text3, lineHeight: 1.7, maxWidth: 520 }}>
            <div style={{ color: C.text2, fontWeight: 700 }}>{OPERATOR.legalName}</div>
            {OPERATOR.registeredAddress}.<br />
            Registration number {OPERATOR.registrationNumber}.<br />
            Support: {OPERATOR.supportEmail}
          </div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {NAV.slice(1).map(([to, label]) => (
              <button
                key={to}
                type="button"
                onClick={() => go(to)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: C.text2, fontSize: 13, fontWeight: 700 }}
              >{label}</button>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}

function PlanCard({ tier, highlight }) {
  return (
    <div style={{
      flex: '1 1 280px', padding: 26, borderRadius: 16,
      background: 'var(--vg-grad-card)',
      border: `1px solid ${highlight ? `${C.gold}66` : C.borderSoft}`,
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ color: tier.color }}><Icon name={tier.icon} size={22} /></span>
        <h3 className="vg-syne" style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>{tier.name}</h3>
      </div>
      <div>
        <span className="vg-mono" style={{ fontSize: 34, fontWeight: 800, color: C.text }}>
          ${tier.price.toFixed(2)}
        </span>
        <span style={{ fontSize: 14, color: C.text3, fontWeight: 700 }}> / month</span>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: C.text3 }}>
        Billed monthly in US dollars. Cancel any time.
      </p>
      <ul style={{ margin: '4px 0 0', paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 9 }}>
        {tier.features.map((f) => (
          <li key={f} style={{ display: 'flex', gap: 9, fontSize: 14, lineHeight: 1.5, color: C.text2 }}>
            <span style={{ color: tier.color, flexShrink: 0 }}><Icon name="check" size={17} /></span>
            {f}
          </li>
        ))}
      </ul>
      <a
        href={`${APP_URL}/settings/subscription`}
        style={{
          marginTop: 'auto', textAlign: 'center', textDecoration: 'none',
          padding: '13px 20px', borderRadius: 11, fontWeight: 800, fontSize: 15,
          background: highlight ? `linear-gradient(135deg, ${C.gold}, ${C.gold})` : `linear-gradient(135deg, ${C.violet}, ${C.pink})`,
          color: '#0B0B14',
        }}
      >
        Get {tier.name}
      </a>
    </div>
  );
}

function ProductPage() {
  const lite = TIERS.lite;
  const pro = TIERS.pro;
  return (
    <main>
      <section style={{ maxWidth: 1080, margin: '0 auto', padding: '64px 24px 24px' }}>
        <p className="vg-mono" style={{
          fontSize: 11, fontWeight: 700, color: C.violet,
          letterSpacing: '0.2em', textTransform: 'uppercase', margin: 0,
        }}>Subscription plans</p>
        <h1 className="vg-syne" style={{
          marginTop: 14, fontSize: 'clamp(32px, 6vw, 52px)', lineHeight: 1.05,
          fontWeight: 800, letterSpacing: '-0.03em', margin: '14px 0 0',
        }}>Vergr Lite and Vergr Pro</h1>
        <p style={{ marginTop: 18, maxWidth: 680, fontSize: 17, lineHeight: 1.65, color: C.text2 }}>
          Vergr is a live streaming and social platform for gamers. Lite and Pro
          are optional monthly subscriptions that unlock higher streaming
          quality, larger uploads, creator tools and analytics on your account.
          Everything else on Vergr stays free.
        </p>
        <p style={{ marginTop: 12, maxWidth: 680, fontSize: 15, lineHeight: 1.65, color: C.text3 }}>
          A subscription is software access tied to your Vergr account. It is not
          a physical product, and nothing is shipped.
        </p>
      </section>

      <section style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 24px 8px' }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <PlanCard tier={lite} />
          <PlanCard tier={pro} highlight />
        </div>
      </section>

      <section style={{ maxWidth: 1080, margin: '0 auto', padding: '40px 24px 8px' }}>
        <h2 className="vg-syne" style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>What you get</h2>
        <div style={{ display: 'grid', gap: 14, marginTop: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {[
            ['videocam', 'Higher streaming quality', 'Lite streams publicly at 720p from your first day, up to four hours daily. Pro streams at 1080p with no daily limit.'],
            ['cloud_upload', 'Larger uploads', 'Upload limits rise from 200MB on the free plan to 1GB on Lite and 5GB on Pro. Pro keeps photos at full 4K.'],
            ['insights', 'Creator tools and analytics', 'Scheduled posts, scheduled messages and creator analytics on Lite. Advanced analytics and 90-day replays of past broadcasts on Pro.'],
            ['block', 'No advertising', 'Both paid plans remove advertising from your feed.'],
          ].map(([icon, title, body]) => (
            <div key={title} style={{
              padding: 20, borderRadius: 14,
              background: 'var(--vg-grad-card)', border: `1px solid ${C.borderSoft}`,
            }}>
              <span style={{ color: C.violet }}><Icon name={icon} size={26} /></span>
              <h3 className="vg-syne" style={{ fontSize: 17, fontWeight: 700, margin: '10px 0 6px' }}>{title}</h3>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: C.text2 }}>{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section style={{ maxWidth: 1080, margin: '0 auto', padding: '40px 24px 8px' }}>
        <h2 className="vg-syne" style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>Billing</h2>
        <div style={{ marginTop: 16, display: 'grid', gap: 12, maxWidth: 760 }}>
          {[
            ['How am I billed?', 'Monthly, in US dollars, from the day you subscribe. The price shown is the price charged.'],
            ['Can I cancel?', 'Yes, at any time, from your account settings. Your plan stays active until the end of the period you have already paid for, and it does not renew after that.'],
            ['Do I get a refund?', 'Our Refund Policy is linked in the navigation above and sets out when a refund is available.'],
            ['What happens if I stop paying?', 'Your account reverts to the free plan. Nothing you posted is deleted, and limits that apply to the free plan apply again.'],
            ['Do I need a subscription to use Vergr?', 'No. The core platform is free, including watching streams, posting and squad streaming. Lite and Pro are optional.'],
          ].map(([q, a]) => (
            <div key={q} style={{ padding: '16px 18px', borderRadius: 12, background: C.surface, border: `1px solid ${C.borderSoft}` }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 5 }}>{q}</div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: C.text2 }}>{a}</p>
            </div>
          ))}
        </div>
      </section>

      <section style={{ maxWidth: 1080, margin: '0 auto', padding: '40px 24px 20px' }}>
        <div style={{
          padding: '26px 28px', borderRadius: 16,
          background: 'var(--vg-grad-card)', border: `1px solid ${C.borderSoft}`,
        }}>
          <h2 className="vg-syne" style={{ fontSize: 20, fontWeight: 800, margin: '0 0 8px' }}>About the platform</h2>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: C.text2 }}>
            Vergr is operated by {OPERATOR.legalName}, registered in the{' '}
            {OPERATOR.formationState} under number {OPERATOR.registrationNumber}. The
            platform is at{' '}
            <a href={APP_URL} style={{ color: C.violet, fontWeight: 700 }}>vergr.app</a>,
            where you can create a free account. Subscriptions are managed from your
            account settings.
          </p>
        </div>
      </section>
    </main>
  );
}

function LegalPage({ doc }) {
  const intro = Array.isArray(doc.intro) ? doc.intro : [doc.intro];
  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '48px 24px 24px' }}>
      <p className="vg-mono" style={{
        fontSize: 11, fontWeight: 700, color: C.violet,
        textTransform: 'uppercase', letterSpacing: '0.18em', margin: 0,
      }}>{doc.updated}</p>
      <h1 className="vg-syne" style={{
        marginTop: 12, fontSize: 'clamp(28px, 5vw, 40px)', fontWeight: 800, letterSpacing: '-0.02em',
      }}>{doc.label}</h1>
      {intro.map((p, i) => (
        <p key={i} style={{ marginTop: 14, fontSize: 15, lineHeight: 1.75, color: C.text2 }}>{p}</p>
      ))}
      {doc.sections.map((s) => (
        <section key={s.id} style={{ marginTop: 30 }}>
          <h2 className="vg-syne" style={{ fontSize: 19, fontWeight: 700, margin: '0 0 10px' }}>{s.title}</h2>
          {s.body.map((b, i) => (
            b && b.type === 'list' ? (
              <ul key={i} style={{ margin: '10px 0', paddingLeft: 22, color: C.text2, fontSize: 15, lineHeight: 1.75 }}>
                {b.items.map((it, k) => <li key={k} style={{ marginBottom: 6 }}>{it}</li>)}
              </ul>
            ) : (
              <p key={i} style={{ margin: '10px 0', fontSize: 15, lineHeight: 1.75, color: C.text2 }}>{b}</p>
            )
          ))}
        </section>
      ))}
    </main>
  );
}

export default function ProSubscriptionSite() {
  const [path, go] = useHashlessPath();
  const page = PAGES[path] || 'product';

  useEffect(() => {
    document.title = {
      product: 'Vergr Lite and Pro - Subscription Plans',
      terms: 'Terms of Service - Vergr',
      refunds: 'Refund Policy - Vergr',
      privacy: 'Privacy Policy - Vergr',
    }[page];
  }, [page]);

  return (
    <Shell path={PAGES[path] ? path : '/'} go={go}>
      {page === 'product' && <ProductPage />}
      {page === 'terms' && <LegalPage doc={LEGAL_DOCUMENTS.terms} />}
      {page === 'refunds' && <LegalPage doc={LEGAL_DOCUMENTS.refunds} />}
      {page === 'privacy' && <LegalPage doc={LEGAL_DOCUMENTS.privacy} />}
    </Shell>
  );
}
