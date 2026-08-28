// Stubs for the remaining 17 Vanguard dashboard pages.
//
// Each stub uses the real VanguardLayout shell with the correct `page` key
// (so the side nav highlights), a proper VanguardPageHeader, and a centered
// "build in progress" notice with a link to read the source design. Pages
// will be fleshed out one-by-one in follow-up sessions — these stubs ensure
// every nav link resolves to a real screen NOW so navigation feels complete.

import { useNavigate } from 'react-router-dom';
import VanguardLayout, { VG_COLORS as C, VanguardPageHeader, VgCard } from '../../components/vanguard/VanguardLayout';
import Icon from '../../components/Icon';

function StubBody({ icon, title, blurb, designFile }) {
  const navigate = useNavigate();
  return (
    <VgCard style={{ textAlign: 'center', padding: '48px 24px', maxWidth: 720, margin: '40px auto' }}>
      <div style={{
        width: 64, height: 64, borderRadius: 16,
        margin: '0 auto 16px',
        background: 'rgba(180,79,255,.12)',
        color: C.violetLt,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={icon} size={32} />
      </div>
      <h2 style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 22, color: C.text, margin: 0 }}>{title}</h2>
      <p style={{ fontFamily: 'DM Sans', fontSize: 13.5, color: C.textDim, marginTop: 8, lineHeight: 1.55 }}>{blurb}</p>
      <div style={{
        marginTop: 16,
        padding: '10px 14px',
        background: 'rgba(245,200,66,.08)',
        border: `1px solid rgba(245,200,66,.25)`,
        borderRadius: 10,
        fontFamily: 'DM Mono',
        fontSize: 11,
        color: C.gold,
        display: 'inline-block',
      }}>
        DESIGN ON FILE — {designFile}
      </div>
      <div style={{ marginTop: 24, display: 'flex', gap: 10, justifyContent: 'center' }}>
        <button
          onClick={() => navigate('/vanguard/today')}
          style={{
            padding: '10px 18px',
            background: 'rgba(180,79,255,.12)',
            border: `1px solid rgba(180,79,255,.3)`,
            borderRadius: 8,
            color: C.violetLt,
            cursor: 'pointer',
            fontFamily: 'DM Sans',
            fontSize: 13,
            fontWeight: 600,
          }}
        >← Back to Today</button>
      </div>
    </VgCard>
  );
}

// Queue page is now a real screen at VanguardQueueScreen.jsx — removed from stubs.

export function VanguardLiveScreen() {
  return (
    <VanguardLayout page="live">
      <VanguardPageHeader title="Live Now" subtitle="Active streams and tournaments that need Vanguard eyes." />
      <StubBody icon="live_tv" title="Live Now — coming next" blurb="Grid of in-progress streams + tournaments with Observe/Moderate quick actions. Your presence indicator broadcasts to the room when you join." designFile="Vanguard Live Now.png" />
    </VanguardLayout>
  );
}

export function VanguardMyCasesScreen() {
  return (
    <VanguardLayout page="my-cases">
      <VanguardPageHeader title="My Cases" subtitle="Cases you've claimed and are working through." />
      <StubBody icon="folder_managed" title="My Cases — coming next" blurb="Pinned cases, evidence trail, status tracker (open / pending evidence / pending decision). 48-hour SLA timer per claim." designFile="Vanguard My Cases.png" />
    </VanguardLayout>
  );
}

export function VanguardNotesScreen() {
  return (
    <VanguardLayout page="notes">
      <VanguardPageHeader title="Notes" subtitle="Private notes on users, posts, tournaments and recurring patterns." />
      <StubBody icon="sticky_note_2" title="Notes — coming next" blurb="Searchable note system. Tag users + cases. Visible only to you (unless you escalate the case and attach the note as evidence)." designFile="Vanguard Notes.png" />
    </VanguardLayout>
  );
}

export function VanguardTreasuryScreen() {
  return (
    <VanguardLayout page="treasury">
      <VanguardPageHeader title="Treasury" subtitle="Transparency leads to trust. Your earnings, plain math." />
      <StubBody icon="account_balance" title="Treasury — coming next" blurb="Live balance, 6-month pool history graph, your projected share, distribution countdown to 1st of month, leaderboard of contributors." designFile="Vanguard Treasury.png" />
    </VanguardLayout>
  );
}

export function VanguardPayoutsScreen() {
  return (
    <VanguardLayout page="payouts">
      <VanguardPageHeader title="Payout History" subtitle="Every monthly distribution you've received." />
      <StubBody icon="receipt_long" title="Payout History — coming next" blurb="Monthly cards with your share, rank at distribution, action count, pool breakdown, per-recipient comparison row." designFile="Vanguard Payout History.png" />
    </VanguardLayout>
  );
}

export function VanguardWalletScreen() {
  return (
    <VanguardLayout page="wallet">
      <VanguardPageHeader title="VP & Wallet" subtitle="Your Vanguard Points, coins and wallet actions." />
      <StubBody icon="wallet" title="VP & Wallet — coming next" blurb="Big VP balance + rank progress bar to L100 / next mod-rank, Buy Coins, and the per-action VP table. (Convert and Request Payout are gone from the product: there is no conversion and no user-initiated withdrawal.)" designFile="Vanguard VP & Wallet.png" />
    </VanguardLayout>
  );
}

export function VanguardStatsScreen() {
  return (
    <VanguardLayout page="stats">
      <VanguardPageHeader title="My Stats" subtitle="Your moderation impact at a glance." />
      <StubBody icon="bar_chart" title="My Stats — coming next" blurb="Total actions, this week / this month, average per day, streak counter. Actions-per-day chart + breakdowns by action type and reason code." designFile="Vanguard My Stats.png" />
    </VanguardLayout>
  );
}

export function VanguardRankScreen() {
  return (
    <VanguardLayout page="rank">
      <VanguardPageHeader title="Rank Progress" subtitle="Track your journey, see what's next, and grow your impact." />
      <StubBody icon="military_tech" title="Rank Progress — coming next" blurb="VP toward next rank (5k → 25k → 250k → 1M → 5M), skill gates checklist, what next rank unlocks. Founder approval required for Commander+ regardless of VP." designFile="Vanguard Rank Progress.png" />
    </VanguardLayout>
  );
}

export function VanguardPeerScreen() {
  return (
    <VanguardLayout page="peer">
      <VanguardPageHeader title="Peer Activity" subtitle="Real-time activity from across the Vanguard community." />
      <StubBody icon="visibility" title="Peer Activity — coming next" blurb="Live feed of mod actions with rank + action type + target snippet. Click any row to see the full audit detail. Filter by type (overturns, bans, tournament calls, etc.)." designFile="Vanguard Peer Activity.png" />
    </VanguardLayout>
  );
}

export function VanguardRosterScreen() {
  return (
    <VanguardLayout page="roster">
      <VanguardPageHeader title="Roster" subtitle="All active Vanguard members. Real identities. Trusted peers." />
      <StubBody icon="groups" title="Roster — coming next" blurb="Real-identity directory with rank badges, status (active / suspended / retired), action counts, last seen. Click any row for full profile + send DM. Recommend-to-promote button on the side rail." designFile="Vanguard Roster.png" />
    </VanguardLayout>
  );
}

export function VanguardChatScreen() {
  return (
    <VanguardLayout page="chat">
      <VanguardPageHeader title="Vanguard Chat" subtitle="Secure squad communication for active Vanguard members." />
      <StubBody icon="chat" title="Vanguard Chat — coming next" blurb="Pinned messages + 'Open in Vanguard Chat' deep-link to the squad chat thread. Code-of-Conduct §5 (confidentiality) reminder at the top." designFile="Vanguard Vanguard Chat.png" />
    </VanguardLayout>
  );
}

export function VanguardEscalationsScreen() {
  return (
    <VanguardLayout page="escalations">
      <VanguardPageHeader title="Escalations" subtitle="Cases you've kicked up. Decisions overturned. My escalations." />
      <StubBody icon="priority_high" title="Escalations — coming next" blurb="Three sections: Cases I've escalated upward, Cases escalated to me (Commander+), My decisions challenged on appeal. Founder approval / Senior decisioning trail." designFile="Vanguard Escalations.png" />
    </VanguardLayout>
  );
}

export function VanguardHandbookScreen() {
  return (
    <VanguardLayout page="handbook">
      <VanguardPageHeader title="Vanguard Handbook" subtitle="Your complete guide to policies, procedures, and best practices." />
      <StubBody icon="menu_book" title="Handbook — coming next" blurb="The 8 Rules of the Vanguard, consequences ladder, per-rank financials with live MRR-activation status pills. PDF download. Side-nav of sections + per-section anchor links." designFile="Vanguard Handbook.png" />
    </VanguardLayout>
  );
}

export function VanguardLibraryScreen() {
  return (
    <VanguardLayout page="library">
      <VanguardPageHeader title="Decision Library" subtitle="Past rulings, precedents, and patterns to learn from." />
      <StubBody icon="gavel" title="Decision Library — coming next" blurb="Searchable archive of accepted-as-precedent rulings. Tagged by rule, action type, severity. Lookup before deciding a tricky case to stay consistent." designFile="(generic — pattern from queue + escalations)" />
    </VanguardLayout>
  );
}

export function VanguardAnnouncementsScreen() {
  return (
    <VanguardLayout page="announcements">
      <VanguardPageHeader title="Announcements" subtitle="Updates from founder & Overseers. Read carefully." />
      <StubBody icon="campaign" title="Announcements — coming next" blurb="Founder/Overseer announcement stream. Acknowledge button on important ones (records read-receipt on the audit trail). Filters by date + author rank." designFile="(generic — pattern from notifications)" />
    </VanguardLayout>
  );
}

export function VanguardLookupUserScreen() {
  return (
    <VanguardLayout page="lookup-user">
      <VanguardPageHeader title="User Lookup" subtitle="Pull any user's full audit history in one query." />
      <StubBody icon="person_search" title="User Lookup — coming next" blurb="Search by username, email or uid. Returns profile snapshot + all `vanguard_actions` where targetId = user, plus any reports filed by or against them." designFile="(generic — pattern from admin tools)" />
    </VanguardLayout>
  );
}

export function VanguardLookupTournamentScreen() {
  return (
    <VanguardLayout page="lookup-tour">
      <VanguardPageHeader title="Tournament Lookup" subtitle="Drill into any tournament's match history + mod decisions." />
      <StubBody icon="emoji_events" title="Tournament Lookup — coming next" blurb="Search by tournament name or ID. Returns bracket state, every Vanguard call on the matches, prize-pool routing (treasury vs platform), disputes." designFile="(generic — pattern from admin tools)" />
    </VanguardLayout>
  );
}

export function VanguardLookupActionScreen() {
  return (
    <VanguardLayout page="lookup-action">
      <VanguardPageHeader title="Action Lookup" subtitle="Find a specific audit entry by ID, moderator, or case code." />
      <StubBody icon="search" title="Action Lookup — coming next" blurb="The audit-log search Commander+ have asked for. Filter by moderator, action type, time range, target type. Export-as-CSV button." designFile="(generic — pattern from admin tools)" />
    </VanguardLayout>
  );
}
