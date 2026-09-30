import { useEffect } from 'react';
import Icon from './Icon';
import useResponsive from '../hooks/useResponsive';

const LocationSubMenu = ({ isOpen, onClose, onCurrentLocation, onChooseOnMap }) => {
  const { isMobile } = useResponsive();

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const options = [
    { id: 'current', icon: 'my_location', label: 'Current Location', action: onCurrentLocation },
    { id: 'map', icon: 'map', label: 'Choose on Map', action: onChooseOnMap },
  ];

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-60 flex items-end justify-center bg-black/60 animate-fade-in"
      onClick={handleBackdropClick}
    >
      <div
        className={`bg-surface-1 w-full max-w-md overflow-hidden animate-slide-up sheet-safe ${
          !isMobile ? 'rounded-2xl mb-8 max-w-sm' : 'rounded-t-2xl'
        }`}
      >
        <div className="flex justify-between items-center p-4 border-b border-white/[0.04]">
          <h3 className="text-white font-bold text-sm">Share Location</h3>
          <button onClick={onClose} className="text-text-muted">
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 p-4">
          {options.map((opt) => (
            <button
              key={opt.id}
              onClick={() => {
                if (opt.action) opt.action();
                onClose();
              }}
              className="flex flex-col items-center gap-2 py-3 rounded-xl hover:bg-surface-2 transition-colors active:scale-95"
            >
              <div className="w-12 h-12 rounded-full bg-brand-violet/10 flex items-center justify-center">
                <Icon name={opt.icon} size={24} className="text-brand-violet-light" />
              </div>
              <span className="text-xs text-text-secondary">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default LocationSubMenu;