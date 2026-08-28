import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation, Link } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import { UserProvider } from '../context/UserContext';
import { NotificationProvider } from '../context/NotificationContext';
import { UIProvider } from '../context/UIContext';
import { LayoutProvider } from '../context/LayoutContext';
import { CartProvider } from '../context/CartContext';
import GlobalCartDrawer from '../components/wallet/GlobalCartDrawer';
import { isTauri, IS_NATIVE_BUILD } from '../utils/platform';
import { pruneNavOrigin } from '../utils/navOrigin';
import ProtectedRoute from '../components/ProtectedRoute';
import ErrorBoundary from '../components/ErrorBoundary';
import DisplaySettingsApplier from '../components/DisplaySettingsApplier';
import KycGate from '../components/KycGate';
import RegionGate from '../components/RegionGate';
import GuestRouteGate from '../components/GuestRouteGate';
import Toast from '../components/Toast';
import PushToast from '../components/PushToast';
import IncomingCallOverlay from '../components/IncomingCallOverlay';
import VoiceSessionPill from '../components/VoiceSessionPill';
// Admin screens are code-split into ./AdminRoutes (lazy) and excluded from the
// native APK build entirely — see the __VERGR_NATIVE__ gate below. Do NOT
// statically import any AdminXScreen here or it rejoins the main bundle.
import DesktopNotificationManager from '../components/DesktopNotificationManager';
import NotificationsDrawer from '../components/NotificationsDrawer';
import ConsentSheet from '../components/ConsentSheet';
import TosVersionGate from '../components/TosVersionGate';
import LevelUpWatcher from '../components/engagement/LevelUpWatcher';
import GuestSignupPrompt from '../components/GuestSignupPrompt';
import AnnouncementPopup from '../components/AnnouncementPopup';
import GuestModeBanner from '../components/GuestModeBanner';
import { captureSignals } from '../utils/captureSignals';
import { setTrackingUser } from '../utils/trackEvent';
import { useAuth } from '../context/AuthContext';
import MainLayout from '../layouts/MainLayout';
import MessagesMasterDetail from '../layouts/MessagesMasterDetail';
import ResponsiveLayout from '../components/ResponsiveLayout';
import LoadingScreen from '../components/LoadingScreen';
import { signalAppPaintedAfterFrame } from '../utils/nativeSplash';
import { prefetchPrimaryRoutes } from '../utils/routePrefetch';
import { FeedSkeleton } from '../components/skeletons/GlassSkeletons';
import FirstBootGate from '../components/FirstBootIntro';
import NativeUpdateBanner from '../components/NativeUpdateBanner';
import DevChannelBadge from '../components/DevChannelBadge';
import { LiveUsersProvider } from '../context/LiveUsersContext';
import InstallAppBanner from '../components/InstallAppBanner';
import { MobileNavDrawerHost } from '../components/MobileNavDrawer';
import usePresence from '../hooks/usePresence';
import { useEffect, Suspense, lazy } from 'react';

// Admin UI is lazy-loaded on web and, crucially, gated behind __VERGR_NATIVE__
// so the admin chunk is tree-shaken out of the native APK build entirely.
// __VERGR_NATIVE__ is a vite `define` (literal true/false), so on native this
// folds to `null` and Rollup never emits AdminRoutes or its admin screens.
const AdminRoutes = __VERGR_NATIVE__ ? null : lazy(() => import('./AdminRoutes'));
import { checkScheduledBackup } from '../utils/chatBackup';

// Vergr.me Link‑in‑Bio
const VergrMeEditorScreen = lazy(() => import('../screens/VergrMeEditorScreen'));
const VergrMePage = lazy(() => import('../screens/VergrMePage'));

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

/**
 * Tells the NATIVE Kotlin splash when it may lift.
 *
 * It is rendered INSIDE <Suspense>, which is the whole trick: React does not
 * mount a Suspense boundary's children until the lazy chunk they need has
 * arrived, so this mounting is proof that a real screen — not a fallback — is
 * about to paint. signalAppPaintedAfterFrame then waits two frames so the paint
 * is genuinely committed before the splash starts its cross-fade.
 *
 * The signal used to live in AuthContext, on auth resolving. That is roughly a
 * second too early: auth only unblocks the router, and the screen behind it was
 * still a pending chunk, so the splash lifted onto nothing. A cold-start capture
 * showed the cost exactly — 200ms of #000000 then 150ms of the bare body colour.
 * Do not move it back to an earlier gate, and do not put it on a timer.
 */
/**
 * Suspense fallback for route transitions.
 *
 * The full <LoadingScreen/> is right for a COLD BOOT — a deep link straight into
 * a lazy screen has nothing else to show. It is wrong for a tab switch: once 311
 * lazy boundaries existed, tapping Explore suspended on a chunk fetch and flashed
 * the whole branded nebula splash for a few tens of milliseconds. Visible, and it
 * reads as the app restarting.
 *
 * So it shows the splash only while the app has never rendered a route, and
 * nothing after that. Combined with prefetchPrimaryRoutes() the common tabs are
 * already in memory and this never renders at all.
 */
let hasRenderedARoute = false;
function RouteFallback() {
  if (!hasRenderedARoute) return <LoadingScreen />;
  // Mid-session: a skeleton, which is what a loading screen is for. Rendering
  // null flashed a blank; rendering the full splash flashed the whole brand
  // animation for a chunk fetch and read as the app restarting.
  return (
    <div className="min-h-screen bg-bg-dark px-4 pt-6">
      <FeedSkeleton count={3} />
    </div>
  );
}

/**
 * Suspense fallback for a Creator Studio route.
 *
 * The global RouteFallback renders a full-width, full-height feed skeleton with
 * NO layout around it. On a studio route that painted edge-to-edge and then
 * jumped sideways the moment CreatorLayout mounted and the sidebar appeared.
 *
 * CreatorLayout is imported eagerly, so it can render inside the fallback while
 * the screen's lazy chunk is still in flight. The nav is therefore present from
 * the first frame and nothing shifts when the screen arrives.
 */
function creatorChunk(page, title, subtitle, Skeleton, children) {
  return (
    <Suspense fallback={
      <CreatorLayout page={page} title={title} subtitle={subtitle}>
        <Skeleton />
      </CreatorLayout>
    }>
      {children}
    </Suspense>
  );
}

function SplashHandoff() {
  const { loading } = useAuth();
  useEffect(() => {
    hasRenderedARoute = true;
    prefetchPrimaryRoutes();
  }, []);
  useEffect(() => {
    // Gate on auth having resolved, not just on this component mounting. Mount
    // alone only proves the route chunk arrived; while `loading` is true every
    // route still renders <LoadingScreen/>, so signalling then hands the screen
    // back to a loading state rather than to the app.
    if (loading) return;
    signalAppPaintedAfterFrame();
  }, [loading]);
  return null;
}

/**
 * Paths on this origin that belong to VLink, not to Vergr.
 *
 * VLink is a separate product served by Cloud Functions behind the /vlink/**
 * and /l/** Hosting rewrites (see firebase.json). They are not Vergr SPA
 * routes and never were.
 *
 * The catch-all below used to send them through RootRoute, which for a
 * logged-out visitor lands on /platform — Vergr's marketing landing. Inside
 * the Shopify admin's app frame that renders a coin-selling page, which is
 * what paused VLink's submission under requirement 1.2.1, ref 126602.
 *
 * Never render Vergr UI on a VLink URL: hand the URL back to the server once,
 * and render nothing rather than redirect.
 */
const VLINK_PATH = /^\/(vlink|l)(\/|$)/;

/**
 * Hand a VLink URL back to the network and render nothing.
 *
 * The sessionStorage flag guards against a reload loop if something is still
 * intercepting the request — better a blank frame than a redirect loop.
 */
function VLinkHandback() {
  const { pathname, search } = window.location;
  try {
    if (!sessionStorage.getItem('vgr_vlink_handback')) {
      sessionStorage.setItem('vgr_vlink_handback', '1');
      window.location.replace(pathname + search);
    }
  } catch (_) { /* private mode: skip the retry, still render nothing */ }
  return null;
}

function CatchAllRoute() {
  // Two or more segments (/vlink/admin/..., /l/handle) land here.
  // LOAD-BEARING — see memory `never-break-vlink`. Unchanged.
  if (VLINK_PATH.test(window.location.pathname)) return <VLinkHandback />;

  // This used to `<Navigate to="/" replace />`, so a mistyped link, a stale
  // push-notification actionUrl, an old email link or any of the many URLs
  // unrouted by the tournament and withdrawal cleanups silently dumped the user
  // on the home feed with no explanation — and `replace` meant Back could not
  // undo it either (audit A21). It gets worse over time, not better, as more
  // old links go stale.
  return <NotFoundScreen />;
}

/**
 * 404. Says what was missed and offers a way on, instead of pretending the
 * navigation succeeded.
 */
function NotFoundScreen() {
  // BrowserRouter (line ~746), so the real path is on `pathname`. CLAUDE.md
  // still describes HashRouter; the code moved and the note did not.
  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  return (
    <div style={{
      minHeight: '70vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 14,
      padding: 24, textAlign: 'center', color: '#fff',
    }}>
      <span className="material-symbols-outlined" style={{ fontSize: 48, opacity: 0.35 }}>explore_off</span>
      <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 22 }}>Page not found</div>
      <div style={{ fontSize: 14, color: '#9CA3AF', maxWidth: 460, lineHeight: 1.6 }}>
        This page has moved or no longer exists.
        {path && (
          <div className="font-dmmono" style={{ fontSize: 12, opacity: 0.6, marginTop: 8, wordBreak: 'break-all' }}>
            {path}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
        {/* <Link>, not <a>: this is BrowserRouter, so a plain anchor would do a
            full page reload. '/' already routes logged-out visitors on to
            /platform, so one destination works for both states. */}
        <Link to="/" style={{
          padding: '10px 18px', borderRadius: 10, textDecoration: 'none',
          background: 'linear-gradient(135deg, #7B1FFF, #B44FFF)',
          color: '#fff', fontWeight: 700, fontSize: 13,
        }}>Go home</Link>
        <Link to="/explore" style={{
          padding: '10px 18px', borderRadius: 10, textDecoration: 'none',
          background: 'transparent', color: '#9CA3AF',
          border: '1px solid rgba(255,255,255,0.14)', fontSize: 13,
        }}>Search</Link>
      </div>
    </div>
  );
}

function RootRoute() {
  const { currentUser, loading } = useAuth();
  // vergr.me ROOT is the link-in-bio product landing (host-gated; dormant
  // until the founder points vergr.me at Hosting, same as VergrMeHostRoute).
  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  if (host === 'vergr.me' || host.endsWith('.vergr.me')) return <LinkInBioScreen />;
  if (loading) return <LoadingScreen />;
  if (!currentUser) {
    // Installed apps should open straight into the app (login → which links to
    // sign-up/onboarding), NOT the public marketing landing. Someone who tapped
    // the app icon already downloaded it — the sales page is pointless there.
    // Covers: the native shell (Tauri Android/desktop), PWA Add-to-Home-Screen /
    // standalone display mode, and the ?source=pwa manifest hint.
    const isStandalone =
      isTauri() ||
      (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches) ||
      (typeof navigator !== 'undefined' && navigator.standalone) ||
      (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('source') === 'pwa');
    if (isStandalone) return <Navigate to="/login" replace />;
    // Public landing lives at /platform (clean, SEO-indexed); root redirects there.
    return <Navigate to="/platform" replace />;
  }
  return IS_NATIVE_BUILD ? <NativeHomeFeedScreen /> : <HomeFeedScreen />;
}

// Auth
const SplashScreen = lazy(() => import('../screens/auth/SplashScreen'));
import LoginScreen from '../screens/auth/LoginScreen';
import ProSubscriptionSite from '../screens/marketing/ProSubscriptionSite';
const SignUpStep1 = lazy(() => import('../screens/auth/SignUpStep1'));
const SignUpStep2 = lazy(() => import('../screens/auth/SignUpStep2'));
const InviteLandingScreen = lazy(() => import('../screens/auth/InviteLandingScreen'));
const ForgotPasswordScreen = lazy(() => import('../screens/auth/ForgotPasswordScreen'));
const TwoFASetupScreen = lazy(() => import('../screens/auth/TwoFASetupScreen'));
const TwoFALoginScreen = lazy(() => import('../screens/auth/TwoFALoginScreen'));
const EmailVerificationScreen = lazy(() => import('../screens/auth/EmailVerificationScreen'));
const PhoneEntryScreen = lazy(() => import('../screens/auth/PhoneEntryScreen'));
const PhoneOTPScreen = lazy(() => import('../screens/auth/PhoneOTPScreen'));
const NewPasswordScreen = lazy(() => import('../screens/auth/NewPasswordScreen'));
const ResetSuccessScreen = lazy(() => import('../screens/auth/ResetSuccessScreen'));
const SocialLoginScreen = lazy(() => import('../screens/auth/SocialLoginScreen'));
const AccountTypeScreen = lazy(() => import('../screens/auth/AccountTypeScreen'));
const ConnectGamingScreen = lazy(() => import('../screens/auth/ConnectGamingScreen'));
import {
  LandingScreen,
  StoreScreen,
  DownloadScreen,
  DesktopAppScreen,
  MobileAppScreen,
  HelpScreen as MarketingHelpScreen,
  HelpCategoryScreen,
  HelpArticleScreen,
  LegalScreen,
  AboutScreen as MarketingAboutScreen,
  CareersScreen,
  ContactScreen,
  CreditsScreen,
  DeleteAccountScreen,
  CodeOfConductScreen,
  ForumsScreen,
  BecomeStreamerScreen,
  MonetizationScreen,
  CreatorsLandingScreen,
  StudioToolsScreen,
  PartnerProgramScreen,
  LearnLiveScreen,
  LearnSquadsScreen,
  LearnClipsScreen,
  LearnCoinsScreen,
  LinkInBioScreen,
  WhatsNewScreen,
} from '../screens/marketing/marketingLazy';

// Onboarding — the setup-first flow (rebuilt 2026-07-09). The old screen
// chain (slides/interests/profile/follow/complete) navigated to routes that
// never existed and dropped its data; legacy paths below redirect into the
// new flow. /onboarding/identity (Didit KYC wizard) is unrelated and stays.
const OnboardingFlowScreen = lazy(() => import('../screens/onboarding/OnboardingFlowScreen'));
const ProfileIdentityScreen = lazy(() => import('../screens/onboarding/ProfileIdentityScreen'));

// Main tabs
import HomeFeedScreen from '../screens/home/HomeFeedScreen';
import NativeHomeFeedScreen from '../screens/home/native/NativeHomeFeedScreen';
const ExploreScreen = lazy(() => import('../screens/explore/ExploreScreen'));
const NativeExploreScreen = lazy(() => import('../screens/explore/native/NativeExploreScreen'));
const NativeEditProfileScreen = lazy(() => import('../screens/profile/native/NativeEditProfileScreen'));
const SquadsScreen = lazy(() => import('../screens/squads/SquadsScreen'));
const ProfileScreen = lazy(() => import('../screens/profile/ProfileScreen'));
const NativeProfileScreen = lazy(() => import('../screens/profile/native/NativeProfileScreens').then((m) => ({ default: m.NativeProfileScreen })));
const NativePublicProfileScreen = lazy(() => import('../screens/profile/native/NativeProfileScreens').then((m) => ({ default: m.NativePublicProfileScreen })));

// Home
const EarnCoinsScreen = lazy(() => import('../screens/home/EarnCoinsScreen'));
const NotificationsScreen = lazy(() => import('../screens/home/NotificationsScreen'));
const CreatePostScreen = lazy(() => import('../screens/home/CreatePostScreen'));
const LeaderboardScreen = lazy(() => import('../screens/home/LeaderboardScreen'));
const PostDetailScreen = lazy(() => import('../screens/home/PostDetailScreen'));
const CreatePollScreen = lazy(() => import('../screens/home/CreatePollScreen'));
const TrendingHashtagsScreen = lazy(() => import('../screens/home/TrendingHashtagsScreen'));
const NativeNotificationsScreen = lazy(() => import('../screens/home/native/NativeHomeScreens').then((m) => ({ default: m.NativeNotificationsScreen })));
const NativeTrendingHashtagsScreen = lazy(() => import('../screens/home/native/NativeHomeScreens').then((m) => ({ default: m.NativeTrendingHashtagsScreen })));
const NativeLeaderboardScreen = lazy(() => import('../screens/home/native/NativeHomeScreens').then((m) => ({ default: m.NativeLeaderboardScreen })));
const NativeEarnCoinsScreen = lazy(() => import('../screens/home/native/NativeHomeScreens').then((m) => ({ default: m.NativeEarnCoinsScreen })));
const NativeReferralScreen = lazy(() => import('../screens/home/native/NativeHomeScreens').then((m) => ({ default: m.NativeReferralScreen })));
const NativePostDetailScreen = lazy(() => import('../screens/home/native/NativeHomeScreens').then((m) => ({ default: m.NativePostDetailScreen })));
// Create (post types)
const CreatePostSelectorScreen = lazy(() => import('../screens/create/CreatePostSelectorScreen'));
const CreateTextPostScreen = lazy(() => import('../screens/create/CreateTextPostScreen'));
const CreatePhotoPostScreen = lazy(() => import('../screens/create/CreatePhotoPostScreen'));
const CreateClipPostScreen = lazy(() => import('../screens/create/CreateClipPostScreen'));
const CreateArticleScreen = lazy(() => import('../screens/create/CreateArticleScreen'));
const CreateLFGScreen = lazy(() => import('../screens/create/CreateLFGScreen'));
const CreateTierListScreen = lazy(() => import('../screens/create/CreateTierListScreen'));
const CreateAchievementScreen = lazy(() => import('../screens/create/CreateAchievementScreen'));
const QuotePostScreen = lazy(() => import('../screens/create/QuotePostScreen'));

// Viewers
const ClipViewerScreen = lazy(() => import('../screens/viewer/ClipViewerScreen'));
const NativeClipViewerScreen = lazy(() => import('../screens/viewer/native/NativeClipViewerScreen'));

// Shorts
const ShortsScreen = lazy(() => import('../screens/shorts/ShortsScreen'));
const NativeShortsScreen = lazy(() => import('../screens/shorts/native/NativeShortsScreen'));
const CreateShortScreen = lazy(() => import('../screens/create/CreateShortScreen'));
const NativeCreatePostSelectorScreen = lazy(() => import('../screens/create/native/NativeCreateScreens').then((m) => ({ default: m.NativeCreatePostSelectorScreen })));
const NativeCreateTextPostScreen = lazy(() => import('../screens/create/native/NativeCreateScreens').then((m) => ({ default: m.NativeCreateTextPostScreen })));
const NativeCreatePhotoPostScreen = lazy(() => import('../screens/create/native/NativeCreateScreens').then((m) => ({ default: m.NativeCreatePhotoPostScreen })));
const NativeCreateClipPostScreen = lazy(() => import('../screens/create/native/NativeCreateScreens').then((m) => ({ default: m.NativeCreateClipPostScreen })));
const NativeCreateShortScreen = lazy(() => import('../screens/create/native/NativeCreateScreens').then((m) => ({ default: m.NativeCreateShortScreen })));
const NativeCreateArticleScreen = lazy(() => import('../screens/create/native/NativeCreateScreens').then((m) => ({ default: m.NativeCreateArticleScreen })));
const NativeCreateAchievementScreen = lazy(() => import('../screens/create/native/NativeCreateScreens').then((m) => ({ default: m.NativeCreateAchievementScreen })));
const NativeCreateLFGScreen = lazy(() => import('../screens/create/native/NativeCreateScreens').then((m) => ({ default: m.NativeCreateLFGScreen })));
const NativeCreateTierListScreen = lazy(() => import('../screens/create/native/NativeCreateScreens').then((m) => ({ default: m.NativeCreateTierListScreen })));
const NativeQuotePostScreen = lazy(() => import('../screens/create/native/NativeCreateScreens').then((m) => ({ default: m.NativeQuotePostScreen })));
const NativeCreatePollScreen = lazy(() => import('../screens/create/native/NativeCreateScreens').then((m) => ({ default: m.NativeCreatePollScreen })));
// Profile
const EditProfileScreen = lazy(() => import('../screens/profile/EditProfileScreen'));
const FollowListScreen = lazy(() => import('../screens/profile/FollowListScreen'));
const NativeFollowListScreen = lazy(() => import('../screens/explore/native/NativeDiscoveryScreens').then((m) => ({ default: m.NativeFollowListScreen })));
const NativeSearchResultsAllScreen = lazy(() => import('../screens/explore/native/NativeDiscoveryScreens').then((m) => ({ default: m.NativeSearchResultsAllScreen })));
const PublicProfileScreen = lazy(() => import('../screens/profile/PublicProfileScreen'));
const MyMembershipsScreen = lazy(() => import('../screens/MyMembershipsScreen'));
const VergrMePurchasesScreen = lazy(() => import('../screens/VergrMePurchasesScreen'));
const NativeMyMembershipsScreen = lazy(() => import('../screens/membership/native/NativeMyMembershipsScreen'));
const BrowseCreatorsScreen = lazy(() => import('../screens/profile/BrowseCreatorsScreen'));
const EsportsTeamScreen = lazy(() => import('../screens/profile/EsportsTeamScreen'));
const PrestigeLevelsScreen = lazy(() => import('../screens/profile/PrestigeLevelsScreen'));
const NativeSearchResultsStreamsScreen = lazy(() => import('../screens/explore/native/NativeDiscoveryScreens').then((m) => ({ default: m.NativeSearchResultsStreamsScreen })));
const NativeBrowseCreatorsScreen = lazy(() => import('../screens/explore/native/NativeDiscoveryScreens').then((m) => ({ default: m.NativeBrowseCreatorsScreen })));
const NativePrestigeLevelsScreen = lazy(() => import('../screens/explore/native/NativeDiscoveryScreens').then((m) => ({ default: m.NativePrestigeLevelsScreen })));
const NativeEsportsTeamScreen = lazy(() => import('../screens/explore/native/NativeDiscoveryScreens').then((m) => ({ default: m.NativeEsportsTeamScreen })));

// Messages
const MessagesInboxScreen = lazy(() => import('../screens/messages/MessagesInboxScreen'));
const NativeMessagesInboxScreen = lazy(() => import('../screens/messages/native/NativeMessageScreens').then((m) => ({ default: m.NativeMessagesInboxScreen })));
const ChatThreadScreen = lazy(() => import('../screens/messages/ChatThreadScreen'));
const MessageRequestsScreen = lazy(() => import('../screens/messages/MessageRequestsScreen'));
// Official Vergr channels: the broadcast threads that sit in the message list.
const ChannelThreadScreen = lazy(() => import('../screens/messages/ChannelThreadScreen'));
const CallHistoryScreen = lazy(() => import('../screens/messages/CallHistoryScreen'));
const CreateGroupChatScreen = lazy(() => import('../screens/messages/CreateGroupChatScreen'));
const NewMessageScreen = lazy(() => import('../screens/messages/NewMessageScreen'));
const ChatSettingsScreen = lazy(() => import('../screens/messages/ChatSettingsScreen'));
const ChatDetailScreen = lazy(() => import('../screens/messages/ChatDetailScreen'));
const GroupInfoScreen = lazy(() => import('../screens/messages/GroupInfoScreen'));
const JoinGroupScreen = lazy(() => import('../screens/messages/JoinGroupScreen'));
const ImportChatScreen = lazy(() => import('../screens/messages/ImportChatScreen'));
const CallScreen = lazy(() => import('../screens/messages/CallScreen'));
const GroupCallScreen = lazy(() => import('../screens/messages/GroupCallScreen'));
// Messages — dedicated native (phone) screens
const NativeMessageRequestsScreen = lazy(() => import('../screens/messages/native/NativeMessageRequestsScreen'));
const NativeCallHistoryScreen = lazy(() => import('../screens/messages/native/NativeCallHistoryScreen'));
const NativeCreateGroupChatScreen = lazy(() => import('../screens/messages/native/NativeCreateGroupChatScreen'));
const NativeNewMessageScreen = lazy(() => import('../screens/messages/native/NativeNewMessageScreen'));
const NativeChatSettingsScreen = lazy(() => import('../screens/messages/native/NativeChatSettingsScreen'));
const NativeChatDetailScreen = lazy(() => import('../screens/messages/native/NativeChatDetailScreen'));
const NativeGroupInfoScreen = lazy(() => import('../screens/messages/native/NativeGroupInfoScreen'));
const NativeJoinGroupScreen = lazy(() => import('../screens/messages/native/NativeJoinGroupScreen'));
const NativeFriendsScreen = lazy(() => import('../screens/messages/native/NativeFriendsScreen'));
const NativeBrowseGroupsScreen = lazy(() => import('../screens/messages/native/NativeBrowseGroupsScreen'));
const NativeVoiceChannelScreen = lazy(() => import('../screens/messages/native/NativeVoiceChannelScreen'));
const NativeChatThreadScreen = lazy(() => import('../screens/messages/native/NativeChatThreadScreen'));
const NativeCallScreen = lazy(() => import('../screens/messages/native/NativeCallScreen'));

// Squads
const CreateSquadScreen = lazy(() => import('../screens/squads/CreateSquadScreen'));
const SquadDetailScreen = lazy(() => import('../screens/squads/SquadDetailScreen'));
const SquadOverviewScreen = lazy(() => import('../screens/squads/SquadOverviewScreen'));
const SquadStreamScreen = lazy(() => import('../screens/squads/SquadStreamScreen'));
const VoiceChannelScreen = lazy(() => import('../screens/messages/VoiceChannelScreen'));
const FriendsScreen = lazy(() => import('../screens/messages/FriendsScreen'));
const BrowseGroupsScreen = lazy(() => import('../screens/messages/BrowseGroupsScreen'));
const SquadChatThreadScreen = lazy(() => import('../screens/squads/SquadChatThreadScreen'));
const SquadSettingsScreen = lazy(() => import('../screens/squads/SquadSettingsScreen'));
const SquadRolesScreen = lazy(() => import('../screens/squads/SquadRolesScreen'));
const SquadMembersScreen = lazy(() => import('../screens/squads/SquadMembersScreen'));
const SquadMediaScreen = lazy(() => import('../screens/squads/SquadMediaScreen'));
const SquadPinnedScreen = lazy(() => import('../screens/squads/SquadPinnedScreen'));
const SquadChallengesScreen = lazy(() => import('../screens/squads/SquadChallengesScreen'));
const SquadEventsScreen = lazy(() => import('../screens/squads/SquadEventsScreen'));
const SquadJoinRequestsScreen = lazy(() => import('../screens/squads/SquadJoinRequestsScreen'));
const SquadAnnouncementsScreen = lazy(() => import('../screens/squads/SquadAnnouncementsScreen'));
const SquadLeaderboardScreen = lazy(() => import('../screens/squads/SquadLeaderboardScreen'));
const SquadsMineScreen = lazy(() => import('../screens/squads/SquadsMineScreen'));
const SquadInvitationsScreen = lazy(() => import('../screens/squads/SquadInvitationsScreen'));
const SquadApplicationsScreen = lazy(() => import('../screens/squads/SquadApplicationsScreen'));
const BrowsePlayersScreen = lazy(() => import('../screens/squads/BrowsePlayersScreen'));
const SquadAnalyticsScreen = lazy(() => import('../screens/squads/SquadAnalyticsScreen'));
// Native squad screens (rendered only on the APK build via IS_NATIVE_BUILD).
const NativeSquadsScreen = lazy(() => import('../screens/squads/native/NativeSquadsScreen'));
const NativeSquadsMineScreen = lazy(() => import('../screens/squads/native/NativeSquadsMineScreen'));
const NativeSquadInvitationsScreen = lazy(() => import('../screens/squads/native/NativeSquadInvitationsScreen'));
const NativeSquadApplicationsScreen = lazy(() => import('../screens/squads/native/NativeSquadApplicationsScreen'));
const NativeBrowsePlayersScreen = lazy(() => import('../screens/squads/native/NativeBrowsePlayersScreen'));
const NativeCreateSquadScreen = lazy(() => import('../screens/squads/native/NativeCreateSquadScreen'));
const NativeSquadOverviewScreen = lazy(() => import('../screens/squads/native/NativeSquadOverviewScreen'));
const NativeSquadMembersScreen = lazy(() => import('../screens/squads/native/NativeSquadMembersScreen'));
const NativeSquadEventsScreen = lazy(() => import('../screens/squads/native/NativeSquadEventsScreen'));
const NativeSquadChallengesScreen = lazy(() => import('../screens/squads/native/NativeSquadChallengesScreen'));
const NativeSquadAnnouncementsScreen = lazy(() => import('../screens/squads/native/NativeSquadAnnouncementsScreen'));
const NativeSquadLeaderboardScreen = lazy(() => import('../screens/squads/native/NativeSquadLeaderboardScreen'));
const NativeSquadMediaScreen = lazy(() => import('../screens/squads/native/NativeSquadMediaScreen'));
const NativeSquadPinnedScreen = lazy(() => import('../screens/squads/native/NativeSquadPinnedScreen'));
const NativeSquadSettingsScreen = lazy(() => import('../screens/squads/native/NativeSquadSettingsScreen'));
const NativeSquadRolesScreen = lazy(() => import('../screens/squads/native/NativeSquadRolesScreen'));
const NativeSquadJoinRequestsScreen = lazy(() => import('../screens/squads/native/NativeSquadJoinRequestsScreen'));
const NativeSquadAnalyticsScreen = lazy(() => import('../screens/squads/native/NativeSquadAnalyticsScreen'));
const NativeInviteMembersScreen = lazy(() => import('../screens/squads/native/NativeInviteMembersScreen'));
const NativeSquadChatThreadScreen = lazy(() => import('../screens/squads/native/NativeSquadChatThreadScreen'));
const NativeSquadStreamScreen = lazy(() => import('../screens/squads/native/NativeSquadStreamScreen'));
const VanguardInvitationScreen = lazy(() => import('../screens/vanguard/VanguardInvitationScreen'));
const VanguardMeScreen = lazy(() => import('../screens/vanguard/VanguardMeScreen'));
const VanguardTodayScreen = lazy(() => import('../screens/vanguard/VanguardTodayScreen'));
const VanguardScheduleScreen = lazy(() => import('../screens/vanguard/VanguardScheduleScreen'));
const VanguardModerationRoomScreen = lazy(() => import('../screens/vanguard/VanguardModerationRoomScreen'));
// The two tournament OBS overlays are no longer imported here: neither had a
// Route, so they were dead weight. TournamentOverlayNeon.jsx itself stays on
// disk because StreamerBattleOverlay imports its exported OVERLAY_CSS.
const StreamerBattleOverlay = lazy(() => import('../screens/overlay/StreamerBattleOverlay'));
const VanguardQueueScreen = lazy(() => import('../screens/vanguard/VanguardQueueScreen'));
const VanguardTreasuryScreen = lazy(() => import('../screens/vanguard/VanguardTreasuryScreen'));
const VanguardWalletScreen = lazy(() => import('../screens/vanguard/VanguardWalletScreen'));
const VanguardRankScreen = lazy(() => import('../screens/vanguard/VanguardRankScreen'));
const VanguardStatsScreen = lazy(() => import('../screens/vanguard/VanguardStatsScreen'));
const VanguardRosterScreen = lazy(() => import('../screens/vanguard/VanguardRosterScreen'));
const VanguardHandbookScreen = lazy(() => import('../screens/vanguard/VanguardHandbookScreen'));
const VanguardPeerScreen = lazy(() => import('../screens/vanguard/VanguardPagesB').then((m) => ({ default: m.VanguardPeerScreen })));
const VanguardLiveScreen = lazy(() => import('../screens/vanguard/VanguardPagesB').then((m) => ({ default: m.VanguardLiveScreen })));
const VanguardPayoutsScreen = lazy(() => import('../screens/vanguard/VanguardPagesB').then((m) => ({ default: m.VanguardPayoutsScreen })));
const VanguardMyCasesScreen = lazy(() => import('../screens/vanguard/VanguardPagesB').then((m) => ({ default: m.VanguardMyCasesScreen })));
const VanguardNotesScreen = lazy(() => import('../screens/vanguard/VanguardPagesB').then((m) => ({ default: m.VanguardNotesScreen })));
const VanguardEscalationsScreen = lazy(() => import('../screens/vanguard/VanguardPagesB').then((m) => ({ default: m.VanguardEscalationsScreen })));
const VanguardAnnouncementsScreen = lazy(() => import('../screens/vanguard/VanguardPagesB').then((m) => ({ default: m.VanguardAnnouncementsScreen })));
const VanguardLibraryScreen = lazy(() => import('../screens/vanguard/VanguardPagesB').then((m) => ({ default: m.VanguardLibraryScreen })));
const VanguardChatScreen = lazy(() => import('../screens/vanguard/VanguardPagesB').then((m) => ({ default: m.VanguardChatScreen })));
const VanguardLookupUserScreen = lazy(() => import('../screens/vanguard/VanguardPagesB').then((m) => ({ default: m.VanguardLookupUserScreen })));
const VanguardLookupTournamentScreen = lazy(() => import('../screens/vanguard/VanguardPagesB').then((m) => ({ default: m.VanguardLookupTournamentScreen })));
const VanguardLookupActionScreen = lazy(() => import('../screens/vanguard/VanguardPagesB').then((m) => ({ default: m.VanguardLookupActionScreen })));
const InviteMembersScreen = lazy(() => import('../screens/squads/InviteMembersScreen'));

// Wallet & Coins
const TransactionReceiptScreen = lazy(() => import('../screens/wallet/TransactionReceiptScreen'));
const TransactionFiltersScreen = lazy(() => import('../screens/wallet/TransactionFiltersScreen'));
const PayoutSuccessScreen = lazy(() => import('../screens/wallet/PayoutSuccessScreen'));
const WalletSecurityScreen = lazy(() => import('../screens/wallet/WalletSecurityScreen'));

// Wallet v2 (Session 1 redesign) — own layout, own routes, own onboarding.
// See src/layouts/WalletLayout.jsx and src/screens/wallet/v2/*.jsx.
import WalletLayout from '../layouts/WalletLayout';

// Vergr Shop — standalone seller workspace (own layout + side nav).
import ShopLayout from '../layouts/ShopLayout';
const LinkShopifyScreen = lazy(() => import('../screens/shop/LinkShopifyScreen'));
const ShopOverviewScreen = lazy(() => import('../screens/shop/ShopScreens').then((m) => ({ default: m.ShopOverviewScreen })));
const ShopProductsScreen = lazy(() => import('../screens/shop/ShopScreens').then((m) => ({ default: m.ShopProductsScreen })));
const ShopOrdersScreen = lazy(() => import('../screens/shop/ShopScreens').then((m) => ({ default: m.ShopOrdersScreen })));
const ShopCustomersScreen = lazy(() => import('../screens/shop/ShopScreens').then((m) => ({ default: m.ShopCustomersScreen })));
const ShopIntegrationsScreen = lazy(() => import('../screens/shop/ShopScreens').then((m) => ({ default: m.ShopIntegrationsScreen })));
const ShopSettingsScreen = lazy(() => import('../screens/shop/ShopScreens').then((m) => ({ default: m.ShopSettingsScreen })));
const WalletHomeScreen = lazy(() => import('../screens/wallet/v2/HomeScreen'));
const WalletBuyScreen = lazy(() => import('../screens/wallet/v2/BuyScreen'));
// Mobile basket. Desktop uses the slide-in drawer instead; both render the same
// CartContents so the lines and totals cannot diverge.
const WalletCartScreen = lazy(() => import('../screens/wallet/v2/CartScreen'));
const WalletHistoryScreen = lazy(() => import('../screens/wallet/v2/HistoryScreen'));
const WalletSettingsV2Screen = lazy(() => import('../screens/wallet/v2/SettingsScreen'));
const WalletKycScreen = lazy(() => import('../screens/wallet/v2/KycScreen'));
const WalletHelpV2Screen = lazy(() => import('../screens/wallet/v2/HelpScreen'));
// NATIVE-APP-ONLY wallet screens (single-column, immune to the Android WebView's
// inflated layout width). Desktop + mobile-web keep the v2 screens above.
const NativeHomeScreen = lazy(() => import('../screens/wallet/native/NativeWalletScreens').then((m) => ({ default: m.NativeHomeScreen })));
const NativeSettingsScreen = lazy(() => import('../screens/wallet/native/NativeWalletScreens').then((m) => ({ default: m.NativeSettingsScreen })));
const NativeHistoryScreen = lazy(() => import('../screens/wallet/native/NativeWalletScreens').then((m) => ({ default: m.NativeHistoryScreen })));
const NativeKycScreen = lazy(() => import('../screens/wallet/native/NativeWalletScreens').then((m) => ({ default: m.NativeKycScreen })));
const NativeBuyScreen = lazy(() => import('../screens/wallet/native/NativeWalletScreens').then((m) => ({ default: m.NativeBuyScreen })));
import {
  SecurityScreen          as WalletSecurityHubScreen,
  SecurityPinScreen       as WalletSecurityPinScreen,
  SecurityTotpScreen      as WalletSecurityTotpScreen,
} from '../screens/wallet/v2/SecurityScreens';

// Creator
const CreatorDashboardScreen = lazy(() => import('../screens/creator/CreatorDashboardScreen'));
const CreatorHomeScreen = lazy(() => import('../screens/creator/CreatorHomeScreen'));
const CreatorEarningsScreen = lazy(() => import('../screens/creator/CreatorEarningsScreen'));
const BecomeCreatorScreen = lazy(() => import('../screens/creator/BecomeCreatorScreen'));
const PayoutSetupScreen = lazy(() => import('../screens/creator/PayoutScreens').then((m) => ({ default: m.PayoutSetupScreen })));
const PayoutStatementScreen = lazy(() => import('../screens/creator/PayoutScreens').then((m) => ({ default: m.PayoutStatementScreen })));
const CreatorContentScreen = lazy(() => import('../screens/creator/CreatorContentScreen'));
const CreatorScheduleScreen = lazy(() => import('../screens/creator/CreatorScheduleScreen'));
const CreatorAudienceScreen = lazy(() => import('../screens/creator/CreatorAudienceScreen'));
const CreatorCommunityScreen = lazy(() => import('../screens/creator/CreatorCommunityScreen'));
const MonthlyAnalyticsScreen = lazy(() => import('../screens/creator/MonthlyAnalyticsScreen'));
const CreatorQuestsScreen = lazy(() => import('../screens/creator/CreatorQuestsScreen'));
const MembershipTiersScreen = lazy(() => import('../screens/creator/MembershipTiersScreen'));
const CreatorVerificationScreen = lazy(() => import('../screens/creator/CreatorVerificationScreen'));
// Creator Studio — dedicated native (phone) screens
const NativeCreatorDashboardScreen = lazy(() => import('../screens/creator/native/NativeCreatorDashboardScreen'));
const NativeCreatorEarningsScreen = lazy(() => import('../screens/creator/native/NativeCreatorEarningsScreen'));
const NativeCreatorContentScreen = lazy(() => import('../screens/creator/native/NativeCreatorContentScreen'));
const NativeCreatorScheduleScreen = lazy(() => import('../screens/creator/native/NativeCreatorScheduleScreen'));
const NativeCreatorAudienceScreen = lazy(() => import('../screens/creator/native/NativeCreatorAudienceScreen'));
const NativeCreatorCommunityScreen = lazy(() => import('../screens/creator/native/NativeCreatorCommunityScreen'));
const NativeCreatorAnalyticsScreen = lazy(() => import('../screens/creator/native/NativeCreatorAnalyticsScreen'));
const NativeCreatorQuestsScreen = lazy(() => import('../screens/creator/native/NativeCreatorQuestsScreen'));
const NativeCreatorMembershipScreen = lazy(() => import('../screens/creator/native/NativeCreatorMembershipScreen'));
const NativeCreatorAdsScreen = lazy(() => import('../screens/creator/native/NativeCreatorAdsScreen'));
const NativeCreatorVerifyScreen = lazy(() => import('../screens/creator/native/NativeCreatorVerifyScreen'));
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

// Bare /:username route. Only resolves to the vergr.me link-in-bio page when
// the page is served on the vergr.me apex (so vergr.me/Vergr serves the page
// directly, no /u/ prefix). On vergr.app a single unknown segment falls back
// to home, matching the previous catch-all behaviour. Static routes always
// outrank this dynamic single-segment route, so app routes are unaffected.
function VergrMeHostRoute() {
  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  // `/vlink` is ONE segment, so React Router ranks it as a :username match and
  // it never reaches the catch-all. That is the exact URL Shopify loads the
  // embedded app at, so without this the Navigate below sent the app frame to
  // "/" and on to /platform — Vergr's coin-selling landing page, rendered
  // inside the Shopify admin. Requirement 1.2.1, ref 126602.
  if (VLINK_PATH.test(window.location.pathname)) return <VLinkHandback />;
  const isVergrMe = host === 'vergr.me' || host.endsWith('.vergr.me');
  return isVergrMe ? <VergrMePage /> : <Navigate to="/" replace />;
}
const VerificationPendingScreen = lazy(() => import('../screens/creator/VerificationPendingScreen'));
import CreatorLayout from '../components/creator/CreatorLayout';
import { AnalyticsSkeleton, EarningsSkeleton, HomeSkeleton, PayoutSetupSkeleton, StatementSkeleton, PanelListSkeleton } from '../components/creator/StudioSkeletons';

// Streams
const GoLiveSetupScreen = lazy(() => import('../screens/streams/GoLiveSetupScreen'));
const LiveStreamScreen = lazy(() => import('../screens/streams/LiveStreamScreen'));
const LiveStreamsScreen = lazy(() => import('../screens/streams/LiveStreamsScreen'));
const BroadcasterScreen = lazy(() => import('../screens/streams/BroadcasterScreen'));
const ViewerStreamScreen = lazy(() => import('../screens/streams/ViewerStreamScreen'));
const StreamAnalyticsScreen = lazy(() => import('../screens/streams/StreamAnalyticsScreen'));
const StreamEndingScreen = lazy(() => import('../screens/streams/StreamEndingScreen'));
const StreamModerationScreen = lazy(() => import('../screens/streams/StreamModerationScreen'));
const CoStreamingScreen = lazy(() => import('../screens/streams/CoStreamingScreen'));
const CoStreamInviteScreen = lazy(() => import('../screens/streams/CoStreamInviteScreen'));
const NativeGoLiveScreen = lazy(() => import('../screens/streams/native/NativeGoLiveScreen'));
const NativeBroadcasterScreen = lazy(() => import('../screens/streams/native/NativeBroadcasterScreen'));
const NativeViewerStreamScreen = lazy(() => import('../screens/streams/native/NativeViewerStreamScreen'));
const NativeCoStreamingScreen = lazy(() => import('../screens/streams/native/NativeStreamScreens').then((m) => ({ default: m.NativeCoStreamingScreen })));
const NativeCoStreamInviteScreen = lazy(() => import('../screens/streams/native/NativeStreamScreens').then((m) => ({ default: m.NativeCoStreamInviteScreen })));
const NativeStreamEndingScreen = lazy(() => import('../screens/streams/native/NativeStreamScreens').then((m) => ({ default: m.NativeStreamEndingScreen })));
const NativeStreamAnalyticsScreen = lazy(() => import('../screens/streams/native/NativeStreamScreens').then((m) => ({ default: m.NativeStreamAnalyticsScreen })));
import LiveInviteBanner from '../components/LiveInviteBanner';
// TournamentSummonsBanner unmounted with the tournaments section. The
// component file is kept; re-import and re-mount below to restore it.

// Tournaments
const ModWallScreen = lazy(() => import('../screens/tournaments/ModWallScreen'));
const VanguardReviewQueueScreen = lazy(() => import('../screens/tournaments/VanguardReviewQueueScreen'));
const HudOverlay = lazy(() => import('../screens/hud/HudOverlay'));
const EventLandingScreen = lazy(() => import('../screens/events/EventLandingScreen'));
const CreateEventScreen = lazy(() => import('../screens/events/CreateEventScreen'));

// Settings
const SettingsScreen = lazy(() => import('../screens/settings/SettingsScreen'));
const NativeSettingsHubScreen = lazy(() => import('../screens/settings/native/NativeSettingsScreen'));
const BackupSettingsScreen = lazy(() => import('../screens/settings/BackupSettingsScreen'));
const PrivacySettingsScreen = lazy(() => import('../screens/settings/PrivacySettingsScreen'));
const LinkedAccountsScreen = lazy(() => import('../screens/settings/LinkedAccountsScreen'));
const NotificationSettingsScreen = lazy(() => import('../screens/settings/NotificationSettingsScreen'));
const AboutScreen = lazy(() => import('../screens/settings/AboutScreen'));
const SecuritySettingsScreen = lazy(() => import('../screens/settings/SecuritySettingsScreen'));
const LanguageSettingsScreen = lazy(() => import('../screens/settings/LanguageSettingsScreen'));
const DisplaySettingsScreen = lazy(() => import('../screens/settings/DisplaySettingsScreen'));
const StorageSettingsScreen = lazy(() => import('../screens/settings/StorageSettingsScreen'));
const AppPermissionsScreen = lazy(() => import('../screens/settings/AppPermissionsScreen'));
const BlockedWordsScreen = lazy(() => import('../screens/settings/BlockedWordsScreen'));
const BlockedUsersScreen = lazy(() => import('../screens/settings/BlockedUsersScreen'));
const AccountDataExportScreen = lazy(() => import('../screens/settings/AccountDataExportScreen'));
const AccountDeletionScreen = lazy(() => import('../screens/settings/AccountDeletionScreen'));
const DisconnectAccountScreen = lazy(() => import('../screens/settings/DisconnectAccountScreen'));
const HelpCenterScreen = lazy(() => import('../screens/settings/HelpCenterScreen'));
const HowItWorksScreen = lazy(() => import('../screens/settings/HowItWorksScreen'));
const BoostScreen = lazy(() => import('../screens/wallet/BoostScreen'));
const ReferralScreen = lazy(() => import('../screens/home/ReferralScreen'));
const WalletReferralScreen = lazy(() => import('../screens/home/ReferralScreen').then((m) => ({ default: m.WalletReferralScreen })));
const CallsScreen = lazy(() => import('../screens/calls/CallsScreen'));
const StatusScreen = lazy(() => import('../screens/status/StatusScreen'));
const SquadsHub = lazy(() => import('../screens/messages/hub/SquadsHub'));
const PrivacyPolicyScreen = lazy(() => import('../screens/settings/PrivacyPolicyScreen'));
const PhoneAllowListScreen = lazy(() => import('../screens/settings/PhoneAllowListScreen'));
const SubscriptionScreen = lazy(() => import('../screens/settings/SubscriptionScreen'));
const VPRanksScreen = lazy(() => import('../screens/settings/VPRanksScreen'));

// Ad Center
const AdCenterScreen = lazy(() => import('../screens/ad/AdCenterScreen'));

// Search
const SearchResultsAllScreen = lazy(() => import('../screens/search/SearchResultsAllScreen'));
const SearchResultsStreamsScreen = lazy(() => import('../screens/search/SearchResultsStreamsScreen'));
const NoSearchResultsScreen = lazy(() => import('../screens/search/NoSearchResultsScreen'));

// Utility
const MaintenanceScreen = lazy(() => import('../screens/utility/MaintenanceScreen'));
const ForceUpdateScreen = lazy(() => import('../screens/utility/ForceUpdateScreen'));
const NetworkErrorScreen = lazy(() => import('../screens/utility/NetworkErrorScreen'));
const ActivityLogScreen = lazy(() => import('../screens/utility/ActivityLogScreen'));

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

// Drops a section-entry breadcrumb (see utils/navOrigin) once the user has
// navigated out of the section it belongs to, so a later visit that arrived
// from somewhere else never inherits a stale "back" target.
function NavOriginTracker() {
  const location = useLocation();
  useEffect(() => { pruneNavOrigin(location.pathname); }, [location.pathname]);
  return null;
}

export default function AppRouter() {
  // pro.vergr.app is the SUBSCRIPTION product on its own domain, and it is a
  // completely separate surface: its own nav, its own footer, its own copies of
  // Terms/Refund/Privacy, and no route anywhere near Coins or the wallet. See
  // ProSubscriptionSite.jsx for why that separation is load-bearing.
  //
  // Gated on hostname and returned BEFORE the providers so none of the app
  // shell, auth, presence or cart mounts on that host. Every other hostname is
  // untouched by this branch.
  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  if (host === 'pro.vergr.app') return <ProSubscriptionSite />;


  return (
    <BrowserRouter>
      <AuthProvider>
        <UserProvider>
          <NotificationProvider>
            <UIProvider>
              <LayoutProvider>
                <CartProvider>
                <LiveUsersProvider>
                <div className="app-container mx-auto min-h-screen bg-bg-dark text-text-primary relative">
                  <NavOriginTracker />
                  {/* The basket, on every page. CartProvider was already global
                      but CartDrawer was mounted only inside wallet/v2/BuyScreen,
                      so a basket opened from a stream had nowhere to render.
                      Renders nothing while closed. */}
                  <GlobalCartDrawer />
                  <Toast />
                  <PushToast />
                  <LiveInviteBanner />
                  <IncomingCallOverlay />
                  <VoiceSessionPill />
                  <DesktopNotificationManager />
                  <PresenceManager />
                  <DisplaySettingsApplier />
                  <BackupChecker />
                  <ImageProtection />
                  <SignalsCapture />
                  <ConsentSheet />
                  <TosVersionGate />
                  {/* Levelling up was completely silent: LevelUpCelebration was
                      built and rendered nowhere (audit A111). Mounted app-wide so
                      the moment lands whatever screen earned it. */}
                  <LevelUpWatcher />
                  <GuestSignupPrompt />
                  <AnnouncementPopup />
                  <GuestModeBanner />
                  <NotificationsDrawer />
                  <FirstBootGate />
                  <NativeUpdateBanner />
                  <DevChannelBadge />
                  <InstallAppBanner />
                  <MobileNavDrawerHost />
                  {/* Route-level boundary (audit A50). Sits INSIDE the app
                      shell, so a screen that throws during render shows the
                      fallback while the nav, drawers and banners above stay
                      mounted and usable — instead of React unmounting the whole
                      tree to a black page. The root boundary in main.jsx is the
                      backstop for anything above this. */}
                  <ErrorBoundary label="route">
                  <Suspense fallback={<RouteFallback />}>
                  <SplashHandoff />
                  <Routes>
                    {/* ---------- PUBLIC ROUTES (no layout) ---------- */}
                    <Route path="/" element={<RootRoute />} />
                    {/* ---------- PUBLIC: PLATFORM (marketing/info, SEO-indexed) ---------- */}
                    <Route path="/platform" element={<LandingScreen />} />
                    <Route path="/platform/store" element={<StoreScreen />} />
                    {/* Public changelog. Two routes, one component: the list and
                        a single entry are the same data at two depths. */}
                    <Route path="/whats-new" element={<WhatsNewScreen />} />
                    <Route path="/whats-new/:slug" element={<WhatsNewScreen />} />
                    <Route path="/platform/download" element={<DownloadScreen />} />
                    <Route path="/platform/download/mobile" element={<MobileAppScreen />} />
                    <Route path="/platform/download/desktop" element={<DesktopAppScreen />} />
                    <Route path="/platform/help" element={<MarketingHelpScreen />} />
                    <Route path="/platform/help/category/:catId" element={<HelpCategoryScreen />} />
                    <Route path="/platform/help/:slug" element={<HelpArticleScreen />} />
                    <Route path="/platform/privacy"               element={<LegalScreen type="privacy" />} />
                    <Route path="/platform/terms"                 element={<LegalScreen type="terms" />} />
                    <Route path="/platform/acceptable-use"        element={<LegalScreen type="acceptable_use" />} />
                    <Route path="/platform/cookies"               element={<LegalScreen type="cookies" />} />
                    <Route path="/platform/refunds"              element={<LegalScreen type="refunds" />} />
                    {/* Compliance policies. Payment partners and app stores ask for these
                        by name, so each one keeps its own URL and its checklist title. */}
                    <Route path="/platform/content-moderation" element={<LegalScreen type="content_moderation" />} />
                    <Route path="/platform/identity-and-consent" element={<LegalScreen type="idv_consent" />} />
                    <Route path="/platform/age-verification" element={<LegalScreen type="age_verification" />} />
                    <Route path="/platform/anti-slavery" element={<LegalScreen type="anti_slavery" />} />
                    <Route path="/platform/csam-policy" element={<LegalScreen type="csam" />} />
                    <Route path="/platform/law-enforcement" element={<LegalScreen type="law_enforcement" />} />
                    <Route path="/platform/aml-policy" element={<LegalScreen type="aml" />} />
                    <Route path="/platform/anti-fraud" element={<LegalScreen type="anti_fraud" />} />
                    <Route path="/platform/creator-agreement" element={<LegalScreen type="creator_agreement" />} />
                    {/* Required by Google Play's Child Safety Standards policy —
                        the declaration points at this URL, so it must stay live
                        and publicly reachable. */}
                    <Route path="/platform/child-safety"          element={<LegalScreen type="child_safety" />} />
                    <Route path="/platform/about" element={<MarketingAboutScreen />} />
                    <Route path="/platform/careers" element={<CareersScreen />} />
                    <Route path="/platform/contact" element={<ContactScreen />} />
                    <Route path="/platform/credits" element={<CreditsScreen />} />
                    <Route path="/platform/delete-account" element={<DeleteAccountScreen />} />
                    <Route path="/platform/code-of-conduct" element={<CodeOfConductScreen />} />
                    <Route path="/platform/forums" element={<ForumsScreen />} />
                    <Route path="/platform/streamer" element={<BecomeStreamerScreen />} />
                    <Route path="/platform/monetization" element={<MonetizationScreen />} />
                    <Route path="/platform/creators" element={<CreatorsLandingScreen />} />
                    <Route path="/platform/studio-tools" element={<StudioToolsScreen />} />
                    <Route path="/platform/partners" element={<PartnerProgramScreen />} />
                    <Route path="/platform/learn/live" element={<LearnLiveScreen />} />
                    <Route path="/platform/learn/squads" element={<LearnSquadsScreen />} />
                    <Route path="/platform/learn/clips" element={<LearnClipsScreen />} />
                    <Route path="/platform/learn/coins" element={<LearnCoinsScreen />} />
                    {/* The growth funnel (/platform/make-money-gaming, /platform/legit,
                        /platform/play) was REMOVED 2026-08-16, not just unrouted: an
                        earnings-claim page, a page arguing our own legitimacy, and
                        per-game money pages, all built on tournament prize pools,
                        money matches and withdrawal, none of which exist. */}
                    <Route path="/linkinbio" element={<LinkInBioScreen />} />

                    {/* Public ticketed-event landing page (share target, works logged-out) */}
                    <Route path="/e/:id" element={<EventLandingScreen />} />
                    {/* Legacy clean-path → /platform redirects (in-app nav safety; direct hits also 301 via firebase.json) */}
                    <Route path="/store" element={<Navigate to="/platform/store" replace />} />
                    <Route path="/download" element={<Navigate to="/platform/download" replace />} />
                    <Route path="/help" element={<Navigate to="/platform/help" replace />} />
                    <Route path="/privacy" element={<Navigate to="/platform/privacy" replace />} />
                    <Route path="/terms" element={<Navigate to="/platform/terms" replace />} />
                    <Route path="/acceptable-use" element={<Navigate to="/platform/acceptable-use" replace />} />
                    <Route path="/cookies" element={<Navigate to="/platform/cookies" replace />} />
                    <Route path="/refunds" element={<Navigate to="/platform/refunds" replace />} />
                    <Route path="/about" element={<Navigate to="/platform/about" replace />} />
                    <Route path="/careers" element={<Navigate to="/platform/careers" replace />} />
                    <Route path="/contact" element={<Navigate to="/platform/contact" replace />} />
                    <Route path="/delete-account" element={<Navigate to="/platform/delete-account" replace />} />
                    <Route path="/code-of-conduct" element={<Navigate to="/platform/code-of-conduct" replace />} />
                    <Route path="/forums" element={<Navigate to="/platform/forums" replace />} />
                    <Route path="/streamer" element={<Navigate to="/platform/streamer" replace />} />
                    <Route path="/monetization" element={<Navigate to="/platform/monetization" replace />} />
                    <Route path="/creators" element={<Navigate to="/platform/creators" replace />} />
                    <Route path="/studio-tools" element={<Navigate to="/platform/studio-tools" replace />} />
                    <Route path="/partners" element={<Navigate to="/platform/partners" replace />} />
                    <Route path="/learn/live" element={<Navigate to="/platform/learn/live" replace />} />
                    <Route path="/learn/squads" element={<Navigate to="/platform/learn/squads" replace />} />
                    <Route path="/learn/clips" element={<Navigate to="/platform/learn/clips" replace />} />
                    <Route path="/learn/coins" element={<Navigate to="/platform/learn/coins" replace />} />

                    {/* Tournament OBS overlays retired with the section. The
                        screen files are kept; re-add the two routes to restore. */}
                    {/* GR8 — streamer-battle overlay (two-streamer co-stream),
                        reuses the neon visual language, driven by stream/co-host. */}
                    <Route path="/overlay/battle/:streamId/neon" element={<StreamerBattleOverlay />} />

                    {/* Auth */}
                    <Route path="/splash" element={<SplashScreen />} />
                    {/* Referral landing. The ?ref=<uid> param is captured into
                        localStorage by captureReferral() at module load (above);
                        this screen adds the "you were invited" moment (friend's
                        name/avatar + reward + one-tap signup) so shared links
                        actually convert instead of dumping visitors on the
                        generic marketing page. */}
                    <Route path="/reflink" element={<InviteLandingScreen />} />
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
                    <Route path="/onboarding" element={<OnboardingFlowScreen />} />
                    <Route path="/onboarding/identity" element={<ProfileIdentityScreen />} />
                    {/* Legacy onboarding paths (old screens + the /setup/*
                        strings some auth screens still emit) → the new flow. */}
                    <Route path="/onboarding/welcome" element={<Navigate to="/onboarding" replace />} />
                    <Route path="/onboarding/interests" element={<Navigate to="/onboarding" replace />} />
                    <Route path="/onboarding/profile" element={<Navigate to="/onboarding" replace />} />
                    <Route path="/onboarding/profile-step2" element={<Navigate to="/onboarding" replace />} />
                    <Route path="/onboarding/follow" element={<Navigate to="/onboarding" replace />} />
                    <Route path="/onboarding/complete" element={<Navigate to="/onboarding" replace />} />
                    <Route path="/setup/interests" element={<Navigate to="/onboarding" replace />} />
                    <Route path="/setup/profile" element={<Navigate to="/onboarding" replace />} />
                    <Route path="/setup/follow-suggestions" element={<Navigate to="/onboarding" replace />} />

                    {/* Utility (public) */}
                    <Route path="/maintenance" element={<MaintenanceScreen />} />
                    <Route path="/update-required" element={<ForceUpdateScreen />} />
                    <Route path="/offline" element={<NetworkErrorScreen />} />

                    {/* Vergr.me public page — no auth required */}
                    <Route path="/u/:username" element={<VergrMePage />} />

                    {/* ---------- PROTECTED MAIN APP (with MainLayout) ---------- */}
                    <Route element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
                      {/* Main tabs */}
                      <Route path="/explore" element={IS_NATIVE_BUILD ? <NativeExploreScreen /> : <ExploreScreen />} />
                      <Route path="/streams" element={<LiveStreamsScreen />} />
                      <Route path="/profile" element={IS_NATIVE_BUILD ? <NativeProfileScreen /> : <ProfileScreen />} />
                      <Route path="/memberships" element={IS_NATIVE_BUILD ? <NativeMyMembershipsScreen /> : <MyMembershipsScreen />} />
                      <Route path="/purchases" element={<VergrMePurchasesScreen />} />

                      {/* Home */}
                      <Route path="/earn" element={IS_NATIVE_BUILD ? <NativeEarnCoinsScreen /> : <EarnCoinsScreen />} />
                      {/* Native uses the SAME tabbed Referral hub as web (its
                          standalone variant already renders a mobile header +
                          hamburger drawer with safe-area insets). The old
                          NativeReferralScreen is retired from this route. */}
                      <Route path="/earn/refer" element={<ReferralScreen />} />
                      <Route path="/notifications" element={IS_NATIVE_BUILD ? <NativeNotificationsScreen /> : <NotificationsScreen />} />
                      <Route path="/create-post" element={<Navigate to="/" replace />} />
                      {/* /create-poll: native-only route (footer icon in NativeCreateScreens).
                          On web, polls are created inline in the CreateComposer modal. */}
                      <Route path="/create-poll" element={IS_NATIVE_BUILD ? <GuestRouteGate action="create polls"><NativeCreatePollScreen /></GuestRouteGate> : <Navigate to="/" replace />} />
                      <Route path="/leaderboard" element={IS_NATIVE_BUILD ? <NativeLeaderboardScreen /> : <LeaderboardScreen />} />
                      <Route path="/post/:postId" element={IS_NATIVE_BUILD ? <NativePostDetailScreen /> : <PostDetailScreen />} />
                      <Route path="/trending" element={IS_NATIVE_BUILD ? <NativeTrendingHashtagsScreen /> : <TrendingHashtagsScreen />} />

                      {/* Create — native-only screens (footer/selector flow in NativeCreateScreens).
                          On web/desktop, post creation is the CreateComposer modal (sidebar "Create"
                          button / mobile FAB) — these per-type screens are superseded there and would
                          otherwise be dead URLs reachable only by typing them, so they redirect home. */}
                      <Route path="/create"             element={IS_NATIVE_BUILD ? <GuestRouteGate action="create posts"><NativeCreatePostSelectorScreen /></GuestRouteGate> : <Navigate to="/" replace />} />
                      <Route path="/create/text"        element={IS_NATIVE_BUILD ? <GuestRouteGate action="create posts"><NativeCreateTextPostScreen /></GuestRouteGate> : <Navigate to="/" replace />} />
                      <Route path="/create/photo"       element={IS_NATIVE_BUILD ? <GuestRouteGate action="post photos"><NativeCreatePhotoPostScreen /></GuestRouteGate> : <Navigate to="/" replace />} />
                      <Route path="/create/clip"        element={IS_NATIVE_BUILD ? <GuestRouteGate action="post clips"><NativeCreateClipPostScreen /></GuestRouteGate> : <Navigate to="/" replace />} />
                      <Route path="/create/article"     element={IS_NATIVE_BUILD ? <GuestRouteGate action="post articles"><NativeCreateArticleScreen /></GuestRouteGate> : <Navigate to="/" replace />} />
                      <Route path="/create/lfg"         element={IS_NATIVE_BUILD ? <GuestRouteGate action="post LFG"><NativeCreateLFGScreen /></GuestRouteGate> : <Navigate to="/" replace />} />
                      <Route path="/create/tierlist"    element={IS_NATIVE_BUILD ? <GuestRouteGate action="post tier lists"><NativeCreateTierListScreen /></GuestRouteGate> : <Navigate to="/" replace />} />
                      <Route path="/create/achievement" element={IS_NATIVE_BUILD ? <GuestRouteGate action="post achievements"><NativeCreateAchievementScreen /></GuestRouteGate> : <Navigate to="/" replace />} />
                      {/* /create/quote stays live on web too — PostCard's "Quote" action links here. */}
                      <Route path="/create/quote"       element={<GuestRouteGate action="post quotes">{IS_NATIVE_BUILD ? <NativeQuotePostScreen /> : <QuotePostScreen />}</GuestRouteGate>} />

                      {/* Shorts */}
                      <Route path="/shorts" element={IS_NATIVE_BUILD ? <NativeShortsScreen /> : <ShortsScreen />} />
                      <Route path="/create/short" element={<GuestRouteGate action="create shorts">{IS_NATIVE_BUILD ? <NativeCreateShortScreen /> : <CreateShortScreen />}</GuestRouteGate>} />

                      {/* Viewers */}
                      <Route path="/clip/:postId" element={IS_NATIVE_BUILD ? <NativeClipViewerScreen /> : <ClipViewerScreen />} />

                      {/* Profile */}
                      <Route path="/edit-profile" element={<GuestRouteGate action="edit your profile">{IS_NATIVE_BUILD ? <NativeEditProfileScreen /> : <EditProfileScreen />}</GuestRouteGate>} />
                      <Route path="/followers/:tab" element={IS_NATIVE_BUILD ? <NativeFollowListScreen /> : <FollowListScreen />} />
                      {/* Followers/following for ANY user (self or others). uid scopes whose list. */}
                      <Route path="/connections/:uid/:tab" element={IS_NATIVE_BUILD ? <NativeFollowListScreen /> : <FollowListScreen />} />
                      <Route path="/user/:id" element={IS_NATIVE_BUILD ? <NativePublicProfileScreen /> : <PublicProfileScreen />} />
                      <Route path="/browse-creators" element={IS_NATIVE_BUILD ? <NativeBrowseCreatorsScreen /> : <BrowseCreatorsScreen />} />
                      <Route path="/esports-team/:teamId" element={IS_NATIVE_BUILD ? <NativeEsportsTeamScreen /> : <EsportsTeamScreen />} />
                      <Route path="/prestige" element={IS_NATIVE_BUILD ? <NativePrestigeLevelsScreen /> : <PrestigeLevelsScreen />} />

                      {/* Standalone message screens (not master‑detail) */}
                      <Route path="/messages/new" element={IS_NATIVE_BUILD ? <NativeNewMessageScreen /> : <NewMessageScreen />} />
                      <Route path="/messages/requests" element={IS_NATIVE_BUILD ? <NativeMessageRequestsScreen /> : <MessageRequestsScreen />} />
                      <Route path="/messages/calls" element={IS_NATIVE_BUILD ? <NativeCallHistoryScreen /> : <CallHistoryScreen />} />
                      <Route path="/messages/create-group" element={IS_NATIVE_BUILD ? <NativeCreateGroupChatScreen /> : <CreateGroupChatScreen />} />
                      {/* WhatsApp chat import (share-target lands here too) */}
                      <Route path="/messages/import" element={<ImportChatScreen />} />
                      <Route path="/messages/g/:chatId" element={IS_NATIVE_BUILD ? <NativeJoinGroupScreen /> : <JoinGroupScreen />} />
                      <Route path="/messages/:chatId/settings" element={IS_NATIVE_BUILD ? <NativeChatSettingsScreen /> : <ChatSettingsScreen />} />
                      <Route path="/messages/:chatId/details" element={IS_NATIVE_BUILD ? <NativeChatDetailScreen /> : <ChatDetailScreen />} />
                      <Route path="/messages/:chatId/group" element={IS_NATIVE_BUILD ? <NativeGroupInfoScreen /> : <GroupInfoScreen />} />
                      {/* Call routes MOVED OUT of MainLayout — see the standalone
                          block below. ResponsiveLayout returns five different
                          trees keyed on isDesktop/isTablet, so crossing a
                          breakpoint remounted the call screen and tore down the
                          live WebRTC connection. */}

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

                      {/* Legacy → v2 redirects (kept inside MainLayout block
                          so they're caught by the same ProtectedRoute gate). */}
                      <Route path="/buy-coins"          element={<Navigate to="/wallet/buy" replace />} />
                      <Route path="/request-payout"     element={<Navigate to="/creator/earnings" replace />} />
                      <Route path="/wallet/payout"      element={<Navigate to="/creator/earnings" replace />} />

                      <Route path="/verification-pending" element={<VerificationPendingScreen />} />

                      {/* Streams */}
                      <Route path="/go-live" element={<GuestRouteGate action="go live">{IS_NATIVE_BUILD ? <NativeGoLiveScreen /> : <GoLiveSetupScreen />}</GuestRouteGate>} />
                      {/* Create a ticketed EVENT (live show, watch party, Q&A, class...).
                          Not a tournament: createTournamentSecure is retired and throws. */}
                      <Route path="/events/create" element={<GuestRouteGate action="create an event"><CreateEventScreen /></GuestRouteGate>} />
                      <Route path="/go-live/co-stream" element={<GuestRouteGate action="co-stream">{IS_NATIVE_BUILD ? <NativeCoStreamingScreen /> : <CoStreamingScreen />}</GuestRouteGate>} />
                      <Route path="/co-stream/invite/:inviteId" element={<GuestRouteGate action="co-stream">{IS_NATIVE_BUILD ? <NativeCoStreamInviteScreen /> : <CoStreamInviteScreen />}</GuestRouteGate>} />
                      <Route path="/stream/:streamId" element={<LiveStreamScreen />} />
                      <Route path="/broadcast" element={<GuestRouteGate action="broadcast">{IS_NATIVE_BUILD ? <NativeBroadcasterScreen /> : <BroadcasterScreen />}</GuestRouteGate>} />
                      <Route path="/broadcast/:streamId" element={<GuestRouteGate action="broadcast">{IS_NATIVE_BUILD ? <NativeBroadcasterScreen /> : <BroadcasterScreen />}</GuestRouteGate>} />
                      <Route path="/watch" element={IS_NATIVE_BUILD ? <NativeViewerStreamScreen /> : <ViewerStreamScreen />} />
                      <Route path="/watch/:streamId" element={IS_NATIVE_BUILD ? <NativeViewerStreamScreen /> : <ViewerStreamScreen />} />
                      <Route path="/stream/:streamId/moderation" element={<StreamModerationScreen />} />
                      <Route path="/stream/analytics" element={IS_NATIVE_BUILD ? <NativeStreamAnalyticsScreen /> : <StreamAnalyticsScreen />} />
                      <Route path="/stream/ended" element={IS_NATIVE_BUILD ? <NativeStreamEndingScreen /> : <StreamEndingScreen />} />

                      {/* Tournaments are retired from the product. Every route
                          that reached a tournament screen is unregistered so
                          nothing is navigable or crawlable. The screen files
                          under src/screens/tournaments/ are KEPT on disk — to
                          restore the section, re-add these routes plus the
                          navConfig entries. Only the role-gated moderation
                          surfaces stay mounted. */}
                      <Route path="/vanguard/wall" element={<ModWallScreen />} />
                      {/* Distinct path — /vanguard/queue resolves to the active moderation queue (VanguardQueueScreen) below; this is the separate review/anti-cheat queue. */}
                      <Route path="/vanguard/review-queue" element={<VanguardReviewQueueScreen />} />

                      {/* Settings */}
                      <Route path="/settings" element={IS_NATIVE_BUILD ? <NativeSettingsHubScreen /> : <SettingsScreen />} />
                      <Route path="/settings/backup" element={<BackupSettingsScreen />} />
                      <Route path="/settings/privacy" element={<PrivacySettingsScreen />} />
                      <Route path="/settings/linked-accounts" element={<LinkedAccountsScreen />} />
                      <Route path="/settings/notifications" element={<NotificationSettingsScreen />} />
                      <Route path="/settings/about" element={<AboutScreen />} />
                      <Route path="/settings/security" element={<SecuritySettingsScreen />} />
                      <Route path="/settings/language" element={<LanguageSettingsScreen />} />
                      <Route path="/settings/display" element={<DisplaySettingsScreen />} />
                      <Route path="/settings/storage" element={<StorageSettingsScreen />} />
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
                      {/* Admin UI: lazy chunk on web, EXCLUDED from the native APK
                          (AdminRoutes is null when __VERGR_NATIVE__). */}
                      {!IS_NATIVE_BUILD && AdminRoutes && (
                        <Route path="/admin/*" element={<Suspense fallback={null}><AdminRoutes /></Suspense>} />
                      )}
                      <Route path="/hud" element={<HudOverlay />} />
                      <Route path="/vanguard/invitation" element={<VanguardInvitationScreen />} />
                      {/* Legacy redirect — /vanguard/me → /vanguard/today (new shell) */}
                      <Route path="/vanguard/me" element={<Navigate to="/vanguard/today" replace />} />

                      {/* Search */}
                      <Route path="/search" element={IS_NATIVE_BUILD ? <NativeSearchResultsAllScreen /> : <SearchResultsAllScreen />} />
                      <Route path="/search/streams" element={IS_NATIVE_BUILD ? <NativeSearchResultsStreamsScreen /> : <SearchResultsStreamsScreen />} />
                      <Route path="/search/empty" element={<NoSearchResultsScreen />} />

                      {/* Activity */}
                      <Route path="/activity" element={<ActivityLogScreen />} />
                    </Route>

                    {/* Vergr.me Editor — standalone focused editor (own chrome,
                        no app rail) so the Settings/Creator nav context isn't
                        replaced by the generic main nav. Back button returns
                        to wherever the user came from. */}
                    <Route path="/vergrme/edit" element={<ProtectedRoute><VergrMeEditorScreen /></ProtectedRoute>} />

                    {/* ---------- CALLS (standalone, NO app shell) ----------
                        These screens are `fixed inset-0 z-[100]` and cover the
                        whole viewport, so they never used the shell's chrome.
                        Mounting them INSIDE it was actively harmful:
                        (1) ResponsiveLayout returns a different tree per
                            breakpoint, so resizing across the mobile/desktop
                            boundary remounted the screen mid-call and killed the
                            RTCPeerConnection — verified live, the timer reset
                            1:21 -> 0:02 and the remote tracks came back muted
                            with videoWidth 0 while the call doc still read
                            status:'active'. A dead call that looks connected.
                        (2) The 15 nav controls behind the overlay stayed
                            keyboard-focusable during a call, so Tab+Enter could
                            navigate away mid-conversation.
                        Same pattern the wallet already uses. */}
                    <Route path="/call/:chatId/:callType" element={<ProtectedRoute>{IS_NATIVE_BUILD ? <NativeCallScreen /> : <CallScreen />}</ProtectedRoute>} />
                    {/* Group calls run on the SFU, not P2P — one screen for
                        web + native (it's already a single-column layout). */}
                    <Route path="/group-call/:callId" element={<ProtectedRoute><GroupCallScreen /></ProtectedRoute>} />

                    {/* ---------- WALLET v2 (own layout — sidebar + topbar + mobile bottom-nav) ---------- */}
                    <Route element={<ProtectedRoute><RegionGate feature="the VERGR wallet"><WalletLayout /></RegionGate></ProtectedRoute>}>
                      <Route path="/wallet"                          element={IS_NATIVE_BUILD ? <NativeHomeScreen /> : <WalletHomeScreen />} />
                      <Route path="/wallet/buy"                      element={IS_NATIVE_BUILD ? <NativeBuyScreen /> : <WalletBuyScreen />} />
                      {/* Available in EVERY build, including Play. Google must permit
                          alternative billing, so the basket offers both rails and the
                          buyer picks; see PaymentMethodPicker. */}
                      <Route path="/wallet/cart"                     element={<WalletCartScreen />} />
                      <Route path="/wallet/history"                  element={IS_NATIVE_BUILD ? <NativeHistoryScreen /> : <WalletHistoryScreen />} />
                      <Route path="/wallet/settings"                 element={IS_NATIVE_BUILD ? <NativeSettingsScreen /> : <WalletSettingsV2Screen />} />
                      <Route path="/wallet/security"                 element={<WalletSecurityHubScreen />} />
                      <Route path="/wallet/security/pin"             element={<WalletSecurityPinScreen />} />
                      <Route path="/wallet/security/totp"            element={<WalletSecurityTotpScreen />} />
                      <Route path="/wallet/kyc"                      element={IS_NATIVE_BUILD ? <NativeKycScreen /> : <WalletKycScreen />} />
                      <Route path="/wallet/referral"                 element={<WalletReferralScreen />} />
                      <Route path="/wallet/help"                     element={<WalletHelpV2Screen />} />
                    </Route>

                    {/* ---------- VERGR SHOP (own layout — seller commerce workspace) ----------
                        Standalone on purpose: vergr.me is the display tool, this is
                        where selling is managed (catalog, orders, customers, stores). */}
                    {/* Outside ShopLayout: the merchant arrives here straight
                        from Shopify admin, before any store is linked. */}
                    <Route path="/shop/link-shopify" element={<LinkShopifyScreen />} />
                    <Route element={<ProtectedRoute><ShopLayout /></ProtectedRoute>}>
                      <Route path="/shop"              element={<ShopOverviewScreen />} />
                      <Route path="/shop/products"     element={<ShopProductsScreen />} />
                      <Route path="/shop/orders"       element={<ShopOrdersScreen />} />
                      <Route path="/shop/customers"    element={<ShopCustomersScreen />} />
                      <Route path="/shop/integrations" element={<ShopIntegrationsScreen />} />
                      <Route path="/shop/settings"     element={<ShopSettingsScreen />} />
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
                      <Route path="/creator/dashboard"  element={IS_NATIVE_BUILD ? <NativeCreatorDashboardScreen /> : creatorChunk('home', 'Home', 'What happened, and what to do next', HomeSkeleton, <CreatorHomeScreen />)} />
                      <Route path="/creator/dashboard/old" element={<CreatorDashboardScreen />} />
                      <Route path="/creator/apply"      element={<BecomeCreatorScreen />} />
                      <Route path="/creator/earnings"   element={IS_NATIVE_BUILD ? <NativeCreatorEarningsScreen /> : creatorChunk('earnings', 'Earnings', 'Your revenue share and payouts', EarningsSkeleton, <CreatorEarningsScreen />)} />
                      <Route path="/creator/earnings/setup" element={creatorChunk('earnings', 'Payout setup', 'Four steps, once', PayoutSetupSkeleton, <PayoutSetupScreen />)} />
                      <Route path="/creator/earnings/statement/:runId" element={creatorChunk('earnings', 'Statement', null, StatementSkeleton, <PayoutStatementScreen />)} />
                      <Route path="/creator/content"    element={IS_NATIVE_BUILD ? <NativeCreatorContentScreen /> : <CreatorContentScreen />} />
                      <Route path="/creator/schedule"   element={IS_NATIVE_BUILD ? <NativeCreatorScheduleScreen /> : <CreatorScheduleScreen />} />
                      <Route path="/creator/audience"   element={IS_NATIVE_BUILD ? <NativeCreatorAudienceScreen /> : creatorChunk('audience', 'Audience', 'Who is watching', PanelListSkeleton, <CreatorAudienceScreen />)} />
                      <Route path="/creator/community"  element={IS_NATIVE_BUILD ? <NativeCreatorCommunityScreen /> : <CreatorCommunityScreen />} />
                      <Route path="/creator/analytics"  element={IS_NATIVE_BUILD ? <NativeCreatorAnalyticsScreen /> : creatorChunk('analytics', 'Analytics', 'What is working, and when', AnalyticsSkeleton, <MonthlyAnalyticsScreen />)} />
                      <Route path="/creator/quests"     element={IS_NATIVE_BUILD ? <NativeCreatorQuestsScreen /> : <CreatorLayout page="quests" title="Creator Quests" subtitle="Earn VP — level up your creator rank"><CreatorQuestsScreen embedded /></CreatorLayout>} />
                      <Route path="/creator/membership" element={IS_NATIVE_BUILD ? <NativeCreatorMembershipScreen /> : <CreatorLayout page="memberships" title="Membership Tiers" subtitle="Offer paid perks to your fans"><MembershipTiersScreen embedded /></CreatorLayout>} />
                      <Route path="/creator/ads"        element={IS_NATIVE_BUILD ? <NativeCreatorAdsScreen /> : <CreatorLayout page="ads" title="Ad Center" subtitle="Run targeted in-feed campaigns"><AdCenterScreen embedded /></CreatorLayout>} />
                      <Route path="/creator/verify"     element={IS_NATIVE_BUILD ? <NativeCreatorVerifyScreen /> : <CreatorLayout page="verify" title="Creator Verification" subtitle="Identity check — required for Ad Center, payouts and membership tiers"><CreatorVerificationScreen embedded /></CreatorLayout>} />
                    </Route>

                    {/* Mobile hand-off route for QR-code verification continuation */}
                    <Route path="/verify/mobile/:sid" element={<ProtectedRoute><MobileKycHandoff /></ProtectedRoute>} />

                    {/* ---------- MESSAGES MASTER‑DETAIL ---------- */}
                    <Route path="/messages" element={<ProtectedRoute><MessagesMasterDetail /></ProtectedRoute>}>
                      <Route index element={IS_NATIVE_BUILD ? <NativeMessagesInboxScreen /> : <MessagesInboxScreen />} />
                      <Route path="browse" element={IS_NATIVE_BUILD ? <NativeBrowseGroupsScreen /> : <BrowseGroupsScreen />} />
                      <Route path="friends" element={IS_NATIVE_BUILD ? <NativeFriendsScreen /> : <FriendsScreen />} />
                      <Route path="voice/:slug" element={IS_NATIVE_BUILD ? <NativeVoiceChannelScreen /> : <VoiceChannelScreen />} />
                      {/* Communication-hub sections — render inside the messages
                          shell so the glossy hub rail stays pinned (they each
                          bring their own list column + main). */}
                      <Route path="hub/calls" element={<CallsScreen />} />
                      <Route path="hub/status" element={<StatusScreen />} />
                      <Route path="hub/squads" element={<SquadsHub />} />
                      {/* Official Vergr channel. Two segments, so it can never
                          collide with the single-segment :chatId below. */}
                      <Route path="c/:channelId" element={<ChannelThreadScreen />} />
                      <Route path=":chatId" element={IS_NATIVE_BUILD ? <NativeChatThreadScreen /> : <ChatThreadScreen />} />
                    </Route>

                    {/* ---------- SQUADS ----------
                        Web = self-contained SquadShell chrome. Native (APK) = a
                        dedicated phone-first screen per surface (NativeSquad*),
                        routed via IS_NATIVE_BUILD so the desktop-rail DOM never
                        ships to the WebView. */}
                    {/* Global level */}
                    <Route path="/squads" element={<ProtectedRoute>{IS_NATIVE_BUILD ? <NativeSquadsScreen /> : <SquadsScreen />}</ProtectedRoute>} />
                    <Route path="/squads/mine" element={<ProtectedRoute>{IS_NATIVE_BUILD ? <NativeSquadsMineScreen /> : <SquadsMineScreen />}</ProtectedRoute>} />
                    <Route path="/squads/invitations" element={<ProtectedRoute>{IS_NATIVE_BUILD ? <NativeSquadInvitationsScreen /> : <SquadInvitationsScreen />}</ProtectedRoute>} />
                    <Route path="/squads/applications" element={<ProtectedRoute>{IS_NATIVE_BUILD ? <NativeSquadApplicationsScreen /> : <SquadApplicationsScreen />}</ProtectedRoute>} />
                    <Route path="/squads/players" element={<ProtectedRoute>{IS_NATIVE_BUILD ? <NativeBrowsePlayersScreen /> : <BrowsePlayersScreen />}</ProtectedRoute>} />
                    <Route path="/squads/create" element={<ProtectedRoute>{IS_NATIVE_BUILD ? <NativeCreateSquadScreen /> : <CreateSquadScreen />}</ProtectedRoute>} />
                    {/* Per-squad */}
                    <Route path="/squads/:squadId" element={<ProtectedRoute>{IS_NATIVE_BUILD ? <NativeSquadOverviewScreen /> : <SquadOverviewScreen />}</ProtectedRoute>} />
                    <Route path="/squads/:squadId/chat" element={<ProtectedRoute>{IS_NATIVE_BUILD ? <NativeSquadChatThreadScreen /> : <SquadChatThreadScreen />}</ProtectedRoute>} />
                    <Route path="/squads/:squadId/members" element={<ProtectedRoute>{IS_NATIVE_BUILD ? <NativeSquadMembersScreen /> : <SquadMembersScreen />}</ProtectedRoute>} />
                    <Route path="/squads/:squadId/announcements" element={<ProtectedRoute>{IS_NATIVE_BUILD ? <NativeSquadAnnouncementsScreen /> : <SquadAnnouncementsScreen />}</ProtectedRoute>} />
                    <Route path="/squads/:squadId/leaderboard" element={<ProtectedRoute>{IS_NATIVE_BUILD ? <NativeSquadLeaderboardScreen /> : <SquadLeaderboardScreen />}</ProtectedRoute>} />
                    <Route path="/squads/:squadId/events" element={<ProtectedRoute>{IS_NATIVE_BUILD ? <NativeSquadEventsScreen /> : <SquadEventsScreen />}</ProtectedRoute>} />
                    <Route path="/squads/:squadId/challenges" element={<ProtectedRoute>{IS_NATIVE_BUILD ? <NativeSquadChallengesScreen /> : <SquadChallengesScreen />}</ProtectedRoute>} />
                    <Route path="/squads/:squadId/media" element={<ProtectedRoute>{IS_NATIVE_BUILD ? <NativeSquadMediaScreen /> : <SquadMediaScreen />}</ProtectedRoute>} />
                    <Route path="/squads/:squadId/pinned" element={<ProtectedRoute>{IS_NATIVE_BUILD ? <NativeSquadPinnedScreen /> : <SquadPinnedScreen />}</ProtectedRoute>} />
                    <Route path="/squads/:squadId/settings" element={<ProtectedRoute>{IS_NATIVE_BUILD ? <NativeSquadSettingsScreen /> : <SquadSettingsScreen />}</ProtectedRoute>} />
                    <Route path="/squads/:squadId/roles" element={<ProtectedRoute>{IS_NATIVE_BUILD ? <NativeSquadRolesScreen /> : <SquadRolesScreen />}</ProtectedRoute>} />
                    <Route path="/squads/:squadId/requests" element={<ProtectedRoute>{IS_NATIVE_BUILD ? <NativeSquadJoinRequestsScreen /> : <SquadJoinRequestsScreen />}</ProtectedRoute>} />
                    <Route path="/squads/:squadId/invite" element={<ProtectedRoute>{IS_NATIVE_BUILD ? <NativeInviteMembersScreen /> : <InviteMembersScreen />}</ProtectedRoute>} />
                    <Route path="/squads/:squadId/analytics" element={<ProtectedRoute>{IS_NATIVE_BUILD ? <NativeSquadAnalyticsScreen /> : <SquadAnalyticsScreen />}</ProtectedRoute>} />
                    {/* Squad voice/video hangout (self-contained, already phone-first) */}
                    <Route path="/squads/:squadId/stream" element={<ProtectedRoute>{IS_NATIVE_BUILD ? <NativeSquadStreamScreen /> : <SquadStreamScreen />}</ProtectedRoute>} />

                    {/* vergr.me/:username — bare handle on the vergr.me apex serves
                        the link-in-bio page directly (host-gated; see VergrMeHostRoute). */}
                    <Route path="/:username" element={<VergrMeHostRoute />} />

                    {/* ---------- CATCH‑ALL ---------- */}
                    <Route path="*" element={<CatchAllRoute />} />
                  </Routes>
                  </Suspense>
                  </ErrorBoundary>
                </div>
                </LiveUsersProvider>
                </CartProvider>
              </LayoutProvider>
            </UIProvider>
          </NotificationProvider>
        </UserProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
