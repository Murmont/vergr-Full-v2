// NativeCreatorDashboardScreen — native mount for /creator/dashboard.
//
// Re-exports the SAME screen the web route renders. It used to re-export
// CreatorDashboardScreen, the DEPRECATED dashboard that only survives at
// /creator/dashboard/old, so the app and the web showed two different Home
// screens for the same route.
export { default } from '../CreatorHomeScreen';
