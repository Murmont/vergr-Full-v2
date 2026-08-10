import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import LoadingScreen from './LoadingScreen';
import { PublicPostScreen, PublicUserScreen, PublicWatchScreen } from '../screens/public/PublicUgcScreens';

// Shareable content routes render a public read-only view for logged-out
// visitors (the share-to-grow loop) instead of bouncing them to /login.
// Everything else keeps the login redirect. The public screens read route
// params via useParams (React Router merges matched-child params up the
// tree, so rendering them here at the layout gate still resolves :postId etc).
function publicFallbackFor(pathname) {
  if (/^\/(post|clip)\/[^/]+\/?$/.test(pathname)) return <PublicPostScreen />;
  if (/^\/user\/[^/]+\/?$/.test(pathname)) return <PublicUserScreen />;
  if (/^\/watch\/[^/]+\/?$/.test(pathname)) return <PublicWatchScreen />;
  return null;
}

export default function ProtectedRoute({ children }) {
  const { currentUser, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;
  if (!currentUser) {
    const pub = publicFallbackFor(location.pathname);
    if (pub) return pub;
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return children;
}
