// Designed emails to chosen users. Backend: functions/emailCampaigns.js, reached
// through adminListEmailTemplates({ op: 'campaign.*' }) so no new Cloud Function.
//
// Flow: write + design -> send a test (default @Verion) -> choose who gets it
// (everyone, categories, or people one by one) -> check the count -> send.
// Sending is done in batches from this screen with a progress bar; closing the
// screen pauses it and "Continue sending" picks up where it stopped. Every
// campaign carries an unsubscribe link, and people who used it are left out.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useUI } from '../../context/UIContext';
import Icon from '../../components/Icon';
import { ADMIN_COLORS as C } from './AdminShell';
import { call, fmtRelative, fmtTime } from './_adminGuarded';
import EmailDesigner, { FALLBACK_THEMES, input, chipBtn, solidBtn, L } from './EmailDesigner';

const op = (name, data = {}) => call('adminListEmailTemplates', { op: name, ...data });

const STARTER = {
  name: '',
  subject: 'News from Vergr',
  preheader: '',
  theme: 'violet',
  hero: { title: 'News from Vergr', subtitle: '' },
  blocks: [
    { type: 'heading', text: 'Hey {{name}},', url: '', alt: '', items: [], muted: false, align: 'left' },
    { type: 'paragraph', text: 'Write your message here.', url: '', alt: '', items: [], muted: false, align: 'left' },
    { type: 'button', text: 'Open Vergr', url: 'https://vergr.app', alt: '', items: [], muted: false, align: 'left' },
  ],
  audience: { mode: 'all', segments: [], uids: [] },
  pickedPeople: [],
};

const STATUS = {
  draft: { label: 'Draft', bg: '#2a2a40', fg: '#b8b8d8' },
  sending: { label: 'Sending', bg: '#3b2a08', fg: '#f5c842' },
  stopped: { label: 'Paused', bg: '#3a1620', fg: '#ff9aab' },
  sent: { label: 'Sent', bg: '#0f3322', fg: '#6fe3a5' },
};

export default function AdminEmailCampaigns({ guarded }) {
  const { showToast } = useUI();
  const [meta, setMeta] = useState({ segments: [], themes: FALLBACK_THEMES, smtpConfigured: true });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, l] = await Promise.all([op('campaign.meta'), op('campaign.list')]);
      setMeta(m);
      setRows(l.rows || []);
    } catch (e) { showToast(e?.message || 'Could not load emails', 'error'); }
    setLoading(false);
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  if (editing) {
    return <CampaignEditor initial={editing} meta={meta} guarded={guarded}
      onClose={() => { setEditing(null); load(); }} />;
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1, fontSize: 12, color: C.textDim, lineHeight: 1.55 }}>
          Designed emails you write and send to your users. Everyone who gets one can unsubscribe, and they are left out of every email after that.
        </div>
        <button onClick={() => setEditing({ ...STARTER })} style={solidBtn(C.accent)}>
          <Icon name="add" size={15} style={{ verticalAlign: '-3px', marginRight: 5 }} />New email
        </button>
      </div>
      <div style={{ background: C.card, borderRadius: 12, overflow: 'hidden' }}>
        {loading && <div style={{ padding: 20, fontSize: 12, color: C.textDim }}>Loading…</div>}
        {!loading && rows.length === 0 && (
          <div style={{ padding: 28, textAlign: 'center', fontSize: 12.5, color: C.textDim }}>No emails yet. Press New email to write the first one.</div>
        )}
        {rows.map((r, i) => {
          const st = STATUS[r.status] || STATUS.draft;
          return (
            <div key={r.id} style={{ padding: '14px 16px', display: 'flex', gap: 14, alignItems: 'center', background: i % 2 ? C.card : C.card2 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text, marginBottom: 3, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {r.name || r.subject}
                  <span style={{ padding: '2px 8px', borderRadius: 6, background: st.bg, color: st.fg, fontSize: 10.5, fontWeight: 800 }}>{st.label}</span>
                </div>
                <div style={{ fontSize: 11.5, color: C.textDim }}>
                  {r.subject}
                  {r.status === 'draft'
                    ? (r.updatedAt ? ` · edited ${fmtRelative(r.updatedAt)}` : '')
                    : ` · ${r.counts.sent} of ${r.counts.total} sent${r.counts.failed ? `, ${r.counts.failed} failed` : ''}${r.sentAt ? ` · ${fmtTime(r.sentAt)}` : ''}`}
                </div>
              </div>
              {r.status !== 'draft' && (
                <button onClick={async () => {
                  try { const d = await op('campaign.duplicate', { id: r.id }); const full = await op('campaign.get', { id: d.id }); setEditing(full); }
                  catch (e) { showToast(e?.message || 'Could not copy', 'error'); }
                }} style={chipBtn}>Copy</button>
              )}
              <button onClick={() => setEditing(r)} style={solidBtn(r.status === 'draft' ? C.accent : C.card2, r.status === 'draft' ? '#fff' : C.text)}>
                {r.status === 'draft' ? 'Edit' : 'Open'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CampaignEditor({ initial, meta, guarded, onClose }) {
  const { showToast } = useUI();
  const [id, setId] = useState(initial.id || null);
  const [name, setName] = useState(initial.name || '');
  const [design, setDesign] = useState({
    subject: initial.subject, preheader: initial.preheader || '', theme: initial.theme || 'violet',
    hero: initial.hero || { title: '', subtitle: '' }, blocks: initial.blocks || [],
  });
  const [audience, setAudience] = useState(initial.audience || { mode: 'all', segments: [], uids: [] });
  const [picked, setPicked] = useState(initial.pickedPeople || []);
  const [status, setStatus] = useState(initial.status || 'draft');
  const [counts, setCounts] = useState(initial.counts || { total: 0, sent: 0, failed: 0 });
  const [check, setCheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const [testHandle, setTestHandle] = useState('Verion');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);
  const locked = status !== 'draft';

  useEffect(() => () => { stopRef.current = true; }, []);
  // An audience change makes the last count stale.
  const audienceKey = JSON.stringify(audience) + picked.length;
  useEffect(() => { setCheck(null); }, [audienceKey]);

  const save = async (quiet = false) => {
    setSaving(true);
    try {
      const r = await op('campaign.save', { id, name, design, audience: { ...audience, uids: picked.map((p) => p.uid) }, pickedPeople: picked });
      setId(r.id);
      if (!quiet) showToast('Saved', 'success');
      setSaving(false);
      return r.id;
    } catch (e) {
      setSaving(false);
      showToast(e?.message || 'Could not save', 'error');
      throw e;
    }
  };

  const runCheck = async () => {
    setChecking(true);
    try { setCheck(await op('campaign.audience', { audience: { ...audience, uids: picked.map((p) => p.uid) } })); }
    catch (e) { showToast(e?.message || 'Could not count', 'error'); }
    setChecking(false);
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const r = await op('campaign.test', { id, design, handle: testHandle });
      showToast(`Test sent to @${r.handle}`, 'success');
    } catch (e) { showToast(e?.message || 'Test failed', 'error'); }
    setTesting(false);
  };

  const drain = async (cid) => {
    setRunning(true);
    stopRef.current = false;
    try {
      for (let guard = 0; guard < 2000 && !stopRef.current; guard++) {
        const r = await op('campaign.sendBatch', { id: cid });
        if (r.busy) { await new Promise((ok) => setTimeout(ok, 4000)); continue; }
        if (r.sent || r.failed) setCounts((c) => ({ ...c, sent: c.sent + (r.sent || 0), failed: c.failed + (r.failed || 0) }));
        if (r.done) {
          if (r.status === 'stopped') setStatus('stopped');
          else { setStatus('sent'); showToast('All sent', 'success'); }
          break;
        }
      }
    } catch (e) { showToast(e?.message || 'Sending stopped', 'error'); }
    setRunning(false);
  };

  const startSend = async () => {
    setConfirm(null);
    try {
      const cid = await save(true);
      const r = await guarded(() => op('campaign.queue', { id: cid }));
      setStatus('sending');
      setCounts({ total: r.total, sent: 0, failed: 0 });
      drain(cid);
    } catch { /* surfaced */ }
  };

  const stop = async () => {
    stopRef.current = true;
    try { await op('campaign.stop', { id }); setStatus('stopped'); } catch (e) { showToast(e?.message || 'Could not pause', 'error'); }
  };
  const resume = async () => {
    try { await guarded(() => op('campaign.resume', { id })); setStatus('sending'); drain(id); } catch { /* surfaced */ }
  };
  const del = async () => {
    if (!id) { onClose(); return; }
    if (!window.confirm('Delete this draft?')) return;
    try { await op('campaign.delete', { id }); onClose(); } catch (e) { showToast(e?.message || 'Could not delete', 'error'); }
  };

  const pct = counts.total ? Math.round(((counts.sent + counts.failed) / counts.total) * 100) : 0;

  const sideTop = (
    <>
      {status !== 'draft' && (
        <Panel title="Sending">
          <div style={{ fontSize: 22, fontWeight: 800, color: C.text, fontFamily: 'DM Mono, monospace' }}>
            {counts.sent}<span style={{ color: C.textDim, fontSize: 14 }}> / {counts.total}</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: C.bg, margin: '10px 0' }}>
            <div style={{ width: `${pct}%`, height: '100%', borderRadius: 4, background: status === 'sent' ? '#2fbf71' : C.accent, transition: 'width .3s' }} />
          </div>
          <div style={{ fontSize: 11.5, color: C.textDim, marginBottom: 10 }}>
            {status === 'sent' && 'Finished.'}
            {status === 'sending' && (running ? 'Sending in small batches. Keep this screen open.' : 'Paused because the screen was closed.')}
            {status === 'stopped' && 'Paused. Nobody left in the queue gets it until you continue.'}
            {counts.failed ? ` ${counts.failed} could not be delivered.` : ''}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {status === 'sending' && running && <button onClick={stop} style={solidBtn('#3a1620', '#ff9aab')}>Pause</button>}
            {(status === 'stopped' || (status === 'sending' && !running)) && (
              <button onClick={status === 'stopped' ? resume : () => drain(id)} style={solidBtn(C.accent)}>Continue sending</button>
            )}
          </div>
        </Panel>
      )}

      <Panel title="Send a test">
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <span style={{ position: 'absolute', left: 10, top: 9, color: C.textDim, fontSize: 12.5 }}>@</span>
            <input value={testHandle} onChange={(e) => setTestHandle(e.target.value.replace(/^@/, ''))} style={{ ...input, paddingLeft: 24 }} />
          </div>
          <button onClick={sendTest} disabled={testing || !meta.smtpConfigured} style={solidBtn(C.card2, C.text)}>
            {testing ? 'Sending…' : 'Send test'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: C.textDim, marginTop: 7 }}>Goes to that account's email with [Test] in the subject. Nobody else gets it.</div>
      </Panel>
    </>
  );

  const footer = (
    <>
      <div style={{ height: 20 }} />
      <AudiencePicker audience={audience} setAudience={setAudience} picked={picked} setPicked={setPicked}
        segments={meta.segments} locked={locked} />
      <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: C.card2, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, fontSize: 12, color: C.textDim, lineHeight: 1.5 }}>
          {check ? (
            <>
              <b style={{ color: C.text, fontSize: 14 }}>{check.count} {check.count === 1 ? 'person' : 'people'}</b> will get this.
              {check.sample?.length > 0 && <div style={{ marginTop: 3 }}>{check.sample.join(', ')}{check.count > check.sample.length ? '…' : ''}</div>}
              <div style={{ marginTop: 3 }}>
                Left out: {check.skipped.noEmail} with no email (guests), {check.skipped.optedOut} unsubscribed, {check.skipped.banned} banned or disabled.
              </div>
            </>
          ) : 'Check how many people this reaches before you send.'}
        </div>
        {!locked && <button onClick={runCheck} disabled={checking} style={solidBtn(C.card, C.text)}>{checking ? 'Counting…' : 'Check audience'}</button>}
      </div>

      {!locked && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <button onClick={onClose} style={solidBtn(C.card2, C.text)}>Back</button>
          <button onClick={del} style={solidBtn('#3a1620', '#ff9aab')}>Delete</button>
          <div style={{ flex: 1 }} />
          <button onClick={() => save()} disabled={saving} style={solidBtn(C.card2, C.text)}>{saving ? 'Saving…' : 'Save draft'}</button>
          <button disabled={!meta.smtpConfigured} onClick={async () => {
            try {
              const r = await op('campaign.audience', { audience: { ...audience, uids: picked.map((p) => p.uid) } });
              setCheck(r);
              if (!r.count) { showToast('Nobody in this audience can receive email', 'error'); return; }
              setConfirm(r);
            } catch (e) { showToast(e?.message || 'Could not count', 'error'); }
          }} style={solidBtn(C.accent)}>
            <Icon name="send" size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />Send
          </button>
        </div>
      )}
      {locked && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={solidBtn(C.card2, C.text)}>Back</button>
        </div>
      )}
    </>
  );

  return (
    <div>
      {!meta.smtpConfigured && (
        <div style={{ padding: 12, marginBottom: 14, borderRadius: 10, background: '#3b2a08', color: '#f5c842', fontSize: 12 }}>
          Email is not configured on the server, so nothing can be sent.
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <button onClick={onClose} aria-label="Back" style={{ ...chipBtn, padding: 7 }}><Icon name="arrow_back" size={16} /></button>
        <input value={name} onChange={(e) => setName(e.target.value)} disabled={locked}
          placeholder="Name for this email (only you see it)" style={{ ...input, fontSize: 15, fontWeight: 700, maxWidth: 480 }} />
        {locked && <span style={{ fontSize: 11.5, color: C.textDim }}>Sent emails cannot be edited. Use Copy on the list to reuse it.</span>}
      </div>
      <div style={locked ? { pointerEvents: 'none', opacity: 1 } : undefined}>
        <EmailDesigner design={design} onChange={setDesign} themes={meta.themes?.length ? meta.themes : FALLBACK_THEMES}
          tokens={['name', 'username']} preview={(d) => op('campaign.preview', { design: d })}
          footer={<div style={{ pointerEvents: 'auto' }}>{footer}</div>}
          sideTop={<div style={{ pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>{sideTop}</div>} />
      </div>

      {confirm && (
        <div style={{ position: 'fixed', inset: 0, background: '#000000b3', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ width: 420, maxWidth: 'calc(100vw - 32px)', background: C.card, borderRadius: 16, padding: 22 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.text, marginBottom: 8 }}>Send to {confirm.count} {confirm.count === 1 ? 'person' : 'people'}?</div>
            <div style={{ fontSize: 12.5, color: C.textDim, lineHeight: 1.6, marginBottom: 6 }}>
              Subject: <b style={{ color: C.text }}>{design.subject}</b>
            </div>
            <div style={{ fontSize: 12.5, color: C.textDim, lineHeight: 1.6, marginBottom: 18 }}>
              This cannot be undone once an email has gone out. You will be asked for your authenticator code.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirm(null)} style={solidBtn(C.card2, C.text)}>Cancel</button>
              <button onClick={startSend} style={solidBtn(C.accent)}>Send now</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AudiencePicker({ audience, setAudience, picked, setPicked, segments, locked }) {
  const { showToast } = useUI();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  const [searching, setSearching] = useState(false);
  const mode = audience.mode || 'all';

  useEffect(() => {
    const term = q.trim();
    if (mode !== 'pick' || term.length < 2) { setHits([]); return undefined; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await call('adminListUsers', { search: term, pageSize: 10 });
        setHits(r.rows || []);
      } catch (e) { showToast(e?.message || 'Search failed', 'error'); }
      setSearching(false);
    }, 350);
    return () => clearTimeout(t);
  }, [q, mode, showToast]);

  const MODES = [
    { id: 'all', label: 'Everyone', icon: 'public' },
    { id: 'segments', label: 'Categories', icon: 'category' },
    { id: 'pick', label: 'Pick people', icon: 'person_add' },
  ];
  const toggleSeg = (sid) => {
    const on = (audience.segments || []).includes(sid);
    setAudience({ ...audience, segments: on ? audience.segments.filter((x) => x !== sid) : [...(audience.segments || []), sid] });
  };
  const labelOf = (u) => (u.username ? '@' + u.username : (u.displayName || u.uid));

  return (
    <div>
      <L>Who gets it</L>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {MODES.map((m) => (
          <button key={m.id} disabled={locked} onClick={() => setAudience({ ...audience, mode: m.id })} style={{
            ...chipBtn, flex: 1, padding: '10px 8px',
            background: mode === m.id ? C.accent : C.card2, color: mode === m.id ? '#fff' : C.textDim,
          }}>
            <Icon name={m.icon} size={14} style={{ verticalAlign: '-3px', marginRight: 6 }} />{m.label}
          </button>
        ))}
      </div>

      {mode === 'all' && (
        <div style={{ fontSize: 12, color: C.textDim }}>Every account with an email address, except people who unsubscribed and banned accounts.</div>
      )}

      {mode === 'segments' && (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {segments.map((s) => {
              const on = (audience.segments || []).includes(s.id);
              return (
                <button key={s.id} disabled={locked} onClick={() => toggleSeg(s.id)} style={{
                  ...chipBtn, background: on ? C.accent : C.card2, color: on ? '#fff' : C.text,
                }}>
                  {on && <Icon name="check" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />}{s.label}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11.5, color: C.textDim, marginTop: 8 }}>Anyone in at least one of the picked categories gets it.</div>
        </>
      )}

      {mode === 'pick' && (
        <>
          {!locked && (
            <div style={{ position: 'relative' }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by username, name or email" style={input} />
              {(hits.length > 0 || searching) && (
                <div style={{ marginTop: 6, borderRadius: 10, background: C.card2, overflow: 'hidden' }}>
                  {searching && <div style={{ padding: 10, fontSize: 12, color: C.textDim }}>Searching…</div>}
                  {hits.map((u) => {
                    const on = picked.some((p) => p.uid === u.uid);
                    return (
                      <button key={u.uid} disabled={on} onClick={() => {
                        setPicked([...picked, { uid: u.uid, label: labelOf(u) }]);
                        setAudience({ ...audience, uids: [...(audience.uids || []), u.uid] });
                      }} style={{
                        display: 'flex', width: '100%', alignItems: 'center', gap: 10, padding: '9px 12px', border: 0,
                        background: 'transparent', color: C.text, cursor: on ? 'default' : 'pointer', textAlign: 'left', fontSize: 12.5,
                      }}>
                        <span style={{ flex: 1 }}>{u.displayName || u.username} <span style={{ color: C.textDim }}>{u.username ? '@' + u.username : ''}</span></span>
                        <Icon name={on ? 'check' : 'add'} size={16} style={{ color: on ? '#6fe3a5' : C.textDim }} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            {picked.length === 0 && <span style={{ fontSize: 12, color: C.textDim }}>Nobody picked yet.</span>}
            {picked.map((p) => (
              <span key={p.uid} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 6px 5px 10px', borderRadius: 8, background: C.card2, color: C.text, fontSize: 12 }}>
                {p.label}
                {!locked && (
                  <button aria-label={`Remove ${p.label}`} onClick={() => {
                    setPicked(picked.filter((x) => x.uid !== p.uid));
                    setAudience({ ...audience, uids: (audience.uids || []).filter((x) => x !== p.uid) });
                  }} style={{ border: 0, background: 'transparent', color: C.textDim, cursor: 'pointer', padding: 0, display: 'flex' }}>
                    <Icon name="close" size={14} />
                  </button>
                )}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div style={{ background: C.card, borderRadius: 12, padding: 14 }}>
      <L>{title}</L>
      {children}
    </div>
  );
}
