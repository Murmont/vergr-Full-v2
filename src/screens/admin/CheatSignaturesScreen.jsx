// CheatSignaturesScreen — admin CRUD for the cheat-tool database.
// Route: /admin/cheat-signatures
//
// Each signature: { kind, value, severity, label, active }
//   kind: 'exe_hash' | 'exe_name' | 'cmd_substring'
//   severity: 'yellow' (review) | 'orange' (mod confirm) | 'red' (auto-DQ pending)
//
// Used by functions/antiCheat.js to match against player scan submissions.

import { useEffect, useState } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../firebase/config';
import { useUI } from '../../context/UIContext';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';

const C = {
  bg: '#0B0B14', surface: '#14141F', soft: '#1A1A2A',
  border: 'rgba(255,255,255,0.10)',
  text: '#fff', dim: 'rgba(255,255,255,0.65)', mute: 'rgba(255,255,255,0.45)',
  red: '#ef4444', amber: '#f59e0b', yellow: '#fbbf24',
};
const SEV_COLOR = { yellow: C.yellow, orange: C.amber, red: C.red };
const fns = () => getFunctions(undefined, 'europe-west1');

export default function CheatSignaturesScreen() {
  const { showToast } = useUI();
  const [sigs, setSigs] = useState([]);
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    const q = query(collection(db, 'cheat_signatures'), orderBy('updatedAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => setSigs(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return () => unsub();
  }, []);

  const save = async (sig) => {
    try {
      await httpsCallable(fns(), 'upsertCheatSignature')(sig);
      showToast('Saved', 'success');
      setEditing(null);
    } catch (err) { showToast(err?.message || 'Save failed', 'error'); }
  };
  const remove = async (id) => {
    if (!confirm('Delete signature?')) return;
    try {
      await httpsCallable(fns(), 'deleteCheatSignature')({ id });
      showToast('Deleted', 'info');
    } catch (err) { showToast(err?.message || 'Delete failed', 'error'); }
  };

  // AC7 — staleness banner. Signatures arrive ordered by updatedAt desc, so the
  // first row is the newest. Stale = empty DB or newest >90 days old.
  const newestMs = (() => {
    const t = sigs[0]?.updatedAt || sigs[0]?.createdAt;
    if (!t) return 0;
    if (typeof t.toMillis === 'function') return t.toMillis();
    if (typeof t.seconds === 'number') return t.seconds * 1000;
    return 0;
  })();
  const ageDays = newestMs ? Math.floor((Date.now() - newestMs) / 86400000) : null;
  const stale = sigs.length === 0 || (newestMs > 0 && ageDays > 90);

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text }}>
      <TopBar showBack title="Cheat Signatures" subtitle="Anti-cheat detection database" />
      <div style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>
        {stale && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14,
            padding: '12px 14px', borderRadius: 10,
            background: `${C.amber}1a`, border: `1px solid ${C.amber}66`,
          }}>
            <Icon name="warning" style={{ color: C.amber }} />
            <div style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>
              <b style={{ color: C.amber }}>Signatures need a refresh.</b>{' '}
              {sigs.length === 0
                ? 'The database is empty — click "Seed defaults" to load the known cheat-tool set.'
                : `Newest signature is ${ageDays} days old (>90). Review the list and add any newly-discovered cheat tools, then re-seed if needed.`}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.mute, fontFamily: 'DM Mono, monospace' }}>
            {sigs.length} signatures · {sigs.filter((s) => s.active).length} active
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={async () => {
              if (!confirm('Seed 40 known cheat-tool signatures? (idempotent)')) return;
              try {
                const { data } = await httpsCallable(fns(), 'adminSeedCheatSignatures')({});
                showToast(`Seeded ${data.count} signatures`, 'success');
              } catch (err) { showToast(err?.message || 'Seed failed', 'error'); }
            }} style={{
              padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.border}`,
              background: 'transparent', color: C.text, fontWeight: 700, cursor: 'pointer',
            }}>Seed defaults</button>
            <button onClick={() => setEditing({ kind: 'exe_name', severity: 'orange', value: '', label: '', active: true })} style={{
              padding: '8px 14px', borderRadius: 8, border: 'none',
              background: '#F0A500', color: '#000', fontWeight: 900, cursor: 'pointer',
            }}>+ New signature</button>
          </div>
        </div>

        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          {sigs.map((s) => (
            <div key={s.id} style={{
              display: 'grid', gridTemplateColumns: 'auto 1fr auto auto auto',
              gap: 12, alignItems: 'center', padding: '10px 14px',
              borderBottom: `1px solid ${C.border}`,
              opacity: s.active ? 1 : 0.45,
            }}>
              <div style={{
                width: 10, height: 10, borderRadius: 5,
                background: SEV_COLOR[s.severity] || C.mute,
              }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{s.label || s.value}</div>
                <div style={{ fontSize: 10, color: C.mute, fontFamily: 'DM Mono, monospace',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.kind} · {s.value}
                </div>
              </div>
              <div style={{ fontSize: 9, color: SEV_COLOR[s.severity] || C.mute,
                textTransform: 'uppercase', fontWeight: 900, letterSpacing: '0.1em' }}>
                {s.severity}
              </div>
              <button onClick={() => setEditing({ ...s })} style={iconBtn}>Edit</button>
              <button onClick={() => remove(s.id)} style={{ ...iconBtn, color: C.red }}>Delete</button>
            </div>
          ))}
          {sigs.length === 0 && <div style={{ padding: 30, color: C.dim, textAlign: 'center' }}>No signatures yet.</div>}
        </div>
      </div>

      {editing && (
        <div onClick={() => setEditing(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: C.surface, borderRadius: 14, padding: 18, width: '100%', maxWidth: 480,
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ fontSize: 16, fontWeight: 900 }}>{editing.id ? 'Edit' : 'New'} signature</div>
            <Sel label="Kind" value={editing.kind} onChange={(v) => setEditing({ ...editing, kind: v })}
              opts={[['exe_hash', 'Exe path hash'], ['exe_name', 'Exe filename'], ['cmd_substring', 'Cmd substring']]} />
            <Fld label="Value" value={editing.value}
              onChange={(v) => setEditing({ ...editing, value: v })}
              ph={editing.kind === 'exe_hash' ? 'sha256 hex of exe path'
                : editing.kind === 'exe_name' ? 'cheatengine.exe' : 'substring like --inject'} />
            <Fld label="Label (human readable)" value={editing.label}
              onChange={(v) => setEditing({ ...editing, label: v })}
              ph="Cheat Engine memory editor" />
            <Sel label="Severity" value={editing.severity} onChange={(v) => setEditing({ ...editing, severity: v })}
              opts={[['yellow', 'Yellow — review'], ['orange', 'Orange — mod confirm'], ['red', 'Red — auto-DQ pending']]} />
            <label style={{ fontSize: 12, color: C.dim, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={editing.active}
                onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
              Active
            </label>
            <button onClick={() => save(editing)} style={{
              padding: 10, borderRadius: 8, border: 'none',
              background: '#F0A500', color: '#000', fontWeight: 900, cursor: 'pointer', marginTop: 6,
            }}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Fld({ label, value, onChange, ph }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: C.mute, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>{label}</div>
      <input value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={ph}
        style={{
          width: '100%', padding: 10, borderRadius: 8,
          background: C.soft, color: C.text, border: `1px solid ${C.border}`, fontSize: 13,
          fontFamily: 'DM Mono, monospace',
        }} />
    </div>
  );
}
function Sel({ label, value, onChange, opts }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: C.mute, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%', padding: 10, borderRadius: 8,
          background: C.soft, color: C.text, border: `1px solid ${C.border}`, fontSize: 13,
        }}>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}
const iconBtn = {
  padding: '6px 10px', borderRadius: 6, background: 'transparent',
  border: `1px solid ${C.border}`, color: C.text, fontSize: 11, cursor: 'pointer',
};
