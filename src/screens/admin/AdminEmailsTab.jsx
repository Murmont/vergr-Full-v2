// Emails in the admin.
//
//   Send an email     designed campaigns you write and send (AdminEmailCampaigns)
//   Automatic emails  the transactional emails Vergr sends by itself: the
//                     verification code, receipts, refunds, password reset,
//                     welcome. Same designer, but a token like {{code}} cannot be
//                     deleted, because an email without it is useless and the
//                     failure would not show until a real person could not sign in.

import { useState, useEffect, useCallback } from 'react';
import { useUI } from '../../context/UIContext';
import { ADMIN_COLORS as C } from './AdminShell';
import { call, fmtRelative, useGuardedCall } from './_adminGuarded';
import EmailDesigner, { solidBtn } from './EmailDesigner';
import AdminEmailCampaigns from './AdminEmailCampaigns';

export default function AdminEmailsTab() {
  const { guarded, overlay } = useGuardedCall();
  const [view, setView] = useState('campaigns');
  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {[['campaigns', 'Send an email'], ['templates', 'Automatic emails']].map(([id, label]) => (
          <button key={id} onClick={() => setView(id)} style={solidBtn(view === id ? C.accent : C.card2, view === id ? '#fff' : C.textDim)}>
            {label}
          </button>
        ))}
      </div>
      {view === 'campaigns' ? <AdminEmailCampaigns guarded={guarded} /> : <Templates guarded={guarded} />}
      {overlay}
    </>
  );
}

function Templates({ guarded }) {
  const { showToast } = useUI();
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
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  if (editing) {
    return <TemplateEditor row={editing} guarded={guarded}
      onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />;
  }
  return (
    <>
      {!smtp && (
        <div style={{ padding: 12, marginBottom: 14, borderRadius: 10, background: '#3b2a08', color: '#f5c842', fontSize: 12, lineHeight: 1.6 }}>
          <b>No email is being sent right now.</b> The SMTP login is not set, so these templates are saved but dormant.
        </div>
      )}
      <div style={{ background: C.card, borderRadius: 12, overflow: 'hidden' }}>
        {loading && <div style={{ padding: 20, fontSize: 12, color: C.textDim }}>Loading…</div>}
        {rows.map((r, i) => (
          <div key={r.templateId} style={{ padding: '14px 16px', display: 'flex', gap: 14, alignItems: 'center', background: i % 2 ? C.card : C.card2 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text, marginBottom: 3 }}>
                {r.name}
                {r.edited && <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 6, background: '#2a1d4d', color: '#d9c6ff', fontSize: 10, fontWeight: 800 }}>EDITED</span>}
              </div>
              <div style={{ fontSize: 11.5, color: C.textDim, marginBottom: 4 }}>{r.description}</div>
              <div style={{ fontSize: 11, color: C.textDim }}>
                Subject: <span style={{ color: C.text }}>{r.subject}</span>
                {r.edited && r.updatedAt ? ` · changed ${fmtRelative(r.updatedAt)}` : ''}
              </div>
            </div>
            <button onClick={() => setEditing(r)} style={solidBtn(C.accent)}>Edit</button>
          </div>
        ))}
      </div>
    </>
  );
}

function TemplateEditor({ row, onCancel, onSaved, guarded }) {
  const { showToast } = useUI();
  const [design, setDesign] = useState({
    subject: row.subject || '', preheader: row.preheader || '', theme: row.theme || 'violet',
    hero: row.hero || { title: '', subtitle: '' },
    blocks: (row.blocks || []).map((b) => ({ ...b })),
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await guarded(() => call('adminSaveEmailTemplate', { templateId: row.templateId, ...design }));
      showToast('Saved', 'success');
      onSaved();
    } catch { /* guarded surfaces it */ }
    setBusy(false);
  };
  const reset = async () => {
    if (!window.confirm('Put this email back to the original design and wording? Your changes are discarded.')) return;
    try {
      await guarded(() => call('adminResetEmailTemplate', { templateId: row.templateId }));
      showToast('Back to the original', 'success');
      onSaved();
    } catch { /* ignore */ }
  };

  const footer = (
    <>
      {row.tokens?.some((t) => t !== 'name') && (
        <div style={{ marginTop: 14, padding: 10, borderRadius: 8, background: '#3b2a08', color: '#f5c842', fontSize: 11.5, lineHeight: 1.55 }}>
          Saving is refused if you delete a token that carries the whole point of this email, like the code or the link.
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={onCancel} style={solidBtn(C.card2, C.text)}>Cancel</button>
        {row.edited && <button onClick={reset} style={solidBtn('#3a1620', '#ff9aab')}>Back to original</button>}
        <div style={{ flex: 1 }} />
        <button onClick={save} disabled={busy} style={solidBtn(C.accent)}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </>
  );

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>{row.name}</div>
        <div style={{ fontSize: 12, color: C.textDim, marginTop: 3 }}>{row.description}</div>
      </div>
      <EmailDesigner design={design} onChange={setDesign} tokens={row.tokens || []} footer={footer}
        preview={(d) => call('adminPreviewEmailTemplate', { templateId: row.templateId, ...d })} />
    </>
  );
}
