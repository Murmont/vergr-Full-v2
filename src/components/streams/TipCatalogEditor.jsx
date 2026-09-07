// TipCatalogEditor — host configures tip-tier messages for their stream.
//
// Each entry is { minCoins, message }. When a viewer tips ≥ minCoins without
// typing their own message, the highest matching entry's message becomes
// the chat caption.
//
// Every message is Gemini-moderated server-side on save. We do NOT pre-validate
// locally — the callable handles the check and returns a clear error if any
// entry is blocked.

import { useEffect, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import Icon from '../Icon';

const C = {
  bg: '#12121e',
  bgSoft: '#0f0f1a',
  border: 'rgba(255,255,255,0.10)',
  text: '#fff',
  textDim: 'rgba(255,255,255,0.65)',
  purple: '#7c3aed',
  purpleLight: '#b44fff',
  green: '#22c55e',
  amber: '#f59e0b',
};

const MAX_ENTRIES = 10;
const MAX_MSG = 80;
const DEFAULT_TEMPLATE = [
  { minCoins: 5,   message: 'Hello' },
  { minCoins: 50,  message: 'Thanks for the support' },
  { minCoins: 500, message: 'Legend' },
];

export default function TipCatalogEditor({ onClose }) {
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load current catalog.
  useEffect(() => {
    if (!currentUser?.uid) return;
    const unsub = onSnapshot(doc(db, 'users', currentUser.uid), (snap) => {
      setLoading(false);
      const arr = snap.exists() ? (snap.data().tipCatalog || []) : [];
      setEntries(arr.length ? arr : []);
    });
    return unsub;
  }, [currentUser?.uid]);

  const add = () => {
    if (entries.length >= MAX_ENTRIES) return;
    const lastCoins = entries.length ? entries[entries.length - 1].minCoins : 1;
    setEntries((prev) => [...prev, { minCoins: Math.max(1, lastCoins * 2), message: '' }]);
  };
  const remove = (i) => setEntries((prev) => prev.filter((_, j) => j !== i));
  const updateAt = (i, patch) => setEntries((prev) => prev.map((e, j) => j === i ? { ...e, ...patch } : e));

  const useTemplate = () => setEntries(DEFAULT_TEMPLATE);

  const save = async () => {
    if (saving) return;
    // Drop empty rows.
    const cleaned = entries
      .map((e) => ({ minCoins: Math.max(1, Math.floor(Number(e.minCoins) || 0)), message: (e.message || '').trim() }))
      .filter((e) => e.message.length > 0);
    if (cleaned.length === 0) {
      showToast('Add at least one tier or clear the catalog.', 'error');
      return;
    }
    setSaving(true);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'setTipCatalog');
      const { data } = await fn({ entries: cleaned });
      showToast('Tip catalog saved.', 'success');
      setEntries(data.entries || cleaned);
      onClose?.();
    } catch (err) {
      showToast(err?.message || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const clearAll = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'clearTipCatalog');
      await fn({});
      setEntries([]);
      showToast('Catalog cleared.', 'success');
    } catch (err) {
      showToast(err?.message || 'Clear failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      width: 'min(440px, 92vw)', background: C.bg, border: `1px solid ${C.border}`,
      borderRadius: 14, overflow: 'hidden', color: C.text,
      fontFamily: '"DM Sans", system-ui, sans-serif',
    }}>
      <div style={{
        padding: '14px 16px', borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div style={{ fontSize: 13, fontWeight: 800, flex: 1 }}>Tip messages</div>
        <button onClick={onClose} style={{
          background: 'transparent', border: 'none', color: C.textDim, cursor: 'pointer',
        }} aria-label="Close">
          <Icon name="close" size={16} className=""/>
        </button>
      </div>

      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.5, marginBottom: 14 }}>
          When a viewer tips you, the matching message appears in chat. Viewers can also write
          their own short message — both are moderated before broadcast.
        </div>

        {loading ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: C.textDim, fontSize: 12 }}>
            Loading…
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {entries.map((e, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: 10, borderRadius: 10,
                  background: C.bgSoft, border: `1px solid ${C.border}`,
                }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    minWidth: 88,
                  }}>
                    <input
                      type="number" min={1} value={e.minCoins}
                      onChange={(ev) => updateAt(i, { minCoins: Math.max(1, parseInt(ev.target.value || '1', 10)) })}
                      style={{
                        width: 56, background: 'transparent', border: 'none',
                        color: C.text, fontSize: 14, fontWeight: 800,
                        fontFamily: 'DM Mono, ui-monospace, monospace', outline: 'none',
                      }}
                    />
                    <span style={{ color: C.textDim, fontSize: 11, fontWeight: 700 }}>c+</span>
                  </div>
                  <input
                    type="text"
                    value={e.message}
                    maxLength={MAX_MSG}
                    onChange={(ev) => updateAt(i, { message: ev.target.value })}
                    placeholder="e.g. Thanks for the support"
                    style={{
                      flex: 1, background: 'transparent', border: 'none',
                      color: C.text, fontSize: 13, outline: 'none',
                    }}
                  />
                  <button onClick={() => remove(i)} aria-label="Remove" style={{
                    background: 'transparent', border: 'none', color: C.textDim,
                    cursor: 'pointer', padding: 4,
                  }}>
                    <Icon name="delete" size={14} className=""/>
                  </button>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <button onClick={add} disabled={entries.length >= MAX_ENTRIES} style={{
                flex: 1, padding: 10, borderRadius: 8, border: `1px dashed ${C.border}`,
                background: 'transparent', color: C.textDim,
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
                opacity: entries.length >= MAX_ENTRIES ? 0.4 : 1,
              }}>
                + Add tier {entries.length}/{MAX_ENTRIES}
              </button>
              {entries.length === 0 && (
                <button onClick={useTemplate} style={{
                  padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.border}`,
                  background: 'transparent', color: C.purpleLight,
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}>Use template</button>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={clearAll} disabled={saving || entries.length === 0}
                style={{
                  padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.border}`,
                  background: 'transparent', color: C.textDim,
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  opacity: saving || entries.length === 0 ? 0.5 : 1,
                }}>Clear all</button>
              <button onClick={save} disabled={saving}
                style={{
                  flex: 1, padding: '10px 14px', borderRadius: 8, border: 'none',
                  background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`,
                  color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer',
                  opacity: saving ? 0.6 : 1,
                }}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
