// src/components/BackgroundPickerModal.jsx
import { useState } from 'react';
import { setSquadChatBackground } from '../firebase/firestore';
import { uploadFile } from '../firebase/firestore';
import Modal from './Modal';
import Icon from './Icon';
import { useUI } from '../context/UIContext';

export default function BackgroundPickerModal({ isOpen, onClose, squadId, currentBackground, currentValue }) {
  const { showToast } = useUI();
  const [selectedType, setSelectedType] = useState(currentBackground || 'color');
  const [color, setColor] = useState(currentBackground === 'color' ? currentValue || '#0B0B0F' : '#0B0B0F');
  const [uploading, setUploading] = useState(false);

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
        </div>

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