// NativeCreatorAnalyticsScreen — dedicated native screen for /creator/analytics.
// Composes the mobile CreatorLayout shell around the embedded analytics body
// (Recharts responsive; caps its own data). Mirrors the web route's wrapping.
import CreatorLayout from '../../../components/creator/CreatorLayout';
import MonthlyAnalyticsScreen from '../MonthlyAnalyticsScreen';

export default function NativeCreatorAnalyticsScreen() {
  return (
    <CreatorLayout page="analytics" title="Analytics" subtitle="Deep dive into your performance"
      requiredTier="lite"
      lockDescription="Detailed monthly analytics with growth, engagement and revenue breakdowns. Upgrade to Lite to unlock.">
      <MonthlyAnalyticsScreen embedded />
    </CreatorLayout>
  );
}
