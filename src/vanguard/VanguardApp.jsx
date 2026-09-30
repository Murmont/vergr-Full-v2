// Vergr Vanguard — the moderation app, as its own application (2026-09-21).
//
// Built exactly like Vergr Admin (src/admin/AdminApp.jsx): it reuses the SAME
// Vanguard screens the web app had at /vanguard/* (VanguardRoutes), so there is
// one implementation of every moderation surface, and wraps them in a gate
// (VanguardGate) and a self-updater on the locked channel.
//
// ⚠ MemoryRouter, not BrowserRouter, for the same reason as Vergr Admin: a
// packaged Tauri app has no server to answer a reload on a deep path.
//
// ⚠ THIS APP HAS NO CONSUMER ROUTES. A profile, a post or a live stream opens
// on vergr.app through src/admin/openExternal.js (openInVergr), never through
// navigate(), which would bounce to the queue.

import { lazy, Suspense, useContext, useMemo } from 'react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { UserProvider, UserContext } from '../context/UserContext';
import { UIProvider } from '../context/UIContext';
import { LayoutProvider } from '../context/LayoutContext';
import ErrorBoundary from '../components/ErrorBoundary';
import AdminUpdateGate from '../admin/AdminUpdateGate';
import VanguardGate from './VanguardGate';

const VanguardRoutes = lazy(() => import('../router/VanguardRoutes'));

const FALLBACK = (
  <div style={{ background: '#07070f', minHeight: '100vh', color: '#7070a0', padding: 60, textAlign: 'center' }}>
    Loading…
  </div>
);

// ⚠ THE OPERATOR HAS NO users DOCUMENT, so every Vanguard screen, which reads
// `profile` for the viewer's rank, would see null and treat the founder as a
// stranger. The server already treats the operator as a synthetic Overseer
// (functions/vanguard.js loadActor), so the screens get the matching stand-in
// here. It lives in memory only; nothing writes it anywhere, and every action
// is still decided by the server, not by this object.
function OperatorProfile({ isOperator, children }) {
  const ctx = useContext(UserContext);
  const { currentUser } = useAuth();
  const value = useMemo(() => {
    if (!isOperator || !ctx || ctx.profile) return ctx;
    return {
      ...ctx,
      profile: {
        uid: currentUser?.uid || null,
        id: currentUser?.uid || null,
        displayName: 'Vergr',
        username: 'vergr-operator',
        role: 'admin',
        staff: true,
        operator: true,
      },
    };
  }, [ctx, isOperator, currentUser?.uid]);
  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export default function VanguardApp() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <UserProvider>
          <UIProvider>
            <LayoutProvider>
              {/* ⚠ OUTSIDE the gate on purpose: an app too old to sign in must
                  still be able to update itself. */}
              <AdminUpdateGate ticketField="vanguardTicket" appName="Vergr Vanguard">
                <MemoryRouter initialEntries={['/vanguard/today']}>
                  <VanguardGate>
                    {({ isOperator }) => (
                      <OperatorProfile isOperator={isOperator}>
                        <Suspense fallback={FALLBACK}>
                          <Routes>
                            <Route path="/vanguard/*" element={<VanguardRoutes />} />
                            <Route path="*" element={<Navigate to="/vanguard/today" replace />} />
                          </Routes>
                        </Suspense>
                      </OperatorProfile>
                    )}
                  </VanguardGate>
                </MemoryRouter>
              </AdminUpdateGate>
            </LayoutProvider>
          </UIProvider>
        </UserProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
