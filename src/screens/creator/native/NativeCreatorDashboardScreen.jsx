// NativeCreatorDashboardScreen — dedicated native entry for /creator/dashboard.
// This screen renders inside <CreatorLayout>, which already ships a dedicated
// mobile shell on native (own bottom nav, safe-area header, "More" sheet, no
// desktop sidebar). The body's desktop density comes from inert lg:/xl: grid
// prefixes that collapse to single / 2-column on the phone. Kept as its own
// routed native file so a future phone-only divergence is a one-file change.
export { default } from '../CreatorDashboardScreen';
