// NativeCreatorAdsScreen — dedicated native screen for /creator/ads.
// Composes the mobile CreatorLayout shell around the embedded Ad Center body.
import CreatorLayout from '../../../components/creator/CreatorLayout';
import AdCenterScreen from '../../ad/AdCenterScreen';

export default function NativeCreatorAdsScreen() {
  return (
    <CreatorLayout page="ads" title="Ad Center" subtitle="Run targeted in-feed campaigns">
      <AdCenterScreen embedded />
    </CreatorLayout>
  );
}
