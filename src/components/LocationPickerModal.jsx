import { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import Icon from './Icon';
import { reverseGeocode } from '../utils/geo';

// Free map picker: Leaflet + OpenStreetMap tiles. No API key, no billing.
// Replaces the old Google Maps JS API version, which (a) was paid and (b) read
// an undefined VITE_GOOGLE_MAPS_API_KEY, so it hung the app on open.
//
// `apiKey` is accepted-and-ignored so existing call sites don't break.
const LocationPickerModal = ({ isOpen, onClose, onConfirm }) => {
  const [selected, setSelected] = useState(null); // {lat, lng}
  const [address, setAddress] = useState('');
  const [resolving, setResolving] = useState(false);
  const mapRef = useRef(null);
  const mapObj = useRef(null);
  const markerObj = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;

    // Leaflet's default marker icon URLs break under a bundler; use a lightweight
    // CSS pin via divIcon so there is no missing-image square.
    const pin = L.divIcon({
      className: '',
      html: '<div style="width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#7B1FFF;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.5)"></div>',
      iconSize: [26, 26],
      iconAnchor: [13, 26],
    });

    const place = (lat, lng) => {
      setSelected({ lat, lng });
      if (markerObj.current) markerObj.current.setLatLng([lat, lng]);
      else markerObj.current = L.marker([lat, lng], { icon: pin }).addTo(mapObj.current);
      setResolving(true);
      reverseGeocode(lat, lng).then((r) => { if (!cancelled) { setAddress(r); setResolving(false); } });
    };

    const init = (lat, lng, zoom) => {
      if (cancelled || !mapRef.current) return;
      const map = L.map(mapRef.current, { zoomControl: true, attributionControl: true }).setView([lat, lng], zoom);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }).addTo(map);
      map.on('click', (e) => place(e.latlng.lat, e.latlng.lng));
      mapObj.current = map;
      // A map created in a modal that just mounted often mis-sizes; nudge it.
      setTimeout(() => { try { map.invalidateSize(); } catch { /* unmounted */ } }, 60);
    };

    // Centre on the user if they allow it, else a neutral world view.
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => init(pos.coords.latitude, pos.coords.longitude, 14),
        () => init(20, 0, 2),
        { timeout: 6000 },
      );
    } else {
      init(20, 0, 2);
    }

    return () => {
      cancelled = true;
      if (mapObj.current) { mapObj.current.remove(); mapObj.current = null; }
      markerObj.current = null;
      setSelected(null); setAddress(null); setResolving(false);
    };
  }, [isOpen]);

  const handleConfirm = () => {
    if (!selected) return;
    onConfirm(selected, address || { title: `${selected.lat.toFixed(5)}, ${selected.lng.toFixed(5)}`, subtitle: '' });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 animate-fade-in p-3" onClick={onClose}>
      <div className="bg-surface-1 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b border-white/[0.06]">
          <div>
            <h3 className="text-white font-bold font-syne">Pick a location</h3>
            <p className="text-[11px] text-text-muted">Tap the map to drop a pin</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-white" aria-label="Close"><Icon name="close" size={22} /></button>
        </div>

        <div className="flex-1 min-h-0 relative">
          <div ref={mapRef} className="w-full h-[52vh]" />
        </div>

        <div className="p-4 border-t border-white/[0.06]">
          <div className="flex items-center gap-2 min-h-[20px]">
            <Icon name="location_on" size={18} className="text-brand-violet-light shrink-0" />
            <p className="text-sm text-white break-words">
              {selected ? (resolving ? 'Finding address…' : (address?.title || 'Selected location')) : 'No pin yet — tap the map to choose'}
            </p>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={onClose} className="px-4 py-2 rounded-full bg-surface-2 text-text-secondary text-sm">Cancel</button>
            <button onClick={handleConfirm} disabled={!selected}
              className="px-5 py-2 rounded-full bg-brand-violet text-white text-sm font-semibold disabled:opacity-40">
              Send location
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LocationPickerModal;
