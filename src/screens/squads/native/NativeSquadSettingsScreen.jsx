// Native Squad Settings — /squads/:squadId/settings on the APK.
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../firebase/config';
import { useAuth } from '../../../context/AuthContext';
import { useUI } from '../../../context/UIContext';
import { getSquadMember } from '../../../firebase/firestore';
import { uploadToR2 } from '../../../utils/r2Storage';
import { compressMedia } from '../../../utils/mediaCompression';
import { initials } from '../../../components/squad/squadHelpers';
import NativeSquadScaffold from './NativeSquadScaffold';

const GAMES = ['Valorant', 'Apex Legends', 'Fortnite', 'League of Legends', 'CS2', 'Overwatch 2', 'Call of Duty', 'Rocket League', 'Dota 2', 'FIFA', 'Other'];
const inputStyle = { width: '100%', padding: '12px 14px', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, color: '#fff', fontSize: 14 };

export default function NativeSquadSettingsScreen() {
  const { squadId } = useParams();
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const navigate = useNavigate();

  const [squad, setSquad] = useState(null);
  const [myRole, setMyRole] = useState(null);
  const [saving, setSaving] = useState(false);
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [bannerFile, setBannerFile] = useState(null);
  const [bannerPreview, setBannerPreview] = useState(null);

  useEffect(() => {
    if (!squadId || !currentUser) return;
    (async () => {
      const snap = await getDoc(doc(db, 'squads', squadId));
      if (snap.exists()) setSquad({ id: snap.id, ...snap.data() });
      const mem = await getSquadMember(squadId, currentUser.uid).catch(() => null);
      setMyRole(mem?.role || null);
    })();
  }, [squadId, currentUser]);

  const isPresident = myRole === 'president';
  const isLeader = isPresident || myRole === 'vice_president';

  const onPickAvatar = (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; setAvatarFile(f); setAvatarPreview(URL.createObjectURL(f)); };
  const onPickBanner = (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) { showToast('Image only', 'error'); return; }
    if (f.size > 10 * 1024 * 1024) { showToast('Banner must be under 10MB', 'error'); return; }
    setBannerFile(f); setBannerPreview(URL.createObjectURL(f));
  };
  const onRemoveBanner = async () => {
    if (!squad?.banner) { setBannerFile(null); setBannerPreview(null); return; }
    if (!window.confirm('Remove the squad banner?')) return;
    try { await updateDoc(doc(db, 'squads', squadId), { banner: null, updatedAt: serverTimestamp() }); setSquad((s) => ({ ...s, banner: null })); setBannerFile(null); setBannerPreview(null); showToast('Banner removed', 'info'); }
    catch (err) { showToast(err?.message || 'Could not remove', 'error'); }
  };

  const handleSave = async () => {
    if (!squad) return;
    setSaving(true);
    try {
      const updates = { name: squad.name, description: squad.description || '', game: squad.game || null, isPublic: !!squad.isPublic, updatedAt: serverTimestamp() };
      if (avatarFile) { const c = await compressMedia(avatarFile, 'free', 'avatar'); const up = await uploadToR2(c, 'squad'); if (up?.url) updates.avatar = up.url; }
      if (bannerFile) { const c = await compressMedia(bannerFile, 'free', 'background'); const up = await uploadToR2(c, 'banner'); if (up?.url) updates.banner = up.url; }
      await updateDoc(doc(db, 'squads', squadId), updates);
      setSquad((s) => ({ ...s, ...(updates.avatar ? { avatar: updates.avatar } : {}), ...(updates.banner ? { banner: updates.banner } : {}) }));
      setAvatarFile(null); setAvatarPreview(null); setBannerFile(null); setBannerPreview(null);
      showToast('Settings saved', 'success');
    } catch (err) { showToast(`Save failed: ${err?.message || err?.details || err?.code || String(err)}`, 'error'); }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!isPresident) { showToast('Only the President can delete this squad', 'error'); return; }
    if (!window.confirm('Permanently delete this squad? This cannot be undone.')) return;
    try { await deleteDoc(doc(db, 'squads', squadId)); showToast('Squad deleted', 'info'); navigate('/squads'); }
    catch (err) { showToast(err?.message || 'Failed to delete', 'error'); }
  };

  const actions = isLeader ? <button className="btn primary sm" disabled={saving} onClick={handleSave}>{saving ? 'Saving…' : 'Save'}</button> : null;

  if (!squad) {
    return (
      <NativeSquadScaffold mode="squad" title="Settings" activeId="settings" squadId={squadId}>
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--t3)' }}>Loading…</div>
      </NativeSquadScaffold>
    );
  }

  return (
    <NativeSquadScaffold mode="squad" title="Settings" activeId="settings" squadId={squadId} squadName={squad?.name} actions={actions}>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 22 }}>
        {/* Avatar */}
        <section>
          <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 14, color: '#fff', marginBottom: 10 }}>Squad Avatar</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div className="squad-avatar" style={{ width: 64, height: 64, fontSize: 22 }}>{avatarPreview ? <img src={avatarPreview} alt="" /> : squad.avatar ? <img src={squad.avatar} alt="" /> : initials(squad.name)}</div>
            {isLeader && <label className="btn ghost"><span className="material-symbols-outlined">upload</span> Change<input type="file" hidden accept="image/*" onChange={onPickAvatar} /></label>}
          </div>
        </section>

        {/* Banner */}
        <section>
          <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 14, color: '#fff', marginBottom: 10 }}>Squad Banner</div>
          <div style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: 'var(--t3)', marginBottom: 8 }}>Shown across the top of the squad card + overview. Recommended 1500×500 (3:1).</div>
          <label htmlFor="squad-banner-input-native" style={{ position: 'relative', display: 'block', aspectRatio: '3 / 1', borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,.08)', cursor: isLeader ? 'pointer' : 'default', background: 'linear-gradient(135deg,#0d0820 0%,#1a0a3a 30%,#2d0a5a 60%,#1a0a30 100%)' }}>
            {(bannerPreview || squad.banner) && <img src={bannerPreview || squad.banner} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
            {isLeader && !(bannerPreview || squad.banner) && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.4)', color: '#fff', flexDirection: 'column', gap: 6 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 28 }}>add_photo_alternate</span>
                <div style={{ fontFamily: 'DM Mono', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.1em' }}>Tap to upload banner</div>
              </div>
            )}
          </label>
          {isLeader && (
            <>
              <input id="squad-banner-input-native" type="file" hidden accept="image/*" onChange={onPickBanner} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <label htmlFor="squad-banner-input-native" className="btn ghost"><span className="material-symbols-outlined">upload</span> {(bannerPreview || squad.banner) ? 'Replace' : 'Upload'}</label>
                {(bannerPreview || squad.banner) && <button className="btn danger" onClick={onRemoveBanner}><span className="material-symbols-outlined">delete</span> Remove</button>}
              </div>
            </>
          )}
        </section>

        <section>
          <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 14, color: '#fff', marginBottom: 10 }}>Squad Name</div>
          <input value={squad.name || ''} onChange={(e) => setSquad({ ...squad, name: e.target.value })} disabled={!isLeader} maxLength={32} style={{ ...inputStyle, opacity: isLeader ? 1 : .6 }} />
        </section>

        <section>
          <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 14, color: '#fff', marginBottom: 10 }}>Description</div>
          <textarea value={squad.description || ''} onChange={(e) => setSquad({ ...squad, description: e.target.value })} disabled={!isLeader} maxLength={200} rows={3} style={{ ...inputStyle, resize: 'vertical', minHeight: 80, opacity: isLeader ? 1 : .6 }} />
        </section>

        <section>
          <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 14, color: '#fff', marginBottom: 10 }}>Primary Game</div>
          <div className="chips">{GAMES.map((g) => <button key={g} onClick={() => isLeader && setSquad({ ...squad, game: g })} className={`chip${squad.game === g ? ' active' : ''}`} disabled={!isLeader}>{g}</button>)}</div>
        </section>

        <section>
          <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 14, color: '#fff', marginBottom: 10 }}>Privacy</div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button disabled={!isLeader} onClick={() => setSquad({ ...squad, isPublic: true })} className={`chip${squad.isPublic ? ' active' : ''}`} style={{ flex: 1, padding: '14px 16px', borderRadius: 14, textAlign: 'left' }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>Public</div><div style={{ fontSize: 11, opacity: .8, marginTop: 2 }}>Searchable, anyone can request to join</div>
            </button>
            <button disabled={!isLeader} onClick={() => setSquad({ ...squad, isPublic: false })} className={`chip${!squad.isPublic ? ' active' : ''}`} style={{ flex: 1, padding: '14px 16px', borderRadius: 14, textAlign: 'left' }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>Private</div><div style={{ fontSize: 11, opacity: .8, marginTop: 2 }}>Invite-only, hidden from search</div>
            </button>
          </div>
        </section>

        {isLeader && <button className="btn primary lg" disabled={saving} onClick={handleSave} style={{ justifyContent: 'center' }}>{saving ? 'Saving…' : 'Save changes'}</button>}

        {isPresident && (
          <section style={{ marginTop: 8, padding: 18, border: '1px solid rgba(240,64,96,.3)', borderRadius: 14, background: 'rgba(240,64,96,.05)' }}>
            <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 14, color: 'var(--ember)', marginBottom: 6 }}>Danger Zone</div>
            <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 12 }}>Deleting your squad is permanent. All messages, members, and treasury balance will be wiped.</div>
            <button className="btn danger" onClick={handleDelete}><span className="material-symbols-outlined">delete_forever</span> Delete Squad</button>
          </section>
        )}
      </div>
    </NativeSquadScaffold>
  );
}
