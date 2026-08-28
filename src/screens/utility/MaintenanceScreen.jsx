import Icon from '../../components/Icon';
import VergrLogo from '../../components/VergrLogo';
export default function MaintenanceScreen() {
  return (
    <div className="screen-container min-h-screen flex flex-col items-center justify-center p-6">
      <VergrLogo size={48}/><div className="w-20 h-20 rounded-full bg-yellow-500/10 flex items-center justify-center my-8"><Icon name="build" size={36} className="text-yellow-400"/></div>
      <h1 className="font-syne text-text-primary text-2xl font-bold text-center mb-3">Under Maintenance</h1>
      <p className="text-text-secondary text-base text-center max-w-[280px]">We're making VERGR even better. We'll be back shortly!</p>
    </div>);
}
