// Lazy wrappers for the public marketing + help screens.
//
// PublicMarketingScreens.jsx statically imports helpContent.jsx (which imports
// every help-article body via ./articles). Importing it statically into the
// router pulls all of that into the main app bundle, even for users who never
// open a marketing/help page. Routing through React.lazy here splits the whole
// marketing + help surface (and the article bodies) into its own async chunk,
// loaded only when a /platform/* route is visited.
//
// All wrappers share one import() call, so Vite emits a single chunk for the
// entire marketing module. Public API of PublicMarketingScreens is unchanged.
import { lazy } from 'react';

const load = () => import('./PublicMarketingScreens');
const pick = (name) => lazy(() => load().then((m) => ({ default: m[name] })));

export const LandingScreen = pick('LandingScreen');
export const StoreScreen = pick('StoreScreen');
export const DownloadScreen = pick('DownloadScreen');
export const DesktopAppScreen = pick('DesktopAppScreen');
export const MobileAppScreen = pick('MobileAppScreen');
export const HelpScreen = pick('HelpScreen');
export const HelpCategoryScreen = pick('HelpCategoryScreen');
export const HelpArticleScreen = pick('HelpArticleScreen');
export const LegalScreen = pick('LegalScreen');
export const AboutScreen = pick('AboutScreen');
export const CareersScreen = pick('CareersScreen');
export const ContactScreen = pick('ContactScreen');
export const CreditsScreen = pick('CreditsScreen');
export const DeleteAccountScreen = pick('DeleteAccountScreen');
export const CodeOfConductScreen = pick('CodeOfConductScreen');
export const ForumsScreen = pick('ForumsScreen');
export const BecomeStreamerScreen = pick('BecomeStreamerScreen');
export const MonetizationScreen = pick('MonetizationScreen');
export const CreatorsLandingScreen = pick('CreatorsLandingScreen');
export const StudioToolsScreen = pick('StudioToolsScreen');
export const PartnerProgramScreen = pick('PartnerProgramScreen');
// Lives in its own file (it is a full bespoke layout, not the shared
// Section/Grid/Tile shape). It still imports MarketingShell from
// PublicMarketingScreens, so Vite keeps it in the same marketing chunk — but
// it must NOT be re-exported from there, or the two files form an import cycle.
export const LearnLiveScreen = lazy(() => import('./LearnLiveScreen'));
// LearnTournamentsScreen removed 2026-08-19 (tournaments retired).
export const LearnSquadsScreen = pick('LearnSquadsScreen');
export const LearnClipsScreen = pick('LearnClipsScreen');
export const LearnCoinsScreen = pick('LearnCoinsScreen');

// Vergr.me link-in-bio landing (own module, pulls the marketing shell chunk).
export const LinkInBioScreen = lazy(() => import('./LinkInBioScreen'));


// Public changelog. Its own module so the marketing shell chunk is not pulled
// in for a page that does not use it.
export const WhatsNewScreen = lazy(() => import('./WhatsNewScreen'));
