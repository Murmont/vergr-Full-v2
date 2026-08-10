// NativeChatDetailScreen — dedicated phone build of /messages/:chatId/details.
// Renders the shared, already-phone-first ChatDetailsPanel (page variant:
// safe-area inset, single column, glass, brand violet). Reusing the panel keeps
// one source of truth for the contact-info logic + shared-media loaders.
import { useNavigate, useParams } from 'react-router-dom';
import { ChatDetailsPanel } from '../ChatDetailScreen';

export default function NativeChatDetailScreen() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-dark)' }}>
      <ChatDetailsPanel chatId={chatId} variant="page" onClose={() => navigate(-1)} />
    </div>
  );
}
