// /appeal?type=post|stream|mute&id=<id>
//
// Where the moderation notifications point ("Your post was hidden", "Your live
// stream was ended"). The form itself is the shared <AppealForm>; this page only
// resolves what is being appealed. A mute or a ban is always about the signed-in
// account, so it takes no id. (A banned account appeals from the ban screen,
// BannedGate, because the rest of the app is locked for it.)

import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import TopBar from '../../components/TopBar';
import { AppealForm, APPEAL_COPY } from '../../components/moderation/Appeal';

export default function AppealScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const type = params.get('type') || '';
  const self = type === 'mute' || type === 'account';
  const id = self ? currentUser?.uid : params.get('id');
  const valid = !!APPEAL_COPY[type] && !!id;

  return (
    <div className="min-h-screen bg-bg-dark">
      <TopBar title="Appeal" showBack />
      <div className="max-w-lg mx-auto px-4 py-6">
        {valid ? (
          <div className="bg-surface-1 rounded-2xl p-5">
            <AppealForm targetType={type} targetId={id} onCancel={() => navigate(-1)} />
          </div>
        ) : (
          <p className="text-text-secondary text-sm text-center py-10">
            This appeal link is missing what it is about. Open it again from the notification.
          </p>
        )}
      </div>
    </div>
  );
}
