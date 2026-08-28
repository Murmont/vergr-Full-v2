// Editing the emails Vergr already sends (founder decision D3).
//
// Not a bulk-email tool. These are the transactional emails: a verification
// code, a password reset, a welcome. The editor is a block list plus a live
// preview of the REAL rendered HTML, because an email that looks right in a
// textarea and wrong in Gmail is not edited, it is guessed at.
//
// Two things the screen is honest about rather than hiding:
//   - whether SMTP is configured at all, since dormant and broken look identical
//     from the outside and only one of them is a bug;
//   - that a token like {{code}} cannot be deleted, because an email without it
//     is useless and the failure would not show up until a real person could not
//     sign in.

import { useState, useEffect, useCallback } from 'react';
import { useUI } from '../../context/UIContext';
import Icon from '../../components/Icon';
import { ADMIN_COLORS as C } from './AdminShell';
import { call, fmtRelative, useGuardedCall } from './_adminGuarded';

const BLOCKS = [
  { id: 'heading',   label: 'Heading',   icon: 'title' },
  { id: 'paragraph', label: 'Paragraph', icon: 'notes' },
  { id: 'code',      label: 'Code',      icon: 'pin' },
  { id: 'button',    label: 'Button',    icon: 'smart_button' },
  { id: 'divider',   label: 'Divider',   icon: 'horizontal_rule' },
  { id: 'image',     label: 'Image',     icon: 'image' },
];

export default function AdminEmailsTab() {
  const { showToast } = useUI();
  const { guarded, overlay } = useGuardedCall();
  const [rows, setRows] = useState([]);
  const [smtp, setSmtp] = useState(true);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call('adminListEmailTemplates', {});
      setRows(r.rows || []);
      setSmtp(r.smtpConfigured !== false);
    } catch (e) { showToast(e?.message || 'Could not load templates', 'error'); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      {!smtp && (
        <div style={{
          padding: 12, marginBottom: 14, borderRadius: 8, fontSize: 11.5, lineHeight: 1.6,
          background: 'rgba(245,197,66,0.08)', border: '1px solid rgba(245,197,66,0.3)', color: '#f5c542',
        }}>
          <b>No email is being sent right now.</b> The SMTP login is not set, so these
          templates are saved but dormant. To switch email on: create the
          noreply@vergr.app mailbox in Spacemail, then set the SMTP_USER and SMTP_PASS
          secrets. Nothing here needs changing afterwards.
        </div>
      )}

      {editing ? (
        <TemplateEditor row={editing} guarded={guarded}
          onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      ) : (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          {loading && <div style={{ padding: 20, fontSize: 12, color: C.textDim }}>Loading…</div>}
          {rows.map((r) => (
            <div key={r.templateId} style={{ padding: '14px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 14, alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text, marginBottom: 3 }}>
                  {r.name}
                  {r.edited && (
                    <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: C.accent, letterSpacing: '0.05em' }}>
                      EDITED
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: C.textDim, marginBottom: 4 }}>{r.description}</div>
                <div style={{ fontSize: 11, color: C.textDim }}>
                  Subject: <span style={{ color: C.text }}>{r.subject}</span>
                  {r.edited && r.updatedAt ? ` · changed ${fmtRelative(r.updatedAt)}` : ''}
                </div>
              </div>
              <button onClick={() => setEditing(r)} style={btn(C.accent)}>Edit</button>
            </div>
          ))}
        </div>
      )}
      {overlay}
    </>
  );
}

function TemplateEditor({ row, onCancel, onSaved, guarded }) {
  const { showToast } = useUI();
  const [subject, setSubject] = useState(row.subject || '');
  const [preheader, setPreheader] = useState(row.preheader || '');
  const [blocks, setBlocks] = useState(() => (row.blocks || []).map((b) => ({ ...b })));
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  // Preview the DRAFT, not what is saved, so it shows what is about to ship.
  // Debounced so typing does not fire a call per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      call('adminPreviewEmailTemplate', { templateId: row.templateId, subject, preheader, blocks })
        .then(setPreview).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [row.templateId, subject, preheader, blocks]);

  const patch = (i, k, v) => setBlocks((p) => p.map((b, j) => (j === i ? { ...b, [k]: v } : b)));
  const move = (i, dir) => setBlocks((p) => {
    const j = i + dir;
    if (j < 0 || j >= p.length) return p;
    const next = [...p];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const remove = (i) => setBlocks((p) => p.filter((_, j) => j !== i));
  const add = (type) => setBlocks((p) => [...p, { type, text: '', url: '', alt: '', muted: false, align: 'left' }]);

  const save = async () => {
    setBusy(true);
    try {
      await guarded(() => call('adminSaveEmailTemplate', { templateId: row.templateId, subject, preheader, blocks }));
      showToast('Saved', 'success');
      onSaved();
    } catch { /* guarded surfaces it */ }
    setBusy(false);
  };

  const reset = async () => {
    if (!window.confirm('Put this email back to the original wording? Your changes are discarded.')) return;
    try {
      await guarded(() => call('adminResetEmailTemplate', { templateId: row.templateId }));
      showToast('Back to the original', 'success');
      onSaved();
    } catch { /* ignore */ }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,420px)', gap: 16, alignItems: 'start' }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
        <h3 style={{ margin: 0, marginBottom: 4, fontSize: 14, fontWeight: 700, color: C.text }}>{row.name}</h3>
        <div style={{ fontSize: 11.5, color: C.textDim, marginBottom: 14, lineHeight: 1.55 }}>{row.description}</div>

        {row.tokens?.length > 0 && (
          <div style={{
            padding: 10, marginBottom: 14, borderRadius: 8, fontSize: 11.5, lineHeight: 1.6,
            background: '#0a0a14', border: `1px solid ${C.border}`, color: C.textDim,
          }}>
            These get replaced with real values when the email is sent:
            <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {row.tokens.map((t) => (
                <code key={t} style={{
                  padding: '2px 8px', borderRadius: 5, fontSize: 11,
                  background: `${C.accent}18`, color: C.accent, fontFamily: 'ui-monospace, monospace',
                }}>{`{{${t}}}`}</code>
              ))}
            </div>
            {row.tokens.some((t) => t !== 'name') && (
              <div style={{ marginTop: 7, color: '#f5c542' }}>
                The email is refused if you delete one that carries its whole point,
                like the code or the reset link.
              </div>
            )}
          </div>
        )}

        <L>Subject line</L>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} style={{ ...input, marginBottom: 12 }} />

        <L>Preview line</L>
        <input value={preheader} onChange={(e) => setPreheader(e.target.value)} style={{ ...input, marginBottom: 0 }} />
        <H>The grey line inboxes show next to the subject. Leave it empty and the client picks its own, usually badly.</H>

        <L>Content</L>
        {blocks.map((b, i) => (
          <div key={i} style={{
            padding: 11, marginBottom: 8, borderRadius: 8,
            background: '#0a0a14', border: `1px solid ${C.border}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: b.type === 'divider' ? 0 : 8 }}>
              <Icon name={BLOCKS.find((x) => x.id === b.type)?.icon || 'notes'} size={14} style={{ color: C.textDim }} />
              <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {BLOCKS.find((x) => x.id === b.type)?.label || b.type}
              </span>
              <button onClick={() => move(i, -1)} disabled={i === 0} style={iconBtn}><Icon name="arrow_upward" size={13} /></button>
              <button onClick={() => move(i, 1)} disabled={i === blocks.length - 1} style={iconBtn}><Icon name="arrow_downward" size={13} /></button>
              <button onClick={() => remove(i)} style={{ ...iconBtn, color: '#f04060' }}><Icon name="close" size={13} /></button>
            </div>

            {b.type !== 'divider' && b.type !== 'image' && (
              <textarea rows={b.type === 'paragraph' ? 3 : 1} value={b.text}
                onChange={(e) => patch(i, 'text', e.target.value)}
                placeholder={b.type === 'code' ? '{{code}}' : 'Text'}
                style={{ ...input, marginBottom: 8, resize: 'vertical', fontFamily: 'inherit' }} />
            )}
            {b.type === 'button' && (
              <input value={b.url} onChange={(e) => patch(i, 'url', e.target.value)}
                placeholder="https://vergr.app" style={{ ...input, marginBottom: 0 }} />
            )}
            {b.type === 'image' && (
              <>
                <input value={b.url} onChange={(e) => patch(i, 'url', e.target.value)}
                  placeholder="https://cdn.vergr.app/…" style={{ ...input, marginBottom: 8 }} />
                <input value={b.alt} onChange={(e) => patch(i, 'alt', e.target.value)}
                  placeholder="Describe the image" style={{ ...input, marginBottom: 0 }} />
                <H>
                  Alt text is required. Most email apps block images until the reader
                  allows them, so for a lot of people this is all they see.
                </H>
              </>
            )}
            {b.type === 'paragraph' && (
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <label style={chk}>
                  <input type="checkbox" checked={!!b.muted} onChange={(e) => patch(i, 'muted', e.target.checked)} />
                  Small and grey
                </label>
                <label style={chk}>
                  <input type="checkbox" checked={b.align === 'center'} onChange={(e) => patch(i, 'align', e.target.checked ? 'center' : 'left')} />
                  Centred
                </label>
              </div>
            )}
          </div>
        ))}

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0 16px' }}>
          {BLOCKS.map((b) => (
            <button key={b.id} onClick={() => add(b.id)} style={btn(C.border)}>
              <Icon name={b.icon} size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              {b.label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: C.textDim, marginBottom: 14, lineHeight: 1.55 }}>
          There is no video block on purpose. Email apps cannot play video, so a
          block that offered it would be promising something the reader never gets.
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} style={{ ...btn(C.border), padding: '10px 16px' }}>Cancel</button>
          {row.edited && <button onClick={reset} style={{ ...btn('#f04060'), padding: '10px 16px' }}>Back to original</button>}
          <button onClick={save} disabled={busy} style={{ ...btn(C.accent), padding: '10px 16px' }}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div style={{ position: 'sticky', top: 16, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Preview
        </div>
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
          <div style={{ color: C.textDim, fontSize: 10.5, marginBottom: 2 }}>SUBJECT</div>
          <div style={{ color: C.text, fontWeight: 600 }}>{preview?.subject || '…'}</div>
        </div>
        {/* The REAL rendered HTML in an iframe, not an approximation. Sandboxed
            with no allow-scripts: this is untrusted-shaped content and it only
            ever needs to paint. */}
        <iframe
          title="Email preview"
          sandbox=""
          srcDoc={preview?.html || ''}
          style={{ width: '100%', height: 520, border: 0, background: '#0B0B14', display: 'block' }}
        />
        <details style={{ borderTop: `1px solid ${C.border}` }}>
          <summary style={{ padding: '10px 14px', fontSize: 11.5, color: C.textDim, cursor: 'pointer' }}>
            Plain text version
          </summary>
          <pre style={{
            margin: 0, padding: 14, fontSize: 11, color: C.textDim, whiteSpace: 'pre-wrap',
            fontFamily: 'ui-monospace, monospace', background: '#0a0a14', maxHeight: 240, overflowY: 'auto',
          }}>{preview?.text || ''}</pre>
        </details>
        <div style={{ padding: '9px 14px', fontSize: 11, color: C.textDim, borderTop: `1px solid ${C.border}`, lineHeight: 1.55 }}>
          Both versions are built from the blocks above, so they can never say
          different things. Sample values are shown where the tokens go.
        </div>
      </div>
    </div>
  );
}

const input = {
  width: '100%', padding: '9px 11px', background: '#0a0a14',
  border: `1px solid ${C.border}`, borderRadius: 7, color: C.text, fontSize: 12.5,
};
const btn = (color) => ({
  padding: '6px 12px', borderRadius: 6, border: `1px solid ${color}`,
  background: `${color}22`, color: color === C.border ? C.textDim : color,
  fontSize: 11.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
});
const iconBtn = {
  background: 'transparent', border: 0, color: C.textDim, cursor: 'pointer', padding: 2,
};
const chk = {
  display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.textDim, cursor: 'pointer',
};
function L({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{children}</div>;
}
function H({ children }) {
  return <div style={{ fontSize: 11, color: C.textDim, marginTop: 6, marginBottom: 12, lineHeight: 1.55 }}>{children}</div>;
}
