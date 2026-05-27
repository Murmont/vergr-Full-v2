import { HashRouter as BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import { UserProvider } from '../context/UserContext';
import { NotificationProvider } from '../context/NotificationContext';
import { UIProvider } from '../context/UIContext';
import { LayoutProvider } from '../context/LayoutContext';
import ProtectedRoute from '../components/ProtectedRoute';
import KycGate from '../components/KycGate';
import RegionGate from '../components/RegionGate';
import GuestRouteGate from '../components/GuestRouteGate';
import Toast from '../components/Toast';
import PushToast from '../components/PushToast';
import IncomingCallOverlay from '../components/IncomingCallOverlay';
import AdminAnnounceScreen from '../screens/admin/AdminAnnounceScreen';
import AdminDashboardScreen from '../screens/admin/AdminDashboardScreen';
import AdminAccessScreen from '../screens/admin/AdminAccessScreen';
import AdminUsersScreen from '../screens/admin/AdminUsersScreen';
import AdminEconomyScreen from '../screens/admin/AdminEconomyScreen';
import AdminModerationScreen from '../screens/admin/AdminModerationScreen';
import AdminModerationAuditScreen from '../screens/admin/AdminModerationAuditScreen';
import AdminBotsScreen from '../screens/admin/AdminBotsScreen';
import AdminSecurityScreen from '../screens/admin/AdminSecurityScreen';
import AdminConfigScreen from '../screens/admin/AdminConfigScreen';
import AdminAuditScreen from '../screens/admin/AdminAuditScreen';
import AdminSubscriptionsScreen from '../screens/admin/AdminSubscriptionsScreen';
import AdminTournamentsScreen from '../screens/admin/AdminTournamentsScreen';
import AdminStatsScreen from '../screens/admin/AdminStatsScreen';
import DesktopNotificationManager from '../components/DesktopNotificationManager';
import NotificationsDrawer from '../components/NotificationsDrawer';
import ConsentSheet from '../components/ConsentSheet';
import TosVersionGate from '../components/TosVersionGate';
import GuestSignupPrompt from '../components/GuestSignupPrompt';
import GuestModeBanner from '../components/GuestModeBanner';
import { captureSignals } from '../utils/captureSignals';
import { setTrackingUser } from '../utils/trackEvent';
import { useAuth } from '../context/AuthContext';
import MainLayout from '../layouts/MainLayout';
import MessagesMasterDetail from '../layouts/MessagesMasterDetail';
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

// Renders nothing — installs a global context-menu blocker on <img> elements
// so users can't right-click → "Save image as" / "Copy image" / "Open in new
// tab" on any image in the app (logo, avatars, banners, post media, etc.).
// Doesn't stop determined users (devtools, network tab, screenshots) but
// raises the friction enough to discourage casual saving. Pairs with the
// `img { user-drag: none; user-select: none }` CSS in index.css.
function ImageProtection() {
  useEffect(() => {
    const onCtx = (e) => { if (e.target?.tagName === 'IMG') e.preventDefault(); };
    const onDragStart = (e) => { if (e.target?.tagName === 'IMG') e.preventDefault(); };
    document.addEventListener('contextmenu', onCtx);
    document.addEventListener('dragstart', onDragStart);
    return () => {
      document.removeEventListener('contextmenu', onCtx);
      document.removeEventListener('dragstart', onDragStart);
    };
  }, []);
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
  AboutScreen as MarketingAboutScreen,
  CareersScreen,
  ContactScreen,
  CodeOfConductScreen,
  ForumsScreen,
  BecomeStreamerScreen,
  MonetizationScreen,
  StudioToolsScreen,
  PartnerProgramScreen,
  LearnLiveScreen,
  LearnTournamentsScreen,
  LearnSquadsScreen,
  LearnClipsScreen,
  LearnCoinsScreen,
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
import SquadOverviewScreen from '../screens/squads/SquadOverviewScreen';
import SquadStreamScreen from '../screens/squads/SquadStreamScreen';
import VoiceChannelScreen from '../screens/messages/VoiceChannelScreen';
import FriendsScreen from '../screens/messages/FriendsScreen';
import BrowseGroupsScreen from '../screens/messages/BrowseGroupsScreen';
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
import SquadsMineScreen from '../screens/squads/SquadsMineScreen';
import SquadInvitationsScreen from '../screens/squads/SquadInvitationsScreen';
import SquadApplicationsScreen from '../screens/squads/SquadApplicationsScreen';
import BrowsePlayersScreen from '../screens/squads/BrowsePlayersScreen';
import SquadAnalyticsScreen from '../screens/squads/SquadAnalyticsScreen';
import AdminVanguardScreen from '../screens/admin/AdminVanguardScreen';
import VanguardInvitationScreen from '../screens/vanguard/VanguardInvitationScreen';
import VanguardMeScreen from '../screens/vanguard/VanguardMeScreen';
import VanguardTodayScreen from '../screens/vanguard/VanguardTodayScreen';
import VanguardScheduleScreen from '../screens/vanguard/VanguardScheduleScreen';
import VanguardModerationRoomScreen from '../screens/vanguard/VanguardModerationRoomScreen';
import TournamentOverlayScreen from '../screens/overlay/TournamentOverlayScreen';
import TournamentOverlayNeon from '../screens/overlay/TournamentOverlayNeon';
import StreamerBattleOverlay from '../screens/overlay/StreamerBattleOverlay';
import CoachingScreen from '../screens/tournaments/CoachingScreen';
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
  VanguardMyCasesScreen,
  VanguardNotesScreen,
  VanguardEscalationsScreen,
  VanguardAnnouncementsScreen,
  VanguardLibraryScreen,
  VanguardChatScreen,
  VanguardLookupUserScreen,
  VanguardLookupTournamentScreen,
  VanguardLookupActionScreen,
} from '../screens/vanguard/VanguardPagesB';
import InviteMembersScreen from '../screens/squads/InviteMembersScreen';

// Wallet & Coins
import WalletScreen from '../screens/wallet/WalletScreen';
import ConvertCoinsScreen from '../screens/wallet/ConvertCoinsScreen';
import TransactionReceiptScreen from '../screens/wallet/TransactionReceiptScreen';
import TransactionFiltersScreen from '../screens/wallet/TransactionFiltersScreen';
import RequestPayoutScreen from '../screens/wallet/RequestPayoutScreen';
import PayoutSuccessScreen from '../screens/wallet/PayoutSuccessScreen';
import WalletSecurityScreen from '../screens/wallet/WalletSecurityScreen';
import { PayoutStatusScreen, PayoutHistoryScreen, SavedAddressesScreen } from '../screens/wallet/PayoutScreens';

// Wallet v2 (Session 1 redesign) — own layout, own routes, own onboarding.
// See src/layouts/WalletLayout.jsx and src/screens/wallet/v2/*.jsx.
import WalletLayout from '../layouts/WalletLayout';
import WalletHomeScreen      from '../screens/wallet/v2/HomeScreen';
import WalletBuyScreen       from '../screens/wallet/v2/BuyScreen';
import WalletConvertScreen   from '../screens/wallet/v2/ConvertScreen';
import WalletWithdrawScreen  from '../screens/wallet/v2/WithdrawScreen';
import WalletNewAddressScreen from '../screens/wallet/v2/NewAddressScreen';
import WalletHistoryScreen   from '../screens/wallet/v2/HistoryScreen';
import WalletSettingsV2Screen from '../screens/wallet/v2/SettingsScreen';
import WalletKycScreen       from '../screens/wallet/v2/KycScreen';
import WalletHelpV2Screen    from '../screens/wallet/v2/HelpScreen';
import {
  SecurityScreen          as WalletSecurityHubScreen,
  SecurityPinScreen       as WalletSecurityPinScreen,
  SecurityTotpScreen      as WalletSecurityTotpScreen,
  SecurityAddressesScreen as WalletSecurityAddressesScreen,
  SecurityDepositScreen   as WalletSecurityDepositScreen,
} from '../screens/wallet/v2/SecurityScreens';

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
import CoStreamInviteScreen from '../screens/streams/CoStreamInviteScreen';
import LiveInviteBanner from '../components/LiveInviteBanner';
import TournamentSummonsBanner from '../components/TournamentSummonsBanner';

// Tournaments
import TournamentScreen from '../screens/tournaments/TournamentScreen';
import TournamentStandingsScreen from '../screens/tournaments/TournamentStandingsScreen';
import TournamentPrizePoolScreen from '../screens/tournaments/TournamentPrizePoolScreen';
import MatchDetailsScreen from '../screens/tournaments/MatchDetailsScreen';
import TournamentMatchScreen from '../screens/tournaments/TournamentMatchScreen';
import TournamentStatsScreen from '../screens/tournaments/TournamentStatsScreen';
import ModWallScreen from '../screens/tournaments/ModWallScreen';
import VanguardReviewQueueScreen from '../screens/tournaments/VanguardReviewQueueScreen';
import HudOverlay from '../screens/hud/HudOverlay';
import CheatSignaturesScreen from '../screens/admin/CheatSignaturesScreen';
import AdminRouteGate from '../components/AdminRouteGate';
import TeamManagementScreen from '../screens/tournaments/TeamManagementScreen';
import TeamFundingScreen from '../screens/tournaments/TeamFundingScreen';
import ContributeScreen from '../screens/tournaments/ContributeScreen';
import ContributionSuccessScreen from '../screens/tournaments/ContributionSuccessScreen';
import PrizeReceiptScreen from '../screens/tournaments/PrizeReceiptScreen';
import CreateTournamentScreen from '../screens/tournaments/CreateTournamentScreen';
import ModeratorMatchControlScreen from '../screens/tournaments/ModeratorMatchControlScreen';
import TournamentListScreen from '../screens/tournaments/TournamentListScreen';
import TournamentApplicationsScreen from '../screens/tournaments/TournamentApplicationsScreen';
import CheatFlagClipScreen from '../screens/clips/CheatFlagClipScreen';
import WarmupLobbyScreen from '../screens/tournaments/WarmupLobbyScreen';

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
                  <LiveInviteBanner />
                  <TournamentSummonsBanner />
                  <IncomingCallOverlay />
                  <DesktopNotificationManager />
                  <PresenceManager />
                  <BackupChecker />
                  <ImageProtection />
                  <SignalsCapture />
                  <ConsentSheet />
                  <TosVersionGate />
                  <GuestSignupPrompt />
                  <GuestModeBanner />
                  <NotificationsDrawer />
                  <Routes>
                    {/* ---------- PUBLIC ROUTES (no layout) ---------- */}
                    <Route path="/" element={<RootRoute />} />
                    <Route path="/store" element={<StoreScreen />} />
                    <Route path="/download" element={<DownloadScreen />} />
                    <Route path="/help" element={<MarketingHelpScreen />} />
                    <Route path="/privacy"               element={<LegalScreen type="privacy" />} />
                    <Route path="/terms"                 element={<LegalScreen type="terms" />} />
                    <Route path="/acceptable-use"        element={<LegalScreen type="acceptable_use" />} />
                    <Route path="/cookies"               element={<LegalScreen type="cookies" />} />
                    <Route path="/learn/tournament-rules" element={<LegalScreen type="tournament_rules" />} />
                    {/* Phase 1 marketing pages — see PublicMarketingScreens.jsx */}
                    <Route path="/about" element={<MarketingAboutScreen />} />
                    <Route path="/careers" element={<CareersScreen />} />
                    <Route path="/contact" element={<ContactScreen />} />
                    <Route path="/code-of-conduct" element={<CodeOfConductScreen />} />
                    <Route path="/forums" element={<ForumsScreen />} />
                    <Route path="/streamer" element={<BecomeStreamerScreen />} />
                    <Route path="/monetization" element={<MonetizationScreen />} />
                    <Route path="/studio-tools" element={<StudioToolsScreen />} />
                    <Route path="/partners" element={<PartnerProgramScreen />} />
                    <Route path="/learn/live" element={<LearnLiveScreen />} />
                    <Route path="/learn/tournaments" element={<LearnTournamentsScreen />} />
                    <Route path="/learn/squads" element={<LearnSquadsScreen />} />
                    <Route path="/learn/clips" element={<LearnClipsScreen />} />
                    <Route path="/learn/coins" element={<LearnCoinsScreen />} />

                    {/* Tournament OBS overlay — public (token-gated, not auth-gated) */}
                    <Route path="/overlay/:tournamentId" element={<TournamentOverlayScreen />} />
                    {/* Tournament HUD pack — Neon (v1). Public, no auth.
                        Streamer adds this URL once to OBS as a Browser
                        Source (1920×1080, transparent). Subscribes to live
                        match + picks pool. */}
                    <Route path="/overlay/:tournamentId/neon" element={<TournamentOverlayNeon />} />
                    {/* GR8 — streamer-battle overlay (two-streamer co-stream),
                        reuses the neon visual language, driven by stream/co-host. */}
                    <Route path="/overlay/battle/:streamId/neon" element={<StreamerBattleOverlay />} />

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
                      {/* "Social Media" nav — opens the feed on the Gaming News
                          (RSS/social) tab so it's distinct from Home. */}
                      <Route path="/feed" element={<HomeFeedScreen initialTab="Gaming News" />} />
                      <Route path="/profile" element={<ProfileScreen />} />

                      {/* Home */}
                      <Route path="/earn" element={<EarnCoinsScreen />} />
                      <Route path="/earn/refer" element={<ReferralScreen />} />
                      <Route path="/notifications" element={<NotificationsScreen />} />
                      <Route path="/create-post" element={<Navigate to="/create" replace />} />
                      <Route path="/create-poll" element={<GuestRouteGate action="create polls"><CreatePollScreen /></GuestRouteGate>} />
                      <Route path="/leaderboard" element={<LeaderboardScreen />} />
                      <Route path="/post/:postId" element={<PostDetailScreen />} />
                      <Route path="/trending" element={<TrendingHashtagsScreen />} />

                      {/* Create — all variants are write-only, gated against guests */}
                      <Route path="/create"             element={<GuestRouteGate action="create posts"><CreatePostSelectorScreen /></GuestRouteGate>} />
                      <Route path="/create/text"        element={<GuestRouteGate action="create posts"><CreateTextPostScreen /></GuestRouteGate>} />
                      <Route path="/create/photo"       element={<GuestRouteGate action="post photos"><CreatePhotoPostScreen /></GuestRouteGate>} />
                      <Route path="/create/clip"        element={<GuestRouteGate action="post clips"><CreateClipPostScreen /></GuestRouteGate>} />
                      <Route path="/create/article"     element={<GuestRouteGate action="post articles"><CreateArticleScreen /></GuestRouteGate>} />
                      <Route path="/create/lfg"         element={<GuestRouteGate action="post LFG"><CreateLFGScreen /></GuestRouteGate>} />
                      <Route path="/create/tierlist"    element={<GuestRouteGate action="post tier lists"><CreateTierListScreen /></GuestRouteGate>} />
                      <Route path="/create/achievement" element={<GuestRouteGate action="post achievements"><CreateAchievementScreen /></GuestRouteGate>} />
                      <Route path="/create/quote"       element={<GuestRouteGate action="post quotes"><QuotePostScreen /></GuestRouteGate>} />

                      {/* Shorts */}
                      <Route path="/shorts" element={<ShortsScreen />} />
                      <Route path="/create/short" element={<GuestRouteGate action="create shorts"><CreateShortScreen /></GuestRouteGate>} />

                      {/* Viewers */}
                      <Route path="/clip/:postId" element={<ClipViewerScreen />} />

                      {/* Profile */}
                      <Route path="/edit-profile" element={<GuestRouteGate action="edit your profile"><EditProfileScreen /></GuestRouteGate>} />
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

                      {/* /squads/create was here under MainLayout — moved out
                          to the standalone squad route group below (line ~600)
                          so SquadShell owns the chrome. Leaving it here also
                          rendered DesktopSidebar + SquadShell rails together
                          (double left rail bug, 2026-05-15). */}

                      {/* Wallet — kept here only for the transactions sub-routes
                          which still belong inside MainLayout chrome. The full
                          /wallet/* tree (Home, Buy, Convert, Withdraw, History,
                          Settings, Security, KYC, Help) mounts under WalletLayout
                          OUTSIDE MainLayout — see the standalone <Route> block
                          further down. Legacy paths (/buy-coins, /request-payout,
                          /wallet/payout*, /wallet/addresses) are redirected there
                          too so deep-links from posts / notifications survive. */}
                      <Route path="/transaction/:txId" element={<TransactionReceiptScreen />} />
                      <Route path="/transactions/filter" element={<TransactionFiltersScreen />} />
                      <Route path="/payout-success"          element={<PayoutSuccessScreen />} />
                      <Route path="/wallet/payout/history"   element={<PayoutHistoryScreen />} />
                      <Route path="/wallet/payout/:payoutId" element={<PayoutStatusScreen />} />

                      {/* Legacy → v2 redirects (kept inside MainLayout block
                          so they're caught by the same ProtectedRoute gate). */}
                      <Route path="/buy-coins"          element={<Navigate to="/wallet/buy" replace />} />
                      <Route path="/request-payout"     element={<Navigate to="/wallet/withdraw" replace />} />
                      <Route path="/wallet/payout"      element={<Navigate to="/wallet/withdraw" replace />} />
                      <Route path="/wallet/addresses"   element={<Navigate to="/wallet/security/addresses" replace />} />

                      <Route path="/verification-pending" element={<VerificationPendingScreen />} />

                      {/* Streams */}
                      <Route path="/go-live" element={<GuestRouteGate action="go live"><GoLiveSetupScreen /></GuestRouteGate>} />
                      <Route path="/go-live/co-stream" element={<GuestRouteGate action="co-stream"><CoStreamingScreen /></GuestRouteGate>} />
                      <Route path="/co-stream/invite/:inviteId" element={<GuestRouteGate action="co-stream"><CoStreamInviteScreen /></GuestRouteGate>} />
                      <Route path="/stream/:streamId" element={<LiveStreamScreen />} />
                      <Route path="/broadcast" element={<GuestRouteGate action="broadcast"><BroadcasterScreen /></GuestRouteGate>} />
                      <Route path="/broadcast/:streamId" element={<GuestRouteGate action="broadcast"><BroadcasterScreen /></GuestRouteGate>} />
                      <Route path="/watch" element={<ViewerStreamScreen />} />
                      <Route path="/watch/:streamId" element={<ViewerStreamScreen />} />
                      <Route path="/stream/:streamId/moderation" element={<StreamModerationScreen />} />
                      <Route path="/stream/analytics" element={<StreamAnalyticsScreen />} />
                      <Route path="/stream/ended" element={<StreamEndingScreen />} />

                      {/* Tournaments — browse-only screens stay open; entry
                          and creation require KYC + supported region. */}
                      <Route path="/tournaments" element={<RegionGate feature="tournaments"><TournamentScreen /></RegionGate>} />
                      <Route path="/tournaments/all" element={<RegionGate feature="tournaments"><TournamentListScreen variant="all" /></RegionGate>} />
                      <Route path="/tournaments/mine" element={<RegionGate feature="tournaments"><TournamentListScreen variant="mine" /></RegionGate>} />
                      <Route path="/tournaments/following" element={<RegionGate feature="tournaments"><TournamentListScreen variant="following" /></RegionGate>} />
                      <Route path="/tournaments/past" element={<RegionGate feature="tournaments"><TournamentListScreen variant="past" /></RegionGate>} />
                      <Route path="/tournaments/type/:slug" element={<RegionGate feature="tournaments"><TournamentListScreen variant="type" /></RegionGate>} />
                      <Route path="/tournaments/applications" element={<RegionGate feature="tournaments"><TournamentApplicationsScreen /></RegionGate>} />
                      <Route path="/tournaments/rules" element={<LegalScreen type="tournament_rules" />} />
                      <Route path="/tournaments/:tournamentId/standings" element={<TournamentStandingsScreen />} />
                      <Route path="/tournaments/:tournamentId/prizes" element={<TournamentPrizePoolScreen />} />
                      <Route path="/match/:matchId" element={<RegionGate feature="tournament entry"><MatchDetailsScreen /></RegionGate>} />
                      <Route path="/tournaments/:tournamentId/match/:matchId" element={<RegionGate feature="tournament entry"><TournamentMatchScreen /></RegionGate>} />
                      <Route path="/tournaments/me/stats" element={<TournamentStatsScreen />} />
                      {/* GR6 — coaching marketplace */}
                      <Route path="/coaching" element={<CoachingScreen />} />
                      {/* Mod-internal clip viewer for AI cheat-flag moments.
                          Auth required + client-side mod-role gate. */}
                      <Route path="/clips/cheat-flag/:tournamentId/:matchId/:flagIndex" element={<CheatFlagClipScreen />} />
                      {/* Pre-match warmup lobby — voice P2P + readiness for the two players. */}
                      <Route path="/squads/warmup/:tag" element={<WarmupLobbyScreen />} />
                      <Route path="/vanguard/wall" element={<ModWallScreen />} />
                      <Route path="/vanguard/queue" element={<VanguardReviewQueueScreen />} />
                      <Route path="/team/:teamId/manage" element={<TeamManagementScreen />} />
                      <Route path="/team/:teamId/funding" element={<TeamFundingScreen />} />
                      <Route path="/team-contribute" element={<GuestRouteGate action="fund a team"><RegionGate feature="team funding"><KycGate feature="team funding"><ContributeScreen /></KycGate></RegionGate></GuestRouteGate>} />
                      <Route path="/contribution-success" element={<ContributionSuccessScreen />} />
                      <Route path="/prize-receipt/:prizeId" element={<PrizeReceiptScreen />} />
                      <Route path="/create-tournament" element={<GuestRouteGate action="create a tournament"><RegionGate feature="creating tournaments"><KycGate feature="creating tournaments"><CreateTournamentScreen /></KycGate></RegionGate></GuestRouteGate>} />
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

                      {/* Admin — new sidebar-shell dashboard. Old card-grid replaced 2026-05-17.
                          Phase 1 will replace each "SOON" screen with its redesigned mockup. */}
                      <Route path="/admin" element={<AdminDashboardScreen />} />
                      <Route path="/admin/access" element={<AdminAccessScreen />} />
                      <Route path="/admin/users" element={<AdminUsersScreen />} />
                      <Route path="/admin/economy" element={<AdminEconomyScreen />} />
                      <Route path="/admin/reports" element={<AdminModerationScreen />} />
                      <Route path="/admin/reports/audit" element={<AdminModerationAuditScreen />} />
                      <Route path="/admin/bots" element={<AdminBotsScreen />} />
                      <Route path="/admin/announce" element={<AdminAnnounceScreen />} />
                      <Route path="/admin/vanguard" element={<AdminVanguardScreen />} />
                      <Route path="/admin/security" element={<AdminSecurityScreen />} />
                      <Route path="/admin/config" element={<AdminConfigScreen />} />
                      <Route path="/admin/audit" element={<AdminAuditScreen />} />
                      <Route path="/admin/cheat-signatures" element={
                        <AdminRouteGate screen="cheat-signatures"><CheatSignaturesScreen /></AdminRouteGate>
                      } />
                      <Route path="/hud" element={<HudOverlay />} />
                      <Route path="/admin/subscriptions" element={<AdminSubscriptionsScreen />} />
                      <Route path="/admin/tournaments" element={<AdminTournamentsScreen />} />
                      <Route path="/admin/stats" element={<AdminStatsScreen />} />
                      <Route path="/vanguard/invitation" element={<VanguardInvitationScreen />} />
                      {/* Legacy redirect — /vanguard/me → /vanguard/today (new shell) */}
                      <Route path="/vanguard/me" element={<Navigate to="/vanguard/today" replace />} />

                      {/* Search */}
                      <Route path="/search" element={<SearchResultsAllScreen />} />
                      <Route path="/search/streams" element={<SearchResultsStreamsScreen />} />
                      <Route path="/search/empty" element={<NoSearchResultsScreen />} />

                      {/* Activity */}
                      <Route path="/activity" element={<ActivityLogScreen />} />

                      {/* Vergr.me Editor — Pro user only, protected */}
                      <Route path="/vergrme/edit" element={<VergrMeEditorScreen />} />
                    </Route>

                    {/* ---------- WALLET v2 (own layout — sidebar + topbar + mobile bottom-nav) ---------- */}
                    <Route element={<ProtectedRoute><RegionGate feature="the VERGR wallet"><WalletLayout /></RegionGate></ProtectedRoute>}>
                      <Route path="/wallet"                          element={<WalletHomeScreen />} />
                      <Route path="/wallet/buy"                      element={<WalletBuyScreen />} />
                      <Route path="/wallet/convert"                  element={<WalletConvertScreen />} />
                      <Route path="/wallet/withdraw"                 element={<WalletWithdrawScreen />} />
                      <Route path="/wallet/withdraw/new-address"     element={<WalletNewAddressScreen />} />
                      <Route path="/wallet/history"                  element={<WalletHistoryScreen />} />
                      <Route path="/wallet/settings"                 element={<WalletSettingsV2Screen />} />
                      <Route path="/wallet/security"                 element={<WalletSecurityHubScreen />} />
                      <Route path="/wallet/security/pin"             element={<WalletSecurityPinScreen />} />
                      <Route path="/wallet/security/totp"            element={<WalletSecurityTotpScreen />} />
                      <Route path="/wallet/security/addresses"       element={<WalletSecurityAddressesScreen />} />
                      <Route path="/wallet/security/deposit"         element={<WalletSecurityDepositScreen />} />
                      <Route path="/wallet/kyc"                      element={<WalletKycScreen />} />
                      <Route path="/wallet/help"                     element={<WalletHelpV2Screen />} />
                    </Route>

                    {/* ---------- VANGUARD DASHBOARD (own layout — sidebar + topbar) ---------- */}
                    <Route element={<ProtectedRoute><Outlet /></ProtectedRoute>}>
                      <Route path="/vanguard"                  element={<Navigate to="/vanguard/today" replace />} />
                      <Route path="/vanguard/today"            element={<VanguardTodayScreen />} />
                      <Route path="/vanguard/schedule"         element={<VanguardScheduleScreen />} />
                      <Route path="/vanguard/moderation-room/:assignmentId" element={<VanguardModerationRoomScreen />} />
                      <Route path="/vanguard/queue"            element={<VanguardQueueScreen />} />
                      <Route path="/vanguard/live"             element={<VanguardLiveScreen />} />
                      <Route path="/vanguard/my-cases"         element={<VanguardMyCasesScreen />} />
                      <Route path="/vanguard/notes"            element={<VanguardNotesScreen />} />
                      <Route path="/vanguard/treasury"         element={<VanguardTreasuryScreen />} />
                      <Route path="/vanguard/payouts"          element={<VanguardPayoutsScreen />} />
                      <Route path="/vanguard/wallet"           element={<VanguardWalletScreen />} />
                      <Route path="/vanguard/stats"            element={<VanguardStatsScreen />} />
                      <Route path="/vanguard/rank"             element={<VanguardRankScreen />} />
                      <Route path="/vanguard/peer"             element={<VanguardPeerScreen />} />
                      <Route path="/vanguard/roster"           element={<VanguardRosterScreen />} />
                      <Route path="/vanguard/chat"             element={<VanguardChatScreen />} />
                      <Route path="/vanguard/escalations"      element={<VanguardEscalationsScreen />} />
                      <Route path="/vanguard/handbook"         element={<VanguardHandbookScreen />} />
                      <Route path="/vanguard/library"          element={<VanguardLibraryScreen />} />
                      <Route path="/vanguard/announcements"    element={<VanguardAnnouncementsScreen />} />
                      <Route path="/vanguard/lookup/user"      element={<VanguardLookupUserScreen />} />
                      <Route path="/vanguard/lookup/tournament" element={<VanguardLookupTournamentScreen />} />
                      <Route path="/vanguard/lookup/action"    element={<VanguardLookupActionScreen />} />
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
                      <Route path="browse" element={<BrowseGroupsScreen />} />
                      <Route path="friends" element={<FriendsScreen />} />
                      <Route path="voice/:slug" element={<VoiceChannelScreen />} />
                      <Route path=":chatId" element={<ChatThreadScreen />} />
                    </Route>

                    {/* ---------- SQUADS (redesigned — self-contained SquadShell chrome) ---------- */}
                    {/* Global level */}
                    <Route path="/squads" element={<ProtectedRoute><SquadsScreen /></ProtectedRoute>} />
                    <Route path="/squads/mine" element={<ProtectedRoute><SquadsMineScreen /></ProtectedRoute>} />
                    <Route path="/squads/invitations" element={<ProtectedRoute><SquadInvitationsScreen /></ProtectedRoute>} />
                    <Route path="/squads/applications" element={<ProtectedRoute><SquadApplicationsScreen /></ProtectedRoute>} />
                    <Route path="/squads/players" element={<ProtectedRoute><BrowsePlayersScreen /></ProtectedRoute>} />
                    <Route path="/squads/create" element={<ProtectedRoute><CreateSquadScreen /></ProtectedRoute>} />
                    {/* Per-squad */}
                    <Route path="/squads/:squadId" element={<ProtectedRoute><SquadOverviewScreen /></ProtectedRoute>} />
                    <Route path="/squads/:squadId/chat" element={<ProtectedRoute><SquadChatThreadScreen /></ProtectedRoute>} />
                    <Route path="/squads/:squadId/members" element={<ProtectedRoute><SquadMembersScreen /></ProtectedRoute>} />
                    <Route path="/squads/:squadId/announcements" element={<ProtectedRoute><SquadAnnouncementsScreen /></ProtectedRoute>} />
                    <Route path="/squads/:squadId/leaderboard" element={<ProtectedRoute><SquadLeaderboardScreen /></ProtectedRoute>} />
                    <Route path="/squads/:squadId/events" element={<ProtectedRoute><SquadEventsScreen /></ProtectedRoute>} />
                    <Route path="/squads/:squadId/challenges" element={<ProtectedRoute><SquadChallengesScreen /></ProtectedRoute>} />
                    <Route path="/squads/:squadId/media" element={<ProtectedRoute><SquadMediaScreen /></ProtectedRoute>} />
                    <Route path="/squads/:squadId/pinned" element={<ProtectedRoute><SquadPinnedScreen /></ProtectedRoute>} />
                    <Route path="/squads/:squadId/settings" element={<ProtectedRoute><SquadSettingsScreen /></ProtectedRoute>} />
                    <Route path="/squads/:squadId/roles" element={<ProtectedRoute><SquadRolesScreen /></ProtectedRoute>} />
                    <Route path="/squads/:squadId/requests" element={<ProtectedRoute><SquadJoinRequestsScreen /></ProtectedRoute>} />
                    <Route path="/squads/:squadId/invite" element={<ProtectedRoute><InviteMembersScreen /></ProtectedRoute>} />
                    <Route path="/squads/:squadId/analytics" element={<ProtectedRoute><SquadAnalyticsScreen /></ProtectedRoute>} />
                    {/* Squad voice/video hangout still uses its own self-contained screen */}
                    <Route path="/squads/:squadId/stream" element={<ProtectedRoute><SquadStreamScreen /></ProtectedRoute>} />

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
