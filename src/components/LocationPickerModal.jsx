import { useState, useEffect, useRef } from 'react';
import Icon from './Icon';

const LocationPickerModal = ({ isOpen, onClose, onConfirm, apiKey }) => {
  const [map, setMap] = useState(null);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(true);
  const mapRef = useRef(null);
  const scriptLoaded = useRef(false);

  useEffect(() => {
    if (!isOpen || scriptLoaded.current) return;
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      scriptLoaded.current = true;
      setLoading(false);
      // Try to get user's current position as initial center
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const center = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            initMap(center);
          },
          () => {
            initMap({ lat: 0, lng: 0 }); // fallback
          }
        );
      } else {
        initMap({ lat: 0, lng: 0 });
      }
    };
    document.head.appendChild(script);
    return () => {
      // optional: remove script if needed, but we keep it loaded
    };
  }, [isOpen, apiKey]);

  const initMap = (center) => {
    const mapInstance = new window.google.maps.Map(mapRef.current, {
      center,
      zoom: 13,
      mapTypeId: 'roadmap',
    });
    setMap(mapInstance);

    mapInstance.addListener('click', (e) => {
      const latLng = e.latLng;
      const lat = latLng.lat();
      const lng = latLng.lng();
      setSelectedLocation({ lat, lng });
      // Geocode to get address
      const geocoder = new window.google.maps.Geocoder();
      geocoder.geocode({ location: { lat, lng } }, (results, status) => {
        if (status === 'OK' && results[0]) {
          setAddress(results[0].formatted_address);
        } else {
          setAddress(`${lat}, ${lng}`);
        }
      });
      // Place marker
      if (window.currentMarker) window.currentMarker.setMap(null);
      const marker = new window.google.maps.Marker({
        position: latLng,
        map: mapInstance,
        draggable: true,
      });
      window.currentMarker = marker;
    });
  };

  const handleConfirm = () => {
    if (selectedLocation) {
      onConfirm(selectedLocation, address);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/80 animate-fade-in" onClick={onClose}>
      <div className="bg-surface-1 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b border-white/[0.04]">
          <h3 className="text-white font-bold">Pick a Location</h3>
          <button onClick={onClose} className="text-text-muted"><Icon name="close" size={24} /></button>
        </div>
        <div className="flex-1 relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface-2">
              <div className="w-6 h-6 border-2 border-brand-violet border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          <div ref={mapRef} className="w-full h-96" style={{ visibility: loading ? 'hidden' : 'visible' }} />
        </div>
        {selectedLocation && (
          <div className="p-4 border-t border-white/[0.04]">
            <p className="text-sm text-text-muted mb-2">Selected location:</p>
            <p className="text-sm text-white break-words">{address}</p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={onClose} className="px-4 py-2 rounded-full bg-surface-2 text-text-secondary">Cancel</button>
              <button onClick={handleConfirm} className="px-4 py-2 rounded-full bg-brand-violet text-white">Send</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LocationPickerModal;