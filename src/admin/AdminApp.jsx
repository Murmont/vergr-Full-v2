// Vergr Admin — the operator console, as its own application.
//
// It reuses the SAME admin screens the web app had at /admin/* (AdminRoutes),
// so there is one implementation of every admin surface and they cannot drift.
// What is different is everything around them: no feed, no marketing, no
// service worker, no presence, no AdSense, and an OperatorGate in front.
//
// ⚠ MemoryRouter, not BrowserRouter, ON PURPOSE. A packaged Tauri app is served
// over a custom protocol; a reload on a deep path like /admin/users has no
// server to answer it. MemoryRouter keeps the whole route tree in memory, so
// there is no URL to reload and no base-path problem. Admin screens are all
// reached by navigation, never by a pasted link.

import { lazy, Suspense } from 'react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import { UserProvider } from '../context/UserContext';
import { UIProvider } from '../context/UIContext';
import { LayoutProvider } from '../context/LayoutContext';
import ErrorBoundary from '../components/ErrorBoundary';
import OperatorGate from './OperatorGate';
import AdminUpdateGate from './AdminUpdateGate';

// Lazy for the same reason the web build did it: the admin screens are a large
// chunk, and the sign-in gate should paint immediately.
const AdminRoutes = lazy(() => import('../router/AdminRoutes'));

const FALLBACK = (
  <div style={{ background: '#09090f', minHeight: '100vh', color: '#7070a0', padding: 60, textAlign: 'center' }}>
    Loading…
  </div>
);

export default function AdminApp() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        {/* UserProvider is mounted so the shared admin screens keep working
            unchanged. The operator has NO users document, so `profile` stays
            null here — every consumer already guards for that. */}
        <UserProvider>
          <UIProvider>
            <LayoutProvider>
              {/* ⚠ OUTSIDE OperatorGate on purpose: a console too old to
                  sign in must still be able to update itself. */}
              <AdminUpdateGate>
              <MemoryRouter initialEntries={['/admin']}>
                <OperatorGate>
                  <Suspense fallback={FALLBACK}>
                    <Routes>
                      <Route path="/admin/*" element={<AdminRoutes />} />
                      <Route path="*" element={<Navigate to="/admin" replace />} />
                    </Routes>
                  </Suspense>
                </OperatorGate>
              </MemoryRouter>
              </AdminUpdateGate>
            </LayoutProvider>
          </UIProvider>
        </UserProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
