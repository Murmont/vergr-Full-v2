// AdminRouteGate — blocks the route unless the current user is admin or
// a sub-admin with the named screen permission. Pure client-side gate;
// real authority lives in Firestore rules + Cloud Function checks.
//
// Usage:  <AdminRouteGate screen="cheat-signatures"><Screen /></AdminRouteGate>

import { Navigate } from 'react-router-dom';
import useAdminAccess from '../hooks/useAdminAccess';

export default function AdminRouteGate({ screen, children }) {
  const { loading, isAdmin, can } = useAdminAccess();
  if (loading) return null;
  if (!isAdmin) return <Navigate to="/" replace />;
  if (screen && !can(screen)) return <Navigate to="/admin" replace />;
  return children;
}
