// src/screens/creator/CreatorHomeScreen.jsx
//
// Creator Studio home. Wired 2026-08-14; this was a structure-only shell before.
//
// Every block reads real data or renders nothing. Nothing on this screen shows a
// number it cannot source, and no block renders a placeholder value.
//
// All six "Needs you" signals are live: payout blockers, strikes, creator
// application state, scheduled-post failures, a post outperforming right now,
// going quiet, and a membership tier nobody joins while your others sell.
//
// The one job of this screen: "what happened since I was last here, and what
// should I do next?" Every block must be actionable within ten minutes. If it
// is analysis it belongs on Analytics; if it is money it belongs on Earnings.
// Plan: docs/CREATOR_PROGRAM_PLAN.md §9.
//
// Drawn from what the majors actually put on a creator home:
//   YouTube Studio  — latest video vs YOUR OWN typical performance, comments
//                     awaiting reply, "ideas for you", channel snapshot.
//   Twitch Dashboard— quick actions first, a checklist of things to fix, and a
//                     recent-stream summary.
//   TikTok Studio   — a short metric strip with period deltas, and posts needing
//                     attention.
// The common shape across all three is: act first, measure second, and never
// show a lifetime total on the home screen.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { getUserPosts, getPayoutAccount, getRecentFollowerCounts, getCreatorAttentionSignals } from '../../firebase/firestore';
import CreatorLayout from '../../components/creator/CreatorLayout';
import Icon from '../../components/Icon';
import { RowsSkeleton } from '../../components/creator/StudioSkeletons';
import '../../styles/surface.css';

const GOLD = ['#FFF6D4', '#FBDA62', '#F2B721', '#DE9A0C'];
const GOLD_TEXT = {
  background: `linear-gradient(175deg, ${GOLD[0]} 0%, ${GOLD[1]} 34%, ${GOLD[2]} 74%, ${GOLD[3]} 100%)`,
  WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
};
const NUM = 'font-dmmono font-bold tabular-nums';

/** Marks a block whose data is not wired yet. Better than inventing numbers. */
function Stub({ children }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider align-middle"
      style={{ background: 'rgba(180,79,255,0.14)', color: '#B44FFF' }}>
      <Icon name="construction" className="text-[10px]" />{children || 'not wired'}
    </span>
  );
}

function Panel({ title, sub, right, children, className = '' }) {
  return (
    <div className={`vg-material vg-grain rounded-2xl overflow-hidden ${className}`}>
      <div className="relative z-[1] p-5">
        {(title || right) && (
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              {title && <div className="text-sm font-bold text-text-primary">{title}</div>}
              {sub && <div className="text-xs text-text-muted mt-0.5">{sub}</div>}
            </div>
            {right}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/* ── 2. Needs you ──────────────────────────────────────────────────────
 * The block that makes this screen worth opening, and the one nothing in the
 * studio does today. Twitch's checklist is the closest analogue.
 * Ships complete or not at all: a half-populated list is worse than none,
 * because a creator learns to distrust it. */
/**
 * Build the real list. Ranked by urgency, capped at five.
 *
 * Only emits a row when there is a genuine fact behind it, and never a
 * placeholder: a to-do list that invents rows gets ignored wholesale, including
 * the rows that are real.
 *
 * Urgency order is deliberate. 0 is money or a publish that already failed,
 * because both have a cost that grows while ignored. 4 is an empty membership
 * tier, which is a missed opportunity rather than a broken thing.
 */
function buildNeedsYou(account, profile, navigate, posts = [], signals = null) {
  const items = [];

  // 0. Scheduled posts. A post that failed to publish is the most urgent thing
  //    on this list after money, because the window it was written for passes.
  const now = Date.now();
  const scheduled = posts.filter((p) => p.status === 'scheduled');
  const overdue = scheduled.filter((p) => {
    const at = p.scheduledFor?.toDate ? p.scheduledFor.toDate().getTime()
      : p.scheduledFor?.seconds ? p.scheduledFor.seconds * 1000 : 0;
    // More than an hour past its slot: the 5-minute publish cron should have
    // taken it, so something is wrong rather than merely pending.
    return at && at < now - 3600000;
  });
  if (overdue.length) {
    items.push({
      key: 'overdue', icon: 'schedule_send', urgency: 0,
      label: `${overdue.length} scheduled post${overdue.length === 1 ? '' : 's'} did not publish`,
      sub: 'Past their slot and still unpublished',
      onClick: () => navigate('/creator/schedule'),
    });
  } else if (scheduled.length) {
    const soonest = scheduled
      .map((p) => (p.scheduledFor?.toDate ? p.scheduledFor.toDate().getTime()
        : p.scheduledFor?.seconds ? p.scheduledFor.seconds * 1000 : 0))
      .filter(Boolean).sort((a, b) => a - b)[0];
    if (soonest && soonest < now + 24 * 3600000) {
      items.push({
        key: 'upcoming', icon: 'schedule_send', urgency: 3,
        label: 'A post publishes in the next 24 hours',
        sub: 'Review it before it goes out',
        onClick: () => navigate('/creator/schedule'),
      });
    }
  }

  // 1. Payouts. Highest urgency: it is the creator's money.
  const BLOCKERS = {
    kyc_required:            ['Verify your identity to get paid',        'Payouts cannot be sent until this is done'],
    tax_form_required:       ['Add your tax form',                       'Required before your first payout'],
    payout_account_required: ['Connect a payout account',                'We have nowhere to send your money'],
    frozen:                  ['Your payout account is frozen',           'Reach support to resolve'],
    suspended_strikes:       ['Payouts are paused pending review',       'You are still earning, nothing is lost'],
  };
  if (account?.blockedBy && BLOCKERS[account.blockedBy]) {
    const [label, sub] = BLOCKERS[account.blockedBy];
    items.push({
      key: 'payout', icon: 'account_balance', urgency: 0, label, sub,
      onClick: () => navigate('/creator/earnings/setup'),
    });
  } else if (account && !account.enrolled && (account.availableMicroUsd || 0) > 0) {
    items.push({
      key: 'enroll', icon: 'account_balance', urgency: 0,
      label: 'Set up payouts to get your earnings',
      sub: 'You have money waiting',
      onClick: () => navigate('/creator/earnings/setup'),
    });
  }

  // 2. Strikes. Shown even when payouts are not blocked, because one strike
  //    still slows the schedule and the creator should know why.
  if ((account?.activeStrikes || 0) > 0 && account?.blockedBy !== 'suspended_strikes') {
    items.push({
      key: 'strike', icon: 'gavel', urgency: 1,
      label: `${account.activeStrikes} active strike${account.activeStrikes === 1 ? '' : 's'} on your account`,
      sub: 'Your payout schedule is reduced until they expire',
      onClick: () => navigate('/creator/earnings'),
    });
  }

  // 3. Creator application state.
  const st = profile?.creator?.status;
  if (st === 'pending') {
    items.push({
      key: 'creator', icon: 'how_to_reg', urgency: 2,
      label: 'Your creator application is under review',
      sub: 'Nothing to do, we will let you know',
      onClick: () => navigate('/creator/verify'),
    });
  } else if (st === 'rejected') {
    items.push({
      key: 'creator', icon: 'how_to_reg', urgency: 1,
      label: 'Your creator application was declined',
      sub: 'You can review the reason and reapply',
      onClick: () => navigate('/creator/verify'),
    });
  }

  // 4. A post that is outperforming, RIGHT NOW.
  //
  // This replaced an "unanswered comments" row, which was a design error worth
  // recording: a busy post always has a newer comment than the creator's last
  // reply, so that row could never be cleared. It was a permanent nag dressed
  // as a task, and nobody replies to a thousand comments. A to-do item that
  // cannot be completed teaches a creator to ignore the entire list.
  //
  // This one is finite by construction: it only considers the last 7 days, so
  // it ages out on its own, and it points at a window that is genuinely closing
  // rather than at an obligation that never ends.
  const week = posts.filter((p) => {
    const ms = p.createdAt?.toDate ? p.createdAt.toDate().getTime()
      : p.createdAt?.seconds ? p.createdAt.seconds * 1000 : 0;
    return ms && ms >= now - 7 * 86400000 && p.status !== 'scheduled';
  });
  const older = posts.filter((p) => !week.includes(p) && p.status !== 'scheduled');
  if (week.length && older.length >= 4) {
    const score = (p) => (p.likeCount || 0) + (p.commentCount || 0);
    const baseline = [...older].map(score).sort((a, b) => a - b)[Math.floor(older.length / 2)];
    const hot = week.map((p) => ({ p, s: score(p) })).sort((a, b) => b.s - a.s)[0];
    if (baseline > 0 && hot.s >= baseline * 2) {
      items.push({
        key: 'hot', icon: 'trending_up', urgency: 2,
        label: `A recent post is doing ${(hot.s / baseline).toFixed(1)}x your usual`,
        sub: 'Worth a follow-up or a boost while it is still moving',
        onClick: () => navigate(`/post/${hot.p.id}`),
      });
    }
  }

  // 4b. Gone quiet. Clearable by doing the one thing this whole studio is for.
  if (posts.length >= 3) {
    const newest = posts
      .filter((p) => p.status !== 'scheduled')
      .map((p) => (p.createdAt?.toDate ? p.createdAt.toDate().getTime()
        : p.createdAt?.seconds ? p.createdAt.seconds * 1000 : 0))
      .filter(Boolean).sort((a, b) => b - a)[0];
    const days = newest ? Math.floor((now - newest) / 86400000) : null;
    if (days != null && days >= 14 && !scheduled.length) {
      items.push({
        key: 'quiet', icon: 'edit_note', urgency: 3,
        label: `You have not posted in ${days} days`,
        sub: 'Nothing is scheduled either',
        onClick: () => navigate('/'),
      });
    }
  }

  // 5. A published tier nobody has joined. Lowest urgency: it is a missed
  //    opportunity, not a broken thing.
  if (signals?.emptyTiers?.length) {
    const t = signals.emptyTiers[0];
    items.push({
      key: 'tier', icon: 'workspace_premium', urgency: 4,
      label: signals.emptyTiers.length === 1
        ? `"${t.name}" has no members yet`
        : `${signals.emptyTiers.length} membership tiers have no members`,
      sub: 'Your other tiers have members, so the offer works. Try repricing or changing the perks',
      onClick: () => navigate('/creator/membership'),
    });
  }

  return items.sort((a, b) => a.urgency - b.urgency).slice(0, 5);
}

function NeedsYou({ items, loading }) {
  return (
    <Panel
      title="Needs you"
      sub="Sorted by what costs you most to ignore"
    >
      {loading ? (
        // Same shape as a real row: icon square, label, sub. A plain pulsing
        // block here would resize the panel the moment data arrived.
        <RowsSkeleton rows={2} />
      ) : !items.length ? (
        // The empty state is a WIN state, never a blank panel.
        <div className="flex items-center gap-3 py-2">
          <span className="shrink-0 grid place-items-center w-9 h-9 rounded-full"
            style={{ background: 'rgba(52,211,153,0.12)' }}>
            <Icon name="check" className="text-base" style={{ color: '#34D399' }} />
          </span>
          <div className="text-sm text-text-secondary">Nothing needs you right now.</div>
        </div>
      ) : (
        <div className="grid gap-1.5">
          {items.map((s) => (
            <button key={s.key} onClick={s.onClick}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left w-full hover:bg-white/[0.04] transition-colors"
              style={{ background: 'rgba(255,255,255,0.02)' }}>
              <span className="shrink-0 grid place-items-center w-8 h-8 rounded-lg"
                style={{ background: 'rgba(240,180,50,0.10)', boxShadow: 'inset 0 0 0 1px rgba(240,180,50,0.22)' }}>
                <Icon name={s.icon} className="text-base" style={{ color: '#F5C842' }} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-text-primary">{s.label}</div>
                <div className="text-xs text-text-muted mt-0.5">{s.sub}</div>
              </div>
              <Icon name="chevron_right" className="text-text-muted shrink-0" />
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ── 3. Since you were last here ───────────────────────────────────────
 * Deltas, not absolutes. A delta is actionable; a lifetime total is trivia and
 * belongs on Earnings. All four majors lead with a short strip like this. */
/**
 * Deltas over the last 30 days against the 30 before it.
 *
 * Views, engagement and posts are computed from the creator's own posts, which
 * are already loaded, so they cost no extra read. New followers is NOT computed:
 * it needs a followers-by-date query that does not exist, and inventing it from
 * a lifetime count would print a number that looks like a delta and is not.
 */
function SnapshotStrip({ posts, followers }) {
  const now = Date.now();
  const DAY = 86400000;
  const at = (p) => {
    const t = p.createdAt;
    if (!t) return 0;
    if (t.toDate) return t.toDate().getTime();
    if (t.seconds) return t.seconds * 1000;
    return new Date(t).getTime() || 0;
  };

  const inWindow = (from, to) => posts.filter((p) => at(p) >= from && at(p) < to);
  const cur = inWindow(now - 30 * DAY, now + DAY);
  const prev = inWindow(now - 60 * DAY, now - 30 * DAY);

  const views = (rows) => rows.reduce((s, p) => s + (p.viewCount || 0), 0);
  const eng = (rows) => rows.reduce((s, p) => s + (p.likeCount || 0) + (p.commentCount || 0), 0);
  const engRate = (rows) => {
    const v = views(rows);
    return v > 0 ? (eng(rows) / v) * 100 : null;
  };

  const delta = (a, b) => {
    if (b == null || a == null || b === 0) return null;
    return ((a - b) / b) * 100;
  };

  const cells = [
    { label: 'New followers',
      value: followers ? followers.last30 : null,
      change: followers ? delta(followers.last30, followers.prev30) : null,
      tone: '#B44FFF',
      unwired: !followers },
    { label: 'Views',      value: views(cur), change: delta(views(cur), views(prev)), tone: '#F5C842' },
    { label: 'Engagement', value: engRate(cur), suffix: '%', decimals: 1,
      change: delta(engRate(cur), engRate(prev)), tone: '#F472B6' },
    { label: 'Posts',      value: cur.length, change: delta(cur.length, prev.length), tone: '#34D399' },
  ];

  // An account with no activity should not be shown four zeros and a pair of
  // negative percentages. "-100% vs previous 30 days" on an empty account is
  // technically true and completely demoralising, and it is the first thing a
  // new creator sees. Below a floor of real activity the strip says so once.
  const totalActivity = views(cur) + views(prev) + cur.length + prev.length
    + (followers ? followers.last30 + followers.prev30 : 0);
  const tooQuiet = totalActivity < 3;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cells.map((c) => (
        <div key={c.label} className="vg-wash rounded-[11px] p-4"
          style={{ '--vg-accent': `${c.tone}55`, '--vg-wash': `${c.tone}14` }}>
          <div className="relative z-[2]">
            <div className="text-[10px] uppercase tracking-wider text-text-muted">{c.label}</div>
            <div className={`${NUM} text-2xl text-text-primary mt-1 leading-none`}>
              {c.value == null ? '—'
                : c.decimals ? c.value.toFixed(c.decimals) + (c.suffix || '')
                  : c.value.toLocaleString() + (c.suffix || '')}
            </div>
            <div className="text-[10px] mt-2 min-h-[13px]" style={{ color: c.tone }}>
              {c.unwired ? <Stub />
                : tooQuiet ? <span className="text-text-muted">nothing to compare yet</span>
                  : c.change == null ? <span className="text-text-muted">first period</span>
                    : c.change === 0 ? <span className="text-text-muted">no change</span>
                      : `${c.change > 0 ? '+' : ''}${c.change.toFixed(0)}% vs previous 30 days`}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── 4. Your last post ─────────────────────────────────────────────────
 * Straight from YouTube Studio: the value is comparing a post to the creator's
 * OWN median, not to zero. Needs ~5 posts of history or it prints a misleading
 * multiple, so under that it must say so. */
function LastPost({ post, median }) {
  if (!post) {
    return <Panel title="Your last post" sub="How it is doing against your usual">
      <p className="text-sm text-text-muted py-6 text-center">Nothing published yet.</p>
    </Panel>;
  }
  const eng = (post.likeCount || 0) + (post.commentCount || 0);
  const ratio = median > 0 ? eng / median : null;
  return (
    <Panel title="Your last post" sub="Against your own typical performance">
      <div className="flex items-center gap-3">
        {post.mediaUrls?.[0]
          ? <img src={post.mediaUrls[0]} alt="" className="w-14 h-14 rounded-xl object-cover shrink-0" />
          : <div className="w-14 h-14 rounded-xl shrink-0 grid place-items-center" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <Icon name="article" className="text-text-muted" />
            </div>}
        <div className="min-w-0 flex-1">
          <div className="text-sm text-text-primary truncate">{post.text || post.title || 'Untitled'}</div>
          <div className="text-xs text-text-muted mt-0.5 font-dmmono tabular-nums">
            {post.viewCount || 0} views · {post.likeCount || 0} likes · {post.commentCount || 0} comments
          </div>
        </div>
        <div className="text-right shrink-0">
          {/* "your usual" only makes sense under a multiple. Rendering it under
              "Not enough history yet" produced a dangling fragment. */}
          {ratio == null ? (
            <span className="text-[11px] text-text-muted">Needs 5 posts to compare</span>
          ) : (
            <>
              <span className={`${NUM} text-lg`} style={ratio >= 1 ? GOLD_TEXT : { color: '#9CA3AF' }}>
                {ratio.toFixed(1)}x
              </span>
              <div className="text-[10px] text-text-muted">your usual</div>
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}

/* ── 5. Next payout ────────────────────────────────────────────────────
 * ONE line. Lifetime totals, the tier ladder and statements live on Earnings;
 * duplicating them here is how three numbers ended up disagreeing with each
 * other on the old dashboard. */

const usdShort = (micro) => `$${((Number(micro) || 0) / 1e6).toLocaleString(undefined, {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})}`;

/** Mirrors cadenceDueToday() in functions/creatorPayouts.js. Display only. */
function nextPayoutDate(cadence, from = new Date()) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 1);
  for (let i = 0; i < 400; i++) {
    const dom = d.getUTCDate();
    if (cadence === 'standard' && dom === 1) return new Date(d);
    if (cadence === 'established' && (dom === 1 || dom === 15)) return new Date(d);
    if (cadence === 'priority' && d.getUTCDay() === 1) return new Date(d);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return null;
}

function NextPayoutLine({ account, loading, navigate }) {
  let body;
  if (loading) {
    body = <span className="text-sm text-text-muted">Checking...</span>;
  } else if (!account?.enrolled) {
    body = <span className="text-sm text-text-secondary">Set up payouts to receive what you earn</span>;
  } else if (account.blockedBy && account.blockedBy !== 'below_minimum') {
    // The blocker already has its own row in Needs You, so this stays terse
    // rather than repeating the instruction twice on one screen.
    body = <span className="text-sm" style={{ color: '#F5C842' }}>
      {usdShort(account.availableMicroUsd)} waiting, held until setup is finished
    </span>;
  } else if (account.blockedBy === 'below_minimum') {
    body = <span className="text-sm text-text-secondary">
      <span className={NUM}>{usdShort(account.availableMicroUsd)}</span> so far, carries over until it reaches{' '}
      <span className={NUM}>{usdShort(account.minimumMicroUsd)}</span>
    </span>;
  } else {
    const d = nextPayoutDate(account.cadence || 'standard');
    body = <span className="text-sm text-text-secondary">
      <span className={NUM} style={GOLD_TEXT}>{usdShort(account.availableMicroUsd)}</span>
      {' '}on {d ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' }) : 'your next run'}
    </span>;
  }

  return (
    <Panel title="Next payout" sub="Your revenue share, on your schedule">
      <button onClick={() => navigate('/creator/earnings')}
        className="w-full flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-left hover:bg-white/[0.04] transition-colors"
        style={{ background: 'rgba(255,255,255,0.02)' }}>
        {body}
        <Icon name="chevron_right" className="text-text-muted shrink-0" />
      </button>
    </Panel>
  );
}

/* ── 6. What to do next ────────────────────────────────────────────────
 * YouTube's "Ideas for you". ONE suggestion, citing a real number from this
 * creator's own data, and one button. If it cannot cite a number it renders
 * NOTHING rather than generic filler, which is the whole point: advice that
 * could apply to anyone teaches a creator to skip the block. */
function buildSuggestion(posts) {
  if (posts.length < 5) return null;

  const byType = {};
  for (const p of posts) {
    const t = p.type || 'text';
    const e = (p.likeCount || 0) + (p.commentCount || 0);
    (byType[t] = byType[t] || { type: t, total: 0, n: 0 }).total += e;
    byType[t].n++;
  }
  // At least two posts of a format before its average means anything: one
  // lucky post would otherwise generate confident nonsense.
  const formats = Object.values(byType)
    .filter((f) => f.n >= 2)
    .map((f) => ({ ...f, avg: f.total / f.n }))
    .sort((a, b) => b.avg - a.avg);

  if (formats.length < 2) return null;
  const best = formats[0];
  const rest = formats.slice(1);
  const restAvg = rest.reduce((s, f) => s + f.total, 0) / rest.reduce((s, f) => s + f.n, 0);
  if (!(restAvg > 0) || !(best.avg > restAvg)) return null;

  const multiple = best.avg / restAvg;
  if (multiple < 1.3) return null; // not a real difference, do not manufacture one

  const monthAgo = Date.now() - 30 * 86400000;
  const recentOfBest = posts.filter((p) => {
    const t = p.createdAt;
    const ms = t?.toDate ? t.toDate().getTime() : t?.seconds ? t.seconds * 1000 : 0;
    return (p.type || 'text') === best.type && ms >= monthAgo;
  }).length;

  const LABEL = { clip: 'clips', short: 'shorts', photo: 'photos', text: 'text posts', article: 'articles' };
  const name = LABEL[best.type] || `${best.type} posts`;

  return {
    text: `Your ${name} get ${multiple.toFixed(1)}x the engagement of your other posts. You have posted ${recentOfBest} in the last 30 days.`,
    cta: `Create a ${best.type === 'text' ? 'post' : best.type}`,
  };
}

function WhatToDoNext({ posts, navigate }) {
  const s = buildSuggestion(posts);
  if (!s) return null; // renders nothing rather than filler
  return (
    <Panel title="What to do next" sub="Based on what is working for you">
      <div className="rounded-xl px-4 py-3 flex items-center justify-between gap-4 flex-wrap"
        style={{ background: 'rgba(255,255,255,0.02)' }}>
        <div className="text-sm text-text-secondary min-w-0 flex-1">{s.text}</div>
        <button onClick={() => navigate('/')}
          className="shrink-0 rounded-xl px-3 py-2 text-xs font-bold"
          style={{ background: 'rgba(180,79,255,0.16)', color: '#B44FFF' }}>
          {s.cta}
        </button>
      </div>
    </Panel>
  );
}

export default function CreatorHomeScreen() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const [posts, setPosts] = useState([]);
  const [account, setAccount] = useState(null);
  const [followers, setFollowers] = useState(null);
  const [signals, setSignals] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) return;
    let alive = true;
    (async () => {
      // Settled, not all: a failing payout read must not blank the posts blocks.
      const [p, a, f] = await Promise.allSettled([
        getUserPosts(currentUser.uid, 60, { includeUnpublished: true }),
        getPayoutAccount(),
        getRecentFollowerCounts(currentUser.uid),
      ]);
      if (!alive) return;
      if (p.status === 'fulfilled') setPosts(p.value || []);
      if (a.status === 'fulfilled') setAccount(a.value || null);
      // A missing composite index makes this reject. The strip then shows the
      // stub rather than a zero, because 0 new followers and 'we could not ask'
      // are different facts and must not look the same.
      if (f.status === 'fulfilled') setFollowers(f.value || null);
      // Second pass: the comment and membership signals need the posts, so they
      // run after. Kept off the critical path so the screen paints first.
      if (p.status === 'fulfilled') {
        getCreatorAttentionSignals(currentUser.uid, p.value || [])
          .then((sig) => alive && setSignals(sig))
          .catch((e) => console.error('attention signals', e));
      }
      else console.error('getRecentFollowerCounts', f.reason);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [currentUser]);

  const needsYou = buildNeedsYou(account, profile, navigate, posts, signals);

  // Median engagement, so "your usual" means something. Under 5 posts it is
  // noise and the card says so instead of printing a number.
  const engs = posts.map((p) => (p.likeCount || 0) + (p.commentCount || 0)).sort((a, b) => a - b);
  const median = engs.length >= 5 ? engs[Math.floor(engs.length / 2)] : 0;

  const name = profile?.displayName || profile?.username || 'there';

  return (
    <CreatorLayout page="home" title="Home" subtitle="What happened, and what to do next">
      <div className="max-w-[1100px] grid gap-4">

        {/* 1. Greeting + status line. Sets the tone: a to-do list, not a trophy
             cabinet. The count comes from Needs You once it is wired. */}
        <div className="vg-material vg-grain vg-beam rounded-2xl overflow-hidden relative">
          {/* Warm directional light from the upper left, the same construction
              the Earnings tier hero uses. Without it this block is the same
              flat value as every panel under it and reads as a row, not a head. */}
          <div aria-hidden className="absolute inset-0 pointer-events-none"
            style={{ background: 'radial-gradient(680px 260px at 12% -20%, rgba(240,165,0,0.13), transparent 62%)' }} />
          <div className="relative z-[1] p-6 flex items-center justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="font-syne text-[30px] leading-none font-bold" style={GOLD_TEXT}>
                Hey {name}
              </div>
              <div className="text-sm text-text-secondary mt-2">
                {loading ? 'Checking what needs you...'
                  : needsYou.length === 0
                    ? 'Nothing needs you. Here is what changed since you were last here.'
                    : `${needsYou.length} thing${needsYou.length === 1 ? '' : 's'} on your list. Here is what changed since you were last here.`}
              </div>
            </div>
            {/* 7. Quick actions. Twitch puts these first; four, never more. */}
            <div className="flex gap-2 flex-wrap">
              {[
                ['sensors', 'Go live', '/go-live', true],
                ['add', 'Create', '/'],
                ['calendar_month', 'Schedule', '/creator/schedule'],
                ['person_add', 'Invite', '/wallet/referral'],
              ].map(([icon, label, path, primary]) => (
                <button key={label} onClick={() => navigate(path)}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-colors ${
                    primary ? 'text-white' : 'text-text-secondary hover:text-text-primary'
                  }`}
                  style={primary
                    ? { background: 'rgba(240,64,96,0.16)', boxShadow: 'inset 0 0 0 1px rgba(240,64,96,0.42)' }
                    : { boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.10)' }}>
                  <Icon name={icon} className="text-sm" />{label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <NeedsYou items={needsYou} loading={loading} />

        <div>
          <div className="text-sm font-bold text-text-primary mb-2 px-1">Last 30 days</div>
          <SnapshotStrip posts={posts} followers={followers} />
        </div>

        <LastPost post={posts[0]} median={median} />

        {/* 5. Next payout. ONE line. Lifetime totals and breakdowns live on
             Earnings; duplicating them is how three numbers ended up
             disagreeing with each other. */}
        <NextPayoutLine account={account} loading={loading} navigate={navigate} />

        {/* 6. AI coach. YouTube's "Ideas for you". ONE suggestion, citing a real
             number from this creator's own data, and one button. If it cannot
             cite a number it renders nothing rather than generic filler. */}
        <WhatToDoNext posts={posts} navigate={navigate} />

        {/* The "Deliberately not on this screen" panel was removed 2026-08-14.
            It was a note to the founder about scope decisions, rendered to
            every creator as if it were product. Where things live is answered
            by the nav, not by a panel explaining the nav. */}

        {/* Where to go next. Three destinations, as a footer rather than a
            panel, so it closes the screen without competing with the to-do
            list at the top. */}
        <div className="flex flex-wrap gap-2 pt-1 pb-2">
          {[
            ['analytics', 'Analytics', '/creator/analytics'],
            ['paid', 'Earnings', '/creator/earnings'],
            ['groups', 'Audience', '/creator/audience'],
          ].map(([icon, label, path]) => (
            <button key={label} onClick={() => navigate(path)}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-text-muted hover:text-text-primary transition-colors"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.07)' }}>
              <Icon name={icon} className="text-sm" />{label}
              <Icon name="chevron_right" className="text-sm opacity-50" />
            </button>
          ))}
        </div>
      </div>
    </CreatorLayout>
  );
}
