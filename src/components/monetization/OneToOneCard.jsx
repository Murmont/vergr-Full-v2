// src/components/monetization/OneToOneCard.jsx
//
// The 1:1 session card that appears in a DM, a group chat or a squad chat when
// somebody starts a private session.
//
// ## Why this is a live component and not a static bubble
//
// The first version rendered a fixed "1:1 session — Join" card. It said Join
// whether the host was still setting up, live, or had finished an hour ago, so
// the button was a coin flip: it either worked or dropped the person onto a
// dead watch page with no explanation. A session has a lifetime, so the card
// has to track it — it subscribes to the stream document and shows the state
// the session is actually in.
//
// `streams/{id}` is world-readable, so reading the status here needs no
// callable. That is fine and is not the paywall: the playback URL is NOT on
// that document for a 1:1 (or for a paid stream), and getAccess hands it over
// only to a uid on the session's guest list. Knowing a session exists is not
// the same as being able to watch it.
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../../firebase/config';
import Icon from '../Icon';

/**
 * @param {string}  streamId    the session's stream id
 * @param {number}  priceCoins  0 for a free session
 * @param {boolean} isMe        true when the viewer is the host
 * @param {string}  hostName    fallback label before the document loads
 * @param {string}  hostAvatar  fallback backdrop before the document loads
 */
export default function OneToOneCard({ streamId, priceCoins = 0, isMe = false, hostName, hostAvatar }) {
  const navigate = useNavigate();
  const [stream, setStream] = useState(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!streamId) return undefined;
    const unsub = onSnapshot(
      doc(db, 'streams', streamId),
      (snap) => {
        if (!snap.exists()) { setMissing(true); return; }
        setStream({ id: snap.id, ...snap.data() });
      },
      // A read failure is not a reason to offer a button that cannot work.
      () => setMissing(true),
    );
    return unsub;
  }, [streamId]);

  const status = missing ? 'ended' : (stream?.status || null);
  const live = status === 'live';
  const ended = status === 'ended' || missing;
  const price = Math.floor(priceCoins || stream?.access?.priceCoins || 0);

  const name = stream?.hostName || stream?.hostUsername || hostName || 'Private session';
  const backdrop = stream?.thumbnailUrl || stream?.coverUrl || stream?.thumbUrl || hostAvatar || null;

  return (
    <div className="relative w-[250px] max-w-full overflow-hidden rounded-2xl bg-surface-2">
      {/* The host's own thumbnail, dimmed, rather than a flat panel: the card
          should look like the person it is from. */}
      {backdrop && (
        <img
          src={backdrop}
          alt=""
          aria-hidden
          className={`absolute inset-0 w-full h-full object-cover ${ended ? 'opacity-15 grayscale' : 'opacity-30'}`}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/45 to-black/70" />

      <div className="relative p-3 flex flex-col items-center gap-2 text-center">
        <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-wide uppercase text-white/55">
          <Icon name="videocam" size={13} />
          1:1 session
        </div>

        <div className="text-[13.5px] font-bold text-white truncate max-w-full">{name}</div>

        {/* State first, price second. Somebody looking at an old card needs to
            know it is over before they need to know what it would have cost. */}
        {ended ? (
          <div className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold text-white/50">
            Session ended
          </div>
        ) : !live ? (
          <div className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold text-white/70">
            {isMe ? 'Waiting for you to start' : 'Starting soon'}
          </div>
        ) : (
          <>
            <div className="text-[11px] text-white/70">
              {price > 0 ? (
                <span className="inline-flex items-center gap-1">
                  <Icon name="paid" size={13} className="text-brand-gold" />
                  <span className="font-dmmono tabular-nums font-bold">{price.toLocaleString()}</span>
                  to join
                </span>
              ) : 'Free to join'}
            </div>
            {isMe ? (
              <button
                onClick={(e) => { e.stopPropagation(); navigate(`/broadcast/${streamId}`); }}
                className="w-full rounded-full bg-white/15 hover:bg-white/25 text-white font-bold text-[13px] py-2 transition"
              >
                Back to your session
              </button>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); navigate(`/watch/${streamId}`); }}
                className="w-full rounded-full bg-gradient-to-r from-brand-pink to-brand-violet-light hover:opacity-90 text-white font-bold text-[13px] py-2 transition"
              >
                {price > 0 ? 'Tip to Join' : 'Join'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
