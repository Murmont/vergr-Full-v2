// /vanguard/handbook — The Vanguard Handbook. Design ref: Vanguard Handbook.png
// Full content: 8 Rules, Consequences Ladder, Financials with MRR-activation pills,
// Tournament procedure, Platform rules FAQ. Side-nav of sections.

import { useState } from 'react';
import VanguardLayout, { VG_COLORS as C, VanguardPageHeader, VgCard } from '../../components/vanguard/VanguardLayout';
import Icon from '../../components/Icon';
import { VANGUARD_RANKS, STIPEND_MRR_BRACKETS, stipendForRank } from '../../utils/vanguardRanks';

const SECTIONS = [
  { key: 'rules',         label: 'The 8 Rules of the Vanguard',   icon: 'gavel' },
  { key: 'consequences',  label: 'Consequences Ladder',            icon: 'warning' },
  { key: 'financials',    label: 'Financials & Treasury',          icon: 'paid' },
  { key: 'recruits',      label: 'Onboarding & Recruits',          icon: 'school' },
  { key: 'tournaments',   label: 'Tournament Winner-Call Procedure', icon: 'emoji_events' },
  { key: 'queue',         label: 'Working the Queue',              icon: 'inbox' },
  { key: 'escalations',   label: 'Escalations & Appeals',          icon: 'priority_high' },
  { key: 'faq',           label: 'Platform Rules FAQ',             icon: 'help' },
];

// Replace this once real MRR aggregator is wired. For now: zero MRR → all
// stipends locked.
const CURRENT_MRR = 0;

const RULES = [
  { n: 1, title: 'Anonymity is Absolute',  body: 'Never reveal your real identity to any user — DM, chat, or any public surface. First offense = demotion to Recruit. Second offense = removal + permanent ban from Vanguard.' },
  { n: 2, title: 'Onboarding the Recruits', body: 'Recruits learn by shadowing. Take time to explain your reasoning when they ask. Mentor at least one Recruit per quarter at Senior+ rank.' },
  { n: 3, title: 'Platform Confidentiality', body: 'Audit logs, evidence, user reports, Vanguard chat content — never shared externally. Screenshots of moderation surfaces are prohibited.' },
  { n: 4, title: 'Follow the Evidence',     body: 'Decisions based on evidence, not vibes. When evidence is grainy, escalate. Don\'t guess.' },
  { n: 5, title: 'Escalation Paths',         body: 'When unsure: ask in Vanguard Chat. When stake is high (permaban, large prize pool): escalate to Senior+. Recruits cannot decide; only shadow + flag.' },
  { n: 6, title: 'Tournament Standards',     body: 'Match decisions are final after 24h unless appealed to Senior+. Use Decision Library precedents before deciding. Document your reasoning in the audit log.' },
  { n: 7, title: 'Consistency, Even when Costly', body: 'Apply the same rule to friends as to strangers. Recuse from any case involving personal off-platform relationships. Disclose conflicts of interest immediately.' },
  { n: 8, title: 'Discipline Means Following', body: 'When Commander+ overturns your decision, accept it. Appeal once, then move on. Repeated insubordination = demotion review.' },
];

const CONSEQUENCES = [
  { level: 1, title: 'Level 1 · Logged Warning',          body: 'Minor procedural slip. Documented in your audit row. No effect on rank.', color: C.gold },
  { level: 2, title: 'Level 2 · Formal Warning',          body: 'Repeated minor errors OR a single moderate breach. Acknowledged in writing.', color: C.gold },
  { level: 3, title: 'Level 3 · Mentor Review',           body: 'Senior+ pairs with you for 30 days. Decisions co-signed during the period.', color: '#F09030' },
  { level: 4, title: 'Level 4 · Suspension (7-30d)',      body: 'Stripped of moderation actions. Read-only Vanguard access. Treasury share suspended.', color: C.ember },
  { level: 5, title: 'Level 5 · Demotion',                body: 'Drop one rank. Loss of treasury weight + per-action VP. Resumes from new rank.', color: C.ember },
  { level: 6, title: 'Level 6 · Removal + Permaban',      body: 'Severe breach (anonymity, leak, abuse). Permanently removed. Cannot return.', color: C.ember },
];

function StipendCell({ rankId, mrr }) {
  const amount = stipendForRank(rankId, mrr);
  if (amount === 0) {
    // Find the lowest bracket where this rank earns >0
    const r = VANGUARD_RANKS.find(x => x.id === rankId);
    const firstNonZero = STIPEND_MRR_BRACKETS.find(m => (r?.stipendCoinsByMrr?.[m] || 0) > 0);
    return (
      <div>
        <div style={{ fontFamily: 'DM Mono', fontSize: 12, color: C.textMuted }}>—</div>
        {firstNonZero && (
          <div style={{ fontFamily: 'DM Mono', fontSize: 9.5, color: C.textMuted, marginTop: 2 }}>unlocks at €{(firstNonZero / 1000)}k</div>
        )}
      </div>
    );
  }
  return (
    <div>
      <div style={{ fontFamily: 'DM Mono', fontSize: 13, fontWeight: 700, color: C.gold }}>{amount.toLocaleString()}c</div>
      <div style={{ fontFamily: 'DM Mono', fontSize: 9.5, color: C.textMuted, marginTop: 2 }}>~€{(amount * 0.01).toFixed(0)}/mo</div>
    </div>
  );
}

export default function VanguardHandbookScreen() {
  const [section, setSection] = useState('rules');

  const renderSection = () => {
    if (section === 'rules') return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {RULES.map(r => (
          <VgCard key={r.n}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(180,79,255,.12)', color: C.violetLt, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: 'Syne', fontWeight: 800, fontSize: 16 }}>{r.n}</div>
              <div>
                <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 15, color: C.text }}>{r.title}</div>
                <div style={{ fontFamily: 'DM Sans', fontSize: 13, color: C.textDim, marginTop: 6, lineHeight: 1.55 }}>{r.body}</div>
              </div>
            </div>
          </VgCard>
        ))}
      </div>
    );

    if (section === 'consequences') return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {CONSEQUENCES.map(c => (
          <VgCard key={c.level} style={{ borderLeft: `3px solid ${c.color}` }}>
            <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 14, color: c.color }}>{c.title}</div>
            <div style={{ fontFamily: 'DM Sans', fontSize: 12.5, color: C.textDim, marginTop: 6, lineHeight: 1.55 }}>{c.body}</div>
          </VgCard>
        ))}
        <div style={{ marginTop: 6, padding: 10, background: 'rgba(245,200,66,.06)', border: `1px solid rgba(245,200,66,.2)`, borderRadius: 8, fontFamily: 'DM Sans', fontSize: 12, color: C.gold }}>
          <Icon name="info" size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          Severe breaches (anonymity violation, evidence leak, abuse of authority) go directly to Level 6, no warnings. Founder + Overseers vote on severe-breach calls.
        </div>
      </div>
    );

    if (section === 'financials') return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <VgCard>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em' }}>Platform MRR</div>
              <div style={{ fontFamily: 'DM Mono', fontSize: 22, fontWeight: 800, color: C.text }}>€{CURRENT_MRR.toLocaleString()}</div>
            </div>
            <div style={{ padding: '6px 12px', background: CURRENT_MRR >= 10000 ? 'rgba(34,209,126,.12)' : 'rgba(107,114,128,.12)', border: `1px solid ${CURRENT_MRR >= 10000 ? 'rgba(34,209,126,.3)' : C.border}`, borderRadius: 999, fontFamily: 'DM Sans', fontSize: 12, fontWeight: 700, color: CURRENT_MRR >= 10000 ? C.success : C.textMuted }}>
              {CURRENT_MRR >= 10000 ? '🟢 Tier B Active' : '⚪ Tier B Dormant'}
            </div>
          </div>
          <div style={{ fontFamily: 'DM Sans', fontSize: 12.5, color: C.textDim, lineHeight: 1.5 }}>
            You're building this with us. When the platform reaches profitability, you share in it. The stipend ladder below activates automatically once MRR thresholds are crossed.
          </div>
        </VgCard>

        <VgCard>
          <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 12 }}>Active perks — every rank, every day</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontFamily: 'DM Sans', fontSize: 13, color: C.textDim, lineHeight: 1.8 }}>
            <li><strong style={{ color: C.text }}>Treasury share</strong> — every active mod earns from the 5% tournament mod cut on tournaments they preside over. Pool distributes 1st of each month at 00:05 UTC.</li>
            <li><strong style={{ color: C.text }}>0% coin → gem conversion fee</strong> — Vanguard+ pay zero commission converting. Normal users pay 5-30%.</li>
            <li><strong style={{ color: C.text }}>+VP per moderation action</strong> — Recruit +10, Vanguard +50, Senior +100, Commander +200, Overseer +500.</li>
            <li><strong style={{ color: C.text }}>Unlimited referral cap</strong> — normal users capped at 5/week (Free) or 20/week (Lite/Pro). You're uncapped.</li>
            <li><strong style={{ color: C.text }}>Unlimited Vanguard squad cap</strong> — 100-member cap doesn't apply to the Vanguard squad.</li>
          </ul>
        </VgCard>

        <VgCard>
          <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 12 }}>Monthly stipend ladder (Tier B — MRR-gated)</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'DM Sans', fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ textAlign: 'left', padding: '8px 10px', fontFamily: 'DM Mono', fontSize: 9.5, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.12em' }}>Rank</th>
                  {STIPEND_MRR_BRACKETS.map(m => (
                    <th key={m} style={{ textAlign: 'left', padding: '8px 10px', fontFamily: 'DM Mono', fontSize: 9.5, color: CURRENT_MRR >= m ? C.success : C.textMuted, textTransform: 'uppercase', letterSpacing: '.12em' }}>
                      €{(m / 1000)}k MRR
                      {CURRENT_MRR >= m && <span style={{ marginLeft: 4 }}>🟢</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {VANGUARD_RANKS.map(r => (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: '10px', color: C.text, fontWeight: 700 }}>{r.label}</td>
                    {STIPEND_MRR_BRACKETS.map(m => (
                      <td key={m} style={{ padding: '10px' }}><StipendCell rankId={r.id} mrr={m} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 14, padding: 10, background: 'rgba(180,79,255,.05)', border: `1px solid rgba(180,79,255,.15)`, borderRadius: 8, fontFamily: 'DM Mono', fontSize: 10.5, color: C.textDim }}>
            Stipends are paid from <code>app_revenue/tournaments</code> first, <code>app_revenue/tips</code> as fallback. Infrastructure stays funded — stipends never come from the tip 10% lifeline. Activates at €10k MRR. Currently dormant.
          </div>
        </VgCard>

        <VgCard>
          <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 12 }}>Treasury share formula</div>
          <div style={{ fontFamily: 'DM Mono', fontSize: 14, color: C.text, padding: 12, background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8, textAlign: 'center', letterSpacing: '.04em' }}>
            share = (rank_weight × monthly_actions) / Σ × pool
          </div>
          <div style={{ fontFamily: 'DM Sans', fontSize: 12.5, color: C.textDim, marginTop: 10, lineHeight: 1.6 }}>
            Rank weights: Recruit 0× (no share), Vanguard 1.0×, Senior 2.0×, Commander 4.0×, Overseer 8.0×. Inactive months pay nothing — show up + work or lose your share to active mods.
          </div>
        </VgCard>
      </div>
    );

    if (section === 'recruits') return (
      <VgCard>
        <h3 style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 16, color: C.text, margin: '0 0 12px' }}>Recruit-to-Vanguard onboarding</h3>
        <ol style={{ paddingLeft: 18, fontFamily: 'DM Sans', fontSize: 13, color: C.textDim, lineHeight: 1.7 }}>
          <li>Recruit accepts invitation + signs Code of Conduct.</li>
          <li>Recruit shadows seniors in the Queue for ~30 days. They see cases + decisions but cannot act.</li>
          <li>At ~25,000 VP earned via Recruit shadowing actions (+10 VP each, ~2,500 cases), Recruit becomes eligible for Vanguard promotion.</li>
          <li>A Senior+ recommends them on the Roster page. Founder approves the promotion.</li>
          <li>New Vanguard gets first solo decision authority + treasury weight unlocks at 1.0×.</li>
        </ol>
        <div style={{ marginTop: 12, padding: 10, background: 'rgba(180,79,255,.05)', border: `1px solid rgba(180,79,255,.15)`, borderRadius: 8, fontFamily: 'DM Sans', fontSize: 12, color: C.textDim }}>
          Senior+ ranks: mentor at least one Recruit per quarter. Mentor-to-mentee promotion stats are visible to Commander+ on the Roster page.
        </div>
      </VgCard>
    );

    if (section === 'tournaments') return (
      <VgCard>
        <h3 style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 16, color: C.text, margin: '0 0 12px' }}>Tournament winner-call procedure</h3>
        <ol style={{ paddingLeft: 18, fontFamily: 'DM Sans', fontSize: 13, color: C.textDim, lineHeight: 1.7 }}>
          <li><strong style={{ color: C.text }}>Verify your authority.</strong> Recruits cannot decide. Vanguard+ can.</li>
          <li><strong style={{ color: C.text }}>Review evidence.</strong> GSI data {'>'} replay clips {'>'} screenshots {'>'} player testimony. Demand timestamps.</li>
          <li><strong style={{ color: C.text }}>Check the Decision Library.</strong> Search for prior rulings on similar disputes. Cite precedent in your reason.</li>
          <li><strong style={{ color: C.text }}>Document.</strong> Write a clear reason in the Decision column. This goes to audit + appears on the appeal record if challenged.</li>
          <li><strong style={{ color: C.text }}>Decide.</strong> Click the winning player. Match auto-completes. Bracket advances.</li>
          <li><strong style={{ color: C.text }}>If unclear:</strong> escalate to Senior+. Don't guess on prize-money disputes.</li>
        </ol>
        <div style={{ marginTop: 12, padding: 10, background: 'rgba(34,209,126,.05)', border: `1px solid rgba(34,209,126,.2)`, borderRadius: 8, fontFamily: 'DM Sans', fontSize: 12, color: C.success }}>
          Tournaments you decide get flagged <code>vanguardModerated: true</code>. The 5% mod cut routes to the Vanguard treasury automatically. Your action increments your monthly count + treasury weight.
        </div>
      </VgCard>
    );

    if (section === 'queue') return (
      <VgCard>
        <h3 style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 16, color: C.text, margin: '0 0 12px' }}>Working the Queue</h3>
        <ul style={{ paddingLeft: 18, fontFamily: 'DM Sans', fontSize: 13, color: C.textDim, lineHeight: 1.7 }}>
          <li><strong style={{ color: C.text }}>Oldest first.</strong> The queue defaults to oldest items first to prevent old cases getting buried.</li>
          <li><strong style={{ color: C.text }}>Claim before reviewing.</strong> Once you claim a case, you have 48h SLA. Held longer = auto-released to queue.</li>
          <li><strong style={{ color: C.text }}>Use filters.</strong> Critical-only filter when you have 15 minutes. Tournaments filter when you want decision practice.</li>
          <li><strong style={{ color: C.text }}>Notes are private.</strong> Use the Notes page to track patterns, but never share screenshots externally.</li>
          <li><strong style={{ color: C.text }}>Reason is required.</strong> Every decision gets logged. Write reasons others could learn from.</li>
        </ul>
      </VgCard>
    );

    if (section === 'escalations') return (
      <VgCard>
        <h3 style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 16, color: C.text, margin: '0 0 12px' }}>Escalations & Appeals</h3>
        <div style={{ fontFamily: 'DM Sans', fontSize: 13, color: C.textDim, lineHeight: 1.7 }}>
          <p><strong style={{ color: C.text }}>When to escalate:</strong> evidence is grainy, stakes are high (permaban / large prize pool), conflict of interest, you've been challenged on appeal once and want a second opinion.</p>
          <p><strong style={{ color: C.text }}>Escalation chain:</strong> Vanguard → Senior Vanguard → Commander → Overseer → Founder. Don't skip levels unless time-critical.</p>
          <p><strong style={{ color: C.text }}>Appeals:</strong> Users can appeal your decision once. The next-tier mod reviews + either upholds or overturns. Repeated overturns trigger a Mentor Review.</p>
          <p><strong style={{ color: C.text }}>If your decision is overturned:</strong> read the reviewer's reason carefully. Add the case to your Notes. Discuss in Vanguard Chat if you disagree — never publicly.</p>
        </div>
      </VgCard>
    );

    if (section === 'faq') return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[
          { q: 'A user claims they were banned for no reason. What do I tell them?', a: 'Every action has an audit row. Look it up in the Action Lookup. Then tell them the reason code + the day they violated. They can appeal once.' },
          { q: 'Can I moderate a tournament my friend is competing in?',                  a: 'No. Conflict of interest. Pass the case to another mod. Disclose the relationship in Vanguard Chat.' },
          { q: 'How do I unban someone?',                                                 a: 'Find their record in User Lookup, find the ban in audit log, and run an Unban action (Commander+ only). Document why.' },
          { q: 'What if I disagree with another mod\'s decision?',                        a: 'Discuss in Vanguard Chat. Don\'t challenge publicly. If still unresolved, formally escalate to Commander+ for review.' },
          { q: 'A user offers me coins to overturn a decision.',                          a: 'Report immediately in Vanguard Chat with screenshots. Bribery = instant Level-6 consequences for both parties.' },
        ].map((f, i) => (
          <VgCard key={i}>
            <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: 13.5, color: C.text }}>{f.q}</div>
            <div style={{ fontFamily: 'DM Sans', fontSize: 12.5, color: C.textDim, marginTop: 8, lineHeight: 1.55 }}>{f.a}</div>
          </VgCard>
        ))}
      </div>
    );
    return null;
  };

  return (
    <VanguardLayout page="handbook">
      <VanguardPageHeader
        title="Vanguard Handbook"
        subtitle="Your complete guide to policies, procedures, and best practices."
        right={
          <button style={{ padding: '8px 14px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: C.textDim, fontFamily: 'DM Sans', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="download" size={14} /> Download PDF
          </button>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 260px) minmax(0, 1fr)', gap: 14 }}>
        <VgCard style={{ padding: 8, alignSelf: 'flex-start' }}>
          {SECTIONS.map((s) => {
            const isActive = section === s.key;
            return (
              <button
                key={s.key}
                onClick={() => setSection(s.key)}
                style={{
                  width: '100%',
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px',
                  background: isActive ? 'rgba(180,79,255,.12)' : 'transparent',
                  border: 0,
                  borderLeft: isActive ? `2px solid ${C.violetLt}` : '2px solid transparent',
                  borderRadius: 6,
                  color: isActive ? C.text : C.textDim,
                  fontFamily: 'DM Sans',
                  fontSize: 12.5,
                  fontWeight: isActive ? 700 : 500,
                  cursor: 'pointer',
                  textAlign: 'left',
                  marginBottom: 2,
                }}
              >
                <Icon name={s.icon} size={16} />
                <span>{s.label}</span>
              </button>
            );
          })}
        </VgCard>

        <div>{renderSection()}</div>
      </div>
    </VanguardLayout>
  );
}
