import { HashRouter as BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import { UserProvider } from '../context/UserContext';
import { NotificationProvider } from '../context/NotificationContext';
import { UIProvider } from '../context/UIContext';
import { LayoutProvider } from '../context/LayoutContext';
import ProtectedRoute from '../components/ProtectedRoute';
import Toast from '../components/Toast';
import PushToast from '../components/PushToast';
import IncomingCallOverlay from '../components/IncomingCallOverlay';
import AdminAnnounceScreen from '../screens/admin/AdminAnnounceScreen';
import SuperAdminDashboardScreen from '../screens/admin/SuperAdminDashboardScreen';
import AdminBotsScreen from '../screens/admin/AdminBotsScreen';
import DesktopNotificationManager from '../components/DesktopNotificationManager';
import NotificationsDrawer from '../components/NotificationsDrawer';
import ConsentSheet from '../components/ConsentSheet';
import { captureSignals } from '../utils/captureSignals';
import { setTrackingUser } from '../utils/trackEvent';
import { useAuth } from '../context/AuthContext';
import MainLayout from '../layouts/MainLayout';
import MessagesMasterDetail from '../layouts/MessagesMasterDetail';
import SquadsMasterDetail from '../layouts/SquadsMasterDetail';
import ResponsiveLayout from '../components/ResponsiveLayout';
import LoadingScreen from '../components/LoadingScreen';
import usePresence from '../hooks/usePresence';
import { useEffect } from 'react';
import { checkScheduledBackup } from '../utils/chatBackup';

// Vergr.me Link‑in‑Bio
import VergrMeEditorScreen from '../screens/VergrMeEditorScreen';
import VergrMePage from '../screens/VergrMePage';

// Renders nothing — just activates the presence system inside the auth context
function PresenceManager() {
  usePresence();
  return null;
}

// Renders nothing — checks if a scheduled backup is due on app startup
function BackupChecker() {
  useEffect(() => {
    checkScheduledBackup().catch(() => {});
  }, []);
  return null;
}

// Renders nothing — captures GDPR-lawful passive signals once per session
function SignalsCapture() {
  const { currentUser } = useAuth();
  useEffect(() => {
    setTrackingUser(currentUser?.uid || null);
    if (currentUser?.uid) captureSignals(currentUser.uid).catch(() => {});
  }, [currentUser?.uid]);
  return null;
}

function RootRoute() {
  const { currentUser, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!currentUser) return <LandingScreen />;
  return <HomeFeedScreen />;
}

// Auth
import SplashScreen from '../screens/auth/SplashScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import SignUpStep1 from '../screens/auth/SignUpStep1';
import SignUpStep2 from '../screens/auth/SignUpStep2';
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen';
import TwoFASetupScreen from '../screens/auth/TwoFASetupScreen';
import TwoFALoginScreen from '../screens/auth/TwoFALoginScreen';
import EmailVerificationScreen from '../screens/auth/EmailVerificationScreen';
import PhoneEntryScreen from '../screens/auth/PhoneEntryScreen';
import PhoneOTPScreen from '../screens/auth/PhoneOTPScreen';
import NewPasswordScreen from '../screens/auth/NewPasswordScreen';
import ResetSuccessScreen from '../screens/auth/ResetSuccessScreen';
import SocialLoginScreen from '../screens/auth/SocialLoginScreen';
import AccountTypeScreen from '../screens/auth/AccountTypeScreen';
import ConnectGamingScreen from '../screens/auth/ConnectGamingScreen';
import {
  LandingScreen,
  StoreScreen,
  DownloadScreen,
  HelpScreen as MarketingHelpScreen,
  LegalScreen,
} from '../screens/marketing/PublicMarketingScreens';

// Onboarding
import OnboardingScreen from '../screens/onboarding/OnboardingScreen';
import InterestSelectionScreen from '../screens/onboarding/InterestSelectionScreen';
import ProfileSetupScreen from '../screens/onboarding/ProfileSetupScreen';
import FollowSuggestionsScreen from '../screens/onboarding/FollowSuggestionsScreen';
import OnboardingCompleteScreen from '../screens/onboarding/OnboardingCompleteScreen';
import ProfileSetupStep2Screen from '../screens/onboarding/ProfileSetupStep2Screen';
import ProfileIdentityScreen from '../screens/onboarding/ProfileIdentityScreen';

// Main tabs
import HomeFeedScreen from '../screens/home/HomeFeedScreen';
import ExploreScreen from '../screens/explore/ExploreScreen';
import SquadsScreen from '../screens/squads/SquadsScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';

// Home
import EarnCoinsScreen from '../screens/home/EarnCoinsScreen';
import NotificationsScreen from '../screens/home/NotificationsScreen';
import CreatePostScreen from '../screens/home/CreatePostScreen';
import LeaderboardScreen from '../screens/home/LeaderboardScreen';
import PostDetailScreen from '../screens/home/PostDetailScreen';
import CreatePollScreen from '../screens/home/CreatePollScreen';
import TrendingHashtagsScreen from '../screens/home/TrendingHashtagsScreen';

// Create (post types)
import CreatePostSelectorScreen from '../screens/create/CreatePostSelectorScreen';
import CreateTextPostScreen from '../screens/create/CreateTextPostScreen';
import CreatePhotoPostScreen from '../screens/create/CreatePhotoPostScreen';
import CreateClipPostScreen from '../screens/create/CreateClipPostScreen';
import CreateArticleScreen from '../screens/create/CreateArticleScreen';
import CreateLFGScreen from '../screens/create/CreateLFGScreen';
import CreateTierListScreen from '../screens/create/CreateTierListScreen';
import CreateAchievementScreen from '../screens/create/CreateAchievementScreen';
import QuotePostScreen from '../screens/create/QuotePostScreen';

// Viewers
import ClipViewerScreen from '../screens/viewer/ClipViewerScreen';

// Shorts
import ShortsScreen from '../screens/shorts/ShortsScreen';
import CreateShortScreen from '../screens/create/CreateShortScreen';

// Profile
import EditProfileScreen from '../screens/profile/EditProfileScreen';
import FollowListScreen from '../screens/profile/FollowListScreen';
import PublicProfileScreen from '../screens/profile/PublicProfileScreen';
import BrowseCreatorsScreen from '../screens/profile/BrowseCreatorsScreen';
import EsportsTeamScreen from '../screens/profile/EsportsTeamScreen';
import PrestigeLevelsScreen from '../screens/profile/PrestigeLevelsScreen';

// Messages
import MessagesInboxScreen from '../screens/messages/MessagesInboxScreen';
import ChatThreadScreen from '../screens/messages/ChatThreadScreen';
import MessageRequestsScreen from '../screens/messages/MessageRequestsScreen';
import CreateGroupChatScreen from '../screens/messages/CreateGroupChatScreen';
import NewMessageScreen from '../screens/messages/NewMessageScreen';
import ChatSettingsScreen from '../screens/messages/ChatSettingsScreen';
import ChatDetailScreen from '../screens/messages/ChatDetailScreen';
import CallScreen from '../screens/messages/CallScreen';

// Squads
import CreateSquadScreen from '../screens/squads/CreateSquadScreen';
import SquadDetailScreen from '../screens/squads/SquadDetailScreen';
import SquadChatThreadScreen from '../screens/squads/SquadChatThreadScreen';
import SquadSettingsScreen from '../screens/squads/SquadSettingsScreen';
import SquadRolesScreen from '../screens/squads/SquadRolesScreen';
import SquadMembersScreen from '../screens/squads/SquadMembersScreen';
import SquadMediaScreen from '../screens/squads/SquadMediaScreen';
import SquadPinnedScreen from '../screens/squads/SquadPinnedScreen';
import SquadChallengesScreen from '../screens/squads/SquadChallengesScreen';
import SquadEventsScreen from '../screens/squads/SquadEventsScreen';
import SquadJoinRequestsScreen from '../screens/squads/SquadJoinRequestsScreen';
import SquadAnnouncementsScreen from '../screens/squads/SquadAnnouncementsScreen';
import SquadLeaderboardScreen from '../screens/squads/SquadLeaderboardScreen';
import InviteMembersScreen from '../screens/squads/InviteMembersScreen';

// Wallet & Coins
import WalletScreen from '../screens/wallet/WalletScreen';
import ConvertCoinsScreen from '../screens/wallet/ConvertCoinsScreen';
import BuyCoinsScreen from '../screens/wallet/BuyCoinsScreen';
import TransactionReceiptScreen from '../screens/wallet/TransactionReceiptScreen';
import TransactionFiltersScreen from '../screens/wallet/TransactionFiltersScreen';
import RequestPayoutScreen from '../screens/wallet/RequestPayoutScreen';
import PayoutSuccessScreen from '../screens/wallet/PayoutSuccessScreen';
import WalletSecurityScreen from '../screens/wallet/WalletSecurityScreen';
import { PayoutStatusScreen, PayoutHistoryScreen, SavedAddressesScreen } from '../screens/wallet/PayoutScreens';

// Creator
import CreatorDashboardScreen from '../screens/creator/CreatorDashboardScreen';
import CreatorEarningsScreen from '../screens/creator/CreatorEarningsScreen';
import CreatorContentScreen from '../screens/creator/CreatorContentScreen';
import CreatorScheduleScreen from '../screens/creator/CreatorScheduleScreen';
import CreatorAudienceScreen from '../screens/creator/CreatorAudienceScreen';
import CreatorCommunityScreen from '../screens/creator/CreatorCommunityScreen';
import MonthlyAnalyticsScreen from '../screens/creator/MonthlyAnalyticsScreen';
import CreatorQuestsScreen from '../screens/creator/CreatorQuestsScreen';
import MembershipTiersScreen from '../screens/creator/MembershipTiersScreen';
import CreatorVerificationScreen from '../screens/creator/CreatorVerificationScreen';
import { useParams } from 'react-router-dom';
function MobileKycHandoff() {
  const { sid } = useParams();
  return (
    <div className="min-h-screen bg-bg-dark px-4 py-6">
      <div className="max-w-xl mx-auto">
        <h1 className="font-syne text-white font-bold text-xl mb-1">VERGR Verification</h1>
        <p className="text-text-muted text-xs mb-4">Continuing session · {sid.slice(0, 6)}…</p>
        <CreatorVerificationScreen embedded sessionId={sid} />
      </div>
    </div>
  );
}
import VerificationPendingScreen from '../screens/creator/VerificationPendingScreen';
import CreatorLayout from '../components/creator/CreatorLayout';

// Streams
import GoLiveSetupScreen from '../screens/streams/GoLiveSetupScreen';
import LiveStreamScreen from '../screens/streams/LiveStreamScreen';
import BroadcasterScreen from '../screens/streams/BroadcasterScreen';
import ViewerStreamScreen from '../screens/streams/ViewerStreamScreen';
import StreamAnalyticsScreen from '../screens/streams/StreamAnalyticsScreen';
import StreamEndingScreen from '../screens/streams/StreamEndingScreen';
import StreamModerationScreen from '../screens/streams/StreamModerationScreen';
import CoStreamingScreen from '../screens/streams/CoStreamingScreen';

// Tournaments
import TournamentScreen from '../screens/tournaments/TournamentScreen';
import TournamentStandingsScreen from '../screens/tournaments/TournamentStandingsScreen';
import TournamentPrizePoolScreen from '../screens/tournaments/TournamentPrizePoolScreen';
import MatchDetailsScreen from '../screens/tournaments/MatchDetailsScreen';
import TeamManagementScreen from '../screens/tournaments/TeamManagementScreen';
import TeamFundingScreen from '../screens/tournaments/TeamFundingScreen';
import ContributeScreen from '../screens/tournaments/ContributeScreen';
import ContributionSuccessScreen from '../screens/tournaments/ContributionSuccessScreen';
import PrizeReceiptScreen from '../screens/tournaments/PrizeReceiptScreen';
import CreateTournamentScreen from '../screens/tournaments/CreateTournamentScreen';
import ModeratorMatchControlScreen from '../screens/tournaments/ModeratorMatchControlScreen';

// Settings
import SettingsScreen from '../screens/settings/SettingsScreen';
import BackupSettingsScreen from '../screens/settings/BackupSettingsScreen';
import PrivacySettingsScreen from '../screens/settings/PrivacySettingsScreen';
import LinkedAccountsScreen from '../screens/settings/LinkedAccountsScreen';
import NotificationSettingsScreen from '../screens/settings/NotificationSettingsScreen';
import AboutScreen from '../screens/settings/AboutScreen';
import SecuritySettingsScreen from '../screens/settings/SecuritySettingsScreen';
import LanguageSettingsScreen from '../screens/settings/LanguageSettingsScreen';
import DisplaySettingsScreen from '../screens/settings/DisplaySettingsScreen';
import AppPermissionsScreen from '../screens/settings/AppPermissionsScreen';
import BlockedWordsScreen from '../screens/settings/BlockedWordsScreen';
import BlockedUsersScreen from '../screens/settings/BlockedUsersScreen';
import AccountDataExportScreen from '../screens/settings/AccountDataExportScreen';
import AccountDeletionScreen from '../screens/settings/AccountDeletionScreen';
import DisconnectAccountScreen from '../screens/settings/DisconnectAccountScreen';
import HelpCenterScreen from '../screens/settings/HelpCenterScreen';
import HowItWorksScreen from '../screens/settings/HowItWorksScreen';
import BoostScreen from '../screens/wallet/BoostScreen';
import ReferralScreen from '../screens/home/ReferralScreen';
import CallsScreen from '../screens/calls/CallsScreen';
import StatusScreen from '../screens/status/StatusScreen';
import PrivacyPolicyScreen from '../screens/settings/PrivacyPolicyScreen';
import PhoneAllowListScreen from '../screens/settings/PhoneAllowListScreen';
import SubscriptionScreen from '../screens/settings/SubscriptionScreen';
import VPRanksScreen from '../screens/settings/VPRanksScreen';

// Ad Center
import AdCenterScreen from '../screens/ad/AdCenterScreen';

// Search
import SearchResultsAllScreen from '../screens/search/SearchResultsAllScreen';
import SearchResultsStreamsScreen from '../screens/search/SearchResultsStreamsScreen';
import NoSearchResultsScreen from '../screens/search/NoSearchResultsScreen';

// Utility
import MaintenanceScreen from '../screens/utility/MaintenanceScreen';
import ForceUpdateScreen from '../screens/utility/ForceUpdateScreen';
import NetworkErrorScreen from '../screens/utility/NetworkErrorScreen';
import ActivityLogScreen from '../screens/utility/ActivityLogScreen';

// Capture an incoming `?ref=<uid>` invite parameter into localStorage as
// early as possible. It survives any number of navigations (splash → login
// → signup → etc.) and is consumed by SignUpStep2 when the user actually
// creates their account. We run this once at module load so the value is
// stashed even before React mounts.
(function captureReferral() {
  try {
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const ref = new URLSearchParams(search).get('ref');
    if (ref && /^[A-Za-z0-9_-]{6,64}$/.test(ref)) {
      localStorage.setItem('vergr_ref', ref);
    }
  } catch { /* SSR / private-mode — ignore */ }
})();

// Firebase Hosting serves the SPA for clean URLs like /store. HashRouter
// needs those paths moved into the hash before React routes mount.
(function bridgeCleanUrlsToHashRoutes() {
  try {
    if (typeof window === 'undefined') return;
    const { pathname, search, hash } = window.location;
    if (hash || pathname === '/' || pathname.includes('.')) return;
    if (pathname.startsWith('/media/') || pathname.startsWith('/share/')) return;
    window.history.replaceState(null, '', `/#${pathname}${search || ''}`);
  } catch { /* ignore */ }
})();

export default function AppRouter() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <UserProvider>
          <NotificationProvider>
            <UIProvider>
              <LayoutProvider>
                <div className="app-container mx-auto min-h-screen bg-bg-dark text-text-primary relative">
                  <Toast />
                  <PushToast />
                  <IncomingCallOverlay />
                  <DesktopNotificationManager />
                  <PresenceManager />
                  <BackupChecker />
                  <SignalsCapture />
                  <ConsentSheet />
                  <NotificationsDrawer />
                  <Routes>
                    {/* ---------- PUBLIC ROUTES (no layout) ---------- */}
                    <Route path="/" element={<RootRoute />} />
                    <Route path="/store" element={<StoreScreen />} />
                    <Route path="/download" element={<DownloadScreen />} />
                    <Route path="/help" element={<MarketingHelpScreen />} />
                    <Route path="/privacy" element={<LegalScreen type="privacy" />} />
                    <Route path="/terms" element={<LegalScreen type="terms" />} />

                    {/* Auth */}
                    <Route path="/splash" element={<SplashScreen />} />
                    <Route path="/login" element={<LoginScreen />} />
                    <Route path="/signup" element={<SignUpStep1 />} />
                    <Route path="/signup/step2" element={<SignUpStep2 />} />
                    <Route path="/forgot-password" element={<ForgotPasswordScreen />} />
                    <Route path="/2fa-setup" element={<TwoFASetupScreen />} />
                    <Route path="/2fa-login" element={<TwoFALoginScreen />} />
                    <Route path="/verify-email" element={<EmailVerificationScreen />} />
                    <Route path="/phone-entry" element={<PhoneEntryScreen />} />
                    <Route path="/phone-otp" element={<PhoneOTPScreen />} />
                    <Route path="/new-password" element={<NewPasswordScreen />} />
                    <Route path="/reset-success" element={<ResetSuccessScreen />} />
                    <Route path="/social-login" element={<SocialLoginScreen />} />
                    <Route path="/account-type" element={<AccountTypeScreen />} />
                    <Route path="/connect-gaming" element={<ConnectGamingScreen />} />

                    {/* Onboarding */}
                    <Route path="/onboarding" element={<OnboardingScreen />} />
                    <Route path="/onboarding/interests" element={<InterestSelectionScreen />} />
                    <Route path="/onboarding/profile" element={<ProfileSetupScreen />} />
                    <Route path="/onboarding/profile-step2" element={<ProfileSetupStep2Screen />} />
                    <Route path="/onboarding/identity" element={<ProfileIdentityScreen />} />
                    <Route path="/onboarding/follow" element={<FollowSuggestionsScreen />} />
                    <Route path="/onboarding/complete" element={<OnboardingCompleteScreen />} />

                    {/* Utility (public) */}
                    <Route path="/maintenance" element={<MaintenanceScreen />} />
                    <Route path="/update-required" element={<ForceUpdateScreen />} />
                    <Route path="/offline" element={<NetworkErrorScreen />} />

                    {/* Vergr.me public page — no auth required */}
                    <Route path="/u/:username" element={<VergrMePage />} />

                    {/* ---------- PROTECTED MAIN APP (with MainLayout) ---------- */}
                    <Route element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
                      {/* Main tabs */}
                      <Route path="/explore" element={<ExploreScreen />} />
                      <Route path="/profile" element={<ProfileScreen />} />

                      {/* Home */}
                      <Route path="/earn" element={<EarnCoinsScreen />} />
                      <Route path="/earn/refer" element={<ReferralScreen />} />
                      <Route path="/notifications" element={<NotificationsScreen />} />
                      <Route path="/create-post" element={<Navigate to="/create" replace />} />
                      <Route path="/create-poll" element={<CreatePollScreen />} />
                      <Route path="/leaderboard" element={<LeaderboardScreen />} />
                      <Route path="/post/:postId" element={<PostDetailScreen />} />
                      <Route path="/trending" element={<TrendingHashtagsScreen />} />

                      {/* Create */}
                      <Route path="/create" element={<CreatePostSelectorScreen />} />
                      <Route path="/create/text" element={<CreateTextPostScreen />} />
                      <Route path="/create/photo" element={<CreatePhotoPostScreen />} />
                      <Route path="/create/clip" element={<CreateClipPostScreen />} />
                      <Route path="/create/article" element={<CreateArticleScreen />} />
                      <Route path="/create/lfg" element={<CreateLFGScreen />} />
                      <Route path="/create/tierlist" element={<CreateTierListScreen />} />
                      <Route path="/create/achievement" element={<CreateAchievementScreen />} />
                      <Route path="/create/quote" element={<QuotePostScreen />} />

                      {/* Shorts */}
                      <Route path="/shorts" element={<ShortsScreen />} />
                      <Route path="/create/short" element={<CreateShortScreen />} />

                      {/* Viewers */}
                      <Route path="/clip/:postId" element={<ClipViewerScreen />} />

                      {/* Profile */}
                      <Route path="/edit-profile" element={<EditProfileScreen />} />
                      <Route path="/followers/:tab" element={<FollowListScreen />} />
                      <Route path="/user/:id" element={<PublicProfileScreen />} />
                      <Route path="/browse-creators" element={<BrowseCreatorsScreen />} />
                      <Route path="/esports-team/:teamId" element={<EsportsTeamScreen />} />
                      <Route path="/prestige" element={<PrestigeLevelsScreen />} />

                      {/* Standalone message screens (not master‑detail) */}
                      <Route path="/messages/new" element={<NewMessageScreen />} />
                      <Route path="/messages/requests" element={<MessageRequestsScreen />} />
                      <Route path="/messages/create-group" element={<CreateGroupChatScreen />} />
                      <Route path="/messages/:chatId/settings" element={<ChatSettingsScreen />} />
                      <Route path="/messages/:chatId/details" element={<ChatDetailScreen />} />
                      <Route path="/call/:chatId/:callType" element={<CallScreen />} />

                      {/* Standalone squad creation */}
                      <Route path="/squads/create" element={<CreateSquadScreen />} />

                      {/* Wallet & Coins */}
                      <Route path="/wallet" element={<WalletScreen />} />
                      <Route path="/wallet/convert" element={<ConvertCoinsScreen />} />
                      <Route path="/wallet/security" element={<WalletSecurityScreen />} />
                      <Route path="/buy-coins" element={<BuyCoinsScreen />} />
                      <Route path="/transaction/:txId" element={<TransactionReceiptScreen />} />
                      <Route path="/transactions/filter" element={<TransactionFiltersScreen />} />
                      <Route path="/request-payout" element={<RequestPayoutScreen />} />
                      <Route path="/payout-success" element={<PayoutSuccessScreen />} />
                      <Route path="/wallet/payout"           element={<RequestPayoutScreen />} />
                      <Route path="/wallet/payout/history"   element={<PayoutHistoryScreen />} />
                      <Route path="/wallet/payout/:payoutId" element={<PayoutStatusScreen />} />
                      <Route path="/wallet/addresses"        element={<SavedAddressesScreen />} />

                      <Route path="/verification-pending" element={<VerificationPendingScreen />} />

                      {/* Streams */}
                      <Route path="/go-live" element={<GoLiveSetupScreen />} />
                      <Route path="/go-live/co-stream" element={<CoStreamingScreen />} />
                      <Route path="/stream/:streamId" element={<LiveStreamScreen />} />
                      <Route path="/broadcast" element={<BroadcasterScreen />} />
                      <Route path="/broadcast/:streamId" element={<BroadcasterScreen />} />
                      <Route path="/watch" element={<ViewerStreamScreen />} />
                      <Route path="/watch/:streamId" element={<ViewerStreamScreen />} />
                      <Route path="/stream/:streamId/moderation" element={<StreamModerationScreen />} />
                      <Route path="/stream/analytics" element={<StreamAnalyticsScreen />} />
                      <Route path="/stream/ended" element={<StreamEndingScreen />} />

                      {/* Tournaments */}
                      <Route path="/tournaments" element={<TournamentScreen />} />
                      <Route path="/tournaments/standings" element={<TournamentStandingsScreen />} />
                      <Route path="/tournaments/prizes" element={<TournamentPrizePoolScreen />} />
                      <Route path="/match/:matchId" element={<MatchDetailsScreen />} />
                      <Route path="/team/:teamId/manage" element={<TeamManagementScreen />} />
                      <Route path="/team/:teamId/funding" element={<TeamFundingScreen />} />
                      <Route path="/team-contribute" element={<ContributeScreen />} />
                      <Route path="/contribution-success" element={<ContributionSuccessScreen />} />
                      <Route path="/prize-receipt/:prizeId" element={<PrizeReceiptScreen />} />
                      <Route path="/create-tournament" element={<CreateTournamentScreen />} />
                      <Route path="/match/:matchId/control" element={<ModeratorMatchControlScreen />} />

                      {/* Settings */}
                      <Route path="/settings" element={<SettingsScreen />} />
                      <Route path="/settings/backup" element={<BackupSettingsScreen />} />
                      <Route path="/settings/privacy" element={<PrivacySettingsScreen />} />
                      <Route path="/settings/linked-accounts" element={<LinkedAccountsScreen />} />
                      <Route path="/settings/notifications" element={<NotificationSettingsScreen />} />
                      <Route path="/settings/about" element={<AboutScreen />} />
                      <Route path="/settings/security" element={<SecuritySettingsScreen />} />
                      <Route path="/settings/language" element={<LanguageSettingsScreen />} />
                      <Route path="/settings/display" element={<DisplaySettingsScreen />} />
                      <Route path="/settings/permissions" element={<AppPermissionsScreen />} />
                      <Route path="/settings/blocked-words" element={<BlockedWordsScreen />} />
                      <Route path="/settings/blocked-users" element={<BlockedUsersScreen />} />
                      <Route path="/settings/export-data" element={<AccountDataExportScreen />} />
                      <Route path="/settings/delete-account" element={<AccountDeletionScreen />} />
                      <Route path="/settings/disconnect/:platform" element={<DisconnectAccountScreen />} />
                      <Route path="/settings/help" element={<HelpCenterScreen />} />
                      <Route path="/settings/how-it-works" element={<HowItWorksScreen />} />
                      <Route path="/settings/phone-allowlist" element={<PhoneAllowListScreen />} />
                      <Route path="/settings/subscription" element={<SubscriptionScreen />} />
                      <Route path="/settings/ranks" element={<VPRanksScreen />} />

                      {/* Boost */}
                      <Route path="/boost" element={<BoostScreen />} />

                      {/* Calls */}
                      <Route path="/calls" element={<CallsScreen />} />

                      {/* Status */}
                      <Route path="/status" element={<StatusScreen />} />

                      {/* Ad Center — moved into Creator Studio. Redirect legacy URL. */}
                      <Route path="/ad-center" element={<Navigate to="/creator/ads" replace />} />

                      <Route path="/settings/privacy-policy" element={<PrivacyPolicyScreen />} />

                      {/* Admin */}
                      <Route path="/admin" element={<SuperAdminDashboardScreen />} />
                      <Route path="/admin/bots" element={<AdminBotsScreen />} />
                      <Route path="/admin/announce" element={<AdminAnnounceScreen />} />

                      {/* Search */}
                      <Route path="/search" element={<SearchResultsAllScreen />} />
                      <Route path="/search/streams" element={<SearchResultsStreamsScreen />} />
                      <Route path="/search/empty" element={<NoSearchResultsScreen />} />

                      {/* Activity */}
                      <Route path="/activity" element={<ActivityLogScreen />} />

                      {/* Vergr.me Editor — Pro user only, protected */}
                      <Route path="/vergrme/edit" element={<VergrMeEditorScreen />} />
                    </Route>

                    {/* ---------- CREATOR STUDIO (own layout — sidebar + topbar) ---------- */}
                    <Route element={<ProtectedRoute><Outlet /></ProtectedRoute>}>
                      <Route path="/creator" element={<Navigate to="/creator/dashboard" replace />} />
                      <Route path="/creator/dashboard"  element={<CreatorDashboardScreen />} />
                      <Route path="/creator/earnings"   element={<CreatorEarningsScreen />} />
                      <Route path="/creator/content"    element={<CreatorContentScreen />} />
                      <Route path="/creator/schedule"   element={<CreatorScheduleScreen />} />
                      <Route path="/creator/audience"   element={<CreatorAudienceScreen />} />
                      <Route path="/creator/community"  element={<CreatorCommunityScreen />} />
                      <Route path="/creator/analytics"  element={<CreatorLayout page="analytics" title="Analytics" subtitle="Deep dive into your performance" requiredTier="lite" lockDescription="Detailed monthly analytics with growth, engagement and revenue breakdowns. Upgrade to Lite to unlock."><MonthlyAnalyticsScreen embedded /></CreatorLayout>} />
                      <Route path="/creator/quests"     element={<CreatorLayout page="quests" title="Creator Quests" subtitle="Earn VP — level up your creator rank"><CreatorQuestsScreen embedded /></CreatorLayout>} />
                      <Route path="/creator/membership" element={<CreatorLayout page="memberships" title="Membership Tiers" subtitle="Offer paid perks to your fans" requiredTier="pro" lockDescription="Build paid tiers with perks, Discord roles and monthly earnings caps. Upgrade to Pro to enable."><MembershipTiersScreen embedded /></CreatorLayout>} />
                      <Route path="/creator/ads"        element={<CreatorLayout page="ads" title="Ad Center" subtitle="Run targeted in-feed campaigns"><AdCenterScreen embedded /></CreatorLayout>} />
                      <Route path="/creator/verify"     element={<CreatorLayout page="verify" title="Creator Verification" subtitle="Identity check — required for Ad Center, payouts and membership tiers"><CreatorVerificationScreen embedded /></CreatorLayout>} />
                    </Route>

                    {/* Mobile hand-off route for QR-code verification continuation */}
                    <Route path="/verify/mobile/:sid" element={<ProtectedRoute><MobileKycHandoff /></ProtectedRoute>} />

                    {/* ---------- MESSAGES MASTER‑DETAIL ---------- */}
                    <Route path="/messages" element={<ProtectedRoute><MessagesMasterDetail /></ProtectedRoute>}>
                      <Route index element={<MessagesInboxScreen />} />
                      <Route path=":chatId" element={<ChatThreadScreen />} />
                    </Route>

                    {/* ---------- SQUADS MASTER‑DETAIL ---------- */}
                    <Route path="/squads" element={<ProtectedRoute><SquadsMasterDetail /></ProtectedRoute>}>
                      <Route index element={<SquadsScreen />} />
                      <Route path=":squadId" element={<SquadDetailScreen />} />
                      <Route path=":squadId/chat" element={<SquadChatThreadScreen />} />
                      <Route path=":squadId/settings" element={<SquadSettingsScreen />} />
                      <Route path=":squadId/roles" element={<SquadRolesScreen />} />
                      <Route path=":squadId/members" element={<SquadMembersScreen />} />
                      <Route path=":squadId/media" element={<SquadMediaScreen />} />
                      <Route path=":squadId/pinned" element={<SquadPinnedScreen />} />
                      <Route path=":squadId/challenges" element={<SquadChallengesScreen />} />
                      <Route path=":squadId/events" element={<SquadEventsScreen />} />
                      <Route path=":squadId/requests" element={<SquadJoinRequestsScreen />} />
                      <Route path=":squadId/announcements" element={<SquadAnnouncementsScreen />} />
                      <Route path=":squadId/leaderboard" element={<SquadLeaderboardScreen />} />
                      <Route path=":squadId/invite" element={<InviteMembersScreen />} />
                    </Route>

                    {/* ---------- CATCH‑ALL ---------- */}
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </div>
              </LayoutProvider>
            </UIProvider>
          </NotificationProvider>
        </UserProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
