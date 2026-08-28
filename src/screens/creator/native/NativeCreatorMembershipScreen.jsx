// NativeCreatorMembershipScreen — dedicated native screen for /creator/membership.
// Composes the mobile CreatorLayout shell around the embedded tiers editor body.
import CreatorLayout from '../../../components/creator/CreatorLayout';
import MembershipTiersScreen from '../MembershipTiersScreen';

export default function NativeCreatorMembershipScreen() {
  return (
    // NOT tier-gated. Memberships ARE revenue share, and nothing that lets a
    // creator earn, see earnings or get paid may sit behind a paid plan.
    <CreatorLayout page="memberships" title="Membership Tiers" subtitle="Offer paid perks to your fans">
      <MembershipTiersScreen embedded />
    </CreatorLayout>
  );
}
