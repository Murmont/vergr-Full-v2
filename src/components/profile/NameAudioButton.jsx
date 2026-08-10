// Tiny play button beside a display name that speaks the user's recorded
// name-pronunciation clip (profile.nameAudioUrl, set in Edit Profile →
// Profile Images). Renders nothing when there's no clip.

import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';

export default function NameAudioButton({ url, accent = '#B44FFF', size = 22 }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef(null);

  useEffect(() => () => audioRef.current?.pause(), []);

  if (!url) return null;

  const play = (e) => {
    e.stopPropagation();
    if (playing) { audioRef.current?.pause(); setPlaying(false); return; }
    const a = new Audio(url);
    audioRef.current = a;
    setPlaying(true);
    a.onended = () => setPlaying(false);
    a.onerror = () => setPlaying(false);
    a.play().catch(() => setPlaying(false));
  };

  return (
    <button
      onClick={play}
      className="rounded-full flex items-center justify-center shrink-0 transition-transform hover:scale-110"
      style={{
        width: size, height: size,
        background: `${accent}26`, border: `1px solid ${accent}59`, color: accent,
      }}
      title="Hear name pronunciation"
    >
      <Icon name={playing ? 'graphic_eq' : 'volume_up'} size={Math.round(size * 0.55)} />
    </button>
  );
}
