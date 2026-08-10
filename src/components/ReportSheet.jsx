// ReportSheet — shared report-reason picker (11-doc P2.1). Same look as
// PostCard's inline report modal; reused by profile + comment reporting so
// every public surface lands reports in the same Vanguard queue.

import Icon from './Icon';

const REASONS = [
  'Spam or scam', 'Harassment or bullying', 'Hate speech',
  'Inappropriate content', 'Cheating or exploiting', 'Impersonation', 'Other',
];

export default function ReportSheet({ open, title = 'Report', onSubmit, onClose }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-surface-1 border border-white/[0.06] rounded-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-white/[0.04] flex items-center justify-between">
          <h3 className="font-syne font-bold text-sm">{title}</h3>
          <button onClick={onClose} className="text-text-muted p-1"><Icon name="close" size={18} /></button>
        </div>
        <div className="py-1">
          {REASONS.map(reason => (
            <button key={reason} onClick={() => onSubmit?.(reason)}
              className="w-full px-4 py-3 text-left text-sm text-text-primary hover:bg-surface-2 transition-colors">
              {reason}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
