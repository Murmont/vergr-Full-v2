// The one email editor, used by campaigns AND the automatic emails, so a design
// change looks the same wherever it is made. Left: the design (theme, hero,
// subject, blocks). Right: the REAL rendered HTML from the server in an iframe,
// switchable between desktop and phone width, because an email that looks right
// in a form and wrong in Gmail has been guessed at, not designed.
//
// Solid surfaces only (founder design rule): no tints, no hairline outlines on
// selected controls; selection is a solid fill.

import { useEffect, useState } from 'react';
import Icon from '../../components/Icon';
import { ADMIN_COLORS as C } from './AdminShell';

export const BLOCKS = [
  { id: 'heading',   label: 'Heading',   icon: 'title' },
  { id: 'paragraph', label: 'Text',      icon: 'notes' },
  { id: 'button',    label: 'Button',    icon: 'smart_button' },
  { id: 'image',     label: 'Image',     icon: 'image' },
  { id: 'chips',     label: 'Tiles',     icon: 'view_week' },
  { id: 'code',      label: 'Big code',  icon: 'pin' },
  { id: 'divider',   label: 'Space',     icon: 'expand' },
];

export const FALLBACK_THEMES = [
  { id: 'violet', label: 'Violet', hero: '#2B0D5E', btn: '#7B1FFF' },
  { id: 'ember', label: 'Ember', hero: '#4A0E1C', btn: '#E0304F' },
  { id: 'gold', label: 'Gold', hero: '#4A3208', btn: '#E9A517' },
  { id: 'blue', label: 'Blue', hero: '#0C1F52', btn: '#3D7FFF' },
  { id: 'midnight', label: 'Midnight', hero: '#1A1A2A', btn: '#7B1FFF' },
];

const newBlock = (type) => ({
  type, text: '', url: '', alt: '', muted: false, align: 'left',
  items: type === 'chips' ? ['', '', ''] : [],
});

/**
 * design: { subject, preheader, hero: {title, subtitle}, theme, blocks }
 * preview(design) -> Promise<{subject, html, text}>
 */
export default function EmailDesigner({ design, onChange, preview, themes = FALLBACK_THEMES, tokens = [], footer = null, sideTop = null }) {
  const [rendered, setRendered] = useState(null);
  const [width, setWidth] = useState('desktop');
  const set = (k, v) => onChange({ ...design, [k]: v });
  const blocks = design.blocks || [];
  const setBlocks = (fn) => onChange({ ...design, blocks: fn(blocks) });

  const key = JSON.stringify(design);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      preview(design).then((r) => { if (live) setRendered(r); }).catch(() => {});
    }, 450);
    return () => { live = false; clearTimeout(t); };
  }, [key]);

  const patch = (i, k, v) => setBlocks((p) => p.map((b, j) => (j === i ? { ...b, [k]: v } : b)));
  const move = (i, dir) => setBlocks((p) => {
    const j = i + dir;
    if (j < 0 || j >= p.length) return p;
    const next = [...p];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,440px)', gap: 16, alignItems: 'start' }}>
      <div style={{ background: C.card, borderRadius: 12, padding: 18 }}>
        <L>Colour</L>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {themes.map((t) => {
            const on = (design.theme || 'violet') === t.id;
            return (
              <button key={t.id} onClick={() => set('theme', t.id)} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px 7px 7px', borderRadius: 10, border: 0,
                background: on ? C.accent : C.card2, color: on ? '#fff' : C.textDim, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}>
                <span style={{ width: 22, height: 22, borderRadius: 7, background: t.hero, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', overflow: 'hidden' }}>
                  <span style={{ width: 11, height: 11, background: t.btn, borderRadius: '4px 0 0 0' }} />
                </span>
                {t.label}
              </button>
            );
          })}
        </div>

        <L>Header</L>
        <input value={design.hero?.title || ''} onChange={(e) => set('hero', { ...design.hero, title: e.target.value })}
          placeholder="Big title in the coloured header" style={{ ...input, marginBottom: 8 }} />
        <input value={design.hero?.subtitle || ''} onChange={(e) => set('hero', { ...design.hero, subtitle: e.target.value })}
          placeholder="Smaller line under it (optional)" style={{ ...input, marginBottom: 16 }} />

        <L>Subject line</L>
        <input value={design.subject || ''} onChange={(e) => set('subject', e.target.value)} style={{ ...input, marginBottom: 8 }} />
        <L>Preview line</L>
        <input value={design.preheader || ''} onChange={(e) => set('preheader', e.target.value)}
          placeholder="The grey line inboxes show after the subject" style={input} />

        {tokens.length > 0 && (
          <div style={{ marginTop: 14, padding: 10, borderRadius: 8, background: C.card2, fontSize: 11.5, color: C.textDim, lineHeight: 1.6 }}>
            Replaced per person when it sends:
            <span style={{ marginLeft: 6 }}>
              {tokens.map((t) => (
                <code key={t} style={{ marginRight: 6, padding: '1px 7px', borderRadius: 5, background: '#2a1d4d', color: '#d9c6ff', fontSize: 11 }}>{`{{${t}}}`}</code>
              ))}
            </span>
          </div>
        )}

        <div style={{ height: 18 }} />
        <L>Content</L>
        {blocks.map((b, i) => (
          <div key={i} style={{ padding: 11, marginBottom: 8, borderRadius: 10, background: C.card2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: b.type === 'divider' ? 0 : 8 }}>
              <Icon name={BLOCKS.find((x) => x.id === b.type)?.icon || 'notes'} size={14} style={{ color: C.textDim }} />
              <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {BLOCKS.find((x) => x.id === b.type)?.label || b.type}
              </span>
              <button aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0} style={iconBtn}><Icon name="arrow_upward" size={14} /></button>
              <button aria-label="Move down" onClick={() => move(i, 1)} disabled={i === blocks.length - 1} style={iconBtn}><Icon name="arrow_downward" size={14} /></button>
              <button aria-label="Remove" onClick={() => setBlocks((p) => p.filter((_, j) => j !== i))} style={{ ...iconBtn, color: '#f04060' }}><Icon name="close" size={14} /></button>
            </div>

            {['heading', 'paragraph', 'button', 'code'].includes(b.type) && (
              <textarea rows={b.type === 'paragraph' ? 4 : 1} value={b.text}
                onChange={(e) => patch(i, 'text', e.target.value)}
                placeholder={b.type === 'button' ? 'Button label' : b.type === 'code' ? '{{code}}' : 'Write here'}
                style={{ ...input, marginBottom: b.type === 'button' ? 8 : 0, resize: 'vertical', fontFamily: 'inherit' }} />
            )}
            {b.type === 'button' && (
              <input value={b.url} onChange={(e) => patch(i, 'url', e.target.value)} placeholder="https://vergr.app/…" style={input} />
            )}
            {b.type === 'image' && (
              <>
                <input value={b.url} onChange={(e) => patch(i, 'url', e.target.value)} placeholder="https://cdn.vergr.app/…" style={{ ...input, marginBottom: 8 }} />
                <input value={b.alt} onChange={(e) => patch(i, 'alt', e.target.value)} placeholder="Describe the image (required)" style={input} />
              </>
            )}
            {b.type === 'chips' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 6 }}>
                {[0, 1, 2, 3].map((k) => (
                  <input key={k} value={(b.items || [])[k] || ''} placeholder={`Tile ${k + 1}`}
                    onChange={(e) => {
                      const items = [...(b.items || [])];
                      items[k] = e.target.value;
                      patch(i, 'items', items);
                    }} style={input} />
                ))}
              </div>
            )}
            {(b.type === 'paragraph' || b.type === 'heading') && (
              <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
                {b.type === 'paragraph' && (
                  <label style={chk}><input type="checkbox" checked={!!b.muted} onChange={(e) => patch(i, 'muted', e.target.checked)} />Small and grey</label>
                )}
                <label style={chk}><input type="checkbox" checked={b.align === 'center'} onChange={(e) => patch(i, 'align', e.target.checked ? 'center' : 'left')} />Centred</label>
              </div>
            )}
          </div>
        ))}

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0 4px' }}>
          {BLOCKS.map((b) => (
            <button key={b.id} onClick={() => setBlocks((p) => [...p, newBlock(b.id)])} style={chipBtn}>
              <Icon name={b.icon} size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
              {b.label}
            </button>
          ))}
        </div>
        {footer}
      </div>

      <div style={{ position: 'sticky', top: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {sideTop}
        <div style={{ background: C.card, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8, background: C.card2 }}>
            <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Preview</span>
            {['desktop', 'phone'].map((w) => (
              <button key={w} onClick={() => setWidth(w)} style={{
                padding: '5px 10px', borderRadius: 7, border: 0, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                background: width === w ? C.accent : C.card, color: width === w ? '#fff' : C.textDim,
              }}>
                <Icon name={w === 'desktop' ? 'desktop_windows' : 'smartphone'} size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                {w === 'desktop' ? 'Desktop' : 'Phone'}
              </button>
            ))}
          </div>
          <div style={{ padding: '10px 14px', fontSize: 12 }}>
            <div style={{ color: C.textDim, fontSize: 10.5, marginBottom: 2 }}>SUBJECT</div>
            <div style={{ color: C.text, fontWeight: 600 }}>{rendered?.subject || '…'}</div>
          </div>
          <div style={{ background: '#08080F', display: 'flex', justifyContent: 'center' }}>
            {/* Sandboxed with no scripts: it only ever needs to paint. */}
            <iframe title="Email preview" sandbox="" srcDoc={rendered?.html || ''}
              style={{ width: width === 'phone' ? 375 : '100%', height: 620, border: 0, background: '#08080F', display: 'block' }} />
          </div>
          <details>
            <summary style={{ padding: '10px 14px', fontSize: 11.5, color: C.textDim, cursor: 'pointer' }}>Plain text version</summary>
            <pre style={{ margin: 0, padding: 14, fontSize: 11, color: C.textDim, whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace', background: C.card2, maxHeight: 240, overflowY: 'auto' }}>{rendered?.text || ''}</pre>
          </details>
        </div>
      </div>
    </div>
  );
}

export const input = {
  width: '100%', padding: '9px 11px', background: C.bg,
  border: 0, borderRadius: 8, color: C.text, fontSize: 12.5, outline: 'none',
};
export const chipBtn = {
  padding: '7px 11px', borderRadius: 8, border: 0, background: C.card2, color: C.text,
  fontSize: 11.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
};
export const solidBtn = (bg, fg = '#fff') => ({
  padding: '9px 16px', borderRadius: 9, border: 0, background: bg, color: fg,
  fontSize: 12.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
});
const iconBtn = { background: 'transparent', border: 0, color: C.textDim, cursor: 'pointer', padding: 2 };
const chk = { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: C.textDim, cursor: 'pointer' };
export function L({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{children}</div>;
}
