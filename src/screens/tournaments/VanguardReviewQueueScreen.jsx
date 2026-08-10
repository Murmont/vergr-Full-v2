// VanguardReviewQueueScreen — single mod queue surface for everything that
// requires Vanguard attention. 3 tabs:
//   1. AI Review        — tournament_review_queue (AI cheat-flag VOD passes)
//   2. Anti-cheat       — anti_cheat_alerts (process-scan red/orange flags)
//   3. Replay Requests  — replay_review_requests (player-flagged moments)
//
// Each item opens a focused review pane (right column on desktop, modal on
// mobile) with the relevant evidence (cheat flags, scan details, VOD link).
// Actions: confirm, clear, escalate.
//
// Route: /vanguard/queue

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db } from '../../firebase/config';
import { functions } from '../../firebase/config';
import { useUI } from '../../context/UIContext';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';

const resolveQueueItemFn = httpsCallable(functions, 'vanguardResolveQueueItem');

const C = {
  bg: '#0B0B14', surface: '#14141F', soft: '#1A1A2A',
  border: 'rgba(255,255,255,0.10)',
  text: '#fff', dim: 'rgba(255,255,255,0.65)', mute: 'rgba(255,255,255,0.45)',
  cyan: '#B44FFF', amber: '#f59e0b', red: '#ef4444', green: '#22c55e', violet: '#7B6FFF',
};

const TABS = [
  { key: 'ai', label: 'AI Review', icon: 'smart_toy', color: C.violet },
  { key: 'ac', label: 'Anti-Cheat', icon: 'shield', color: C.red },
  { key: 'rp', label: 'Replay Requests', icon: 'replay', color: C.amber },
];

export default function VanguardReviewQueueScreen() {
  const { showToast } = useUI();
  const navigate = useNavigate();
  const [tab, setTab] = useState('ai');
  const [aiItems, setAiItems] = useState([]);
  const [acItems, setAcItems] = useState([]);
  const [rpItems, setRpItems] = useState([]);
  const [focused, setFocused] = useState(null);

  useEffect(() => {
    const unsubs = [];
    unsubs.push(onSnapshot(
      query(collection(db, 'tournament_review_queue'),
        where('status', '==', 'pending'), orderBy('createdAt', 'desc'), limit(50)),
      (s) => setAiItems(s.docs.map((d) => ({ id: d.id, kind: 'ai', ...d.data() })))));
    unsubs.push(onSnapshot(
      query(collection(db, 'anti_cheat_alerts'),
        where('status', '==', 'pending'), orderBy('createdAt', 'desc'), limit(50)),
      (s) => setAcItems(s.docs.map((d) => ({ id: d.id, kind: 'ac', ...d.data() })))));
    unsubs.push(onSnapshot(
      query(collection(db, 'replay_review_requests'),
        where('status', '==', 'pending'), orderBy('createdAt', 'desc'), limit(50)),
      (s) => setRpItems(s.docs.map((d) => ({ id: d.id, kind: 'rp', ...d.data() })))));
    return () => unsubs.forEach((u) => u());
  }, []);

  const items = useMemo(() => {
    return tab === 'ai' ? aiItems : tab === 'ac' ? acItems : rpItems;
  }, [tab, aiItems, acItems, rpItems]);

  const resolve = async (item, action) => {
    // action arrives as 'confirmed' | 'cleared' from the old buttons — normalise
    // to the callable's contract ('confirm' | 'clear').
    const verb = action === 'confirmed' || action === 'confirm' ? 'confirm' : 'clear';
    try {
      const res = await resolveQueueItemFn({ kind: item.kind, itemId: item.id, action: verb });
      const consequences = res?.data?.consequences || [];
      const summary = consequences.length
        ? `${verb === 'confirm' ? 'Confirmed' : 'Cleared'} — ${consequences.join(', ')}`
        : `Marked ${verb}ed`;
      showToast(summary, verb === 'confirm' ? 'success' : 'info');
      if (focused?.id === item.id) setFocused(null);
    } catch (err) {
      showToast(err?.message || 'Resolve failed', 'error');
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text }}>
      <TopBar showBack title="Vanguard Review Queue" />
      <div style={{ display: 'flex', gap: 6, padding: 12, borderBottom: `1px solid ${C.border}` }}>
        {TABS.map((t) => {
          const counts = { ai: aiItems.length, ac: acItems.length, rp: rpItems.length };
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              flex: 1, padding: '10px 12px', borderRadius: 10,
              background: active ? `${t.color}22` : 'transparent',
              border: `1px solid ${active ? t.color : C.border}`,
              color: active ? t.color : C.text,
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center',
            }}>
              <Icon name={t.icon} size={16} className="" />
              <span>{t.label}</span>
              <span style={{
                padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 900,
                background: counts[t.key] > 0 ? t.color : C.soft,
                color: counts[t.key] > 0 ? '#000' : C.mute,
              }}>{counts[t.key]}</span>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: focused ? '1fr 1fr' : '1fr', gap: 0 }}>
        <div style={{ padding: 12, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto' }}>
          {items.length === 0 && (
            <div style={{ padding: 40, color: C.dim, textAlign: 'center' }}>
              Nothing pending — good work.
            </div>
          )}
          {items.map((it) => (
            <QueueItem key={it.id} item={it}
              active={focused?.id === it.id}
              onClick={() => setFocused(it)}
              onResolve={(action) => resolve(it, action)}
              onOpenMatch={() => navigate(`/tournaments/${it.tournamentId}/match/${it.matchId}`)}
            />
          ))}
        </div>

        {focused && (
          <div style={{
            padding: 14, borderLeft: `1px solid ${C.border}`,
            maxHeight: 'calc(100vh - 120px)', overflowY: 'auto',
          }}>
            <FocusedDetail item={focused} onResolve={(action) => resolve(focused, action)}
              onOpenMatch={() => navigate(`/tournaments/${focused.tournamentId}/match/${focused.matchId}`)} />
          </div>
        )}
      </div>
    </div>
  );
}

function QueueItem({ item, active, onClick, onResolve, onOpenMatch }) {
  const accent = item.kind === 'ai' ? C.violet : item.kind === 'ac' ? C.red : C.amber;
  const title = item.kind === 'ai' ? `AI flag · ${item.severity || 'unknown'}`
              : item.kind === 'ac' ? `Anti-cheat · ${item.severity}`
              : `Replay · ${Math.floor((item.timestampSec || 0) / 60)}m${Math.floor((item.timestampSec || 0) % 60)}s`;
  const desc = item.kind === 'ai' ? (item.flags || []).map((f) => f.type).join(', ')
             : item.kind === 'ac' ? (item.red?.length ? `${item.red.length} red` : '') + ' ' + (item.orange?.length ? `${item.orange.length} orange` : '')
             : (item.reason || '—');
  return (
    <div onClick={onClick} style={{
      padding: 12, marginBottom: 8, borderRadius: 10, cursor: 'pointer',
      background: active ? `${accent}11` : C.surface,
      border: `1px solid ${active ? accent : C.border}`,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <div style={{ width: 8, height: 8, borderRadius: 4, background: accent, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{title}</div>
        <div style={{ fontSize: 11, color: C.dim, marginTop: 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {desc}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button onClick={(e) => { e.stopPropagation(); onResolve('confirmed'); }} style={pillBtn(C.red)}>
          <Icon name="check" size={12} className="" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onResolve('cleared'); }} style={pillBtn(C.green)}>
          <Icon name="close" size={12} className="" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onOpenMatch(); }} style={pillBtn(C.cyan)}>
          <Icon name="open_in_new" size={12} className="" />
        </button>
      </div>
    </div>
  );
}

function FocusedDetail({ item, onResolve, onOpenMatch }) {
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 900, color: C.text, marginBottom: 4 }}>
        {item.kind === 'ai' ? 'AI VOD Review' : item.kind === 'ac' ? 'Anti-Cheat Alert' : 'Replay Request'}
      </div>
      <div style={{ fontSize: 11, color: C.mute, fontFamily: 'DM Mono, monospace', marginBottom: 12 }}>
        {item.tournamentId?.slice(0, 8)} · {item.matchId?.slice(0, 8)}
      </div>

      {item.kind === 'ai' && (
        <>
          <Section label="Severity"><strong style={{ color: C.violet }}>{item.severity}</strong></Section>
          <Section label="Flags">
            {(item.flags || []).map((f, i) => {
              const clipPath = item.tournamentId && item.matchId
                ? `/clips/cheat-flag/${item.tournamentId}/${item.matchId}/${i}`
                : null;
              return (
                <div key={i} style={{
                  marginBottom: 6, fontSize: 12,
                  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                }}>
                  <span style={{ color: C.red, fontWeight: 800 }}>{f.type}</span>
                  <span style={{ color: C.dim }}> @ {f.tSec}s — sev {f.severity}/5 — {f.note}</span>
                  {clipPath && (
                    <>
                      <a href={`#${clipPath}`} style={clipLinkStyle(C.cyan)}>
                        Watch
                      </a>
                      <button
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(`${window.location.origin}/#${clipPath}`);
                          } catch {}
                        }}
                        style={clipLinkStyle(C.violet)}
                      >
                        Copy share
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </Section>
        </>
      )}

      {item.kind === 'ac' && (
        <>
          <Section label="Player"><span style={{ fontFamily: 'DM Mono, monospace' }}>{item.uid}</span></Section>
          <Section label="Severity"><strong style={{ color: item.severity === 'red' ? C.red : C.amber }}>{item.severity}</strong></Section>
          {(item.red?.length > 0) && (
            <Section label="Red flags">
              {item.red.map((f, i) => (
                <div key={i} style={{ fontSize: 11, color: C.red, fontFamily: 'DM Mono, monospace' }}>
                  {f.proc} · {f.sig} · pid {f.pid}
                </div>
              ))}
            </Section>
          )}
          {(item.orange?.length > 0) && (
            <Section label="Orange flags">
              {item.orange.map((f, i) => (
                <div key={i} style={{ fontSize: 11, color: C.amber, fontFamily: 'DM Mono, monospace' }}>
                  {f.proc} · {f.sig}
                </div>
              ))}
            </Section>
          )}
        </>
      )}

      {item.kind === 'rp' && (
        <>
          <Section label="Requester"><span style={{ fontFamily: 'DM Mono, monospace' }}>{item.requesterUid}</span></Section>
          <Section label="Timestamp">
            <strong>{Math.floor((item.timestampSec || 0) / 60)}m{Math.floor((item.timestampSec || 0) % 60)}s</strong>
          </Section>
          <Section label="Reason"><div style={{ fontSize: 13, color: C.text }}>{item.reason || '—'}</div></Section>
        </>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={() => onResolve('confirmed')} style={ctaBtn(C.red)}>Confirm violation</button>
        <button onClick={() => onResolve('cleared')} style={ctaBtn(C.green)}>Clear</button>
        <button onClick={onOpenMatch} style={ctaBtn(C.cyan)}>Open match</button>
      </div>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: C.mute, textTransform: 'uppercase', letterSpacing: '0.12em' }}>{label}</div>
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  );
}

const pillBtn = (color) => ({
  width: 24, height: 24, borderRadius: 6, border: `1px solid ${color}66`,
  background: 'transparent', color, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
});
const ctaBtn = (color) => ({
  flex: 1, padding: '10px 12px', borderRadius: 8, border: `1px solid ${color}66`,
  background: `${color}11`, color, fontSize: 12, fontWeight: 800, cursor: 'pointer',
});
const clipLinkStyle = (color) => ({
  padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 800,
  background: color + '15', color, border: `1px solid ${color}55`,
  textDecoration: 'none', cursor: 'pointer',
  fontFamily: 'inherit',
});
