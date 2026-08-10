// BannedWordsEditor — host-curated word filter for THIS stream.
//
// Lexical substring match (case-insensitive). Words written into
// streams/{streamId}.bannedWords; the chat relay redacts hits with '#'.
// No Gemini involved — host's curation is the authority.

import { useEffect, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
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
  red: '#ef4444',
};

const MAX_WORDS = 100;
const MAX_LEN = 32;

export default function BannedWordsEditor({ streamId, onClose }) {
  const { showToast } = useUI();
  const [words, setWords] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!streamId) return;
    const unsub = onSnapshot(doc(db, 'streams', streamId), (snap) => {
      setLoading(false);
      if (snap.exists()) setWords(snap.data().bannedWords || []);
    });
    return unsub;
  }, [streamId]);

  const addFromDraft = () => {
    const next = draft
      .split(/[,\n]/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0 && s.length <= MAX_LEN);
    if (!next.length) return;
    setWords((prev) => {
      const merged = [...prev];
      for (const w of next) {
        if (!merged.includes(w) && merged.length < MAX_WORDS) merged.push(w);
      }
      return merged;
    });
    setDraft('');
  };

  const removeAt = (i) => setWords((prev) => prev.filter((_, j) => j !== i));

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await httpsCallable(getFunctions(undefined, 'europe-west1'), 'setStreamBannedWords')({
        streamId, words,
      });
      showToast(`Saved (${words.length} word${words.length === 1 ? '' : 's'}).`, 'success');
      onClose?.();
    } catch (err) {
      showToast(err?.message || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      width: 'min(420px, 92vw)', background: C.bg, border: `1px solid ${C.border}`,
      borderRadius: 14, overflow: 'hidden', color: C.text,
      fontFamily: '"Inter", system-ui, sans-serif',
    }}>
      <div style={{
        padding: '14px 16px', borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div style={{ fontSize: 13, fontWeight: 800, flex: 1 }}>Banned words</div>
        <button onClick={onClose} style={{
          background: 'transparent', border: 'none', color: C.textDim, cursor: 'pointer',
        }} aria-label="Close">
          <Icon name="close" size={16} className=""/>
        </button>
      </div>

      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.5, marginBottom: 14 }}>
          Words you list here will be hidden in chat (replaced with #####).
          Case-insensitive substring match. Up to {MAX_WORDS} words.
        </div>

        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: C.textDim, fontSize: 12 }}>
            Loading…
          </div>
        ) : (
          <>
            {words.length > 0 && (
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12,
              }}>
                {words.map((w, i) => (
                  <span key={i} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '4px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700,
                    background: 'rgba(239,68,68,0.10)', color: C.red,
                    border: `1px solid ${C.red}33`,
                  }}>
                    {w}
                    <button onClick={() => removeAt(i)}
                      aria-label="Remove" style={{
                        background: 'transparent', border: 'none',
                        color: C.red, cursor: 'pointer', padding: 0,
                      }}>
                      <Icon name="close" size={12} className=""/>
                    </button>
                  </span>
                ))}
              </div>
            )}

            <input
              type="text"
              value={draft}
              maxLength={MAX_LEN * 4}
              placeholder="Add words (comma or newline-separated)"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); addFromDraft(); }
              }}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '10px 12px', borderRadius: 8,
                background: 'rgba(255,255,255,0.04)',
                border: `1px solid ${C.border}`, color: C.text, fontSize: 13,
                outline: 'none', marginBottom: 8,
              }}
            />
            <button onClick={addFromDraft} disabled={!draft.trim()}
              style={{
                width: '100%', padding: 10, borderRadius: 8,
                border: `1px dashed ${C.border}`, background: 'transparent',
                color: C.textDim, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                marginBottom: 14, opacity: draft.trim() ? 1 : 0.5,
              }}>
              + Add to list
            </button>

            <button onClick={save} disabled={saving}
              style={{
                width: '100%', padding: 12, borderRadius: 10, border: 'none',
                background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`,
                color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer',
                opacity: saving ? 0.6 : 1,
              }}>
              {saving ? 'Saving…' : `Save (${words.length})`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
