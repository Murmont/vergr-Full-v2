// NativeCreatorMembershipScreen — dedicated native screen for /creator/membership.
// Composes the mobile CreatorLayout shell around the embedded tiers editor body.
import CreatorLayout from '../../../components/creator/CreatorLayout';
import MembershipTiersScreen from '../MembershipTiersScreen';

export default function NativeCreatorMembershipScreen() {
  return (
    <CreatorLayout page="memberships" title="Membership Tiers" subtitle="Offer paid perks to your fans"
      requiredTier="pro"
      lockDescription="Build paid tiers with perks, Discord roles and monthly earnings caps. Upgrade to Pro to enable.">
      <MembershipTiersScreen embedded />
    </CreatorLayout>
  );
}
