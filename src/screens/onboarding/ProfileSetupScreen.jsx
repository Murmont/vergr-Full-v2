import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../../firebase/config';
import { uploadToR2 } from '../../utils/r2Storage';
import { compressMedia } from '../../utils/mediaCompression';
import { SiTwitch, SiDiscord, SiYoutube, SiSteam } from 'react-icons/si'; // Professional brand logos
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import AddPhoneModal from '../../components/AddPhoneModal';

export default function ProfileSetupScreen() {
  const [bio, setBio] = useState('');
  const [phoneModalOpen, setPhoneModalOpen] = useState(false);
  const [phoneSaved, setPhoneSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const fileInputRef = useRef(null);
  const navigate = useNavigate();

  const handleFileClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file || !auth.currentUser) return;

    // Show local preview immediately
    setPreviewUrl(URL.createObjectURL(file));
    setUploading(true);

    try {
      // Compress on-device before upload — 4 MB phone photos become ~80 KB
      // 512×512 JPEGs, which keeps Storage costs flat as users grow.
      const compressed = await compressMedia(file, 'free', 'avatar');

      const { url: downloadURL } = await uploadToR2(compressed, 'avatar');

      // Update Firestore in the 'vgrdb' database
      const userRef = doc(db, 'users', auth.currentUser.uid);
      await updateDoc(userRef, {
        avatar: downloadURL,
        updatedAt: new Date()
      });

      console.log("Avatar uploaded successfully!");
    } catch (error) {
      console.error("Upload failed:", error);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="screen-container min-h-screen">
      <TopBar title="Set Up Profile" showBack />
      
      {/* Required for the browser to open the photo gallery */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        accept="image/*" 
        className="hidden" 
      />

      <div className="flex-1 px-4 pb-32">
        <div className="flex flex-col items-center mb-8 mt-4">
          <div className="relative cursor-pointer" onClick={handleFileClick}>
            <div className="w-24 h-24 rounded-full bg-surface-2 border-2 border-dashed border-white/[0.06] flex items-center justify-center overflow-hidden">
              {previewUrl ? (
                <img src={previewUrl} className="w-full h-full object-cover" alt="Avatar" />
              ) : (
                <Icon name="add_a_photo" size={32} className="text-text-muted" />
              )}
              {uploading && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-brand-violet border-t-transparent animate-spin rounded-full"></div>
                </div>
              )}
            </div>
            <button className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-brand-violet flex items-center justify-center">
              <Icon name="edit" size={16} className="text-bg-dark" />
            </button>
          </div>
          <p className="text-text-secondary text-sm mt-3">
            {uploading ? "Uploading..." : "Tap to upload avatar"}
          </p>
        </div>

        <div className="mb-6">
          <label className="text-text-secondary text-sm mb-2 block">Bio</label>
          <textarea
            value={bio} onChange={e => setBio(e.target.value)} maxLength={150}
            placeholder="Tell gamers about yourself..."
            className="w-full bg-surface-2 border border-white/[0.06] rounded-2xl p-4 text-text-primary placeholder:text-text-muted focus:border-brand-violet focus:ring-1 focus:ring-brand-violet focus:outline-none transition-all h-28 resize-none text-sm"
          />
          <p className="text-text-muted text-xs text-right mt-1">{bio.length}/150</p>
        </div>

        {/* Optional phone — earns 1000 VP once saved, lets the user invite
            contacts and auto-match the ones already on VERGR. Fully skippable;
            the New Chat screen's 3-dot menu and Earn tab also offer this later. */}
        <div className="mb-6">
          <label className="text-text-secondary text-sm mb-2 block">
            Phone number <span className="text-text-muted">(optional — earn +1000 VP)</span>
          </label>
          {phoneSaved ? (
            <div className="flex items-center gap-2 bg-brand-violet/10 border border-brand-violet/30 rounded-2xl px-4 py-3">
              <Icon name="check_circle" size={18} className="text-brand-violet-light" />
              <p className="text-brand-violet-light text-sm font-bold">Phone saved — +1000 VP added to your wallet.</p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPhoneModalOpen(true)}
              className="w-full flex items-center gap-3 p-3 rounded-2xl bg-surface-2 border border-white/[0.06] hover:border-brand-violet/30 transition-all"
            >
              <div className="w-10 h-10 rounded-full bg-brand-violet/15 text-brand-violet-light flex items-center justify-center shrink-0">
                <Icon name="phone" size={18} />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-bold text-white">Add phone number</p>
                <p className="text-[11px] text-text-muted">Pick your country, type your number, earn +1000 VP.</p>
              </div>
              <Icon name="chevron_right" size={20} className="text-text-muted" />
            </button>
          )}
        </div>

        {phoneModalOpen && (
          <AddPhoneModal
            rewardAmount={1000}
            onClose={() => setPhoneModalOpen(false)}
            onSaved={() => { setPhoneModalOpen(false); setPhoneSaved(true); }}
          />
        )}

        <h3 className="text-text-primary font-semibold mb-3">Link Gaming Accounts</h3>
        <div className="space-y-3">
          {[
            { name: 'Twitch', icon: <SiTwitch />, color: '#9146FF' },
            { name: 'Discord', icon: <SiDiscord />, color: '#5865F2' },
            { name: 'YouTube', icon: <SiYoutube />, color: '#FF0000' },
            { name: 'Steam', icon: <SiSteam />, color: '#66c0f4' }, // Official Vibrant Steam Blue
          ].map(platform => (
            <button key={platform.name}
              className="w-full flex items-center justify-between px-4 py-3.5 rounded-2xl border border-white/[0.06] bg-surface-2 hover:border-white/[0.12] transition-colors">
              <div className="flex items-center gap-3">
                <span className="text-xl" style={{ color: platform.color }}>{platform.icon}</span>
                <span className="text-text-primary text-sm font-medium">{platform.name}</span>
              </div>
              <span className="text-brand-violet-light text-sm font-semibold">Connect</span>
            </button>
          ))}
        </div>
      </div>

      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] p-4 glass-header border-t border-white/[0.04]">
        <button 
          onClick={() => navigate('/setup/follow-suggestions')} 
          disabled={uploading}
          className={`btn-primary ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          Continue
        </button>
        <button 
          onClick={() => navigate('/setup/follow-suggestions')} 
          className="w-full text-text-muted text-sm mt-3 text-center"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}