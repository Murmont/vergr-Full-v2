// AdminRoutes — all /admin/* screens, split into their own lazy chunk.
//
// SECURITY: this module is imported ONLY via `lazy(() => import('./AdminRoutes'))`
// and that import is gated behind `__VERGR_NATIVE__` in AppRouter, so on the
// native (APK) build the whole admin chunk — every AdminXScreen, the cheat
// signatures screen, and their code — is tree-shaken out and never ships to the
// mobile app. On web it loads on demand only when someone navigates to /admin.
// (Server-side role:'admin' checks in Firestore rules + Cloud Functions remain
// the real authorization boundary; this just keeps the admin UI off public
// clients.)
//
// Do NOT statically import any of these screens from AppRouter or they will be
// pulled back into the main bundle and defeat the exclusion.

import { Routes, Route } from 'react-router-dom';
import AdminDashboardScreen from '../screens/admin/AdminDashboardScreen';
import AdminAccessScreen from '../screens/admin/AdminAccessScreen';
import AdminUsersScreen from '../screens/admin/AdminUsersScreen';
const AdminCreatorsScreen = lazy(() => import('../screens/admin/AdminCreatorsScreen'));
import AdminEconomyScreen from '../screens/admin/AdminEconomyScreen';
import AdminModerationScreen from '../screens/admin/AdminModerationScreen';
import AdminModerationAuditScreen from '../screens/admin/AdminModerationAuditScreen';
import AdminBotsScreen from '../screens/admin/AdminBotsScreen';
import AdminAnnounceScreen from '../screens/admin/AdminAnnounceScreen';
import AdminVanguardScreen from '../screens/admin/AdminVanguardScreen';
import AdminSecurityScreen from '../screens/admin/AdminSecurityScreen';
import AdminConfigScreen from '../screens/admin/AdminConfigScreen';
import AdminAuditScreen from '../screens/admin/AdminAuditScreen';
import AdminSubscriptionsScreen from '../screens/admin/AdminSubscriptionsScreen';
import AdminTournamentsScreen from '../screens/admin/AdminTournamentsScreen';
import AdminStatsScreen from '../screens/admin/AdminStatsScreen';
import AdminStreamPreviewScreen from '../screens/admin/AdminStreamPreviewScreen';
import CheatSignaturesScreen from '../screens/admin/CheatSignaturesScreen';
import AdminRouteGate from '../components/AdminRouteGate';

// Paths are relative to the /admin/* parent route in AppRouter.
export default function AdminRoutes() {
  return (
    <Routes>
      <Route index element={<AdminDashboardScreen />} />
      <Route path="access" element={<AdminAccessScreen />} />
      <Route path="users" element={<AdminUsersScreen />} />
      <Route path="creators" element={<AdminCreatorsScreen />} />
      <Route path="economy" element={<AdminEconomyScreen />} />
      <Route path="reports" element={<AdminModerationScreen />} />
      <Route path="reports/audit" element={<AdminModerationAuditScreen />} />
      <Route path="bots" element={<AdminBotsScreen />} />
      <Route path="announce" element={<AdminAnnounceScreen />} />
      <Route path="vanguard" element={<AdminVanguardScreen />} />
      <Route path="security" element={<AdminSecurityScreen />} />
      <Route path="config" element={<AdminConfigScreen />} />
      <Route path="audit" element={<AdminAuditScreen />} />
      <Route path="cheat-signatures" element={<AdminRouteGate screen="cheat-signatures"><CheatSignaturesScreen /></AdminRouteGate>} />
      <Route path="subscriptions" element={<AdminSubscriptionsScreen />} />
      <Route path="tournaments" element={<AdminTournamentsScreen />} />
      <Route path="stats" element={<AdminStatsScreen />} />
      <Route path="stream-preview" element={<AdminStreamPreviewScreen />} />
    </Routes>
  );
}
