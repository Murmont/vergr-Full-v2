// AdminAnnounceScreen — /admin/announce (redesigned inside AdminShell).
//
// Two tabs: Create Announcement + Announcement History.
// Wraps the existing `sendAnnouncement` callable (unchanged contract).

import { useState, useEffect } from 'react';
import { collection, query, orderBy, limit as fbLimit, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useUI } from '../../context/UIContext';
import Icon from '../../components/Icon';
import AdminShell, { ADMIN_COLORS as C } from './AdminShell';
import { call, fmtRelative, useGuardedCall, Tabs } from './_adminGuarded';

const TABS = [
  { id: 'create',  label: 'Create Announcement' },
  { id: 'history', label: 'Announcement History' },
];

const TYPES = [
  { id: 'system', label: 'Notification', desc: 'In-app drawer', icon: 'notifications' },
  { id: 'coins', label: 'Coin Reward', desc: 'Send notif + grant coins', icon: 'paid' },
  { id: 'tournament', label: 'Tournament', desc: 'Tournament-related broadcast', icon: 'emoji_events' },
];

const AUDIENCES = [
  { id: 'all',  label: 'All Users',  desc: 'Everyone on VERGR',         icon: 'public' },
  { id: 'paid', label: 'Paid Users', desc: 'Lite + Pro subscribers',    icon: 'workspace_premium' },
  { id: 'lite', label: 'Lite Tier',  desc: 'Lite subscribers only',     icon: 'star_half' },
  { id: 'pro',  label: 'Pro Tier',   desc: 'Pro subscribers only',      icon: 'star' },
];

export default function AdminAnnounceScreen() {
  const [tab, setTab] = useState('create');
  const { guarded, overlay } = useGuardedCall();
  return (
    <AdminShell
      screen="announcements"
      title="Announcements"
      subtitle="Create and send system notifications or popup banners to your users."
    >
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'create'  && <CreateTab guarded={guarded} />}
      {tab === 'history' && <HistoryTab />}
      {overlay}
    </AdminShell>
  );
}

// ───────────────────────────────────────────────────────────
// CREATE
// ───────────────────────────────────────────────────────────

function CreateTab({ guarded }) {
  const { showToast } = useUI();
  const [type, setType] = useState('system');
  const [audience, setAudience] = useState('all');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [actionUrl, setActionUrl] = useState('');
  const [coinReward, setCoinReward] = useState('');
  const [sending, setSending] = useState(false);

  const valid = title.trim().length > 0 && body.trim().length > 0;

  const handleSend = async () => {
    if (!valid || sending) return;
    setSending(true);
    try {
      await guarded(async () => {
        const result = await call('sendAnnouncement', {
          title: title.trim(),
          body: body.trim(),
          audience,
          type,
          coinReward: type === 'coins' ? parseInt(coinReward) || 0 : 0,
          actionUrl: actionUrl.trim() || null,
        });
        showToast(`Sent to ${result?.count || 0} users`, 'success');
        setTitle(''); setBody(''); setActionUrl(''); setCoinReward('');
      });
    } catch {}
    setSending(false);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 20 }}>
      <div>
        <Section number={1} title="Type">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {TYPES.map(t => (
              <ChoiceCard key={t.id} icon={t.icon} label={t.label} desc={t.desc}
                active={type === t.id} onClick={() => setType(t.id)} />
            ))}
          </div>
        </Section>

        <Section number={2} title="Audience">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {AUDIENCES.map(a => (
              <ChoiceCard key={a.id} icon={a.icon} label={a.label} desc={a.desc}
                active={audience === a.id} onClick={() => setAudience(a.id)} />
            ))}
          </div>
        </Section>

        <Section number={3} title="Content">
          <Field label="Heading (60 chars max)">
            <Input value={title} onChange={setTitle} placeholder="NEW SEASON IS LIVE!" maxLength={60} />
          </Field>
          <Field label="Description (200 chars max)">
            <Textarea value={body} onChange={setBody}
              placeholder="Jump into the new season now and unlock exclusive rewards."
              maxLength={200} rows={3} />
          </Field>
          <Field label="Action URL (optional)">
            <Input value={actionUrl} onChange={setActionUrl}
              placeholder="https://vergr.app/tournaments" />
          </Field>
          {type === 'coins' && (
            <Field label="Coin reward per recipient">
              <Input value={coinReward} onChange={setCoinReward}
                placeholder="0" type="number" />
            </Field>
          )}
        </Section>

        <Section number={4} title="Schedule">
          <div style={{ fontSize: 12, color: C.textDim }}>
            Scheduled sends will land in a follow-up pass. For now every announcement fires immediately.
          </div>
        </Section>
      </div>

      <Preview type={type} audience={audience} title={title} body={body} actionUrl={actionUrl}
        coinReward={coinReward} valid={valid} sending={sending} onSend={handleSend} />
    </div>
  );
}

function Section({ number, title, children }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      padding: 18, marginBottom: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: `${C.accent}30`, border: `1px solid ${C.accent}60`, color: C.accent2,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: 12,
        }}>{number}</div>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>{title}</h3>
      </div>
      {children}
    </div>
  );
}

function ChoiceCard({ icon, label, desc, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: 14, borderRadius: 10, border: `1px solid ${active ? C.accent : C.border}`,
      background: active ? `${C.accent}15` : '#0a0a14', color: C.text,
      textAlign: 'left', cursor: 'pointer',
      transition: 'border-color .15s, background .15s',
    }}>
      <Icon name={icon} size={20} className={active ? '' : 'opacity-60'} />
      <div style={{ fontSize: 13, fontWeight: 700, marginTop: 8 }}>{label}</div>
      <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>{desc}</div>
    </button>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.textDim, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

function Input({ value, onChange, placeholder, type = 'text', maxLength }) {
  return (
    <input type={type} value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} maxLength={maxLength}
      style={{
        width: '100%', padding: '10px 12px',
        background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 8,
        color: C.text, fontSize: 13,
      }}
    />
  );
}

function Textarea({ value, onChange, placeholder, rows = 3, maxLength }) {
  return (
    <textarea value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} rows={rows} maxLength={maxLength}
      style={{
        width: '100%', padding: '10px 12px',
        background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 8,
        color: C.text, fontSize: 13, resize: 'vertical', fontFamily: 'inherit',
      }}
    />
  );
}

// Preview rail (mockup right column)
function Preview({ type, audience, title, body, actionUrl, coinReward, valid, sending, onSend }) {
  return (
    <aside>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, marginBottom: 14 }}>
        <h3 style={{ margin: 0, marginBottom: 12, fontSize: 13, fontWeight: 700, color: C.text }}>Notification Preview</h3>
        <div style={{
          padding: 14, borderRadius: 10, background: '#0a0a14', border: `1px solid ${C.border}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 6,
              background: `linear-gradient(135deg, ${C.accent2}, ${C.accent})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 700, fontSize: 11,
            }}>V</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.text }}>VERGR</div>
              <div style={{ fontSize: 9, color: C.textMuted }}>now</div>
            </div>
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
            {title || 'Heading appears here'}
          </div>
          <div style={{ fontSize: 12, color: C.textDim, marginTop: 4 }}>
            {body || 'Description appears here.'}
          </div>
          {type === 'coins' && coinReward && (
            <div style={{ marginTop: 10, padding: '6px 10px', borderRadius: 6,
              background: '#f0a50020', color: '#f0a500', fontSize: 11, fontWeight: 700,
              display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="paid" size={13} /> +{coinReward} coins
            </div>
          )}
        </div>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, marginBottom: 14 }}>
        <h3 style={{ margin: 0, marginBottom: 10, fontSize: 13, fontWeight: 700, color: C.text }}>Summary</h3>
        <SummaryRow label="Type"     value={TYPES.find(t => t.id === type)?.label} />
        <SummaryRow label="Audience" value={AUDIENCES.find(a => a.id === audience)?.label} />
        <SummaryRow label="Heading"  value={title || '—'} />
        <SummaryRow label="Button URL" value={actionUrl || '—'} small />
        {type === 'coins' && <SummaryRow label="Reward" value={coinReward ? `+${coinReward} coins` : '—'} />}
      </div>

      <button onClick={onSend} disabled={!valid || sending} style={{
        width: '100%', padding: '12px 16px', borderRadius: 10, border: 0,
        background: !valid || sending ? '#2a2a3e' : C.accent, color: '#fff',
        fontSize: 14, fontWeight: 700, cursor: valid && !sending ? 'pointer' : 'not-allowed',
        opacity: !valid ? 0.5 : 1,
      }}>
        {sending ? 'Sending…' : 'Send Announcement'}
      </button>
    </aside>
  );
}

function SummaryRow({ label, value, small }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12,
      padding: '6px 0', borderBottom: `1px dashed ${C.border}`,
    }}>
      <span style={{ fontSize: 11, color: C.textDim }}>{label}</span>
      <span style={{
        fontSize: small ? 10 : 12, color: C.text, fontWeight: 600,
        textAlign: 'right', wordBreak: 'break-all', maxWidth: '60%',
      }}>{value}</span>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// HISTORY
// ───────────────────────────────────────────────────────────

function HistoryTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'announcements'), orderBy('createdAt', 'desc'), fbLimit(50));
    const unsub = onSnapshot(q, snap => {
      setRows(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, []);

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '120px 2fr 100px 100px 90px',
        padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
        fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase',
      }}>
        <div>Sent</div>
        <div>Title</div>
        <div>Audience</div>
        <div>Type</div>
        <div style={{ textAlign: 'right' }}>Recipients</div>
      </div>
      {loading && <Empty label="Loading…" />}
      {!loading && rows.length === 0 && <Empty label="No announcements sent yet." />}
      {rows.map(r => (
        <div key={r.id} style={{
          display: 'grid', gridTemplateColumns: '120px 2fr 100px 100px 90px',
          padding: '12px 14px', borderBottom: `1px solid ${C.border}`,
          fontSize: 12, color: C.text, alignItems: 'center',
        }}>
          <div style={{ color: C.textDim, fontSize: 11 }}>
            {r.createdAt?.toMillis?.() ? fmtRelative(r.createdAt.toMillis()) : '—'}
          </div>
          <div>
            <div style={{ fontWeight: 600 }}>{r.title || '—'}</div>
            <div style={{ fontSize: 10, color: C.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {r.body || '—'}
            </div>
          </div>
          <div style={{ fontSize: 11, color: C.textDim, textTransform: 'capitalize' }}>{r.audience || 'all'}</div>
          <div style={{ fontSize: 11, color: C.textDim, textTransform: 'capitalize' }}>{r.type || 'system'}</div>
          <div style={{ textAlign: 'right', fontWeight: 600 }} className="font-dmmono tabular-nums">
            {r.recipientCount ?? r.count ?? '—'}
          </div>
        </div>
      ))}
    </div>
  );
}

function Empty({ label }) {
  return <div style={{ padding: 32, textAlign: 'center', color: C.textDim, fontSize: 12 }}>{label}</div>;
}
