import { useEffect, useRef, useState } from 'react';

// Rolls to a new value with a brief vertical tick in the direction of change
// (up on increment, down on decrement). Keyed remount replays the .an-roll
// keyframe on every change. Reduced-motion safe (the global
// html[data-reduced-motion] rule zeroes the animation). Shared so like counts,
// viewer counts, etc. all animate identically.
export default function AnimatedNumber({ value, className = '', format }) {
  const [display, setDisplay] = useState(value);
  const dir = useRef(0); // 1 = up (increment), -1 = down
  const prev = useRef(value);

  useEffect(() => {
    if (value === prev.current) return;
    dir.current = value > prev.current ? 1 : -1;
    prev.current = value;
    setDisplay(value);
  }, [value]);

  const text = format ? format(display) : display;
  return (
    <span className={`inline-block tabular-nums ${className}`}>
      <span key={display} className="an-roll" style={{ '--an-dir': dir.current }}>{text}</span>
    </span>
  );
}
