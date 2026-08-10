// Create Squad — .sqd-shelled creation flow. Form on the left, sticky live
// preview card on the right (inside the same column, so the layout doesn't
// rely on a separate rail-r and doesn't leave dead horizontal space).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { createSquad, getUserSquads } from '../../firebase/firestore';
import { uploadToR2 } from '../../utils/r2Storage';
import { compressMedia } from '../../utils/mediaCompression';
import { MAX_SQUAD_OWN } from '../../utils/constants';
import SquadShell from '../../components/squad/SquadShell';
import { IS_NATIVE_BUILD } from '../../utils/platform';
import { initials } from '../../components/squad/squadHelpers';

const GAME_OPTIONS = ['Valorant', 'Apex Legends', 'Fortnite', 'League of Legends', 'CS2', 'Overwatch 2', 'Call of Duty', 'Rocket League', 'Dota 2', 'FIFA', 'Other'];

export default function CreateSquadScreen() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { showToast } = useUI();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [game, setGame] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [bannerFile, setBannerFile] = useState(null);
  const [bannerPreview, setBannerPreview] = useState(null);
  const [creating, setCreating] = useState(false);

  const onPickAvatar = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) { showToast('Image only', 'error'); return; }
    setAvatarFile(f);
    setAvatarPreview(URL.createObjectURL(f));
  };

  const onPickBanner = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) { showToast('Image only', 'error'); return; }
    if (f.size > 10 * 1024 * 1024) { showToast('Banner must be under 10MB', 'error'); return; }
    setBannerFile(f);
    setBannerPreview(URL.createObjectURL(f));
  };

  const handleCreate = async () => {
    if (!name.trim() || !game) { showToast('Name and game are required', 'error'); return; }
    if (name.trim().length < 3) { showToast('Name must be at least 3 characters', 'error'); return; }
    setCreating(true);
    try {
      const userSquads = await getUserSquads(currentUser.uid);
      const owned = userSquads.filter((s) => s.ownerId === currentUser.uid);
      if (owned.length >= MAX_SQUAD_OWN) {
        showToast(`You can only own ${MAX_SQUAD_OWN} squad`, 'error');
        setCreating(false);
        return;
      }
      let avatarUrl = null;
      let bannerUrl = null;
      // Always compress before upload — avatar preset ~80KB, background
      // preset ~250KB. Stops phone-camera 5MB JPEGs from eating R2 storage.
      if (avatarFile) {
        const compressed = await compressMedia(avatarFile, 'free', 'avatar');
        const up = await uploadToR2(compressed, 'squad');
        avatarUrl = up?.url || null;
      }
      if (bannerFile) {
        const compressed = await compressMedia(bannerFile, 'free', 'background');
        const up = await uploadToR2(compressed, 'banner');
        bannerUrl = up?.url || null;
      }
      const squadId = await createSquad(currentUser.uid, {
        name: name.trim(),
        description: description.trim(),
        game,
        isPublic: !isPrivate,
        avatar: avatarUrl,
        banner: bannerUrl,
      });
      showToast('Squad created — you are the President', 'success');
      navigate(`/squads/${squadId}`);
    } catch (err) {
      console.error('Failed to create squad:', err);
      const msg = err?.message || err?.details || err?.code || String(err);
      showToast(`Create squad failed: ${msg}`, 'error');
    }
    setCreating(false);
  };

  const previewCard = (
    <div style={{ position: 'sticky', top: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontFamily: 'DM Mono', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--t3)' }}>Live Preview</div>
      <div className="sq-card" style={{ cursor: 'default', maxWidth: 360 }}>
        <div
          className="sq-banner"
          style={bannerPreview ? { background: `url(${bannerPreview}) center/cover, #1a0a3a` } : undefined}
        >
          <div className="sq-avatar-wrap">
            <div>{avatarPreview ? <img src={avatarPreview} alt="" /> : initials(name || '?')}</div>
          </div>
        </div>
        <div className="sq-body">
          <div className="sq-name">{name || 'Your Squad'}</div>
          <div className="sq-line">
            <span>{game || 'Pick a game'}</span>
            <span className="pip" />
            <span>{isPrivate ? 'Private' : 'Public'}</span>
          </div>
          {description && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--t2)', lineHeight: 1.5 }}>{description}</div>}
          <div className="sq-xp">
            <span className="lvl">LVL <span className="v">1</span></span>
            <div className="bar"><div style={{ width: '0%' }} /></div>
            <span className="pct">1 member</span>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    // No rightRail prop — preview is inline beside the form. That way the
    // 2-column inner grid uses available width fully on wide viewports and
    // collapses to a single column on narrow ones (≤900px) without leaving
    // dead horizontal space.
    <SquadShell mode="global" activeId="create">
      <main className="main" style={{ overflowY: 'auto' }}>
        <header className="channel-header">
          <div className="channel-title">
            <span className="channel-name">Create Squad</span>
            <span className="channel-divider" />
            <span className="channel-desc">Build your team. Recruit your roster.</span>
          </div>
        </header>

        <div
          style={{
            padding: 22,
            display: 'grid',
            gap: 28,
            gridTemplateColumns: IS_NATIVE_BUILD ? '1fr' : 'minmax(0,1fr) minmax(280px, 380px)',
            alignItems: 'start',
          }}
          className="create-squad-grid"
        >
          {/* FORM */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 640 }}>
            {/* Avatar */}
            <section>
              <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 14, color: '#fff', marginBottom: 10 }}>Squad Avatar</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div className="squad-avatar" style={{ width: 64, height: 64, fontSize: 22 }}>
                  {avatarPreview ? <img src={avatarPreview} alt="" /> : initials(name || '?')}
                </div>
                <label className="btn ghost">
                  <span className="material-symbols-outlined">upload</span> Upload
                  <input type="file" hidden accept="image/*" onChange={onPickAvatar} />
                </label>
                {avatarPreview && (
                  <button className="btn ghost" onClick={() => { setAvatarFile(null); setAvatarPreview(null); }}>Remove</button>
                )}
              </div>
            </section>

            {/* Banner */}
            <section>
              <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 14, color: '#fff', marginBottom: 6 }}>Squad Banner</div>
              <div style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: 'var(--t3)', marginBottom: 8 }}>
                Optional. Recommended 1500×500 (3:1). You can add or change this later in Squad Settings.
              </div>
              <label
                style={{
                  position: 'relative', display: 'block', aspectRatio: '3 / 1', borderRadius: 12, overflow: 'hidden',
                  border: '1px solid rgba(255,255,255,.08)', cursor: 'pointer',
                  background: 'linear-gradient(135deg,#0d0820 0%,#1a0a3a 30%,#2d0a5a 60%,#1a0a30 100%)',
                }}
              >
                {bannerPreview && (
                  <img src={bannerPreview} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                )}
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: bannerPreview ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,.35)', color: '#fff', flexDirection: 'column', gap: 6,
                  transition: 'background .15s',
                }}>
                  {!bannerPreview && (
                    <>
                      <span className="material-symbols-outlined" style={{ fontSize: 28 }}>add_photo_alternate</span>
                      <div style={{ fontFamily: 'DM Mono', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.1em' }}>Click to upload banner</div>
                    </>
                  )}
                </div>
                <input type="file" hidden accept="image/*" onChange={onPickBanner} />
              </label>
              {bannerPreview && (
                <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => { setBannerFile(null); setBannerPreview(null); }}>
                  <span className="material-symbols-outlined">delete</span> Remove banner
                </button>
              )}
            </section>

            {/* Name */}
            <section>
              <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 14, color: '#fff', marginBottom: 10 }}>Squad Name</div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={32}
                placeholder="Night Raiders"
                style={{ width: '100%', padding: '12px 14px', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, color: '#fff', fontSize: 14 }}
              />
              <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: 'var(--t3)', marginTop: 6 }}>{name.length}/32</div>
            </section>

            {/* Description */}
            <section>
              <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 14, color: '#fff', marginBottom: 10 }}>Description</div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={200}
                rows={3}
                placeholder="What's your squad about?"
                style={{ width: '100%', padding: '12px 14px', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, color: '#fff', fontSize: 14, resize: 'vertical', minHeight: 80 }}
              />
              <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: 'var(--t3)', marginTop: 6 }}>{description.length}/200</div>
            </section>

            {/* Game */}
            <section>
              <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 14, color: '#fff', marginBottom: 10 }}>Primary Game</div>
              <div className="chips">
                {GAME_OPTIONS.map((g) => (
                  <button key={g} onClick={() => setGame(g)} className={`chip${game === g ? ' active' : ''}`}>{g}</button>
                ))}
              </div>
            </section>

            {/* Privacy */}
            <section>
              <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 14, color: '#fff', marginBottom: 10 }}>Privacy</div>
              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  onClick={() => setIsPrivate(false)}
                  className={`chip${!isPrivate ? ' active' : ''}`}
                  style={{ flex: 1, padding: '14px 16px', borderRadius: 14, display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left' }}
                >
                  <span className="material-symbols-outlined">public</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>Public</div>
                    <div style={{ fontSize: 11, opacity: .8, marginTop: 2 }}>Anyone can find and request to join</div>
                  </div>
                </button>
                <button
                  onClick={() => setIsPrivate(true)}
                  className={`chip${isPrivate ? ' active' : ''}`}
                  style={{ flex: 1, padding: '14px 16px', borderRadius: 14, display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left' }}
                >
                  <span className="material-symbols-outlined">lock</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>Private</div>
                    <div style={{ fontSize: 11, opacity: .8, marginTop: 2 }}>Invite-only — hidden from search</div>
                  </div>
                </button>
              </div>
            </section>

            <div style={{ display: 'flex', gap: 10, paddingTop: 6 }}>
              <button className="btn ghost" onClick={() => navigate('/squads')}>Cancel</button>
              <button className="btn primary lg" disabled={creating || !name.trim() || !game} onClick={handleCreate} style={{ flex: 1 }}>
                {creating ? 'Creating…' : 'Create Squad'}
              </button>
            </div>
          </div>

          {/* PREVIEW (sticky inside the same grid column area) */}
          {previewCard}
        </div>

        {/* Collapse preview below form on narrow viewports. */}
        <style>{`
          @media (max-width: 900px) {
            .create-squad-grid { grid-template-columns: 1fr !important; }
            .create-squad-grid > div:last-child { position: static !important; }
          }
        `}</style>
      </main>
    </SquadShell>
  );
}
