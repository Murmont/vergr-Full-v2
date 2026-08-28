// src/components/BackgroundPickerModal.jsx
//
// ⚠ 'environment' IS A THIRD KIND ON `squads/{id}.chatBackground`, not a new
// field. Effect 11 — doc: docs/effects/11-squad-environments.md. One field
// decides the background, so colour / image / environment can never disagree
// about what is painted.
import { useState } from 'react';
import { setSquadChatBackground } from '../firebase/firestore';
import { uploadFile } from '../firebase/firestore';
import Modal from './Modal';
import Icon from './Icon';
import { useUI } from '../context/UIContext';
import { useUser } from '../context/UserContext';
import { ENVIRONMENTS, environmentBackdrop } from '../utils/squadEnvironments';
import { unlockLevel } from '../utils/rankUnlocks';

export default function BackgroundPickerModal({ isOpen, onClose, squadId, currentBackground, currentValue, currentWeather }) {
  const { showToast } = useUI();
  const { profile } = useUser();
  const [selectedType, setSelectedType] = useState(currentBackground || 'color');
  const [color, setColor] = useState(currentBackground === 'color' ? currentValue || '#0B0B0F' : '#0B0B0F');
  const [uploading, setUploading] = useState(false);
  const [envId, setEnvId] = useState(currentBackground === 'environment' ? currentValue : ENVIRONMENTS[0].id);
  const [weather, setWeather] = useState(currentWeather === true);

  // ⚠ THE SETTER'S LEVEL DECIDES, NOT THE VIEWER'S. A squad is a shared room:
  // whoever applies the environment must hold the unlock, and every member then
  // sees it regardless of their own level. Admin resolves everything, mirroring
  // isEffectOn() and firestore.rules.
  const myLevel = profile?.role === 'admin' ? 100 : (Number(profile?.vpLevel) || 1);
  const envLevel = unlockLevel('squad_environment');
  const weatherLevel = unlockLevel('squad_weather');
  const canEnv = myLevel >= envLevel;
  const canWeather = myLevel >= weatherLevel;

  const colors = [
    '#0B0B0F', '#1A1B1F', '#2A2C32', '#3A3C44', '#4A4C56',
    '#B44FFF', '#7B6FFF', '#FF6B4A', '#FFD93D', '#C56CF0'
  ];

  const [uploadedImageUrl, setUploadedImageUrl] = useState(currentBackground === 'image' ? currentValue : null);

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadFile(`squad_backgrounds/${squadId}/${Date.now()}_${file.name}`, file);
      setUploadedImageUrl(url);
    } catch (err) {
      showToast('Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    try {
      if (selectedType === 'color') {
        await setSquadChatBackground(squadId, 'color', color);
        showToast('Background color updated', 'success');
      } else if (selectedType === 'image' && uploadedImageUrl) {
        await setSquadChatBackground(squadId, 'image', uploadedImageUrl);
        showToast('Background image updated', 'success');
      } else if (selectedType === 'environment' && canEnv) {
        // ⚠ Weather is written as `canWeather && weather`, never the raw toggle.
        // The client gate is convenience; firestore.rules is the boundary, and
        // sending a value the rules would reject just produces a failed write.
        await setSquadChatBackground(squadId, 'environment', envId, canWeather && weather);
        showToast('Squad environment updated', 'success');
      }
      onClose();
    } catch (err) {
      showToast('Failed to update background', 'error');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Chat Background">
      <div className="space-y-4">
        <div className="flex gap-2">
          <button
            onClick={() => setSelectedType('color')}
            className={`flex-1 py-2 rounded-lg font-semibold text-sm ${selectedType === 'color' ? 'bg-brand-violet text-white' : 'bg-surface-2 text-text-muted'}`}
          >
            Color
          </button>
          <button
            onClick={() => setSelectedType('image')}
            className={`flex-1 py-2 rounded-lg font-semibold text-sm ${selectedType === 'image' ? 'bg-brand-violet text-white' : 'bg-surface-2 text-text-muted'}`}
          >
            Image
          </button>
          <button
            onClick={() => setSelectedType('environment')}
            className={`flex-1 py-2 rounded-lg font-semibold text-sm ${selectedType === 'environment' ? 'bg-brand-violet text-white' : 'bg-surface-2 text-text-muted'}`}
          >
            Environment
          </button>
        </div>

        {selectedType === 'environment' && (
          <div>
            {!canEnv && (
              <p className="text-[11px] text-text-muted mb-3">
                Squad environments unlock at level {envLevel}. You are level {myLevel}.
              </p>
            )}
            {/* ⚠ EACH SWATCH IS THE REAL BACKDROP, not an approximation of it.
                The profile theme system shipped a picker whose swatch drew one
                thing and whose page drew another, and neither file showed the
                disagreement. One function renders both. */}
            <div className="grid grid-cols-3 gap-2">
              {ENVIRONMENTS.map((e) => (
                <button
                  key={e.id}
                  disabled={!canEnv}
                  onClick={() => setEnvId(e.id)}
                  title={e.blurb}
                  className={`relative h-20 rounded-xl overflow-hidden text-left ${!canEnv ? 'opacity-40' : ''}`}
                  style={{
                    ...environmentBackdrop(e),
                    outline: envId === e.id ? '2px solid var(--brand-violet,#7B1FFF)' : 'none',
                    outlineOffset: 1,
                  }}
                >
                  <span className="absolute left-2 bottom-1.5 text-[11px] font-bold"
                        style={{ textShadow: '0 1px 3px rgba(0,0,0,0.85)' }}>
                    {e.name}
                  </span>
                  {envId === e.id && (
                    <Icon name="check_circle" size={16}
                          className="absolute right-1.5 top-1.5 text-white" />
                  )}
                </button>
              ))}
            </div>

            <label className={`flex items-center gap-2 mt-3 text-[12px] ${canWeather ? '' : 'opacity-50'}`}>
              <input
                type="checkbox"
                checked={canWeather && weather}
                disabled={!canWeather}
                onChange={(ev) => setWeather(ev.target.checked)}
                style={{ accentColor: 'var(--brand-violet,#7B1FFF)' }}
              />
              <span>
                Live weather
                {!canWeather && <span className="text-text-muted"> — unlocks at level {weatherLevel}</span>}
              </span>
            </label>
            <p className="mt-1 text-[10px] text-text-muted">
              Everyone in the squad sees the room you pick, whatever their own level.
            </p>
          </div>
        )}

        {selectedType === 'color' && (
          <div>
            <div className="grid grid-cols-5 gap-2 mb-4">
              {colors.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="w-10 h-10 rounded-full border-2 border-white/20"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-full h-10 rounded-lg bg-surface-2 border border-white/[0.06]"
            />
          </div>
        )}

        {selectedType === 'image' && (
          <div>
            <label className="block w-full p-4 border-2 border-dashed border-white/[0.06] rounded-xl text-center cursor-pointer hover:border-brand-violet transition-colors">
              <Icon name="cloud_upload" size={32} className="mx-auto text-text-muted mb-2" />
              <span className="text-sm text-text-muted">Click to upload image</span>
              <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
            </label>
            {uploadedImageUrl && (
              <div className="mt-3 relative">
                <img src={uploadedImageUrl} alt="Background preview" className="w-full h-32 object-cover rounded-lg" />
                <button
                  onClick={() => setUploadedImageUrl(null)}
                  className="absolute top-1 right-1 bg-black/50 rounded-full p-1"
                >
                  <Icon name="close" size={16} className="text-white" />
                </button>
              </div>
            )}
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={uploading}
          className="w-full py-3 rounded-xl bg-brand-violet text-white font-bold text-sm"
        >
          {uploading ? 'Uploading...' : 'Apply Background'}
        </button>
      </div>
    </Modal>
  );
}