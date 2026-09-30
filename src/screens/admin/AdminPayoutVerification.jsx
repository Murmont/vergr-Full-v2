// Payout verification review: approve or reject a creator's Level 2 (proof of
// address) or Level 3 (source of funds) document. Lives in the Creators screen,
// under the same 'creators' grant. Server: functions/payoutVerification.js,
// reached through the EXISTING reviewKyc / decideKyc callables (kind 'payout_level').
//
// Documents are fetched one at a time (a callable response is capped at 10 MB)
// and are deleted on the server the moment a decision is saved. A PDF is shown
// from a blob: URL, which only the Vergr Admin CSP allows (tauri.admin.conf.json).
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon';
import { callCreator } from '../creator/BecomeCreatorScreen';
import { DOC_TYPES, REJECT_COPY } from '../../utils/payoutVerification';

const STATUS_TABS = [
  { key: 'pending', label: 'To review' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];
const REASONS = Object.keys(REJECT_COPY);
const fmt = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const docLabel = (level, key) => (DOC_TYPES[level] || []).find((d) => d.key === key)?.label || key || '—';

export default function AdminPayoutVerification() {
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(null);       // openRequest() result
  const [fileIndex, setFileIndex] = useState(0);
  const [viewUrl, setViewUrl] = useState(null);
  const [reason, setReason] = useState('unreadable');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const urlRef = useRef(null);

  const setBlob = (url) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;
    setViewUrl(url);
  };
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const load = useCallback(async (s) => {
    setLoading(true); setMsg(''); setSel(null); setBlob(null);
    try {
      const d = await callCreator('reviewKyc', { kind: 'payout_level', list: true, status: s });
      setRows(d.requests || []);
    } catch (e) { setMsg(e.message || 'Could not load requests.'); }
    setLoading(false);
  }, []);
  useEffect(() => { load(status); }, [status, load]);

  const open = async (uid, i = 0) => {
    setBusy(true); setMsg('');
    try {
      const d = await callCreator('reviewKyc', { kind: 'payout_level', uid, fileIndex: i });
      setSel(d); setFileIndex(i);
      if (d.file?.dataUrl) {
        const blob = await (await fetch(d.file.dataUrl)).blob();
        setBlob(URL.createObjectURL(blob));
      } else setBlob(null);
    } catch (e) { setMsg(e.message || 'Could not open the request.'); }
    setBusy(false);
  };

  const decide = async (decision) => {
    if (!sel) return;
    setBusy(true); setMsg('');
    try {
      await callCreator('decideKyc', {
        kind: 'payout_level', uid: sel.request.uid, decision,
        reason: decision === 'rejected' ? reason : null, note: note || null,
      });
      setNote('');
      setMsg(decision === 'approved'
        ? `Approved. Level ${sel.request.targetLevel} is active and the document was deleted.`
        : 'Rejected. The creator was told why and the document was deleted.');
      await load(status);
    } catch (e) { setMsg(e.message || 'Could not save the decision.'); }
    setBusy(false);
  };

  const r = sel?.request;
  const isPdf = sel?.file?.contentType === 'application/pdf';

  return (
    <div>
      <div className="flex gap-2 mb-3">
        {STATUS_TABS.map((t) => (
          <button key={t.key} onClick={() => setStatus(t.key)}
            className="rounded-lg px-3 py-1.5 text-xs font-bold"
            style={status === t.key ? { background: '#F5C842', color: '#14110A' } : { background: '#1C1B26', color: '#9CA3AF' }}>
            {t.label}
          </button>
        ))}
      </div>
      {msg && <div className="text-xs mb-3" style={{ color: '#F5C842' }}>{msg}</div>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)]">
        <div className="rounded-2xl p-2" style={{ background: '#14141F' }}>
          {loading ? <div className="p-6 text-center text-sm text-text-muted">Loading…</div>
            : !rows.length ? <div className="p-6 text-center text-sm text-text-muted">Nothing here.</div>
              : rows.map((x) => (
                <button key={x.uid} onClick={() => status === 'pending' && open(x.uid)} disabled={status !== 'pending'}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left"
                  style={r?.uid === x.uid ? { background: '#221F31' } : {}}>
                  <img src={x.avatar || '/brand/avatar-default.webp'} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-text-primary truncate">{x.displayName || x.username || x.uid.slice(0, 8)}</div>
                    <div className="text-[11px] text-text-muted truncate">
                      Level {x.kycLevel} to {x.targetLevel} · {docLabel(x.targetLevel, x.docType)} · {fmt(x.submittedAtMs)}
                      {x.rejectionReason ? ` · ${x.rejectionReason}` : ''}
                    </div>
                  </div>
                </button>
              ))}
        </div>

        <div className="rounded-2xl p-4" style={{ background: '#14141F' }}>
          {!sel ? <div className="text-sm text-text-muted">Choose a request to review.</div> : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><div className="text-text-muted">Verified name (Didit)</div><div className="font-bold text-text-primary">{sel.verifiedLegalName || 'NOT ON FILE'}</div></div>
                <div><div className="text-text-muted">Countries</div><div className="font-bold text-text-primary">ID {sel.verifiedCountry || '—'} · profile {sel.profileCountry || '—'}</div></div>
                <div><div className="text-text-muted">Asking for</div><div className="font-bold text-text-primary">Level {sel.currentLevel} to {r.targetLevel}</div></div>
                <div><div className="text-text-muted">Document</div><div className="font-bold text-text-primary">{docLabel(r.targetLevel, r.docType)}</div></div>
              </div>
              <div className="text-[11px] text-text-muted">
                Check: the name matches the verified name, {r.targetLevel === 2
                  ? 'it shows a home address, and it is dated within the last 3 months.'
                  : 'it shows where the money comes from, in their name.'}
              </div>

              {r.fileCount > 1 && (
                <div className="flex gap-2">
                  {Array.from({ length: r.fileCount }, (_, i) => (
                    <button key={i} onClick={() => open(r.uid, i)} disabled={busy}
                      className="rounded-lg px-2.5 py-1 text-xs font-bold"
                      style={i === fileIndex ? { background: '#7B1FFF', color: '#fff' } : { background: '#221F31', color: '#C4C4D0' }}>
                      File {i + 1}
                    </button>
                  ))}
                </div>
              )}

              <div className="rounded-xl overflow-hidden" style={{ background: '#0B0B14', height: 520 }}>
                {!viewUrl ? <div className="p-6 text-sm text-text-muted">No document.</div>
                  : isPdf ? <iframe title="Document" src={viewUrl} className="w-full h-full" />
                    : <img src={viewUrl} alt="Document" className="w-full h-full object-contain" />}
              </div>

              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Private note (optional)"
                className="w-full rounded-lg p-2 text-xs text-text-primary" style={{ background: '#1C1B26' }} />

              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => decide('approved')} disabled={busy || !sel.verifiedLegalName}
                  className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: busy ? '#3A3450' : '#16A34A' }}>
                  <Icon name="check" className="text-base align-middle" /> Approve
                </button>
                <select value={reason} onChange={(e) => setReason(e.target.value)}
                  className="rounded-lg px-2 py-2 text-xs text-text-primary" style={{ background: '#1C1B26' }}>
                  {REASONS.map((k) => <option key={k} value={k}>{REJECT_COPY[k]}</option>)}
                </select>
                <button onClick={() => decide('rejected')} disabled={busy}
                  className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: busy ? '#3A3450' : '#B91C1C' }}>
                  Reject
                </button>
              </div>
              {!sel.verifiedLegalName && (
                <div className="text-[11px]" style={{ color: '#F5C842' }}>
                  No Didit-verified name is stored for this creator, so the document cannot be matched to them. Approval is disabled.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
