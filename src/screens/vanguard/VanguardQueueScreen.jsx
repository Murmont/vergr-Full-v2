// /vanguard/queue — the active moderation queue.
//
// Designs reviewed 2026-05-16:
//   - Vanguad queue screen.png         (default filter-sidebar layout)
//   - Vanguad queue screen option 2.png (denser, with severity left rail)
//   - Vanguad queue screen Case Detail.png (right drawer with 3-column evidence/context/decision)
//
// Combined into a single screen:
//   - Left filter sidebar (filter pills + filter chips + Save as view)
//   - Top toolbar (sort, severity, claim/escalate batch ops, search)
//   - Main list (severity dot + thumbnail + title + reporter + timing + Review CTA)
//   - Click any row → slides a Case Detail drawer in from the right
//
// Auth model: founder has full powers (no read-only). Recruits see the list
// but Review buttons are disabled with a "shadow your seniors" notice.

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import VanguardLayout, { VG_COLORS as C, VanguardPageHeader, VgCard } from '../../components/vanguard/VanguardLayout';
import Icon from '../../components/Icon';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import useResponsive from '../../hooks/useResponsive';
import { isVanguard } from '../../utils/vanguard';
import {
  getPendingReports,
  getAiFlaggedPosts,
} from '../../firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { TargetPreview, AccountActions, approveLabel, useModAuthority } from '../../components/vanguard/ModActions';
import { openInVergr } from '../../admin/openExternal';

const callCallable = (name, payload) => httpsCallable(getFunctions(undefined, 'europe-west1'), name)(payload).then(r => r.data);
// Tournament match decisions and the commander match-review lane were removed on
// 2026-09-10 (founder: the app may have nothing to do with tournaments). The queue
// is user reports and AI flags.
const vanguardResolveReport = (payload) => callCallable('vanguardResolveReport', payload);
const vanguardReviewAiFlag = (payload) => callCallable('vanguardReviewAiFlag', payload);

const tsMs = (t) => (t?.toDate ? t.toDate().getTime() : t?.seconds ? t.seconds * 1000 : (typeof t === 'number' ? t : 0));
const fmtAgo = (ms) => {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
};

// Severity classification — drives the colored left rail dot + ordering.
const severity = (row) => {
  if (row.kind === 'report') {
    return row.priority === 'critical' ? 'high' : 'mid';
  }
  return 'low';
};

const SEV_COLOR = { high: C.ember, mid: C.gold, low: C.violetLt };
const SEV_LABEL = { high: 'CRITICAL', mid: 'NORMAL', low: 'LOW' };

const KIND_ICON = {
  report: 'flag',
  ai_flag: 'smart_toy',
};

// Filter taxonomy — categories + statuses.
const CATEGORIES = [
  { key: 'all',                label: 'All',                icon: 'inbox' },
  { key: 'report',             label: 'Reports',            icon: 'flag' },
  { key: 'ai_flag',            label: 'AI Flags',           icon: 'smart_toy' },
];
const SEVERITIES = [
  { key: 'all',  label: 'All severities' },
  { key: 'high', label: 'Critical only' },
  { key: 'mid',  label: 'Normal' },
];
const SORTS = [
  { key: 'oldest', label: 'Oldest first' },
  { key: 'newest', label: 'Newest first' },
  { key: 'severity', label: 'Severity' },
];

function FilterChip({ active, label, count, icon, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px',
        background: active ? C.activeFill : 'transparent',
        border: 0,
        borderRadius: 8,
        color: active ? C.violetLt : C.textDim,
        fontFamily: 'DM Sans',
        fontSize: 12.5,
        fontWeight: active ? 700 : 500,
        cursor: 'pointer',
        width: '100%',
        textAlign: 'left',
      }}
    >
      <Icon name={icon} size={16} />
      <span style={{ flex: 1 }}>{label}</span>
      {typeof count === 'number' && (
        <span style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: active ? C.violetLt : C.textMuted }}>{count}</span>
      )}
    </button>
  );
}

function SeverityDot({ sev }) {
  const color = SEV_COLOR[sev];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: sev === 'high' ? `0 0 6px ${color}` : 'none' }} />
      <span style={{ fontFamily: 'DM Mono', fontSize: 9.5, color, textTransform: 'uppercase', letterSpacing: '.12em', fontWeight: 700 }}>{SEV_LABEL[sev]}</span>
    </div>
  );
}

// ─── Case Detail Drawer ──────────────────────────────────────────────────────
function CaseDetailDrawer({ row, onClose, onResolved }) {
  const { showToast } = useUI();
  const auth = useModAuthority();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [owner, setOwner] = useState(null);

  // Recruits read along but cannot decide (server: canApproveReject).
  const canAct = auth.canAct;

  const doReportDecision = useCallback(async (decision) => {
    if (!canAct || busy) return;
    setBusy(true);
    try {
      await vanguardResolveReport({ reportId: row.id, decision, reason: reason.trim() });
      showToast?.(decision === 'approve' ? 'Report upheld.' : decision === 'reject' ? 'Report dismissed.' : 'Escalated to a Senior or above.', 'success');
      onResolved?.();
      onClose();
    } catch (e) {
      showToast?.(e?.message || 'Failed to resolve', 'error');
    } finally {
      setBusy(false);
    }
  }, [row, reason, busy, canAct, showToast, onResolved, onClose]);

  const decisionBtn = (tone) => ({
    padding: '10px 14px', border: 0, borderRadius: 8, fontFamily: 'DM Sans', fontSize: 13, fontWeight: 700,
    cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1, color: C.text,
    background: tone === 'danger' ? C.ember : tone === 'gold' ? C.goldFill : C.card2,
  });

  return (
    <>
      {/* Backdrop (a scrim, the one place a translucent fill belongs) */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 200, animation: 'caseDrawerFade .15s ease-out' }} />
      <aside style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(960px, 95vw)', zIndex: 201,
        background: C.bg, display: 'flex', flexDirection: 'column', animation: 'caseDrawerSlide .25s ease-out',
      }}>
        <div style={{ padding: '14px 18px', background: C.card, display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onClose} style={{ background: 'transparent', border: 0, color: C.textDim, cursor: 'pointer', padding: 6, display: 'flex' }} aria-label="Back to queue">
            <Icon name="arrow_back" size={20} />
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 18, color: C.text }}>
              Case #VRGR-{(row.id || '').slice(0, 6).toUpperCase()}
            </div>
            <div style={{ fontFamily: 'DM Mono', fontSize: 11, color: C.textDim, marginTop: 2 }}>
              {row.targetType || 'user'} report · reported {fmtAgo(tsMs(row.createdAt))}
            </div>
          </div>
          <SeverityDot sev={severity(row)} />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14, alignContent: 'start' }}>
          {/* 1 · What was reported, and why */}
          <VgCard style={{ padding: 14, border: 0, display: 'grid', gap: 10, alignContent: 'start' }}>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em' }}>1 · Evidence</div>
            <div style={{ fontFamily: 'DM Sans', fontSize: 13, fontWeight: 700, color: C.text }}>{String(row.reason || 'User report').replace(/_/g, ' ')}</div>
            <div style={{ fontFamily: 'DM Sans', fontSize: 12, color: C.textDim, lineHeight: 1.5 }}>{row.details || 'No extra detail from the reporter.'}</div>
            <TargetPreview row={row} onOwner={setOwner} />
          </VgCard>

          {/* 2 · Context, and the account behind what was reported */}
          <VgCard style={{ padding: 14, border: 0, display: 'grid', gap: 8, alignContent: 'start' }}>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 2 }}>2 · Context</div>
            <div style={{ fontFamily: 'DM Sans', fontSize: 12, color: C.textDim }}>Priority: <span style={{ color: C.text }}>{row.priority === 'critical' ? 'critical' : 'normal'}</span></div>
            <div style={{ fontFamily: 'DM Sans', fontSize: 12, color: C.textDim }}>Status: <span style={{ color: C.text }}>{row.status || 'pending'}</span></div>
            {row.context?.surface && (
              <div style={{ fontFamily: 'DM Sans', fontSize: 12, color: C.textDim }}>Reported from: <span style={{ color: C.text }}>{String(row.context.surface).replace(/_/g, ' ')}</span></div>
            )}
            <div style={{ padding: 10, background: C.card2, borderRadius: 8, fontFamily: 'DM Sans', fontSize: 11.5, color: C.textDim, lineHeight: 1.5 }}>
              Unsure? Search the Decision Library for a precedent, or escalate so a Senior or above picks it up.
            </div>
            {owner && <AccountActions uid={owner} onDone={onResolved} />}
          </VgCard>

          {/* 3 · Decision */}
          <VgCard style={{ padding: 14, border: 0, alignContent: 'start' }}>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 10 }}>3 · Decision</div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for the call (kept in the audit trail)"
              rows={4}
              style={{ width: '100%', boxSizing: 'border-box', padding: 10, background: C.card2, border: 0, borderRadius: 8, color: C.text, fontFamily: 'DM Sans', fontSize: 12.5, resize: 'vertical', outline: 'none', marginBottom: 12 }}
            />
            {!canAct ? (
              <div style={{ padding: 10, background: C.card2, borderRadius: 8, color: C.textMuted, fontFamily: 'DM Sans', fontSize: 12, lineHeight: 1.5 }}>
                Recruits are read-only. Shadow your seniors until you are promoted to Vanguard.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button disabled={busy} onClick={() => doReportDecision('approve')} style={decisionBtn('danger')}>{approveLabel(row.targetType)}</button>
                <button disabled={busy} onClick={() => doReportDecision('reject')} style={decisionBtn('neutral')}>Dismiss the report</button>
                <button disabled={busy} onClick={() => doReportDecision('escalate')} style={{ ...decisionBtn('gold'), color: C.gold }}>Escalate to a Senior or above</button>
              </div>
            )}
          </VgCard>
        </div>

        <style>{`
          @keyframes caseDrawerSlide { from { transform: translateX(100%); } to { transform: translateX(0); } }
          @keyframes caseDrawerFade { from { opacity: 0; } to { opacity: 1; } }
        `}</style>
      </aside>
    </>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────
export default function VanguardQueueScreen() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { profile } = useUser();
  const { isMobile } = useResponsive();

  const [reports, setReports] = useState([]);
  const [aiFlags, setAiFlags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [openCase, setOpenCase] = useState(null);

  const [category, setCategory] = useState(searchParams.get('cat') || 'all');
  const [sev, setSev] = useState(searchParams.get('sev') || 'all');
  const [sort, setSort] = useState(searchParams.get('sort') || 'oldest');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [r, ai] = await Promise.all([
          getPendingReports(50).catch(() => []),
          getAiFlaggedPosts(50).catch(() => []),
        ]);
        if (!alive) return;
        setReports(r || []);
        setAiFlags(ai || []);
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [refreshKey]);


  // Unified rows.
  const rows = useMemo(() => {
    const rRows = reports.map((r) => ({
      ...r,
      kind: 'report',
      title: r.reason || 'User report',
      sub: `Target: ${r.targetType || 'user'} · ${r.priority === 'critical' ? 'Critical' : 'Normal'}`,
      thumb: null,
    }));
    // AI-flagged posts (Gemini verdict 'flag' → moderationStatus pending_review).
    const aiRows = aiFlags.map((p) => {
      const flagged = p.aiVerdict?.results?.find?.((x) => x.verdict === 'flag');
      return {
        kind: 'ai_flag',
        id: `ai_${p.id}`,
        post: p,
        createdAt: p.createdAt,
        title: `AI flag · ${flagged?.category || 'possible violation'}`,
        sub: (flagged?.reason || p.content || p.text || 'Flagged for human review').slice(0, 120),
        thumb: p.imageUrl || p.thumbnailUrl || (Array.isArray(p.mediaUrls) ? p.mediaUrls[0] : null),
      };
    });
    return [...rRows, ...aiRows];
  }, [reports, aiFlags]);

  const filtered = useMemo(() => {
    let out = rows;
    if (category !== 'all') out = out.filter((r) => r.kind === category);
    if (sev !== 'all') out = out.filter((r) => severity(r) === sev);
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter((r) => (r.title + ' ' + r.sub).toLowerCase().includes(q));
    }
    out = [...out].sort((a, b) => {
      if (sort === 'severity') {
        const order = { high: 0, mid: 1, low: 2 };
        return (order[severity(a)] - order[severity(b)]) || (tsMs(a.createdAt) - tsMs(b.createdAt));
      }
      const va = tsMs(a.createdAt) || 0;
      const vb = tsMs(b.createdAt) || 0;
      return sort === 'oldest' ? va - vb : vb - va;
    });
    return out;
  }, [rows, category, sev, sort, search]);

  const counts = useMemo(() => ({
    all: rows.length,
    report: rows.filter(r => r.kind === 'report').length,
    ai_flag: rows.filter(r => r.kind === 'ai_flag').length,
    high: rows.filter(r => severity(r) === 'high').length,
    mid: rows.filter(r => severity(r) === 'mid').length,
  }), [rows]);

  const updateUrl = (next) => {
    const p = new URLSearchParams(searchParams);
    Object.entries(next).forEach(([k, v]) => {
      if (v && v !== 'all') p.set(k, v); else p.delete(k);
    });
    setSearchParams(p, { replace: true });
  };

  return (
    <VanguardLayout page="queue">
      <VanguardPageHeader
        title="Queue"
        subtitle="Review and take action on reports, disputes and flags."
        right={
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            style={{
              padding: '8px 14px',
              background: 'transparent',
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              color: C.textDim,
              cursor: 'pointer',
              fontFamily: 'DM Sans',
              fontSize: 12,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Icon name="refresh" size={14} />
            Refresh
          </button>
        }
      />

      {/* 2-column: filter sidebar + main list */}
      {/* One column on a phone: the 220px filter rail plus a 200px search box ran
          the page to 499px wide on a 412px screen (measured 2026-09-16). */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(220px, 260px) minmax(0, 1fr)', gap: 14 }}>
        {/* Filter sidebar */}
        <VgCard style={{ padding: 14, alignSelf: 'flex-start' }}>
          <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 8 }}>Categories</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
            {CATEGORIES.map((c) => (
              <FilterChip
                key={c.key}
                active={category === c.key}
                label={c.label}
                count={counts[c.key]}
                icon={c.icon}
                onClick={() => { setCategory(c.key); updateUrl({ cat: c.key }); }}
              />
            ))}
          </div>

          <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 8 }}>Severity</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
            {SEVERITIES.map((s) => (
              <FilterChip
                key={s.key}
                active={sev === s.key}
                label={s.label}
                count={s.key === 'all' ? counts.all : counts[s.key]}
                icon={s.key === 'high' ? 'priority_high' : s.key === 'mid' ? 'horizontal_rule' : 'tune'}
                onClick={() => { setSev(s.key); updateUrl({ sev: s.key }); }}
              />
            ))}
          </div>

          <button
            disabled
            title="Save-as-view coming next session"
            style={{
              width: '100%',
              padding: '10px 12px',
              background: 'transparent',
              border: `1px dashed ${C.border}`,
              borderRadius: 8,
              color: C.textMuted,
              fontFamily: 'DM Sans',
              fontSize: 12,
              cursor: 'not-allowed',
              opacity: 0.7,
            }}
          >
            + Save as view
          </button>
        </VgCard>

        {/* Main list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Toolbar */}
          <VgCard style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8, flex: 1, minWidth: 200 }}>
              <Icon name="search" size={14} style={{ color: C.textMuted }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title or context..."
                style={{ background: 'transparent', border: 0, color: C.text, fontFamily: 'DM Sans', fontSize: 12.5, outline: 'none', width: '100%' }}
              />
            </div>
            <select
              value={sort}
              onChange={(e) => { setSort(e.target.value); updateUrl({ sort: e.target.value }); }}
              style={{
                padding: '8px 10px',
                background: C.card2,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                color: C.text,
                fontFamily: 'DM Sans',
                fontSize: 12.5,
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </VgCard>

          {/* Rows */}
          {loading ? (
            <VgCard style={{ textAlign: 'center', color: C.textMuted, padding: 40 }}>Loading queue…</VgCard>
          ) : filtered.length === 0 ? (
            <VgCard style={{ textAlign: 'center', padding: 40 }}>
              <Icon name="check_circle" size={36} style={{ color: C.success, marginBottom: 6 }} />
              <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 16, color: C.success }}>Queue is clear.</div>
              <div style={{ fontFamily: 'DM Sans', fontSize: 12.5, color: C.textMuted, marginTop: 4 }}>Nothing waiting on a Vanguard decision right now.</div>
            </VgCard>
          ) : (
            filtered.map((row) => {
              const sevLevel = severity(row);
              const sevColor = SEV_COLOR[sevLevel];
              return (
                <button
                  key={`${row.kind}-${row.id || row.matchId}`}
                  onClick={() => setOpenCase(row)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: 12,
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderLeft: `3px solid ${sevColor}`,
                    borderRadius: 12,
                    color: C.text,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'border-color .12s, background .12s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.borderH; e.currentTarget.style.background = C.card2; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.card; }}
                >
                  <div style={{
                    width: 44, height: 44, borderRadius: 10,
                    background: row.thumb ? `url(${row.thumb}) center/cover` : `${sevColor}22`,
                    color: sevColor,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {!row.thumb && <Icon name={KIND_ICON[row.kind] || 'inbox'} size={20} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      <SeverityDot sev={sevLevel} />
                      {/* Aging indicator (P2.2): reports must not rot silently —
                          amber past 24h, red past 72h. */}
                      {(() => {
                        const ageMs = Date.now() - (tsMs(row.createdAt) || Date.now());
                        const ageColor = ageMs > 72 * 3600e3 ? '#F04060' : ageMs > 24 * 3600e3 ? '#F5C842' : C.textMuted;
                        const stale = ageMs > 24 * 3600e3;
                        return (
                          <span style={{ fontFamily: 'DM Mono', fontSize: 10, color: ageColor, fontWeight: stale ? 700 : 400 }}>
                            {stale && <Icon name="schedule" size={10} style={{ verticalAlign: '-1px', marginRight: 3 }} />}
                            {fmtAgo(tsMs(row.createdAt))}
                          </span>
                        );
                      })()}
                    </div>
                    <div style={{ fontFamily: 'DM Sans', fontSize: 13.5, fontWeight: 700, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.title}</div>
                    <div style={{ fontFamily: 'DM Mono', fontSize: 11, color: C.textDim, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.sub}</div>
                  </div>
                  <span style={{
                    padding: '6px 14px',
                    background: C.activeFill,
                    border: 0,
                    borderRadius: 999,
                    color: C.violetLt,
                    fontFamily: 'DM Sans',
                    fontSize: 11.5,
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                  }}>Review</span>
                </button>
              );
            })
          )}

          {!loading && filtered.length > 0 && (
            <div style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: C.textMuted, textAlign: 'center', padding: '6px 0' }}>
              {filtered.length} of {rows.length} cases · Oldest items first protect against burying old disputes
            </div>
          )}
        </div>
      </div>

      {openCase && (openCase.kind === 'ai_flag' ? (
        <AiFlagDrawer
          row={openCase}
          profile={profile}
          onClose={() => setOpenCase(null)}
          onResolved={() => setRefreshKey(k => k + 1)}
        />
      ) : (
        <CaseDetailDrawer
          row={openCase}
          profile={profile}
          onClose={() => setOpenCase(null)}
          onResolved={() => setRefreshKey(k => k + 1)}
        />
      ))}
    </VanguardLayout>
  );
}

// ─── AI-flag Drawer ──────────────────────────────────────────────────────────
// Gemini flagged this post (visible, pending human review). Mod either
// CONFIRMS the violation (post hidden) or marks it CLEAN (records the AI was
// wrong — ground truth for prompt tuning).
function AiFlagDrawer({ row, profile, onClose, onResolved }) {
  const { showToast } = useUI();
  const [busy, setBusy] = useState(false);
  const p = row.post || {};
  const flagged = p.aiVerdict?.results?.filter?.((x) => x.verdict === 'flag') || [];

  const isFounder = profile?.role === 'admin';
  const isRecruit = profile?.vanguard?.rank === 'recruit';
  const canAct = isFounder || (isVanguard(profile) && !isRecruit);

  const decide = async (verdict) => {
    if (!canAct || busy) return;
    setBusy(true);
    try {
      await vanguardReviewAiFlag({ postId: p.id, verdict });
      showToast?.(verdict === 'violation' ? 'Confirmed — post hidden.' : 'Marked clean — AI verdict recorded as wrong.', 'success');
      onResolved?.();
      onClose();
    } catch (e) {
      showToast?.(e?.message || 'Failed to resolve', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 200 }} />
      <aside style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(560px, 95vw)', zIndex: 201,
        background: C.bg, display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '14px 18px', background: C.card, display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onClose} style={{ background: 'transparent', border: 0, color: C.textDim, cursor: 'pointer', padding: 6, display: 'flex' }} aria-label="Back to queue">
            <Icon name="arrow_back" size={20} />
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 18, color: C.text }}>AI Flag · {(p.id || '').slice(0, 6).toUpperCase()}</div>
            <div style={{ fontFamily: 'DM Mono', fontSize: 11, color: C.textDim, marginTop: 2 }}>Flagged {fmtAgo(tsMs(row.createdAt))} · post stays visible until you decide</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <VgCard style={{ padding: 14 }}>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 10 }}>Post content</div>
            {(p.content || p.text) && <div style={{ fontFamily: 'DM Sans', fontSize: 13.5, color: C.text, whiteSpace: 'pre-wrap', marginBottom: 10 }}>{(p.content || p.text).slice(0, 2000)}</div>}
            {row.thumb && <img src={row.thumb} alt="" style={{ maxWidth: '100%', maxHeight: 320, borderRadius: 10, border: `1px solid ${C.border}` }} />}
            <button type="button" onClick={() => openInVergr(`/post/${p.id}`)} style={{ display: 'inline-block', marginTop: 10, background: 'transparent', border: 0, padding: 0, cursor: 'pointer', color: C.violetLt, fontFamily: 'DM Sans', fontSize: 12, fontWeight: 600 }}>Open post on vergr.app ↗</button>
          </VgCard>

          <VgCard style={{ padding: 14 }}>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 10 }}>AI verdict</div>
            {flagged.length === 0 ? (
              <div style={{ fontFamily: 'DM Sans', fontSize: 12.5, color: C.textDim }}>No detail recorded.</div>
            ) : flagged.map((f, i) => (
              <div key={i} style={{ padding: 10, background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 8 }}>
                <div style={{ fontFamily: 'DM Sans', fontSize: 12.5, fontWeight: 700, color: C.gold }}>{f.category || 'uncategorised'} · {(Math.round((f.confidence || 0) * 100))}%</div>
                <div style={{ fontFamily: 'DM Sans', fontSize: 12, color: C.textDim, marginTop: 3 }}>{f.reason || '—'}{f._subject ? ` (${f._subject})` : ''}</div>
              </div>
            ))}
          </VgCard>

          {canAct && (p.userId || p.authorId) && <AccountActions uid={p.userId || p.authorId} onDone={onResolved} />}
        </div>

        <div style={{ padding: 14, background: C.card, display: 'flex', gap: 10 }}>
          <button onClick={() => decide('clean')} disabled={!canAct || busy}
            style={{ flex: 1, padding: '12px 0', background: C.card2, border: 0, borderRadius: 10, color: C.success, fontFamily: 'DM Sans', fontSize: 13, fontWeight: 700, cursor: canAct ? 'pointer' : 'not-allowed', opacity: canAct ? 1 : 0.5 }}>
            {busy ? '…' : 'Mark clean (AI wrong)'}
          </button>
          <button onClick={() => decide('violation')} disabled={!canAct || busy}
            style={{ flex: 1, padding: '12px 0', background: C.ember, border: 0, borderRadius: 10, color: C.text, fontFamily: 'DM Sans', fontSize: 13, fontWeight: 700, cursor: canAct ? 'pointer' : 'not-allowed', opacity: canAct ? 1 : 0.5 }}>
            {busy ? '…' : 'Confirm violation (hide post)'}
          </button>
        </div>
        {!canAct && <div style={{ padding: '0 14px 12px', fontFamily: 'DM Sans', fontSize: 11.5, color: C.textMuted }}>Recruits shadow their seniors — actions unlock at Vanguard rank.</div>}
      </aside>
    </>
  );
}
