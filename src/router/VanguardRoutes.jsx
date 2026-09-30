// VanguardRoutes — every Vanguard moderation screen, for Vergr Vanguard only.
//
// Until 2026-09-21 these were routes inside the consumer web app. They now live
// in their own desktop app (src/vanguard/VanguardApp.jsx), exactly like the
// admin screens live in Vergr Admin, and vergr.app keeps only the invitation
// page and a "get the app" page. Nothing in AppRouter imports this file, so the
// moderation screens are not in the web bundle at all.
//
// Paths are relative to the /vanguard/* parent route in VanguardApp.

import { Routes, Route, Navigate } from 'react-router-dom';
import VanguardTodayScreen from '../screens/vanguard/VanguardTodayScreen';
import VanguardQueueScreen from '../screens/vanguard/VanguardQueueScreen';
import VanguardTreasuryScreen from '../screens/vanguard/VanguardTreasuryScreen';
import VanguardWalletScreen from '../screens/vanguard/VanguardWalletScreen';
import VanguardRankScreen from '../screens/vanguard/VanguardRankScreen';
import VanguardStatsScreen from '../screens/vanguard/VanguardStatsScreen';
import VanguardRosterScreen from '../screens/vanguard/VanguardRosterScreen';
import VanguardHandbookScreen from '../screens/vanguard/VanguardHandbookScreen';
import {
  VanguardPeerScreen,
  VanguardLiveScreen,
  VanguardPayoutsScreen,
  VanguardNotesScreen,
  VanguardEscalationsScreen,
  VanguardAnnouncementsScreen,
  VanguardLibraryScreen,
  VanguardChatScreen,
  VanguardLookupUserScreen,
  VanguardLookupActionScreen,
} from '../screens/vanguard/VanguardPagesB';

export default function VanguardRoutes() {
  return (
    <Routes>
      <Route index element={<Navigate to="today" replace />} />
      <Route path="today" element={<VanguardTodayScreen />} />
      <Route path="queue" element={<VanguardQueueScreen />} />
      <Route path="live" element={<VanguardLiveScreen />} />
      <Route path="notes" element={<VanguardNotesScreen />} />
      <Route path="treasury" element={<VanguardTreasuryScreen />} />
      <Route path="payouts" element={<VanguardPayoutsScreen />} />
      <Route path="wallet" element={<VanguardWalletScreen />} />
      <Route path="stats" element={<VanguardStatsScreen />} />
      <Route path="rank" element={<VanguardRankScreen />} />
      <Route path="peer" element={<VanguardPeerScreen />} />
      <Route path="roster" element={<VanguardRosterScreen />} />
      <Route path="chat" element={<VanguardChatScreen />} />
      <Route path="escalations" element={<VanguardEscalationsScreen />} />
      <Route path="handbook" element={<VanguardHandbookScreen />} />
      <Route path="library" element={<VanguardLibraryScreen />} />
      <Route path="announcements" element={<VanguardAnnouncementsScreen />} />
      <Route path="lookup/user" element={<VanguardLookupUserScreen />} />
      <Route path="lookup/action" element={<VanguardLookupActionScreen />} />
      <Route path="*" element={<Navigate to="today" replace />} />
    </Routes>
  );
}
