// TakedownNotice: tells a host that VERGR ended their stream, and why.
//
// Without it a takedown looked like the broadcast simply died: the ingest
// server stops accepting video (functions/streamTakedown.js) and the screen
// flips to ended with no explanation. Shown by both broadcasters (web and
// phone) when the stream doc carries `takenDownAt`.

import { useNavigate } from 'react-router-dom';
import Icon from '../Icon';

export default function TakedownNotice({ streamId, reason, onClose }) {
  const navigate = useNavigate();
  return (
    <div className="fixed inset-0 z-[9000] bg-bg-dark flex items-center justify-center p-6" role="alertdialog" aria-modal="true">
      <div className="max-w-md w-full bg-surface-1 rounded-2xl p-6 text-center">
        <div className="w-14 h-14 rounded-full bg-surface-2 flex items-center justify-center mx-auto mb-4">
          <Icon name="block" size={28} className="text-brand-ember" />
        </div>
        <h2 className="font-syne text-xl font-bold mb-2">Vergr ended this stream</h2>
        <p className="text-text-secondary text-sm leading-relaxed mb-5">
          {reason || 'It broke the Vergr rules.'} You can appeal if you think this is wrong.
        </p>
        <button
          type="button"
          onClick={() => navigate(`/appeal?type=stream&id=${encodeURIComponent(streamId)}`)}
          className="block w-full py-3 rounded-xl bg-brand-violet text-white text-sm font-semibold mb-3"
        >
          Appeal
        </button>
        <button
          type="button"
          onClick={onClose}
          className="block w-full py-3 rounded-xl bg-surface-2 text-text-primary text-sm font-semibold"
        >
          Close
        </button>
      </div>
    </div>
  );
}
