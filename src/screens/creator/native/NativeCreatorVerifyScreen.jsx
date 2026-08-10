// NativeCreatorVerifyScreen — dedicated native screen for /creator/verify.
// Composes the mobile CreatorLayout shell around the embedded KYC body.
import CreatorLayout from '../../../components/creator/CreatorLayout';
import CreatorVerificationScreen from '../CreatorVerificationScreen';

export default function NativeCreatorVerifyScreen() {
  return (
    <CreatorLayout page="verify" title="Creator Verification"
      subtitle="Identity check — required for Ad Center, payouts and membership tiers">
      <CreatorVerificationScreen embedded />
    </CreatorLayout>
  );
}
