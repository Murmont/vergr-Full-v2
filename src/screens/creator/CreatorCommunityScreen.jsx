// src/screens/creator/CreatorCommunityScreen.jsx
// Creator Studio — Community. Non-moderation: engagement stream, milestones,
// replies needed, community announcements. Moderation belongs to mod/manager roles.
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { PanelListSkeleton } from '../../components/creator/StudioSkeletons';
import { useUser } from '../../context/UserContext';
import { getTransactions } from '../../firebase/firestore';
import CreatorLayout from '../../components/creator/CreatorLayout';
import { Card, KpiCard, SectionHeader, InsightCard } from '../../components/creator/Widgets';
import { DonutChart, PALETTE, compactNum } from '../../components/creator/charts';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';

function tsMs(t) {
  if (!t) return 0;
  if (t.toDate) return t.toDate().getTime();
  if (t.seconds) return t.seconds * 1000;
  return new Date(t).getTime() || 0;
}

function relative(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export default function CreatorCommunityScreen() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (!currentUser) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const tx = await getTransactions(currentUser.uid, 200);
        if (alive) setTransactions(tx || []);
      } catch (e) { console.error(e); }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [currentUser]);

  // Derived signals
  const last30 = useMemo(() => {
    const cutoff = Date.now() - 30 * 86400000;
    return transactions.filter(t => (t.amount || 0) > 0 && tsMs(t.createdAt) >= cutoff);
  }, [transactions]);

  const uniqueContributors = useMemo(() => {
    const set = new Set();
    last30.forEach(t => set.add(t.fromUserId || t.fromUsername));
    return set.size;
  }, [last30]);

  const newContributors = useMemo(() => {
    // First-time supporters in last 30d (no prior tx before window)
    const beforeSet = new Set();
    const cutoff = Date.now() - 30 * 86400000;
    transactions.forEach(t => {
      if (tsMs(t.createdAt) < cutoff) beforeSet.add(t.fromUserId || t.fromUsername);
    });
    const newSet = new Set();
    last30.forEach(t => {
      const k = t.fromUserId || t.fromUsername;
      if (k && !beforeSet.has(k)) newSet.add(k);
    });
    return newSet.size;
  }, [transactions, last30]);

  // Milestones — derived from profile counts
  const fc = profile?.followersCount || 0;
  const milestones = [];
  [100, 500, 1_000, 5_000, 10_000, 50_000, 100_000].forEach(m => {
    if (fc >= m) milestones.push({ icon: 'emoji_events', label: `Hit ${compactNum(m)} followers`, date: '—', done: true });
  });
  const nextMilestone = [100, 500, 1_000, 5_000, 10_000, 50_000, 100_000].find(m => fc < m);
  if (nextMilestone) milestones.push({ icon: 'flag', label: `${compactNum(nextMilestone - fc)} followers to ${compactNum(nextMilestone)}`, date: 'upcoming', done: false });

  // Activity stream — mix of contributions, follows (mock), mentions (mock)
  const activity = useMemo(() => {
    const items = [];
    last30.slice(0, 8).forEach(t => items.push({
      id: `tx-${t.id}`,
      kind: 'tip',
      who: t.fromUsername || 'fan',
      avatar: t.fromAvatar,
      detail: `tipped ${compactNum(t.amount)} coins`,
      when: tsMs(t.createdAt),
    }));
    // Mock engagement items so the stream never looks empty in design
    const mocks = [
      { id: 'm1', kind: 'follow',  who: 'nova_rae',     detail: 'started following',                when: Date.now() - 2 * 60_000 },
      { id: 'm2', kind: 'comment', who: 'apex_hunter',  detail: 'commented on your Clip — "insane movement"', when: Date.now() - 9 * 60_000 },
      { id: 'm3', kind: 'mention', who: 'squadgoals',   detail: 'mentioned you in an LFG post',     when: Date.now() - 45 * 60_000 },
      { id: 'm4', kind: 'share',   who: 'kenji_vpx',    detail: 'shared your Article to 3 servers', when: Date.now() - 3 * 3_600_000 },
    ];
    return [...items, ...mocks].sort((a, b) => b.when - a.when);
  }, [last30]);

  // Replies needed — mock pending comments
  const repliesNeeded = [
    { id: 'r1', who: 'aurora_rift', avatar: null, text: 'Any chance you could post the full build loadout?', post: 'Ranked recap montage', when: Date.now() - 25 * 60_000 },
    { id: 'r2', who: 'cosmo.byte',  avatar: null, text: 'GG on the clutch last stream 🔥 when\'s the next one?', post: 'Live · Apex tourney', when: Date.now() - 2 * 3_600_000 },
    { id: 'r3', who: 'nyx_theorist', avatar: null, text: 'What sens do you play on?', post: 'Highlight clip', when: Date.now() - 4 * 3_600_000 },
  ];

  // Sentiment — positive / neutral only (toxicity is moderator territory)
  const sentiment = [
    { name: 'Positive', value: 74, color: PALETTE.emerald },
    { name: 'Neutral',  value: 21, color: PALETTE.blue },
    { name: 'Curious',  value: 5,  color: PALETTE.violet },
  ];

  const iconForKind = (k) => ({
    tip:     { name: 'paid',           color: 'text-amber-400',  bg: 'bg-amber-500/10' },
    follow:  { name: 'person_add',     color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    comment: { name: 'chat_bubble',    color: 'text-brand-violet-light', bg: 'bg-cyan-500/10' },
    mention: { name: 'alternate_email', color: 'text-brand-violet', bg: 'bg-violet-500/10' },
    share:   { name: 'share',          color: 'text-brand-pink', bg: 'bg-pink-500/10' },
  }[k] || { name: 'circle', color: 'text-text-muted', bg: 'bg-white/[0.04]' });

  return (
    <CreatorLayout page="community" title="Community" subtitle="Stay connected with your fans">
      {loading ? (
        <PanelListSkeleton count={4} />
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
            <KpiCard label="Active supporters" value={uniqueContributors} icon="favorite" iconColor="text-brand-pink" />
            <KpiCard label="New supporters" value={newContributors} icon="person_add" iconColor="text-emerald-400" deltaLabel="last 30d" />
            <KpiCard label="Replies needed" value={repliesNeeded.length} icon="mark_unread_chat_alt" iconColor="text-brand-violet-light" />
            <KpiCard label="Sentiment" value={`${sentiment[0].value}%`} icon="mood" iconColor="text-emerald-400" deltaLabel="positive" />
          </div>

          {/* Announcement composer */}
          <Card className="p-4 md:p-5 mb-6">
            <SectionHeader title="Post a community update"
              subtitle="Broadcast to everyone who follows you"
            />
            <div className="flex items-start gap-3">
              <UserAvatar src={profile?.avatar} size={40} />
              <div className="flex-1">
                <textarea
                  value={announcement}
                  onChange={(e) => setAnnouncement(e.target.value)}
                  placeholder="What's the word? Drop an update, plan a meetup, tease a stream…"
                  rows={3}
                  className="w-full bg-white/[0.03] border border-white/[0.06] rounded-xl p-3 text-sm text-white placeholder:text-text-muted focus:outline-none focus:border-brand-violet/40 resize-none"
                />
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-1 text-text-muted">
                    <button className="w-8 h-8 rounded-lg hover:bg-white/[0.05] flex items-center justify-center"><Icon name="image" size={18} /></button>
                    <button className="w-8 h-8 rounded-lg hover:bg-white/[0.05] flex items-center justify-center"><Icon name="poll" size={18} /></button>
                    <button className="w-8 h-8 rounded-lg hover:bg-white/[0.05] flex items-center justify-center"><Icon name="event" size={18} /></button>
                  </div>
                  <button
                    disabled={!announcement.trim()}
                    onClick={() => { /* wire to post creation later */ setAnnouncement(''); }}
                    className="h-9 px-4 rounded-xl bg-gradient-to-r from-brand-violet to-brand-violet text-bg-dark font-extrabold text-xs hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                    Post update
                  </button>
                </div>
              </div>
            </div>
          </Card>

          {/* Activity stream + sentiment donut */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mb-6">
            <Card className="p-4 md:p-5 xl:col-span-2">
              <SectionHeader title="Live activity" subtitle="Recent interactions with your profile" />
              <div className="space-y-1">
                {activity.map(a => {
                  const ic = iconForKind(a.kind);
                  return (
                    <div key={a.id} className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-white/[0.02] transition-colors">
                      <div className={`w-9 h-9 rounded-xl ${ic.bg} flex items-center justify-center shrink-0`}>
                        <Icon name={ic.name} size={16} filled className={ic.color} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white"><span className="font-bold">@{a.who}</span> <span className="text-text-secondary">{a.detail}</span></p>
                      </div>
                      <span className="text-[11px] text-text-muted font-dmmono tabular-nums shrink-0">{relative(a.when)}</span>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card className="p-4 md:p-5">
              <SectionHeader title="Community sentiment" subtitle="From recent comments" />
              <DonutChart data={sentiment} height={200} centerValue={`${sentiment[0].value}%`} centerLabel="positive" />
              <div className="mt-3 space-y-1">
                {sentiment.map(s => (
                  <div key={s.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: s.color }} />
                    <span className="flex-1 text-text-secondary">{s.name}</span>
                    <span className="font-dmmono font-bold text-white tabular-nums">{s.value}%</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-white/[0.05] text-[11px] text-text-muted leading-relaxed">
                Concerned about harassment or spam? Those reports go to the Moderation team — you'll be notified if something tagged to you needs attention.
              </div>
            </Card>
          </div>

          {/* Replies needed + Milestones */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-6">
            <Card className="p-4 md:p-5">
              <SectionHeader title="Replies waiting" subtitle="Comments your fans hope you'll see" />
              {repliesNeeded.length === 0 ? (
                <div className="py-8 text-center text-text-muted text-sm">You're all caught up ✨</div>
              ) : (
                <div className="space-y-2">
                  {repliesNeeded.map(r => (
                    <div key={r.id} className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                      <div className="flex items-center gap-2 mb-2">
                        <UserAvatar src={r.avatar} size={28} />
                        <p className="text-sm font-bold text-white truncate">@{r.who}</p>
                        <span className="text-[10px] text-text-muted font-dmmono tabular-nums">· {relative(r.when)}</span>
                      </div>
                      <p className="text-sm text-text-secondary leading-snug">{r.text}</p>
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/[0.04]">
                        <span className="text-[11px] text-text-muted truncate">on {r.post}</span>
                        <button className="h-7 px-3 rounded-lg bg-brand-violet/10 hover:bg-brand-violet/20 border border-brand-violet/30 text-brand-violet-light text-[11px] font-bold">
                          Reply
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-4 md:p-5">
              <SectionHeader title="Milestones" subtitle="Celebrate the wins" />
              {milestones.length === 0 ? (
                <div className="py-8 text-center text-text-muted text-sm">Keep growing — your first milestone is at 100 followers.</div>
              ) : (
                <div className="space-y-2">
                  {milestones.map((m, i) => (
                    <div key={i} className={`flex items-center gap-3 p-3 rounded-xl border ${
                      m.done ? 'bg-amber-500/5 border-amber-500/20' : 'bg-white/[0.02] border-white/[0.05]'
                    }`}>
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        m.done ? 'bg-amber-500/15' : 'bg-white/[0.04]'
                      }`}>
                        <Icon name={m.icon} size={18} filled className={m.done ? 'text-amber-400' : 'text-text-muted'} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-white">{m.label}</p>
                        <p className="text-[11px] text-text-muted uppercase tracking-widest font-bold mt-0.5">{m.done ? 'unlocked' : m.date}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Tip */}
          <InsightCard
            tone="violet"
            title="COMMUNITY TIP"
            body="Pin a welcome post for first-time visitors. Creators who pin a welcome gain 2.3× more follow conversions on average."
            cta="Create welcome post"
            onCta={() => window.dispatchEvent(new CustomEvent('vergr:open-composer'))}
            icon="campaign"
          />
        </>
      )}
    </CreatorLayout>
  );
}
