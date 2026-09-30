import Icon from '../../components/Icon';
import VergrLogo from '../../components/VergrLogo';

// Shown by <AppGate> on every app route while Admin → App Config → Maintenance
// mode is on, and at /maintenance directly.
export default function MaintenanceScreen() {
  return (
    <div className="screen-container min-h-screen flex flex-col items-center justify-center p-6">
      <VergrLogo size={48} />
      <div className="w-20 h-20 rounded-full bg-surface-2 flex items-center justify-center my-8">
        <Icon name="build" size={36} className="text-brand-gold" />
      </div>
      <h1 className="font-syne text-text-primary text-2xl font-bold text-center mb-3">Down for maintenance</h1>
      <p className="text-text-secondary text-base text-center max-w-[300px]">
        Vergr is getting an update. We will be back shortly.
      </p>
      <a href="/platform/help" className="mt-8 text-sm font-semibold text-brand-violet-light">Help centre</a>
    </div>
  );
}
