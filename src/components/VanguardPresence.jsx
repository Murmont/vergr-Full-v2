// VanguardPresence — the live-stream / tournament "a moderator is watching"
// indicator system. Three responsibilities, all in one mounted component:
//
//   1. WRITE — if the current viewer IS Vanguard, write a presence doc to
//      `<parentPath>/vanguardPresence/<uid>` on mount and delete it on
//      unmount. Heartbeat every 30s to keep `lastSeen` fresh.
//
//   2. READ — listen to all presence docs under that path. Maintain a list
//      of currently-present Vanguard members. Filter out docs older than
//      90 seconds (stale heartbeats).
//
//   3. RENDER — show a full-width banner with the rank's stream-join webp
//      when a non-Overseer Vanguard newly joins. Show a persistent
//      indicator (compact badge cluster) listing the visible ranks for
//      everyone to see. Overseers ALWAYS join SILENTLY (no banner, no
//      indicator entry) per the founder's design — they audit the audit.
//
// Usage:
//   <VanguardPresence parentPath={`streams/${streamId}`} />
//   <VanguardPresence parentPath={`tournaments/${tournamentId}`} />
//
// Mount the component anywhere inside the screen — it renders a fixed-position
// banner + indicator that doesn't disrupt layout.
//
// To allow Commander+ to remove a moderator from the room, the indicator
// shows a 🗑 button next to each row (Commander+ only).
import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, setDoc, deleteDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useUser } from '../context/UserContext';
import { useUI } from '../context/UIContext';
import { isVanguard, rankMeta, RANK_BY_ID } from '../utils/vanguard';

const HEARTBEAT_MS = 30_000;
const STALE_MS = 90_000;

const C = { card: '#12121e', border: '#1e1e30', text: '#fff', textDim: '#9CA3AF', ember: '#F04060' };
const tsMs = (t) => (t?.toDate ? t.toDate().getTime() : t?.seconds ? t.seconds * 1000 : 0);

export default function VanguardPresence({ parentPath }) {
  const { profile } = useUser();
  const { showToast } = useUI();
  const meIsVanguard = isVanguard(profile);
  const myRank = profile?.vanguard?.rank;
  const presenceCol = useMemo(
    () => parentPath ? collection(db, ...parentPath.split('/'), 'vanguardPresence') : null,
    [parentPath],
  );

  // ── 1. Write own presence + heartbeat ───────────────────────────
  useEffect(() => {
    if (!presenceCol || !meIsVanguard || !profile?.uid) return;
    const myRef = doc(presenceCol, profile.uid);
    const write = () => setDoc(myRef, {
      uid: profile.uid,
      rank: myRank,
      // displayName here is the REAL name — the persona is applied at
      // render time via rankMeta. The doc is readable by anyone, but we
      // include it so a Commander viewing the roster can identify who
      // exactly is in the room.
      realDisplayName: profile.displayName || profile.username || profile.uid.slice(0, 6),
      joinedAt: serverTimestamp(),
      lastSeen: serverTimestamp(),
    }, { merge: true }).catch(() => {});
    write();
    const interval = setInterval(write, HEARTBEAT_MS);
    return () => {
      clearInterval(interval);
      deleteDoc(myRef).catch(() => {});
    };
  }, [presenceCol, meIsVanguard, profile?.uid, myRank, profile?.displayName, profile?.username]);

  // ── 2. Read all presences ───────────────────────────────────────
  const [present, setPresent] = useState([]); // [{ uid, rank, joinedAt, lastSeen, realDisplayName }]
  useEffect(() => {
    if (!presenceCol) return;
    const unsub = onSnapshot(presenceCol, (snap) => {
      const now = Date.now();
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => {
          const ms = tsMs(p.lastSeen);
          return !ms || (now - ms) < STALE_MS;
        });
      setPresent(rows);
    }, () => {});
    return () => unsub();
  }, [presenceCol]);

  // ── 3a. Banner — fire once when a NEW non-Overseer Vanguard joins ──
  const [banner, setBanner] = useState(null);  // { rank, joinIcon, label, key }
  const seenRef = useRef(new Set());
  useEffect(() => {
    // Initial mount: mark all currently-present as already-seen so we
    // don't fire a banner-storm on first load.
    if (seenRef.current.size === 0 && present.length > 0) {
      for (const p of present) seenRef.current.add(p.uid);
      return;
    }
    // Detect newly-appearing uids.
    for (const p of present) {
      if (seenRef.current.has(p.uid)) continue;
      seenRef.current.add(p.uid);
      const meta = rankMeta(p.rank);
      if (!meta) continue;
      // Overseers join SILENTLY — they're auditing other Vanguard.
      if (!meta.authority?.announcesJoin) continue;
      // Don't show the banner to the joining Vanguard themselves.
      if (p.uid === profile?.uid) continue;
      setBanner({
        rank: p.rank,
        joinIcon: meta.join,
        label: meta.label,
        key: `${p.uid}_${Date.now()}`,
      });
      // Auto-dismiss after 4s. (CSS animation handles the fade-out.)
      const t = setTimeout(() => setBanner((b) => (b && b.key === `${p.uid}_${Date.now()}` ? null : b)), 4200);
      return () => clearTimeout(t);
    }
  }, [present, profile?.uid]);

  // Auto-clear stuck banners after 4.2s regardless (in case dependency
  // change beat the clearTimeout).
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 4200);
    return () => clearTimeout(t);
  }, [banner]);

  // ── 3b. Persistent indicator data ───────────────────────────────
  // Visible Vanguard list = those whose rank's authority.announcesJoin
  // is true. Overseers are intentionally excluded from the public
  // indicator so users can't tell they're being audited.
  const visible = useMemo(
    () => present.filter((p) => rankMeta(p.rank)?.authority?.announcesJoin),
    [present],
  );
  // Commander+ get a Remove button on each row.
  const canRemove = myRank === 'commander' || myRank === 'overseer';
  const onRemove = async (uid) => {
    if (!presenceCol) return;
    if (!window.confirm('Remove this moderator from the room? They\'ll need to rejoin themselves.')) return;
    try {
      await deleteDoc(doc(presenceCol, uid));
      showToast?.('Moderator removed.', 'success');
    } catch (e) {
      showToast?.(e?.message || 'Failed to remove', 'error');
    }
  };

  return (
    <>
      {/* BANNER — full-width slim strip across the top, fades after 4s. */}
      {banner && (
        <div
          style={{
            position: 'fixed', top: 'calc(env(safe-area-inset-top, 0px) + 16px)', left: '50%', transform: 'translateX(-50%)',
            zIndex: 9999, pointerEvents: 'none',
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 18px 10px 12px',
            background: 'linear-gradient(90deg, rgba(11,11,20,.95), rgba(180,79,255,.18), rgba(11,11,20,.95))',
            border: '1px solid rgba(180,79,255,.5)',
            borderRadius: 14,
            boxShadow: '0 8px 32px rgba(0,0,0,.6), 0 0 24px rgba(180,79,255,.35)',
            color: C.text,
            animation: 'vanguardBannerIn .35s ease-out, vanguardBannerOut .4s ease-in 3.6s forwards',
            maxWidth: '90vw',
          }}
        >
          <img src={banner.joinIcon} alt="" style={{ height: 36, width: 'auto', flexShrink: 0 }} draggable={false} />
          <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 14, letterSpacing: '.02em' }}>
            {banner.label} has joined
          </div>
        </div>
      )}

      {/* PERSISTENT INDICATOR — small badge cluster top-right. */}
      {visible.length > 0 && (
        <div
          style={{
            position: 'fixed', top: 'calc(env(safe-area-inset-top, 0px) + 16px)', right: 16, zIndex: 9998,
            display: 'flex', flexDirection: 'column', gap: 6,
            padding: 8,
            background: 'rgba(11,11,20,.78)',
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            backdropFilter: 'blur(6px)',
            maxWidth: 260,
          }}
        >
          <div style={{ fontFamily: 'DM Mono', fontSize: 9.5, color: C.textDim, textTransform: 'uppercase', letterSpacing: '.12em', padding: '0 4px' }}>
            Vanguard watching · {visible.length}
          </div>
          {visible.map((p) => {
            const meta = rankMeta(p.rank);
            return (
              <div key={p.uid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 6, background: 'rgba(255,255,255,.025)' }}>
                <img src={meta.badge} alt="" style={{ height: 14, width: 'auto', flexShrink: 0 }} draggable={false} />
                <span style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: C.text, fontWeight: 700, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {meta.label}
                </span>
                {canRemove && p.uid !== profile?.uid && (
                  <button
                    onClick={() => onRemove(p.uid)}
                    title={`Remove ${meta.label}`}
                    style={{ background: 'transparent', border: 0, color: C.ember, cursor: 'pointer', padding: 2, fontSize: 14, lineHeight: 1, fontFamily: 'inherit' }}
                  >×</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        @keyframes vanguardBannerIn {
          from { opacity: 0; transform: translate(-50%, -16px) scale(.96); }
          to   { opacity: 1; transform: translate(-50%, 0) scale(1); }
        }
        @keyframes vanguardBannerOut {
          to { opacity: 0; transform: translate(-50%, -8px) scale(.98); }
        }
      `}</style>
    </>
  );
}
