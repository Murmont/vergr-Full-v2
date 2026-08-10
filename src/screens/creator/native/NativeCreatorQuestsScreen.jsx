// NativeCreatorQuestsScreen — dedicated native screen for /creator/quests.
// Composes the mobile CreatorLayout shell around the embedded quests body.
import CreatorLayout from '../../../components/creator/CreatorLayout';
import CreatorQuestsScreen from '../CreatorQuestsScreen';

export default function NativeCreatorQuestsScreen() {
  return (
    <CreatorLayout page="quests" title="Creator Quests" subtitle="Earn VP — level up your creator rank">
      <CreatorQuestsScreen embedded />
    </CreatorLayout>
  );
}
