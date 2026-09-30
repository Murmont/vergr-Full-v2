// Monthly payout limit + the route to a higher one (identity Level 2 / 3).
//
// The help centre promises "The app will tell you when a step is needed". This
// is that step: it shows the limit for the creator's level, what has used it
// this calendar month, what is waiting above it, and how to raise it.
// Data: getPayoutAccount().limits / .upgrade. Upload: utils/payoutVerification.
import { useState } from 'react';
import { Card, SectionHeader } from './Widgets';
import Icon from '../Icon';
import {
  DOC_TYPES, LEVEL_ASK, REJECT_COPY, MAX_FILES, fileProblem, submitPayoutVerification,
} from '../../utils/payoutVerification';

const NUM = 'font-dmmono font-bold tabular-nums';
const usd = (micro) => `$${((Number(micro) || 0) / 1e6).toLocaleString(undefined, {
  minimumFractionDigits: 0, maximumFractionDigits: 2,
})}`;

export default function RaisePayoutLimit({ uid, limits, upgrade, onSubmitted }) {
  const [docType, setDocType] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!limits || limits.level < 1) return null; // Level 1 is the Didit step above.

  const next = limits.nextLevel;
  const pending = upgrade?.status === 'pending';
  const rejected = upgrade?.status === 'rejected' && upgrade?.targetLevel === next;
  const canUpload = !!next && !pending;
  const options = next ? DOC_TYPES[next] : [];

  const submit = async () => {
    setError('');
    const problem = !docType ? 'Choose what kind of document it is.' : fileProblem(files);
    if (problem) { setError(problem); return; }
    setBusy(true);
    try {
      await submitPayoutVerification(uid, { targetLevel: next, docType, files });
      setFiles([]); setDocType('');
      onSubmitted?.();
    } catch (e) {
      setError(e?.message || 'Upload failed. Try again.');
    }
    setBusy(false);
  };

  return (
    <Card>
      <div className="px-4 pt-4">
        <SectionHeader title="Your monthly payout limit" subtitle={`Level ${limits.level} verification`} />
      </div>

      <div className="px-4 pb-4 pt-2 space-y-3">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className={`${NUM} text-2xl text-text-primary`}>{usd(limits.monthlyCapMicroUsd)}</span>
          <span className="text-sm text-text-secondary">a month</span>
          <span className="text-xs text-text-muted ml-auto">
            {usd(limits.paidThisMonthMicroUsd)} paid this month
          </span>
        </div>

        {limits.aboveCapMicroUsd > 0 && (
          <div className="rounded-xl px-3 py-2.5 text-xs" style={{ background: '#1E1A2E', color: '#E5E7EB' }}>
            <span className={`${NUM} text-brand-gold`}>{usd(limits.aboveCapMicroUsd)}</span>{' '}
            is over this month&apos;s limit. It is not lost: it is paid in later months
            {next ? ', or sooner once your limit is raised.' : '.'}
          </div>
        )}

        {!next && (
          <p className="text-xs text-text-muted">This is the highest verification level.</p>
        )}

        {next && pending && (
          <div className="flex items-start gap-2 text-sm">
            <Icon name="schedule" className="text-brand-violet-light text-lg shrink-0" />
            <div>
              <div className="font-bold text-text-primary">Level {upgrade.targetLevel} under review</div>
              <div className="text-xs text-text-muted">We will notify you when it has been checked. Your document is deleted once reviewed.</div>
            </div>
          </div>
        )}

        {canUpload && (
          <div className="rounded-xl p-3 space-y-3" style={{ background: '#16141F' }}>
            <div>
              <div className="font-bold text-sm text-text-primary">
                Raise it to {usd(limits.nextLevelCapMicroUsd)} a month: {LEVEL_ASK[next].title.toLowerCase()}
              </div>
              <div className="text-xs text-text-muted mt-0.5">{LEVEL_ASK[next].body}</div>
            </div>

            {rejected && (
              <div className="text-xs font-bold" style={{ color: '#F5C842' }}>
                {REJECT_COPY[upgrade.rejectionReason] || REJECT_COPY.other} Upload a new one below.
              </div>
            )}

            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Document type">
              {options.map((o) => (
                <button key={o.key} type="button" role="radio" aria-checked={docType === o.key}
                  onClick={() => setDocType(o.key)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold"
                  style={docType === o.key
                    ? { background: '#7B1FFF', color: '#FFFFFF' }
                    : { background: '#221F31', color: '#C4C4D0' }}>
                  {o.label}
                </button>
              ))}
            </div>

            <label className="block">
              <span className="sr-only">Choose files</span>
              <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, MAX_FILES))}
                className="block w-full text-xs text-text-secondary file:mr-3 file:rounded-lg file:border-0 file:px-3 file:py-1.5 file:text-xs file:font-bold file:bg-[#221F31] file:text-white" />
            </label>
            <div className="text-[11px] text-text-muted">
              PDF, JPG, PNG or WebP, up to 5 MB each, up to {MAX_FILES} files. Seen only by the Vergr staff member
              who reviews it, and deleted as soon as it has been reviewed.
            </div>

            {error && <div className="text-xs font-bold" style={{ color: '#F04060' }}>{error}</div>}

            <button type="button" onClick={submit} disabled={busy}
              className="w-full px-3 py-2.5 rounded-lg text-sm font-bold text-white"
              style={{ background: busy ? '#3A3450' : '#7B1FFF' }}>
              {busy ? 'Uploading…' : 'Send for review'}
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}
