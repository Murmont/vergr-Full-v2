// Retired in Phase 6 — the old `/stream/:id` mockup was a static demo with no
// player and hardcoded metadata. The real viewer screen is ViewerStreamScreen
// at `/watch/:streamId`. We keep this file + the `/stream/:id` route per
// CLAUDE.md hard rule ("never remove a route without permission"); it simply
// redirects callers to the live viewer.
import { Navigate, useParams } from 'react-router-dom';

export default function LiveStreamScreen() {
  const { streamId } = useParams();
  return <Navigate to={streamId ? `/watch/${streamId}` : '/'} replace />;
}
