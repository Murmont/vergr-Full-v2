// Admin: News bot management.
// Global kill switch, per-run cap, per-bot pause, run-now, cleanup.
// Reads bot accounts from `users` collection where accountType == 'news_bot'.
import { useEffect, useRef, useState } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc, getCountFromServer } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase/config';
import { useUI } from '../../context/UIContext';
import Icon from '../../components/Icon';
import AdminShell, { ADMIN_COLORS } from './AdminShell';

const C = {
  ...ADMIN_COLORS,
  cardSoft: '#0d0d1a', borderSoft: '#1a1a2e', borderHard: '#2a2a3e',
  textSoft: '#c0c0d8', textVeryDim: '#5050a0',
  purple: ADMIN_COLORS.accent, purpleLight: '#9d6ef7', purpleDeep: '#6d28d9',
  green: '#22c55e', red: '#ef4444', amber: '#f59e0b',
};

export default function AdminBotsScreen() {
  const { showToast } = useUI();

  const [bots, setBots] = useState([]);
  const [cfg, setCfg] = useState({ botsPaused: false, maxPostsPerBotPerRun: 2 });
  const [running, setRunning] = useState(false);
  const [busyBot, setBusyBot] = useState(null);
  const [limitDraft, setLimitDraft] = useState(2);
  const [savingLimit, setSavingLimit] = useState(false);
  const [seoQueue, setSeoQueue] = useState(null);
  const [rewriting, setRewriting] = useState(false);
  const [drain, setDrain] = useState({ passes: 0, total: 0, note: '' });
  // Ref, not state: the drain loop reads this between passes, and a state value
  // captured in the async closure would never see the update.
  const stopDrainRef = useRef(false);

  // SEO rewrite queue size (one aggregation read on mount / after a run)
  const refreshSeoQueue = async () => {
    try {
      const agg = await getCountFromServer(query(collection(db, 'posts'), where('needsSeoRewrite', '==', true)));
      setSeoQueue(agg.data().count);
    } catch { setSeoQueue(null); }
  };
  useEffect(() => { refreshSeoQueue(); }, []);

  // Bot list, live
  useEffect(() => {
    const q = query(collection(db, 'users'), where('accountType', '==', 'news_bot'));
    const unsub = onSnapshot(q, snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (a.username || '').localeCompare(b.username || ''));
      setBots(list);
    });
    return () => unsub();
  }, []);

  // Config, live
  useEffect(() => {
    const ref = doc(db, 'app_config', 'general');
    const unsub = onSnapshot(ref, snap => {
      const data = snap.exists() ? snap.data() : {};
      setCfg({
        botsPaused: !!data.botsPaused,
        maxPostsPerBotPerRun: Number(data.maxPostsPerBotPerRun ?? 2),
      });
      setLimitDraft(Number(data.maxPostsPerBotPerRun ?? 2));
    });
    return () => unsub();
  }, []);

  const togglePaused = async () => {
    try {
      const fn = httpsCallable(functions, 'setBotsPaused');
      const res = await fn({ paused: !cfg.botsPaused });
      showToast(res.data?.paused ? 'Bots PAUSED globally' : 'Bots RESUMED', 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to update kill switch', 'error');
    }
  };

  const saveLimit = async () => {
    if (savingLimit) return;
    setSavingLimit(true);
    try {
      const fn = httpsCallable(functions, 'setBotPostLimit');
      await fn({ limit: limitDraft });
      showToast(`Per-run cap set to ${limitDraft}`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to save limit', 'error');
    } finally {
      setSavingLimit(false);
    }
  };

  const runNow = async () => {
    if (running) return;
    if (cfg.botsPaused) { showToast('Resume bots first', 'error'); return; }
    setRunning(true);
    try {
      const fn = httpsCallable(functions, 'runBotSyncNow');
      const res = await fn({});
      if (res.data?.ok) {
        const created = res.data.totalCreated || 0;
        showToast(`Sync complete: ${created} new posts`, 'success');
        // The new posts land queued (needsSeoRewrite), so show the real number
        // rather than the stale mount-time count.
        await refreshSeoQueue();
        setRunning(false);
        // A syndicated post with no rewrite is served noindex, so every minute
        // it sits unrewritten is a post Google can't index. Drain immediately
        // instead of waiting for tomorrow's cronDaily pass.
        if (created > 0) runSeoRewrites();
        return;
      }
      showToast(res.data?.reason || 'Sync skipped', 'info');
    } catch (err) {
      console.error(err);
      showToast('Sync failed', 'error');
    } finally {
      setRunning(false);
    }
  };

  // Drain the whole queue, not one 100-post pass.
  //
  // The callable is capped at 540s (~100 posts paced to Gemini's rate limit), so
  // a full backlog can't be done server-side in one shot. Instead we CHAIN passes
  // from here until the queue is empty or Gemini's daily bucket is spent. That
  // keeps it to the existing callable — no Cloud Tasks queue and no new Scheduler
  // job, both of which are the GCP line items we've been cutting.
  //
  // Requirement: this tab must stay open while it runs (it's the loop driver).
  // Closing it just stops the chain; every completed pass is already saved, and
  // the queue keeps whatever is left, so a later run resumes with no double work.
  const runSeoRewrites = async () => {
    if (rewriting) return;
    stopDrainRef.current = false;
    setRewriting(true);
    setDrain({ passes: 0, total: 0, note: 'Starting…' });

    let total = 0;
    let passes = 0;
    let note = '';
    let tone = 'success';

    try {
      const fn = httpsCallable(functions, 'adminRewriteNewsSeo', { timeout: 540000 });

      for (;;) {
        if (stopDrainRef.current) { note = `Stopped by you after ${total}.`; break; }

        setDrain({ passes, total, note: `Pass ${passes + 1} running (up to 100, ~7 min)…` });
        const res = await fn({});
        const { rewritten = 0, failed = 0, remaining, stopped, empty, paused } = res.data || {};

        total += rewritten;
        passes += 1;
        if (typeof remaining === 'number') setSeoQueue(remaining);
        setDrain({ passes, total, note: `Pass ${passes} done: +${rewritten}. ${remaining ?? '?'} left.` });

        if (paused) { note = `Paused via kill switch after ${total}.`; tone = 'error'; break; }
        if (empty || remaining === 0) { note = `Done. Rewrote ${total} across ${passes} pass(es). Queue empty.`; break; }

        // `stopped` is two different things. A time-budget stop is the callable
        // bowing out at its 540s cap — that's normal mid-drain, so continue.
        // Anything else (notably a 429 once BOTH models are spent) means today's
        // free-tier quota is gone and another pass would just burn minutes.
        if (stopped) {
          if (!/time budget/i.test(String(stopped))) {
            note = /429/.test(String(stopped))
              ? `Gemini's daily quota is spent. Rewrote ${total}; ${remaining ?? '?'} left for tomorrow.`
              : `Stopped after ${total}: ${String(stopped).slice(0, 120)}`;
            tone = 'error';
            break;
          }
        }

        // Safety valve: a pass that neither rewrote nor failed anything made no
        // progress, so looping again would spin hot against the callable.
        if (rewritten === 0 && failed === 0) {
          note = `No progress on pass ${passes} — stopping. ${remaining ?? '?'} still queued.`;
          tone = 'error';
          break;
        }
      }
    } catch (err) {
      console.error(err);
      note = total
        ? `Run failed after ${total} rewritten — the finished ones are saved.`
        : 'SEO rewrite run failed';
      tone = 'error';
      refreshSeoQueue();
    } finally {
      setRewriting(false);
      setDrain(d => ({ ...d, note }));
      showToast(note, tone);
    }
  };

  const togglePerBot = async (bot) => {
    if (busyBot) return;
    setBusyBot(bot.id);
    try {
      await updateDoc(doc(db, 'users', bot.id), { botPaused: !bot.botPaused });
      showToast(`${bot.username} ${!bot.botPaused ? 'paused' : 'resumed'}`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to update bot', 'error');
    } finally {
      setBusyBot(null);
    }
  };

  const cleanupBot = async (bot) => {
    if (busyBot) return;
    const n = Number(prompt(`Delete how many of the most recent posts from ${bot.username}?`, '10'));
    if (!n || n < 1) return;
    if (!confirm(`Delete ${n} most recent posts from ${bot.username}?`)) return;
    setBusyBot(bot.id);
    try {
      const fn = httpsCallable(functions, 'deleteBotPosts');
      const res = await fn({ botId: bot.id, count: n });
      showToast(`Deleted ${res.data?.deleted || 0} posts`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Cleanup failed', 'error');
    } finally {
      setBusyBot(null);
    }
  };

  const totalBots = bots.length;
  const pausedBots = bots.filter(b => b.botPaused).length;
  const totalPosts = bots.reduce((s, b) => s + (b.postCount || 0), 0);

  return (
    <AdminShell
      screen="bots"
      title="News Bots"
      subtitle="Manage the news-bot accounts that auto-post RSS-sourced content to the platform."
    >
      <>
        {/* HERO: kill switch */}
        <div style={{
          background: cfg.botsPaused
            ? 'linear-gradient(135deg,rgba(239,68,68,0.12),rgba(185,28,28,0.04))'
            : 'linear-gradient(135deg,rgba(34,197,94,0.10),rgba(16,128,64,0.04))',
          border: `1px solid ${cfg.botsPaused ? 'rgba(239,68,68,0.4)' : 'rgba(34,197,94,0.3)'}`,
          borderRadius: 12, padding: 20,
          display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap',
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: cfg.botsPaused ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)',
            border: `1px solid ${cfg.botsPaused ? 'rgba(239,68,68,0.40)' : 'rgba(34,197,94,0.30)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Icon name={cfg.botsPaused ? 'pause_circle' : 'play_circle'} size={28} className={cfg.botsPaused ? 'text-red-500' : 'text-green-500'} />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: C.textVeryDim, textTransform: 'uppercase' }}>
              Global kill switch
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2, color: cfg.botsPaused ? C.red : C.green }}>
              {cfg.botsPaused ? 'Bots are PAUSED' : 'Bots are ACTIVE'}
            </div>
            <div style={{ fontSize: 12, color: C.textDim, marginTop: 4 }}>
              {cfg.botsPaused
                ? 'Scheduled cron + manual sync are blocked. No new bot posts will be created.'
                : 'Bots will run on the daily cron (06:00 UTC). Toggle off to stop posting now.'}
            </div>
          </div>
          <button
            type="button"
            onClick={togglePaused}
            style={{
              background: cfg.botsPaused ? `linear-gradient(135deg,${C.green},#16a34a)` : `linear-gradient(135deg,${C.red},#b91c1c)`,
              color: '#fff', border: 'none', borderRadius: 10,
              padding: '12px 22px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            <Icon name={cfg.botsPaused ? 'play_arrow' : 'pause'} size={16} />
            {cfg.botsPaused ? 'Resume bots' : 'Pause all bots'}
          </button>
        </div>

        {/* Stats + controls */}
        <div style={{
          display: 'grid', gap: 12, marginBottom: 16,
          gridTemplateColumns: 'repeat(4, 1fr)',
        }}>
          <Stat label="Bots" value={totalBots} />
          <Stat label="Paused" value={pausedBots} valueColor={pausedBots > 0 ? C.red : undefined} />
          <Stat label="Total posts" value={totalPosts.toLocaleString()} />
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 10, color: C.textVeryDim, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
              Posts per bot per run
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="number"
                min={0}
                max={20}
                value={limitDraft}
                onChange={e => setLimitDraft(Math.max(0, Math.min(20, Number(e.target.value))))}
                style={{
                  flex: 1, background: C.cardSoft, border: `1px solid ${C.borderHard}`,
                  borderRadius: 8, padding: '8px 10px', fontSize: 14, color: C.text, outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={saveLimit}
                disabled={savingLimit || limitDraft === cfg.maxPostsPerBotPerRun}
                style={{
                  background: limitDraft === cfg.maxPostsPerBotPerRun ? C.borderHard : `linear-gradient(135deg,${C.purple},${C.purpleDeep})`,
                  color: '#fff', border: 'none', borderRadius: 8,
                  padding: '8px 14px', fontSize: 12, fontWeight: 700,
                  cursor: limitDraft === cfg.maxPostsPerBotPerRun ? 'default' : 'pointer',
                  opacity: savingLimit ? 0.6 : 1,
                }}
              >Save</button>
            </div>
          </div>
        </div>

        {/* Run now */}
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
          padding: 16, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Run sync now</div>
            <div style={{ fontSize: 12, color: C.textDim, marginTop: 2 }}>
              Triggers an immediate RSS pull. Honors the kill switch + per-bot pause + per-run cap.
            </div>
          </div>
          <button
            type="button"
            onClick={runNow}
            disabled={running || cfg.botsPaused}
            style={{
              background: cfg.botsPaused ? C.borderHard : `linear-gradient(135deg,${C.purple},${C.purpleDeep})`,
              color: '#fff', border: 'none', borderRadius: 8,
              padding: '10px 18px', fontSize: 13, fontWeight: 700,
              cursor: cfg.botsPaused ? 'not-allowed' : (running ? 'wait' : 'pointer'),
              display: 'flex', alignItems: 'center', gap: 8,
              opacity: running ? 0.6 : 1,
            }}
          >
            <Icon name="play_arrow" size={14} />
            {running ? 'Running…' : 'Run now'}
          </button>
        </div>

        {/* SEO rewrites */}
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
          padding: 16, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              Run SEO rewrites
              {seoQueue !== null && (
                <span style={{
                  fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 999,
                  background: seoQueue > 0 ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.15)',
                  border: `1px solid ${seoQueue > 0 ? 'rgba(245,158,11,0.4)' : 'rgba(34,197,94,0.3)'}`,
                  color: seoQueue > 0 ? C.amber : C.green,
                }}>{seoQueue > 0 ? `${seoQueue.toLocaleString()} queued` : 'queue empty'}</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: C.textDim, marginTop: 2 }}>
              Gemini writes an original article for each queued bot post so Google can index it
              (verbatim RSS copies get rejected as duplicates). Keeps going until the queue is empty
              or Gemini's daily free quota runs out (roughly 500/day), so you can start it and leave it.
              Also runs automatically after the daily bot sync.
            </div>
            {rewriting && (
              <div style={{ fontSize: 12, color: C.amber, marginTop: 6, fontWeight: 600 }}>
                {drain.note} · {drain.total} rewritten this run
                <span style={{ color: C.textVeryDim, fontWeight: 500 }}> · keep this tab open</span>
              </div>
            )}
            {!rewriting && drain.note && (
              <div style={{ fontSize: 12, color: C.textSoft, marginTop: 6 }}>{drain.note}</div>
            )}
          </div>
          {rewriting && (
            <button
              type="button"
              onClick={() => { stopDrainRef.current = true; }}
              style={{
                background: 'transparent', color: C.textSoft,
                border: `1px solid ${C.borderHard}`, borderRadius: 8,
                padding: '10px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Stop after this pass
            </button>
          )}
          <button
            type="button"
            onClick={runSeoRewrites}
            disabled={rewriting || seoQueue === 0}
            style={{
              background: seoQueue === 0 ? C.borderHard : `linear-gradient(135deg,${C.purple},${C.purpleDeep})`,
              color: '#fff', border: 'none', borderRadius: 8,
              padding: '10px 18px', fontSize: 13, fontWeight: 700,
              cursor: seoQueue === 0 ? 'default' : (rewriting ? 'wait' : 'pointer'),
              display: 'flex', alignItems: 'center', gap: 8,
              opacity: rewriting ? 0.6 : 1,
            }}
          >
            <Icon name="auto_fix_high" size={14} />
            {rewriting ? `Rewriting… (${drain.total})` : 'Run rewrites'}
          </button>
        </div>

        {/* Bot list */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{
            padding: '12px 16px', borderBottom: `1px solid ${C.border}`,
            fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: C.textVeryDim, textTransform: 'uppercase',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span>Bot accounts</span>
            <span>{bots.length}</span>
          </div>
          {bots.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: C.textDim, fontSize: 13 }}>
              No bot accounts found yet. The first cron run creates them.
            </div>
          ) : bots.map(bot => (
            <div key={bot.id} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
              borderBottom: `1px solid ${C.borderSoft}`, flexWrap: 'wrap',
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: 'linear-gradient(135deg,#3d1f7a,#7c3aed)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 800, color: '#fff', flexShrink: 0,
              }}>{(bot.displayName || bot.username || '?')[0]?.toUpperCase()}</div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{bot.displayName || bot.username}</div>
                <div style={{ fontSize: 11, color: C.textVeryDim }}>@{bot.username} · {(bot.postCount || 0).toLocaleString()} posts</div>
              </div>
              <div style={{
                fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                background: bot.botPaused ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)',
                color: bot.botPaused ? C.red : C.green,
                border: `1px solid ${bot.botPaused ? 'rgba(239,68,68,0.30)' : 'rgba(34,197,94,0.30)'}`,
              }}>
                {bot.botPaused ? 'PAUSED' : 'ACTIVE'}
              </div>
              <button
                type="button"
                disabled={busyBot === bot.id}
                onClick={() => togglePerBot(bot)}
                style={{
                  background: 'transparent', border: `1px solid ${C.borderHard}`, borderRadius: 8,
                  color: C.textSoft, fontSize: 12, padding: '6px 12px', cursor: 'pointer',
                  opacity: busyBot === bot.id ? 0.5 : 1,
                }}
              >
                {bot.botPaused ? 'Resume' : 'Pause'}
              </button>
              <button
                type="button"
                disabled={busyBot === bot.id}
                onClick={() => cleanupBot(bot)}
                style={{
                  background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)',
                  color: C.red, fontSize: 12, padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 4,
                  opacity: busyBot === bot.id ? 0.5 : 1,
                }}
              >
                <Icon name="delete" size={12} /> Cleanup
              </button>
            </div>
          ))}
        </div>
      </>
    </AdminShell>
  );
}

function Stat({ label, value, valueColor }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
      <div style={{ fontSize: 10, color: C.textVeryDim, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: valueColor || C.text, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  );
}
